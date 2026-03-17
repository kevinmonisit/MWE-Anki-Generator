"""
LLM-based Mexican Spanish MWE extraction.

Uses OpenAI + PARSEME categories + Mexican dialect awareness to extract
and normalize multiword expressions from small texts. No large corpus needed.

Approach:
  1. Send text to OpenAI with a prompt informed by PARSEME Shared Task
     categories (VPC, LVC, VID, IRV, MVC, etc.) adapted to Spanish
  2. Layer on Mexican dialect MWE knowledge (mexicanismos, slang idioms)
  3. Normalize extracted MWEs to citation/dictionary forms
  4. Output a PARSEME-style lexicon as JSON
"""

import json
import os
import re
from openai import OpenAI
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), '..', '.env.local'))

client = OpenAI(api_key=os.environ["OPENAI_API_KEY"])

# ── Extraction prompt ──────────────────────────────────────────────
# Combines PARSEME Shared Task typology with Mexican Spanish dialect knowledge.

EXTRACTION_SYSTEM_PROMPT = """\
You are a Mexican Spanish linguistics expert trained on the PARSEME Shared Task
annotation guidelines for verbal multiword expressions, extended to cover all
MWE types relevant to colloquial Mexican Spanish.

Given numbered sentences, extract ALL multiword expressions.

## PARSEME-based Categories (use exactly these labels)

### Verbal MWEs (from PARSEME Shared Task)
1. **VID** — Verbal idioms: fixed/semi-fixed verb phrases with non-compositional
   meaning. PARSEME criterion: at least one word has non-literal meaning.
   Examples: echar de menos, darse cuenta, caer el veinte, pasarse de lanza,
   hacerse el loco, quedar mal, caer bien/mal

2. **LVC.full** — Light verb construction (full): verb is semantically light,
   noun carries core meaning, verb contributes full event structure.
   Examples: dar un paseo, tener miedo, echar relajo, hacer caso

3. **LVC.cause** — Light verb construction (causative): verb adds causative
   semantics to nominal predicate.
   Examples: dar miedo, meter prisa

4. **VPC** — Verb-particle construction: verb + adverb/preposition forming a
   semantic unit. (Less common in Spanish but exists.)
   Examples: salir adelante, echar a perder, ir de mal en peor

5. **IRV** — Inherently reflexive verb: clitic pronoun is integral and cannot
   be dropped without changing meaning or grammaticality.
   Examples: darse cuenta, echarse a perder, hacerse el loco, irse,
   ponerse a + inf, pasarse de lanza

6. **MVC** — Multi-verb construction: grammaticalized verb chains / periphrases.
   Examples: ir a + inf, estar + gerund, tener que + inf, ponerse a + inf,
   empezar a + inf, acabar de + inf, andar + gerund, seguir + gerund

### Extended Categories (beyond PARSEME verbal scope)
7. **mexicanismo** — Mexicanisms: slang, colloquialisms, or expressions
   specific to Mexican Spanish that function as fixed chunks.
   Examples: qué onda, no manches, la neta, chido, ni modo, órale,
   a huevo, está cañón, echar la hueva, cada quien, bien chido,
   aflojó la lana, jalar (=irse)

8. **marcador_discursivo** — Discourse markers / pragmatic chunks.
   Examples: o sea, la verdad, es que, fíjate que, la neta, al rato,
   ni modo, total, al final

9. **locucion_adverbial** — Adverbial locutions: frozen multi-word adverbs.
   Examples: de repente, al rato, al final, de todos modos, a lo mejor

10. **locucion_prepositiva** — Prepositional locutions.
    Examples: a pesar de, en vez de, en cuanto a

11. **colocacion** — Collocations: conventionally preferred combinations.
    Examples: prestar atención, cometer un error, pasarla bien/chido

12. **expresion_fija** — Fixed expressions / formulaic phrases.
    Examples: ni modo, cada quien, hoy en día, para no quedar mal

## Rules
- Extract MWEs **as they appear** in the sentence (inflected surface form).
- One MWE can belong to multiple categories (e.g., VID + IRV + mexicanismo).
- Include sentence_index (0-based, matching the [N] label).
- Extract overlapping MWEs separately.
- Do NOT extract simple conjugations, transparent noun phrases, or single words.
- Err on the side of inclusion for Mexican colloquial speech.

## Output — ONLY a JSON array, no markdown fences, no prose.

[
  {
    "surface_form": "me di cuenta",
    "categories": ["VID", "IRV"],
    "sentence_index": 5,
    "context_note": "realized / became aware"
  }
]

If no MWEs found, return: []"""


NORMALIZATION_SYSTEM_PROMPT = """\
You are a Mexican Spanish lexicographer producing PARSEME-compatible normalized
(citation/dictionary) forms for multiword expressions.

## Normalization Rules
- Conjugated verbs → infinitive
- Pronominal verbs → infinitive + se (darse cuenta, echarse a perder)
- Person-specific clitics → generalized (me di cuenta → darse cuenta)
- Verbal periphrases → pattern form (ir a + infinitivo, tener que + infinitivo)
- Fixed expressions / discourse markers → keep as conventionally cited
- Preserve Mexican-specific forms (don't Peninsularize)

## Output — ONLY a JSON array, no markdown fences, no prose.

[
  {
    "surface_form": "me di cuenta",
    "normalized_form": "darse cuenta",
    "parseme_category": "VID;IRV",
    "normalization_note": "Pronominal verb, reflexive se + infinitive"
  }
]"""


# ── Helpers ────────────────────────────────────────────────────────

