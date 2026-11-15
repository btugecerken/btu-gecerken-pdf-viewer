pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

// Dify API Endpoint (Masaüstü uygulamasından sunucuya giden tam adres)
const DIFY_API_URL = "https://btugecerken.com/api/dify/chat-messages";

let currentPdfSource = null; // Dosya yolu (string) veya boş not belgesi için Uint8Array
let pdfDoc = null;
// Sayfa dizini: Orijinal 1-tabanlı PDF sayfa numaralarını tutar (sıralama & silme & yeni sayfa destekli)
let pageOrder = [];
let currentPageIdx = 0; // pageOrder dizisindeki aktif indeks (0-tabanlı)

let isRendering = false;
let renderPendingIdx = null;
let currentRenderTask = null;
let currentScale = 1.0;

// Aktif araç durumu ile açılır menü görünürlüğü birbirinden ayrıldı
let isDrawingActive = false;
let isPenPopoverOpen = false;
let currentMode = 'pen'; // 'pen', 'highlighter', 'text', 'eraser'
let currentColor = '#009B77';
let currentSize = 2;

// Çizimler ve metin önbelleği orijinal PDF sayfa numarasına (origPageNum) göre indekslenir
const drawingCache = {};
const pageStrokeHistory = {};
const pageTextCache = {};
let hasDrawnOnCurrentPage = false;
let currentConversationId = null;

const canvas = document.getElementById('pdfCanvas');
const ctx = canvas.getContext('2d');
const drawCanvas = document.getElementById('drawCanvas');
const drawCtx = drawCanvas.getContext('2d', { willReadFrequently: true });
const canvasContainer = document.getElementById('canvasContainer');
const penToolbar = document.getElementById('penToolbar');

const docTitleInput = document.getElementById('docTitleInput');
const pageJumpInputDesktop = document.getElementById('pageJumpInputDesktop');
const pageJumpInputMobile = document.getElementById('pageJumpInputMobile');
const pageCountEl = document.getElementById('pageCount');
const mobPageCountEl = document.getElementById('mobPageCount');
const zoomLevelBadge = document.getElementById('zoomLevelBadge');

const thumbnailSidebar = document.getElementById('thumbnailSidebar');
const thumbnailGrid = document.getElementById('thumbnailGrid');

// Klavyeden metin ekleme katmanı elemanları
const textNoteOverlay = document.getElementById('textNoteOverlay');
const textNoteInput = document.getElementById('textNoteInput');
let pendingTextCoords = null;

const aiDrawer = document.getElementById('pdfAiDrawer');
const drawerMessages = document.getElementById('drawerMessages');
const drawerForm = document.getElementById('drawerForm');
const drawerInput = document.getElementById('drawerInput');

// Akıllı DPR ölçeği: Hız ve netlik dengesi (1.5x - 2x)
function getRenderDPR() {
  const dpr = window.devicePixelRatio || 1;
  return Math.min(Math.max(dpr, 1.5), 2);
}

function getCurrentOrigPageNum() {
  return pageOrder[currentPageIdx] || 1;
}

function saveCurrentPageDrawing() {
  if (!hasDrawnOnCurrentPage) return;
  const origNum = getCurrentOrigPageNum();
  if (drawCanvas.width > 0 && drawCanvas.height > 0) {
    drawingCache[origNum] = drawCanvas.toDataURL('image/png');
  }
  hasDrawnOnCurrentPage = false;
}

function restorePageDrawing(origNum) {
  hasDrawnOnCurrentPage = false;
  drawCtx.save();
  drawCtx.setTransform(1, 0, 0, 1, 0, 0);
  drawCtx.clearRect(0, 0, drawCanvas.width, drawCanvas.height);
  drawCtx.restore();

  if (drawingCache[origNum]) {
    const img = new Image();
    img.onload = () => {
      drawCtx.save();
      drawCtx.setTransform(1, 0, 0, 1, 0, 0);
      drawCtx.drawImage(img, 0, 0, drawCanvas.width, drawCanvas.height);
      drawCtx.restore();
    };
    img.src = drawingCache[origNum];
  }
}

function pushStrokeState() {
  const origNum = getCurrentOrigPageNum();
  if (!pageStrokeHistory[origNum]) pageStrokeHistory[origNum] = [];
  if (pageStrokeHistory[origNum].length >= 15) pageStrokeHistory[origNum].shift();
  pageStrokeHistory[origNum].push(drawCtx.getImageData(0, 0, drawCanvas.width, drawCanvas.height));
}

function undoLastStroke() {
  const origNum = getCurrentOrigPageNum();
  if (pageStrokeHistory[origNum] && pageStrokeHistory[origNum].length > 0) {
    const prevState = pageStrokeHistory[origNum].pop();
    drawCtx.putImageData(prevState, 0, 0);
    hasDrawnOnCurrentPage = true;
    saveCurrentPageDrawing();
  } else {
    drawCtx.save();
    drawCtx.setTransform(1, 0, 0, 1, 0, 0);
    drawCtx.clearRect(0, 0, drawCanvas.width, drawCanvas.height);
    drawCtx.restore();
    delete drawingCache[origNum];
    hasDrawnOnCurrentPage = false;
  }
}

