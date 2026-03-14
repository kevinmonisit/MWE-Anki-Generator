const { app, BrowserWindow, ipcMain, protocol, net } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs');
let mainWindow;
const DOWNLOADS_DIR = path.join(__dirname, 'downloads');

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 850,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile('index.html');
}

app.whenReady().then(() => {
  protocol.handle('local-video', (request) => {
    const filePath = decodeURIComponent(request.url.slice('local-video://'.length));
    const stat = fs.statSync(filePath);
    const fileSize = stat.size;
    const rangeHeader = request.headers.get('range');

    if (rangeHeader) {
      const parts = rangeHeader.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
      const chunkSize = end - start + 1;
      const stream = fs.createReadStream(filePath, { start, end });

      return new Response(stream, {
        status: 206,
        headers: {
          'Content-Range': `bytes ${start}-${end}/${fileSize}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': String(chunkSize),
          'Content-Type': 'video/mp4',
        },
      });
    }

    const stream = fs.createReadStream(filePath);
    return new Response(stream, {
      status: 200,
      headers: {
        'Content-Length': String(fileSize),
        'Content-Type': 'video/mp4',
        'Accept-Ranges': 'bytes',
      },
    });
  });

  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// IPC: Download video using Python script
ipcMain.handle('download-video', async (event, url) => {
  return new Promise((resolve, reject) => {
    const scriptPath = path.join(__dirname, './scripts/download.py');

    const proc = spawn('python3', [scriptPath, url, DOWNLOADS_DIR], {
      cwd: __dirname,
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => {
      const msg = data.toString();
      stdout += msg;
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('download-progress', msg.trim());
      }
    });

    proc.stderr.on('data', (data) => {
      const msg = data.toString();
      stderr += msg;
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('download-progress', `[stderr] ${msg.trim()}`);
      }
    });

    proc.on('close', (code) => {
      if (code === 0) {
        const folderMatch = stdout.match(/FOLDER:(.+)/);
        const folderName = folderMatch ? folderMatch[1].trim() : null;

        if (folderName) {
          const videoDir = path.join(DOWNLOADS_DIR, folderName);
          resolve({
            success: true,
            videoPath: path.join(videoDir, 'video.mp4'),
            srtPath: path.join(videoDir, 'video.srt'),
            folder: folderName,
          });
        } else {
          resolve({ success: false, error: 'Could not determine download folder' });
        }
      } else {
        resolve({
          success: false,
          error: stderr || `Process exited with code ${code}`,
        });
      }
    });

    proc.on('error', (err) => {
      resolve({ success: false, error: err.message });
    });
  });
});

// IPC: List all downloaded videos
ipcMain.handle('list-downloads', async () => {
  if (!fs.existsSync(DOWNLOADS_DIR)) return [];

  const entries = fs.readdirSync(DOWNLOADS_DIR, { withFileTypes: true });
  const videos = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const videoDir = path.join(DOWNLOADS_DIR, entry.name);
    const videoPath = path.join(videoDir, 'video.mp4');
    const srtPath = path.join(videoDir, 'video.srt');
    const infoPath = path.join(videoDir, 'info.json');

    if (!fs.existsSync(videoPath)) continue;

    let title = entry.name;
    let url = '';
    if (fs.existsSync(infoPath)) {
      try {
        const info = JSON.parse(fs.readFileSync(infoPath, 'utf-8'));
        title = info.title || entry.name;
        url = info.url || '';
      } catch (e) { /* ignore */ }
    }

    videos.push({
      folder: entry.name,
      title,
      url,
      videoPath,
      srtPath,
      hasSrt: fs.existsSync(srtPath),
    });
  }

  return videos;
});

// IPC: Delete a downloaded video folder
ipcMain.handle('delete-download', async (_event, folder) => {
  const videoDir = path.join(DOWNLOADS_DIR, folder);
  if (fs.existsSync(videoDir)) {
    fs.rmSync(videoDir, { recursive: true });
    return { success: true };
  }
  return { success: false, error: 'Folder not found' };
});

ipcMain.handle('read-file', async (_event, filePath) => {
  return fs.readFileSync(filePath, 'utf-8');
});
