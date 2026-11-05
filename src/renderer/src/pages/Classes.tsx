import { memo, useEffect, useMemo, useState } from 'react';
import { Badge, Button, Card, Checkbox, Group, Modal, Select, SimpleGrid, Stack, Table, Tabs, Text, Textarea, TextInput, Tooltip } from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import { IconCalendarDue, IconCertificate, IconClipboardText, IconClock, IconListDetails, IconMessageQuestion, IconSchool, IconSearch, IconUsers } from '@tabler/icons-react';
import { keepPreviousData, useInfiniteQuery, useQuery } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router';
import { LEVELS } from '@shared/courseQuery';
import { addDays, CURRENT_TERM, TERMS, ymd } from '@shared/dates';
import { termWithExams } from '@shared/keyDates';
import type { MeetingTime } from '@shared/meetings';
import { ClashNote, Empty, Loading, PageHeader, SectionCard, Tag } from '../components/ui';
import { fmtMeetings } from '../lib/format';
import { useAction, useMe } from '../lib/hooks';
import { type Out, rpc } from '../lib/rpc';
import { classFromJoinCode } from '@shared/joinCode';
import { useShowCount, useVariant } from '../lib/variants';
import { AcademicsPanel } from './Academics';
import { t, term, tx } from '../lib/i18n';
import { CatalogueLink } from '../components/CatalogueLink';
import { LoadOnScroll } from '../components/LoadOnScroll';
import { ReqInfo, WithInfo } from '../components/ReqInfo';

const TABS = ['mine', 'find', 'record', 'degree'] as const;
type CoursesTab = (typeof TABS)[number];

// S1 (my courses, find & join a section) plus A1/A2 (record and degree plan).
export function CoursesPage() {
  const params = useParams();
  const navigate = useNavigate();
  const tab: CoursesTab = TABS.includes(params.tab as CoursesTab) ? (params.tab as CoursesTab) : 'mine';
  const student = useMe().role === 'student';
  const ownTab = useVariant('academics-tab');
  if (ownTab && (tab === 'record' || tab === 'degree')) return <Navigate to={`/academics/${tab}`} replace />;

  return (
    <>
      <PageHeader
        info="nav-courses"
        title={t('Courses')}
        subtitle={!student ? t('The sections you teach, and finding others.') : ownTab ? 'Your classes, and finding new ones.' : t('Your classes, finding new ones, and how they add up toward your degree.')}
      />
      <Tabs value={tab} onChange={(v) => navigate(`/courses/${v}`)} keepMounted={false} variant="pills" radius="xl">
        <Tabs.List mb="lg">
          <Tabs.Tab value="mine" leftSection={<IconSchool size={16} />} rightSection={<ReqInfo id="tab-mine" />}>
            {t('My courses')}
          </Tabs.Tab>
          <Tabs.Tab value="find" leftSection={<IconSearch size={16} />} rightSection={<ReqInfo id="tab-find" />}>
            {t('Find courses')}
          </Tabs.Tab>
          {student && !ownTab && (
            <Tabs.Tab value="record" leftSection={<IconListDetails size={16} />} rightSection={<ReqInfo id="tab-record" />}>
              {t('Course record')}
            </Tabs.Tab>
          )}
          {student && !ownTab && (
            <Tabs.Tab value="degree" leftSection={<IconCertificate size={16} />} rightSection={<ReqInfo id="tab-degree" />}>
              {t('Degree plan')}
            </Tabs.Tab>
          )}
        </Tabs.List>
        <Tabs.Panel value="mine">
          <MyCourses />
        </Tabs.Panel>
        <Tabs.Panel value="find">
          <FindCourses />
        </Tabs.Panel>
        <Tabs.Panel value="record">
          <AcademicsPanel tab="record" />
        </Tabs.Panel>
        <Tabs.Panel value="degree">
          <AcademicsPanel tab="degree" />
        </Tabs.Panel>
      </Tabs>
    </>
  );
}

