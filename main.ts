import { app, BrowserWindow, ipcMain, net } from 'electron';
import path from 'path';
import { spawn, execFile, ChildProcess } from 'child_process';
import fs from 'fs';
import { registerMWEHandlers } from './mwe-ipc';
import { getLevelProfile, cefrAtOrBelow, lookupCEFR } from './mwe-pipeline';

let mainWindow: BrowserWindow | null = null;
let activeDownloadProc: ChildProcess | null = null;
let downloadWasCancelled = false;
const DOWNLOADS_DIR = path.join(app.getPath('userData'), 'downloads');
const SETTINGS_DIR = path.join(app.getPath('userData'), 'settings');
const SETTINGS_FILE = path.join(SETTINGS_DIR, 'user-settings.json');
const COST_FILE = path.join(SETTINGS_DIR, 'api-cost.json');

interface UserSettings {
  selectedDeck: string;
  chunkingDeck: string;
  userLevel: string; // CEFR level: A1, A2, B1, B2, C1, C2
}

function loadSettings(): UserSettings {
  try {
    fs.mkdirSync(SETTINGS_DIR, { recursive: true });
    const data = fs.readFileSync(SETTINGS_FILE, 'utf-8');
    return JSON.parse(data);
  } catch {
    return { selectedDeck: '', chunkingDeck: '', userLevel: 'B1' };
  }
}

function saveSettings(settings: UserSettings): void {
  fs.mkdirSync(SETTINGS_DIR, { recursive: true });
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));
}

// Card storage on disk
const CARDS_DIR = path.join(app.getPath('userData'), 'cards');

// Lemma analysis storage on disk (per-video)
const LEMMAS_DIR = path.join(app.getPath('userData'), 'lemmas');

function loadLemmasFromDisk(folder: string): { lemmas: TranscriptLemmaData[]; analyzedAt: string } | null {
  try {
    const filePath = path.join(LEMMAS_DIR, `${folder}.json`);
    const data = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(data);
  } catch {
    return null;
  }
}

function saveLemmasToDisk(folder: string, lemmas: TranscriptLemmaData[]): void {
  fs.mkdirSync(LEMMAS_DIR, { recursive: true });
  fs.writeFileSync(
    path.join(LEMMAS_DIR, `${folder}.json`),
    JSON.stringify({ lemmas, analyzedAt: new Date().toISOString() }, null, 2)
  );
}

interface TranscriptLemmaData {
  lemma: string; pos: string; transcript_count: number; general_freq: number; score: number; first_sentence_index: number; sentence_indices: number[]; is_known: boolean; known_source: 'deck' | 'level' | null; cefr_level?: string | null; one_t_count: number;
}

function loadCardsFromDisk(folder: string): Card[] {
  try {
    const filePath = path.join(CARDS_DIR, `${folder}.json`);
    const data = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(data);
  } catch {
    return [];
  }
}

function saveCardsToDisk(folder: string, cards: Card[]): void {
  fs.mkdirSync(CARDS_DIR, { recursive: true });
  fs.writeFileSync(path.join(CARDS_DIR, `${folder}.json`), JSON.stringify(cards, null, 2));
}

interface Card {
  id: string;
  expression: string;
  meaning: string;
  translation: string;
  targetLineBefore: string;
  targetLineAfter: string;
  selectedText: string;
  time: string;
  source: string;
  startTime: number;
  endTime: number;
  createdAt: number;
  exported?: boolean;
  chunking?: boolean;
  clozeHint?: string;
}

// Load OpenAI API key from .env.local
function loadOpenAIKey(): string {
  try {
    const envPath = path.join(__dirname, '..', '.env.local');
    const envContent = fs.readFileSync(envPath, 'utf-8');
    const match = envContent.match(/^OPENAI_API_KEY=(.+)$/m);
    return match ? match[1].trim() : '';
  } catch {
    return '';
  }
}

const OPENAI_API_KEY = loadOpenAIKey();

// --- API Cost Tracking ---
// Pricing per 1M tokens (USD) — update these as models change
const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  'gpt-5.4':      { input: 2.50, output: 10.00 },
  'gpt-5.4-mini': { input: 0.15, output: 0.60 },
  'gpt-5.4-nano': { input: 0.03, output: 0.12 },
  'gpt-5.1':      { input: 2.00, output: 8.00 },
};

interface ApiCostEntry {
  model: string;
  promptTokens: number;
  completionTokens: number;
  costUsd: number;
  source: string;
  timestamp: number;
}

interface ApiCostStore {
  totalCost: number;
  entries: ApiCostEntry[];
}

function loadApiCost(): ApiCostStore {
  try {
    fs.mkdirSync(SETTINGS_DIR, { recursive: true });
    const data = fs.readFileSync(COST_FILE, 'utf-8');
    return JSON.parse(data);
  } catch {
    return { totalCost: 0, entries: [] };
  }
}

function saveApiCostToDisk(): void {
  fs.mkdirSync(SETTINGS_DIR, { recursive: true });
  fs.writeFileSync(COST_FILE, JSON.stringify({ totalCost: totalApiCost, entries: apiCostEntries }, null, 2));
}

const costStore = loadApiCost();
let apiCostEntries: ApiCostEntry[] = costStore.entries;
let totalApiCost = costStore.totalCost;

function trackApiCost(model: string, promptTokens: number, completionTokens: number, source: string): void {
  const pricing = MODEL_PRICING[model] || { input: 2.50, output: 10.00 };
  const cost = (promptTokens * pricing.input + completionTokens * pricing.output) / 1_000_000;
  totalApiCost += cost;
  apiCostEntries.push({ model, promptTokens, completionTokens, costUsd: cost, source, timestamp: Date.now() });
  saveApiCostToDisk();

  // Notify renderer
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('api-cost-update', { totalCost: totalApiCost, entries: apiCostEntries });
  }
}

interface ExplainParams {
  selectedText: string;
  fullSentence: string;
  sentenceBefore: string;
  sentenceAfter: string;
}

interface DownloadSuccess {
  success: true;
  videoPath: string;
  srtPath: string;
  folder: string;
}

interface DownloadFailure {
  success: false;
  error: string;
}

type DownloadResult = DownloadSuccess | DownloadFailure;

interface VideoInfo {
  title?: string;
  url?: string;
  transcriptionMethod?: 'whisper' | 'elevenlabs';
}

