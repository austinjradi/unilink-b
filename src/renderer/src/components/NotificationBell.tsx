import { useEffect, useRef, useState } from 'react';
import { ActionIcon, Anchor, Box, Button, Group, Indicator, Popover, ScrollArea, SegmentedControl, Stack, Text, UnstyledButton, Select } from '@mantine/core';
import { IconBell } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router';
import { ymd } from '@shared/dates';
import { dayLabel, fromNow } from '../lib/format';
import { t, tm } from '../lib/i18n';
import { useAction } from '../lib/hooks';
import { rpc } from '../lib/rpc';
import { modals } from '@mantine/modals';
import { useVariant } from '../lib/variants';
import { ReqInfo, WithInfo } from './ReqInfo';

// G3: in-app notifications.
// 'notify-sound': a short tone, made here so there's no sound file to load.
function beep() {
  try {
    const audio = new AudioContext();
    const tone = audio.createOscillator();
    const volume = audio.createGain();
    tone.frequency.value = 880;
    volume.gain.value = 0.05;
    tone.connect(volume).connect(audio.destination);
    tone.onended = () => void audio.close();
    tone.start();
    tone.stop(audio.currentTime + 0.15);
  } catch {
    // No sound, then.
  }
}

export function NotificationBell() {
  const navigate = useNavigate();
  const [opened, setOpened] = useState(false);
  const list = useQuery({ queryKey: ['notifications'], queryFn: () => rpc.notifications.list(), refetchInterval: 15_000 });
  const markRead = useAction((id: number) => rpc.notifications.markRead({ id }));
  const markAll = useAction(() => rpc.notifications.markAllRead());
  const unread = list.data?.unread ?? 0;
  const [onlyUnread, setOnlyUnread] = useState(false);
  const noList = useVariant('email-all-no-list');
  const dailySummary = useVariant('daily-summary');
  const readOnOpen = useVariant('mark-read-on-open');
  const askFirst = useVariant('confirm-mark-all');
  const withSound = useVariant('notify-sound');
  const askThenMarkAll = () => {
    if (!askFirst) return markAll.mutate();
    modals.openConfirmModal({
      title: 'Mark everything as read?',
      labels: { confirm: 'Mark all read', cancel: 'Cancel' },
      onConfirm: () => markAll.mutate(),
    });
  };
  const canFilter = useVariant('filter-notifications');
  const [typeFilter, setTypeFilter] = useState<string | null>(null);
  const [classFilter, setClassFilter] = useState<string | null>(null);
  const classes = useQuery({ queryKey: ['classes', 'mine'], queryFn: () => rpc.classes.mine(), enabled: canFilter });
  const classOf = (link: string | null) => link?.match(/^\/classes\/(\d+)/)?.[1] ?? null;
  const items = (list.data?.items ?? []).filter((n) => (!onlyUnread || !n.readAt) && (!typeFilter || n.type === typeFilter) && (!classFilter || classOf(n.link) === classFilter));
  // 'mark-read-on-open': opening the list is reading it.
  const heard = useRef(unread);
  useEffect(() => {
    if (withSound && unread > heard.current) beep();
    heard.current = unread;
  }, [unread, withSound]);
  useEffect(() => {
    if (readOnOpen && opened && unread) markAll.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readOnOpen, opened]);
  // Newest first, under a heading for each day.
  const today = ymd(new Date());
  const days = [...new Set(items.map((n) => ymd(n.createdAt)))];

  if (noList) return <ReqInfo id="notif-bell" />;
  return (
    <WithInfo id="notif-bell">
    <Popover opened={opened} onChange={setOpened} position="bottom-end" width="min(380px, calc(100vw - 16px))" shadow="md">
      <Popover.Target>
        <Indicator label={unread > 9 ? '9+' : unread} size={16} disabled={!unread} offset={6} color="red.8">
          <ActionIcon variant="subtle" color="gray" size="lg" onClick={() => setOpened((o) => !o)} aria-label={t('Notifications')}>
            <IconBell size={20} />
          </ActionIcon>
        </Indicator>
      </Popover.Target>
      <Popover.Dropdown p={0}>
        <Group justify="space-between" px="md" py="sm" style={{ borderBottom: '1px solid var(--mantine-color-default-border)' }}>
          <Text fw={600}>
            {t('Notifications')} <ReqInfo id="notif-bell" />
          </Text>
          {!readOnOpen && (
            <WithInfo id="notif-mark-all">
              <Button size="compact-xs" variant="subtle" disabled={!unread} onClick={askThenMarkAll}>
                {t('Mark all read')}
              </Button>
            </WithInfo>
          )}
        </Group>
        {(list.data?.items.length ?? 0) > 0 && (
          <Box mx="md" mt="xs">
            <WithInfo id="notif-filter" block>
              <SegmentedControl
                size="xs"
                fullWidth
                value={onlyUnread ? 'unread' : 'all'}
                onChange={(v) => setOnlyUnread(v === 'unread')}
                data={[
                  { value: 'all', label: t('All') },
                  { value: 'unread', label: t('Unread ({{count}})', { count: unread }) },
                ]}
                aria-label={t('Which notifications to show')}
              />
            </WithInfo>
          </Box>
        )}
        {canFilter && (
          <Group mx="md" mt="xs" grow gap="xs">
            <Select size="xs" placeholder="Any kind" aria-label="Kind of notification" clearable comboboxProps={{ withinPortal: false }} data={[...new Set((list.data?.items ?? []).map((n) => n.type))]} value={typeFilter} onChange={setTypeFilter} />
            <Select size="xs" placeholder="Any class" aria-label="Class" clearable comboboxProps={{ withinPortal: false }} data={(classes.data ?? []).map((c) => ({ value: String(c.id), label: c.code }))} value={classFilter} onChange={setClassFilter} />
          </Group>
        )}
        <ScrollArea.Autosize mah={440}>
          {dailySummary && items.length ? (
            <Stack gap="xs" p="md">
              {days.map((day) => {
                const onDay = items.filter((n) => ymd(n.createdAt) === day);
                return (
                  <div key={day}>
                    <Text size="xs" fw={800} c="dimmed" tt="uppercase">
                      {dayLabel(day, today)}
                    </Text>
                    <Text size="sm">
                      {onDay.length} notifications: {onDay.slice(0, 3).map((n) => (n.i18n ? tm(n.i18n.title) : n.title)).join(' · ')}
                      {onDay.length > 3 ? ' …' : ''}
                    </Text>
                  </div>
                );
              })}
            </Stack>
          ) : items.length ? (
            <Stack gap={0}>
              {days.flatMap((day) => [
                <Text key={day} size="xs" fw={800} c="dimmed" tt="uppercase" px="md" pt="sm" pb={2}>
                  {dayLabel(day, today)}
                </Text>,
                ...items.filter((n) => ymd(n.createdAt) === day).map((n) => (
                <UnstyledButton
                  key={n.id}
                  className="clickable"
                  px="md"
                  py="sm"
                  onClick={() => {
                    if (!n.readAt) markRead.mutate(n.id);
                    if (n.link) navigate(n.link);
                    setOpened(false);
                  }}
                >
                  <Group gap="sm" wrap="nowrap" align="flex-start">
                    <Box w={8} h={8} mt={6} style={{ borderRadius: 8, flex: 'none', background: n.readAt ? 'transparent' : 'var(--mantine-color-indigo-6)' }} />
                    <div style={{ minWidth: 0 }}>
                      <Text size="sm" fw={n.readAt ? 400 : 600}>
                        {n.i18n ? tm(n.i18n.title) : n.title}
                      </Text>
                      {(n.i18n?.body || n.body) && (
                        <Text size="xs" c="dimmed" lineClamp={2}>
                          {n.i18n?.body ? tm(n.i18n.body) : n.body}
                        </Text>
                      )}
                      <Text size="xs" c="dimmed" mt={2}>
                        {fromNow(n.createdAt)}
                      </Text>
                    </div>
                  </Group>
                </UnstyledButton>
                )),
              ])}
            </Stack>
          ) : (
            <Text c="dimmed" size="sm" ta="center" py="xl">
              {t("You're all caught up.")}
            </Text>
          )}
        </ScrollArea.Autosize>
        <Box px="md" py="xs" style={{ borderTop: '1px solid var(--mantine-color-default-border)' }}>
          <Anchor component={Link} to="/settings/notifications" size="xs" onClick={() => setOpened(false)}>
            {t('Notification settings')}
          </Anchor>{' '}
          <ReqInfo id="notif-settings" />
        </Box>
      </Popover.Dropdown>
    </Popover>
    </WithInfo>
  );
}
