import { ipcMain, BrowserWindow, app, dialog } from 'electron';
import path from 'path';
import { spawn, ChildProcess } from 'child_process';
import fs from 'fs';
import type { SpeechAnalysisProgress, SpeechAnalysisStore } from '../../shared/types';
import { openaiChat } from '../services/openai';

const SPEECH_ANALYSIS_DIR = path.join(app.getPath('userData'), 'speech-analysis');
const STORE_FILE = path.join(SPEECH_ANALYSIS_DIR, 'store.json');

let activeProc: ChildProcess | null = null;
let wasCancelled = false;

function loadStore(): SpeechAnalysisStore {
  try {
    fs.mkdirSync(SPEECH_ANALYSIS_DIR, { recursive: true });
    const data = fs.readFileSync(STORE_FILE, 'utf-8');
    return JSON.parse(data);
  } catch {
    return {};
  }
}

function saveStore(store: SpeechAnalysisStore): void {
  fs.mkdirSync(SPEECH_ANALYSIS_DIR, { recursive: true });
  fs.writeFileSync(STORE_FILE, JSON.stringify(store, null, 2));
}

export function registerSpeechAnalysisHandlers(
  getMainWindow: () => BrowserWindow | null,
  getApiKey: () => string,
  trackCost: (model: string, promptTokens: number, completionTokens: number, source: string) => void,
): void {
  // Transcribe a playlist
  ipcMain.handle('speech-analysis-transcribe', async (_event, params: { playlistUrl: string; cookiesBrowser?: string; cookiesFile?: string }) => {
    const { playlistUrl, cookiesBrowser, cookiesFile } = params;
    const outputDir = path.join(SPEECH_ANALYSIS_DIR, 'playlist-data');
    const metaFile = path.join(outputDir, 'playlist-meta.json');

    // Check if this is the same playlist or a new one
    try {
      if (fs.existsSync(metaFile)) {
        const meta = JSON.parse(fs.readFileSync(metaFile, 'utf-8'));
        if (meta.playlistUrl !== playlistUrl) {
          // Different playlist — wipe old data
          fs.rmSync(outputDir, { recursive: true, force: true });
        }
        // Same playlist — keep existing video data for incremental download
      }
    } catch {
      // If meta read fails, start fresh
      try { fs.rmSync(outputDir, { recursive: true, force: true }); } catch { /* ignore */ }
    }

    // Save playlist URL to meta before starting
    fs.mkdirSync(outputDir, { recursive: true });
    fs.writeFileSync(metaFile, JSON.stringify({ playlistUrl }, null, 2));

    return new Promise((resolve) => {
      const scriptPath = path.join(__dirname, '..', '..', '..', '..', 'scripts', 'playlist_transcribe.py');
      const venvPython = path.join(__dirname, '..', '..', '..', '..', '.venv', 'bin', 'python3');

      // Pass auth method: "file:<path>", browser name, or nothing
      const args = [scriptPath, playlistUrl, outputDir, 'whisper'];
      if (cookiesFile) {
        args.push(`file:${cookiesFile}`);
      } else if (cookiesBrowser) {
        args.push(cookiesBrowser);
      }

      const proc = spawn(venvPython, args, {
        cwd: path.join(__dirname, '..', '..', '..', '..'),
      });
      activeProc = proc;
      wasCancelled = false;

      let stdout = '';
      let stderr = '';
      const mainWindow = getMainWindow();

      proc.stdout.on('data', (data: Buffer) => {
        const msg = data.toString();
        stdout += msg;

        // Parse progress messages
        for (const line of msg.split('\n')) {
          const trimmed = line.trim();
          if (!trimmed) continue;

          const countMatch = trimmed.match(/^PLAYLIST_COUNT:(\d+)$/);
          if (countMatch) {
            sendProgress(mainWindow, {
              stage: 'fetching',
              totalVideos: parseInt(countMatch[1]),
              message: `Found ${countMatch[1]} videos in playlist`,
            });
            continue;
          }

          const startMatch = trimmed.match(/^VIDEO_START:(\d+):(\d+):(.+)$/);
          if (startMatch) {
            sendProgress(mainWindow, {
              stage: 'downloading',
              currentVideo: parseInt(startMatch[1]),
              totalVideos: parseInt(startMatch[2]),
              videoTitle: startMatch[3],
              message: `Processing video ${startMatch[1]}/${startMatch[2]}: ${startMatch[3]}`,
            });
            continue;
          }

          const doneMatch = trimmed.match(/^VIDEO_DONE:(\d+):(\d+):(.+)$/);
          if (doneMatch) {
            sendProgress(mainWindow, {
              stage: 'transcribing',
              currentVideo: parseInt(doneMatch[1]),
              totalVideos: parseInt(doneMatch[2]),
              videoTitle: doneMatch[3],
              message: `Completed ${doneMatch[1]}/${doneMatch[2]}: ${doneMatch[3]}`,
            });
            continue;
          }

          const failMatch = trimmed.match(/^VIDEO_FAILED:(\d+):(\d+):(.+)$/);
          if (failMatch) {
            sendProgress(mainWindow, {
              stage: 'error',
              currentVideo: parseInt(failMatch[1]),
              totalVideos: parseInt(failMatch[2]),
              videoTitle: failMatch[3],
              message: `Failed ${failMatch[1]}/${failMatch[2]}: ${failMatch[3]}`,
            });
            continue;
          }

          const dlErrMatch = trimmed.match(/^DOWNLOAD_ERROR:([^:]+):(.+)$/);
          if (dlErrMatch) {
            sendProgress(mainWindow, {
              stage: 'error',
              videoTitle: dlErrMatch[1],
              message: `Download error: ${dlErrMatch[2]}`,
            });
            continue;
          }

          if (trimmed === 'STEP:DONE') {
            sendProgress(mainWindow, {
              stage: 'done',
              message: 'All videos transcribed',
            });
          }
        }
      });

      proc.stderr.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      proc.on('close', (code: number | null) => {
        activeProc = null;

        if (wasCancelled) {
          resolve({ success: false, error: 'cancelled' });
          return;
        }

        if (code === 0) {
          const transcriptMatch = stdout.match(/TRANSCRIPT_READY:(.+)/);
          if (transcriptMatch) {
            const transcriptPath = transcriptMatch[1].trim();
            try {
              const transcript = fs.readFileSync(transcriptPath, 'utf-8');
              resolve({ success: true, transcript });
            } catch (err) {
              resolve({ success: false, error: `Failed to read transcript: ${(err as Error).message}` });
            }
          } else {
            resolve({ success: false, error: 'Transcript file not found in output' });
          }
        } else {
          resolve({ success: false, error: stderr || `Process exited with code ${code}` });
        }
      });

      proc.on('error', (err: Error) => {
        activeProc = null;
        resolve({ success: false, error: err.message });
      });
    });
  });

  // Open native file picker for cookies.txt
  ipcMain.handle('pick-cookies-file', async () => {
    const mainWindow = getMainWindow();
    const result = await dialog.showOpenDialog(mainWindow!, {
      title: 'Select cookies.txt file',
      filters: [{ name: 'Cookies file', extensions: ['txt'] }, { name: 'All files', extensions: ['*'] }],
      properties: ['openFile'],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });

  // Cancel active transcription
  ipcMain.handle('cancel-speech-analysis', async () => {
    if (activeProc && !activeProc.killed) {
      wasCancelled = true;
      activeProc.kill();
    }
  });

  // Run analysis prompt (placeholder - user will provide prompts later)
  ipcMain.handle('speech-analysis-run-prompt', async (_event, params: { transcript: string; mode: 'correction' | 'parent' }) => {
    const { transcript, mode } = params;
    const apiKey = getApiKey();

    if (!apiKey) {
      return { success: false, error: 'OpenAI API key not configured' };
    }

    // Placeholder prompts - user will replace these later
    const systemPrompt = mode === 'correction'
      ? 'You are a Spanish language tutor. Analyze the following transcript for errors and provide corrections. [PLACEHOLDER - replace with actual prompt]'
      : 'You are a language analysis expert. Provide a parent analysis of the following Spanish speech transcript. [PLACEHOLDER - replace with actual prompt]';

    try {
      const result = await openaiChat(apiKey, [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: transcript },
      ], {
        maxTokens: 4000,
        temperature: 0.3,
      });

      if (result.error) {
        return { success: false, error: result.error };
      }

      if (result.usage && result.model) {
        trackCost(result.model, result.usage.prompt_tokens, result.usage.completion_tokens, `speech-analysis-${mode}`);
      }

      return { success: true, output: result.content };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  // Load saved analysis
  ipcMain.handle('load-speech-analysis', async () => {
    return loadStore();
  });

  // Save analysis
  ipcMain.handle('save-speech-analysis', async (_event, store: SpeechAnalysisStore) => {
    saveStore(store);
    return { success: true };
  });
}

function sendProgress(mainWindow: BrowserWindow | null, progress: SpeechAnalysisProgress): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('speech-analysis-progress', progress);
  }
}
