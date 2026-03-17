interface Card {
  id: string;
  expression: string;
  meaning: string;
  translation: string;
  targetLineBefore: string;
  targetLineAfter: string;
  selectedText: string;
  time: string;
  source: string;
  startTime: number;
  endTime: number;
  createdAt: number;
  exported?: boolean;
  chunking?: boolean;
}

interface MWEResult {
  normalized_form: string;
  surface_form: string;
  categories: string[];
  context_note: string;
  sentence_text: string;
  sentence_index: number;
  is_new: boolean;
  is_known: boolean;
}

interface MWEType {
  normalized_form: string;
  categories: string[];
  context_note: string;
  frequency: number;
}

interface MWEProgress {
  stage: 'extracting' | 'normalizing' | 'storing';
  current?: number;
  total?: number;
  sentenceStart?: number;
  sentenceEnd?: number;
  totalSentences?: number;
}

interface ElectronAPI {
  downloadVideo: (url: string) => Promise<{
    success: boolean;
    videoPath?: string;
    srtPath?: string;
    folder?: string;
    error?: string;
  }>;
  onDownloadProgress: (callback: (message: string) => void) => void;
  readFile: (filePath: string) => Promise<string>;
  listDownloads: () => Promise<{
    folder: string;
    title: string;
    url: string;
    videoPath: string;
    srtPath: string;
    hasSrt: boolean;
  }[]>;
  deleteDownload: (folder: string) => Promise<{ success: boolean; error?: string }>;
  ankiInvoke: (action: string, params?: Record<string, unknown>) => Promise<{ result: unknown; error: string | null }>;
  explainText: (params: { selectedText: string; fullSentence: string; sentenceBefore: string; sentenceAfter: string }) => Promise<{ success: boolean; translation?: string; explanation?: string; error?: string }>;
  getDownloadPath: (folder: string) => Promise<string>;
  loadSettings: () => Promise<{ selectedDeck: string; chunkingDeck: string }>;
  saveSettings: (settings: { selectedDeck: string; chunkingDeck: string }) => Promise<{ success: boolean }>;
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
  markMWEsKnown: (params: { normalizedForms: string[]; known: boolean }) => Promise<{ success: boolean }>;
}

interface Window {
  api: ElectronAPI;
  startDownload: () => Promise<void>;
}
