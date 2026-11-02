import { ActionIcon, Button, Dialog, Group, Text, Tooltip } from '@mantine/core';
import { IconFocus2 } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import { useAction } from '../lib/hooks';
import { t } from '../lib/i18n';
import { rpc } from '../lib/rpc';

// ST1 + ST2: start a focus session on a planned task, as long as the task is meant to take.
export function FocusButton({ taskId, title }: { taskId: number; title: string }) {
  const focus = useAction(() => rpc.studyMode.focusOnTask({ taskId }), { success: 'Focus session started' });
  return (
    <Tooltip label={t('Focus on this task')}>
      <ActionIcon variant="subtle" color="gray" size="sm" onClick={() => focus.mutate()} loading={focus.isPending} aria-label={t('Focus on {{title}}', { title })}>
        <IconFocus2 size={14} />
      </ActionIcon>
    </Tooltip>
  );
}

// When that session ends, on whatever page they're on: did it get done?
export function FocusCheckIn() {
  const status = useQuery({ queryKey: ['studyMode', 'status'], queryFn: () => rpc.studyMode.status(), refetchInterval: 15_000 });
  const finished = status.data?.finishedTask;
  const answer = useAction(async (done: boolean) => {
    if (done && finished) await rpc.planner.setDone({ taskId: finished.id, done: true });
    await rpc.studyMode.clearFocusTask();
  });
  if (!finished) return null;
  return (
    <Dialog opened withBorder shadow="md" radius="lg" size="sm" position={{ bottom: 20, right: 20 }} role="status">
      <Text size="sm" fw={700} mb="sm">
        {t('Focus session over. Did you finish “{{title}}”?', { title: finished.title })}
      </Text>
      <Group gap="xs">
        <Button size="xs" onClick={() => answer.mutate(true)} loading={answer.isPending}>
          {t('Yes, mark it done')}
        </Button>
        <Button size="xs" variant="default" onClick={() => answer.mutate(false)} disabled={answer.isPending}>
          {t('Not yet')}
        </Button>
      </Group>
    </Dialog>
  );
}
