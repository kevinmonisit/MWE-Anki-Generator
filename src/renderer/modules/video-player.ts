import type { TranscriptLemma } from '../../shared/types';
import type { Subtitle } from '../state';
import {
  subtitles,
  currentActiveIndex,
  mweView,
  cachedTranscriptLemmas,
  activeLemmaSource,
  setSubtitles,
  setCurrentActiveIndex,
  setCurrentFolder,
  setCurrentVideoTitle,
  setCachedTranscriptLemmas,
  setCachedLemmaAnalyzedAt,
  setCachedLemmasBySource,
  resetCachedLemmasBySource,
  setActiveLemmaSource,
  setSidebarView,
} from '../state';
import { escapeHtml, formatTime } from '../utils';
import { refreshSidebar } from './layout';
import { loadMWEsForFolder, renderTranscriptLemmas } from './mwe-panel';

// DOM elements
const videoPlayer = document.getElementById('videoPlayer') as HTMLVideoElement;
const transcriptList = document.getElementById('transcriptList') as HTMLDivElement;
const welcomeEl = document.getElementById('welcome') as HTMLDivElement;
const contentEl = document.getElementById('content') as HTMLDivElement;
const progressEl = document.getElementById('progress') as HTMLDivElement;

// Search DOM elements
const searchBar = document.getElementById('transcriptSearchBar') as HTMLDivElement;
const searchInput = document.getElementById('transcriptSearchInput') as HTMLInputElement;
const searchCount = document.getElementById('transcriptSearchCount') as HTMLSpanElement;
const searchPrevBtn = document.getElementById('transcriptSearchPrev') as HTMLButtonElement;
const searchNextBtn = document.getElementById('transcriptSearchNext') as HTMLButtonElement;
const searchCloseBtn = document.getElementById('transcriptSearchClose') as HTMLButtonElement;

// Search state
let searchMatches: { entryIndex: number; node: HTMLElement }[] = [];
let currentMatchIndex = -1;

/**
 * Select a video: updates state, refreshes sidebar, loads video + MWEs,
 * and restores any previously saved transcript lemma analysis.
 */
export async function selectVideo(video: {
  folder: string;
  videoPath: string;
  srtPath: string;
  title?: string;
}): Promise<void> {
  setCurrentFolder(video.folder);
  setCurrentVideoTitle(video.title || video.folder);
  setCachedTranscriptLemmas(null);
  setCachedLemmaAnalyzedAt(null);
  setSidebarView('cards');
  refreshSidebar();
  loadVideo(video.videoPath, video.srtPath);
  loadMWEsForFolder(video.folder);

  // Load all saved lemma sources (spacy + gpt) for this video
  resetCachedLemmasBySource();
  const allSources = await window.api.loadAllLemmaSources(video.folder);
  if (allSources.success) {
    if (allSources.spacy) {
      setCachedLemmasBySource('spacy', { lemmas: allSources.spacy.lemmas as TranscriptLemma[], analyzedAt: allSources.spacy.analyzedAt });
    }
    if (allSources.gpt) {
      setCachedLemmasBySource('gpt', { lemmas: allSources.gpt.lemmas as TranscriptLemma[], analyzedAt: allSources.gpt.analyzedAt });
    }
    // Default to whichever source is available, preferring current active source
    const preferred = allSources[activeLemmaSource] || allSources.gpt || allSources.spacy;
    const activeSource = allSources[activeLemmaSource] ? activeLemmaSource : (allSources.gpt ? 'gpt' : 'spacy');
    if (preferred) {
      setActiveLemmaSource(activeSource);
      setCachedTranscriptLemmas(preferred.lemmas as TranscriptLemma[]);
      setCachedLemmaAnalyzedAt(preferred.analyzedAt || null);
      if (mweView === 'lemmas') renderTranscriptLemmas(preferred.lemmas as TranscriptLemma[]);
    }
  }
}

/**
 * Load a video file and its SRT subtitle track.
 * Sets the video source, parses the SRT, renders the transcript,
 * and wires up the timeupdate listener for sync.
 */
