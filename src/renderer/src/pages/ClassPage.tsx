import { Button, Card, Group, Stack, Tabs, Text } from '@mantine/core';
import { IconBrandWhatsapp, IconFileText, IconInfoCircle, IconMessages, IconPercentage, IconUsersGroup } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router';
import { ClashNote, Loading, PageHeader, Tag } from '../components/ui';
import { fmtMeetings } from '../lib/format';
import { useAction, useMe } from '../lib/hooks';
import { t, term, tx } from '../lib/i18n';
import { rpc } from '../lib/rpc';
import { Assignments } from './class/Assignments';
import { Discussion } from './class/Discussion';
import { Grades } from './class/Grades';
import { GroupChats } from './class/GroupChats';
import { Overview } from './class/Overview';
import { StudySessions } from './class/StudySessions';
import { ReqInfo, WithInfo } from '../components/ReqInfo';

const TABS = [
  { value: 'overview', label: tx('Overview'), icon: IconInfoCircle, info: 'tab-overview' },
  { value: 'discussion', label: tx('Discussion'), icon: IconMessages, info: 'feed-board' },
  { value: 'assignments', label: tx('Assignments'), icon: IconFileText, info: 'tab-assignments' },
  { value: 'chats', label: tx('Group chats'), icon: IconBrandWhatsapp, info: 'tab-chats' },
  { value: 'sessions', label: tx('Study Sessions'), icon: IconUsersGroup, info: 'tab-sessions' },
  { value: 'grades', label: tx('Grades'), icon: IconPercentage, info: 'tab-grades' },
] as const;

export function ClassPage() {
  const params = useParams();
  const navigate = useNavigate();
  const classId = Number(params.classId);
  const tab = TABS.some((tabItem) => tabItem.value === params.tab) ? params.tab! : 'overview';

  const cls = useQuery({ queryKey: ['classes', classId], queryFn: () => rpc.classes.get({ classId }) });
  const professor = useMe().role === 'professor';
  const join = useAction(() => rpc.classes.join({ classId }), {
    success: () => (professor ? t('You now teach this section, and your name is on its course details.') : t('Joined!')),
  });
  const switchHere = useAction(() => rpc.classes.switchSection({ classId }), { success: 'Switched sections' });

  if (cls.isPending) return <Loading />;
  if (!cls.data) return <Text c="red">{cls.error?.message}</Text>;
  const c = cls.data;
  const code = c.code;

  return (
    <>
      <PageHeader
        info="class-page"
        crumbs={[{ label: t('Courses'), to: '/courses' }, { label: code }]}
        title={code}
        subtitle={
          <>
            {c.title} · {t('{{count}} credits', { count: c.credits })} · {t('{{count}} students on UniLink', { count: c.memberCount })}
            {c.professors.length > 0 && ` · ${t('Taught by {{names}}', { names: c.professors.map((p) => p.name).join(', ') })}`}{' '}
            <Tag>{term(c.term)}</Tag>
          </>
        }
      />

      {!c.joined ? (
        <Card padding="xl">
          {(c.times.length > 0 || c.clashesWith.length > 0) && (
            <Stack gap={2} mb="md">
              {c.times.length > 0 && <Text size="sm">{t('Class times: {{times}}', { times: fmtMeetings(c.times) })} <ReqInfo id="find-times" /></Text>}
              <ClashNote codes={c.clashesWith} />
            </Stack>
          )}
          {c.otherSection ? (
            <>
              <Text mb="md">
                {t("You're in {{other}}. Each section has its own discussion, chats, sessions and shared course info, and you can be in one at a time.", { other: c.otherSection.code })}
              </Text>
              <Group>
                <WithInfo id="switch-section">
                  <Button onClick={() => switchHere.mutate()} loading={switchHere.isPending}>
                    {t('Switch to {{code}}', { code })}
                  </Button>
                </WithInfo>
                <Button variant="default" component={Link} to={`/classes/${c.otherSection.id}`}>
                  {t('Back to {{code}}', { code: c.otherSection.code })}
                </Button>
              </Group>
            </>
          ) : (
            <>
              <Text mb="md">
                {professor
                  ? t('Teach this section to run its grading scheme, details and class times, post assignments and moderate its discussion.')
                  : t('Join this section to see its group chats, study sessions, discussion and shared course info.')}
              </Text>
              <WithInfo id="join-section">
                <Button onClick={() => join.mutate()} loading={join.isPending}>
                  {professor ? t('Teach {{code}}', { code }) : t('Join {{code}}', { code })}
                </Button>
              </WithInfo>
            </>
          )}
          {c.sections.length > 1 && (
            <Text size="sm" c="dimmed" mt="lg">
              <ReqInfo id="sections-list" /> {t('Sections this term:')}{' '}
              {c.sections.map((s, i) => (
                <span key={s.id}>
                  {i > 0 && ' · '}
                  {s.id === c.id ? (
                    <b>{s.section}</b>
                  ) : (
                    <Text span inherit c="periwinkle" fw={700} component={Link} to={`/classes/${s.id}`}>
                      {s.section}
                    </Text>
                  )}{' '}
                  ({s.times.length > 0 && `${fmtMeetings(s.times)}, `}
                  {t('{{count}} students on UniLink', { count: s.memberCount })})
                </span>
              ))}
            </Text>
          )}
        </Card>
      ) : (
        <Tabs value={tab} onChange={(v) => navigate(`/classes/${classId}/${v}`)} keepMounted={false} variant="pills" radius="xl">
          <Tabs.List mb="lg">
            {TABS.map(({ value, label, icon: Icon, info }) => (
              <Tabs.Tab key={value} value={value} leftSection={<Icon size={16} />} rightSection={<ReqInfo id={info} />}>
                {value === 'grades' && c.teaching ? t('Grading scheme') : t(label)}
              </Tabs.Tab>
            ))}
          </Tabs.List>
          <Tabs.Panel value="overview">
            <Overview classId={classId} cls={c} />
          </Tabs.Panel>
          <Tabs.Panel value="discussion">
            <Discussion classId={classId} />
          </Tabs.Panel>
          <Tabs.Panel value="assignments">
            <Assignments classId={classId} />
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
