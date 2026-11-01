import { useState } from 'react';
import {
  ActionIcon,
  Anchor,
  Badge,
  Button,
  Card,
  Checkbox,
  Collapse,
  Group,
  RingProgress,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
} from '@mantine/core';
import { DateInput } from '@mantine/dates';
import { IconCalendarEvent, IconChevronDown, IconChevronRight, IconListCheck, IconSchool, IconTrash, IconUsersGroup } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { Link } from 'react-router';
import { ymd } from '@shared/dates';
import { Empty, KindBadge, kindColor, Loading, PageHeader, SectionCard } from '../components/ui';
import { dayLabel, fmtDateTime, fmtTime, fromNow, toDate } from '../lib/format';
import { useAction, useMe } from '../lib/hooks';
import { type Out, rpc } from '../lib/rpc';

type TodayItem = Out<typeof rpc.todos.today>['today'][number];

function greeting() {
  const hour = new Date().getHours();
  return hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
}

export function Dashboard() {
  const me = useMe();
  const classes = useQuery({ queryKey: ['classes', 'mine'], queryFn: () => rpc.classes.mine() });

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
      <Stack gap="lg">
        <TodayTasks />
        <SimpleGrid cols={{ base: 1, md: 3 }} spacing="lg">
          <UpcomingDeadlines />
          <TodaySchedule />
          <StudySessionsCard />
        </SimpleGrid>
      </Stack>
    </>
  );
}

// ST3: today's tasks first — planned work (ST2) and the student's own to-dos.
function TodayTasks() {
  const today = ymd(new Date());
  const data = useQuery({ queryKey: ['todos', 'today'], queryFn: () => rpc.todos.today() });
  const [title, setTitle] = useState('');
  const [due, setDue] = useState<string | null>(null);
  const [showLater, setShowLater] = useState(false);

  const add = useAction(() => rpc.todos.add({ title, dueDate: due, classId: null }), {
    onSuccess: () => {
      setTitle('');
      setDue(null);
    },
  });

  const items = data.data?.today ?? [];
  const done = items.filter((i) => i.done).length;

  return (
    <SectionCard
      title={
        <Group gap="sm">
          <IconListCheck size={20} />
          Today's tasks
        </Group>
      }
      actions={
        items.length > 0 && (
          <Group gap="xs">
            <Text size="sm" c="dimmed">
              {done} of {items.length} done
            </Text>
            <RingProgress size={34} thickness={4} roundCaps sections={[{ value: (done / items.length) * 100, color: 'teal' }]} />
          </Group>
        )
      }
    >
      {data.isPending ? (
        <Loading />
      ) : (
        <Stack gap={6}>
          {items.length === 0 && (
            <Text size="sm" c="dimmed" mb="xs">
              Nothing planned for today. Add a task below, or plan an assignment in the{' '}
              <Anchor component={Link} to="/planner" size="sm">
                planner
              </Anchor>
              .
            </Text>
          )}
          {items.map((item) => (
            <TaskRow key={item.key} item={item} today={today} />
          ))}

          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (title.trim()) add.mutate();
            }}
          >
            <Group gap="xs" mt="xs" wrap="nowrap">
              <TextInput placeholder="Add a task…" value={title} onChange={(e) => setTitle(e.currentTarget.value)} style={{ flex: 1 }} />
              <DateInput
                placeholder="Any day"
                value={due}
                onChange={(v) => setDue(v ? ymd(toDate(v)!) : null)}
                clearable
                minDate={new Date()}
                valueFormat="ddd D MMM"
                w={150}
                aria-label="Due date"
              />
              <Button type="submit" variant="light" disabled={!title.trim()} loading={add.isPending}>
                Add
              </Button>
            </Group>
          </form>

          {!!data.data?.later.length && (
            <>
              <Button
                variant="subtle"
                color="gray"
                size="compact-sm"
                w="fit-content"
                mt="xs"
                leftSection={showLater ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />}
                onClick={() => setShowLater((s) => !s)}
              >
                Later ({data.data.later.length})
              </Button>
              <Collapse expanded={showLater}>
                <Stack gap={6}>
                  {data.data.later.map((item) => (
                    <TaskRow key={item.key} item={item} today={today} />
                  ))}
                </Stack>
              </Collapse>
            </>
          )}
        </Stack>
      )}
    </SectionCard>
  );
}

