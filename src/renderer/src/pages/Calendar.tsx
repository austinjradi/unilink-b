import { type KeyboardEvent, useState } from 'react';
import {
  ActionIcon,
  Badge,
  Box,
  Button,
  Card,
  Checkbox,
  Grid,
  Group,
  Menu,
  Modal,
  SegmentedControl,
  Select,
  Stack,
  Table,
  Text,
  Textarea,
  TextInput,
  Title,
  Tooltip,
} from '@mantine/core';
import { DateTimePicker } from '@mantine/dates';
import { useForm } from '@mantine/form';
import { useMediaQuery } from '@mantine/hooks';
import {
  IconArrowRight,
  IconChevronLeft,
  IconChevronRight,
  IconDownload,
  IconPencil,
  IconPlus,
  IconRefresh,
  IconTrash,
  IconUpload,
} from '@tabler/icons-react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { useNavigate } from 'react-router';
import { addDays, CURRENT_TERM, eachDay, termRange, ymd } from '@shared/dates';
import { chipStyle, Empty, KindBadge, kindColor, Loading, PageHeader } from '../components/ui';
import { fmtDateTime, fmtTime, toDate } from '../lib/format';
import { useAction } from '../lib/hooks';
import { type Out, rpc } from '../lib/rpc';
import { t, term, tx } from '../lib/i18n';

type Deadline = Out<typeof rpc.calendar.deadlines>[number];
type CalEvent = Out<typeof rpc.calendar.range>[number];
type View = 'month' | 'week' | 'semester';

const KINDS = [
  { value: 'assignment', label: tx('Assignment') },
  { value: 'exam', label: tx('Exam') },
  { value: 'quiz', label: tx('Quiz') },
  { value: 'other', label: tx('Other') },
];

const eventKind = (e: CalEvent) => (e.kind === 'deadline' ? e.detail : e.kind);
const eventLabel = (e: CalEvent) => (e.kind === 'deadline' ? t('Due: {{title}}', { title: e.title }) : e.title);
const mondayOf = (day: string) => {
  const d = dayjs(day);
  return ymd(d.subtract((d.day() + 6) % 7, 'day').toDate());
};

