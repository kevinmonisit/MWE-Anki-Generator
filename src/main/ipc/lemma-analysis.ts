import { app, BrowserWindow, ipcMain, net } from 'electron';
import path from 'path';
import { spawn, ChildProcess } from 'child_process';
import fs from 'fs';
import { ankiRequest, loadSettings, loadLemmasFromDisk, saveLemmasToDisk } from '../services/storage';
import { getLevelProfile, cefrAtOrBelow, lookupCEFR } from '../mwe/mwe-pipeline';
import { MIGAKU_POS_MAP } from '../../shared/constants';
import type { TranscriptLemmaData, LemmaAnalysisProgress } from '../../shared/types';

let activeLemmaProcess: ChildProcess | null = null;
let lemmaAnalysisCancelled = false;

/** Batch-fetch Zipf frequencies for a list of lemmas via the Python venv's wordfreq library. */
function fetchZipfFrequencies(lemmas: string[]): Promise<Record<string, number>> {
  return new Promise((resolve) => {
    if (lemmas.length === 0) { resolve({}); return; }
    const venvPython = path.join(__dirname, '..', '..', '..', '..', '.venv-spacy', 'bin', 'python3.13');
    const script = `
import json, sys
from wordfreq import zipf_frequency
lemmas = json.loads(sys.stdin.read())
print(json.dumps({l: zipf_frequency(l, "es") for l in lemmas}))
`;
    const proc = spawn(venvPython, ['-c', script]);
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (data: Buffer) => { stdout += data.toString(); });
    proc.stderr.on('data', (data: Buffer) => { stderr += data.toString(); });
    proc.stdin.write(JSON.stringify(lemmas));
    proc.stdin.end();
    proc.on('close', (code: number | null) => {
      if (code === 0) {
        try { resolve(JSON.parse(stdout)); } catch { resolve({}); }
      } else {
        resolve({});
      }
    });
    proc.on('error', () => resolve({}));
  });
}

function parseMigakuSentence(raw: string): { cleanText: string; lemmas: { lemma: string; pos: string }[] } {
  const lemmaMap = new Map<string, string>();

  const bracketRegex = /\[([^\]]*)\]/g;
  let match;
  while ((match = bracketRegex.exec(raw)) !== null) {
    const content = match[1];
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

  const cleanText = raw.replace(/\[[^\]]*\]/g, '').trim();
  const lemmas = Array.from(lemmaMap.entries())
    .map(([lemma, pos]) => ({ lemma, pos }))
    .sort((a, b) => a.lemma.localeCompare(b.lemma));

  return { cleanText, lemmas };
}

function stripCloze(text: string): string {
  return text
    .replace(/\{\{c\d+::(.*?)(?:::.*?)?\}\}/g, (_match, content: string) => content.trim())
    .replace(/  +/g, ' ');
}

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

function getKnownLemmaSet(): Set<string> {
  const dbPath = path.join(app.getPath('userData'), 'mwe.db');
  let knownSet = new Set<string>();
  if (fs.existsSync(dbPath)) {
    const Database = require('better-sqlite3');
    const db = new Database(dbPath, { readonly: true });
    const knownRows = db.prepare('SELECT lemma FROM known_lemmas').all() as { lemma: string }[];
    db.close();
    knownSet = new Set(knownRows.map((r: { lemma: string }) => r.lemma.toLowerCase()));
  }
  return knownSet;
}

function tagLemmasWithKnown(
  allLemmas: { lemma: string; pos: string; transcript_count: number; general_freq: number; score: number; first_sentence_index: number; sentence_indices: number[]; cefr_level?: string | null }[],
  knownSet: Set<string>,
  userLevel: string
) {
  return allLemmas.map(l => {
    const cefrLevel = l.cefr_level ?? lookupCEFR(l.lemma, l.pos, l.general_freq);
    const inDeck = knownSet.has(l.lemma);
    const inferredByLevel = cefrAtOrBelow(cefrLevel, userLevel);
    return {
      ...l,
      cefr_level: cefrLevel,
      is_known: inDeck || inferredByLevel,
      known_source: inDeck ? 'deck' as const : inferredByLevel ? 'level' as const : null,
      one_t_count: 0,
    };
  });
}