// Hızlı İlk Açılış (1x) + Arka Planda High-DPI Netleştirme Motoru
async function renderPageByIndex(idx) {
  if (!pdfDoc || pageOrder.length === 0) return;

  cancelTextNoteBox();

  if (isRendering) {
    if (currentRenderTask) currentRenderTask.cancel();
    renderPendingIdx = idx;
    return;
  }

  saveCurrentPageDrawing();
  isRendering = true;
  currentPageIdx = Math.max(0, Math.min(idx, pageOrder.length - 1));
  const origPageNum = pageOrder[currentPageIdx];

  updatePageCounters();
  highlightActiveThumbnail();

  try {
    const page = await pdfDoc.getPage(origPageNum);
    const containerWidth = canvasContainer.clientWidth - 40;
    const baseViewport = page.getViewport({ scale: 1.0 });

    if (window.innerWidth <= 768 && currentScale === 1.0) {
      currentScale = Math.min(1.0, containerWidth / baseViewport.width);
    }

    const cssViewport = page.getViewport({ scale: currentScale });
    const targetDpr = getRenderDPR();

    // 1. ADIM: Hızlı İlk Çizim (1x ölçekte anında ekrana bas)
    canvas.width = Math.floor(cssViewport.width);
    canvas.height = Math.floor(cssViewport.height);
    canvas.style.width = `${Math.floor(cssViewport.width)}px`;
    canvas.style.height = `${Math.floor(cssViewport.height)}px`;

    drawCanvas.width = canvas.width;
    drawCanvas.height = canvas.height;
    drawCanvas.style.width = canvas.style.width;
    drawCanvas.style.height = canvas.style.height;

    if (zoomLevelBadge) {
      zoomLevelBadge.textContent = `${Math.round(currentScale * 100)}%`;
    }

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    currentRenderTask = page.render({
      canvasContext: ctx,
      viewport: cssViewport
    });
    await currentRenderTask.promise;

    restorePageDrawing(origPageNum);
    extractTextInBackground(page, origPageNum);
    preloadNearbyPages(currentPageIdx);

    // 2. ADIM: Yüksek Çözünürlüklü (Hi-DPI) Netleştirme Geçişi
    if (targetDpr > 1) {
      const hiResViewport = page.getViewport({ scale: currentScale * targetDpr });
      const offscreenCanvas = document.createElement('canvas');
      offscreenCanvas.width = Math.floor(hiResViewport.width);
      offscreenCanvas.height = Math.floor(hiResViewport.height);

      currentRenderTask = page.render({
        canvasContext: offscreenCanvas.getContext('2d'),
        viewport: hiResViewport
      });
      await currentRenderTask.promise;

      canvas.width = offscreenCanvas.width;
      canvas.height = offscreenCanvas.height;
      ctx.drawImage(offscreenCanvas, 0, 0);

      drawCanvas.width = canvas.width;
      drawCanvas.height = canvas.height;
      restorePageDrawing(origPageNum);
    }

    currentRenderTask = null;
  } catch (err) {
    if (err.name !== 'RenderingCancelledException') {
      console.error("Render hatası:", err);
    }
  } finally {
    isRendering = false;
    if (renderPendingIdx !== null) {
      const nextIdx = renderPendingIdx;
      renderPendingIdx = null;
      await renderPageByIndex(nextIdx);
    }
  }
}

function updatePageCounters() {
  const displayNum = pageOrder.length > 0 ? currentPageIdx + 1 : 0;
  const totalCount = pageOrder.length;

  if (pageJumpInputDesktop) {
    pageJumpInputDesktop.value = displayNum;
    pageJumpInputDesktop.max = totalCount;
  }
  if (pageJumpInputMobile) {
    pageJumpInputMobile.value = displayNum;
    pageJumpInputMobile.max = totalCount;
  }
  if (pageCountEl) pageCountEl.textContent = totalCount;
  if (mobPageCountEl) mobPageCountEl.textContent = totalCount;
}

function extractTextInBackground(page, origNum) {
  if (pageTextCache[origNum]) return;
  page.getTextContent().then(textContent => {
    const text = textContent.items.map(item => item.str).join(' ').replace(/\s+/g, ' ').trim();
    pageTextCache[origNum] = text;
  }).catch(() => {
    pageTextCache[origNum] = "";
  });
}

function preloadNearbyPages(idx) {
  if (!pdfDoc) return;
  if (idx + 1 < pageOrder.length) pdfDoc.getPage(pageOrder[idx + 1]);
  if (idx - 1 >= 0) pdfDoc.getPage(pageOrder[idx - 1]);
}

function jumpToDisplayPage(targetDisplayPage) {
  if (!pdfDoc || pageOrder.length === 0) return;
  const parsed = parseInt(targetDisplayPage, 10);
  if (isNaN(parsed)) {
    updatePageCounters();
    return;
  }
  const clampedDisplay = Math.max(1, Math.min(parsed, pageOrder.length));
  renderPageByIndex(clampedDisplay - 1);
}

[pageJumpInputDesktop, pageJumpInputMobile].forEach(inputEl => {
  if (!inputEl) return;
  inputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      jumpToDisplayPage(inputEl.value);
      inputEl.blur();
    }
  });
  inputEl.addEventListener('change', () => {
    jumpToDisplayPage(inputEl.value);
  });
  inputEl.addEventListener('focus', () => inputEl.select());
});

