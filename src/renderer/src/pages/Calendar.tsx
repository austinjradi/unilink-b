import { type KeyboardEvent, useState } from 'react';
import {
  ActionIcon,
  Alert,
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
  IconUpload,
} from '@tabler/icons-react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { useNavigate } from 'react-router';
import { addDays, CURRENT_TERM, eachDay, TERMS, ymd } from '@shared/dates';
import { EXAM_SCHEDULE_TERMS, FINAL_EXAMS, keyDatesFor, termWithExams } from '@shared/keyDates';
import { parseSyllabus, type SyllabusItem } from '@shared/syllabus';
import { chipStyle, Empty, KindBadge, kindColor, Loading, PageHeader } from '../components/ui';
import { fmtDateTime, fmtTime, toDate } from '../lib/format';
import { useAction } from '../lib/hooks';
import { type Out, rpc } from '../lib/rpc';
import { t, term, tx } from '../lib/i18n';

type Deadline = Out<typeof rpc.calendar.deadlines>[number];
type CalEvent = Out<typeof rpc.calendar.range>[number];
type View = 'month' | 'week' | 'semester' | 'key';

const KINDS = [
  { value: 'assignment', label: tx('Assignment') },
  { value: 'exam', label: tx('Exam') },
  { value: 'quiz', label: tx('Quiz') },
  { value: 'other', label: tx('Other') },
];

