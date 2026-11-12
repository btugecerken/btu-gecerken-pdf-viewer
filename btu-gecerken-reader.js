pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

// Dify API Endpoint (Sunucu adresi veya proxy)
const DIFY_API_URL = "https://btugecerken.com/api/dify/chat-messages";

let currentPdfSource = null;
let pdfDoc = null;
let pageNum = 1;
let isRendering = false;
let renderPendingNum = null;
let currentRenderTask = null;
let currentScale = 1.0;

let isPenToolbarOpen = false;
let currentMode = 'pen';
let currentColor = '#009B77';
let currentSize = 2;

const drawingCache = {};
const pageStrokeHistory = {};
const pageTextCache = {};
let currentConversationId = null;

const canvas = document.getElementById('pdfCanvas');
const ctx = canvas.getContext('2d');
const drawCanvas = document.getElementById('drawCanvas');
const drawCtx = drawCanvas.getContext('2d', { willReadFrequently: true });
const canvasContainer = document.getElementById('canvasContainer');
const penToolbar = document.getElementById('penToolbar');

const docTitleEl = document.getElementById('docTitle');
const pageNumEl = document.getElementById('pageNum');
const pageCountEl = document.getElementById('pageCount');
const mobPageNumEl = document.getElementById('mobPageNum');
const mobPageCountEl = document.getElementById('mobPageCount');

const aiDrawer = document.getElementById('pdfAiDrawer');
const drawerMessages = document.getElementById('drawerMessages');
const drawerForm = document.getElementById('drawerForm');
const drawerInput = document.getElementById('drawerInput');

function saveCurrentPageDrawing() {
  if (drawCanvas.width > 0 && drawCanvas.height > 0) {
    drawingCache[pageNum] = drawCanvas.toDataURL('image/png');
  }
}

function restorePageDrawing(num) {
  drawCtx.clearRect(0, 0, drawCanvas.width, drawCanvas.height);
  if (drawingCache[num]) {
    const img = new Image();
    img.onload = () => {
      drawCtx.drawImage(img, 0, 0, drawCanvas.width, drawCanvas.height);
    };
    img.src = drawingCache[num];
  }
}

function pushStrokeState() {
  if (!pageStrokeHistory[pageNum]) pageStrokeHistory[pageNum] = [];
  if (pageStrokeHistory[pageNum].length >= 15) pageStrokeHistory[pageNum].shift();
  pageStrokeHistory[pageNum].push(drawCtx.getImageData(0, 0, drawCanvas.width, drawCanvas.height));
}

function undoLastStroke() {
  if (pageStrokeHistory[pageNum] && pageStrokeHistory[pageNum].length > 0) {
    const prevState = pageStrokeHistory[pageNum].pop();
    drawCtx.putImageData(prevState, 0, 0);
    saveCurrentPageDrawing();
  } else {
    drawCtx.clearRect(0, 0, drawCanvas.width, drawCanvas.height);
    saveCurrentPageDrawing();
  }
}

async function renderPage(num) {
  if (isRendering) {
    if (currentRenderTask) currentRenderTask.cancel();
    renderPendingNum = num;
    return;
  }

  saveCurrentPageDrawing();
  isRendering = true;
  pageNum = num;
  updatePageCounters(num);

  try {
    const page = await pdfDoc.getPage(num);
    const containerWidth = canvasContainer.clientWidth - 24;
    const baseViewport = page.getViewport({ scale: 1.0 });

    if (window.innerWidth <= 768 && currentScale === 1.0) {
      currentScale = Math.min(1.0, containerWidth / baseViewport.width);
    }

    const viewport = page.getViewport({ scale: currentScale });

    canvas.height = viewport.height;
    canvas.width = viewport.width;
    drawCanvas.height = viewport.height;
    drawCanvas.width = viewport.width;

    const renderContext = {
      canvasContext: ctx,
      viewport: viewport
    };

    currentRenderTask = page.render(renderContext);
    await currentRenderTask.promise;
    currentRenderTask = null;

    restorePageDrawing(num);
    extractTextInBackground(page, num);
    preloadNearbyPages(num);
  } catch (err) {
    if (err.name !== 'RenderingCancelledException') {
      console.error("Render hatası:", err);
    }
  } finally {
    isRendering = false;
    if (renderPendingNum !== null) {
      const nextNum = renderPendingNum;
      renderPendingNum = null;
      renderPage(nextNum);
    }
  }
}

