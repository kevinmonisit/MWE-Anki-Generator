#!/usr/bin/env python3
"""
Download a YouTube video (mp4), extract audio (mp3), and transcribe
with Whisper (MLX) to generate an SRT file.

Usage:
    python3 download.py <youtube_url> <output_dir>

Creates a subfolder named after the video title inside output_dir.
Outputs:
    <output_dir>/<video-title>/video.mp4
    <output_dir>/<video-title>/video.mp3
    <output_dir>/<video-title>/video.srt
    <output_dir>/<video-title>/info.json  (metadata)
"""
import sys
import os
import subprocess
import json
import re
import time
import hashlib

import mlx_whisper


MODEL_ID = "mlx-community/whisper-large-v3-turbo"


def sanitize_filename(name: str, url: str) -> str:
    """Create a short, filesystem-safe folder name."""
    # Use a short hash of the URL for uniqueness
    url_hash = hashlib.md5(url.encode()).hexdigest()[:8]
    # Keep only safe ASCII chars from title
    safe = re.sub(r'[^a-zA-Z0-9 _-]', '', name).strip()
    # Truncate to keep paths short
    safe = safe[:40].rstrip()
    if not safe:
        safe = 'video'
    return f"{safe}_{url_hash}"


def get_video_title(url: str) -> str:
    """Fetch the video title using yt-dlp."""
    result = subprocess.run(
        ["yt-dlp", "--get-title", url],
        capture_output=True, text=True, check=True
    )
    return result.stdout.strip()


def format_timestamp(seconds):
    h = int(seconds // 3600)
    m = int((seconds % 3600) // 60)
    s = int(seconds % 60)
    ms = int((seconds % 1) * 1000)
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


def transcribe_audio(mp3_path: str, srt_path: str):
    """Transcribe audio using MLX Whisper on Apple Silicon."""
    print(f"Transcribing with Whisper ({MODEL_ID})...")
    start_time = time.time()

    result = mlx_whisper.transcribe(
        mp3_path,
        path_or_hf_repo=MODEL_ID,
        language="es",
        word_timestamps=True,
        verbose=True,
    )

    elapsed = time.time() - start_time
    print(f"Transcription completed in {elapsed:.1f}s")

    print("Writing SRT...")
    with open(srt_path, "w", encoding="utf-8") as f:
        segments = result.get("segments", [])
        if not segments:
            f.write("1\n00:00:00,000 --> 00:00:00,000\n")
            f.write(result["text"].strip() + "\n")
        else:
            for i, seg in enumerate(segments, 1):
                start = seg["start"]
                end = seg["end"]
                text = seg["text"].strip()
                f.write(f"{i}\n")
                f.write(f"{format_timestamp(start)} --> {format_timestamp(end)}\n")
                f.write(f"{text}\n\n")

    print(f"SRT saved: {srt_path} ({len(result.get('segments', []))} segments)")


def download(url: str, output_dir: str):
    os.makedirs(output_dir, exist_ok=True)

    # Step 1: Fetch video info
    print("STEP:1:4:Fetching video info...")
    sys.stdout.flush()
    title = get_video_title(url)
    folder_name = sanitize_filename(title, url)

    video_dir = os.path.join(output_dir, folder_name)
    os.makedirs(video_dir, exist_ok=True)

    video_path = os.path.join(video_dir, "video.mp4")
    mp3_path = os.path.join(video_dir, "video.mp3")
    srt_path = os.path.join(video_dir, "video.srt")

    # Remove old files and stale .part files if they exist
    for f in [video_path, mp3_path, srt_path]:
        if os.path.exists(f):
            os.remove(f)
    # Clean up any leftover .part files from interrupted downloads
    if os.path.isdir(video_dir):
        for f in os.listdir(video_dir):
            if f.endswith('.part'):
                os.remove(os.path.join(video_dir, f))

    # Step 2: Download video as mp4
    print("STEP:2:4:Downloading MP4 video...")
    sys.stdout.flush()
    subprocess.run([
        "yt-dlp",
        "-f", "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best",
        "--merge-output-format", "mp4",
        "--no-write-subs",
        "-o", video_path,
        url,
    ], check=True)

    # Step 3: Extract audio as mp3
    print("STEP:3:4:Extracting MP3 audio...")
    sys.stdout.flush()
    subprocess.run([
        "yt-dlp",
        "-x",
        "--audio-format", "mp3",
        "--no-write-subs",
        "-o", mp3_path,
        url,
    ], check=True)

    # Step 4: Transcribe with Whisper (MLX)
    print("STEP:4:4:Running Whisper transcription...")
    sys.stdout.flush()
    transcribe_audio(mp3_path, srt_path)

    # Save metadata
    info = {"title": title, "url": url, "folder": folder_name}
    info_path = os.path.join(video_dir, "info.json")
    with open(info_path, "w") as f:
        json.dump(info, f, indent=2)

    print("STEP:DONE")
    sys.stdout.flush()
    print(f"FOLDER:{folder_name}")
    sys.stdout.flush()
    return {"video": video_path, "srt": srt_path, "folder": folder_name}


if __name__ == "__main__":
    if len(sys.argv) != 3:
        print(f"Usage: {sys.argv[0]} <youtube_url> <output_dir>")
        sys.exit(1)

    url = sys.argv[1]
    output_dir = sys.argv[2]
    result = download(url, output_dir)
    print(f"Video: {result['video']}")
    print(f"SRT: {result['srt']}")
