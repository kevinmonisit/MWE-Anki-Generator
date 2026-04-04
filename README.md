# MWE Anki Generator

A desktop app for learning Spanish from YouTube videos. Download a video, get an automatic transcription, select phrases to get AI explanations, and export flashcards directly to Anki — complete with audio clips and screenshots. [Read more.](https://kevinmonisit.me/#/blog/language-part1)

<img width="1312" height="962" alt="preview" src="https://github.com/user-attachments/assets/e4d80ade-e046-40b2-a5cd-15f220b2ed7d" />

## Features

- **Download & Transcribe** — Paste a YouTube URL to download the video and generate a Spanish transcript via MLX Whisper (Apple Silicon optimized)
- **Interactive Transcript** — Clickable, synced transcript that highlights as the video plays
- **AI Explanations** — Select any Spanish phrase to get an explanation and translation via OpenAI
- **Speech Analysis** — Analyze pronunciation and speech patterns from the video
- **Lemma Analysis** — Extract and analyze vocabulary by lemma across a transcript
- **Anki Card Creation** — One-click flashcard creation capturing the phrase, sentence, context, explanation, and translation
- **Media Export** — Exported Anki cards include extracted audio clips and video screenshots
- **Dual Deck Support** — Choose separate Anki decks for vocabulary and chunking cards
- **Resizable Panels** — Drag-to-resize video, sidebar, and explanation panels

## Prerequisites

- **macOS** (Apple Silicon recommended for MLX Whisper)
- **Node.js** 18+
- **Python** 3.9+
- **Anki** with [AnkiConnect](https://ankiweb.net/shared/info/2055492159) installed
- **yt-dlp** and **FFmpeg**:
  ```bash
  brew install yt-dlp ffmpeg
  ```
- **Python packages**:
  ```bash
  pip install mlx-whisper genanki
  ```

## Setup

1. Clone the repo and install dependencies:
   ```bash
   git clone https://github.com/kevinmonisit/MWE-Anki-Generator.git
   cd MWE-Anki-Generator
   npm install
   ```

2. Create a `.env.local` file in the project root with your OpenAI API key:
   ```
   OPENAI_API_KEY=sk-proj-your-key-here
   ```

3. Build and launch:
   ```bash
   npm start
   ```

## Usage

1. Paste a YouTube URL and click **Download** — the app downloads and transcribes the video
2. Watch the video with the synced transcript panel
3. Select any Spanish text and click **Explain** to get an AI explanation
4. Click **Create Card** to save a flashcard
5. Choose your target Anki deck and click **Export Cards** to send cards to Anki with audio and screenshots

## Project Structure

```
src/
├── main/
│   ├── index.ts              # Electron main process entry
│   ├── ipc/
│   │   ├── anki.ts           # Anki export IPC handlers
│   │   ├── data.ts           # Data read/write handlers
│   │   ├── download.ts       # Video download handlers
│   │   ├── explain.ts        # AI explanation handlers
│   │   ├── lemma-analysis.ts # Lemma analysis handlers
│   │   └── speech-analysis.ts
│   ├── mwe/
│   │   ├── mwe-ipc.ts        # MWE IPC handlers
│   │   ├── mwe-pipeline.ts   # Card generation pipeline
│   │   └── mwe-prompts.ts    # OpenAI prompts
│   └── services/
│       ├── openai.ts         # OpenAI client
│       ├── python-runner.ts  # Python subprocess runner
│       └── storage.ts        # Persistent storage
├── renderer/
│   ├── index.ts              # Renderer entry
│   ├── state.ts              # App state
│   ├── utils.ts
│   └── modules/
│       ├── anki-ui.ts        # Anki deck UI
│       ├── cards.ts          # Flashcard management
│       ├── corpus-page.ts    # Corpus/lemma page
│       ├── download.ts       # Download UI
│       ├── layout.ts         # Panel layout / resize
│       ├── mwe-panel.ts      # MWE explanation panel
│       ├── navigation.ts     # Page navigation
│       ├── speech-analysis.ts
│       └── video-player.ts   # Video + transcript sync
├── preload.ts                # IPC bridge
└── input.css                 # Tailwind source
scripts/
├── download.py               # YouTube download + Whisper transcription
├── transcribe.py             # Standalone transcription
├── extract_lemmas.py         # Lemma extraction
├── transcript_lemmas.py      # Transcript-level lemma analysis
├── zipf_lookup.py            # Zipf frequency lookup
├── build_cefr_json.py        # CEFR word list builder
├── build_custom_deck.py      # Custom APKG builder
├── make_apkg.py              # APKG from TSV
├── make_subs2srs.py          # subs2srs deck generator
└── playlist_transcribe.py    # Batch playlist transcription
```

## Tech Stack

- **Electron** + **TypeScript** — Desktop app framework
- **esbuild** — Renderer bundler
- **Tailwind CSS** — Styling
- **MLX Whisper** — On-device Spanish transcription (Apple Silicon)
- **OpenAI API** (gpt-4o-mini) — Phrase explanation and translation
- **AnkiConnect** — Local HTTP API for Anki integration
- **yt-dlp** — YouTube downloading
- **FFmpeg** — Audio/screenshot extraction for flashcards

## Data Storage

All app data is stored locally in the Electron userData directory (`~/Library/Application Support/youtube-transcript-viewer/`):

- `downloads/` — Downloaded videos, audio, and transcripts
- `settings/user-settings.json` — Selected Anki decks

Cards are stored in the browser's localStorage per video.

## Scripts

| Script | Description |
|--------|-------------|
| `npm start` | Build and launch the app |
| `npm run build` | Compile TypeScript and Tailwind CSS |
| `npm run css` | Rebuild CSS only |

## License

ISC
