import { type ReactNode, useEffect } from 'react';
import { ActionIcon, AppShell, Box, Group, Menu, Text, Tooltip, UnstyledButton } from '@mantine/core';
import { IconChevronDown, IconFocus2, IconLogout, IconMenu2, IconSettings, IconUser, IconX } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import { Link, useLocation, useNavigate } from 'react-router';
import { goatFor } from '@shared/goat';
import { fmtTime } from '../lib/format';
import { t, tx } from '../lib/i18n';
import { useAction, useMe } from '../lib/hooks';
import { rpc } from '../lib/rpc';
import { GoatAvatar, GoatSvg } from './Goat';
import { NotificationBell } from './NotificationBell';

// Top navigation from the wireframes: logo, pill tabs, then the student and their goat.
const NAV = [
  { to: '/', label: tx('Home'), match: (p: string) => p === '/' },
  { to: '/courses', label: tx('Courses'), match: (p: string) => p.startsWith('/courses') || p.startsWith('/classes') },
  { to: '/calendar', label: tx('Calendar'), match: (p: string) => p.startsWith('/calendar') },
  { to: '/planner', label: tx('Planner'), match: (p: string) => p.startsWith('/planner') },
  { to: '/calculator', label: tx('Calculator'), match: (p: string) => p.startsWith('/calculator') },
  { to: '/sessions', label: tx('Study Sessions'), match: (p: string) => p.startsWith('/sessions') },
  { to: '/study-mode', label: tx('Study Mode'), match: (p: string) => p.startsWith('/study-mode') },
  { to: '/settings', label: tx('Settings'), match: (p: string) => p.startsWith('/settings') },
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
      <UnstyledButton component={Link} to="/study-mode">
        <Text size="xs" fw={800}>
          {t('Study mode · until {{time}}', { time: fmtTime(status.data.until!) })}
        </Text>
      </UnstyledButton>
      <Tooltip label={t('Stop study mode')}>
        <ActionIcon size="xs" variant="subtle" color="teal" onClick={() => stop.mutate()} aria-label={t('Stop study mode')}>
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

  // Tab titles name the page ("Calendar · UniLink"), for history and many open tabs.
  const section = NAV.find((item) => item.match(pathname));
  useEffect(() => {
    document.title = section ? `${t(section.label)} · UniLink` : 'UniLink';
  }, [section]);

  return (
    <AppShell header={{ height: 72 }} padding={{ base: 'sm', sm: 'lg' }}>
      <AppShell.Header px={{ base: 'sm', sm: 'lg' }} style={{ borderBottom: '2px solid var(--ul-rule)' }}>
        <Group h="100%" justify="space-between" wrap="nowrap" gap="md">
          <UnstyledButton component={Link} to="/" aria-label={t('UniLink home')} className="header-logo">
            <Logo />
          </UnstyledButton>

          <Group gap={6} wrap="nowrap" component="nav" className="nav-tabs">
            {NAV.map((item) => (
              <Link key={item.to} to={item.to} className="nav-pill" data-active={item.match(pathname) || undefined}>
                {t(item.label)}
              </Link>
            ))}
          </Group>

          <Group gap="sm" wrap="nowrap">
            <StudyModePill />
            {/* Phones: the tabs don't fit, so they're also in a menu. */}
            <Menu position="bottom-end" width={220}>
              <Menu.Target>
                <ActionIcon variant="subtle" color="gray" size="lg" className="nav-menu" aria-label={t('Menu')}>
                  <IconMenu2 size={20} />
                </ActionIcon>
              </Menu.Target>
              <Menu.Dropdown>
                {NAV.map((item) => (
                  <Menu.Item key={item.to} component={Link} to={item.to} fw={item.match(pathname) ? 800 : undefined} c={item.match(pathname) ? 'periwinkle' : undefined}>
                    {t(item.label)}
                  </Menu.Item>
                ))}
              </Menu.Dropdown>
            </Menu>
            <NotificationBell />
            <Menu position="bottom-end" width={220}>
              <Menu.Target>
                <UnstyledButton aria-label={t('Account menu')}>
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
                  {t('Account')}
                </Menu.Item>
                <Menu.Item component={Link} to="/settings/goat" leftSection={<IconSettings size={16} />}>
                  {t('Customize your goat')}
                </Menu.Item>
                <Menu.Divider />
                <Menu.Item leftSection={<IconLogout size={16} />} onClick={() => signOut.mutate()}>
                  {t('Sign out')}
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
