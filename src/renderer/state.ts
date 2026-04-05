import type { Card, MWEResult, TranscriptLemma, CorpusProgress, MWEProgress } from '../shared/types';

export interface Subtitle {
  start: number;
  end: number;
  text: string;
}

export interface AnkiConnectResponse {
  result: unknown;
  error: string | null;
}

// --- Video / Transcript state ---
export let subtitles: Subtitle[] = [];
export let currentActiveIndex = -1;
export let currentFolder: string | null = null;
export let currentVideoTitle = '';
export let currentAnchorIndex = -1;

export function setSubtitles(subs: Subtitle[]) { subtitles = subs; }
export function setCurrentActiveIndex(idx: number) { currentActiveIndex = idx; }
export function setCurrentFolder(folder: string | null) { currentFolder = folder; }
export function setCurrentVideoTitle(title: string) { currentVideoTitle = title; }
export function setCurrentAnchorIndex(idx: number) { currentAnchorIndex = idx; }

// --- Sidebar state ---
export let sidebarView: 'videos' | 'cards' = 'videos';
export function setSidebarView(view: 'videos' | 'cards') { sidebarView = view; }

// --- Anki state ---
export let ankiConnected = false;
export let ankiDecks: string[] = [];
export let selectedAnkiDeck = '';
export let selectedChunkingDeck = '';

export function setAnkiConnected(val: boolean) { ankiConnected = val; }
export function setAnkiDecks(decks: string[]) { ankiDecks = decks; }
export function setSelectedAnkiDeck(deck: string) { selectedAnkiDeck = deck; }
export function setSelectedChunkingDeck(deck: string) { selectedChunkingDeck = deck; }

// --- MWE state ---
export let mweView: 'categories' | 'list' | 'lemmas' = 'categories';
export let lastMWEResults: MWEResult[] = [];
export let selectedMWEs = new Set<string>();
export let lastClickedMWEIndex = -1;
export let knownSectionCollapsed = true;
export let isMWEExtracting = false;

export function setMWEView(view: 'categories' | 'list' | 'lemmas') { mweView = view; }
export function setLastMWEResults(results: MWEResult[]) { lastMWEResults = results; }
export function setLastClickedMWEIndex(idx: number) { lastClickedMWEIndex = idx; }
export function setKnownSectionCollapsed(val: boolean) { knownSectionCollapsed = val; }
export function setIsMWEExtracting(val: boolean) { isMWEExtracting = val; }

// --- Lemma state ---
export let cachedTranscriptLemmas: TranscriptLemma[] | null = null;
export let cachedLemmaAnalyzedAt: string | null = null;
export let lemmaFilter: 'all' | 'unknown' | 'known' = 'unknown';
export let lemmaCefrFilter = 'all';
export let isLemmaAnalyzing = false;
export let selectedLemmaIndices = new Set<number>();
export let lastClickedLemmaIndex = -1;
/** The currently displayed (filtered+sorted) lemma list, kept in sync by renderTranscriptLemmas */
export let displayedLemmaList: TranscriptLemma[] = [];

export function setSelectedLemmaIndices(s: Set<number>) { selectedLemmaIndices = s; }
export function setLastClickedLemmaIndex(idx: number) { lastClickedLemmaIndex = idx; }
export function setDisplayedLemmaList(list: TranscriptLemma[]) { displayedLemmaList = list; }

export function setCachedTranscriptLemmas(lemmas: TranscriptLemma[] | null) { cachedTranscriptLemmas = lemmas; }
export function setCachedLemmaAnalyzedAt(at: string | null) { cachedLemmaAnalyzedAt = at; }
export function setLemmaFilter(f: 'all' | 'unknown' | 'known') { lemmaFilter = f; }
export function setLemmaCefrFilter(f: string) { lemmaCefrFilter = f; }
export function setIsLemmaAnalyzing(val: boolean) { isLemmaAnalyzing = val; }

// --- Explain state ---
export let currentTranslation = '';
export let currentExplanation = '';
export let currentExplanationEs = '';
export let currentSelectedText = '';
export let currentSelectionContext = { sentenceBefore: '', sentenceAfter: '' };

export function setCurrentTranslation(t: string) { currentTranslation = t; }
export function setCurrentExplanation(e: string) { currentExplanation = e; }
export function setCurrentExplanationEs(e: string) { currentExplanationEs = e; }
export function setCurrentSelectedText(t: string) { currentSelectedText = t; }
export function setCurrentSelectionContext(ctx: { sentenceBefore: string; sentenceAfter: string }) { currentSelectionContext = ctx; }

// --- Corpus state ---
export let currentPage: 'main' | 'corpus' | 'speech-analysis' = 'main';
export let selectedCorpusDecks = new Set<string>();
export let corpusSentences: string[] = [];
export let corpusLemmas: { lemma: string; pos: string }[] = [];
export let pendingMWEs: MWEResult[] = [];
export let mweCheckedSet = new Set<number>();
export let corpusDeckName = '';
export let corpusLemmaCount = 0;
export let corpusNewSentenceCount = 0;
export let corpusSkippedCount = 0;

export function setCurrentPage(page: 'main' | 'corpus' | 'speech-analysis') { currentPage = page; }
export function setCorpusSentences(s: string[]) { corpusSentences = s; }
export function setCorpusLemmas(l: { lemma: string; pos: string }[]) { corpusLemmas = l; }
export function setPendingMWEs(m: MWEResult[]) { pendingMWEs = m; }
export function setMWECheckedSet(s: Set<number>) { mweCheckedSet = s; }
export function setCorpusDeckName(n: string) { corpusDeckName = n; }
export function setCorpusLemmaCount(c: number) { corpusLemmaCount = c; }
export function setCorpusNewSentenceCount(c: number) { corpusNewSentenceCount = c; }
export function setCorpusSkippedCount(c: number) { corpusSkippedCount = c; }
