import { Text } from '@mantine/core';
import { modals } from '@mantine/modals';
import { notifications } from '@mantine/notifications';
import { t } from './i18n';

// Restoring replaces everything in this browser, so it asks first.
export function restoreBackup() {
  const input = Object.assign(document.createElement('input'), { type: 'file', accept: '.unilink,application/json' });
  input.addEventListener('change', () => {
    const file = input.files?.[0];
    if (!file) return;
    modals.openConfirmModal({
      title: t('Restore this backup?'),
      children: <Text size="sm">{t('Everything now in this browser is replaced by what is in {{name}}. You sign in again afterwards.', { name: file.name })}</Text>,
      labels: { confirm: t('Restore'), cancel: t('Keep') },
      confirmProps: { color: 'red' },
      onConfirm: async () => {
        const restored = await window.unilink.restoreBackup(file);
        if (!restored) notifications.show({ color: 'red', title: t("That didn't work"), message: t("That file isn't a UniLink backup, so nothing changed.") });
      },
    });
  });
  input.click();
}