function TaskRow({ item, today }: { item: TodayItem; today: string }) {
  const toggle = useAction((done: boolean) =>
    item.kind === 'task' ? rpc.planner.setDone({ taskId: item.id, done }) : rpc.todos.setDone({ id: item.id, done }),
  );
  const remove = useAction(() => rpc.todos.remove({ id: item.id }));

  return (
    <Group gap="sm" wrap="nowrap">
      <Checkbox checked={item.done} onChange={(e) => toggle.mutate(e.currentTarget.checked)} aria-label={`Done: ${item.title}`} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <Text size="sm" td={item.done ? 'line-through' : undefined} c={item.done ? 'dimmed' : undefined} truncate>
          {item.title}
        </Text>
        {item.context && (
          <Text size="xs" c="dimmed" truncate>
            {item.context}
          </Text>
        )}
      </div>
      {item.overdue && (
        <Badge size="sm" color="red" variant="light">
          {item.kind === 'task' ? 'missed' : `due ${dayLabel(item.due!, today).toLowerCase()}`}
        </Badge>
      )}
      {!item.overdue && item.kind === 'todo' && item.due && item.due !== today && (
        <Badge size="sm" variant="default">
          {dayLabel(item.due, today)}
        </Badge>
      )}
      {item.progress && (
        <Badge size="sm" variant="light" color="teal">
          {item.progress.done} of {item.progress.total} done
        </Badge>
      )}
      {item.kind === 'todo' && (
        <ActionIcon variant="subtle" color="gray" size="sm" onClick={() => remove.mutate()} aria-label="Delete task">
          <IconTrash size={14} />
        </ActionIcon>
      )}
    </Group>
  );
}

// ST3: then upcoming deadlines from A3, by date. The student's own deadlines can be checked off.
function UpcomingDeadlines() {
  const upcoming = useQuery({ queryKey: ['calendar', 'upcoming'], queryFn: () => rpc.calendar.upcoming({ days: 14 }) });
  const setDone = useAction((id: number) => rpc.calendar.setDeadlineDone({ id, done: true }), { success: 'Nice! Marked as done.' });

  return (
    <SectionCard title="Upcoming deadlines" actions={<Anchor component={Link} to="/calendar" size="sm">Calendar</Anchor>}>
      {upcoming.isPending ? (
        <Loading />
      ) : upcoming.data?.length ? (
        <Stack gap="sm">
          {upcoming.data.map((e) => (
            <Group key={e.key} gap="sm" wrap="nowrap" align="flex-start">
              {e.deadlineId != null ? (
                <Checkbox mt={2} onChange={() => setDone.mutate(e.deadlineId!)} aria-label={`Mark ${e.title} done`} />
              ) : (
                <div style={{ width: 20 }} />
              )}
              <div style={{ flex: 1, minWidth: 0 }}>
                <Text size="sm" fw={500} truncate>
                  {e.title}
                </Text>
                <Text size="xs" c="dimmed">
                  {[e.classLabel, fmtDateTime(e.start)].filter(Boolean).join(' · ')}
                </Text>
              </div>
              <Stack gap={2} align="flex-end">
                <KindBadge kind={e.detail} />
                <Text size="xs" c="dimmed">
                  {fromNow(e.start)}
                </Text>
              </Stack>
            </Group>
          ))}
        </Stack>
      ) : (
        <Empty>Nothing due in the next two weeks.</Empty>
      )}
    </SectionCard>
  );
}

function TodaySchedule() {
  const today = ymd(new Date());
  const agenda = useQuery({ queryKey: ['calendar', today, today], queryFn: () => rpc.calendar.range({ from: today, to: today }) });
  const schedule = agenda.data?.filter((e) => e.kind === 'class' || e.kind === 'session') ?? [];

  return (
    <SectionCard title="Today's schedule">
      {agenda.isPending ? (
        <Loading />
      ) : schedule.length ? (
        <Stack gap="xs">
          {schedule.map((e) => (
            <Group key={e.key} gap="sm" wrap="nowrap">
              <Text size="sm" w={44} c="dimmed">
                {fmtTime(e.start)}
              </Text>
              <div
                className="event"
                style={{ ['--event-color' as string]: `var(--mantine-color-${kindColor(e.kind)}-6)`, flex: 1, marginBottom: 0 }}
              >
                <Text size="sm" fw={500}>
                  {e.title}
                </Text>
                <Text size="xs" c="dimmed">
                  {[e.classLabel !== e.title && e.classLabel, e.location].filter(Boolean).join(' · ')}
                </Text>
              </div>
            </Group>
          ))}
        </Stack>
      ) : (
        <Empty icon={<IconCalendarEvent size={22} />}>No classes or sessions today.</Empty>
      )}
    </SectionCard>
  );
}

function StudySessionsCard() {
  const sessions = useQuery({ queryKey: ['studySessions', 'mine'], queryFn: () => rpc.studySessions.mine() });
  const join = useAction((sessionId: number) => rpc.studySessions.join({ sessionId }), { success: "You're going!" });
  const decline = useAction((sessionId: number) => rpc.studySessions.leave({ sessionId }), { success: 'Invitation declined' });
  const invitations = sessions.data?.filter((s) => s.myStatus === 'invited') ?? [];
  const going = sessions.data?.filter((s) => s.myStatus === 'going') ?? [];

  return (
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
            <div key={s.id}>
              <Anchor component={Link} to={`/classes/${s.classId}/sessions`} size="sm" fw={500}>
                {s.title}
              </Anchor>
              <Text size="xs" c="dimmed">
                {s.classLabel} · {fmtDateTime(s.startsAt)} · {s.going.length} going
              </Text>
            </div>
          ))}
        </Stack>
      ) : (
        <Empty icon={<IconUsersGroup size={22} />}>No upcoming study sessions. Host one from any class page.</Empty>
      )}
    </SectionCard>
  );
}
