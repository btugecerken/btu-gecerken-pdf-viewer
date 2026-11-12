# BTÜ Geçerken PDF Reader — Masaüstü Doküman & Çizim Uygulaması

> **"Geçerken Güzel Bir İz Bırak"**

**BTÜ Geçerken Topluluğu** tarafından geliştirilen; PDF dokümanlarını okuma, HTML5 Canvas üzerinde kalem (stylus) ile serbest çizim/not alma ve belgeleri kütüphane mantığıyla gruplandırma imkânı sunan **Electron** tabanlı çapraz platform masaüstü uygulamasıdır.

---

## 1. Mimari Yapı ve Süreç Modeli

Uygulama, Electron'un **Main Process (Ana Süreç)** ve **Renderer Process (Arayüz Süreci)** ayrımını güvenli IPC (`preload.js`) köprüsü üzerinden yönetir:

```text
┌─────────────────────────────────────────────────────────────────┐
│                    Electron Main Process (main.js)              │
│  • Pencere Yaşam Döngüsü (Splash -> Library -> Reader)          │
│  • Dosya Sistemi Erişimi & Yerel Depolama Yönetimi              │
└───────────────────────────────┬─────────────────────────────────┘
                                │ ContextBridge (preload.js)
┌───────────────────────────────▼─────────────────────────────────┐
│                   Renderer Processes (Arayüzler)                │
├───────────────────┬─────────────────────┬───────────────────────┤
│   splash.html     │    library.html     │btu-gecerken-reader.html│
│ (Açılış Ekranı)   │  (Kütüphane & Raf)  │ (PDF & Canvas Motoru) │
│   splash.css      │  library.js/css     │ btu-gecerken-reader.js│
│                   │  library-store.js   │ btu-gecerken-reader.css│
└───────────────────┴─────────────────────┴───────────────────────┘
```

---

## 2. Temel Özellikler ve Modüller

* **Açılış Ekranı (`splash.html`, `splash.css`):** Uygulama başlatılırken arka plan servisleri ve kütüphane verileri hazırlanırken kullanıcıya akıcı bir karşılama ekranı sunar.
* **Akıllı Kütüphane ve Belge Gruplama (`library.html`, `library.js`, `library-store.js`):**
  * PDF dosyalarını ders, proje veya kategori bazlı klasörler altında gruplandırma.
  * Son okunan belgeleri kalıcı yerel depolama (`library-store.js`) üzerinden takip etme ve hızlı erişim.
* **Gelişmiş PDF Okuyucu ve Canvas Çizim Katmanı (`btu-gecerken-reader.html`, `btu-gecerken-reader.js`, `btu-gecerken-reader.css`):**
  * Yüksek çözünürlüklü sayfa görüntüleme ve yakınlaştırma (zoom) kontrolleri.
  * PDF sayfalarının üzerine katmanlı olarak çalışan **HTML5 Canvas** çizim motoru.
  * Dokunmatik ekran ve dijital kalem (**Stylus**) basıncı/hareketiyle uyumlu serbest çizim, işaretleme ve silgi araçları.

---

## 3. Dizin Yapısı

```text
btu-gecerken-pdf-reader/
├── main.js                      # Electron ana süreç (Main Process) ve pencere yöneticisi
├── preload.js                   # Güvenli IPC köprüsü (ContextBridge)
├── splash.html                  # Açılış (Splash) ekranı arayüzü
├── splash.css                   # Açılış ekranı animasyon ve tasarım stilleri
├── library.html                 # Doküman kütüphanesi ve gruplama arayüzü
├── library.css                  # Kütüphane arayüzü ve kurumsal tema stilleri
├── library.js                   # Kütüphane etkileşimleri ve belge yönetimi mantığı
├── library-store.js             # Kalıcı kütüphane veri ve grup depolama katmanı
├── btu-gecerken-reader.html     # Ana PDF okuyucu ve çizim çalışma alanı
├── btu-gecerken-reader.css      # Okuyucu araç çubuğu ve Canvas yerleşim stilleri
├── btu-gecerken-reader.js       # PDF render, Canvas çizim ve Stylus kontrol motoru
├── icon.ico                     # Uygulama masaüstü ve pencere ikonu
├── package.json                 # Proje bağımlılıkları ve derleme (build) betikleri
├── package-lock.json            # Bağımlılık sürüm kilidi
├── .gitignore                   # Git takip dışı bırakılan dosyalar (node_modules, dist)
└── README.md                    # Proje dokümantasyonu
```

---

## 4. Kurulum ve Çalıştırma

### Geliştirme Ortamında Çalıştırma
1. **Depoyu klonlayın:**
   ```bash
   git clone [https://github.com/btugecerken/btu-gecerken-pdf-viewer.git](https://github.com/btugecerken/btu-gecerken-pdf-viewer.git)
   cd btu-gecerken-pdf-viewer
   ```

2. **Bağımlılıkları yükleyin:**
   ```bash
   npm install
   ```

3. **Uygulamayı başlatın:**
   ```bash
   npm start
   ```

### Kurulum Dosyası Oluşturma (Build)
Uygulamayı çalıştırılabilir masaüstü paketine (`.exe` vb.) dönüştürmek için:
```bash
npm run build
```

---

## 5. Geliştirici ve Ekosistem

* **Geliştirici Ekip:** BTÜ Geçerken Topluluğu — Proje ve Ar-Ge Ekibi
* **Ana Web Ekosistemi:** [btugecerken.com](https://btugecerken.com)
* **GitHub Deposu:** [github.com/btugecerken/btu-gecerken-pdf-viewer](https://github.com/btugecerken/btu-gecerken-pdf-viewer)
* **İletişim:** info@btugecerken.com
