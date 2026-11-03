import { useEffect, useState } from 'react';
import { Alert, Badge, Button, Card, Grid, Group, List, SimpleGrid, Stack, Switch, Text, ThemeIcon, Title } from '@mantine/core';
import { IconBellOff, IconFocus2, IconInfoCircle } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import { Empty, Loading, PageHeader, SectionCard } from '../components/ui';
import { fmtDateTime, fmtTime } from '../lib/format';
import { useAction } from '../lib/hooks';
import { type Out, rpc } from '../lib/rpc';
import { t, term } from '../lib/i18n';
import { ReqInfo, WithInfo } from '../components/ReqInfo';

type Status = Out<typeof rpc.studyMode.status>;

// ST1: study mode, its own tab in the top navigation.
export function StudyModePage() {
  const status = useQuery({ queryKey: ['studyMode', 'status'], queryFn: () => rpc.studyMode.status(), refetchInterval: 15_000 });
  if (status.isPending || !status.data) return <Loading />;

  return (
    <>
      <PageHeader
        info="study-page"
        title={t('Study Mode')}
        subtitle={t("Turns on by itself during your classes and study sessions, and holds back notifications until it's over.")}
      />
      <Grid gap="lg">
        <Grid.Col span={{ base: 12, lg: 7 }}>
          <Stack gap="lg">
            <StatusCard status={status.data} />
            <FocusTime />
            <Settings status={status.data} />
          </Stack>
        </Grid.Col>
        <Grid.Col span={{ base: 12, lg: 5 }}>
          <Stack gap="lg">
            <PerClass enabled={status.data.settings.autoForClasses} />
            <Alert variant="light" icon={<IconInfoCircle size={18} />} title={<WithInfo id="study-limits">{t("What study mode can't do yet")}</WithInfo>}>
              <List size="sm" spacing={4}>
                <List.Item>
                  <b>{t('Block distracting websites.')}</b>{' '}
                  {t("A web page can't block other sites. A companion browser extension that reads UniLink's study mode is the planned route.")}
                </List.Item>
                <List.Item>
                  {t("It only switches on and off while a UniLink tab is open. It isn't a background service.")}
                </List.Item>
                <List.Item>
                  {t("A web page can't turn on your computer's Do Not Disturb. The desktop app can, on GNOME (Ubuntu).")}
                </List.Item>
              </List>
            </Alert>
          </Stack>
        </Grid.Col>
      </Grid>
    </>
  );
}

// A clock counting down to the end of what's running.
function TimeLeft({ until }: { until: Date }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const seconds = Math.max(0, Math.round((until.getTime() - now) / 1000));
  const pad = (n: number) => String(n).padStart(2, '0');
  const hours = Math.floor(seconds / 3600);
  const clock = `${hours ? `${hours}:` : ''}${hours ? pad(Math.floor(seconds / 60) % 60) : Math.floor(seconds / 60)}:${pad(seconds % 60)}`;
  return (
    <Text fz={36} fw={700} lh={1.1} mt={6} className="display" role="timer" style={{ fontVariantNumeric: 'tabular-nums' }}>
      {t('{{time}} left', { time: clock })} <ReqInfo id="study-countdown" />
    </Text>
  );
}

const duration = (minutes: number) => (minutes >= 60 ? `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, '0')}` : `${minutes} min`);

