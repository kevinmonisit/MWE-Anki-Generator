export const CEFR_LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'] as const;

export const MIGAKU_POS_MAP: Record<string, string> = {
  'v': 'VERB', 'n': 'NOUN', 'adj': 'ADJ', 'adv': 'ADV',
  'adp': 'ADP', 'pron': 'PRON', 'art': 'DET', 'sconj': 'SCONJ',
  'propn': 'PROPN', 'intj': 'INTJ', 'conj': 'CCONJ', 'num': 'NUM',
  'det': 'DET', 'aux': 'AUX', 'part': 'PART',
};
