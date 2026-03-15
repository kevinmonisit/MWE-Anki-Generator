import { contextBridge, ipcRenderer } from 'electron';

export interface UserSettings {
  selectedDeck: string;
  chunkingDeck: string;
}

export interface MWEResult {
  normalized_form: string;
  surface_form: string;
  categories: string[];
  context_note: string;
  sentence_text: string;
  sentence_index: number;
  is_new: boolean;
}

export interface MWEType {
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
  cancelDownload: () => Promise<void>;
  extractMWEs: (params: { folder: string; subtitles: { index: number; text: string }[] }) => Promise<{ success: boolean; results?: MWEResult[]; error?: string }>;
  cancelMWEExtraction: () => Promise<void>;
  onMWEProgress: (callback: (progress: MWEProgress) => void) => void;
  getMWEsForFolder: (folder: string) => Promise<MWEResult[]>;
  getAllMWETypes: () => Promise<MWEType[]>;
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
  cancelDownload: () => ipcRenderer.invoke('cancel-download'),
  extractMWEs: (params: { folder: string; subtitles: { index: number; text: string }[] }) => ipcRenderer.invoke('extract-mwes', params),
  cancelMWEExtraction: () => ipcRenderer.invoke('cancel-mwe-extraction'),
  onMWEProgress: (callback: (progress: MWEProgress) => void) => {
    ipcRenderer.on('extract-mwes-progress', (_event, progress: MWEProgress) => callback(progress));
  },
  getMWEsForFolder: (folder: string) => ipcRenderer.invoke('get-mwes-for-folder', folder),
  getAllMWETypes: () => ipcRenderer.invoke('get-all-mwe-types'),
} satisfies ElectronAPI);
