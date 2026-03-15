interface Subtitle {
  start: number;
  end: number;
  text: string;
}

interface AnkiConnectResponse {
  result: unknown;
  error: string | null;
}

interface Card {
  id: string;
  expression: string;        // subs2srs "Target: line" — full Spanish subtitle sentence
  meaning: string;           // subs2srs "Base: line" — English explanation
  translation: string;       // direct English translation of the selected phrase
  targetLineBefore: string;  // subs2srs "Target: line before"
  targetLineAfter: string;   // subs2srs "Target: line after"
  selectedText: string;      // highlighted text for display emphasis
  time: string;              // subs2srs "Time" — subtitle timestamp
  source: string;            // subs2srs "Source" — video title
  startTime: number;         // subtitle start in seconds (for clip playback)
  endTime: number;           // subtitle end in seconds (for clip playback)
  createdAt: number;
  exported?: boolean;        // true if successfully exported to Anki
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

function loadCards(folder: string): Card[] {
  try {
    const data = localStorage.getItem(`cards-${folder}`);
    return data ? JSON.parse(data) : [];
  } catch { return []; }
}

function saveCards(folder: string, cards: Card[]): void {
  localStorage.setItem(`cards-${folder}`, JSON.stringify(cards));
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

function renderCardsView(folder: string, title: string): void {
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

  const cards = loadCards(folder);
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

  for (const card of cards) {
    const item = document.createElement('div');
    item.className = 'group py-2.5 px-4 cursor-pointer transition-colors duration-150 border-l-[3px] border-l-transparent flex items-center gap-2 hover:bg-accent/10';
    item.innerHTML = `
      ${card.exported ? '<span class="text-green-500 text-sm shrink-0" title="Exported to Anki">&#10003;</span>' : ''}
      <div class="flex-1 min-w-0">
        <div class="text-[13px] text-gray-300 font-medium overflow-hidden text-ellipsis whitespace-nowrap">${escapeHtml(card.selectedText)}</div>
        <div class="text-[11px] text-gray-600 overflow-hidden text-ellipsis whitespace-nowrap mt-0.5">${escapeHtml(card.expression)}</div>
      </div>
      <button class="opacity-0 group-hover:opacity-100 bg-transparent border-none text-gray-500 text-base cursor-pointer py-0.5 px-1.5 rounded transition-all duration-150 hover:text-accent shrink-0" title="Delete card">&times;</button>
    `;

    item.querySelector('div.flex-1')!.addEventListener('click', () => {
      openCardModal(card);
    });

    (item.querySelector('button') as HTMLElement).addEventListener('click', (e: Event) => {
      e.stopPropagation();
      const updatedCards = loadCards(folder).filter(c => c.id !== card.id);
      saveCards(folder, updatedCards);
      renderCardsView(folder, title);
    });

    sidebarList.appendChild(item);
  }
}

async function exportCards(folder: string, title: string): Promise<void> {
  const cards = loadCards(folder);
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
    videoTitle: title,
  });

  // Mark successfully exported cards
  const allCards = loadCards(folder);
  for (const r of result.results) {
    if (r.success) {
      const card = allCards.find(c => c.id === r.cardId);
      if (card) card.exported = true;
    }
  }
  saveCards(folder, allCards);

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

async function selectVideo(video: { folder: string; videoPath: string; srtPath: string; title?: string }): Promise<void> {
  currentFolder = video.folder;
  currentVideoTitle = video.title || video.folder;
  sidebarView = 'cards';
  refreshSidebar();
  loadVideo(video.videoPath, video.srtPath);
}

async function startDownload(): Promise<void> {
  const url = urlInput.value.trim();
  if (!url) return;

  downloadBtn.disabled = true;
  downloadBtn.textContent = 'Downloading...';
  resetPipeline();
  progressEl.classList.add('visible');

  const result = await window.api.downloadVideo(url);

  if (result.success) {
    updatePipeline(5);
    currentFolder = result.folder!;
    await refreshSidebar();
    loadVideo(result.videoPath!, result.srtPath!);
    setTimeout(() => progressEl.classList.remove('visible'), 2000);
  } else {
    resetPipeline();
    progressEl.innerHTML = `<div class="text-accent">Error: ${escapeHtml(result.error!)}</div>`;
  }

  downloadBtn.disabled = false;
  downloadBtn.textContent = 'Download';
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
    entry.className = 'transcript-entry flex gap-3 py-2 px-4 cursor-pointer transition-colors duration-150 border-l-[3px] border-l-transparent hover:bg-accent/10';
    entry.dataset.index = String(i);
    entry.innerHTML = `
      <span class="transcript-time text-xs text-accent font-mono whitespace-nowrap min-w-[80px] pt-0.5">${formatTime(sub.start)}</span>
      <span class="transcript-text text-sm leading-normal text-gray-300">${escapeHtml(sub.text)}</span>
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
  window.api.saveSettings({ selectedDeck: selectedAnkiDeck, chunkingDeck: selectedChunkingDeck });
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
});

// Check Anki on startup and poll every 5 seconds
checkAnkiConnection();
setInterval(checkAnkiConnection, 5000);

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

transcriptList.addEventListener('mouseup', () => {
  setTimeout(() => {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed) { hideSelectionPopup(); return; }

    const selected = selection.toString().trim();
    if (!selected || selected.length < 2) { hideSelectionPopup(); return; }

    const anchorIndex = findSubtitleIndexForNode(selection.anchorNode!);
    if (anchorIndex < 0) { hideSelectionPopup(); return; }

    currentSelectedText = selected;
    currentAnchorIndex = anchorIndex;
    currentSelectionContext = {
      sentenceBefore: anchorIndex > 0 ? subtitles[anchorIndex - 1].text : '',
      sentenceAfter: anchorIndex < subtitles.length - 1 ? subtitles[anchorIndex + 1].text : '',
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

createCardBtn.addEventListener('click', () => {
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

  const cards = loadCards(currentFolder);
  cards.push(card);
  saveCards(currentFolder, cards);

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

// Make startDownload available to onclick in HTML
window.startDownload = startDownload;
