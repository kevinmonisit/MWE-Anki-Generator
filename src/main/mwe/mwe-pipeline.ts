import Database from 'better-sqlite3';
import { net } from 'electron';
import { app } from 'electron';
import fs from 'fs';
import path from 'path';
import { MWE_EXTRACTION_SYSTEM_PROMPT, MWE_NORMALIZATION_SYSTEM_PROMPT } from './mwe-prompts';

export interface MWEResult {
  normalized_form: string;
  surface_form: string;
  categories: string[];
  context_note: string;
  sentence_text: string;
  sentence_index: number;
  is_new: boolean;
  is_known: boolean;
}

export interface MWETypeRow {
  normalized_form: string;
  categories: string[];
  context_note: string;
  frequency: number;
}

export interface MWEProgress {
  stage: 'extracting' | 'normalizing' | 'storing';
  current?: number;
  total?: number;
  sentenceStart?: number;
  sentenceEnd?: number;
  totalSentences?: number;
}

interface MWEExtracted {
  surface_form: string;
  categories: string[];
  sentence_index: number;
  context_note?: string;
}

interface MWENormalized {
  surface_form: string;
  normalized_form: string;
  normalization_note?: string;
}

// --- Database ---

let mweDb: Database.Database | null = null;

export function initMWEDatabase(dbPath: string): Database.Database {
  if (mweDb) return mweDb;
  mweDb = new Database(dbPath);
  mweDb.pragma('journal_mode = WAL');
  mweDb.exec(`
    CREATE TABLE IF NOT EXISTS mwe_types (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      normalized_form TEXT UNIQUE NOT NULL,
      categories TEXT NOT NULL,
      context_note TEXT,
      is_known INTEGER DEFAULT 0,
      first_seen_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS mwe_instances (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      mwe_type_id INTEGER REFERENCES mwe_types(id),
      surface_form TEXT NOT NULL,
      sentence_index INTEGER NOT NULL,
      sentence_text TEXT NOT NULL,
      start_pos INTEGER,
      end_pos INTEGER,
      transcript_file TEXT,
      extracted_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS known_lemmas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lemma TEXT UNIQUE NOT NULL,
      pos TEXT,
      source_deck TEXT NOT NULL,
      general_freq REAL DEFAULT 0,
      first_seen_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS corpus_imports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      deck_name TEXT UNIQUE NOT NULL,
      sentence_count INTEGER NOT NULL DEFAULT 0,
      lemma_count INTEGER NOT NULL DEFAULT 0,
      mwe_count INTEGER NOT NULL DEFAULT 0,
      imported_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS processed_sentences (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sentence_hash TEXT UNIQUE NOT NULL,
      sentence_text TEXT NOT NULL,
      source_deck TEXT NOT NULL,
      processed_at TEXT DEFAULT (datetime('now'))
    );
  `);
  // Migrations for existing databases
  try {
    mweDb.exec(`ALTER TABLE mwe_types ADD COLUMN is_known INTEGER DEFAULT 0`);
  } catch { /* column already exists */ }
  try {
    mweDb.exec(`ALTER TABLE known_lemmas ADD COLUMN general_freq REAL DEFAULT 0`);
  } catch { /* column already exists */ }
  try {
    mweDb.exec(`ALTER TABLE known_lemmas ADD COLUMN cefr_level TEXT DEFAULT NULL`);
  } catch { /* column already exists */ }
  return mweDb;
}

export function getMWEDb(): Database.Database {
  if (!mweDb) throw new Error('MWE database not initialized. Call initMWEDatabase first.');
  return mweDb;
}

// --- OpenAI helpers ---

export type CostCallback = (model: string, promptTokens: number, completionTokens: number, source: string) => void;

let costCallback: CostCallback | undefined;

export function setCostCallback(cb: CostCallback): void {
  costCallback = cb;
}

