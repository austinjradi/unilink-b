import { type ReactNode, useEffect, useState } from 'react';
import { ActionIcon, Alert, AppShell, Box, Button, Group, Menu, Text, Tooltip, UnstyledButton } from '@mantine/core';
import { IconAlertTriangle, IconChevronDown, IconCloudOff, IconFocus2, IconLogout, IconMenu2, IconSettings, IconUser, IconX } from '@tabler/icons-react';
import { useNetwork } from '@mantine/hooks';
import { useQuery } from '@tanstack/react-query';
import { Link, useLocation, useNavigate } from 'react-router';
import { goatFor } from '@shared/goat';
import type { ReqTopicId } from '../lib/reqTopics';
import { fmtTime } from '../lib/format';
import { t, tx } from '../lib/i18n';
import { useAction, useMe } from '../lib/hooks';
import { rpc } from '../lib/rpc';
import { GoatAvatar, GoatSvg } from './Goat';
import { FocusCheckIn } from './FocusTask';
import { GlobalSearch } from './GlobalSearch';
import { NotificationBell } from './NotificationBell';
import { ReqInfo, WithInfo } from './ReqInfo';

// Top navigation from the wireframes: logo, pill tabs, then the student and their goat.
const NAV: { to: string; label: string; info: ReqTopicId; match: (p: string) => boolean; studentOnly?: boolean }[] = [
  { to: '/', label: tx('Home'), info: 'nav-home', match: (p: string) => p === '/' },
  { to: '/courses', label: tx('Courses'), info: 'nav-courses', match: (p: string) => p.startsWith('/courses') || p.startsWith('/classes') },
  { to: '/calendar', label: tx('Calendar'), info: 'nav-calendar', match: (p: string) => p.startsWith('/calendar') },
  { to: '/planner', label: tx('Planner'), info: 'nav-planner', match: (p: string) => p.startsWith('/planner'), studentOnly: true },
  { to: '/calculator', label: tx('Calculator'), info: 'nav-calculator', match: (p: string) => p.startsWith('/calculator'), studentOnly: true },
  { to: '/sessions', label: tx('Study Sessions'), info: 'nav-sessions', match: (p: string) => p.startsWith('/sessions') },
  { to: '/study-mode', label: tx('Study Mode'), info: 'nav-study-mode', match: (p: string) => p.startsWith('/study-mode'), studentOnly: true },
  { to: '/settings', label: tx('Settings'), info: 'nav-settings', match: (p: string) => p.startsWith('/settings') },
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

// Everything is saved only in this browser. If that stops working, say so while there's still time.
function SaveProblem() {
  const [problem, setProblem] = useState(false);
  useEffect(() => window.unilink.onSaveProblem(setProblem), []);
  useEffect(() => void window.unilink.keepData(), []);
  if (!problem) return null;
  return (
    <Alert color="red" icon={<IconAlertTriangle size={18} />} mb="md" title={<WithInfo id="save-problem">{t('This browser isn’t saving your work')}</WithInfo>}>
      <Text size="sm" mb="xs">
        {t('It may be a private window, or its storage may be full. Download a backup before you close this tab, or what you did here will be gone.')}
      </Text>
      <Button size="xs" color="red" onClick={() => void window.unilink.downloadBackup()}>
        {t('Download a backup')}
      </Button>
    </Alert>
  );
}

// ST1: shown while study mode is on.
function StudyModePill() {
  const status = useQuery({ queryKey: ['studyMode', 'status'], queryFn: () => rpc.studyMode.status(), refetchInterval: 15_000 });
  const stop = useAction(() => rpc.studyMode.stop(), { success: 'Study mode off' });
  if (!status.data?.active) return null;
  return (
    <Group
      className="study-pill"
      gap={6}
      wrap="nowrap"
      px="sm"
      py={4}
      style={{ borderRadius: 999, background: 'var(--mantine-color-teal-light)', color: 'var(--mantine-color-teal-light-color)' }}
    >
      <IconFocus2 size={16} />
      <Tooltip label={status.data.focusTask ?? t('Study mode')}>
        <UnstyledButton component={Link} to="/study-mode">
          <Text size="xs" fw={800} style={{ whiteSpace: 'nowrap' }}>
            {t('until {{time}}', { time: fmtTime(status.data.until!) })}
          </Text>
        </UnstyledButton>
      </Tooltip>
      <Tooltip label={t('Stop study mode')}>
        <ActionIcon size="xs" variant="subtle" color="teal" onClick={() => stop.mutate()} aria-label={t('Stop study mode')}>
          <IconX size={12} />
        </ActionIcon>
      </Tooltip>
      <ReqInfo id="study-pill" />
    </Group>
  );
}

export function Layout({ children }: { children: ReactNode }) {
  const me = useMe();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const signOut = useAction(() => rpc.auth.signOut());
  const network = useNetwork();

  // Clicking a desktop notification opens what it's about.
  useEffect(() => window.unilink.onNavigate((link) => navigate(link)), [navigate]);

  // Tab titles name the page ("Calendar · UniLink"), for history and many open tabs.
  const section = NAV.find((item) => item.match(pathname));
  // Planning work, working out marks and study mode are for students, not whoever teaches them.
  const nav = NAV.filter((item) => me.role === 'student' || !item.studentOnly);
  useEffect(() => {
    document.title = section ? `${t(section.label)} · UniLink` : 'UniLink';
  }, [section]);

  return (
    <AppShell header={{ height: 72 }} padding={{ base: 'sm', sm: 'lg' }}>
      <UnstyledButton className="skip-link" onClick={() => document.getElementById('content')?.focus()}>
        {t('Skip to content')}
      </UnstyledButton>
      <AppShell.Header px={{ base: 'sm', sm: 'lg' }} style={{ borderBottom: '2px solid var(--ul-rule)' }}>
        <Group h="100%" justify="space-between" wrap="nowrap" gap="md">
          <WithInfo id="nav-logo">
            <UnstyledButton component={Link} to="/" aria-label={t('UniLink home')} className="header-logo">
              <Logo />
            </UnstyledButton>
          </WithInfo>

          <Group gap={6} wrap="nowrap" component="nav" className="nav-tabs">
            {nav.map((item) => (
              <Link key={item.to} to={item.to} className="nav-pill" data-active={item.match(pathname) || undefined} aria-current={item.match(pathname) ? 'page' : undefined}>
                {t(item.label)}
                <ReqInfo id={item.info} />
              </Link>
            ))}
          </Group>

          <Group gap="sm" wrap="nowrap">
            {!network.online && (
              <Tooltip label={t('Everything you do is still saved in this browser. Group chats and online sessions need a connection.')}>
                <Group gap={6} wrap="nowrap" px="sm" py={4} style={{ borderRadius: 999, background: 'var(--mantine-color-gray-light)' }}>
                  <IconCloudOff size={16} />
                  <Text size="xs" fw={800} visibleFrom="xs">
                    {t('Offline')}
                  </Text>
                  <ReqInfo id="offline-badge" />
                </Group>
              </Tooltip>
            )}
            {me.role === 'student' && <StudyModePill />}
            {me.role === 'student' && <FocusCheckIn />}
            {/* Phones and small tablets: the tabs don't fit, so they're in a menu. */}
            <Menu position="bottom-end" width={240}>
              <Menu.Target>
                <ActionIcon variant="subtle" color="gray" size="lg" className="nav-menu" aria-label={t('Menu')}>
                  <IconMenu2 size={20} />
                </ActionIcon>
              </Menu.Target>
              <Menu.Dropdown>
                <Menu.Label>
                  <WithInfo id="nav-menu">{t('Menu')}</WithInfo>
                </Menu.Label>
                {nav.map((item) => (
                  <Menu.Item key={item.to} component={Link} to={item.to} fw={item.match(pathname) ? 800 : undefined} c={item.match(pathname) ? 'periwinkle' : undefined} rightSection={<ReqInfo id={item.info} />}>
                    {t(item.label)}
                  </Menu.Item>
                ))}
              </Menu.Dropdown>
            </Menu>
            <GlobalSearch />
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
                <Menu.Label>
                  <WithInfo id="account-menu">{me.email}</WithInfo>
                </Menu.Label>
                <Menu.Item component={Link} to="/settings/account" leftSection={<IconUser size={16} />} rightSection={<ReqInfo id="settings-account" />}>
                  {t('Account')}
                </Menu.Item>
                <Menu.Item component={Link} to="/settings/goat" leftSection={<IconSettings size={16} />} rightSection={<ReqInfo id="settings-goat" />}>
                  {t('Customize your goat')}
                </Menu.Item>
                <Menu.Divider />
                <Menu.Item leftSection={<IconLogout size={16} />} rightSection={<ReqInfo id="sign-out" />} onClick={() => signOut.mutate()}>
                  {t('Sign out')}
                </Menu.Item>
              </Menu.Dropdown>
            </Menu>
          </Group>
        </Group>
      </AppShell.Header>

      <AppShell.Main id="content" tabIndex={-1} style={{ outline: 'none' }}>
        <Box maw={1400} mx="auto">
          <SaveProblem />
          {children}
        </Box>
      </AppShell.Main>
    </AppShell>
  );
}