interface VideoEntry {
  folder: string;
  title: string;
  url: string;
  videoPath: string;
  srtPath: string;
  hasSrt: boolean;
  transcriptionMethod?: 'whisper' | 'elevenlabs';
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1600,
    height: 1000,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'index.html'));
}

app.whenReady().then(() => {
  createWindow();
  registerMWEHandlers(() => mainWindow, () => OPENAI_API_KEY, trackApiCost);
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// IPC: API cost tracking
ipcMain.handle('get-api-cost', async () => ({ totalCost: totalApiCost, entries: apiCostEntries }));
ipcMain.handle('reset-api-cost', async () => {
  apiCostEntries = [];
  totalApiCost = 0;
  saveApiCostToDisk();
  return { success: true };
});

// IPC: User settings
ipcMain.handle('load-settings', async () => loadSettings());
ipcMain.handle('save-settings', async (_event, settings: UserSettings) => {
  saveSettings(settings);
  return { success: true };
});

// IPC: Card storage on disk
ipcMain.handle('load-cards', async (_event, folder: string) => loadCardsFromDisk(folder));
ipcMain.handle('save-cards', async (_event, folder: string, cards: Card[]) => {
  saveCardsToDisk(folder, cards);
  return { success: true };
});

// IPC: Download video using Python script
ipcMain.handle('download-video', async (_event, url: string): Promise<DownloadResult> => {
  return new Promise((resolve) => {
    const scriptPath = path.join(__dirname, '..', 'scripts', 'download.py');

    const venvPython = path.join(__dirname, '..', '.venv', 'bin', 'python3');
    const proc = spawn(venvPython, [scriptPath, url, DOWNLOADS_DIR], {
      cwd: path.join(__dirname, '..'),
    });
    activeDownloadProc = proc;
    downloadWasCancelled = false;

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data: Buffer) => {
      const msg = data.toString();
      stdout += msg;
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('download-progress', msg.trim());
      }
    });

    proc.stderr.on('data', (data: Buffer) => {
      const msg = data.toString();
      stderr += msg;
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('download-progress', `[stderr] ${msg.trim()}`);
      }
    });

    proc.on('close', (code: number | null) => {
      activeDownloadProc = null;

      if (downloadWasCancelled) {
        // Clean up partial download folder
        const folderMatch = stdout.match(/FOLDER:(.+)/);
        const folderName = folderMatch ? folderMatch[1].trim() : null;
        if (folderName) {
          const videoDir = path.join(DOWNLOADS_DIR, folderName);
          try { fs.rmSync(videoDir, { recursive: true }); } catch { /* ignore */ }
        }
        resolve({ success: false, error: 'cancelled' });
        return;
      }

      if (code === 0) {
        const folderMatch = stdout.match(/FOLDER:(.+)/);
        const folderName = folderMatch ? folderMatch[1].trim() : null;

        if (folderName) {
          const videoDir = path.join(DOWNLOADS_DIR, folderName);
          resolve({
            success: true,
            videoPath: path.join(videoDir, 'video.mp4'),
            srtPath: path.join(videoDir, 'video.srt'),
            folder: folderName,
          });
        } else {
          resolve({ success: false, error: 'Could not determine download folder' });
        }
      } else {
        resolve({
          success: false,
          error: stderr || `Process exited with code ${code}`,
        });
      }
    });

    proc.on('error', (err: Error) => {
      activeDownloadProc = null;
      resolve({ success: false, error: err.message });
    });

  });
});

// IPC: Cancel active download
ipcMain.handle('cancel-download', async () => {
  if (activeDownloadProc && !activeDownloadProc.killed) {
    downloadWasCancelled = true;
    activeDownloadProc.kill();
  }
});

// IPC: List all downloaded videos
ipcMain.handle('list-downloads', async (): Promise<VideoEntry[]> => {
  if (!fs.existsSync(DOWNLOADS_DIR)) return [];

  const entries = fs.readdirSync(DOWNLOADS_DIR, { withFileTypes: true });
  const videos: VideoEntry[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const videoDir = path.join(DOWNLOADS_DIR, entry.name);
    const videoPath = path.join(videoDir, 'video.mp4');
    const srtPath = path.join(videoDir, 'video.srt');
    const infoPath = path.join(videoDir, 'info.json');

    if (!fs.existsSync(videoPath)) continue;

    let title = entry.name;
    let url = '';
    let transcriptionMethod: 'whisper' | 'elevenlabs' | undefined;
    if (fs.existsSync(infoPath)) {
      try {
        const info: VideoInfo = JSON.parse(fs.readFileSync(infoPath, 'utf-8'));
        title = info.title || entry.name;
        url = info.url || '';
        transcriptionMethod = info.transcriptionMethod;
      } catch (_e) { /* ignore */ }
    }

    videos.push({
      folder: entry.name,
      title,
      url,
      videoPath,
      srtPath,
      hasSrt: fs.existsSync(srtPath),
      transcriptionMethod,
    });
  }

  return videos;
});

// IPC: Delete a downloaded video folder
ipcMain.handle('delete-download', async (_event, folder: string) => {
  const videoDir = path.join(DOWNLOADS_DIR, folder);
  if (fs.existsSync(videoDir)) {
    fs.rmSync(videoDir, { recursive: true });
    return { success: true };
  }
  return { success: false, error: 'Folder not found' };
});

ipcMain.handle('read-file', async (_event, filePath: string) => {
  return fs.readFileSync(filePath, 'utf-8');
});

