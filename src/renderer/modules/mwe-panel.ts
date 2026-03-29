import type { MWEResult, MWEProgress, TranscriptLemma, LemmaAnalysisProgress } from '../../shared/types';
import { escapeHtml } from '../utils';
import {
  subtitles,
  currentFolder,
  currentVideoTitle,
  mweView, setMWEView,
  lastMWEResults, setLastMWEResults,
  selectedMWEs,
  lastClickedMWEIndex, setLastClickedMWEIndex,
  knownSectionCollapsed, setKnownSectionCollapsed,
  isMWEExtracting, setIsMWEExtracting,
  cachedTranscriptLemmas, setCachedTranscriptLemmas,
  cachedLemmaAnalyzedAt, setCachedLemmaAnalyzedAt,
  lemmaFilter, setLemmaFilter,
  lemmaCefrFilter, setLemmaCefrFilter,
  isLemmaAnalyzing, setIsLemmaAnalyzing,
  selectedLemmaIndices, setLastClickedLemmaIndex, lastClickedLemmaIndex,
  displayedLemmaList, setDisplayedLemmaList,
  sidebarView,
} from '../state';

// --- Constants ---

const MWE_CATEGORY_COLORS: Record<string, string> = {
  VID: 'bg-green-800/60 text-green-300',
  'LVC.full': 'bg-purple-800/60 text-purple-300',
  'LVC.cause': 'bg-violet-800/60 text-violet-300',
  VPC: 'bg-sky-800/60 text-sky-300',
  IRV: 'bg-teal-800/60 text-teal-300',
  MVC: 'bg-blue-800/60 text-blue-300',
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

const TAB_ACTIVE = 'flex-1 py-1.5 text-[11px] font-semibold text-accent border-b-2 border-accent bg-transparent cursor-pointer transition-colors';
const TAB_INACTIVE = 'flex-1 py-1.5 text-[11px] font-semibold text-gray-500 border-b-2 border-transparent bg-transparent cursor-pointer transition-colors hover:text-gray-300';

// --- DOM element references (resolved lazily) ---

let mwePanel: HTMLDivElement;
let mweList: HTMLDivElement;
let extractMWEsBtn: HTMLButtonElement;
let mweProgress: HTMLDivElement;
let mweProgressText: HTMLSpanElement;
let mweTabCategories: HTMLButtonElement;
let mweTabList: HTMLButtonElement;
let mweTabLemmas: HTMLButtonElement;

// --- Helper functions ---

function getCategoryLabel(cat: string): string {
  return MWE_CATEGORY_LABELS[cat] || cat.replace(/_/g, ' ');
}

function renderMWEList(results: MWEResult[]): void {
  setLastMWEResults(results);
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

  const videoPlayer = document.getElementById('videoPlayer') as HTMLVideoElement;
  const transcriptList = document.getElementById('transcriptList') as HTMLDivElement;

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
      setKnownSectionCollapsed(!knownSectionCollapsed);
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
  const videoPlayer = document.getElementById('videoPlayer') as HTMLVideoElement;
  const transcriptList = document.getElementById('transcriptList') as HTMLDivElement;

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
        setLastClickedMWEIndex(selectedMWEs.size > 0 ? indexInDisplayList : -1);
      } else if (lastClickedMWEIndex >= 0 && lastClickedMWEIndex !== indexInDisplayList) {
        // Range select from anchor to current
        const start = Math.min(lastClickedMWEIndex, indexInDisplayList);
        const end = Math.max(lastClickedMWEIndex, indexInDisplayList);
        for (let j = start; j <= end; j++) {
          if (j < displayList.length) selectedMWEs.add(displayList[j].normalized_form);
        }
        setLastClickedMWEIndex(indexInDisplayList);
      } else {
        // Select single item
        selectedMWEs.add(form);
        setLastClickedMWEIndex(indexInDisplayList);
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
    setLastClickedMWEIndex(-1);
    renderMWEFlatList(lastMWEResults);
  });

  bar.appendChild(label);
  bar.appendChild(btn);
  // Append to mwePanel (the positioned parent) so it overlays above the scrollable list
  mwePanel.style.position = 'relative';
  mwePanel.appendChild(bar);
}

