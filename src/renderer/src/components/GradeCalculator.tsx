import { useState } from 'react';
import {
  ActionIcon,
  Button,
  Card,
  Grid,
  Group,
  Menu,
  Modal,
  NumberInput,
  Select,
  Stack,
  Switch,
  Table,
  Text,
  Textarea,
  TextInput,
  Title,
  Tooltip,
} from '@mantine/core';
import { DateTimePicker } from '@mantine/dates';
import { useForm } from '@mantine/form';
import { modals } from '@mantine/modals';
import { notifications } from '@mantine/notifications';
import { IconCopy, IconListNumbers, IconPencil, IconPlus, IconTrash } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import { bestFromName, finalIfRemainingAverages, hasSecondScheme, letterFor, markFromParts, MCGILL_SCALE, minimumFor, parseMark, parseMarks, summarize } from '@shared/grades';
import { toDate } from '../lib/format';
import { t } from '../lib/i18n';
import { useAction } from '../lib/hooks';
import { type Out, rpc } from '../lib/rpc';
import { Empty, Loading } from './ui';

type Assessment = Out<typeof rpc.courses.assessments>[number];

// A4 + A5 in the layout of the wireframe (A2Team.pdf p. 6): the grading scheme with
// your grades, a target grade, what you need, and a table of scenarios.
// Version B: the scheme is shared by the section (anyone can add or fix a component);
// your grades and target stay private. Weight that isn't listed counts as still to come.
// A section can add a second scheme ("whichever is higher"); targets use the better one.
// Once a professor teaches the section the scheme is theirs: they see it without marks (those
// stay private) or the calculator, and students see it read-only with their own marks.
export function GradeCalculator({ classId }: { classId: number }) {
  const items = useQuery({ queryKey: ['courses', 'assessments', classId], queryFn: () => rpc.courses.assessments({ classId }) });
  const info = useQuery({ queryKey: ['courses', 'info', classId], queryFn: () => rpc.courses.info({ classId }) });
  const [editing, setEditing] = useState<Assessment | 'new' | null>(null);
  const [severalId, setSeveralId] = useState<number | null>(null);
  const remove = useAction((id: number) => rpc.courses.removeAssessment({ id }));
  const setScore = useAction((a: { id: number; score: number | null }) => rpc.courses.setScore(a));
  const setTarget = useAction((targetGrade: string) => rpc.courses.setTarget({ classId, targetGrade }));
  const mine = useQuery({ queryKey: ['classes', 'mine'], queryFn: () => rpc.classes.mine() });
  const copyTo = useAction((c: { id: number; code: string }) => rpc.courses.copyScheme({ fromClassId: classId, toClassId: c.id }), {
    success: (_r, c) => t('Scheme copied to {{class}}', { class: c.code }),
  });
  const setSecondScheme = useAction((on: boolean) => rpc.courses.setSecondScheme({ classId, on }), {
    success: (_r, on) => (on ? t('Second scheme added. Adjust its weights in the table.') : t('Second scheme removed')),
  });

  if (items.isPending || !items.data || !info.data) return <Loading />;
  const list = items.data;
  const { canEdit, teaching, managedBy } = info.data;
  const summary = summarize(list);
  const two = hasSecondScheme(list);
  const target = info.data.targetGrade;
  const goal = summary.requirements.find((r) => r.letter === target);
  // The scheme that reaches the target (with two schemes, the one that needs less).
  const scheme = (goal && summary.schemes[goal.scheme]) ?? summary;
  const remaining = list.filter((a) => a.score == null);
  const single = remaining.length === 1 && scheme.unlistedWeight === 0 ? remaining[0].name : null;
  const restParams = { name: single?.toLowerCase() ?? '', weight: scheme.remainingWeight, min: minimumFor(target) };
  const confirmRemove = (a: Assessment) => {
    if (!teaching) return remove.mutate(a.id);
    modals.openConfirmModal({
      title: t('Remove {{name}}?', { name: a.name }),
      children: <Text size="sm">{t("Students who entered a mark for it lose that mark, and they're told the scheme changed.")}</Text>,
      labels: { confirm: t('Remove'), cancel: t('Keep') },
      confirmProps: { color: 'red' },
      onConfirm: () => remove.mutate(a.id),
    });
  };

  return (
    <Stack gap="lg">
      <Card padding="lg">
        <Group justify="space-between" mb={4}>
          <Title order={2}>{teaching ? t('Grading scheme') : t('Current grades')}</Title>
          {canEdit && (
          <Group gap="md">
            {teaching && list.length > 0 && (mine.data?.length ?? 0) > 1 && (
              <Menu position="bottom-end">
                <Menu.Target>
                  <Button variant="subtle" leftSection={<IconCopy size={16} />}>
                    {t('Copy to a section')}
                  </Button>
                </Menu.Target>
                <Menu.Dropdown>
                  {mine.data!
                    .filter((c) => c.id !== classId)
                    .map((c) => (
                      <Menu.Item key={c.id} onClick={() => copyTo.mutate(c)}>
                        {c.code}
                      </Menu.Item>
                    ))}
                </Menu.Dropdown>
              </Menu>
            )}
            {list.length > 0 && (
              <Switch
                label={t('Second scheme, whichever is higher')}
                checked={two}
                onChange={(e) => setSecondScheme.mutate(e.currentTarget.checked)}
                disabled={setSecondScheme.isPending}
              />
            )}
            <Button variant="default" leftSection={<IconPlus size={16} />} onClick={() => setEditing('new')}>
              {t('Add component')}
            </Button>
          </Group>
          )}
        </Group>
        <Text size="xs" c="dimmed" mb="md">
          {teaching
            ? t("Students in the section see this scheme and enter their own marks, which stay private, even from you. They're told when you change it.")
            : canEdit
              ? t('The grading scheme is shared with your section, so anyone in it can add or fix a component. Your grades are private.')
              : t('{{name}} sets the grading scheme for this section. Your grades are private.', { name: managedBy ?? '' })}
        </Text>
        {list.length ? (
          <Table.ScrollContainer minWidth={teaching ? 460 : 760}>
            <Table withTableBorder withColumnBorders verticalSpacing="sm" fz="md">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>{t('Component')}</Table.Th>
                  <Table.Th w={120}>{two ? t('Scheme 1 (%)') : t('Weight (%)')}</Table.Th>
                  {two && <Table.Th w={120}>{t('Scheme 2 (%)')}</Table.Th>}
                  {!teaching && (
                    <Table.Th w={170}>
                      {t('Your grade (%)')}
                      <Text size="xs" c="dimmed" fw={400}>
                        {t('or a fraction, like 44/50')}
                      </Text>
                    </Table.Th>
                  )}
                  {!teaching && <Table.Th w={200}>{t('Weighted contribution (%)')}</Table.Th>}
                  <Table.Th w={140}>{t('Added by')}</Table.Th>
                  {canEdit && <Table.Th w={90} />}
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {list.map((a) => (
                  <Table.Tr key={a.id}>
                    <Table.Td fw={600}>{a.name}</Table.Td>
                    <Table.Td>{a.weight}</Table.Td>
                    {two && <Table.Td>{a.altWeight ?? 0}</Table.Td>}
                    {!teaching && (
                    <Table.Td>
                      <TextInput
                        key={`${a.id}-${a.score}`}
                        radius="xl"
                        size="sm"
                        w={120}
                        placeholder="—"
                        inputMode="text"
                        rightSection={
                          <Tooltip label={t('Several marks, like weekly quizzes')}>
                            <ActionIcon variant="subtle" color="gray" size="sm" radius="xl" onClick={() => setSeveralId(a.id)} aria-label={t('Enter several marks for {{name}}', { name: a.name })}>
                              <IconListNumbers size={14} />
                            </ActionIcon>
                          </Tooltip>
                        }
                        defaultValue={a.score ?? ''}
                        aria-label={t('Your grade for {{name}}, as a percentage or a fraction like 44/50', { name: a.name })}
                        onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
                        onBlur={(e) => {
                          const score = parseMark(e.currentTarget.value);
                          if (score === undefined) {
                            notifications.show({ color: 'red', message: t('Enter a percentage or a fraction like 44/50.') });
                            e.currentTarget.value = a.score == null ? '' : String(a.score);
                          } else if (score !== a.score) setScore.mutate({ id: a.id, score });
                        }}
                      />
                      {a.parts && (
                        <Text size="xs" c="dimmed" mt={2}>
                          {a.parts.best != null && a.parts.best < a.parts.marks.length
                            ? t('best {{best}} of {{count}} marks', { best: a.parts.best, count: a.parts.marks.length })
                            : t('from {{count}} marks', { count: a.parts.marks.length })}
                        </Text>
                      )}
                    </Table.Td>
                    )}
                    {!teaching && (
                    <Table.Td>
                      {a.score == null
                        ? '—'
                        : [a.weight, ...(two ? [a.altWeight ?? 0] : [])].map((w) => ((w * a.score!) / 100).toFixed(1)).join(' / ')}
                    </Table.Td>
                    )}
                    <Table.Td>
                      <Text size="xs" c="dimmed">
                        {a.addedBy ? (a.addedBy.former ? t('a former student') : a.addedBy.name) : ''}
                      </Text>
                    </Table.Td>
                    {canEdit && (
                    <Table.Td>
                      <Group gap={4} justify="flex-end" wrap="nowrap">
                        <ActionIcon variant="subtle" onClick={() => setEditing(a)} aria-label={t('Edit {{name}}', { name: a.name })}>
                          <IconPencil size={16} />
                        </ActionIcon>
                        <ActionIcon variant="subtle" color="red" onClick={() => confirmRemove(a)} aria-label={t('Delete {{name}}', { name: a.name })}>
                          <IconTrash size={16} />
                        </ActionIcon>
                      </Group>
                    </Table.Td>
                    )}
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        ) : (
          <Empty>{canEdit ? t('Add each graded component from the syllabus with its weight, e.g. "Midterm, 25%".') : t("Your professor hasn't added the grading scheme yet.")}</Empty>
        )}
        {list.length > 0 && (
          <Group mt="sm" gap="lg">
            {!teaching && (
              <Text size="sm" c="dimmed">
                {t('Average so far:')}{' '}
                <b>{summary.currentAverage == null ? '—' : `${summary.currentAverage}% (${letterFor(summary.currentAverage).letter})`}</b>
              </Text>
            )}
            <Text size="sm" c={summary.unlistedWeight === 0 ? 'dimmed' : 'orange'}>
              {t('Weights total')} <b>{summary.totalWeight}%</b>
              {two && ` · ${t('scheme 2: {{weight}}%', { weight: summary.schemes[1].totalWeight })}`}
              {summary.unlistedWeight > 0 && ` ${t('({{weight}}% not listed yet, counted as still to come)', { weight: summary.unlistedWeight })}`}
            </Text>
          </Group>
        )}
      </Card>

      {list.length > 0 && !teaching && (
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
                    {two && (
                      <Text size="xs" c="dimmed">
                        {t('Using scheme {{number}}, the better one for you', { number: goal.scheme + 1 })}
                      </Text>
                    )}
                  </>
                )}
              </Stack>
            </Card>
          </Grid.Col>
          <Grid.Col span={{ base: 12, md: 4 }}>
            <Scenarios items={list} needed={goal?.status === 'possible' ? goal.needed : null} single={single} two={two} />
          </Grid.Col>
        </Grid>
      )}

      <Modal opened={editing != null} onClose={() => setEditing(null)} title={editing && editing !== 'new' ? t('Edit component') : t('Add component')}>
        {editing && (
          <ComponentForm
            key={editing === 'new' ? 'new' : editing.id}
            classId={classId}
            existing={editing === 'new' ? null : editing}
            two={two}
            teaching={teaching}
            onDone={() => setEditing(null)}
          />
        )}
      </Modal>
      <Modal opened={severalId != null} onClose={() => setSeveralId(null)} title={t('Marks for {{name}}', { name: list.find((a) => a.id === severalId)?.name ?? '' })}>
        {severalId != null && list.some((a) => a.id === severalId) && <SeveralMarks assessment={list.find((a) => a.id === severalId)!} onDone={() => setSeveralId(null)} />}
      </Modal>
    </Stack>
  );
}

function Scenarios({ items, needed, single, two }: { items: Assessment[]; needed: number | null; single: string | null; two: boolean }) {
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
            const { final: overall, scheme } = finalIfRemainingAverages(items, v);
            return (
              <Table.Tr key={v} bg={v === needed ? 'var(--mantine-color-blue-light)' : undefined} fw={v === needed ? 800 : undefined}>
                <Table.Td>{v}</Table.Td>
                <Table.Td>
                  {overall.toFixed(1)}{' '}
                  <Text span size="xs" c="dimmed">
                    ({letterFor(overall).letter}
                    {two && `, ${t('scheme {{number}}', { number: scheme + 1 })}`})
                  </Text>
                </Table.Td>
              </Table.Tr>
            );
          })}
        </Table.Tbody>
      </Table>
    </Card>
  );
}

