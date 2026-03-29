import { app, ipcMain, BrowserWindow } from 'electron';
import path from 'path';
import { spawn } from 'child_process';
import { initMWEDatabase, runMWEPipeline, getMWEsForFolder, getAllMWETypes, markMWEsKnown, setCostCallback, storeLemmas, storeApprovedMWEs, getCorpusStats, recordCorpusImport, isCorpusImported, filterUnprocessedSentences, storeProcessedSentences, resetLemmaDatabase, checkLemmaExists, getMWEDb, type CostCallback, type LemmaEntry, type MWEResult } from './mwe-pipeline';

let activeAbortController: AbortController | null = null;

function batchZipfLookup(lemmas: LemmaEntry[]): Promise<LemmaEntry[]> {
  return new Promise((resolve) => {
    const venvPython = path.join(__dirname, '..', '..', '..', '..', '.venv-spacy', 'bin', 'python3.13');
    const scriptPath = path.join(__dirname, '..', '..', '..', '..', 'scripts', 'zipf_lookup.py');
    const proc = spawn(venvPython, [scriptPath]);

    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (data: Buffer) => { stdout += data.toString(); });
    proc.stderr.on('data', (data: Buffer) => { stderr += data.toString(); });

    proc.stdin.write(JSON.stringify(lemmas));
    proc.stdin.end();

    proc.on('close', (code) => {
      if (code === 0) {
        try {
          resolve(JSON.parse(stdout) as LemmaEntry[]);
        } catch {
          resolve(lemmas); // fallback: return without freq
        }
      } else {
        resolve(lemmas); // fallback on error
      }
    });
    proc.on('error', () => resolve(lemmas));
  });
}

