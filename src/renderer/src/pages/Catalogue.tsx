import { memo, type ReactNode, useDeferredValue, useMemo, useState } from 'react';
import { Alert, Anchor, Badge, Button, Card, Group, List, Paper, Select, SimpleGrid, Stack, Table, Tabs, Text, TextInput, Title } from '@mantine/core';
import { IconAward, IconBook2, IconCalendarEvent, IconCertificate, IconCoin, IconInfoCircle, IconListSearch, IconListTree, IconMail, IconMapPin, IconPhone, IconScale, IconSearch, IconWorld } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { CURRENT_TERM, TERMS } from '@shared/dates';
import {
  type Award,
  type CatalogueIndex,
  type CatalogueProgram,
  type Contact,
  courseParts,
  type CourseRow,
  dateOrder,
  type GuideSection,
  loadAwards,
  loadContacts,
  loadCourses,
  loadContents,
  loadGuide,
  loadIndex,
  loadPrograms,
  parseCatalogueDate,
  type ProgramListing,
  type SectionFacts,
} from '@shared/catalogue';
import { CourseFacts } from '../components/CourseFacts';
import { LoadOnScroll } from '../components/LoadOnScroll';
import { Empty, Loading, PageHeader } from '../components/ui';
import { useAction } from '../lib/hooks';
import { rpc } from '../lib/rpc';
import { t, tx } from '../lib/i18n';

const PAGE_SIZE = 40;

const TABS: { value: string; label: string; icon: typeof IconBook2 }[] = [
  { value: 'overview', label: tx('Search'), icon: IconListSearch },
  { value: 'programs', label: tx('Programs'), icon: IconCertificate },
  { value: 'courses', label: tx('Courses'), icon: IconBook2 },
  { value: 'guide', label: tx('Rules and guides'), icon: IconScale },
  { value: 'awards', label: tx('Awards'), icon: IconAward },
  { value: 'dates', label: tx('Dates and amounts'), icon: IconCalendarEvent },
  { value: 'contacts', label: tx('Contacts'), icon: IconMapPin },
  { value: 'contents', label: tx('Contents'), icon: IconListTree },
];

// The catalogue never changes while the page is open, so one load of each part is enough.
const useData = <T,>(name: string, load: () => Promise<T>) => useQuery({ queryKey: ['catalogue', name], queryFn: load, staleTime: Infinity, gcTime: Infinity });
const useIndex = () => useData('index', loadIndex);
const useCourses = () => useData('courses', loadCourses);
const usePrograms = () => useData('programs', loadPrograms);
const useGuide = () => useData('guide', loadGuide);
const useContacts = () => useData('contacts', loadContacts);
const useAwards = () => useData('awards', loadAwards);
const useContents = () => useData('contents', loadContents);

const has = (text: string | null | undefined, query: string) => !!text && text.toLowerCase().includes(query);
const pageRef = (page: number) => t('p. {{page}}', { page });
const courseLink = (code: string) => `/catalogue/courses/${encodeURIComponent(code)}`;
const programLink = (id: string) => `/catalogue/programs/${encodeURIComponent(id)}`;
const guideLink = (key: string) => `/catalogue/guide/${encodeURIComponent(key)}`;

function PageBadge({ page }: { page: number }) {
  return (
    <Badge variant="light" color="gray" radius="sm" style={{ flexShrink: 0 }} title={t('Page in the 2026–2027 catalogue')}>
      {pageRef(page)}
    </Badge>
  );
}

function ShowMore({ shown, total, onMore }: { shown: number; total: number; onMore: () => void }) {
  if (shown >= total) return null;
  return <LoadOnScroll label={t('Show more ({{left}} left)', { left: total - shown })} shown={shown} onMore={onMore} />;
}

