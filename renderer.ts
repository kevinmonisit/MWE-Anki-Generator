interface Subtitle {
  start: number;
  end: number;
  text: string;
}

interface AnkiConnectResponse {
  result: unknown;
  error: string | null;
}

let subtitles: Subtitle[] = [];
let currentActiveIndex = -1;
let currentFolder: string | null = null;
let currentVideoTitle = '';
let currentAnchorIndex = -1;
let sidebarView: 'videos' | 'cards' = 'videos';
let ankiConnected = false;
let ankiDecks: string[] = [];
let selectedAnkiDeck = '';
let selectedChunkingDeck = '';

async function loadCards(folder: string): Promise<Card[]> {
  return window.api.loadCards(folder);
}

async function saveCards(folder: string, cards: Card[]): Promise<void> {
  await window.api.saveCards(folder, cards);
}

const urlInput = document.getElementById('urlInput') as HTMLInputElement;
const downloadBtn = document.getElementById('downloadBtn') as HTMLButtonElement;
const progressEl = document.getElementById('progress') as HTMLDivElement;
const welcomeEl = document.getElementById('welcome') as HTMLDivElement;
const contentEl = document.getElementById('content') as HTMLDivElement;
const videoPlayer = document.getElementById('videoPlayer') as HTMLVideoElement;
const transcriptList = document.getElementById('transcriptList') as HTMLDivElement;
const sidebarList = document.getElementById('sidebarList') as HTMLDivElement;

// Listen for progress messages from main process
window.api.onDownloadProgress((message: string) => {
  progressEl.classList.add('visible');

  const stepMatch = message.match(/^STEP:(\d+):(\d+):(.+)$/);
  const doneMatch = message.match(/^STEP:DONE$/);

  if (stepMatch) {
    const currentStep = parseInt(stepMatch[1]);
    updatePipeline(currentStep);
  } else if (doneMatch) {
    updatePipeline(5);
  }
});

function updatePipeline(currentStep: number): void {
  const steps = document.querySelectorAll('.pipeline-step');
  const arrows = document.querySelectorAll('.pipeline-arrow');

  steps.forEach((el) => {
    const htmlEl = el as HTMLElement;
    const step = parseInt(htmlEl.dataset.step || '0');
    const icon = htmlEl.querySelector('.step-icon') as HTMLElement;

    htmlEl.classList.remove('active', 'done');
    icon.className = 'step-icon';

    if (step < currentStep) {
      htmlEl.classList.add('done');
      icon.innerHTML = '';
      icon.classList.add('checkmark');
    } else if (step === currentStep) {
      htmlEl.classList.add('active');
      icon.innerHTML = '<span class="spinner"></span>';
    } else {
      icon.innerHTML = '';
    }
  });

  arrows.forEach((arrow, i) => {
    arrow.classList.remove('done', 'active');
    const afterStep = i + 1;
    if (afterStep < currentStep) arrow.classList.add('done');
    else if (afterStep === currentStep) arrow.classList.add('active');
  });
}

function resetPipeline(): void {
  const steps = document.querySelectorAll('.pipeline-step');
  const arrows = document.querySelectorAll('.pipeline-arrow');
  steps.forEach(el => {
    el.classList.remove('active', 'done');
    const icon = el.querySelector('.step-icon') as HTMLElement;
    icon.className = 'step-icon';
    icon.innerHTML = '';
  });
  arrows.forEach(a => a.classList.remove('done', 'active'));
}

// Enter key triggers download
urlInput.addEventListener('keydown', (e: KeyboardEvent) => {
  if (e.key === 'Enter') startDownload();
});

// Space bar toggles video play/pause (unless an input/button/select has focus)
document.addEventListener('keydown', (e: KeyboardEvent) => {
  if (e.code !== 'Space') return;
  const tag = (document.activeElement?.tagName ?? '').toLowerCase();
  if (['input', 'textarea', 'button', 'select'].includes(tag)) return;
  if (videoPlayer.src) {
    e.preventDefault();
    videoPlayer.paused ? videoPlayer.play() : videoPlayer.pause();
  }
});

const sidebarHeader = document.querySelector('#sidebar > div:first-child') as HTMLDivElement;

// Load sidebar on startup
refreshSidebar();

async function refreshSidebar(): Promise<void> {
  if (sidebarView === 'cards' && currentFolder) {
    renderCardsView(currentFolder, currentVideoTitle);
    return;
  }

  // Restore header to default
  sidebarHeader.innerHTML = 'Downloaded Videos';

  const videos = await window.api.listDownloads();
  sidebarList.innerHTML = '';

  if (videos.length === 0) {
    sidebarList.innerHTML = '<div class="py-6 px-4 text-gray-600 text-[13px] text-center">No videos yet</div>';
    return;
  }

  for (const video of videos) {
    const item = document.createElement('div');
    item.className = 'sidebar-item group py-2.5 px-4 cursor-pointer transition-colors duration-150 border-l-[3px] border-l-transparent flex items-center gap-2 hover:bg-accent/10'
      + (video.folder === currentFolder ? ' active' : '');
    item.innerHTML = `
      <span class="sidebar-item-title flex-1 text-[13px] leading-snug text-gray-400 overflow-hidden text-ellipsis line-clamp-2">${escapeHtml(video.title)}</span>
      <button class="opacity-0 group-hover:opacity-100 bg-transparent border-none text-gray-500 text-base cursor-pointer py-0.5 px-1.5 rounded transition-all duration-150 hover:text-accent shrink-0" title="Delete">&times;</button>
    `;

    (item.querySelector('.sidebar-item-title') as HTMLElement).addEventListener('click', () => {
      selectVideo({ ...video, title: video.title });
    });

    (item.querySelector('button') as HTMLElement).addEventListener('click', async (e: Event) => {
      e.stopPropagation();
      if (confirm(`Delete "${video.title}"?`)) {
        await window.api.deleteDownload(video.folder);
        if (currentFolder === video.folder) {
          currentFolder = null;
          sidebarView = 'videos';
          contentEl.classList.remove('visible');
          welcomeEl.style.display = '';
        }
        refreshSidebar();
      }
    });

    sidebarList.appendChild(item);
  }
}

async function renderCardsView(folder: string, title: string): Promise<void> {
  // Update header with Go Back button + video title only
  sidebarHeader.innerHTML = `
    <button id="goBackBtn" class="bg-transparent border-none text-gray-400 cursor-pointer text-sm hover:text-accent transition-colors shrink-0" title="Go back">&larr;</button>
    <span class="flex-1 text-sm leading-snug break-words min-w-0">${escapeHtml(title)}</span>
  `;
  sidebarHeader.classList.add('flex', 'items-start', 'gap-2');

  document.getElementById('goBackBtn')!.addEventListener('click', () => {
    sidebarView = 'videos';
    sidebarHeader.classList.remove('flex', 'items-start', 'gap-2');
    refreshSidebar();
  });

  const cards = await loadCards(folder);
  const unexported = cards.filter(c => !c.exported);
  const canExport = ankiConnected && !!selectedAnkiDeck && unexported.length > 0;

  // Build a status hint for why export is disabled
  let exportHint = '';
  if (!ankiConnected) exportHint = 'Anki not connected';
  else if (!selectedAnkiDeck) exportHint = 'Select a deck above';
  else if (unexported.length === 0 && cards.length > 0) exportHint = 'All exported';

  // Render sidebarList: export row + cards
  sidebarList.innerHTML = '';

  // Export button row (below title, above cards)
  const exportRow = document.createElement('div');
  exportRow.className = 'px-4 py-2 border-b border-border-primary flex items-center gap-2';
  exportRow.innerHTML = `
    <button id="exportCardsBtn" class="py-1 px-3 border-none rounded-md bg-accent text-white text-xs font-semibold cursor-pointer transition-colors hover:bg-accent-hover disabled:bg-gray-700 disabled:cursor-not-allowed" ${canExport ? '' : 'disabled'}>Export Cards</button>
    ${exportHint ? `<span class="text-[10px] text-gray-600 italic">${escapeHtml(exportHint)}</span>` : ''}
  `;
  sidebarList.appendChild(exportRow);

  document.getElementById('exportCardsBtn')!.addEventListener('click', () => exportCards(folder, title));

  if (cards.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'py-6 px-4 text-gray-600 text-[13px] text-center';
    empty.textContent = 'No cards yet';
    sidebarList.appendChild(empty);
    return;
  }

  const chunkingEnabled = !!selectedChunkingDeck;

  // Table header
  const headerRow = document.createElement('div');
  headerRow.className = 'flex items-center px-4 py-1 border-b border-border-primary';
  headerRow.innerHTML = `
    <span class="w-8 shrink-0 text-center text-[8px] uppercase tracking-wider text-gray-700 font-medium">C</span>
    <span class="w-px h-3 bg-border-primary mx-4 shrink-0"></span>
    <span class="flex-1 min-w-0 text-[8px] uppercase tracking-wider text-gray-700 font-medium">Card</span>
  `;
  sidebarList.appendChild(headerRow);

  for (const card of cards) {
    const isExported = !!card.exported;
    const item = document.createElement('div');
    item.className = 'group py-2 px-4 cursor-pointer transition-colors duration-150 hover:bg-accent/10'
      + (isExported ? ' bg-green-900/20 border-l-[3px] border-l-green-500/60' : ' border-l-[3px] border-l-transparent');
    item.innerHTML = `
      <div class="flex items-center">
        <label class="w-8 shrink-0 flex items-center justify-center cursor-pointer" title="${!chunkingEnabled ? 'Select a chunking deck to enable' : isExported ? 'Already exported' : 'Send cloze card to chunking deck'}">
          <input type="checkbox" class="chunking-cb accent-yellow-500 w-3 h-3 cursor-pointer" ${card.chunking ? 'checked' : ''} ${(!chunkingEnabled || isExported) ? 'disabled' : ''}>
        </label>
        <span class="w-px self-stretch bg-border-primary mx-4 shrink-0"></span>
        <div class="card-content flex-1 min-w-0">
          <div class="text-[13px] font-medium overflow-hidden text-ellipsis whitespace-nowrap ${isExported ? 'text-green-400' : 'text-gray-300'}">${escapeHtml(card.selectedText)}</div>
          <div class="text-[11px] text-gray-600 overflow-hidden text-ellipsis whitespace-nowrap mt-0.5">${escapeHtml(card.expression)}</div>
        </div>
        <button class="opacity-0 group-hover:opacity-100 bg-transparent border-none text-gray-500 text-base cursor-pointer py-0.5 px-1.5 rounded transition-all duration-150 hover:text-accent w-6 shrink-0" title="Delete card">&times;</button>
      </div>
    `;

    // Cloze hint row (shown when chunking is enabled) — sits below the sentence, aligned with content
    if (card.chunking) {
      const contentDiv = item.querySelector('.card-content') as HTMLDivElement;
      const hintRow = document.createElement('div');
      hintRow.className = 'flex items-center gap-1.5 mt-1';
      hintRow.innerHTML = `
        <span class="text-[10px] text-gray-600 shrink-0">Hint:</span>
        <input type="text" class="cloze-hint-input flex-1 bg-bg-primary border border-border-primary rounded text-[11px] text-gray-300 py-0.5 px-1.5 outline-none transition-colors focus:border-accent" value="${escapeHtml(card.clozeHint || '')}" placeholder="loading...">
      `;
      contentDiv.appendChild(hintRow);

      const hintInput = hintRow.querySelector('.cloze-hint-input') as HTMLInputElement;

      // If no hint yet, fetch one
      if (!card.clozeHint) {
        hintInput.disabled = true;
        window.api.getClozeHint({
          selectedText: card.selectedText,
          fullSentence: card.expression,
          translation: card.translation || '',
        }).then(async (res) => {
          const hint = res.success && res.hint ? res.hint : card.translation || '';
          hintInput.value = hint;
          hintInput.disabled = false;
          // Save the auto-generated hint
          const allCards = await loadCards(folder);
          const target = allCards.find(c => c.id === card.id);
          if (target) {
            target.clozeHint = hint;
            await saveCards(folder, allCards);
          }
        });
      }

      // Save on edit
      let hintDebounce: ReturnType<typeof setTimeout>;
      hintInput.addEventListener('input', () => {
        clearTimeout(hintDebounce);
        hintDebounce = setTimeout(async () => {
          const allCards = await loadCards(folder);
          const target = allCards.find(c => c.id === card.id);
          if (target) {
            target.clozeHint = hintInput.value;
            await saveCards(folder, allCards);
          }
        }, 400);
      });

      // Prevent card modal from opening when clicking input
      hintInput.addEventListener('click', (e: Event) => e.stopPropagation());
    }

    // Chunking checkbox toggle
    const cb = item.querySelector('.chunking-cb') as HTMLInputElement;
    cb.addEventListener('change', async (e: Event) => {
      e.stopPropagation();
      const allCards = await loadCards(folder);
      const target = allCards.find(c => c.id === card.id);
      if (target) {
        target.chunking = cb.checked;
        if (!cb.checked) {
          target.clozeHint = undefined;
        }
        await saveCards(folder, allCards);
        renderCardsView(folder, title);
      }
    });

    // Prevent checkbox click from opening modal
    (item.querySelector('label') as HTMLElement).addEventListener('click', (e: Event) => {
      e.stopPropagation();
    });

    item.querySelector('.card-content')!.addEventListener('click', () => {
      openCardModal(card);
    });

    (item.querySelector('button') as HTMLElement).addEventListener('click', async (e: Event) => {
      e.stopPropagation();
      const updatedCards = (await loadCards(folder)).filter(c => c.id !== card.id);
      await saveCards(folder, updatedCards);
      renderCardsView(folder, title);
    });

    sidebarList.appendChild(item);
  }
}

