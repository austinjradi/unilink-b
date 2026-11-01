import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'electron-vite';

const shared = { '@shared': fileURLToPath(new URL('./src/shared', import.meta.url)) };

export default defineConfig({
  main: { resolve: { alias: shared } },
  preload: { resolve: { alias: shared } },
  renderer: {
    resolve: {
      alias: { ...shared, '@renderer': fileURLToPath(new URL('./src/renderer/src', import.meta.url)) },
    },
    plugins: [react()],
  },
});
