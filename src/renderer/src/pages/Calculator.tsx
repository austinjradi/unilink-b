import { Anchor, Card, Group, HoverCard, Select, Table, Text } from '@mantine/core';
import { IconExternalLink, IconInfoCircle } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router';
import { MCGILL_SCALE } from '@shared/grades';
import { GradeCalculator } from '../components/GradeCalculator';
import { Empty, Loading, PageHeader } from '../components/ui';
import { rpc } from '../lib/rpc';

// A4: the grade calculator as its own page, with a course picker.
export function CalculatorPage() {
  const [params, setParams] = useSearchParams();
  const classes = useQuery({ queryKey: ['classes', 'mine'], queryFn: () => rpc.classes.mine() });
  if (classes.isPending) return <Loading />;

  const chosen = Number(params.get('class')) || classes.data?.[0]?.id || null;

  return (
    <>
      <PageHeader
        title="Grade Calculator"
        actions={
          <HoverCard width={260} position="bottom-end" shadow="md">
            <HoverCard.Target>
              <Anchor size="sm" fw={700} underline="always">
                <Group gap={4}>
                  <IconExternalLink size={14} /> McGill grading scheme <IconInfoCircle size={14} />
                </Group>
              </Anchor>
            </HoverCard.Target>
            <HoverCard.Dropdown>
              <Text size="xs" c="dimmed" mb={6}>
                Letter grades and grade points the calculator uses.
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
            Join your courses first, then add their grading schemes here.{' '}
            <Anchor component={Link} to="/courses/find">
              Find courses
            </Anchor>
          </Empty>
        </Card>
      ) : (
        <>
          <Group mb="lg" gap="sm">
            <Text fz="xl" fw={600} className="display">
              Select a course
            </Text>
            <Select
              radius="xl"
              w={220}
              data={classes.data.map((c) => ({ value: String(c.id), label: `${c.subject} ${c.number}` }))}
              value={chosen ? String(chosen) : null}
              onChange={(v) => v && setParams({ class: v })}
              allowDeselect={false}
              aria-label="Course"
            />
          </Group>
          {chosen && <GradeCalculator key={chosen} classId={chosen} />}
        </>
      )}
    </>
  );
}
