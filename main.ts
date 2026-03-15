import { app, BrowserWindow, ipcMain, net } from 'electron';
import path from 'path';
import { spawn, execFile } from 'child_process';
import fs from 'fs';

let mainWindow: BrowserWindow | null = null;
const DOWNLOADS_DIR = path.join(app.getPath('userData'), 'downloads');
const SETTINGS_DIR = path.join(app.getPath('userData'), 'settings');
const SETTINGS_FILE = path.join(SETTINGS_DIR, 'user-settings.json');

interface UserSettings {
  selectedDeck: string;
  chunkingDeck: string;
}

function loadSettings(): UserSettings {
  try {
    fs.mkdirSync(SETTINGS_DIR, { recursive: true });
    const data = fs.readFileSync(SETTINGS_FILE, 'utf-8');
    return JSON.parse(data);
  } catch {
    return { selectedDeck: '', chunkingDeck: '' };
  }
}

function saveSettings(settings: UserSettings): void {
  fs.mkdirSync(SETTINGS_DIR, { recursive: true });
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));
}

// Load OpenAI API key from .env.local
function loadOpenAIKey(): string {
  try {
    const envPath = path.join(__dirname, '..', '.env.local');
    const envContent = fs.readFileSync(envPath, 'utf-8');
    const match = envContent.match(/^OPENAI_API_KEY=(.+)$/m);
    return match ? match[1].trim() : '';
  } catch {
    return '';
  }
}

const OPENAI_API_KEY = loadOpenAIKey();

interface ExplainParams {
  selectedText: string;
  fullSentence: string;
  sentenceBefore: string;
  sentenceAfter: string;
}

interface DownloadSuccess {
  success: true;
  videoPath: string;
  srtPath: string;
  folder: string;
}

interface DownloadFailure {
  success: false;
  error: string;
}

type DownloadResult = DownloadSuccess | DownloadFailure;

interface VideoInfo {
  title?: string;
  url?: string;
}

interface VideoEntry {
  folder: string;
  title: string;
  url: string;
  videoPath: string;
  srtPath: string;
  hasSrt: boolean;
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 850,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'index.html'));
}

app.whenReady().then(() => {
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// IPC: User settings
ipcMain.handle('load-settings', async () => loadSettings());
ipcMain.handle('save-settings', async (_event, settings: UserSettings) => {
  saveSettings(settings);
  return { success: true };
});

// IPC: Download video using Python script
ipcMain.handle('download-video', async (_event, url: string): Promise<DownloadResult> => {
  return new Promise((resolve) => {
    const scriptPath = path.join(__dirname, '..', 'scripts', 'download.py');

    const proc = spawn('python3', [scriptPath, url, DOWNLOADS_DIR], {
      cwd: path.join(__dirname, '..'),
    });

    let stdout = '';
    let stderr = '';

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
        resolve({
          success: false,
          error: stderr || `Process exited with code ${code}`,
        });
      }
    });

    proc.on('error', (err: Error) => {
      resolve({ success: false, error: err.message });
    });
  });
});

// IPC: List all downloaded videos
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
      } catch (_e) { /* ignore */ }
    }

    videos.push({
      folder: entry.name,
      title,
      url,
      videoPath,
      srtPath,
      hasSrt: fs.existsSync(srtPath),
    });
  }

  return videos;
});

// IPC: Delete a downloaded video folder
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

