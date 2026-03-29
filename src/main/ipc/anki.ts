import { ipcMain, net } from 'electron';
import path from 'path';
import { execFile } from 'child_process';
import fs from 'fs';
import { ankiRequest } from '../services/storage';
import { getClozeHint } from './explain';
import type { ExportParams, ExportResult } from '../../shared/types';

const PAD_START = 0.25;
const PAD_END = 0.50;

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
.sentence { font-size: 22px; color: #ffffff; margin: 12px 0; line-height: 1.5; }
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
.cloze { font-weight: bold; color: #5b9dff; }
`;

const CARD_FRONT = '<div class="audio-wrap">{{Audio}}</div>';
const CARD_BACK = `<div class="audio-wrap">{{Audio}}</div>
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
</div>{{/Translation}}
<div class="image-wrap">{{Image}}</div>`;

const CLOZE_MODEL_NAME = 'Spanish Chunking Cloze';
const CLOZE_MODEL_ID = 2_345_678_902;
const CLOZE_FRONT = `<div class="sentence">{{cloze:Text}}</div>`;
const CLOZE_BACK = `<div class="sentence">{{cloze:Text}}</div>
<hr id="answer">
<div class="image-wrap">{{Image}}</div>
<div class="audio-wrap">{{Audio}}</div>
{{#Extra}}<div class="explanation">{{Extra}}</div>{{/Extra}}`;

async function ensureAnkiModel(): Promise<void> {
  const res = await ankiRequest('modelNames');
  const models = res.result as string[];

  if (!models.includes(ANKI_MODEL_NAME)) {
    await ankiRequest('createModel', {
      modelName: ANKI_MODEL_NAME,
      inOrderFields: ['SegmentId', 'Phrase', 'Sentence', 'Translation', 'Explanation', 'ContextBefore', 'ContextAfter', 'Audio', 'Image'],
      css: ANKI_MODEL_CSS,
      cardTemplates: [{ Name: 'Comprehension', Front: CARD_FRONT, Back: CARD_BACK }],
    });
  } else {
    await ankiRequest('updateModelStyling', { model: { name: ANKI_MODEL_NAME, css: ANKI_MODEL_CSS } });
    await ankiRequest('updateModelTemplates', {
      model: { name: ANKI_MODEL_NAME, templates: { Comprehension: { Front: CARD_FRONT, Back: CARD_BACK } } },
    });
    const fieldsRes = await ankiRequest('modelFieldNames', { modelName: ANKI_MODEL_NAME });
    const existingFields = (fieldsRes.result as string[]) || [];
    const fieldsToAdd = [
      { name: 'Translation', index: 3 },
      { name: 'ContextBefore', index: 5 },
      { name: 'ContextAfter', index: 6 },
    ];
    for (const f of fieldsToAdd) {
      if (!existingFields.includes(f.name)) {
        await ankiRequest('modelFieldAdd', { modelName: ANKI_MODEL_NAME, fieldName: f.name, index: f.index });
      }
    }
  }
}

async function ensureClozeModel(): Promise<void> {
  const res = await ankiRequest('modelNames');
  const models = res.result as string[];

  if (!models.includes(CLOZE_MODEL_NAME)) {
    await ankiRequest('createModel', {
      modelName: CLOZE_MODEL_NAME,
      inOrderFields: ['Text', 'Extra', 'Audio', 'Image'],
      css: ANKI_MODEL_CSS,
      isCloze: true,
      cardTemplates: [{ Name: 'Cloze', Front: CLOZE_FRONT, Back: CLOZE_BACK }],
    });
  } else {
    await ankiRequest('updateModelStyling', { model: { name: CLOZE_MODEL_NAME, css: ANKI_MODEL_CSS } });
    await ankiRequest('updateModelTemplates', {
      model: { name: CLOZE_MODEL_NAME, templates: { Cloze: { Front: CLOZE_FRONT, Back: CLOZE_BACK } } },
    });
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

export function registerAnkiHandlers(
  getApiKey: () => string,
  trackCost: (model: string, promptTokens: number, completionTokens: number, source: string) => void
): void {
  // Proxy AnkiConnect requests (bypasses CORS)
  ipcMain.handle('anki-invoke', async (_event, action: string, params?: Record<string, unknown>) => {
    try {
      return await ankiRequest(action, params);
    } catch (err) {
      return { result: null, error: (err as Error).message };
    }
  });

  ipcMain.handle('export-cards-to-anki', async (_event, params: ExportParams): Promise<{ results: ExportResult[] }> => {
    const { videoDir, cards, deckName, chunkingDeckName, videoTitle } = params;
    const titleTag = videoTitle.replace(/[^\w\u00C0-\u024F]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 80);
    const videoPath = path.join(videoDir, 'video.mp4');
    const audioDir = path.join(videoDir, 'subs2srs', 'audio');
    const imgDir = path.join(videoDir, 'subs2srs', 'img');

    fs.mkdirSync(audioDir, { recursive: true });
    fs.mkdirSync(imgDir, { recursive: true });

    try {
      await ensureAnkiModel();
      if (chunkingDeckName) await ensureClozeModel();
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

        const paddedStart = Math.max(0, card.startTime - PAD_START);
        const duration = (card.endTime + PAD_END) - paddedStart;
        await runFfmpeg([
          '-y', '-ss', paddedStart.toFixed(3), '-i', videoPath,
          '-t', Math.max(duration, 0.1).toFixed(3),
          '-vn', '-ac', '1', '-ar', '44100', '-q:a', '5',
          audioPath,
        ]);

        const midpoint = (card.startTime + card.endTime) / 2;
        await runFfmpeg([
          '-y', '-ss', midpoint.toFixed(3), '-i', videoPath,
          '-vframes', '1', '-q:v', '3',
          imgPath,
        ]);

        const audioData = fs.readFileSync(audioPath).toString('base64');
        const imgData = fs.readFileSync(imgPath).toString('base64');

        await ankiRequest('storeMediaFile', { filename: audioFile, data: audioData });
        await ankiRequest('storeMediaFile', { filename: imgFile, data: imgData });

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
          results.push({ cardId: card.id, success: false, error: addRes.error as string });
        } else {
          if (card.chunking && chunkingDeckName) {
            try {
              const apiKey = getApiKey();
              const hint = card.clozeHint || await getClozeHint(apiKey, card.selectedText, card.expression, card.translation || '', trackCost);
              const clozeText = card.expression.replace(
                card.selectedText,
                `{{c1::${card.selectedText}::${hint}}}`
              );

              await ankiRequest('addNote', {
                note: {
                  deckName: chunkingDeckName,
                  modelName: CLOZE_MODEL_NAME,
                  fields: {
                    Text: clozeText,
                    Extra: card.meaning || '',
                    Audio: `[sound:${audioFile}]`,
                    Image: `<img src="${imgFile}">`,
                  },
                  options: { allowDuplicate: false },
                  tags: ['chunking', 'spanish', titleTag].filter(Boolean),
                },
              });
            } catch (clozeErr) {
              console.error(`Cloze card failed for ${card.id}:`, (clozeErr as Error).message);
            }
          }
          results.push({ cardId: card.id, success: true });
        }
      } catch (err) {
        results.push({ cardId: card.id, success: false, error: (err as Error).message });
      }
    }

    return { results };
  });
}