async function exportCards(folder: string, title: string): Promise<void> {
  const cards = await loadCards(folder);
  const unexported = cards.filter(c => !c.exported);

  if (unexported.length === 0 || !selectedAnkiDeck || !currentFolder) return;

  const exportBtn = document.getElementById('exportCardsBtn') as HTMLButtonElement;
  exportBtn.disabled = true;
  exportBtn.textContent = 'Exporting...';

  const videoFolder = cards[0].source ? folder : folder;
  const videoDir = await window.api.getDownloadPath(videoFolder);

  const result = await window.api.exportCardsToAnki({
    videoDir,
    cards: unexported,
    deckName: selectedAnkiDeck,
    chunkingDeckName: selectedChunkingDeck,
    videoTitle: title,
  });

  // Mark successfully exported cards
  const allCards = await loadCards(folder);
  for (const r of result.results) {
    if (r.success) {
      const card = allCards.find(c => c.id === r.cardId);
      if (card) card.exported = true;
    }
  }
  await saveCards(folder, allCards);

  const successCount = result.results.filter(r => r.success).length;
  exportBtn.textContent = `${successCount}/${unexported.length} exported`;
  setTimeout(() => {
    exportBtn.textContent = 'Export';
    exportBtn.disabled = false;
    renderCardsView(folder, title);
  }, 2000);
}

function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

let cachedLemmaAnalyzedAt: string | null = null;

async function selectVideo(video: { folder: string; videoPath: string; srtPath: string; title?: string }): Promise<void> {
  currentFolder = video.folder;
  currentVideoTitle = video.title || video.folder;
  cachedTranscriptLemmas = null;
  cachedLemmaAnalyzedAt = null;
  sidebarView = 'cards';
  refreshSidebar();
  loadVideo(video.videoPath, video.srtPath);
  loadMWEsForFolder(video.folder);

  // Load previously saved lemma analysis for this video
  const saved = await window.api.loadTranscriptLemmas(video.folder);
  if (saved.success && saved.lemmas) {
    cachedTranscriptLemmas = saved.lemmas;
    cachedLemmaAnalyzedAt = saved.analyzedAt || null;
    if (mweView === 'lemmas') renderTranscriptLemmas(saved.lemmas);
  }
}

let isDownloading = false;

async function startDownload(): Promise<void> {
  // Cancel if already downloading
  if (isDownloading) {
    downloadBtn.disabled = true;
    downloadBtn.textContent = 'Cancelling...';
    await window.api.cancelDownload();
    return;
  }

  const url = urlInput.value.trim();
  if (!url) return;

  isDownloading = true;
  downloadBtn.textContent = 'Cancel';
  resetPipeline();
  progressEl.classList.add('visible');

  const result = await window.api.downloadVideo(url);

  isDownloading = false;
  downloadBtn.disabled = false;

  if (result.success) {
    updatePipeline(5);
    currentFolder = result.folder!;
    await refreshSidebar();
    loadVideo(result.videoPath!, result.srtPath!);
    downloadBtn.textContent = 'Download';
    setTimeout(() => progressEl.classList.remove('visible'), 2000);
  } else if (result.error === 'cancelled') {
    resetPipeline();
    progressEl.classList.remove('visible');
    downloadBtn.textContent = 'Download';
  } else {
    resetPipeline();
    progressEl.innerHTML = `<div class="text-accent">Error: ${escapeHtml(result.error!)}</div>`;
    downloadBtn.textContent = 'Download';
  }
}

async function loadVideo(videoPath: string, srtPath: string): Promise<void> {
  videoPlayer.removeEventListener('timeupdate', syncTranscript);

  videoPlayer.src = `file://${videoPath}`;
  videoPlayer.load();

  try {
    const srtText = await window.api.readFile(srtPath);
    subtitles = parseSRT(srtText);
    currentActiveIndex = -1;
    renderTranscript();
    welcomeEl.style.display = 'none';
    contentEl.classList.add('visible');
    progressEl.classList.remove('visible');

    videoPlayer.addEventListener('timeupdate', syncTranscript);
  } catch (err) {
    console.error('Failed to load SRT:', err);
    progressEl.textContent = 'Warning: Could not load subtitles.';
    subtitles = [];
    currentActiveIndex = -1;
    renderTranscript();
    welcomeEl.style.display = 'none';
    contentEl.classList.add('visible');
  }
}

