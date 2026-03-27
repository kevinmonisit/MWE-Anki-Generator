#!/usr/bin/env python3
"""Extract lemmas from an SRT transcript with frequency scoring and CEFR levels.

Reads an SRT file path from argv[1], extracts text, lemmatizes with SpaCy,
and scores each lemma by combining transcript frequency and general Spanish
word frequency (via wordfreq library). Also looks up CEFR level from
data/cefr_spanish.json.

Outputs JSON array of {lemma, pos, transcript_count, general_freq, score, cefr_level}
sorted by CEFR level (A1 first), then by score descending within each level.
"""

import json
import math
import re
import sys
import unicodedata
from pathlib import Path

import simplemma
import spacy
from wordfreq import zipf_frequency


try:
    nlp = spacy.load("es_core_news_md")
except OSError:
    nlp = spacy.load("es_core_news_sm")

# POS tags to keep (filter out function words, punctuation, etc.)
CONTENT_POS = {"NOUN", "VERB", "ADJ", "ADV"}

# Spanish enclitic patterns (verb+pronoun forms like repítelo, vámonos, dígame)
_CLITIC_PATTERNS = [
    re.compile(r"(melo|mela|melos|melas|telo|tela|telos|telas|selo|sela|selos|selas)$", re.IGNORECASE),
    re.compile(r"(nos|me|te|se|lo|la|le|los|las|les|os)$", re.IGNORECASE),
]

# Irregular imperative stems that SpaCy fails to lemmatize even after clitic stripping.
# Maps the bare stem (after clitic + accent removal) to the infinitive lemma.
_IRREGULAR_IMPERATIVE_MAP = {
    "pon": "poner",
    "pon": "poner",
    "ten": "tener",
    "ven": "venir",
    "sal": "salir",
    "haz": "hacer",
    "di": "decir",
    "ve": "ir",
    "da": "dar",
    "se": "ser",
    "oye": "oír",
    "trae": "traer",
    "vale": "valer",
    "cae": "caer",
}


def _remove_accent(word: str) -> str:
    nfkd = unicodedata.normalize("NFKD", word)
    return "".join(c for c in nfkd if not unicodedata.combining(c))


def _try_clitic_fix(text: str, original_lemma: str, original_pos: str) -> tuple[str, str]:
    """Attempt to fix verb+clitic forms that SpaCy fails to lemmatize correctly.

    Strips enclitic pronouns (lo, me, nos, etc.) and re-lemmatizes the base verb.
    Only applied when the original lemma looks suspicious (low zipf or lemma == surface form).
    Returns (lemma, pos) — unchanged if no better analysis found.
    """
    text_lower = text.lower()
    if len(text_lower) <= 3:
        return original_lemma, original_pos

    candidates = []
    for pat in _CLITIC_PATTERNS:
        m = pat.search(text_lower)
        if m and len(text_lower[: m.start()]) >= 2:
            stripped = text_lower[: m.start()]
            no_acc = _remove_accent(stripped)
            candidates.extend([no_acc, stripped])
            # For -nos/-se clitics, base might need 's' back (vámonos -> vamos)
            if m.group().lower() in ("nos", "se"):
                candidates.extend([no_acc + "s", stripped + "s"])

    if not candidates:
        return original_lemma, original_pos

    # Check irregular imperative map first (pon->poner, ven->venir, etc.)
    for form in dict.fromkeys(candidates):
        if form in _IRREGULAR_IMPERATIVE_MAP:
            return _IRREGULAR_IMPERATIVE_MAP[form], "VERB"

    # Try all candidates via SpaCy, pick the verb lemma with highest zipf
    # Use multiple context sentences: infinitive context AND conjugated-verb context,
    # because SpaCy may fail to tag a conjugated form as VERB in infinitive position.
    best_lemma = None
    best_zipf = 0.0
    for form in dict.fromkeys(candidates):
        for ctx in [f"Yo debo {form}.", f"Ella {form} mucho."]:
            doc = nlp(ctx)
            for tok in doc:
                if tok.text.lower() == form and tok.pos_ == "VERB":
                    new_lemma = tok.lemma_.lower()
                    z = zipf_frequency(new_lemma, "es")
                    if z > best_zipf:
                        best_lemma = new_lemma
                        best_zipf = z

    if best_lemma and best_zipf > 0:
        return best_lemma, "VERB"
    return original_lemma, original_pos

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
        if key not in by_lemma_pos or CEFR_ORDER.index(level) < CEFR_ORDER.index(by_lemma_pos[key]):
            by_lemma_pos[key] = level
        if entry["lemma"] not in by_lemma or CEFR_ORDER.index(level) < CEFR_ORDER.index(by_lemma[entry["lemma"]]):
            by_lemma[entry["lemma"]] = level

    return by_lemma_pos, by_lemma


def zipf_to_cefr(zipf: float) -> str | None:
    """Estimate CEFR level from Zipf frequency as fallback."""
    if zipf >= 5.0:
        return "A1"
    if zipf >= 4.0:
        return "A2"
    if zipf >= 3.0:
        return "B1"
    if zipf >= 2.0:
        return "B2"
    if zipf >= 1.0:
        return "C1"
    return None


