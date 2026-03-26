#!/usr/bin/env python3
"""Batch lookup zipf frequencies for a list of lemmas.

Reads JSON array of {lemma, pos} from stdin, outputs JSON array with general_freq added.
"""

import json
import sys
from wordfreq import zipf_frequency


def main():
    data = json.load(sys.stdin)
    for entry in data:
        entry["general_freq"] = round(zipf_frequency(entry["lemma"], "es"), 2)
    json.dump(data, sys.stdout, ensure_ascii=False)


if __name__ == "__main__":
    main()