function parseSRT(text: string): Subtitle[] {
  const entries: Subtitle[] = [];
  const blocks = text.trim().split(/\n\s*\n/);

  for (const block of blocks) {
    const lines = block.trim().split('\n');
    if (lines.length < 3) continue;

    const timeMatch = lines[1].match(
      /(\d{2}):(\d{2}):(\d{2})[,.](\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2})[,.](\d{3})/
    );
    if (!timeMatch) continue;

    const start = +timeMatch[1]*3600 + +timeMatch[2]*60 + +timeMatch[3] + +timeMatch[4]/1000;
    const end = +timeMatch[5]*3600 + +timeMatch[6]*60 + +timeMatch[7] + +timeMatch[8]/1000;
    const subtitleText = lines.slice(2).join(' ').replace(/<[^>]*>/g, '').trim();

    if (subtitleText) {
      entries.push({ start, end, text: subtitleText });
    }
  }

  return entries;
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function renderTranscript(): void {
  transcriptList.innerHTML = '';

  subtitles.forEach((sub, i) => {
    const entry = document.createElement('div');
    entry.className = 'transcript-entry flex gap-3 py-1.5 px-4 cursor-pointer transition-colors duration-150 border-l-[3px] border-l-transparent hover:bg-accent/10';
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

function syncTranscript(): void {
  const time = videoPlayer.currentTime;

  let activeIndex = -1;
  for (let i = 0; i < subtitles.length; i++) {
    if (time >= subtitles[i].start && time < subtitles[i].end) {
      activeIndex = i;
      break;
    }
  }

  if (activeIndex === currentActiveIndex) return;
  currentActiveIndex = activeIndex;

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

// --- AnkiConnect integration ---

const ankiDot = document.getElementById('ankiDot') as HTMLElement;
const ankiStatusText = document.getElementById('ankiStatusText') as HTMLElement;
const ankiDeckSelect = document.getElementById('ankiDeckSelect') as HTMLSelectElement;
const ankiChunkingDeckSelect = document.getElementById('ankiChunkingDeckSelect') as HTMLSelectElement;

// Load saved deck selections on startup
(async () => {
  try {
    const settings = await window.api.loadSettings();
    selectedAnkiDeck = settings.selectedDeck || '';
    selectedChunkingDeck = settings.chunkingDeck || '';
    if (settings.userLevel) {
      const levelEl = document.getElementById('userLevelSelect') as HTMLSelectElement | null;
      if (levelEl) levelEl.value = settings.userLevel;
    }
  } catch { /* ignore */ }
})();

async function checkAnkiConnection(): Promise<void> {
  try {
    const res: AnkiConnectResponse = await window.api.ankiInvoke('version');
    if (res.error === null) {
      ankiConnected = true;
      ankiDot.className = 'anki-dot w-2 h-2 rounded-full transition-colors duration-300 connected';
      ankiStatusText.textContent = `Anki connected (v${res.result})`;
      ankiDeckSelect.disabled = false;
      ankiChunkingDeckSelect.disabled = false;
      await fetchAnkiDecks();
    } else {
      setAnkiDisconnected();
    }
  } catch {
    setAnkiDisconnected();
  }
}

function setAnkiDisconnected(): void {
  ankiConnected = false;
  ankiDecks = [];
  selectedAnkiDeck = '';
  selectedChunkingDeck = '';
  ankiDot.className = 'anki-dot w-2 h-2 rounded-full transition-colors duration-300 disconnected';
  ankiStatusText.textContent = 'Anki not connected';
  ankiDeckSelect.disabled = true;
  ankiDeckSelect.innerHTML = '<option value="">Select deck...</option>';
  ankiChunkingDeckSelect.disabled = true;
  ankiChunkingDeckSelect.innerHTML = '<option value="">Select deck...</option>';
}

async function fetchAnkiDecks(): Promise<void> {
  try {
    const res: AnkiConnectResponse = await window.api.ankiInvoke('deckNames');
    if (res.error === null && Array.isArray(res.result)) {
      ankiDecks = res.result as string[];
      renderAnkiDecks();
    }
  } catch {
    ankiDecks = [];
  }
}

function renderAnkiDecks(): void {
  // Populate vocab deck dropdown
  const prev = selectedAnkiDeck;
  ankiDeckSelect.innerHTML = '<option value="">Select deck...</option>';
  for (const deck of ankiDecks) {
    const opt = document.createElement('option');
    opt.value = deck;
    opt.textContent = deck;
    if (deck === prev) opt.selected = true;
    ankiDeckSelect.appendChild(opt);
  }
  if (prev && ankiDecks.includes(prev)) {
    selectedAnkiDeck = prev;
  }

  // Populate chunking deck dropdown
  const prevChunking = selectedChunkingDeck;
  ankiChunkingDeckSelect.innerHTML = '<option value="">Select deck...</option>';
  for (const deck of ankiDecks) {
    const opt = document.createElement('option');
    opt.value = deck;
    opt.textContent = deck;
    if (deck === prevChunking) opt.selected = true;
    ankiChunkingDeckSelect.appendChild(opt);
  }
  if (prevChunking && ankiDecks.includes(prevChunking)) {
    selectedChunkingDeck = prevChunking;
  }
}

function persistDeckSettings(): void {
  window.api.saveSettings({ selectedDeck: selectedAnkiDeck, chunkingDeck: selectedChunkingDeck, userLevel: userLevelSelect.value });
}

ankiDeckSelect.addEventListener('change', () => {
  selectedAnkiDeck = ankiDeckSelect.value;
  persistDeckSettings();
  // Refresh cards view so Export button state updates immediately
  if (sidebarView === 'cards' && currentFolder) {
    renderCardsView(currentFolder, currentVideoTitle);
  }
});

ankiChunkingDeckSelect.addEventListener('change', () => {
  selectedChunkingDeck = ankiChunkingDeckSelect.value;
  persistDeckSettings();
  // Refresh cards view so chunking checkboxes update enabled/disabled state
  if (sidebarView === 'cards' && currentFolder) {
    renderCardsView(currentFolder, currentVideoTitle);
  }
});

// Check Anki on startup and poll every 5 seconds
checkAnkiConnection();
setInterval(checkAnkiConnection, 5000);

// --- API Cost Display ---
const apiCostDisplay = document.getElementById('apiCostDisplay') as HTMLSpanElement;
const apiCostResetBtn = document.getElementById('apiCostResetBtn') as HTMLButtonElement;

function updateCostDisplay(totalCost: number): void {
  apiCostDisplay.textContent = totalCost < 0.01
    ? `$${totalCost.toFixed(4)}`
    : `$${totalCost.toFixed(2)}`;
}

// Listen for real-time cost updates from main process
window.api.onApiCostUpdate((data) => {
  updateCostDisplay(data.totalCost);
});

// Load existing cost on startup
(async () => {
  try {
    const { totalCost } = await window.api.getApiCost();
    updateCostDisplay(totalCost);
  } catch { /* ignore */ }
})();

apiCostResetBtn.addEventListener('click', async () => {
  await window.api.resetApiCost();
  updateCostDisplay(0);
});

// --- Video / transcript resize handle ---

const videoSection = document.getElementById('videoSection') as HTMLDivElement;
const videoResizeHandle = document.getElementById('videoResizeHandle') as HTMLDivElement;
const contentEl2 = document.getElementById('content') as HTMLDivElement;

let isVideoResizing = false;
let videoResizeStartY = 0;
let videoResizeStartHeight = 0;

videoResizeHandle.addEventListener('mousedown', (e: MouseEvent) => {
  isVideoResizing = true;
  videoResizeStartY = e.clientY;
  videoResizeStartHeight = videoSection.offsetHeight;
  videoResizeHandle.classList.add('dragging');
  document.body.style.cursor = 'row-resize';
  document.body.style.userSelect = 'none';
  e.preventDefault();
});

// --- Sidebar resize handle ---

const sidebar = document.getElementById('sidebar') as HTMLDivElement;
const sidebarResizeHandle = document.getElementById('sidebarResizeHandle') as HTMLDivElement;

let isSidebarResizing = false;
let sidebarResizeStartX = 0;
let sidebarResizeStartWidth = 0;

sidebarResizeHandle.addEventListener('mousedown', (e: MouseEvent) => {
  isSidebarResizing = true;
  sidebarResizeStartX = e.clientX;
  sidebarResizeStartWidth = sidebar.offsetWidth;
  sidebarResizeHandle.classList.add('dragging');
  document.body.style.cursor = 'col-resize';
  document.body.style.userSelect = 'none';
  e.preventDefault();
});

// --- Explain panel resize handle ---

const explainPanel = document.getElementById('explainPanel') as HTMLDivElement;
const explainResizeHandle = document.getElementById('explainResizeHandle') as HTMLDivElement;

let isExplainResizing = false;
let explainResizeStartY = 0;
let explainResizeStartHeight = 0;

explainResizeHandle.addEventListener('mousedown', (e: MouseEvent) => {
  isExplainResizing = true;
  explainResizeStartY = e.clientY;
  explainResizeStartHeight = explainPanel.offsetHeight;
  explainResizeHandle.classList.add('dragging');
  document.body.style.cursor = 'row-resize';
  document.body.style.userSelect = 'none';
  e.preventDefault();
});

// --- Unified mousemove / mouseup for all resize handles ---

document.addEventListener('mousemove', (e: MouseEvent) => {
  if (isVideoResizing) {
    const delta = e.clientY - videoResizeStartY;
    const contentHeight = contentEl2.offsetHeight;
    const newHeight = Math.min(
      Math.max(videoResizeStartHeight + delta, 80),
      contentHeight - 80 - videoResizeHandle.offsetHeight
    );
    videoSection.style.height = `${newHeight}px`;
  }

  if (isSidebarResizing) {
    const delta = e.clientX - sidebarResizeStartX;
    const newWidth = Math.min(Math.max(sidebarResizeStartWidth + delta, 180), 400);
    sidebar.style.width = `${newWidth}px`;
  }

  if (isExplainResizing) {
    const delta = explainResizeStartY - e.clientY; // inverted: dragging up = larger
    const sidebarHeight = sidebar.offsetHeight;
    const maxHeight = sidebarHeight * 0.7;
    const newHeight = Math.min(Math.max(explainResizeStartHeight + delta, 100), maxHeight);
    explainPanel.style.height = `${newHeight}px`;
  }

  if (isMWEResizing) {
    const delta = mweResizeStartX - e.clientX; // inverted: dragging left = wider
    const newWidth = Math.min(Math.max(mweResizeStartWidth + delta, 180), 500);
    mwePanel.style.width = `${newWidth}px`;
  }
});

document.addEventListener('mouseup', () => {
  if (isVideoResizing) {
    isVideoResizing = false;
    videoResizeHandle.classList.remove('dragging');
  }
  if (isSidebarResizing) {
    isSidebarResizing = false;
    sidebarResizeHandle.classList.remove('dragging');
  }
  if (isExplainResizing) {
    isExplainResizing = false;
    explainResizeHandle.classList.remove('dragging');
  }
  if (isMWEResizing) {
    isMWEResizing = false;
    mweResizeHandle.classList.remove('dragging');
  }
  document.body.style.cursor = '';
  document.body.style.userSelect = '';
});

// --- Text selection → sidebar explain panel ---

let currentTranslation = '';
let currentExplanation = '';

const explainPanelText = document.getElementById('explainPanelText') as HTMLDivElement;
const explainPanelBtn = document.getElementById('explainPanelBtn') as HTMLButtonElement;
const explainPanelResult = document.getElementById('explainPanelResult') as HTMLDivElement;
const createCardBtn = document.getElementById('createCardBtn') as HTMLButtonElement;

let currentSelectedText = '';
let currentSelectionContext = { sentenceBefore: '', sentenceAfter: '' };

function findSubtitleIndexForNode(node: Node): number {
  let el: HTMLElement | null = node.nodeType === Node.TEXT_NODE ? node.parentElement : node as HTMLElement;
  while (el && !el.classList.contains('transcript-entry')) {
    el = el.parentElement;
  }
  if (!el) return -1;
  return parseInt(el.dataset.index || '-1');
}

// --- Inline selection popup ---
const selectionPopup = document.getElementById('selectionPopup') as HTMLDivElement;
const selectionExplainBtn = document.getElementById('selectionExplainBtn') as HTMLButtonElement;

function hideSelectionPopup(): void {
  selectionPopup.classList.add('hidden');
}

/**
 * Expand a selection so it snaps to whole-word boundaries.
 * A "word" here includes any adjacent punctuation (e.g. "¿Qué?" stays as one unit).
 */
function expandSelectionToWords(selection: Selection): void {
  if (!selection.rangeCount) return;

  const range = selection.getRangeAt(0);

  // Expand start to word boundary
  const startNode = range.startContainer;
  if (startNode.nodeType === Node.TEXT_NODE) {
    const text = startNode.textContent || '';
    let offset = range.startOffset;
    // Move backward past word chars and punctuation (skip spaces)
    while (offset > 0 && text[offset - 1] !== ' ') {
      offset--;
    }
    range.setStart(startNode, offset);
  }

  // Expand end to word boundary
  const endNode = range.endContainer;
  if (endNode.nodeType === Node.TEXT_NODE) {
    const text = endNode.textContent || '';
    let offset = range.endOffset;
    // Move forward past word chars and punctuation (skip spaces)
    while (offset < text.length && text[offset] !== ' ') {
      offset++;
    }
    range.setEnd(endNode, offset);
  }

  selection.removeAllRanges();
  selection.addRange(range);
}

transcriptList.addEventListener('mouseup', () => {
  setTimeout(() => {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed) { hideSelectionPopup(); return; }

    // Snap to whole words (including punctuation)
    expandSelectionToWords(selection);

    const selected = selection.toString().trim();
    if (!selected || selected.length < 2) { hideSelectionPopup(); return; }

    const anchorIndex = findSubtitleIndexForNode(selection.anchorNode!);
    if (anchorIndex < 0) { hideSelectionPopup(); return; }

    currentSelectedText = selected;
    currentAnchorIndex = anchorIndex;
    currentSelectionContext = {
      sentenceBefore: subtitles.slice(Math.max(0, anchorIndex - 6), anchorIndex).map(s => s.text).join(' '),
      sentenceAfter: subtitles.slice(anchorIndex + 1, Math.min(subtitles.length, anchorIndex + 7)).map(s => s.text).join(' '),
    };

    // Update sidebar panel
    explainPanelText.textContent = selected;
    explainPanelResult.innerHTML = '';
    explainPanelBtn.disabled = false;
    explainPanelBtn.textContent = 'Explain in English';
    createCardBtn.classList.add('hidden');

    // Position popup above the selection
    const range = selection.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    if (rect.width > 0) {
      selectionPopup.style.left = `${rect.left + rect.width / 2}px`;
      selectionPopup.style.top = `${rect.top - 8}px`;
      selectionPopup.classList.remove('hidden');
    }
  }, 10);
});

document.addEventListener('mousedown', (e) => {
  if (!selectionPopup.contains(e.target as Node)) hideSelectionPopup();
});

selectionExplainBtn.addEventListener('click', () => {
  hideSelectionPopup();
  window.getSelection()?.removeAllRanges();
  explainPanelBtn.click();
});

explainPanelBtn.addEventListener('click', async () => {
  if (!currentSelectedText) return;

  explainPanelBtn.disabled = true;
  explainPanelBtn.textContent = 'Explaining...';
  explainPanelResult.innerHTML = '<div class="flex items-center gap-1.5 text-xs text-gray-400"><span class="spinner"></span> Thinking...</div>';

  const fullSentence = currentAnchorIndex >= 0 ? subtitles[currentAnchorIndex].text : currentSelectedText;
  const result = await window.api.explainText({
    selectedText: currentSelectedText,
    fullSentence,
    sentenceBefore: currentSelectionContext.sentenceBefore,
    sentenceAfter: currentSelectionContext.sentenceAfter,
  });

  if (result.success && (result.translation || result.explanation)) {
    currentTranslation = result.translation || '';
    currentExplanation = result.explanation || '';
    explainPanelResult.innerHTML = `
      ${currentExplanation ? `<div class="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-0.5">Explanation</div><div class="text-xs text-gray-300 leading-relaxed">${escapeHtml(currentExplanation)}</div>` : ''}
      ${currentTranslation ? `<div class="text-xs font-semibold text-gray-400 uppercase tracking-wide mt-1 mb-0.5">Translation</div><div class="text-xs text-accent leading-relaxed">${escapeHtml(currentTranslation)}</div>` : ''}
    `;
    createCardBtn.classList.remove('hidden');
  } else {
    explainPanelResult.innerHTML = `<div class="text-accent text-xs">Error: ${escapeHtml(result.error || 'Unknown error')}</div>`;
  }

  explainPanelBtn.textContent = 'Explain in English';
  explainPanelBtn.disabled = false;
});

// --- Create Card button ---

createCardBtn.addEventListener('click', async () => {
  if (!currentFolder || currentAnchorIndex < 0) return;

  const sub = subtitles[currentAnchorIndex];

  const card: Card = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    expression: sub.text,
    meaning: currentExplanation,
    translation: currentTranslation,
    targetLineBefore: currentAnchorIndex > 0 ? subtitles[currentAnchorIndex - 1].text : '',
    targetLineAfter: currentAnchorIndex < subtitles.length - 1 ? subtitles[currentAnchorIndex + 1].text : '',
    selectedText: currentSelectedText,
    time: formatTime(sub.start),
    source: currentVideoTitle,
    startTime: sub.start,
    endTime: sub.end,
    createdAt: Date.now(),
  };

  const cards = await loadCards(currentFolder);
  cards.push(card);
  await saveCards(currentFolder, cards);

  // Visual confirmation
  createCardBtn.textContent = 'Saved!';
  createCardBtn.disabled = true;
  setTimeout(() => {
    createCardBtn.textContent = 'Create Card';
    createCardBtn.disabled = false;
  }, 1000);

  // Refresh cards view if active
  if (sidebarView === 'cards') {
    renderCardsView(currentFolder, currentVideoTitle);
  }
});

// --- MWE Panel ---

const mwePanel = document.getElementById('mwePanel') as HTMLDivElement;
const mweList = document.getElementById('mweList') as HTMLDivElement;
const extractMWEsBtn = document.getElementById('extractMWEsBtn') as HTMLButtonElement;
const mweProgress = document.getElementById('mweProgress') as HTMLDivElement;
const mweProgressText = document.getElementById('mweProgressText') as HTMLSpanElement;
const mweResizeHandle = document.getElementById('mweResizeHandle') as HTMLDivElement;
const mweTabCategories = document.getElementById('mweTabCategories') as HTMLButtonElement;
const mweTabList = document.getElementById('mweTabList') as HTMLButtonElement;

let isMWEResizing = false;
let mweView: 'categories' | 'list' | 'lemmas' = 'categories';
const mweTabLemmas = document.getElementById('mweTabLemmas') as HTMLButtonElement;
let cachedTranscriptLemmas: TranscriptLemma[] | null = null;
let lemmaFilter: 'all' | 'unknown' | 'known' = 'unknown';
let lemmaCefrFilter: string = 'all'; // 'all', 'A1', 'A2', 'B1', 'B2', 'C1', 'C2', 'none'
let isLemmaAnalyzing = false;
let lastMWEResults: MWEResult[] = [];
let selectedMWEs = new Set<string>();
let lastClickedMWEIndex = -1;
let knownSectionCollapsed = true;
let mweResizeStartX = 0;
let mweResizeStartWidth = 0;

mweResizeHandle.addEventListener('mousedown', (e: MouseEvent) => {
  isMWEResizing = true;
  mweResizeStartX = e.clientX;
  mweResizeStartWidth = mwePanel.offsetWidth;
  mweResizeHandle.classList.add('dragging');
  document.body.style.cursor = 'col-resize';
  document.body.style.userSelect = 'none';
  e.preventDefault();
});

const MWE_CATEGORY_COLORS: Record<string, string> = {
  // PARSEME verbal MWE categories
  VID: 'bg-green-800/60 text-green-300',
  'LVC.full': 'bg-purple-800/60 text-purple-300',
  'LVC.cause': 'bg-violet-800/60 text-violet-300',
  VPC: 'bg-sky-800/60 text-sky-300',
  IRV: 'bg-teal-800/60 text-teal-300',
  MVC: 'bg-blue-800/60 text-blue-300',
  // Extended categories
  mexicanismo: 'bg-red-800/60 text-red-300',
  marcador_discursivo: 'bg-pink-800/60 text-pink-300',
  locucion_adverbial: 'bg-yellow-800/60 text-yellow-300',
  locucion_prepositiva: 'bg-orange-800/60 text-orange-300',
  colocacion: 'bg-cyan-800/60 text-cyan-300',
  expresion_fija: 'bg-indigo-800/60 text-indigo-300',
};

const MWE_CATEGORY_LABELS: Record<string, string> = {
  VID: 'verbal idiom',
  'LVC.full': 'light verb (full)',
  'LVC.cause': 'light verb (cause)',
  VPC: 'verb-particle',
  IRV: 'inherently reflexive',
  MVC: 'multi-verb / periphrasis',
};

function getCategoryLabel(cat: string): string {
  return MWE_CATEGORY_LABELS[cat] || cat.replace(/_/g, ' ');
}

function renderMWEList(results: MWEResult[]): void {
  lastMWEResults = results;
  if (mweView === 'categories') {
    renderMWEByCategory(results);
  } else {
    renderMWEFlatList(results);
  }
}

function renderMWEByCategory(results: MWEResult[]): void {
  mweList.innerHTML = '';

  if (results.length === 0) {
    mweList.innerHTML = '<div class="py-6 px-3 text-gray-600 text-[12px] text-center">No MWEs found in this transcript.</div>';
    return;
  }

  // Group by category
  const byCategory = new Map<string, MWEResult[]>();
  for (const r of results) {
    for (const cat of r.categories) {
      if (!byCategory.has(cat)) byCategory.set(cat, []);
      byCategory.get(cat)!.push(r);
    }
  }

  // Deduplicate within categories by normalized_form
  for (const [cat, items] of byCategory) {
    const seen = new Set<string>();
    byCategory.set(cat, items.filter(item => {
      if (seen.has(item.normalized_form)) return false;
      seen.add(item.normalized_form);
      return true;
    }));
  }

  // Sort categories by count
  const sortedCategories = [...byCategory.entries()].sort((a, b) => b[1].length - a[1].length);

  for (const [category, items] of sortedCategories) {
    const colorClass = MWE_CATEGORY_COLORS[category] || 'bg-gray-700 text-gray-300';

    const section = document.createElement('div');
    section.className = 'mb-1';

    const header = document.createElement('div');
    header.className = 'py-1.5 px-3 text-[10px] uppercase tracking-wider text-gray-500 font-semibold flex items-center justify-between cursor-pointer hover:text-gray-400 transition-colors';
    header.innerHTML = `
      <span>${getCategoryLabel(category)}</span>
      <span class="text-[9px] ${colorClass} rounded px-1.5 py-0.5">${items.length}</span>
    `;

    const itemsContainer = document.createElement('div');
    itemsContainer.className = 'mwe-category-items';

    header.addEventListener('click', () => {
      itemsContainer.classList.toggle('hidden');
      header.querySelector('span:first-child')!.textContent =
        (itemsContainer.classList.contains('hidden') ? '▸ ' : '') + getCategoryLabel(category);
    });

    for (const item of items) {
      const row = document.createElement('div');
      row.className = 'py-1.5 px-3 hover:bg-accent/10 cursor-pointer transition-colors border-l-2 border-l-transparent hover:border-l-accent';
      row.innerHTML = `
        <div class="flex items-center gap-1.5">
          <span class="text-[12px] text-gray-200 font-medium">${escapeHtml(item.normalized_form)}</span>
          ${item.is_new ? '<span class="text-[8px] bg-green-800/60 text-green-300 rounded px-1 py-0.5 uppercase font-bold">new</span>' : ''}
        </div>
        ${item.surface_form !== item.normalized_form ? `<div class="text-[10px] text-gray-500 mt-0.5">${escapeHtml(item.surface_form)}</div>` : ''}
        ${item.context_note ? `<div class="text-[10px] text-gray-600 mt-0.5 italic">${escapeHtml(item.context_note)}</div>` : ''}
      `;

      row.addEventListener('click', () => {
        if (item.sentence_index >= 0 && item.sentence_index < subtitles.length) {
          videoPlayer.currentTime = subtitles[item.sentence_index].start;
          const entry = transcriptList.children[item.sentence_index] as HTMLElement;
          if (entry) entry.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      });

      itemsContainer.appendChild(row);
    }

    section.appendChild(header);
    section.appendChild(itemsContainer);
    mweList.appendChild(section);
  }

  // Summary at top
  const uniqueNormalized = new Set(results.map(r => r.normalized_form));
  const newCount = new Set(results.filter(r => r.is_new).map(r => r.normalized_form)).size;
  const summary = document.createElement('div');
  summary.className = 'py-2 px-3 text-[11px] text-gray-500 border-b border-border-primary';
  summary.textContent = `${uniqueNormalized.size} unique MWEs${newCount > 0 ? ` (${newCount} new)` : ''}`;
  mweList.insertBefore(summary, mweList.firstChild);
}

function renderMWEFlatList(results: MWEResult[]): void {
  mweList.innerHTML = '';

  if (results.length === 0) {
    mweList.innerHTML = '<div class="py-6 px-3 text-gray-600 text-[12px] text-center">No MWEs found in this transcript.</div>';
    return;
  }

  // Deduplicate by normalized_form, keeping first occurrence
  const seen = new Set<string>();
  const unique: MWEResult[] = [];
  for (const r of results) {
    if (!seen.has(r.normalized_form)) {
      seen.add(r.normalized_form);
      unique.push(r);
    }
  }

  // Split into unknown (top) and known (bottom), both sorted alphabetically
  const unknown = unique.filter(r => !r.is_known).sort((a, b) => a.normalized_form.localeCompare(b.normalized_form));
  const known = unique.filter(r => r.is_known).sort((a, b) => a.normalized_form.localeCompare(b.normalized_form));
  const displayList = [...unknown, ...known];

  // Clean stale selections
  const validForms = new Set(unique.map(r => r.normalized_form));
  for (const form of selectedMWEs) {
    if (!validForms.has(form)) selectedMWEs.delete(form);
  }

  const summary = document.createElement('div');
  summary.className = 'py-2 px-3 text-[11px] text-gray-500 border-b border-border-primary';
  summary.textContent = `${unique.length} unique MWEs${known.length > 0 ? ` · ${known.length} known` : ''}`;
  mweList.appendChild(summary);

  // Render unknown items
  for (let i = 0; i < unknown.length; i++) {
    mweList.appendChild(createMWEFlatRow(unknown[i], i, displayList));
  }

  // Render known section (collapsible)
  if (known.length > 0) {
    const knownHeader = document.createElement('div');
    knownHeader.className = 'py-1.5 px-3 text-[10px] uppercase tracking-wider text-gray-500 font-semibold flex items-center justify-between cursor-pointer hover:text-gray-400 transition-colors border-t border-border-primary mt-1';
    knownHeader.innerHTML = `<span>${knownSectionCollapsed ? '▸' : '▾'} Known (${known.length})</span>`;
    knownHeader.addEventListener('click', () => {
      knownSectionCollapsed = !knownSectionCollapsed;
      renderMWEFlatList(lastMWEResults);
    });
    mweList.appendChild(knownHeader);

    if (!knownSectionCollapsed) {
      for (let i = 0; i < known.length; i++) {
        mweList.appendChild(createMWEFlatRow(known[i], unknown.length + i, displayList));
      }
    }
  }

  // Action bar
  renderMWEActionBar();
}

function createMWEFlatRow(item: MWEResult, indexInDisplayList: number, displayList: MWEResult[]): HTMLElement {
  const isSelected = selectedMWEs.has(item.normalized_form);
  const row = document.createElement('div');
  const baseClass = 'py-1 px-3 cursor-pointer transition-colors border-l-2 select-none';
  const selectedClass = isSelected
    ? ' bg-accent/20 border-l-accent'
    : ' border-l-transparent hover:bg-accent/10 hover:border-l-accent';
  row.className = baseClass + selectedClass;

  const textColor = item.is_known ? 'text-gray-500' : 'text-gray-200';
  row.innerHTML = `
    <div class="flex items-center gap-1.5">
      <span class="text-[12px] ${textColor} font-medium">${escapeHtml(item.normalized_form)}</span>
      ${item.is_new ? '<span class="text-[8px] bg-green-800/60 text-green-300 rounded px-1 py-0.5 uppercase font-bold shrink-0">new</span>' : ''}
    </div>
  `;

  row.addEventListener('mousedown', (e: MouseEvent) => {
    if (e.shiftKey) e.preventDefault();
  });

  row.addEventListener('click', (e: MouseEvent) => {
    const form = item.normalized_form;

    if (e.shiftKey) {
      e.preventDefault();
      if (selectedMWEs.has(form)) {
        // Already selected: deselect it
        selectedMWEs.delete(form);
        lastClickedMWEIndex = selectedMWEs.size > 0 ? indexInDisplayList : -1;
      } else if (lastClickedMWEIndex >= 0 && lastClickedMWEIndex !== indexInDisplayList) {
        // Range select from anchor to current
        const start = Math.min(lastClickedMWEIndex, indexInDisplayList);
        const end = Math.max(lastClickedMWEIndex, indexInDisplayList);
        for (let j = start; j <= end; j++) {
          if (j < displayList.length) selectedMWEs.add(displayList[j].normalized_form);
        }
        lastClickedMWEIndex = indexInDisplayList;
      } else {
        // Select single item
        selectedMWEs.add(form);
        lastClickedMWEIndex = indexInDisplayList;
      }
      renderMWEFlatList(lastMWEResults);
    } else {
      // No shift: navigate to transcript position
      if (item.sentence_index >= 0 && item.sentence_index < subtitles.length) {
        videoPlayer.currentTime = subtitles[item.sentence_index].start;
        const entry = transcriptList.children[item.sentence_index] as HTMLElement;
        if (entry) entry.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }
  });

  return row;
}

function renderMWEActionBar(): void {
  // Remove existing action bar
  const existing = document.getElementById('mweActionBar');
  if (existing) existing.remove();

  if (selectedMWEs.size === 0) return;

  // Check if all selected are known
  const selectedResults = lastMWEResults.filter(r => selectedMWEs.has(r.normalized_form));
  const seenForms = new Set<string>();
  const uniqueSelected: MWEResult[] = [];
  for (const r of selectedResults) {
    if (!seenForms.has(r.normalized_form)) {
      seenForms.add(r.normalized_form);
      uniqueSelected.push(r);
    }
  }
  const allKnown = uniqueSelected.length > 0 && uniqueSelected.every(r => r.is_known);

  const bar = document.createElement('div');
  bar.id = 'mweActionBar';
  bar.className = 'absolute top-1 right-2 z-20 flex items-center gap-2 bg-bg-secondary border border-border-primary rounded-md px-2.5 py-1.5 shadow-lg';

  const label = document.createElement('span');
  label.className = 'text-[10px] text-gray-400';
  label.textContent = `${selectedMWEs.size}`;

  const btn = document.createElement('button');
  btn.className = 'text-[10px] px-2.5 py-0.5 rounded font-semibold cursor-pointer transition-colors ' +
    (allKnown
      ? 'bg-gray-700 text-gray-200 hover:bg-gray-600'
      : 'bg-accent text-white hover:bg-accent/80');
  btn.textContent = allKnown ? 'Mark unknown' : 'Mark known';

  btn.addEventListener('click', async () => {
    const forms = [...selectedMWEs];
    const markKnown = !allKnown;
    await window.api.markMWEsKnown({ normalizedForms: forms, known: markKnown });
    for (const r of lastMWEResults) {
      if (selectedMWEs.has(r.normalized_form)) {
        r.is_known = markKnown;
      }
    }
    selectedMWEs.clear();
    lastClickedMWEIndex = -1;
    renderMWEFlatList(lastMWEResults);
  });

  bar.appendChild(label);
  bar.appendChild(btn);
  // Append to mwePanel (the positioned parent) so it overlays above the scrollable list
  mwePanel.style.position = 'relative';
  mwePanel.appendChild(bar);
}

// ⌘D shortcut to toggle known/unknown on selected MWEs
document.addEventListener('keydown', async (e: KeyboardEvent) => {
  if (e.metaKey && e.key === 'd') {
    e.preventDefault();
    if (selectedMWEs.size === 0) return;

    const selectedResults = lastMWEResults.filter(r => selectedMWEs.has(r.normalized_form));
    const seenForms = new Set<string>();
    const uniqueSelected: MWEResult[] = [];
    for (const r of selectedResults) {
      if (!seenForms.has(r.normalized_form)) {
        seenForms.add(r.normalized_form);
        uniqueSelected.push(r);
      }
    }
    const allKnown = uniqueSelected.length > 0 && uniqueSelected.every(r => r.is_known);
    const markKnown = !allKnown;
    const forms = [...selectedMWEs];
    await window.api.markMWEsKnown({ normalizedForms: forms, known: markKnown });
    for (const r of lastMWEResults) {
      if (selectedMWEs.has(r.normalized_form)) {
        r.is_known = markKnown;
      }
    }
    selectedMWEs.clear();
    lastClickedMWEIndex = -1;
    renderMWEFlatList(lastMWEResults);
  }
});

const TAB_ACTIVE = 'flex-1 py-1.5 text-[11px] font-semibold text-accent border-b-2 border-accent bg-transparent cursor-pointer transition-colors';
const TAB_INACTIVE = 'flex-1 py-1.5 text-[11px] font-semibold text-gray-500 border-b-2 border-transparent bg-transparent cursor-pointer transition-colors hover:text-gray-300';

function setMWETabActive(active: 'categories' | 'list' | 'lemmas') {
  mweTabCategories.className = active === 'categories' ? TAB_ACTIVE : TAB_INACTIVE;
  mweTabList.className = active === 'list' ? TAB_ACTIVE : TAB_INACTIVE;
  mweTabLemmas.className = active === 'lemmas' ? TAB_ACTIVE : TAB_INACTIVE;
}

mweTabCategories.addEventListener('click', () => {
  mweView = 'categories';
  selectedMWEs.clear();
  lastClickedMWEIndex = -1;
  setMWETabActive('categories');
  if (lastMWEResults.length > 0) renderMWEByCategory(lastMWEResults);
});

mweTabList.addEventListener('click', () => {
  mweView = 'list';
  setMWETabActive('list');
  if (lastMWEResults.length > 0) renderMWEFlatList(lastMWEResults);
});

async function runLemmaAnalysis(): Promise<void> {
  if (!currentFolder) return;
  if (isLemmaAnalyzing) return;
  isLemmaAnalyzing = true;
  mweList.innerHTML = '<div class="py-6 px-3 text-gray-400 text-[12px] text-center flex items-center justify-center gap-2"><span class="spinner"></span> Analyzing transcript lemmas...</div>';

  try {
    const result = await window.api.analyzeTranscriptLemmas(currentFolder);
    if (result.success && result.lemmas) {
      cachedTranscriptLemmas = result.lemmas;
      cachedLemmaAnalyzedAt = result.analyzedAt || new Date().toISOString();
      if (mweView === 'lemmas') {
        renderTranscriptLemmas(result.lemmas);
      }
    } else {
      mweList.innerHTML = `<div class="py-6 px-3 text-red-400 text-[12px] text-center">${result.error || 'Failed to analyze'}</div>`;
    }
  } catch (err) {
    mweList.innerHTML = `<div class="py-6 px-3 text-red-400 text-[12px] text-center">Error: ${(err as Error).message}</div>`;
  } finally {
    isLemmaAnalyzing = false;
  }
}

mweTabLemmas.addEventListener('click', async () => {
  mweView = 'lemmas';
  setMWETabActive('lemmas');

  // Default CEFR filter to user's set level on first open
  if (lemmaCefrFilter === 'all') {
    lemmaCefrFilter = userLevelSelect.value || 'B1';
  }

  if (cachedTranscriptLemmas) {
    renderTranscriptLemmas(cachedTranscriptLemmas);
    return;
  }

  if (!currentFolder) {
    mweList.innerHTML = '<div class="py-6 px-3 text-gray-600 text-[12px] text-center">Select a video first.</div>';
    return;
  }

  await runLemmaAnalysis();
});

function renderTranscriptLemmas(allLemmas: TranscriptLemma[]): void {
  const knownCount = allLemmas.filter(l => l.is_known).length;
  const unknownCount = allLemmas.length - knownCount;

  // Apply known/unknown filter
  let filtered = lemmaFilter === 'all' ? [...allLemmas]
    : lemmaFilter === 'known' ? allLemmas.filter(l => l.is_known)
    : allLemmas.filter(l => !l.is_known);

  // Apply CEFR filter
  if (lemmaCefrFilter !== 'all') {
    if (lemmaCefrFilter === 'none') {
      filtered = filtered.filter(l => !l.cefr_level);
    } else {
      filtered = filtered.filter(l => l.cefr_level === lemmaCefrFilter);
    }
  }

  // CEFR ordering and proximity scoring
  const cefrOrder = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
  const cefrOrd = (l: TranscriptLemma) => {
    return l.cefr_level ? cefrOrder.indexOf(l.cefr_level) : cefrOrder.length;
  };
  if (lemmaFilter === 'unknown') {
    filtered.sort((a, b) => {
      const oneTDiff = (b.one_t_count || 0) - (a.one_t_count || 0);
      if (oneTDiff !== 0) return oneTDiff;
      const freqDiff = b.transcript_count - a.transcript_count;
      if (freqDiff !== 0) return freqDiff;
      return b.general_freq - a.general_freq;
    });
  } else if (lemmaFilter === 'all') {
    filtered.sort((a, b) => {
      if (a.is_known !== b.is_known) return a.is_known ? 1 : -1;
      const cefrDiff = cefrOrd(a) - cefrOrd(b);
      if (cefrDiff !== 0) return cefrDiff;
      return b.general_freq - a.general_freq;
    });
  }

  const posColors: Record<string, string> = {
    NOUN: 'text-blue-400',
    VERB: 'text-green-400',
    ADJ: 'text-yellow-400',
    ADV: 'text-purple-400',
  };

  const posLabels: Record<string, string> = {
    NOUN: 'n',
    VERB: 'v',
    ADJ: 'adj',
    ADV: 'adv',
  };

  const filterBtnClass = (f: string) => f === lemmaFilter
    ? 'px-2 py-0.5 rounded text-[10px] font-medium bg-white/10 text-white'
    : 'px-2 py-0.5 rounded text-[10px] font-medium text-gray-500 hover:text-gray-300 hover:bg-white/5';

  const cefrFilterBtnClass = (f: string) => f === lemmaCefrFilter
    ? 'px-1.5 py-0.5 rounded text-[9px] font-semibold bg-accent/20 text-accent border border-accent/30'
    : 'px-1.5 py-0.5 rounded text-[9px] font-medium text-gray-600 hover:text-gray-400 hover:bg-white/5 border border-transparent';

  // Count per CEFR level for the current filter view
  const baseLemmas = lemmaFilter === 'known' ? allLemmas.filter(l => l.is_known)
    : lemmaFilter === 'unknown' ? allLemmas.filter(l => !l.is_known)
    : allLemmas;
  const cefrCounts: Record<string, number> = { A1: 0, A2: 0, B1: 0, B2: 0, C1: 0, C2: 0, none: 0 };
  for (const l of baseLemmas) {
    if (l.cefr_level && cefrCounts[l.cefr_level] !== undefined) cefrCounts[l.cefr_level]++;
    else cefrCounts.none++;
  }

  let html = '';

  // Count known lemmas by source
  const knownByLevel = allLemmas.filter(l => l.is_known && l.known_source === 'level');
  const knownByDeck = allLemmas.filter(l => l.is_known && l.known_source === 'deck');

  // Known/Unknown filter bar
  html += `<div class="px-3 py-1.5 flex items-center gap-1 border-b border-border-primary bg-bg-primary/30">
    <button class="${filterBtnClass('unknown')}" data-lemma-filter="unknown">Unknown <span class="text-gray-500">${unknownCount}</span></button>
    <button class="${filterBtnClass('known')}" data-lemma-filter="known">Known <span class="text-gray-500">${knownCount}</span></button>
    <button class="${filterBtnClass('all')}" data-lemma-filter="all">All <span class="text-gray-500">${allLemmas.length}</span></button>
    <span class="ml-auto flex items-center gap-2">
      ${cachedLemmaAnalyzedAt ? `<span class="italic text-[10px] text-gray-600" title="Analyzed on ${new Date(cachedLemmaAnalyzedAt).toLocaleString()}">${new Date(cachedLemmaAnalyzedAt).toLocaleDateString()}</span>` : ''}
      <button id="lemmaReanalyzeBtn" class="text-[10px] text-gray-500 hover:text-gray-300 px-1.5 py-0.5 rounded hover:bg-white/5 transition-colors">re-analyze</button>
    </span>
  </div>`;

  // Comprehension percentage
  const comprehensionPct = allLemmas.length > 0 ? Math.round(knownCount / allLemmas.length * 100) : 0;
  const compColor = comprehensionPct >= 95 ? 'text-green-400'
    : comprehensionPct >= 90 ? 'text-yellow-400'
    : comprehensionPct >= 80 ? 'text-orange-400'
    : 'text-red-400';
  const compBgColor = comprehensionPct >= 95 ? 'bg-green-500'
    : comprehensionPct >= 90 ? 'bg-yellow-500'
    : comprehensionPct >= 80 ? 'bg-orange-500'
    : 'bg-red-500';
  const compLabel = comprehensionPct >= 95 ? 'Fluent comprehension'
    : comprehensionPct >= 90 ? 'Sweet spot — learn a few more words'
    : comprehensionPct >= 80 ? 'Challenging but possible'
    : 'Too many unknowns for comfortable reading';

  html += `<div class="px-3 py-2 border-b border-border-primary bg-bg-primary/20">
    <div class="flex items-center justify-between mb-1">
      <span class="text-[11px] ${compColor} font-semibold">${comprehensionPct}% comprehension</span>
      <span class="text-[10px] text-gray-500">${compLabel}</span>
    </div>
    <div class="w-full h-1.5 bg-white/5 rounded-full overflow-hidden">
      <div class="h-full ${compBgColor} rounded-full transition-all" style="width: ${comprehensionPct}%"></div>
    </div>
    <div class="flex items-center justify-between mt-1">
      <span class="text-[9px] text-gray-600">${knownCount} known / ${allLemmas.length} lemmas</span>
      <span class="text-[9px] text-gray-600 italic" title="Based on content word lemmas (nouns, verbs, adjectives, adverbs), not multi-word expressions">Based on lemmas, not MWEs</span>
    </div>
  </div>`;

  // CEFR level filter bar
  html += `<div class="px-3 py-1 flex items-center gap-1 border-b border-border-primary bg-bg-primary/20 flex-wrap">
    <button class="${cefrFilterBtnClass('all')}" data-cefr-filter="all">All</button>
    ${['A1', 'A2', 'B1', 'B2', 'C1', 'C2'].map(level =>
      `<button class="${cefrFilterBtnClass(level)}" data-cefr-filter="${level}">${level} <span class="text-gray-600">${cefrCounts[level]}</span></button>`
    ).join('')}
    <button class="${cefrFilterBtnClass('none')}" data-cefr-filter="none">? <span class="text-gray-600">${cefrCounts.none}</span></button>
  </div>`;

  // Legend
  html += `<div class="px-3 py-1 flex items-center justify-end gap-3 text-[10px] text-gray-600 border-b border-border-primary">
    <span class="flex items-center gap-1"><span class="font-mono text-amber-500/70">1T</span> = unlocks a sentence</span>
    <span class="flex items-center gap-1"><span class="font-mono text-gray-500">3x</span> = in transcript</span>
  </div>`;

  if (filtered.length === 0) {
    const msg = lemmaFilter === 'known'
      ? 'No known lemmas found in this transcript.'
      : lemmaCefrFilter !== 'all'
      ? `No ${lemmaCefrFilter === 'none' ? 'uncategorized' : lemmaCefrFilter} lemmas to show.`
      : 'You know all the content words in this transcript!';
    html += `<div class="py-6 px-3 text-gray-500 text-[12px] text-center">${msg}</div>`;
    mweList.innerHTML = html;
    attachLemmaFilterListeners();
    return;
  }

  // CEFR pill color mapping
  const cefrColors: Record<string, string> = {
    A1: 'bg-green-600/30 text-green-400',
    A2: 'bg-green-600/20 text-green-500',
    B1: 'bg-yellow-600/20 text-yellow-400',
    B2: 'bg-yellow-600/15 text-yellow-500',
    C1: 'bg-red-600/20 text-red-400',
    C2: 'bg-red-600/15 text-red-500',
  };

  // Helper to render a single lemma row
  // inGroupedView: true when inside Known view with section headers (skip redundant CEFR pill & checkmark)
  const renderLemmaRow = (lemma: TranscriptLemma, dimmed: boolean, inGroupedView = false) => {
    const posColor = posColors[lemma.pos] || 'text-gray-400';
    const posLabel = posLabels[lemma.pos] || lemma.pos.toLowerCase();
    const knownDim = dimmed ? ' opacity-50' : '';
    const cefrPill = (!inGroupedView && lemma.cefr_level)
      ? `<span class="text-[9px] px-1 py-px rounded ${cefrColors[lemma.cefr_level] || 'bg-gray-700 text-gray-400'} shrink-0">${lemma.cefr_level}</span>`
      : '';
    const checkmark = (!inGroupedView && lemma.is_known)
      ? '<span class="text-[9px] text-green-600 shrink-0">✓</span>'
      : '';
    const oneTBadge = (lemma.one_t_count || 0) > 0
      ? `<span class="text-[9px] font-mono text-amber-500/70 shrink-0" title="Learning this word unlocks ${lemma.one_t_count} fully-comprehensible sentence${lemma.one_t_count > 1 ? 's' : ''}">1T×${lemma.one_t_count}</span>`
      : '';

    return `<div class="px-3 py-1.5 hover:bg-bg-primary/50 transition-colors cursor-pointer lemma-entry${knownDim}" data-sentence-index="${lemma.first_sentence_index}">
      <div class="flex items-center justify-between gap-2">
        <div class="flex items-center gap-1.5 min-w-0">
          <span class="text-[13px] ${dimmed ? 'text-gray-500' : 'text-gray-200'} font-medium truncate">${lemma.lemma}</span>
          <span class="${posColor} text-[10px] font-mono shrink-0">${posLabel}</span>
          ${cefrPill}
          ${checkmark}
        </div>
        <div class="flex items-center gap-2 shrink-0">
          ${oneTBadge}
          <span class="text-[10px] text-gray-600" title="Times in transcript">${lemma.transcript_count}x</span>
        </div>
      </div>
    </div>`;
  };

  // Lemma list
  html += '<div class="divide-y divide-border-primary">';

  if (lemmaFilter === 'known') {
    // Group known words by source: level-inferred grouped by CEFR, then deck/vocab
    const cefrLevelOrder = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
    const levelGroups: Record<string, TranscriptLemma[]> = {};
    const deckGroup: TranscriptLemma[] = [];
    const uncategorizedGroup: TranscriptLemma[] = [];

    for (const lemma of filtered) {
      if (lemma.known_source === 'deck') {
        deckGroup.push(lemma);
      } else if (lemma.cefr_level && cefrLevelOrder.includes(lemma.cefr_level)) {
        if (!levelGroups[lemma.cefr_level]) levelGroups[lemma.cefr_level] = [];
        levelGroups[lemma.cefr_level].push(lemma);
      } else {
        uncategorizedGroup.push(lemma);
      }
    }

    // Render level-inferred groups
    for (const level of cefrLevelOrder) {
      const group = levelGroups[level];
      if (!group || group.length === 0) continue;
      const levelColor = cefrColors[level] || 'bg-gray-700 text-gray-400';
      html += `<div class="px-3 py-1.5 bg-bg-primary/80 border-b border-border-primary sticky top-0 z-10">
        <div class="flex items-center gap-2">
          <span class="text-[9px] px-1.5 py-0.5 rounded ${levelColor} font-semibold">${level}</span>
          <span class="text-[11px] text-gray-400">Presumed known at your level</span>
          <span class="text-[10px] text-gray-600 ml-auto">${group.length}</span>
        </div>
      </div>`;
      group.sort((a, b) => b.general_freq - a.general_freq);
      for (const lemma of group) {
        html += renderLemmaRow(lemma, false, true);
      }
    }

    // Render deck/vocab group
    if (deckGroup.length > 0) {
      html += `<div class="px-3 py-1.5 bg-bg-primary/80 border-b border-border-primary sticky top-0 z-10">
        <div class="flex items-center gap-2">
          <span class="text-[9px] px-1.5 py-0.5 rounded bg-blue-600/20 text-blue-400 font-semibold">Vocab</span>
          <span class="text-[11px] text-gray-400">From your imported decks</span>
          <span class="text-[10px] text-gray-600 ml-auto">${deckGroup.length}</span>
        </div>
      </div>`;
      deckGroup.sort((a, b) => b.general_freq - a.general_freq);
      for (const lemma of deckGroup) {
        html += renderLemmaRow(lemma, false, true);
      }
    }

    // Render uncategorized known
    if (uncategorizedGroup.length > 0) {
      html += `<div class="px-3 py-1.5 bg-bg-primary/80 border-b border-border-primary sticky top-0 z-10">
        <div class="flex items-center gap-2">
          <span class="text-[9px] px-1.5 py-0.5 rounded bg-gray-700 text-gray-400 font-semibold">?</span>
          <span class="text-[11px] text-gray-400">Other known words</span>
          <span class="text-[10px] text-gray-600 ml-auto">${uncategorizedGroup.length}</span>
        </div>
      </div>`;
      for (const lemma of uncategorizedGroup) {
        html += renderLemmaRow(lemma, false, true);
      }
    }
  } else {
    // Default flat list for Unknown and All views
    for (const lemma of filtered) {
      html += renderLemmaRow(lemma, lemma.is_known);
    }
  }

  html += '</div>';

  mweList.innerHTML = html;
  attachLemmaFilterListeners();

  // Add click handlers to navigate to first occurrence in transcript
  mweList.querySelectorAll('.lemma-entry').forEach((el) => {
    el.addEventListener('click', () => {
      const sentenceIndex = parseInt((el as HTMLElement).dataset.sentenceIndex || '-1', 10);
      if (sentenceIndex >= 0 && sentenceIndex < subtitles.length) {
        videoPlayer.currentTime = subtitles[sentenceIndex].start;
        const entry = transcriptList.children[sentenceIndex] as HTMLElement;
        if (entry) entry.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    });
  });
}

function attachLemmaFilterListeners(): void {
  mweList.querySelectorAll('[data-lemma-filter]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      lemmaFilter = (btn as HTMLElement).dataset.lemmaFilter as 'all' | 'unknown' | 'known';
      if (cachedTranscriptLemmas) renderTranscriptLemmas(cachedTranscriptLemmas);
    });
  });

  mweList.querySelectorAll('[data-cefr-filter]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      lemmaCefrFilter = (btn as HTMLElement).dataset.cefrFilter || 'all';
      if (cachedTranscriptLemmas) renderTranscriptLemmas(cachedTranscriptLemmas);
    });
  });

  const reanalyzeBtn = document.getElementById('lemmaReanalyzeBtn');
  if (reanalyzeBtn) {
    reanalyzeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      cachedTranscriptLemmas = null;
      cachedLemmaAnalyzedAt = null;
      runLemmaAnalysis();
    });
  }
}

