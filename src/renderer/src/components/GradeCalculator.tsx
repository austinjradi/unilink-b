import { useState } from 'react';
import { useLocalStorage } from '@mantine/hooks';
import {
  ActionIcon,
  Button,
  Card,
  Checkbox,
  Grid,
  Group,
  Menu,
  Modal,
  NumberInput,
  Select,
  Slider,
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
import { IconClipboardText, IconCopy, IconFileImport, IconFileText, IconListNumbers, IconPencil, IconPlus, IconTrash } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import { type GradeScale, bestFromName, finalIfRemainingAverages, hasSecondScheme, matchComponent, parsePastedGrades, letterFor, markFromParts, MCGILL_SCALE, minimumFor, parseMark, parseMarks, scaleWeights, summarize, dropLowest, scaleWith } from '@shared/grades';
import { CURRENT_TERM } from '@shared/dates';
import { parseScheme } from '@shared/syllabus';
import { toDate } from '../lib/format';
import { t } from '../lib/i18n';
import { useAction } from '../lib/hooks';
import { type Out, rpc } from '../lib/rpc';
import { useVariant } from '../lib/variants';
import { Empty, Loading } from './ui';
import { ReqInfo, WithInfo } from './ReqInfo';

type Assessment = Out<typeof rpc.courses.assessments>[number];

// A4 + A5 in the layout of the wireframe (A2Team.pdf p. 6): the grading scheme with
// your grades, a target grade, what you need, and a table of scenarios.
// Version B: the scheme is shared by the section (anyone can add or fix a component);
// your grades and target stay private. Weight that isn't listed counts as still to come.
// A section can add a second scheme ("whichever is higher"); targets use the better one.
// Once a professor teaches the section the scheme is theirs: they see it without marks (those
// stay private) or the calculator, and students see it read-only with their own marks.
// 'course-cutoffs': the lowest mark for each letter in this course, starting from McGill's.
function CutoffForm({ classId, current, onDone }: { classId: number; current: Record<string, number> | null; onDone: () => void }) {
  const [values, setValues] = useState<Record<string, number | string>>(Object.fromEntries(MCGILL_SCALE.filter((g) => g.min > 0).map((g) => [g.letter, current?.[g.letter] ?? g.min])));
  const save = useAction((cutoffs: Record<string, number> | null) => rpc.courses.setCutoffs({ classId, cutoffs }), { onSuccess: onDone });
  return (
    <Stack gap="xs">
      {Object.keys(values).map((letter) => (
        <NumberInput key={letter} size="xs" label={letter} suffix="%" min={0} max={100} value={values[letter]} onChange={(v) => setValues({ ...values, [letter]: v })} />
      ))}
      <Group justify="space-between" mt="xs">
        <Button variant="subtle" onClick={() => save.mutate(null)}>
          Use McGill&apos;s
        </Button>
        <Button onClick={() => save.mutate(Object.fromEntries(Object.entries(values).map(([letter, v]) => [letter, Number(v)])))} loading={save.isPending}>
          {t('Save')}
        </Button>
      </Group>
    </Stack>
  );
}

export function GradeCalculator({ classId }: { classId: number }) {
  const sharedScheme = useVariant('shared-scheme');
  const personalScheme = useVariant('personal-grading-scheme');
  const noSecond = useVariant('no-second-scheme');
  const noSeveral = useVariant('quiz-components');
  const noContribution = useVariant('no-contribution-column');
  const marksLost = useVariant('marks-lost');
  const pointsView = useVariant('points-out-of-100');
  const scaleUp = useVariant('scale-to-listed-total');
  const lowestDropped = useVariant('drop-lowest');
  const ownCutoffs = useVariant('course-cutoffs');
  const cutoffs = useQuery({ queryKey: ['courses', 'cutoffs', classId], queryFn: () => rpc.courses.cutoffs({ classId }), enabled: ownCutoffs });
  const [editingCutoffs, setEditingCutoffs] = useState(false);
  const waitFor100 = useVariant('wait-for-100-percent');
  const typeTarget = useVariant('target-percentage');
  const canSwitchToPercent = useVariant('percent-only-view');
  const sectionAverage = useVariant('section-average');
  const approvals = useVariant('approve-shared-changes');
  const [percentOnly, setPercentOnly] = useLocalStorage<boolean>({ key: 'unilink-percent-only', defaultValue: false });
  const [typedTarget, setTypedTarget] = useLocalStorage<number>({ key: `unilink-target-percent-${classId}`, defaultValue: 80 });
  const proposals = useQuery({ queryKey: ['courses', 'proposedComponents', classId], queryFn: () => rpc.courses.proposedComponents({ classId }), enabled: approvals });
  const approve = useAction((key: number) => rpc.courses.approveComponent({ classId, key }));
  const items = useQuery({ queryKey: ['courses', 'assessments', classId], queryFn: () => rpc.courses.assessments({ classId }) });
  const info = useQuery({ queryKey: ['courses', 'info', classId], queryFn: () => rpc.courses.info({ classId }) });
  const [editing, setEditing] = useState<Assessment | 'new' | null>(null);
  const [severalId, setSeveralId] = useState<number | null>(null);
  const [importing, setImporting] = useState(false);
  const [pasting, setPasting] = useState(false);
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
  const list = noSecond ? items.data.map((a) => ({ ...a, altWeight: null })) : items.data;
  const { teaching, managedBy } = info.data;
  const canEdit = info.data.canEdit || personalScheme;
  const counted = lowestDropped ? dropLowest(list) : list;
  const scale = scaleWith(ownCutoffs ? cutoffs.data : null);
  const summary = summarize(scaleUp ? scaleWeights(counted) : counted, scale);
  const two = hasSecondScheme(list);
  const target = info.data.targetGrade;
  const earnedPoints = list.reduce((sum, a) => sum + (a.score == null ? 0 : (a.weight * a.score) / 100), 0);
  const letter = (percent: number) => (percentOnly && canSwitchToPercent ? '' : ` (${letterFor(percent, scale).letter})`);
  // 'wait-for-100-percent': nothing's worked out until the scheme is complete.
  const incomplete = waitFor100 && Math.round(summary.totalWeight) !== 100;
  // 'target-percentage': the same sum as for a letter, for any number.
  const typedNeeded = summary.remainingWeight > 0 ? Math.round(((typedTarget - summary.worstFinal) / summary.remainingWeight) * 1000) / 10 : null;
  const goal = typeTarget
    ? { letter: target, needed: typedNeeded ?? 0, scheme: 0, status: summary.worstFinal >= typedTarget ? ('secured' as const) : typedNeeded == null || typedNeeded > 100 ? ('out-of-reach' as const) : ('possible' as const) }
    : summary.requirements.find((r) => r.letter === target);
  // The scheme that reaches the target (with two schemes, the one that needs less).
  const scheme = (goal && summary.schemes[goal.scheme]) ?? summary;
  const remaining = list.filter((a) => a.score == null);
  const single = remaining.length === 1 && scheme.unlistedWeight === 0 ? remaining[0].name : null;
  const restParams = { name: single?.toLowerCase() ?? '', weight: scheme.remainingWeight, min: typeTarget ? typedTarget : minimumFor(target) };
  const confirmRemove = (a: Assessment) => {
    if (!teaching) return remove.mutate(a.id);
    modals.openConfirmModal({
      title: <WithInfo id="scheme-edit">{t('Remove {{name}}?', { name: a.name })}</WithInfo>,
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
          <Title order={2}>
            {teaching ? t('Grading scheme') : t('Current grades')} <ReqInfo id="grades-card" />
          </Title>
          {canEdit && (
          <Group gap="md">
            {teaching && !sharedScheme && list.length > 0 && (mine.data?.length ?? 0) > 1 && (
              <WithInfo id="scheme-copy">
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
              </WithInfo>
            )}
            {ownCutoffs && teaching && (
              <WithInfo id="mcgill-scale">
                <Button variant="subtle" onClick={() => setEditingCutoffs(true)}>
                  Set this course&apos;s cutoffs
                </Button>
              </WithInfo>
            )}
            {canSwitchToPercent && !teaching && <Switch label={<WithInfo id="mcgill-scale">Percentages only</WithInfo>} checked={percentOnly} onChange={(e) => setPercentOnly(e.currentTarget.checked)} />}
            {list.length > 0 && !noSecond && (
              <Switch
                label={<WithInfo id="scheme-second">{t('Second scheme, whichever is higher')}</WithInfo>}
                checked={two}
                onChange={(e) => setSecondScheme.mutate(e.currentTarget.checked)}
                disabled={setSecondScheme.isPending}
              />
            )}
            <WithInfo id="scheme-import">
              <Button variant="subtle" leftSection={<IconFileImport size={16} />} onClick={() => setImporting(true)}>
                {t('From the syllabus')}
              </Button>
            </WithInfo>
            <WithInfo id="scheme-add">
              <Button variant="default" leftSection={<IconPlus size={16} />} onClick={() => setEditing('new')}>
                {t('Add component')}
              </Button>
            </WithInfo>
          </Group>
          )}
        </Group>
        <Text size="xs" c="dimmed" mb="md">
          {personalScheme
            ? 'This is your own scheme: only you see it, with your own marks.'
            : teaching
            ? t("Students in the section see this scheme and enter their own marks, which stay private, even from you. They're told when you change it.")
            : canEdit
              ? t('The grading scheme is shared with your section, so anyone in it can add or fix a component. Your grades are private.')
              : t('{{name}} sets the grading scheme for this section. Your grades are private.', { name: managedBy ?? '' })}{' '}
          <ReqInfo id="scheme-shared" />
        </Text>
        {lowestDropped && !teaching && (
          <Text size="xs" c="dimmed" mb="md">
            Your lowest mark so far doesn&apos;t count, and the other components share its weight.
          </Text>
        )}
        {list.length ? (
          <Table.ScrollContainer minWidth={teaching ? 460 : 760}>
            <Table withTableBorder withColumnBorders verticalSpacing="sm" fz="md">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>
                    <WithInfo id="scheme-component">{t('Component')}</WithInfo>
                  </Table.Th>
                  <Table.Th w={120}>
                    <WithInfo id="scheme-weight">{two ? t('Scheme 1 (%)') : t('Weight (%)')}</WithInfo>
                  </Table.Th>
                  {two && (
                    <Table.Th w={120}>
                      <WithInfo id="scheme-second">{t('Scheme 2 (%)')}</WithInfo>
                    </Table.Th>
                  )}
                  {!teaching && (
                    <Table.Th w={170}>
                      <WithInfo id="marks-enter">{t('Your grade (%)')}</WithInfo>
                      <Text size="xs" c="dimmed" fw={400}>
                        {t('or a fraction, like 44/50')}
                      </Text>
                    </Table.Th>
                  )}
                  {!teaching && !noContribution && (
                    <Table.Th w={200}>
                      <WithInfo id="marks-contribution">{t('Weighted contribution (%)')}</WithInfo>
                    </Table.Th>
                  )}
                  <Table.Th w={140}>
                    <WithInfo id="scheme-added-by">{t('Added by')}</WithInfo>
                  </Table.Th>
                  {canEdit && (
                    <Table.Th w={90} ta="right">
                      <ReqInfo id="scheme-edit" />
                    </Table.Th>
                  )}
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
                          noSeveral ? undefined :
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
                            : t('from {{count}} marks', { count: a.parts.marks.length })}{' '}
                          <ReqInfo id="marks-several" />
                        </Text>
                      )}
                      {a.sectionAverage != null && sectionAverage && (
                        <Text size="xs" c="dimmed" mt={2}>
                          Section average: {a.sectionAverage}% <ReqInfo id="marks-enter" />
                        </Text>
                      )}
                    </Table.Td>
                    )}
                    {!teaching && !noContribution && (
                    <Table.Td>
                      {a.score == null
                        ? '—'
                        : [a.weight, ...(two ? [a.altWeight ?? 0] : [])].map((w) => ((w * a.score!) / 100).toFixed(1)).join(' / ')}
                      {marksLost && a.score != null && ` (${((a.weight * Math.max(0, 100 - a.score)) / 100).toFixed(1)} lost)`}
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
              <WithInfo id="marks-paste">
                <Button size="compact-sm" variant="subtle" leftSection={<IconClipboardText size={14} />} onClick={() => setPasting(true)}>
                  {t('Paste marks from myCourses')}
                </Button>
              </WithInfo>
            )}
            {!teaching && (
              <Text size="sm" c="dimmed">
                {pointsView ? 'Points so far:' : t('Average so far:')}{' '}
                <b>{pointsView ? `${Math.round(earnedPoints * 10) / 10} / 100` : summary.currentAverage == null ? '—' : `${summary.currentAverage}%${letter(summary.currentAverage)}`}</b> <ReqInfo id="marks-average" />
              </Text>
            )}
            <Text size="sm" c={summary.unlistedWeight === 0 ? 'dimmed' : 'orange'}>
              {t('Weights total')} <b>{summary.totalWeight}%</b>
              {two && ` · ${t('scheme 2: {{weight}}%', { weight: summary.schemes[1].totalWeight })}`}
              {summary.unlistedWeight > 0 && ` ${t('({{weight}}% not listed yet, counted as still to come)', { weight: summary.unlistedWeight })}`} <ReqInfo id="scheme-total" />
            </Text>
          </Group>
        )}
      </Card>

      {!!proposals.data?.length && (
        <Card padding="md">
          <Text fw={700} mb="xs">
            Waiting for approval <ReqInfo id="scheme-add" />
          </Text>
          <Stack gap={4}>
            {proposals.data.map((proposal) => (
              <Group key={proposal.key} justify="space-between">
                <Text size="sm">
                  {proposal.byName}: {proposal.name}, {proposal.weight}%
                </Text>
                {!proposal.mine && (
                  <Button size="compact-xs" onClick={() => approve.mutate(proposal.key)}>
                    Approve
                  </Button>
                )}
              </Group>
            ))}
          </Stack>
        </Card>
      )}
      {list.length > 0 && !teaching && incomplete && (
        <Text size="sm" c="dimmed">
          Nothing is worked out until the weights add up to 100%. <ReqInfo id="scheme-total" />
        </Text>
      )}
      {list.length > 0 && !teaching && !incomplete && (
        <Grid gap="lg" align="stretch">
          <Grid.Col span={{ base: 12, md: 3 }}>
            <Title order={3} mb="sm">
              {t('Target grade')} <ReqInfo id="grade-target" />
            </Title>
            {typeTarget ? (
              <NumberInput radius="xl" size="lg" min={1} max={100} suffix="%" value={typedTarget} onChange={(v) => setTypedTarget(Number(v) || 0)} aria-label={t('Target grade')} />
            ) : (
            <Select
              radius="xl"
              size="lg"
              data={MCGILL_SCALE.filter((g) => g.min > 0).map((g) => ({ value: g.letter, label: `${g.letter} (≥${g.min}%)` }))}
              value={target}
              onChange={(v) => v && setTarget.mutate(v)}
              allowDeselect={false}
              aria-label={t('Target grade')}
            />
            )}
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
                    <Text fw={700}>
                      {t("You've already secured")} <ReqInfo id="grade-needed" />
                    </Text>
                    <Text fz={44} fw={700} className="display">
                      {typeTarget ? `${typedTarget}%` : target} 🎉
                    </Text>
                    <Text size="sm">
                      {single
                        ? t('even with 0% on the {{name}}.', restParams)
                        : t('even with 0% on the remaining {{weight}}% of the course.', restParams)}
                    </Text>
                  </>
                ) : goal.status === 'out-of-reach' ? (
                  <>
                    <Text fw={700}>
                      {t('Out of reach')} <ReqInfo id="grade-needed" />
                    </Text>
                    <Text size="sm">
                      {single
                        ? t("Even 100% on the {{name}} won't reach {{min}}%.", restParams)
                        : t("Even 100% on the remaining {{weight}}% of the course won't reach {{min}}%.", restParams)}{' '}
                      {percentOnly && canSwitchToPercent
                        ? `Your best possible grade is ${summary.bestFinal}%.`
                        : t('Your best possible grade is {{best}}% ({{letter}}).', {
                            best: summary.bestFinal,
                            letter: letterFor(summary.bestFinal, scale).letter,
                          })}
                    </Text>
                  </>
                ) : (
                  <>
                    <Text fw={700}>
                      {t('You need at least')} <ReqInfo id="grade-needed" />
                    </Text>
                    <Text fz={48} fw={700} className="display" lh={1}>
                      {goal.needed}%
                    </Text>
                    <Text fw={700}>
                      {single ? t('on the {{name}}', restParams) : t('on the remaining {{weight}}% of the course', restParams)}
                      <br />
                      {t('to achieve {{grade}} in the course', { grade: typeTarget ? `${typedTarget}%` : target })}
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
            <Scenarios items={counted} needed={goal?.status === 'possible' ? goal.needed : null} single={single} two={two} scale={scale} />
          </Grid.Col>
        </Grid>
      )}

      <Modal opened={editingCutoffs} onClose={() => setEditingCutoffs(false)} title="This course's cutoffs">
        {editingCutoffs && <CutoffForm classId={classId} current={cutoffs.data ?? null} onDone={() => setEditingCutoffs(false)} />}
      </Modal>
      <Modal opened={editing != null} onClose={() => setEditing(null)} title={editing && editing !== 'new' ? <WithInfo id="scheme-edit">{t('Edit component')}</WithInfo> : <WithInfo id="scheme-add">{t('Add component')}</WithInfo>}>
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
      <Modal opened={pasting} onClose={() => setPasting(false)} title={<WithInfo id="marks-paste">{t('Marks from myCourses')}</WithInfo>} size="lg">
        {pasting && <GradesPaste scheme={list} onDone={() => setPasting(false)} />}
      </Modal>
      <Modal opened={importing} onClose={() => setImporting(false)} title={<WithInfo id="scheme-import">{t('Grading scheme from a syllabus')}</WithInfo>} size="lg">
        {importing && <SchemeImport classId={classId} scheme={list} outlineName={info.data.outlineName} onDone={() => setImporting(false)} />}
      </Modal>
      <Modal opened={severalId != null} onClose={() => setSeveralId(null)} title={<WithInfo id="marks-several">{t('Marks for {{name}}', { name: list.find((a) => a.id === severalId)?.name ?? '' })}</WithInfo>}>
        {severalId != null && list.some((a) => a.id === severalId) && <SeveralMarks assessment={list.find((a) => a.id === severalId)!} onDone={() => setSeveralId(null)} />}
      </Modal>
    </Stack>
  );
}