function computeOneTCounts(
  taggedLemmas: ReturnType<typeof tagLemmasWithKnown>,
  sentenceMap: { lemma: string; pos: string }[][] | Set<string>[]
) {
  const knownKeySet = new Set<string>();
  for (const l of taggedLemmas) {
    if (l.is_known) knownKeySet.add(`${l.lemma}|${l.pos}`);
  }
  const unknownLemmaMap = new Map<string, typeof taggedLemmas[0]>();
  for (const l of taggedLemmas) {
    if (!l.is_known) unknownLemmaMap.set(`${l.lemma}|${l.pos}`, l);
  }

  for (let sentIdx = 0; sentIdx < sentenceMap.length; sentIdx++) {
    const entry = sentenceMap[sentIdx];
    const unknownsInSentence: string[] = [];

    if (entry instanceof Set) {
      for (const key of entry) {
        if (!knownKeySet.has(key)) unknownsInSentence.push(key);
      }
    } else {
      for (const lk of entry) {
        const key = `${lk.lemma}|${lk.pos}`;
        if (!knownKeySet.has(key)) unknownsInSentence.push(key);
      }
    }

    if (unknownsInSentence.length === 1) {
      const lemma = unknownLemmaMap.get(unknownsInSentence[0]);
      if (lemma) lemma.one_t_count++;
    }
  }
}

const GPT_LEMMA_MODEL = 'gpt-5.4-mini';