// IPC: Explain selected Spanish text via OpenAI
ipcMain.handle('openai-explain', async (_event, params: ExplainParams) => {
  if (!OPENAI_API_KEY) {
    return { success: false, error: 'OpenAI API key not found in .env.local' };
  }

  const { selectedText, fullSentence, sentenceBefore, sentenceAfter } = params;

  const prompt = `You are a Spanish language tutor helping an English-speaking student. The student selected the following Spanish text: "${selectedText}"

It appears in this full sentence: "${fullSentence}"

Surrounding context:
Previous line: "${sentenceBefore}"
Current line: "${fullSentence}"
Next line: "${sentenceAfter}"

Respond with a JSON object (no markdown, no code fences) with exactly two fields:
- "explanation": a concise explanation (2-3 sentences max) of the selected text. Use the surrounding context to clarify how the phrase is being used in this specific moment — reference what is happening in the scene where relevant. Cover meaning, nuance, idioms, or key grammar as needed.
- "translation": a natural English translation of the ENTIRE current line "${fullSentence}" (not just the selected part — translate the whole sentence).

Example format: {"explanation":"...","translation":"..."}`;



  try {
    const response = await net.fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 300,
        temperature: 0.3,
      }),
    });

    const json = await response.json() as {
      choices?: { message?: { content?: string } }[];
      error?: { message?: string };
    };

    if (json.error) {
      return { success: false, error: json.error.message || 'OpenAI API error' };
    }

    const raw = json.choices?.[0]?.message?.content?.trim() || '{}';
    let translation = '';
    let explanation = '';
    try {
      const parsed = JSON.parse(raw) as { translation?: string; explanation?: string };
      translation = parsed.translation?.trim() || '';
      explanation = parsed.explanation?.trim() || '';
    } catch {
      // Fallback: treat whole response as explanation
      explanation = raw;
    }
    if (!explanation && !translation) explanation = 'No explanation returned.';
    return { success: true, translation, explanation };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
});

