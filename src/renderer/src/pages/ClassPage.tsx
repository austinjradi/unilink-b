import { Box, Button, Card, Group, Stack, Tabs, Text } from '@mantine/core';
import { IconBrandWhatsapp, IconFileText, IconInfoCircle, IconMessages, IconPercentage, IconUsersGroup } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router';
import { CatalogueLink } from '../components/CatalogueLink';
import { ClashNote, Loading, PageHeader, Tag } from '../components/ui';
import { fmtMeetings } from '../lib/format';
import { useAction, useMe } from '../lib/hooks';
import { t, term, tx } from '../lib/i18n';
import { rpc } from '../lib/rpc';
import { useShowCount, useVariant } from '../lib/variants';
import { Assignments } from './class/Assignments';
import { Discussion } from './class/Discussion';
import { Grades } from './class/Grades';
import { GroupChats } from './class/GroupChats';
import { Overview } from './class/Overview';
import { StudySessions } from './class/StudySessions';
import { ReqInfo, WithInfo } from '../components/ReqInfo';

// `as const` at the end keeps each value as its exact string, so a tab can only be one of these.
const TABS = [
  { value: 'overview', label: tx('Overview'), icon: IconInfoCircle, info: 'tab-overview' },
  { value: 'discussion', label: tx('Discussion'), icon: IconMessages, info: 'feed-board' },
  { value: 'assignments', label: tx('Assignments'), icon: IconFileText, info: 'tab-assignments' },
  { value: 'chats', label: tx('Group chats'), icon: IconBrandWhatsapp, info: 'tab-chats' },
  { value: 'sessions', label: tx('Study Sessions'), icon: IconUsersGroup, info: 'tab-sessions' },
  { value: 'grades', label: tx('Grades'), icon: IconPercentage, info: 'tab-grades' },
] as const;

export function ClassPage() {
  // The route is /classes/:classId/:tab?, so params has classId
  // and maybe tab, always as strings (hence Number() below).
  const params = useParams();
  const navigate = useNavigate();
  const classId = Number(params.classId);
  // An unknown tab in the URL falls back to overview. The `!` tells
  // TypeScript that params.tab is defined, which some() has just shown.
  const tabInUrl = TABS.some((tabItem) => tabItem.value === params.tab) ? params.tab! : 'overview';

  // This section's details, including whether you've joined. When join.mutate()
  // succeeds, useAction refreshes this query and the page switches to the tabs.
  const cls = useQuery({ queryKey: ['classes', classId], queryFn: () => rpc.classes.get({ classId }) });
  const professor = useMe().role === 'professor';
  // success is a function here, so the message can depend on the
  // role. A function must return text that's already translated.
  const join = useAction(() => rpc.classes.join({ classId }), {
    success: () => (professor ? t('You now teach this section, and your name is on its course details.') : t('Joined!')),
  });
  const switchHere = useAction(() => rpc.classes.switchSection({ classId }), { success: 'Switched sections' });

  const showCount = useShowCount();
  const noTimes = useVariant('no-section-times');
  const chatsOnOverview = useVariant('chats-on-overview');
  const noProfessors = useVariant('no-professor-features');
  const postWithoutJoining = useVariant('post-without-joining');
  const tab = chatsOnOverview && tabInUrl === 'chats' ? 'overview' : tabInUrl;
  // Early returns must come after every hook call. React
  // relies on hooks running in the same order on every render.
  if (cls.isPending) return <Loading />;
  // Not pending and no data means the call failed, for example for a class that doesn't exist.
  if (!cls.data) return <Text c="red">{cls.error?.message}</Text>;
  // From here on TypeScript knows c isn't undefined, thanks to the early returns above.
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
            {c.title} · {t('{{count}} credits', { count: c.credits })}
            {showCount(c.memberCount) && ` · ${t('{{count}} students on UniLink', { count: c.memberCount })}`}
            {c.professors.length > 0 && ` · ${t('Taught by {{names}}', { names: c.professors.map((p) => p.name).join(', ') })}`}{' '}
            <Tag>{term(c.term)}</Tag> <CatalogueLink code={`${c.subject} ${c.number}`} />
          </>
        }
      />

      {/* Not joined: a card with Join or Switch. Joined: the tabs. */}
      {!c.joined ? (
        <>
        <Card padding="xl">
          {!noTimes && (c.times.length > 0 || c.clashesWith.length > 0) && (
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
              {/* `i > 0 && ' · '` adds a separator before every section except the first. */}
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
        {postWithoutJoining && (
          <Box mt="lg">
            <Discussion classId={classId} />
          </Box>
        )}
        </>
      ) : (
        // Controlled tabs: the URL decides which tab is open, and choosing a tab navigates.
        // keepMounted={false} unmounts hidden tabs, so each tab's queries run only when it's opened.
        <Tabs value={tab} onChange={(v) => navigate(`/classes/${classId}/${v}`)} keepMounted={false} variant="pills" radius="xl">
          <Tabs.List mb="lg">
            {/* Filter, then map, since switches can remove tabs. `icon: */}
            {/* Icon` renames the field while destructuring, because JSX */}
            {/* needs a capital letter to treat a name as a component. */}
            {TABS.filter((tabItem) => (!chatsOnOverview || tabItem.value !== 'chats') && (!noProfessors || tabItem.value !== 'assignments')).map(({ value, label, icon: Icon, info }) => (
              <Tabs.Tab key={value} value={value} leftSection={<Icon size={16} />} rightSection={<ReqInfo id={info} />}>
                {value === 'grades' && c.teaching ? t('Grading scheme') : t(label)}
              </Tabs.Tab>
            ))}
          </Tabs.List>
          <Tabs.Panel value="overview">
            <Overview classId={classId} cls={c} />
            {chatsOnOverview && (
              <Box mt="xl">
                <GroupChats classId={classId} classLabel={code} />
              </Box>
            )}
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
