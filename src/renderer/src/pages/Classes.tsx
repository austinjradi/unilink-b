import { useState } from 'react';
import { Badge, Button, Card, Group, Select, SimpleGrid, Stack, Table, Text, TextInput } from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import { IconSearch, IconSchool, IconUsers } from '@tabler/icons-react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router';
import { CURRENT_TERM } from '@shared/dates';
import { Empty, Loading, PageHeader, SectionCard } from '../components/ui';
import { plural } from '../lib/format';
import { useAction } from '../lib/hooks';
import { rpc } from '../lib/rpc';

// S1: my classes, and the catalogue search to join more.
export function ClassesPage() {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [term, setTerm] = useState<string>(CURRENT_TERM);
  const [subject, setSubject] = useState<string | null>(null);
  const [debounced] = useDebouncedValue(query, 200);

  const mine = useQuery({ queryKey: ['classes', 'mine'], queryFn: () => rpc.classes.mine() });
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
    <>
      <PageHeader title="Classes" subtitle="Join your classes to find classmates, group chats and study sessions." />

      <Stack gap="lg">
        <SectionCard title="My classes">
          {mine.isPending ? (
            <Loading />
          ) : mine.data?.length ? (
            <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }}>
              {mine.data.map((c) => (
                <Card key={c.id} withBorder component={Link} to={`/classes/${c.id}`} className="clickable" padding="md">
                  <Group justify="space-between" mb={4}>
                    <Text fw={700}>
                      {c.subject} {c.number}
                    </Text>
                    <Badge variant="light">{c.term}</Badge>
                  </Group>
                  <Text size="sm">{c.title}</Text>
                  <Group gap={4} mt="sm" c="dimmed">
                    <IconUsers size={14} />
                    <Text size="xs">{plural(c.memberCount, 'student')}</Text>
                  </Group>
                </Card>
              ))}
            </SimpleGrid>
          ) : (
            <Empty icon={<IconSchool size={22} />}>You haven't joined any classes yet. Search for them below.</Empty>
          )}
        </SectionCard>

        <SectionCard title="Find classes">
          <Group mb="md" align="flex-end">
            <TextInput
              label="Course code or name"
              placeholder="e.g. COMP 251 or algorithms"
              leftSection={<IconSearch size={16} />}
              value={query}
              onChange={(e) => setQuery(e.currentTarget.value)}
              style={{ flex: 1 }}
              autoFocus
            />
            <Select label="Term" data={terms.data ?? [CURRENT_TERM]} value={term} onChange={(v) => v && setTerm(v)} w={160} allowDeselect={false} />
            <Select label="Subject" placeholder="Any" data={subjects.data ?? []} value={subject} onChange={setSubject} clearable searchable w={140} />
          </Group>

          {results.isPending ? (
            <Loading />
          ) : results.data?.length ? (
            <Table highlightOnHover verticalSpacing="xs">
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
                    <Table.Td fw={600} style={{ whiteSpace: 'nowrap' }}>
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
            <Empty>No classes match. Try a course code like "MATH 240".</Empty>
          )}
        </SectionCard>
      </Stack>
    </>
  );
}
