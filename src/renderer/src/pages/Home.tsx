import { Fragment, type ReactNode, useState } from 'react';
import { ActionIcon, Anchor, Badge, Button, Card, Checkbox, Collapse, Grid, Group, Popover, RingProgress, Select, Stack, Stepper, Text, TextInput, Title, Tooltip, Modal, SegmentedControl } from '@mantine/core';
import { DateInput } from '@mantine/dates';
import { IconAdjustments, IconArrowDown, IconArrowUp, IconChevronDown, IconChevronRight, IconCircle, IconCircleCheck, IconListCheck, IconPlus, IconRepeat, IconTrash, IconX } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { parseTaskDate } from '@shared/taskDate';
import { Link } from 'react-router';
import { addDays, ymd } from '@shared/dates';
import { Feed } from '../components/Feed';
import { Empty, Loading } from '../components/ui';
import { dayLabel, fmtDateTime, fmtTime } from '../lib/format';
import { FocusButton } from '../components/FocusTask';
import { useAction, useMe } from '../lib/hooks';
import { type Out, rpc } from '../lib/rpc';
import { useClipboard, useLocalStorage } from '@mantine/hooks';
import { useUndo } from '../lib/undo';
import { useVariant } from '../lib/variants';
import { t } from '../lib/i18n';
import { ReqInfo, WithInfo } from '../components/ReqInfo';

// The type of one row: Out<> gives { today, later },
// ['today'] picks that list, and [number] one item in it.
type TodayItem = Out<typeof rpc.todos.today>['today'][number];

// Home, after the feed wireframe (A2Team.pdf p. 9): deadlines and today's tasks on the
// left (ST3: the first thing you see), class discussions in the middle, filters on the right.
export function Home() {
  const me = useMe();
  const custom = useVariant('home-custom');
  const calendarFirst = useVariant('home-calendar');
  const noFeed = useVariant('no-cross-class-feed');
  const emptyStart = useVariant('empty-start');
  const wizard = useVariant('setup-wizard');
  // `enabled: wizard` means this query only runs when the setup-wizard switch is on.
  const mine = useQuery({ queryKey: ['classes', 'mine'], queryFn: () => rpc.classes.mine(), enabled: wizard });
  const [setup, setSetup] = useLocalStorage<number | 'done'>({ key: `unilink-setup-${me.id}`, defaultValue: 0 });
  const [parts, setParts] = useLocalStorage<HomePart[]>({ key: `unilink-home-${me.id}`, defaultValue: HOME_PARTS.map((p) => p.id) });
  // An early return is fine here because every hook comes before
  // it. Hooks must run in the same order on every render.
  if (wizard && setup !== 'done' && mine.data && (!mine.data.length || setup > 0)) return <SetupWizard step={setup} onStep={setSetup} />;

  // JSX kept as values and picked by id below, so the left column's order can come from data.
  const blocks: Record<string, ReactNode> = { welcome: <Welcome />, tasks: <TodayTasks />, deadlines: <Deadlines /> };
  const left = (
    <Stack gap="lg">
      {emptyStart && <InviteClassmates />}
      {(custom ? parts : HOME_PARTS.map((p) => p.id)).map((id) => (
        // A Fragment groups without adding an element. The short
        // form <></> can't take a key, hence the long form.
        <Fragment key={id}>{blocks[id]}</Fragment>
      ))}
    </Stack>
  );
  // Chained ternaries choose the middle column; null means there isn't one.
  const middle = calendarFirst ? <TodayCalendar /> : noFeed ? <ClassLinks /> : custom && !parts.includes('discussion') ? null : <Feed left={left} />;
  return (
    <>
      {custom && <HomeCustomizer parts={parts} onChange={setParts} />}
      <Text component="h1" fz={30} fw={600} className="display" mt={0} mb="md">
        {t('Hi {{name}}', { name: me.name.split(' ')[0] })} <span aria-hidden>👋</span> <ReqInfo id="nav-home" />
        <Text span c="dimmed" fz="md" fw={500} ml="sm">
          {dayjs().format(t('dddd, MMMM D'))}
        </Text>
      </Text>
      {calendarFirst || noFeed || !middle ? (
        <Grid gap="lg" columns={24}>
          <Grid.Col span={{ base: 24, lg: middle ? 8 : 24 }}>{left}</Grid.Col>
          {middle && <Grid.Col span={{ base: 24, lg: 16 }}>{middle}</Grid.Col>}
        </Grid>
      ) : (
        middle
      )}
    </>
  );
}