async function callOpenAI(apiKey: string, systemPrompt: string, userPrompt: string, maxTokens: number = 4000, signal?: AbortSignal, model: string = 'gpt-5.4'): Promise<string> {
  const maxRetries = 5;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const bodyStr = JSON.stringify({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      max_completion_tokens: maxTokens,
      temperature: 0.3,
    });
    const response = await net.fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: bodyStr,
      signal,
    } as RequestInit);

    const json = await response.json() as {
      choices?: { message?: { content?: string } }[];
      usage?: { prompt_tokens: number; completion_tokens: number };
      model?: string;
      error?: { message?: string; type?: string; code?: string };
    };

    if (json.error) {
      const isRateLimit = response.status === 429 || json.error.type === 'rate_limit_error' || json.error.code === 'rate_limit_exceeded';
      if (isRateLimit && attempt < maxRetries - 1) {
        const retryAfterHeader = response.headers.get('retry-after');
        const waitMs = retryAfterHeader ? parseFloat(retryAfterHeader) * 1000 : Math.min(1000 * Math.pow(2, attempt), 10000);
        console.log(`Rate limited, retrying in ${Math.round(waitMs)}ms (attempt ${attempt + 1}/${maxRetries})`);
        await new Promise(resolve => setTimeout(resolve, waitMs));
        continue;
      }
      throw new Error(json.error.message || 'OpenAI API error');
    }

    if (json.usage && costCallback) {
      const source = model === 'gpt-5.1' ? 'mwe-normalize' : 'mwe-extract';
      costCallback(json.model || model, json.usage.prompt_tokens, json.usage.completion_tokens, source);
    }

    return json.choices?.[0]?.message?.content?.trim() || '[]';
  }
  throw new Error('Max retries exceeded');
}

function parseJSONResponse<T>(raw: string): T[] {
  let cleaned = raw.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
  }
  return JSON.parse(cleaned);
}

// --- Extraction & Normalization ---

async function extractMWEsFromBatch(apiKey: string, sentences: { index: number; text: string }[], signal?: AbortSignal): Promise<MWEExtracted[]> {
  const userPrompt = sentences.map((s, i) => `[${i}] ${s.text}`).join('\n');
  const raw = await callOpenAI(apiKey, MWE_EXTRACTION_SYSTEM_PROMPT, `Extract all MWEs from these sentences:\n\n${userPrompt}`, 4000, signal);

  try {
    const parsed = parseJSONResponse<MWEExtracted>(raw);
    return parsed.map(mwe => ({
      ...mwe,
      sentence_index: sentences[mwe.sentence_index]?.index ?? mwe.sentence_index,
    }));
  } catch {
    console.error('Failed to parse extraction response:', raw);
    return [];
  }
}

async function normalizeMWEBatch(apiKey: string, mwes: MWEExtracted[], signal?: AbortSignal): Promise<MWENormalized[]> {
  const input = mwes.map(m => ({ surface_form: m.surface_form, categories: m.categories }));
  const raw = await callOpenAI(
    apiKey,
    MWE_NORMALIZATION_SYSTEM_PROMPT,
    `Normalize these MWEs:\n\n${JSON.stringify(input, null, 2)}`,
    4000,
    signal,
    'gpt-5.1'
  );

  try {
    return parseJSONResponse<MWENormalized>(raw);
  } catch {
    console.error('Failed to parse normalization response:', raw);
    return mwes.map(m => ({ surface_form: m.surface_form, normalized_form: m.surface_form.toLowerCase() }));
  }
}

// --- Storage ---

function storeMWEs(
  db: Database.Database,
  extracted: MWEExtracted[],
  normalized: MWENormalized[],
  sentences: { index: number; text: string }[],
  folder: string
): MWEResult[] {
  const normMap = new Map<string, MWENormalized>();
  for (const n of normalized) {
    normMap.set(n.surface_form, n);
  }

  const sentenceMap = new Map<number, string>();
  for (const s of sentences) {
    sentenceMap.set(s.index, s.text);
  }

  const insertType = db.prepare(
    'INSERT OR IGNORE INTO mwe_types (normalized_form, categories, context_note) VALUES (?, ?, ?)'
  );
  const getType = db.prepare('SELECT id FROM mwe_types WHERE normalized_form = ?');
  const insertInstance = db.prepare(
    'INSERT INTO mwe_instances (mwe_type_id, surface_form, sentence_index, sentence_text, transcript_file) VALUES (?, ?, ?, ?, ?)'
  );

  const results: MWEResult[] = [];

  const transaction = db.transaction(() => {
    for (const mwe of extracted) {
      const norm = normMap.get(mwe.surface_form);
      const normalizedForm = norm?.normalized_form || mwe.surface_form.toLowerCase();
      const categoriesJson = JSON.stringify(mwe.categories);
      const sentenceText = sentenceMap.get(mwe.sentence_index) || '';

      const existing = getType.get(normalizedForm) as { id: number } | undefined;
      const isNew = !existing;

      if (isNew) {
        insertType.run(normalizedForm, categoriesJson, mwe.context_note || null);
      }

      const typeRow = getType.get(normalizedForm) as { id: number };
      if (typeRow) {
        insertInstance.run(typeRow.id, mwe.surface_form, mwe.sentence_index, sentenceText, folder);
      }

      results.push({
        normalized_form: normalizedForm,
        surface_form: mwe.surface_form,
        categories: mwe.categories,
        context_note: mwe.context_note || '',
        sentence_text: sentenceText,
        sentence_index: mwe.sentence_index,
        is_new: isNew,
        is_known: false,
      });
    }
  });

  transaction();
  return results;
}

