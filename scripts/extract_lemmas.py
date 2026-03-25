#!/usr/bin/env python3
"""Extract lemmas from Spanish sentences using SpaCy.

Reads JSON array of sentences from stdin, outputs JSON array of unique lemmas
with proper POS tags from SpaCy's NLP pipeline.
"""

import json
import sys

import spacy

nlp = spacy.load("es_core_news_sm")


def extract_lemmas(sentences: list[str]) -> list[dict]:
    """Extract unique lemmas from a list of Spanish sentences."""
    seen: dict[str, str] = {}  # lemma -> pos

    # Process in batches using SpaCy's pipe for efficiency
    for doc in nlp.pipe(sentences, batch_size=50):
        for token in doc:
            if token.is_punct or token.is_space or len(token.text) <= 1:
                continue
            lemma = token.lemma_.lower()
            if lemma not in seen:
                seen[lemma] = token.pos_

    return [{"lemma": lemma, "pos": pos} for lemma, pos in sorted(seen.items())]


def main():
    data = json.loads(sys.stdin.read())
    sentences = data if isinstance(data, list) else data.get("sentences", [])
    results = extract_lemmas(sentences)
    json.dump(results, sys.stdout, ensure_ascii=False)


if __name__ == "__main__":
    main()
