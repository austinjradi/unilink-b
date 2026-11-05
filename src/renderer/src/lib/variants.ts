import { useSyncExternalStore } from 'react';
import type { Locale } from '@shared/i18n';
import { isOn, subscribeVariants, type VariantId, variantsOn } from '@shared/variants';

// useSyncExternalStore(subscribe, getSnapshot): React calls subscribe once
// with a callback, calls getSnapshot on every render, and re-renders when the
// snapshot changes. Here the snapshot is a boolean, so comparing it is cheap.
export const useVariant = (id: VariantId) => useSyncExternalStore(subscribeVariants, () => isOn(id));

// A snapshot must be the same object while nothing has changed, or React
// re-renders forever. variantsOn() returns the same array until a switch changes.
export const useVariantsOn = () => useSyncExternalStore(subscribeVariants, variantsOn);

// 'english-only' and 'browser-language' settle the language, so there's nothing to choose.
export function useForcedLocale(): Locale | null {
  const englishOnly = useVariant('english-only');
  const browser = useVariant('browser-language');
  if (englishOnly) return 'en';
  return browser ? (navigator.language.toLowerCase().startsWith('fr') ? 'fr' : 'en') : null;
}

// With 'hide-small-counts', a section's head count only shows once there are this many.
const ENOUGH_STUDENTS = 5;

// Returns a function rather than a boolean, because the answer depends on each count.
export function useShowCount() {
  const hideSmall = useVariant('hide-small-counts');
  return (count: number) => !hideSmall || count >= ENOUGH_STUDENTS;
}
