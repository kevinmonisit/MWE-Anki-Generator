import { ipcMain, BrowserWindow } from 'electron';
import path from 'path';
import { spawn, ChildProcess } from 'child_process';
import fs from 'fs';
import { DOWNLOADS_DIR } from '../services/storage';
import type { DownloadResult, VideoEntry, VideoInfo } from '../../shared/types';

let activeDownloadProc: ChildProcess | null = null;
let downloadWasCancelled = false;

export function registerDownloadHandlers(getMainWindow: () => BrowserWindow | null): void {
  ipcMain.handle('download-video', async (_event, url: string): Promise<DownloadResult> => {
    return new Promise((resolve) => {
      const scriptPath = path.join(__dirname, '..', '..', '..', '..', 'scripts', 'download.py');
      const venvPython = path.join(__dirname, '..', '..', '..', '..', '.venv', 'bin', 'python3');
      const proc = spawn(venvPython, [scriptPath, url, DOWNLOADS_DIR], {
        cwd: path.join(__dirname, '..', '..', '..', '..'),
      });
      activeDownloadProc = proc;
      downloadWasCancelled = false;

      let stdout = '';
      let stderr = '';
      const mainWindow = getMainWindow();

      proc.stdout.on('data', (data: Buffer) => {
        const msg = data.toString();
        stdout += msg;
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('download-progress', msg.trim());
        }
      });

      proc.stderr.on('data', (data: Buffer) => {
        const msg = data.toString();
        stderr += msg;
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('download-progress', `[stderr] ${msg.trim()}`);
        }
      });

      proc.on('close', (code: number | null) => {
        activeDownloadProc = null;

        if (downloadWasCancelled) {
          const folderMatch = stdout.match(/FOLDER:(.+)/);
          const folderName = folderMatch ? folderMatch[1].trim() : null;
          if (folderName) {
            const videoDir = path.join(DOWNLOADS_DIR, folderName);
            try { fs.rmSync(videoDir, { recursive: true }); } catch { /* ignore */ }
          }
          resolve({ success: false, error: 'cancelled' });
          return;
        }

        if (code === 0) {
          const folderMatch = stdout.match(/FOLDER:(.+)/);
          const folderName = folderMatch ? folderMatch[1].trim() : null;
          if (folderName) {
            const videoDir = path.join(DOWNLOADS_DIR, folderName);
            resolve({
              success: true,
              videoPath: path.join(videoDir, 'video.mp4'),
              srtPath: path.join(videoDir, 'video.srt'),
              folder: folderName,
            });
          } else {
            resolve({ success: false, error: 'Could not determine download folder' });
          }
        } else {
          resolve({ success: false, error: stderr || `Process exited with code ${code}` });
        }
      });

      proc.on('error', (err: Error) => {
        activeDownloadProc = null;
        resolve({ success: false, error: err.message });
      });
    });
  });

  ipcMain.handle('cancel-download', async () => {
    if (activeDownloadProc && !activeDownloadProc.killed) {
      downloadWasCancelled = true;
      activeDownloadProc.kill();
    }
  });

  ipcMain.handle('list-downloads', async (): Promise<VideoEntry[]> => {
    if (!fs.existsSync(DOWNLOADS_DIR)) return [];

    const entries = fs.readdirSync(DOWNLOADS_DIR, { withFileTypes: true });
    const videos: VideoEntry[] = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const videoDir = path.join(DOWNLOADS_DIR, entry.name);
      const videoPath = path.join(videoDir, 'video.mp4');
      const srtPath = path.join(videoDir, 'video.srt');
      const infoPath = path.join(videoDir, 'info.json');

      if (!fs.existsSync(videoPath)) continue;

      let title = entry.name;
      let url = '';
      if (fs.existsSync(infoPath)) {
        try {
          const info: VideoInfo = JSON.parse(fs.readFileSync(infoPath, 'utf-8'));
          title = info.title || entry.name;
          url = info.url || '';
        } catch { /* ignore */ }
      }

      videos.push({ folder: entry.name, title, url, videoPath, srtPath, hasSrt: fs.existsSync(srtPath) });
    }

    return videos;
  });

  ipcMain.handle('delete-download', async (_event, folder: string) => {
    const videoDir = path.join(DOWNLOADS_DIR, folder);
    if (fs.existsSync(videoDir)) {
      fs.rmSync(videoDir, { recursive: true });
      return { success: true };
    }
    return { success: false, error: 'Folder not found' };
  });

  ipcMain.handle('read-file', async (_event, filePath: string) => {
    return fs.readFileSync(filePath, 'utf-8');
  });

  ipcMain.handle('get-download-path', async (_event, folder: string) => {
    return path.join(DOWNLOADS_DIR, folder);
  });
}