// IPC: Explain selected Spanish text via OpenAI
ipcMain.handle('openai-explain', async (_event, params: ExplainParams) => {
  if (!OPENAI_API_KEY) {
    return { success: false, error: 'OpenAI API key not found in .env.local' };
  }

  const { selectedText, fullSentence, sentenceBefore, sentenceAfter } = params;

  const prompt = `You are a Mexican Spanish language API that explains the specific nuance of specified word(s) in a sentence. The student selected: "${selectedText}"

It appears in this sentence: "${fullSentence}"

Surrounding context (6 sentences before and after):
Before: "${sentenceBefore}"
Current line: "${fullSentence}"
After: "${sentenceAfter}"

Respond with a JSON object (no markdown, no code fences) with exactly two fields:
- "explanation": Respond concisely in no more than 100 words. The specified word(s)/phrases MUST be in their original Spanish. All other explanation text MUST be in English. Use Mexican Spanish. Write an explanation that helps someone understand the word, phrase, or idiom and how it is used in this context, as though you're explaining it to a friend. Use the surrounding context to clarify how the phrase is being used in this specific moment. DO NOT output the word 'nuance'. DO NOT use complicated words. Explain the essence of the word in its context to an intermediate to advanced Spanish learner. DO NOT avoid direct explanations for tricky or slang meanings; explain them as they are. DO NOT overcomplicate with grammar jargon; keep it natural and simple. Conclude with the specific meaning within the context sentence.
- "translation": a natural English translation of the ENTIRE current line "${fullSentence}" (not just the selected part — translate the whole sentence).

Example format: {"explanation":"...","translation":"..."}`;



  try {
    const response = await net.fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'gpt-5.4',
        messages: [{ role: 'user', content: prompt }],
        max_completion_tokens: 300,
        temperature: 0.3,
      }),
    });

    const json = await response.json() as {
      choices?: { message?: { content?: string } }[];
      usage?: { prompt_tokens: number; completion_tokens: number };
      model?: string;
      error?: { message?: string };
    };

    if (json.error) {
      return { success: false, error: json.error.message || 'OpenAI API error' };
    }

    if (json.usage) {
      trackApiCost(json.model || 'gpt-5.4', json.usage.prompt_tokens, json.usage.completion_tokens, 'explain');
    }

    const raw = json.choices?.[0]?.message?.content?.trim() || '{}';
    let translation = '';
    let explanation = '';
    try {
      const parsed = JSON.parse(raw) as { translation?: string; explanation?: string };
      translation = parsed.translation?.trim() || '';
      explanation = parsed.explanation?.trim() || '';
    } catch {
      // Fallback: treat whole response as explanation
      explanation = raw;
    }
    if (!explanation && !translation) explanation = 'No explanation returned.';
    return { success: true, translation, explanation };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
});

// IPC: Get cloze hint for chunking
ipcMain.handle('get-cloze-hint', async (_event, params: { selectedText: string; fullSentence: string; translation: string }) => {
  try {
    const hint = await getClozeHint(params.selectedText, params.fullSentence, params.translation);
    return { success: true, hint };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
});

// IPC: Proxy AnkiConnect requests (bypasses CORS)
ipcMain.handle('anki-invoke', async (_event, action: string, params?: Record<string, unknown>) => {
  const body: Record<string, unknown> = { action, version: 6 };
  if (params) body.params = params;

  try {
    const response = await net.fetch('http://127.0.0.1:8765', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    const json = await response.json();
    return json;
  } catch (err) {
    return { result: null, error: (err as Error).message };
  }
});

// IPC: Get absolute path for a download folder
ipcMain.handle('get-download-path', async (_event, folder: string) => {
  return path.join(DOWNLOADS_DIR, folder);
});

// Migaku POS abbreviation -> UPOS tag mapping
const MIGAKU_POS_MAP: Record<string, string> = {
  'v': 'VERB', 'n': 'NOUN', 'adj': 'ADJ', 'adv': 'ADV',
  'adp': 'ADP', 'pron': 'PRON', 'art': 'DET', 'sconj': 'SCONJ',
  'propn': 'PROPN', 'intj': 'INTJ', 'conj': 'CCONJ', 'num': 'NUM',
  'det': 'DET', 'aux': 'AUX', 'part': 'PART',
};

/**
 * Parse a Migaku-annotated sentence field.
 * Format: word[lemma,pos,features|lemma2,pos2,features2]
 * Returns clean text (brackets stripped) and extracted lemmas.
 */
function parseMigakuSentence(raw: string): { cleanText: string; lemmas: { lemma: string; pos: string }[] } {
  const lemmaMap = new Map<string, string>(); // lemma -> UPOS

  // Extract lemmas from bracket annotations (first analysis per word)
  const bracketRegex = /\[([^\]]*)\]/g;
  let match;
  while ((match = bracketRegex.exec(raw)) !== null) {
    const content = match[1];
    // Take only the first analysis (before any |)
    const firstAnalysis = content.split('|')[0];
    const parts = firstAnalysis.split(',');
    if (parts.length >= 2) {
      const lemma = parts[0].trim().toLowerCase();
      const pos = parts[1].trim().toLowerCase();
      if (lemma && lemma.length > 1 && pos) {
        const upos = MIGAKU_POS_MAP[pos] || pos.toUpperCase();
        if (!lemmaMap.has(lemma)) {
          lemmaMap.set(lemma, upos);
        }
      }
    }
  }

  // Strip all bracket annotations to get clean text
  const cleanText = raw.replace(/\[[^\]]*\]/g, '').trim();

  const lemmas = Array.from(lemmaMap.entries())
    .map(([lemma, pos]) => ({ lemma, pos }))
    .sort((a, b) => a.lemma.localeCompare(b.lemma));

  return { cleanText, lemmas };
}

/**
 * Strip Anki cloze deletion markup from text.
 * {{c1::word::hint}} -> word
 * {{c1::word}} -> word
 */
function stripCloze(text: string): string {
  return text
    .replace(/\{\{c\d+::(.*?)(?:::.*?)?\}\}/g, (_match, content: string) => content.trim())
    .replace(/  +/g, ' ');
}

