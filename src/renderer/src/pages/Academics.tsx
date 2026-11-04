import { type ReactNode, useState } from 'react';
import {
  ActionIcon,
  Alert,
  Anchor,
  Badge,
  Button,
  Card,
  Checkbox,
  Group,
  Modal,
  NumberInput,
  Paper,
  Progress,
  SegmentedControl,
  Select,
  SimpleGrid,
  Stack,
  Table,

  Text,
  Textarea,
  TextInput,
  Title,
  Tooltip,
} from '@mantine/core';
import { useForm } from '@mantine/form';
import { useLocalStorage } from '@mantine/hooks';
import { IconAlertTriangle, IconCertificate, IconCircleCheck, IconClipboardText, IconDownload, IconListDetails, IconPencil, IconPlus, IconTrash } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { goalOutlook, gpaTrend, OTHER_GRADES, RECORD_GRADES, RECORD_STATUSES, type RecordStatus, summarizeRecord, termOptions, termOrder } from '@shared/academics';
import { CURRENT_TERM } from '@shared/dates';
import { whyCantPlan } from '@shared/prereqs';
import { graduationPace } from '@shared/degree';
import { letterFor } from '@shared/grades';
import { parseTranscript } from '@shared/transcript';
import { GpaTrend } from '../components/GpaTrend';
import type { ReqTopicId } from '../lib/reqTopics';
import { Covered, Empty, Loading, SectionCard } from '../components/ui';
import { useAction, useMe } from '../lib/hooks';
import { type Out, rpc } from '../lib/rpc';
import { t, term, tx } from '../lib/i18n';
import { ReqInfo, WithInfo } from '../components/ReqInfo';
import { useVariant } from '../lib/variants';

type CourseRecord = Out<typeof rpc.record.list>[number];
type RecordDraft = { code: string; title: string; credits: number; term: string; status: RecordStatus; grade: string | null };

const STATUS_LABEL: Record<string, string> = {
  completed: tx('Completed'),
  'in-progress': tx('In progress'),
  planned: tx('Planned'),
  missing: tx('Missing'),
  'below-minimum': tx('Below min. grade'),
};
const STATUS_COLOR: Record<string, string> = {
  completed: 'teal',
  'in-progress': 'blue',
  planned: 'grape',
  missing: 'gray',
  'below-minimum': 'red',
};
const TERMS = termOptions(2020, 2031);
const NEXT_TERM = TERMS[TERMS.indexOf(CURRENT_TERM) + 1];
const gradeOptions = () =>
  RECORD_GRADES.map((g) => ({
    value: g,
    label: g in OTHER_GRADES ? `${g} (${t(OTHER_GRADES[g as keyof typeof OTHER_GRADES])})` : g,
  }));
const termOptionsData = () => TERMS.map((value) => ({ value, label: term(value) }));

// 'planned-no-term': a course planned for no term in particular.
const NO_TERM = 'Fall 2099';
const termName = (value: string) => (value === NO_TERM ? 'No term yet' : term(value));

// 'gpa-table': the same numbers as the chart.
function GpaTable({ points }: { points: ReturnType<typeof gpaTrend> }) {
  if (points.length < 2) return null;
  return (
    <Table withTableBorder fz="sm" verticalSpacing={4}>
      <Table.Thead>
        <Table.Tr>
          <Table.Th>
            <WithInfo id="gpa-trend">{t('Term')}</WithInfo>
          </Table.Th>
          <Table.Th>{t('Term GPA')}</Table.Th>
          <Table.Th>{t('CGPA')}</Table.Th>
        </Table.Tr>
      </Table.Thead>
      <Table.Tbody>
        {points.map((p) => (
          <Table.Tr key={p.term}>
            <Table.Td>{term(p.term)}</Table.Td>
            <Table.Td>{p.gpa.toFixed(2)}</Table.Td>
            <Table.Td>{p.cgpa.toFixed(2)}</Table.Td>
          </Table.Tr>
        ))}
      </Table.Tbody>
    </Table>
  );
}

