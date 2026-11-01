import { useState } from 'react';
import { Button, Modal, Text, TextInput } from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import { IconPlus, IconSearch, IconUsersGroup } from '@tabler/icons-react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { JoinByCode, SessionForm, SessionList, SessionsCard } from '../components/Sessions';
import { Empty, Loading, PageHeader } from '../components/ui';
import { rpc } from '../lib/rpc';
import { t } from '../lib/i18n';

function CreateButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="md" leftSection={<IconPlus size={18} />} onClick={() => setOpen(true)}>
        {t('Create your study session')}
      </Button>
      <Modal opened={open} onClose={() => setOpen(false)} title={t('Create a study session')} size="lg">
        {open && <SessionForm classId={null} existing={null} onDone={() => setOpen(false)} />}
      </Modal>
    </>
  );
}

// "My upcoming study sessions" (A2Team.pdf p. 13).
export function SessionsPage() {
  const mine = useQuery({ queryKey: ['studySessions', 'mine'], queryFn: () => rpc.studySessions.mine() });
  return (
    <>
      <PageHeader
        title={t('My upcoming study sessions')}
        actions={
          <>
            <JoinByCode />
            <Button size="md" variant="default" component={Link} to="/sessions/search" leftSection={<IconSearch size={18} />}>
              {t('Search for study sessions')}
            </Button>
            <CreateButton />
          </>
        }
      />
      <SessionsCard>
        {mine.isPending ? (
          <Loading />
        ) : (
          <SessionList
            sessions={mine.data ?? []}
            empty={
              <Empty icon={<IconUsersGroup size={22} />}>
                {t("You're not in any upcoming sessions. Search for one to join, enter an invite code, or create your own.")}
              </Empty>
            }
          />
        )}
      </SessionsCard>
    </>
  );
}

// "Study sessions > Search for sessions" (A2Team.pdf p. 12).
export function SessionSearchPage() {
  const [search, setSearch] = useState('');
  const [debounced] = useDebouncedValue(search, 200);
  const found = useQuery({
    queryKey: ['studySessions', 'browse', debounced],
    queryFn: () => rpc.studySessions.browse({ search: debounced }),
    placeholderData: keepPreviousData,
  });
  return (
    <>
      <PageHeader
        crumbs={[{ label: t('Study Sessions'), to: '/sessions' }, { label: t('Search for sessions') }]}
        title={t('Search for sessions')}
        subtitle={t('Upcoming open sessions in all your classes. Invite-only sessions need their code.')}
        actions={<CreateButton />}
      />
      <TextInput
        size="md"
        radius="xl"
        mb="md"
        maw={520}
        placeholder={t('Search by course, topic, type or place')}
        leftSection={<IconSearch size={18} />}
        value={search}
        onChange={(e) => setSearch(e.currentTarget.value)}
        autoFocus
      />
      {found.isPending ? (
        <Loading />
      ) : (
        <SessionList
          sessions={found.data ?? []}
          empty={
            <Empty>
              {search ? t('No sessions match.') : t('No upcoming sessions in your classes yet.')}{' '}
              <Text span inherit>
                {t('Be the first to create one!')}
              </Text>
            </Empty>
          }
        />
      )}
    </>
  );
}