// Load existing MWEs when a video is selected
async function loadMWEsForFolder(folder: string): Promise<void> {
  try {
    const existing = await window.api.getMWEsForFolder(folder);
    if (existing.length > 0) {
      renderMWEList(existing);
    } else {
      mweList.innerHTML = '<div class="py-6 px-3 text-gray-600 text-[12px] text-center">Click "Extract" to find multiword expressions in this transcript.</div>';
    }
  } catch (err) {
    console.error('Failed to load MWEs:', err);
  }
}

// Progress listener
window.api.onMWEProgress((progress: MWEProgress) => {
  mweProgress.classList.remove('hidden');
  if (progress.stage === 'extracting') {
    mweProgressText.textContent = `Extracting... sentences ${progress.sentenceStart}–${progress.sentenceEnd} of ${progress.totalSentences}`;
  } else if (progress.stage === 'normalizing') {
    mweProgressText.textContent = `Normalizing... (${progress.current}/${progress.total})`;
  } else if (progress.stage === 'storing') {
    mweProgressText.textContent = 'Saving to database...';
  }
});

// Extract button handler
let isMWEExtracting = false;

extractMWEsBtn.addEventListener('click', async () => {
  // Cancel if already extracting
  if (isMWEExtracting) {
    extractMWEsBtn.disabled = true;
    extractMWEsBtn.textContent = 'Cancelling...';
    await window.api.cancelMWEExtraction();
    return;
  }

  if (!currentFolder || subtitles.length === 0) return;

  isMWEExtracting = true;
  extractMWEsBtn.textContent = 'Cancel';
  mweProgress.classList.remove('hidden');
  mweProgressText.textContent = 'Starting extraction...';

  const subsData = subtitles.map((s, i) => ({ index: i, text: s.text }));

  const result = await window.api.extractMWEs({ folder: currentFolder, subtitles: subsData });

  mweProgress.classList.add('hidden');
  isMWEExtracting = false;
  extractMWEsBtn.disabled = false;
  extractMWEsBtn.textContent = 'Extract';

  if (result.success && result.results) {
    renderMWEList(result.results);
  } else if (result.error === 'cancelled') {
    // Load whatever was saved before cancellation, or show message
    mweList.innerHTML = '<div class="py-4 px-3 text-gray-500 text-[12px] text-center">Extraction cancelled.</div>';
  } else {
    mweList.innerHTML = `<div class="py-4 px-3 text-accent text-[12px] text-center">Error: ${escapeHtml(result.error || 'Unknown error')}</div>`;
  }
});

