import { useState } from 'react';
import { ActionIcon, Anchor, Badge, Button, Card, Checkbox, Collapse, Group, RingProgress, Stack, Text, TextInput } from '@mantine/core';
import { IconChevronDown, IconChevronRight, IconPlus, IconTrash } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { Link } from 'react-router';
import { ymd } from '@shared/dates';
import { Feed } from '../components/Feed';
import { Empty, Loading } from '../components/ui';
import { dayLabel, fmtDateTime } from '../lib/format';
import { useAction, useMe } from '../lib/hooks';
import { type Out, rpc } from '../lib/rpc';
import { t } from '../lib/i18n';

type TodayItem = Out<typeof rpc.todos.today>['today'][number];

// Home, after the feed wireframe (A2Team.pdf p. 9): deadlines and today's tasks on the
// left (ST3: the first thing you see), class discussions in the middle, filters on the right.
export function Home() {
  const me = useMe();
  return (
    <>
      <Text fz={30} fw={600} className="display" mb="md">
        {t('Hi {{name}}', { name: me.name.split(' ')[0] })} <span aria-hidden>👋</span>
        <Text span c="dimmed" fz="md" fw={500} ml="sm">
          {dayjs().format(t('dddd, MMMM D'))}
        </Text>
      </Text>
      <Feed
        left={
          <Stack gap="lg">
            <TodayTasks />
            <Deadlines />
          </Stack>
        }
      />
    </>
  );
}

function TodayTasks() {
  const today = ymd(new Date());
  const data = useQuery({ queryKey: ['todos', 'today'], queryFn: () => rpc.todos.today() });
  const [title, setTitle] = useState('');
  const [showLater, setShowLater] = useState(false);
  const add = useAction(() => rpc.todos.add({ title, dueDate: null, classId: null }), { onSuccess: () => setTitle('') });

  const items = data.data?.today ?? [];
  const done = items.filter((i) => i.done).length;

  return (
    <Card padding="md">
      <Group justify="space-between" mb="sm">
        <Text fw={800} size="lg" className="display">
          {t('Today')}
        </Text>
        {items.length > 0 && (
          <Group gap={6}>
            <Text size="xs" c="dimmed" fw={700}>
              {done}/{items.length}
            </Text>
            <RingProgress size={28} thickness={4} roundCaps sections={[{ value: (done / items.length) * 100, color: 'teal' }]} />
          </Group>
        )}
      </Group>
      {data.isPending ? (
        <Loading />
      ) : (
        <Stack gap={8}>
          {items.length === 0 && (
            <Text size="sm" c="dimmed">
              {t('Nothing planned today.')}
            </Text>
          )}
          {items.map((item) => (
            <TaskRow key={item.key} item={item} today={today} />
          ))}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (title.trim()) add.mutate();
            }}
          >
            <TextInput
              size="xs"
              radius="xl"
              placeholder={t('Add a task…')}
              value={title}
              onChange={(e) => setTitle(e.currentTarget.value)}
              rightSection={
                <ActionIcon size="sm" variant="subtle" type="submit" disabled={!title.trim()} aria-label={t('Add task')}>
                  <IconPlus size={14} />
                </ActionIcon>
              }
            />
          </form>
          {!!data.data?.later.length && (
            <>
              <Button
                variant="subtle"
                color="gray"
                size="compact-xs"
                w="fit-content"
                leftSection={showLater ? <IconChevronDown size={12} /> : <IconChevronRight size={12} />}
                onClick={() => setShowLater((s) => !s)}
              >
                {t('Later ({{count}})', { count: data.data.later.length })}
              </Button>
              <Collapse expanded={showLater}>
                <Stack gap={8}>
                  {data.data.later.map((item) => (
                    <TaskRow key={item.key} item={item} today={today} />
                  ))}
                </Stack>
              </Collapse>
            </>
          )}
        </Stack>
      )}
    </Card>
  );
}

