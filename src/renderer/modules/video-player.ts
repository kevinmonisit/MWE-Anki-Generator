import type { TranscriptLemma } from '../../shared/types';
import type { Subtitle } from '../state';
import {
  subtitles,
  currentActiveIndex,
  mweView,
  cachedTranscriptLemmas,
  setSubtitles,
  setCurrentActiveIndex,
  setCurrentFolder,
  setCurrentVideoTitle,
  setCachedTranscriptLemmas,
  setCachedLemmaAnalyzedAt,
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

  // Load previously saved lemma analysis for this video
  const saved = await window.api.loadTranscriptLemmas(video.folder);
  if (saved.success && saved.lemmas) {
    setCachedTranscriptLemmas(saved.lemmas);
    setCachedLemmaAnalyzedAt(saved.analyzedAt || null);
    if (mweView === 'lemmas') renderTranscriptLemmas(saved.lemmas);
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

/**
 * Initialise the video player module.
 * Adds the timeupdate event listener (also handled inside loadVideo for re-binding).
 */
export function initVideoPlayer(): void {
  videoPlayer.addEventListener('timeupdate', syncTranscript);
}
