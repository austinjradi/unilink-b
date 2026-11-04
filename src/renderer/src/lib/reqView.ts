import { useSyncExternalStore } from 'react';

// How the site is being looked at, not what it does, so these aren't requirement switches: whether
// the info buttons show, and whether the requirements list has taken the website's place. They're
// kept per browser, like the switches.
const INFO_KEY = 'unilink-info-hidden';
const LIST_KEY = 'unilink-requirements-open';

function saved(key: string) {
  try {
    return localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

function save(key: string, on: boolean) {
  try {
    if (on) localStorage.setItem(key, '1');
    else localStorage.removeItem(key);
  } catch {
    // Without storage, this lasts until the page reloads.
  }
}

let infoHidden = saved(INFO_KEY);
let listOpen = saved(LIST_KEY);
const listeners = new Set<() => void>();

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

// The icons are all hidden by one rule in the stylesheet, set before anything paints.
const showInfoState = () => document.documentElement.toggleAttribute('data-info-hidden', infoHidden);
showInfoState();

export function setInfoHidden(next: boolean) {
  infoHidden = next;
  save(INFO_KEY, next);
  showInfoState();
  listeners.forEach((listener) => listener());
}

// Each view comes back where it was scrolled to.
const scrolled = { site: 0, list: 0 };

export function setListOpen(next: boolean) {
  if (next === listOpen) return;
  scrolled[listOpen ? 'list' : 'site'] = window.scrollY;
  listOpen = next;
  save(LIST_KEY, next);
  listeners.forEach((listener) => listener());
  requestAnimationFrame(() => window.scrollTo(0, scrolled[next ? 'list' : 'site']));
}

export const useInfoHidden = () => useSyncExternalStore(subscribe, () => infoHidden);
export const useListOpen = () => useSyncExternalStore(subscribe, () => listOpen);