// IPC: Proxy AnkiConnect requests (bypasses CORS)
ipcMain.handle('anki-invoke', async (_event, action: string, params?: Record<string, unknown>) => {
  const body: Record<string, unknown> = { action, version: 6 };
  if (params) body.params = params;

  try {
    const response = await net.fetch('http://127.0.0.1:8765', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    const json = await response.json();
    return json;
  } catch (err) {
    return { result: null, error: (err as Error).message };
  }
});

// IPC: Get absolute path for a download folder
ipcMain.handle('get-download-path', async (_event, folder: string) => {
  return path.join(DOWNLOADS_DIR, folder);
});

// --- subs2srs export to Anki ---

const PAD_START = 0.25;
const PAD_END = 0.50;

// Stable model ID matching build_custom_deck.py
const ANKI_MODEL_ID = 2_345_678_901;
const ANKI_MODEL_NAME = 'Spanish Vocab in Context';

const ANKI_MODEL_CSS = `
.card {
  font-family: "Noto Sans", Arial, sans-serif;
  font-size: 18px;
  text-align: center;
  color: #e0e0e0;
  background-color: #1e1e2e;
  padding: 20px;
}
.image-wrap img {
  max-width: 100%;
  max-height: 280px;
  border-radius: 6px;
  box-shadow: 0 2px 12px rgba(0,0,0,.6);
  margin-bottom: 12px;
}
.audio-wrap { margin-bottom: 10px; }
.sentence { font-size: 22px; color: #cdd6f4; margin: 12px 0; line-height: 1.5; }
hr#answer { border: none; border-top: 2px solid #e8b931; margin: 16px auto; width: 60%; }
.phrase { font-size: 20px; font-weight: bold; color: #fab387; margin: 10px 0 6px; }
.translation { font-size: 17px; color: #89dceb; font-style: italic; margin: 8px 0 4px; }
.translation-label { font-size: 10px; text-transform: uppercase; letter-spacing: .08em; color: #6c7086; margin-top: 14px; }
.explanation-label { font-size: 10px; text-transform: uppercase; letter-spacing: .08em; color: #6c7086; margin-top: 14px; }
.explanation { font-size: 16px; color: #bac2de; line-height: 1.6; text-align: left; max-width: 500px; margin: 0 auto; }
.context-wrap { margin: 14px auto 0; max-width: 500px; text-align: left; border-left: 3px solid #313244; padding-left: 10px; }
.context-label { font-size: 10px; text-transform: uppercase; letter-spacing: .08em; color: #6c7086; margin-bottom: 6px; }
.context-line { font-size: 13px; color: #585b70; line-height: 1.5; font-style: italic; }
.context-line.ctx-before, .context-line.ctx-after { color: #45475a; }
.context-line.ctx-current { color: #7f849c; }
.trans-section { margin: 14px auto 0; max-width: 500px; text-align: left; }
.trans-toggle-btn { background: none; border: 1px solid #45475a; color: #6c7086; font-size: 11px; padding: 3px 10px; border-radius: 4px; cursor: pointer; margin-bottom: 6px; }
.trans-toggle-btn:hover { border-color: #89dceb; color: #89dceb; }
.trans-text { font-size: 15px; color: #89dceb; font-style: italic; line-height: 1.5; }
`;

async function ankiRequest(action: string, params?: Record<string, unknown>): Promise<{ result: unknown; error: string | null }> {
  const body: Record<string, unknown> = { action, version: 6 };
  if (params) body.params = params;
  const response = await net.fetch('http://127.0.0.1:8765', {
    method: 'POST',
    body: JSON.stringify(body),
  });
  return await response.json() as { result: unknown; error: string | null };
}

const CARD_FRONT = '<div class="audio-wrap">{{Audio}}</div>';
const CARD_BACK = `<div class="image-wrap">{{Image}}</div>
<div class="audio-wrap">{{Audio}}</div>
<div class="sentence">{{Sentence}}</div>
<hr id="answer">
<div class="phrase">"{{Phrase}}"</div>
<div class="explanation-label">Explanation</div>
<div class="explanation">{{Explanation}}</div>
{{#ContextBefore}}{{#ContextAfter}}<div class="context-wrap">
<div class="context-label">Context</div>
{{#ContextBefore}}<div class="context-line ctx-before">{{ContextBefore}}</div>{{/ContextBefore}}
<div class="context-line ctx-current">{{Sentence}}</div>
{{#ContextAfter}}<div class="context-line ctx-after">{{ContextAfter}}</div>{{/ContextAfter}}
</div>{{/ContextAfter}}{{/ContextBefore}}
{{#Translation}}<div class="trans-section">
<button class="trans-toggle-btn" onclick="var d=document.getElementById('tr');d.style.display=d.style.display==='none'?'block':'none';this.textContent=d.style.display==='none'?'▶ Show Translation':'▼ Hide Translation'">▶ Show Translation</button>
<div id="tr" class="trans-text" style="display:none">{{Translation}}</div>
</div>{{/Translation}}`;

async function ensureAnkiModel(): Promise<void> {
  const res = await ankiRequest('modelNames');
  const models = res.result as string[];

  if (!models.includes(ANKI_MODEL_NAME)) {
    await ankiRequest('createModel', {
      modelName: ANKI_MODEL_NAME,
      inOrderFields: ['SegmentId', 'Phrase', 'Sentence', 'Translation', 'Explanation', 'ContextBefore', 'ContextAfter', 'Audio', 'Image'],
      css: ANKI_MODEL_CSS,
      cardTemplates: [
        { Name: 'Comprehension', Front: CARD_FRONT, Back: CARD_BACK },
      ],
    });
  } else {
    // Update styling and templates on existing model
    await ankiRequest('updateModelStyling', { model: { name: ANKI_MODEL_NAME, css: ANKI_MODEL_CSS } });
    await ankiRequest('updateModelTemplates', {
      model: {
        name: ANKI_MODEL_NAME,
        templates: { Comprehension: { Front: CARD_FRONT, Back: CARD_BACK } },
      },
    });
    // Add any missing fields to existing model
    const fieldsRes = await ankiRequest('modelFieldNames', { modelName: ANKI_MODEL_NAME });
    const existingFields = (fieldsRes.result as string[]) || [];
    const fieldsToAdd: { name: string; index: number }[] = [
      { name: 'Translation',   index: 3 },
      { name: 'ContextBefore', index: 5 },
      { name: 'ContextAfter',  index: 6 },
    ];
    for (const f of fieldsToAdd) {
      if (!existingFields.includes(f.name)) {
        await ankiRequest('modelFieldAdd', { modelName: ANKI_MODEL_NAME, fieldName: f.name, index: f.index });
      }
    }
  }
}

function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile('ffmpeg', args, { timeout: 30000 }, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

interface ExportCard {
  id: string;
  expression: string;
  meaning: string;
  translation: string;
  selectedText: string;
  targetLineBefore: string;
  targetLineAfter: string;
  startTime: number;
  endTime: number;
}

interface ExportParams {
  videoDir: string;
  cards: ExportCard[];
  deckName: string;
  videoTitle: string;
}

interface ExportResult {
  cardId: string;
  success: boolean;
  error?: string;
}

ipcMain.handle('export-cards-to-anki', async (_event, params: ExportParams): Promise<{ results: ExportResult[] }> => {
  const { videoDir, cards, deckName, videoTitle } = params;
  // Sanitize title for Anki tag: replace spaces/special chars with underscores
  const titleTag = videoTitle.replace(/[^\w\u00C0-\u024F]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 80);
  const videoPath = path.join(videoDir, 'video.mp4');
  const audioDir = path.join(videoDir, 'subs2srs', 'audio');
  const imgDir = path.join(videoDir, 'subs2srs', 'img');

  // Create subs2srs directories
  fs.mkdirSync(audioDir, { recursive: true });
  fs.mkdirSync(imgDir, { recursive: true });

  // Ensure model exists in Anki
  try {
    await ensureAnkiModel();
  } catch (err) {
    return { results: cards.map(c => ({ cardId: c.id, success: false, error: `Model creation failed: ${(err as Error).message}` })) };
  }

  const results: ExportResult[] = [];

  for (const card of cards) {
    try {
      const audioFile = `${card.id}.mp3`;
      const imgFile = `${card.id}.jpg`;
      const audioPath = path.join(audioDir, audioFile);
      const imgPath = path.join(imgDir, imgFile);

      // Extract audio clip with padding (matching make_subs2srs.py)
      const paddedStart = Math.max(0, card.startTime - PAD_START);
      const duration = (card.endTime + PAD_END) - paddedStart;
      await runFfmpeg([
        '-y', '-ss', paddedStart.toFixed(3), '-i', videoPath,
        '-t', Math.max(duration, 0.1).toFixed(3),
        '-vn', '-ac', '1', '-ar', '44100', '-q:a', '5',
        audioPath,
      ]);

      // Extract screenshot at midpoint (matching make_subs2srs.py)
      const midpoint = (card.startTime + card.endTime) / 2;
      await runFfmpeg([
        '-y', '-ss', midpoint.toFixed(3), '-i', videoPath,
        '-vframes', '1', '-q:v', '3',
        imgPath,
      ]);

      // Read files as base64 for AnkiConnect
      const audioData = fs.readFileSync(audioPath).toString('base64');
      const imgData = fs.readFileSync(imgPath).toString('base64');

      // Store media in Anki
      await ankiRequest('storeMediaFile', { filename: audioFile, data: audioData });
      await ankiRequest('storeMediaFile', { filename: imgFile, data: imgData });

      // Add note to selected deck
      const addRes = await ankiRequest('addNote', {
        note: {
          deckName,
          modelName: ANKI_MODEL_NAME,
          fields: {
            SegmentId: card.id,
            Phrase: card.selectedText,
            Sentence: card.expression,
            Translation: card.translation || '',
            Explanation: card.meaning,
            ContextBefore: card.targetLineBefore || '',
            ContextAfter: card.targetLineAfter || '',
            Audio: `[sound:${audioFile}]`,
            Image: `<img src="${imgFile}">`,
          },
          options: { allowDuplicate: false },
          tags: ['subs2srs', 'spanish', titleTag].filter(Boolean),
        },
      });

      if (addRes.error) {
        results.push({ cardId: card.id, success: false, error: addRes.error });
      } else {
        results.push({ cardId: card.id, success: true });
      }
    } catch (err) {
      results.push({ cardId: card.id, success: false, error: (err as Error).message });
    }
  }

  return { results };
});
