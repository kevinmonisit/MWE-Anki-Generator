#!/usr/bin/env python3
"""
Builds a subs2srs-style .apkg from the deck.tsv + media files.
"""

import csv
import genanki
import random
from pathlib import Path

OUT_DIR    = Path("output")
DECK_TSV   = OUT_DIR / "subs2srs_deck" / "deck.tsv"
AUDIO_DIR  = OUT_DIR / "subs2srs_deck" / "audio"
IMG_DIR    = OUT_DIR / "subs2srs_deck" / "img"
OUT_APKG   = OUT_DIR / "subs2srs.apkg"

# Stable IDs (random but fixed so re-runs don't duplicate)
MODEL_ID = 1_234_567_890
DECK_ID  = 9_876_543_210

# ── Note type ──────────────────────────────────────────────────────────────────
model = genanki.Model(
    MODEL_ID,
    "subs2srs",
    fields=[
        {"name": "id"},
        {"name": "Expression"},
        {"name": "Audio"},
        {"name": "Image"},
        {"name": "Start"},
        {"name": "End"},
    ],
    templates=[
        {
            "name": "Recognition",
            "qfmt": """
<div class="image-wrap">{{Image}}</div>
<div class="audio-wrap">{{Audio}}</div>
""",
            "afmt": """
{{FrontSide}}
<hr id="answer">
<div class="expression">{{Expression}}</div>
<div class="timing">{{Start}} → {{End}}</div>
""",
        },
    ],
    css="""
.card {
  font-family: "Noto Sans", Arial, sans-serif;
  font-size: 20px;
  text-align: center;
  color: #222;
  background-color: #fafafa;
  padding: 20px;
}

.image-wrap img {
  max-width: 100%;
  max-height: 300px;
  border-radius: 6px;
  box-shadow: 0 2px 8px rgba(0,0,0,.25);
  margin-bottom: 14px;
}

.audio-wrap {
  margin-bottom: 10px;
}

hr#answer {
  border: none;
  border-top: 1px solid #ddd;
  margin: 16px auto;
  width: 60%;
}

.expression {
  font-size: 24px;
  font-weight: bold;
  color: #1a1a2e;
  margin: 8px 0;
}

.timing {
  font-size: 12px;
  color: #888;
  margin-top: 6px;
}
""",
)

# ── Deck ───────────────────────────────────────────────────────────────────────
deck = genanki.Deck(DECK_ID, "subs2srs")

with open(DECK_TSV, newline="", encoding="utf-8") as f:
    reader = csv.DictReader(f, delimiter="\t")
    for row in reader:
        note = genanki.Note(
            model=model,
            fields=[
                row["id"],
                row["text"],
                row["audio"],
                row["image"],
                row["start"],
                row["end"],
            ],
        )
        deck.add_note(note)

# ── Media ──────────────────────────────────────────────────────────────────────
media_files = (
    [str(p) for p in sorted(AUDIO_DIR.glob("*.mp3"))] +
    [str(p) for p in sorted(IMG_DIR.glob("*.jpg"))]
)

package = genanki.Package(deck)
package.media_files = media_files
package.write_to_file(str(OUT_APKG))

print(f"Wrote {OUT_APKG}")
print(f"  Notes  : {len(deck.notes)}")
print(f"  Media  : {len(media_files)} files")
print(f"\nDouble-click {OUT_APKG} to import into Anki.")
