import { currentFolder, setCurrentFolder } from '../state';
import { escapeHtml } from '../utils';
import { refreshSidebar } from './layout';
import { loadVideo } from './video-player';

let isDownloading = false;

const urlInput = document.getElementById('urlInput') as HTMLInputElement;
const downloadBtn = document.getElementById('downloadBtn') as HTMLButtonElement;
const progressEl = document.getElementById('progress') as HTMLDivElement;
const transcriptionMethodSelect = document.getElementById('transcriptionMethod') as HTMLSelectElement;
const step4Label = document.getElementById('step4Label') as HTMLSpanElement;

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

async function startDownload(): Promise<void> {
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

  const method = transcriptionMethodSelect.value;
  step4Label.textContent = method === 'elevenlabs' ? 'ElevenLabs Scribe' : 'Whisper transcription';

  const result = await window.api.downloadVideo(url, method);

  isDownloading = false;
  downloadBtn.disabled = false;

  if (result.success) {
    updatePipeline(5);
    setCurrentFolder(result.folder!);
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

export function initDownload(): void {
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

  urlInput.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Enter') startDownload();
  });

  (window as any).startDownload = startDownload;
}