// 'academics-tab': the course record and degree plan get a page of their own.
export function AcademicsPage() {
  const params = useParams();
  const navigate = useNavigate();
  const tab = params.tab === 'degree' ? 'degree' : 'record';
  return (
    <>
      <PageHeader info="nav-courses" title="Academics" subtitle="How your classes add up toward your degree." />
      <Tabs value={tab} onChange={(v) => navigate(`/academics/${v}`)} keepMounted={false} variant="pills" radius="xl">
        <Tabs.List mb="lg">
          <Tabs.Tab value="record" leftSection={<IconListDetails size={16} />} rightSection={<ReqInfo id="tab-record" />}>
            {t('Course record')}
          </Tabs.Tab>
          <Tabs.Tab value="degree" leftSection={<IconCertificate size={16} />} rightSection={<ReqInfo id="tab-degree" />}>
            {t('Degree plan')}
          </Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="record">
          <AcademicsPanel tab="record" />
        </Tabs.Panel>
        <Tabs.Panel value="degree">
          <AcademicsPanel tab="degree" />
        </Tabs.Panel>
      </Tabs>
    </>
  );
}

// 'card-professor': who teaches it, on the course's card.
function CardProfessor({ classId }: { classId: number }) {
  const on = useVariant('card-professor');
  const details = useQuery({ queryKey: ['classes', 'card-professor', classId], queryFn: () => rpc.classes.get({ classId }), enabled: on });
  const names = details.data?.professors.map((p) => p.name).join(', ');
  if (!on || !names) return null;
  return (
    <Text size="sm" c="dimmed">
      {names}
    </Text>
  );
}

