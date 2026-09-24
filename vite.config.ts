import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, 'src/renderer');

export default defineConfig({
  root,
  base: './',
  publicDir: resolve(root, 'public'),
  plugins: [react()],
  build: {
    outDir: resolve(here, 'dist/renderer'),
    emptyOutDir: true,
    target: 'chrome150',
    sourcemap: false,
    rollupOptions: {
      input: {
        index: resolve(root, 'index.html'),
        mini: resolve(root, 'mini.html'),
        engine: resolve(root, 'engine.html'),
      },
    },
  },
});
