import { Alert, Badge, Button, Card, Grid, Group, List, Stack, Switch, Text, ThemeIcon, Title } from '@mantine/core';
import { IconBellOff, IconFocus2, IconInfoCircle } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import { Empty, Loading, SectionCard } from '../components/ui';
import { fmtDateTime, fmtTime } from '../lib/format';
import { useAction } from '../lib/hooks';
import { type Out, rpc } from '../lib/rpc';

type Status = Out<typeof rpc.studyMode.status>;

// ST1: study mode.
export function StudyModePanel() {
  const status = useQuery({ queryKey: ['studyMode', 'status'], queryFn: () => rpc.studyMode.status(), refetchInterval: 15_000 });
  if (status.isPending || !status.data) return <Loading />;

  return (
    <>
      <Text c="dimmed" mb="md">
        Turns on by itself during your classes and study sessions, and holds back notifications until it's over.
      </Text>
      <Grid gap="lg">
        <Grid.Col span={{ base: 12, lg: 7 }}>
          <Stack gap="lg">
            <StatusCard status={status.data} />
            <Settings status={status.data} />
          </Stack>
        </Grid.Col>
        <Grid.Col span={{ base: 12, lg: 5 }}>
          <Stack gap="lg">
            <PerClass enabled={status.data.settings.autoForClasses} />
            <Alert variant="light" icon={<IconInfoCircle size={18} />} title="What study mode can't do yet">
              <List size="sm" spacing={4}>
                <List.Item>
                  <b>Block distracting websites.</b> A desktop app can't block sites in your browser without admin rights
                  or a browser extension. A companion extension that reads UniLink's study mode is the planned route.
                </List.Item>
                <List.Item>
                  It only switches on and off while UniLink is open. It isn't a background service.
                </List.Item>
                <List.Item>
                  System-wide Do Not Disturb works on GNOME (Ubuntu) only. Windows and macOS don't let apps turn on Focus.
                </List.Item>
              </List>
            </Alert>
          </Stack>
        </Grid.Col>
      </Grid>
    </>
  );
}

function StatusCard({ status }: { status: Status }) {
  const start = useAction((minutes: number) => rpc.studyMode.start({ minutes }), { success: 'Focus session started' });
  const stop = useAction(() => rpc.studyMode.stop(), { success: 'Study mode off' });

  return (
    <Card withBorder padding="xl" bg={status.active ? 'var(--mantine-color-teal-light)' : undefined}>
      <Group justify="space-between" align="flex-start">
        <Group align="flex-start">
          <ThemeIcon size={48} radius="xl" color={status.active ? 'teal' : 'gray'} variant={status.active ? 'filled' : 'light'}>
            <IconFocus2 size={26} />
          </ThemeIcon>
          <div>
            <Title order={3}>{status.active ? 'Study mode is on' : 'Study mode is off'}</Title>
            {status.active ? (
              <Text>
                {status.reason === 'manual' ? 'Focus session' : status.label} · until {fmtTime(status.until!)}
                {status.settings.silenceNotifications && (
                  <Text span c="dimmed" size="sm">
                    {' '}
                    · notifications held
                  </Text>
                )}
              </Text>
            ) : status.pausedWindow ? (
              <Text c="dimmed">
                Switched off for {status.pausedWindow.label} (until {fmtTime(status.pausedWindow.end)}).
              </Text>
            ) : status.next ? (
              <Text c="dimmed">
                Next: {status.next.label} at {fmtDateTime(status.next.start)}
              </Text>
            ) : (
              <Text c="dimmed">No classes or study sessions coming up today.</Text>
            )}
          </div>
        </Group>
        {status.active && (
          <Button color="teal" variant="white" onClick={() => stop.mutate()} loading={stop.isPending}>
            Stop
          </Button>
        )}
      </Group>
      {!status.active && (
        <Group mt="lg" gap="xs">
          <Text size="sm" fw={500} mr="xs">
            Start a focus session:
          </Text>
          {[25, 50, 90].map((m) => (
            <Button key={m} variant="light" size="xs" onClick={() => start.mutate(m)}>
              {m} min
            </Button>
          ))}
        </Group>
      )}
    </Card>
  );
}

function Settings({ status }: { status: Status }) {
  const s = status.settings;
  const update = useAction((patch: Partial<typeof s>) => rpc.studyMode.updateSettings({ ...s, ...patch }));

  return (
    <SectionCard title="Settings">
      <Stack>
        <Switch
          label="Turn on during my class times"
          description="Uses the class times on each class's Overview tab"
          checked={s.autoForClasses}
          onChange={(e) => update.mutate({ autoForClasses: e.currentTarget.checked })}
        />
        <Switch
          label="Turn on during study sessions I'm going to"
          checked={s.autoForSessions}
          onChange={(e) => update.mutate({ autoForSessions: e.currentTarget.checked })}
        />
        <Switch
          label="Hold UniLink notifications while it's on"
          description="You'll see them all when study mode ends"
          checked={s.silenceNotifications}
          onChange={(e) => update.mutate({ silenceNotifications: e.currentTarget.checked })}
        />
        <Switch
          label={
            <Group gap={6}>
              Also turn on system Do Not Disturb <IconBellOff size={14} />
            </Group>
          }
          description={
            status.systemDndSupported
              ? 'Silences notifications from every app (GNOME), and switches back afterwards'
              : 'Only available on GNOME desktops'
          }
          disabled={!status.systemDndSupported}
          checked={s.systemDnd && status.systemDndSupported}
          onChange={(e) => update.mutate({ systemDnd: e.currentTarget.checked })}
        />
      </Stack>
    </SectionCard>
  );
}

function PerClass({ enabled }: { enabled: boolean }) {
  const classes = useQuery({ queryKey: ['studyMode', 'classes'], queryFn: () => rpc.studyMode.classes() });
  const set = useAction((v: { classId: number; enabled: boolean }) => rpc.studyMode.setClassAuto(v));

  return (
    <SectionCard title="Per class">
      {classes.isPending ? (
        <Loading />
      ) : classes.data?.length ? (
        <Stack gap="sm">
          {!enabled && (
            <Badge color="gray" variant="light">
              Class times are switched off in settings
            </Badge>
          )}
          {classes.data.map((c) => (
            <Switch
              key={c.classId}
              label={`${c.subject} ${c.number}`}
              description={c.term}
              checked={c.auto}
              disabled={!enabled}
              onChange={(e) => set.mutate({ classId: c.classId, enabled: e.currentTarget.checked })}
            />
          ))}
        </Stack>
      ) : (
        <Empty>Join classes to choose which ones turn study mode on.</Empty>
      )}
    </SectionCard>
  );
}