// --- Card Modal ---

const cardModal = document.getElementById('cardModal') as HTMLDivElement;
const cardModalInner = document.getElementById('cardModalInner') as HTMLDivElement;
const cardModalContent = document.getElementById('cardModalContent') as HTMLDivElement;
const cardModalClose = document.getElementById('cardModalClose') as HTMLButtonElement;
const cardModalVideo = document.getElementById('cardModalVideo') as HTMLVideoElement;

let clipTimeUpdateHandler: (() => void) | null = null;

function openCardModal(card: Card): void {
  // Set up video clip
  cardModalVideo.src = videoPlayer.src;
  cardModalVideo.currentTime = card.startTime;

  // Clean up any previous handler
  if (clipTimeUpdateHandler) {
    cardModalVideo.removeEventListener('timeupdate', clipTimeUpdateHandler);
  }

  // Pause at end of subtitle
  clipTimeUpdateHandler = () => {
    if (cardModalVideo.currentTime >= card.endTime) {
      cardModalVideo.pause();
      cardModalVideo.currentTime = card.startTime;
    }
  };
  cardModalVideo.addEventListener('timeupdate', clipTimeUpdateHandler);

  // Auto-play once seeked
  cardModalVideo.addEventListener('seeked', () => {
    cardModalVideo.play();
  }, { once: true });

  // Highlight selectedText within expression
  const highlightedExpression = card.expression.replace(
    card.selectedText,
    `<span class="text-accent font-bold">${escapeHtml(card.selectedText)}</span>`
  );

  cardModalContent.innerHTML = `
    <div class="space-y-4">
      <div>
        <div class="text-[10px] uppercase tracking-wider text-gray-600 mb-1">Spanish</div>
        <div class="text-base text-gray-200 leading-relaxed">${highlightedExpression}</div>
      </div>
      <div>
        <div class="text-[10px] uppercase tracking-wider text-gray-600 mb-1">Selected</div>
        <div class="text-sm text-accent font-semibold">${escapeHtml(card.selectedText)}</div>
      </div>
      ${card.translation ? `<div>
        <div class="text-[10px] uppercase tracking-wider text-gray-600 mb-1">Translation</div>
        <div class="text-sm text-accent leading-relaxed">${escapeHtml(card.translation)}</div>
      </div>` : ''}
      ${card.meaning ? `<div>
        <div class="text-[10px] uppercase tracking-wider text-gray-600 mb-1">Explanation</div>
        <div class="text-sm text-gray-300 leading-relaxed">${escapeHtml(card.meaning)}</div>
      </div>` : ''}
      ${card.targetLineBefore || card.targetLineAfter ? `
      <div>
        <div class="text-[10px] uppercase tracking-wider text-gray-600 mb-1">Context</div>
        ${card.targetLineBefore ? `<div class="text-xs text-gray-500 italic">${escapeHtml(card.targetLineBefore)}</div>` : ''}
        <div class="text-xs text-gray-400 my-0.5">${escapeHtml(card.expression)}</div>
        ${card.targetLineAfter ? `<div class="text-xs text-gray-500 italic">${escapeHtml(card.targetLineAfter)}</div>` : ''}
      </div>` : ''}
      <div class="text-[10px] text-gray-600">${card.time} &middot; ${escapeHtml(card.source)}</div>
    </div>
  `;

  cardModal.classList.remove('hidden');
  cardModal.classList.add('flex');
}

