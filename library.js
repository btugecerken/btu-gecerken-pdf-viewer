pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

let currentView = 'all'; // 'all', 'trash', veya klasör ID'si
let selectedFolderColor = '#009B77';

const docsGrid = document.getElementById('docsGrid');
const emptyState = document.getElementById('emptyState');
const currentViewTitle = document.getElementById('currentViewTitle');
const libSearchInput = document.getElementById('libSearchInput');
const countAllEl = document.getElementById('countAll');
const countTrashEl = document.getElementById('countTrash');
const folderListEl = document.getElementById('folderList');

const folderModal = document.getElementById('folderModal');
const folderNameInput = document.getElementById('folderNameInput');
const thumbGenCanvas = document.getElementById('thumbGenCanvas');
const thumbCtx = thumbGenCanvas.getContext('2d');

// --- 1. OTOMATİK KAPAK (THUMBNAIL) ÜRETİCİ ---
async function generateThumbnail(filePath) {
  try {
    const loadingTask = pdfjsLib.getDocument(filePath);
    const pdf = await loadingTask.promise;
    const page = await pdf.getPage(1);

    const desiredWidth = 260;
    const viewport = page.getViewport({ scale: 1.0 });
    const scale = desiredWidth / viewport.width;
    const scaledViewport = page.getViewport({ scale: scale });

    thumbGenCanvas.width = scaledViewport.width;
    thumbGenCanvas.height = scaledViewport.height;

    await page.render({
      canvasContext: thumbCtx,
      viewport: scaledViewport
    }).promise;

    return {
      thumbnail: thumbGenCanvas.toDataURL('image/jpeg', 0.82),
      pageCount: pdf.numPages
    };
  } catch (err) {
    console.warn("Thumbnail oluşturulamadı:", err);
    return { thumbnail: null, pageCount: 0 };
  }
}

// --- 2. KÜTÜPHANEYİ VE KLASÖRLERİ YÜKLEME ---
async function refreshLibrary() {
  if (!window.desktopAPI) return;

  const allActiveDocs = await window.desktopAPI.getDocuments({ isTrash: false });
  const allTrashDocs = await window.desktopAPI.getDocuments({ isTrash: true });
  const folders = await window.desktopAPI.getFolders();

  if (countAllEl) countAllEl.textContent = allActiveDocs.length;
  if (countTrashEl) countTrashEl.textContent = allTrashDocs.length;

  renderFolderList(folders);

  let displayedDocs = [];
  if (currentView === 'trash') {
    displayedDocs = allTrashDocs;
    currentViewTitle.textContent = "Çöp Kutusu";
  } else if (currentView === 'all') {
    displayedDocs = allActiveDocs;
    currentViewTitle.textContent = "Tüm Belgeler";
  } else {
    const activeFolder = folders.find(f => f.id === currentView);
    displayedDocs = allActiveDocs.filter(d => d.folderId === currentView);
    currentViewTitle.textContent = activeFolder ? activeFolder.name : "Klasör";
  }

  // Arama filtresi
  const searchQuery = libSearchInput.value.trim().toLowerCase();
  if (searchQuery) {
    displayedDocs = displayedDocs.filter(d => d.title.toLowerCase().includes(searchQuery));
  }

  renderDocCards(displayedDocs);
}

// --- 3. KLASÖR LİSTESİ OLUŞTURMA ---
function renderFolderList(folders) {
  folderListEl.innerHTML = '';
  folders.forEach(f => {
    const btn = document.createElement('button');
    btn.className = `nav-item ${currentView === f.id ? 'active' : ''}`;
    btn.innerHTML = `
      <span class="folder-dot" style="background: ${f.color || '#009B77'};"></span>
      <span class="nav-label">${f.name}</span>
    `;
    btn.addEventListener('click', () => {
      document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
      btn.classList.add('active');
      currentView = f.id;
      refreshLibrary();
    });
    folderListEl.appendChild(btn);
  });
}