// ==========================================================================
// BOŞ YENİ NOT DEFTERİ OLUŞTURMA & YENİ BOŞ SAYFA EKLEME (PDF-LIB)
// ==========================================================================
async function createNewBlankNote(customTitle, autoEnablePen = true) {
  saveCurrentPageDrawing();
  const todayStr = new Date().toLocaleDateString('tr-TR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  });
  const noteTitle = customTitle || `Yeni Not - ${todayStr}`;

  try {
    const newDoc = await PDFLib.PDFDocument.create();
    // Standart A4 boyutu (595.28 x 841.89 pt)
    newDoc.addPage([595.28, 841.89]);
    const pdfBytes = await newDoc.save();

    await loadPdfFromBytes(pdfBytes, noteTitle);

    if (autoEnablePen) {
      setDrawingMode(true);
    }
  } catch (err) {
    console.error("Boş not oluşturulamadı:", err);
    alert("Yeni not sayfası oluşturulurken hata oluştu.");
  }
}

async function appendBlankPageToCurrentDoc() {
  if (!currentPdfSource || !pdfDoc) {
    await createNewBlankNote();
    return;
  }
  saveCurrentPageDrawing();

  try {
    const existingBytes = await getSourcePdfBytes();
    const docLib = await PDFLib.PDFDocument.load(existingBytes);
    const firstPage = docLib.getPages()[0];
    const { width, height } = firstPage ? firstPage.getSize() : { width: 595.28, height: 841.89 };

    docLib.addPage([width, height]);
    const updatedBytes = await docLib.save();

    const prevOrder = [...pageOrder];
    const newOrigPageNum = docLib.getPageCount();

    currentPdfSource = updatedBytes;
    const loadedDoc = await pdfjsLib.getDocument({ data: updatedBytes }).promise;
    pdfDoc = loadedDoc;
    pageOrder = [...prevOrder, newOrigPageNum];

    updatePageCounters();
    await renderPageByIndex(pageOrder.length - 1);
    if (thumbnailSidebar?.classList.contains('open')) {
      buildThumbnailGrid();
    }
  } catch (err) {
    console.error("Yeni sayfa eklenemedi:", err);
    alert("Yeni sayfa eklenirken bir hata oluştu.");
  }
}

document.getElementById('btnNewBlankNote')?.addEventListener('click', () => {
  createNewBlankNote();
});
document.getElementById('btnAddBlankPageDesktop')?.addEventListener('click', appendBlankPageToCurrentDoc);
document.getElementById('btnAddBlankPageMobile')?.addEventListener('click', appendBlankPageToCurrentDoc);

// ==========================================================================
// KALEM ARACI, KLAVYEDEN METİN NOTU (T) VE MENÜ STATE AYRIMI
// ==========================================================================
function setPenPopoverOpen(open) {
  isPenPopoverOpen = open;
  penToolbar.classList.toggle('open', open);
}

function setDrawingMode(active) {
  isDrawingActive = active;
  drawCanvas.classList.toggle('pen-active', active);
  drawCanvas.classList.toggle('text-mode', active && currentMode === 'text');

  if (!active) cancelTextNoteBox();

  document.getElementById('penToggleDesktop')?.classList.toggle('active', active);
  document.getElementById('penToggleMobile')?.classList.toggle('active', active);

  const settingsDesktop = document.getElementById('penSettingsToggleDesktop');
  const settingsMobile = document.getElementById('penSettingsToggleMobile');
  if (settingsDesktop) settingsDesktop.style.display = active ? 'inline-flex' : 'none';
  if (settingsMobile) settingsMobile.style.display = active ? 'flex' : 'none';

  setPenPopoverOpen(active);
}

document.getElementById('penToggleDesktop')?.addEventListener('click', () => {
  setDrawingMode(!isDrawingActive);
});
document.getElementById('penToggleMobile')?.addEventListener('click', () => {
  setDrawingMode(!isDrawingActive);
});

document.getElementById('penSettingsToggleDesktop')?.addEventListener('click', () => {
  setPenPopoverOpen(!isPenPopoverOpen);
});
document.getElementById('penSettingsToggleMobile')?.addEventListener('click', () => {
  setPenPopoverOpen(!isPenPopoverOpen);
});

document.getElementById('btnHidePenPopover')?.addEventListener('click', () => {
  setPenPopoverOpen(false);
});
document.getElementById('btnExitPenMode')?.addEventListener('click', () => {
  setDrawingMode(false);
});

// --- Klavyeden Metin Yazma Fonksiyonları ---
function openTextNoteBox(cssX, cssY, canvasX, canvasY) {
  pendingTextCoords = { canvasX, canvasY };
  const maxLeft = Math.max(8, drawCanvas.clientWidth - 235);
  const maxTop = Math.max(8, drawCanvas.clientHeight - 95);

  textNoteOverlay.style.left = `${Math.min(cssX, maxLeft)}px`;
  textNoteOverlay.style.top = `${Math.min(cssY, maxTop)}px`;
  textNoteOverlay.style.display = 'flex';
  textNoteInput.value = '';
  setTimeout(() => textNoteInput.focus(), 10);
}

function cancelTextNoteBox() {
  pendingTextCoords = null;
  if (textNoteOverlay) textNoteOverlay.style.display = 'none';
  if (textNoteInput) textNoteInput.value = '';
}

function commitTextNoteToCanvas() {
  if (!pendingTextCoords || !textNoteInput) {
    cancelTextNoteBox();
    return;
  }
  const text = textNoteInput.value.trim();
  if (!text) {
    cancelTextNoteBox();
    return;
  }

  pushStrokeState();

  const scaleRatio = drawCanvas.width / (parseFloat(drawCanvas.style.width) || drawCanvas.width);
  const baseFontSize = currentSize === 2 ? 15 : currentSize === 5 ? 20 : 28;
  const fontSizePx = Math.round(baseFontSize * scaleRatio * currentScale);
  const lineHeight = Math.round(fontSizePx * 1.32);

  drawCtx.save();
  drawCtx.font = `600 ${fontSizePx}px "Noto Serif TR", serif`;
  drawCtx.fillStyle = currentColor;
  drawCtx.textBaseline = 'top';

  const lines = text.split('\n');
  lines.forEach((line, idx) => {
    drawCtx.fillText(line, pendingTextCoords.canvasX, pendingTextCoords.canvasY + idx * lineHeight);
  });
  drawCtx.restore();

  hasDrawnOnCurrentPage = true;
  saveCurrentPageDrawing();
  cancelTextNoteBox();
}

document.getElementById('btnConfirmTextNote')?.addEventListener('click', commitTextNoteToCanvas);
document.getElementById('btnCancelTextNote')?.addEventListener('click', cancelTextNoteBox);

textNoteInput?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    commitTextNoteToCanvas();
  } else if (e.key === 'Escape') {
    e.preventDefault();
    cancelTextNoteBox();
  }
});

