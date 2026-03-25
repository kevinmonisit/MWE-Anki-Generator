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
  is_known: boolean;
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

export interface CorpusProgress {
  stage: string;
  current?: number;
  total?: number;
  message: string;
}

export interface CorpusStats {
  totalLemmas: number;
  totalMWEs: number;
  knownMWEs: number;
  unknownMWEs: number;
  lemmasByPos: { pos: string; count: number }[];
  mwesByCategory: { category: string; count: number }[];
  imports: { deck_name: string; sentence_count: number; lemma_count: number; mwe_count: number; imported_at: string }[];
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
    cards: { id: string; expression: string; meaning: string; translation: string; selectedText: string; targetLineBefore: string; targetLineAfter: string; startTime: number; endTime: number; chunking?: boolean; clozeHint?: string }[];
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
  markMWEsKnown: (params: { normalizedForms: string[]; known: boolean }) => Promise<{ success: boolean }>;
  getClozeHint: (params: { selectedText: string; fullSentence: string; translation: string }) => Promise<{ success: boolean; hint?: string; error?: string }>;
  getApiCost: () => Promise<{ totalCost: number; entries: { model: string; promptTokens: number; completionTokens: number; costUsd: number; source: string; timestamp: number }[] }>;
  resetApiCost: () => Promise<{ success: boolean }>;
  onApiCostUpdate: (callback: (data: { totalCost: number }) => void) => void;
  fetchAnkiNotes: (deckNames: string[]) => Promise<{ success: boolean; sentences?: string[]; totalNotes?: number; error?: string }>;
  extractLemmas: (sentences: string[]) => Promise<{ success: boolean; lemmas?: { lemma: string; pos: string }[]; error?: string }>;
  buildAnkiCorpus: (params: { deckName: string; sentences: string[]; lemmas: { lemma: string; pos: string }[] }) => Promise<{ success: boolean; lemmaCount?: number; mwes?: MWEResult[]; sentenceCount?: number; skippedCount?: number; error?: string }>;
  approveCorpusMWEs: (params: { deckName: string; mwes: MWEResult[]; sentenceCount: number; lemmaCount: number; processedSentences?: string[] }) => Promise<{ success: boolean; stored?: number }>;
  cancelCorpusBuild: () => Promise<void>;
  onCorpusProgress: (callback: (progress: CorpusProgress) => void) => void;
  getCorpusStats: () => Promise<CorpusStats>;
  isCorpusImported: (deckName: string) => Promise<boolean>;
  analyzeTranscriptLemmas: (folder: string) => Promise<{ success: boolean; lemmas?: { lemma: string; pos: string; transcript_count: number; general_freq: number; score: number; is_known: boolean }[]; totalInTranscript?: number; knownCount?: number; unknownCount?: number; error?: string }>;
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
    cards: { id: string; expression: string; meaning: string; translation: string; selectedText: string; targetLineBefore: string; targetLineAfter: string; startTime: number; endTime: number; chunking?: boolean; clozeHint?: string }[];
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
  markMWEsKnown: (params: { normalizedForms: string[]; known: boolean }) => ipcRenderer.invoke('mark-mwes-known', params),
  getClozeHint: (params: { selectedText: string; fullSentence: string; translation: string }) => ipcRenderer.invoke('get-cloze-hint', params),
  getApiCost: () => ipcRenderer.invoke('get-api-cost'),
  resetApiCost: () => ipcRenderer.invoke('reset-api-cost'),
  onApiCostUpdate: (callback: (data: { totalCost: number }) => void) => {
    ipcRenderer.on('api-cost-update', (_event, data: { totalCost: number }) => callback(data));
  },
  fetchAnkiNotes: (deckNames: string[]) => ipcRenderer.invoke('fetch-anki-notes', deckNames),
  extractLemmas: (sentences: string[]) => ipcRenderer.invoke('extract-lemmas', sentences),
  buildAnkiCorpus: (params: { deckName: string; sentences: string[]; lemmas: { lemma: string; pos: string }[] }) => ipcRenderer.invoke('build-anki-corpus', params),
  approveCorpusMWEs: (params: { deckName: string; mwes: MWEResult[]; sentenceCount: number; lemmaCount: number }) => ipcRenderer.invoke('approve-corpus-mwes', params),
  cancelCorpusBuild: () => ipcRenderer.invoke('cancel-corpus-build'),
  onCorpusProgress: (callback: (progress: CorpusProgress) => void) => {
    ipcRenderer.on('corpus-progress', (_event, progress: CorpusProgress) => callback(progress));
  },
  getCorpusStats: () => ipcRenderer.invoke('get-corpus-stats'),
  isCorpusImported: (deckName: string) => ipcRenderer.invoke('is-corpus-imported', deckName),
  analyzeTranscriptLemmas: (folder: string) => ipcRenderer.invoke('analyze-transcript-lemmas', folder),
} satisfies ElectronAPI);
