import { Badge, Button, Card, Group, Tabs, Text } from '@mantine/core';
import { IconBrandWhatsapp, IconInfoCircle, IconMessages, IconPercentage, IconUsersGroup } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router';
import { Loading, PageHeader } from '../components/ui';
import { plural } from '../lib/format';
import { useAction } from '../lib/hooks';
import { rpc } from '../lib/rpc';
import { Discussion } from './class/Discussion';
import { Grades } from './class/Grades';
import { GroupChats } from './class/GroupChats';
import { Overview } from './class/Overview';
import { StudySessions } from './class/StudySessions';

const TABS = [
  { value: 'overview', label: 'Overview', icon: IconInfoCircle },
  { value: 'grades', label: 'Grades', icon: IconPercentage },
  { value: 'chats', label: 'Group chats', icon: IconBrandWhatsapp },
  { value: 'sessions', label: 'Study sessions', icon: IconUsersGroup },
  { value: 'discussion', label: 'Discussion', icon: IconMessages },
] as const;

export function ClassPage() {
  const params = useParams();
  const navigate = useNavigate();
  const classId = Number(params.classId);
  const tab = TABS.some((t) => t.value === params.tab) ? params.tab! : 'overview';

  const cls = useQuery({ queryKey: ['classes', classId], queryFn: () => rpc.classes.get({ classId }) });
  const join = useAction(() => rpc.classes.join({ classId }), { success: 'Joined!' });

  if (cls.isPending) return <Loading />;
  if (!cls.data) return <Text c="red">{cls.error?.message}</Text>;
  const c = cls.data;

  return (
    <>
      <PageHeader
        title={
          <Group gap="sm">
            {c.subject} {c.number}
            <Badge variant="light" size="lg">
              {c.term}
            </Badge>
          </Group>
        }
        subtitle={`${c.title} · ${c.credits} credits · ${plural(c.memberCount, 'student')} on UniLink`}
      />

      {!c.joined ? (
        <Card withBorder padding="xl">
          <Text mb="md">Join this class to see its group chats, study sessions and discussion board.</Text>
          <Button onClick={() => join.mutate()} loading={join.isPending}>
            Join {c.subject} {c.number}
          </Button>
        </Card>
      ) : (
        <Tabs value={tab} onChange={(v) => navigate(`/classes/${classId}/${v}`)} keepMounted={false}>
          <Tabs.List mb="lg">
            {TABS.map(({ value, label, icon: Icon }) => (
              <Tabs.Tab key={value} value={value} leftSection={<Icon size={16} />}>
                {label}
              </Tabs.Tab>
            ))}
          </Tabs.List>
          <Tabs.Panel value="overview">
            <Overview classId={classId} cls={c} />
          </Tabs.Panel>
          <Tabs.Panel value="grades">
            <Grades classId={classId} />
          </Tabs.Panel>
          <Tabs.Panel value="chats">
            <GroupChats classId={classId} />
          </Tabs.Panel>
          <Tabs.Panel value="sessions">
            <StudySessions classId={classId} />
          </Tabs.Panel>
          <Tabs.Panel value="discussion">
            <Discussion classId={classId} />
          </Tabs.Panel>
        </Tabs>
      )}
    </>
  );
}