// 'home-custom': what's on Home and in what order, kept in this browser.
const HOME_PARTS = [
  { id: 'welcome', label: 'Getting started' },
  { id: 'tasks', label: 'Today' },
  { id: 'deadlines', label: 'Deadlines' },
  { id: 'discussion', label: 'Discussions' },
] as const;
// The union of the ids above, derived from the list, so the two can't drift apart.
type HomePart = (typeof HOME_PARTS)[number]['id'];

function HomeCustomizer({ parts, onChange }: { parts: HomePart[]; onChange: (next: HomePart[]) => void }) {
  const hidden = HOME_PARTS.filter((p) => !parts.includes(p.id)).map((p) => p.id);
  // Copies the array before changing it. State must never be changed in place, or React
  // won't notice. splice() takes the item out, then puts it back one place up or down.
  const move = (id: HomePart, by: number) => {
    const next = [...parts];
    const at = next.indexOf(id);
    next.splice(at, 1);
    next.splice(at + by, 0, id);
    onChange(next);
  };
  const row = (id: HomePart) => (
    <Group key={id} justify="space-between" wrap="nowrap">
      <Checkbox size="xs" label={HOME_PARTS.find((p) => p.id === id)!.label} checked={parts.includes(id)} onChange={(e) => onChange(e.currentTarget.checked ? [...parts, id] : parts.filter((other) => other !== id))} />
      {parts.includes(id) && (
        <Group gap={2} wrap="nowrap">
          <ActionIcon size="xs" variant="subtle" color="gray" aria-label="Move up" disabled={parts.indexOf(id) === 0} onClick={() => move(id, -1)}>
            <IconArrowUp size={12} />
          </ActionIcon>
          <ActionIcon size="xs" variant="subtle" color="gray" aria-label="Move down" disabled={parts.indexOf(id) === parts.length - 1} onClick={() => move(id, 1)}>
            <IconArrowDown size={12} />
          </ActionIcon>
        </Group>
      )}
    </Group>
  );
  return (
    <Group justify="flex-end" mb={-36}>
      <Popover position="bottom-end" width={240} withArrow>
        <Popover.Target>
          <Button size="compact-sm" variant="default" leftSection={<IconAdjustments size={14} />}>
            Customize
          </Button>
        </Popover.Target>
        <Popover.Dropdown>
          <Stack gap={8}>
            {parts.map(row)}
            {hidden.map(row)}
          </Stack>
        </Popover.Dropdown>
      </Popover>
    </Group>
  );
}

// 'home-calendar': today's classes, deadlines and sessions, in order.
function TodayCalendar() {
  const today = ymd(new Date());
  const events = useQuery({ queryKey: ['calendar', 'range', today], queryFn: () => rpc.calendar.range({ from: today, to: addDays(today, 1) }) });
  const todays = (events.data ?? []).filter((e) => ymd(e.start) === today).sort((a, b) => a.start.getTime() - b.start.getTime());
  return (
    <Card>
      <Group justify="space-between" mb="sm">
        <Title order={3}>
          {t('Today')} <ReqInfo id="nav-home" />
        </Title>
        <Anchor component={Link} to="/calendar" size="sm">
          {t('Calendar')}
        </Anchor>
      </Group>
      {events.isPending ? (
        <Loading />
      ) : todays.length ? (
        <Stack gap="xs">
          {todays.map((e) => (
            <Group key={e.key} gap="sm" wrap="nowrap" align="flex-start">
              <Text size="sm" c="dimmed" w={48} style={{ flex: 'none' }}>
                {e.allDay ? '' : fmtTime(e.start)}
              </Text>
              <div style={{ minWidth: 0 }}>
                <Text size="sm" fw={600} truncate>
                  {e.title}
                </Text>
                {e.classLabel && (
                  <Text size="xs" c="dimmed">
                    {e.classLabel}
                  </Text>
                )}
              </div>
            </Group>
          ))}
        </Stack>
      ) : (
        <Text size="sm" c="dimmed">
          Nothing on your calendar today.
        </Text>
      )}
    </Card>
  );
}

// 'no-cross-class-feed': each class's discussion, one page at a time.
function ClassLinks() {
  const mine = useQuery({ queryKey: ['classes', 'mine'], queryFn: () => rpc.classes.mine() });
  return (
    <Card>
      <Title order={3} mb="sm">
        {t('Class discussions')} <ReqInfo id="feed-board" />
      </Title>
      {mine.data?.length ? (
        <Stack gap="xs">
          {mine.data.map((c) => (
            <Anchor key={c.id} component={Link} to={`/classes/${c.id}/discussion`} fw={600}>
              {c.code}
            </Anchor>
          ))}
        </Stack>
      ) : (
        <Text size="sm" c="dimmed">
          Join a class to see its discussion.
        </Text>
      )}
    </Card>
  );
}

