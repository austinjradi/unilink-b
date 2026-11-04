import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

const src = (path: string) => fileURLToPath(new URL(`./src/${path}`, import.meta.url));

// The service worker (src/web/sw.js) keeps the built files for offline use, so it's built with
// their hashed names. PDF reading, fonts and the course catalogue are big or many, and are kept once they're used.
function serviceWorker(): Plugin {
  return {
    name: 'unilink-service-worker',
    apply: 'build',
    generateBundle(_options, bundle) {
      const isCatalogue = (name: string) => {
        const file = bundle[name];
        return file.type === 'chunk' && !!file.facadeModuleId?.includes('/catalogue/data/');
      };
      const files = Object.keys(bundle).filter((name) => /\.(js|css|wasm)$/.test(name) && !/pdf/.test(name) && !isCatalogue(name)).sort();
      const version = createHash('sha256').update(files.join()).digest('hex').slice(0, 12);
      this.emitFile({
        type: 'asset',
        fileName: 'sw.js',
        source: readFileSync(src('web/sw.js'), 'utf8').replace('__FILES__', JSON.stringify(files)).replace('__VERSION__', JSON.stringify(version)),
      });
    },
  };
}

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
  plugins: [react(), serviceWorker()],
  build: { outDir: 'dist', chunkSizeWarningLimit: 2000 },
});