const asLink = (link: string) => (/^https?:\/\//.test(link) ? link : `https://${link}`);

// The details found in a section: nothing here is rewritten, so nothing gets lost in a summary.
function Facts({ facts }: { facts?: SectionFacts }) {
  if (!facts) return null;
  const chip = (key: string, icon: ReactNode, label: string, href?: string) => (
    <Badge key={key} variant="light" color="gray" radius="sm" tt="none" fw={500} leftSection={icon} {...(href ? { component: 'a', href, target: '_blank', rel: 'noreferrer', style: { cursor: 'pointer' } } : {})}>
      {label}
    </Badge>
  );
  return (
    <Group gap={6} mt={6}>
      {facts.dates?.map((d) => chip(`d${d}`, <IconCalendarEvent size={12} />, d))}
      {facts.money?.map((m) => chip(`m${m}`, <IconCoin size={12} />, m))}
      {facts.percents?.map((p) => chip(`p${p}`, null, p))}
      {facts.phones?.map((p) => chip(`t${p}`, <IconPhone size={12} />, p, `tel:${p.replace(/\D/g, '')}`))}
      {facts.emails?.map((e) => chip(`e${e}`, <IconMail size={12} />, e, `mailto:${e}`))}
      {facts.links?.map((l) => chip(`l${l}`, <IconWorld size={12} />, l, asLink(l)))}
    </Group>
  );
}

function CourseChips({ codes }: { codes?: string[] }) {
  if (!codes?.length) return null;
  return (
    <Group gap={6} mt={6}>
      {codes.map((code) => (
        <Badge key={code} component={Link} to={courseLink(code)} variant="light" radius="sm" style={{ cursor: 'pointer' }}>
          {code}
        </Badge>
      ))}
    </Group>
  );
}

// Pages the catalogue points to: straight to a program or section when there's one on that page.
function PageRefs({ refs }: { refs?: GuideSection['refs'] }) {
  const index = useIndex();
  if (!refs?.length) return null;
  const target = (label: string, page?: number) => {
    const name = label.replace(/\s*\(\d[\d.-]* (?:credits?|crédits?)\).*$/, '');
    const program = index.data?.programs.find((p) => (page === undefined || p.page === page) && p.name.startsWith(name.slice(0, 40)));
    if (program) return programLink(program.id);
    const section = page === undefined ? undefined : index.data?.guide.find((g) => g.page === page);
    return section ? guideLink(section.key) : null;
  };
  return (
    <List size="sm" spacing={2} mt={6}>
      {refs.map(({ label, page }) => {
        const to = target(label, page);
        return (
          <List.Item key={`${label}-${page}`}>
            {to ? <Anchor component={Link} to={to} size="sm">{label}</Anchor> : label} {page !== undefined && <Text span size="xs" c="dimmed">{pageRef(page)}</Text>}
          </List.Item>
        );
      })}
    </List>
  );
}

function SectionBody({ section }: { section: GuideSection }) {
  return (
    <>
      {section.points?.length === 1 ? (
        <Text size="sm">{section.points[0]}</Text>
      ) : (
        section.points && (
          <List size="sm" spacing={4}>
            {section.points.map((point) => (
              <List.Item key={point}>{point}</List.Item>
            ))}
          </List>
        )
      )}
      <Facts facts={section.facts} />
      <CourseChips codes={section.courses} />
      <PageRefs refs={section.refs} />
    </>
  );
}

// --- Search over everything ---------------------------------------------------------------------

const RESULT_LIMIT = 8;

function ResultGroup({ title, total, children }: { title: string; total: number; children: ReactNode }) {
  if (!total) return null;
  return (
    <Paper withBorder p="md" radius="lg">
      <Text fw={700} mb={6}>
        {title} <Text span c="dimmed" size="sm">{total}</Text>
      </Text>
      <Stack gap={4}>{children}</Stack>
    </Paper>
  );
}

function Hit({ to, title, sub, page }: { to: string; title: string; sub?: string | null; page?: number }) {
  return (
    <Group justify="space-between" wrap="nowrap" gap="sm">
      <div style={{ minWidth: 0 }}>
        <Anchor component={Link} to={to} size="sm" fw={600}>
          {title}
        </Anchor>
        {sub && (
          <Text span size="xs" c="dimmed">
            {' '}· {sub}
          </Text>
        )}
      </div>
      {page !== undefined && <PageBadge page={page} />}
    </Group>
  );
}

function Overview() {
  const [params, setParams] = useSearchParams();
  const query = params.get('q') ?? '';
  const deferred = useDeferredValue(query.trim().toLowerCase());
  const index = useIndex();
  const courses = useCourses();
  const guide = useGuide();
  const awards = useAwards();
  const contacts = useContacts();

  const results = useMemo(() => {
    if (deferred.length < 2) return null;
    return {
      programs: index.data?.programs.filter((p) => has(p.name, deferred) || has(p.unit, deferred)) ?? [],
      courses: courses.data?.filter(([code, title]) => has(code, deferred) || has(title, deferred) || has(code.replace(' ', ''), deferred)) ?? [],
      guide: guide.data?.filter((s) => has(s.title, deferred) || s.points?.some((point) => has(point, deferred))) ?? [],
      awards: awards.data?.filter((a) => has(a.name, deferred)) ?? [],
      contacts: contacts.data?.filter((c) => has(c.unit, deferred) || has(c.section, deferred) || c.emails.some((e) => has(e, deferred)) || c.phones.some((p) => has(p, deferred))) ?? [],
    };
  }, [deferred, index.data, courses.data, guide.data, awards.data, contacts.data]);

  const count = (results?.programs.length ?? 0) + (results?.courses.length ?? 0) + (results?.guide.length ?? 0) + (results?.awards.length ?? 0) + (results?.contacts.length ?? 0);

  return (
    <Stack>
      <TextInput
        size="md"
        radius="xl"
        autoFocus
        leftSection={<IconSearch size={18} />}
        placeholder={t('Search programs, courses, rules, awards and contacts')}
        value={query}
        onChange={(e) => setParams(e.currentTarget.value ? { q: e.currentTarget.value } : {}, { replace: true })}
      />
      {!results ? (
        <>
          <SimpleGrid cols={{ base: 2, sm: 4 }}>
            <Stat label={t('Programs')} value={index.data?.programs.length} to="/catalogue/programs" />
            <Stat label={t('Courses')} value={courses.data?.length} to="/catalogue/courses" />
            <Stat label={t('Awards')} value={awards.data?.length} to="/catalogue/awards" />
            <Stat label={t('Contacts')} value={contacts.data?.length} to="/catalogue/contacts" />
          </SimpleGrid>
          <Title order={3}>{t('Browse the catalogue')}</Title>
          <SimpleGrid cols={{ base: 1, sm: 2, md: 3 }}>
            {index.data?.parts.map((part) => (
              <PartCard key={part.title} part={part} index={index.data} />
            ))}
          </SimpleGrid>
        </>
      ) : count === 0 ? (
        <Empty icon={<IconSearch size={22} />}>{t('Nothing in the catalogue matches that.')}</Empty>
      ) : (
        <>
          <ResultGroup title={t('Programs')} total={results.programs.length}>
            {results.programs.slice(0, RESULT_LIMIT).map((p) => (
              <Hit key={p.id} to={programLink(p.id)} title={p.name} sub={p.faculty} page={p.page} />
            ))}
          </ResultGroup>
          <ResultGroup title={t('Courses')} total={results.courses.length}>
            {results.courses.slice(0, RESULT_LIMIT).map(([code, title]) => (
              <Hit key={code} to={courseLink(code)} title={code} sub={title} />
            ))}
          </ResultGroup>
          <ResultGroup title={t('Rules and guides')} total={results.guide.length}>
            {results.guide.slice(0, RESULT_LIMIT).map((s) => (
              <Hit key={s.key} to={s.program ? programLink(s.program) : guideLink(s.key)} title={s.title} sub={s.part} page={s.page} />
            ))}
          </ResultGroup>
          <ResultGroup title={t('Awards')} total={results.awards.length}>
            {results.awards.slice(0, RESULT_LIMIT).map((a) => (
              <Hit key={a.key} to={guideLink(a.key)} title={a.name} sub={a.value} page={a.page} />
            ))}
          </ResultGroup>
          <ResultGroup title={t('Contacts')} total={results.contacts.length}>
            {results.contacts.slice(0, RESULT_LIMIT).map((c) => (
              <Hit key={`${c.page}-${c.section}-${c.phones[0]}`} to={`/catalogue/contacts?q=${encodeURIComponent(c.unit ?? c.section)}`} title={c.unit ?? c.section} sub={c.phones[0] ?? c.emails[0]} page={c.page} />
            ))}
          </ResultGroup>
        </>
      )}
    </Stack>
  );
}

function Stat({ label, value, to }: { label: string; value?: number; to: string }) {
  return (
    <Card withBorder radius="lg" component={Link} to={to}>
      <Text fw={800} fz={28} className="display">
        {value?.toLocaleString() ?? '…'}
      </Text>
      <Text size="sm" c="dimmed">
        {label}
      </Text>
    </Card>
  );
}

function PartCard({ part, index }: { part: CatalogueIndex['parts'][number]; index: CatalogueIndex }) {
  const programs = index.programs.filter((p) => p.part === part.title).length;
  const sections = index.guide.filter((s) => s.part === part.title).length;
  return (
    <Card withBorder radius="lg">
      <Group justify="space-between" wrap="nowrap" align="flex-start">
        <Text fw={700}>{part.title}</Text>
        <PageBadge page={part.page} />
      </Group>
      <Group gap="md" mt={6}>
        {programs > 0 && (
          <Anchor component={Link} to={`/catalogue/programs?part=${encodeURIComponent(part.title)}`} size="sm">
            {t('{{count}} programs', { count: programs })}
          </Anchor>
        )}
        <Anchor component={Link} to={`/catalogue/guide?part=${encodeURIComponent(part.title)}`} size="sm">
          {t('{{count}} sections', { count: sections })}
        </Anchor>
      </Group>
    </Card>
  );
}

// --- Programs -----------------------------------------------------------------------------------

function ProgramList() {
  const [params, setParams] = useSearchParams();
  const index = useIndex();
  const [limit, setLimit] = useState(PAGE_SIZE);
  const query = (params.get('q') ?? '').trim().toLowerCase();
  const part = params.get('part');
  const kind = params.get('kind');
  const set = (key: string, value: string | null) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
    setLimit(PAGE_SIZE);
  };
  if (!index.data) return <Loading />;
  const kinds = [...new Set(index.data.programs.map((p) => p.kind))].sort();
  const found = index.data.programs.filter((p) => (!part || p.part === part) && (!kind || p.kind === kind) && (!query || has(p.name, query) || has(p.unit, query)));
  return (
    <Stack>
      <Group align="flex-end">
        <TextInput style={{ flex: 1, minWidth: 220 }} radius="xl" leftSection={<IconSearch size={16} />} placeholder={t('Search programs')} value={params.get('q') ?? ''} onChange={(e) => set('q', e.currentTarget.value)} />
        <Select radius="xl" clearable placeholder={t('Any faculty')} data={index.data.parts.filter((p) => index.data.programs.some((x) => x.part === p.title)).map((p) => p.title)} value={part} onChange={(v) => set('part', v)} />
        <Select radius="xl" clearable placeholder={t('Any type')} data={kinds} value={kind} onChange={(v) => set('kind', v)} />
      </Group>
      <Text size="sm" c="dimmed">
        {t('{{count}} programs', { count: found.length })}
      </Text>
      <Stack gap="xs">
        {found.slice(0, limit).map((p) => (
          <ProgramRow key={p.id} program={p} />
        ))}
      </Stack>
      <ShowMore shown={limit} total={found.length} onMore={() => setLimit(limit + PAGE_SIZE)} />
    </Stack>
  );
}

