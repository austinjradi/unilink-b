import { useState } from 'react';
import { Badge, Button, Card, Checkbox, Group, Modal, Select, SimpleGrid, Stack, Table, Tabs, Text, Textarea, TextInput } from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import { IconCalendarDue, IconCertificate, IconClipboardText, IconClock, IconListDetails, IconMessageQuestion, IconSchool, IconSearch, IconUsers } from '@tabler/icons-react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { Link, useNavigate, useParams } from 'react-router';
import { LEVELS } from '@shared/courseQuery';
import { addDays, CURRENT_TERM, ymd } from '@shared/dates';
import { ClashNote, Empty, Loading, PageHeader, SectionCard, Tag } from '../components/ui';
import { fmtMeetings } from '../lib/format';
import { useAction, useMe } from '../lib/hooks';
import { rpc } from '../lib/rpc';
import { AcademicsPanel } from './Academics';
import { t, term } from '../lib/i18n';

const TABS = ['mine', 'find', 'record', 'degree'] as const;
type CoursesTab = (typeof TABS)[number];

// S1 (my courses, find & join a section) plus A1/A2 (record and degree plan).
export function CoursesPage() {
  const params = useParams();
  const navigate = useNavigate();
  const tab: CoursesTab = TABS.includes(params.tab as CoursesTab) ? (params.tab as CoursesTab) : 'mine';
  const student = useMe().role === 'student';

  return (
    <>
      <PageHeader title={t('Courses')} subtitle={student ? t('Your classes, finding new ones, and how they add up toward your degree.') : t('The sections you teach, and finding others.')} />
      <Tabs value={tab} onChange={(v) => navigate(`/courses/${v}`)} keepMounted={false} variant="pills" radius="xl">
        <Tabs.List mb="lg">
          <Tabs.Tab value="mine" leftSection={<IconSchool size={16} />}>
            {t('My courses')}
          </Tabs.Tab>
          <Tabs.Tab value="find" leftSection={<IconSearch size={16} />}>
            {t('Find courses')}
          </Tabs.Tab>
          {student && (
            <Tabs.Tab value="record" leftSection={<IconListDetails size={16} />}>
              {t('Course record')}
            </Tabs.Tab>
          )}
          {student && (
            <Tabs.Tab value="degree" leftSection={<IconCertificate size={16} />}>
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

function MyCourses() {
  const professor = useMe().role === 'professor';
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
  return (
    <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="lg">
      {mine.data.map((c) => {
        const lecture = week.data?.find((e) => e.kind === 'class' && e.classId === c.id && e.start > new Date());
        const next = due.data?.find((e) => e.classId === c.id);
        const questions = open.data?.filter((p) => p.classId === c.id).length ?? 0;
        const newPosts = fresh.data?.find((n) => n.classId === c.id)?.count ?? 0;
        return (
          <Card key={c.id} component={Link} to={`/classes/${c.id}`} className="clickable" padding="lg">
            <Group justify="space-between" mb="xs">
              <Text fw={700} fz={24} className="display">
                {c.code}
              </Text>
              <Tag>{term(c.term)}</Tag>
            </Group>
            <Text>{c.title}</Text>
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
                <Group gap={6} wrap="nowrap">
                  <IconUsers size={16} />
                  <Text size="sm">{t('{{count}} students on UniLink', { count: c.memberCount })}</Text>
                </Group>
                {questions > 0 && (
                  <Group gap={6} wrap="nowrap">
                    <IconMessageQuestion size={16} />
                    <Text size="sm">{t('{{count}} unanswered questions', { count: questions })}</Text>
                  </Group>
                )}
                {newPosts > 0 && (
                  <Badge size="sm" variant="light">
                    {t('{{count}} new posts', { count: newPosts })}
                  </Badge>
                )}
              </Group>
            </Stack>
          </Card>
        );
      })}
    </SimpleGrid>
  );
}

function FindCourses() {
  const professor = useMe().role === 'professor';
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [term, setTerm] = useState<string>(CURRENT_TERM);
  const [level, setLevel] = useState<string | null>(null);
  const [debounced] = useDebouncedValue(query, 200);
  const [pasting, setPasting] = useState(false);

  const terms = useQuery({ queryKey: ['catalogue', 'terms'], queryFn: () => rpc.catalogue.terms() });
  const results = useQuery({
    queryKey: ['catalogue', 'search', debounced, term, level],
    queryFn: () => rpc.catalogue.search({ query: debounced, term, level: level ? Number(level) : null }),
    placeholderData: keepPreviousData,
  });
  const join = useAction((classId: number) => rpc.classes.join({ classId }), {
    success: () => (professor ? t('You now teach this section, and your name is on its course details.') : t('Joined! Your classmates are here.')),
    onSuccess: (_data, classId) => navigate(`/classes/${classId}`),
  });
  const switchTo = useAction((classId: number) => rpc.classes.switchSection({ classId }), {
    success: 'Switched sections',
    onSuccess: (_data, classId) => navigate(`/classes/${classId}`),
  });

  return (
    <SectionCard
      title={t('Find your courses')}
      actions={
        <Button size="compact-sm" variant="subtle" leftSection={<IconClipboardText size={14} />} onClick={() => setPasting(true)}>
          {t('Paste my schedule')}
        </Button>
      }
    >
      <Modal opened={pasting} onClose={() => setPasting(false)} title={t('Add sections from your schedule')} size="lg">
        {pasting && <SchedulePaste term={term} professor={professor} onDone={() => setPasting(false)} />}
      </Modal>
      <Group mb="md" align="flex-end">
        <TextInput
          label={t('Course code or title')}
          placeholder={t('e.g. COMP 2XX, MATH 240 or algorithms')}
          description={t('X stands for any digit: "COMP 3XX" lists every 300-level COMP course.')}
          leftSection={<IconSearch size={16} />}
          radius="xl"
          value={query}
          onChange={(e) => setQuery(e.currentTarget.value)}
          style={{ flex: 1 }}
          autoFocus
        />
        <Select label={t('Term')} radius="xl" data={terms.data ?? [CURRENT_TERM]} value={term} onChange={(v) => v && setTerm(v)} w={160} allowDeselect={false} />
        <Select
          label={t('Level')}
          radius="xl"
          placeholder={t('Any')}
          data={LEVELS.map((l) => ({ value: String(l), label: t('{{level}}-level', { level: l }) }))}
          value={level}
          onChange={setLevel}
          clearable
          w={140}
        />
      </Group>
      {results.isPending ? (
        <Loading />
      ) : results.data?.length ? (
        <Table.ScrollContainer minWidth={560}>
          <Table highlightOnHover verticalSpacing="sm">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>{t('Section')}</Table.Th>
                <Table.Th>{t('Title')}</Table.Th>
                <Table.Th>{t('Credits')}</Table.Th>
                <Table.Th>{t('Students')}</Table.Th>
                <Table.Th />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {results.data.map((c) => (
                <Table.Tr key={c.id}>
                  <Table.Td fw={700} style={{ whiteSpace: 'nowrap' }}>
                    {c.code}
                  </Table.Td>
                  <Table.Td>
                    {c.title}
                    {c.times.length > 0 && (
                      <Text size="xs" c="dimmed">
                        {fmtMeetings(c.times)}
                      </Text>
                    )}
                    {c.professors.length > 0 && (
                      <Text size="xs" c="dimmed">
                        {t('Taught by {{names}}', { names: c.professors.join(', ') })}
                      </Text>
                    )}
                    {!c.joined && <ClashNote codes={c.clashesWith} />}
                  </Table.Td>
                  <Table.Td>{c.credits}</Table.Td>
                  <Table.Td>{c.memberCount}</Table.Td>
                  <Table.Td ta="right">
                    {c.joined ? (
                      <Button size="xs" variant="light" component={Link} to={`/classes/${c.id}`}>
                        {t('Open')}
                      </Button>
                    ) : c.otherSectionId ? (
                      <Button size="xs" variant="default" onClick={() => switchTo.mutate(c.id)} loading={switchTo.isPending && switchTo.variables === c.id}>
                        {t('Switch here')}
                      </Button>
                    ) : (
                      <Button size="xs" onClick={() => join.mutate(c.id)} loading={join.isPending && join.variables === c.id}>
                        {professor ? t('Teach') : t('Join')}
                      </Button>
                    )}
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      ) : (
        <Empty>
          {t('No sections match. Try a code like "MATH 240" or "COMP 2XX". The built-in catalogue is a sample of McGill courses for now.')}
          <Badge ml={6} size="xs" variant="light" color="yellow">
            {t('sample')}
          </Badge>
        </Empty>
      )}
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
        label={t('Schedule')}
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
      </Group>
    </Stack>
  );
}
