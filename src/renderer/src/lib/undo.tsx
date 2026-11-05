import { Button, Group, Text } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useQueryClient } from '@tanstack/react-query';
import { changesWithWrites } from './preload';
import { t } from './i18n';

// For things deleted without asking first: a moment to take it back.
export function useUndo() {
  const queryClient = useQueryClient();
  return (message: string, undo: () => Promise<unknown>) => {
    const id = notifications.show({
      autoClose: 8000,
      message: (
        <Group justify="space-between" wrap="nowrap" gap="sm">
          <Text size="sm">{message}</Text>
          <Button
            size="compact-xs"
            variant="subtle"
            onClick={async () => {
              notifications.hide(id);
              await undo();
              await queryClient.invalidateQueries({ predicate: changesWithWrites });
            }}
          >
            {t('Undo')}
          </Button>
        </Group>
      ),
    });
  };
}
