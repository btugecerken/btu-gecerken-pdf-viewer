const fs = require('fs');
const path = require('path');
const { app } = require('electron');

// Kullanıcının sistemindeki AppData / btu-gecerken klasörü
const userDataPath = app ? app.getPath('userData') : path.join(__dirname, '.data');
const dbFilePath = path.join(userDataPath, 'library-data.json');

// Varsayılan boş veri şeması
const defaultData = {
  folders: [
    { id: 'default', name: 'Genel', color: '#009B77' }
  ],
  documents: []
};

// Veritabanını oku
function readStore() {
  try {
    if (!fs.existsSync(userDataPath)) {
      fs.mkdirSync(userDataPath, { recursive: true });
    }
    if (!fs.existsSync(dbFilePath)) {
      fs.writeFileSync(dbFilePath, JSON.stringify(defaultData, null, 2), 'utf-8');
      return defaultData;
    }
    const raw = fs.readFileSync(dbFilePath, 'utf-8');
    return JSON.parse(raw);
  } catch (err) {
    console.error('Kütüphane verisi okunurken hata:', err);
    return defaultData;
  }
}

// Veritabanına kaydet
function writeStore(data) {
  try {
    fs.writeFileSync(dbFilePath, JSON.stringify(data, null, 2), 'utf-8');
    return true;
  } catch (err) {
    console.error('Kütüphane verisi kaydedilirken hata:', err);
    return false;
  }
}

// Tüm belgeleri listele (aktif veya çöp kutusundakiler)
function getDocuments(filter = {}) {
  const store = readStore();
  let list = store.documents;

  if (filter.isTrash !== undefined) {
    list = list.filter(doc => !!doc.isTrash === !!filter.isTrash);
  }
  if (filter.folderId && filter.folderId !== 'all') {
    list = list.filter(doc => doc.folderId === filter.folderId);
  }
  return list;
}

// Yeni belge ekle veya güncelle
function saveDocument(doc) {
  const store = readStore();
  const index = store.documents.findIndex(d => d.id === doc.id || d.filePath === doc.filePath);

  const docItem = {
    id: doc.id || 'doc_' + Date.now(),
    title: doc.title || path.basename(doc.filePath),
    filePath: doc.filePath,
    thumbnail: doc.thumbnail || null, // Base64 kapak görseli
    folderId: doc.folderId || 'default',
    pageCount: doc.pageCount || 0,
    addedAt: doc.addedAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    isTrash: !!doc.isTrash
  };

  if (index >= 0) {
    store.documents[index] = { ...store.documents[index], ...docItem, updatedAt: new Date().toISOString() };
  } else {
    store.documents.unshift(docItem);
  }

  writeStore(store);
  return docItem;
}

// Belgeyi çöp kutusuna taşı / geri yükle
function setDocumentTrash(docId, isTrash) {
  const store = readStore();
  const doc = store.documents.find(d => d.id === docId);
  if (doc) {
    doc.isTrash = isTrash;
    doc.updatedAt = new Date().toISOString();
    writeStore(store);
    return true;
  }
  return false;
}

// Belgeyi kütüphaneden tamamen sil
function deleteDocumentPermanently(docId) {
  const store = readStore();
  store.documents = store.documents.filter(d => d.id !== docId);
  return writeStore(store);
}

// Klasörleri getir
function getFolders() {
  const store = readStore();
  return store.folders;
}

// Yeni klasör oluştur
function createFolder(name, color = '#009B77') {
  const store = readStore();
  const newFolder = {
    id: 'f_' + Date.now(),
    name: name.trim(),
    color: color
  };
  store.folders.push(newFolder);
  writeStore(store);
  return newFolder;
}

// Klasör sil (içindeki belgeler 'default' klasörüne geçer)
function deleteFolder(folderId) {
  if (folderId === 'default') return false;
  const store = readStore();
  store.folders = store.folders.filter(f => f.id !== folderId);
  store.documents.forEach(doc => {
    if (doc.folderId === folderId) doc.folderId = 'default';
  });
  return writeStore(store);
}

module.exports = {
  getDocuments,
  saveDocument,
  setDocumentTrash,
  deleteDocumentPermanently,
  getFolders,
  createFolder,
  deleteFolder
};