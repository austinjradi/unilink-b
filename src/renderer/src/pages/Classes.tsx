import { useState } from 'react';
import { Badge, Button, Card, Group, Select, SimpleGrid, Table, Tabs, Text, TextInput } from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import { IconCertificate, IconListDetails, IconSchool, IconSearch, IconUsers } from '@tabler/icons-react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router';
import { CURRENT_TERM } from '@shared/dates';
import { Empty, Loading, PageHeader, SectionCard, Tag } from '../components/ui';
import { plural } from '../lib/format';
import { useAction } from '../lib/hooks';
import { rpc } from '../lib/rpc';
import { AcademicsPanel } from './Academics';

const TABS = ['mine', 'find', 'record', 'degree'] as const;
type CoursesTab = (typeof TABS)[number];

// S1 (my courses, find & join) plus A1/A2 (record and degree plan).
export function CoursesPage() {
  const params = useParams();
  const navigate = useNavigate();
  const tab: CoursesTab = TABS.includes(params.tab as CoursesTab) ? (params.tab as CoursesTab) : 'mine';

  return (
    <>
      <PageHeader title="Courses" subtitle="Your classes, finding new ones, and how they add up toward your degree." />
      <Tabs value={tab} onChange={(v) => navigate(`/courses/${v}`)} keepMounted={false} variant="pills" radius="xl">
        <Tabs.List mb="lg">
          <Tabs.Tab value="mine" leftSection={<IconSchool size={16} />}>
            My courses
          </Tabs.Tab>
          <Tabs.Tab value="find" leftSection={<IconSearch size={16} />}>
            Find courses
          </Tabs.Tab>
          <Tabs.Tab value="record" leftSection={<IconListDetails size={16} />}>
            Course record
          </Tabs.Tab>
          <Tabs.Tab value="degree" leftSection={<IconCertificate size={16} />}>
            Degree plan
          </Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="mine">
          <MyCourses />
        </Tabs.Panel>
        <Tabs.Panel value="find">
          <FindCourses />
        </Tabs.Panel>
        <Tabs.Panel value="record">
          <AcademicsPanel tab="record" />
        </Tabs.Panel>
        <Tabs.Panel value="degree">
          <AcademicsPanel tab="degree" />
        </Tabs.Panel>
      </Tabs>
    </>
  );
}

function MyCourses() {
  const mine = useQuery({ queryKey: ['classes', 'mine'], queryFn: () => rpc.classes.mine() });
  if (mine.isPending) return <Loading />;
  if (!mine.data?.length) {
    return (
      <Card>
        <Empty icon={<IconSchool size={22} />}>
          You haven't joined any courses yet.{' '}
          <Text span inherit c="periwinkle" fw={700} component={Link} to="/courses/find">
            Find your courses
          </Text>
        </Empty>
      </Card>
    );
  }
  return (
    <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="lg">
      {mine.data.map((c) => (
        <Card key={c.id} component={Link} to={`/classes/${c.id}`} className="clickable" padding="lg">
          <Group justify="space-between" mb="xs">
            <Text fw={700} fz={24} className="display">
              {c.subject} {c.number}
            </Text>
            <Tag>{c.term}</Tag>
          </Group>
          <Text>{c.title}</Text>
          <Group gap={4} mt="md" c="dimmed">
            <IconUsers size={16} />
            <Text size="sm">{plural(c.memberCount, 'student')} on UniLink</Text>
          </Group>
        </Card>
      ))}
    </SimpleGrid>
  );
}

function FindCourses() {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [term, setTerm] = useState<string>(CURRENT_TERM);
  const [subject, setSubject] = useState<string | null>(null);
  const [debounced] = useDebouncedValue(query, 200);

  const terms = useQuery({ queryKey: ['catalogue', 'terms'], queryFn: () => rpc.catalogue.terms() });
  const subjects = useQuery({ queryKey: ['catalogue', 'subjects'], queryFn: () => rpc.catalogue.subjects() });
  const results = useQuery({
    queryKey: ['catalogue', 'search', debounced, term, subject],
    queryFn: () => rpc.catalogue.search({ query: debounced, term, subject }),
    placeholderData: keepPreviousData,
  });
  const join = useAction((classId: number) => rpc.classes.join({ classId }), {
    success: 'Joined! Your classmates are here.',
    onSuccess: (_data, classId) => navigate(`/classes/${classId}`),
  });

  return (
    <SectionCard title="Find your courses">
      <Group mb="md" align="flex-end">
        <TextInput
          label="Course code or name"
          placeholder="e.g. COMP 251 or algorithms"
          leftSection={<IconSearch size={16} />}
          radius="xl"
          value={query}
          onChange={(e) => setQuery(e.currentTarget.value)}
          style={{ flex: 1 }}
          autoFocus
        />
        <Select label="Term" radius="xl" data={terms.data ?? [CURRENT_TERM]} value={term} onChange={(v) => v && setTerm(v)} w={160} allowDeselect={false} />
        <Select label="Subject" radius="xl" placeholder="Any" data={subjects.data ?? []} value={subject} onChange={setSubject} clearable searchable w={140} />
      </Group>
      {results.isPending ? (
        <Loading />
      ) : results.data?.length ? (
        <Table highlightOnHover verticalSpacing="sm">
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Course</Table.Th>
              <Table.Th>Title</Table.Th>
              <Table.Th>Credits</Table.Th>
              <Table.Th>Students</Table.Th>
              <Table.Th />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {results.data.map((c) => (
              <Table.Tr key={c.id}>
                <Table.Td fw={700} style={{ whiteSpace: 'nowrap' }}>
                  {c.subject} {c.number}
                </Table.Td>
                <Table.Td>{c.title}</Table.Td>
                <Table.Td>{c.credits}</Table.Td>
                <Table.Td>{c.memberCount}</Table.Td>
                <Table.Td ta="right">
                  {c.joined ? (
                    <Button size="xs" variant="light" component={Link} to={`/classes/${c.id}`}>
                      Open
                    </Button>
                  ) : (
                    <Button size="xs" onClick={() => join.mutate(c.id)} loading={join.isPending && join.variables === c.id}>
                      Join
                    </Button>
                  )}
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      ) : (
        <Empty>
          No courses match. Try a code like "MATH 240". The built-in catalogue is a sample of McGill courses for now.
          <Badge ml={6} size="xs" variant="light" color="yellow">
            sample
          </Badge>
        </Empty>
      )}
    </SectionCard>
  );
}
