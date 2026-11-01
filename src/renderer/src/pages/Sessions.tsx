import { useState } from 'react';
import { Button, Modal, Text, TextInput } from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import { IconPlus, IconSearch, IconUsersGroup } from '@tabler/icons-react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { SessionForm, SessionList, SessionsCard } from '../components/Sessions';
import { Empty, Loading, PageHeader } from '../components/ui';
import { rpc } from '../lib/rpc';

function CreateButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="md" leftSection={<IconPlus size={18} />} onClick={() => setOpen(true)}>
        Create your study session
      </Button>
      <Modal opened={open} onClose={() => setOpen(false)} title="Create a study session" size="lg">
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
        title="My upcoming study sessions"
        actions={
          <>
            <Button size="md" variant="default" component={Link} to="/sessions/search" leftSection={<IconSearch size={18} />}>
              Search for study sessions
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
                You're not in any upcoming sessions. Search for one to join, or create your own.
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
        crumbs={[{ label: 'Study sessions', to: '/sessions' }, { label: 'Search for sessions' }]}
        title="Search for sessions"
        subtitle="Upcoming study sessions in all your classes."
        actions={<CreateButton />}
      />
      <TextInput
        size="md"
        radius="xl"
        mb="md"
        maw={520}
        placeholder="Search by course, topic, type or place"
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
              {search ? 'No sessions match.' : 'No upcoming sessions in your classes yet.'}{' '}
              <Text span inherit>
                Be the first to create one!
              </Text>
            </Empty>
          }
        />
      )}
    </>
  );
}
