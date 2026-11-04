import { SegmentedControl } from '@mantine/core';
import { useQueryClient } from '@tanstack/react-query';
import { LOCALE_NAMES, LOCALES, type Locale } from '@shared/i18n';
import { useLocale } from '../lib/i18n';
import { rpc } from '../lib/rpc';
import { useForcedLocale } from '../lib/variants';
import { WithInfo } from './ReqInfo';

// English ⇄ Français. Signed in, the choice is saved to the account so notifications and
// emails follow it too; on the sign-in screens it's remembered on this device.
export function LanguageSwitch({ signedIn = false, size = 'sm' }: { signedIn?: boolean; size?: string }) {
  const { locale, setLocale } = useLocale();
  const queryClient = useQueryClient();
  const forced = useForcedLocale();

  const change = (next: Locale) => {
    if (signedIn) {
      // Update the cached account first so the app doesn't switch back while saving.
      queryClient.setQueryData(['me'], (me: { locale: Locale } | null | undefined) => (me ? { ...me, locale: next } : me));
      void rpc.profile.setLocale({ locale: next });
    }
    setLocale(next);
  };

  if (forced) return null;
  return (
    <WithInfo id="language">
      <SegmentedControl
        size={size}
        value={locale}
        onChange={(v) => change(v as Locale)}
        data={LOCALES.map((l) => ({ value: l, label: LOCALE_NAMES[l] }))}
      />
    </WithInfo>
  );
}
