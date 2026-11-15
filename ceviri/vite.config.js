import { defineConfig } from 'vite';

// public/ klasöründeki dosyalar (manifest, simgeler, service worker) dist/ köküne adları
// değişmeden kopyalanır; service worker bunları bu sabit adlarla önbelleğe alır.
export default defineConfig({
  // Göreli yollar: uygulama alt klasörde (ör. GitHub Pages /ceviri/) ve Capacitor'da çalışır.
  base: './',
});