export function registerMWEHandlers(getMainWindow: () => BrowserWindow | null, getApiKey: () => string, onCost?: CostCallback): void {
  if (onCost) setCostCallback(onCost);
  const dbPath = path.join(app.getPath('userData'), 'mwe.db');
  initMWEDatabase(dbPath);

  ipcMain.handle('extract-mwes', async (_event, params: { folder: string; subtitles: { index: number; text: string }[] }) => {
    const apiKey = getApiKey();
    if (!apiKey) {
      return { success: false, error: 'OpenAI API key not found in .env.local' };
    }

    const { folder, subtitles: subs } = params;
    const mainWindow = getMainWindow();

    // Create abort controller for this extraction
    activeAbortController = new AbortController();
    const { signal } = activeAbortController;

    try {
      const results = await runMWEPipeline(apiKey, folder, subs, (progress) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('extract-mwes-progress', progress);
        }
      }, signal);

      return { success: true, results };
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        return { success: false, error: 'cancelled' };
      }
      return { success: false, error: (err as Error).message };
    } finally {
      activeAbortController = null;
    }
  });

  ipcMain.handle('cancel-mwe-extraction', async () => {
    if (activeAbortController) {
      activeAbortController.abort();
      activeAbortController = null;
    }
  });

  ipcMain.handle('get-mwes-for-folder', async (_event, folder: string) => {
    return getMWEsForFolder(folder);
  });

  ipcMain.handle('get-all-mwe-types', async () => {
    return getAllMWETypes();
  });

  ipcMain.handle('mark-mwes-known', async (_event, params: { normalizedForms: string[]; known: boolean }) => {
    markMWEsKnown(params.normalizedForms, params.known);
    return { success: true };
  });

  ipcMain.handle('mark-lemmas-known', async (_event, params: { lemmas: { lemma: string; pos: string; general_freq?: number; cefr_level?: string | null }[]; known: boolean }) => {
    if (params.known) {
      storeLemmas(params.lemmas.map(l => ({ lemma: l.lemma, pos: l.pos, general_freq: l.general_freq, cefr_level: l.cefr_level })), 'manual');
    } else {
      const db = getMWEDb();
      const del = db.prepare('DELETE FROM known_lemmas WHERE lemma = ? AND source_deck = ?');
      const transaction = db.transaction(() => {
        for (const l of params.lemmas) {
          del.run(l.lemma, 'manual');
        }
      });
      transaction();
    }
    return { success: true };
  });

  // --- Corpus builder handlers ---

  let corpusAbortController: AbortController | null = null;

  ipcMain.handle('build-anki-corpus', async (_event, params: { deckName: string; sentences: string[]; lemmas: LemmaEntry[]; mode?: 'lemmas' | 'mwes' | 'both' }) => {
    const { deckName, sentences, lemmas, mode = 'both' } = params;
    const mainWindow = getMainWindow();
    const doLemmas = mode === 'lemmas' || mode === 'both';
    const doMWEs = mode === 'mwes' || mode === 'both';

    const apiKey = getApiKey();
    if (doMWEs && !apiKey) {
      return { success: false, error: 'OpenAI API key not found in .env.local' };
    }

    // Step 1: Store lemmas if requested (with frequency enrichment)
    let lemmaCount = 0;
    if (doLemmas) {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('corpus-progress', { stage: 'lemmas', message: `Computing frequencies for ${lemmas.length} lemmas...` });
      }
      const enrichedLemmas = await batchZipfLookup(lemmas);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('corpus-progress', { stage: 'lemmas', message: `Storing ${enrichedLemmas.length} lemmas...` });
      }
      lemmaCount = storeLemmas(enrichedLemmas, deckName);
    }

    // If lemmas-only mode, return early — no MWE extraction needed
    if (!doMWEs) {
      return { success: true, lemmaCount, mwes: [], sentenceCount: sentences.length, skippedCount: 0 };
    }

    // Step 2: Filter out already-processed sentences
    const { newSentences, skippedCount } = filterUnprocessedSentences(sentences);

    if (newSentences.length === 0) {
      return { success: true, lemmaCount, mwes: [], sentenceCount: 0, skippedCount };
    }

    if (mainWindow && !mainWindow.isDestroyed() && skippedCount > 0) {
      mainWindow.webContents.send('corpus-progress', {
        stage: 'filtering',
        message: `Skipping ${skippedCount} already-processed sentences. Analyzing ${newSentences.length} new sentences...`,
      });
    }

    // Step 3: Run MWE pipeline in dry-run mode on NEW sentences only
    corpusAbortController = new AbortController();
    const { signal } = corpusAbortController;

    try {
      const subtitles = newSentences.map((text, index) => ({ index, text }));
      const folder = `anki:${deckName}`;

      const results = await runMWEPipeline(apiKey, folder, subtitles, (progress) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('corpus-progress', {
            stage: progress.stage,
            current: progress.current,
            total: progress.total,
            message: progress.stage === 'extracting'
              ? `Extracting MWEs: batch ${progress.current}/${progress.total} (sentences ${progress.sentenceStart}-${progress.sentenceEnd} of ${progress.totalSentences})`
              : progress.stage === 'normalizing'
                ? `Normalizing: batch ${progress.current}/${progress.total}`
                : 'Preparing results for review...',
          });
        }
      }, signal, true /* dryRun */);

      return { success: true, lemmaCount, mwes: results, sentenceCount: newSentences.length, skippedCount };
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        return { success: false, error: 'cancelled' };
      }
      return { success: false, error: (err as Error).message };
    } finally {
      corpusAbortController = null;
    }
  });

  ipcMain.handle('approve-corpus-mwes', async (_event, params: { deckName: string; mwes: MWEResult[]; sentenceCount: number; lemmaCount: number; processedSentences?: string[] }) => {
    const { deckName, mwes, sentenceCount, lemmaCount, processedSentences } = params;
    const folder = `anki:${deckName}`;
    const stored = storeApprovedMWEs(mwes, folder);
    recordCorpusImport(deckName, sentenceCount, lemmaCount, stored);

    // Mark sentences as processed so they won't be re-analyzed
    if (processedSentences && processedSentences.length > 0) {
      storeProcessedSentences(processedSentences, deckName);
    }

    return { success: true, stored };
  });

  ipcMain.handle('cancel-corpus-build', async () => {
    if (corpusAbortController) {
      corpusAbortController.abort();
      corpusAbortController = null;
    }
  });

  ipcMain.handle('get-corpus-stats', async () => {
    return getCorpusStats();
  });

  ipcMain.handle('is-corpus-imported', async (_event, deckName: string) => {
    return isCorpusImported(deckName);
  });

  ipcMain.handle('check-lemma-exists', async (_event, lemma: string) => {
    return checkLemmaExists(lemma);
  });

  ipcMain.handle('reset-lemma-database', async () => {
    try {
      const result = resetLemmaDatabase();
      return { success: true, ...result };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });
}