// --- Pipeline orchestration ---

export async function runMWEPipeline(
  apiKey: string,
  folder: string,
  subtitles: { index: number; text: string }[],
  onProgress: (progress: MWEProgress) => void,
  signal?: AbortSignal,
  dryRun?: boolean
): Promise<MWEResult[]> {
  const db = getMWEDb();
  const allExtracted: MWEExtracted[] = [];
  const batchSize = 20;
  const concurrency = 2; // Keep low to avoid rate limits on gpt-4.1
  const totalBatches = Math.ceil(subtitles.length / batchSize);

  // Step 1: Extract MWEs in concurrent batches
  const extractionBatches: { batch: { index: number; text: string }[]; batchNum: number; sentenceStart: number; sentenceEnd: number }[] = [];
  for (let i = 0; i < subtitles.length; i += batchSize) {
    extractionBatches.push({
      batch: subtitles.slice(i, i + batchSize),
      batchNum: Math.floor(i / batchSize) + 1,
      sentenceStart: i + 1,
      sentenceEnd: Math.min(i + batchSize, subtitles.length),
    });
  }

  for (let i = 0; i < extractionBatches.length; i += concurrency) {
    if (signal?.aborted) throw new DOMException('Extraction cancelled', 'AbortError');

    const chunk = extractionBatches.slice(i, i + concurrency);
    const lastInChunk = chunk[chunk.length - 1];
    onProgress({
      stage: 'extracting',
      current: lastInChunk.batchNum,
      total: totalBatches,
      sentenceStart: chunk[0].sentenceStart,
      sentenceEnd: lastInChunk.sentenceEnd,
      totalSentences: subtitles.length,
    });

    const results = await Promise.all(
      chunk.map(c => extractMWEsFromBatch(apiKey, c.batch, signal))
    );
    for (const extracted of results) {
      allExtracted.push(...extracted);
    }
  }

  if (allExtracted.length === 0) return [];

  // Step 2: Normalize in concurrent batches
  const allNormalized: MWENormalized[] = [];
  const normBatchSize = 15;
  const normTotalBatches = Math.ceil(allExtracted.length / normBatchSize);

  const normBatches: { batch: MWEExtracted[]; batchNum: number }[] = [];
  for (let i = 0; i < allExtracted.length; i += normBatchSize) {
    normBatches.push({
      batch: allExtracted.slice(i, i + normBatchSize),
      batchNum: Math.floor(i / normBatchSize) + 1,
    });
  }

  for (let i = 0; i < normBatches.length; i += concurrency) {
    if (signal?.aborted) throw new DOMException('Normalization cancelled', 'AbortError');

    const chunk = normBatches.slice(i, i + concurrency);
    onProgress({ stage: 'normalizing', current: chunk[chunk.length - 1].batchNum, total: normTotalBatches });

    const results = await Promise.all(
      chunk.map(c => normalizeMWEBatch(apiKey, c.batch, signal))
    );
    for (const normalized of results) {
      allNormalized.push(...normalized);
    }
  }

  // Step 3: Store in database (or return for review if dryRun)
  if (dryRun) {
    // Build results without storing
    const normMap = new Map<string, MWENormalized>();
    for (const n of allNormalized) {
      normMap.set(n.surface_form, n);
    }
    const sentenceMap = new Map<number, string>();
    for (const s of subtitles) {
      sentenceMap.set(s.index, s.text);
    }
    return allExtracted.map(mwe => {
      const norm = normMap.get(mwe.surface_form);
      return {
        normalized_form: norm?.normalized_form || mwe.surface_form.toLowerCase(),
        surface_form: mwe.surface_form,
        categories: mwe.categories,
        context_note: mwe.context_note || '',
        sentence_text: sentenceMap.get(mwe.sentence_index) || '',
        sentence_index: mwe.sentence_index,
        is_new: true,
        is_known: false,
      };
    });
  }

  onProgress({ stage: 'storing' });
  return storeMWEs(db, allExtracted, allNormalized, subtitles, folder);
}

