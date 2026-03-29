#!/usr/bin/env python3
"""
Download all videos from a YouTube playlist, transcribe each with Whisper,
and combine all transcripts into a single text file.

Supports authentication via --cookies-from-browser for unlisted videos.

Usage:
    python3 playlist_transcribe.py <playlist_url> <output_dir> [whisper|elevenlabs] [browser_for_cookies]

Output:
    <output_dir>/combined_transcript.txt  (all transcripts concatenated)
    <output_dir>/videos/<video_id>/video.mp3
    <output_dir>/videos/<video_id>/video.srt

Progress messages:
    PLAYLIST_COUNT:<n>
    VIDEO_START:<index>:<total>:<title>
    VIDEO_DONE:<index>:<total>:<title>
    TRANSCRIPT_READY:<path_to_combined_transcript>
    STEP:DONE
"""
import sys
import os
import subprocess
import json
import re
import time
import hashlib

# Reuse transcription functions from download.py
script_dir = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, script_dir)
from download import (
    transcribe_audio_whisper,
    transcribe_audio_elevenlabs,
    format_timestamp,
    merge_segments_into_sentences,
)


def extract_playlist_id(playlist_url: str) -> str | None:
    """Extract the playlist ID from a YouTube playlist URL."""
    match = re.search(r'[?&]list=([^&]+)', playlist_url)
    return match.group(1) if match else None


def add_cookies_args(cmd: list, cookies_browser: str | None) -> list:
    """Append the appropriate yt-dlp cookie arguments."""
    if not cookies_browser:
        return cmd
    if cookies_browser.startswith("file:"):
        cookie_file = cookies_browser[5:]
        cmd.extend(["--cookies", cookie_file])
    else:
        cmd.extend(["--cookies-from-browser", cookies_browser])
    return cmd


def get_playlist_video_urls(playlist_url: str, cookies_browser: str | None = None) -> list[dict]:
    """Get all video URLs and titles from a playlist using yt-dlp."""
    cmd = add_cookies_args([
        "yt-dlp",
        "--flat-playlist",
        "--dump-json",
        "--no-warnings",
        playlist_url,
    ], cookies_browser)

    result = subprocess.run(cmd, capture_output=True, text=True, check=True)

    playlist_id = extract_playlist_id(playlist_url)

    videos = []
    for line in result.stdout.strip().split("\n"):
        if not line.strip():
            continue
        try:
            data = json.loads(line)
            video_id = data.get("id", "")
            title = data.get("title", video_id)
            # Include playlist context in URL so unlisted videos remain accessible
            if playlist_id:
                url = f"https://www.youtube.com/watch?v={video_id}&list={playlist_id}"
            else:
                url = data.get("url") or data.get("webpage_url") or f"https://www.youtube.com/watch?v={video_id}"
            videos.append({"id": video_id, "title": title, "url": url})
        except json.JSONDecodeError:
            continue

    return videos


def download_and_transcribe_video(
    url: str,
    video_id: str,
    output_dir: str,
    method: str = "whisper",
    cookies_browser: str | None = None,
) -> str | None:
    """Download a single video's audio and transcribe it. Returns path to SRT or None on failure."""
    video_dir = os.path.join(output_dir, "videos", video_id)
    os.makedirs(video_dir, exist_ok=True)

    mp3_path = os.path.join(video_dir, "video.mp3")
    srt_path = os.path.join(video_dir, "video.srt")

    # Skip if already transcribed
    if os.path.exists(srt_path) and os.path.getsize(srt_path) > 0:
        print(f"  Skipping download (already transcribed): {video_id}")
        return srt_path

    # Download audio as mp3
    cmd = add_cookies_args([
        "yt-dlp",
        "-x",
        "--audio-format", "mp3",
        "--no-write-subs",
        "-o", mp3_path,
        url,
    ], cookies_browser)

    try:
        result = subprocess.run(cmd, capture_output=True, text=True)
        if result.returncode != 0:
            err = (result.stderr or result.stdout or "unknown error").strip()
            # Print to stdout so it surfaces as a progress message
            print(f"DOWNLOAD_ERROR:{video_id}:{err[:300]}")
            sys.stdout.flush()
            return None
    except Exception as e:
        print(f"DOWNLOAD_ERROR:{video_id}:{e}")
        sys.stdout.flush()
        return None

    if not os.path.exists(mp3_path):
        print(f"DOWNLOAD_ERROR:{video_id}:mp3 not found after download")
        sys.stdout.flush()
        return None

    # Transcribe
    try:
        if method == "elevenlabs":
            transcribe_audio_elevenlabs(mp3_path, srt_path)
        else:
            transcribe_audio_whisper(mp3_path, srt_path)
    except Exception as e:
        print(f"  ERROR transcribing {video_id}: {e}", file=sys.stderr)
        return None

    return srt_path