// --- Serbest Çizim (Kalem / Fosforlu / Silgi) ---
let isDrawing = false;
let points = [];

drawCanvas.addEventListener('pointerdown', (e) => {
  if (!isDrawingActive) return;
  if (e.pointerType === 'touch' && e.isPrimary === false) return;

  if (isPenPopoverOpen) {
    setPenPopoverOpen(false);
  }

  const rect = drawCanvas.getBoundingClientRect();
  const cssX = e.clientX - rect.left;
  const cssY = e.clientY - rect.top;
  const canvasX = cssX * (drawCanvas.width / rect.width);
  const canvasY = cssY * (drawCanvas.height / rect.height);

  // Eğer Metin (T) modu seçiliyse metin giriş kutusunu aç
  if (currentMode === 'text') {
    if (textNoteOverlay.style.display === 'flex' && textNoteInput.value.trim() !== '') {
      commitTextNoteToCanvas();
    }
    openTextNoteBox(cssX, cssY, canvasX, canvasY);
    return;
  }

  pushStrokeState();
  isDrawing = true;
  points = [{ x: canvasX, y: canvasY }];
});

drawCanvas.addEventListener('pointermove', (e) => {
  if (!isDrawing || !isDrawingActive || currentMode === 'text') return;

  const rect = drawCanvas.getBoundingClientRect();
  const x = (e.clientX - rect.left) * (drawCanvas.width / rect.width);
  const y = (e.clientY - rect.top) * (drawCanvas.height / rect.height);

  points.push({ x, y });
  requestAnimationFrame(drawSmoothStroke);
});

function drawSmoothStroke() {
  if (points.length < 2) return;

  const scaleRatio = drawCanvas.width / (parseFloat(drawCanvas.style.width) || drawCanvas.width);
  const scaledStrokeWidth = currentSize * scaleRatio * currentScale;

  drawCtx.save();

  if (currentMode === 'eraser') {
    drawCtx.globalCompositeOperation = 'destination-out';
    drawCtx.lineWidth = scaledStrokeWidth * 6;
  } else if (currentMode === 'highlighter') {
    drawCtx.globalCompositeOperation = 'source-over';
    drawCtx.strokeStyle = currentColor + '55';
    drawCtx.lineWidth = scaledStrokeWidth * 3;
  } else {
    drawCtx.globalCompositeOperation = 'source-over';
    drawCtx.strokeStyle = currentColor;
    drawCtx.lineWidth = scaledStrokeWidth;
  }

  drawCtx.lineCap = 'round';
  drawCtx.lineJoin = 'round';

  const p1 = points[points.length - 2];
  const p2 = points[points.length - 1];

  drawCtx.beginPath();
  drawCtx.moveTo(p1.x, p1.y);
  drawCtx.lineTo(p2.x, p2.y);
  drawCtx.stroke();
  drawCtx.restore();
}

window.addEventListener('pointerup', () => {
  if (isDrawing) {
    isDrawing = false;
    points = [];
    hasDrawnOnCurrentPage = true;
    saveCurrentPageDrawing();
  }
});

document.querySelectorAll('.pen-mode-btn').forEach(btn => {
  btn.addEventListener('click', function() {
    document.querySelectorAll('.pen-mode-btn').forEach(b => b.classList.remove('active'));
    this.classList.add('active');
    currentMode = this.getAttribute('data-mode');
    drawCanvas.classList.toggle('text-mode', isDrawingActive && currentMode === 'text');
    if (currentMode !== 'text') cancelTextNoteBox();
  });
});

document.querySelectorAll('.color-dot').forEach(dot => {
  dot.addEventListener('click', function() {
    document.querySelectorAll('.color-dot').forEach(d => d.classList.remove('active'));
    this.classList.add('active');
    currentColor = this.getAttribute('data-color');
    if (currentMode === 'eraser') {
      document.querySelector('[data-mode="pen"]').click();
    }
  });
});

