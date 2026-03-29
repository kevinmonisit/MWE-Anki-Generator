import { currentPage, setCurrentPage } from '../state';

type PageName = 'main' | 'corpus' | 'speech-analysis';

// Callbacks that pages register to be called on navigation
const onNavigateCallbacks: Record<string, () => void> = {};

export function registerOnNavigate(page: string, callback: () => void): void {
  onNavigateCallbacks[page] = callback;
}

const NAV_BUTTONS: { id: string; page: PageName; label: string }[] = [
  { id: 'navMainBtn', page: 'main', label: 'Download' },
  { id: 'corpusNavBtn', page: 'corpus', label: 'Corpus' },
  { id: 'speechAnalysisNavBtn', page: 'speech-analysis', label: 'Speech Analysis' },
];

export function switchToPage(page: PageName): void {
  const mainPage = document.getElementById('mainPage') as HTMLDivElement;
  const corpusPage = document.getElementById('corpusPage') as HTMLDivElement;
  const speechAnalysisPage = document.getElementById('speechAnalysisPage') as HTMLDivElement;
  const progressEl = document.getElementById('progress') as HTMLDivElement;
  const urlInputBar = document.getElementById('urlInputBar') as HTMLDivElement;
  const ankiStatusBar = document.getElementById('ankiStatusBar') as HTMLDivElement;

  setCurrentPage(page);

  // Hide all pages
  mainPage.classList.add('hidden');
  corpusPage.classList.add('hidden');
  corpusPage.classList.remove('flex');
  speechAnalysisPage.classList.add('hidden');
  speechAnalysisPage.classList.remove('flex');

  // Update nav button styles
  for (const btn of NAV_BUTTONS) {
    const el = document.getElementById(btn.id) as HTMLButtonElement;
    if (btn.page === page) {
      el.className = 'py-1.5 px-4 rounded-md text-sm font-semibold cursor-pointer transition-colors bg-accent text-white';
    } else {
      el.className = 'py-1.5 px-4 rounded-md text-sm font-semibold cursor-pointer transition-colors bg-transparent text-gray-400 hover:text-accent';
    }
  }

  // Show/hide page-specific bars
  if (page === 'main') {
    mainPage.classList.remove('hidden');
    urlInputBar.classList.remove('hidden');
    ankiStatusBar.classList.remove('hidden');
  } else if (page === 'corpus') {
    progressEl.classList.remove('visible');
    corpusPage.classList.remove('hidden');
    corpusPage.classList.add('flex');
    urlInputBar.classList.add('hidden');
    ankiStatusBar.classList.remove('hidden');
  } else if (page === 'speech-analysis') {
    progressEl.classList.remove('visible');
    speechAnalysisPage.classList.remove('hidden');
    speechAnalysisPage.classList.add('flex');
    urlInputBar.classList.add('hidden');
    ankiStatusBar.classList.add('hidden');
  }

  // Call registered callback for the target page
  if (onNavigateCallbacks[page]) {
    onNavigateCallbacks[page]();
  }
}

export function initNavigation(): void {
  for (const btn of NAV_BUTTONS) {
    const el = document.getElementById(btn.id) as HTMLButtonElement;
    el.addEventListener('click', () => {
      switchToPage(btn.page);
    });
  }
}
