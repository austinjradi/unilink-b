import { Anchor, Badge, Button, Card, Checkbox, Group, SimpleGrid, Stack, Text } from '@mantine/core';
import { IconCalendarEvent, IconChecklist, IconSchool, IconUsersGroup } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { Link } from 'react-router';
import { ymd } from '@shared/dates';
import { Empty, KindBadge, kindColor, Loading, PageHeader, SectionCard } from '../components/ui';
import { fmtDateTime, fmtTime, fromNow } from '../lib/format';
import { useAction, useMe } from '../lib/hooks';
import { rpc } from '../lib/rpc';

function greeting() {
  const hour = new Date().getHours();
  return hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
}

export function Dashboard() {
  const me = useMe();
  const today = ymd(new Date());
  const agenda = useQuery({ queryKey: ['calendar', today, today], queryFn: () => rpc.calendar.range({ from: today, to: today }) });
  const tasks = useQuery({ queryKey: ['planner', 'today'], queryFn: () => rpc.planner.today() });
  const upcoming = useQuery({ queryKey: ['calendar', 'upcoming'], queryFn: () => rpc.calendar.upcoming({ days: 14 }) });
  const sessions = useQuery({ queryKey: ['studySessions', 'mine'], queryFn: () => rpc.studySessions.mine() });
  const classes = useQuery({ queryKey: ['classes', 'mine'], queryFn: () => rpc.classes.mine() });

  const setDone = useAction((v: { taskId: number; done: boolean }) => rpc.planner.setDone(v));
  const join = useAction((sessionId: number) => rpc.studySessions.join({ sessionId }), { success: "You're going!" });
  const decline = useAction((sessionId: number) => rpc.studySessions.leave({ sessionId }), { success: 'Invitation declined' });

  const schedule = agenda.data?.filter((e) => e.kind !== 'task') ?? [];
  const invitations = sessions.data?.filter((s) => s.myStatus === 'invited') ?? [];
  const going = sessions.data?.filter((s) => s.myStatus === 'going') ?? [];

  return (
    <>
      <PageHeader
        title={`${greeting()}, ${me.name.split(' ')[0]}`}
        subtitle={dayjs().format('dddd, MMMM D')}
        actions={
          classes.data?.length === 0 && (
            <Button component={Link} to="/classes" leftSection={<IconSchool size={16} />}>
              Find your classes
            </Button>
          )
        }
      />

      <SimpleGrid cols={{ base: 1, md: 2 }} spacing="lg">
        <SectionCard title="Today" actions={<Anchor component={Link} to="/calendar" size="sm">Calendar</Anchor>}>
          {agenda.isPending ? (
            <Loading />
          ) : schedule.length ? (
            <Stack gap="xs">
              {schedule.map((e) => (
                <Group key={e.key} gap="sm" wrap="nowrap">
                  <Text size="sm" w={48} c="dimmed">
                    {fmtTime(e.start)}
                  </Text>
                  <div className="event" style={{ ['--event-color' as string]: `var(--mantine-color-${kindColor(e.kind === 'deadline' ? e.detail : e.kind)}-6)`, flex: 1, marginBottom: 0 }}>
                    <Text size="sm" fw={500}>
                      {e.kind === 'deadline' ? `Due: ${e.title}` : e.title}
                    </Text>
                    <Text size="xs" c="dimmed">
                      {[e.classLabel !== e.title && e.classLabel, e.location].filter(Boolean).join(' · ')}
                    </Text>
                  </div>
                </Group>
              ))}
            </Stack>
          ) : (
            <Empty icon={<IconCalendarEvent size={22} />}>
              Nothing scheduled today. Add your class times from each class's Overview tab.
            </Empty>
          )}
        </SectionCard>

        <SectionCard title="Planned work for today" actions={<Anchor component={Link} to="/planner" size="sm">Planner</Anchor>}>
          {tasks.isPending ? (
            <Loading />
          ) : tasks.data?.length ? (
            <Stack gap="xs">
              {tasks.data.map((t) => (
                <Checkbox
                  key={t.id}
                  checked={!!t.doneAt}
                  onChange={(e) => setDone.mutate({ taskId: t.id, done: e.currentTarget.checked })}
                  label={
                    <Text size="sm" td={t.doneAt ? 'line-through' : undefined} c={t.doneAt ? 'dimmed' : undefined}>
                      {t.title} <Text span c="dimmed" size="xs">· {t.assignmentTitle} · {t.minutes} min</Text>
                      {t.scheduledFor < today && !t.doneAt && (
                        <Badge ml="xs" size="xs" color="red" variant="light">
                          overdue
                        </Badge>
                      )}
                    </Text>
                  }
                />
              ))}
            </Stack>
          ) : (
            <Empty icon={<IconChecklist size={22} />}>
              No planned work today. Add an assignment in the planner and UniLink will spread it out for you.
            </Empty>
          )}
        </SectionCard>

        <SectionCard title="Due in the next two weeks">
          {upcoming.isPending ? (
            <Loading />
          ) : upcoming.data?.length ? (
            <Stack gap="xs">
              {upcoming.data.map((e) => (
                <Group key={e.key} justify="space-between" wrap="nowrap">
                  <div style={{ minWidth: 0 }}>
                    <Text size="sm" fw={500} truncate>
                      {e.title}
                    </Text>
                    <Text size="xs" c="dimmed">
                      {[e.classLabel, fmtDateTime(e.start)].filter(Boolean).join(' · ')}
                    </Text>
                  </div>
                  <Group gap={6} wrap="nowrap">
                    <KindBadge kind={e.detail} />
                    <Text size="xs" c="dimmed" w={80} ta="right">
                      {fromNow(e.start)}
                    </Text>
                  </Group>
                </Group>
              ))}
            </Stack>
          ) : (
            <Empty>Nothing due soon.</Empty>
          )}
        </SectionCard>

        <SectionCard title="Study sessions">
          {sessions.isPending ? (
            <Loading />
          ) : invitations.length || going.length ? (
            <Stack gap="sm">
              {invitations.map((s) => (
                <Card key={s.id} withBorder padding="sm" bg="var(--mantine-color-indigo-light)">
                  <Text size="sm">
                    <b>{s.host?.name ?? 'A classmate'}</b> invited you to <b>{s.title}</b> ({s.classLabel})
                  </Text>
                  <Text size="xs" c="dimmed" mb="xs">
                    {fmtDateTime(s.startsAt)} · {s.location}
                  </Text>
                  <Group gap="xs">
                    <Button size="xs" onClick={() => join.mutate(s.id)} disabled={s.isFull}>
                      {s.isFull ? 'Full' : 'Accept'}
                    </Button>
                    <Button size="xs" variant="default" onClick={() => decline.mutate(s.id)}>
                      Decline
                    </Button>
                  </Group>
                </Card>
              ))}
              {going.map((s) => (
                <Group key={s.id} justify="space-between" wrap="nowrap">
                  <div>
                    <Anchor component={Link} to={`/classes/${s.classId}/sessions`} size="sm" fw={500}>
                      {s.title}
                    </Anchor>
                    <Text size="xs" c="dimmed">
                      {s.classLabel} · {fmtDateTime(s.startsAt)} · {s.location}
                    </Text>
                  </div>
                  <Badge variant="light" color="teal">
                    {s.going.length} going
                  </Badge>
                </Group>
              ))}
            </Stack>
          ) : (
            <Empty icon={<IconUsersGroup size={22} />}>No upcoming study sessions. Host one from any class page.</Empty>
          )}
        </SectionCard>
      </SimpleGrid>
    </>
  );
}
