import { type ReactNode, useEffect } from 'react';
import { ActionIcon, AppShell, Box, Group, Menu, Text, Tooltip, UnstyledButton } from '@mantine/core';
import { IconChevronDown, IconFocus2, IconLogout, IconSettings, IconUser, IconX } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import { Link, useLocation, useNavigate } from 'react-router';
import { goatFor } from '@shared/goat';
import { fmtTime } from '../lib/format';
import { useAction, useMe } from '../lib/hooks';
import { rpc } from '../lib/rpc';
import { GoatAvatar, GoatSvg } from './Goat';
import { NotificationBell } from './NotificationBell';

// Top navigation from the wireframes: logo, pill tabs, then the student and their goat.
const NAV = [
  { to: '/', label: 'Home', match: (p: string) => p === '/' },
  { to: '/courses', label: 'Courses', match: (p: string) => p.startsWith('/courses') || p.startsWith('/classes') },
  { to: '/calendar', label: 'Calendar', match: (p: string) => p.startsWith('/calendar') },
  { to: '/planner', label: 'Planner', match: (p: string) => p.startsWith('/planner') },
  { to: '/calculator', label: 'Calculator', match: (p: string) => p.startsWith('/calculator') },
  { to: '/sessions', label: 'Study sessions', match: (p: string) => p.startsWith('/sessions') },
  { to: '/settings', label: 'Settings', match: (p: string) => p.startsWith('/settings') },
];

export const initials = (name: string) =>
  name
    .split(/\s+/)
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

export function Logo() {
  return (
    <Group gap={8} wrap="nowrap">
      <Box w={38} h={38}>
        <GoatSvg goat={{ hat: 'grad', eyes: 'goat', horns: 'classic', fur: 'white', background: 'mint' }} background={false} />
      </Box>
      <Text fw={700} fz={24} className="display" style={{ letterSpacing: -0.5 }}>
        UniLink
      </Text>
    </Group>
  );
}

// ST1: shown while study mode is on.
function StudyModePill() {
  const status = useQuery({ queryKey: ['studyMode', 'status'], queryFn: () => rpc.studyMode.status(), refetchInterval: 15_000 });
  const stop = useAction(() => rpc.studyMode.stop(), { success: 'Study mode off' });
  if (!status.data?.active) return null;
  return (
    <Group
      gap={6}
      wrap="nowrap"
      px="sm"
      py={4}
      style={{ borderRadius: 999, background: 'var(--mantine-color-teal-light)', color: 'var(--mantine-color-teal-light-color)' }}
    >
      <IconFocus2 size={16} />
      <UnstyledButton component={Link} to="/settings/study-mode">
        <Text size="xs" fw={800}>
          Study mode · until {fmtTime(status.data.until!)}
        </Text>
      </UnstyledButton>
      <Tooltip label="Stop study mode">
        <ActionIcon size="xs" variant="subtle" color="teal" onClick={() => stop.mutate()} aria-label="Stop study mode">
          <IconX size={12} />
        </ActionIcon>
      </Tooltip>
    </Group>
  );
}

export function Layout({ children }: { children: ReactNode }) {
  const me = useMe();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const signOut = useAction(() => rpc.auth.signOut());

  // Clicking a desktop notification opens what it's about.
  useEffect(() => window.unilink.onNavigate((link) => navigate(link)), [navigate]);

  return (
    <AppShell header={{ height: 72 }} padding="lg">
      <AppShell.Header px="lg" style={{ borderBottom: '2px solid var(--ul-ink)' }}>
        <Group h="100%" justify="space-between" wrap="nowrap" gap="md">
          <UnstyledButton component={Link} to="/" aria-label="UniLink home">
            <Logo />
          </UnstyledButton>

          <Group gap={6} wrap="nowrap" component="nav">
            {NAV.map((item) => (
              <Link key={item.to} to={item.to} className="nav-pill" data-active={item.match(pathname) || undefined}>
                {item.label}
              </Link>
            ))}
          </Group>

          <Group gap="sm" wrap="nowrap">
            <StudyModePill />
            <NotificationBell />
            <Menu position="bottom-end" width={220}>
              <Menu.Target>
                <UnstyledButton aria-label="Account menu">
                  <Group gap={8} wrap="nowrap">
                    <Text size="sm" fw={700} visibleFrom="xl">
                      {me.name}
                    </Text>
                    <GoatAvatar goat={goatFor(me.id, me.avatar)} size={44} />
                    <IconChevronDown size={14} />
                  </Group>
                </UnstyledButton>
              </Menu.Target>
              <Menu.Dropdown>
                <Menu.Label>{me.email}</Menu.Label>
                <Menu.Item component={Link} to="/settings/account" leftSection={<IconUser size={16} />}>
                  Account
                </Menu.Item>
                <Menu.Item component={Link} to="/settings/goat" leftSection={<IconSettings size={16} />}>
                  Customize your goat
                </Menu.Item>
                <Menu.Divider />
                <Menu.Item leftSection={<IconLogout size={16} />} onClick={() => signOut.mutate()}>
                  Sign out
                </Menu.Item>
              </Menu.Dropdown>
            </Menu>
          </Group>
        </Group>
      </AppShell.Header>

      <AppShell.Main>
        <Box maw={1400} mx="auto">
          {children}
        </Box>
      </AppShell.Main>
    </AppShell>
  );
}
