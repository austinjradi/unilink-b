import { useState } from 'react';
import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Card,
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
  TextInput,
  Title,
  Tooltip,
} from '@mantine/core';
import { useForm } from '@mantine/form';
import { IconAlertTriangle, IconCertificate, IconCircleCheck, IconDownload, IconListDetails, IconPencil, IconPlus, IconTrash } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import { OTHER_GRADES, RECORD_GRADES, RECORD_STATUSES, type RecordStatus, summarizeRecord, termOptions } from '@shared/academics';
import { CURRENT_TERM } from '@shared/dates';
import { letterFor } from '@shared/grades';
import { Empty, Loading, SectionCard } from '../components/ui';
import { useAction } from '../lib/hooks';
import { type Out, rpc } from '../lib/rpc';

type CourseRecord = Out<typeof rpc.record.list>[number];
type RecordDraft = { code: string; title: string; credits: number; term: string; status: RecordStatus; grade: string | null };

const STATUS_LABEL: Record<string, string> = {
  completed: 'Completed',
  'in-progress': 'In progress',
  planned: 'Planned',
  missing: 'Missing',
  'below-minimum': 'Below min. grade',
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
const GRADE_OPTIONS = RECORD_GRADES.map((g) => ({
  value: g,
  label: g in OTHER_GRADES ? `${g} (${OTHER_GRADES[g as keyof typeof OTHER_GRADES]})` : g,
}));

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
          Add course
        </Button>
      </Group>
      {tab === 'record' ? (
        <RecordTab onEdit={(record) => setEditing({ record, draft: record })} />
      ) : (
        <DegreeTab onPlan={(draft) => openNew(draft)} />
      )}
      <Modal opened={editing != null} onClose={() => setEditing(null)} title={editing?.record ? 'Edit course' : 'Add course'}>
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

function RecordTab({ onEdit }: { onEdit: (r: CourseRecord) => void }) {
  const records = useQuery({ queryKey: ['record'], queryFn: () => rpc.record.list() });
  const importClasses = useAction(() => rpc.record.importClasses(), {
    success: (r) => (r.added ? `Added ${r.added} current class${r.added === 1 ? '' : 'es'}` : 'Your current classes are already here'),
  });
  const remove = useAction((id: number) => rpc.record.remove({ id }));

  if (records.isPending || !records.data) return <Loading />;
  const summary = summarizeRecord(records.data);

  return (
    <Stack gap="lg">
      <SimpleGrid cols={{ base: 2, md: 4 }}>
        <Stat label="CGPA" value={summary.cgpa?.toFixed(2) ?? '—'} hint="Out of 4.00, from letter grades" />
        <Stat label="Credits earned" value={String(summary.creditsEarned)} />
        <Stat label="In progress" value={String(summary.creditsInProgress)} hint="credits" />
        <Stat label="Planned" value={String(summary.creditsPlanned)} hint="credits" />
      </SimpleGrid>

      <Group>
        <Button variant="light" leftSection={<IconDownload size={16} />} onClick={() => importClasses.mutate()}>
          Add my current classes
        </Button>
        <Text size="sm" c="dimmed">
          Adds the classes you've joined on UniLink as in-progress courses.
        </Text>
      </Group>

      {summary.terms.length === 0 ? (
        <Card withBorder>
          <Empty icon={<IconListDetails size={22} />}>
            Record the courses you've taken, are taking and plan to take. Your CGPA, credits and degree plan update
            automatically.
          </Empty>
        </Card>
      ) : (
        summary.terms.map((t) => (
          <SectionCard
            key={t.term}
            title={t.term}
            actions={
              <Text size="sm" c="dimmed">
                {t.totalCredits} credits{t.gpa != null ? ` · term GPA ${t.gpa.toFixed(2)}` : ''}
              </Text>
            }
          >
            <Table verticalSpacing="xs">
              <Table.Tbody>
                {records.data
                  .filter((r) => r.term === t.term)
                  .map((r) => (
                    <Table.Tr key={r.id}>
                      <Table.Td w={110} fw={600}>
                        {r.code}
                      </Table.Td>
                      <Table.Td>{r.title}</Table.Td>
                      <Table.Td w={90}>{r.credits} cr</Table.Td>
                      <Table.Td w={120}>
                        <Badge variant="light" color={STATUS_COLOR[r.status]}>
                          {STATUS_LABEL[r.status]}
                        </Badge>
                      </Table.Td>
                      <Table.Td w={170}>
                        {r.grade ? (
                          <Text fw={600}>{r.grade}</Text>
                        ) : r.currentAverage != null ? (
                          <Tooltip label="From the grades on this class's Grades tab">
                            <Text size="sm" c="dimmed">
                              now {r.currentAverage}% ({letterFor(r.currentAverage).letter})
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
                          <ActionIcon variant="subtle" onClick={() => onEdit(r)} aria-label="Edit">
                            <IconPencil size={16} />
                          </ActionIcon>
                          <ActionIcon variant="subtle" color="red" onClick={() => remove.mutate(r.id)} aria-label="Delete">
                            <IconTrash size={16} />
                          </ActionIcon>
                        </Group>
                      </Table.Td>
                    </Table.Tr>
                  ))}
              </Table.Tbody>
            </Table>
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
      code: (v) => (/^[A-Za-z]{4}\s*-?\s*\d{3}/.test(v.trim()) ? null : 'Use a course code like "COMP 251"'),
      grade: (v, values) => (values.status === 'completed' && !v ? 'Add the final grade' : null),
    },
  });
  const save = useAction(
    async (v: RecordDraft) => {
      const fields = { ...v, grade: v.status === 'completed' ? v.grade : null };
      if (record) await rpc.record.update({ id: record.id, ...fields });
      else await rpc.record.add(fields);
    },
    { success: record ? 'Course updated' : 'Course added', onSuccess: onDone },
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
          <TextInput label="Course code" placeholder="COMP 251" data-autofocus {...form.getInputProps('code')} onBlur={lookup} />
          <NumberInput label="Credits" min={0} max={12} step={0.5} decimalScale={1} {...form.getInputProps('credits')} />
        </Group>
        <TextInput label="Title" placeholder="Algorithms and Data Structures" {...form.getInputProps('title')} />
        <Select label="Term" data={TERMS} searchable allowDeselect={false} {...form.getInputProps('term')} />
        <SegmentedControl
          data={RECORD_STATUSES.map((s) => ({ value: s, label: STATUS_LABEL[s] }))}
          {...form.getInputProps('status')}
        />
        {form.values.status === 'completed' && (
          <Select label="Final grade" data={GRADE_OPTIONS} {...form.getInputProps('grade')} />
        )}
        <Group justify="flex-end">
          <Button type="submit" loading={save.isPending}>
            Save
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
          label="Your program"
          placeholder="Pick a program"
          w={360}
          data={programs.data?.map((p) => ({ value: p.id, label: `${p.name}, ${p.degree}` })) ?? []}
          value={data?.program.id ?? null}
          onChange={(v) => select.mutate(v)}
          clearable
        />
      </Group>
      <Alert variant="light" color="yellow" icon={<IconAlertTriangle size={18} />}>
        These are <b>sample programs</b> to show how degree planning works. They are not official McGill requirements.
        Real program data needs an import from the McGill eCalendar. Always confirm with your advisor or Minerva's
        degree evaluation.
      </Alert>

      {!data ? (
        <Card withBorder>
          <Empty icon={<IconCertificate size={22} />}>Pick a program to see which of your courses count and what's left.</Empty>
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
    e.missingCredits > 0 && `${e.missingCredits} credit${e.missingCredits === 1 ? '' : 's'} toward the total`,
    missingRequired > 0 && `${missingRequired} required course${missingRequired === 1 ? '' : 's'}`,
    missingChoose > 0 && `${missingChoose} complementary credit${missingChoose === 1 ? '' : 's'}`,
  ].filter(Boolean);

  return (
    <>
      <SectionCard
        title={`${program.name}, ${program.degree}`}
        actions={
          <Text size="sm" c="dimmed">
            {program.totalCredits} credits · program courses need {program.minProgramGrade} or better
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
              {STATUS_LABEL[s]}: {e.credits[s]} credits
            </Badge>
          ))}
          <Badge variant="dot" color="gray">
            Not yet planned: {e.missingCredits} credits
          </Badge>
        </Group>
        {e.graduated ? (
          <Alert color="teal" icon={<IconCircleCheck size={18} />}>All requirements are completed.</Alert>
        ) : e.planComplete ? (
          <Alert color="teal" icon={<IconCircleCheck size={18} />}>
            Your plan is complete: once you pass everything in progress and planned, you'll meet every requirement.
          </Alert>
        ) : (
          <Alert color="orange" icon={<IconAlertTriangle size={18} />}>
            Your plan still needs {gaps.join(', ')}. Use "Plan it" below to add courses to a future term.
          </Alert>
        )}
      </SectionCard>

      {e.groups.map((g) => {
        const counted = g.credits.completed + g.credits['in-progress'] + g.credits.planned;
        return (
          <SectionCard
            key={g.id}
            title={g.name}
            actions={
              <Group gap="xs">
                <Text size="sm" c="dimmed">
                  {g.kind === 'choose' ? `${Math.min(counted, g.neededCredits)} of ${g.neededCredits} credits` : `${g.courses.filter((c) => c.state !== 'missing' && c.state !== 'below-minimum').length} of ${g.courses.length} courses`}
                </Text>
                {g.coveredByPlan && <IconCircleCheck size={18} color="var(--mantine-color-teal-6)" />}
              </Group>
            }
          >
            {g.kind === 'choose' && (
              <Text size="sm" c="dimmed" mb="sm">
                Choose {g.neededCredits} credits from:
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
                          {c.code} <Text span size="xs" c="dimmed">· {c.credits} cr</Text>
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
                          Plan it
                        </Button>
                      ) : (
                        <Badge size="sm" variant="light" color={STATUS_COLOR[c.state]} style={{ flexShrink: 0 }}>
                          {STATUS_LABEL[c.state]}
                        </Badge>
                      )}
                    </Group>
                    {c.state === 'below-minimum' && (
                      <Text size="xs" c="red" mt={4}>
                        Grade below {program.minProgramGrade}: retake to count it
                      </Text>
                    )}
                  </Paper>
                );
              })}
            </SimpleGrid>
          </SectionCard>
        );
      })}

      <SectionCard title="Electives">
        <Text size="sm">
          {e.electiveCredits} credits from other courses count as electives toward the {program.totalCredits}-credit total.
        </Text>
      </SectionCard>
    </>
  );
}