function closeCardModal(): void {
  // Stop clip playback and clean up
  cardModalVideo.pause();
  if (clipTimeUpdateHandler) {
    cardModalVideo.removeEventListener('timeupdate', clipTimeUpdateHandler);
    clipTimeUpdateHandler = null;
  }
  cardModalVideo.removeAttribute('src');
  cardModalVideo.load();

  cardModal.classList.add('hidden');
  cardModal.classList.remove('flex');
}

cardModalClose.addEventListener('click', closeCardModal);
cardModal.addEventListener('click', (e: Event) => {
  if (e.target === cardModal) closeCardModal();
});

// --- Corpus Page ---

const corpusNavBtn = document.getElementById('corpusNavBtn') as HTMLButtonElement;
const mainPage = document.getElementById('mainPage') as HTMLDivElement;
const corpusPage = document.getElementById('corpusPage') as HTMLDivElement;
const corpusDeckList = document.getElementById('corpusDeckList') as HTMLDivElement;
const corpusFetchBtn = document.getElementById('corpusFetchBtn') as HTMLButtonElement;
const corpusDeckInfo = document.getElementById('corpusDeckInfo') as HTMLDivElement;
const corpusPreview = document.getElementById('corpusPreview') as HTMLDivElement;
const corpusSentenceCount = document.getElementById('corpusSentenceCount') as HTMLSpanElement;
const corpusSentenceList = document.getElementById('corpusSentenceList') as HTMLDivElement;
const corpusBuildLemmasBtn = document.getElementById('corpusBuildLemmasBtn') as HTMLButtonElement;
const corpusBuildMWEsBtn = document.getElementById('corpusBuildMWEsBtn') as HTMLButtonElement;
const corpusBuildBothBtn = document.getElementById('corpusBuildBothBtn') as HTMLButtonElement;
const corpusCancelBtn = document.getElementById('corpusCancelBtn') as HTMLButtonElement;
const corpusBuildProgress = document.getElementById('corpusBuildProgress') as HTMLDivElement;
const corpusBuildProgressText = document.getElementById('corpusBuildProgressText') as HTMLSpanElement;