// --- 4. BELGE KARTLARINI RENDER ETME ---
function renderDocCards(docs) {
  docsGrid.innerHTML = '';

  if (docs.length === 0) {
    emptyState.style.display = 'block';
    return;
  }
  emptyState.style.display = 'none';

  docs.forEach(doc => {
    const card = document.createElement('div');
    card.className = 'doc-card';

    const previewContent = doc.thumbnail 
      ? `<img src="${doc.thumbnail}" class="doc-thumb-img" alt="${doc.title}">`
      : `<i class="fa-solid fa-file-pdf doc-placeholder-icon"></i>`;

    const dateStr = new Date(doc.updatedAt || doc.addedAt).toLocaleDateString('tr-TR', {
      day: 'numeric',
      month: 'short'
    });

    const actionBtnTitle = currentView === 'trash' ? 'Kalıcı Olarak Sil' : 'Çöp Kutusuna Gönder';
    const actionBtnIcon = currentView === 'trash' ? 'fa-solid fa-xmark' : 'fa-regular fa-trash-can';

    card.innerHTML = `
      <div class="doc-preview-wrapper">
        ${previewContent}
      </div>
      <div class="doc-card-actions">
        <button class="btn-card-menu" title="${actionBtnTitle}">
          <i class="${actionBtnIcon}"></i>
        </button>
      </div>
      <div class="doc-card-info">
        <span class="doc-card-title" title="${doc.title}">${doc.title}</span>
        <div class="doc-card-meta">
          <span>${doc.pageCount ? doc.pageCount + ' Sayfa' : 'PDF'}</span>
          <span>${dateStr}</span>
        </div>
      </div>
    `;

    // Karta tıklandığında Okuyucu Arayüzünü Aç
    card.addEventListener('click', (e) => {
      if (e.target.closest('.btn-card-menu')) return;
      if (currentView === 'trash') {
        const restore = confirm("Bu belge çöp kutusunda. Geri yüklemek ister misiniz?");
        if (restore) {
          window.desktopAPI.setDocumentTrash(doc.id, false).then(refreshLibrary);
        }
        return;
      }
      window.desktopAPI.openReaderView({
        filePath: doc.filePath,
        title: doc.title,
        id: doc.id
      });
    });

    // Silme butonu mantığı
    const btnAction = card.querySelector('.btn-card-menu');
    btnAction.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (currentView === 'trash') {
        if (confirm(`"${doc.title}" belgesini kütüphaneden tamamen silmek istiyor musunuz?`)) {
          await window.desktopAPI.deleteDocumentPermanently(doc.id);
          refreshLibrary();
        }
      } else {
        await window.desktopAPI.setDocumentTrash(doc.id, true);
        refreshLibrary();
      }
    });

    docsGrid.appendChild(card);
  });
}

// --- 5. PDF İÇE AKTARMA BUTONU ---
document.getElementById('btnImportPdf')?.addEventListener('click', async () => {
  if (!window.desktopAPI) return;

  const selectedPath = await window.desktopAPI.selectPdfFileDialog();
  if (!selectedPath) return;

  const fileName = selectedPath.split('\\').pop().split('/').pop();
  const folderTarget = (currentView !== 'all' && currentView !== 'trash') ? currentView : 'default';

  // Otomatik thumbnail üret
  const meta = await generateThumbnail(selectedPath);

  await window.desktopAPI.saveDocument({
    title: fileName.replace(/\.pdf$/i, ''),
    filePath: selectedPath,
    thumbnail: meta.thumbnail,
    pageCount: meta.pageCount,
    folderId: folderTarget
  });

  refreshLibrary();
});

// --- 6. NAVİGASYON TIKLAMALARI ---
document.getElementById('navAllDocs')?.addEventListener('click', () => {
  document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
  document.getElementById('navAllDocs').classList.add('active');
  currentView = 'all';
  refreshLibrary();
});

document.getElementById('navTrash')?.addEventListener('click', () => {
  document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
  document.getElementById('navTrash').classList.add('active');
  currentView = 'trash';
  refreshLibrary();
});

libSearchInput?.addEventListener('input', refreshLibrary);

// --- 7. YENİ KLASÖR MODAL YÖNETİMİ ---
document.getElementById('btnNewFolderModal')?.addEventListener('click', () => {
  folderNameInput.value = '';
  folderModal.classList.add('open');
  folderNameInput.focus();
});

document.getElementById('btnCloseModal')?.addEventListener('click', () => folderModal.classList.remove('open'));
document.getElementById('btnCancelFolder')?.addEventListener('click', () => folderModal.classList.remove('open'));

document.querySelectorAll('#folderColorPicker .color-circle').forEach(circle => {
  circle.addEventListener('click', () => {
    document.querySelectorAll('#folderColorPicker .color-circle').forEach(c => c.classList.remove('active'));
    circle.classList.add('active');
    selectedFolderColor = circle.getAttribute('data-color');
  });
});

document.getElementById('btnConfirmFolder')?.addEventListener('click', async () => {
  const name = folderNameInput.value.trim();
  if (!name) return;

  await window.desktopAPI.createFolder(name, selectedFolderColor);
  folderModal.classList.remove('open');
  refreshLibrary();
});

// Başlat
refreshLibrary();