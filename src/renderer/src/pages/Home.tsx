import { useState } from 'react';
import { ActionIcon, Anchor, Badge, Button, Card, Checkbox, Collapse, Group, RingProgress, Stack, Text, TextInput, Tooltip } from '@mantine/core';
import { IconChevronDown, IconChevronRight, IconCircle, IconCircleCheck, IconListCheck, IconPlus, IconRepeat, IconTrash, IconX } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { parseTaskDate } from '@shared/taskDate';
import { Link } from 'react-router';
import { ymd } from '@shared/dates';
import { Feed } from '../components/Feed';
import { Empty, Loading } from '../components/ui';
import { dayLabel, fmtDateTime } from '../lib/format';
import { FocusButton } from '../components/FocusTask';
import { useAction, useMe } from '../lib/hooks';
import { type Out, rpc } from '../lib/rpc';
import { useUndo } from '../lib/undo';
import { t } from '../lib/i18n';

type TodayItem = Out<typeof rpc.todos.today>['today'][number];

// Home, after the feed wireframe (A2Team.pdf p. 9): deadlines and today's tasks on the
// left (ST3: the first thing you see), class discussions in the middle, filters on the right.
export function Home() {
  const me = useMe();
  return (
    <>
      <Text component="h1" fz={30} fw={600} className="display" mt={0} mb="md">
        {t('Hi {{name}}', { name: me.name.split(' ')[0] })} <span aria-hidden>👋</span>
        <Text span c="dimmed" fz="md" fw={500} ml="sm">
          {dayjs().format(t('dddd, MMMM D'))}
        </Text>
      </Text>
      <Feed
        left={
          <Stack gap="lg">
            <Welcome />
            <TodayTasks />
            <Deadlines />
          </Stack>
        }
      />
    </>
  );
}

// A new account's first steps, ticked off as they're done, until they all are or it's dismissed.
function Welcome() {
  const me = useMe();
  const professor = me.role === 'professor';
  const hidden = `unilink-welcome-hidden-${me.id}`;
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(hidden) === '1';
    } catch {
      return false;
    }
  });
  const mine = useQuery({ queryKey: ['classes', 'mine'], queryFn: () => rpc.classes.mine() });
  const first = mine.data?.[0]?.id;
  const around = useQuery({ queryKey: ['planner', 'aroundClasses'], queryFn: () => rpc.planner.freeTimeAroundClasses(), enabled: !professor });
  const plans = useQuery({ queryKey: ['planner', 'list'], queryFn: () => rpc.planner.list(), enabled: !professor });
  const scheme = useQuery({ queryKey: ['courses', 'assessments', first], queryFn: () => rpc.courses.assessments({ classId: first! }), enabled: professor && first != null });
  const posted = useQuery({ queryKey: ['assignments', first], queryFn: () => rpc.assignments.list({ classId: first! }), enabled: professor && first != null });
  if (!mine.data || dismissed) return null;
  const inClass = (tab = '') => (first != null ? `/classes/${first}${tab && `/${tab}`}` : '/courses/find');
  const goat = { to: '/settings/goat', label: t('Dress up your goat'), done: me.avatar != null };
  const steps = professor
    ? [
        { to: '/courses/find', label: t('Find the sections you teach'), done: first != null },
        { to: inClass('grades'), label: t('Set the grading scheme'), done: !!scheme.data?.length },
        { to: inClass('assignments'), label: t('Post an assignment'), done: !!posted.data?.length },
        goat,
      ]
    : [
        { to: '/courses/find', label: t('Find and join your classes'), done: first != null },
        { to: inClass(), label: t('Add your class times'), done: around.data != null },
        { to: '/settings/account', label: t('Set your free study time'), done: me.weeklyStudyMinutes != null },
        { to: '/planner?new=1', label: t('Plan out an assignment'), done: !!plans.data?.length },
        goat,
      ];
  if (steps.every((step) => step.done)) return null;
  const hide = () => {
    setDismissed(true);
    try {
      localStorage.setItem(hidden, '1');
    } catch {
      // It just comes back next time.
    }
  };
  return (
    <Card padding="md">
      <Group justify="space-between" wrap="nowrap" align="flex-start">
        <Text fw={800} size="lg" className="display">
          {t('Welcome to UniLink!')}
        </Text>
        <ActionIcon variant="subtle" color="gray" size="sm" onClick={hide} aria-label={t('Hide these steps')}>
          <IconX size={14} />
        </ActionIcon>
      </Group>
      <Text size="sm" c="dimmed" mb="sm">
        {t('A few things to start with:')}
      </Text>
      <Stack gap={6}>
        {steps.map((step) => (
          <Group key={step.label} gap={8} wrap="nowrap">
            {step.done ? <IconCircleCheck size={16} color="var(--mantine-color-teal-filled)" aria-label={t('Done')} /> : <IconCircle size={16} color="var(--mantine-color-dimmed)" aria-hidden />}
            {step.done ? (
              <Text size="sm" c="dimmed" td="line-through">
                {step.label}
              </Text>
            ) : (
              <Anchor component={Link} to={step.to} size="sm" fw={700}>
                {step.label}
              </Anchor>
            )}
          </Group>
        ))}
      </Stack>
    </Card>
  );
}

