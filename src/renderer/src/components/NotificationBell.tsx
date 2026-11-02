import { useState } from 'react';
import { ActionIcon, Anchor, Box, Button, Group, Indicator, Popover, ScrollArea, SegmentedControl, Stack, Text, UnstyledButton } from '@mantine/core';
import { IconBell } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router';
import { ymd } from '@shared/dates';
import { dayLabel, fromNow } from '../lib/format';
import { t, tm } from '../lib/i18n';
import { useAction } from '../lib/hooks';
import { rpc } from '../lib/rpc';

// G3: in-app notifications.
export function NotificationBell() {
  const navigate = useNavigate();
  const [opened, setOpened] = useState(false);
  const list = useQuery({ queryKey: ['notifications'], queryFn: () => rpc.notifications.list(), refetchInterval: 15_000 });
  const markRead = useAction((id: number) => rpc.notifications.markRead({ id }));
  const markAll = useAction(() => rpc.notifications.markAllRead());
  const unread = list.data?.unread ?? 0;
  const [onlyUnread, setOnlyUnread] = useState(false);
  const items = (list.data?.items ?? []).filter((n) => !onlyUnread || !n.readAt);
  // Newest first, under a heading for each day.
  const today = ymd(new Date());
  const days = [...new Set(items.map((n) => ymd(n.createdAt)))];

  return (
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
          <Text fw={600}>{t('Notifications')}</Text>
          <Button size="compact-xs" variant="subtle" disabled={!unread} onClick={() => markAll.mutate()}>
            {t('Mark all read')}
          </Button>
        </Group>
        {(list.data?.items.length ?? 0) > 0 && (
          <SegmentedControl
            size="xs"
            fullWidth
            mx="md"
            mt="xs"
            value={onlyUnread ? 'unread' : 'all'}
            onChange={(v) => setOnlyUnread(v === 'unread')}
            data={[
              { value: 'all', label: t('All') },
              { value: 'unread', label: t('Unread ({{count}})', { count: unread }) },
            ]}
            aria-label={t('Which notifications to show')}
          />
        )}
        <ScrollArea.Autosize mah={440}>
          {items.length ? (
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
          </Anchor>
        </Box>
      </Popover.Dropdown>
    </Popover>
  );
}
