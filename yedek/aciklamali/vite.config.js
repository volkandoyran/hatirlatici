import { copyFile } from 'node:fs/promises';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [
    {
      name: 'copy-service-worker',
      async writeBundle() {
        await copyFile('service-worker.js', 'dist/service-worker.js');
      },
    },
  ],
});