function ProgramRow({ program }: { program: ProgramListing }) {
  return (
    <Card withBorder radius="md" padding="sm" component={Link} to={programLink(program.id)}>
      <Group justify="space-between" wrap="nowrap">
        <div style={{ minWidth: 0 }}>
          <Text fw={700} size="sm">
            {program.name}
          </Text>
          <Text size="xs" c="dimmed">
            {[program.unit, program.faculty].filter((v, i, all) => v && all.indexOf(v) === i).join(' · ')}
          </Text>
        </div>
        <Group gap={6} wrap="nowrap">
          <Badge variant="light" radius="sm">
            {program.kind}
          </Badge>
          {program.credits != null && (
            <Badge variant="outline" color="gray" radius="sm">
              {t('{{count}} credits', { count: program.credits })}
            </Badge>
          )}
        </Group>
      </Group>
    </Card>
  );
}

function ProgramPage({ id }: { id: string }) {
  const programs = usePrograms();
  const courses = useCourses();
  const guide = useGuide();
  const titles = useMemo(() => new Map(courses.data?.map((row) => [row[0], row])), [courses.data]);
  const sections = useMemo(() => new Map(guide.data?.map((s) => [s.key, s])), [guide.data]);
  const navigate = useNavigate();
  const select = useAction((programId: string) => rpc.degree.select({ programId }), { success: 'Set as your program' });
  if (!programs.data) return <Loading />;
  const program = programs.data.find((p) => p.id === id);
  if (!program) return <Empty>{t('That program is not in the catalogue.')}</Empty>;
  return (
    <Stack>
      <Crumbs items={[{ label: t('Programs'), to: '/catalogue/programs' }, { label: program.name }]} />
      <Group justify="space-between" align="flex-start">
        <div style={{ minWidth: 0, flex: 1 }}>
          <Title order={2}>{program.name}</Title>
          <Text c="dimmed" size="sm">
            {[program.unit, program.faculty].filter((v, i, all) => v && all.indexOf(v) === i).join(' · ')}
          </Text>
          <Group gap={6} mt={6}>
            <Badge variant="light" radius="sm">
              {program.kind}
            </Badge>
            {program.credits != null && (
              <Badge variant="outline" color="gray" radius="sm">
                {t('{{count}} credits', { count: program.credits })}
              </Badge>
            )}
            {program.degrees.map((degree) => (
              <Badge key={degree} variant="outline" color="gray" radius="sm" tt="none">
                {degree}
              </Badge>
            ))}
            <PageBadge page={program.page} />
          </Group>
        </div>
        <Button radius="xl" onClick={() => select.mutate(program.id, { onSuccess: () => navigate('/courses/degree') })} loading={select.isPending}>
          {t('Check my degree against this')}
        </Button>
      </Group>

      {program.prose.map((key) => {
        const section = sections.get(key);
        if (!section || !(section.points || section.facts || section.courses)) return null;
        return (
          <Paper key={key} withBorder radius="lg" p="md">
            <Group justify="space-between" mb={6}>
              <Text fw={700}>{section.title}</Text>
              <PageBadge page={section.page} />
            </Group>
            <SectionBody section={section} />
          </Paper>
        );
      })}

      {program.parts.length === 0 && (
        <Alert icon={<IconInfoCircle size={18} />} variant="light">
          {t('The catalogue lists no course tables for this program. See its page for how it is set up.')}
        </Alert>
      )}
      {program.parts.map((part) => (
        <Paper key={part.title} withBorder radius="lg" p="md">
          <Group justify="space-between" mb={6}>
            <Text fw={700}>{part.title}</Text>
            <Badge variant="light" color={part.kind === 'required' ? 'teal' : 'grape'} radius="sm">
              {part.kind === 'required' ? t('Required') : t('Choose')}
            </Badge>
          </Group>
          <Stack gap="sm">
            {part.lists.map((list, index) => (
              <div key={`${list.page}-${index}`}>
                {(list.label || list.rule) && (
                  <Text size="sm" fw={600} mb={4}>
                    {[list.label, list.rule].filter(Boolean).join(' · ')}
                  </Text>
                )}
                <Table.ScrollContainer minWidth={420}>
                  <Table verticalSpacing={4} horizontalSpacing="xs" striped>
                    <Table.Tbody>
                      {list.courses.map((code) => (
                        <Table.Tr key={code}>
                          <Table.Td w={110}>
                            <Anchor component={Link} to={courseLink(code)} size="sm" fw={600} style={{ whiteSpace: 'nowrap' }}>
                              {code}
                            </Anchor>
                          </Table.Td>
                          <Table.Td>
                            <Text size="sm">{titles.get(code)?.[1]}</Text>
                          </Table.Td>
                          <Table.Td w={40} ta="right">
                            <Text size="sm">{titles.get(code)?.[2]}</Text>
                          </Table.Td>
                        </Table.Tr>
                      ))}
                    </Table.Tbody>
                  </Table>
                </Table.ScrollContainer>
              </div>
            ))}
          </Stack>
        </Paper>
      ))}
    </Stack>
  );
}