export function storeApprovedMWEs(approvedMWEs: MWEResult[], folder: string): number {
  const db = getMWEDb();
  const insertType = db.prepare(
    'INSERT OR IGNORE INTO mwe_types (normalized_form, categories, context_note) VALUES (?, ?, ?)'
  );
  const getType = db.prepare('SELECT id FROM mwe_types WHERE normalized_form = ?');
  const insertInstance = db.prepare(
    'INSERT INTO mwe_instances (mwe_type_id, surface_form, sentence_index, sentence_text, transcript_file) VALUES (?, ?, ?, ?, ?)'
  );

  let stored = 0;
  const transaction = db.transaction(() => {
    for (const mwe of approvedMWEs) {
      const categoriesJson = JSON.stringify(mwe.categories);
      insertType.run(mwe.normalized_form, categoriesJson, mwe.context_note || null);
      const typeRow = getType.get(mwe.normalized_form) as { id: number } | undefined;
      if (typeRow) {
        insertInstance.run(typeRow.id, mwe.surface_form, mwe.sentence_index, mwe.sentence_text, folder);
        stored++;
      }
    }
  });
  transaction();
  return stored;
}

// --- Query helpers ---

export function getMWEsForFolder(folder: string): MWEResult[] {
  const db = getMWEDb();
  const rows = db.prepare(`
    SELECT t.normalized_form, t.categories, t.context_note, t.is_known, i.surface_form, i.sentence_index, i.sentence_text
    FROM mwe_instances i
    JOIN mwe_types t ON i.mwe_type_id = t.id
    WHERE i.transcript_file = ?
    ORDER BY i.sentence_index
  `).all(folder) as { normalized_form: string; categories: string; context_note: string; is_known: number; surface_form: string; sentence_index: number; sentence_text: string }[];

  return rows.map(r => ({
    normalized_form: r.normalized_form,
    surface_form: r.surface_form,
    categories: JSON.parse(r.categories),
    context_note: r.context_note || '',
    sentence_text: r.sentence_text,
    sentence_index: r.sentence_index,
    is_new: false,
    is_known: !!r.is_known,
  }));
}

export function markMWEsKnown(normalizedForms: string[], known: boolean): void {
  const db = getMWEDb();
  const stmt = db.prepare('UPDATE mwe_types SET is_known = ? WHERE normalized_form = ?');
  const transaction = db.transaction(() => {
    for (const form of normalizedForms) {
      stmt.run(known ? 1 : 0, form);
    }
  });
  transaction();
}

export function getAllMWETypes(): MWETypeRow[] {
  const db = getMWEDb();
  const rows = db.prepare(`
    SELECT t.normalized_form, t.categories, t.context_note, COUNT(i.id) as frequency
    FROM mwe_types t
    LEFT JOIN mwe_instances i ON i.mwe_type_id = t.id
    GROUP BY t.id
    ORDER BY frequency DESC
  `).all() as { normalized_form: string; categories: string; context_note: string; frequency: number }[];

  return rows.map(r => ({
    normalized_form: r.normalized_form,
    categories: JSON.parse(r.categories),
    context_note: r.context_note || '',
    frequency: r.frequency,
  }));
}

// --- Known lemmas ---

export interface LemmaEntry {
  lemma: string;
  pos: string;
  general_freq?: number;
  cefr_level?: string | null;
}

