import Database from 'better-sqlite3';
import { net } from 'electron';
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
  `);
  // Migration: add is_known column for existing databases
  try {
    mweDb.exec(`ALTER TABLE mwe_types ADD COLUMN is_known INTEGER DEFAULT 0`);
  } catch { /* column already exists */ }
  return mweDb;
}

export function getMWEDb(): Database.Database {
  if (!mweDb) throw new Error('MWE database not initialized. Call initMWEDatabase first.');
  return mweDb;
}

// --- OpenAI helpers ---

async function callOpenAI(apiKey: string, systemPrompt: string, userPrompt: string, maxTokens: number = 4000, signal?: AbortSignal, model: string = 'gpt-4.1'): Promise<string> {
  const maxRetries = 5;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const bodyStr = JSON.stringify({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      max_tokens: maxTokens,
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
    'gpt-4.1'
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
  signal?: AbortSignal
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

  // Step 3: Store in database
  onProgress({ stage: 'storing' });
  return storeMWEs(db, allExtracted, allNormalized, subtitles, folder);
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