function MyCourses() {
  const professor = useMe().role === 'professor';
  const plainList = useVariant('plain-course-list');
  const byTerm = useVariant('group-courses-by-term');
  const minimalCard = useVariant('minimal-course-card');
  const leaveAtTermEnd = useVariant('leave-at-term-end');
  const showCount = useShowCount();
  const mine = useQuery({ queryKey: ['classes', 'mine'], queryFn: () => rpc.classes.mine() });
  // At a glance for each class: the next lecture, the next thing due and questions still open.
  const today = ymd(new Date());
  const week = useQuery({ queryKey: ['calendar', today, addDays(today, 7)], queryFn: () => rpc.calendar.range({ from: today, to: addDays(today, 7) }) });
  const due = useQuery({ queryKey: ['calendar', 'upcoming', 60], queryFn: () => rpc.calendar.upcoming({ days: 60 }) });
  const fresh = useQuery({ queryKey: ['board', 'newCounts'], queryFn: () => rpc.board.newCounts() });
  const open = useQuery({
    queryKey: ['board', 'feed', 'open'],
    queryFn: () => rpc.board.feed({ classIds: null, topics: [], since: null, search: '', unresolved: true }),
  });
  // For a professor: what students have reported, waiting to be looked at.
  const reported = useQuery({
    queryKey: ['board', 'feed', 'reported'],
    queryFn: () => rpc.board.feed({ classIds: null, topics: [], since: null, search: '', reported: true }),
    enabled: professor,
  });
  if (mine.isPending) return <Loading />;
  if (!mine.data?.length) {
    return (
      <Card>
        <Empty icon={<IconSchool size={22} />}>
          {professor ? t("You aren't teaching any sections yet.") : t("You haven't joined any courses yet.")}{' '}
          <Text span inherit c="periwinkle" fw={700} component={Link} to="/courses/find">
            {t('Find your courses')}
          </Text>
        </Empty>
      </Card>
    );
  }
  type Course = (typeof mine.data)[number];
  const courseCard = (c: Course) => {
    const lecture = week.data?.find((e) => e.kind === 'class' && e.classId === c.id && e.start > new Date());
    const next = due.data?.find((e) => e.classId === c.id);
    const questions = open.data?.filter((p) => p.classId === c.id).length ?? 0;
    const newPosts = fresh.data?.find((n) => n.classId === c.id)?.count ?? 0;
    const reports = reported.data?.filter((p) => p.classId === c.id).length ?? 0;
    return (
      <Card key={c.id} component={Link} to={`/classes/${c.id}`} className="clickable" padding="lg">
        <Group justify="space-between" mb="xs">
          <Text fw={700} fz={24} className="display">
            {c.code} <ReqInfo id="course-card" />
          </Text>
          <Tag>{term(c.term)}</Tag>
        </Group>
        <Text>{c.title}</Text>
        <CardProfessor classId={c.id} />
        {!minimalCard && (
          <Stack gap={4} mt="md" c="dimmed">
            {lecture && (
              <Group gap={6} wrap="nowrap">
                <IconClock size={16} style={{ flex: 'none' }} />
                <Text size="sm" truncate>
                  {t('Next class: {{when}}', { when: dayjs(lecture.start).format(t('ddd, MMM D · HH:mm')) })}
                  {lecture.location && ` · ${lecture.location}`}
                </Text>
              </Group>
            )}
            {next && (
              <Group gap={6} wrap="nowrap">
                <IconCalendarDue size={16} style={{ flex: 'none' }} />
                <Text size="sm" truncate>
                  {t('Next due: {{title}}, {{when}}', { title: next.title, when: dayjs(next.start).format(t('ddd, MMM D')) })}
                </Text>
              </Group>
            )}
            <Group gap="md">
              {showCount(c.memberCount) && (
                <Group gap={6} wrap="nowrap">
                  <IconUsers size={16} />
                  <Text size="sm">{t('{{count}} students on UniLink', { count: c.memberCount })}</Text>
                  <ReqInfo id="course-members" />
                </Group>
              )}
              {questions > 0 && (
                <Group gap={6} wrap="nowrap">
                  <IconMessageQuestion size={16} />
                  <Text size="sm">{t('{{count}} unanswered questions', { count: questions })}</Text>
                  <ReqInfo id="feed-unanswered" />
                </Group>
              )}
              {newPosts > 0 && (
                <WithInfo id="post-new-badge">
                  <Badge size="sm" variant="light">
                    {t('{{count}} new posts', { count: newPosts })}
                  </Badge>
                </WithInfo>
              )}
              {reports > 0 && (
                <WithInfo id="feed-reported">
                  <Badge size="sm" variant="light" color="red">
                    {t('{{count}} reported threads', { count: reports })}
                  </Badge>
                </WithInfo>
              )}
            </Group>
            {leaveAtTermEnd && !professor && termWithExams(c.term) && (
              <Text size="xs">You'll leave this class on {dayjs(termWithExams(c.term)!.end).format(t('ddd, MMM D'))}, when the term ends.</Text>
            )}
          </Stack>
        )}
      </Card>
    );
  };
  const courseList = (list: Course[]) =>
    plainList ? (
      <Card padding={0}>
        {list.map((c) => (
          <Group key={c.id} component={Link} {...{ to: `/classes/${c.id}` }} className="course-row" wrap="nowrap" gap="md" px="md" py="sm">
            <Text fw={700} style={{ whiteSpace: 'nowrap' }}>
              {c.code} <ReqInfo id="course-card" />
            </Text>
            <Text size="sm" truncate style={{ flex: 1 }}>
              {c.title}
            </Text>
            <Tag>{term(c.term)}</Tag>
          </Group>
        ))}
      </Card>
    ) : (
      <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="lg">
        {list.map(courseCard)}
      </SimpleGrid>
    );
  if (!byTerm) return courseList(mine.data);
  // Terms you've finished stay here too, so the latest comes first.
  const terms = [...new Set(mine.data.map((c) => c.term))].sort((a, b) => TERMS.indexOf(b as (typeof TERMS)[number]) - TERMS.indexOf(a as (typeof TERMS)[number]));
  return (
    <Stack gap="xl">
      {terms.map((name) => (
        <div key={name}>
          <Text fw={800} size="lg" mb="sm" className="display">
            {term(name)}
          </Text>
          {courseList(mine.data.filter((c) => c.term === name))}
        </div>
      ))}
    </Stack>
  );
}

