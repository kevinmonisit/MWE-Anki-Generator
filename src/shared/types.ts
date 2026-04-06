export interface Card {
  id: string;
  expression: string;
  meaning: string;
  meaningEs: string;
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

export interface UserSettings {
  selectedDeck: string;
  chunkingDeck: string;
  userLevel: string;
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

export interface CEFRBand {
  level: string;
  knownCount: number;
  totalInList: number;
  coverage: number;
}

export interface LevelProfile {
  bands: CEFRBand[];
  floorLevel: string;
  estimatedLevel: string;
}

export interface CorpusStats {
  totalLemmas: number;
  totalMWEs: number;
  knownMWEs: number;
  unknownMWEs: number;
  lemmasByPos: { pos: string; count: number }[];
  mwesByCategory: { category: string; count: number }[];
  imports: { deck_name: string; sentence_count: number; lemma_count: number; mwe_count: number; imported_at: string }[];
  levelProfile: LevelProfile;
}

export interface TranscriptLemma {
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

export type LemmaSource = 'spacy' | 'gpt';

export interface TranscriptLemmaResult {
  success: boolean;
  lemmas?: TranscriptLemma[];
  totalInTranscript?: number;
  knownCount?: number;
  unknownCount?: number;
  analyzedAt?: string;
  userLevel?: string;
  error?: string;
  source?: LemmaSource;
}

export interface AllLemmaSourcesResult {
  success: boolean;
  spacy?: { lemmas: TranscriptLemma[]; analyzedAt: string };
  gpt?: { lemmas: TranscriptLemma[]; analyzedAt: string };
  userLevel?: string;
  error?: string;
}

export interface TranscriptLemmaData {
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

export interface ApiCostEntry {
  model: string;
  promptTokens: number;
  completionTokens: number;
  costUsd: number;
  source: string;
  timestamp: number;
}

export interface ApiCostStore {
  totalCost: number;
  entries: ApiCostEntry[];
}

export interface ElevenLabsCostEntry {
  durationSec: number;
  costUsd: number;
  source: string;
  timestamp: number;
}

export interface ElevenLabsCostStore {
  totalCost: number;
  entries: ElevenLabsCostEntry[];
}

export interface ExplainParams {
  selectedText: string;
  fullSentence: string;
  sentenceBefore: string;
  sentenceAfter: string;
}

export interface ExportCard {
  id: string;
  expression: string;
  meaning: string;
  meaningEs: string;
  translation: string;
  selectedText: string;
  targetLineBefore: string;
  targetLineAfter: string;
  startTime: number;
  endTime: number;
  chunking?: boolean;
  clozeHint?: string;
}

export interface ExportParams {
  videoDir: string;
  cards: ExportCard[];
  deckName: string;
  chunkingDeckName: string;
  videoTitle: string;
}

export interface ExportResult {
  cardId: string;
  success: boolean;
  error?: string;
}

export interface VideoInfo {
  title?: string;
  url?: string;
  transcriptionMethod?: 'whisper' | 'elevenlabs';
  hidden?: boolean;
}

export interface VideoEntry {
  folder: string;
  title: string;
  url: string;
  videoPath: string;
  srtPath: string;
  hasSrt: boolean;
  transcriptionMethod?: 'whisper' | 'elevenlabs';
  hidden?: boolean;
}

export interface DownloadSuccess {
  success: true;
  videoPath: string;
  srtPath: string;
  folder: string;
}

export interface DownloadFailure {
  success: false;
  error: string;
}

export type DownloadResult = DownloadSuccess | DownloadFailure;

export interface ElectronAPI {
  downloadVideo: (url: string, transcriptionMethod?: string) => Promise<{ success: boolean; videoPath?: string; srtPath?: string; folder?: string; error?: string }>;
  onDownloadProgress: (callback: (message: string) => void) => void;
  readFile: (filePath: string) => Promise<string>;
  listDownloads: () => Promise<VideoEntry[]>;
  deleteDownload: (folder: string) => Promise<{ success: boolean; error?: string }>;
  toggleVideoHidden: (folder: string, hidden: boolean) => Promise<{ success: boolean }>;
  ankiInvoke: (action: string, params?: Record<string, unknown>) => Promise<{ result: unknown; error: string | null }>;
  explainText: (params: ExplainParams) => Promise<{ success: boolean; translation?: string; explanation?: string; explanationEs?: string; error?: string }>;
  getDownloadPath: (folder: string) => Promise<string>;
  loadSettings: () => Promise<UserSettings>;
  saveSettings: (settings: UserSettings) => Promise<{ success: boolean }>;
  loadCards: (folder: string) => Promise<Card[]>;
  saveCards: (folder: string, cards: Card[]) => Promise<{ success: boolean }>;
  exportCardsToAnki: (params: ExportParams) => Promise<{ results: ExportResult[] }>;
  cancelDownload: () => Promise<void>;
  extractMWEs: (params: { folder: string; subtitles: { index: number; text: string }[] }) => Promise<{ success: boolean; results?: MWEResult[]; error?: string }>;
  cancelMWEExtraction: () => Promise<void>;
  onMWEProgress: (callback: (progress: MWEProgress) => void) => void;
  getMWEsForFolder: (folder: string) => Promise<MWEResult[]>;
  getAllMWETypes: () => Promise<MWEType[]>;
  markMWEsKnown: (params: { normalizedForms: string[]; known: boolean }) => Promise<{ success: boolean }>;
  markLemmasKnown: (params: { lemmas: { lemma: string; pos: string; general_freq?: number; cefr_level?: string | null }[]; known: boolean }) => Promise<{ success: boolean }>;
  getClozeHint: (params: { selectedText: string; fullSentence: string; translation: string }) => Promise<{ success: boolean; hint?: string; error?: string }>;
  getApiCost: () => Promise<ApiCostStore>;
  resetApiCost: () => Promise<{ success: boolean }>;
  onApiCostUpdate: (callback: (data: { totalCost: number }) => void) => void;
  getElevenLabsCost: () => Promise<ElevenLabsCostStore>;
  resetElevenLabsCost: () => Promise<{ success: boolean }>;
  onElevenLabsCostUpdate: (callback: (data: { totalCost: number }) => void) => void;
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
  analyzeTranscriptLemmasGpt: (folder: string) => Promise<TranscriptLemmaResult>;
  loadTranscriptLemmas: (folder: string) => Promise<TranscriptLemmaResult>;
  loadAllLemmaSources: (folder: string) => Promise<AllLemmaSourcesResult>;
  cancelLemmaAnalysis: () => Promise<void>;
  onLemmaAnalysisProgress: (callback: (progress: LemmaAnalysisProgress) => void) => void;

  // Speech Analysis
  speechAnalysisTranscribe: (params: { playlistUrl: string; cookiesBrowser?: string; cookiesFile?: string }) => Promise<{ success: boolean; transcript?: string; error?: string }>;
  pickCookiesFile: () => Promise<string | null>;
  cancelSpeechAnalysis: () => Promise<void>;
  onSpeechAnalysisProgress: (callback: (progress: SpeechAnalysisProgress) => void) => void;
  speechAnalysisRunPrompt: (params: { transcript: string; mode: 'correction' | 'parent' }) => Promise<{ success: boolean; output?: string; error?: string }>;
  loadSpeechAnalysis: () => Promise<SpeechAnalysisStore>;
  saveSpeechAnalysis: (store: SpeechAnalysisStore) => Promise<{ success: boolean }>;
}

export interface LemmaAnalysisProgress {
  currentBatch: number;
  totalBatches: number;
  processedSentences: number;
  totalSentences: number;
}

// --- Speech Analysis types ---

export interface SpeechAnalysisProgress {
  stage: 'fetching' | 'downloading' | 'transcribing' | 'done' | 'error';
  currentVideo?: number;
  totalVideos?: number;
  videoTitle?: string;
  message: string;
}

export interface SpeechAnalysisResult {
  transcript: string;
  analysisOutput: string;
  generatedAt: string;
  playlistUrl: string;
}

export interface SpeechAnalysisStore {
  correction?: SpeechAnalysisResult;
  parent?: SpeechAnalysisResult;
}
