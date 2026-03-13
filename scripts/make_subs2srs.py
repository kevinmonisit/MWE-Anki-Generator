#!/usr/bin/env python3
"""
subs2srs-style Anki deck generator.
Reads video.srt + video.mp4 and outputs:
  subs2srs_deck/
    audio/  - one .mp3 per subtitle line
    img/    - one .jpg per subtitle line
    deck.tsv - Anki import file: [id | text | [sound:...] | <img ...>]
"""

import os
import re
import subprocess
import csv
from pathlib import Path

SRT  = "video.srt"
MP4  = "video.mp4"
OUT  = Path("subs2srs_deck")
AUDIO_DIR = OUT / "audio"
IMG_DIR   = OUT / "img"

OUT.mkdir(exist_ok=True)
AUDIO_DIR.mkdir(exist_ok=True)
IMG_DIR.mkdir(exist_ok=True)


def srt_time_to_seconds(t: str) -> float:
    """Convert SRT timestamp '00:01:23,456' to float seconds."""
    t = t.replace(",", ".")
    h, m, s = t.split(":")
    return int(h) * 3600 + int(m) * 60 + float(s)


def parse_srt(path: str):
    """Yield (index, start_sec, end_sec, text) for each entry."""
    text = Path(path).read_text(encoding="utf-8")
    blocks = re.split(r"\n\s*\n", text.strip())
    for block in blocks:
        lines = block.strip().splitlines()
        if len(lines) < 3:
            continue
        try:
            idx = int(lines[0].strip())
        except ValueError:
            continue
        times = lines[1].split("-->")
        start = srt_time_to_seconds(times[0].strip())
        end   = srt_time_to_seconds(times[1].strip())
        content = " ".join(l.strip() for l in lines[2:])
        # strip HTML tags that sometimes appear in SRTs
        content = re.sub(r"<[^>]+>", "", content)
        yield idx, start, end, content


PAD_START = 0.25   # seconds of padding before subtitle start
PAD_END   = 0.50   # seconds of padding after subtitle end


def extract_audio(mp4: str, start: float, end: float, out_path: str):
    padded_start = max(0.0, start - PAD_START)
    padded_end   = end + PAD_END
    duration = padded_end - padded_start
    if duration <= 0:
        duration = 0.1
    subprocess.run(
        [
            "ffmpeg", "-y",
            "-ss", f"{padded_start:.3f}",
            "-i", mp4,
            "-t", f"{duration:.3f}",
            "-vn",
            "-ac", "1",
            "-ar", "44100",
            "-q:a", "5",
            out_path,
        ],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        check=True,
    )


def extract_image(mp4: str, ts: float, out_path: str):
    subprocess.run(
        [
            "ffmpeg", "-y",
            "-ss", f"{ts:.3f}",
            "-i", mp4,
            "-vframes", "1",
            "-q:v", "3",
            out_path,
        ],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        check=True,
    )


entries = list(parse_srt(SRT))
total = len(entries)
print(f"Processing {total} entries...")

rows = []
for i, (idx, start, end, text) in enumerate(entries):
    name = f"{idx:04d}"
    audio_file = f"{name}.mp3"
    img_file   = f"{name}.jpg"

    audio_path = str(AUDIO_DIR / audio_file)
    img_path   = str(IMG_DIR   / img_file)

    extract_audio(MP4, start, end, audio_path)

    mid = (start + end) / 2
    extract_image(MP4, mid, img_path)

    rows.append({
        "id":    name,
        "text":  text,
        "audio": f"[sound:{audio_file}]",
        "image": f'<img src="{img_file}">',
        "start": f"{start:.3f}",
        "end":   f"{end:.3f}",
    })

    if (i + 1) % 50 == 0 or (i + 1) == total:
        print(f"  {i+1}/{total}")

tsv_path = OUT / "deck.tsv"
with open(tsv_path, "w", newline="", encoding="utf-8") as f:
    writer = csv.writer(f, delimiter="\t")
    # Anki: first row treated as headers when using "Allow HTML in fields"
    writer.writerow(["id", "text", "audio", "image", "start", "end"])
    for r in rows:
        writer.writerow([r["id"], r["text"], r["audio"], r["image"], r["start"], r["end"]])

print(f"\nDone! Deck written to: {OUT}/")
print(f"  Audio clips : {AUDIO_DIR}/")
print(f"  Screenshots : {IMG_DIR}/")
print(f"  Anki import : {tsv_path}")
print()
print("To import into Anki:")
print("  1. Copy audio/*.mp3 and img/*.jpg into your Anki media collection folder.")
print("  2. In Anki: File > Import > select deck.tsv")
print("     - Separator: Tab, check 'Allow HTML in fields'")
print("     - Map fields to a note type with Text, Audio, Image fields.")
