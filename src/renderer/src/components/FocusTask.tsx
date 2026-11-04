import { useState } from 'react';
import { ActionIcon, Button, Dialog, Group, NumberInput, Text, Tooltip } from '@mantine/core';
import { IconFocus2 } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import { useAction } from '../lib/hooks';
import { t } from '../lib/i18n';
import { rpc } from '../lib/rpc';
import { useVariant } from '../lib/variants';
import { ReqInfo, WithInfo } from './ReqInfo';

// ST1 + ST2: start a focus session on a planned task, as long as the task is meant to take.
export function FocusButton({ taskId, title }: { taskId: number; title: string }) {
  const separate = useVariant('study-mode-separate-from-tasks');
  const pomodoro = useVariant('pomodoro');
  const startFixed = useAction(() => rpc.studyMode.start({ minutes: 25 }), { success: () => '25 minutes on, then take 5.' });
  const focus = useAction(() => rpc.studyMode.focusOnTask({ taskId }), { success: 'Focus session started' });
  if (separate) return null;
  return (
    <WithInfo id="focus-task">
      <Tooltip label={t('Focus on this task')}>
        <ActionIcon variant="subtle" color="gray" size="sm" onClick={() => (pomodoro ? startFixed.mutate() : focus.mutate())} loading={focus.isPending} aria-label={t('Focus on {{title}}', { title })}>
          <IconFocus2 size={14} />
        </ActionIcon>
      </Tooltip>
    </WithInfo>
  );
}

// When that session ends, on whatever page they're on: did it get done?
export function FocusCheckIn() {
  const neverAsk = useVariant('no-focus-checkin');
  const askLeft = useVariant('ask-how-much-left');
  const [left, setLeft] = useState<number | string>(30);
  const status = useQuery({ queryKey: ['studyMode', 'status'], queryFn: () => rpc.studyMode.status(), refetchInterval: 15_000 });
  const finished = status.data?.finishedTask;
  const answer = useAction(async (done: boolean) => {
    if (done && finished) await rpc.planner.setDone({ taskId: finished.id, done: true });
    await rpc.studyMode.clearFocusTask();
  });
  const adjust = useAction(async () => {
    if (finished) await rpc.planner.updateTask({ taskId: finished.id, title: finished.title, minutes: Number(left) || 30 });
    await rpc.studyMode.clearFocusTask();
  });
  if (!finished || neverAsk) return null;
  return (
    <Dialog opened withBorder shadow="md" radius="lg" size="sm" position={{ bottom: 20, right: 20 }} role="status">
      <Text size="sm" fw={700} mb="sm">
        {t('Focus session over. Did you finish “{{title}}”?', { title: finished.title })} <ReqInfo id="focus-checkin" />
      </Text>
      <Group gap="xs">
        <Button size="xs" onClick={() => answer.mutate(true)} loading={answer.isPending}>
          {t('Yes, mark it done')}
        </Button>
        {!askLeft && (
          <Button size="xs" variant="default" onClick={() => answer.mutate(false)} disabled={answer.isPending}>
            {t('Not yet')}
          </Button>
        )}
      </Group>
      {askLeft && (
        <Group gap="xs" mt="xs" align="flex-end">
          <NumberInput size="xs" w={120} label="Minutes left" min={5} max={600} step={15} value={left} onChange={setLeft} />
          <Button size="xs" variant="default" onClick={() => adjust.mutate()} loading={adjust.isPending}>
            Update my plan
          </Button>
        </Group>
      )}
    </Dialog>
  );
}
