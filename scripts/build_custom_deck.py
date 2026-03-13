#!/usr/bin/env python3
"""
Builds a custom Anki .apkg from a JSON file of user-selected cards.
Each card has: segmentId, phrase, sentence, explanation

Uses the existing subs2srs_deck/audio and subs2srs_deck/img media.

Card layout:
  Front: sentence (Spanish) + audio + screenshot
  Back:  highlighted phrase + English explanation
"""

import json
import sys
import genanki
from pathlib import Path

SUBS2SRS_DIR = Path(__file__).parent.parent / "output" / "subs2srs_deck"
AUDIO_DIR = SUBS2SRS_DIR / "audio"
IMG_DIR = SUBS2SRS_DIR / "img"

# Stable IDs (different from the main subs2srs deck to avoid conflicts)
MODEL_ID = 2_345_678_901
DECK_ID = 8_765_432_109

model = genanki.Model(
    MODEL_ID,
    "Spanish Vocab in Context",
    fields=[
        {"name": "SegmentId"},
        {"name": "Phrase"},
        {"name": "Sentence"},
        {"name": "Explanation"},
        {"name": "Audio"},
        {"name": "Image"},
    ],
    templates=[
        {
            "name": "Comprehension",
            "qfmt": """
<div class="image-wrap">{{Image}}</div>
<div class="audio-wrap">{{Audio}}</div>
<div class="sentence">{{Sentence}}</div>
""",
            "afmt": """
<div class="image-wrap">{{Image}}</div>
<div class="audio-wrap">{{Audio}}</div>
<div class="sentence">{{Sentence}}</div>
<hr id="answer">
<div class="phrase">"{{Phrase}}"</div>
<div class="explanation">{{Explanation}}</div>
""",
        },
    ],
    css="""
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

.audio-wrap {
  margin-bottom: 10px;
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
""",
)


def build_deck(cards_json_path: str, output_path: str):
    with open(cards_json_path, "r", encoding="utf-8") as f:
        cards = json.load(f)

    if not cards:
        print("No cards to export.", file=sys.stderr)
        sys.exit(1)

    deck = genanki.Deck(DECK_ID, "Spanish Vocab in Context")
    media_files = []

    for card in cards:
        seg_id = int(card["segmentId"])
        name = f"{seg_id:04d}"
        audio_file = f"{name}.mp3"
        img_file = f"{name}.jpg"

        audio_path = AUDIO_DIR / audio_file
        img_path = IMG_DIR / img_file

        if not audio_path.exists():
            print(f"Warning: missing audio {audio_path}", file=sys.stderr)
            continue
        if not img_path.exists():
            print(f"Warning: missing image {img_path}", file=sys.stderr)
            continue

        note = genanki.Note(
            model=model,
            fields=[
                str(seg_id),
                card["phrase"],
                card["sentence"],
                card["explanation"],
                f"[sound:{audio_file}]",
                f'<img src="{img_file}">',
            ],
        )
        deck.add_note(note)
        media_files.append(str(audio_path))
        media_files.append(str(img_path))

    package = genanki.Package(deck)
    package.media_files = media_files
    package.write_to_file(output_path)

    print(json.dumps({
        "success": True,
        "notes": len(deck.notes),
        "media": len(media_files),
        "output": output_path,
    }))


if __name__ == "__main__":
    if len(sys.argv) != 3:
        print(f"Usage: {sys.argv[0]} <cards.json> <output.apkg>", file=sys.stderr)
        sys.exit(1)
    build_deck(sys.argv[1], sys.argv[2])