def parse_json_response(raw: str) -> list:
    cleaned = raw.strip()
    cleaned = re.sub(r'^```(?:json)?\s*', '', cleaned)
    cleaned = re.sub(r'\s*```$', '', cleaned)
    return json.loads(cleaned)


def split_sentences(text: str) -> list[dict]:
    sentences = []
    for line in text.strip().split('\n'):
        line = line.strip()
        if not line:
            continue
        parts = re.split(r'(?<=[.!?])\s+', line)
        for part in parts:
            part = part.strip()
            if part:
                sentences.append({"index": len(sentences), "text": part})
    return sentences


# ── Pipeline ───────────────────────────────────────────────────────

def extract_mwes(sentences: list[dict], model: str = "gpt-4.1") -> list[dict]:
    user_prompt = "\n".join(f"[{s['index']}] {s['text']}" for s in sentences)
    resp = client.chat.completions.create(
        model=model,
        messages=[
            {"role": "system", "content": EXTRACTION_SYSTEM_PROMPT},
            {"role": "user", "content": f"Extract all MWEs from these sentences:\n\n{user_prompt}"},
        ],
        max_tokens=4000,
        temperature=0.3,
    )
    return parse_json_response(resp.choices[0].message.content)


def normalize_mwes(mwes: list[dict], model: str = "gpt-4.1") -> list[dict]:
    input_data = [{"surface_form": m["surface_form"], "categories": m["categories"]} for m in mwes]
    resp = client.chat.completions.create(
        model=model,
        messages=[
            {"role": "system", "content": NORMALIZATION_SYSTEM_PROMPT},
            {"role": "user", "content": f"Normalize these MWEs:\n\n{json.dumps(input_data, ensure_ascii=False, indent=2)}"},
        ],
        max_tokens=4000,
        temperature=0.3,
    )
    return parse_json_response(resp.choices[0].message.content)


def build_lexicon(extracted: list[dict], normalized: list[dict], sentences: list[dict]) -> list[dict]:
    norm_map = {n["surface_form"]: n for n in normalized}
    sent_map = {s["index"]: s["text"] for s in sentences}

    seen: dict[str, dict] = {}
    for mwe in extracted:
        norm = norm_map.get(mwe["surface_form"], {})
        normalized_form = norm.get("normalized_form", mwe["surface_form"].lower())
        parseme_cats = ";".join(mwe["categories"])

        if normalized_form not in seen:
            seen[normalized_form] = {
                "normalized_form": normalized_form,
                "parseme_categories": parseme_cats,
                "categories": mwe["categories"],
                "context_note": mwe.get("context_note", ""),
                "normalization_note": norm.get("normalization_note", ""),
                "frequency": 0,
                "instances": [],
            }
        entry = seen[normalized_form]
        entry["frequency"] += 1
        entry["instances"].append({
            "surface_form": mwe["surface_form"],
            "sentence_index": mwe["sentence_index"],
            "sentence_text": sent_map.get(mwe["sentence_index"], ""),
        })

    return sorted(seen.values(), key=lambda e: (-e["frequency"], e["normalized_form"]))


# ── Main ───────────────────────────────────────────────────────────

TEXT = """Ayer salí con unos amigos y la neta la pasamos bien chido.
Primero íbamos a echarnos unos tacos, pero el puesto se echó a perder porque se les fue la luz.
Ni modo, así pasa. Entonces dijimos órale, vamos a ver qué onda en el centro.
Un compa empezó a hacerse el loco porque no quería pagar el Uber, pero al final aflojó la lana.
Ya en el bar nos pusimos a cotorrear y a echar relajo. Un amigo se pasó de lanza y empezó a hablarle a todo el mundo.
Al rato me di cuenta de que ya era tardísimo.
La verdad ya me estaba cayendo el veinte de que mañana tenía que chambear temprano.
Total, pedimos otro drink nomás para no quedar mal y luego cada quien jaló para su casa."""


def main():
    print("=" * 60)
    print("Mexican Spanish MWE Extraction (LLM + PARSEME)")
    print("=" * 60)

    sentences = split_sentences(TEXT)
    print(f"\n[1/3] Split into {len(sentences)} sentences")
    for s in sentences:
        print(f"  [{s['index']}] {s['text']}")

    print(f"\n[2/3] Extracting MWEs via OpenAI...")
    extracted = extract_mwes(sentences)
    print(f"  Found {len(extracted)} MWE instances")

    print(f"\n[3/3] Normalizing MWEs...")
    normalized = normalize_mwes(extracted)

    lexicon = build_lexicon(extracted, normalized, sentences)

    print("\n" + "=" * 60)
    print(f"PARSEME-STYLE MWE LEXICON — {len(lexicon)} unique entries")
    print("=" * 60)

    for i, entry in enumerate(lexicon, 1):
        cats = ", ".join(entry["categories"])
        print(f"\n{i}. {entry['normalized_form']}  [{cats}]")
        if entry["context_note"]:
            print(f"   Meaning: {entry['context_note']}")
        if entry["normalization_note"]:
            print(f"   Norm: {entry['normalization_note']}")
        print(f"   Freq: {entry['frequency']}")
        for inst in entry["instances"]:
            print(f"   → \"{inst['surface_form']}\" in sent {inst['sentence_index']}")

    out_path = os.path.join(os.path.dirname(__file__), "mwe_lexicon.json")
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(lexicon, f, ensure_ascii=False, indent=2)
    print(f"\nLexicon saved to {out_path}")


if __name__ == "__main__":
    main()
