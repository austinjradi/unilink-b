import { Anchor, Card, Group, HoverCard, Select, Table, Text, Title, UnstyledButton } from '@mantine/core';
import { IconExternalLink, IconInfoCircle } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router';
import { cgpaWith, letterFor, MCGILL_SCALE, minimumFor, termGpa } from '@shared/grades';
import { GradeCalculator } from '../components/GradeCalculator';
import { Empty, Loading, PageHeader, Tag } from '../components/ui';
import { useMe } from '../lib/hooks';
import { rpc } from '../lib/rpc';
import { t } from '../lib/i18n';

// A4: the grade calculator as its own page, with a course picker, and below it how all the
// term's classes add up.
export function CalculatorPage() {
  const student = useMe().role === 'student';
  const [params, setParams] = useSearchParams();
  const classes = useQuery({ queryKey: ['classes', 'mine'], queryFn: () => rpc.classes.mine() });
  if (classes.isPending) return <Loading />;

  const chosen = Number(params.get('class')) || classes.data?.[0]?.id || null;

  return (
    <>
      <PageHeader
        title={t('Grade Calculator')}
        actions={
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
          <Group mb="lg" gap="sm">
            <Text fz="xl" fw={600} className="display">
              {t('Select a course')}
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
          {chosen && <GradeCalculator key={chosen} classId={chosen} />}
          {student && <TermOverview onPick={(classId) => setParams({ class: String(classId) })} />}
        </>
      )}
    </>
  );
}

// Every class this term at a glance, and the GPA they point to on McGill's scale.
function TermOverview({ onPick }: { onPick: (classId: number) => void }) {
  const standing = useQuery({ queryKey: ['courses', 'standing'], queryFn: () => rpc.courses.standing() });
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
        {t('This term across your classes')}
      </Title>
      <Text size="xs" c="dimmed" mb="md">
        {t('Only you see this. Projections assume you keep your average so far, so they move as marks come in.')}
      </Text>
      <Table.ScrollContainer minWidth={620}>
        <Table withTableBorder withColumnBorders verticalSpacing="sm" fz="md">
          <Table.Thead>
            <Table.Tr>
              <Table.Th>{t('Course')}</Table.Th>
              <Table.Th>{t('Credits')}</Table.Th>
              <Table.Th>{t('Average so far')}</Table.Th>
              <Table.Th>{t('Could finish between')}</Table.Th>
              <Table.Th>{t('Your target')}</Table.Th>
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
                <Table.Td>{c.hasScheme ? `${c.worstFinal}–${c.bestFinal}%` : '—'}</Table.Td>
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
      <Group mt="sm" gap="lg">
        <Text size="sm" c="dimmed">
          {t('Projected term GPA:')} <b>{projected == null ? '—' : projected.toFixed(2)}</b>
          {projected != null && graded.length < rows.length && ` ${t('(from {{count}} of {{total}} classes with marks)', { count: graded.length, total: rows.length })}`}
        </Text>
        <Text size="sm" c="dimmed">
          {t('If you reach every target:')} <b>{onTarget?.toFixed(2)}</b>
        </Text>
        {after != null && standing.data.cgpa != null && (
          <Text size="sm" c="dimmed">
            {t('CGPA after this term:')} <b>{after.toFixed(2)}</b> {t('(now {{cgpa}})', { cgpa: standing.data.cgpa.toFixed(2) })}
          </Text>
        )}
      </Group>
    </Card>
  );
}
