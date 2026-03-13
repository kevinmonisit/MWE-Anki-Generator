"""
Whisper transcription optimized for Apple Silicon using MLX.

MLX runs natively on Apple Silicon's GPU/Neural Engine cores,
providing 3-5x speedup over PyTorch MPS for local model inference.

Uses mlx-community/whisper-large-v3-turbo (MLX-native weights)
with language set to Spanish for full Apple Silicon acceleration.
"""
import time
import mlx_whisper

AUDIO_FILE = "video.mp3"
OUTPUT_SRT = "video.srt"

# MLX-native converted model — runs directly on Apple Silicon GPU
MODEL_ID = "mlx-community/whisper-large-v3-turbo"

print("=" * 50)
print("MLX Whisper — Apple Silicon GPU Acceleration")
print(f"Model: {MODEL_ID}")
print(f"Audio: {AUDIO_FILE}")
print("=" * 50)

print("\nTranscribing audio...")
start_time = time.time()

result = mlx_whisper.transcribe(
    AUDIO_FILE,
    path_or_hf_repo=MODEL_ID,
    language="es",
    word_timestamps=True,
    verbose=True,
)

elapsed = time.time() - start_time
print(f"\nTranscription completed in {elapsed:.1f}s")


def format_timestamp(seconds):
    h = int(seconds // 3600)
    m = int((seconds % 3600) // 60)
    s = int(seconds % 60)
    ms = int((seconds % 1) * 1000)
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


print("Writing SRT...")
with open(OUTPUT_SRT, "w", encoding="utf-8") as f:
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

print(f"\nDone! SRT saved to {OUTPUT_SRT}")
print(f"Total segments: {len(result.get('segments', []))}")
print(f"Total time: {elapsed:.1f}s")
