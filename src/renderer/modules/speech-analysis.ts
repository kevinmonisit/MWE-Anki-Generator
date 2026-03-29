import type { SpeechAnalysisProgress, SpeechAnalysisStore, SpeechAnalysisResult } from '../../shared/types';
import { registerOnNavigate } from './navigation';

type AnalysisMode = 'correction' | 'parent';

let currentMode: AnalysisMode = 'correction';
let store: SpeechAnalysisStore = {};
let currentTranscript = '';
let isTranscribing = false;
let isAnalyzing = false;
let selectedCookiesFile: string | null = null;

async function loadSavedData(): Promise<void> {
  try {
    store = await window.api.loadSpeechAnalysis();
  } catch {
    store = {};
  }

  const result = currentMode === 'correction' ? store.correction : store.parent;
  if (result) {
    currentTranscript = result.transcript;
    renderTranscript(result.transcript);
    renderAnalysis(result.analysisOutput);
    updateTranscriptInfo(result.playlistUrl);
    updateRunBtn();
  }
}

function renderTranscript(text: string): void {
  const container = document.getElementById('saTranscriptContent') as HTMLDivElement;
  if (!text) {
    container.innerHTML = '<div class="text-gray-600 text-sm text-center py-10">Enter a playlist or video URL above and click "Transcribe Playlist" to get started.</div>';
    return;
  }
  const lines = text.split('\n').filter(l => l.trim());
  container.innerHTML = '';
  for (const line of lines) {
    const p = document.createElement('p');
    p.className = 'text-[13px] text-gray-300 leading-relaxed mb-1.5';
    p.textContent = line;
    container.appendChild(p);
  }
}

function renderAnalysis(text: string): void {
  const container = document.getElementById('saAnalysisContent') as HTMLDivElement;
  if (!text) {
    container.innerHTML = '<div class="text-gray-600 text-sm text-center py-10">Transcribe a playlist first, then click "Run Analysis" to generate output.</div>';
    return;
  }
  const lines = text.split('\n');
  container.innerHTML = '';
  for (const line of lines) {
    const p = document.createElement('p');
    p.className = 'text-[13px] text-gray-300 leading-relaxed mb-1';
    if (line.trim() === '') {
      p.innerHTML = '&nbsp;';
    } else {
      p.textContent = line;
    }
    container.appendChild(p);
  }
}

function updateTranscriptInfo(playlistUrl?: string): void {
  const info = document.getElementById('saTranscriptInfo') as HTMLSpanElement;
  if (currentTranscript) {
    const lineCount = currentTranscript.split('\n').filter(l => l.trim()).length;
    info.textContent = `${lineCount} lines${playlistUrl ? ' | ' + playlistUrl.substring(0, 50) + '...' : ''}`;
  } else {
    info.textContent = '';
  }
}

function updateRunBtn(): void {
  const btn = document.getElementById('saRunAnalysisBtn') as HTMLButtonElement;
  btn.disabled = !currentTranscript || isAnalyzing;
}

function setMode(mode: AnalysisMode): void {
  currentMode = mode;

  const tabCorrection = document.getElementById('saTabCorrection') as HTMLButtonElement;
  const tabParent = document.getElementById('saTabParent') as HTMLButtonElement;
  const outputTitle = document.getElementById('saOutputTitle') as HTMLSpanElement;

  if (mode === 'correction') {
    tabCorrection.className = 'py-1.5 px-4 text-sm font-semibold rounded-lg transition-colors bg-accent text-white cursor-pointer';
    tabParent.className = 'py-1.5 px-4 text-sm font-semibold rounded-lg transition-colors bg-bg-primary text-gray-400 border border-border-primary cursor-pointer hover:text-accent hover:border-accent';
    outputTitle.textContent = 'Correction Analysis';
  } else {
    tabParent.className = 'py-1.5 px-4 text-sm font-semibold rounded-lg transition-colors bg-accent text-white cursor-pointer';
    tabCorrection.className = 'py-1.5 px-4 text-sm font-semibold rounded-lg transition-colors bg-bg-primary text-gray-400 border border-border-primary cursor-pointer hover:text-accent hover:border-accent';
    outputTitle.textContent = 'Parent Analysis';
  }

  // Load saved data for this mode
  const result = mode === 'correction' ? store.correction : store.parent;
  if (result) {
    currentTranscript = result.transcript;
    renderTranscript(result.transcript);
    renderAnalysis(result.analysisOutput);
    updateTranscriptInfo(result.playlistUrl);
  } else {
    renderAnalysis('');
  }
  updateRunBtn();
}