document.querySelectorAll('.size-btn').forEach(btn => {
  btn.addEventListener('click', function() {
    document.querySelectorAll('.size-btn').forEach(b => b.classList.remove('active'));
    this.classList.add('active');
    currentSize = parseInt(this.getAttribute('data-size'), 10);
  });
});

document.getElementById('btnUndoStroke')?.addEventListener('click', undoLastStroke);
document.getElementById('btnClearPageDraw')?.addEventListener('click', () => {
  const origNum = getCurrentOrigPageNum();
  pushStrokeState();
  drawCtx.save();
  drawCtx.setTransform(1, 0, 0, 1, 0, 0);
  drawCtx.clearRect(0, 0, drawCanvas.width, drawCanvas.height);
  drawCtx.restore();
  delete drawingCache[origNum];
  hasDrawnOnCurrentPage = false;
  cancelTextNoteBox();
});

// ==========================================================================
// SAYFA SIRALAYICI (THUMBNAIL GRID) VE MANİPÜLASYON
// ==========================================================================
let draggedThumbIdx = null;

function toggleThumbnailSidebar() {
  const isOpen = thumbnailSidebar.classList.toggle('open');
  document.getElementById('toggleThumbnailsDesktop')?.classList.toggle('active', isOpen);
  document.getElementById('toggleThumbnailsMobile')?.classList.toggle('active', isOpen);
  if (isOpen && thumbnailGrid.children.length === 0) {
    buildThumbnailGrid();
  }
}

document.getElementById('toggleThumbnailsDesktop')?.addEventListener('click', toggleThumbnailSidebar);
document.getElementById('toggleThumbnailsMobile')?.addEventListener('click', toggleThumbnailSidebar);
document.getElementById('closeThumbnailSidebar')?.addEventListener('click', () => {
  thumbnailSidebar.classList.remove('open');
  document.getElementById('toggleThumbnailsDesktop')?.classList.remove('active');
  document.getElementById('toggleThumbnailsMobile')?.classList.remove('active');
});

function highlightActiveThumbnail() {
  const cards = thumbnailGrid.querySelectorAll('.thumb-card');
  cards.forEach((card, idx) => {
    card.classList.toggle('active', idx === currentPageIdx);
  });
}

async function buildThumbnailGrid() {
  if (!pdfDoc) return;
  thumbnailGrid.innerHTML = '';

  for (let i = 0; i < pageOrder.length; i++) {
    const origNum = pageOrder[i];
    const card = document.createElement('div');
    card.className = `thumb-card ${i === currentPageIdx ? 'active' : ''}`;
    card.draggable = true;
    card.dataset.idx = i;

    card.innerHTML = `
      <div class="thumb-canvas-wrap">
        <canvas id="thumb-canvas-${i}"></canvas>
      </div>
      <div class="thumb-footer">
        <span>Sayfa ${i + 1}</span>
        <div class="thumb-actions">
          <button type="button" class="thumb-mini-btn btn-move-up" title="Öne Taşı"><i class="fa-solid fa-arrow-left"></i></button>
          <button type="button" class="thumb-mini-btn btn-move-down" title="Arkaya Taşı"><i class="fa-solid fa-arrow-right"></i></button>
          <button type="button" class="thumb-mini-btn btn-del" title="Sayfayı Sil"><i class="fa-solid fa-trash"></i></button>
        </div>
      </div>
    `;

    card.addEventListener('click', (e) => {
      if (e.target.closest('.thumb-actions')) return;
      renderPageByIndex(i);
    });

    card.querySelector('.btn-move-up')?.addEventListener('click', () => movePageInOrder(i, i - 1));
    card.querySelector('.btn-move-down')?.addEventListener('click', () => movePageInOrder(i, i + 1));
    card.querySelector('.btn-del')?.addEventListener('click', () => deletePageFromOrder(i));

    card.addEventListener('dragstart', () => {
      draggedThumbIdx = i;
      card.classList.add('dragging');
    });

    card.addEventListener('dragend', () => {
      draggedThumbIdx = null;
      card.classList.remove('dragging');
      thumbnailGrid.querySelectorAll('.thumb-card').forEach(c => c.classList.remove('drag-over'));
    });

    card.addEventListener('dragover', (e) => {
      e.preventDefault();
      if (draggedThumbIdx !== null && draggedThumbIdx !== i) {
        card.classList.add('drag-over');
      }
    });

    card.addEventListener('dragleave', () => {
      card.classList.remove('drag-over');
    });

    card.addEventListener('drop', (e) => {
      e.preventDefault();
      card.classList.remove('drag-over');
      if (draggedThumbIdx !== null && draggedThumbIdx !== i) {
        movePageInOrder(draggedThumbIdx, i);
      }
    });

    thumbnailGrid.appendChild(card);
    renderSingleThumbnail(origNum, card.querySelector('canvas'));
  }
}

async function renderSingleThumbnail(origNum, thumbCanvas) {
  try {
    const page = await pdfDoc.getPage(origNum);
    const viewport = page.getViewport({ scale: 0.35 });
    thumbCanvas.width = viewport.width;
    thumbCanvas.height = viewport.height;
    await page.render({
      canvasContext: thumbCanvas.getContext('2d'),
      viewport
    }).promise;
  } catch (err) {
    console.warn(`Thumbnail ${origNum} çizilemedi:`, err);
  }
}