function updatePageCounters(num) {
  if (pageNumEl) pageNumEl.textContent = num;
  if (mobPageNumEl) mobPageNumEl.textContent = num;
}

function extractTextInBackground(page, num) {
  if (pageTextCache[num]) return;
  page.getTextContent().then(textContent => {
    const text = textContent.items.map(item => item.str).join(' ').replace(/\s+/g, ' ').trim();
    pageTextCache[num] = text;
  }).catch(() => {
    pageTextCache[num] = "";
  });
}

function preloadNearbyPages(current) {
  if (!pdfDoc) return;
  if (current + 1 <= pdfDoc.numPages) pdfDoc.getPage(current + 1);
  if (current - 1 >= 1) pdfDoc.getPage(current - 1);
}

function goToPage(target) {
  if (!pdfDoc) return;
  if (target < 1 || target > pdfDoc.numPages) return;
  renderPage(target);
}

let isDrawing = false;
let points = [];

drawCanvas.addEventListener('pointerdown', (e) => {
  if (!isPenToolbarOpen) return;
  if (e.pointerType === 'touch' && e.isPrimary === false) return;

  pushStrokeState();
  isDrawing = true;

  const rect = drawCanvas.getBoundingClientRect();
  const x = (e.clientX - rect.left) * (drawCanvas.width / rect.width);
  const y = (e.clientY - rect.top) * (drawCanvas.height / rect.height);

  points = [{ x, y }];
});

drawCanvas.addEventListener('pointermove', (e) => {
  if (!isDrawing || !isPenToolbarOpen) return;

  const rect = drawCanvas.getBoundingClientRect();
  const x = (e.clientX - rect.left) * (drawCanvas.width / rect.width);
  const y = (e.clientY - rect.top) * (drawCanvas.height / rect.height);

  points.push({ x, y });
  requestAnimationFrame(drawSmoothStroke);
});

function drawSmoothStroke() {
  if (points.length < 2) return;

  drawCtx.save();

  if (currentMode === 'eraser') {
    drawCtx.globalCompositeOperation = 'destination-out';
    drawCtx.lineWidth = currentSize * 6;
  } else if (currentMode === 'highlighter') {
    drawCtx.globalCompositeOperation = 'source-over';
    drawCtx.strokeStyle = currentColor + '55';
    drawCtx.lineWidth = currentSize * 3;
  } else {
    drawCtx.globalCompositeOperation = 'source-over';
    drawCtx.strokeStyle = currentColor;
    drawCtx.lineWidth = currentSize;
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
    saveCurrentPageDrawing();
  }
});

function togglePenToolbar() {
  isPenToolbarOpen = !isPenToolbarOpen;
  penToolbar.classList.toggle('open', isPenToolbarOpen);
  drawCanvas.classList.toggle('pen-active', isPenToolbarOpen);

  document.getElementById('penToggleDesktop')?.classList.toggle('active', isPenToolbarOpen);
  document.getElementById('penToggleMobile')?.classList.toggle('active', isPenToolbarOpen);
}

document.getElementById('penToggleDesktop')?.addEventListener('click', togglePenToolbar);
document.getElementById('penToggleMobile')?.addEventListener('click', togglePenToolbar);

document.querySelectorAll('.pen-mode-btn').forEach(btn => {
  btn.addEventListener('click', function() {
    document.querySelectorAll('.pen-mode-btn').forEach(b => b.classList.remove('active'));
    this.classList.add('active');
    currentMode = this.getAttribute('data-mode');
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
    currentSize = parseInt(this.getAttribute('data-size'));
  });
});

