// The bridge goes first: it sets up window.unilink before the React app makes any calls.
import './bridge';
import '../renderer/src/main';

// Offline use and "add to home screen" (src/web/sw.js). Only on the built site: in development
// it would keep serving files that have since changed.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch((err) => console.warn('[sw] not registered:', err));
  });
}