// 'grade-slider': one average for what's left, on a slider.
function ScenarioSlider({ items, scale }: { items: Assessment[]; scale: GradeScale }) {
  const [value, setValue] = useState(75);
  const { final: overall } = finalIfRemainingAverages(items, value);
  return (
    <Card padding="md" h="100%">
      <Text fw={800} className="display" mb="md">
        {t('Explore different scenarios')} <ReqInfo id="grade-scenarios" />
      </Text>
      <Text size="sm" mb={4}>
        {t('Average on the rest')}: <b>{value}%</b>
      </Text>
      <Slider value={value} onChange={setValue} min={0} max={100} label={null} mb="md" />
      <Text size="sm">
        {t('Overall grade (%)')}: <b>{overall.toFixed(1)}</b> ({letterFor(overall, scale).letter})
      </Text>
    </Card>
  );
}

// 'per-component-scenarios': a different mark for each thing that's left.
function ScenarioMarks({ items, scale }: { items: Assessment[]; scale: GradeScale }) {
  const left = items.filter((a) => a.score == null);
  const [marks, setMarks] = useState<Record<number, number>>({});
  const overall = items.reduce((sum, a) => sum + (a.weight * (a.score ?? marks[a.id] ?? 0)) / 100, 0);
  return (
    <Card padding="md" h="100%">
      <Text fw={800} className="display" mb="xs">
        {t('Explore different scenarios')} <ReqInfo id="grade-scenarios" />
      </Text>
      <Stack gap={4}>
        {left.map((a) => (
          <NumberInput key={a.id} size="xs" label={a.name} min={0} max={100} suffix="%" value={marks[a.id] ?? ''} onChange={(v) => setMarks({ ...marks, [a.id]: Number(v) || 0 })} />
        ))}
      </Stack>
      <Text size="sm" mt="sm">
        {t('Overall grade (%)')}: <b>{overall.toFixed(1)}</b> ({letterFor(overall, scale).letter})
      </Text>
    </Card>
  );
}

