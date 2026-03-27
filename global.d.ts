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
  clozeHint?: string;
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

interface CorpusProgress {
  stage: string;
  current?: number;
  total?: number;
  message: string;
}

interface CEFRBand {
  level: string;
  knownCount: number;
  totalInList: number;
  coverage: number;
}

interface LevelProfile {
  bands: CEFRBand[];
  floorLevel: string;
  estimatedLevel: string;
}

interface CorpusStats {
  totalLemmas: number;
  totalMWEs: number;
  knownMWEs: number;
  unknownMWEs: number;
  lemmasByPos: { pos: string; count: number }[];
  mwesByCategory: { category: string; count: number }[];
  imports: { deck_name: string; sentence_count: number; lemma_count: number; mwe_count: number; imported_at: string }[];
  levelProfile: LevelProfile;
}

interface TranscriptLemma {
  lemma: string;
  pos: string;
  transcript_count: number;
  general_freq: number;
  score: number;
  first_sentence_index: number;
  sentence_indices: number[];
  is_known: boolean;
  known_source: 'deck' | 'level' | null;
  cefr_level?: string | null;
  one_t_count: number;
}

interface TranscriptLemmaResult {
  success: boolean;
  lemmas?: TranscriptLemma[];
  totalInTranscript?: number;
  knownCount?: number;
  unknownCount?: number;
  analyzedAt?: string;
  userLevel?: string;
  error?: string;
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
  loadSettings: () => Promise<{ selectedDeck: string; chunkingDeck: string; userLevel: string }>;
  saveSettings: (settings: { selectedDeck: string; chunkingDeck: string; userLevel: string }) => Promise<{ success: boolean }>;
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
  fetchAnkiNotes: (deckNames: string[]) => Promise<{ success: boolean; sentences?: string[]; totalNotes?: number; migakuLemmas?: { lemma: string; pos: string }[]; error?: string }>;
  extractLemmas: (sentences: string[]) => Promise<{ success: boolean; lemmas?: { lemma: string; pos: string }[]; error?: string }>;
  buildAnkiCorpus: (params: { deckName: string; sentences: string[]; lemmas: { lemma: string; pos: string }[]; mode?: 'lemmas' | 'mwes' | 'both' }) => Promise<{ success: boolean; lemmaCount?: number; mwes?: MWEResult[]; sentenceCount?: number; skippedCount?: number; error?: string }>;
  approveCorpusMWEs: (params: { deckName: string; mwes: MWEResult[]; sentenceCount: number; lemmaCount: number; processedSentences?: string[] }) => Promise<{ success: boolean; stored?: number }>;
  cancelCorpusBuild: () => Promise<void>;
  onCorpusProgress: (callback: (progress: CorpusProgress) => void) => void;
  getCorpusStats: () => Promise<CorpusStats>;
  isCorpusImported: (deckName: string) => Promise<boolean>;
  checkLemmaExists: (lemma: string) => Promise<{ exists: boolean; pos?: string; source_deck?: string }>;
  resetLemmaDatabase: () => Promise<{ success: boolean; deletedLemmas?: number; deletedImports?: number; deletedProcessed?: number; error?: string }>;
  analyzeTranscriptLemmas: (folder: string) => Promise<TranscriptLemmaResult>;
  loadTranscriptLemmas: (folder: string) => Promise<TranscriptLemmaResult>;
}

interface Window {
  api: ElectronAPI;
  startDownload: () => Promise<void>;
}