document.getElementById('btnUndoStroke')?.addEventListener('click', undoLastStroke);
document.getElementById('btnClearPageDraw')?.addEventListener('click', () => {
  pushStrokeState();
  drawCtx.clearRect(0, 0, drawCanvas.width, drawCanvas.height);
  saveCurrentPageDrawing();
});

let initialPinchDist = null;
let touchStartX = 0;
let touchStartY = 0;

canvasContainer.addEventListener('touchstart', (e) => {
  if (e.touches.length === 2) {
    initialPinchDist = Math.hypot(
      e.touches[0].clientX - e.touches[1].clientX,
      e.touches[0].clientY - e.touches[1].clientY
    );
  } else if (e.touches.length === 1) {
    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;
  }
}, { passive: true });

canvasContainer.addEventListener('touchmove', (e) => {
  if (e.touches.length === 2 && initialPinchDist) {
    const currentDist = Math.hypot(
      e.touches[0].clientX - e.touches[1].clientX,
      e.touches[0].clientY - e.touches[1].clientY
    );

    const diff = currentDist - initialPinchDist;
    if (Math.abs(diff) > 40) {
      if (diff > 0 && currentScale < 2.5) {
        currentScale += 0.08;
        renderPage(pageNum);
      } else if (diff < 0 && currentScale > 0.6) {
        currentScale -= 0.08;
        renderPage(pageNum);
      }
      initialPinchDist = currentDist;
    }
  }
}, { passive: true });

canvasContainer.addEventListener('touchend', (e) => {
  initialPinchDist = null;
  if (!isPenToolbarOpen && e.changedTouches.length === 1) {
    const deltaX = e.changedTouches[0].clientX - touchStartX;
    const deltaY = e.changedTouches[0].clientY - touchStartY;

    if (Math.abs(deltaX) > 75 && Math.abs(deltaY) < 60) {
      if (deltaX < 0) goToPage(pageNum + 1);
      else goToPage(pageNum - 1);
    }
  }
});

