import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const src = (path: string) => fileURLToPath(new URL(`./src/${path}`, import.meta.url));

export default defineConfig({
  // Relative asset URLs, so the build works from any folder (GitHub Pages serves it under /<repo>/).
  base: './',
  resolve: {
    alias: {
      '@shared': src('shared'),
      '@renderer': src('renderer/src'),
      // The services' file access runs on a browser stand-in (see src/web/node).
      'node:fs/promises': src('web/node/fs.ts'),
      'node:path': src('web/node/path.ts'),
    },
  },
  plugins: [react()],
  build: { outDir: 'dist', chunkSizeWarningLimit: 2000 },
});
