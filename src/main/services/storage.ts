import { app } from 'electron';
import path from 'path';
import fs from 'fs';
import { net } from 'electron';
import type { UserSettings, Card, ApiCostEntry, ApiCostStore, ElevenLabsCostEntry, ElevenLabsCostStore, TranscriptLemmaData } from '../../shared/types';

// --- Paths ---
export const DOWNLOADS_DIR = path.join(app.getPath('userData'), 'downloads');
export const SETTINGS_DIR = path.join(app.getPath('userData'), 'settings');
export const SETTINGS_FILE = path.join(SETTINGS_DIR, 'user-settings.json');
export const COST_FILE = path.join(SETTINGS_DIR, 'api-cost.json');
export const ELEVENLABS_COST_FILE = path.join(SETTINGS_DIR, 'elevenlabs-cost.json');
export const CARDS_DIR = path.join(app.getPath('userData'), 'cards');
export const LEMMAS_DIR = path.join(app.getPath('userData'), 'lemmas');

// --- Settings ---
export function loadSettings(): UserSettings {
  try {
    fs.mkdirSync(SETTINGS_DIR, { recursive: true });
    const data = fs.readFileSync(SETTINGS_FILE, 'utf-8');
    return JSON.parse(data);
  } catch {
    return { selectedDeck: '', chunkingDeck: '', userLevel: 'B1' };
  }
}

export function saveSettings(settings: UserSettings): void {
  fs.mkdirSync(SETTINGS_DIR, { recursive: true });
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));
}

// --- Cards ---
export function loadCardsFromDisk(folder: string): Card[] {
  try {
    const filePath = path.join(CARDS_DIR, `${folder}.json`);
    const data = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(data);
  } catch {
    return [];
  }
}

export function saveCardsToDisk(folder: string, cards: Card[]): void {
  fs.mkdirSync(CARDS_DIR, { recursive: true });
  fs.writeFileSync(path.join(CARDS_DIR, `${folder}.json`), JSON.stringify(cards, null, 2));
}

// --- Lemmas ---
export function loadLemmasFromDisk(folder: string): { lemmas: TranscriptLemmaData[]; analyzedAt: string } | null {
  try {
    const filePath = path.join(LEMMAS_DIR, `${folder}.json`);
    const data = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(data);
  } catch {
    return null;
  }
}

export function saveLemmasToDisk(folder: string, lemmas: TranscriptLemmaData[]): void {
  fs.mkdirSync(LEMMAS_DIR, { recursive: true });
  fs.writeFileSync(
    path.join(LEMMAS_DIR, `${folder}.json`),
    JSON.stringify({ lemmas, analyzedAt: new Date().toISOString() }, null, 2)
  );
}

// --- API Cost ---
export function loadApiCost(): ApiCostStore {
  try {
    fs.mkdirSync(SETTINGS_DIR, { recursive: true });
    const data = fs.readFileSync(COST_FILE, 'utf-8');
    return JSON.parse(data);
  } catch {
    return { totalCost: 0, entries: [] };
  }
}

export function saveApiCostToDisk(totalCost: number, entries: ApiCostEntry[]): void {
  fs.mkdirSync(SETTINGS_DIR, { recursive: true });
  fs.writeFileSync(COST_FILE, JSON.stringify({ totalCost, entries }, null, 2));
}

// --- ElevenLabs Cost ---
export function loadElevenLabsCost(): ElevenLabsCostStore {
  try {
    fs.mkdirSync(SETTINGS_DIR, { recursive: true });
    const data = fs.readFileSync(ELEVENLABS_COST_FILE, 'utf-8');
    return JSON.parse(data);
  } catch {
    return { totalCost: 0, entries: [] };
  }
}

export function saveElevenLabsCostToDisk(totalCost: number, entries: ElevenLabsCostEntry[]): void {
  fs.mkdirSync(SETTINGS_DIR, { recursive: true });
  fs.writeFileSync(ELEVENLABS_COST_FILE, JSON.stringify({ totalCost, entries }, null, 2));
}

// --- AnkiConnect helper ---
export async function ankiRequest(action: string, params?: Record<string, unknown>): Promise<{ result: unknown; error: string | null }> {
  const body: Record<string, unknown> = { action, version: 6 };
  if (params) body.params = params;
  const response = await net.fetch('http://127.0.0.1:8765', {
    method: 'POST',
    body: JSON.stringify(body),
  });
  return await response.json() as { result: unknown; error: string | null };
}