async function downloadAnnotatedPDF() {
  if (!currentPdfSource) return;
  saveCurrentPageDrawing();

  const btnDesktop = document.getElementById('btnDownloadAnnotatedDesktop');
  const btnMobile = document.getElementById('btnDownloadAnnotatedMobile');
  const originalHtml = btnDesktop ? btnDesktop.innerHTML : '';

  if (btnDesktop) btnDesktop.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
  if (btnMobile) btnMobile.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';

  try {
    const existingPdfBytes = await fetch(currentPdfSource).then(res => res.arrayBuffer());
    const pdfDocLib = await PDFLib.PDFDocument.load(existingPdfBytes);
    const pages = pdfDocLib.getPages();

    for (const [pageIndexStr, dataUrl] of Object.entries(drawingCache)) {
      const pIdx = parseInt(pageIndexStr) - 1;
      if (pages[pIdx] && dataUrl) {
        const pngImage = await pdfDocLib.embedPng(dataUrl);
        const targetPage = pages[pIdx];
        const { width, height } = targetPage.getSize();

        targetPage.drawImage(pngImage, {
          x: 0,
          y: 0,
          width: width,
          height: height
        });
      }
    }

    const modifiedPdfBytes = await pdfDocLib.save();
    const blob = new Blob([modifiedPdfBytes], { type: 'application/pdf' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    const cleanTitle = (docTitleEl?.textContent || 'Dokuman').replace(/[^a-zA-Z0-9_-]/g, '_');
    link.download = `${cleanTitle}_Notlu.pdf`;
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

document.getElementById('prevPageDesktop')?.addEventListener('click', () => goToPage(pageNum - 1));
document.getElementById('nextPageDesktop')?.addEventListener('click', () => goToPage(pageNum + 1));
document.getElementById('prevPageMobile')?.addEventListener('click', () => goToPage(pageNum - 1));
document.getElementById('nextPageMobile')?.addEventListener('click', () => goToPage(pageNum + 1));

function applyZoom(delta) {
  const nextScale = currentScale + delta;
  if (nextScale >= 0.5 && nextScale <= 3.0) {
    currentScale = nextScale;
    renderPage(pageNum);
  }
}

document.getElementById('zoomInDesktop')?.addEventListener('click', () => applyZoom(0.2));
document.getElementById('zoomOutDesktop')?.addEventListener('click', () => applyZoom(-0.2));

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
  const currentPageText = pageTextCache[pageNum] || "Bu sayfada okunabilir metin bulunamadı.";
  
  let promptPayload = userQuery;
  if (forceCurrentPage || !currentConversationId) {
    promptPayload = `[BELGE ADI]: ${docTitleEl?.textContent || 'Doküman'}
[AÇIK OLAN SAYFA]: ${pageNum} / ${pdfDoc ? pdfDoc.numPages : 1}

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
  aiDrawer.classList.add('open');
  appendDrawerMsg(`Sayfa ${pageNum}'i benim için özetler misin?`, 'user');
  const loading = appendDrawerMsg(`<i class="fa-solid fa-spinner fa-spin"></i> Sayfa ${pageNum} inceleniyor...`, 'bot');

  try {
    const reply = await askPdfAI(`Lütfen belgenin ${pageNum}. sayfasını ana hatlarıyla özetle.`, true);
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

// PDF Dosyasını Yükleme ve Çizim Alanını Sıfırlama
function loadPdfFile(sourcePath, optionalTitle) {
  currentPdfSource = sourcePath;
  const fileName = optionalTitle || sourcePath.split('\\').pop().split('/').pop();
  if (docTitleEl) docTitleEl.textContent = fileName;

  // Çizim önbelleğini sıfırla
  for (const k in drawingCache) delete drawingCache[k];
  for (const k in pageStrokeHistory) delete pageStrokeHistory[k];
  for (const k in pageTextCache) delete pageTextCache[k];

  pdfjsLib.getDocument(sourcePath).promise.then(doc => {
    pdfDoc = doc;
    if (pageCountEl) pageCountEl.textContent = doc.numPages;
    if (mobPageCountEl) mobPageCountEl.textContent = doc.numPages;
    renderPage(1);
  }).catch(err => {
    console.error("PDF Yüklenemedi:", err);
    if (docTitleEl) docTitleEl.textContent = "PDF Dosyası Açılamadı!";
  });
}

// Masaüstü Entegrasyonu ve Başlatıcı
async function initDesktopReader() {
  let fileToOpen = null;
  let fileTitle = null;

  if (window.desktopAPI) {
    // 1. Kütüphaneden bir karta tıklanarak gelinmişse o belgeyi al
    const currentDoc = await window.desktopAPI.getCurrentDocument();
    if (currentDoc && currentDoc.filePath) {
      fileToOpen = currentDoc.filePath;
      fileTitle = currentDoc.title;
    } else {
      // 2. Uygulama dışarıdan bir PDF çift tıklanarak açılmışsa onu al
      fileToOpen = await window.desktopAPI.getOpenedPdf();
    }

    // Uygulama açıkken dışarıdan yeni bir PDF açılırsa anlık yakala
    window.desktopAPI.onFileOpened((newFilePath) => {
      loadPdfFile(newFilePath);
    });
  }

  if (fileToOpen) {
    loadPdfFile(fileToOpen, fileTitle);
  } else {
    if (docTitleEl) docTitleEl.textContent = "Lütfen bir PDF açın";
  }
}

// Sol üstteki geri butonuna tıklandığında Kütüphaneye (library.html) dönüş
document.getElementById('btnOpenLibrary')?.addEventListener('click', () => {
  if (window.desktopAPI) {
    window.desktopAPI.openLibraryView();
  }
});

initDesktopReader();

window.addEventListener('resize', () => {
  if (pdfDoc) renderPage(pageNum);
});