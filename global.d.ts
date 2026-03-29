import type { ElectronAPI, Card, MWEResult, MWEProgress, CorpusProgress, TranscriptLemma } from './src/shared/types';

declare global {
  interface Window {
    api: ElectronAPI;
    startDownload: () => Promise<void>;
  }

  type Card = import('./src/shared/types').Card;
  type MWEResult = import('./src/shared/types').MWEResult;
  type MWEProgress = import('./src/shared/types').MWEProgress;
  type CorpusProgress = import('./src/shared/types').CorpusProgress;
  type TranscriptLemma = import('./src/shared/types').TranscriptLemma;
  type ElevenLabsCostStore = import('./src/shared/types').ElevenLabsCostStore;
}

export {};
