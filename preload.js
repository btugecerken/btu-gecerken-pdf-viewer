const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktopAPI', {
  // --- PDF Açılış Köprüsü ---
  getOpenedPdf: () => ipcRenderer.invoke('get-opened-pdf'),
  onFileOpened: (callback) => {
    ipcRenderer.on('file-opened', (event, filePath) => callback(filePath));
  },

  // --- Sayfa Geçişleri (Kütüphane <-> Okuyucu) ---
  openReaderView: (docData) => ipcRenderer.send('navigate-to-reader', docData),
  openLibraryView: () => ipcRenderer.send('navigate-to-library'),
  getCurrentDocument: () => ipcRenderer.invoke('get-current-document'),

  // --- Kütüphane Veri Yönetimi ---
  getDocuments: (filter) => ipcRenderer.invoke('lib:get-documents', filter),
  saveDocument: (doc) => ipcRenderer.invoke('lib:save-document', doc),
  setDocumentTrash: (docId, isTrash) => ipcRenderer.invoke('lib:set-trash', docId, isTrash),
  deleteDocumentPermanently: (docId) => ipcRenderer.invoke('lib:delete-permanently', docId),

  // --- Klasör Yönetimi ---
  getFolders: () => ipcRenderer.invoke('lib:get-folders'),
  createFolder: (name, color) => ipcRenderer.invoke('lib:create-folder', name, color),
  deleteFolder: (folderId) => ipcRenderer.invoke('lib:delete-folder', folderId),

  // --- Yerel Dosya Seçici ---
  selectPdfFileDialog: () => ipcRenderer.invoke('dialog:select-pdf')
});