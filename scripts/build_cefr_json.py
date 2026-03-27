#!/usr/bin/env python3
"""
Convert ELELex TSV (FreeLing POS tags) to a deduplicated JSON list of
{lemma, pos, cefr_level} using UPOS conventions.

Only keeps NOUN, VERB, ADJ, ADV.
For duplicate (lemma, pos) pairs, the lowest CEFR level wins.
Output is sorted by CEFR level then lemma.
"""

import csv
import json
import sys
from pathlib import Path

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
INPUT = DATA_DIR / "ELELex.tsv"
OUTPUT = DATA_DIR / "cefr_spanish.json"

CEFR_LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2"]
LEVEL_RANK = {lv: i for i, lv in enumerate(CEFR_LEVELS)}

# Map FreeLing tag prefixes to UPOS
FREELING_TO_UPOS = {
    "NC": "NOUN",   # common noun
    "NP": "NOUN",   # proper noun (we'll keep some)
    "NM": "NOUN",   # number used as noun
    "VM": "VERB",   # main verb
    "VA": "VERB",   # auxiliary verb
    "VS": "VERB",   # ser
    "VP": "VERB",   # haber
    "AO": "ADJ",    # ordinal adjective
    "AQ": "ADJ",    # qualifying adjective
    "RG": "ADV",    # general adverb
    "RN": "ADV",    # negative adverb
}


def map_pos(freeling_tag: str) -> str | None:
    """Return UPOS tag or None if we should skip this entry."""
    tag = freeling_tag.strip().strip('"')
    if not tag:
        return None
    # Handle compound / messy tags: take the first token
    parts = tag.split()
    tag = parts[0] if parts else tag
    tag = tag.split(",")[0].split(";")[0]
    # Try exact match first, then prefix match (2 chars)
    if tag in FREELING_TO_UPOS:
        return FREELING_TO_UPOS[tag]
    prefix = tag[:2]
    if prefix in FREELING_TO_UPOS:
        return FREELING_TO_UPOS[prefix]
    return None


def dominant_level(freq_a1, freq_a2, freq_b1, freq_b2, freq_c1) -> str | None:
    """Return the lowest CEFR level where the word has non-trivial frequency.

    Strategy: pick the lowest level where the normalised frequency is > 0
    (the data uses 0 for absent). If all zeros, return None.
    """
    freqs = [
        ("A1", freq_a1),
        ("A2", freq_a2),
        ("B1", freq_b1),
        ("B2", freq_b2),
        ("C1", freq_c1),
    ]
    for level, f in freqs:
        if f > 0:
            return level
    return None


def main():
    # (lemma, pos) -> best CEFR level (lowest)
    best: dict[tuple[str, str], str] = {}

    with open(INPUT, newline="", encoding="utf-8") as fh:
        reader = csv.reader(fh, delimiter="\t")
        header = next(reader)  # skip header

        for row in reader:
            if len(row) < 8:
                continue
            word = row[0].strip().strip('"')
            tag_raw = row[1]
            upos = map_pos(tag_raw)
            if upos is None:
                continue

            # Skip proper nouns (capitalised single words that aren't common words)
            # but keep the entry if it's a regular common noun tag
            tag_clean = tag_raw.strip().strip('"').split()[0].split(",")[0]
            if tag_clean.startswith("NP"):
                continue  # skip proper nouns

            # Parse frequencies
            try:
                freq_a1 = float(row[2].strip().strip('"'))
                freq_a2 = float(row[3].strip().strip('"'))
                freq_b1 = float(row[4].strip().strip('"'))
                freq_b2 = float(row[5].strip().strip('"'))
                freq_c1 = float(row[6].strip().strip('"'))
            except (ValueError, IndexError):
                continue

            level = dominant_level(freq_a1, freq_a2, freq_b1, freq_b2, freq_c1)
            if level is None:
                continue

            # Normalise lemma: lowercase, strip
            lemma = word.lower().strip()
            if not lemma or len(lemma) < 1:
                continue

            key = (lemma, upos)
            if key not in best or LEVEL_RANK[level] < LEVEL_RANK[best[key]]:
                best[key] = level

    # Add zipf frequencies
    from wordfreq import zipf_frequency

    # Build sorted output
    entries = [
        {"lemma": lemma, "pos": pos, "cefr_level": level, "general_freq": round(zipf_frequency(lemma, "es"), 2)}
        for (lemma, pos), level in best.items()
    ]
    entries.sort(key=lambda e: (LEVEL_RANK[e["cefr_level"]], e["lemma"]))

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    with open(OUTPUT, "w", encoding="utf-8") as fh:
        json.dump(entries, fh, ensure_ascii=False, indent=2)

    # Stats
    from collections import Counter
    dist = Counter(e["cefr_level"] for e in entries)
    print(f"Total entries: {len(entries)}")
    for lv in CEFR_LEVELS:
        print(f"  {lv}: {dist.get(lv, 0)}")
    print(f"\nWritten to {OUTPUT}")


if __name__ == "__main__":
    main()