function Crumbs({ items }: { items: { label: string; to?: string }[] }) {
  return (
    <Group gap={6}>
      {items.map((item, i) => (
        <Group key={item.label} gap={6}>
          {i > 0 && <Text size="sm" c="dimmed">/</Text>}
          {item.to ? (
            <Anchor component={Link} to={item.to} size="sm" c="dimmed" fw={600}>
              {item.label}
            </Anchor>
          ) : (
            <Text size="sm" fw={700} lineClamp={1}>
              {item.label}
            </Text>
          )}
        </Group>
      ))}
    </Group>
  );
}

// --- Courses ------------------------------------------------------------------------------------

// Memoized so scrolling only renders the new rows.
const CourseListRow = memo(function CourseListRow({ row: [code, title, credits] }: { row: CourseRow }) {
  return (
    <Table.Tr>
      <Table.Td w={120}>
        <Anchor component={Link} to={courseLink(code)} fw={700} size="sm" style={{ whiteSpace: 'nowrap' }}>
          {code}
        </Anchor>
      </Table.Td>
      <Table.Td>
        <Text size="sm">{title}</Text>
      </Table.Td>
      <Table.Td w={90} ta="right">
        {credits != null && <Text size="sm" c="dimmed" style={{ whiteSpace: 'nowrap' }}>{t('{{count}} credits', { count: credits })}</Text>}
      </Table.Td>
    </Table.Tr>
  );
});

