import { loadCourses, parseOffering } from '@shared/catalogue';
import { isOn } from '@shared/variants';
import { createContext, type CSSProperties, type DragEvent, type KeyboardEvent, memo, useContext, useDeferredValue, useMemo, useState } from 'react';
import type { ReqTopicId } from '../lib/reqTopics';
import {
  ActionIcon,
  Alert,
  Badge,
  Box,
  Button,
  Card,
  Chip,
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
import { useMediaQuery, useLocalStorage } from '@mantine/hooks';
import {
  IconAlertTriangle,
  IconArrowRight,
  IconChevronLeft,
  IconChevronRight,
  IconDownload,
  IconPencil,
  IconPlus,
  IconRefresh,
  IconSearch,
  IconTrash,
  IconUpload, IconFileText } from '@tabler/icons-react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { modals } from '@mantine/modals';
import { useNavigate } from 'react-router';
import { addDays, CURRENT_TERM, eachDay, TERMS, ymd } from '@shared/dates';
import { isBusyWeek } from '@shared/grades';
import { examConflicts, FINAL_EXAMS, type FinalExam, finalExamsFor, keyDatesFor, termWithExams } from '@shared/keyDates';
import { parseSyllabus, type SyllabusItem } from '@shared/syllabus';
import { examTime, useOfferings } from '../components/CourseFacts';
import { LoadOnScroll } from '../components/LoadOnScroll';
import { chipStyle, Empty, KindBadge, kindColor, Loading, PageHeader, Tag } from '../components/ui';
import { fmtDateTime, fmtTime, toDate } from '../lib/format';
import { useAction } from '../lib/hooks';
import { type Out, rpc, RpcError } from '../lib/rpc';
import { useUndo } from '../lib/undo';
import { useVariant } from '../lib/variants';
import { t, term, tx } from '../lib/i18n';
import { ReqInfo, WithInfo } from '../components/ReqInfo';
import { PlannerPage } from './Planner';

type Deadline = Out<typeof rpc.calendar.deadlines>[number];
type CalEvent = Out<typeof rpc.calendar.range>[number];
type View = 'month' | 'week' | 'semester' | 'key' | 'agenda';

const KINDS = [
  { value: 'assignment', label: tx('Assignment') },
  { value: 'exam', label: tx('Exam') },
  { value: 'quiz', label: tx('Quiz') },
  { value: 'other', label: tx('Other') },
];

const eventKind = (e: CalEvent) => (e.kind === 'deadline' ? e.detail : e.kind);

// 'colour-by-class': a class keeps one colour wherever it shows.
const CLASS_COLOURS = ['periwinkle', 'teal', 'orange', 'grape', 'cyan', 'red', 'yellow', 'green'];
const classStyle = (classId: number | null): CSSProperties =>
  ({
    '--chip-bg': `var(--mantine-color-${CLASS_COLOURS[(classId ?? 0) % CLASS_COLOURS.length]}-light)`,
    '--chip-fg': `var(--mantine-color-${CLASS_COLOURS[(classId ?? 0) % CLASS_COLOURS.length]}-light-color)`,
  }) as CSSProperties;

function useEventStyle() {
  const byClass = useVariant('colour-by-class');
  return (e: CalEvent) => (byClass ? classStyle(e.classId) : chipStyle(eventKind(e)));
}
// Final exams and the term's key deadlines read fine on their own; other deadlines get "Due:".
const eventLabel = (e: CalEvent) => (e.kind === 'deadline' && e.detail !== 'final' && e.detail !== 'key' ? t('Due: {{title}}', { title: e.title }) : e.title);
// The first day of the week: a Monday, or a Sunday with 'week-starts-sunday'.
const mondayOf = (day: string) => {
  const d = dayjs(day);
  return ymd(d.subtract(isOn('week-starts-sunday') ? d.day() : (d.day() + 6) % 7, 'day').toDate());
};

// A3 in the layout of the wireframe (A2Team.pdf p. 7).
// Classes switched off in the calendar's filter. What belongs to no class always shows.
const HiddenClasses = createContext<number[]>([]);

// 'filter-by-event-kind': kinds switched off, instead of classes.
const HiddenKinds = createContext<string[]>([]);

const FILTER_KINDS = [
  { value: 'class', label: tx('Lecture') },
  { value: 'session', label: tx('Study') },
  { value: 'task', label: tx('Task') },
  { value: 'deadline', label: tx('Due') },
  { value: 'key', label: tx('Key date') },
];

function KindFilter({ hidden, onChange }: { hidden: string[]; onChange: (hidden: string[]) => void }) {
  return (
    <Group gap={6} mb="md" role="group" aria-label="Kinds of event shown on the calendar">
      {FILTER_KINDS.map((k) => (
        <Chip key={k.value} size="xs" variant="outline" checked={!hidden.includes(k.value)} onChange={(shown) => onChange(shown ? hidden.filter((other) => other !== k.value) : [...hidden, k.value])}>
          {t(k.label)}
        </Chip>
      ))}
      <ReqInfo id="cal-filter" />
    </Group>
  );
}

function ClassFilter({ hidden, onChange }: { hidden: number[]; onChange: (hidden: number[]) => void }) {
  const mine = useQuery({ queryKey: ['classes', 'mine'], queryFn: () => rpc.classes.mine() });
  const classes = mine.data ?? [];
  if (classes.length < 2) return null;
  return (
    <Group gap={6} mb="md" aria-label={t('Classes shown on the calendar')} role="group">
      {classes.map((c) => (
        <Chip
          key={c.id}
          size="xs"
          variant="outline"
          checked={!hidden.includes(c.id)}
          onChange={(shown) => onChange(shown ? hidden.filter((id) => id !== c.id) : [...hidden, c.id])}
        >
          {c.code}
        </Chip>
      ))}
      <ReqInfo id="cal-filter" />
    </Group>
  );
}

// 'no-calendar-page': nothing here but sending events to the student's own calendar.
function ExportOnly() {
  const exportIcs = useAction((tasks: boolean) => rpc.calendar.exportIcs({ tasks }), {
    success: (r) => (r ? t('Exported {{count}} events. Import the file into Google Calendar.', { count: r.count }) : ''),
  });
  return (
    <>
      <PageHeader info="nav-calendar" title={t('Calendar')} />
      <Card padding="lg">
        <Text mb="md">UniLink doesn't keep a calendar. Send your class times, deadlines and sessions to your own instead.</Text>
        <Group>
          <Button leftSection={<IconDownload size={16} />} onClick={() => exportIcs.mutate(false)}>
            {t('Export for Google Calendar (.ics)')}
          </Button>
          <Button variant="default" leftSection={<IconDownload size={16} />} onClick={() => exportIcs.mutate(true)}>
            {t('Export with my planned tasks (.ics)')}
          </Button>
        </Group>
      </Card>
    </>
  );
}

export function CalendarPage() {
  const noCalendar = useVariant('no-calendar-page');
  return noCalendar ? <ExportOnly /> : <FullCalendar />;
}

function FullCalendar() {
  const navigate = useNavigate();
  const noSyllabus = useVariant('no-syllabus-import');
  const professorDates = useVariant('professor-enters-dates');
  const oneForm = useVariant('one-add-form');
  const continuous = useVariant('continuous-calendar');
  const agenda = useVariant('agenda-view');
  const onlyMonthWeek = useVariant('only-month-week');
  const hideKeyDates = useVariant('hide-key-dates');
  const kindFilter = useVariant('filter-by-event-kind');
  const dayPopup = useVariant('day-popup');
  const separatePlans = useVariant('calendar-without-plans');
  const plannerHere = useVariant('planner-in-calendar');
  const noExportTasks = useVariant('no-export-tasks');
  const planAfter = useVariant('calendar-first-then-plan');
  const [dayOpen, setDayOpen] = useState(false);
  const [hiddenKinds, setHiddenKinds] = useState<string[]>([]);
  const canImport = !noSyllabus && !professorDates;
  const today = ymd(new Date());
  const [view, setView] = useState<View>('month');
  const [cursor, setCursor] = useState(today);
  // The day listed under the calendar: today, or whichever day was picked in it.
  const [selected, setSelected] = useState(today);
  const pick = (day: string) => {
    setSelected(day);
    if (dayPopup) setDayOpen(true);
    // When the list sits below the calendar (narrow windows), bring it into view.
    if (window.innerWidth < 1200) document.getElementById('day-list')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  const [editing, setEditing] = useState<Deadline | 'new' | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [importing, setImporting] = useState(false);
  // Remembered between visits, on this device.
  const [hidden, setHidden] = useLocalStorage<number[]>({ key: 'unilink-calendar-hidden-classes', defaultValue: [] });

  const exportIcs = useAction((tasks: boolean) => rpc.calendar.exportIcs({ tasks }), {
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
    view === 'semester' || view === 'key'
      ? term(CURRENT_TERM)
      : view === 'week'
        ? `${dayjs(mondayOf(cursor)).format('D MMM')} – ${dayjs(addDays(mondayOf(cursor), 6)).format('D MMM YYYY')}`
        : dayjs(cursor).format('MMMM YYYY');

  return (
    <>
      <PageHeader
        info="calendar-page"
        title={separatePlans ? t('Calendar') : t('Calendar & Planner')}
        actions={
          <>
            <WithInfo id="cal-sync">
              <Menu position="bottom-end">
                <Menu.Target>
                  <Button variant="default" leftSection={<IconRefresh size={16} />}>
                    {t('Sync')}
                  </Button>
                </Menu.Target>
                <Menu.Dropdown>
                  <Menu.Item leftSection={<IconDownload size={14} />} rightSection={<ReqInfo id="cal-export" />} onClick={() => exportIcs.mutate(false)}>
                    {t('Export for Google Calendar (.ics)')}
                  </Menu.Item>
                  <Menu.Item display={noExportTasks ? 'none' : undefined} leftSection={<IconDownload size={14} />} rightSection={<ReqInfo id="cal-export-tasks" />} onClick={() => exportIcs.mutate(true)}>
                    {t('Export with my planned tasks (.ics)')}
                  </Menu.Item>
                  <Menu.Item leftSection={<IconUpload size={14} />} rightSection={<ReqInfo id="cal-import" />} onClick={() => importIcs.mutate()}>
                    {t('Import from myCourses (.ics)')}
                  </Menu.Item>
                </Menu.Dropdown>
              </Menu>
            </WithInfo>
            {oneForm ? (
              <WithInfo id="cal-add">
                <Button size="md" leftSection={<IconPlus size={18} />} onClick={() => setEditing('new')}>
                  {t('Add event/assignment')}
                </Button>
              </WithInfo>
            ) : (
            <WithInfo id="cal-add">
              <Menu position="bottom-end">
                <Menu.Target>
                  <Button size="md" leftSection={<IconPlus size={18} />}>
                    {t('Add event/assignment')}
                  </Button>
                </Menu.Target>
                <Menu.Dropdown>
                  <Menu.Item rightSection={<ReqInfo id="deadline-add" />} onClick={() => setEditing('new')}>{t('Deadline, exam or quiz')}</Menu.Item>
                  {!separatePlans && !planAfter && <Menu.Item rightSection={<ReqInfo id="cal-add-plan" />} onClick={() => navigate('/planner?new=1')}>{t('Assignment to plan out')}</Menu.Item>}
                  {canImport && <Menu.Item rightSection={<ReqInfo id="syllabus-import" />} onClick={() => setImporting(true)}>{t('Dates from a syllabus')}</Menu.Item>}
                </Menu.Dropdown>
              </Menu>
            </WithInfo>
            )}
          </>
        }
      />

      <HiddenClasses.Provider value={kindFilter ? [] : hidden}>
      <HiddenKinds.Provider value={kindFilter ? hiddenKinds : []}>
      <Grid gap="lg" columns={24}>
        <Grid.Col span={{ base: 24, lg: 17 }}>
          <Card padding="md">
            <Group justify="space-between" mb="md">
              <Group gap={4}>
                {view !== 'semester' && view !== 'key' && view !== 'agenda' && !(continuous && view === 'month') && (
                  <ActionIcon variant="subtle" onClick={() => step(-1)} aria-label={t('Previous')}>
                    <IconChevronLeft size={20} />
                  </ActionIcon>
                )}
                <Title order={3} miw={190} ta="center">
                  {view === 'key' ? t('Key dates and exams') : title}
                </Title>
                {view !== 'semester' && view !== 'key' && view !== 'agenda' && !(continuous && view === 'month') && (
                  <ActionIcon variant="subtle" onClick={() => step(1)} aria-label={t('Next')}>
                    <IconChevronRight size={20} />
                  </ActionIcon>
                )}
                {view !== 'semester' && view !== 'key' && cursor !== today && (
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
                {view !== 'semester' && view !== 'key' && <ReqInfo id="cal-nav" />}
              </Group>
              <WithInfo id="cal-views">
                <SegmentedControl
                  size="xs"
                  value={view}
                  onChange={(v) => setView(v as View)}
                  data={[
                    { value: 'month', label: t('Month') },
                    { value: 'week', label: t('Week') },
                    ...(agenda ? [{ value: 'agenda', label: 'Agenda' }] : []),
                    ...(onlyMonthWeek ? [] : [{ value: 'semester', label: t('Semester') }]),
                    ...(onlyMonthWeek || hideKeyDates ? [] : [{ value: 'key', label: t('Key dates') }]),
                  ]}
                />
              </WithInfo>
            </Group>
            {view !== 'key' && !kindFilter && <ClassFilter hidden={hidden} onChange={setHidden} />}
            {view !== 'key' && kindFilter && <KindFilter hidden={hiddenKinds} onChange={setHiddenKinds} />}
            {view === 'month' && !continuous && <MonthView cursor={cursor} today={today} selected={selected} onSelect={pick} />}
            {view === 'month' && continuous && (
              <Box style={{ maxHeight: 680, overflowY: 'auto' }}>
                {Array.from({ length: 12 }, (_, n) => ymd(dayjs(today).startOf('month').add(n - 1, 'month').toDate())).map((month) => (
                  <Box key={month} mb="lg">
                    <Text fw={800} mb={4}>
                      {dayjs(month).format('MMMM YYYY')}
                    </Text>
                    <MonthView cursor={month} today={today} selected={selected} onSelect={pick} />
                  </Box>
                ))}
              </Box>
            )}
            {view === 'agenda' && <AgendaView today={today} />}
            {view === 'week' && <WeekView start={mondayOf(cursor)} today={today} selected={selected} onSelect={pick} />}
            {view === 'semester' && <SemesterView />}
            {view === 'key' && <KeyDatesView />}
          </Card>
        </Grid.Col>
        <Grid.Col span={{ base: 24, lg: 7 }}>
          <Upcoming onViewAll={() => setShowAll(true)} />
        </Grid.Col>
        {!dayPopup && (
          <Grid.Col span={24}>
            <DayList day={selected} today={today} />
          </Grid.Col>
        )}
        {plannerHere && (
          <Grid.Col span={24}>
            <PlannerPage />
          </Grid.Col>
        )}
      </Grid>
      {dayPopup && (
        <Modal opened={dayOpen} onClose={() => setDayOpen(false)} title={dayjs(selected).format(t('dddd, MMMM D'))} size="lg" padding={0}>
          <DayList day={selected} today={today} />
        </Modal>
      )}
      </HiddenKinds.Provider>
      </HiddenClasses.Provider>

      <Modal opened={editing != null} onClose={() => setEditing(null)} title={editing === 'new' ? <WithInfo id="deadline-add">{t('Add deadline')}</WithInfo> : <WithInfo id="deadline-manage">{t('Edit deadline')}</WithInfo>}>
        {editing && (
          <DeadlineForm
            key={editing === 'new' ? 'new' : editing.id}
            existing={editing === 'new' ? null : editing}
            onDone={(saved) => {
              setEditing(null);
              if (planAfter && saved) {
                modals.openConfirmModal({
                  title: <WithInfo id="cal-add-plan">Plan it out?</WithInfo>,
                  children: <Text size="sm">It's on your calendar. Want to split it into tasks too?</Text>,
                  labels: { confirm: t('Plan it'), cancel: 'Not now' },
                  onConfirm: () => navigate(`/planner?new=1&from=deadline-${saved}`),
                });
              }
            }}
            onPickOther={
              oneForm
                ? (choice) => {
                    setEditing(null);
                    if (choice === 'plan') navigate('/planner?new=1');
                    else setImporting(true);
                  }
                : undefined
            }
          />
        )}
      </Modal>
      <Modal opened={importing} onClose={() => setImporting(false)} title={<WithInfo id="syllabus-import">{t('Import dates from a syllabus')}</WithInfo>} size="xl">
        {importing && <SyllabusImport onDone={() => setImporting(false)} />}
      </Modal>
      <Modal opened={showAll} onClose={() => setShowAll(false)} title={<WithInfo id="cal-all-deadlines">{t('All your deadlines')}</WithInfo>} size="xl">
        <AllDeadlines onEdit={(d) => setEditing(d)} />
      </Modal>
    </>
  );
}

function useRange(from: string, to: string) {
  const hidden = useContext(HiddenClasses);
  const hiddenKinds = useContext(HiddenKinds);
  return useQuery({
    queryKey: ['calendar', from, to],
    queryFn: () => rpc.calendar.range({ from, to }),
    placeholderData: keepPreviousData,
    select: (events) => events.filter((e) => (e.classId == null || !hidden.includes(e.classId)) && !hiddenKinds.includes(e.kind)),
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
  const styleOf = useEventStyle();
  const byClass = useVariant('colour-by-class');
  const canDrag = useVariant('drag-tasks');
  const moveTask = useAction((v: { taskId: number; day: string }) => rpc.planner.moveTask(v));
  const dragTask = (e: CalEvent) => ({ draggable: true, onDragStart: (event: DragEvent) => event.dataTransfer.setData('text/unilink-task', e.key.slice(5)) });
  const dropOn = (day: string) => ({
    onDragOver: (event: DragEvent) => event.preventDefault(),
    onDrop: (event: DragEvent) => {
      const id = Number(event.dataTransfer.getData('text/unilink-task'));
      if (id) moveTask.mutate({ taskId: id, day });
    },
  });

  return (
    <>
      <div className="month-grid" style={{ borderTop: 'none', borderLeft: 'none' }}>
        {(isOn('week-starts-sunday') ? [0, 1, 2, 3, 4, 5, 6] : [1, 2, 3, 4, 5, 6, 0]).map((i) => dayjs().day(i).format('ddd')).map((d) => (
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
              {...(canDrag ? dropOn(day) : {})}
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
                    <span key={e.key} className="dot" style={styleOf(e)} data-done={e.done || undefined} />
                  ))}
                </div>
              ) : (
                dayEvents.slice(0, 3).map((e) => (
                  <Tooltip key={e.key} label={[eventLabel(e), e.classLabel, e.end ? `${fmtTime(e.start)}–${fmtTime(e.end)}` : !e.allDay && fmtTime(e.start)].filter(Boolean).join(' · ')}>
                    <span className="chip" style={styleOf(e)} data-done={e.done || undefined} {...(canDrag && e.kind === 'task' ? dragTask(e) : {})}>
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
        {!byClass && ['session', 'task', 'assignment', 'exam', 'quiz', 'graded', 'final', 'key'].map((k) => (
          <KindBadge key={k} kind={k} />
        ))}
        <Text size="xs" c="dimmed">
          {t('· dot = class times')} <ReqInfo id="cal-legend" /> <ReqInfo id="cal-day" />
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
      <ReqInfo id="cal-day" />
    </div>
  );
}

// 'agenda-view': what's coming, in order.
function AgendaView({ today }: { today: string }) {
  const events = useRange(today, addDays(today, 60));
  if (events.isPending) return <Loading />;
  const shown = (events.data ?? []).filter((e) => e.kind !== 'class');
  if (!shown.length) return <Empty>{t('Nothing on this day.')}</Empty>;
  const days = [...new Set(shown.map((e) => ymd(e.start)))].sort();
  return (
    <Stack gap="sm">
      {days.map((day) => (
        <div key={day}>
          <Text size="sm" fw={800}>
            {dayjs(day).format(t('dddd, MMMM D'))} <ReqInfo id="cal-views" />
          </Text>
          {shown
            .filter((e) => ymd(e.start) === day)
            .map((e) => (
              <Text key={e.key} size="sm" td={e.done ? 'line-through' : undefined}>
                {e.allDay ? '' : `${fmtTime(e.start)} · `}
                {eventLabel(e)}
                {e.classLabel && e.classLabel !== e.title ? ` · ${e.classLabel}` : ''}
              </Text>
            ))}
        </div>
      ))}
    </Stack>
  );
}

// The whole term at a glance: deadlines, exams and sessions week by week.
function SemesterView() {
  const printable = useVariant('print-semester');
  const styleOf = useEventStyle();
  const { start, end } = termWithExams(CURRENT_TERM) ?? { start: ymd(new Date()), end: addDays(ymd(new Date()), 120) };
  const events = useRange(start, end);
  if (events.isPending) return <Loading />;
  // Key dates that span days (reading break, exams) are listed once a week.
  const seen = new Set<string>();
  const items = (events.data ?? []).filter((e) => {
    if (e.kind !== 'key') return e.kind === 'deadline' || e.kind === 'session';
    const id = `${mondayOf(ymd(e.start))}|${e.title}`;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
  const weeks = [...new Set(items.map((e) => mondayOf(ymd(e.start))))].sort();
  if (!weeks.length) return <Empty>{t('No deadlines or study sessions this term yet.')}</Empty>;

  return (
    <Stack gap="sm">
      {printable && (
        <WithInfo id="cal-semester">
          <Button size="xs" variant="default" w="fit-content" onClick={() => window.print()}>
            Print this term
          </Button>
        </WithInfo>
      )}
      {weeks.map((week) => (
        <Group key={week} align="flex-start" wrap="nowrap" gap="md">
          <div style={{ flex: 'none', width: 110 }}>
            <Text size="sm" fw={800}>
              {t('Week of {{date}}', { date: dayjs(week).format(t('MMM D')) })} <ReqInfo id="cal-semester" />
            </Text>
            <BusyWeek week={week} due={items.filter((e) => e.kind === 'deadline' && !e.done && mondayOf(ymd(e.start)) === week)} />
          </div>
          <Group gap={6}>
            {items
              .filter((e) => mondayOf(ymd(e.start)) === week)
              .map((e) => (
                <Tooltip key={e.key} label={`${fmtDateTime(e.start)}${e.classLabel ? ` · ${e.classLabel}` : ''}`}>
                  <span className="chip" style={{ ...styleOf(e), display: 'inline-block', marginTop: 0 }} data-done={e.done || undefined}>
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

// Only weeks still to come: there's nothing to do about the ones that went by.
function BusyWeek({ week, due }: { week: string; due: { weight?: number }[] }) {
  if (week < mondayOf(ymd(new Date())) || !isBusyWeek(due)) return null;
  const worth = due.reduce((sum, d) => sum + (d.weight ?? 0), 0);
  return (
    <WithInfo id="cal-busy-week">
      <Tooltip label={worth ? t('{{count}} things due, worth {{worth}}% across your classes', { count: due.length, worth }) : t('{{count}} things due', { count: due.length })} multiline w={220}>
        <span>
          <Tag color="orange">{t('Busy week')}</Tag>
        </span>
      </Tooltip>
    </WithInfo>
  );
}

const EXAM_PAGE_SIZE = 50;

// Memoized so scrolling only renders the new rows.
const ExamRow = memo(function ExamRow({ exam: e, title, mine }: { exam: FinalExam; title?: string; mine: boolean }) {
  return (
    <Table.Tr fw={mine ? 800 : undefined}>
      <Table.Td>
        {e.course}
        {e.section && e.section !== '001' && ` (${e.section})`}
        <Text span size="xs" c="dimmed" ml={6}>
          {title}
        </Text>
      </Table.Td>
      <Table.Td>{examTime(e)}</Table.Td>
      <Table.Td>{e.location}</Table.Td>
    </Table.Tr>
  );
});

// A3: the term's key dates and the final exam schedule (shared/keyDates.ts).
function KeyDatesView() {
  const linkOfficial = useVariant('link-official-dates');
  const onlyOfficial = useVariant('only-official-dates');
  const onlyUpcoming = useVariant('only-upcoming-dates');
  const exactConflicts = useVariant('exact-exam-conflicts');
  const conflictRules = useVariant('exam-conflict-rules');
  const onlyMine = useVariant('only-my-exams');
  const manualFinals = useVariant('manual-final-exams');
  const today = ymd(new Date());
  const [termName, setTermName] = useState<string>(CURRENT_TERM);
  const [search, setSearch] = useState('');
  const mine = useQuery({ queryKey: ['classes', 'mine'], queryFn: () => rpc.classes.mine() });
  const catalogue = useQuery({ queryKey: ['catalogue', 'courses'], queryFn: loadCourses, staleTime: Infinity });
  const offerings = useOfferings();
  const [shownExams, setShownExams] = useState(EXAM_PAGE_SIZE);

  const dates = keyDatesFor(termName).filter((d) => (!onlyOfficial || !d.approximate) && (!onlyUpcoming || (d.end ?? d.date) >= today));
  const next = dates.find((d) => (d.end ?? d.date) >= today);
  const titles = useMemo(() => new Map((catalogue.data ?? []).map(([code, title]) => [code, title])), [catalogue.data]);
  const myClasses = (mine.data ?? []).filter((c) => c.term === termName);
  const myCourses = new Set(myClasses.map((c) => `${c.subject} ${c.number}`));
  const byTime = (a: FinalExam, b: FinalExam) => `${a.date}${a.start}`.localeCompare(`${b.date}${b.start}`);
  // April's isn't out, so that list is an estimate for each course that probably runs in Winter.
  const exams = useMemo(
    () => (termName === TERMS[0] ? FINAL_EXAMS : (catalogue.data ?? []).flatMap(([code]) => (parseOffering(offerings.data?.[code])?.terms.includes(termName) ? finalExamsFor(code, termName) : []))).toSorted(byTime),
    [termName, catalogue.data, offerings.data],
  );
  const myExams = myClasses.flatMap((c) => finalExamsFor(`${c.subject} ${c.number}`, termName, c.section)).sort(byTime);
  const conflicts = new Map([...examConflicts(myExams)].filter(([, conflict]) => !exactConflicts || conflict.overlap));
  const query = useDeferredValue(search.trim().toLowerCase().replace(/\s+/g, ''));
  const listed = useMemo(() => exams.filter((e) => !query || `${e.course}${titles.get(e.course) ?? ''}`.toLowerCase().replace(/\s+/g, '').includes(query)), [exams, titles, query]);
  const day = (date: string) => dayjs(date).format(t('ddd, MMM D'));

  return (
    <Stack gap="lg">
      <WithInfo id="key-term">
        <SegmentedControl size="xs" w="fit-content" value={termName} onChange={(next) => { setTermName(next); setShownExams(EXAM_PAGE_SIZE); }} data={TERMS.map((x) => ({ value: x, label: term(x) }))} />
      </WithInfo>

      <div>
        <Title order={4} mb="xs">
          {t('Key dates')} <ReqInfo id="key-dates" />
        </Title>
        {linkOfficial && (
          <Text size="sm">
            McGill keeps these up to date on{' '}
            <a href="https://www.mcgill.ca/importantdates/" target="_blank" rel="noopener noreferrer">
              its official dates page
            </a>
            .
          </Text>
        )}
        {!linkOfficial && dates.map((d) => (
          <Group
            key={`${d.title}-${d.date}`}
            py={6}
            gap="sm"
            wrap="nowrap"
            style={{ borderBottom: '1.5px solid var(--ul-border)', opacity: (d.end ?? d.date) < today ? 0.55 : 1 }}
          >
            <Text size="sm" fw={800} w={170} style={{ flex: 'none' }}>
              {d.end ? `${day(d.date)} – ${day(d.end)}` : day(d.date)}
            </Text>
            <Box w={9} h={9} style={{ flex: 'none', borderRadius: 9, background: `var(--mantine-color-${d.type === 'deadline' ? 'red' : 'yellow'}-5)` }} />
            <Text size="sm" fw={d.type === 'deadline' ? 800 : 600} style={{ flex: 1 }}>
              {t(d.title)}
            </Text>
            {d.approximate && (
              <WithInfo id="key-approx">
                <Tooltip label={t('Not published yet; check Minerva closer to the term.')}>
                  <Badge size="sm" variant="light" color="gray">
                    {t('approx.')}
                  </Badge>
                </Tooltip>
              </WithInfo>
            )}
            {d === next && (
              <WithInfo id="key-next">
                <Badge size="sm">{t('Up next')}</Badge>
              </WithInfo>
            )}
          </Group>
        ))}
      </div>

      {manualFinals ? (
        <Text size="sm" c="dimmed">
          Add your final exams by hand, like any exam date. <ReqInfo id="final-exam" />
        </Text>
      ) : (
      <div>
        <Title order={4} mb="xs">
          {t('Final exam schedule')} <ReqInfo id="final-exam" />
        </Title>
          <Stack gap="sm">
            <Alert variant="light" color="yellow" icon={<IconAlertTriangle size={18} />}>
              {termName === TERMS[0]
                ? t('McGill’s December 2026 schedule, as of October 27. Rooms are posted on November 27 and times can change, so check McGill’s exams website before your exams. Anything marked estimated isn’t on it.')
                : t('Estimated. McGill hasn’t posted the April schedule, so these dates are guesses inside the exam period, to help you plan until it’s out.')}{' '}
              <ReqInfo id="final-sample" />
            </Alert>
            {myExams.length > 0 && (
              <Card withBorder padding="sm" style={{ background: 'var(--ul-soft)' }}>
                <Text fw={800} mb={6}>
                  {t('Your final exams')} <ReqInfo id="final-mine" />
                </Text>
                {myExams.map((e) => (
                  <Group key={`${e.course}-${e.section}`} gap="sm" wrap="nowrap" py={2}>
                    <Text size="sm" fw={800} w={90} style={{ flex: 'none' }}>
                      {e.course}
                    </Text>
                    <Text size="sm" style={{ flex: 1 }}>
                      {examTime(e)}
                    </Text>
                    {conflicts.has(e.course) && (
                      <WithInfo id="final-conflict">
                        <Tag color={conflicts.get(e.course)!.overlap ? 'red' : 'orange'}>
                          {conflicts.get(e.course)!.overlap ? t('Overlaps {{course}}', { course: conflicts.get(e.course)!.with }) : t('Same day as {{course}}', { course: conflicts.get(e.course)!.with })}
                        </Tag>
                      </WithInfo>
                    )}
                    <Text size="sm" c="dimmed">
                      {e.location}
                    </Text>
                  </Group>
                ))}
                {conflictRules && conflicts.size > 0 && (
                  <Text size="xs" mt="xs">
                    Two exams at once or three in a day can be changed.{' '}
                    <a href="https://www.mcgill.ca/exams/" target="_blank" rel="noopener noreferrer">
                      See McGill's rules and how to ask
                    </a>
                    .
                  </Text>
                )}
              </Card>
            )}
            {!onlyMine && <>
            <WithInfo id="final-search" block>
              <TextInput
                placeholder={t('Search by course code or title')}
                leftSection={<IconSearch size={16} />}
                radius="xl"
                value={search}
                onChange={(e) => {
                  setSearch(e.currentTarget.value);
                  setShownExams(EXAM_PAGE_SIZE);
                }}
              />
            </WithInfo>
            <Table.ScrollContainer minWidth={520}>
              <Table verticalSpacing={6}>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>
                      <WithInfo id="final-exam">{t('Course')}</WithInfo>
                    </Table.Th>
                    <Table.Th>
                      <WithInfo id="final-exam">{t('When')}</WithInfo>
                    </Table.Th>
                    <Table.Th>
                      <WithInfo id="final-exam">{t('Location')}</WithInfo>
                    </Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {listed.slice(0, shownExams).map((e) => (
                    <ExamRow key={`${e.course}-${e.section}`} exam={e} title={titles.get(e.course)} mine={myCourses.has(e.course)} />
                  ))}
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>
            {listed.length > shownExams && <LoadOnScroll label={t('Show more exams')} shown={shownExams} onMore={() => setShownExams(shownExams + EXAM_PAGE_SIZE)} />}
            </>}
          </Stack>
      </div>
      )}
    </Stack>
  );
}

function Upcoming({ onViewAll }: { onViewAll: () => void }) {
  const hidden = useContext(HiddenClasses);
  const chooseLength = useVariant('choose-upcoming-length');
  const [chosenDays, setChosenDays] = useLocalStorage<string>({ key: 'unilink-calendar-upcoming-days', defaultValue: '14' });
  const days = chooseLength ? Number(chosenDays) : 7;
  const upcoming = useQuery({ queryKey: ['calendar', 'upcoming', days], queryFn: () => rpc.calendar.upcoming({ days }) });
  const sessions = useQuery({ queryKey: ['studySessions', 'mine'], queryFn: () => rpc.studySessions.mine() });
  const remove = useAction((id: number) => rpc.calendar.removeDeadline({ id }), { success: 'Deadline removed' });

  const soon = dayjs().add(days, 'day');
  const items = [
    ...(upcoming.data ?? []).filter((e) => e.classId == null || !hidden.includes(e.classId)).map((e) => ({ key: e.key, title: e.title, sub: e.classLabel, when: e.start, end: null as Date | null, kind: eventKind(e), deadlineId: e.addedBy == null ? e.deadlineId : null, addedBy: e.addedBy })),
    ...(sessions.data ?? [])
      .filter((s) => s.myStatus === 'going' && dayjs(s.startsAt).isBefore(soon) && !hidden.includes(s.classId))
      .map((s) => ({ key: `s${s.id}`, title: s.title, sub: s.classLabel, when: s.startsAt, end: s.endsAt, kind: 'session', deadlineId: null, addedBy: null })),
  ].sort((a, b) => a.when.getTime() - b.when.getTime());

  return (
    <Card padding={0} h="100%">
      <Text fw={800} size="lg" className="display" px="md" py="sm" style={{ borderBottom: '1.5px solid var(--ul-border)' }}>
        {chooseLength ? `Upcoming (next ${days} days)` : t('Upcoming (next 7 days)')} <ReqInfo id="cal-upcoming" />
      </Text>
      {chooseLength && (
        <Box px="md" pt="xs">
          <SegmentedControl size="xs" value={chosenDays} onChange={setChosenDays} data={['7', '14', '30']} aria-label="Days ahead" />
        </Box>
      )}
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
                  {i.addedBy != null && ` · ${t('shared by {{name}}', { name: i.addedBy || t('a former student') })}`} {i.addedBy != null && <ReqInfo id="deadline-shared" />}
                </Text>
              )}
              <Text size="xs" mt={2}>
                {dayjs(i.when).format(t('ddd, MMM D · HH:mm'))}
                {i.end && `–${fmtTime(i.end)}`}
              </Text>
            </div>
            {i.deadlineId != null && (
              <WithInfo id="deadline-manage">
                <ActionIcon variant="subtle" color="gray" onClick={() => remove.mutate(i.deadlineId!)} aria-label={t('Delete {{name}}', { name: i.title })}>
                  <IconTrash size={16} />
                </ActionIcon>
              </WithInfo>
            )}
          </Group>
        ))
      ) : (
        <Empty>{chooseLength ? `Nothing in the next ${days} days.` : t('Nothing in the next 7 days.')}</Empty>
      )}
      <Box p="sm">
        <WithInfo id="cal-all-deadlines" block>
          <Button variant="default" fullWidth rightSection={<IconArrowRight size={16} />} onClick={onViewAll}>
            {t('View all deadlines')}
          </Button>
        </WithInfo>
      </Box>
    </Card>
  );
}

const PILL: Record<string, string> = { class: tx('Lecture'), session: tx('Study'), task: tx('Task'), deadline: tx('Due'), key: tx('Key date'), final: tx('Exam') };

function DayList({ day, today }: { day: string; today: string }) {
  const events = useRange(day, day);
  const setTask = useAction((v: { id: number; done: boolean }) => rpc.planner.setDone({ taskId: v.id, done: v.done }));
  const setDeadline = useAction((v: { id: number; done: boolean }) => rpc.calendar.setDeadlineDone(v));
  const noCheck = useVariant('no-check-on-calendar');
  const colourOnly = useVariant('colour-only-event-kind');
  const oneOffChanges = useVariant('cancel-one-lecture');
  const toggleLecture = useAction((v: { meetingId: number; classId: number; day: string }) => rpc.calendar.toggleLecture(v));

  const duration = (e: CalEvent) => {
    if (!e.end) return null;
    const mins = Math.round((e.end.getTime() - e.start.getTime()) / 60_000);
    return mins >= 60 ? `${Math.floor(mins / 60)}h${mins % 60 ? ` ${mins % 60}m` : ''}` : `${mins}m`;
  };

  return (
    <Card padding={0} id="day-list" style={{ scrollMarginTop: 90 }}>
      <Text fw={800} size="lg" className="display" px="md" py="sm" style={{ borderBottom: '1.5px solid var(--ul-border)', background: 'var(--ul-soft)' }}>
        {day === today ? `${t('Today')} · ${dayjs(day).format(t('ddd, MMM D'))}` : dayjs(day).format(t('dddd, MMMM D'))} <ReqInfo id="cal-day" />
      </Text>
      {events.isPending ? (
        <Loading />
      ) : events.data?.length ? (
        events.data.map((e) => {
          const taskId = e.kind === 'task' ? Number(e.key.slice(5)) : null;
          return (
            <Group key={e.key} px="md" py="sm" wrap="nowrap" style={{ borderBottom: '1.5px solid var(--ul-border)' }}>
              {!noCheck && (
              <WithInfo id="cal-check">
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
              </WithInfo>
              )}
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
              {oneOffChanges && e.kind === 'class' && e.classId != null && (
                <WithInfo id="class-time-row">
                  <Button size="compact-xs" variant="subtle" onClick={() => toggleLecture.mutate({ meetingId: Number(e.key.split('-')[1]), classId: e.classId!, day })}>
                    {e.detail === 'cancelled' ? 'Put it back' : 'Cancel this lecture'}
                  </Button>
                </WithInfo>
              )}
              {!colourOnly && (
                <Badge variant="outline" color={kindColor(eventKind(e))} size="lg" visibleFrom="xs">
                  {t(PILL[e.detail === 'final' ? 'final' : e.kind] ?? e.kind)}
                </Badge>
              )}
              {!colourOnly && <ReqInfo id="cal-event-kind" />}
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
  const approve = useAction((id: number) => rpc.calendar.approveDeadline({ id }));
  const anyoneFixes = useVariant('anyone-fixes-deadlines');
  const showCounts = useVariant('professor-sees-checkoffs');
  if (deadlines.isPending) return <Loading />;
  if (!deadlines.data?.length) return <Empty>{t('No deadlines added yet.')}</Empty>;
  return (
    <>
      <Text size="sm" c="dimmed" mb="sm">
        {t("Deadlines you add to a class are shared with everyone in that section; ones with no class stay private. Graded work from each course's Grades tab and planner due dates show on the calendar automatically.")} <ReqInfo id="deadline-shared" />
      </Text>
      <Table verticalSpacing="xs">
        <Table.Tbody>
          {deadlines.data.map((d) => (
            <Table.Tr key={d.id} opacity={d.done || d.dueAt < new Date() ? 0.5 : 1}>
              <Table.Td fw={600} td={d.done ? 'line-through' : undefined}>
                {/^https?:\/\//.test(d.notes) ? (
                  <a href={d.notes} target="_blank" rel="noopener noreferrer">
                    {d.title}
                  </a>
                ) : (
                  d.title
                )}
                {d.pending && (
                  <Text size="xs" c="orange">
                    Waiting for a classmate's approval
                  </Text>
                )}
                {showCounts && d.doneCount > 0 && (
                  <Text size="xs" c="dimmed">
                    {d.doneCount} checked off <ReqInfo id="deadline-done" />
                  </Text>
                )}
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
                {d.pending && !d.mine && (
                  <Button size="compact-xs" onClick={() => approve.mutate(d.id)}>
                    Approve
                  </Button>
                )}
                {!d.mine && anyoneFixes && d.classId != null && (
                  <ActionIcon variant="subtle" onClick={() => onEdit(d)} aria-label={t('Edit')}>
                    <IconPencil size={16} />
                  </ActionIcon>
                )}
                {d.mine && (
                  <Group gap={4} justify="flex-end" wrap="nowrap">
                    <ActionIcon variant="subtle" onClick={() => onEdit(d)} aria-label={t('Edit')}>
                      <IconPencil size={16} />
                    </ActionIcon>
                    <ActionIcon variant="subtle" color="red" onClick={() => remove.mutate(d.id)} aria-label={t('Delete')}>
                      <IconTrash size={16} />
                    </ActionIcon>
                    <ReqInfo id="deadline-manage" />
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

// A3 "imported from my syllabus": paste the course outline's schedule, check what was found,
// and add it for the whole section. Weighted items join the shared grading scheme (A5),
// which shows them on the calendar too; the rest become class deadlines.
export function SyllabusImport({ onDone, initialClassId = null }: { onDone: () => void; initialClassId?: number | null }) {
  const [classId, setClassId] = useState<number | null>(initialClassId);
  const [text, setText] = useState('');
  const [unchecked, setUnchecked] = useState<Set<number>>(new Set());
  const classes = useQuery({ queryKey: ['classes', 'mine'], queryFn: () => rpc.classes.mine() });
  const scheme = useQuery({ queryKey: ['courses', 'assessments', classId], queryFn: () => rpc.courses.assessments({ classId: classId! }), enabled: classId != null });
  const deadlines = useQuery({ queryKey: ['calendar', 'deadlines'], queryFn: () => rpc.calendar.deadlines() });
  const cls = classes.data?.find((c) => c.id === classId);
  const info = useQuery({ queryKey: ['courses', 'info', classId], queryFn: () => rpc.courses.info({ classId: classId! }), enabled: classId != null });
  const fill = (read: string | null) => {
    if (read == null) return;
    setText(read);
    setUnchecked(new Set());
  };
  const readFile = useAction(() => rpc.calendar.readSyllabusFile(), { onSuccess: (r) => fill(r?.text ?? null) });
  const readOutline = useAction(() => rpc.courses.outlineText({ classId: classId! }), { onSuccess: fill });

  const found = cls ? parseSyllabus(text, cls.term) : [];
  const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
  const already = (i: SyllabusItem) =>
    i.weight != null
      ? (scheme.data ?? []).some((a) => same(a.name, i.title))
      : (deadlines.data ?? []).some((d) => d.classId === classId && same(d.title, i.title) && ymd(d.dueAt) === ymd(i.dueAt));
  const picked = found.filter((item, n) => !unchecked.has(n) && !already(item));
  const straightAway = useVariant('add-found-dates-right-away');
  const undo = useUndo();

  const add = useAction(
    async () => {
      const failed: string[] = [];
      const added: number[] = [];
      for (const item of picked) {
        try {
          const deadline = () => rpc.calendar.addDeadline({ classId, kind: item.kind, title: item.title, dueAt: item.dueAt, notes: '' }).then((row) => void added.push(row.id));
          if (item.weight == null) await deadline();
          else {
            // Where a professor runs the scheme, the date still goes in as a class deadline.
            await rpc.courses.addAssessment({ classId: classId!, name: item.title, weight: item.weight, dueAt: item.dueAt }).catch((error) => {
              if (error instanceof RpcError && error.code === 'FORBIDDEN') return deadline();
              throw error;
            });
          }
        } catch {
          failed.push(item.title);
        }
      }
      if (straightAway && added.length) {
        undo(`Added ${added.length} dates.`, async () => {
          for (const id of added) await rpc.calendar.removeDeadline({ id });
        });
      }
      return { added: picked.length - failed.length, failed };
    },
    {
      success: (r) =>
        [t('Added {{count}} to {{code}}', { count: r.added, code: cls?.code ?? '' }), r.failed.length ? t('Not added: {{titles}}', { titles: r.failed.join(', ') }) : '']
          .filter(Boolean)
          .join(' '),
      onSuccess: (r) => !r.failed.length && onDone(),
    },
  );

  return (
    <Stack>
      <Text size="sm" c="dimmed">
        {t('Read the course outline, or paste its schedule. Each line with a date and something to hand in or write becomes a date you can add.')} <ReqInfo id="syllabus-import" />
      </Text>
      <ClassSelect info="deadline-class" value={classId} onChange={setClassId} />
      <Group gap="xs">
        {info.data?.outlineName && (
          <Button size="xs" variant="light" leftSection={<IconFileText size={14} />} onClick={() => readOutline.mutate()} loading={readOutline.isPending}>
            {t('Read {{name}}', { name: info.data.outlineName })}
          </Button>
        )}
        <Button size="xs" variant="default" leftSection={<IconFileText size={14} />} onClick={() => readFile.mutate()} loading={readFile.isPending}>
          {t('Choose a PDF, Word or text file')}
        </Button>
        <ReqInfo id="syllabus-read" />
      </Group>
      <Textarea
        label={<WithInfo id="syllabus-read">{t('Syllabus text')}</WithInfo>}
        placeholder={t('Assignment 1 (10%) due Sept 22 at 11:59 pm')}
        autosize
        minRows={5}
        maxRows={12}
        value={text}
        onChange={(e) => {
          setText(e.currentTarget.value);
          setUnchecked(new Set());
        }}
      />
      {cls && text.trim() && (
        <>
          <Text size="sm" fw={700}>
            {found.length ? t('Found {{count}} dates', { count: found.length }) : t('No dates found yet. Lines need a date like "Oct 6" or "2026-10-06".')} <ReqInfo id="syllabus-review" />
          </Text>
          {found.map((item, n) => {
            const there = already(item);
            return (
              <Group key={n} gap="sm" wrap="nowrap" align="flex-start">
                <Checkbox
                  mt={2}
                  display={straightAway ? 'none' : undefined}
                  checked={!there && !unchecked.has(n)}
                  disabled={there}
                  onChange={(e) =>
                    setUnchecked((u) => {
                      const next = new Set(u);
                      if (e.currentTarget.checked) next.delete(n);
                      else next.add(n);
                      return next;
                    })
                  }
                  aria-label={item.title}
                />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <Group gap={6}>
                    <Text size="sm" fw={700}>
                      {item.title}
                    </Text>
                    {item.weight != null && <Badge size="sm" variant="light">{item.weight}%</Badge>}
                    <KindBadge kind={item.kind} />
                    {there && (
                      <Badge size="sm" variant="light" color="gray">
                        {t('Already added')}
                      </Badge>
                    )}
                  </Group>
                  <Text size="xs" c="dimmed">
                    {item.timed ? fmtDateTime(item.dueAt) : `${dayjs(item.dueAt).format(t('ddd, MMM D'))} · 23:59`} ·{' '}
                    {item.weight != null ? t('to the grading scheme') : t('as a class deadline')}
                  </Text>
                </div>
              </Group>
            );
          })}
        </>
      )}
      <Group justify="space-between">
        <Text size="xs" c="dimmed" maw={420}>
          {cls ? t('Everyone in {{code}} will see what you add.', { code: cls.code }) : t('Pick the class the syllabus is for.')}
        </Text>
        <WithInfo id="syllabus-add">
          <Button onClick={() => add.mutate()} disabled={!picked.length} loading={add.isPending}>
            {t('Add {{count}} dates', { count: picked.length })}
          </Button>
        </WithInfo>
      </Group>
    </Stack>
  );
}

export function ClassSelect({ value, onChange, label = t('Class'), info }: { value: number | null; onChange: (v: number | null) => void; label?: string; info: ReqTopicId }) {
  const classes = useQuery({ queryKey: ['classes', 'mine'], queryFn: () => rpc.classes.mine() });
  return (
    <Select
      label={<WithInfo id={info}>{label}</WithInfo>}
      placeholder={t('None')}
      clearable
      data={classes.data?.map((c) => ({ value: String(c.id), label: `${c.code} · ${c.title}` })) ?? []}
      value={value == null ? null : String(value)}
      onChange={(v) => onChange(v ? Number(v) : null)}
    />
  );
}

function DeadlineForm({ existing, onDone, onPickOther }: { existing: Deadline | null; onDone: (savedId?: number) => void; onPickOther?: (choice: 'plan' | 'syllabus') => void }) {
  const labsAndReadings = useVariant('labs-and-readings');
  const askToShare = useVariant('ask-to-share-deadline');
  const dateOnly = useVariant('date-without-time');
  const linkNotNotes = useVariant('no-deadline-notes');
  const personal = useVariant('personal-deadlines');
  const noSyllabus = useVariant('no-syllabus-import');
  const professorDates = useVariant('professor-enters-dates');
  const [shareIt, setShareIt] = useState(true);
  const [noTime, setNoTime] = useState(existing?.noTime ?? false);
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
      const due = toDate(v.dueAt)!;
      const fields = { ...v, dueAt: noTime ? dayjs(due).hour(23).minute(59).second(0).toDate() : due, shared: shareIt, noTime };
      if (existing) {
        await rpc.calendar.updateDeadline({ id: existing.id, ...fields });
        return undefined;
      }
      return (await rpc.calendar.addDeadline(fields)).id;
    },
    { success: 'Deadline saved', onSuccess: (id) => onDone(id) },
  );

  return (
    <form onSubmit={form.onSubmit((v) => save.mutate(v))}>
      <Stack>
        <TextInput label={<WithInfo id="deadline-add">{t('Title')}</WithInfo>} placeholder={t('Assignment 3')} data-autofocus {...form.getInputProps('title')} />
        <Group grow>
          <Select
            label={<WithInfo id="deadline-kind">{t('Type')}</WithInfo>}
            data={[
              ...KINDS.map((k) => ({ ...k, label: t(k.label) })),
              ...(labsAndReadings ? [{ value: 'lab', label: 'Lab' }, { value: 'reading', label: 'Reading' }] : []),
              ...(onPickOther ? [{ value: 'plan', label: t('Assignment to plan out') }, ...(!noSyllabus && !professorDates ? [{ value: 'syllabus', label: t('Dates from a syllabus') }] : [])] : []),
            ]}
            allowDeselect={false}
            {...form.getInputProps('kind')}
            onChange={(v) => {
              if (v === 'plan' || v === 'syllabus') onPickOther?.(v);
              else if (v) form.setFieldValue('kind', v as Deadline['kind']);
            }}
          />
          <DateTimePicker label={<WithInfo id="deadline-due">{t('Due')}</WithInfo>} valueFormat="ddd D MMM YYYY, HH:mm" {...form.getInputProps('dueAt')} />
        </Group>
        <ClassSelect info="deadline-class" value={form.values.classId} onChange={(v) => form.setFieldValue('classId', v)} />
        <Text size="xs" c="dimmed" mt={-8}>
          {personal
            ? 'Only you see it.'
            : askToShare
              ? 'You choose who sees it below.'
              : form.values.classId
                ? t('Everyone in this section will see it on their calendar.')
                : t('With no class, only you see it.')}{' '}
          <ReqInfo id="deadline-shared" />
        </Text>
        {askToShare && <Checkbox label="Share it with the section" description="With no class, only you see it either way." disabled={!form.values.classId} checked={shareIt && !!form.values.classId} onChange={(e) => setShareIt(e.currentTarget.checked)} />}
        {dateOnly && <Checkbox label={<WithInfo id="deadline-due">No specific time</WithInfo>} checked={noTime} onChange={(e) => setNoTime(e.currentTarget.checked)} />}
        {linkNotNotes ? (
          <TextInput label={<WithInfo id="deadline-notes">Link to the assignment</WithInfo>} placeholder="https://mycourses2.mcgill.ca/…" {...form.getInputProps('notes')} />
        ) : (
          <Textarea label={<WithInfo id="deadline-notes">{t('Notes')}</WithInfo>} autosize minRows={2} {...form.getInputProps('notes')} />
        )}
        <Group justify="flex-end">
          <Button type="submit" loading={save.isPending}>
            {t('Save')}
          </Button>
        </Group>
      </Stack>
    </form>
  );
}
