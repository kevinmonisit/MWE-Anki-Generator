/**
 * Renderer entry point.
 * Imports and initializes all UI modules.
 * Bundled by esbuild into dist/renderer.js (iife, browser).
 */

import { initLayout } from './modules/layout';
import { initVideoPlayer } from './modules/video-player';
import { initCards } from './modules/cards';
import { initDownload } from './modules/download';
import { initAnkiUI } from './modules/anki-ui';
import { initMWEPanel } from './modules/mwe-panel';
import { initCorpusPage } from './modules/corpus-page';

// Initialize all modules — order matters where there are dependencies
initLayout();
initVideoPlayer();
initCards();
initDownload();
initAnkiUI();
initMWEPanel();
initCorpusPage();
