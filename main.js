const { app, BrowserWindow, ipcMain, dialog, Menu } = require('electron');
const path = require('path');
const store = require('./library-store');

// Uygulama adını ve Windows görev çubuğu kimliğini ayarla
app.setName('BTÜ Geçerken PDF Viewer');
if (process.platform === 'win32') {
  app.setAppUserModelId('com.btugecerken.pdfviewer');
}

// Varsayılan Electron üst menü çubuğunu (File, Edit, View...) kaldır
Menu.setApplicationMenu(null);

let splashWindow = null;
let mainWindow = null;
let activeDocument = null; // Okuyucuya aktarılacak aktif belge bilgisi

// Windows üzerinden çift tıklanan veya parametre olarak gönderilen PDF yolunu yakalama
function getTargetPdfPath() {
  const args = process.argv;
  if (app.isPackaged) {
    if (args.length > 1 && !args[1].startsWith('--')) {
      return args[1];
    }
  } else {
    if (args.length > 2 && !args[2].startsWith('--')) {
      return args[2];
    }
  }
  return null;
}

function createWindows() {
  const initialPdfPath = getTargetPdfPath();
  const appIconPath = path.join(__dirname, 'icon.ico');

  // 1. Splash Screen Penceresi
  splashWindow = new BrowserWindow({
    width: 580,
    height: 340,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: false,
    center: true,
    show: true,
    icon: appIconPath,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  splashWindow.loadFile('splash.html');

  // 2. Ana Uygulama Penceresi
  mainWindow = new BrowserWindow({
    width: 1366,
    height: 850,
    minWidth: 960,
    minHeight: 650,
    show: false,
    title: "BTÜ Geçerken PDF Viewer",
    icon: appIconPath,
    autoHideMenuBar: true,
    backgroundColor: '#12161a',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false
    }
  });

  // Eğer dışarıdan bir PDF çift tıklanarak açıldıysa doğrudan okuyucuyu yükle, yoksa kütüphaneyi aç
  if (initialPdfPath) {
    activeDocument = { filePath: initialPdfPath, title: path.basename(initialPdfPath) };
    mainWindow.loadFile('btu-gecerken-reader.html');
  } else {
    mainWindow.loadFile('library.html');
  }

  // Sayfa içi <title> etiketi yüklenirken bile pencere başlığını sabit tut
  mainWindow.on('page-title-updated', (e) => {
    e.preventDefault();
    mainWindow.setTitle('BTÜ Geçerken PDF Viewer');
  });

  mainWindow.once('ready-to-show', () => {
    setTimeout(() => {
      if (splashWindow && !splashWindow.isDestroyed()) {
        splashWindow.close();
      }
      mainWindow.show();
      mainWindow.maximize();
    }, 1400);
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// Tekil uygulama örneği kilidi
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', (event, commandLine) => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();

      const openedFile = commandLine.find(arg => arg.toLowerCase().endsWith('.pdf'));
      if (openedFile) {
        activeDocument = { filePath: openedFile, title: path.basename(openedFile) };
        mainWindow.loadFile('btu-gecerken-reader.html');
      }
    }
  });

  app.whenReady().then(createWindows);
}

// --- IPC KANALLARI & SAYFA YÖNETİMİ ---

// Arayüzler arası geçiş
ipcMain.on('navigate-to-reader', (event, docData) => {
  activeDocument = docData;
  if (mainWindow) mainWindow.loadFile('btu-gecerken-reader.html');
});

ipcMain.on('navigate-to-library', () => {
  activeDocument = null;
  if (mainWindow) mainWindow.loadFile('library.html');
});

ipcMain.handle('get-current-document', () => {
  return activeDocument;
});

ipcMain.handle('get-opened-pdf', () => {
  return activeDocument ? activeDocument.filePath : getTargetPdfPath();
});

// Windows Dosya Seçici Penceresi (PDF İçe Aktar butonu için)
ipcMain.handle('dialog:select-pdf', async () => {
  if (!mainWindow) return null;
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'İçe Aktarılacak PDF Dosyasını Seçin',
    filters: [{ name: 'PDF Belgeleri', extensions: ['pdf'] }],
    properties: ['openFile']
  });

  if (!result.canceled && result.filePaths.length > 0) {
    return result.filePaths[0];
  }
  return null;
});

// Kütüphane Veritabanı IPC Köprüleri
ipcMain.handle('lib:get-documents', (event, filter) => store.getDocuments(filter));
ipcMain.handle('lib:save-document', (event, doc) => store.saveDocument(doc));
ipcMain.handle('lib:set-trash', (event, docId, isTrash) => store.setDocumentTrash(docId, isTrash));
ipcMain.handle('lib:delete-permanently', (event, docId) => store.deleteDocumentPermanently(docId));

// Klasör IPC Köprüleri
ipcMain.handle('lib:get-folders', () => store.getFolders());
ipcMain.handle('lib:create-folder', (event, name, color) => store.createFolder(name, color));
ipcMain.handle('lib:delete-folder', (event, folderId) => store.deleteFolder(folderId));

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});