function Scenarios({ items, needed, single, two, scale }: { items: Assessment[]; needed: number | null; single: string | null; two: boolean; scale: GradeScale }) {
  const slider = useVariant('grade-slider');
  const perComponent = useVariant('per-component-scenarios');
  if (!items.some((a) => a.score == null)) return null;
  if (slider) return <ScenarioSlider items={items} scale={scale} />;
  if (perComponent) return <ScenarioMarks items={items} scale={scale} />;
  const values = [...new Set([60, 70, 75, 80, 85, 90, 100, ...(needed != null ? [needed] : [])])].sort((a, b) => a - b);
  return (
    <Card padding="md" h="100%">
      <Text fw={800} className="display">
        {t('Explore different scenarios')} <ReqInfo id="grade-scenarios" />
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
                    ({letterFor(overall, scale).letter}
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
        <TextInput label={<WithInfo id="scheme-component">{t('Component')}</WithInfo>} placeholder={t('Midterm')} data-autofocus {...form.getInputProps('name')} />
        <Group align="flex-end">
          <NumberInput label={<WithInfo id="scheme-weight">{two ? t('Weight in scheme 1') : t('Weight')}</WithInfo>} suffix="%" min={0} max={100} decimalScale={2} w={160} {...form.getInputProps('weight')} />
          {two && (
            <NumberInput
              label={<WithInfo id="scheme-second">{t('Weight in scheme 2')}</WithInfo>}
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
          label={<WithInfo id="scheme-due">{t('Due date')}</WithInfo>}
          description={t("Shows on everyone's calendar in this section")}
          placeholder={t('Optional')}
          clearable
          valueFormat="ddd D MMM YYYY, HH:mm"
          {...form.getInputProps('dueAt')}
        />
        <Text size="xs" c="dimmed">
          {teaching ? t("This changes the grading scheme for the whole section, and students are told.") : t('This changes the grading scheme for the whole section. Enter your own grade in the table.')} <ReqInfo id="scheme-shared" />
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
  // 'shared-best-rule': "best 4 of 5" is the section's, not each student's.
  const sharedRule = useVariant('shared-best-rule');
  const [text, setText] = useState(a.parts?.marks.join(' ') ?? '');
  const [best, setBest] = useState<number | string>(a.parts?.best ?? bestFromName(a.name) ?? '');
  const { marks, unreadable } = parseMarks(text);
  const sharedBest = useQuery({ queryKey: ['courses', 'sharedBest', a.classId], queryFn: () => rpc.courses.sharedBest({ classId: a.classId }), enabled: sharedRule });
  const setSharedBest = useAction((value: number | null) => rpc.courses.setSharedBest({ id: a.id, best: value }));
  const rule = sharedBest.data?.[a.id] ?? null;
  const count = sharedRule ? rule : typeof best === 'number' && best >= 1 ? best : null;
  const result = markFromParts(marks, count);
  const save = useAction(() => rpc.courses.setScoreParts({ id: a.id, marks, best: count }), { onSuccess: onDone });
  return (
    <Stack>
      <Textarea
        label={<WithInfo id="marks-several">{t('Your marks')}</WithInfo>}
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
        label={<WithInfo id="marks-best">{t('Only the best ones count')}</WithInfo>}
        description={t('Leave it empty if they all count. "Best 4 of 5 quizzes" is 4.')}
        placeholder="—"
        min={1}
        max={60}
        allowDecimal={false}
        w={280}
        value={sharedRule ? (rule ?? '') : best}
        onChange={(v) => (sharedRule ? setSharedBest.mutate(typeof v === 'number' && v >= 1 ? v : null) : setBest(v))}
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

// A5: the breakdown from the course outline, reviewed before anything is added to the section's scheme.
function SchemeImport({ classId, scheme, outlineName, onDone }: { classId: number; scheme: Assessment[]; outlineName: string | null; onDone: () => void }) {
  const [text, setText] = useState('');
  const [unchecked, setUnchecked] = useState<Set<number>>(new Set());
  const mine = useQuery({ queryKey: ['classes', 'mine'], queryFn: () => rpc.classes.mine() });
  const term = mine.data?.find((c) => c.id === classId)?.term ?? CURRENT_TERM;
  const fill = (read: string | null) => {
    if (read == null) return;
    setText(read);
    setUnchecked(new Set());
  };
  const readFile = useAction(() => rpc.calendar.readSyllabusFile(), { onSuccess: (r) => fill(r?.text ?? null) });
  const readOutline = useAction(() => rpc.courses.outlineText({ classId }), { onSuccess: fill });
  const found = parseScheme(text, term);
  const there = (name: string) => scheme.some((a) => a.name.trim().toLowerCase() === name.trim().toLowerCase());
  const noReview = useVariant('scheme-no-review');
  const picked = found.filter((item, n) => !unchecked.has(n) && !there(item.name));
  const total = picked.reduce((sum, item) => sum + item.weight, 0) + scheme.reduce((sum, a) => sum + a.weight, 0);
  const add = useAction(
    async () => {
      const failed: string[] = [];
      for (const item of picked) {
        await rpc.courses.addAssessment({ classId, name: item.name, weight: item.weight, dueAt: item.dueAt }).catch(() => failed.push(item.name));
      }
      return { added: picked.length - failed.length, failed };
    },
    {
      success: (r) => [t('Added {{count}} components', { count: r.added }), r.failed.length ? t('Not added: {{titles}}', { titles: r.failed.join(', ') }) : ''].filter(Boolean).join(' '),
      onSuccess: (r) => !r.failed.length && onDone(),
    },
  );
  return (
    <Stack>
      <Text size="sm" c="dimmed">
        {t('Read the course outline, or paste the part with the grading breakdown. You choose what gets added.')} <ReqInfo id="scheme-import" />
      </Text>
      <Group gap="xs">
        {outlineName && (
          <Button size="xs" variant="light" leftSection={<IconFileText size={14} />} onClick={() => readOutline.mutate()} loading={readOutline.isPending}>
            {t('Read {{name}}', { name: outlineName })}
          </Button>
        )}
        <Button size="xs" variant="default" leftSection={<IconFileText size={14} />} onClick={() => readFile.mutate()} loading={readFile.isPending}>
          {t('Choose a PDF, Word or text file')}
        </Button>
        <ReqInfo id="syllabus-read" />
      </Group>
      <Textarea
        label={<WithInfo id="syllabus-read">{t('Syllabus text')}</WithInfo>}
        placeholder={t('Assignments 20%, Midterm 30%, Final exam 50%')}
        autosize
        minRows={4}
        maxRows={10}
        data-autofocus
        value={text}
        onChange={(e) => {
          setText(e.currentTarget.value);
          setUnchecked(new Set());
        }}
      />
      {text.trim() && !found.length && (
        <Text size="sm" c="dimmed">
          {t('No grading breakdown found yet. Lines need a name and a percentage, like "Midterm 30%".')}
        </Text>
      )}
      {!noReview && found.map((item, n) => {
        const already = there(item.name);
        return (
          <Checkbox
            key={item.line}
            disabled={already}
            checked={!already && !unchecked.has(n)}
            onChange={(e) =>
              setUnchecked((u) => {
                const next = new Set(u);
                if (e.currentTarget.checked) next.delete(n);
                else next.add(n);
                return next;
              })
            }
            label={`${item.name}, ${item.weight}%`}
            description={already ? t('Already added') : item.line}
          />
        );
      })}
      {found.length > 0 && (
        <Group justify="space-between">
          <Text size="sm" c={total === 100 ? 'teal' : 'orange'} fw={700}>
            {t('The scheme would total {{total}}%', { total: Math.round(total * 100) / 100 })} <ReqInfo id="scheme-total" />
          </Text>
          <Button onClick={() => add.mutate()} disabled={!picked.length || total > 100} loading={add.isPending}>
            {t('Add {{count}} components', { count: picked.length })}
          </Button>
        </Group>
      )}
    </Stack>
  );
}

// G2 ← myCourses: marks from a copied grades page, matched to this section's components by name.
// They stay private like any other mark, and nothing changes until they're reviewed.
function GradesPaste({ scheme, onDone }: { scheme: Assessment[]; onDone: () => void }) {
  const [text, setText] = useState('');
  const [unchecked, setUnchecked] = useState<Set<number>>(new Set());
  const found = parsePastedGrades(text).map((grade) => ({ ...grade, component: matchComponent(grade.name, scheme) }));
  const picked = found.filter((g, n) => g.component && !unchecked.has(n));
  const save = useAction(
    async () => {
      for (const g of picked) await rpc.courses.setScore({ id: g.component!.id, score: g.score });
      return picked.length;
    },
    { success: (count) => t('Saved {{count}} marks', { count }), onSuccess: onDone },
  );
  return (
    <Stack>
      <Text size="sm" c="dimmed">
        {t('On myCourses, open Grades for this course, select the page and paste it here. Only you see your marks.')} <ReqInfo id="marks-paste" />
      </Text>
      <Textarea
        label={<WithInfo id="marks-paste">{t('Your grades page')}</WithInfo>}
        placeholder={'Assignment 1  18 / 20  90 %\nMidterm  41 / 50  82 %'}
        autosize
        minRows={4}
        maxRows={10}
        data-autofocus
        value={text}
        onChange={(e) => {
          setText(e.currentTarget.value);
          setUnchecked(new Set());
        }}
      />
      {text.trim() && !found.length && (
        <Text size="sm" c="dimmed">
          {t('No marks found yet. Lines need a name and a mark, like "Midterm 41 / 50".')}
        </Text>
      )}
      {found.map((g, n) => (
        <Checkbox
          key={g.name}
          disabled={!g.component}
          checked={!!g.component && !unchecked.has(n)}
          onChange={(e) =>
            setUnchecked((u) => {
              const next = new Set(u);
              if (e.currentTarget.checked) next.delete(n);
              else next.add(n);
              return next;
            })
          }
          label={g.component ? `${g.component.name}, ${g.score}%` : `${g.name}, ${g.score}%`}
          description={
            !g.component
              ? t('Not in this section’s grading scheme')
              : g.component.score != null && g.component.score !== g.score
                ? t('Replaces your {{mark}}%', { mark: g.component.score })
                : g.component.name !== g.name
                  ? t('From “{{name}}”', { name: g.name })
                  : undefined
          }
        />
      ))}
      {found.length > 0 && (
        <Group justify="flex-end">
          <Button onClick={() => save.mutate()} disabled={!picked.length} loading={save.isPending}>
            {t('Save {{count}} marks', { count: picked.length })}
          </Button>
        </Group>
      )}
    </Stack>
  );
}