const eventKind = (e: CalEvent) => (e.kind === 'deadline' ? e.detail : e.kind);
// Final exams and the term's key deadlines read fine on their own; other deadlines get "Due:".
const eventLabel = (e: CalEvent) => (e.kind === 'deadline' && e.detail !== 'final' && e.detail !== 'key' ? t('Due: {{title}}', { title: e.title }) : e.title);
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
  const [importing, setImporting] = useState(false);

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
    view === 'semester' || view === 'key'
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
                <Menu.Item onClick={() => setImporting(true)}>{t('Dates from a syllabus')}</Menu.Item>
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
                {view !== 'semester' && view !== 'key' && (
                  <ActionIcon variant="subtle" onClick={() => step(-1)} aria-label={t('Previous')}>
                    <IconChevronLeft size={20} />
                  </ActionIcon>
                )}
                <Title order={3} miw={190} ta="center">
                  {view === 'key' ? t('Key dates and exams') : title}
                </Title>
                {view !== 'semester' && view !== 'key' && (
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
              </Group>
              <SegmentedControl
                size="xs"
                value={view}
                onChange={(v) => setView(v as View)}
                data={[
                  { value: 'month', label: t('Month') },
                  { value: 'week', label: t('Week') },
                  { value: 'semester', label: t('Semester') },
                  { value: 'key', label: t('Key dates') },
                ]}
              />
            </Group>
            {view === 'month' && <MonthView cursor={cursor} today={today} selected={selected} onSelect={pick} />}
            {view === 'week' && <WeekView start={mondayOf(cursor)} today={today} selected={selected} onSelect={pick} />}
            {view === 'semester' && <SemesterView />}
            {view === 'key' && <KeyDatesView />}
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
      <Modal opened={importing} onClose={() => setImporting(false)} title={t('Import dates from a syllabus')} size="xl">
        {importing && <SyllabusImport onDone={() => setImporting(false)} />}
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
        {['session', 'task', 'assignment', 'exam', 'quiz', 'graded', 'final', 'key'].map((k) => (
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

// A3: the term's key dates and the final exam schedule (shared/keyDates.ts).
function KeyDatesView() {
  const today = ymd(new Date());
  const [termName, setTermName] = useState<string>(CURRENT_TERM);
  const [search, setSearch] = useState('');
  const mine = useQuery({ queryKey: ['classes', 'mine'], queryFn: () => rpc.classes.mine() });
  const catalogue = useQuery({
    queryKey: ['catalogue', 'search', '', termName, null],
    queryFn: () => rpc.catalogue.search({ query: '', term: termName, level: null }),
  });

  const dates = keyDatesFor(termName);
  const next = dates.find((d) => (d.end ?? d.date) >= today);
  const titles = new Map((catalogue.data ?? []).map((c) => [`${c.subject} ${c.number}`, c.title]));
  const myCourses = new Set((mine.data ?? []).filter((c) => c.term === termName).map((c) => `${c.subject} ${c.number}`));
  const exams = FINAL_EXAMS.filter((e) => e.term === termName).sort((a, b) => `${a.date}${a.start}`.localeCompare(`${b.date}${b.start}`));
  const myExams = exams.filter((e) => myCourses.has(e.course));
  const query = search.trim().toLowerCase().replace(/\s+/g, '');
  const listed = exams.filter((e) => !query || `${e.course}${titles.get(e.course) ?? ''}`.toLowerCase().replace(/\s+/g, '').includes(query));
  const day = (date: string) => dayjs(date).format(t('ddd, MMM D'));

  return (
    <Stack gap="lg">
      <SegmentedControl size="xs" w="fit-content" value={termName} onChange={setTermName} data={TERMS.map((x) => ({ value: x, label: term(x) }))} />

      <div>
        <Title order={4} mb="xs">
          {t('Key dates')}
        </Title>
        {dates.map((d) => (
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
              <Tooltip label={t('Not published yet; check Minerva closer to the term.')}>
                <Badge size="sm" variant="light" color="gray">
                  {t('approx.')}
                </Badge>
              </Tooltip>
            )}
            {d === next && <Badge size="sm">{t('Up next')}</Badge>}
          </Group>
        ))}
      </div>

      <div>
        <Title order={4} mb="xs">
          {t('Final exam schedule')}
        </Title>
        {!EXAM_SCHEDULE_TERMS.includes(termName) ? (
          <Text size="sm" c="dimmed">
            {t("The {{term}} exam schedule isn't out yet. McGill publishes it during the term.", { term: term(termName) })}
          </Text>
        ) : (
          <Stack gap="sm">
            <Alert variant="light" color="yellow" icon={<IconAlertTriangle size={18} />}>
              {t('Sample schedule. The official one is on McGill’s exams website; always check it before your exams.')}
            </Alert>
            {myExams.length > 0 && (
              <Card withBorder padding="sm" style={{ background: 'var(--ul-soft)' }}>
                <Text fw={800} mb={6}>
                  {t('Your final exams')}
                </Text>
                {myExams.map((e) => (
                  <Group key={e.course} gap="sm" wrap="nowrap" py={2}>
                    <Text size="sm" fw={800} w={90} style={{ flex: 'none' }}>
                      {e.course}
                    </Text>
                    <Text size="sm" style={{ flex: 1 }}>
                      {day(e.date)} · {e.start}–{e.end}
                    </Text>
                    <Text size="sm" c="dimmed">
                      {e.location}
                    </Text>
                  </Group>
                ))}
              </Card>
            )}
            <TextInput
              placeholder={t('Search by course code or title')}
              leftSection={<IconSearch size={16} />}
              radius="xl"
              value={search}
              onChange={(e) => setSearch(e.currentTarget.value)}
            />
            <Table.ScrollContainer minWidth={520}>
              <Table verticalSpacing={6}>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>{t('Course')}</Table.Th>
                    <Table.Th>{t('When')}</Table.Th>
                    <Table.Th>{t('Location')}</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {listed.map((e) => (
                    <Table.Tr key={e.course} fw={myCourses.has(e.course) ? 800 : undefined}>
                      <Table.Td>
                        {e.course}
                        <Text span size="xs" c="dimmed" ml={6}>
                          {titles.get(e.course)}
                        </Text>
                      </Table.Td>
                      <Table.Td>
                        {day(e.date)} · {e.start}–{e.end}
                      </Table.Td>
                      <Table.Td>{e.location}</Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>
          </Stack>
        )}
      </div>
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

const PILL: Record<string, string> = { class: tx('Lecture'), session: tx('Study'), task: tx('Task'), deadline: tx('Due'), key: tx('Key date'), final: tx('Exam') };

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
                {t(PILL[e.detail === 'final' ? 'final' : e.kind] ?? e.kind)}
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

  const found = cls ? parseSyllabus(text, cls.term) : [];
  const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
  const already = (i: SyllabusItem) =>
    i.weight != null
      ? (scheme.data ?? []).some((a) => same(a.name, i.title))
      : (deadlines.data ?? []).some((d) => d.classId === classId && same(d.title, i.title) && ymd(d.dueAt) === ymd(i.dueAt));
  const picked = found.filter((item, n) => !unchecked.has(n) && !already(item));

  const add = useAction(
    async () => {
      const failed: string[] = [];
      for (const item of picked) {
        try {
          if (item.weight != null) await rpc.courses.addAssessment({ classId: classId!, name: item.title, weight: item.weight, dueAt: item.dueAt });
          else await rpc.calendar.addDeadline({ classId, kind: item.kind, title: item.title, dueAt: item.dueAt, notes: '' });
        } catch {
          failed.push(item.title);
        }
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
        {t('Paste the schedule or the list of due dates from the course outline. Each line with a date and something to hand in or write becomes a date you can add.')}
      </Text>
      <ClassSelect value={classId} onChange={setClassId} />
      <Textarea
        label={t('Syllabus text')}
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
            {found.length ? t('Found {{count}} dates', { count: found.length }) : t('No dates found yet. Lines need a date like "Oct 6" or "2026-10-06".')}
          </Text>
          {found.map((item, n) => {
            const there = already(item);
            return (
              <Group key={n} gap="sm" wrap="nowrap" align="flex-start">
                <Checkbox
                  mt={2}
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
        <Button onClick={() => add.mutate()} disabled={!picked.length} loading={add.isPending}>
          {t('Add {{count}} dates', { count: picked.length })}
        </Button>
      </Group>
    </Stack>
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
