import { NextRequest, NextResponse } from "next/server";
import { readFileSync, existsSync } from "fs";
import { join } from "path";

export const dynamic = "force-dynamic";

const ANKI_CONNECT_URL = "http://127.0.0.1:8765";
const DECK_NAME = "Spanish Vocab in Context";
const MODEL_NAME = "Spanish Vocab in Context";

const SUBS2SRS_DIR = join(process.cwd(), "output", "subs2srs_deck");
const AUDIO_DIR = join(SUBS2SRS_DIR, "audio");
const IMG_DIR = join(SUBS2SRS_DIR, "img");

async function ankiConnect(action: string, params: Record<string, unknown> = {}) {
  const res = await fetch(ANKI_CONNECT_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, version: 6, params }),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return data.result;
}

async function ensureModelExists() {
  const models: string[] = await ankiConnect("modelNames");
  if (models.includes(MODEL_NAME)) return;

  await ankiConnect("createModel", {
    modelName: MODEL_NAME,
    inOrderFields: ["Sentence", "Phrase", "Explanation", "Audio", "Image"],
    css: `
.card {
  font-family: "Noto Sans", Arial, sans-serif;
  font-size: 18px;
  text-align: center;
  color: #222;
  background-color: #fafafa;
  padding: 20px;
}
.image-wrap img {
  max-width: 100%;
  max-height: 280px;
  border-radius: 6px;
  box-shadow: 0 2px 8px rgba(0,0,0,.25);
  margin-bottom: 12px;
}
.sentence {
  font-size: 22px;
  color: #1a1a2e;
  margin: 12px 0;
  line-height: 1.5;
}
hr#answer {
  border: none;
  border-top: 2px solid #e8b931;
  margin: 16px auto;
  width: 60%;
}
.phrase {
  font-size: 20px;
  font-weight: bold;
  color: #b45309;
  margin: 10px 0 6px;
}
.explanation {
  font-size: 16px;
  color: #444;
  line-height: 1.6;
  text-align: left;
  max-width: 500px;
  margin: 0 auto;
}
`,
    cardTemplates: [
      {
        Name: "Comprehension",
        Front: `
<div class="image-wrap">{{Image}}</div>
{{Audio}}
<div class="sentence">{{Sentence}}</div>
`,
        Back: `
<div class="image-wrap">{{Image}}</div>
{{Audio}}
<div class="sentence">{{Sentence}}</div>
<hr id="answer">
<div class="phrase">"{{Phrase}}"</div>
<div class="explanation">{{Explanation}}</div>
`,
      },
    ],
  });
}

async function ensureDeckExists() {
  await ankiConnect("createDeck", { deck: DECK_NAME });
}

function fileToBase64(filePath: string): string | null {
  if (!existsSync(filePath)) return null;
  return readFileSync(filePath).toString("base64");
}

// POST - send a single card to Anki
export async function POST(req: NextRequest) {
  try {
    const { segmentId, phrase, sentence, explanation } = await req.json();

    if (!segmentId || !phrase || !sentence || !explanation) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      );
    }

    // Check AnkiConnect is reachable
    try {
      await ankiConnect("version");
    } catch {
      return NextResponse.json(
        { error: "Cannot connect to Anki. Make sure Anki is running with AnkiConnect installed (add-on code: 2055492159)." },
        { status: 503 }
      );
    }

    await ensureDeckExists();
    await ensureModelExists();

    const name = String(segmentId).padStart(4, "0");
    const audioFilename = `spanish_vocab_${name}.mp3`;
    const imgFilename = `spanish_vocab_${name}.jpg`;

    // Store media files in Anki
    const audioPath = join(AUDIO_DIR, `${name}.mp3`);
    const imgPath = join(IMG_DIR, `${name}.jpg`);

    const audioData = fileToBase64(audioPath);
    const imgData = fileToBase64(imgPath);

    if (audioData) {
      await ankiConnect("storeMediaFile", {
        filename: audioFilename,
        data: audioData,
      });
    }

    if (imgData) {
      await ankiConnect("storeMediaFile", {
        filename: imgFilename,
        data: imgData,
      });
    }

    // Add note
    const noteId = await ankiConnect("addNote", {
      note: {
        deckName: DECK_NAME,
        modelName: MODEL_NAME,
        fields: {
          Sentence: sentence,
          Phrase: phrase,
          Explanation: explanation,
          Audio: audioData ? `[sound:${audioFilename}]` : "",
          Image: imgData ? `<img src="${imgFilename}">` : "",
        },
        options: {
          allowDuplicate: false,
          duplicateScope: "deck",
        },
        tags: ["spanish-transcript-reader"],
      },
    });

    return NextResponse.json({
      success: true,
      noteId,
      message: "Card sent to Anki",
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";

    // AnkiConnect returns "cannot create note because it is a duplicate" for dupes
    if (msg.includes("duplicate")) {
      return NextResponse.json({
        success: true,
        duplicate: true,
        message: "Card already exists in Anki",
      });
    }

    console.error("AnkiConnect error:", error);
    return NextResponse.json(
      { error: msg },
      { status: 500 }
    );
  }
}