// MWE Review elements
const corpusMWEReview = document.getElementById('corpusMWEReview') as HTMLDivElement;
const corpusMWEReviewCount = document.getElementById('corpusMWEReviewCount') as HTMLSpanElement;
const corpusMWEReviewList = document.getElementById('corpusMWEReviewList') as HTMLDivElement;
const corpusMWESelectAll = document.getElementById('corpusMWESelectAll') as HTMLButtonElement;
const corpusMWEDeselectAll = document.getElementById('corpusMWEDeselectAll') as HTMLButtonElement;
const corpusMWEApproveBtn = document.getElementById('corpusMWEApproveBtn') as HTMLButtonElement;
const corpusMWESelectedCount = document.getElementById('corpusMWESelectedCount') as HTMLSpanElement;

// Stats elements
const statTotalLemmas = document.getElementById('statTotalLemmas') as HTMLDivElement;
const statTotalMWEs = document.getElementById('statTotalMWEs') as HTMLDivElement;
const statKnownMWEs = document.getElementById('statKnownMWEs') as HTMLDivElement;
const statUnknownMWEs = document.getElementById('statUnknownMWEs') as HTMLDivElement;
const statLemmasByPos = document.getElementById('statLemmasByPos') as HTMLDivElement;
const statMWEsByCategory = document.getElementById('statMWEsByCategory') as HTMLDivElement;
const statImports = document.getElementById('statImports') as HTMLDivElement;
const statEstimatedLevel = document.getElementById('statEstimatedLevel') as HTMLDivElement;
const statFrequencyBands = document.getElementById('statFrequencyBands') as HTMLDivElement;
const corpusResetBtn = document.getElementById('corpusResetBtn') as HTMLButtonElement;
const userLevelSelect = document.getElementById('userLevelSelect') as HTMLSelectElement;
const lemmaSearchInput = document.getElementById('lemmaSearchInput') as HTMLInputElement;
const lemmaSearchBtn = document.getElementById('lemmaSearchBtn') as HTMLButtonElement;
const lemmaSearchResult = document.getElementById('lemmaSearchResult') as HTMLDivElement;

let currentPage: 'main' | 'corpus' = 'main';
let selectedCorpusDecks = new Set<string>();
let corpusSentences: string[] = [];
let corpusLemmas: { lemma: string; pos: string }[] = [];
let pendingMWEs: MWEResult[] = [];
let mweCheckedSet = new Set<number>(); // indices into pendingMWEs that are checked
let corpusDeckName = '';
let corpusLemmaCount = 0;
let corpusNewSentenceCount = 0;
let corpusSkippedCount = 0;

function switchPage(page: 'main' | 'corpus'): void {
  currentPage = page;
  if (page === 'main') {
    mainPage.classList.remove('hidden');
    // progressEl visibility controlled by 'visible' class during downloads
    corpusPage.classList.add('hidden');
    corpusNavBtn.textContent = 'Corpus';
    corpusNavBtn.classList.remove('bg-accent', 'text-white', 'border-accent');
    corpusNavBtn.classList.add('bg-bg-primary', 'text-gray-400', 'border-border-primary');
  } else {
    mainPage.classList.add('hidden');
    progressEl.classList.remove('visible');
    corpusPage.classList.remove('hidden');
    corpusPage.classList.add('flex');
    corpusNavBtn.textContent = '← Back';
    corpusNavBtn.classList.add('bg-accent', 'text-white', 'border-accent');
    corpusNavBtn.classList.remove('bg-bg-primary', 'text-gray-400', 'border-border-primary');
    loadCorpusDecks();
    refreshCorpusStats();
  }
}

corpusNavBtn.addEventListener('click', () => {
  switchPage(currentPage === 'main' ? 'corpus' : 'main');
});

async function loadCorpusDecks(): Promise<void> {
  if (!ankiConnected) {
    corpusDeckList.innerHTML = '<div class="py-6 text-red-400 text-[13px] text-center">Anki not connected</div>';
    return;
  }

  corpusDeckList.innerHTML = '<div class="py-6 text-gray-600 text-[13px] text-center">Loading decks...</div>';

  try {
    const res = await window.api.ankiInvoke('deckNames');
    const decks = (res.result as string[]).sort();

    corpusDeckList.innerHTML = '';
    for (const deck of decks) {
      const div = document.createElement('div');
      div.className = 'flex items-center gap-2 py-1.5 px-2 rounded hover:bg-bg-primary cursor-pointer transition-colors';
      div.innerHTML = `
        <input type="checkbox" class="corpus-deck-cb accent-accent cursor-pointer" data-deck="${escapeHtml(deck)}" ${selectedCorpusDecks.has(deck) ? 'checked' : ''}>
        <span class="text-[13px] text-gray-300 truncate">${escapeHtml(deck)}</span>
      `;
      const cb = div.querySelector('input') as HTMLInputElement;
      cb.addEventListener('change', () => {
        if (cb.checked) {
          selectedCorpusDecks.add(deck);
        } else {
          selectedCorpusDecks.delete(deck);
        }
        updateCorpusDeckInfo();
      });
      div.addEventListener('click', (e) => {
        if (e.target !== cb) {
          cb.checked = !cb.checked;
          cb.dispatchEvent(new Event('change'));
        }
      });
      corpusDeckList.appendChild(div);
    }
    updateCorpusDeckInfo();
  } catch {
    corpusDeckList.innerHTML = '<div class="py-6 text-red-400 text-[13px] text-center">Failed to load decks</div>';
  }
}

function updateCorpusDeckInfo(): void {
  const count = selectedCorpusDecks.size;
  corpusDeckInfo.textContent = count === 0 ? 'No decks selected' : `${count} deck${count > 1 ? 's' : ''} selected`;
  corpusFetchBtn.disabled = count === 0;
}

corpusFetchBtn.addEventListener('click', async () => {
  if (selectedCorpusDecks.size === 0) return;

  corpusFetchBtn.disabled = true;
  corpusFetchBtn.textContent = 'Fetching...';
  corpusPreview.classList.add('hidden');

  try {
    const res = await window.api.fetchAnkiNotes([...selectedCorpusDecks]);
    if (!res.success) {
      corpusFetchBtn.textContent = 'Fetch Sentences';
      corpusFetchBtn.disabled = false;
      alert('Failed to fetch: ' + res.error);
      return;
    }

    corpusSentences = res.sentences || [];
    if (corpusSentences.length === 0) {
      corpusFetchBtn.textContent = 'Fetch Sentences';
      corpusFetchBtn.disabled = false;
      alert('No sentences found in selected decks.');
      return;
    }

    const migakuLemmas = res.migakuLemmas || [];
    corpusSentenceCount.textContent = `${corpusSentences.length} unique sentences`;

    // Show preview (first 50)
    corpusSentenceList.innerHTML = '';
    const preview = corpusSentences.slice(0, 50);
    for (const s of preview) {
      const div = document.createElement('div');
      div.className = 'text-[12px] text-gray-400 py-0.5 px-2 border-l-2 border-border-primary';
      div.textContent = s;
      corpusSentenceList.appendChild(div);
    }
    if (corpusSentences.length > 50) {
      const more = document.createElement('div');
      more.className = 'text-[11px] text-gray-600 py-1 px-2 italic';
      more.textContent = `...and ${corpusSentences.length - 50} more`;
      corpusSentenceList.appendChild(more);
    }

    corpusPreview.classList.remove('hidden');

    // Extract lemmas: SpaCy + merge with Migaku-extracted lemmas
    setCorpusBuildBtnsDisabled(true);
    corpusBuildLemmasBtn.textContent = 'Extracting lemmas (SpaCy)...';
    const lemmaRes = await window.api.extractLemmas(corpusSentences);
    if (lemmaRes.success && lemmaRes.lemmas) {
      // Merge SpaCy lemmas with Migaku-extracted lemmas (deduplicated by lemma key)
      const lemmaMap = new Map<string, string>();
      for (const l of lemmaRes.lemmas) {
        lemmaMap.set(l.lemma, l.pos);
      }
      for (const l of migakuLemmas) {
        if (!lemmaMap.has(l.lemma)) {
          lemmaMap.set(l.lemma, l.pos);
        }
      }
      corpusLemmas = Array.from(lemmaMap.entries())
        .map(([lemma, pos]) => ({ lemma, pos }))
        .sort((a, b) => a.lemma.localeCompare(b.lemma));
      corpusBuildLemmasBtn.textContent = `Lemmas Only (${corpusLemmas.length})`;
      corpusBuildBothBtn.textContent = `Both (${corpusLemmas.length} lemmas + MWEs)`;
    } else {
      // SpaCy failed — fall back to Migaku lemmas if available
      if (migakuLemmas.length > 0) {
        corpusLemmas = migakuLemmas;
        corpusBuildLemmasBtn.textContent = `Lemmas Only (${corpusLemmas.length}, Migaku only)`;
        corpusBuildBothBtn.textContent = `Both (${corpusLemmas.length} lemmas + MWEs)`;
      } else {
        corpusBuildLemmasBtn.textContent = 'Lemmas Only (extraction failed)';
        corpusBuildLemmasBtn.disabled = true;
        corpusBuildBothBtn.textContent = 'Both (lemma extraction failed)';
        corpusBuildBothBtn.disabled = true;
        corpusLemmas = [];
      }
    }
    setCorpusBuildBtnsDisabled(false);

  } finally {
    corpusFetchBtn.textContent = 'Fetch Sentences';
    corpusFetchBtn.disabled = selectedCorpusDecks.size === 0;
  }
});

// Helper to enable/disable all three build buttons
function setCorpusBuildBtnsDisabled(disabled: boolean): void {
  corpusBuildLemmasBtn.disabled = disabled;
  corpusBuildMWEsBtn.disabled = disabled;
  corpusBuildBothBtn.disabled = disabled;
}

// Build corpus with mode: 'lemmas', 'mwes', or 'both'
async function runCorpusBuild(mode: 'lemmas' | 'mwes' | 'both'): Promise<void> {
  if (corpusSentences.length === 0) return;

  corpusDeckName = [...selectedCorpusDecks].join('+');
  setCorpusBuildBtnsDisabled(true);
  corpusCancelBtn.classList.remove('hidden');
  corpusBuildProgress.classList.remove('hidden');
  corpusBuildProgressText.textContent = 'Starting...';
  corpusMWEReview.classList.add('hidden');

  try {
    const res = await window.api.buildAnkiCorpus({
      deckName: corpusDeckName,
      sentences: corpusSentences,
      lemmas: corpusLemmas,
      mode,
    });

    if (res.success) {
      corpusLemmaCount = res.lemmaCount || 0;
      corpusSkippedCount = res.skippedCount || 0;
      corpusNewSentenceCount = res.sentenceCount || 0;

      if (mode === 'lemmas') {
        // Lemmas-only: no MWE review needed
        corpusBuildProgressText.textContent = `Stored ${corpusLemmaCount} lemmas. No MWE extraction needed.`;
        // Mark sentences as processed immediately for lemma-only mode
        if (corpusSentences.length > 0) {
          await window.api.approveCorpusMWEs({
            deckName: corpusDeckName,
            mwes: [],
            sentenceCount: corpusNewSentenceCount || corpusSentences.length,
            lemmaCount: corpusLemmaCount,
            processedSentences: corpusSentences,
          });
        }
        refreshCorpusStats();
      } else if (res.mwes) {
        // MWEs or Both mode
        if (corpusNewSentenceCount === 0 && corpusSkippedCount > 0) {
          corpusBuildProgressText.textContent = `All ${corpusSkippedCount} sentences have already been analyzed. Add new cards and try again.`;
        } else {
          const skippedMsg = corpusSkippedCount > 0 ? ` (skipped ${corpusSkippedCount} already-processed)` : '';
          const modeLabel = mode === 'mwes' ? 'MWEs' : 'lemmas + MWEs';
          corpusBuildProgressText.textContent = `Extracted ${res.mwes.length} MWEs from ${corpusNewSentenceCount} new sentences${skippedMsg}. Review below.`;
        }
        if (res.mwes.length > 0) showMWEReview(res.mwes);
      }
    } else if (res.error === 'cancelled') {
      corpusBuildProgressText.textContent = 'Cancelled';
    } else {
      corpusBuildProgressText.textContent = `Error: ${res.error}`;
    }
  } catch (err) {
    corpusBuildProgressText.textContent = `Error: ${(err as Error).message}`;
  } finally {
    setCorpusBuildBtnsDisabled(false);
    corpusCancelBtn.classList.add('hidden');
    corpusBuildProgress.classList.add('hidden');
  }
}