function CourseList() {
  const [params, setParams] = useSearchParams();
  const courses = useCourses();
  const [limit, setLimit] = useState(PAGE_SIZE);
  const query = useDeferredValue((params.get('q') ?? '').trim().toLowerCase());
  const subject = params.get('subject');
  const level = params.get('level');
  const subjects = useMemo(() => [...new Set(courses.data?.map((row) => courseParts(row[0]).subject))].sort(), [courses.data]);
  const set = (key: string, value: string | null) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
    setLimit(PAGE_SIZE);
  };
  const found = useMemo(
    () =>
      (courses.data ?? []).filter(([code, title]) => {
    const parts = courseParts(code);
    return (!subject || parts.subject === subject) && (!level || parts.level === Number(level)) && (!query || has(code, query) || has(code.replace(' ', ''), query) || has(title, query));
  }),
    [courses.data, subject, level, query],
  );
  if (!courses.data) return <Loading />;
  return (
    <Stack>
      <Group align="flex-end">
        <TextInput style={{ flex: 1, minWidth: 220 }} radius="xl" leftSection={<IconSearch size={16} />} placeholder={t('Search by code or title')} value={params.get('q') ?? ''} onChange={(e) => set('q', e.currentTarget.value)} />
        <Select radius="xl" clearable searchable placeholder={t('Any subject')} data={subjects} value={subject} onChange={(v) => set('subject', v)} />
        <Select radius="xl" clearable placeholder={t('Any level')} data={['100', '200', '300', '400', '500', '600', '700'].map((value) => ({ value, label: t('{{level}} level', { level: value }) }))} value={level} onChange={(v) => set('level', v)} />
      </Group>
      <Text size="sm" c="dimmed">
        {t('{{count}} courses', { count: found.length })}
      </Text>
      <Paper withBorder radius="lg" p="xs">
        <Table.ScrollContainer minWidth={420}>
          <Table verticalSpacing={6} striped highlightOnHover>
            <Table.Tbody>
              {found.slice(0, limit).map((row) => (
                <CourseListRow key={row[0]} row={row} />
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      </Paper>
      <ShowMore shown={limit} total={found.length} onMore={() => setLimit(limit + PAGE_SIZE)} />
    </Stack>
  );
}

function CoursePage({ code }: { code: string }) {
  const courses = useCourses();
  const programs = usePrograms();
  const navigate = useNavigate();
  const row: CourseRow | undefined = courses.data?.find((c) => c[0] === code);
  const usedIn = useMemo(
    () => programs.data?.filter((p: CatalogueProgram) => p.parts.some((part) => part.lists.some((list) => list.courses.includes(code)))) ?? [],
    [programs.data, code],
  );
  const [limit, setLimit] = useState(PAGE_SIZE);
  const add = useAction(
    async () => {
      const { subject, number } = courseParts(code);
      const section = await rpc.catalogue.addCourse({ subject, number, title: row![1], credits: row![2] ?? 0, term: CURRENT_TERM });
      await rpc.classes.join({ classId: section.id });
      return section.id;
    },
    { success: 'Added to your courses', onSuccess: (classId) => navigate(`/classes/${classId}`) },
  );
  const plan = useAction(() => rpc.record.add({ code, title: row![1], credits: row![2] ?? 0, term: TERMS[TERMS.indexOf(CURRENT_TERM) + 1], status: 'planned', grade: null }), {
    success: 'Added to your plan',
    onSuccess: () => navigate('/courses/record'),
  });
  if (!courses.data) return <Loading />;
  if (!row) return <Empty>{t('That course is not in the catalogue.')}</Empty>;
  return (
    <Stack>
      <Crumbs items={[{ label: t('Courses'), to: '/catalogue/courses' }, { label: code }]} />
      <Group justify="space-between" align="flex-start">
        <div>
          <Title order={2}>{code}</Title>
          <Text>{row[1]}</Text>
          <Group gap={6} mt={6}>
            {row[2] != null && (
              <Badge variant="outline" color="gray" radius="sm">
                {t('{{count}} credits', { count: row[2] })}
              </Badge>
            )}
            <Badge variant="light" radius="sm">
              {t('{{level}} level', { level: courseParts(code).level })}
            </Badge>
          </Group>
        </div>
        <Group gap="xs">
          <Button radius="xl" variant="default" onClick={() => plan.mutate()} loading={plan.isPending}>
            {t('Plan it')}
          </Button>
          <Button radius="xl" onClick={() => add.mutate()} loading={add.isPending}>
            {t('Add to my courses')}
          </Button>
        </Group>
      </Group>
      <CourseFacts code={code} />
      <Paper withBorder radius="lg" p="md">
        <Text fw={700} mb={6}>
          {t('Programs that list it')} <Text span c="dimmed" size="sm">{usedIn.length}</Text>
        </Text>
        <Stack gap={4}>
          {usedIn.slice(0, limit).map((p) => (
            <Hit key={p.id} to={programLink(p.id)} title={p.name} sub={p.faculty} page={p.page} />
          ))}
        </Stack>
        <Group justify="center" mt="sm">
          <ShowMore shown={limit} total={usedIn.length} onMore={() => setLimit(limit + PAGE_SIZE)} />
        </Group>
      </Paper>
    </Stack>
  );
}

// --- Rules and guides ---------------------------------------------------------------------------

function GuideList() {
  const [params, setParams] = useSearchParams();
  const guide = useGuide();
  const index = useIndex();
  const [limit, setLimit] = useState(PAGE_SIZE);
  const part = params.get('part') ?? 'University Regulations';
  const query = (params.get('q') ?? '').trim().toLowerCase();
  const found = useMemo(
    () => guide.data?.filter((s) => !s.program && s.part === part && (!query || has(s.title, query) || s.points?.some((point) => has(point, query)))) ?? [],
    [guide.data, part, query],
  );
  const set = (key: string, value: string | null) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
    setLimit(PAGE_SIZE);
  };
  if (!guide.data || !index.data) return <Loading />;
  return (
    <Stack>
      <Group align="flex-end">
        <Select radius="xl" w={320} allowDeselect={false} data={index.data.parts.map((p) => p.title)} value={part} onChange={(v) => set('part', v)} />
        <TextInput style={{ flex: 1, minWidth: 220 }} radius="xl" leftSection={<IconSearch size={16} />} placeholder={t('Search this part')} value={params.get('q') ?? ''} onChange={(e) => set('q', e.currentTarget.value)} />
      </Group>
      <Stack gap="xs">
        {found.slice(0, limit).map((section) => (
          <GuideCard key={section.key} section={section} />
        ))}
      </Stack>
      <ShowMore shown={limit} total={found.length} onMore={() => setLimit(limit + PAGE_SIZE)} />
    </Stack>
  );
}

function GuideCard({ section }: { section: GuideSection }) {
  return (
    <Paper withBorder radius="md" p="sm" ml={Math.max(section.level - 1, 0) * 14}>
      <Group justify="space-between" wrap="nowrap" align="flex-start" gap="sm">
        <Anchor component={Link} to={guideLink(section.key)} fw={700} size={section.level === 1 ? 'md' : 'sm'} c="var(--mantine-color-text)">
          {section.title}
        </Anchor>
        <PageBadge page={section.page} />
      </Group>
      <SectionBody section={section} />
    </Paper>
  );
}

function GuidePage({ sectionKey }: { sectionKey: string }) {
  const guide = useGuide();
  if (!guide.data) return <Loading />;
  const at = guide.data.findIndex((s) => s.key === sectionKey);
  if (at < 0) return <Empty>{t('That section is not in the catalogue.')}</Empty>;
  const section = guide.data[at];
  // The headings under this one, up to the next at its level.
  const end = guide.data.findIndex((s, i) => i > at && s.level <= section.level);
  const within = guide.data.slice(at + 1, end < 0 ? undefined : end);
  return (
    <Stack>
      <Crumbs items={[{ label: t('Rules and guides'), to: `/catalogue/guide?part=${encodeURIComponent(section.part)}` }, { label: section.title }]} />
      <Paper withBorder radius="lg" p="md">
        <Group justify="space-between" wrap="nowrap" align="flex-start">
          <Title order={2}>{section.title}</Title>
          <PageBadge page={section.page} />
        </Group>
        <Text size="sm" c="dimmed" mb="xs">
          {section.part}
        </Text>
        <SectionBody section={section} />
      </Paper>
      {within.map((s) => (
        <GuideCard key={s.key} section={s} />
      ))}
    </Stack>
  );
}

// --- Awards ---------------------------------------------------------------------------------------

function AwardList() {
  const awards = useAwards();
  const guide = useGuide();
  const [query, setQuery] = useState('');
  const [faculty, setFaculty] = useState<string | null>(null);
  const [kind, setKind] = useState<string | null>(null);
  const [limit, setLimit] = useState(PAGE_SIZE);
  const sections = useMemo(() => new Map(guide.data?.map((s) => [s.key, s])), [guide.data]);
  if (!awards.data) return <Loading />;
  const q = query.trim().toLowerCase();
  const found = awards.data.filter((a: Award) => (!faculty || a.faculty === faculty) && (!kind || a.kind === kind) && (!q || has(a.name, q) || sections.get(a.key)?.points?.some((point) => has(point, q))));
  return (
    <Stack>
      <Group align="flex-end">
        <TextInput style={{ flex: 1, minWidth: 220 }} radius="xl" leftSection={<IconSearch size={16} />} placeholder={t('Search awards')} value={query} onChange={(e) => setQuery(e.currentTarget.value)} />
        <Select radius="xl" clearable placeholder={t('Any faculty')} data={[...new Set(awards.data.map((a) => a.faculty))].sort()} value={faculty} onChange={setFaculty} />
        <Select radius="xl" clearable placeholder={t('Any type')} data={[...new Set(awards.data.map((a) => a.kind))].sort()} value={kind} onChange={setKind} />
      </Group>
      <Text size="sm" c="dimmed">
        {t('{{count}} awards', { count: found.length })}
      </Text>
      <Stack gap="xs">
        {found.slice(0, limit).map((a) => {
          const section = sections.get(a.key);
          return (
            <Paper key={a.key} withBorder radius="md" p="sm">
              <Group justify="space-between" wrap="nowrap" align="flex-start" gap="sm">
                <Text fw={700} size="sm">
                  {a.name}
                </Text>
                <Group gap={6} wrap="nowrap">
                  <Badge variant="light" radius="sm">
                    {a.kind}
                  </Badge>
                  <PageBadge page={a.page} />
                </Group>
              </Group>
              {a.value && (
                <Text size="sm" fw={600} mt={2}>
                  {a.value}
                </Text>
              )}
              <Text size="xs" c="dimmed">
                {a.faculty}
              </Text>
              {section && <SectionBody section={section} />}
            </Paper>
          );
        })}
      </Stack>
      <ShowMore shown={limit} total={found.length} onMore={() => setLimit(limit + PAGE_SIZE)} />
    </Stack>
  );
}

// --- Dates and amounts ----------------------------------------------------------------------------

function DatesAndAmounts() {
  const guide = useGuide();
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [what, setWhat] = useState<string | null>('dates');
  const rows = useMemo(() => {
    const out: { label: string; order: number; section: GuideSection }[] = [];
    for (const section of guide.data ?? []) {
      if (what === 'dates') {
        for (const label of section.facts?.dates ?? []) {
          const date = parseCatalogueDate(label);
          // Dates from before this catalogue's year are history, like when a society was founded, so they come last.
          if (date) out.push({ label, order: dateOrder(date) + (date.year && date.year < 2026 ? 1e8 : 0), section });
        }
      } else {
        for (const label of section.facts?.money ?? []) {
          out.push({ label, order: -Number(label.replace(/[^\d.]/g, '')) || 0, section });
        }
      }
    }
    return out.sort((a, b) => a.order - b.order);
  }, [guide.data, what]);
  if (!guide.data) return <Loading />;
  const q = query.trim().toLowerCase();
  const found = rows.filter((r) => !q || has(r.label, q) || has(r.section.title, q) || has(r.section.part, q));
  return (
    <Stack>
      <Group align="flex-end">
        <TextInput style={{ flex: 1, minWidth: 220 }} radius="xl" leftSection={<IconSearch size={16} />} placeholder={t('Search by section or faculty')} value={query} onChange={(e) => setQuery(e.currentTarget.value)} />
        <Select radius="xl" allowDeselect={false} data={[{ value: 'dates', label: t('Dates') }, { value: 'money', label: t('Amounts') }]} value={what} onChange={(v) => { setWhat(v); setLimit(PAGE_SIZE); }} />
      </Group>
      <Paper withBorder radius="lg" p="xs">
        <Table.ScrollContainer minWidth={480}>
          <Table verticalSpacing={6} striped>
            <Table.Tbody>
              {found.slice(0, limit).map((r) => (
                <Table.Tr key={`${r.label}-${r.section.key}`}>
                  <Table.Td w={170}>
                    <Text fw={700} size="sm" style={{ whiteSpace: 'nowrap' }}>{r.label}</Text>
                  </Table.Td>
                  <Table.Td>
                    <Anchor component={Link} to={r.section.program ? programLink(r.section.program) : guideLink(r.section.key)} size="sm">
                      {r.section.title}
                    </Anchor>
                    <Text size="xs" c="dimmed">
                      {r.section.part}
                    </Text>
                  </Table.Td>
                  <Table.Td w={70} ta="right">
                    <PageBadge page={r.section.page} />
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      </Paper>
      <ShowMore shown={limit} total={found.length} onMore={() => setLimit(limit + PAGE_SIZE)} />
    </Stack>
  );
}

// --- Contacts -------------------------------------------------------------------------------------

function ContactList() {
  const [params, setParams] = useSearchParams();
  const contacts = useContacts();
  const [limit, setLimit] = useState(PAGE_SIZE);
  const query = (params.get('q') ?? '').trim().toLowerCase();
  if (!contacts.data) return <Loading />;
  const found = contacts.data.filter((c: Contact) => !query || has(c.unit, query) || has(c.section, query) || has(c.where, query) || c.address.some((l) => has(l, query)) || c.emails.some((e) => has(e, query)) || c.phones.some((p) => has(p, query)));
  return (
    <Stack>
      <TextInput radius="xl" leftSection={<IconSearch size={16} />} placeholder={t('Search offices, departments, emails and phone numbers')} value={params.get('q') ?? ''} onChange={(e) => { setParams(e.currentTarget.value ? { q: e.currentTarget.value } : {}, { replace: true }); setLimit(PAGE_SIZE); }} />
      <SimpleGrid cols={{ base: 1, md: 2 }}>
        {found.slice(0, limit).map((c) => (
          <Paper key={`${c.page}-${c.section}-${c.phones[0]}-${c.emails[0]}-${c.address[0]}`} withBorder radius="md" p="sm">
            <Group justify="space-between" wrap="nowrap" align="flex-start" gap="sm">
              <div style={{ minWidth: 0 }}>
                <Text fw={700} size="sm">
                  {c.unit ?? c.section}
                </Text>
                <Text size="xs" c="dimmed">
                  {c.where}
                </Text>
              </div>
              <PageBadge page={c.page} />
            </Group>
            {c.address.map((line) => (
              <Text key={line} size="sm">
                {line}
              </Text>
            ))}
            <Facts facts={{ phones: c.phones, emails: c.emails, links: c.links }} />
          </Paper>
        ))}
      </SimpleGrid>
      <ShowMore shown={limit} total={found.length} onMore={() => setLimit(limit + PAGE_SIZE)} />
    </Stack>
  );
}

// --- The catalogue's own table of contents -------------------------------------------------------

function ContentsList() {
  const [params, setParams] = useSearchParams();
  const contents = useContents();
  const guide = useGuide();
  const index = useIndex();
  const [limit, setLimit] = useState(PAGE_SIZE);
  const query = (params.get('q') ?? '').trim().toLowerCase();
  const found = useMemo(() => contents.data?.filter((entry) => !query || has(entry.title, query)) ?? [], [contents.data, query]);
  // An entry links to the program or section with its title on the same page.
  const links = useMemo(() => {
    const out = new Map<string, string>();
    for (const section of guide.data ?? []) if (!section.program) out.set(`${section.page}|${section.title}`, guideLink(section.key));
    for (const program of index.data?.programs ?? []) out.set(`${program.page}|${program.name}`, programLink(program.id));
    return out;
  }, [guide.data, index.data]);
  if (!contents.data) return <Loading />;
  return (
    <Stack>
      <TextInput
        radius="xl"
        leftSection={<IconSearch size={16} />}
        placeholder={t('Search the table of contents')}
        value={params.get('q') ?? ''}
        onChange={(e) => {
          const next = new URLSearchParams(params);
          if (e.currentTarget.value) next.set('q', e.currentTarget.value);
          else next.delete('q');
          setParams(next, { replace: true });
          setLimit(PAGE_SIZE);
        }}
      />
      {found.length === 0 && <Empty icon={<IconSearch size={22} />}>{t('Nothing in the catalogue matches that.')}</Empty>}
      <Paper withBorder radius="lg" p="md" hidden={found.length === 0}>
        <Stack gap={6}>
          {found.slice(0, limit).map((entry) => {
            const to = links.get(`${entry.page}|${entry.title}`);
            return (
              <Group key={`${entry.page}|${entry.depth}|${entry.title}`} justify="space-between" wrap="nowrap" gap="sm" ml={query ? 0 : entry.depth * 14}>
                {to ? (
                  <Anchor component={Link} to={to} size="sm" fw={entry.depth === 0 ? 700 : undefined}>
                    {entry.title}
                  </Anchor>
                ) : (
                  <Text size="sm" fw={entry.depth === 0 ? 700 : undefined}>
                    {entry.title}
                  </Text>
                )}
                <PageBadge page={entry.page} />
              </Group>
            );
          })}
        </Stack>
      </Paper>
      <ShowMore shown={limit} total={found.length} onMore={() => setLimit(limit + PAGE_SIZE)} />
    </Stack>
  );
}

// --- The page -------------------------------------------------------------------------------------

export function CataloguePage() {
  const { tab = 'overview', id } = useParams();
  const navigate = useNavigate();
  const known = TABS.some((item) => item.value === tab) ? tab : 'overview';
  return (
    <>
      <PageHeader title={t('Course Catalogue')} subtitle={t('McGill undergraduate and professional programs, courses and regulations, 2026–2027')} />
      {known === 'overview' && (
        <Alert icon={<IconInfoCircle size={18} />} variant="light" mb="md">
          {t('Facts come from the catalogue, and rules are summarized in our own words. The page numbers point to the official text, which has the last word.')}{' '}
          <Anchor component={Link} to={guideLink('1-about-this-publication')} size="sm">
            {t('About this publication')}
          </Anchor>
        </Alert>
      )}
      <Tabs value={known} onChange={(value) => navigate(value === 'overview' ? '/catalogue' : `/catalogue/${value}`)} mb="md" keepMounted={false}>
        <Tabs.List>
          {TABS.map((item) => (
            <Tabs.Tab key={item.value} value={item.value} leftSection={<item.icon size={16} />}>
              {t(item.label)}
            </Tabs.Tab>
          ))}
        </Tabs.List>
      </Tabs>
      {known === 'overview' && <Overview />}
      {known === 'programs' && (id ? <ProgramPage id={id} /> : <ProgramList />)}
      {known === 'courses' && (id ? <CoursePage code={id} /> : <CourseList />)}
      {known === 'guide' && (id ? <GuidePage sectionKey={id} /> : <GuideList />)}
      {known === 'awards' && <AwardList />}
      {known === 'dates' && <DatesAndAmounts />}
      {known === 'contacts' && <ContactList />}
      {known === 'contents' && <ContentsList />}
    </>
  );
}