export function storeLemmas(lemmas: LemmaEntry[], sourceDeck: string): number {
  const db = getMWEDb();
  const insert = db.prepare('INSERT OR IGNORE INTO known_lemmas (lemma, pos, source_deck, general_freq, cefr_level) VALUES (?, ?, ?, ?, ?)');
  const transaction = db.transaction(() => {
    for (const l of lemmas) {
      insert.run(l.lemma, l.pos, sourceDeck, l.general_freq ?? 0, l.cefr_level ?? null);
    }
  });
  transaction();
  return lemmas.length;
}

export function checkLemmaExists(lemma: string): { exists: boolean; pos?: string; source_deck?: string } {
  const db = getMWEDb();
  const row = db.prepare('SELECT lemma, pos, source_deck FROM known_lemmas WHERE lemma = ?').get(lemma) as { lemma: string; pos: string; source_deck: string } | undefined;
  if (row) {
    return { exists: true, pos: row.pos, source_deck: row.source_deck };
  }
  return { exists: false };
}

export function resetLemmaDatabase(): { deletedLemmas: number; deletedImports: number; deletedProcessed: number } {
  const db = getMWEDb();
  const lemmaCount = (db.prepare('SELECT COUNT(*) as c FROM known_lemmas').get() as { c: number }).c;
  const importCount = (db.prepare('SELECT COUNT(*) as c FROM corpus_imports').get() as { c: number }).c;
  const processedCount = (db.prepare('SELECT COUNT(*) as c FROM processed_sentences').get() as { c: number }).c;
  db.prepare('DELETE FROM known_lemmas').run();
  db.prepare('DELETE FROM corpus_imports').run();
  db.prepare('DELETE FROM processed_sentences').run();
  return { deletedLemmas: lemmaCount, deletedImports: importCount, deletedProcessed: processedCount };
}

// --- Level inference (CEFR-based) ---

const CEFR_LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'] as const;
const CEFR_LABELS: Record<string, string> = {
  A1: 'A1 (Beginner)',
  A2: 'A2 (Elementary)',
  B1: 'B1 (Intermediate)',
  B2: 'B2 (Upper intermediate)',
  C1: 'C1 (Advanced)',
  C2: 'C2 (Near-native)',
};

export interface CEFRBand {
  level: string;
  knownCount: number;
  totalInList: number;
  coverage: number; // 0-1
}

export interface LevelProfile {
  bands: CEFRBand[];
  floorLevel: string; // highest CEFR level with >= 80% coverage
  estimatedLevel: string; // human-readable label
}

// Cache the CEFR lookup data
interface CEFREntry { lemma: string; pos: string; cefr_level: string; general_freq: number }
let cefrByLemmaPos: Map<string, string> | null = null;
let cefrByLemma: Map<string, string> | null = null;
let cefrTotalsPerLevel: Map<string, number> | null = null;
let cefrAllEntries: CEFREntry[] | null = null;

function loadCEFRData(): void {
  if (cefrByLemmaPos) return; // already loaded

  cefrByLemmaPos = new Map();
  cefrByLemma = new Map();
  cefrTotalsPerLevel = new Map();
  cefrAllEntries = [];

  for (const level of CEFR_LEVELS) cefrTotalsPerLevel.set(level, 0);

  try {
    const cefrPath = path.join(__dirname, '..', '..', '..', '..', 'data', 'cefr_spanish.json');
    const data = JSON.parse(fs.readFileSync(cefrPath, 'utf-8')) as CEFREntry[];
    cefrAllEntries = data;

    for (const entry of data) {
      const key = `${entry.lemma}|${entry.pos}`;
      const existing = cefrByLemmaPos.get(key);
      if (!existing || CEFR_LEVELS.indexOf(entry.cefr_level as typeof CEFR_LEVELS[number]) < CEFR_LEVELS.indexOf(existing as typeof CEFR_LEVELS[number])) {
        cefrByLemmaPos.set(key, entry.cefr_level);
      }
      const existingLemma = cefrByLemma.get(entry.lemma);
      if (!existingLemma || CEFR_LEVELS.indexOf(entry.cefr_level as typeof CEFR_LEVELS[number]) < CEFR_LEVELS.indexOf(existingLemma as typeof CEFR_LEVELS[number])) {
        cefrByLemma.set(entry.lemma, entry.cefr_level);
      }
      cefrTotalsPerLevel.set(entry.cefr_level, (cefrTotalsPerLevel.get(entry.cefr_level) || 0) + 1);
    }
  } catch { /* CEFR data not available */ }
}

