import type { Card } from '../../shared/types';
import {
  currentFolder,
  subtitles,
  currentAnchorIndex,
  ankiConnected,
  selectedAnkiDeck,
  selectedChunkingDeck,
  sidebarView,
  currentVideoTitle,
  currentTranslation,
  currentExplanation,
  currentExplanationEs,
  currentSelectedText,
  currentSelectionContext,
  cachedTranscriptLemmas,
  setSidebarView,
  setCurrentAnchorIndex,
  setCurrentTranslation,
  setCurrentExplanation,
  setCurrentExplanationEs,
  setCurrentSelectedText,
  setCurrentSelectionContext,
} from '../state';
import { escapeHtml, formatTime } from '../utils';

// DOM elements
const explainPanel = document.getElementById('explainPanel') as HTMLDivElement;
const explainPanelText = document.getElementById('explainPanelText') as HTMLDivElement;
const explainPanelBtn = document.getElementById('explainPanelBtn') as HTMLButtonElement;
const explainPanelResult = document.getElementById('explainPanelResult') as HTMLDivElement;
const createCardBtn = document.getElementById('createCardBtn') as HTMLButtonElement;
const selectionPopup = document.getElementById('selectionPopup') as HTMLDivElement;
const selectionExplainBtn = document.getElementById('selectionExplainBtn') as HTMLButtonElement;
const cardModal = document.getElementById('cardModal') as HTMLDivElement;
const cardModalInner = document.getElementById('cardModalInner') as HTMLDivElement;
const cardModalContent = document.getElementById('cardModalContent') as HTMLDivElement;
const cardModalClose = document.getElementById('cardModalClose') as HTMLButtonElement;
const cardModalVideo = document.getElementById('cardModalVideo') as HTMLVideoElement;
const sidebarList = document.getElementById('sidebarList') as HTMLDivElement;
const sidebarHeader = document.querySelector('#sidebar > div:first-child') as HTMLDivElement;
const transcriptList = document.getElementById('transcriptList') as HTMLDivElement;
const videoPlayer = document.getElementById('videoPlayer') as HTMLVideoElement;

// --- Card helpers ---

async function loadCards(folder: string): Promise<Card[]> {
  return window.api.loadCards(folder);
}

async function saveCards(folder: string, cards: Card[]): Promise<void> {
  await window.api.saveCards(folder, cards);
}

