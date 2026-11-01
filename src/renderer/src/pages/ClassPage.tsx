import { Button, Card, Tabs, Text } from '@mantine/core';
import { IconBrandWhatsapp, IconInfoCircle, IconMessages, IconPercentage, IconUsersGroup } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router';
import { Loading, PageHeader, Tag } from '../components/ui';
import { useAction } from '../lib/hooks';
import { t, term, tx } from '../lib/i18n';
import { rpc } from '../lib/rpc';
import { Discussion } from './class/Discussion';
import { Grades } from './class/Grades';
import { GroupChats } from './class/GroupChats';
import { Overview } from './class/Overview';
import { StudySessions } from './class/StudySessions';

const TABS = [
  { value: 'overview', label: tx('Overview'), icon: IconInfoCircle },
  { value: 'discussion', label: tx('Discussion'), icon: IconMessages },
  { value: 'chats', label: tx('Group chats'), icon: IconBrandWhatsapp },
  { value: 'sessions', label: tx('Study Sessions'), icon: IconUsersGroup },
  { value: 'grades', label: tx('Grades'), icon: IconPercentage },
] as const;

export function ClassPage() {
  const params = useParams();
  const navigate = useNavigate();
  const classId = Number(params.classId);
  const tab = TABS.some((tabItem) => tabItem.value === params.tab) ? params.tab! : 'overview';

  const cls = useQuery({ queryKey: ['classes', classId], queryFn: () => rpc.classes.get({ classId }) });
  const join = useAction(() => rpc.classes.join({ classId }), { success: 'Joined!' });

  if (cls.isPending) return <Loading />;
  if (!cls.data) return <Text c="red">{cls.error?.message}</Text>;
  const c = cls.data;
  const code = `${c.subject} ${c.number}`;

  return (
    <>
      <PageHeader
        crumbs={[{ label: t('Courses'), to: '/courses' }, { label: code }]}
        title={code}
        subtitle={
          <>
            {c.title} · {t('{{count}} credits', { count: c.credits })} · {t('{{count}} students on UniLink', { count: c.memberCount })}{' '}
            <Tag>{term(c.term)}</Tag>
          </>
        }
      />

      {!c.joined ? (
        <Card padding="xl">
          <Text mb="md">{t('Join this class to see its group chats, study sessions and discussions.')}</Text>
          <Button onClick={() => join.mutate()} loading={join.isPending}>
            {t('Join {{code}}', { code })}
          </Button>
        </Card>
      ) : (
        <Tabs value={tab} onChange={(v) => navigate(`/classes/${classId}/${v}`)} keepMounted={false} variant="pills" radius="xl">
          <Tabs.List mb="lg">
            {TABS.map(({ value, label, icon: Icon }) => (
              <Tabs.Tab key={value} value={value} leftSection={<Icon size={16} />}>
                {t(label)}
              </Tabs.Tab>
            ))}
          </Tabs.List>
          <Tabs.Panel value="overview">
            <Overview classId={classId} cls={c} />
          </Tabs.Panel>
          <Tabs.Panel value="discussion">
            <Discussion classId={classId} />
          </Tabs.Panel>
          <Tabs.Panel value="chats">
            <GroupChats classId={classId} classLabel={code} />
          </Tabs.Panel>
          <Tabs.Panel value="sessions">
            <StudySessions classId={classId} />
          </Tabs.Panel>
          <Tabs.Panel value="grades">
            <Grades classId={classId} />
          </Tabs.Panel>
        </Tabs>
      )}
    </>
  );
}