export async function loadVideo(videoPath: string, srtPath: string): Promise<void> {
  // Remove any previous listener to avoid duplicates
  videoPlayer.removeEventListener('timeupdate', syncTranscript);

  videoPlayer.src = `file://${videoPath}`;
  videoPlayer.load();

  try {
    closeSearch();
    const srtText = await window.api.readFile(srtPath);
    setSubtitles(parseSRT(srtText));
    setCurrentActiveIndex(-1);
    renderTranscript();
    welcomeEl.style.display = 'none';
    contentEl.classList.add('visible');
    progressEl.classList.remove('visible');

    videoPlayer.addEventListener('timeupdate', syncTranscript);
  } catch (err) {
    console.error('Failed to load SRT:', err);
    progressEl.textContent = 'Warning: Could not load subtitles.';
    setSubtitles([]);
    setCurrentActiveIndex(-1);
    renderTranscript();
    welcomeEl.style.display = 'none';
    contentEl.classList.add('visible');
  }
}

/**
 * Parse an SRT-format string into an array of Subtitle objects.
 */
export function parseSRT(text: string): Subtitle[] {
  const entries: Subtitle[] = [];
  const blocks = text.trim().split(/\n\s*\n/);

  for (const block of blocks) {
    const lines = block.trim().split('\n');
    if (lines.length < 3) continue;

    const timeMatch = lines[1].match(
      /(\d{2}):(\d{2}):(\d{2})[,.](\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2})[,.](\d{3})/
    );
    if (!timeMatch) continue;

    const start =
      +timeMatch[1] * 3600 +
      +timeMatch[2] * 60 +
      +timeMatch[3] +
      +timeMatch[4] / 1000;
    const end =
      +timeMatch[5] * 3600 +
      +timeMatch[6] * 60 +
      +timeMatch[7] +
      +timeMatch[8] / 1000;
    const subtitleText = lines
      .slice(2)
      .join(' ')
      .replace(/<[^>]*>/g, '')
      .trim();

    if (subtitleText) {
      entries.push({ start, end, text: subtitleText });
    }
  }

  return entries;
}

/**
 * Render the parsed subtitles into the transcript list DOM element.
 * Each entry shows a timestamp and text; clicking jumps the video to that time.
 */
export function renderTranscript(): void {
  transcriptList.innerHTML = '';

  subtitles.forEach((sub, i) => {
    const entry = document.createElement('div');
    entry.className =
      'transcript-entry flex gap-3 py-1.5 px-4 cursor-pointer transition-colors duration-150 border-l-[3px] border-l-transparent hover:bg-accent/10';
    entry.dataset.index = String(i);
    entry.innerHTML = `
      <span class="transcript-time text-xs text-accent font-mono whitespace-nowrap min-w-[80px] pt-1">${formatTime(sub.start)}</span>
      <span class="transcript-text text-base leading-relaxed text-gray-300">${escapeHtml(sub.text)}</span>
    `;

    entry.addEventListener('click', () => {
      videoPlayer.currentTime = sub.start;
    });

    transcriptList.appendChild(entry);
  });
}

/**
 * Synchronise the transcript highlight with the current video playback position.
 * Called on every `timeupdate` event from the video element.
 */
