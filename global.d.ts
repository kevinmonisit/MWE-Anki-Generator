import type { ElectronAPI } from './src/shared/types';

declare global {
  interface Window {
    api: ElectronAPI;
    startDownload: () => Promise<void>;
  }
}

export {};