// A3 in the layout of the wireframe (A2Team.pdf p. 7).
export function CalendarPage() {
  const navigate = useNavigate();
  const today = ymd(new Date());
  const [view, setView] = useState<View>('month');
  const [cursor, setCursor] = useState(today);
  // The day listed under the calendar: today, or whichever day was picked in it.
  const [selected, setSelected] = useState(today);
  const pick = (day: string) => {
    setSelected(day);
    // When the list sits below the calendar (narrow windows), bring it into view.
    if (window.innerWidth < 1200) document.getElementById('day-list')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  const [editing, setEditing] = useState<Deadline | 'new' | null>(null);
  const [showAll, setShowAll] = useState(false);

  const exportIcs = useAction(() => rpc.calendar.exportIcs(), {
    success: (r) => (r ? t('Exported {{count}} events. Import the file into Google Calendar.', { count: r.count }) : ''),
  });
  const importIcs = useAction(() => rpc.calendar.importIcs({ classId: null }), {
    success: (r) =>
      r
        ? t('Imported {{count}} deadlines', { count: r.imported }) +
          (r.skipped ? ` ${t('(skipped {{count}} past or duplicate)', { count: r.skipped })}` : '')
        : '',
  });

  const step = (n: number) =>
    setCursor(view === 'week' ? addDays(cursor, 7 * n) : ymd(dayjs(cursor).add(n, 'month').startOf('month').toDate()));
  const title =
    view === 'semester'
      ? term(CURRENT_TERM)
      : view === 'week'
        ? `${dayjs(mondayOf(cursor)).format('D MMM')} – ${dayjs(addDays(mondayOf(cursor), 6)).format('D MMM YYYY')}`
        : dayjs(cursor).format('MMMM YYYY');

  return (
    <>
      <PageHeader
        title={t('Calendar & Planner')}
        actions={
          <>
            <Menu position="bottom-end">
              <Menu.Target>
                <Button variant="default" leftSection={<IconRefresh size={16} />}>
                  {t('Sync')}
                </Button>
              </Menu.Target>
              <Menu.Dropdown>
                <Menu.Item leftSection={<IconDownload size={14} />} onClick={() => exportIcs.mutate()}>
                  {t('Export for Google Calendar (.ics)')}
                </Menu.Item>
                <Menu.Item leftSection={<IconUpload size={14} />} onClick={() => importIcs.mutate()}>
                  {t('Import from myCourses (.ics)')}
                </Menu.Item>
              </Menu.Dropdown>
            </Menu>
            <Menu position="bottom-end">
              <Menu.Target>
                <Button size="md" leftSection={<IconPlus size={18} />}>
                  {t('Add event/assignment')}
                </Button>
              </Menu.Target>
              <Menu.Dropdown>
                <Menu.Item onClick={() => setEditing('new')}>{t('Deadline, exam or quiz')}</Menu.Item>
                <Menu.Item onClick={() => navigate('/planner?new=1')}>{t('Assignment to plan out')}</Menu.Item>
              </Menu.Dropdown>
            </Menu>
          </>
        }
      />

      <Grid gap="lg" columns={24}>
        <Grid.Col span={{ base: 24, lg: 17 }}>
          <Card padding="md">
            <Group justify="space-between" mb="md">
              <Group gap={4}>
                {view !== 'semester' && (
                  <ActionIcon variant="subtle" onClick={() => step(-1)} aria-label={t('Previous')}>
                    <IconChevronLeft size={20} />
                  </ActionIcon>
                )}
                <Title order={3} miw={190} ta="center">
                  {title}
                </Title>
                {view !== 'semester' && (
                  <ActionIcon variant="subtle" onClick={() => step(1)} aria-label={t('Next')}>
                    <IconChevronRight size={20} />
                  </ActionIcon>
                )}
                {view !== 'semester' && cursor !== today && (
                  <Button
                    size="compact-xs"
                    variant="subtle"
                    onClick={() => {
                      setCursor(today);
                      setSelected(today);
                    }}
                  >
                    {t('Today')}
                  </Button>
                )}
              </Group>
              <SegmentedControl
                size="xs"
                value={view}
                onChange={(v) => setView(v as View)}
                data={[
                  { value: 'month', label: t('Month') },
                  { value: 'week', label: t('Week') },
                  { value: 'semester', label: t('Semester') },
                ]}
              />
            </Group>
            {view === 'month' && <MonthView cursor={cursor} today={today} selected={selected} onSelect={pick} />}
            {view === 'week' && <WeekView start={mondayOf(cursor)} today={today} selected={selected} onSelect={pick} />}
            {view === 'semester' && <SemesterView />}
          </Card>
        </Grid.Col>
        <Grid.Col span={{ base: 24, lg: 7 }}>
          <Upcoming onViewAll={() => setShowAll(true)} />
        </Grid.Col>
        <Grid.Col span={24}>
          <DayList day={selected} today={today} />
        </Grid.Col>
      </Grid>

      <Modal opened={editing != null} onClose={() => setEditing(null)} title={editing === 'new' ? t('Add deadline') : t('Edit deadline')}>
        {editing && <DeadlineForm key={editing === 'new' ? 'new' : editing.id} existing={editing === 'new' ? null : editing} onDone={() => setEditing(null)} />}
      </Modal>
      <Modal opened={showAll} onClose={() => setShowAll(false)} title={t('All your deadlines')} size="xl">
        <AllDeadlines onEdit={(d) => setEditing(d)} />
      </Modal>
    </>
  );
}

function useRange(from: string, to: string) {
  return useQuery({
    queryKey: ['calendar', from, to],
    queryFn: () => rpc.calendar.range({ from, to }),
    placeholderData: keepPreviousData,
  });
}

type DayPicker = { today: string; selected: string; onSelect: (day: string) => void };

// Days are buttons: picking one lists everything on it under the calendar.
const dayButton = (day: string, onSelect: (day: string) => void) => ({
  role: 'button',
  tabIndex: 0,
  'aria-label': dayjs(day).format(t('dddd, MMMM D')),
  onClick: () => onSelect(day),
  onKeyDown: (e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onSelect(day);
    }
  },
});

