import dayjs from 'dayjs';
import 'dayjs/locale/fr';
import { createContext, useContext } from 'react';
import { isLocale, type Locale, type Message, type Params, render, termLabel, translate } from '@shared/i18n';

// The app re-mounts when the language changes (see App.tsx), so these plain functions
// can be called anywhere during render without hooks.

const STORAGE_KEY = 'unilink-b.locale';

function initialLocale(): Locale {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (isLocale(saved)) return saved;
  } catch {}
  return navigator.language.toLowerCase().startsWith('fr') ? 'fr' : 'en';
}

// A module-level variable: the language t() uses. Reading it during
// render is safe because a language change re-mounts the whole app.
let current: Locale = initialLocale();
dayjs.locale(current);
document.documentElement.lang = current;

export const getLocale = () => current;

export function applyLocale(locale: Locale) {
  current = locale;
  dayjs.locale(locale);
  document.documentElement.lang = locale;
  try {
    localStorage.setItem(STORAGE_KEY, locale);
  } catch {}
}

// Translate English UI text (the English is the key; see src/shared/i18n).
// params fills the {{name}} placeholders in the key. A numeric
// `count` param also picks the singular or plural form.
export const t = (key: string, params?: Params) => translate(current, key, params);
// Mark text for translation where it's defined (module constants); call t() on it when rendering.
export const tx = (key: string) => key;
export const tm = (message: Message) => render(current, message);
export const term = (name: string) => termLabel(current, name);

// The default value is only used outside the Provider, which
// never happens in the app; it's there to satisfy the type.
export const LocaleContext = createContext<{ locale: Locale; setLocale: (l: Locale) => void }>({
  locale: current,
  setLocale: () => {},
});
export const useLocale = () => useContext(LocaleContext);
