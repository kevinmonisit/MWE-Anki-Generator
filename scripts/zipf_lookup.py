#!/usr/bin/env python3
"""Batch lookup zipf frequencies and CEFR levels for a list of lemmas.

Reads JSON array of {lemma, pos} from stdin, outputs JSON array with
general_freq and cefr_level added.
"""

import json
import sys
from pathlib import Path
from wordfreq import zipf_frequency

CEFR_ORDER = ["A1", "A2", "B1", "B2", "C1", "C2"]

def load_cefr_dict():
    """Load CEFR data keyed by (lemma, pos) and lemma-only (lowest level)."""
    cefr_path = Path(__file__).parent.parent / "data" / "cefr_spanish.json"
    if not cefr_path.exists():
        return {}, {}

    data = json.loads(cefr_path.read_text(encoding="utf-8"))
    by_lemma_pos = {}
    by_lemma = {}

    for entry in data:
        key = (entry["lemma"], entry["pos"])
        level = entry["cefr_level"]
        # Keep lowest level per (lemma, pos)
        if key not in by_lemma_pos or CEFR_ORDER.index(level) < CEFR_ORDER.index(by_lemma_pos[key]):
            by_lemma_pos[key] = level
        # Keep lowest level per lemma (any POS)
        if entry["lemma"] not in by_lemma or CEFR_ORDER.index(level) < CEFR_ORDER.index(by_lemma[entry["lemma"]]):
            by_lemma[entry["lemma"]] = level

    return by_lemma_pos, by_lemma


def lookup_cefr(lemma, pos, by_lemma_pos, by_lemma):
    """Lookup CEFR level: exact (lemma, pos) first, then lemma-only fallback."""
    level = by_lemma_pos.get((lemma, pos))
    if level:
        return level
    return by_lemma.get(lemma)


def main():
    by_lemma_pos, by_lemma = load_cefr_dict()
    data = json.load(sys.stdin)
    for entry in data:
        entry["general_freq"] = round(zipf_frequency(entry["lemma"], "es"), 2)
        entry["cefr_level"] = lookup_cefr(entry["lemma"], entry.get("pos", ""), by_lemma_pos, by_lemma)
    json.dump(data, sys.stdout, ensure_ascii=False)


if __name__ == "__main__":
    main()
