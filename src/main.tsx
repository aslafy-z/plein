import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
// First import of all: registers the Paraglide locale strategy, so nothing can
// reach a message function before the language is resolvable.
import { syncDocumentLocale } from './lib/locale';
import { applyFxMode } from './lib/fx';
import 'leaflet/dist/leaflet.css';
import './styles.css';
import './lib/installPrompt'; // capture beforeinstallprompt as early as possible
import './lib/viewport'; // keep --app-height in sync (Android PWA resume)
import App from './App';
import { m } from './paraglide/messages.js';
import { AppProvider } from './state/store';

// index.html ships the base locale; put the real one on <html> before the
// first paint so screen readers and the browser's translate prompt agree with
// what is on screen.
syncDocumentLocale(m.app_title());

// Gecko runs with the expensive effects off (see lib/fx.ts) — stamped before
// the first paint so no frame ever pays for them.
applyFxMode();

// Service worker: installability + offline shell (production only)
if (!import.meta.env.DEV && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      /* offline shell is best-effort */
    });
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppProvider>
      <App />
    </AppProvider>
  </StrictMode>,
);