export function lookupCEFR(lemma: string, pos?: string, generalFreq?: number): string | null {
  loadCEFRData();
  if (pos) {
    const exact = cefrByLemmaPos!.get(`${lemma}|${pos}`);
    if (exact) return exact;
  }
  const byLemma = cefrByLemma!.get(lemma);
  if (byLemma) return byLemma;
  // Fallback: estimate from Zipf frequency
  if (generalFreq !== undefined && generalFreq >= 1.0) return zipfToCEFR(generalFreq);
  return null;
}

/** Infer CEFR level from zipf frequency (fallback when not in CEFR list) */
function zipfToCEFR(zipf: number): string {
  if (zipf >= 5) return 'A1';
  if (zipf >= 4) return 'A2';
  if (zipf >= 3) return 'B1';
  if (zipf >= 2) return 'B2';
  if (zipf >= 1) return 'C1';
  return 'C2';
}

export function cefrAtOrBelow(level: string | null, floor: string): boolean {
  if (!level) return false;
  return CEFR_LEVELS.indexOf(level as typeof CEFR_LEVELS[number]) <= CEFR_LEVELS.indexOf(floor as typeof CEFR_LEVELS[number]);
}

export function getLevelProfile(): LevelProfile {
  loadCEFRData();
  const db = getMWEDb();
  const knownLemmas = db.prepare('SELECT lemma, pos, general_freq, cefr_level FROM known_lemmas').all() as { lemma: string; pos: string; general_freq: number; cefr_level: string | null }[];

  // Build a set of known lemmas for fast lookup
  const knownLemmaSet = new Set<string>();
  for (const l of knownLemmas) {
    knownLemmaSet.add(l.lemma);
  }

  // Compute frequency threshold for presumed-known words:
  // Use the 25th percentile zipf of known lemmas (conservative estimate).
  // Words in the CEFR list with zipf above this are presumed known.
  const knownFreqs = knownLemmas.map(l => l.general_freq).filter(f => f > 0).sort((a, b) => a - b);
  let freqThreshold = 4.0; // default: top ~2000 words presumed known
  if (knownFreqs.length > 50) {
    const p25 = knownFreqs[Math.floor(knownFreqs.length * 0.25)];
    freqThreshold = Math.min(p25, 5.0); // cap at 5.0 to avoid being too aggressive
  }

  // Count known words per CEFR level from:
  // 1. Words explicitly in the DB (matched to a CEFR level)
  // 2. CEFR list words not in DB but with zipf >= threshold (presumed known)
  const knownPerLevel = new Map<string, number>();
  for (const level of CEFR_LEVELS) knownPerLevel.set(level, 0);

  // First: count DB-known lemmas
  for (const l of knownLemmas) {
    let level = l.cefr_level;
    if (!level) level = lookupCEFR(l.lemma, l.pos);
    if (!level && l.general_freq > 0) level = zipfToCEFR(l.general_freq);
    if (level && knownPerLevel.has(level)) {
      knownPerLevel.set(level, knownPerLevel.get(level)! + 1);
    }
  }

  // Second: count presumed-known CEFR words (not in DB, but common enough)
  for (const entry of cefrAllEntries!) {
    if (knownLemmaSet.has(entry.lemma)) continue; // already counted from DB
    if (entry.general_freq >= freqThreshold) {
      const level = entry.cefr_level;
      if (knownPerLevel.has(level)) {
        knownPerLevel.set(level, knownPerLevel.get(level)! + 1);
      }
    }
  }

  const bands: CEFRBand[] = CEFR_LEVELS.map(level => {
    const totalInList = cefrTotalsPerLevel!.get(level) || 0;
    const knownCount = knownPerLevel.get(level) || 0;
    const coverage = totalInList > 0 ? Math.min(1, knownCount / totalInList) : 0;
    return { level, knownCount, totalInList, coverage };
  });

  // Floor = highest CEFR level where coverage >= 80%
  let floorLevel = 'Pre-A1';
  for (const band of bands) {
    if (band.totalInList > 0 && band.coverage >= 0.8) {
      floorLevel = band.level;
    }
  }

  const estimatedLevel = CEFR_LABELS[floorLevel] || 'Pre-A1';

  return { bands, floorLevel, estimatedLevel };
}

