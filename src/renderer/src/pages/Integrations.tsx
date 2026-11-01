import { useState } from 'react';
import { Badge, Button, Card, Group, List, SimpleGrid, Stack, Text, ThemeIcon } from '@mantine/core';
import { IconBook, IconBrandGoogle, IconDownload, IconSchool, IconUpload } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import { useAction } from '../lib/hooks';
import { rpc } from '../lib/rpc';
import { ClassSelect } from './Calendar';
import { t, term } from '../lib/i18n';

// G2: course catalogue, Google Calendar and myCourses.
export function IntegrationsPanel() {
  const stats = useQuery({ queryKey: ['catalogue', 'stats'], queryFn: () => rpc.catalogue.stats() });
  const [importClass, setImportClass] = useState<number | null>(null);
  const exportIcs = useAction(() => rpc.calendar.exportIcs(), {
    success: (r) => (r ? t('Exported {{count}} events to {{path}}', { count: r.count, path: r.path }) : ''),
  });
  const importIcs = useAction(() => rpc.calendar.importIcs({ classId: importClass }), {
    success: (r) =>
      r
        ? t('Imported {{count}} deadlines', { count: r.imported }) +
          (r.skipped ? ` ${t('(skipped {{count}} past or duplicate)', { count: r.skipped })}` : '')
        : '',
  });

  return (
    <>
      <Text c="dimmed" mb="md">
        {t('Connect UniLink to the McGill and Google tools you already use.')}
      </Text>
      <SimpleGrid cols={{ base: 1, lg: 3 }} spacing="lg">
        <Card withBorder padding="lg">
          <Stack h="100%">
            <Group justify="space-between">
              <ThemeIcon size="xl" variant="light" color="red">
                <IconBook size={22} />
              </ThemeIcon>
              <Badge color="yellow" variant="light">
                {t('Sample data')}
              </Badge>
            </Group>
            <Text fw={600}>{t('McGill course catalogue')}</Text>
            <Text size="sm" c="dimmed" style={{ flex: 1 }}>
              {t('Powers class search. UniLink ships with a built-in sample of {{count}} courses for {{terms}}.', {
                count: stats.data?.courses ?? 0,
                terms: stats.data?.terms.map((name) => term(name)).join(` ${t('and')} `) ?? '…',
              })}{' '}
              {t('A full import from the McGill eCalendar is planned (tech team decision).')}
            </Text>
          </Stack>
        </Card>

        <Card withBorder padding="lg">
          <Stack h="100%">
            <ThemeIcon size="xl" variant="light" color="blue">
              <IconBrandGoogle size={22} />
            </ThemeIcon>
            <Text fw={600}>{t('Google Calendar')}</Text>
            <List size="sm" c="dimmed" spacing={4} style={{ flex: 1 }}>
              <List.Item>{t('Export your class times, deadlines, graded work and study sessions as an .ics file.')}</List.Item>
              <List.Item>{t('In Google Calendar, open Settings → Import & export → Import, and pick the file.')}</List.Item>
              <List.Item>{t('Re-export after big changes. Live two-way sync is a later step.')}</List.Item>
            </List>
            <Button leftSection={<IconDownload size={16} />} onClick={() => exportIcs.mutate()} loading={exportIcs.isPending}>
              {t('Export .ics')}
            </Button>
          </Stack>
        </Card>

        <Card withBorder padding="lg">
          <Stack h="100%">
            <ThemeIcon size="xl" variant="light" color="grape">
              <IconSchool size={22} />
            </ThemeIcon>
            <Text fw={600}>{t('myCourses')}</Text>
            <List size="sm" c="dimmed" spacing={4}>
              <List.Item>{t('In myCourses, open Calendar and export or subscribe to it as an .ics file.')}</List.Item>
              <List.Item>{t('Import it here. Upcoming events become deadlines, matched to your classes by course code.')}</List.Item>
            </List>
            <div style={{ flex: 1 }}>
              <ClassSelect label={t('Attach everything to (optional)')} value={importClass} onChange={setImportClass} />
            </div>
            <Button variant="light" leftSection={<IconUpload size={16} />} onClick={() => importIcs.mutate()} loading={importIcs.isPending}>
              {t('Import .ics')}
            </Button>
          </Stack>
        </Card>
      </SimpleGrid>
    </>
  );
}