// 'empty-start': there's nobody here until people are asked.
function InviteClassmates() {
  const clipboard = useClipboard({ timeout: 1500 });
  return (
    <Card>
      <Text fw={700} mb={4}>
        <WithInfo id="demo-accounts">Invite your classmates</WithInfo>
      </Text>
      <Text size="sm" c="dimmed" mb="sm">
        UniLink starts empty, so it&apos;s only useful once people in your classes are on it too.
      </Text>
      <Button size="xs" variant="default" onClick={() => clipboard.copy(location.href.split('#')[0])}>
        {clipboard.copied ? 'Copied' : 'Copy the link'}
      </Button>
    </Card>
  );
}

// 'setup-wizard': the first steps, one at a time, before Home.
function SetupWizard({ step, onStep }: { step: number; onStep: (next: number | 'done') => void }) {
  const me = useMe();
  const steps = [
    { to: '/courses/find', label: me.role === 'professor' ? t('Find the sections you teach') : t('Find and join your classes') },
    ...(me.role === 'professor' ? [] : [{ to: '/settings/account', label: t('Set your free study time') }]),
    { to: '/settings/goat', label: t('Dress up your goat') },
  ];
  const last = step >= steps.length - 1;
  return (
    <Card maw={640} mx="auto" mt="xl">
      <Title order={2} mb="lg">
        <WithInfo id="home-welcome">Let&apos;s get you set up</WithInfo>
      </Title>
      <Stepper active={step} size="sm" mb="lg">
        {steps.map((s) => (
          <Stepper.Step key={s.to} label={s.label} />
        ))}
      </Stepper>
      <Group justify="flex-end">
        <Button variant="default" component={Link} to={steps[Math.min(step, steps.length - 1)].to} onClick={() => onStep(last ? 'done' : step + 1)}>
          {steps[Math.min(step, steps.length - 1)].label}
        </Button>
        <Button onClick={() => onStep(last ? 'done' : step + 1)}>{last ? 'Finish' : 'Skip this step'}</Button>
      </Group>
    </Card>
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
  const noChecklist = useVariant('no-checklist');
  const first = mine.data?.[0]?.id;
  const around = useQuery({ queryKey: ['planner', 'aroundClasses'], queryFn: () => rpc.planner.freeTimeAroundClasses(), enabled: !professor });
  const plans = useQuery({ queryKey: ['planner', 'list'], queryFn: () => rpc.planner.list(), enabled: !professor });
  const scheme = useQuery({ queryKey: ['courses', 'assessments', first], queryFn: () => rpc.courses.assessments({ classId: first! }), enabled: professor && first != null });
  const posted = useQuery({ queryKey: ['assignments', first], queryFn: () => rpc.assignments.list({ classId: first! }), enabled: professor && first != null });
  if (!mine.data || dismissed || noChecklist) return null;
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
          {t('Welcome to UniLink!')} <ReqInfo id="home-welcome" />
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

// The Today card: today's planned tasks and to-dos, a box
// for adding a to-do, and a button to take today off.
function TodayTasks() {
  const today = ymd(new Date());
  const data = useQuery({ queryKey: ['todos', 'today'], queryFn: () => rpc.todos.today() });
  const [title, setTitle] = useState('');
  const [showLater, setShowLater] = useState(false);
  const weekView = useVariant('week-of-tasks');
  const oneList = useVariant('all-todos-one-list');
  const datePicker = useVariant('todo-date-picker');
  const withClass = useVariant('todo-class');
  const hasTrash = useVariant('todo-trash');
  const canDrag = useVariant('drag-reorder-tasks');
  const [pickedDate, setPickedDate] = useState<string | null>(null);
  const [pickedClass, setPickedClass] = useState<string | null>(null);
  const myClasses = useQuery({ queryKey: ['classes', 'mine'], queryFn: () => rpc.classes.mine(), enabled: withClass });
  const [order, setOrder] = useLocalStorage<string[]>({ key: 'unilink-task-order', defaultValue: [] });
  const [dragging, setDragging] = useState<string | null>(null);
  // 'drag-reorder-tasks': the order lives in this browser. Anything not dragged yet stays below.
  const rank = (key: string) => (order.includes(key) ? order.indexOf(key) : order.length);
  const inDraggedOrder = (list: TodayItem[]) => [...list].sort((a, b) => rank(a.key) - rank(b.key));
  // HTML drag and drop: the row being dragged is kept in state, and dropping
  // it on another row moves it to that row's place in the saved order.
  const dropOn = (target: string) => {
    if (!dragging || dragging === target) return;
    const keys = inDraggedOrder(data.data?.today ?? []).map((i) => i.key).filter((key) => key !== dragging);
    keys.splice(keys.indexOf(target), 0, dragging);
    setOrder(keys);
  };
  // A date typed at the end ("Read chapter 3 friday") becomes the due date.
  const typed = parseTaskDate(title, today);
  const parsed = datePicker ? { title, dueDate: pickedDate, weekly: false } : typed;
  const add = useAction(() => rpc.todos.add({ title: parsed.title, dueDate: parsed.dueDate, classId: withClass && pickedClass ? Number(pickedClass) : null, weekly: !!parsed.weekly }), { onSuccess: () => setTitle('') });

  const items = data.data?.today ?? [];
  const done = items.filter((i) => i.done).length;
  // ST2: plans move around a day off, so a bad day only takes one click.
  const me = useMe();
  const undo = useUndo();
  const daysOff = me.daysOff ?? [];
  const noTakeOff = useVariant('no-take-today-off');
  const chooseToMove = useVariant('choose-tasks-to-move');
  const twoLists = useVariant('separate-todos-and-tasks');
  const [choosing, setChoosing] = useState(false);
  const [toMove, setToMove] = useState<number[]>([]);
  // Moves the chosen tasks one at a time: `await` inside
  // for…of waits for each call before starting the next.
  const moveChosen = useAction(async () => {
    for (const id of toMove) await rpc.planner.moveTask({ taskId: id, day: addDays(today, 1) });
  }, { onSuccess: () => { setChoosing(false); setToMove([]); } });
  const planned = !noTakeOff && items.some((i) => i.kind === 'task' && !i.done && i.due === today);
  // Adding today as a day off makes the planner move today's
  // tasks. The undo toast puts the previous list of days off back.
  const takeOff = useAction(() => rpc.planner.setDaysOff({ days: [...daysOff, today] }), {
    onSuccess: () => undo(t('Today’s planned tasks moved to your next free time.'), () => rpc.planner.setDaysOff({ days: daysOff })),
  });

  return (
    <Card padding="md">
      <Group justify="space-between" mb="sm">
        <Text fw={800} size="lg" className="display">
          {t('Today')} <ReqInfo id="home-today" />
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
          {/* Which list to draw depends on switches. When dragging */}
          {/* is on, each row is wrapped in a draggable div. */}
          {(twoLists ? items.filter((item) => item.kind === 'task') : canDrag ? inDraggedOrder(items) : items).map((item) =>
            canDrag && !twoLists ? (
              <div key={item.key} className="task-drag" draggable onDragStart={() => setDragging(item.key)} onDragEnd={() => setDragging(null)} onDragOver={(e) => e.preventDefault()} onDrop={() => dropOn(item.key)} style={{ opacity: dragging === item.key ? 0.5 : undefined }}>
                <TaskRow item={item} today={today} />
              </div>
            ) : (
              <TaskRow key={item.key} item={item} today={today} />
            ),
          )}
          {twoLists && items.some((item) => item.kind !== 'task') && (
            <Text size="xs" fw={800} c="dimmed" mt="xs">
              To-dos <ReqInfo id="plan-task" />
            </Text>
          )}
          {twoLists && items.filter((item) => item.kind !== 'task').map((item) => (
            <TaskRow key={item.key} item={item} today={today} />
          ))}
          {/* Like every Mantine modal here, it's always */}
          {/* rendered, and `opened` decides whether it shows. */}
          <Modal opened={choosing} onClose={() => setChoosing(false)} title="Which tasks should move to tomorrow?">
            <Stack gap="xs">
              {items.filter((i) => i.kind === 'task' && !i.done && i.due === today).map((i) => (
                <Checkbox key={i.id} label={i.title} checked={toMove.includes(i.id)} onChange={(e) => setToMove(e.currentTarget.checked ? [...toMove, i.id] : toMove.filter((id) => id !== i.id))} />
              ))}
              <Group justify="flex-end">
                <Button disabled={!toMove.length} onClick={() => moveChosen.mutate()} loading={moveChosen.isPending}>
                  Move them
                </Button>
              </Group>
            </Stack>
          </Modal>
          {planned && !daysOff.includes(today) && (
            <WithInfo id="home-take-off">
              <Anchor component="button" type="button" size="xs" c="dimmed" ta="left" w="fit-content" onClick={() => (chooseToMove ? setChoosing(true) : takeOff.mutate())}>
                {t('Can’t study today? Move today’s tasks')}
              </Anchor>
            </WithInfo>
          )}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (title.trim()) add.mutate();
            }}
          >
            <WithInfo id="home-add-task" block>
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
            </WithInfo>
            {datePicker && <DateInput size="xs" mt={4} placeholder="Due date" aria-label="Due date" valueFormat="ddd D MMM" clearable value={pickedDate} onChange={(v: string | null) => setPickedDate(v ? v.slice(0, 10) : null)} />}
            {withClass && <Select size="xs" mt={4} placeholder={t('Class')} aria-label={t('Class')} clearable data={(myClasses.data ?? []).map((c) => ({ value: String(c.id), label: c.code }))} value={pickedClass} onChange={setPickedClass} />}
            {parsed.dueDate && !datePicker && (
              <Text size="xs" c="dimmed" mt={4} pl={6}>
                {parsed.weekly
                  ? t('“{{title}}”, every week, starting {{when}}', { title: parsed.title, when: dayLabel(parsed.dueDate, today) })
                  : t('“{{title}}”, due {{when}}', { title: parsed.title, when: dayLabel(parsed.dueDate, today) })}
              </Text>
            )}
          </form>
          {!!data.data?.later.length && (weekView || oneList) && (
            <Stack gap={8}>
              {data.data.later
                .filter((item) => oneList || (item.due != null && item.due <= addDays(today, 7)))
                .sort((a, b) => (a.due ?? '').localeCompare(b.due ?? ''))
                .map((item) => (
                  <TaskRow key={item.key} item={item} today={today} />
                ))}
            </Stack>
          )}
          {hasTrash && <TodoTrash />}
          {!!data.data?.later.length && !weekView && !oneList && (
            <>
              <WithInfo id="home-later">
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
              </WithInfo>
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

// 'todo-trash': deleted to-dos stay here for a while, in this browser.
const TRASH_KEY = 'unilink-todo-trash';
// Reads the list that TaskRow writes, from the same localStorage key.
function TodoTrash() {
  const [trash, setTrash] = useLocalStorage<{ title: string; dueDate: string | null }[]>({ key: TRASH_KEY, defaultValue: [] });
  const restore = useAction((row: { title: string; dueDate: string | null }) => rpc.todos.add({ title: row.title, dueDate: row.dueDate, classId: null, weekly: false }), {
    onSuccess: (_r, row) => setTrash(trash.filter((other) => other !== row)),
  });
  if (!trash.length) return null;
  return (
    <div>
      <Text size="xs" fw={800} c="dimmed" mb={4}>
        Trash <ReqInfo id="task-delete" />
      </Text>
      {/* slice(-5) takes the last five items. */}
      {trash.slice(-5).map((row) => (
        <Group key={row.title} justify="space-between" wrap="nowrap">
          <Text size="xs" c="dimmed" truncate>
            {row.title}
          </Text>
          <Button size="compact-xs" variant="subtle" onClick={() => restore.mutate(row)}>
            Restore
          </Button>
        </Group>
      ))}
    </div>
  );
}

// One row in Today. Planned tasks and to-dos look alike
// here, but are saved through different procedures.
function TaskRow({ item, today }: { item: TodayItem; today: string }) {
  const hasTrash = useVariant('todo-trash');
  const askRepeating = useVariant('ask-delete-repeating');
  const [trash, setTrash] = useLocalStorage<{ title: string; dueDate: string | null }[]>({ key: TRASH_KEY, defaultValue: [] });
  // The ternary picks the procedure by kind. Both return a promise, so either one works as the action.
  const toggle = useAction((done: boolean) =>
    item.kind === 'task' ? rpc.planner.setDone({ taskId: item.id, done }) : rpc.todos.setDone({ id: item.id, done }),
  );
  const undo = useUndo();
  const [asking, setAsking] = useState(false);
  const skipWeek = useAction(() => rpc.todos.setDone({ id: item.id, done: true }));
  // After a delete, the toast offers Undo, which adds the to-do back with the same fields.
  const remove = useAction(() => rpc.todos.remove({ id: item.id }), {
    onSuccess: () => {
      if (hasTrash) setTrash([...trash, { title: item.title, dueDate: item.due }]);
      if (!item.done) undo(t('To-do deleted'), () => rpc.todos.add({ title: item.title, dueDate: item.due, classId: item.classId, weekly: item.weekly }));
    },
  });

  return (
    <Group gap={8} wrap="nowrap" align="flex-start">
      {/* A controlled checkbox: `checked` comes from the data, and onChange asks */}
      {/* the backend to change it. The new state shows once the refetch arrives. */}
      <Checkbox mt={2} size="xs" checked={item.done} onChange={(e) => toggle.mutate(e.currentTarget.checked)} aria-label={t('Done: {{title}}', { title: item.title })} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <Text size="sm" fw={600} td={item.done ? 'line-through' : undefined} c={item.done ? 'dimmed' : undefined} lineClamp={2}>
          {item.title} <ReqInfo id="task-row" />
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
        <WithInfo id="task-delete">
          <ActionIcon variant="subtle" color="gray" size="sm" onClick={() => (askRepeating && item.weekly ? setAsking(true) : remove.mutate())} aria-label={item.weekly ? t('Delete task and stop it repeating') : t('Delete task')}>
            <IconTrash size={13} />
          </ActionIcon>
        </WithInfo>
      )}
      <Modal opened={asking} onClose={() => setAsking(false)} title="Delete a repeating to-do">
        <Group justify="flex-end">
          <Button variant="default" onClick={() => { skipWeek.mutate(); setAsking(false); }}>
            Just this week
          </Button>
          <Button color="red" onClick={() => { remove.mutate(); setAsking(false); }}>
            All of them
          </Button>
        </Group>
      </Modal>
    </Group>
  );
}

// "2 d. left" countdowns from the wireframe; the student's own deadlines can be checked off.
function Deadlines() {
  const student = useMe().role === 'student';
  const showDates = useVariant('due-dates-not-countdowns');
  const planByHand = useVariant('plan-date-by-hand');
  const chooseWindow = useVariant('choose-deadline-window');
  const noCalendar = useVariant('no-calendar-page');
  const [windowDays, setWindowDays] = useLocalStorage<string>({ key: 'unilink-home-deadline-days', defaultValue: '21' });
  const days = chooseWindow ? Number(windowDays) : 21;
  // `days` is part of the key, so choosing another window fetches a new list.
  const upcoming = useQuery({ queryKey: ['calendar', 'upcoming', days], queryFn: () => rpc.calendar.upcoming({ days }) });
  const setDone = useAction((id: number) => rpc.calendar.setDeadlineDone({ id, done: true }), { success: 'Marked as done' });

  // Whole days from today to the deadline, counted from the
  // start of each day, so 11 pm tomorrow is still one day away.
  const left = (d: Date) => {
    const days = dayjs(d).startOf('day').diff(dayjs().startOf('day'), 'day');
    return days <= 0 ? null : days;
  };

  return (
    <Card padding="md">
      <Group justify="space-between" mb="sm">
        <Text fw={800} size="lg" className="display">
          {t('Deadlines')} <ReqInfo id="home-deadlines" />
        </Text>
        {!noCalendar && (
          <Anchor component={Link} to="/calendar" size="xs" fw={700}>
            {t('Calendar')}
          </Anchor>
        )}
      </Group>
      {chooseWindow && <SegmentedControl size="xs" mb="sm" value={windowDays} onChange={setWindowDays} data={['7', '21', '60']} aria-label="Days ahead" />}
      {upcoming.isPending ? (
        <Loading />
      ) : upcoming.data?.length ? (
        <Stack gap="sm">
          {upcoming.data.map((e) => {
            const label = left(e.start);
            return (
              <Group key={e.key} gap="sm" wrap="nowrap" align="flex-start">
                <div className="countdown" data-urgent={label == null || label === 1 || undefined}>
                  {showDates ? dayjs(e.start).format(t('MMM D')) : label == null ? t('today') : t('{{count}} d. left', { count: label })}
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
                {student && !planByHand && e.detail !== 'planner' && e.detail !== 'key' && (
                  <WithInfo id="plan-it">
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
                  </WithInfo>
                )}
                {student && e.deadlineId != null && (
                  <WithInfo id="deadline-done">
                    <Checkbox size="xs" mt={2} onChange={() => setDone.mutate(e.deadlineId!)} aria-label={t('Mark {{title}} done', { title: e.title })} />
                  </WithInfo>
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
