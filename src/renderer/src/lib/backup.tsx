import { useState } from 'react';
import { Button, Group, PasswordInput, Stack, Text } from '@mantine/core';
import { modals } from '@mantine/modals';
import { notifications } from '@mantine/notifications';
import { isSealed } from '@shared/backup';
import { isOn } from '@shared/variants';
import { t } from './i18n';

// 'encrypt-backup': the passphrase is only ever in the person's head.
function PassphraseForm({ onDone }: { onDone: (passphrase: string) => void }) {
  const [passphrase, setPassphrase] = useState('');
  return (
    <Stack>
      <PasswordInput data-autofocus label="Passphrase" description="There's no way to open the backup without it." value={passphrase} onChange={(e) => setPassphrase(e.currentTarget.value)} />
      <Group justify="flex-end">
        <Button disabled={passphrase.length < 8} onClick={() => onDone(passphrase)}>
          Continue
        </Button>
      </Group>
    </Stack>
  );
}

// modals.open returns an id, which the modal's own content uses to close it. children can be any JSX.
function askPassphrase(title: string, then: (passphrase: string) => void) {
  const id = modals.open({
    title,
    children: (
      <PassphraseForm
        onDone={(passphrase) => {
          modals.close(id);
          then(passphrase);
        }}
      />
    ),
  });
}

export function downloadBackup() {
  if (isOn('encrypt-backup')) askPassphrase('Choose a passphrase for this backup', (passphrase) => void window.unilink.downloadBackup(passphrase));
  else void window.unilink.downloadBackup();
}

// Restoring replaces everything in this browser, so it asks first.
// Not a hook or a component: a plain function, called from a
// click, that opens a file picker and then modals imperatively.
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
        const restore = async (passphrase?: string) => {
          const restored = await window.unilink.restoreBackup(file, passphrase);
          if (!restored) notifications.show({ color: 'red', title: t("That didn't work"), message: t("That file isn't a UniLink backup, so nothing changed.") });
        };
        if (isSealed(await file.text())) askPassphrase('Enter this backup’s passphrase', (passphrase) => void restore(passphrase));
        else await restore();
      },
    });
  });
  input.click();
}