function movePageInOrder(fromIdx, toIdx) {
  if (toIdx < 0 || toIdx >= pageOrder.length || fromIdx === toIdx) return;
  saveCurrentPageDrawing();
  const activeOrigPage = pageOrder[currentPageIdx];

  const [moved] = pageOrder.splice(fromIdx, 1);
  pageOrder.splice(toIdx, 0, moved);

  currentPageIdx = pageOrder.indexOf(activeOrigPage);
  updatePageCounters();
  buildThumbnailGrid();
}

function deletePageFromOrder(targetIdx) {
  if (pageOrder.length <= 1) {
    alert("Belgede en az 1 sayfa kalmalıdır.");
    return;
  }
  saveCurrentPageDrawing();
  pageOrder.splice(targetIdx, 1);

  if (currentPageIdx >= pageOrder.length) {
    currentPageIdx = pageOrder.length - 1;
  }
  renderPageByIndex(currentPageIdx);
  buildThumbnailGrid();
}

// ==========================================================================
// DOKUNMATİK ZOOM (MERKEZ KORUMALI) & AKILLI SAYFA KAYDIRMA (SWIPE)
// ==========================================================================
let initialPinchDist = null;
let wasPinching = false;
let touchStartX = 0;
let touchStartY = 0;
let touchStartScrollLeft = 0;

function isPageHorizontallyScrollable() {
  return canvasContainer.scrollWidth > canvasContainer.clientWidth + 4;
}

function zoomAroundCenter(newScale) {
  const prevWidth = canvasContainer.scrollWidth || 1;
  const prevHeight = canvasContainer.scrollHeight || 1;
  const centerRatioX = (canvasContainer.scrollLeft + canvasContainer.clientWidth / 2) / prevWidth;
  const centerRatioY = (canvasContainer.scrollTop + canvasContainer.clientHeight / 2) / prevHeight;

  currentScale = newScale;
  renderPageByIndex(currentPageIdx).then(() => {
    const newWidth = canvasContainer.scrollWidth;
    const newHeight = canvasContainer.scrollHeight;
    canvasContainer.scrollLeft = Math.max(0, centerRatioX * newWidth - canvasContainer.clientWidth / 2);
    canvasContainer.scrollTop = Math.max(0, centerRatioY * newHeight - canvasContainer.clientHeight / 2);
  });
}

canvasContainer.addEventListener('touchstart', (e) => {
  if (e.touches.length === 2) {
    wasPinching = true;
    initialPinchDist = Math.hypot(
      e.touches[0].clientX - e.touches[1].clientX,
      e.touches[0].clientY - e.touches[1].clientY
    );
  } else if (e.touches.length === 1) {
    wasPinching = false;
    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;
    touchStartScrollLeft = canvasContainer.scrollLeft;
  }
}, { passive: true });

canvasContainer.addEventListener('touchmove', (e) => {
  if (e.touches.length === 2 && initialPinchDist) {
    wasPinching = true;
    const currentDist = Math.hypot(
      e.touches[0].clientX - e.touches[1].clientX,
      e.touches[0].clientY - e.touches[1].clientY
    );

    const diff = currentDist - initialPinchDist;
    if (Math.abs(diff) > 40) {
      if (diff > 0 && currentScale < 3.5) {
        zoomAroundCenter(Math.min(3.5, +(currentScale + 0.15).toFixed(2)));
      } else if (diff < 0 && currentScale > 0.5) {
        zoomAroundCenter(Math.max(0.5, +(currentScale - 0.15).toFixed(2)));
      }
      initialPinchDist = currentDist;
    }
  }
}, { passive: true });

canvasContainer.addEventListener('touchend', (e) => {
  initialPinchDist = null;

  if (wasPinching) {
    if (e.touches.length === 0) wasPinching = false;
    return;
  }

  if (isDrawingActive || isPageHorizontallyScrollable()) return;
  if (Math.abs(canvasContainer.scrollLeft - touchStartScrollLeft) > 5) return;

  if (e.changedTouches.length === 1 && e.touches.length === 0) {
    const deltaX = e.changedTouches[0].clientX - touchStartX;
    const deltaY = e.changedTouches[0].clientY - touchStartY;

    if (Math.abs(deltaX) > 75 && Math.abs(deltaY) < 60) {
      if (deltaX < 0) renderPageByIndex(currentPageIdx + 1);
      else renderPageByIndex(currentPageIdx - 1);
    }
  }
});

// ==========================================================================
// YENİDEN SIRALANMIŞ & NOTLU PDF KAYDETME / İNDİRME (PDF-LIB)
// ==========================================================================
async function getSourcePdfBytes() {
  if (currentPdfSource instanceof Uint8Array || currentPdfSource instanceof ArrayBuffer) {
    return currentPdfSource;
  }
  return await fetch(currentPdfSource).then(res => res.arrayBuffer());
}

