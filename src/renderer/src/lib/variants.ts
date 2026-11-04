import { useSyncExternalStore } from 'react';
import type { Locale } from '@shared/i18n';
import { isOn, subscribeVariants, type VariantId, variantsOn } from '@shared/variants';

export const useVariant = (id: VariantId) => useSyncExternalStore(subscribeVariants, () => isOn(id));

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

export function useShowCount() {
  const hideSmall = useVariant('hide-small-counts');
  return (count: number) => !hideSmall || count >= ENOUGH_STUDENTS;
}
