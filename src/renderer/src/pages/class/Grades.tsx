import { useState } from 'react';
import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Grid,
  Group,
  Modal,
  NumberInput,
  Progress,
  Select,
  SimpleGrid,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { DateTimePicker } from '@mantine/dates';
import { useForm } from '@mantine/form';
import { IconAlertTriangle, IconPencil, IconPlus, IconTrash } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import { letterFor, MCGILL_SCALE, minimumFor, summarize } from '@shared/grades';
import { Empty, Loading, SectionCard } from '../../components/ui';
import { fmtDateTime, toDate } from '../../lib/format';
import { useAction } from '../../lib/hooks';
import { type Out, rpc } from '../../lib/rpc';

type Assessment = Out<typeof rpc.courses.assessments>[number];

// A5 grading scheme + grades, and the A4 grade calculator on top of it.
export function Grades({ classId }: { classId: number }) {
  const items = useQuery({ queryKey: ['courses', 'assessments', classId], queryFn: () => rpc.courses.assessments({ classId }) });
  const info = useQuery({ queryKey: ['courses', 'info', classId], queryFn: () => rpc.courses.info({ classId }) });
  const [editing, setEditing] = useState<Assessment | 'new' | null>(null);
  const remove = useAction((id: number) => rpc.courses.removeAssessment({ id }));

  if (items.isPending || !items.data || !info.data) return <Loading />;
  const summary = summarize(items.data);

  return (
    <Grid gap="lg">
      <Grid.Col span={{ base: 12, lg: 7 }}>
        <SectionCard
          title="Grading scheme"
          actions={
            <Button size="xs" variant="light" leftSection={<IconPlus size={14} />} onClick={() => setEditing('new')}>
              Add assessment
            </Button>
          }
        >
          {items.data.length ? (
            <>
              <Table verticalSpacing="xs">
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Assessment</Table.Th>
                    <Table.Th>Weight</Table.Th>
                    <Table.Th>Your grade</Table.Th>
                    <Table.Th>Due</Table.Th>
                    <Table.Th />
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {items.data.map((a) => (
                    <Table.Tr key={a.id}>
                      <Table.Td fw={500}>{a.name}</Table.Td>
                      <Table.Td>{a.weight}%</Table.Td>
                      <Table.Td>
                        {a.score == null ? (
                          <Text size="sm" c="dimmed">
                            not graded
                          </Text>
                        ) : (
                          <Group gap={6}>
                            {a.score}%<Badge size="xs" variant="light">{letterFor(a.score).letter}</Badge>
                          </Group>
                        )}
                      </Table.Td>
                      <Table.Td>
                        <Text size="sm" c="dimmed">
                          {a.dueAt ? fmtDateTime(a.dueAt) : '—'}
                        </Text>
                      </Table.Td>
                      <Table.Td>
                        <Group gap={4} justify="flex-end" wrap="nowrap">
                          <ActionIcon variant="subtle" onClick={() => setEditing(a)} aria-label="Edit">
                            <IconPencil size={16} />
                          </ActionIcon>
                          <ActionIcon variant="subtle" color="red" onClick={() => remove.mutate(a.id)} aria-label="Delete">
                            <IconTrash size={16} />
                          </ActionIcon>
                        </Group>
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
              {summary.totalWeight !== 100 && (
                <Alert mt="md" color="yellow" variant="light" icon={<IconAlertTriangle size={18} />}>
                  Weights add up to {summary.totalWeight}%, not 100%. Grades are scaled to what's entered.
                </Alert>
              )}
            </>
          ) : (
            <Empty>
              Add each assessment from the syllabus with its weight (e.g. "Midterm, 30%"). Fill in your grade as marks come
              back. Due dates show up on your calendar.
            </Empty>
          )}
        </SectionCard>
      </Grid.Col>

      <Grid.Col span={{ base: 12, lg: 5 }}>
        <Stack gap="lg">
          <Standing summary={summary} />
          <Calculator classId={classId} summary={summary} target={info.data.targetGrade} />
        </Stack>
      </Grid.Col>

      <AssessmentModal classId={classId} editing={editing} onClose={() => setEditing(null)} />
    </Grid>
  );
}

function Standing({ summary }: { summary: ReturnType<typeof summarize> }) {
  const graded = summary.totalWeight ? (summary.gradedWeight / summary.totalWeight) * 100 : 0;
  return (
    <SectionCard title="Where you stand">
      <SimpleGrid cols={2} mb="md">
        <div>
          <Text size="xs" c="dimmed">
            Average so far
          </Text>
          <Title order={2}>
            {summary.currentAverage == null ? '—' : `${summary.currentAverage}%`}{' '}
            {summary.currentAverage != null && (
              <Badge size="lg" variant="light">
                {letterFor(summary.currentAverage).letter}
              </Badge>
            )}
          </Title>
        </div>
        <div>
          <Text size="xs" c="dimmed">
            Final grade range
          </Text>
          <Title order={3}>
            {summary.worstFinal}% – {summary.bestFinal}%
          </Title>
        </div>
      </SimpleGrid>
      <Text size="xs" c="dimmed" mb={4}>
        {summary.gradedWeight}% of the course graded
      </Text>
      <Progress value={graded} />
    </SectionCard>
  );
}

function Calculator({ classId, summary, target }: { classId: number; summary: ReturnType<typeof summarize>; target: string }) {
  const setTarget = useAction((targetGrade: string) => rpc.courses.setTarget({ classId, targetGrade }));
  const goal = summary.requirements.find((r) => r.letter === target);
  const nothingLeft = summary.remainingWeight <= 0;

  let verdict: string;
  if (!summary.totalWeight) verdict = 'Add your grading scheme to use the calculator.';
  else if (!goal || goal.status === 'secured')
    verdict = `You've already secured at least ${/^A/.test(target) ? 'an' : 'a'} ${target}, even with 0% on what's left.`;
  else if (goal.status === 'out-of-reach')
    verdict = nothingLeft ? `Everything is graded, and the final grade is below ${minimumFor(target)}%.` : `Even 100% on the remaining ${summary.remainingWeight}% won't reach ${minimumFor(target)}%.`;
  else verdict = `You need an average of ${goal.needed}% on the remaining ${summary.remainingWeight}% of the course.`;

  return (
    <SectionCard title="Grade calculator">
      <Group align="flex-end" mb="md">
        <Select
          label="Target grade"
          data={MCGILL_SCALE.filter((g) => g.min > 0).map((g) => ({ value: g.letter, label: `${g.letter} (${g.min}%+)` }))}
          value={target}
          onChange={(v) => v && setTarget.mutate(v)}
          allowDeselect={false}
          w={160}
        />
      </Group>
      <Alert variant="light" color={goal?.status === 'out-of-reach' ? 'red' : goal?.status === 'secured' ? 'teal' : 'indigo'} mb="md">
        {verdict}
      </Alert>
      {summary.totalWeight > 0 && !nothingLeft && (
        <Table fz="sm" verticalSpacing={4}>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>McGill grade</Table.Th>
              <Table.Th ta="right">Needed on the rest</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {summary.requirements.map((r) => (
              <Table.Tr key={r.letter} fw={r.letter === target ? 700 : undefined}>
                <Table.Td>
                  {r.letter} ({minimumFor(r.letter)}%+)
                </Table.Td>
                <Table.Td ta="right" c={r.status === 'out-of-reach' ? 'red' : r.status === 'secured' ? 'teal' : undefined}>
                  {r.status === 'secured' ? 'secured' : r.status === 'out-of-reach' ? 'out of reach' : `${r.needed}%`}
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}
    </SectionCard>
  );
}

function AssessmentModal({ classId, editing, onClose }: { classId: number; editing: Assessment | 'new' | null; onClose: () => void }) {
  const existing = editing && editing !== 'new' ? editing : null;
  return (
    <Modal opened={editing != null} onClose={onClose} title={existing ? 'Edit assessment' : 'Add assessment'}>
      {editing && <AssessmentForm key={existing?.id ?? 'new'} classId={classId} existing={existing} onDone={onClose} />}
    </Modal>
  );
}

function AssessmentForm({ classId, existing, onDone }: { classId: number; existing: Assessment | null; onDone: () => void }) {
  const form = useForm({
    initialValues: {
      name: existing?.name ?? '',
      weight: existing?.weight ?? ('' as number | string),
      score: existing?.score ?? ('' as number | string),
      dueAt: (existing?.dueAt ?? null) as Date | string | null,
    },
    validate: {
      name: (v) => (v.trim() ? null : 'Name it, e.g. "Midterm"'),
      weight: (v) => (typeof v === 'number' && v > 0 ? null : 'Enter its weight'),
    },
  });
  const save = useAction(
    (v: typeof form.values) => {
      const fields = {
        name: v.name,
        weight: Number(v.weight),
        score: v.score === '' ? null : Number(v.score),
        dueAt: toDate(v.dueAt),
      };
      return existing ? rpc.courses.updateAssessment({ id: existing.id, ...fields }) : rpc.courses.addAssessment({ classId, ...fields });
    },
    { onSuccess: onDone },
  );

  return (
    <form onSubmit={form.onSubmit((v) => save.mutate(v))}>
      <Stack>
        <TextInput label="Name" placeholder="Midterm" data-autofocus {...form.getInputProps('name')} />
        <Group grow>
          <NumberInput label="Weight" suffix="%" min={0} max={100} decimalScale={2} {...form.getInputProps('weight')} />
          <NumberInput label="Your grade" description="Leave empty until graded" suffix="%" min={0} max={150} decimalScale={2} {...form.getInputProps('score')} />
        </Group>
        <DateTimePicker label="Due date" placeholder="Optional" clearable valueFormat="ddd D MMM YYYY, HH:mm" {...form.getInputProps('dueAt')} />
        <Group justify="flex-end">
          <Button type="submit" loading={save.isPending}>
            Save
          </Button>
        </Group>
      </Stack>
    </form>
  );
}
