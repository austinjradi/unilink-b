import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

// Turns a path inside src/ into an absolute file path. new URL(relative,
// import.meta.url) resolves it against the location of this config file.
const src = (path: string) => fileURLToPath(new URL(`./src/${path}`, import.meta.url));

// The service worker (src/web/sw.js) keeps the built files for offline use, so it's built with
// their hashed names. PDF reading and fonts are big or many, and are kept once they're used.
// A tiny Vite plugin. A plugin is an object with a name and
// hooks, and Vite calls each hook at its point in the build.
function serviceWorker(): Plugin {
  return {
    name: 'unilink-service-worker',
    // Only during `npm run build`, never in the dev server.
    apply: 'build',
    // Runs once every output file is known. `bundle` maps each output file name to its contents.
    generateBundle(_options, bundle) {
      // What to keep for offline use: scripts, styles and WebAssembly, but not the large PDF reader.
      const files = Object.keys(bundle).filter((name) => /\.(js|css|wasm)$/.test(name) && !/pdf/.test(name)).sort();
      // A short hash of the file names. Any change to a file changes its
      // hashed name and so this hash, which gives each deploy its own cache.
      const version = createHash('sha256').update(files.join()).digest('hex').slice(0, 12);
      // Adds sw.js to the build output, with its two placeholders replaced.
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
  // react() handles JSX and Fast Refresh, which updates edited
  // components in the dev server without losing their state.
  plugins: [react(), serviceWorker()],
  // The catalogue chunks are large on purpose, so the size warning is raised to 2000 kB.
  build: { outDir: 'dist', chunkSizeWarningLimit: 2000 },
});