function TodayTasks() {
  const today = ymd(new Date());
  const data = useQuery({ queryKey: ['todos', 'today'], queryFn: () => rpc.todos.today() });
  const [title, setTitle] = useState('');
  const [showLater, setShowLater] = useState(false);
  // A date typed at the end ("Read chapter 3 friday") becomes the due date.
  const parsed = parseTaskDate(title, today);
  const add = useAction(() => rpc.todos.add({ title: parsed.title, dueDate: parsed.dueDate, classId: null, weekly: !!parsed.weekly }), { onSuccess: () => setTitle('') });

  const items = data.data?.today ?? [];
  const done = items.filter((i) => i.done).length;
  // ST2: plans move around a day off, so a bad day only takes one click.
  const me = useMe();
  const undo = useUndo();
  const daysOff = me.daysOff ?? [];
  const planned = items.some((i) => i.kind === 'task' && !i.done && i.due === today);
  const takeOff = useAction(() => rpc.planner.setDaysOff({ days: [...daysOff, today] }), {
    onSuccess: () => undo(t('Today’s planned tasks moved to your next free time.'), () => rpc.planner.setDaysOff({ days: daysOff })),
  });

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
          {planned && !daysOff.includes(today) && (
            <Anchor component="button" type="button" size="xs" c="dimmed" ta="left" w="fit-content" onClick={() => takeOff.mutate()}>
              {t('Can’t study today? Move today’s tasks')}
            </Anchor>
          )}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (title.trim()) add.mutate();
            }}
          >
            <TextInput
              size="xs"
              radius="xl"
              placeholder={t('Add a task… try "read chapter 3 friday"')}
              aria-label={t('Add a task…')}
              value={title}
              onChange={(e) => setTitle(e.currentTarget.value)}
              rightSection={
                <ActionIcon size="sm" variant="subtle" type="submit" disabled={!title.trim()} aria-label={t('Add task')}>
                  <IconPlus size={14} />
                </ActionIcon>
              }
            />
            {parsed.dueDate && (
              <Text size="xs" c="dimmed" mt={4} pl={6}>
                {parsed.weekly
                  ? t('“{{title}}”, every week, starting {{when}}', { title: parsed.title, when: dayLabel(parsed.dueDate, today) })
                  : t('“{{title}}”, due {{when}}', { title: parsed.title, when: dayLabel(parsed.dueDate, today) })}
              </Text>
            )}
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
  const undo = useUndo();
  const remove = useAction(() => rpc.todos.remove({ id: item.id }), {
    onSuccess: () => {
      if (!item.done) undo(t('To-do deleted'), () => rpc.todos.add({ title: item.title, dueDate: item.due, classId: item.classId, weekly: item.weekly }));
    },
  });

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
          {item.weekly && (
            <Badge size="xs" variant="light" color="grape" leftSection={<IconRepeat size={10} />}>
              {t('every week')}
            </Badge>
          )}
          {!item.overdue && item.kind === 'todo' && item.due && item.due !== today && (
            <Badge size="xs" variant="default">
              {dayLabel(item.due, today)}
            </Badge>
          )}
        </Group>
      </div>
      {item.kind === 'task' && !item.done && <FocusButton taskId={item.id} title={item.title} />}
      {item.kind === 'todo' && (
        <ActionIcon variant="subtle" color="gray" size="sm" onClick={() => remove.mutate()} aria-label={item.weekly ? t('Delete task and stop it repeating') : t('Delete task')}>
          <IconTrash size={13} />
        </ActionIcon>
      )}
    </Group>
  );
}

// "2 d. left" countdowns from the wireframe; the student's own deadlines can be checked off.
function Deadlines() {
  const student = useMe().role === 'student';
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
                  <Anchor
                    component={Link}
                    to={e.classId ? `/classes/${e.classId}/${e.detail === 'graded' ? 'grades' : ''}` : '/calendar'}
                    size="sm"
                    fw={700}
                    c="var(--mantine-color-text)"
                    lineClamp={2}
                  >
                    {e.title}
                  </Anchor>
                  <Text size="xs" c="dimmed">
                    {e.classLabel && `${e.classLabel} · `}
                    {fmtDateTime(e.start)}
                  </Text>
                </div>
                {student && e.detail !== 'planner' && e.detail !== 'key' && (
                  <Tooltip label={t('Plan it')}>
                    <ActionIcon
                      size="sm"
                      variant="subtle"
                      color="gray"
                      component={Link}
                      to={`/planner?new=1&from=${e.key}`}
                      aria-label={t('Plan out {{title}}', { title: e.title })}
                    >
                      <IconListCheck size={15} />
                    </ActionIcon>
                  </Tooltip>
                )}
                {student && e.deadlineId != null && (
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
