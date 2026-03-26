#!/usr/bin/env python3
"""Extract lemmas from an SRT transcript with frequency scoring.

Reads an SRT file path from argv[1], extracts text, lemmatizes with SpaCy,
and scores each lemma by combining transcript frequency and general Spanish
word frequency (via wordfreq library).

Outputs JSON array of {lemma, pos, transcript_count, general_freq, score}
sorted by combined score (descending).
"""

import json
import re
import sys
from pathlib import Path

import spacy
from wordfreq import zipf_frequency


nlp = spacy.load("es_core_news_sm")

# POS tags to keep (filter out function words, punctuation, etc.)
CONTENT_POS = {"NOUN", "VERB", "ADJ", "ADV"}


def parse_srt(srt_path: str) -> list[str]:
    """Parse SRT file and return list of text lines."""
    content = Path(srt_path).read_text(encoding="utf-8")
    lines = []
    for block in re.split(r"\n\n+", content.strip()):
        parts = block.split("\n")
        if len(parts) >= 3:
            # Skip index and timestamp lines, join text lines
            text = " ".join(parts[2:])
            # Remove HTML tags from SRT
            text = re.sub(r"<[^>]+>", "", text)
            text = text.strip()
            if text:
                lines.append(text)
    return lines


def extract_lemmas_with_freq(sentences: list[str]) -> list[dict]:
    """Extract lemmas with transcript frequency and general frequency scores."""
    import math

    # Key by (lemma, pos) so the same lemma used as different POS gets separate entries
    lemma_pos_data: dict[tuple[str, str], dict] = {}

    for sent_idx, doc in enumerate(nlp.pipe(sentences, batch_size=50)):
        for token in doc:
            if token.is_punct or token.is_space or len(token.text) <= 1:
                continue
            if token.pos_ not in CONTENT_POS:
                continue
            if token.like_num:
                continue

            lemma = token.lemma_.lower()
            key = (lemma, token.pos_)
            if key not in lemma_pos_data:
                lemma_pos_data[key] = {"count": 0, "first_sentence_index": sent_idx}
            lemma_pos_data[key]["count"] += 1

    results = []
    for (lemma, pos), info in lemma_pos_data.items():
        gen_freq = zipf_frequency(lemma, "es")
        transcript_bonus = math.log2(info["count"] + 1)
        score = gen_freq * 1.5 + transcript_bonus

        results.append({
            "lemma": lemma,
            "pos": pos,
            "transcript_count": info["count"],
            "general_freq": round(gen_freq, 2),
            "score": round(score, 2),
            "first_sentence_index": info["first_sentence_index"],
        })

    results.sort(key=lambda x: x["score"], reverse=True)
    return results


def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "Usage: transcript_lemmas.py <srt_path>"}))
        sys.exit(1)

    srt_path = sys.argv[1]
    if not Path(srt_path).exists():
        print(json.dumps({"error": f"SRT file not found: {srt_path}"}))
        sys.exit(1)

    sentences = parse_srt(srt_path)
    results = extract_lemmas_with_freq(sentences)
    json.dump(results, sys.stdout, ensure_ascii=False)


if __name__ == "__main__":
    main()
