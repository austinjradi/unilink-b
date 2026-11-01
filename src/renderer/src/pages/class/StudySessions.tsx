import { useState } from 'react';
import { Button, Group, Modal, Title } from '@mantine/core';
import { IconPlus, IconUsersGroup } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import { JoinByCode, SessionForm, SessionList, SessionsCard } from '../../components/Sessions';
import { Empty, Loading } from '../../components/ui';
import { rpc } from '../../lib/rpc';
import { t } from '../../lib/i18n';

// S3: the class's upcoming study sessions.
export function StudySessions({ classId }: { classId: number }) {
  const sessions = useQuery({ queryKey: ['studySessions', classId], queryFn: () => rpc.studySessions.list({ classId }) });
  const [creating, setCreating] = useState(false);

  return (
    <>
      <Group justify="space-between" mb="md">
        <Title order={2}>{t('Study Sessions')}</Title>
        <Group gap="sm">
          <JoinByCode />
          <Button leftSection={<IconPlus size={16} />} onClick={() => setCreating(true)}>
            {t('Create your study session')}
          </Button>
        </Group>
      </Group>
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
      <Modal opened={creating} onClose={() => setCreating(false)} title={t('Create a study session')} size="lg">
        {creating && <SessionForm classId={classId} existing={null} onDone={() => setCreating(false)} />}
      </Modal>
    </>
  );
}