function TaskRow({ item, today }: { item: TodayItem; today: string }) {
  const toggle = useAction((done: boolean) =>
    item.kind === 'task' ? rpc.planner.setDone({ taskId: item.id, done }) : rpc.todos.setDone({ id: item.id, done }),
  );
  const remove = useAction(() => rpc.todos.remove({ id: item.id }));

  return (
    <Group gap={8} wrap="nowrap" align="flex-start">
      <Checkbox mt={2} size="xs" checked={item.done} onChange={(e) => toggle.mutate(e.currentTarget.checked)} aria-label={t('Done: {{title}}', { title: item.title })} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <Text size="sm" fw={600} td={item.done ? 'line-through' : undefined} c={item.done ? 'dimmed' : undefined} lineClamp={2}>
          {item.title}
        </Text>
        <Group gap={4}>
          {item.context && (
            <Text size="xs" c="dimmed" truncate>
              {item.context}
            </Text>
          )}
          {item.progress && (
            <Badge size="xs" variant="light" color="teal">
              {t('{{done}} of {{total}} done', { done: item.progress.done, total: item.progress.total })}
            </Badge>
          )}
          {item.overdue && (
            <Badge size="xs" color="red" variant="light">
              {item.kind === 'task' ? t('missed') : t('due {{day}}', { day: dayLabel(item.due!, today).toLowerCase() })}
            </Badge>
          )}
          {!item.overdue && item.kind === 'todo' && item.due && item.due !== today && (
            <Badge size="xs" variant="default">
              {dayLabel(item.due, today)}
            </Badge>
          )}
        </Group>
      </div>
      {item.kind === 'todo' && (
        <ActionIcon variant="subtle" color="gray" size="sm" onClick={() => remove.mutate()} aria-label={t('Delete task')}>
          <IconTrash size={13} />
        </ActionIcon>
      )}
    </Group>
  );
}

// "2 d. left" countdowns from the wireframe; the student's own deadlines can be checked off.
function Deadlines() {
  const upcoming = useQuery({ queryKey: ['calendar', 'upcoming'], queryFn: () => rpc.calendar.upcoming({ days: 21 }) });
  const setDone = useAction((id: number) => rpc.calendar.setDeadlineDone({ id, done: true }), { success: 'Marked as done' });

  const left = (d: Date) => {
    const days = dayjs(d).startOf('day').diff(dayjs().startOf('day'), 'day');
    return days <= 0 ? null : days;
  };

  return (
    <Card padding="md">
      <Group justify="space-between" mb="sm">
        <Text fw={800} size="lg" className="display">
          {t('Deadlines')}
        </Text>
        <Anchor component={Link} to="/calendar" size="xs" fw={700}>
          {t('Calendar')}
        </Anchor>
      </Group>
      {upcoming.isPending ? (
        <Loading />
      ) : upcoming.data?.length ? (
        <Stack gap="sm">
          {upcoming.data.map((e) => {
            const label = left(e.start);
            return (
              <Group key={e.key} gap="sm" wrap="nowrap" align="flex-start">
                <div className="countdown" data-urgent={label == null || label === 1 || undefined}>
                  {label == null ? t('today') : t('{{count}} d. left', { count: label })}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <Text size="sm" fw={700} lineClamp={2}>
                    {e.title}
                  </Text>
                  <Text size="xs" c="dimmed">
                    {e.classLabel && `${e.classLabel} · `}
                    {fmtDateTime(e.start)}
                  </Text>
                </div>
                {e.deadlineId != null && (
                  <Checkbox size="xs" mt={2} onChange={() => setDone.mutate(e.deadlineId!)} aria-label={t('Mark {{title}} done', { title: e.title })} />
                )}
              </Group>
            );
          })}
        </Stack>
      ) : (
        <Empty>{t('Nothing due in the next three weeks.')}</Empty>
      )}
    </Card>
  );
}