corpusBuildLemmasBtn.addEventListener('click', () => runCorpusBuild('lemmas'));
corpusBuildMWEsBtn.addEventListener('click', () => runCorpusBuild('mwes'));
corpusBuildBothBtn.addEventListener('click', () => runCorpusBuild('both'));

corpusCancelBtn.addEventListener('click', () => {
  window.api.cancelCorpusBuild();
});

window.api.onCorpusProgress((progress: CorpusProgress) => {
  corpusBuildProgressText.textContent = progress.message;
});

// --- MWE Review ---

function showMWEReview(mwes: MWEResult[]): void {
  pendingMWEs = mwes;
  // Deduplicate by normalized_form for the review list
  const uniqueMap = new Map<string, { mwe: MWEResult; indices: number[]; surfaces: Set<string> }>();
  mwes.forEach((mwe, i) => {
    const key = mwe.normalized_form;
    if (!uniqueMap.has(key)) {
      uniqueMap.set(key, { mwe, indices: [i], surfaces: new Set([mwe.surface_form]) });
    } else {
      const entry = uniqueMap.get(key)!;
      entry.indices.push(i);
      entry.surfaces.add(mwe.surface_form);
    }
  });

  const uniqueEntries = [...uniqueMap.values()].sort((a, b) => b.indices.length - a.indices.length);

  // Default: all selected
  mweCheckedSet = new Set(mwes.map((_, i) => i));

  corpusMWEReviewCount.textContent = `${uniqueEntries.length} unique MWEs (${mwes.length} instances)`;
  corpusMWEReviewList.innerHTML = '';

  for (const entry of uniqueEntries) {
    const row = document.createElement('div');
    row.className = 'flex items-start gap-2 py-2 px-4 border-b border-border-primary/50 hover:bg-bg-primary/50 transition-colors';

    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = true;
    cb.className = 'accent-accent cursor-pointer mt-1 shrink-0';
    cb.addEventListener('change', () => {
      for (const idx of entry.indices) {
        if (cb.checked) {
          mweCheckedSet.add(idx);
        } else {
          mweCheckedSet.delete(idx);
        }
      }
      updateMWESelectedCount();
    });

    const info = document.createElement('div');
    info.className = 'flex-1 min-w-0';

    const cats = entry.mwe.categories.map(c =>
      `<span class="inline-block text-[9px] px-1.5 py-0.5 rounded bg-accent/20 text-accent mr-1">${escapeHtml(c)}</span>`
    ).join('');

    const surfaces = [...entry.surfaces].map(s => escapeHtml(s)).join(', ');

    info.innerHTML = `
      <div class="flex items-center gap-2">
        <span class="text-[13px] text-white font-medium">${escapeHtml(entry.mwe.normalized_form)}</span>
        <span class="text-[10px] text-gray-600">×${entry.indices.length}</span>
        ${cats}
      </div>
      ${surfaces !== entry.mwe.normalized_form ? `<div class="text-[11px] text-gray-500 mt-0.5">Surface: ${surfaces}</div>` : ''}
      ${entry.mwe.context_note ? `<div class="text-[10px] text-gray-600 mt-0.5 italic">${escapeHtml(entry.mwe.context_note)}</div>` : ''}
      <div class="text-[10px] text-gray-600 mt-0.5 truncate">e.g. "${escapeHtml(entry.mwe.sentence_text)}"</div>
    `;

    row.appendChild(cb);
    row.appendChild(info);
    corpusMWEReviewList.appendChild(row);
  }

  corpusMWEReview.classList.remove('hidden');
  updateMWESelectedCount();
}

function updateMWESelectedCount(): void {
  corpusMWESelectedCount.textContent = `${mweCheckedSet.size} of ${pendingMWEs.length} instances selected`;
  corpusMWEApproveBtn.disabled = mweCheckedSet.size === 0;
}

corpusMWESelectAll.addEventListener('click', () => {
  mweCheckedSet = new Set(pendingMWEs.map((_, i) => i));
  corpusMWEReviewList.querySelectorAll<HTMLInputElement>('input[type="checkbox"]').forEach(cb => { cb.checked = true; });
  updateMWESelectedCount();
});

corpusMWEDeselectAll.addEventListener('click', () => {
  mweCheckedSet.clear();
  corpusMWEReviewList.querySelectorAll<HTMLInputElement>('input[type="checkbox"]').forEach(cb => { cb.checked = false; });
  updateMWESelectedCount();
});

corpusMWEApproveBtn.addEventListener('click', async () => {
  const approved = pendingMWEs.filter((_, i) => mweCheckedSet.has(i));
  if (approved.length === 0) return;

  corpusMWEApproveBtn.disabled = true;
  corpusMWEApproveBtn.textContent = 'Storing...';

  try {
    const res = await window.api.approveCorpusMWEs({
      deckName: corpusDeckName,
      mwes: approved,
      sentenceCount: corpusNewSentenceCount || corpusSentences.length,
      lemmaCount: corpusLemmaCount,
      processedSentences: corpusSentences,
    });

    if (res.success) {
      corpusMWEReview.classList.add('hidden');
      const sentenceLabel = corpusNewSentenceCount || corpusSentences.length;
      corpusBuildProgressText.textContent = `Done! Stored ${res.stored} MWEs + ${corpusLemmaCount} lemmas from ${sentenceLabel} sentences`;
      pendingMWEs = [];
      mweCheckedSet.clear();
      refreshCorpusStats();
    }
  } catch (err) {
    alert('Failed to store MWEs: ' + (err as Error).message);
  } finally {
    corpusMWEApproveBtn.disabled = false;
    corpusMWEApproveBtn.textContent = 'Approve Selected';
  }
});

// Stats rendering
function renderBarChart(container: HTMLDivElement, items: { label: string; count: number }[]): void {
  container.innerHTML = '';
  if (items.length === 0) {
    container.innerHTML = '<div class="text-[12px] text-gray-600 italic">No data yet</div>';
    return;
  }
  const max = Math.max(...items.map(i => i.count));
  for (const item of items) {
    const pct = max > 0 ? (item.count / max) * 100 : 0;
    const row = document.createElement('div');
    row.className = 'flex items-center gap-2';
    row.innerHTML = `
      <span class="text-[11px] text-gray-400 w-16 text-right shrink-0">${escapeHtml(item.label)}</span>
      <div class="flex-1 h-4 bg-bg-primary rounded overflow-hidden">
        <div class="h-full bg-accent/40 rounded transition-all" style="width: ${pct}%"></div>
      </div>
      <span class="text-[11px] text-gray-500 w-10 shrink-0">${item.count}</span>
    `;
    container.appendChild(row);
  }
}

async function refreshCorpusStats(): Promise<void> {
  try {
    const stats = await window.api.getCorpusStats();

    statTotalLemmas.textContent = stats.totalLemmas.toLocaleString();
    statTotalMWEs.textContent = stats.totalMWEs.toLocaleString();
    statKnownMWEs.textContent = stats.knownMWEs.toLocaleString();
    statUnknownMWEs.textContent = stats.unknownMWEs.toLocaleString();

    renderBarChart(statLemmasByPos, stats.lemmasByPos.map(p => ({ label: p.pos, count: p.count })));
    renderBarChart(statMWEsByCategory, stats.mwesByCategory.map(c => ({ label: c.category, count: c.count })));

    // Level profile (CEFR bands)
    const lp = stats.levelProfile;
    const cefrOrder = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
    statEstimatedLevel.textContent = lp.estimatedLevel;
    statFrequencyBands.innerHTML = '';
    for (const band of lp.bands) {
      if (band.totalInList === 0) continue; // skip empty levels (e.g., C2)
      const pct = Math.round(band.coverage * 100);
      const isAtOrBelowFloor = cefrOrder.indexOf(band.level) <= cefrOrder.indexOf(lp.floorLevel);
      const barColor = pct >= 80 ? 'bg-green-500' : pct >= 50 ? 'bg-yellow-500' : 'bg-red-500/70';
      const row = document.createElement('div');
      row.className = 'flex items-center gap-2';
      row.innerHTML = `
        <span class="text-[12px] ${isAtOrBelowFloor ? 'text-gray-200 font-semibold' : 'text-gray-500'} w-10 text-right shrink-0">${escapeHtml(band.level)}</span>
        <div class="flex-1 h-4 bg-bg-primary rounded overflow-hidden">
          <div class="h-full ${barColor} rounded transition-all" style="width: ${pct}%"></div>
        </div>
        <span class="text-[11px] text-gray-500 w-24 shrink-0">${band.knownCount}/${band.totalInList} <span class="text-gray-600">${pct}%</span></span>
      `;
      statFrequencyBands.appendChild(row);
    }

    // Import history
    statImports.innerHTML = '';
    if (stats.imports.length === 0) {
      statImports.innerHTML = '<div class="text-[12px] text-gray-600 italic">No imports yet</div>';
    } else {
      for (const imp of stats.imports) {
        const row = document.createElement('div');
        row.className = 'flex items-center justify-between py-1.5 px-2 bg-bg-primary rounded text-[12px]';
        row.innerHTML = `
          <span class="text-gray-300 font-medium truncate mr-2">${escapeHtml(imp.deck_name)}</span>
          <div class="flex gap-3 shrink-0 text-gray-500">
            <span>${imp.sentence_count} sent</span>
            <span>${imp.lemma_count} lemmas</span>
            <span>${imp.mwe_count} MWEs</span>
            <span class="text-gray-600">${new Date(imp.imported_at).toLocaleDateString()}</span>
          </div>
        `;
        statImports.appendChild(row);
      }
    }
  } catch {
    // Stats not available yet
  }
}

// User level change
userLevelSelect.addEventListener('change', () => {
  persistDeckSettings();
  // Invalidate cached transcript lemmas so they re-tag with new level
  cachedTranscriptLemmas = null;
  cachedLemmaAnalyzedAt = null;
});

// Reset lemma database
corpusResetBtn.addEventListener('click', async () => {
  if (!confirm('This will delete all lemmas, import history, and processed sentence records. MWEs will not be affected. Continue?')) return;
  corpusResetBtn.disabled = true;
  corpusResetBtn.textContent = 'Resetting...';
  try {
    const res = await window.api.resetLemmaDatabase();
    if (res.success) {
      alert(`Deleted ${res.deletedLemmas} lemmas, ${res.deletedImports} imports, ${res.deletedProcessed} processed sentences.`);
      refreshCorpusStats();
    } else {
      alert('Reset failed: ' + res.error);
    }
  } finally {
    corpusResetBtn.disabled = false;
    corpusResetBtn.textContent = 'Reset Lemma Database';
  }
});

// Lemma lookup
async function searchLemma(): Promise<void> {
  const query = lemmaSearchInput.value.trim().toLowerCase();
  if (!query) return;
  lemmaSearchBtn.disabled = true;
  lemmaSearchResult.classList.remove('hidden');
  lemmaSearchResult.textContent = 'Searching...';
  lemmaSearchResult.className = 'mt-2 text-sm text-gray-400';
  try {
    const res = await window.api.checkLemmaExists(query);
    if (res.exists) {
      lemmaSearchResult.className = 'mt-2 text-sm text-green-400';
      lemmaSearchResult.innerHTML = `<span class="font-semibold">${query}</span> found — POS: <span class="text-white font-mono">${res.pos || '?'}</span>, Source: <span class="text-white">${res.source_deck || '?'}</span>`;
    } else {
      lemmaSearchResult.className = 'mt-2 text-sm text-red-400';
      lemmaSearchResult.innerHTML = `<span class="font-semibold">${query}</span> not found in the lemma database.`;
    }
  } catch {
    lemmaSearchResult.className = 'mt-2 text-sm text-red-400';
    lemmaSearchResult.textContent = 'Error looking up lemma.';
  } finally {
    lemmaSearchBtn.disabled = false;
  }
}

lemmaSearchBtn.addEventListener('click', searchLemma);
lemmaSearchInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') searchLemma();
});

// Make startDownload available to onclick in HTML
window.startDownload = startDownload;