function setMWETabActive(active: 'categories' | 'list' | 'lemmas') {
  mweTabCategories.className = active === 'categories' ? TAB_ACTIVE : TAB_INACTIVE;
  mweTabList.className = active === 'list' ? TAB_ACTIVE : TAB_INACTIVE;
  mweTabLemmas.className = active === 'lemmas' ? TAB_ACTIVE : TAB_INACTIVE;
}

async function runLemmaAnalysis(method: 'spacy' | 'gpt' = 'spacy'): Promise<void> {
  if (!currentFolder) return;
  if (isLemmaAnalyzing) return;
  setIsLemmaAnalyzing(true);
  const label = method === 'gpt' ? 'GPT' : 'SpaCy';
  const progressId = 'lemma-progress-text';
  const cancelBtnId = 'lemma-cancel-btn';
  mweList.innerHTML = `<div class="py-6 px-3 text-gray-400 text-[12px] text-center flex items-center justify-center gap-2 flex-col"><div class="flex items-center gap-2"><span class="spinner"></span> Analyzing transcript lemmas (${label})...</div><div id="${progressId}" class="text-[10px] text-gray-500"></div><button id="${cancelBtnId}" class="mt-2 px-3 py-1 text-[11px] text-gray-400 hover:text-red-400 border border-gray-600 hover:border-red-400 rounded transition-colors">Cancel</button></div>`;

  const cancelBtn = document.getElementById(cancelBtnId);
  if (cancelBtn) {
    cancelBtn.addEventListener('click', async () => {
      cancelBtn.textContent = 'Cancelling...';
      (cancelBtn as HTMLButtonElement).disabled = true;
      await window.api.cancelLemmaAnalysis();
    });
  }

  if (method === 'gpt') {
    window.api.onLemmaAnalysisProgress((progress: LemmaAnalysisProgress) => {
      const el = document.getElementById(progressId);
      if (el) {
        const pct = Math.round((progress.processedSentences / progress.totalSentences) * 100);
        el.textContent = `Batch ${progress.currentBatch}/${progress.totalBatches} — ${progress.processedSentences}/${progress.totalSentences} sentences (${pct}%)`;
      }
    });
  }

  try {
    const result = method === 'gpt'
      ? await window.api.analyzeTranscriptLemmasGpt(currentFolder)
      : await window.api.analyzeTranscriptLemmas(currentFolder);
    if (result.success && result.lemmas) {
      setCachedTranscriptLemmas(result.lemmas);
      setCachedLemmaAnalyzedAt(result.analyzedAt || new Date().toISOString());
      if (mweView === 'lemmas') {
        renderTranscriptLemmas(result.lemmas);
      }
    } else if (result.error === 'cancelled') {
      mweList.innerHTML = '<div class="py-6 px-3 text-gray-500 text-[12px] text-center">Analysis cancelled.</div>';
    } else {
      mweList.innerHTML = `<div class="py-6 px-3 text-red-400 text-[12px] text-center">${result.error || 'Failed to analyze'}</div>`;
    }
  } catch (err) {
    mweList.innerHTML = `<div class="py-6 px-3 text-red-400 text-[12px] text-center">Error: ${(err as Error).message}</div>`;
  } finally {
    setIsLemmaAnalyzing(false);
  }
}