export function initSpeechAnalysis(): void {
  const transcribeBtn = document.getElementById('saTranscribeBtn') as HTMLButtonElement;
  const cancelBtn = document.getElementById('saCancelBtn') as HTMLButtonElement;
  const tabCorrection = document.getElementById('saTabCorrection') as HTMLButtonElement;
  const tabParent = document.getElementById('saTabParent') as HTMLButtonElement;
  const runAnalysisBtn = document.getElementById('saRunAnalysisBtn') as HTMLButtonElement;
  const cookiesSelect = document.getElementById('saCookiesBrowser') as HTMLSelectElement;
  const cookiesFileRow = document.getElementById('saCookiesFileRow') as HTMLSpanElement;
  const cookiesFileBtn = document.getElementById('saCookiesFileBtn') as HTMLButtonElement;
  const cookiesFileName = document.getElementById('saCookiesFileName') as HTMLSpanElement;

  // Show/hide cookies file picker based on dropdown
  cookiesSelect.addEventListener('change', () => {
    if (cookiesSelect.value === 'file') {
      cookiesFileRow.classList.remove('hidden');
      cookiesFileRow.classList.add('flex');
    } else {
      cookiesFileRow.classList.add('hidden');
      cookiesFileRow.classList.remove('flex');
      selectedCookiesFile = null;
      cookiesFileName.textContent = 'No file chosen';
    }
  });

  // Open native file picker
  cookiesFileBtn.addEventListener('click', async () => {
    const filePath = await window.api.pickCookiesFile();
    if (filePath) {
      selectedCookiesFile = filePath;
      cookiesFileName.textContent = filePath.split('/').pop() || filePath;
    }
  });

  // Register on-navigate callback
  registerOnNavigate('speech-analysis', () => {
    loadSavedData();
  });

  // Tab switching
  tabCorrection.addEventListener('click', () => setMode('correction'));
  tabParent.addEventListener('click', () => setMode('parent'));

  // Transcribe playlist
  transcribeBtn.addEventListener('click', async () => {
    const urlInput = document.getElementById('saPlaylistUrl') as HTMLInputElement;
    const progressEl = document.getElementById('saProgress') as HTMLDivElement;
    const progressText = document.getElementById('saProgressText') as HTMLSpanElement;

    const playlistUrl = urlInput.value.trim();
    if (!playlistUrl) return;

    isTranscribing = true;
    transcribeBtn.disabled = true;
    cancelBtn.classList.remove('hidden');
    progressEl.classList.remove('hidden');
    progressText.textContent = 'Fetching playlist info...';

    try {
      const rawCookies = (document.getElementById('saCookiesBrowser') as HTMLSelectElement).value;
      const cookiesBrowser = (rawCookies && rawCookies !== 'file') ? rawCookies : undefined;
      const cookiesFile = (rawCookies === 'file' && selectedCookiesFile) ? selectedCookiesFile : undefined;
      const res = await window.api.speechAnalysisTranscribe({ playlistUrl, cookiesBrowser, cookiesFile });

      if (res.success) {
        const transcript = res.transcript || '';
        if (!transcript.trim()) {
          progressText.textContent = 'Transcription finished but no text was extracted. Are the videos unlisted? Try selecting browser cookies for auth.';
          return;
        }

        currentTranscript = transcript;
        renderTranscript(transcript);
        updateTranscriptInfo(playlistUrl);
        progressText.textContent = 'Transcription complete!';

        // Save transcript for current mode
        const result: SpeechAnalysisResult = {
          transcript,
          analysisOutput: '',
          generatedAt: new Date().toISOString(),
          playlistUrl,
        };

        const existing = currentMode === 'correction' ? store.correction : store.parent;
        if (existing) {
          result.analysisOutput = existing.analysisOutput;
        }

        if (currentMode === 'correction') {
          store.correction = result;
        } else {
          store.parent = result;
        }
        await window.api.saveSpeechAnalysis(store);
      } else if (res.error === 'cancelled') {
        progressText.textContent = 'Cancelled';
      } else {
        progressText.textContent = `Error: ${res.error}`;
      }
    } catch (err) {
      progressText.textContent = `Error: ${(err as Error).message}`;
    } finally {
      isTranscribing = false;
      transcribeBtn.disabled = false;
      cancelBtn.classList.add('hidden');
      updateRunBtn();
      // Only auto-hide progress on success; keep errors visible
      if (currentTranscript) {
        setTimeout(() => {
          progressEl.classList.add('hidden');
        }, 3000);
      }
    }
  });

  // Cancel
  cancelBtn.addEventListener('click', () => {
    window.api.cancelSpeechAnalysis();
  });

  // Progress listener
  window.api.onSpeechAnalysisProgress((progress: SpeechAnalysisProgress) => {
    const progressText = document.getElementById('saProgressText') as HTMLSpanElement;
    if (progressText) {
      progressText.textContent = progress.message;
    }
  });

  // Run analysis prompt
  runAnalysisBtn.addEventListener('click', async () => {
    if (!currentTranscript || isAnalyzing) return;

    isAnalyzing = true;
    runAnalysisBtn.disabled = true;
    const analysisProgress = document.getElementById('saAnalysisProgress') as HTMLDivElement;
    const analysisProgressText = document.getElementById('saAnalysisProgressText') as HTMLSpanElement;
    analysisProgress.classList.remove('hidden');
    analysisProgressText.textContent = `Running ${currentMode} analysis...`;

    try {
      const res = await window.api.speechAnalysisRunPrompt({
        transcript: currentTranscript,
        mode: currentMode,
      });

      if (res.success && res.output) {
        renderAnalysis(res.output);

        const playlistUrl = (currentMode === 'correction' ? store.correction?.playlistUrl : store.parent?.playlistUrl) || '';
        const result: SpeechAnalysisResult = {
          transcript: currentTranscript,
          analysisOutput: res.output,
          generatedAt: new Date().toISOString(),
          playlistUrl,
        };
        if (currentMode === 'correction') {
          store.correction = result;
        } else {
          store.parent = result;
        }
        await window.api.saveSpeechAnalysis(store);
      } else {
        renderAnalysis(`Error: ${res.error}`);
      }
    } catch (err) {
      renderAnalysis(`Error: ${(err as Error).message}`);
    } finally {
      isAnalyzing = false;
      runAnalysisBtn.disabled = !currentTranscript;
      analysisProgress.classList.add('hidden');
    }
  });
}
