import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  publicDir: false,
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    target: 'chrome110',
    minify: true,
    lib: {
      entry: resolve(__dirname, 'src/content.ts'),
      formats: ['iife'],
      name: 'TopDownContent',
      fileName: () => 'content.js',
    },
  },
});