// 'record-flat-list': everything in one table, sorted by the column you pick.
function FlatRecord({ records, onEdit }: { records: CourseRecord[]; onEdit: (record: CourseRecord) => void }) {
  const locked = useVariant('lock-completed');
  const [sort, setSort] = useState<'code' | 'title' | 'credits' | 'term' | 'status' | 'grade'>('term');
  const rows = [...records].sort((a, b) => String(a[sort] ?? '').localeCompare(String(b[sort] ?? ''), undefined, { numeric: true }));
  const head = (key: typeof sort, label: string) => (
    <Table.Th onClick={() => setSort(key)} style={{ cursor: 'pointer' }} fw={sort === key ? 800 : 600}>
      {label}
    </Table.Th>
  );
  return (
    <Table.ScrollContainer minWidth={640}>
      <Table verticalSpacing="xs" highlightOnHover>
        <Table.Thead>
          <Table.Tr>
            {head('code', t('Course code'))}
            {head('title', t('Title'))}
            {head('credits', t('Credits'))}
            {head('term', t('Term'))}
            {head('status', 'Status')}
            {head('grade', t('Final grade'))}
            <Table.Th>
              <ReqInfo id="record-term" />
            </Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {rows.map((r) => (
            <Table.Tr key={r.id}>
              <Table.Td fw={600}>{r.code}</Table.Td>
              <Table.Td>{r.title}</Table.Td>
              <Table.Td>{r.credits}</Table.Td>
              <Table.Td>{termName(r.term)}</Table.Td>
              <Table.Td>{t(STATUS_LABEL[r.status])}</Table.Td>
              <Table.Td>{r.grade ?? '—'}</Table.Td>
              <Table.Td>
                {!(locked && r.status === 'completed') && (
                  <ActionIcon variant="subtle" onClick={() => onEdit(r)} aria-label={t('Edit')}>
                    <IconPencil size={16} />
                  </ActionIcon>
                )}
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Table.ScrollContainer>
  );
}

// 'suggest-term-schedule': what's left, five courses a term from next term on.
function SuggestedSchedule({ result, onPlan }: { result: NonNullable<Out<typeof rpc.degree.evaluate>>; onPlan: (d: Partial<RecordDraft>) => void }) {
  const { evaluation: e, titles } = result;
  const open = e.groups.flatMap((g) => (g.kind === 'choose' && g.coveredByPlan ? [] : g.courses.filter((c) => c.state === 'missing' || c.state === 'below-minimum')));
  const unique = [...new Map(open.map((c) => [c.code, c])).values()];
  if (!unique.length) return null;
  const terms = TERMS.slice(TERMS.indexOf(NEXT_TERM)).filter((name) => !name.startsWith('Summer'));
  const plan = terms.map((name, i) => ({ name, courses: unique.slice(i * 5, (i + 1) * 5) })).filter((row) => row.courses.length);
  return (
    <SectionCard info="degree-pace" title="A suggested schedule">
      <Stack gap="sm">
        {plan.map((row) => (
          <div key={row.name}>
            <Text size="sm" fw={800}>
              {term(row.name)}
            </Text>
            <Group gap={6}>
              {row.courses.map((c) => (
                <Button key={c.code} size="compact-xs" variant="light" title={titles[c.code]} onClick={() => onPlan({ code: c.code, title: titles[c.code] ?? '', credits: c.credits, term: row.name, status: 'planned' })}>
                  {c.code}
                </Button>
              ))}
            </Group>
          </div>
        ))}
      </Stack>
    </SectionCard>
  );
}

// A1 course record / A2 degree plan, shown as tabs of the Courses page.
export function AcademicsPanel({ tab }: { tab: 'record' | 'degree' }) {
  const noRecord = useVariant('no-course-record');
  const [editing, setEditing] = useState<{ record: CourseRecord | null; draft: RecordDraft } | null>(null);

  const openNew = (draft?: Partial<RecordDraft>) =>
    setEditing({
      record: null,
      draft: { code: '', title: '', credits: 3, term: CURRENT_TERM, status: 'planned', grade: null, ...draft },
    });

  return (
    <>
      <Group justify="flex-end" mb="md" display={noRecord ? 'none' : undefined}>
        <WithInfo id="record-add">
          <Button leftSection={<IconPlus size={16} />} onClick={() => openNew()}>
            {t('Add course')}
          </Button>
        </WithInfo>
      </Group>
      {tab === 'record' && noRecord ? (
        <Card withBorder>
          <Text mb="sm">
            Minerva keeps your official record. <ReqInfo id="record-add" />
          </Text>
          <Button component="a" href="https://horizon.mcgill.ca/" target="_blank" rel="noopener noreferrer" variant="default">
            Open Minerva
          </Button>
        </Card>
      ) : tab === 'record' ? (
        <RecordTab onEdit={(record) => setEditing({ record, draft: record })} />
      ) : (
        <DegreeTab onPlan={(draft) => openNew(draft)} />
      )}
      <Modal opened={editing != null} onClose={() => setEditing(null)} title={editing?.record ? <WithInfo id="record-edit">{t('Edit course')}</WithInfo> : <WithInfo id="record-add">{t('Add course')}</WithInfo>}>
        {editing && <RecordForm key={editing.record?.id ?? editing.draft.code} {...editing} onDone={() => setEditing(null)} />}
      </Modal>
    </>
  );
}

// --- A1 ---------------------------------------------------------------------------

function Stat({ label, value, hint, info }: { label: string; value: ReactNode; hint?: string; info: ReqTopicId }) {
  return (
    <Paper withBorder p="md">
      <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
        {label} <ReqInfo id={info} />
      </Text>
      <Title order={2}>{value}</Title>
      {hint && (
        <Text size="xs" c="dimmed">
          {hint}
        </Text>
      )}
    </Paper>
  );
}

// A1: paste the unofficial transcript from Minerva (or any list of courses under term
// headings), check what was found, and add it to the record.
function TranscriptImport({ records, onDone }: { records: CourseRecord[]; onDone: () => void }) {
  const [text, setText] = useState('');
  const [unchecked, setUnchecked] = useState<Set<number>>(new Set());
  const found = parseTranscript(text);
  const already = (code: string, termName: string) => records.some((r) => r.code === code && r.term === termName);
  const statusOf = (termName: string, grade: string | null): RecordStatus =>
    grade || termOrder(termName) < termOrder(CURRENT_TERM) ? 'completed' : termOrder(termName) === termOrder(CURRENT_TERM) ? 'in-progress' : 'planned';
  const picked = found.filter((c, n) => !unchecked.has(n) && !already(c.code, c.term));

  const add = useAction(
    async () => {
      const failed: string[] = [];
      for (const c of picked) {
        try {
          await rpc.record.add({ code: c.code, title: c.title, credits: c.credits, term: c.term, status: statusOf(c.term, c.grade), grade: c.grade });
        } catch {
          failed.push(c.code);
        }
      }
      return { added: picked.length - failed.length, failed };
    },
    {
      success: (r) =>
        [t('Added {{count}} courses to your record', { count: r.added }), r.failed.length ? t('Not added: {{titles}}', { titles: r.failed.join(', ') }) : '']
          .filter(Boolean)
          .join(' '),
      onSuccess: (r) => !r.failed.length && onDone(),
    },
  );

  return (
    <Stack>
      <Text size="sm" c="dimmed">
        {t('On Minerva, open your unofficial transcript, select the terms and courses, and paste them here. Each course line under a term heading like "Fall 2025" is read; you pick what to add.')} <ReqInfo id="record-paste" />
      </Text>
      <Textarea
        label={<WithInfo id="record-paste">{t('Transcript')}</WithInfo>}
        placeholder={'Fall 2025\nCOMP 202  Foundations of Programming  3  A  B+'}
        autosize
        minRows={5}
        maxRows={12}
        value={text}
        onChange={(e) => {
          setText(e.currentTarget.value);
          setUnchecked(new Set());
        }}
      />
      {text.trim() && (
        <Text size="sm" fw={700}>
          {found.length ? t('Found {{count}} courses', { count: found.length }) : t('No courses found yet. Put a term like "Fall 2025" above its courses.')}
        </Text>
      )}
      {found.map((c, n) => {
        const there = already(c.code, c.term);
        return (
          <Group key={n} gap="sm" wrap="nowrap">
            <Checkbox
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
              aria-label={c.code}
            />
            <Text size="sm" fw={700} w={90} style={{ flex: 'none' }}>
              {c.code}
            </Text>
            <Text size="sm" style={{ flex: 1, minWidth: 0 }} truncate>
              {c.title}
            </Text>
            <Text size="sm" c="dimmed" style={{ whiteSpace: 'nowrap' }}>
              {term(c.term)} · {t('{{credits}} cr', { credits: c.credits })}
              {c.creditsGuessed && '?'}
            </Text>
            {there ? (
              <Badge size="sm" variant="light" color="gray">
                {t('Already added')}
              </Badge>
            ) : (
              <Badge size="sm" variant="light" color={c.grade ? 'teal' : 'gray'}>
                {c.grade ?? t(STATUS_LABEL[statusOf(c.term, null)])}
              </Badge>
            )}
          </Group>
        );
      })}
      <Group justify="flex-end">
        <Button onClick={() => add.mutate()} disabled={!picked.length} loading={add.isPending}>
          {t('Add {{count}} courses', { count: picked.length })}
        </Button>
      </Group>
    </Stack>
  );
}

// A1: type the CGPA you're aiming for and see what the courses still to come have to average.
function CgpaGoal({ summary }: { summary: ReturnType<typeof summarizeRecord> }) {
  const saved = useQuery({ queryKey: ['record', 'goal'], queryFn: () => rpc.record.goal() });
  if (!saved.data) return null;
  return <CgpaGoalForm summary={summary} saved={saved.data.goal} />;
}

function CgpaGoalForm({ summary, saved }: { summary: ReturnType<typeof summarizeRecord>; saved: number | null }) {
  const [goal, setGoal] = useState<number | string>(saved ?? '');
  const remaining = summary.creditsInProgress + summary.creditsPlanned;
  const [credits, setCredits] = useState<number | string>(remaining || 15);
  const save = useAction((value: number | null) => rpc.record.setGoal({ goal: value }));
  const target = typeof goal === 'number' && goal >= 0 && goal <= 4 ? goal : null;
  const over = typeof credits === 'number' && credits > 0 ? credits : null;
  const outlook = target != null && over != null ? goalOutlook(summary, target, over) : null;

  return (
    <SectionCard info="cgpa-goal" title={t('CGPA goal')}>
      <Group align="flex-start" gap="lg">
        <NumberInput
          w={130}
          label={t('Your goal')}
          placeholder="3.70"
          min={0}
          max={4}
          step={0.1}
          decimalScale={2}
          value={goal}
          onChange={setGoal}
          onBlur={() => target !== saved && save.mutate(target)}
        />
        <NumberInput w={130} label={t('Over the next')} suffix={` ${t('credits')}`} min={1} max={200} value={credits} onChange={setCredits} />
        <Text size="sm" style={{ flex: '1 1 260px' }} mt={26} aria-live="polite">
          {!outlook && t('Enter the CGPA you’re aiming for to see what your next courses have to average.')}
          {outlook?.kind === 'safe' && t('You’re there, and the next {{count}} credits can’t take you below it.', { count: over! })}
          {outlook?.kind === 'keep' &&
            t('You’re there. Averaging {{average}} or better over the next {{count}} credits, about {{grade}}, keeps you there.', {
              average: outlook.average.toFixed(2),
              count: over!,
              grade: outlook.grade,
            })}
          {outlook?.kind === 'reach' &&
            t('You need a {{average}} average over the next {{count}} credits, about {{grade}}.', {
              average: outlook.average.toFixed(2),
              count: over!,
              grade: outlook.grade,
            })}
          {outlook?.kind === 'out-of-reach' && (
            <>
              {t('Even straight A’s over the next {{count}} credits would only get you to {{best}}.', { count: over!, best: outlook.best.toFixed(2) })}
              {outlook.creditsOfAs != null && ` ${t('Reaching {{goal}} would take about {{credits}} credits of A’s.', { goal: target!.toFixed(2), credits: outlook.creditsOfAs })}`}
            </>
          )}
        </Text>
      </Group>
    </SectionCard>
  );
}

function RecordTab({ onEdit }: { onEdit: (r: CourseRecord) => void }) {
  const newestFirst = useVariant('record-newest-first');
  const locked = useVariant('lock-completed');
  const officialOnly = useVariant('official-cgpa-only');
  const gpaAsTable = useVariant('gpa-table');
  const noGoal = useVariant('no-cgpa-goal');
  const syncClasses = useVariant('record-sync-classes');
  const flatList = useVariant('record-flat-list');
  const nothingUntilFinal = useVariant('record-now-after-final');
  const [officialCgpa, setOfficialCgpa] = useLocalStorage<number | string>({ key: 'unilink-official-cgpa', defaultValue: '' });
  const records = useQuery({ queryKey: ['record'], queryFn: () => rpc.record.list() });
  const importClasses = useAction(() => rpc.record.importClasses(), {
    success: (r) => (r.added ? t('Added {{count}} current classes', { count: r.added }) : t('Your current classes are already here')),
  });
  const remove = useAction((id: number) => rpc.record.remove({ id }));
  const [pasting, setPasting] = useState(false);

  if (records.isPending || !records.data) return <Loading />;
  const summary = summarizeRecord(records.data);

  return (
    <Stack gap="lg">
      <SimpleGrid cols={{ base: 2, md: 4 }}>
        <Stat info="record-cgpa" label={t('CGPA')} value={<Covered>{summary.cgpa?.toFixed(2) ?? '—'}</Covered>} hint={t('Out of 4.00, from letter grades')} />
        <Stat info="record-credits" label={t('Credits earned')} value={String(summary.creditsEarned)} />
        <Stat info="record-credits" label={t('In progress')} value={String(summary.creditsInProgress)} hint={t('credits')} />
        <Stat info="record-credits" label={t('Planned')} value={String(summary.creditsPlanned)} hint={t('credits')} />
      </SimpleGrid>

      {officialOnly ? (
        <NumberInput w={200} label={<WithInfo id="record-cgpa">Your official CGPA</WithInfo>} min={0} max={4} step={0.01} decimalScale={2} value={officialCgpa} onChange={setOfficialCgpa} />
      ) : gpaAsTable ? (
        <Covered>
          <GpaTable points={gpaTrend(summary.terms)} />
        </Covered>
      ) : (
        <Covered>
          <GpaTrend points={gpaTrend(summary.terms)} />
        </Covered>
      )}

      {!noGoal && <CgpaGoal summary={summary} />}

      <Group>
        {!syncClasses && (
          <>
            <WithInfo id="record-import-classes">
              <Button variant="light" leftSection={<IconDownload size={16} />} onClick={() => importClasses.mutate()}>
                {t('Add my current classes')}
              </Button>
            </WithInfo>
            <Text size="sm" c="dimmed">
              {t("Adds the classes you've joined on UniLink as in-progress courses.")}
            </Text>
          </>
        )}
        <WithInfo id="record-paste">
          <Button variant="default" leftSection={<IconClipboardText size={16} />} onClick={() => setPasting(true)}>
            {t('Paste a transcript')}
          </Button>
        </WithInfo>
      </Group>
      <Modal opened={pasting} onClose={() => setPasting(false)} title={<WithInfo id="record-paste">{t('Add courses from a transcript')}</WithInfo>} size="xl">
        {pasting && <TranscriptImport records={records.data} onDone={() => setPasting(false)} />}
      </Modal>

      {flatList && summary.terms.length > 0 ? (
        <FlatRecord records={records.data} onEdit={onEdit} />
      ) : summary.terms.length === 0 ? (
        <Card withBorder>
          <Empty icon={<IconListDetails size={22} />}>
            {t("Record the courses you've taken, are taking and plan to take. Your CGPA, credits and degree plan update automatically.")}
          </Empty>
        </Card>
      ) : (
        (newestFirst ? [...summary.terms].reverse() : summary.terms).map((termRow) => (
          <SectionCard
            key={termRow.term}
            info="record-term"
            title={termName(termRow.term)}
            actions={
              <Text size="sm" c="dimmed">
                {t('{{count}} credits', { count: termRow.totalCredits })}
                {termRow.gpa != null && !officialOnly && (
                  <>
                    {' · '}
                    <Covered>{t('term GPA {{gpa}}', { gpa: termRow.gpa.toFixed(2) })}</Covered>
                  </>
                )}
              </Text>
            }
          >
            <Table.ScrollContainer minWidth={640}>
              <Table verticalSpacing="xs">
                <Table.Tbody>
                  {records.data
                    .filter((r) => r.term === termRow.term)
                    .map((r) => (
                      <Table.Tr key={r.id}>
                        <Table.Td w={110} fw={600}>
                          {r.code}
                        </Table.Td>
                        <Table.Td>{r.title}</Table.Td>
                        <Table.Td w={90}>{t('{{credits}} cr', { credits: r.credits })}</Table.Td>
                        <Table.Td w={120}>
                          <WithInfo id="record-status">
                            <Badge variant="light" color={STATUS_COLOR[r.status]}>
                              {t(STATUS_LABEL[r.status])}
                            </Badge>
                          </WithInfo>
                        </Table.Td>
                        <Table.Td w={170}>
                          {r.grade ? (
                            <Text fw={600}>{r.grade}</Text>
                          ) : r.currentAverage != null && !nothingUntilFinal ? (
                            <Tooltip label={t("From the grades on this class's Grades tab")}>
                              <Text size="sm" c="dimmed">
                                {t('now {{average}}% ({{letter}})', { average: r.currentAverage, letter: letterFor(r.currentAverage).letter })} <ReqInfo id="record-now" />
                              </Text>
                            </Tooltip>
                          ) : (
                            <Text size="sm" c="dimmed">
                              —
                            </Text>
                          )}
                        </Table.Td>
                        <Table.Td w={80}>
                          <Group gap={4} justify="flex-end" wrap="nowrap">
                            {!(locked && r.status === 'completed') && (
                              <>
                                <ActionIcon variant="subtle" onClick={() => onEdit(r)} aria-label={t('Edit')}>
                                  <IconPencil size={16} />
                                </ActionIcon>
                                <ActionIcon variant="subtle" color="red" onClick={() => remove.mutate(r.id)} aria-label={t('Delete')}>
                                  <IconTrash size={16} />
                                </ActionIcon>
                              </>
                            )}
                            <ReqInfo id="record-edit" />
                          </Group>
                        </Table.Td>
                      </Table.Tr>
                    ))}
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>
          </SectionCard>
        ))
      )}
    </Stack>
  );
}

function RecordForm({ record, draft, onDone }: { record: CourseRecord | null; draft: RecordDraft; onDone: () => void }) {
  const fromTerm = useVariant('status-from-term');
  const noTerm = useVariant('planned-no-term');
  const asPercent = useVariant('grade-as-percentage');
  const statusFor = (name: string) => (termOrder(name) < termOrder(CURRENT_TERM) ? 'completed' : termOrder(name) === termOrder(CURRENT_TERM) ? 'in-progress' : 'planned') as RecordStatus;
  const form = useForm({
    initialValues: draft,
    validate: {
      code: (v) => (/^[A-Za-z]{4}\s*-?\s*\d{3}/.test(v.trim()) ? null : t('Use a course code like "COMP 251"')),
      grade: (v, values) => ((fromTerm ? statusFor(values.term) : values.status) === 'completed' && !v ? t('Add the final grade') : null),
    },
  });
  const save = useAction(
    async (v: RecordDraft) => {
      const status = fromTerm ? statusFor(v.term) : v.status;
      const fields = { ...v, status, grade: status === 'completed' ? v.grade : null };
      if (record) await rpc.record.update({ id: record.id, ...fields });
      else await rpc.record.add(fields);
    },
    { success: record ? t('Course updated') : t('Course added'), onSuccess: onDone },
  );

  // Fill in the title and credits from the catalogue when the code is known.
  const lookup = async () => {
    if (form.values.title) return;
    const found = await rpc.record.lookup({ code: form.values.code });
    if (found) form.setValues({ code: `${found.subject} ${found.number}`, title: found.title, credits: found.credits });
  };

  return (
    <form onSubmit={form.onSubmit((v) => save.mutate(v))}>
      <Stack>
        <Group grow align="flex-start">
          <TextInput label={<WithInfo id="record-code">{t('Course code')}</WithInfo>} placeholder="COMP 251" data-autofocus {...form.getInputProps('code')} onBlur={lookup} />
          <NumberInput label={<WithInfo id="record-code">{t('Credits')}</WithInfo>} min={0} max={12} step={0.5} decimalScale={1} {...form.getInputProps('credits')} />
        </Group>
        <TextInput label={<WithInfo id="record-code">{t('Title')}</WithInfo>} placeholder={t('Algorithms and Data Structures')} {...form.getInputProps('title')} />
        <Select label={<WithInfo id="record-term-field">{t('Term')}</WithInfo>} data={[...(noTerm ? [{ value: NO_TERM, label: 'No term yet' }] : []), ...termOptionsData()]} searchable allowDeselect={false} {...form.getInputProps('term')} />
        {!fromTerm && (
          <WithInfo id="record-status" block>
            <SegmentedControl
              data={RECORD_STATUSES.map((s) => ({ value: s, label: t(STATUS_LABEL[s]) }))}
              {...form.getInputProps('status')}
            />
          </WithInfo>
        )}
        {asPercent && (fromTerm ? statusFor(form.values.term) : form.values.status) === 'completed' && (
          <NumberInput label={<WithInfo id="record-grade">{t('Final grade')} (%)</WithInfo>} min={0} max={100} suffix="%" onChange={(v) => form.setFieldValue('grade', typeof v === 'number' ? letterFor(v).letter : null)} description={form.values.grade ? `Counts as ${form.values.grade}` : undefined} />
        )}
        {!asPercent && (fromTerm ? statusFor(form.values.term) : form.values.status) === 'completed' && (
          <Select label={<WithInfo id="record-grade">{t('Final grade')}</WithInfo>} data={gradeOptions()} {...form.getInputProps('grade')} />
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

// --- A2 ---------------------------------------------------------------------------

function DegreeTab({ onPlan }: { onPlan: (draft: Partial<RecordDraft>) => void }) {
  const linkOnly = useVariant('link-degree-audit');
  const programs = useQuery({ queryKey: ['degree', 'programs'], queryFn: () => rpc.degree.programs() });
  const result = useQuery({ queryKey: ['degree', 'evaluate'], queryFn: () => rpc.degree.evaluate() });
  const select = useAction((programId: string | null) => rpc.degree.select({ programId }));

  if (linkOnly) {
    return (
      <Card withBorder>
        <Text mb="sm">
          McGill's degree evaluation on Minerva says what's left for your degree. <ReqInfo id="tab-degree" />
        </Text>
        <Button component="a" href="https://horizon.mcgill.ca/" target="_blank" rel="noopener noreferrer" variant="default">
          Open Minerva
        </Button>
      </Card>
    );
  }
  if (result.isPending) return <Loading />;
  const data = result.data;

  return (
    <Stack gap="lg">
      <Group align="flex-end">
        <Select
          label={<WithInfo id="degree-program">{t('Your program')}</WithInfo>}
          placeholder={t('Pick a program')}
          w={480}
          searchable
          limit={60}
          data={programs.data?.map((p) => ({ value: p.id, label: p.id.startsWith('sample-') ? `${t(p.name)}, ${p.degree}` : p.name })) ?? []}
          value={data?.program.id ?? null}
          onChange={(v) => select.mutate(v)}
          clearable
        />
      </Group>
      {data && (!data.program.id.startsWith('sample-') ? (
        <Alert variant="light" icon={<IconAlertTriangle size={18} />}>
          {t("From the 2026–2027 Course Catalogue. Rules like \"at least 3 credits from each group\" count as one pool here, so treat this as a guide and check the program's page with your adviser.")}{' '}
          <Anchor component={Link} to={`/catalogue/programs/${encodeURIComponent(data.program.id)}`}>{t('See the program')}</Anchor>
        </Alert>
      ) : (
      <Alert variant="light" color="yellow" icon={<IconAlertTriangle size={18} />}>
        <b>{t('Sample programs.')}</b>{' '}
        {t("They show how degree planning works and are not official McGill requirements. Pick a real program from the list for the catalogue's own requirements. Always confirm with your advisor or Minerva's degree evaluation.")} <ReqInfo id="degree-sample" />
      </Alert>
      ))}

      {!data ? (
        <Card withBorder>
          <Empty icon={<IconCertificate size={22} />}>{t("Pick a program to see which of your courses count and what's left.")}</Empty>
        </Card>
      ) : (
        <DegreeResult result={data} onPlan={onPlan} />
      )}
    </Stack>
  );
}

function DegreeResult({ result, onPlan }: { result: NonNullable<Out<typeof rpc.degree.evaluate>>; onPlan: (d: Partial<RecordDraft>) => void }) {
  const checksPlans = useVariant('check-prereqs');
  const onlyLeft = useVariant('degree-only-left');
  const over15 = useVariant('warn-over-15');
  const paceLimit = over15 ? 15 : 18;
  const records = useQuery({ queryKey: ['record'], queryFn: () => rpc.record.list() });
  const cantPlan = (code: string) => (checksPlans ? whyCantPlan(code, NEXT_TERM, records.data ?? []) : null);
  const { program, evaluation: e, titles } = result;
  const suggest = useVariant('suggest-term-schedule');
  const gradYear = useMe().gradYear;
  const left = program.totalCredits - e.credits.completed - e.credits['in-progress'];
  const pace = gradYear != null && !e.graduated ? graduationPace(left, gradYear, CURRENT_TERM) : null;
  const pct = (n: number) => (n / program.totalCredits) * 100;
  const isOpen = (c: { state: string }) => c.state === 'missing' || c.state === 'below-minimum';
  const missingRequired = e.groups.filter((g) => g.kind === 'required').flatMap((g) => g.courses.filter(isOpen)).length;
  const missingChoose = e.groups
    .filter((g) => g.kind === 'choose')
    .reduce((n, g) => n + Math.max(0, g.neededCredits - g.credits.completed - g.credits['in-progress'] - g.credits.planned), 0);
  const gaps = [
    e.missingCredits > 0 && t('{{count}} credits toward the total', { count: e.missingCredits }),
    missingRequired > 0 && t('{{count}} required courses', { count: missingRequired }),
    missingChoose > 0 && t('{{count}} complementary credits', { count: missingChoose }),
  ].filter(Boolean);

  return (
    <>
      <SectionCard
        info="degree-result"
        title={`${t(program.name)}, ${program.degree}`}
        actions={
          <Text size="sm" c="dimmed">
            {t('{{count}} credits', { count: program.totalCredits })} ·{' '}
            {t('program courses need {{grade}} or better', { grade: program.minProgramGrade })}
          </Text>
        }
      >
        <Progress.Root size={22} mb="xs">
          <Progress.Section value={pct(e.credits.completed)} color="teal">
            <Progress.Label>{e.credits.completed}</Progress.Label>
          </Progress.Section>
          <Progress.Section value={pct(e.credits['in-progress'])} color="blue">
            <Progress.Label>{e.credits['in-progress']}</Progress.Label>
          </Progress.Section>
          <Progress.Section value={pct(e.credits.planned)} color="grape">
            <Progress.Label>{e.credits.planned}</Progress.Label>
          </Progress.Section>
        </Progress.Root>
        <Group gap="md" mb="md">
          {(['completed', 'in-progress', 'planned'] as const).map((s) => (
            <Badge key={s} variant="dot" color={STATUS_COLOR[s]}>
              {t('{{label}}: {{value}}', { label: { t: STATUS_LABEL[s] }, value: t('{{count}} credits', { count: e.credits[s] }) })}
            </Badge>
          ))}
          <Badge variant="dot" color="gray">
            {t('{{label}}: {{value}}', { label: { t: 'Not yet planned' }, value: t('{{count}} credits', { count: e.missingCredits }) })}
          </Badge>
          <ReqInfo id="record-credits" />
        </Group>
        {e.graduated ? (
          <Alert color="teal" icon={<IconCircleCheck size={18} />}>{t('All requirements are completed.')} <ReqInfo id="degree-status" /></Alert>
        ) : e.planComplete ? (
          <Alert color="teal" icon={<IconCircleCheck size={18} />}>
            {t("Your plan is complete: once you pass everything in progress and planned, you'll meet every requirement.")} <ReqInfo id="degree-status" />
          </Alert>
        ) : (
          <Alert color="orange" icon={<IconAlertTriangle size={18} />}>
            {t('Your plan still needs {{gaps}}. Use "Plan it" below to add courses to a future term.', { gaps: gaps.join(', ') })} <ReqInfo id="degree-status" />
          </Alert>
        )}
        {pace && gradYear != null && (
          <Text size="sm" mt="sm" c={pace.perTerm > paceLimit ? 'orange' : undefined}>
            {pace.terms
              ? t('{{count}} credits left after this term: about {{pace}} a term to graduate in {{year}}.', { count: left, pace: pace.perTerm, year: gradYear })
              : t('{{count}} credits left after this term, with none left before graduating in {{year}}.', { count: left, year: gradYear })}
            {pace.terms > 0 && pace.perTerm > paceLimit && ` ${over15 ? 'That’s more than 15 credits a term, so you may need summer courses or another term.' : t('That’s more than the usual 15 to 18, so you may need summer courses or another term.')}`} <ReqInfo id="degree-pace" />
          </Text>
        )}
      </SectionCard>

      {suggest && <SuggestedSchedule result={result} onPlan={onPlan} />}
      {e.groups.map((g) => {
        const counted = g.credits.completed + g.credits['in-progress'] + g.credits.planned;
        return (
          <SectionCard
            key={g.id}
            info="degree-group"
            title={t(g.name)}
            actions={
              <Group gap="xs">
                <Text size="sm" c="dimmed">
                  {g.kind === 'choose'
                    ? t('{{done}} of {{count}} credits', { done: Math.min(counted, g.neededCredits), count: g.neededCredits })
                    : t('{{done}} of {{count}} courses', {
                        done: g.courses.filter((c) => c.state !== 'missing' && c.state !== 'below-minimum').length,
                        count: g.courses.length,
                      })}
                </Text>
                {g.coveredByPlan && <IconCircleCheck size={18} color="var(--mantine-color-teal-6)" />}
              </Group>
            }
          >
            {g.kind === 'choose' && (
              <Text size="sm" c="dimmed" mb="sm">
                {t('Choose {{count}} credits from:', { count: g.neededCredits })}
              </Text>
            )}
            <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="xs">
              {g.courses.filter((c) => !onlyLeft || c.state === 'missing' || c.state === 'below-minimum').map((c) => {
                const open = c.state === 'missing' || c.state === 'below-minimum';
                return (
                  <Paper key={c.code} withBorder p="xs">
                    <Group justify="space-between" wrap="nowrap" gap="xs">
                      <div style={{ minWidth: 0 }}>
                        <Text size="sm" fw={600}>
                          {c.code}{' '}
                          <Text span size="xs" c="dimmed">
                            · {t('{{credits}} cr', { credits: c.credits })}
                          </Text>
                        </Text>
                        <Text size="xs" c="dimmed" truncate>
                          {titles[c.code] ?? ''}
                        </Text>
                      </div>
                      {open && !(g.kind === 'choose' && g.coveredByPlan) ? (
                        <WithInfo id="degree-plan-it">
                          <Button
                            size="compact-xs"
                            variant="light"
                            disabled={cantPlan(c.code) != null}
                            onClick={() =>
                              onPlan({ code: c.code, title: titles[c.code] ?? '', credits: c.credits, term: NEXT_TERM, status: 'planned' })
                            }
                          >
                            {t('Plan it')}
                          </Button>
                        </WithInfo>
                      ) : (
                        <WithInfo id="record-status">
                          <Badge size="sm" variant="light" color={STATUS_COLOR[c.state]} style={{ flexShrink: 0 }}>
                            {t(STATUS_LABEL[c.state])}
                          </Badge>
                        </WithInfo>
                      )}
                    </Group>
                    {open && cantPlan(c.code) && (
                      <Text size="xs" c="dimmed" mt={4}>
                        {cantPlan(c.code)}
                      </Text>
                    )}
                    {c.state === 'below-minimum' && (
                      <Text size="xs" c="red" mt={4}>
                        {t('Grade below {{grade}}: retake to count it', { grade: program.minProgramGrade })} <ReqInfo id="degree-below-min" />
                      </Text>
                    )}
                  </Paper>
                );
              })}
            </SimpleGrid>
          </SectionCard>
        );
      })}

      <SectionCard info="degree-electives" title={t('Electives')}>
        <Text size="sm">
          {t('{{count}} credits from other courses count as electives toward the {{total}}-credit total.', {
            count: e.electiveCredits,
            total: program.totalCredits,
          })}
        </Text>
      </SectionCard>
    </>
  );
}