// --- Card modal ---

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
      ${card.meaningEs ? `<div>
        <div class="text-[10px] uppercase tracking-wider text-gray-600 mb-1">Explicación</div>
        <div class="text-sm text-gray-300 leading-relaxed">${escapeHtml(card.meaningEs)}</div>
      </div>` : ''}
      ${card.meaning ? `<div>
        <div class="text-[10px] uppercase tracking-wider text-gray-600 mb-1">Explanation (English)</div>
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

// --- Export cards ---

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

// --- Render cards view ---

export async function renderCardsView(folder: string, title: string): Promise<void> {
  // Update header with Go Back button + video title only
  sidebarHeader.innerHTML = `
    <button id="goBackBtn" class="bg-transparent border-none text-gray-400 cursor-pointer text-sm hover:text-accent transition-colors shrink-0" title="Go back">&larr;</button>
    <span class="flex-1 text-sm leading-snug break-words min-w-0">${escapeHtml(title)}</span>
  `;
  sidebarHeader.classList.add('flex', 'items-start', 'gap-2');

  document.getElementById('goBackBtn')!.addEventListener('click', () => {
    setSidebarView('videos');
    sidebarHeader.classList.remove('flex', 'items-start', 'gap-2');
    // Dynamically import refreshSidebar to avoid circular dependency
    import('./layout').then(({ refreshSidebar }) => refreshSidebar());
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

    // Cloze hint row (shown when chunking is enabled) -- sits below the sentence, aligned with content
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

// --- Selection popup ---

function hideSelectionPopup(): void {
  selectionPopup.classList.add('hidden');
}

/**
 * Expand a selection so it snaps to whole-word boundaries.
 * A "word" here includes any adjacent punctuation (e.g. "Que?" stays as one unit).
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

function findSubtitleIndexForNode(node: Node): number {
  let el: HTMLElement | null = node.nodeType === Node.TEXT_NODE ? node.parentElement : node as HTMLElement;
  while (el && !el.classList.contains('transcript-entry')) {
    el = el.parentElement;
  }
  if (!el) return -1;
  return parseInt(el.dataset.index || '-1');
}

// --- Init ---

export function initCards(): void {
  // Text selection in transcript -> shows selection popup with "Explain" button
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

      setCurrentSelectedText(selected);
      setCurrentAnchorIndex(anchorIndex);
      setCurrentSelectionContext({
        sentenceBefore: subtitles.slice(Math.max(0, anchorIndex - 6), anchorIndex).map(s => s.text).join(' '),
        sentenceAfter: subtitles.slice(anchorIndex + 1, Math.min(subtitles.length, anchorIndex + 7)).map(s => s.text).join(' '),
      });

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

  // Explain panel button
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
      setCurrentTranslation(result.translation || '');
      setCurrentExplanation(result.explanation || '');
      setCurrentExplanationEs(result.explanationEs || '');

      // Look up CEFR level from cached lemmas
      const cefrColors: Record<string, string> = {
        A1: 'bg-green-600/30 text-green-400',
        A2: 'bg-green-600/20 text-green-500',
        B1: 'bg-yellow-600/20 text-yellow-400',
        B2: 'bg-yellow-600/15 text-yellow-500',
        C1: 'bg-red-600/20 text-red-400',
        C2: 'bg-red-600/15 text-red-500',
      };
      const selectedLower = currentSelectedText.toLowerCase().trim();
      const matchedLemma = cachedTranscriptLemmas?.find(
        l => l.lemma.toLowerCase() === selectedLower || selectedLower.includes(l.lemma.toLowerCase())
      );
      const cefrLevel = matchedLemma?.cefr_level;
      const cefrPill = cefrLevel
        ? `<span class="text-[9px] px-1 py-px rounded ${cefrColors[cefrLevel] || 'bg-gray-700 text-gray-400'} ml-1">${cefrLevel}</span>`
        : '';

      explainPanelResult.innerHTML = `
        ${currentExplanationEs ? `<div class="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-0.5">Explicación${cefrPill}</div><div class="text-xs text-gray-300 leading-relaxed">${escapeHtml(currentExplanationEs)}</div>` : ''}
        ${currentExplanation ? `<div class="explain-en-toggle mt-1"><button class="text-[10px] text-gray-600 hover:text-gray-400 cursor-pointer bg-transparent border border-gray-700 rounded px-1.5 py-0.5 transition-colors" onclick="var d=this.nextElementSibling;d.style.display=d.style.display==='none'?'block':'none';this.textContent=d.style.display==='none'?'▶ Show English':'▼ Hide English'">▶ Show English</button><div style="display:none"><div class="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-0.5 mt-1">Explanation</div><div class="text-xs text-gray-300 leading-relaxed">${escapeHtml(currentExplanation)}</div></div></div>` : ''}
        ${currentTranslation ? `<div class="text-xs font-semibold text-gray-400 uppercase tracking-wide mt-1 mb-0.5">Translation</div><div class="text-xs text-accent leading-relaxed">${escapeHtml(currentTranslation)}</div>` : ''}
      `;
      createCardBtn.classList.remove('hidden');
    } else {
      explainPanelResult.innerHTML = `<div class="text-accent text-xs">Error: ${escapeHtml(result.error || 'Unknown error')}</div>`;
    }

    explainPanelBtn.textContent = 'Explain in English';
    explainPanelBtn.disabled = false;
  });

  // Create Card button
  createCardBtn.addEventListener('click', async () => {
    if (!currentFolder || currentAnchorIndex < 0) return;

    const sub = subtitles[currentAnchorIndex];

    const card: Card = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      expression: sub.text,
      meaning: currentExplanation,
      meaningEs: currentExplanationEs,
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

  // Card modal close handlers
  cardModalClose.addEventListener('click', closeCardModal);
  cardModal.addEventListener('click', (e: Event) => {
    if (e.target === cardModal) closeCardModal();
  });
}