// IPC: Fetch notes from Anki decks (auto-detects note format by fields)
ipcMain.handle('fetch-anki-notes', async (_event, deckNames: string[]) => {
  try {
    const allSentences: string[] = [];
    const migakuLemmaMap = new Map<string, string>(); // aggregated migaku lemmas

    for (const deck of deckNames) {
      // Fetch all non-suspended notes in the deck
      const res = await ankiRequest('findNotes', { query: `"deck:${deck}" -is:suspended` });
      if (res.error) {
        return { success: false, error: `Failed to find notes in ${deck}: ${res.error}` };
      }
      const noteIds = res.result as number[];
      if (noteIds.length === 0) continue;

      for (let i = 0; i < noteIds.length; i += 100) {
        const batch = noteIds.slice(i, i + 100);
        const infoRes = await ankiRequest('notesInfo', { notes: batch });
        if (infoRes.error) continue;

        const notes = infoRes.result as { fields: Record<string, { value: string }> }[];
        for (const note of notes) {
          const fields = note.fields || {};
          let raw = '';

          // Detect format by fields present:
          // 1. Migaku/standard: has "Sentence" field with bracket annotations
          // 2. Cloze: has "Text" field with {{c1::...}} markup
          // 3. Vocab: has "Word" field (single words/phrases)
          // 4. Basic: has "Front" field
          if (fields.Sentence?.value) {
            raw = fields.Sentence.value.replace(/<[^>]*>/g, '');
            const { cleanText, lemmas } = parseMigakuSentence(raw);
            if (cleanText) allSentences.push(cleanText);
            for (const l of lemmas) {
              if (!migakuLemmaMap.has(l.lemma)) {
                migakuLemmaMap.set(l.lemma, l.pos);
              }
            }
            continue;
          }

          if (fields.Text?.value) {
            raw = fields.Text.value.replace(/<[^>]*>/g, '');
            const clean = stripCloze(raw).trim();
            if (clean) allSentences.push(clean);
            continue;
          }

          if (fields.Word?.value) {
            raw = fields.Word.value.replace(/<[^>]*>/g, '').trim();
            if (raw) allSentences.push(raw);
            continue;
          }

          if (fields.Front?.value) {
            raw = fields.Front.value.replace(/<[^>]*>/g, '').trim();
            if (raw) allSentences.push(raw);
          }
        }
      }
    }

    // Deduplicate sentences
    const unique = [...new Set(allSentences)];

    // Convert aggregated migaku lemmas to array
    const migakuLemmas = Array.from(migakuLemmaMap.entries())
      .map(([lemma, pos]) => ({ lemma, pos }))
      .sort((a, b) => a.lemma.localeCompare(b.lemma));

    return { success: true, sentences: unique, totalNotes: unique.length, migakuLemmas };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
});

// IPC: Extract lemmas using SpaCy (Python 3.13 venv)
ipcMain.handle('extract-lemmas', async (_event, sentences: string[]) => {
  return new Promise((resolve) => {
    const venvPython = path.join(__dirname, '..', '.venv-spacy', 'bin', 'python3.13');
    const scriptPath = path.join(__dirname, '..', 'scripts', 'extract_lemmas.py');

    const proc = spawn(venvPython, [scriptPath], {
      cwd: path.join(__dirname, '..'),
    });

    let stdout = '';
    let stderr = '';

    proc.stdin.write(JSON.stringify(sentences));
    proc.stdin.end();

    proc.stdout.on('data', (data: Buffer) => { stdout += data.toString(); });
    proc.stderr.on('data', (data: Buffer) => { stderr += data.toString(); });

    proc.on('close', (code: number | null) => {
      if (code === 0) {
        try {
          const lemmas = JSON.parse(stdout) as { lemma: string; pos: string }[];
          resolve({ success: true, lemmas });
        } catch {
          resolve({ success: false, error: 'Failed to parse lemma output' });
        }
      } else {
        resolve({ success: false, error: stderr || `SpaCy process exited with code ${code}` });
      }
    });

    proc.on('error', (err: Error) => {
      resolve({ success: false, error: err.message });
    });
  });
});

// IPC: Analyze transcript lemmas — extract unknown lemmas from SRT sorted by importance
ipcMain.handle('analyze-transcript-lemmas', async (_event, folder: string) => {
  return new Promise((resolve) => {
    const downloadsDir = path.join(app.getPath('userData'), 'downloads');
    const srtPath = path.join(downloadsDir, folder, 'video.srt');

    if (!fs.existsSync(srtPath)) {
      resolve({ success: false, error: 'No SRT file found for this video' });
      return;
    }

    const venvPython = path.join(__dirname, '..', '.venv-spacy', 'bin', 'python3.13');
    const scriptPath = path.join(__dirname, '..', 'scripts', 'transcript_lemmas.py');

    const proc = spawn(venvPython, [scriptPath, srtPath], {
      cwd: path.join(__dirname, '..'),
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data: Buffer) => { stdout += data.toString(); });
    proc.stderr.on('data', (data: Buffer) => { stderr += data.toString(); });

    proc.on('close', (code: number | null) => {
      if (code === 0) {
        try {
          const parsed = JSON.parse(stdout) as {
            lemmas: { lemma: string; pos: string; transcript_count: number; general_freq: number; score: number; first_sentence_index: number; sentence_indices: number[]; cefr_level?: string | null }[];
            sentence_map: { lemma: string; pos: string }[][];
          };
          const allLemmas = parsed.lemmas;
          const sentenceMap = parsed.sentence_map;

          // Query known lemmas from DB and tag each lemma
          const dbPath = path.join(app.getPath('userData'), 'mwe.db');
          let knownSet = new Set<string>();
          if (fs.existsSync(dbPath)) {
            const Database = require('better-sqlite3');
            const db = new Database(dbPath, { readonly: true });
            const knownRows = db.prepare('SELECT lemma FROM known_lemmas').all() as { lemma: string }[];
            db.close();
            knownSet = new Set(knownRows.map((r: { lemma: string }) => r.lemma.toLowerCase()));
          }

          // Get user's set level for presumed-known inference
          const settings = loadSettings();
          const userLevel = settings.userLevel || 'B1';

          const taggedLemmas = allLemmas.map(l => {
            const cefrLevel = l.cefr_level ?? lookupCEFR(l.lemma, l.pos, l.general_freq);
            const inDeck = knownSet.has(l.lemma);
            const inferredByLevel = cefrAtOrBelow(cefrLevel, userLevel);
            return {
              ...l,
              cefr_level: cefrLevel,
              is_known: inDeck || inferredByLevel,
              known_source: inDeck ? 'deck' as const : inferredByLevel ? 'level' as const : null,
              one_t_count: 0, // computed below
            };
          });

          // Build known lemma-key set for 1T computation
          const knownKeySet = new Set<string>();
          for (const l of taggedLemmas) {
            if (l.is_known) knownKeySet.add(`${l.lemma}|${l.pos}`);
          }

          // Compute 1T count: for each unknown lemma, how many sentences have it as the ONLY unknown
          const unknownLemmaMap = new Map<string, typeof taggedLemmas[0]>();
          for (const l of taggedLemmas) {
            if (!l.is_known) unknownLemmaMap.set(`${l.lemma}|${l.pos}`, l);
          }

          for (let sentIdx = 0; sentIdx < sentenceMap.length; sentIdx++) {
            const lemmaKeys = sentenceMap[sentIdx];
            const unknownsInSentence: string[] = [];
            for (const lk of lemmaKeys) {
              const key = `${lk.lemma}|${lk.pos}`;
              if (!knownKeySet.has(key)) unknownsInSentence.push(key);
            }
            // 1T sentence: exactly one unknown content word
            if (unknownsInSentence.length === 1) {
              const lemma = unknownLemmaMap.get(unknownsInSentence[0]);
              if (lemma) lemma.one_t_count++;
            }
          }

          const knownCount = taggedLemmas.filter(l => l.is_known).length;
          saveLemmasToDisk(folder, taggedLemmas);
          resolve({ success: true, lemmas: taggedLemmas, totalInTranscript: allLemmas.length, knownCount, unknownCount: allLemmas.length - knownCount, userLevel });
        } catch (e) {
          resolve({ success: false, error: 'Failed to parse lemma output: ' + (e as Error).message });
        }
      } else {
        resolve({ success: false, error: stderr || `Script exited with code ${code}` });
      }
    });

    proc.on('error', (err: Error) => {
      resolve({ success: false, error: err.message });
    });
  });
});

// --- GPT-based lemma analysis ---

function parseSrtToSentences(srtContent: string): string[] {
  const lines: string[] = [];
  for (const block of srtContent.split(/\n\n+/)) {
    const parts = block.trim().split('\n');
    if (parts.length >= 3) {
      const text = parts.slice(2).join(' ').replace(/<[^>]+>/g, '').trim();
      if (text) lines.push(text);
    }
  }
  return lines;
}

const GPT_LEMMA_MODEL = 'gpt-5.4-nano';

async function gptExtractLemmas(sentences: string[]): Promise<{ lemmas: { lemma: string; pos: string }[]; sentenceIndex: number }[]> {
  // Batch sentences to reduce API calls (10 sentences per call)
  const BATCH_SIZE = 10;
  const results: { lemmas: { lemma: string; pos: string }[]; sentenceIndex: number }[] = [];

  for (let i = 0; i < sentences.length; i += BATCH_SIZE) {
    const batch = sentences.slice(i, i + BATCH_SIZE);
    const numberedSentences = batch.map((s, idx) => `${i + idx}: ${s}`).join('\n');

    const prompt = `Extract all content word lemmas (nouns, verbs, adjectives, adverbs) from each numbered Spanish sentence below. Return JSON only — an array of objects with "index" (sentence number), "lemma" (dictionary form, lowercase), and "pos" (one of NOUN, VERB, ADJ, ADV). Exclude function words (articles, prepositions, pronouns, conjunctions, determiners). For verbs, always return the infinitive form. For nouns/adjectives, return the masculine singular form.

${numberedSentences}`;

    try {
      const response = await net.fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${OPENAI_API_KEY}`,
        },
        body: JSON.stringify({
          model: GPT_LEMMA_MODEL,
          messages: [
            { role: 'system', content: 'You are a Spanish linguistics expert. Return only valid JSON arrays, no markdown fences.' },
            { role: 'user', content: prompt },
          ],
          temperature: 0,
        }),
      });

      const json = await response.json() as { choices?: { message?: { content?: string } }[]; usage?: { prompt_tokens: number; completion_tokens: number }; error?: { message: string } };
      if (json.usage) {
        trackApiCost(GPT_LEMMA_MODEL, json.usage.prompt_tokens, json.usage.completion_tokens, 'lemma-analysis');
      }
      if (json.error) continue;

      const content = json.choices?.[0]?.message?.content?.trim() || '[]';
      // Strip markdown fences if present
      const cleaned = content.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '');
      const parsed = JSON.parse(cleaned) as { index: number; lemma: string; pos: string }[];

      for (const entry of parsed) {
        const sentIdx = entry.index;
        if (sentIdx >= 0 && sentIdx < sentences.length) {
          let existing = results.find(r => r.sentenceIndex === sentIdx);
          if (!existing) {
            existing = { sentenceIndex: sentIdx, lemmas: [] };
            results.push(existing);
          }
          existing.lemmas.push({ lemma: entry.lemma.toLowerCase(), pos: entry.pos });
        }
      }
    } catch {
      // Skip failed batches
    }
  }
  return results;
}

ipcMain.handle('analyze-transcript-lemmas-gpt', async (_event, folder: string) => {
  if (!OPENAI_API_KEY) {
    return { success: false, error: 'OpenAI API key not found in .env.local' };
  }

  const downloadsDir = path.join(app.getPath('userData'), 'downloads');
  const srtPath = path.join(downloadsDir, folder, 'video.srt');
  if (!fs.existsSync(srtPath)) {
    return { success: false, error: 'No SRT file found for this video' };
  }

  try {
    const srtContent = fs.readFileSync(srtPath, 'utf-8');
    const sentences = parseSrtToSentences(srtContent);
    if (sentences.length === 0) {
      return { success: false, error: 'No sentences found in SRT' };
    }

    const gptResults = await gptExtractLemmas(sentences);

    // Aggregate lemma data (same structure as the SpaCy pipeline)
    const lemma_pos_data: Record<string, { count: number; first_sentence_index: number; sentence_indices: number[] }> = {};
    const sentence_lemma_keys: Set<string>[] = sentences.map(() => new Set<string>());

    for (const { sentenceIndex, lemmas } of gptResults) {
      for (const { lemma, pos } of lemmas) {
        if (!['NOUN', 'VERB', 'ADJ', 'ADV'].includes(pos)) continue;
        const key = `${lemma}|${pos}`;
        if (!lemma_pos_data[key]) {
          lemma_pos_data[key] = { count: 0, first_sentence_index: sentenceIndex, sentence_indices: [] };
        }
        lemma_pos_data[key].count++;
        if (!lemma_pos_data[key].sentence_indices.includes(sentenceIndex)) {
          lemma_pos_data[key].sentence_indices.push(sentenceIndex);
        }
        sentence_lemma_keys[sentenceIndex].add(key);
      }
    }

    // Build allLemmas array
    const allLemmas = Object.entries(lemma_pos_data).map(([key, info]) => {
      const [lemma, pos] = key.split('|');
      const cefrLevel = lookupCEFR(lemma, pos, 0);
      return {
        lemma,
        pos,
        transcript_count: info.count,
        general_freq: 0,
        score: info.count,
        first_sentence_index: info.first_sentence_index,
        sentence_indices: info.sentence_indices,
        cefr_level: cefrLevel,
      };
    });

    // Sort by CEFR then count
    const CEFR_ORDER = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
    allLemmas.sort((a, b) => {
      const aOrd = a.cefr_level && CEFR_ORDER.includes(a.cefr_level) ? CEFR_ORDER.indexOf(a.cefr_level) : CEFR_ORDER.length;
      const bOrd = b.cefr_level && CEFR_ORDER.includes(b.cefr_level) ? CEFR_ORDER.indexOf(b.cefr_level) : CEFR_ORDER.length;
      if (aOrd !== bOrd) return aOrd - bOrd;
      return b.score - a.score;
    });

    // Tag known/unknown (same logic as SpaCy path)
    const dbPath = path.join(app.getPath('userData'), 'mwe.db');
    let knownSet = new Set<string>();
    if (fs.existsSync(dbPath)) {
      const Database = require('better-sqlite3');
      const db = new Database(dbPath, { readonly: true });
      const knownRows = db.prepare('SELECT lemma FROM known_lemmas').all() as { lemma: string }[];
      db.close();
      knownSet = new Set(knownRows.map((r: { lemma: string }) => r.lemma.toLowerCase()));
    }

    const settings = loadSettings();
    const userLevel = settings.userLevel || 'B1';

    const taggedLemmas = allLemmas.map(l => {
      const inDeck = knownSet.has(l.lemma);
      const inferredByLevel = cefrAtOrBelow(l.cefr_level, userLevel);
      return {
        ...l,
        is_known: inDeck || inferredByLevel,
        known_source: inDeck ? 'deck' as const : inferredByLevel ? 'level' as const : null,
        one_t_count: 0,
      };
    });

    // 1T computation
    const knownKeySet = new Set<string>();
    for (const l of taggedLemmas) {
      if (l.is_known) knownKeySet.add(`${l.lemma}|${l.pos}`);
    }
    const unknownLemmaMap = new Map<string, typeof taggedLemmas[0]>();
    for (const l of taggedLemmas) {
      if (!l.is_known) unknownLemmaMap.set(`${l.lemma}|${l.pos}`, l);
    }
    for (let sentIdx = 0; sentIdx < sentence_lemma_keys.length; sentIdx++) {
      const unknownsInSentence: string[] = [];
      for (const key of sentence_lemma_keys[sentIdx]) {
        if (!knownKeySet.has(key)) unknownsInSentence.push(key);
      }
      if (unknownsInSentence.length === 1) {
        const lemma = unknownLemmaMap.get(unknownsInSentence[0]);
        if (lemma) lemma.one_t_count++;
      }
    }

    const knownCount = taggedLemmas.filter(l => l.is_known).length;
    saveLemmasToDisk(folder, taggedLemmas);
    return { success: true, lemmas: taggedLemmas, totalInTranscript: allLemmas.length, knownCount, unknownCount: allLemmas.length - knownCount, userLevel };
  } catch (e) {
    return { success: false, error: 'GPT lemma analysis failed: ' + (e as Error).message };
  }
});

// IPC: Load saved transcript lemmas for a folder (without re-analyzing)
ipcMain.handle('load-transcript-lemmas', async (_event, folder: string) => {
  const saved = loadLemmasFromDisk(folder);
  if (!saved) return { success: false };
  const { lemmas, analyzedAt } = saved;

  // Re-tag is_known against current DB so counts stay fresh
  const dbPath = path.join(app.getPath('userData'), 'mwe.db');
  let knownSet = new Set<string>();
  if (fs.existsSync(dbPath)) {
    const Database = require('better-sqlite3');
    const db = new Database(dbPath, { readonly: true });
    const knownRows = db.prepare('SELECT lemma FROM known_lemmas').all() as { lemma: string }[];
    db.close();
    knownSet = new Set(knownRows.map((r: { lemma: string }) => r.lemma.toLowerCase()));
  }

  // Use user's set level for presumed-known inference
  const settings = loadSettings();
  const userLevel = settings.userLevel || 'B1';

  for (const l of lemmas) {
    const cefrLevel = l.cefr_level ?? lookupCEFR(l.lemma, l.pos, l.general_freq);
    l.cefr_level = cefrLevel;
    const inDeck = knownSet.has(l.lemma);
    const inferredByLevel = cefrAtOrBelow(cefrLevel, userLevel);
    l.is_known = inDeck || inferredByLevel;
    l.known_source = inDeck ? 'deck' : inferredByLevel ? 'level' : null;
    // Ensure sentence_indices and one_t_count exist (for older cached data)
    if (!l.sentence_indices) l.sentence_indices = [l.first_sentence_index];
    if (l.one_t_count === undefined) l.one_t_count = 0;
  }

  const knownCount = lemmas.filter((l: TranscriptLemmaData) => l.is_known).length;
  return { success: true, lemmas, analyzedAt, totalInTranscript: lemmas.length, knownCount, unknownCount: lemmas.length - knownCount, userLevel };
});

// --- subs2srs export to Anki ---

const PAD_START = 0.25;
const PAD_END = 0.50;

// Stable model ID matching build_custom_deck.py
const ANKI_MODEL_ID = 2_345_678_901;
const ANKI_MODEL_NAME = 'Spanish Vocab in Context';

const ANKI_MODEL_CSS = `
.card {
  font-family: "Noto Sans", Arial, sans-serif;
  font-size: 18px;
  text-align: center;
  color: #e0e0e0;
  background-color: #1e1e2e;
  padding: 20px;
}
.image-wrap img {
  max-width: 100%;
  max-height: 280px;
  border-radius: 6px;
  box-shadow: 0 2px 12px rgba(0,0,0,.6);
  margin-bottom: 12px;
}
.audio-wrap { margin-bottom: 10px; }
.sentence { font-size: 22px; color: #ffffff; margin: 12px 0; line-height: 1.5; }
hr#answer { border: none; border-top: 2px solid #e8b931; margin: 16px auto; width: 60%; }
.phrase { font-size: 20px; font-weight: bold; color: #fab387; margin: 10px 0 6px; }
.translation { font-size: 17px; color: #89dceb; font-style: italic; margin: 8px 0 4px; }
.translation-label { font-size: 10px; text-transform: uppercase; letter-spacing: .08em; color: #6c7086; margin-top: 14px; }
.explanation-label { font-size: 10px; text-transform: uppercase; letter-spacing: .08em; color: #6c7086; margin-top: 14px; }
.explanation { font-size: 16px; color: #bac2de; line-height: 1.6; text-align: left; max-width: 500px; margin: 0 auto; }
.context-wrap { margin: 14px auto 0; max-width: 500px; text-align: left; border-left: 3px solid #313244; padding-left: 10px; }
.context-label { font-size: 10px; text-transform: uppercase; letter-spacing: .08em; color: #6c7086; margin-bottom: 6px; }
.context-line { font-size: 13px; color: #585b70; line-height: 1.5; font-style: italic; }
.context-line.ctx-before, .context-line.ctx-after { color: #45475a; }
.context-line.ctx-current { color: #7f849c; }
.trans-section { margin: 14px auto 0; max-width: 500px; text-align: left; }
.trans-toggle-btn { background: none; border: 1px solid #45475a; color: #6c7086; font-size: 11px; padding: 3px 10px; border-radius: 4px; cursor: pointer; margin-bottom: 6px; }
.trans-toggle-btn:hover { border-color: #89dceb; color: #89dceb; }
.trans-text { font-size: 15px; color: #89dceb; font-style: italic; line-height: 1.5; }
.cloze { font-weight: bold; color: #5b9dff; }
`;

async function ankiRequest(action: string, params?: Record<string, unknown>): Promise<{ result: unknown; error: string | null }> {
  const body: Record<string, unknown> = { action, version: 6 };
  if (params) body.params = params;
  const response = await net.fetch('http://127.0.0.1:8765', {
    method: 'POST',
    body: JSON.stringify(body),
  });
  return await response.json() as { result: unknown; error: string | null };
}

const CARD_FRONT = '<div class="audio-wrap">{{Audio}}</div>';
const CARD_BACK = `<div class="audio-wrap">{{Audio}}</div>
<div class="sentence">{{Sentence}}</div>
<hr id="answer">
<div class="phrase">"{{Phrase}}"</div>
<div class="explanation-label">Explanation</div>
<div class="explanation">{{Explanation}}</div>
{{#ContextBefore}}{{#ContextAfter}}<div class="context-wrap">
<div class="context-label">Context</div>
{{#ContextBefore}}<div class="context-line ctx-before">{{ContextBefore}}</div>{{/ContextBefore}}
<div class="context-line ctx-current">{{Sentence}}</div>
{{#ContextAfter}}<div class="context-line ctx-after">{{ContextAfter}}</div>{{/ContextAfter}}
</div>{{/ContextAfter}}{{/ContextBefore}}
{{#Translation}}<div class="trans-section">
<button class="trans-toggle-btn" onclick="var d=document.getElementById('tr');d.style.display=d.style.display==='none'?'block':'none';this.textContent=d.style.display==='none'?'▶ Show Translation':'▼ Hide Translation'">▶ Show Translation</button>
<div id="tr" class="trans-text" style="display:none">{{Translation}}</div>
</div>{{/Translation}}
<div class="image-wrap">{{Image}}</div>`;

// Cloze model for chunking cards
const CLOZE_MODEL_NAME = 'Spanish Chunking Cloze';
const CLOZE_MODEL_ID = 2_345_678_902;

const CLOZE_FRONT = `<div class="sentence">{{cloze:Text}}</div>`;

const CLOZE_BACK = `<div class="sentence">{{cloze:Text}}</div>
<hr id="answer">
<div class="image-wrap">{{Image}}</div>
<div class="audio-wrap">{{Audio}}</div>
{{#Extra}}<div class="explanation">{{Extra}}</div>{{/Extra}}`;

async function ensureClozeModel(): Promise<void> {
  const res = await ankiRequest('modelNames');
  const models = res.result as string[];

  if (!models.includes(CLOZE_MODEL_NAME)) {
    await ankiRequest('createModel', {
      modelName: CLOZE_MODEL_NAME,
      inOrderFields: ['Text', 'Extra', 'Audio', 'Image'],
      css: ANKI_MODEL_CSS,
      isCloze: true,
      cardTemplates: [
        { Name: 'Cloze', Front: CLOZE_FRONT, Back: CLOZE_BACK },
      ],
    });
  } else {
    await ankiRequest('updateModelStyling', { model: { name: CLOZE_MODEL_NAME, css: ANKI_MODEL_CSS } });
    await ankiRequest('updateModelTemplates', {
      model: {
        name: CLOZE_MODEL_NAME,
        templates: { Cloze: { Front: CLOZE_FRONT, Back: CLOZE_BACK } },
      },
    });
  }
}

async function getClozeHint(selectedText: string, fullSentence: string, translation: string): Promise<string> {
  if (!OPENAI_API_KEY) return translation || 'hint';

  const prompt = `Give me a 1-3 word English translation for the Spanish word/phrase "${selectedText}" as used in "${fullSentence}". The full sentence translates to: "${translation}". Respond with ONLY the short English equivalent, nothing else. Use the most natural, succinct word a native English speaker would use. For example: "apostando" → "betting", "castigo" → "punishment", "ponerse" → "to put on". Keep it as short as possible — ideally one word.`;

  try {
    const response = await net.fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'gpt-5.4-mini',
        messages: [{ role: 'user', content: prompt }],
        max_completion_tokens: 30,
        temperature: 0.3,
      }),
    });

    const json = await response.json() as {
      choices?: { message?: { content?: string } }[];
      usage?: { prompt_tokens: number; completion_tokens: number };
      model?: string;
    };

    if (json.usage) {
      trackApiCost(json.model || 'gpt-5.4-mini', json.usage.prompt_tokens, json.usage.completion_tokens, 'cloze-hint');
    }

    return json.choices?.[0]?.message?.content?.trim() || translation || 'hint';
  } catch {
    return translation || 'hint';
  }
}

async function ensureAnkiModel(): Promise<void> {
  const res = await ankiRequest('modelNames');
  const models = res.result as string[];

  if (!models.includes(ANKI_MODEL_NAME)) {
    await ankiRequest('createModel', {
      modelName: ANKI_MODEL_NAME,
      inOrderFields: ['SegmentId', 'Phrase', 'Sentence', 'Translation', 'Explanation', 'ContextBefore', 'ContextAfter', 'Audio', 'Image'],
      css: ANKI_MODEL_CSS,
      cardTemplates: [
        { Name: 'Comprehension', Front: CARD_FRONT, Back: CARD_BACK },
      ],
    });
  } else {
    // Update styling and templates on existing model
    await ankiRequest('updateModelStyling', { model: { name: ANKI_MODEL_NAME, css: ANKI_MODEL_CSS } });
    await ankiRequest('updateModelTemplates', {
      model: {
        name: ANKI_MODEL_NAME,
        templates: { Comprehension: { Front: CARD_FRONT, Back: CARD_BACK } },
      },
    });
    // Add any missing fields to existing model
    const fieldsRes = await ankiRequest('modelFieldNames', { modelName: ANKI_MODEL_NAME });
    const existingFields = (fieldsRes.result as string[]) || [];
    const fieldsToAdd: { name: string; index: number }[] = [
      { name: 'Translation',   index: 3 },
      { name: 'ContextBefore', index: 5 },
      { name: 'ContextAfter',  index: 6 },
    ];
    for (const f of fieldsToAdd) {
      if (!existingFields.includes(f.name)) {
        await ankiRequest('modelFieldAdd', { modelName: ANKI_MODEL_NAME, fieldName: f.name, index: f.index });
      }
    }
  }
}

function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile('ffmpeg', args, { timeout: 30000 }, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

interface ExportCard {
  id: string;
  expression: string;
  meaning: string;
  translation: string;
  selectedText: string;
  targetLineBefore: string;
  clozeHint?: string;
  targetLineAfter: string;
  startTime: number;
  endTime: number;
  chunking?: boolean;
}

interface ExportParams {
  videoDir: string;
  cards: ExportCard[];
  deckName: string;
  chunkingDeckName: string;
  videoTitle: string;
}

interface ExportResult {
  cardId: string;
  success: boolean;
  error?: string;
}

ipcMain.handle('export-cards-to-anki', async (_event, params: ExportParams): Promise<{ results: ExportResult[] }> => {
  const { videoDir, cards, deckName, chunkingDeckName, videoTitle } = params;
  // Sanitize title for Anki tag: replace spaces/special chars with underscores
  const titleTag = videoTitle.replace(/[^\w\u00C0-\u024F]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 80);
  const videoPath = path.join(videoDir, 'video.mp4');
  const audioDir = path.join(videoDir, 'subs2srs', 'audio');
  const imgDir = path.join(videoDir, 'subs2srs', 'img');

  // Create subs2srs directories
  fs.mkdirSync(audioDir, { recursive: true });
  fs.mkdirSync(imgDir, { recursive: true });

  // Ensure models exist in Anki
  try {
    await ensureAnkiModel();
    if (chunkingDeckName) {
      await ensureClozeModel();
    }
  } catch (err) {
    return { results: cards.map(c => ({ cardId: c.id, success: false, error: `Model creation failed: ${(err as Error).message}` })) };
  }

  const results: ExportResult[] = [];

  for (const card of cards) {
    try {
      const audioFile = `${card.id}.mp3`;
      const imgFile = `${card.id}.jpg`;
      const audioPath = path.join(audioDir, audioFile);
      const imgPath = path.join(imgDir, imgFile);

      // Extract audio clip with padding (matching make_subs2srs.py)
      const paddedStart = Math.max(0, card.startTime - PAD_START);
      const duration = (card.endTime + PAD_END) - paddedStart;
      await runFfmpeg([
        '-y', '-ss', paddedStart.toFixed(3), '-i', videoPath,
        '-t', Math.max(duration, 0.1).toFixed(3),
        '-vn', '-ac', '1', '-ar', '44100', '-q:a', '5',
        audioPath,
      ]);

      // Extract screenshot at midpoint (matching make_subs2srs.py)
      const midpoint = (card.startTime + card.endTime) / 2;
      await runFfmpeg([
        '-y', '-ss', midpoint.toFixed(3), '-i', videoPath,
        '-vframes', '1', '-q:v', '3',
        imgPath,
      ]);

      // Read files as base64 for AnkiConnect
      const audioData = fs.readFileSync(audioPath).toString('base64');
      const imgData = fs.readFileSync(imgPath).toString('base64');

      // Store media in Anki
      await ankiRequest('storeMediaFile', { filename: audioFile, data: audioData });
      await ankiRequest('storeMediaFile', { filename: imgFile, data: imgData });

      // Add note to selected deck
      const addRes = await ankiRequest('addNote', {
        note: {
          deckName,
          modelName: ANKI_MODEL_NAME,
          fields: {
            SegmentId: card.id,
            Phrase: card.selectedText,
            Sentence: card.expression,
            Translation: card.translation || '',
            Explanation: card.meaning,
            ContextBefore: card.targetLineBefore || '',
            ContextAfter: card.targetLineAfter || '',
            Audio: `[sound:${audioFile}]`,
            Image: `<img src="${imgFile}">`,
          },
          options: { allowDuplicate: false },
          tags: ['subs2srs', 'spanish', titleTag].filter(Boolean),
        },
      });

      if (addRes.error) {
        results.push({ cardId: card.id, success: false, error: addRes.error });
      } else {
        // If chunking is enabled for this card, also create a cloze card
        if (card.chunking && chunkingDeckName) {
          try {
            const hint = card.clozeHint || await getClozeHint(card.selectedText, card.expression, card.translation || '');
            // Build cloze text: replace selectedText with cloze deletion
            const clozeText = card.expression.replace(
              card.selectedText,
              `{{c1::${card.selectedText}::${hint}}}`
            );

            await ankiRequest('addNote', {
              note: {
                deckName: chunkingDeckName,
                modelName: CLOZE_MODEL_NAME,
                fields: {
                  Text: clozeText,
                  Extra: card.meaning || '',
                  Audio: `[sound:${audioFile}]`,
                  Image: `<img src="${imgFile}">`,
                },
                options: { allowDuplicate: false },
                tags: ['chunking', 'spanish', titleTag].filter(Boolean),
              },
            });
          } catch (clozeErr) {
            // Cloze failure is non-fatal; the main card was already created
            console.error(`Cloze card failed for ${card.id}:`, (clozeErr as Error).message);
          }
        }
        results.push({ cardId: card.id, success: true });
      }
    } catch (err) {
      results.push({ cardId: card.id, success: false, error: (err as Error).message });
    }
  }

  return { results };
});