export function renderTranscriptLemmas(allLemmas: TranscriptLemma[]): void {
  const videoPlayer = document.getElementById('videoPlayer') as HTMLVideoElement;
  const transcriptList = document.getElementById('transcriptList') as HTMLDivElement;

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
      <span class="relative">
        <button id="lemmaReanalyzeBtn" class="text-[10px] text-gray-500 hover:text-gray-300 px-1.5 py-0.5 rounded hover:bg-white/5 transition-colors">re-analyze ▾</button>
        <div id="lemmaReanalyzeDropdown" class="hidden absolute right-0 top-full mt-0.5 bg-bg-secondary border border-border-primary rounded shadow-lg z-50 min-w-[140px]">
          <button data-analyze-method="spacy" class="block w-full text-left text-[10px] text-gray-400 hover:text-gray-200 hover:bg-white/5 px-3 py-1.5">SpaCy pipeline</button>
          <button data-analyze-method="gpt" class="block w-full text-left text-[10px] text-gray-400 hover:text-gray-200 hover:bg-white/5 px-3 py-1.5">GPT 5.4 nano</button>
        </div>
      </span>
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

  // Store the filtered list in state for shift-click selection and Cmd+D
  setDisplayedLemmaList(filtered);

  // Helper to render a single lemma row
  // inGroupedView: true when inside Known view with section headers (skip redundant CEFR pill & checkmark)
  const renderLemmaRow = (lemma: TranscriptLemma, dimmed: boolean, inGroupedView = false) => {
    const displayIdx = filtered.indexOf(lemma);
    const isSelected = selectedLemmaIndices.has(displayIdx);
    const posColor = posColors[lemma.pos] || 'text-gray-400';
    const posLabel = posLabels[lemma.pos] || lemma.pos.toLowerCase();
    const knownDim = dimmed && !isSelected ? ' opacity-50' : '';
    const selectedClass = isSelected ? ' bg-accent/20 border-l-2 border-l-accent' : '';
    const cefrPill = (!inGroupedView && lemma.cefr_level)
      ? `<span class="text-[9px] px-1 py-px rounded ${cefrColors[lemma.cefr_level] || 'bg-gray-700 text-gray-400'} shrink-0">${lemma.cefr_level}</span>`
      : '';
    const checkmark = (!inGroupedView && lemma.is_known)
      ? '<span class="text-[9px] text-green-600 shrink-0">✓</span>'
      : '';
    const oneTBadge = (lemma.one_t_count || 0) > 0
      ? `<span class="text-[9px] font-mono text-amber-500/70 shrink-0" title="Learning this word unlocks ${lemma.one_t_count} fully-comprehensible sentence${lemma.one_t_count > 1 ? 's' : ''}">1T×${lemma.one_t_count}</span>`
      : '';

    const hoverClass = isSelected ? 'hover:bg-accent/30' : 'hover:bg-bg-primary/50';
    return `<div class="px-3 py-1.5 ${hoverClass} transition-colors cursor-pointer lemma-entry${knownDim}${selectedClass}" data-sentence-index="${lemma.first_sentence_index}" data-display-index="${displayIdx}">
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
          <span class="text-[11px] text-gray-400">From decks &amp; manually marked</span>
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

  // Add click handlers: shift-click for selection, plain click to navigate
  mweList.querySelectorAll('.lemma-entry').forEach((el) => {
    el.addEventListener('mousedown', (e: Event) => {
      if ((e as MouseEvent).shiftKey) e.preventDefault();
    });

    el.addEventListener('click', (e: Event) => {
      const me = e as MouseEvent;
      const htmlEl = el as HTMLElement;
      const displayIdx = parseInt(htmlEl.dataset.displayIndex || '-1', 10);
      const sentenceIndex = parseInt(htmlEl.dataset.sentenceIndex || '-1', 10);

      if (me.shiftKey && displayIdx >= 0) {
        me.preventDefault();
        if (selectedLemmaIndices.has(displayIdx) && selectedLemmaIndices.size === 1) {
          // Only item selected — deselect it
          selectedLemmaIndices.clear();
          setLastClickedLemmaIndex(-1);
        } else if (lastClickedLemmaIndex >= 0 && lastClickedLemmaIndex !== displayIdx) {
          // Clear previous selection and select fresh range from anchor to here
          selectedLemmaIndices.clear();
          const start = Math.min(lastClickedLemmaIndex, displayIdx);
          const end = Math.max(lastClickedLemmaIndex, displayIdx);
          for (let j = start; j <= end; j++) {
            if (j < filtered.length) selectedLemmaIndices.add(j);
          }
        } else {
          // No anchor yet: select this item as anchor
          selectedLemmaIndices.clear();
          selectedLemmaIndices.add(displayIdx);
          setLastClickedLemmaIndex(displayIdx);
        }
        renderTranscriptLemmas(allLemmas);
      } else {
        // Plain click: navigate to first occurrence
        if (sentenceIndex >= 0 && sentenceIndex < subtitles.length) {
          videoPlayer.currentTime = subtitles[sentenceIndex].start;
          const entry = transcriptList.children[sentenceIndex] as HTMLElement;
          if (entry) entry.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }
    });
  });

  renderLemmaActionBar();
}

function getSelectedLemmas(): TranscriptLemma[] {
  const result: TranscriptLemma[] = [];
  for (const idx of selectedLemmaIndices) {
    if (idx < displayedLemmaList.length) result.push(displayedLemmaList[idx]);
  }
  return result;
}

function renderLemmaActionBar(): void {
  const existing = document.getElementById('lemmaActionBar');
  if (existing) existing.remove();

  if (selectedLemmaIndices.size === 0) return;

  const selected = getSelectedLemmas();
  const allKnown = selected.length > 0 && selected.every(l => l.is_known && l.known_source === 'deck');

  const mweList = document.getElementById('mweList') as HTMLDivElement;
  const bar = document.createElement('div');
  bar.id = 'lemmaActionBar';
  bar.className = 'absolute top-1 right-2 z-20 flex items-center gap-2 bg-bg-secondary border border-border-primary rounded-md px-2.5 py-1.5 shadow-lg';

  const label = document.createElement('span');
  label.className = 'text-[10px] text-gray-400';
  label.textContent = `${selectedLemmaIndices.size}`;

  const knownBtn = document.createElement('button');
  knownBtn.className = 'text-[10px] px-2.5 py-0.5 rounded font-semibold cursor-pointer transition-colors '
    + (allKnown
      ? 'bg-gray-700 text-gray-200 hover:bg-gray-600'
      : 'bg-accent text-white hover:bg-accent/80');
  knownBtn.textContent = allKnown ? '⌘S Unknown' : '⌘S Known';
  knownBtn.addEventListener('click', () => markSelectedLemmasKnown(!allKnown));

  const cardBtn = document.createElement('button');
  cardBtn.className = 'text-[10px] px-2.5 py-0.5 rounded font-semibold cursor-pointer transition-colors bg-blue-600 text-white hover:bg-blue-500';
  cardBtn.textContent = '⌘D Cards';
  cardBtn.addEventListener('click', () => sendSelectedLemmasToCards());

  bar.appendChild(label);
  bar.appendChild(knownBtn);
  bar.appendChild(cardBtn);
  mweList.appendChild(bar);
}

async function markSelectedLemmasKnown(known: boolean): Promise<void> {
  const selected = getSelectedLemmas();
  if (selected.length === 0) return;

  await window.api.markLemmasKnown({
    lemmas: selected.map(l => ({ lemma: l.lemma, pos: l.pos, general_freq: l.general_freq, cefr_level: l.cefr_level })),
    known,
  });

  // Update local state
  for (const l of selected) {
    if (known) {
      l.is_known = true;
      l.known_source = 'deck';
    } else {
      // Only unmark if it was manually marked; level-inferred stays known
      l.known_source = null;
      l.is_known = false;
    }
  }

  selectedLemmaIndices.clear();
  setLastClickedLemmaIndex(-1);
  if (cachedTranscriptLemmas) renderTranscriptLemmas(cachedTranscriptLemmas);
}

async function sendSelectedLemmasToCards(): Promise<void> {
  if (selectedLemmaIndices.size === 0 || !currentFolder) return;

  const selectedLemmas: TranscriptLemma[] = [];
  for (const idx of selectedLemmaIndices) {
    if (idx < displayedLemmaList.length) {
      selectedLemmas.push(displayedLemmaList[idx]);
    }
  }
  if (selectedLemmas.length === 0) return;

  const folder = currentFolder;

  // Show progress in action bar
  const bar = document.getElementById('lemmaActionBar');
  if (bar) {
    bar.innerHTML = `<span class="text-[10px] text-gray-400"><span class="spinner"></span> Explaining 0/${selectedLemmas.length}...</span>`;
  }

  const cards = await window.api.loadCards(folder);
  let addedCount = 0;

  for (let i = 0; i < selectedLemmas.length; i++) {
    const lemma = selectedLemmas[i];

    // Skip if a card for this lemma already exists
    if (cards.some(c => c.selectedText === lemma.lemma && c.source === currentVideoTitle)) continue;

    const sentIdx = lemma.first_sentence_index;
    const sub = sentIdx >= 0 && sentIdx < subtitles.length ? subtitles[sentIdx] : null;
    const fullSentence = sub ? sub.text : lemma.lemma;
    const sentenceBefore = sub && sentIdx > 0
      ? subtitles.slice(Math.max(0, sentIdx - 6), sentIdx).map(s => s.text).join(' ')
      : '';
    const sentenceAfter = sub && sentIdx < subtitles.length - 1
      ? subtitles.slice(sentIdx + 1, Math.min(subtitles.length, sentIdx + 7)).map(s => s.text).join(' ')
      : '';

    // Update progress
    if (bar) {
      bar.innerHTML = `<span class="text-[10px] text-gray-400"><span class="spinner"></span> Explaining ${i + 1}/${selectedLemmas.length}...</span>`;
    }

    // Call the same explain API used by the transcript selection flow
    let meaning = '';
    let translation = '';
    try {
      const result = await window.api.explainText({
        selectedText: lemma.lemma,
        fullSentence,
        sentenceBefore,
        sentenceAfter,
      });
      if (result.success) {
        meaning = result.explanation || '';
        translation = result.translation || '';
      }
    } catch { /* proceed without explanation */ }

    const card: import('../../shared/types').Card = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      expression: fullSentence,
      meaning,
      translation,
      targetLineBefore: sub && sentIdx > 0 ? subtitles[sentIdx - 1].text : '',
      targetLineAfter: sub && sentIdx < subtitles.length - 1 ? subtitles[sentIdx + 1].text : '',
      selectedText: lemma.lemma,
      time: sub ? formatLemmaTime(sub.start) : '',
      source: currentVideoTitle,
      startTime: sub ? sub.start : 0,
      endTime: sub ? sub.end : 0,
      createdAt: Date.now(),
    };
    cards.push(card);
    addedCount++;
  }

  await window.api.saveCards(folder, cards);

  // Clear selection and re-render
  selectedLemmaIndices.clear();
  setLastClickedLemmaIndex(-1);
  if (cachedTranscriptLemmas) renderTranscriptLemmas(cachedTranscriptLemmas);

  // Refresh cards sidebar if it's active
  if (sidebarView === 'cards') {
    const { renderCardsView } = await import('./cards');
    renderCardsView(folder, currentVideoTitle);
  }

  // Show brief confirmation
  const confirmBar = document.getElementById('lemmaActionBar') || document.createElement('div');
  confirmBar.id = 'lemmaActionBar';
  confirmBar.className = 'absolute top-1 right-2 z-20 flex items-center gap-2 bg-bg-secondary border border-border-primary rounded-md px-2.5 py-1.5 shadow-lg';
  confirmBar.innerHTML = `<span class="text-[10px] text-green-400">${addedCount} card${addedCount !== 1 ? 's' : ''} created</span>`;
  const mweList = document.getElementById('mweList') as HTMLDivElement;
  if (!confirmBar.parentElement) mweList.appendChild(confirmBar);
  setTimeout(() => confirmBar.remove(), 2000);
}

function formatLemmaTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function attachLemmaFilterListeners(): void {
  mweList.querySelectorAll('[data-lemma-filter]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      selectedLemmaIndices.clear();
      setLastClickedLemmaIndex(-1);
      setLemmaFilter((btn as HTMLElement).dataset.lemmaFilter as 'all' | 'unknown' | 'known');
      if (cachedTranscriptLemmas) renderTranscriptLemmas(cachedTranscriptLemmas);
    });
  });

  mweList.querySelectorAll('[data-cefr-filter]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      selectedLemmaIndices.clear();
      setLastClickedLemmaIndex(-1);
      setLemmaCefrFilter((btn as HTMLElement).dataset.cefrFilter || 'all');
      if (cachedTranscriptLemmas) renderTranscriptLemmas(cachedTranscriptLemmas);
    });
  });

  const reanalyzeBtn = document.getElementById('lemmaReanalyzeBtn');
  const reanalyzeDropdown = document.getElementById('lemmaReanalyzeDropdown');
  if (reanalyzeBtn && reanalyzeDropdown) {
    reanalyzeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      reanalyzeDropdown.classList.toggle('hidden');
    });
    reanalyzeDropdown.querySelectorAll('[data-analyze-method]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        reanalyzeDropdown.classList.add('hidden');
        const method = (btn as HTMLElement).dataset.analyzeMethod as 'spacy' | 'gpt';
        setCachedTranscriptLemmas(null);
        setCachedLemmaAnalyzedAt(null);
        runLemmaAnalysis(method);
      });
    });
    // Close dropdown when clicking elsewhere
    document.addEventListener('click', () => {
      reanalyzeDropdown.classList.add('hidden');
    });
  }
}

// --- Exported functions ---

export async function loadMWEsForFolder(folder: string): Promise<void> {
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

export function initMWEPanel(): void {
  // Resolve DOM elements
  mwePanel = document.getElementById('mwePanel') as HTMLDivElement;
  mweList = document.getElementById('mweList') as HTMLDivElement;
  extractMWEsBtn = document.getElementById('extractMWEsBtn') as HTMLButtonElement;
  mweProgress = document.getElementById('mweProgress') as HTMLDivElement;
  mweProgressText = document.getElementById('mweProgressText') as HTMLSpanElement;
  mweTabCategories = document.getElementById('mweTabCategories') as HTMLButtonElement;
  mweTabList = document.getElementById('mweTabList') as HTMLButtonElement;
  mweTabLemmas = document.getElementById('mweTabLemmas') as HTMLButtonElement;

  // Tab click listeners
  mweTabCategories.addEventListener('click', () => {
    setMWEView('categories');
    selectedMWEs.clear();
    setLastClickedMWEIndex(-1);
    setMWETabActive('categories');
    if (lastMWEResults.length > 0) renderMWEByCategory(lastMWEResults);
  });

  mweTabList.addEventListener('click', () => {
    setMWEView('list');
    setMWETabActive('list');
    if (lastMWEResults.length > 0) renderMWEFlatList(lastMWEResults);
  });

  mweTabLemmas.addEventListener('click', async () => {
    setMWEView('lemmas');
    setMWETabActive('lemmas');

    // Default CEFR filter to user's set level on first open
    if (lemmaCefrFilter === 'all') {
      const userLevelSelect = document.getElementById('userLevelSelect') as HTMLSelectElement | null;
      setLemmaCefrFilter((userLevelSelect && userLevelSelect.value) || 'B1');
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

  // Extract button handler
  extractMWEsBtn.addEventListener('click', async () => {
    // Cancel if already extracting
    if (isMWEExtracting) {
      extractMWEsBtn.disabled = true;
      extractMWEsBtn.textContent = 'Cancelling...';
      await window.api.cancelMWEExtraction();
      return;
    }

    if (!currentFolder || subtitles.length === 0) return;

    setIsMWEExtracting(true);
    extractMWEsBtn.textContent = 'Cancel';
    mweProgress.classList.remove('hidden');
    mweProgressText.textContent = 'Starting extraction...';

    const subsData = subtitles.map((s, i) => ({ index: i, text: s.text }));

    const result = await window.api.extractMWEs({ folder: currentFolder, subtitles: subsData });

    mweProgress.classList.add('hidden');
    setIsMWEExtracting(false);
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

  // MWE progress listener
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

  // Cmd+D shortcut: MWE view → toggle known/unknown; Lemma view → send to cards
  document.addEventListener('keydown', async (e: KeyboardEvent) => {
    if (e.metaKey && e.key === 'd') {
      e.preventDefault();

      // Handle lemma selection → send to cards
      if (selectedLemmaIndices.size > 0 && mweView === 'lemmas') {
        await sendSelectedLemmasToCards();
        return;
      }

      // Handle MWE selection → toggle known/unknown
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
      setLastClickedMWEIndex(-1);
      renderMWEFlatList(lastMWEResults);
    }

    // Cmd+S shortcut: toggle known/unknown on selected lemmas
    if (e.metaKey && e.key === 's') {
      e.preventDefault();
      if (selectedLemmaIndices.size > 0 && mweView === 'lemmas') {
        const selected = getSelectedLemmas();
        const allKnown = selected.length > 0 && selected.every(l => l.is_known && l.known_source === 'deck');
        await markSelectedLemmasKnown(!allKnown);
      }
    }
  });
}
