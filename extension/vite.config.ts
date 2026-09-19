import { defineConfig } from 'vite';
import { resolve } from 'node:path';

// Popup + options pages. The content script is bundled separately
// (vite.content.config.ts) because MV3 content scripts must be a single
// classic script with no shared chunks.
export default defineConfig({
  root: resolve(__dirname, 'src'),
  base: './',
  publicDir: resolve(__dirname, 'public'),
  build: {
    outDir: resolve(__dirname, 'dist'),
    emptyOutDir: true,
    target: 'chrome110',
    minify: true,
    rollupOptions: {
      input: {
        popup: resolve(__dirname, 'src/popup.html'),
        options: resolve(__dirname, 'src/options.html'),
      },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: 'chunks/[name].js',
        assetFileNames: '[name][extname]',
      },
    },
  },
});
