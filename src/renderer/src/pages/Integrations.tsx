import { useState } from 'react';
import { Badge, Button, Card, Group, List, SimpleGrid, Stack, Text, ThemeIcon } from '@mantine/core';
import { IconBook, IconBrandGoogle, IconDownload, IconSchool, IconUpload } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import { PageHeader } from '../components/ui';
import { useAction } from '../lib/hooks';
import { rpc } from '../lib/rpc';
import { ClassSelect } from './Calendar';

// G2: course catalogue, Google Calendar and myCourses.
export function IntegrationsPage() {
  const stats = useQuery({ queryKey: ['catalogue', 'stats'], queryFn: () => rpc.catalogue.stats() });
  const [importClass, setImportClass] = useState<number | null>(null);
  const exportIcs = useAction(() => rpc.calendar.exportIcs(), {
    success: (r) => (r ? `Exported ${r.count} events to ${r.path}` : ''),
  });
  const importIcs = useAction(() => rpc.calendar.importIcs({ classId: importClass }), {
    success: (r) => (r ? `Imported ${r.imported} deadlines${r.skipped ? `, skipped ${r.skipped} past or duplicate` : ''}` : ''),
  });

  return (
    <>
      <PageHeader title="Integrations" subtitle="Connect UniLink to the McGill and Google tools you already use." />
      <SimpleGrid cols={{ base: 1, lg: 3 }} spacing="lg">
        <Card withBorder padding="lg">
          <Stack h="100%">
            <Group justify="space-between">
              <ThemeIcon size="xl" variant="light" color="red">
                <IconBook size={22} />
              </ThemeIcon>
              <Badge color="yellow" variant="light">
                Sample data
              </Badge>
            </Group>
            <Text fw={600}>McGill course catalogue</Text>
            <Text size="sm" c="dimmed" style={{ flex: 1 }}>
              Powers class search. UniLink ships with a built-in sample of {stats.data?.courses ?? '…'} courses for{' '}
              {stats.data?.terms.join(' and ') ?? '…'}. A full import from the McGill eCalendar is planned (tech team
              decision).
            </Text>
          </Stack>
        </Card>

        <Card withBorder padding="lg">
          <Stack h="100%">
            <ThemeIcon size="xl" variant="light" color="blue">
              <IconBrandGoogle size={22} />
            </ThemeIcon>
            <Text fw={600}>Google Calendar</Text>
            <List size="sm" c="dimmed" spacing={4} style={{ flex: 1 }}>
              <List.Item>Export your class times, deadlines, graded work and study sessions as an .ics file.</List.Item>
              <List.Item>In Google Calendar, open Settings → Import & export → Import, and pick the file.</List.Item>
              <List.Item>Re-export after big changes. Live two-way sync is a later step.</List.Item>
            </List>
            <Button leftSection={<IconDownload size={16} />} onClick={() => exportIcs.mutate()} loading={exportIcs.isPending}>
              Export .ics
            </Button>
          </Stack>
        </Card>

        <Card withBorder padding="lg">
          <Stack h="100%">
            <ThemeIcon size="xl" variant="light" color="grape">
              <IconSchool size={22} />
            </ThemeIcon>
            <Text fw={600}>myCourses</Text>
            <List size="sm" c="dimmed" spacing={4}>
              <List.Item>In myCourses, open Calendar and export or subscribe to it as an .ics file.</List.Item>
              <List.Item>Import it here. Upcoming events become deadlines, matched to your classes by course code.</List.Item>
            </List>
            <div style={{ flex: 1 }}>
              <ClassSelect label="Attach everything to (optional)" value={importClass} onChange={setImportClass} />
            </div>
            <Button variant="light" leftSection={<IconUpload size={16} />} onClick={() => importIcs.mutate()} loading={importIcs.isPending}>
              Import .ics
            </Button>
          </Stack>
        </Card>
      </SimpleGrid>
    </>
  );
}
