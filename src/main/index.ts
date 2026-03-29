import { app, BrowserWindow } from 'electron';
import path from 'path';
import { loadOpenAIKey } from './services/openai';
import { registerDownloadHandlers } from './ipc/download';
import { registerDataHandlers, trackApiCost } from './ipc/data';
import { registerExplainHandlers } from './ipc/explain';
import { registerAnkiHandlers } from './ipc/anki';
import { registerLemmaHandlers } from './ipc/lemma-analysis';
import { registerMWEHandlers } from './mwe/mwe-ipc';

let mainWindow: BrowserWindow | null = null;
const getMainWindow = () => mainWindow;
const OPENAI_API_KEY = loadOpenAIKey();
const getApiKey = () => OPENAI_API_KEY;

// Create a cost tracker that passes the mainWindow for notifications
const trackCost = (model: string, promptTokens: number, completionTokens: number, source: string) => {
  trackApiCost(model, promptTokens, completionTokens, source, mainWindow);
};

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 850,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, '..', '..', '..', 'index.html'));
}

app.whenReady().then(() => {
  createWindow();

  // Register all IPC handler groups
  registerDataHandlers(getMainWindow);
  registerDownloadHandlers(getMainWindow);
  registerExplainHandlers(getApiKey, trackCost);
  registerAnkiHandlers(getApiKey, trackCost);
  registerLemmaHandlers(getMainWindow, getApiKey, trackCost);
  registerMWEHandlers(getMainWindow, getApiKey, trackCost);
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
