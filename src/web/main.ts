// The bridge goes first: it sets up window.unilink before the React app makes any calls.
// A bare import runs a module only for its side effects: nothing is imported by name.
// Modules run in the order they're imported, which is how the bridge gets to go first.
import './bridge';
// This one renders the React app (src/renderer/src/main.tsx). The bridge's
// startup is asynchronous, so React may render before the database is
// open. That's fine: every call waits for it (see `ready` in bridge.ts).
import '../renderer/src/main';

// Offline use and "add to home screen" (src/web/sw.js). Only on the built site: in development
// it would keep serving files that have since changed.
// import.meta.env is filled in by Vite. PROD is true in `npm run build` output
// and false under `npm run dev`, so in development this block never runs.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  // Waiting for the load event keeps the service worker's
  // own downloads from competing with the page's first load.
  window.addEventListener('load', () => {
    // A relative path, so it still works when the site lives in a subfolder such as
    // /unilink-b/. A service worker controls only pages at or below its own folder.
    navigator.serviceWorker.register('./sw.js').catch((err) => console.warn('[sw] not registered:', err));
  });
}