export function registerLemmaHandlers(
  getMainWindow: () => BrowserWindow | null,
  getApiKey: () => string,
  trackCost: (model: string, promptTokens: number, completionTokens: number, source: string) => void
): void {

  // Cancel lemma analysis (kills SpaCy process or aborts GPT batches)
  ipcMain.handle('cancel-lemma-analysis', async () => {
    lemmaAnalysisCancelled = true;
    if (activeLemmaProcess) {
      activeLemmaProcess.kill();
      activeLemmaProcess = null;
    }
  });

  // Fetch notes from Anki decks
  ipcMain.handle('fetch-anki-notes', async (_event, deckNames: string[]) => {
    try {
      const allSentences: string[] = [];
      const migakuLemmaMap = new Map<string, string>();

      for (const deck of deckNames) {
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

            if (fields.Sentence?.value) {
              raw = fields.Sentence.value.replace(/<[^>]*>/g, '');
              const { cleanText, lemmas } = parseMigakuSentence(raw);
              if (cleanText) allSentences.push(cleanText);
              for (const l of lemmas) {
                if (!migakuLemmaMap.has(l.lemma)) migakuLemmaMap.set(l.lemma, l.pos);
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

      const unique = [...new Set(allSentences)];
      const migakuLemmas = Array.from(migakuLemmaMap.entries())
        .map(([lemma, pos]) => ({ lemma, pos }))
        .sort((a, b) => a.lemma.localeCompare(b.lemma));

      return { success: true, sentences: unique, totalNotes: unique.length, migakuLemmas };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  // Extract lemmas using SpaCy
  ipcMain.handle('extract-lemmas', async (_event, sentences: string[]) => {
    return new Promise((resolve) => {
      const venvPython = path.join(__dirname, '..', '..', '..', '..', '.venv-spacy', 'bin', 'python3.13');
      const scriptPath = path.join(__dirname, '..', '..', '..', '..', 'scripts', 'extract_lemmas.py');

      const proc = spawn(venvPython, [scriptPath], {
        cwd: path.join(__dirname, '..', '..', '..', '..'),
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

  // Analyze transcript lemmas via SpaCy
  ipcMain.handle('analyze-transcript-lemmas', async (_event, folder: string) => {
    lemmaAnalysisCancelled = false;
    return new Promise((resolve) => {
      const downloadsDir = path.join(app.getPath('userData'), 'downloads');
      const srtPath = path.join(downloadsDir, folder, 'video.srt');

      if (!fs.existsSync(srtPath)) {
        resolve({ success: false, error: 'No SRT file found for this video' });
        return;
      }

      const venvPython = path.join(__dirname, '..', '..', '..', '..', '.venv-spacy', 'bin', 'python3.13');
      const scriptPath = path.join(__dirname, '..', '..', '..', '..', 'scripts', 'transcript_lemmas.py');

      const proc = spawn(venvPython, [scriptPath, srtPath], {
        cwd: path.join(__dirname, '..', '..', '..', '..'),
      });
      activeLemmaProcess = proc;

      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (data: Buffer) => { stdout += data.toString(); });
      proc.stderr.on('data', (data: Buffer) => { stderr += data.toString(); });

      proc.on('close', (code: number | null) => {
        activeLemmaProcess = null;
        if (lemmaAnalysisCancelled) {
          resolve({ success: false, error: 'cancelled' });
          return;
        }
        if (code === 0) {
          try {
            const parsed = JSON.parse(stdout) as {
              lemmas: { lemma: string; pos: string; transcript_count: number; general_freq: number; score: number; first_sentence_index: number; sentence_indices: number[]; cefr_level?: string | null }[];
              sentence_map: { lemma: string; pos: string }[][];
            };

            const knownSet = getKnownLemmaSet();
            const settings = loadSettings();
            const userLevel = settings.userLevel || 'B1';

            const taggedLemmas = tagLemmasWithKnown(parsed.lemmas, knownSet, userLevel);
            computeOneTCounts(taggedLemmas, parsed.sentence_map);

            const knownCount = taggedLemmas.filter(l => l.is_known).length;
            saveLemmasToDisk(folder, taggedLemmas);
            resolve({ success: true, lemmas: taggedLemmas, totalInTranscript: parsed.lemmas.length, knownCount, unknownCount: parsed.lemmas.length - knownCount, userLevel });
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

  // GPT-based lemma analysis
  ipcMain.handle('analyze-transcript-lemmas-gpt', async (_event, folder: string) => {
    lemmaAnalysisCancelled = false;
    const apiKey = getApiKey();
    if (!apiKey) {
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

      const onProgress = (progress: LemmaAnalysisProgress) => {
        const win = getMainWindow();
        if (win) win.webContents.send('lemma-analysis-progress', progress);
      };
      const gptResults = await gptExtractLemmas(apiKey, sentences, trackCost, onProgress);

      if (lemmaAnalysisCancelled) {
        return { success: false, error: 'cancelled' };
      }

      // Aggregate lemma data
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

      // Fetch Zipf frequencies for all unique lemmas so CEFR fallback works
      const uniqueLemmas = [...new Set(Object.keys(lemma_pos_data).map(k => k.split('|')[0]))];
      const zipfMap = await fetchZipfFrequencies(uniqueLemmas);

      const allLemmas = Object.entries(lemma_pos_data).map(([key, info]) => {
        const [lemma, pos] = key.split('|');
        const generalFreq = zipfMap[lemma] ?? 0;
        const cefrLevel = lookupCEFR(lemma, pos, generalFreq);
        return {
          lemma, pos,
          transcript_count: info.count,
          general_freq: Math.round(generalFreq * 100) / 100,
          score: Math.round((generalFreq * 1.5 + Math.log2(info.count + 1)) * 100) / 100,
          first_sentence_index: info.first_sentence_index,
          sentence_indices: info.sentence_indices,
          cefr_level: cefrLevel,
        };
      });

      const CEFR_ORDER = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
      allLemmas.sort((a, b) => {
        const aOrd = a.cefr_level && CEFR_ORDER.includes(a.cefr_level) ? CEFR_ORDER.indexOf(a.cefr_level) : CEFR_ORDER.length;
        const bOrd = b.cefr_level && CEFR_ORDER.includes(b.cefr_level) ? CEFR_ORDER.indexOf(b.cefr_level) : CEFR_ORDER.length;
        if (aOrd !== bOrd) return aOrd - bOrd;
        return b.score - a.score;
      });

      const knownSet = getKnownLemmaSet();
      const settings = loadSettings();
      const userLevel = settings.userLevel || 'B1';

      const taggedLemmas = tagLemmasWithKnown(allLemmas, knownSet, userLevel);
      computeOneTCounts(taggedLemmas, sentence_lemma_keys);

      const knownCount = taggedLemmas.filter(l => l.is_known).length;
      saveLemmasToDisk(folder, taggedLemmas);
      return { success: true, lemmas: taggedLemmas, totalInTranscript: allLemmas.length, knownCount, unknownCount: allLemmas.length - knownCount, userLevel };
    } catch (e) {
      return { success: false, error: 'GPT lemma analysis failed: ' + (e as Error).message };
    }
  });

  // Load saved transcript lemmas
  ipcMain.handle('load-transcript-lemmas', async (_event, folder: string) => {
    const saved = loadLemmasFromDisk(folder);
    if (!saved) return { success: false };
    const { lemmas, analyzedAt } = saved;

    const knownSet = getKnownLemmaSet();
    const settings = loadSettings();
    const userLevel = settings.userLevel || 'B1';

    // For lemmas missing CEFR or general_freq (e.g. from older GPT analyses), fetch zipf frequencies
    const lemmasNeedingFreq = lemmas.filter((l: TranscriptLemmaData) => !l.cefr_level && (!l.general_freq || l.general_freq === 0));
    if (lemmasNeedingFreq.length > 0) {
      const uniqueWords = [...new Set(lemmasNeedingFreq.map((l: TranscriptLemmaData) => l.lemma))];
      const zipfMap = await fetchZipfFrequencies(uniqueWords);
      for (const l of lemmasNeedingFreq) {
        if (zipfMap[l.lemma] !== undefined) {
          l.general_freq = Math.round(zipfMap[l.lemma] * 100) / 100;
        }
      }
    }

    for (const l of lemmas) {
      const cefrLevel = l.cefr_level ?? lookupCEFR(l.lemma, l.pos, l.general_freq);
      l.cefr_level = cefrLevel;
      const inDeck = knownSet.has(l.lemma);
      const inferredByLevel = cefrAtOrBelow(cefrLevel, userLevel);
      l.is_known = inDeck || inferredByLevel;
      l.known_source = inDeck ? 'deck' : inferredByLevel ? 'level' : null;
      if (!l.sentence_indices) l.sentence_indices = [l.first_sentence_index];
      if (l.one_t_count === undefined) l.one_t_count = 0;
    }

    const knownCount = lemmas.filter((l: TranscriptLemmaData) => l.is_known).length;
    return { success: true, lemmas, analyzedAt, totalInTranscript: lemmas.length, knownCount, unknownCount: lemmas.length - knownCount, userLevel };
  });
}

async function gptExtractLemmas(
  apiKey: string,
  sentences: string[],
  trackCost: (model: string, promptTokens: number, completionTokens: number, source: string) => void,
  onProgress?: (progress: LemmaAnalysisProgress) => void
): Promise<{ lemmas: { lemma: string; pos: string }[]; sentenceIndex: number }[]> {
  const BATCH_SIZE = 10;
  const CONCURRENCY = 5;
  const totalBatches = Math.ceil(sentences.length / BATCH_SIZE);
  const results: { lemmas: { lemma: string; pos: string }[]; sentenceIndex: number }[] = [];
  let completedBatches = 0;

  async function processBatch(batchStart: number): Promise<void> {
    const batch = sentences.slice(batchStart, batchStart + BATCH_SIZE);
    const numberedSentences = batch.map((s, idx) => `${batchStart + idx}: ${s}`).join('\n');

    const prompt = `Extract all content word lemmas (nouns, verbs, adjectives, adverbs) from each numbered Spanish sentence below. Return JSON only — an array of objects with "index" (sentence number), "lemma" (dictionary form, lowercase), and "pos" (one of NOUN, VERB, ADJ, ADV). Exclude function words (articles, prepositions, pronouns, conjunctions, determiners). For verbs, always return the infinitive form. For nouns/adjectives, return the masculine singular form.

${numberedSentences}`;

    try {
      const response = await net.fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
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
        trackCost(GPT_LEMMA_MODEL, json.usage.prompt_tokens, json.usage.completion_tokens, 'lemma-analysis');
      }
      if (json.error) return;

      const content = json.choices?.[0]?.message?.content?.trim() || '[]';
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
    } finally {
      completedBatches++;
      const processedSentences = Math.min(completedBatches * BATCH_SIZE, sentences.length);
      onProgress?.({ currentBatch: completedBatches, totalBatches, processedSentences, totalSentences: sentences.length });
    }
  }

  // Process batches with concurrency limit
  const batchStarts: number[] = [];
  for (let i = 0; i < sentences.length; i += BATCH_SIZE) {
    batchStarts.push(i);
  }

  for (let i = 0; i < batchStarts.length; i += CONCURRENCY) {
    if (lemmaAnalysisCancelled) break;
    const chunk = batchStarts.slice(i, i + CONCURRENCY);
    await Promise.all(chunk.map(start => processBatch(start)));
  }

  return results;
}