// 'join-code': opens the section a professor's code stands for, with a button to join.
function JoinByCode() {
  const navigate = useNavigate();
  const [code, setCode] = useState('');
  const classId = classFromJoinCode(code);
  return (
    <Group align="flex-end" gap="xs" mb="md">
      <TextInput label={<WithInfo id="copy-class-link">Got a join code?</WithInfo>} w={180} value={code} onChange={(e) => setCode(e.currentTarget.value)} />
      <Button variant="default" disabled={classId == null} onClick={() => navigate(`/classes/${classId}`)}>
        Open the section
      </Button>
    </Group>
  );
}

// 'add-missing-course': a course the catalogue doesn't have.
function AddCourse({ term: termName }: { term: string }) {
  const [code, setCode] = useState('');
  const [title, setTitle] = useState('');
  const [credits, setCredits] = useState('3');
  const parts = code.trim().toUpperCase().match(/^([A-Z]{3}[A-Z0-9])\s*-?\s*(\d{3}[A-Z0-9]*)$/);
  const add = useAction(() => rpc.catalogue.addCourse({ subject: parts![1], number: parts![2], title, credits: Number(credits), term: termName }), {
    success: () => 'Added to the catalogue',
    onSuccess: () => {
      setCode('');
      setTitle('');
    },
  });
  return (
    <Group align="flex-end" gap="xs" mb="md">
      <TextInput label={<WithInfo id="catalogue-sample">Missing a course?</WithInfo>} placeholder="COMP 251" w={130} value={code} onChange={(e) => setCode(e.currentTarget.value)} />
      <TextInput label={t('Title')} style={{ flex: 1 }} value={title} onChange={(e) => setTitle(e.currentTarget.value)} />
      <Select label={t('Credits')} w={90} data={['1', '2', '3', '4', '6']} allowDeselect={false} value={credits} onChange={(v) => v && setCredits(v)} />
      <Button variant="default" disabled={!parts || !title.trim()} onClick={() => add.mutate()} loading={add.isPending}>
        Add it
      </Button>
    </Group>
  );
}

// 'filter-day-time': the part of the day a class starts in.
const timeOfDay = (m: MeetingTime) => (m.startTime < '12:00' ? 'morning' : m.startTime < '17:00' ? 'afternoon' : 'evening');
const FACULTIES_IN_CATALOGUE = [
  tx('Agricultural and Environmental Sciences'),
  tx('Arts'),
  tx('Continuing Studies'),
  tx('Dental Medicine and Oral Health Sciences'),
  tx('Education'),
  tx('Engineering'),
  tx('Environment'),
  tx('Law'),
  tx('Management'),
  tx('Medicine and Health Sciences'),
  tx('Music'),
  tx('Science'),
];
const COURSE_PAGE_SIZE = 25;

