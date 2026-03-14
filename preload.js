const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  downloadVideo: (url) => ipcRenderer.invoke('download-video', url),
  onDownloadProgress: (callback) => {
    ipcRenderer.on('download-progress', (_event, message) => callback(message));
  },
  readFile: (filePath) => ipcRenderer.invoke('read-file', filePath),
  listDownloads: () => ipcRenderer.invoke('list-downloads'),
  deleteDownload: (folder) => ipcRenderer.invoke('delete-download', folder),
});
