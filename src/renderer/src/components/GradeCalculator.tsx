import { useState } from 'react';
import {
  ActionIcon,
  Button,
  Card,
  Grid,
  Group,
  Modal,
  NumberInput,
  Select,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { DateTimePicker } from '@mantine/dates';
import { useForm } from '@mantine/form';
import { IconPencil, IconPlus, IconTrash } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import { finalIfRemainingAverages, letterFor, MCGILL_SCALE, minimumFor, summarize } from '@shared/grades';
import { toDate } from '../lib/format';
import { t } from '../lib/i18n';
import { useAction } from '../lib/hooks';
import { type Out, rpc } from '../lib/rpc';
import { Empty, Loading } from './ui';

type Assessment = Out<typeof rpc.courses.assessments>[number];

// A4 + A5 in the layout of the wireframe (A2Team.pdf p. 6): the grading scheme with
// your grades, a target grade, what you need, and a table of scenarios.
export function GradeCalculator({ classId }: { classId: number }) {
  const items = useQuery({ queryKey: ['courses', 'assessments', classId], queryFn: () => rpc.courses.assessments({ classId }) });
  const info = useQuery({ queryKey: ['courses', 'info', classId], queryFn: () => rpc.courses.info({ classId }) });
  const [editing, setEditing] = useState<Assessment | 'new' | null>(null);
  const remove = useAction((id: number) => rpc.courses.removeAssessment({ id }));
  const setScore = useAction((a: Assessment & { score: number | null }) =>
    rpc.courses.updateAssessment({ id: a.id, name: a.name, weight: a.weight, score: a.score, dueAt: a.dueAt }),
  );
  const setTarget = useAction((targetGrade: string) => rpc.courses.setTarget({ classId, targetGrade }));

  if (items.isPending || !items.data || !info.data) return <Loading />;
  const list = items.data;
  const summary = summarize(list);
  const target = info.data.targetGrade;
  const goal = summary.requirements.find((r) => r.letter === target);
  const remaining = list.filter((a) => a.score == null);
  const single = remaining.length === 1 ? remaining[0].name : null;
  const restParams = { name: single?.toLowerCase() ?? '', weight: summary.remainingWeight, min: minimumFor(target) };

  return (
    <Stack gap="lg">
      <Card padding="lg">
        <Group justify="space-between" mb="md">
          <Title order={2}>{t('Current grades')}</Title>
          <Button variant="default" leftSection={<IconPlus size={16} />} onClick={() => setEditing('new')}>
            {t('Add component')}
          </Button>
        </Group>
        {list.length ? (
          <Table withTableBorder withColumnBorders verticalSpacing="sm" fz="md">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>{t('Component')}</Table.Th>
                <Table.Th w={120}>{t('Weight (%)')}</Table.Th>
                <Table.Th w={170}>{t('Your grade (%)')}</Table.Th>
                <Table.Th w={220}>{t('Weighted contribution (%)')}</Table.Th>
                <Table.Th w={90} />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {list.map((a) => (
                <Table.Tr key={a.id}>
                  <Table.Td fw={600}>{a.name}</Table.Td>
                  <Table.Td>{a.weight}</Table.Td>
                  <Table.Td>
                    <NumberInput
                      key={`${a.id}-${a.score}`}
                      radius="xl"
                      size="sm"
                      w={120}
                      min={0}
                      max={150}
                      decimalScale={2}
                      hideControls
                      placeholder="—"
                      defaultValue={a.score ?? ''}
                      aria-label={t('Your grade for {{name}}', { name: a.name })}
                      onBlur={(e) => {
                        const raw = e.currentTarget.value.trim();
                        const score = raw === '' ? null : Number(raw);
                        if (score !== a.score && (score == null || !Number.isNaN(score))) setScore.mutate({ ...a, score });
                      }}
                    />
                  </Table.Td>
                  <Table.Td>{a.score == null ? '—' : ((a.weight * a.score) / 100).toFixed(1)}</Table.Td>
                  <Table.Td>
                    <Group gap={4} justify="flex-end" wrap="nowrap">
                      <ActionIcon variant="subtle" onClick={() => setEditing(a)} aria-label={t('Edit {{name}}', { name: a.name })}>
                        <IconPencil size={16} />
                      </ActionIcon>
                      <ActionIcon variant="subtle" color="red" onClick={() => remove.mutate(a.id)} aria-label={t('Delete {{name}}', { name: a.name })}>
                        <IconTrash size={16} />
                      </ActionIcon>
                    </Group>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        ) : (
          <Empty>{t('Add each graded component from the syllabus with its weight, e.g. "Midterm, 25%".')}</Empty>
        )}
        {list.length > 0 && (
          <Group mt="sm" gap="lg">
            <Text size="sm" c="dimmed">
              {t('Average so far:')}{' '}
              <b>{summary.currentAverage == null ? '—' : `${summary.currentAverage}% (${letterFor(summary.currentAverage).letter})`}</b>
            </Text>
            <Text size="sm" c={summary.totalWeight === 100 ? 'dimmed' : 'orange'}>
              {t('Weights total')} <b>{summary.totalWeight}%</b>
              {summary.totalWeight !== 100 && ` ${t('(grades are scaled to this)')}`}
            </Text>
          </Group>
        )}
      </Card>

      {list.length > 0 && (
        <Grid gap="lg" align="stretch">
          <Grid.Col span={{ base: 12, md: 3 }}>
            <Title order={3} mb="sm">
              {t('Target grade')}
            </Title>
            <Select
              radius="xl"
              size="lg"
              data={MCGILL_SCALE.filter((g) => g.min > 0).map((g) => ({ value: g.letter, label: `${g.letter} (≥${g.min}%)` }))}
              value={target}
              onChange={(v) => v && setTarget.mutate(v)}
              allowDeselect={false}
              aria-label={t('Target grade')}
            />
          </Grid.Col>
          <Grid.Col span={{ base: 12, md: 5 }}>
            <Card
              h="100%"
              padding="xl"
              radius={48}
              style={{ background: goal?.status === 'out-of-reach' ? 'var(--mantine-color-red-light)' : 'var(--mantine-color-blue-light)' }}
            >
              <Stack align="center" justify="center" gap={4} h="100%" ta="center">
                {!goal || goal.status === 'secured' ? (
                  <>
                    <Text fw={700}>{t("You've already secured")}</Text>
                    <Text fz={44} fw={700} className="display">
                      {target} 🎉
                    </Text>
                    <Text size="sm">
                      {single
                        ? t('even with 0% on the {{name}}.', restParams)
                        : t('even with 0% on the remaining {{weight}}% of the course.', restParams)}
                    </Text>
                  </>
                ) : goal.status === 'out-of-reach' ? (
                  <>
                    <Text fw={700}>{t('Out of reach')}</Text>
                    <Text size="sm">
                      {single
                        ? t("Even 100% on the {{name}} won't reach {{min}}%.", restParams)
                        : t("Even 100% on the remaining {{weight}}% of the course won't reach {{min}}%.", restParams)}{' '}
                      {t('Your best possible grade is {{best}}% ({{letter}}).', {
                        best: summary.bestFinal,
                        letter: letterFor(summary.bestFinal).letter,
                      })}
                    </Text>
                  </>
                ) : (
                  <>
                    <Text fw={700}>{t('You need at least')}</Text>
                    <Text fz={48} fw={700} className="display" lh={1}>
                      {goal.needed}%
                    </Text>
                    <Text fw={700}>
                      {single ? t('on the {{name}}', restParams) : t('on the remaining {{weight}}% of the course', restParams)}
                      <br />
                      {t('to achieve {{grade}} in the course', { grade: target })}
                    </Text>
                  </>
                )}
              </Stack>
            </Card>
          </Grid.Col>
          <Grid.Col span={{ base: 12, md: 4 }}>
            <Scenarios items={list} needed={goal?.status === 'possible' ? goal.needed : null} single={single} />
          </Grid.Col>
        </Grid>
      )}

      <Modal opened={editing != null} onClose={() => setEditing(null)} title={editing && editing !== 'new' ? t('Edit component') : t('Add component')}>
        {editing && (
          <ComponentForm key={editing === 'new' ? 'new' : editing.id} classId={classId} existing={editing === 'new' ? null : editing} onDone={() => setEditing(null)} />
        )}
      </Modal>
    </Stack>
  );
}

function Scenarios({ items, needed, single }: { items: Assessment[]; needed: number | null; single: string | null }) {
  if (!items.some((a) => a.score == null)) return null;
  const values = [...new Set([60, 70, 75, 80, 85, 90, 100, ...(needed != null ? [needed] : [])])].sort((a, b) => a - b);
  return (
    <Card padding="md" h="100%">
      <Text fw={800} className="display">
        {t('Explore different scenarios')}
      </Text>
      <Text size="xs" c="dimmed" mb="xs">
        {single
          ? t('How your {{name}} grade changes your overall grade.', { name: single.toLowerCase() })
          : t('How your remaining grades change your overall grade.')}
      </Text>
      <Table withTableBorder withColumnBorders fz="sm" verticalSpacing={4}>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>{single ? t('{{name}} grade', { name: single }) : t('Average on the rest')}</Table.Th>
            <Table.Th>{t('Overall grade (%)')}</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {values.map((v) => {
            const overall = finalIfRemainingAverages(items, v);
            return (
              <Table.Tr key={v} bg={v === needed ? 'var(--mantine-color-blue-light)' : undefined} fw={v === needed ? 800 : undefined}>
                <Table.Td>{v}</Table.Td>
                <Table.Td>
                  {overall.toFixed(1)} <Text span size="xs" c="dimmed">({letterFor(overall).letter})</Text>
                </Table.Td>
              </Table.Tr>
            );
          })}
        </Table.Tbody>
      </Table>
    </Card>
  );
}

function ComponentForm({ classId, existing, onDone }: { classId: number; existing: Assessment | null; onDone: () => void }) {
  const form = useForm({
    initialValues: {
      name: existing?.name ?? '',
      weight: existing?.weight ?? ('' as number | string),
      score: existing?.score ?? ('' as number | string),
      dueAt: (existing?.dueAt ?? null) as Date | string | null,
    },
    validate: {
      name: (v) => (v.trim() ? null : t('Name it, e.g. "Midterm"')),
      weight: (v) => (typeof v === 'number' && v > 0 ? null : t('Enter its weight')),
    },
  });
  const save = useAction(
    async (v: typeof form.values) => {
      const fields = { name: v.name, weight: Number(v.weight), score: v.score === '' ? null : Number(v.score), dueAt: toDate(v.dueAt) };
      if (existing) await rpc.courses.updateAssessment({ id: existing.id, ...fields });
      else await rpc.courses.addAssessment({ classId, ...fields });
    },
    { onSuccess: onDone },
  );

  return (
    <form onSubmit={form.onSubmit((v) => save.mutate(v))}>
      <Stack>
        <TextInput label={t('Component')} placeholder={t('Midterm')} data-autofocus {...form.getInputProps('name')} />
        <Group grow>
          <NumberInput label={t('Weight')} suffix="%" min={0} max={100} decimalScale={2} {...form.getInputProps('weight')} />
          <NumberInput label={t('Your grade')} description={t('Empty until graded')} suffix="%" min={0} max={150} decimalScale={2} {...form.getInputProps('score')} />
        </Group>
        <DateTimePicker label={t('Due date')} description={t('Shows on your calendar')} placeholder={t('Optional')} clearable valueFormat="ddd D MMM YYYY, HH:mm" {...form.getInputProps('dueAt')} />
        <Group justify="flex-end">
          <Button type="submit" loading={save.isPending}>
            {t('Save')}
          </Button>
        </Group>
      </Stack>
    </form>
  );
}
