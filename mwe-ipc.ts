import { app, ipcMain, BrowserWindow } from 'electron';
import path from 'path';
import { initMWEDatabase, runMWEPipeline, getMWEsForFolder, getAllMWETypes } from './mwe-pipeline';

let activeAbortController: AbortController | null = null;

export function registerMWEHandlers(getMainWindow: () => BrowserWindow | null, getApiKey: () => string): void {
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
}