// Memoized so loading another page only renders that page.
const SectionRow = memo(function SectionRow({
  section: c,
  allTerms,
  knowsTimes,
  blockClashes,
  professor,
  showMembers,
  joining,
  switching,
  onJoin,
  onSwitch,
}: {
  section: Out<typeof rpc.catalogue.search>[number];
  allTerms: boolean;
  knowsTimes: boolean;
  blockClashes: boolean;
  professor: boolean;
  showMembers: boolean;
  joining: boolean;
  switching: boolean;
  onJoin: (classId: number) => void;
  onSwitch: (classId: number) => void;
}) {
  return (
    <Table.Tr>
      <Table.Td fw={700} style={{ whiteSpace: 'nowrap' }}>
        {c.code} {allTerms && <Tag>{term(c.term)}</Tag>}
      </Table.Td>
      <Table.Td>
        <CatalogueLink code={`${c.subject} ${c.number}`}>{c.title}</CatalogueLink>
        {knowsTimes && c.times.length > 0 && (
          <Text size="xs" c="dimmed">
            {fmtMeetings(c.times)}
          </Text>
        )}
        {c.professors.length > 0 && (
          <Text size="xs" c="dimmed">
            {t('Taught by {{names}}', { names: c.professors.join(', ') })}
          </Text>
        )}
        {!c.joined && knowsTimes && <ClashNote codes={c.clashesWith} />}
      </Table.Td>
      <Table.Td>{c.credits}</Table.Td>
      <Table.Td>{showMembers ? c.memberCount : '–'}</Table.Td>
      <Table.Td ta="right">
        {c.joined ? (
          <Button size="xs" variant="light" component={Link} to={`/classes/${c.id}`}>
            {t('Open')}
          </Button>
        ) : c.otherSectionId ? (
          <Button size="xs" variant="default" disabled={blockClashes && c.clashesWith.length > 0} onClick={() => onSwitch(c.id)} loading={switching}>
            {t('Switch here')}
          </Button>
        ) : (
          <Button size="xs" disabled={blockClashes && !professor && c.clashesWith.length > 0} onClick={() => onJoin(c.id)} loading={joining}>
            {professor ? t('Teach') : t('Join')}
          </Button>
        )}
      </Table.Td>
    </Table.Tr>
  );
});