function MonthView({ cursor, today, selected, onSelect }: { cursor: string } & DayPicker) {
  // On phones the chips are too narrow to read, so each event is a coloured dot instead.
  const phone = useMediaQuery('(max-width: 640px)');
  const month = dayjs(cursor).month();
  const start = mondayOf(ymd(dayjs(cursor).startOf('month').toDate()));
  const end = addDays(mondayOf(ymd(dayjs(cursor).endOf('month').toDate())), 6);
  const days = eachDay(start, end);
  const events = useRange(start, end);

  return (
    <>
      <div className="month-grid" style={{ borderTop: 'none', borderLeft: 'none' }}>
        {[1, 2, 3, 4, 5, 6, 0].map((i) => dayjs().day(i).format('ddd')).map((d) => (
          <Text key={d} size="xs" fw={800} c="dimmed" tt="uppercase" pb={4} pl={6}>
            {d}
          </Text>
        ))}
      </div>
      <div className="month-grid">
        {days.map((day) => {
          const dayEvents = (events.data ?? []).filter((e) => ymd(e.start) === day && e.kind !== 'class');
          const classes = (events.data ?? []).filter((e) => ymd(e.start) === day && e.kind === 'class').length;
          return (
            <div
              key={day}
              className="month-cell"
              data-outside={dayjs(day).month() !== month || undefined}
              data-today={day === today || undefined}
              data-selected={day === selected || undefined}
              {...dayButton(day, onSelect)}
            >
              <Group justify="space-between" gap={2}>
                <Text size="sm" fw={700} className="day-number">
                  {dayjs(day).date()}
                </Text>
                {classes > 0 && (
                  <Tooltip label={t('{{count}} classes', { count: classes })}>
                    <Box w={7} h={7} style={{ borderRadius: 7, background: 'var(--mantine-color-periwinkle-4)' }} />
                  </Tooltip>
                )}
              </Group>
              {phone ? (
                <div className="dots">
                  {dayEvents.slice(0, 8).map((e) => (
                    <span key={e.key} className="dot" style={chipStyle(eventKind(e))} data-done={e.done || undefined} />
                  ))}
                </div>
              ) : (
                dayEvents.slice(0, 3).map((e) => (
                  <Tooltip key={e.key} label={[eventLabel(e), e.classLabel, e.end ? `${fmtTime(e.start)}–${fmtTime(e.end)}` : !e.allDay && fmtTime(e.start)].filter(Boolean).join(' · ')}>
                    <span className="chip" style={chipStyle(eventKind(e))} data-done={e.done || undefined}>
                      {e.kind === 'deadline' ? e.title : e.title.split(' · ')[0]}
                    </span>
                  </Tooltip>
                ))
              )}
              {!phone && dayEvents.length > 3 && (
                <Text size="xs" c="dimmed" fw={700} mt={2}>
                  {t('+{{count}} more', { count: dayEvents.length - 3 })}
                </Text>
              )}
            </div>
          );
        })}
      </div>
      <Group gap="xs" mt="sm">
        {['session', 'task', 'assignment', 'exam', 'quiz', 'graded'].map((k) => (
          <KindBadge key={k} kind={k} />
        ))}
        <Text size="xs" c="dimmed">
          {t('· dot = class times')}
        </Text>
      </Group>
    </>
  );
}

function WeekView({ start, today, selected, onSelect }: { start: string } & DayPicker) {
  const end = addDays(start, 6);
  const events = useRange(start, end);
  return (
    <div className="week-grid">
      {eachDay(start, end).map((day) => (
        <div key={day} className="week-day" data-today={day === today || undefined} data-selected={day === selected || undefined} {...dayButton(day, onSelect)}>
          <Text size="xs" c="dimmed" tt="uppercase" fw={800}>
            {dayjs(day).format('ddd')}
          </Text>
          <Text fw={700} mb="xs">
            {dayjs(day).format('D')}
          </Text>
          {(events.data ?? [])
            .filter((e) => ymd(e.start) === day)
            .map((e) => (
              <div
                key={e.key}
                className="event"
                data-done={e.done || undefined}
                style={{ ['--event-color' as string]: `var(--mantine-color-${kindColor(eventKind(e))}-6)` }}
              >
                <Text size="xs" fw={700} lineClamp={2}>
                  {eventLabel(e)}
                </Text>
                <Text size="xs" c="dimmed">
                  {e.allDay ? e.detail : e.end ? `${fmtTime(e.start)}–${fmtTime(e.end)}` : fmtTime(e.start)}
                </Text>
              </div>
            ))}
        </div>
      ))}
    </div>
  );
}

