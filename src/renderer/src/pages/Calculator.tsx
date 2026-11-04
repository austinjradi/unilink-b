import { Anchor, Card, Group, HoverCard, NumberInput, Select, Stack, Table, Text, Title, UnstyledButton } from '@mantine/core';
import { IconExternalLink, IconInfoCircle } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import { useLocalStorage } from '@mantine/hooks';
import { Link, Navigate, useSearchParams } from 'react-router';
import { cgpaWith, letterFor, MCGILL_SCALE, minimumFor, termGpa } from '@shared/grades';
import { GradeCalculator } from '../components/GradeCalculator';
import { Covered, Empty, Loading, PageHeader, Tag } from '../components/ui';
import { useMe } from '../lib/hooks';
import { rpc } from '../lib/rpc';
import { useVariant } from '../lib/variants';
import { t } from '../lib/i18n';
import { ReqInfo, WithInfo } from '../components/ReqInfo';

// A4: the grade calculator as its own page, with a course picker, and below it how all the
// term's classes add up.
export function CalculatorPage() {
  const student = useMe().role === 'student';
  const onlyInClass = useVariant('calculator-only-in-class');
  const noOverview = useVariant('no-term-overview');
  const allClasses = useVariant('all-classes-one-page');
  const [params, setParams] = useSearchParams();
  const classes = useQuery({ queryKey: ['classes', 'mine'], queryFn: () => rpc.classes.mine() });
  if (onlyInClass) return <Navigate to="/courses" replace />;
  if (classes.isPending) return <Loading />;

  const chosen = Number(params.get('class')) || classes.data?.[0]?.id || null;

  return (
    <>
      <PageHeader
        info="calculator-page"
        title={t('Grade Calculator')}
        actions={
          <WithInfo id="mcgill-scale">
          <HoverCard width={260} position="bottom-end" shadow="md">
            <HoverCard.Target>
              <Anchor size="sm" fw={700} underline="always">
                <Group gap={4}>
                  <IconExternalLink size={14} /> {t('McGill grading scheme')} <IconInfoCircle size={14} />
                </Group>
              </Anchor>
            </HoverCard.Target>
            <HoverCard.Dropdown>
              <Text size="xs" c="dimmed" mb={6}>
                {t('Letter grades and grade points the calculator uses.')}
              </Text>
              <Table fz="xs" verticalSpacing={2}>
                <Table.Tbody>
                  {MCGILL_SCALE.map((g, i) => (
                    <Table.Tr key={g.letter}>
                      <Table.Td fw={700}>{g.letter}</Table.Td>
                      <Table.Td>
                        {g.min}–{i === 0 ? 100 : MCGILL_SCALE[i - 1].min - 1}%
                      </Table.Td>
                      <Table.Td>{g.gpa.toFixed(1)}</Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </HoverCard.Dropdown>
          </HoverCard>
          </WithInfo>
        }
      />
      {!classes.data?.length ? (
        <Card>
          <Empty>
            {t('Join your courses first, then add their grading schemes here.')}{' '}
            <Anchor component={Link} to="/courses/find">
              {t('Find courses')}
            </Anchor>
          </Empty>
        </Card>
      ) : (
        <>
          <Group mb="lg" gap="sm" display={allClasses ? 'none' : undefined}>
            <Text fz="xl" fw={600} className="display">
              {t('Select a course')} <ReqInfo id="calculator-course" />
            </Text>
            <Select
              radius="xl"
              w={220}
              data={classes.data.map((c) => ({ value: String(c.id), label: c.code }))}
              value={chosen ? String(chosen) : null}
              onChange={(v) => v && setParams({ class: v })}
              allowDeselect={false}
              aria-label={t('Course')}
            />
          </Group>
          {allClasses ? (
            <Stack gap="xl">
              {classes.data.map((c) => (
                <div key={c.id}>
                  <Text fz="xl" fw={700} className="display" mb="sm">
                    {c.code}
                  </Text>
                  <GradeCalculator classId={c.id} />
                </div>
              ))}
            </Stack>
          ) : (
            chosen && <GradeCalculator key={chosen} classId={chosen} />
          )}
          {student && !noOverview && <TermOverview onPick={(classId) => setParams({ class: String(classId) })} />}
        </>
      )}
    </>
  );
}

// Every class this term at a glance, and the GPA they point to on McGill's scale.
function TermOverview({ onPick }: { onPick: (classId: number) => void }) {
  const standing = useQuery({ queryKey: ['courses', 'standing'], queryFn: () => rpc.courses.standing() });
  const singleGrade = useVariant('single-projected-grade');
  const onlyHighest = useVariant('only-highest-possible');
  const termGpaOnly = useVariant('term-gpa-only');
  const gpaTarget = useVariant('target-gpa-term');
  const fromCgpa = useVariant('target-from-cgpa');
  const [termTarget, setTermTarget] = useLocalStorage<number>({ key: 'unilink-term-gpa-target', defaultValue: 3.5 });
  if (!standing.data?.classes.length) return null;
  const rows = standing.data.classes;

  const graded = rows.filter((c) => c.currentAverage != null);
  const projected = termGpa(rows.map((c) => ({ credits: c.credits, percent: c.currentAverage })));
  const onTarget = termGpa(rows.map((c) => ({ credits: c.credits, percent: minimumFor(c.target) })));
  const after = cgpaWith(
    { gpa: standing.data.cgpa, credits: standing.data.cgpaCredits },
    { gpa: projected, credits: graded.reduce((sum, c) => sum + c.credits, 0) },
  );

  return (
    <Card padding="lg" mt="lg">
      <Title order={2} mb={4}>
        {t('This term across your classes')} <ReqInfo id="term-overview" />
      </Title>
      <Text size="xs" c="dimmed" mb="md">
        {t('Only you see this. Projections assume you keep your average so far, so they move as marks come in.')}
      </Text>
      <Table.ScrollContainer minWidth={620}>
        <Table withTableBorder withColumnBorders verticalSpacing="sm" fz="md">
          <Table.Thead>
            <Table.Tr>
              <Table.Th>
                <WithInfo id="calculator-course">{t('Course')}</WithInfo>
              </Table.Th>
              <Table.Th>
                <WithInfo id="find-credits">{t('Credits')}</WithInfo>
              </Table.Th>
              <Table.Th>
                <WithInfo id="marks-average">{t('Average so far')}</WithInfo>
              </Table.Th>
              <Table.Th>
                <WithInfo id="term-range">{singleGrade ? 'Projected grade' : onlyHighest ? 'Could still reach' : t('Could finish between')}</WithInfo>
              </Table.Th>
              <Table.Th>
                <WithInfo id="term-target">{t('Your target')}</WithInfo>
              </Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {rows.map((c) => (
              <Table.Tr key={c.classId}>
                <Table.Td>
                  <UnstyledButton fw={700} className="author-link" onClick={() => onPick(c.classId)}>
                    {c.code}
                  </UnstyledButton>
                </Table.Td>
                <Table.Td>{c.credits}</Table.Td>
                <Table.Td>{c.currentAverage == null ? '—' : `${c.currentAverage}% (${letterFor(c.currentAverage).letter})`}</Table.Td>
                <Table.Td>{!c.hasScheme ? '—' : singleGrade ? (c.currentAverage == null ? '—' : `${c.currentAverage}%`) : onlyHighest ? `Up to ${c.bestFinal}%` : `${c.worstFinal}–${c.bestFinal}%`}</Table.Td>
                <Table.Td>
                  {!c.hasScheme ? (
                    <Text size="sm" c="dimmed">
                      {t('No grading scheme yet')}
                    </Text>
                  ) : c.goal?.status === 'secured' ? (
                    <Tag color="teal">{t('{{grade}} secured', { grade: c.target })}</Tag>
                  ) : c.goal?.status === 'out-of-reach' ? (
                    <Tag color="red">{t('{{grade}} out of reach', { grade: c.target })}</Tag>
                  ) : (
                    <Text size="sm">{t('{{grade}}: {{percent}}% on the rest', { grade: c.target, percent: c.goal?.needed ?? 0 })}</Text>
                  )}
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
      {gpaTarget && (
        <Group mt="sm" gap="sm" align="flex-end">
          <NumberInput size="xs" w={120} label={<WithInfo id="grade-target">Term GPA target</WithInfo>} min={0} max={4} step={0.1} decimalScale={2} value={termTarget} onChange={(v) => setTermTarget(Number(v) || 0)} />
          <Text size="sm">
            That's {[...MCGILL_SCALE].reverse().find((g) => g.gpa >= termTarget)?.letter ?? 'A'} or better in each class, at least {minimumFor([...MCGILL_SCALE].reverse().find((g) => g.gpa >= termTarget)?.letter ?? 'A')}%.
          </Text>
        </Group>
      )}
      {fromCgpa && standing.data.cgpaGoal != null && (
        <Text size="sm" mt="sm">
          For your CGPA goal of {standing.data.cgpaGoal.toFixed(2)}, aim for {[...MCGILL_SCALE].reverse().find((g) => g.gpa >= standing.data.cgpaGoal!)?.letter ?? 'A'} in your classes. <ReqInfo id="term-target" />
        </Text>
      )}
      <Group mt="sm" gap="lg">
        <Text size="sm" c="dimmed">
          {t('Projected term GPA:')} <b>{projected == null ? '—' : <Covered>{projected.toFixed(2)}</Covered>}</b>
          {projected != null && graded.length < rows.length && ` ${t('(from {{count}} of {{total}} classes with marks)', { count: graded.length, total: rows.length })}`} <ReqInfo id="term-gpa" />
        </Text>
        <Text size="sm" c="dimmed">
          {t('If you reach every target:')} <b><Covered>{onTarget?.toFixed(2)}</Covered></b>
        </Text>
        {after != null && standing.data.cgpa != null && !termGpaOnly && (
          <Text size="sm" c="dimmed">
            {t('CGPA after this term:')} <b><Covered>{after.toFixed(2)}</Covered></b> <Covered>{t('(now {{cgpa}})', { cgpa: standing.data.cgpa.toFixed(2) })}</Covered>
          </Text>
        )}
      </Group>
    </Card>
  );
}