async function downloadAnnotatedPDF() {
  if (!currentPdfSource) return;
  if (textNoteOverlay.style.display === 'flex') commitTextNoteToCanvas();
  saveCurrentPageDrawing();

  const btnDesktop = document.getElementById('btnDownloadAnnotatedDesktop');
  const btnMobile = document.getElementById('btnDownloadAnnotatedMobile');
  const originalHtml = btnDesktop ? btnDesktop.innerHTML : '';

  if (btnDesktop) btnDesktop.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
  if (btnMobile) btnMobile.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';

  try {
    const existingPdfBytes = await getSourcePdfBytes();
    const srcPdfDoc = await PDFLib.PDFDocument.load(existingPdfBytes);
    const outPdfDoc = await PDFLib.PDFDocument.create();

    const zeroBasedIndices = pageOrder.map(origNum => origNum - 1);
    const copiedPages = await outPdfDoc.copyPages(srcPdfDoc, zeroBasedIndices);

    for (let i = 0; i < copiedPages.length; i++) {
      const targetPage = copiedPages[i];
      outPdfDoc.addPage(targetPage);

      const origNum = pageOrder[i];
      const dataUrl = drawingCache[origNum];
      if (dataUrl) {
        const pngImage = await outPdfDoc.embedPng(dataUrl);
        const { width, height } = targetPage.getSize();
        targetPage.drawImage(pngImage, {
          x: 0,
          y: 0,
          width,
          height
        });
      }
    }

    const modifiedPdfBytes = await outPdfDoc.save();
    const blob = new Blob([modifiedPdfBytes], { type: 'application/pdf' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    const rawTitle = (docTitleInput?.value || 'Yeni_Not').trim();
    const cleanTitle = rawTitle.replace(/[\\/:*?"<>|]/g, '_');
    link.download = `${cleanTitle}.pdf`;
    link.click();
  } catch (err) {
    console.error("PDF oluşturma hatası:", err);
    alert("Notlu PDF oluşturulurken bir hata meydana geldi.");
  } finally {
    if (btnDesktop) btnDesktop.innerHTML = originalHtml;
    if (btnMobile) btnMobile.innerHTML = '<i class="fa-solid fa-file-arrow-down"></i>';
  }
}

document.getElementById('btnDownloadAnnotatedDesktop')?.addEventListener('click', downloadAnnotatedPDF);
document.getElementById('btnDownloadAnnotatedMobile')?.addEventListener('click', downloadAnnotatedPDF);

document.getElementById('prevPageDesktop')?.addEventListener('click', () => renderPageByIndex(currentPageIdx - 1));
document.getElementById('nextPageDesktop')?.addEventListener('click', () => renderPageByIndex(currentPageIdx + 1));
document.getElementById('prevPageMobile')?.addEventListener('click', () => renderPageByIndex(currentPageIdx - 1));
document.getElementById('nextPageMobile')?.addEventListener('click', () => renderPageByIndex(currentPageIdx + 1));

function applyZoom(delta) {
  const nextScale = +(currentScale + delta).toFixed(2);
  if (nextScale >= 0.5 && nextScale <= 3.5) {
    zoomAroundCenter(nextScale);
  }
}

document.getElementById('zoomInDesktop')?.addEventListener('click', () => applyZoom(0.25));
document.getElementById('zoomOutDesktop')?.addEventListener('click', () => applyZoom(-0.25));

canvasContainer.addEventListener('wheel', (e) => {
  if (e.ctrlKey) {
    e.preventDefault();
    applyZoom(e.deltaY < 0 ? 0.15 : -0.15);
  }
}, { passive: false });

// ==========================================================================
// DERGİLİK AI ASİSTANI
// ==========================================================================
function toggleAiDrawer() {
  aiDrawer.classList.toggle('open');
}

document.getElementById('toggleAiDrawerDesktop')?.addEventListener('click', toggleAiDrawer);
document.getElementById('toggleAiDrawerMobile')?.addEventListener('click', toggleAiDrawer);
document.getElementById('closeAiDrawer')?.addEventListener('click', () => aiDrawer.classList.remove('open'));

function appendDrawerMsg(text, sender) {
  const div = document.createElement('div');
  div.className = `d-msg ${sender === 'user' ? 'd-user' : 'd-bot'}`;
  div.innerHTML = text
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>');
  drawerMessages.appendChild(div);
  drawerMessages.scrollTop = drawerMessages.scrollHeight;
  return div;
}

async function askPdfAI(userQuery, forceCurrentPage = false) {
  const origNum = getCurrentOrigPageNum();
  const displayNum = currentPageIdx + 1;
  const currentPageText = pageTextCache[origNum] || "Bu sayfada okunabilir metin bulunamadı.";
  
  let promptPayload = userQuery;
  if (forceCurrentPage || !currentConversationId) {
    promptPayload = `[BELGE ADI]: ${docTitleInput?.value || 'Doküman'}
[AÇIK OLAN SAYFA]: ${displayNum} / ${pageOrder.length}

[SAYFA METNİ]:
"${currentPageText.slice(0, 3800)}"

[KULLANICI TALEBİ]:
${userQuery}`;
  }

  const payload = {
    inputs: {},
    query: promptPayload,
    response_mode: "blocking",
    user: "btu_desktop_user"
  };

  if (currentConversationId) payload.conversation_id = currentConversationId;

  const res = await fetch(DIFY_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  const rawText = await res.text();

  let data;
  try {
    data = JSON.parse(rawText);
  } catch (err) {
    throw new Error(`Sunucu yanıtı okunamadı (${res.status}). Endpoint bağlantısını kontrol edin.`);
  }

  if (!res.ok) {
    throw new Error(data.message || `Sunucu Hatası (${res.status})`);
  }

  if (data.conversation_id) currentConversationId = data.conversation_id;

  const outputText = data.answer || 
                     (data.data && data.data.outputs && (data.data.outputs.answer || data.data.outputs.text || data.data.outputs.result)) || 
                     "";

  return outputText || "Cevap üretilemedi.";
}

document.getElementById('btnSummarizePage')?.addEventListener('click', async () => {
  const displayNum = currentPageIdx + 1;
  aiDrawer.classList.add('open');
  appendDrawerMsg(`Sayfa ${displayNum}'i benim için özetler misin?`, 'user');
  const loading = appendDrawerMsg(`<i class="fa-solid fa-spinner fa-spin"></i> Sayfa ${displayNum} inceleniyor...`, 'bot');

  try {
    const reply = await askPdfAI(`Lütfen belgenin ${displayNum}. sayfasını ana hatlarıyla özetle.`, true);
    loading.remove();
    appendDrawerMsg(reply, 'bot');
  } catch (err) {
    loading.remove();
    appendDrawerMsg(`⚠️ ${err.message}`, 'bot');
  }
});

document.getElementById('btnKeyTakeaways')?.addEventListener('click', async () => {
  aiDrawer.classList.add('open');
  appendDrawerMsg(`Bu sayfadaki önemli notları çıkarır mısın?`, 'user');
  const loading = appendDrawerMsg(`<i class="fa-solid fa-spinner fa-spin"></i> Notlar alınıyor...`, 'bot');

  try {
    const reply = await askPdfAI(`Bu sayfada geçen temel mesajları 3 madde halinde listele.`, true);
    loading.remove();
    appendDrawerMsg(reply, 'bot');
  } catch (err) {
    loading.remove();
    appendDrawerMsg(`⚠️ ${err.message}`, 'bot');
  }
});

drawerForm?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const val = drawerInput.value.trim();
  if (!val) return;

  appendDrawerMsg(val, 'user');
  drawerInput.value = '';
  const loading = appendDrawerMsg(`<i class="fa-solid fa-spinner fa-spin"></i> Düşünüyor...`, 'bot');

  try {
    const reply = await askPdfAI(val, false);
    loading.remove();
    appendDrawerMsg(reply, 'bot');
  } catch (err) {
    loading.remove();
    appendDrawerMsg(`⚠️ ${err.message}`, 'bot');
  }
});

// ==========================================================================
// PDF YÜKLEYİCİLER (DOSYA YOLU VEYA BELLEK İÇİ BYTE)
// ==========================================================================
function resetViewerState(titleText) {
  if (docTitleInput) docTitleInput.value = titleText;
  for (const k in drawingCache) delete drawingCache[k];
  for (const k in pageStrokeHistory) delete pageStrokeHistory[k];
  for (const k in pageTextCache) delete pageTextCache[k];
  hasDrawnOnCurrentPage = false;
  currentScale = 1.0;
  cancelTextNoteBox();
  if (thumbnailGrid) thumbnailGrid.innerHTML = '';
}

function loadPdfFile(sourcePath, optionalTitle) {
  currentPdfSource = sourcePath;
  const fileName = optionalTitle || sourcePath.split('\\').pop().split('/').pop().replace(/\.pdf$/i, '');
  resetViewerState(fileName);

  pdfjsLib.getDocument(sourcePath).promise.then(doc => {
    pdfDoc = doc;
    pageOrder = Array.from({ length: doc.numPages }, (_, idx) => idx + 1);
    updatePageCounters();
    renderPageByIndex(0);
    if (thumbnailSidebar?.classList.contains('open')) {
      buildThumbnailGrid();
    }
  }).catch(err => {
    console.error("PDF Yüklenemedi:", err);
    if (docTitleInput) docTitleInput.value = "PDF Dosyası Açılamadı!";
  });
}

async function loadPdfFromBytes(pdfBytes, titleText) {
  currentPdfSource = pdfBytes;
  resetViewerState(titleText);

  const doc = await pdfjsLib.getDocument({ data: pdfBytes }).promise;
  pdfDoc = doc;
  pageOrder = Array.from({ length: doc.numPages }, (_, idx) => idx + 1);
  updatePageCounters();
  await renderPageByIndex(0);
  if (thumbnailSidebar?.classList.contains('open')) {
    buildThumbnailGrid();
  }
}

// Masaüstü Entegrasyonu ve Başlatıcı
async function initDesktopReader() {
  let currentDoc = null;
  let fileToOpen = null;

  if (window.desktopAPI) {
    currentDoc = await window.desktopAPI.getCurrentDocument();
    if (currentDoc?.isNewBlankNote) {
      await createNewBlankNote(currentDoc.title, true);
      return;
    } else if (currentDoc && currentDoc.filePath) {
      fileToOpen = currentDoc.filePath;
    } else {
      fileToOpen = await window.desktopAPI.getOpenedPdf();
    }

    window.desktopAPI.onFileOpened((newFilePath) => {
      loadPdfFile(newFilePath);
    });
  }

  if (fileToOpen) {
    loadPdfFile(fileToOpen, currentDoc?.title);
  } else {
    // Doğrudan boş bir not sayfası ile başlat
    await createNewBlankNote();
  }
}

document.getElementById('btnOpenLibrary')?.addEventListener('click', () => {
  if (window.desktopAPI) {
    window.desktopAPI.openLibraryView();
  }
});

initDesktopReader();

let resizeTimer = null;
window.addEventListener('resize', () => {
  if (!pdfDoc) return;
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    renderPageByIndex(currentPageIdx);
  }, 150);
});