// The whole term at a glance: deadlines, exams and sessions week by week.
function SemesterView() {
  const { start, end } = termRange(CURRENT_TERM);
  const events = useRange(start, end);
  if (events.isPending) return <Loading />;
  const items = (events.data ?? []).filter((e) => e.kind === 'deadline' || e.kind === 'session');
  const weeks = [...new Set(items.map((e) => mondayOf(ymd(e.start))))].sort();
  if (!weeks.length) return <Empty>{t('No deadlines or study sessions this term yet.')}</Empty>;

  return (
    <Stack gap="sm">
      {weeks.map((week) => (
        <Group key={week} align="flex-start" wrap="nowrap" gap="md">
          <Text size="sm" fw={800} w={110} style={{ flex: 'none' }}>
            {t('Week of {{date}}', { date: dayjs(week).format(t('MMM D')) })}
          </Text>
          <Group gap={6}>
            {items
              .filter((e) => mondayOf(ymd(e.start)) === week)
              .map((e) => (
                <Tooltip key={e.key} label={`${fmtDateTime(e.start)}${e.classLabel ? ` · ${e.classLabel}` : ''}`}>
                  <span className="chip" style={{ ...chipStyle(eventKind(e)), display: 'inline-block', marginTop: 0 }} data-done={e.done || undefined}>
                    {e.classLabel && e.classLabel !== e.title ? `${e.classLabel}: ` : ''}
                    {e.title}
                  </span>
                </Tooltip>
              ))}
          </Group>
        </Group>
      ))}
    </Stack>
  );
}