// ST1: how much time has gone into focus sessions. Only you see this.
function FocusTime() {
  const time = useQuery({ queryKey: ['studyMode', 'focusTime'], queryFn: () => rpc.studyMode.focusTime(), refetchInterval: 60_000 });
  if (!time.data) return null;
  const { thisWeek, sessions, lastWeek, streak } = time.data;
  const stat = (label: string, value: string) => (
    <div>
      <Text size="xs" c="dimmed" fw={700}>
        {label}
      </Text>
      <Text fw={800} size="lg">
        {value}
      </Text>
    </div>
  );
  return (
    <SectionCard info="study-focus-time" title={t('Your focus time')} actions={<Text size="xs" c="dimmed">{t('Only you see this')}</Text>}>
      {thisWeek || lastWeek || streak ? (
        <SimpleGrid cols={3}>
          {stat(t('This week'), thisWeek ? `${duration(thisWeek)}` : '—')}
          {stat(t('Last week'), lastWeek ? duration(lastWeek) : '—')}
          {stat(t('In a row'), t('{{count}} days', { count: streak }))}
        </SimpleGrid>
      ) : (
        <Text size="sm" c="dimmed">
          {t('Start a focus session, and your time shows up here.')}
        </Text>
      )}
      {sessions > 0 && (
        <Text size="xs" c="dimmed" mt="xs">
          {t('{{count}} focus sessions this week', { count: sessions })}
        </Text>
      )}
    </SectionCard>
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
            <Title order={3}>
              {status.active ? t('Study mode is on') : t('Study mode is off')} <ReqInfo id="study-status" />
            </Title>
            {status.active ? (
              <>
              <Text>
                {status.reason === 'manual' ? (status.focusTask ?? t('Focus session')) : status.label} ·{' '}
                {t('until {{time}}', { time: fmtTime(status.until!) })}
                {status.settings.silenceNotifications && (
                  <Text span c="dimmed" size="sm">
                    {' '}
                    · {t('notifications held')}
                  </Text>
                )}
              </Text>
              <TimeLeft until={status.until!} />
              </>
            ) : status.pausedWindow ? (
              <Text c="dimmed">
                {t('Switched off for {{label}} (until {{time}}).', { label: status.pausedWindow.label, time: fmtTime(status.pausedWindow.end) })}
              </Text>
            ) : status.next ? (
              <Text c="dimmed">
                {t('Next: {{label}} at {{when}}', { label: status.next.label, when: fmtDateTime(status.next.start) })}
              </Text>
            ) : (
              <Text c="dimmed">{t('No classes or study sessions coming up today.')}</Text>
            )}
          </div>
        </Group>
        {status.active && (
          <WithInfo id="study-stop">
            <Button color="teal" variant="white" onClick={() => stop.mutate()} loading={stop.isPending}>
              {t('Stop')}
            </Button>
          </WithInfo>
        )}
      </Group>
      {!status.active && (
        <Group mt="lg" gap="xs">
          <Text size="sm" fw={500} mr="xs">
            {t('Start a focus session:')} <ReqInfo id="study-focus-start" />
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
    <SectionCard info="study-settings" title={t('Settings')}>
      <Stack>
        <Switch
          label={<WithInfo id="study-auto-classes">{t('Turn on during my class times')}</WithInfo>}
          description={t("Uses the class times on each class's Overview tab")}
          checked={s.autoForClasses}
          onChange={(e) => update.mutate({ autoForClasses: e.currentTarget.checked })}
        />
        <Switch
          label={<WithInfo id="study-auto-sessions">{t("Turn on during study sessions I'm going to")}</WithInfo>}
          checked={s.autoForSessions}
          onChange={(e) => update.mutate({ autoForSessions: e.currentTarget.checked })}
        />
        <Switch
          label={<WithInfo id="study-hold">{t("Hold UniLink notifications while it's on")}</WithInfo>}
          description={t("You'll see them all when study mode ends")}
          checked={s.silenceNotifications}
          onChange={(e) => update.mutate({ silenceNotifications: e.currentTarget.checked })}
        />
        <Switch
          label={
            <Group gap={6}>
              {t('Also turn on system Do Not Disturb')} <IconBellOff size={14} /> <ReqInfo id="study-dnd" />
            </Group>
          }
          description={
            status.systemDndSupported
              ? t('Silences notifications from every app (GNOME), and switches back afterwards')
              : t('Not available in the browser')
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
    <SectionCard info="study-per-class" title={t('Per class')}>
      {classes.isPending ? (
        <Loading />
      ) : classes.data?.length ? (
        <Stack gap="sm">
          {!enabled && (
            <Badge color="gray" variant="light">
              {t('Class times are switched off in settings')}
            </Badge>
          )}
          {classes.data.map((c) => (
            <Switch
              key={c.classId}
              label={c.code}
              description={term(c.term)}
              checked={c.auto}
              disabled={!enabled}
              onChange={(e) => set.mutate({ classId: c.classId, enabled: e.currentTarget.checked })}
            />
          ))}
        </Stack>
      ) : (
        <Empty>{t('Join classes to choose which ones turn study mode on.')}</Empty>
      )}
    </SectionCard>
  );
}
