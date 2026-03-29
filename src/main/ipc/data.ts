import { ipcMain, BrowserWindow } from 'electron';
import type { UserSettings, Card, ApiCostEntry, ElevenLabsCostEntry } from '../../shared/types';
import {
  loadSettings, saveSettings,
  loadCardsFromDisk, saveCardsToDisk,
  loadApiCost, saveApiCostToDisk,
  loadElevenLabsCost, saveElevenLabsCostToDisk,
} from '../services/storage';

// Pricing per 1M tokens (USD)
const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  'gpt-5.4':      { input: 2.50, output: 10.00 },
  'gpt-5.4-mini': { input: 0.15, output: 0.60 },
  'gpt-5.4-nano': { input: 0.03, output: 0.12 },
  'gpt-5.1':      { input: 2.00, output: 8.00 },
};

const costStore = loadApiCost();
let apiCostEntries: ApiCostEntry[] = costStore.entries;
let totalApiCost = costStore.totalCost;

// ElevenLabs Scribe: $0.40/hour
const ELEVENLABS_PRICE_PER_SECOND = 0.40 / 3600;

const elCostStore = loadElevenLabsCost();
let elCostEntries: ElevenLabsCostEntry[] = elCostStore.entries;
let totalElCost = elCostStore.totalCost;

export function trackApiCost(model: string, promptTokens: number, completionTokens: number, source: string, mainWindow?: BrowserWindow | null): void {
  const pricing = MODEL_PRICING[model] || { input: 2.50, output: 10.00 };
  const cost = (promptTokens * pricing.input + completionTokens * pricing.output) / 1_000_000;
  totalApiCost += cost;
  apiCostEntries.push({ model, promptTokens, completionTokens, costUsd: cost, source, timestamp: Date.now() });
  saveApiCostToDisk(totalApiCost, apiCostEntries);

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('api-cost-update', { totalCost: totalApiCost, entries: apiCostEntries });
  }
}

export function trackElevenLabsCost(durationSec: number, source: string, mainWindow?: BrowserWindow | null): void {
  const cost = durationSec * ELEVENLABS_PRICE_PER_SECOND;
  totalElCost += cost;
  elCostEntries.push({ durationSec, costUsd: cost, source, timestamp: Date.now() });
  saveElevenLabsCostToDisk(totalElCost, elCostEntries);

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('elevenlabs-cost-update', { totalCost: totalElCost });
  }
}

export function registerDataHandlers(getMainWindow: () => BrowserWindow | null): void {
  // --- Settings ---
  ipcMain.handle('load-settings', async () => loadSettings());
  ipcMain.handle('save-settings', async (_event, settings: UserSettings) => {
    saveSettings(settings);
    return { success: true };
  });

  // --- Cards ---
  ipcMain.handle('load-cards', async (_event, folder: string) => loadCardsFromDisk(folder));
  ipcMain.handle('save-cards', async (_event, folder: string, cards: Card[]) => {
    saveCardsToDisk(folder, cards);
    return { success: true };
  });

  // --- API Cost ---
  ipcMain.handle('get-api-cost', async () => ({ totalCost: totalApiCost, entries: apiCostEntries }));
  ipcMain.handle('reset-api-cost', async () => {
    apiCostEntries = [];
    totalApiCost = 0;
    saveApiCostToDisk(totalApiCost, apiCostEntries);
    return { success: true };
  });

  // --- ElevenLabs Cost ---
  ipcMain.handle('get-elevenlabs-cost', async () => ({ totalCost: totalElCost, entries: elCostEntries }));
  ipcMain.handle('reset-elevenlabs-cost', async () => {
    elCostEntries = [];
    totalElCost = 0;
    saveElevenLabsCostToDisk(totalElCost, elCostEntries);
    return { success: true };
  });
}
