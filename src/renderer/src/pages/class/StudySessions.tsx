import { useState } from 'react';
import { Button, Collapse, Group, Modal, Stack, Text, Title } from '@mantine/core';
import { IconCalendarQuestion, IconChevronDown, IconChevronRight, IconPlus, IconUsersGroup } from '@tabler/icons-react';
import dayjs from 'dayjs';
import { useQuery } from '@tanstack/react-query';
import { JoinByCode, SessionForm, SessionList, SessionsCard } from '../../components/Sessions';
import { TimePollForm, TimePolls } from '../../components/TimePolls';
import { Empty, Loading } from '../../components/ui';
import { rpc } from '../../lib/rpc';
import { t } from '../../lib/i18n';

// S3: the class's upcoming study sessions.
export function StudySessions({ classId }: { classId: number }) {
  const sessions = useQuery({ queryKey: ['studySessions', classId], queryFn: () => rpc.studySessions.list({ classId }) });
  const [creating, setCreating] = useState(false);
  const [asking, setAsking] = useState(false);

  return (
    <>
      <Group justify="space-between" mb="md">
        <Title order={2}>{t('Study Sessions')}</Title>
        <Group gap="sm">
          <JoinByCode />
          <Button variant="default" leftSection={<IconCalendarQuestion size={16} />} onClick={() => setAsking(true)}>
            {t('Find a time')}
          </Button>
          <Button leftSection={<IconPlus size={16} />} onClick={() => setCreating(true)}>
            {t('Create your study session')}
          </Button>
        </Group>
      </Group>
      <TimePolls classId={classId} />
      <SessionsCard>
        {sessions.isPending ? (
          <Loading />
        ) : (
          <SessionList
            sessions={sessions.data ?? []}
            empty={<Empty icon={<IconUsersGroup size={22} />}>{t('No open sessions planned. Create one and share its invite code!')}</Empty>}
          />
        )}
      </SessionsCard>
      <PastSessions classId={classId} />
      <Modal opened={creating} onClose={() => setCreating(false)} title={t('Create a study session')} size="lg">
        {creating && <SessionForm classId={classId} existing={null} onDone={() => setCreating(false)} />}
      </Modal>
      <Modal opened={asking} onClose={() => setAsking(false)} title={t('Find a time that works')}>
        {asking && <TimePollForm classId={classId} onDone={() => setAsking(false)} />}
      </Modal>
    </>
  );
}

// Sessions that are over, so the section can see what's been happening.
function PastSessions({ classId }: { classId: number }) {
  const past = useQuery({ queryKey: ['studySessions', classId, 'past'], queryFn: () => rpc.studySessions.past({ classId }) });
  const [open, setOpen] = useState(false);
  if (!past.data?.length) return null;
  return (
    <Stack gap="xs" mt="md">
      <Button
        variant="subtle"
        color="gray"
        size="compact-sm"
        w="fit-content"
        leftSection={open ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />}
        onClick={() => setOpen((o) => !o)}
      >
        {t('Earlier sessions ({{count}})', { count: past.data.length })}
      </Button>
      <Collapse expanded={open}>
        <Stack gap={6} pl="md">
          {past.data.map((s) => (
            <Group key={s.id} gap="sm" wrap="nowrap">
              <Text size="sm" c="dimmed" w={110} style={{ flex: 'none' }}>
                {dayjs(s.startsAt).format(t('ddd, MMM D'))}
              </Text>
              <Text size="sm" fw={700} truncate>
                {s.title}
              </Text>
              <Text size="xs" c="dimmed" style={{ whiteSpace: 'nowrap' }}>
                {t('{{count}} went', { count: s.goingCount })}
              </Text>
            </Group>
          ))}
        </Stack>
      </Collapse>
    </Stack>
  );
}
