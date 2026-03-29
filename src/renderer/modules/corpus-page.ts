import type { MWEResult, CorpusProgress } from '../../shared/types';
import { escapeHtml } from '../utils';
import { persistDeckSettings } from './anki-ui';
import { registerOnNavigate } from './navigation';
import {
  ankiConnected,
  selectedCorpusDecks,
  corpusSentences, setCorpusSentences,
  corpusLemmas, setCorpusLemmas,
  pendingMWEs, setPendingMWEs,
  mweCheckedSet, setMWECheckedSet,
  corpusDeckName, setCorpusDeckName,
  corpusLemmaCount, setCorpusLemmaCount,
  corpusNewSentenceCount, setCorpusNewSentenceCount,
  corpusSkippedCount, setCorpusSkippedCount,
  setCachedTranscriptLemmas,
  setCachedLemmaAnalyzedAt,
} from '../state';

export async function loadCorpusDecks(): Promise<void> {
  const corpusDeckList = document.getElementById('corpusDeckList') as HTMLDivElement;
  const corpusFetchBtn = document.getElementById('corpusFetchBtn') as HTMLButtonElement;

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
  const corpusDeckInfo = document.getElementById('corpusDeckInfo') as HTMLDivElement;
  const corpusFetchBtn = document.getElementById('corpusFetchBtn') as HTMLButtonElement;

  const count = selectedCorpusDecks.size;
  corpusDeckInfo.textContent = count === 0 ? 'No decks selected' : `${count} deck${count > 1 ? 's' : ''} selected`;
  corpusFetchBtn.disabled = count === 0;
}

function setCorpusBuildBtnsDisabled(disabled: boolean): void {
  const corpusBuildLemmasBtn = document.getElementById('corpusBuildLemmasBtn') as HTMLButtonElement;
  const corpusBuildMWEsBtn = document.getElementById('corpusBuildMWEsBtn') as HTMLButtonElement;
  const corpusBuildBothBtn = document.getElementById('corpusBuildBothBtn') as HTMLButtonElement;

  corpusBuildLemmasBtn.disabled = disabled;
  corpusBuildMWEsBtn.disabled = disabled;
  corpusBuildBothBtn.disabled = disabled;
}