function ComponentForm({ classId, existing, two, teaching, onDone }: { classId: number; existing: Assessment | null; two: boolean; teaching: boolean; onDone: () => void }) {
  const form = useForm({
    initialValues: {
      name: existing?.name ?? '',
      weight: existing?.weight ?? ('' as number | string),
      altWeight: existing?.altWeight ?? ('' as number | string),
      dueAt: (existing?.dueAt ?? null) as Date | string | null,
    },
    validate: {
      name: (v) => (v.trim() ? null : t('Name it, e.g. "Midterm"')),
      weight: (v) => (typeof v === 'number' && v > 0 ? null : t('Enter its weight')),
    },
  });
  const save = useAction(
    async (v: typeof form.values) => {
      // Left empty, scheme 2 uses the same weight.
      const altWeight = two && v.altWeight !== '' ? Number(v.altWeight) : null;
      const fields = { name: v.name, weight: Number(v.weight), altWeight, dueAt: toDate(v.dueAt) };
      if (existing) await rpc.courses.updateAssessment({ id: existing.id, ...fields });
      else await rpc.courses.addAssessment({ classId, ...fields });
    },
    { onSuccess: onDone },
  );

  return (
    <form onSubmit={form.onSubmit((v) => save.mutate(v))}>
      <Stack>
        <TextInput label={t('Component')} placeholder={t('Midterm')} data-autofocus {...form.getInputProps('name')} />
        <Group align="flex-end">
          <NumberInput label={two ? t('Weight in scheme 1') : t('Weight')} suffix="%" min={0} max={100} decimalScale={2} w={160} {...form.getInputProps('weight')} />
          {two && (
            <NumberInput
              label={t('Weight in scheme 2')}
              description={t("0 if it doesn't count there")}
              suffix="%"
              min={0}
              max={100}
              decimalScale={2}
              w={180}
              {...form.getInputProps('altWeight')}
            />
          )}
        </Group>
        <DateTimePicker
          label={t('Due date')}
          description={t("Shows on everyone's calendar in this section")}
          placeholder={t('Optional')}
          clearable
          valueFormat="ddd D MMM YYYY, HH:mm"
          {...form.getInputProps('dueAt')}
        />
        <Text size="xs" c="dimmed">
          {teaching ? t("This changes the grading scheme for the whole section, and students are told.") : t('This changes the grading scheme for the whole section. Enter your own grade in the table.')}
        </Text>
        <Group justify="flex-end">
          <Button type="submit" loading={save.isPending}>
            {t('Save')}
          </Button>
        </Group>
      </Stack>
    </form>
  );
}