export function getCorpusStats(): {
  totalLemmas: number;
  totalMWEs: number;
  knownMWEs: number;
  unknownMWEs: number;
  lemmasByPos: { pos: string; count: number }[];
  mwesByCategory: { category: string; count: number }[];
  imports: { deck_name: string; sentence_count: number; lemma_count: number; mwe_count: number; imported_at: string }[];
  levelProfile: LevelProfile;
} {
  const db = getMWEDb();

  const totalLemmas = (db.prepare('SELECT COUNT(*) as c FROM known_lemmas').get() as { c: number }).c;
  const totalMWEs = (db.prepare('SELECT COUNT(*) as c FROM mwe_types').get() as { c: number }).c;
  const knownMWEs = (db.prepare('SELECT COUNT(*) as c FROM mwe_types WHERE is_known = 1').get() as { c: number }).c;

  const lemmasByPos = db.prepare('SELECT pos, COUNT(*) as count FROM known_lemmas GROUP BY pos ORDER BY count DESC').all() as { pos: string; count: number }[];

  // Count MWEs by category (categories stored as JSON array)
  const allMweRows = db.prepare('SELECT categories FROM mwe_types').all() as { categories: string }[];
  const catCounts = new Map<string, number>();
  for (const row of allMweRows) {
    try {
      const cats = JSON.parse(row.categories) as string[];
      for (const cat of cats) {
        catCounts.set(cat, (catCounts.get(cat) || 0) + 1);
      }
    } catch { /* skip malformed */ }
  }
  const mwesByCategory = Array.from(catCounts.entries())
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => b.count - a.count);

  const imports = db.prepare('SELECT deck_name, sentence_count, lemma_count, mwe_count, imported_at FROM corpus_imports ORDER BY imported_at DESC').all() as { deck_name: string; sentence_count: number; lemma_count: number; mwe_count: number; imported_at: string }[];

  const levelProfile = getLevelProfile();

  return { totalLemmas, totalMWEs, knownMWEs, unknownMWEs: totalMWEs - knownMWEs, lemmasByPos, mwesByCategory, imports, levelProfile };
}

export function recordCorpusImport(deckName: string, sentenceCount: number, lemmaCount: number, mweCount: number): void {
  const db = getMWEDb();
  db.prepare(`
    INSERT INTO corpus_imports (deck_name, sentence_count, lemma_count, mwe_count)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(deck_name) DO UPDATE SET
      sentence_count = excluded.sentence_count,
      lemma_count = excluded.lemma_count,
      mwe_count = excluded.mwe_count,
      imported_at = datetime('now')
  `).run(deckName, sentenceCount, lemmaCount, mweCount);
}

export function isCorpusImported(deckName: string): boolean {
  const db = getMWEDb();
  const row = db.prepare('SELECT id FROM corpus_imports WHERE deck_name = ?').get(deckName);
  return !!row;
}

// --- Processed sentences tracking ---

function sentenceHash(text: string): string {
  // Normalize whitespace and lowercase for consistent deduplication
  return text.trim().toLowerCase().replace(/\s+/g, ' ');
}

export function getProcessedSentences(): Set<string> {
  const db = getMWEDb();
  const rows = db.prepare('SELECT sentence_hash FROM processed_sentences').all() as { sentence_hash: string }[];
  return new Set(rows.map(r => r.sentence_hash));
}

export function storeProcessedSentences(sentences: string[], sourceDeck: string): number {
  const db = getMWEDb();
  const insert = db.prepare('INSERT OR IGNORE INTO processed_sentences (sentence_hash, sentence_text, source_deck) VALUES (?, ?, ?)');
  let count = 0;
  const transaction = db.transaction(() => {
    for (const s of sentences) {
      const hash = sentenceHash(s);
      const result = insert.run(hash, s, sourceDeck);
      if (result.changes > 0) count++;
    }
  });
  transaction();
  return count;
}

export function filterUnprocessedSentences(sentences: string[]): { newSentences: string[]; skippedCount: number } {
  const processed = getProcessedSentences();
  const newSentences: string[] = [];
  let skippedCount = 0;
  for (const s of sentences) {
    if (processed.has(sentenceHash(s))) {
      skippedCount++;
    } else {
      newSentences.push(s);
    }
  }
  return { newSentences, skippedCount };
}
