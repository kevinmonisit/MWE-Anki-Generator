import { app, ipcMain, BrowserWindow } from 'electron';
import path from 'path';
import { initMWEDatabase, runMWEPipeline, getMWEsForFolder, getAllMWETypes, markMWEsKnown, setCostCallback, storeLemmas, storeApprovedMWEs, getCorpusStats, recordCorpusImport, isCorpusImported, filterUnprocessedSentences, storeProcessedSentences, type CostCallback, type LemmaEntry, type MWEResult } from './mwe-pipeline';

let activeAbortController: AbortController | null = null;

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

  // --- Corpus builder handlers ---

  let corpusAbortController: AbortController | null = null;

  ipcMain.handle('build-anki-corpus', async (_event, params: { deckName: string; sentences: string[]; lemmas: LemmaEntry[] }) => {
    const apiKey = getApiKey();
    if (!apiKey) {
      return { success: false, error: 'OpenAI API key not found in .env.local' };
    }

    const { deckName, sentences, lemmas } = params;
    const mainWindow = getMainWindow();

    // Step 1: Store lemmas immediately (no review needed)
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('corpus-progress', { stage: 'lemmas', message: `Storing ${lemmas.length} lemmas...` });
    }
    const lemmaCount = storeLemmas(lemmas, deckName);

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
}
