import {
  sidebarView,
  setSidebarView,
  currentFolder,
  setCurrentFolder,
  currentVideoTitle,
} from '../state';
import { escapeHtml } from '../utils';
import { renderCardsView } from './cards';
import { selectVideo } from './video-player';

// --- Resize state (module-local) ---
let isVideoResizing = false;
let videoResizeStartY = 0;
let videoResizeStartHeight = 0;

let isSidebarResizing = false;
let sidebarResizeStartX = 0;
let sidebarResizeStartWidth = 0;

let isExplainResizing = false;
let explainResizeStartY = 0;
let explainResizeStartHeight = 0;

let isMWEResizing = false;
let mweResizeStartX = 0;
let mweResizeStartWidth = 0;

// --- DOM references (resolved once at init) ---
let sidebarList: HTMLDivElement;
let sidebarHeader: HTMLDivElement;
let videoSection: HTMLDivElement;
let videoResizeHandle: HTMLDivElement;
let contentEl: HTMLDivElement;
let sidebar: HTMLDivElement;
let sidebarResizeHandle: HTMLDivElement;
let explainPanel: HTMLDivElement;
let explainResizeHandle: HTMLDivElement;
let mwePanel: HTMLDivElement;
let mweResizeHandle: HTMLDivElement;
let videoPlayer: HTMLVideoElement;
let welcomeEl: HTMLDivElement;

export async function refreshSidebar(): Promise<void> {
  if (sidebarView === 'cards' && currentFolder) {
    renderCardsView(currentFolder, currentVideoTitle);
    return;
  }

  // Restore header to default
  sidebarHeader.innerHTML = 'Downloaded Videos';

  const videos = await window.api.listDownloads();
  sidebarList.innerHTML = '';

  if (videos.length === 0) {
    sidebarList.innerHTML =
      '<div class="py-6 px-4 text-gray-600 text-[13px] text-center">No videos yet</div>';
    return;
  }

  for (const video of videos) {
    const item = document.createElement('div');
    item.className =
      'sidebar-item group py-2.5 px-4 cursor-pointer transition-colors duration-150 border-l-[3px] border-l-transparent flex items-center gap-2 hover:bg-accent/10' +
      (video.folder === currentFolder ? ' active' : '');
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
          setCurrentFolder(null);
          setSidebarView('videos');
          contentEl.classList.remove('visible');
          welcomeEl.style.display = '';
        }
        refreshSidebar();
      }
    });

    sidebarList.appendChild(item);
  }
}

export function initLayout(): void {
  // --- Resolve DOM elements ---
  sidebarList = document.getElementById('sidebarList') as HTMLDivElement;
  sidebarHeader = document.querySelector('#sidebar > div:first-child') as HTMLDivElement;
  videoSection = document.getElementById('videoSection') as HTMLDivElement;
  videoResizeHandle = document.getElementById('videoResizeHandle') as HTMLDivElement;
  contentEl = document.getElementById('content') as HTMLDivElement;
  sidebar = document.getElementById('sidebar') as HTMLDivElement;
  sidebarResizeHandle = document.getElementById('sidebarResizeHandle') as HTMLDivElement;
  explainPanel = document.getElementById('explainPanel') as HTMLDivElement;
  explainResizeHandle = document.getElementById('explainResizeHandle') as HTMLDivElement;
  mwePanel = document.getElementById('mwePanel') as HTMLDivElement;
  mweResizeHandle = document.getElementById('mweResizeHandle') as HTMLDivElement;
  videoPlayer = document.getElementById('videoPlayer') as HTMLVideoElement;
  welcomeEl = document.getElementById('welcome') as HTMLDivElement;

  // --- Load sidebar on startup ---
  refreshSidebar();

  // --- Space bar toggles video play/pause (unless an input/button/select has focus) ---
  document.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.code !== 'Space') return;
    const tag = (document.activeElement?.tagName ?? '').toLowerCase();
    if (['input', 'textarea', 'button', 'select'].includes(tag)) return;
    if (videoPlayer.src) {
      e.preventDefault();
      videoPlayer.paused ? videoPlayer.play() : videoPlayer.pause();
    }
  });

  // --- Video / transcript resize handle ---
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
  explainResizeHandle.addEventListener('mousedown', (e: MouseEvent) => {
    isExplainResizing = true;
    explainResizeStartY = e.clientY;
    explainResizeStartHeight = explainPanel.offsetHeight;
    explainResizeHandle.classList.add('dragging');
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';
    e.preventDefault();
  });

  // --- MWE panel resize handle ---
  mweResizeHandle.addEventListener('mousedown', (e: MouseEvent) => {
    isMWEResizing = true;
    mweResizeStartX = e.clientX;
    mweResizeStartWidth = mwePanel.offsetWidth;
    mweResizeHandle.classList.add('dragging');
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    e.preventDefault();
  });

  // --- Unified mousemove / mouseup for all resize handles ---
  document.addEventListener('mousemove', (e: MouseEvent) => {
    if (isVideoResizing) {
      const delta = e.clientY - videoResizeStartY;
      const contentHeight = contentEl.offsetHeight;
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
}
