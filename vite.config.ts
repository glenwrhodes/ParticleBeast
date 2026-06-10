import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  publicDir: false,
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        three: resolve(__dirname, 'three.html'),
        editor: resolve(__dirname, 'editor.html'),
        downloads: resolve(__dirname, 'downloads.html'),
      },
    },
  },
});