def lookup_cefr(lemma, pos, by_lemma_pos, by_lemma):
    """Lookup CEFR level: exact (lemma, pos) first, then lemma-only, then Zipf estimate."""
    level = by_lemma_pos.get((lemma, pos))
    if level:
        return level
    level = by_lemma.get(lemma)
    if level:
        return level
    # Fallback: estimate from Zipf frequency
    zipf = zipf_frequency(lemma, "es")
    return zipf_to_cefr(zipf)


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
    """Extract lemmas with transcript frequency, general frequency, and CEFR levels."""
    by_lemma_pos, by_lemma = load_cefr_dict()

    # Key by (lemma, pos) so the same lemma used as different POS gets separate entries
    lemma_pos_data: dict[tuple[str, str], dict] = {}

    # Also track which lemma keys appear in each sentence (for 1T computation)
    sentence_lemma_keys: list[set[tuple[str, str]]] = [set() for _ in sentences]

    for sent_idx, doc in enumerate(nlp.pipe(sentences, batch_size=50)):
        for token in doc:
            if token.is_punct or token.is_space or len(token.text) <= 1:
                continue
            if token.like_num:
                continue

            lemma = token.lemma_.lower()
            pos = token.pos_

            # Fix verb+clitic forms (repítelo, vámonos, dígame, etc.)
            # Apply when lemma == surface form (SpaCy didn't lemmatize) or zipf is 0
            if len(token.text) > 3:
                orig_zipf = zipf_frequency(lemma, "es")
                if lemma == token.text.lower() or orig_zipf == 0:
                    lemma, pos = _try_clitic_fix(token.text, lemma, pos)

            # Fallback 1: if lemma still has zipf 0, SpaCy produced a bad lemma.
            # Try re-lemmatizing the original word in a conjugated-verb context.
            if len(token.text) > 3 and zipf_frequency(lemma, "es") == 0 and pos in CONTENT_POS:
                text_lower = token.text.lower()
                for ctx in [f"Ella {text_lower} mucho.", f"Yo {text_lower}."]:
                    doc2 = nlp(ctx)
                    for tok2 in doc2:
                        if tok2.text.lower() == text_lower and tok2.pos_ in CONTENT_POS:
                            candidate = tok2.lemma_.lower()
                            if zipf_frequency(candidate, "es") > 0:
                                lemma = candidate
                                pos = tok2.pos_
                                break
                    if zipf_frequency(lemma, "es") > 0:
                        break

            # Cross-check: always compare SpaCy's lemma against simplemma and
            # pick whichever has the higher zipf frequency. This catches cases
            # where SpaCy produces a bad lemma that still has a non-zero zipf
            # (e.g. "gires" -> "gir" instead of "girar").
            if pos in CONTENT_POS:
                sm_lemma = simplemma.lemmatize(token.text.lower(), lang="es")
                if sm_lemma != lemma and sm_lemma != token.text.lower():
                    spacy_zipf = zipf_frequency(lemma, "es")
                    sm_zipf = zipf_frequency(sm_lemma, "es")
                    if sm_zipf > spacy_zipf:
                        lemma = sm_lemma

            # Filter after clitic fix (clitic fix can change POS to VERB)
            if pos not in CONTENT_POS:
                continue

            key = (lemma, pos)
            if key not in lemma_pos_data:
                lemma_pos_data[key] = {"count": 0, "first_sentence_index": sent_idx, "sentence_indices": []}
            lemma_pos_data[key]["count"] += 1
            if sent_idx not in lemma_pos_data[key]["sentence_indices"]:
                lemma_pos_data[key]["sentence_indices"].append(sent_idx)
            sentence_lemma_keys[sent_idx].add(key)

    results = []
    for (lemma, pos), info in lemma_pos_data.items():
        gen_freq = zipf_frequency(lemma, "es")
        transcript_bonus = math.log2(info["count"] + 1)
        score = gen_freq * 1.5 + transcript_bonus
        cefr = lookup_cefr(lemma, pos, by_lemma_pos, by_lemma)

        results.append({
            "lemma": lemma,
            "pos": pos,
            "transcript_count": info["count"],
            "general_freq": round(gen_freq, 2),
            "score": round(score, 2),
            "first_sentence_index": info["first_sentence_index"],
            "sentence_indices": info["sentence_indices"],
            "cefr_level": cefr,
        })

    # Sort by CEFR level (A1 first, None last), then by score descending within level
    def sort_key(x):
        cefr = x["cefr_level"]
        cefr_ord = CEFR_ORDER.index(cefr) if cefr in CEFR_ORDER else len(CEFR_ORDER)
        return (cefr_ord, -x["score"])

    results.sort(key=sort_key)

    # Build sentence_lemma_map: for each sentence index, list of (lemma, pos) keys
    # This allows the backend to compute 1T counts after determining known/unknown status
    sentence_map = []
    for sent_idx, keys in enumerate(sentence_lemma_keys):
        sentence_map.append([{"lemma": k[0], "pos": k[1]} for k in keys])

    return results, sentence_map


def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "Usage: transcript_lemmas.py <srt_path>"}))
        sys.exit(1)

    srt_path = sys.argv[1]
    if not Path(srt_path).exists():
        print(json.dumps({"error": f"SRT file not found: {srt_path}"}))
        sys.exit(1)

    sentences = parse_srt(srt_path)
    results, sentence_map = extract_lemmas_with_freq(sentences)
    json.dump({"lemmas": results, "sentence_map": sentence_map}, sys.stdout, ensure_ascii=False)


if __name__ == "__main__":
    main()