async function runCorpusBuild(mode: 'lemmas' | 'mwes' | 'both'): Promise<void> {
  const corpusCancelBtn = document.getElementById('corpusCancelBtn') as HTMLButtonElement;
  const corpusBuildProgress = document.getElementById('corpusBuildProgress') as HTMLDivElement;
  const corpusBuildProgressText = document.getElementById('corpusBuildProgressText') as HTMLSpanElement;
  const corpusMWEReview = document.getElementById('corpusMWEReview') as HTMLDivElement;

  if (corpusSentences.length === 0) return;

  setCorpusDeckName([...selectedCorpusDecks].join('+'));
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
      setCorpusLemmaCount(res.lemmaCount || 0);
      setCorpusSkippedCount(res.skippedCount || 0);
      setCorpusNewSentenceCount(res.sentenceCount || 0);

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

function showMWEReview(mwes: MWEResult[]): void {
  const corpusMWEReview = document.getElementById('corpusMWEReview') as HTMLDivElement;
  const corpusMWEReviewCount = document.getElementById('corpusMWEReviewCount') as HTMLSpanElement;
  const corpusMWEReviewList = document.getElementById('corpusMWEReviewList') as HTMLDivElement;

  setPendingMWEs(mwes);
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
  setMWECheckedSet(new Set(mwes.map((_, i) => i)));

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
        <span class="text-[10px] text-gray-600">\u00d7${entry.indices.length}</span>
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
  const corpusMWESelectedCount = document.getElementById('corpusMWESelectedCount') as HTMLSpanElement;
  const corpusMWEApproveBtn = document.getElementById('corpusMWEApproveBtn') as HTMLButtonElement;

  corpusMWESelectedCount.textContent = `${mweCheckedSet.size} of ${pendingMWEs.length} instances selected`;
  corpusMWEApproveBtn.disabled = mweCheckedSet.size === 0;
}

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

export async function refreshCorpusStats(): Promise<void> {
  const statTotalLemmas = document.getElementById('statTotalLemmas') as HTMLDivElement;
  const statTotalMWEs = document.getElementById('statTotalMWEs') as HTMLDivElement;
  const statKnownMWEs = document.getElementById('statKnownMWEs') as HTMLDivElement;
  const statUnknownMWEs = document.getElementById('statUnknownMWEs') as HTMLDivElement;
  const statLemmasByPos = document.getElementById('statLemmasByPos') as HTMLDivElement;
  const statMWEsByCategory = document.getElementById('statMWEsByCategory') as HTMLDivElement;
  const statImports = document.getElementById('statImports') as HTMLDivElement;
  const statEstimatedLevel = document.getElementById('statEstimatedLevel') as HTMLDivElement;
  const statFrequencyBands = document.getElementById('statFrequencyBands') as HTMLDivElement;

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

async function searchLemma(): Promise<void> {
  const lemmaSearchInput = document.getElementById('lemmaSearchInput') as HTMLInputElement;
  const lemmaSearchBtn = document.getElementById('lemmaSearchBtn') as HTMLButtonElement;
  const lemmaSearchResult = document.getElementById('lemmaSearchResult') as HTMLDivElement;

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
      lemmaSearchResult.innerHTML = `<span class="font-semibold">${query}</span> found \u2014 POS: <span class="text-white font-mono">${res.pos || '?'}</span>, Source: <span class="text-white">${res.source_deck || '?'}</span>`;
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

export function initCorpusPage(): void {
  const corpusFetchBtn = document.getElementById('corpusFetchBtn') as HTMLButtonElement;
  const corpusBuildLemmasBtn = document.getElementById('corpusBuildLemmasBtn') as HTMLButtonElement;
  const corpusBuildMWEsBtn = document.getElementById('corpusBuildMWEsBtn') as HTMLButtonElement;
  const corpusBuildBothBtn = document.getElementById('corpusBuildBothBtn') as HTMLButtonElement;
  const corpusCancelBtn = document.getElementById('corpusCancelBtn') as HTMLButtonElement;
  const corpusMWESelectAll = document.getElementById('corpusMWESelectAll') as HTMLButtonElement;
  const corpusMWEDeselectAll = document.getElementById('corpusMWEDeselectAll') as HTMLButtonElement;
  const corpusMWEApproveBtn = document.getElementById('corpusMWEApproveBtn') as HTMLButtonElement;
  const corpusMWEReview = document.getElementById('corpusMWEReview') as HTMLDivElement;
  const corpusMWEReviewList = document.getElementById('corpusMWEReviewList') as HTMLDivElement;
  const corpusPreview = document.getElementById('corpusPreview') as HTMLDivElement;
  const corpusSentenceCount = document.getElementById('corpusSentenceCount') as HTMLSpanElement;
  const corpusSentenceList = document.getElementById('corpusSentenceList') as HTMLDivElement;
  const corpusBuildProgressText = document.getElementById('corpusBuildProgressText') as HTMLSpanElement;
  const corpusResetBtn = document.getElementById('corpusResetBtn') as HTMLButtonElement;
  const userLevelSelect = document.getElementById('userLevelSelect') as HTMLSelectElement;
  const lemmaSearchInput = document.getElementById('lemmaSearchInput') as HTMLInputElement;
  const lemmaSearchBtn = document.getElementById('lemmaSearchBtn') as HTMLButtonElement;

  // Navigation is handled by navigation.ts — register our on-navigate callback
  registerOnNavigate('corpus', () => {
    loadCorpusDecks();
    refreshCorpusStats();
  });

  // --- corpusFetchBtn click ---
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

      setCorpusSentences(res.sentences || []);
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
        setCorpusLemmas(Array.from(lemmaMap.entries())
          .map(([lemma, pos]) => ({ lemma, pos }))
          .sort((a, b) => a.lemma.localeCompare(b.lemma)));
        corpusBuildLemmasBtn.textContent = `Lemmas Only (${corpusLemmas.length})`;
        corpusBuildBothBtn.textContent = `Both (${corpusLemmas.length} lemmas + MWEs)`;
      } else {
        // SpaCy failed -- fall back to Migaku lemmas if available
        if (migakuLemmas.length > 0) {
          setCorpusLemmas(migakuLemmas);
          corpusBuildLemmasBtn.textContent = `Lemmas Only (${corpusLemmas.length}, Migaku only)`;
          corpusBuildBothBtn.textContent = `Both (${corpusLemmas.length} lemmas + MWEs)`;
        } else {
          corpusBuildLemmasBtn.textContent = 'Lemmas Only (extraction failed)';
          corpusBuildLemmasBtn.disabled = true;
          corpusBuildBothBtn.textContent = 'Both (lemma extraction failed)';
          corpusBuildBothBtn.disabled = true;
          setCorpusLemmas([]);
        }
      }
      setCorpusBuildBtnsDisabled(false);

    } finally {
      corpusFetchBtn.textContent = 'Fetch Sentences';
      corpusFetchBtn.disabled = selectedCorpusDecks.size === 0;
    }
  });

  // --- Build buttons ---
  corpusBuildLemmasBtn.addEventListener('click', () => runCorpusBuild('lemmas'));
  corpusBuildMWEsBtn.addEventListener('click', () => runCorpusBuild('mwes'));
  corpusBuildBothBtn.addEventListener('click', () => runCorpusBuild('both'));

  // --- Cancel button ---
  corpusCancelBtn.addEventListener('click', () => {
    window.api.cancelCorpusBuild();
  });

  // --- Corpus progress listener ---
  window.api.onCorpusProgress((progress: CorpusProgress) => {
    corpusBuildProgressText.textContent = progress.message;
  });

  // --- MWE Select All ---
  corpusMWESelectAll.addEventListener('click', () => {
    setMWECheckedSet(new Set(pendingMWEs.map((_, i) => i)));
    corpusMWEReviewList.querySelectorAll<HTMLInputElement>('input[type="checkbox"]').forEach(cb => { cb.checked = true; });
    updateMWESelectedCount();
  });

  // --- MWE Deselect All ---
  corpusMWEDeselectAll.addEventListener('click', () => {
    mweCheckedSet.clear();
    corpusMWEReviewList.querySelectorAll<HTMLInputElement>('input[type="checkbox"]').forEach(cb => { cb.checked = false; });
    updateMWESelectedCount();
  });

  // --- MWE Approve ---
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
        setPendingMWEs([]);
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

  // --- Reset lemma database ---
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

  // --- Lemma search ---
  lemmaSearchBtn.addEventListener('click', searchLemma);
  lemmaSearchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') searchLemma();
  });

  // --- User level change ---
  userLevelSelect.addEventListener('change', () => {
    persistDeckSettings();
    // Invalidate cached transcript lemmas so they re-tag with new level
    setCachedTranscriptLemmas(null);
    setCachedLemmaAnalyzedAt(null);
  });
}
