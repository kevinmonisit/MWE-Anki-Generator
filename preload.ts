import { contextBridge, ipcRenderer } from 'electron';

export interface UserSettings {
  selectedDeck: string;
  chunkingDeck: string;
}

export interface ElectronAPI {
  downloadVideo: (url: string) => Promise<{ success: boolean; videoPath?: string; srtPath?: string; folder?: string; error?: string }>;
  onDownloadProgress: (callback: (message: string) => void) => void;
  readFile: (filePath: string) => Promise<string>;
  listDownloads: () => Promise<{ folder: string; title: string; url: string; videoPath: string; srtPath: string; hasSrt: boolean }[]>;
  deleteDownload: (folder: string) => Promise<{ success: boolean; error?: string }>;
  ankiInvoke: (action: string, params?: Record<string, unknown>) => Promise<{ result: unknown; error: string | null }>;
  explainText: (params: { selectedText: string; fullSentence: string; sentenceBefore: string; sentenceAfter: string }) => Promise<{ success: boolean; translation?: string; explanation?: string; error?: string }>;
  getDownloadPath: (folder: string) => Promise<string>;
  loadSettings: () => Promise<UserSettings>;
  saveSettings: (settings: UserSettings) => Promise<{ success: boolean }>;
  loadCards: (folder: string) => Promise<Card[]>;
  saveCards: (folder: string, cards: Card[]) => Promise<{ success: boolean }>;
  exportCardsToAnki: (params: {
    videoDir: string;
    cards: { id: string; expression: string; meaning: string; translation: string; selectedText: string; targetLineBefore: string; targetLineAfter: string; startTime: number; endTime: number; chunking?: boolean }[];
    deckName: string;
    chunkingDeckName: string;
    videoTitle: string;
  }) => Promise<{ results: { cardId: string; success: boolean; error?: string }[] }>;
}

contextBridge.exposeInMainWorld('api', {
  downloadVideo: (url: string) => ipcRenderer.invoke('download-video', url),
  onDownloadProgress: (callback: (message: string) => void) => {
    ipcRenderer.on('download-progress', (_event, message: string) => callback(message));
  },
  readFile: (filePath: string) => ipcRenderer.invoke('read-file', filePath),
  listDownloads: () => ipcRenderer.invoke('list-downloads'),
  deleteDownload: (folder: string) => ipcRenderer.invoke('delete-download', folder),
  ankiInvoke: (action: string, params?: Record<string, unknown>) => ipcRenderer.invoke('anki-invoke', action, params),
  explainText: (params: { selectedText: string; fullSentence: string; sentenceBefore: string; sentenceAfter: string }) => ipcRenderer.invoke('openai-explain', params),
  getDownloadPath: (folder: string) => ipcRenderer.invoke('get-download-path', folder),
  loadSettings: () => ipcRenderer.invoke('load-settings'),
  saveSettings: (settings: { selectedDeck: string; chunkingDeck: string }) => ipcRenderer.invoke('save-settings', settings),
  loadCards: (folder: string) => ipcRenderer.invoke('load-cards', folder),
  saveCards: (folder: string, cards: Card[]) => ipcRenderer.invoke('save-cards', folder, cards),
  exportCardsToAnki: (params: {
    videoDir: string;
    cards: { id: string; expression: string; meaning: string; translation: string; selectedText: string; targetLineBefore: string; targetLineAfter: string; startTime: number; endTime: number; chunking?: boolean }[];
    deckName: string;
    chunkingDeckName: string;
    videoTitle: string;
  }) => ipcRenderer.invoke('export-cards-to-anki', params),
} satisfies ElectronAPI);
