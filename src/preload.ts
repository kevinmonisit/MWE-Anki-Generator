import { contextBridge, ipcRenderer } from 'electron';
import type {
  ElectronAPI, UserSettings, Card, MWEProgress, CorpusProgress, MWEResult, ExportParams, LemmaAnalysisProgress,
} from './shared/types';

contextBridge.exposeInMainWorld('api', {
  downloadVideo: (url: string, transcriptionMethod?: string) => ipcRenderer.invoke('download-video', url, transcriptionMethod || 'whisper'),
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
  saveSettings: (settings: { selectedDeck: string; chunkingDeck: string; userLevel: string }) => ipcRenderer.invoke('save-settings', settings),
  loadCards: (folder: string) => ipcRenderer.invoke('load-cards', folder),
  saveCards: (folder: string, cards: Card[]) => ipcRenderer.invoke('save-cards', folder, cards),
  exportCardsToAnki: (params: ExportParams) => ipcRenderer.invoke('export-cards-to-anki', params),
  cancelDownload: () => ipcRenderer.invoke('cancel-download'),
  extractMWEs: (params: { folder: string; subtitles: { index: number; text: string }[] }) => ipcRenderer.invoke('extract-mwes', params),
  cancelMWEExtraction: () => ipcRenderer.invoke('cancel-mwe-extraction'),
  onMWEProgress: (callback: (progress: MWEProgress) => void) => {
    ipcRenderer.on('extract-mwes-progress', (_event, progress: MWEProgress) => callback(progress));
  },
  getMWEsForFolder: (folder: string) => ipcRenderer.invoke('get-mwes-for-folder', folder),
  getAllMWETypes: () => ipcRenderer.invoke('get-all-mwe-types'),
  markMWEsKnown: (params: { normalizedForms: string[]; known: boolean }) => ipcRenderer.invoke('mark-mwes-known', params),
  markLemmasKnown: (params: { lemmas: { lemma: string; pos: string; general_freq?: number; cefr_level?: string | null }[]; known: boolean }) => ipcRenderer.invoke('mark-lemmas-known', params),
  getClozeHint: (params: { selectedText: string; fullSentence: string; translation: string }) => ipcRenderer.invoke('get-cloze-hint', params),
  getApiCost: () => ipcRenderer.invoke('get-api-cost'),
  resetApiCost: () => ipcRenderer.invoke('reset-api-cost'),
  onApiCostUpdate: (callback: (data: { totalCost: number }) => void) => {
    ipcRenderer.on('api-cost-update', (_event, data: { totalCost: number }) => callback(data));
  },
  getElevenLabsCost: () => ipcRenderer.invoke('get-elevenlabs-cost'),
  resetElevenLabsCost: () => ipcRenderer.invoke('reset-elevenlabs-cost'),
  onElevenLabsCostUpdate: (callback: (data: { totalCost: number }) => void) => {
    ipcRenderer.on('elevenlabs-cost-update', (_event, data: { totalCost: number }) => callback(data));
  },
  fetchAnkiNotes: (deckNames: string[]) => ipcRenderer.invoke('fetch-anki-notes', deckNames),
  extractLemmas: (sentences: string[]) => ipcRenderer.invoke('extract-lemmas', sentences),
  buildAnkiCorpus: (params: { deckName: string; sentences: string[]; lemmas: { lemma: string; pos: string }[]; mode?: 'lemmas' | 'mwes' | 'both' }) => ipcRenderer.invoke('build-anki-corpus', params),
  approveCorpusMWEs: (params: { deckName: string; mwes: MWEResult[]; sentenceCount: number; lemmaCount: number; processedSentences?: string[] }) => ipcRenderer.invoke('approve-corpus-mwes', params),
  cancelCorpusBuild: () => ipcRenderer.invoke('cancel-corpus-build'),
  onCorpusProgress: (callback: (progress: CorpusProgress) => void) => {
    ipcRenderer.on('corpus-progress', (_event, progress: CorpusProgress) => callback(progress));
  },
  getCorpusStats: () => ipcRenderer.invoke('get-corpus-stats'),
  isCorpusImported: (deckName: string) => ipcRenderer.invoke('is-corpus-imported', deckName),
  checkLemmaExists: (lemma: string) => ipcRenderer.invoke('check-lemma-exists', lemma),
  resetLemmaDatabase: () => ipcRenderer.invoke('reset-lemma-database'),
  analyzeTranscriptLemmas: (folder: string) => ipcRenderer.invoke('analyze-transcript-lemmas', folder),
  analyzeTranscriptLemmasGpt: (folder: string) => ipcRenderer.invoke('analyze-transcript-lemmas-gpt', folder),
  loadTranscriptLemmas: (folder: string) => ipcRenderer.invoke('load-transcript-lemmas', folder),
  cancelLemmaAnalysis: () => ipcRenderer.invoke('cancel-lemma-analysis'),
  onLemmaAnalysisProgress: (callback: (progress: LemmaAnalysisProgress) => void) => {
    ipcRenderer.on('lemma-analysis-progress', (_event, progress: LemmaAnalysisProgress) => callback(progress));
  },
} satisfies ElectronAPI);
