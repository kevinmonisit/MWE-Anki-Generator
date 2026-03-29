#!/usr/bin/env python3
"""
Download a YouTube video (mp4), extract audio (mp3), and transcribe
with MLX Whisper (Apple Silicon GPU) to generate an SRT file.

Segments are post-processed to merge fragments into full sentences.

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
import urllib.request
import urllib.error

MODEL_ID = "mlx-community/whisper-large-v3-turbo"


def sanitize_filename(name: str, url: str) -> str:
    """Create a short, filesystem-safe folder name."""
    url_hash = hashlib.md5(url.encode()).hexdigest()[:8]
    safe = re.sub(r'[^a-zA-Z0-9 _-]', '', name).strip()
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


def merge_segments_into_sentences(segments):
    """Merge Whisper segments so each SRT entry is a full sentence."""
    if not segments:
        return segments

    sentence_end = re.compile(r'[.!?…]\s*$')
    merged = []
    buf_text = ""
    buf_start = None
    buf_end = None

    for seg in segments:
        text = seg["text"].strip()
        if not text:
            continue

        if buf_start is None:
            buf_start = seg["start"]

        buf_text = (buf_text + " " + text).strip() if buf_text else text
        buf_end = seg["end"]

        if sentence_end.search(buf_text):
            merged.append({"start": buf_start, "end": buf_end, "text": buf_text})
            buf_text = ""
            buf_start = None

    if buf_text and buf_start is not None:
        merged.append({"start": buf_start, "end": buf_end, "text": buf_text})

    return merged


def transcribe_audio_whisper(mp3_path: str, srt_path: str):
    """Transcribe audio using MLX Whisper on Apple Silicon."""
    import mlx_whisper

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
            merged = merge_segments_into_sentences(segments)
            for i, seg in enumerate(merged, 1):
                f.write(f"{i}\n")
                f.write(f"{format_timestamp(seg['start'])} --> {format_timestamp(seg['end'])}\n")
                f.write(f"{seg['text']}\n\n")

    raw_count = len(result.get("segments", []))
    merged_count = len(merge_segments_into_sentences(result.get("segments", [])))
    print(f"SRT saved: {srt_path} ({raw_count} segments -> {merged_count} merged sentences)")


def transcribe_audio_elevenlabs(mp3_path: str, srt_path: str):
    """Transcribe audio using ElevenLabs Scribe API."""
    api_key = os.environ.get("ELEVENLABS_API_KEY", "")
    if not api_key:
        # Try loading from .env.local
        env_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".env.local")
        if os.path.exists(env_path):
            with open(env_path) as f:
                for line in f:
                    if line.startswith("ELEVENLABS_API_KEY="):
                        api_key = line.split("=", 1)[1].strip()
                        break
    if not api_key:
        raise RuntimeError("ELEVENLABS_API_KEY not found in environment or .env.local")

    print("Transcribing with ElevenLabs Scribe API...")
    start_time = time.time()

    # Build multipart form data
    boundary = f"----FormBoundary{hashlib.md5(str(time.time()).encode()).hexdigest()[:16]}"
    body = b""

    # model_id field
    body += f"--{boundary}\r\n".encode()
    body += b"Content-Disposition: form-data; name=\"model_id\"\r\n\r\n"
    body += b"scribe_v1\r\n"

    # language_code field
    body += f"--{boundary}\r\n".encode()
    body += b"Content-Disposition: form-data; name=\"language_code\"\r\n\r\n"
    body += b"spa\r\n"

    # file field
    filename = os.path.basename(mp3_path)
    body += f"--{boundary}\r\n".encode()
    body += f"Content-Disposition: form-data; name=\"file\"; filename=\"{filename}\"\r\n".encode()
    body += b"Content-Type: audio/mpeg\r\n\r\n"
    with open(mp3_path, "rb") as f:
        body += f.read()
    body += b"\r\n"

    body += f"--{boundary}--\r\n".encode()

    req = urllib.request.Request(
        "https://api.elevenlabs.io/v1/speech-to-text",
        data=body,
        headers={
            "xi-api-key": api_key,
            "Content-Type": f"multipart/form-data; boundary={boundary}",
        },
        method="POST",
    )

    try:
        with urllib.request.urlopen(req, timeout=600) as resp:
            data = json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        error_body = e.read().decode() if e.fp else ""
        raise RuntimeError(f"ElevenLabs API error {e.code}: {error_body}")

    elapsed = time.time() - start_time
    print(f"Transcription completed in {elapsed:.1f}s")

    # Parse ElevenLabs response into segments
    words = data.get("words", [])
    if words:
        # Build segments from words (group by ~30 word chunks then merge into sentences)
        raw_segments = []
        for w in words:
            if w.get("type") not in ("spacing", "audio_event"):
                raw_segments.append({
                    "start": w["start"],
                    "end": w["end"],
                    "text": w["text"],
                })

        # Group words into rough segments (~sentence-like chunks)
        segments = []
        buf_words = []
        buf_start = None
        for ws in raw_segments:
            if buf_start is None:
                buf_start = ws["start"]
            buf_words.append(ws["text"])
            buf_end = ws["end"]
            text_so_far = " ".join(buf_words)
            if re.search(r'[.!?…]\s*$', text_so_far) or len(buf_words) >= 30:
                segments.append({"start": buf_start, "end": buf_end, "text": text_so_far})
                buf_words = []
                buf_start = None
        if buf_words and buf_start is not None:
            segments.append({"start": buf_start, "end": buf_end, "text": " ".join(buf_words)})

        merged = merge_segments_into_sentences(segments)
    else:
        # Fallback: use full text
        text = data.get("text", "").strip()
        merged = [{"start": 0, "end": 0, "text": text}] if text else []

    print("Writing SRT...")
    with open(srt_path, "w", encoding="utf-8") as f:
        if not merged:
            f.write("1\n00:00:00,000 --> 00:00:00,000\n")
            f.write(data.get("text", "").strip() + "\n")
        else:
            for i, seg in enumerate(merged, 1):
                f.write(f"{i}\n")
                f.write(f"{format_timestamp(seg['start'])} --> {format_timestamp(seg['end'])}\n")
                f.write(f"{seg['text']}\n\n")

    # Emit audio duration for cost tracking (use last word end_time)
    audio_duration_sec = 0.0
    if words:
        for w in reversed(words):
            if w.get("end"):
                audio_duration_sec = w["end"]
                break
    print(f"ELEVENLABS_COST:{audio_duration_sec:.2f}")
    sys.stdout.flush()

    print(f"SRT saved: {srt_path} ({len(merged)} sentences)")


def transcribe_audio(mp3_path: str, srt_path: str, method: str = "whisper"):
    """Transcribe audio using the specified method."""
    if method == "elevenlabs":
        transcribe_audio_elevenlabs(mp3_path, srt_path)
    else:
        transcribe_audio_whisper(mp3_path, srt_path)


def download(url: str, output_dir: str, transcription_method: str = "whisper"):
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

    step4_label = "ElevenLabs Scribe" if transcription_method == "elevenlabs" else "Whisper"
    # Step 4: Transcribe
    print(f"STEP:4:4:Running {step4_label} transcription...")
    sys.stdout.flush()
    transcribe_audio(mp3_path, srt_path, method=transcription_method)

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
    if len(sys.argv) < 3:
        print(f"Usage: {sys.argv[0]} <youtube_url> <output_dir> [whisper|elevenlabs]")
        sys.exit(1)

    url = sys.argv[1]
    output_dir = sys.argv[2]
    method = sys.argv[3] if len(sys.argv) > 3 else "whisper"
    result = download(url, output_dir, transcription_method=method)
    print(f"Video: {result['video']}")
    print(f"SRT: {result['srt']}")
