import { useState } from 'react';
import {
  ActionIcon,
  Alert,
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
import { IconAlertTriangle, IconCertificate, IconCircleCheck, IconClipboardText, IconDownload, IconListDetails, IconPencil, IconPlus, IconTrash } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import { OTHER_GRADES, RECORD_GRADES, RECORD_STATUSES, type RecordStatus, summarizeRecord, termOptions, termOrder } from '@shared/academics';
import { CURRENT_TERM } from '@shared/dates';
import { letterFor } from '@shared/grades';
import { parseTranscript } from '@shared/transcript';
import { Empty, Loading, SectionCard } from '../components/ui';
import { useAction } from '../lib/hooks';
import { type Out, rpc } from '../lib/rpc';
import { t, term, tx } from '../lib/i18n';

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

// A1 course record / A2 degree plan, shown as tabs of the Courses page.
export function AcademicsPanel({ tab }: { tab: 'record' | 'degree' }) {
  const [editing, setEditing] = useState<{ record: CourseRecord | null; draft: RecordDraft } | null>(null);

  const openNew = (draft?: Partial<RecordDraft>) =>
    setEditing({
      record: null,
      draft: { code: '', title: '', credits: 3, term: CURRENT_TERM, status: 'planned', grade: null, ...draft },
    });

  return (
    <>
      <Group justify="flex-end" mb="md">
        <Button leftSection={<IconPlus size={16} />} onClick={() => openNew()}>
          {t('Add course')}
        </Button>
      </Group>
      {tab === 'record' ? (
        <RecordTab onEdit={(record) => setEditing({ record, draft: record })} />
      ) : (
        <DegreeTab onPlan={(draft) => openNew(draft)} />
      )}
      <Modal opened={editing != null} onClose={() => setEditing(null)} title={editing?.record ? t('Edit course') : t('Add course')}>
        {editing && <RecordForm key={editing.record?.id ?? editing.draft.code} {...editing} onDone={() => setEditing(null)} />}
      </Modal>
    </>
  );
}

// --- A1 ---------------------------------------------------------------------------

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Paper withBorder p="md">
      <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
        {label}
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
        {t('On Minerva, open your unofficial transcript, select the terms and courses, and paste them here. Each course line under a term heading like "Fall 2025" is read; you pick what to add.')}
      </Text>
      <Textarea
        label={t('Transcript')}
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

function RecordTab({ onEdit }: { onEdit: (r: CourseRecord) => void }) {
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
        <Stat label={t('CGPA')} value={summary.cgpa?.toFixed(2) ?? '—'} hint={t('Out of 4.00, from letter grades')} />
        <Stat label={t('Credits earned')} value={String(summary.creditsEarned)} />
        <Stat label={t('In progress')} value={String(summary.creditsInProgress)} hint={t('credits')} />
        <Stat label={t('Planned')} value={String(summary.creditsPlanned)} hint={t('credits')} />
      </SimpleGrid>

      <Group>
        <Button variant="light" leftSection={<IconDownload size={16} />} onClick={() => importClasses.mutate()}>
          {t('Add my current classes')}
        </Button>
        <Text size="sm" c="dimmed">
          {t("Adds the classes you've joined on UniLink as in-progress courses.")}
        </Text>
        <Button variant="default" leftSection={<IconClipboardText size={16} />} onClick={() => setPasting(true)}>
          {t('Paste a transcript')}
        </Button>
      </Group>
      <Modal opened={pasting} onClose={() => setPasting(false)} title={t('Add courses from a transcript')} size="xl">
        {pasting && <TranscriptImport records={records.data} onDone={() => setPasting(false)} />}
      </Modal>

      {summary.terms.length === 0 ? (
        <Card withBorder>
          <Empty icon={<IconListDetails size={22} />}>
            {t("Record the courses you've taken, are taking and plan to take. Your CGPA, credits and degree plan update automatically.")}
          </Empty>
        </Card>
      ) : (
        summary.terms.map((termRow) => (
          <SectionCard
            key={termRow.term}
            title={term(termRow.term)}
            actions={
              <Text size="sm" c="dimmed">
                {t('{{count}} credits', { count: termRow.totalCredits })}
                {termRow.gpa != null && ` · ${t('term GPA {{gpa}}', { gpa: termRow.gpa.toFixed(2) })}`}
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
                          <Badge variant="light" color={STATUS_COLOR[r.status]}>
                            {t(STATUS_LABEL[r.status])}
                          </Badge>
                        </Table.Td>
                        <Table.Td w={170}>
                          {r.grade ? (
                            <Text fw={600}>{r.grade}</Text>
                          ) : r.currentAverage != null ? (
                            <Tooltip label={t("From the grades on this class's Grades tab")}>
                              <Text size="sm" c="dimmed">
                                {t('now {{average}}% ({{letter}})', { average: r.currentAverage, letter: letterFor(r.currentAverage).letter })}
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
                            <ActionIcon variant="subtle" onClick={() => onEdit(r)} aria-label={t('Edit')}>
                              <IconPencil size={16} />
                            </ActionIcon>
                            <ActionIcon variant="subtle" color="red" onClick={() => remove.mutate(r.id)} aria-label={t('Delete')}>
                              <IconTrash size={16} />
                            </ActionIcon>
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
  const form = useForm({
    initialValues: draft,
    validate: {
      code: (v) => (/^[A-Za-z]{4}\s*-?\s*\d{3}/.test(v.trim()) ? null : t('Use a course code like "COMP 251"')),
      grade: (v, values) => (values.status === 'completed' && !v ? t('Add the final grade') : null),
    },
  });
  const save = useAction(
    async (v: RecordDraft) => {
      const fields = { ...v, grade: v.status === 'completed' ? v.grade : null };
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
          <TextInput label={t('Course code')} placeholder="COMP 251" data-autofocus {...form.getInputProps('code')} onBlur={lookup} />
          <NumberInput label={t('Credits')} min={0} max={12} step={0.5} decimalScale={1} {...form.getInputProps('credits')} />
        </Group>
        <TextInput label={t('Title')} placeholder={t('Algorithms and Data Structures')} {...form.getInputProps('title')} />
        <Select label={t('Term')} data={termOptionsData()} searchable allowDeselect={false} {...form.getInputProps('term')} />
        <SegmentedControl
          data={RECORD_STATUSES.map((s) => ({ value: s, label: t(STATUS_LABEL[s]) }))}
          {...form.getInputProps('status')}
        />
        {form.values.status === 'completed' && (
          <Select label={t('Final grade')} data={gradeOptions()} {...form.getInputProps('grade')} />
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
  const programs = useQuery({ queryKey: ['degree', 'programs'], queryFn: () => rpc.degree.programs() });
  const result = useQuery({ queryKey: ['degree', 'evaluate'], queryFn: () => rpc.degree.evaluate() });
  const select = useAction((programId: string | null) => rpc.degree.select({ programId }));

  if (result.isPending) return <Loading />;
  const data = result.data;

  return (
    <Stack gap="lg">
      <Group align="flex-end">
        <Select
          label={t('Your program')}
          placeholder={t('Pick a program')}
          w={360}
          data={programs.data?.map((p) => ({ value: p.id, label: `${t(p.name)}, ${p.degree}` })) ?? []}
          value={data?.program.id ?? null}
          onChange={(v) => select.mutate(v)}
          clearable
        />
      </Group>
      <Alert variant="light" color="yellow" icon={<IconAlertTriangle size={18} />}>
        <b>{t('Sample programs.')}</b>{' '}
        {t("They show how degree planning works and are not official McGill requirements. Real program data needs an import from the McGill eCalendar. Always confirm with your advisor or Minerva's degree evaluation.")}
      </Alert>

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
  const { program, evaluation: e, titles } = result;
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
        </Group>
        {e.graduated ? (
          <Alert color="teal" icon={<IconCircleCheck size={18} />}>{t('All requirements are completed.')}</Alert>
        ) : e.planComplete ? (
          <Alert color="teal" icon={<IconCircleCheck size={18} />}>
            {t("Your plan is complete: once you pass everything in progress and planned, you'll meet every requirement.")}
          </Alert>
        ) : (
          <Alert color="orange" icon={<IconAlertTriangle size={18} />}>
            {t('Your plan still needs {{gaps}}. Use "Plan it" below to add courses to a future term.', { gaps: gaps.join(', ') })}
          </Alert>
        )}
      </SectionCard>

      {e.groups.map((g) => {
        const counted = g.credits.completed + g.credits['in-progress'] + g.credits.planned;
        return (
          <SectionCard
            key={g.id}
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
              {g.courses.map((c) => {
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
                        <Button
                          size="compact-xs"
                          variant="light"
                          onClick={() =>
                            onPlan({ code: c.code, title: titles[c.code] ?? '', credits: c.credits, term: NEXT_TERM, status: 'planned' })
                          }
                        >
                          {t('Plan it')}
                        </Button>
                      ) : (
                        <Badge size="sm" variant="light" color={STATUS_COLOR[c.state]} style={{ flexShrink: 0 }}>
                          {t(STATUS_LABEL[c.state])}
                        </Badge>
                      )}
                    </Group>
                    {c.state === 'below-minimum' && (
                      <Text size="xs" c="red" mt={4}>
                        {t('Grade below {{grade}}: retake to count it', { grade: program.minProgramGrade })}
                      </Text>
                    )}
                  </Paper>
                );
              })}
            </SimpleGrid>
          </SectionCard>
        );
      })}

      <SectionCard title={t('Electives')}>
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
