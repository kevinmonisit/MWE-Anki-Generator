import {
  ankiConnected,
  setAnkiConnected,
  ankiDecks,
  setAnkiDecks,
  selectedAnkiDeck,
  setSelectedAnkiDeck,
  selectedChunkingDeck,
  setSelectedChunkingDeck,
  sidebarView,
  currentFolder,
  currentVideoTitle,
  setCachedTranscriptLemmas,
  setCachedLemmaAnalyzedAt,
} from '../state';
import type { AnkiConnectResponse } from '../state';
import { renderCardsView } from './cards';

// --- DOM elements ---
const ankiDot = document.getElementById('ankiDot') as HTMLElement;
const ankiStatusText = document.getElementById('ankiStatusText') as HTMLElement;
const ankiDeckSelect = document.getElementById('ankiDeckSelect') as HTMLSelectElement;
const ankiChunkingDeckSelect = document.getElementById('ankiChunkingDeckSelect') as HTMLSelectElement;
const apiCostDisplay = document.getElementById('apiCostDisplay') as HTMLSpanElement;
const apiCostResetBtn = document.getElementById('apiCostResetBtn') as HTMLButtonElement;
const userLevelSelect = document.getElementById('userLevelSelect') as HTMLSelectElement;

// --- Anki connection ---

export async function checkAnkiConnection(): Promise<void> {
  try {
    const res: AnkiConnectResponse = await window.api.ankiInvoke('version');
    if (res.error === null) {
      setAnkiConnected(true);
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
  setAnkiConnected(false);
  setAnkiDecks([]);
  setSelectedAnkiDeck('');
  setSelectedChunkingDeck('');
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
      setAnkiDecks(res.result as string[]);
      renderAnkiDecks();
    }
  } catch {
    setAnkiDecks([]);
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
    setSelectedAnkiDeck(prev);
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
    setSelectedChunkingDeck(prevChunking);
  }
}

// --- Persist settings ---

export function persistDeckSettings(): void {
  window.api.saveSettings({
    selectedDeck: selectedAnkiDeck,
    chunkingDeck: selectedChunkingDeck,
    userLevel: userLevelSelect.value,
  });
}

// --- API cost display ---

function updateCostDisplay(totalCost: number): void {
  apiCostDisplay.textContent = totalCost < 0.01
    ? `$${totalCost.toFixed(4)}`
    : `$${totalCost.toFixed(2)}`;
}

// --- Init ---

export function initAnkiUI(): void {
  // Load saved deck selections on startup
  (async () => {
    try {
      const settings = await window.api.loadSettings();
      setSelectedAnkiDeck(settings.selectedDeck || '');
      setSelectedChunkingDeck(settings.chunkingDeck || '');
      if (settings.userLevel) {
        if (userLevelSelect) userLevelSelect.value = settings.userLevel;
      }
    } catch { /* ignore */ }
  })();

  // Deck select change handlers
  ankiDeckSelect.addEventListener('change', () => {
    setSelectedAnkiDeck(ankiDeckSelect.value);
    persistDeckSettings();
    // Refresh cards view so Export button state updates immediately
    if (sidebarView === 'cards' && currentFolder) {
      renderCardsView(currentFolder, currentVideoTitle);
    }
  });

  ankiChunkingDeckSelect.addEventListener('change', () => {
    setSelectedChunkingDeck(ankiChunkingDeckSelect.value);
    persistDeckSettings();
    // Refresh cards view so chunking checkboxes update enabled/disabled state
    if (sidebarView === 'cards' && currentFolder) {
      renderCardsView(currentFolder, currentVideoTitle);
    }
  });

  // Check Anki on startup and poll every 5 seconds
  checkAnkiConnection();
  setInterval(checkAnkiConnection, 5000);

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

  // Reset cost button
  apiCostResetBtn.addEventListener('click', async () => {
    await window.api.resetApiCost();
    updateCostDisplay(0);
  });

  // User level change handler
  userLevelSelect.addEventListener('change', () => {
    persistDeckSettings();
    // Invalidate cached transcript lemmas so they re-tag with new level
    setCachedTranscriptLemmas(null);
    setCachedLemmaAnalyzedAt(null);
  });
}
