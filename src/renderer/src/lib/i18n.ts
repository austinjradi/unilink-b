import dayjs from 'dayjs';
import 'dayjs/locale/fr';
import { createContext, useContext } from 'react';
import { isLocale, type Locale, type Message, type Params, render, termLabel, translate } from '@shared/i18n';

// The app re-mounts when the language changes (see App.tsx), so these plain functions
// can be called anywhere during render without hooks.

const STORAGE_KEY = 'unilink.locale';

function initialLocale(): Locale {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (isLocale(saved)) return saved;
  } catch {}
  return navigator.language.toLowerCase().startsWith('fr') ? 'fr' : 'en';
}

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
export const t = (key: string, params?: Params) => translate(current, key, params);
// Mark text for translation where it's defined (module constants); call t() on it when rendering.
export const tx = (key: string) => key;
export const tm = (message: Message) => render(current, message);
export const term = (name: string) => termLabel(current, name);

export const LocaleContext = createContext<{ locale: Locale; setLocale: (l: Locale) => void }>({
  locale: current,
  setLocale: () => {},
});
export const useLocale = () => useContext(LocaleContext);
