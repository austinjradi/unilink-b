// Importing a .css file from JavaScript is a Vite feature: the styles are
// added to the page, and bundled into one stylesheet in the build. Mantine's
// own styles come first, so styles.css (imported last) can override them.
import '@mantine/core/styles.css';
import '@mantine/dates/styles.css';
import '@mantine/notifications/styles.css';
import '@fontsource-variable/nunito';
import '@fontsource/fredoka/500.css';
import '@fontsource/fredoka/600.css';
import './styles.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';

// The `!` is a non-null assertion: getElementById can return null, but index.html always has
// a #root element. createRoot is how React 18 and later start rendering into a DOM element.
createRoot(document.getElementById('root')!).render(
  // StrictMode adds development-only checks: it renders components and runs effects
  // twice, to expose side effects that would break. It does nothing in production.
  <StrictMode>
    <App />
  </StrictMode>,
);