def parse_srt_to_text(srt_path: str) -> str:
    """Parse an SRT file and return just the text lines (no timestamps, no indices)."""
    lines = []
    with open(srt_path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            # Skip empty lines, index numbers, and timestamp lines
            if not line:
                continue
            if re.match(r'^\d+$', line):
                continue
            if re.match(r'\d{2}:\d{2}:\d{2},\d{3}\s*-->\s*\d{2}:\d{2}:\d{2},\d{3}', line):
                continue
            lines.append(line)
    return "\n".join(lines)


def extract_single_video_id(url: str) -> str | None:
    """Extract video ID from a single YouTube video URL."""
    match = re.search(r'(?:v=|youtu\.be/)([a-zA-Z0-9_-]{11})', url)
    return match.group(1) if match else None


def get_single_video_info(url: str, cookies_browser: str | None = None) -> dict | None:
    """Get title and ID for a single video."""
    cmd = add_cookies_args(["yt-dlp", "--dump-json", "--no-playlist", "--no-warnings", url], cookies_browser)
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, check=True)
        data = json.loads(result.stdout.strip().split("\n")[0])
        return {"id": data.get("id", ""), "title": data.get("title", "video"), "url": url}
    except Exception:
        # Fall back to extracting ID from URL
        video_id = extract_single_video_id(url)
        if video_id:
            return {"id": video_id, "title": video_id, "url": url}
        return None


def process_playlist(
    playlist_url: str,
    output_dir: str,
    method: str = "whisper",
    cookies_browser: str | None = None,
):
    """Download and transcribe all videos in a playlist or single video, combine transcripts."""
    os.makedirs(output_dir, exist_ok=True)

    print("Fetching video info...")
    sys.stdout.flush()

    # Detect single video vs playlist
    is_single_video = not extract_playlist_id(playlist_url)

    if is_single_video:
        info = get_single_video_info(playlist_url, cookies_browser)
        if not info:
            print("ERROR: Could not get video info", file=sys.stderr)
            sys.exit(1)
        videos = [info]
    else:
        videos = get_playlist_video_urls(playlist_url, cookies_browser)

    total = len(videos)
    print(f"PLAYLIST_COUNT:{total}")
    sys.stdout.flush()

    if total == 0:
        print("ERROR: No videos found", file=sys.stderr)
        sys.exit(1)

    for i, video in enumerate(videos):
        video_id = video["id"]
        title = video["title"]

        print(f"VIDEO_START:{i+1}:{total}:{title}")
        sys.stdout.flush()

        srt_path = download_and_transcribe_video(
            video["url"], video_id, output_dir, method, cookies_browser
        )

        if srt_path:
            print(f"VIDEO_DONE:{i+1}:{total}:{title}")
        else:
            print(f"VIDEO_FAILED:{i+1}:{total}:{title}")
        sys.stdout.flush()

    # Rebuild combined transcript from ALL existing SRTs in playlist order
    # This ensures incremental runs produce a complete transcript
    all_transcripts = []
    for video in videos:
        srt_path = os.path.join(output_dir, "videos", video["id"], "video.srt")
        if os.path.exists(srt_path) and os.path.getsize(srt_path) > 0:
            text = parse_srt_to_text(srt_path)
            if text.strip():
                all_transcripts.append(text)

    combined_path = os.path.join(output_dir, "combined_transcript.txt")
    combined_text = "\n\n".join(all_transcripts)
    with open(combined_path, "w", encoding="utf-8") as f:
        f.write(combined_text)

    print(f"TRANSCRIPT_READY:{combined_path}")
    sys.stdout.flush()
    print("STEP:DONE")
    sys.stdout.flush()

    return combined_path


if __name__ == "__main__":
    if len(sys.argv) < 3:
        print(f"Usage: {sys.argv[0]} <playlist_url> <output_dir> [whisper|elevenlabs] [browser_for_cookies]")
        sys.exit(1)

    playlist_url = sys.argv[1]
    output_dir = sys.argv[2]
    method = sys.argv[3] if len(sys.argv) > 3 else "whisper"
    cookies_browser = sys.argv[4] if len(sys.argv) > 4 else None

    process_playlist(playlist_url, output_dir, method, cookies_browser)