function FindCourses() {
  const professor = useMe().role === 'professor';
  const showCount = useShowCount();
  const versionA = useVariant('search-version-a');
  const subjectOnly = useVariant('filter-by-subject');
  const byProfessor = useVariant('search-professors');
  const allTerms = useVariant('search-all-terms');
  const facultyCredits = useVariant('filter-faculty-credits');
  const dayTime = useVariant('filter-day-time');
  const noPaste = useVariant('no-schedule-paste');
  const noTimetableFilter = useVariant('no-timetable-filter');
  const noSectionTimes = useVariant('no-section-times');
  const noClashNotes = useVariant('no-clash-notes');
  const blockClashes = useVariant('block-clashes');
  const addMissing = useVariant('add-missing-course');
  const joinCode = useVariant('join-code');
  const bySubject = versionA || subjectOnly;
  const knowsTimes = !noTimetableFilter && !noSectionTimes;
  const navigate = useNavigate();
  // 'search-catalogue' sends a course here from the search box.
  const [params] = useSearchParams();
  const fromSearch = params.get('q');
  const [query, setQuery] = useState(fromSearch ?? '');
  useEffect(() => {
    if (fromSearch) setQuery(fromSearch);
  }, [fromSearch]);
  const [termName, setTermName] = useState<string>(CURRENT_TERM);
  const [level, setLevel] = useState<string | null>(null);
  const [subject, setSubject] = useState<string | null>(null);
  const [faculty, setFaculty] = useState<string | null>(null);
  const [credits, setCredits] = useState<string | null>(null);
  const [day, setDay] = useState<string | null>(null);
  const [slot, setSlot] = useState<string | null>(null);
  const [debounced] = useDebouncedValue(query, 120);
  const [pasting, setPasting] = useState(false);
  // Your own section stays listed, so you can always see where you are.
  const [fits, setFits] = useState(false);

  const terms = useQuery({ queryKey: ['catalogue', 'terms'], queryFn: () => rpc.catalogue.terms() });
  const subjects = useQuery({ queryKey: ['catalogue', 'subjects'], queryFn: () => rpc.catalogue.subjects(), enabled: bySubject });
  const filters = {
    query: debounced,
    term: allTerms ? null : termName,
    level: !bySubject && level ? Number(level) : null,
    subject: bySubject ? subject : null,
    faculty: facultyCredits ? faculty : null,
    credits: facultyCredits && credits ? Number(credits) : null,
  };
  // A page at a time, so a long list costs only what's been scrolled to. A new search starts from the top.
  const results = useInfiniteQuery({
    queryKey: ['catalogue', 'search', filters],
    queryFn: ({ pageParam }) => rpc.catalogue.search({ ...filters, limit: COURSE_PAGE_SIZE, offset: pageParam }),
    initialPageParam: 0,
    getNextPageParam: (page, _pages, offset) => (page.length ? offset + COURSE_PAGE_SIZE : undefined),
    placeholderData: keepPreviousData,
    // Writes refresh it, so coming back to the list doesn't need to.
    staleTime: 5 * 60_000,
  });
  const sections = useMemo(() => results.data?.pages.flat(), [results.data]);
  const join = useAction((classId: number) => rpc.classes.join({ classId }), {
    success: () => (professor ? t('You now teach this section, and your name is on its course details.') : t('Joined! Your classmates are here.')),
    onSuccess: (_data, classId) => navigate(`/classes/${classId}`),
  });
  const switchTo = useAction((classId: number) => rpc.classes.switchSection({ classId }), {
    success: 'Switched sections',
    onSuccess: (_data, classId) => navigate(`/classes/${classId}`),
  });

  const showFits = !professor && knowsTimes && !noClashNotes;
  const inSlot = (m: MeetingTime) => (!day || m.weekday === Number(day)) && (!slot || timeOfDay(m) === slot);
  const shown = sections?.filter((c) => (!showFits || !fits || c.joined || !c.clashesWith.length) && (!dayTime || (!day && !slot) || c.times.some(inSlot)));

  return (
    <SectionCard
      info="tab-find"
      title={t('Find your courses')}
      actions={
        !noPaste && (
          <WithInfo id="find-paste">
            <Button size="compact-sm" variant="subtle" leftSection={<IconClipboardText size={14} />} onClick={() => setPasting(true)}>
              {t('Paste my schedule')}
            </Button>
          </WithInfo>
        )
      }
    >
      <Modal opened={pasting} onClose={() => setPasting(false)} title={<WithInfo id="find-paste">{t('Add sections from your schedule')}</WithInfo>} size="lg">
        {pasting && <SchedulePaste term={termName} professor={professor} onDone={() => setPasting(false)} />}
      </Modal>
      <Group mb="md" align="flex-end">
        <TextInput
          label={<WithInfo id="find-search">{byProfessor ? 'Course code, title or professor' : t('Course code or title')}</WithInfo>}
          placeholder={versionA ? 'e.g. MATH 240 or algorithms' : t('e.g. COMP 2XX, MATH 240 or algorithms')}
          description={versionA ? undefined : t('X stands for any digit: "COMP 3XX" lists every 300-level COMP course.')}
          leftSection={<IconSearch size={16} />}
          radius="xl"
          value={query}
          onChange={(e) => setQuery(e.currentTarget.value)}
          style={{ flex: 1 }}
          autoFocus
        />
        {!allTerms && (
          <Select label={<WithInfo id="find-term">{t('Term')}</WithInfo>} radius="xl" data={terms.data ?? [CURRENT_TERM]} value={termName} onChange={(v) => v && setTermName(v)} w={160} allowDeselect={false} />
        )}
        {bySubject ? (
          <Select label={<WithInfo id="find-level">Subject</WithInfo>} radius="xl" placeholder={t('Any')} data={subjects.data ?? []} value={subject} onChange={setSubject} clearable searchable w={140} />
        ) : (
          <Select
            label={<WithInfo id="find-level">{t('Level')}</WithInfo>}
            radius="xl"
            placeholder={t('Any')}
            data={LEVELS.map((l) => ({ value: String(l), label: t('{{level}}-level', { level: l }) }))}
            value={level}
            onChange={setLevel}
            clearable
            w={140}
          />
        )}
        {facultyCredits && (
          <>
            <Select label={<WithInfo id="find-level">{t('Faculty')}</WithInfo>} radius="xl" placeholder={t('Any')} data={FACULTIES_IN_CATALOGUE.map((f) => ({ value: f, label: t(f) }))} value={faculty} onChange={setFaculty} clearable searchable w={220} />
            <Select label={<WithInfo id="find-level">{t('Credits')}</WithInfo>} radius="xl" placeholder={t('Any')} data={['1', '2', '3', '4', '6', '9', '12']} value={credits} onChange={setCredits} clearable w={110} />
          </>
        )}
        {dayTime && (
          <>
            <Select
              label={<WithInfo id="find-fits">{t('Day')}</WithInfo>}
              radius="xl"
              placeholder={t('Any')}
              data={[1, 2, 3, 4, 5].map((d) => ({ value: String(d), label: dayjs().day(d).format('dddd') }))}
              value={day}
              onChange={setDay}
              clearable
              w={140}
            />
            <Select
              label={<WithInfo id="find-fits">Time of day</WithInfo>}
              radius="xl"
              placeholder={t('Any')}
              data={[
                { value: 'morning', label: 'Morning' },
                { value: 'afternoon', label: 'Afternoon' },
                { value: 'evening', label: 'Evening' },
              ]}
              value={slot}
              onChange={setSlot}
              clearable
              w={140}
            />
          </>
        )}
        {showFits && (
          <Tooltip label={t('Leaves out sections that clash with your classes that term. Sections with no times entered yet stay listed.')} multiline w={260}>
            <Checkbox label={<WithInfo id="find-fits">{t('Fits my timetable')}</WithInfo>} checked={fits} onChange={(e) => setFits(e.currentTarget.checked)} mb={8} />
          </Tooltip>
        )}
      </Group>
      {addMissing && <AddCourse term={termName} />}
      {joinCode && <JoinByCode />}
      {results.isPending ? (
        <Loading />
      ) : shown?.length ? (
        <Table.ScrollContainer minWidth={560}>
          <Table highlightOnHover verticalSpacing="sm">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>
                  <WithInfo id="find-section">{t('Section')}</WithInfo>
                </Table.Th>
                <Table.Th>
                  <WithInfo id="find-times">{t('Title')}</WithInfo>
                </Table.Th>
                <Table.Th>
                  <WithInfo id="find-credits">{t('Credits')}</WithInfo>
                </Table.Th>
                <Table.Th>
                  <WithInfo id="course-members">{t('Students')}</WithInfo>
                </Table.Th>
                <Table.Th ta="right">
                  <ReqInfo id="join-section" />
                </Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {shown.map((c) => (
                <SectionRow
                  key={c.id}
                  section={c}
                  allTerms={allTerms}
                  knowsTimes={knowsTimes}
                  blockClashes={blockClashes}
                  professor={professor}
                  showMembers={showCount(c.memberCount)}
                  joining={join.isPending && join.variables === c.id}
                  switching={switchTo.isPending && switchTo.variables === c.id}
                  onJoin={join.mutate}
                  onSwitch={switchTo.mutate}
                />
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      ) : (
        <Empty>
          {versionA ? 'No sections match. Try a code like "MATH 240".' : t('No sections match. Try a code like "MATH 240" or "COMP 2XX".')} <ReqInfo id="catalogue-sample" />
        </Empty>
      )}
      {results.hasNextPage && !results.isPlaceholderData && (
        <LoadOnScroll
          label={t('Show more courses')}
          shown={results.data?.pages.length ?? 0}
          loading={results.isFetchingNextPage}
          onMore={() => {
            if (!results.isFetchingNextPage) void results.fetchNextPage();
          }}
        />
      )}
      <Text size="xs" c="dimmed" mt="sm">
        {t('Fall sections on McGill’s December exam schedule are real. Other terms and sections are estimates from course codes, titles and program lists. If a course is missing from a term, search its exact code, and check the Minerva Class Schedule to be sure.')} <ReqInfo id="catalogue-sample" />
      </Text>
    </SectionCard>
  );
}

// S1 + G2: every section at once, from a schedule copied out of Minerva. Reviewed before joining.
function SchedulePaste({ term: termName, professor, onDone }: { term: string; professor: boolean; onDone: () => void }) {
  const [text, setText] = useState('');
  const [debounced] = useDebouncedValue(text, 200);
  const [unchecked, setUnchecked] = useState<Set<string>>(new Set());
  const found = useQuery({
    queryKey: ['classes', 'matchSchedule', debounced, termName],
    queryFn: () => rpc.classes.matchSchedule({ text: debounced, term: termName }),
    enabled: !!debounced.trim(),
    placeholderData: keepPreviousData,
  });
  const rows = debounced.trim() ? (found.data ?? []) : [];
  const picked = rows.filter((r) => r.status === 'new' && !unchecked.has(r.label));
  const note = (r: (typeof rows)[number]) =>
    r.status === 'missing'
      ? t("Not in UniLink's course catalogue yet")
      : r.status === 'joined'
        ? t('Already in your courses')
        : r.status === 'other-section'
          ? t("You're in {{code}}", { code: r.otherCode ?? '' })
          : r.title;

  const join = useAction(
    async () => {
      const failed: string[] = [];
      for (const r of picked) {
        try {
          await rpc.classes.join({ classId: r.classId! });
        } catch {
          failed.push(r.label);
        }
      }
      return { added: picked.length - failed.length, failed };
    },
    {
      success: (r) =>
        [t('Added {{count}} sections to your courses', { count: r.added }), r.failed.length ? t('Not added: {{titles}}', { titles: r.failed.join(', ') }) : '']
          .filter(Boolean)
          .join(' '),
      onSuccess: (r) => !r.failed.length && onDone(),
    },
  );

  return (
    <Stack>
      <Text size="sm" c="dimmed">
        {t('On Minerva, open your schedule for {{term}}, select it and paste it here. Codes like "COMP 251 001" are read, and you pick what to add.', { term: term(termName) })}
      </Text>
      <Textarea
        label={<WithInfo id="find-paste">{t('Schedule')}</WithInfo>}
        placeholder={'COMP 251 001  Algorithms and Data Structures\nMATH 240 002  Discrete Structures'}
        autosize
        minRows={5}
        maxRows={12}
        data-autofocus
        value={text}
        onChange={(e) => {
          setText(e.currentTarget.value);
          setUnchecked(new Set());
        }}
      />
      {debounced.trim() && !found.isPending && (
        <Text size="sm" fw={700}>
          {rows.length ? t('Found {{count}} courses', { count: rows.length }) : t('No course codes found yet. Look for lines like "COMP 251 001".')}
        </Text>
      )}
      {rows.map((r) => (
        <Group key={r.label} gap="sm" wrap="nowrap">
          <Checkbox
            checked={r.status === 'new' && !unchecked.has(r.label)}
            disabled={r.status !== 'new'}
            aria-label={r.label}
            onChange={(e) => {
              const on = e.currentTarget.checked;
              setUnchecked((u) => {
                const next = new Set(u);
                if (on) next.delete(r.label);
                else next.add(r.label);
                return next;
              });
            }}
          />
          <Text size="sm" fw={700} style={{ whiteSpace: 'nowrap' }}>
            {r.label}
          </Text>
          <Text size="sm" c="dimmed" truncate>
            {note(r)}
          </Text>
        </Group>
      ))}
      <Group justify="flex-end">
        <Button onClick={() => join.mutate()} disabled={!picked.length} loading={join.isPending}>
          {professor ? t('Teach {{count}} sections', { count: picked.length }) : t('Join {{count}} sections', { count: picked.length })}
        </Button>
        <ReqInfo id="join-section" />
      </Group>
    </Stack>
  );
}
