import { copyFile } from 'node:fs/promises';
import { defineConfig } from 'vite';

export default defineConfig({
  // Göreli yollar: uygulama GitHub Pages alt klasöründe ve Capacitor'da aynı şekilde çalışır.
  base: './',
  plugins: [
    {
      name: 'copy-service-worker',
      async writeBundle() {
        await copyFile('service-worker.js', 'dist/service-worker.js');
      },
    },
  ],
});