export function syncTranscript(): void {
  const time = videoPlayer.currentTime;

  let activeIndex = -1;
  for (let i = 0; i < subtitles.length; i++) {
    if (time >= subtitles[i].start && time < subtitles[i].end) {
      activeIndex = i;
      break;
    }
  }

  if (activeIndex === currentActiveIndex) return;
  setCurrentActiveIndex(activeIndex);

  const prev = transcriptList.querySelector('.active');
  if (prev) prev.classList.remove('active');

  if (activeIndex >= 0) {
    const entry = transcriptList.children[activeIndex] as HTMLElement;
    if (entry) {
      entry.classList.add('active');
      entry.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }
}

// ── Transcript Search ────────────────────────────────────────────────

function openSearch(): void {
  searchBar.classList.remove('hidden');
  searchBar.classList.add('flex');
  searchInput.focus();
  searchInput.select();
}

function closeSearch(): void {
  searchBar.classList.add('hidden');
  searchBar.classList.remove('flex');
  searchInput.value = '';
  clearSearchHighlights();
  searchMatches = [];
  currentMatchIndex = -1;
  searchCount.textContent = '';
}

function clearSearchHighlights(): void {
  transcriptList.querySelectorAll('.transcript-text').forEach((span) => {
    const el = span as HTMLElement;
    // Restore original text (strip <mark> tags)
    if (el.querySelector('mark')) {
      el.textContent = el.textContent || '';
    }
  });
  transcriptList.querySelectorAll('.search-current-entry').forEach((el) => {
    el.classList.remove('search-current-entry');
  });
}

function performSearch(): void {
  const query = searchInput.value.trim().toLowerCase();
  clearSearchHighlights();
  searchMatches = [];
  currentMatchIndex = -1;

  if (!query) {
    searchCount.textContent = '';
    return;
  }

  const entries = transcriptList.querySelectorAll('.transcript-entry');
  entries.forEach((entry, entryIndex) => {
    const textSpan = entry.querySelector('.transcript-text') as HTMLElement;
    if (!textSpan) return;

    const originalText = textSpan.textContent || '';
    const lowerText = originalText.toLowerCase();

    if (!lowerText.includes(query)) return;

    // Highlight all occurrences in this span
    let html = '';
    let pos = 0;
    let idx = lowerText.indexOf(query, pos);
    while (idx !== -1) {
      html += escapeHtml(originalText.slice(pos, idx));
      html += `<mark class="bg-yellow-500/40 text-white rounded-sm">${escapeHtml(originalText.slice(idx, idx + query.length))}</mark>`;
      searchMatches.push({ entryIndex, node: entry as HTMLElement });
      pos = idx + query.length;
      idx = lowerText.indexOf(query, pos);
    }
    html += escapeHtml(originalText.slice(pos));
    textSpan.innerHTML = html;
  });

  if (searchMatches.length > 0) {
    currentMatchIndex = 0;
    highlightCurrentMatch();
  }
  updateSearchCount();
}

function updateSearchCount(): void {
  if (searchMatches.length === 0 && searchInput.value.trim()) {
    searchCount.textContent = 'No results';
  } else if (searchMatches.length > 0) {
    searchCount.textContent = `${currentMatchIndex + 1}/${searchMatches.length}`;
  } else {
    searchCount.textContent = '';
  }
}

function highlightCurrentMatch(): void {
  // Remove previous current-entry highlight
  transcriptList.querySelectorAll('.search-current-entry').forEach((el) => {
    el.classList.remove('search-current-entry');
  });

  if (currentMatchIndex < 0 || currentMatchIndex >= searchMatches.length) return;

  const match = searchMatches[currentMatchIndex];
  match.node.classList.add('search-current-entry');
  match.node.scrollIntoView({ behavior: 'smooth', block: 'center' });

  // Highlight the specific <mark> within this entry more prominently
  const marks = transcriptList.querySelectorAll('mark');
  marks.forEach((m) => {
    m.className = 'bg-yellow-500/40 text-white rounded-sm';
  });

  // Find the mark corresponding to currentMatchIndex
  if (marks[currentMatchIndex]) {
    marks[currentMatchIndex].className = 'bg-yellow-400 text-black rounded-sm';
  }
}

function goToNextMatch(): void {
  if (searchMatches.length === 0) return;
  currentMatchIndex = (currentMatchIndex + 1) % searchMatches.length;
  highlightCurrentMatch();
  updateSearchCount();
}

function goToPrevMatch(): void {
  if (searchMatches.length === 0) return;
  currentMatchIndex = (currentMatchIndex - 1 + searchMatches.length) % searchMatches.length;
  highlightCurrentMatch();
  updateSearchCount();
}

// Wire up search UI events
searchInput.addEventListener('input', performSearch);
searchNextBtn.addEventListener('click', goToNextMatch);
searchPrevBtn.addEventListener('click', goToPrevMatch);
searchCloseBtn.addEventListener('click', closeSearch);

searchInput.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    closeSearch();
  } else if (e.key === 'Enter' && e.shiftKey) {
    e.preventDefault();
    goToPrevMatch();
  } else if (e.key === 'Enter') {
    e.preventDefault();
    goToNextMatch();
  }
});

// Global Ctrl+F / Cmd+F shortcut
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
    // Only intercept when content area is visible (a video is loaded)
    if (!contentEl.classList.contains('visible')) return;
    e.preventDefault();
    openSearch();
  }
});

/**
 * Initialise the video player module.
 * Adds the timeupdate event listener (also handled inside loadVideo for re-binding).
 */
export function initVideoPlayer(): void {
  videoPlayer.addEventListener('timeupdate', syncTranscript);
}