// A4: a component made of many small marks. They stay private like any other mark.
function SeveralMarks({ assessment: a, onDone }: { assessment: Assessment; onDone: () => void }) {
  const [text, setText] = useState(a.parts?.marks.join(' ') ?? '');
  const [best, setBest] = useState<number | string>(a.parts?.best ?? bestFromName(a.name) ?? '');
  const { marks, unreadable } = parseMarks(text);
  const count = typeof best === 'number' && best >= 1 ? best : null;
  const result = markFromParts(marks, count);
  const save = useAction(() => rpc.courses.setScoreParts({ id: a.id, marks, best: count }), { onSuccess: onDone });
  return (
    <Stack>
      <Textarea
        label={t('Your marks')}
        description={t('Percentages or fractions, with spaces between them.')}
        placeholder="8/10 9/10 7.5/10"
        autosize
        minRows={2}
        data-autofocus
        value={text}
        onChange={(e) => setText(e.currentTarget.value)}
        error={unreadable.length ? t('Can’t read: {{marks}}', { marks: unreadable.join(', ') }) : undefined}
      />
      <NumberInput
        label={t('Only the best ones count')}
        description={t('Leave it empty if they all count. "Best 4 of 5 quizzes" is 4.')}
        placeholder="—"
        min={1}
        max={60}
        allowDecimal={false}
        w={280}
        value={best}
        onChange={setBest}
      />
      <Text size="sm" aria-live="polite">
        {result ? (
          <>
            {t('This counts as')} <b>{result.score}%</b>
            {result.dropped.length > 0 && ` · ${t('not counted: {{marks}}', { marks: result.dropped.join(', ') })}`}
          </>
        ) : (
          t('No marks yet.')
        )}
      </Text>
      <Group justify="flex-end">
        <Button onClick={() => save.mutate()} disabled={unreadable.length > 0} loading={save.isPending}>
          {t('Save')}
        </Button>
      </Group>
    </Stack>
  );
}