function Upcoming({ onViewAll }: { onViewAll: () => void }) {
  const upcoming = useQuery({ queryKey: ['calendar', 'upcoming', 7], queryFn: () => rpc.calendar.upcoming({ days: 7 }) });
  const sessions = useQuery({ queryKey: ['studySessions', 'mine'], queryFn: () => rpc.studySessions.mine() });
  const remove = useAction((id: number) => rpc.calendar.removeDeadline({ id }), { success: 'Deadline removed' });

  const soon = dayjs().add(7, 'day');
  const items = [
    ...(upcoming.data ?? []).map((e) => ({ key: e.key, title: e.title, sub: e.classLabel, when: e.start, end: null as Date | null, kind: eventKind(e), deadlineId: e.addedBy == null ? e.deadlineId : null, addedBy: e.addedBy })),
    ...(sessions.data ?? [])
      .filter((s) => s.myStatus === 'going' && dayjs(s.startsAt).isBefore(soon))
      .map((s) => ({ key: `s${s.id}`, title: s.title, sub: s.classLabel, when: s.startsAt, end: s.endsAt, kind: 'session', deadlineId: null, addedBy: null })),
  ].sort((a, b) => a.when.getTime() - b.when.getTime());

  return (
    <Card padding={0} h="100%">
      <Text fw={800} size="lg" className="display" px="md" py="sm" style={{ borderBottom: '1.5px solid var(--ul-border)' }}>
        {t('Upcoming (next 7 days)')}
      </Text>
      {upcoming.isPending ? (
        <Loading />
      ) : items.length ? (
        items.map((i) => (
          <Group key={i.key} px="md" py="sm" wrap="nowrap" align="flex-start" style={{ borderBottom: '1.5px solid var(--ul-border)' }}>
            <Box mt={6} w={9} h={9} style={{ flex: 'none', borderRadius: 9, background: `var(--mantine-color-${kindColor(i.kind)}-4)` }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <Text fw={700} size="sm" lineClamp={2}>
                {i.title}
              </Text>
              {i.sub && (
                <Text size="xs" c="dimmed">
                  {i.sub}
                  {i.addedBy != null && ` · ${t('shared by {{name}}', { name: i.addedBy || t('a former student') })}`}
                </Text>
              )}
              <Text size="xs" mt={2}>
                {dayjs(i.when).format(t('ddd, MMM D · HH:mm'))}
                {i.end && `–${fmtTime(i.end)}`}
              </Text>
            </div>
            {i.deadlineId != null && (
              <ActionIcon variant="subtle" color="gray" onClick={() => remove.mutate(i.deadlineId!)} aria-label={t('Delete {{name}}', { name: i.title })}>
                <IconTrash size={16} />
              </ActionIcon>
            )}
          </Group>
        ))
      ) : (
        <Empty>{t('Nothing in the next 7 days.')}</Empty>
      )}
      <Box p="sm">
        <Button variant="default" fullWidth rightSection={<IconArrowRight size={16} />} onClick={onViewAll}>
          {t('View all deadlines')}
        </Button>
      </Box>
    </Card>
  );
}

const PILL: Record<string, string> = { class: tx('Lecture'), session: tx('Study'), task: tx('Task'), deadline: tx('Due') };

function DayList({ day, today }: { day: string; today: string }) {
  const events = useRange(day, day);
  const setTask = useAction((v: { id: number; done: boolean }) => rpc.planner.setDone({ taskId: v.id, done: v.done }));
  const setDeadline = useAction((v: { id: number; done: boolean }) => rpc.calendar.setDeadlineDone(v));

  const duration = (e: CalEvent) => {
    if (!e.end) return null;
    const mins = Math.round((e.end.getTime() - e.start.getTime()) / 60_000);
    return mins >= 60 ? `${Math.floor(mins / 60)}h${mins % 60 ? ` ${mins % 60}m` : ''}` : `${mins}m`;
  };

  return (
    <Card padding={0} id="day-list" style={{ scrollMarginTop: 90 }}>
      <Text fw={800} size="lg" className="display" px="md" py="sm" style={{ borderBottom: '1.5px solid var(--ul-border)', background: 'var(--ul-soft)' }}>
        {day === today ? `${t('Today')} · ${dayjs(day).format(t('ddd, MMM D'))}` : dayjs(day).format(t('dddd, MMMM D'))}
      </Text>
      {events.isPending ? (
        <Loading />
      ) : events.data?.length ? (
        events.data.map((e) => {
          const taskId = e.kind === 'task' ? Number(e.key.slice(5)) : null;
          return (
            <Group key={e.key} px="md" py="sm" wrap="nowrap" style={{ borderBottom: '1.5px solid var(--ul-border)' }}>
              <Checkbox
                disabled={taskId == null && e.deadlineId == null}
                checked={e.done}
                onChange={(ev) =>
                  taskId != null
                    ? setTask.mutate({ id: taskId, done: ev.currentTarget.checked })
                    : setDeadline.mutate({ id: e.deadlineId!, done: ev.currentTarget.checked })
                }
                aria-label={t('Done: {{title}}', { title: e.title })}
              />
              <div style={{ width: 64 }}>
                <Text size="sm" fw={800}>
                  {e.allDay ? t('Any time') : fmtTime(e.start)}
                </Text>
                <Text size="xs" c="dimmed">
                  {e.allDay ? e.detail : duration(e)}
                </Text>
              </div>
              <Box w={9} h={9} style={{ flex: 'none', borderRadius: 9, background: `var(--mantine-color-${kindColor(eventKind(e))}-4)` }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <Text fw={700} td={e.done ? 'line-through' : undefined}>
                  {eventLabel(e)}
                </Text>
                {(e.location || (e.classLabel && e.classLabel !== e.title)) && (
                  <Text size="xs" c="dimmed">
                    {[e.classLabel !== e.title && e.classLabel, e.location].filter(Boolean).join(' · ')}
                  </Text>
                )}
              </div>
              <Badge variant="outline" color={kindColor(eventKind(e))} size="lg" visibleFrom="xs">
                {t(PILL[e.kind] ?? e.kind)}
              </Badge>
            </Group>
          );
        })
      ) : (
        <Empty>{day === today ? t("Nothing on today. Add class times from each course's Overview tab.") : t('Nothing on this day.')}</Empty>
      )}
    </Card>
  );
}

function AllDeadlines({ onEdit }: { onEdit: (d: Deadline) => void }) {
  const deadlines = useQuery({ queryKey: ['calendar', 'deadlines'], queryFn: () => rpc.calendar.deadlines() });
  const remove = useAction((id: number) => rpc.calendar.removeDeadline({ id }), { success: 'Deadline removed' });
  if (deadlines.isPending) return <Loading />;
  if (!deadlines.data?.length) return <Empty>{t('No deadlines added yet.')}</Empty>;
  return (
    <>
      <Text size="sm" c="dimmed" mb="sm">
        {t("Deadlines you add to a class are shared with everyone in that section; ones with no class stay private. Graded work from each course's Grades tab and planner due dates show on the calendar automatically.")}
      </Text>
      <Table verticalSpacing="xs">
        <Table.Tbody>
          {deadlines.data.map((d) => (
            <Table.Tr key={d.id} opacity={d.done || d.dueAt < new Date() ? 0.5 : 1}>
              <Table.Td fw={600} td={d.done ? 'line-through' : undefined}>
                {d.title}
              </Table.Td>
              <Table.Td>
                {d.classLabel ?? '—'}
                {d.addedBy != null && (
                  <Text size="xs" c="dimmed">
                    {t('shared by {{name}}', { name: d.addedBy || t('a former student') })}
                  </Text>
                )}
              </Table.Td>
              <Table.Td>
                <KindBadge kind={d.kind} />
              </Table.Td>
              <Table.Td>{fmtDateTime(d.dueAt)}</Table.Td>
              <Table.Td>
                {d.mine && (
                  <Group gap={4} justify="flex-end" wrap="nowrap">
                    <ActionIcon variant="subtle" onClick={() => onEdit(d)} aria-label={t('Edit')}>
                      <IconPencil size={16} />
                    </ActionIcon>
                    <ActionIcon variant="subtle" color="red" onClick={() => remove.mutate(d.id)} aria-label={t('Delete')}>
                      <IconTrash size={16} />
                    </ActionIcon>
                  </Group>
                )}
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </>
  );
}

export function ClassSelect({ value, onChange, label = t('Class') }: { value: number | null; onChange: (v: number | null) => void; label?: string }) {
  const classes = useQuery({ queryKey: ['classes', 'mine'], queryFn: () => rpc.classes.mine() });
  return (
    <Select
      label={label}
      placeholder={t('None')}
      clearable
      data={classes.data?.map((c) => ({ value: String(c.id), label: `${c.code} · ${c.title}` })) ?? []}
      value={value == null ? null : String(value)}
      onChange={(v) => onChange(v ? Number(v) : null)}
    />
  );
}

function DeadlineForm({ existing, onDone }: { existing: Deadline | null; onDone: () => void }) {
  const form = useForm({
    initialValues: {
      title: existing?.title ?? '',
      kind: (existing?.kind ?? 'assignment') as Deadline['kind'],
      classId: existing?.classId ?? null,
      dueAt: (existing?.dueAt ?? dayjs().add(7, 'day').hour(23).minute(59).second(0).toDate()) as Date | string | null,
      notes: existing?.notes ?? '',
    },
    validate: {
      title: (v) => (v.trim() ? null : t('Add a title')),
      dueAt: (v) => (v ? null : t('Pick a date')),
    },
  });
  const save = useAction(
    async (v: typeof form.values) => {
      const fields = { ...v, dueAt: toDate(v.dueAt)! };
      if (existing) await rpc.calendar.updateDeadline({ id: existing.id, ...fields });
      else await rpc.calendar.addDeadline(fields);
    },
    { success: 'Deadline saved', onSuccess: onDone },
  );

  return (
    <form onSubmit={form.onSubmit((v) => save.mutate(v))}>
      <Stack>
        <TextInput label={t('Title')} placeholder={t('Assignment 3')} data-autofocus {...form.getInputProps('title')} />
        <Group grow>
          <Select label={t('Type')} data={KINDS.map((k) => ({ ...k, label: t(k.label) }))} allowDeselect={false} {...form.getInputProps('kind')} />
          <DateTimePicker label={t('Due')} valueFormat="ddd D MMM YYYY, HH:mm" {...form.getInputProps('dueAt')} />
        </Group>
        <ClassSelect value={form.values.classId} onChange={(v) => form.setFieldValue('classId', v)} />
        <Text size="xs" c="dimmed" mt={-8}>
          {form.values.classId
            ? t('Everyone in this section will see it on their calendar.')
            : t('With no class, only you see it.')}
        </Text>
        <Textarea label={t('Notes')} autosize minRows={2} {...form.getInputProps('notes')} />
        <Group justify="flex-end">
          <Button type="submit" loading={save.isPending}>
            {t('Save')}
          </Button>
        </Group>
      </Stack>
    </form>
  );
}
