import { type ReactNode, useEffect, useState } from 'react';
import { ActionIcon, Alert, AppShell, Box, Button, Group, Menu, Switch, Text, Tooltip, UnstyledButton, SegmentedControl, Stack, useMantineColorScheme } from '@mantine/core';
import { IconAlertTriangle, IconChevronDown, IconCloudOff, IconFocus2, IconHelp, IconLogout, IconMessageReport, IconMenu2, IconSettings, IconUser, IconX } from '@tabler/icons-react';
import { useIdle, useLocalStorage, useNetwork } from '@mantine/hooks';
import { useQuery } from '@tanstack/react-query';
import { Link, useLocation, useNavigate } from 'react-router';
import { goatFor } from '@shared/goat';
import { useListOpen } from '../lib/reqView';
import type { ReqTopicId } from '../lib/reqTopics';
import { downloadBackup } from '../lib/backup';
import { fmtTime } from '../lib/format';
import { t, tx } from '../lib/i18n';
import { useAction, useMe } from '../lib/hooks';
import { rpc } from '../lib/rpc';
import { useVariant } from '../lib/variants';
import { GoatAvatar, GoatSvg } from './Goat';
import { FocusCheckIn } from './FocusTask';
import { GlobalSearch } from './GlobalSearch';
import { LanguageSwitch } from './LanguageSwitch';
import { NotificationBell } from './NotificationBell';
import { ReqInfo, WithInfo } from './ReqInfo';

// Top navigation from the wireframes: logo, pill tabs, then the student and their goat.
const NAV: { to: string; label: string; info: ReqTopicId; match: (p: string) => boolean; studentOnly?: boolean }[] = [
  { to: '/', label: tx('Home'), info: 'nav-home', match: (p: string) => p === '/' },
  { to: '/courses', label: tx('Courses'), info: 'nav-courses', match: (p: string) => p.startsWith('/courses') || p.startsWith('/classes') },
  { to: '/catalogue', label: tx('Catalogue'), info: 'nav-courses', match: (p: string) => p.startsWith('/catalogue') },
  { to: '/academics', label: 'Academics', info: 'nav-courses', match: (p: string) => p.startsWith('/academics'), studentOnly: true },
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
  const plain = useVariant('plain-wordmark');
  return (
    <Group gap={8} wrap="nowrap">
      <Box w={38} h={38} display={plain ? 'none' : undefined}>
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
      <Button size="xs" color="red" onClick={downloadBackup}>
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

// 'study-mode-toggle': on or off from anywhere, with no page of its own.
function StudySwitch() {
  const status = useQuery({ queryKey: ['studyMode', 'status'], queryFn: () => rpc.studyMode.status(), refetchInterval: 15_000 });
  const start = useAction(() => rpc.studyMode.start({ minutes: 60 }));
  const stop = useAction(() => rpc.studyMode.stop());
  return (
    <WithInfo id="nav-study-mode">
      <Switch size="xs" label="Study mode" checked={!!status.data?.active} onChange={(e) => (e.currentTarget.checked ? start.mutate() : stop.mutate())} />
    </WithInfo>
  );
}

// 'calm-focus-view': while study mode is on, the app steps out of the way.
function CalmFocus() {
  const status = useQuery({ queryKey: ['studyMode', 'status'], queryFn: () => rpc.studyMode.status(), refetchInterval: 15_000 });
  const stop = useAction(() => rpc.studyMode.stop());
  const noStop = useVariant('no-stopping-early');
  if (!status.data?.active) return null;
  return (
    <Box style={{ position: 'fixed', inset: 0, zIndex: 190, background: 'var(--mantine-color-body)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16 }}>
      <Text fz={32} fw={700} className="display">
        {status.data.focusTask ?? t('Focus session')} <ReqInfo id="study-pill" />
      </Text>
      <Text c="dimmed">{t('until {{time}}', { time: fmtTime(status.data.until!) })}</Text>
      {!(noStop && status.data.reason === 'manual') && (
        <Button variant="default" onClick={() => stop.mutate()}>
          {t('Stop study mode')}
        </Button>
      )}
    </Box>
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
  const academics = useVariant('academics-tab');
  const sessionsOnlyOnClass = useVariant('sessions-only-on-class');
  const plannerInCalendar = useVariant('planner-in-calendar');
  const calculatorOnlyInClass = useVariant('calculator-only-in-class');
  const studyToggle = useVariant('study-mode-toggle');
  const photoAvatar = useVariant('photo-avatar');
  const profilePage = useVariant('separate-profile-page');
  const autoSignOut = useVariant('auto-sign-out');
  const idle = useIdle(15 * 60_000);
  const [photo] = useLocalStorage<string | null>({ key: `unilink-photo-${me.id}`, defaultValue: null });
  useEffect(() => {
    if (autoSignOut && idle) signOut.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoSignOut, idle]);
  const calm = useVariant('calm-focus-view');
  const scrollingTabs = useVariant('scrolling-tabs');
  const bottomTabs = useVariant('bottom-tabs');
  const settingsInMenu = useVariant('settings-in-account-menu');
  const lightOnly = useVariant('light-only');
  const helpLinks = useVariant('help-links');
  const { colorScheme, setColorScheme } = useMantineColorScheme();
  const nav = NAV.filter((item) => (me.role === 'student' || !item.studentOnly) && (academics || item.to !== '/academics') && (!sessionsOnlyOnClass || item.to !== '/sessions') && (!plannerInCalendar || item.to !== '/planner') && (!calculatorOnlyInClass || item.to !== '/calculator') && (!studyToggle || item.to !== '/study-mode'));
  const listOpen = useListOpen();
  useEffect(() => {
    // The requirements list puts it back when it closes, and this takes over from there.
    if (listOpen) return;
    document.title = section ? `${t(section.label)} · UniLink` : 'UniLink';
  }, [section, listOpen]);

  return (
    <AppShell header={{ height: 72 }} padding={{ base: 'sm', sm: 'lg' }} className={bottomTabs ? 'with-bottom-tabs' : scrollingTabs ? 'with-scrolling-tabs' : undefined}>
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
            {me.role === 'student' && studyToggle && <StudySwitch />}
            {me.role === 'student' && calm && <CalmFocus />}
            {me.role === 'student' && !studyToggle && <StudyModePill />}
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
            <Menu position="bottom-end" width={settingsInMenu ? 280 : 220} closeOnItemClick>
              <Menu.Target>
                <UnstyledButton aria-label={t('Account menu')}>
                  <Group gap={8} wrap="nowrap">
                    <Text size="sm" fw={700} visibleFrom="xl">
                      {me.name}
                    </Text>
                    {photoAvatar && photo ? <img src={photo} alt="" width={44} height={44} style={{ borderRadius: 8, objectFit: 'cover' }} /> : <GoatAvatar goat={goatFor(me.id, me.avatar)} size={44} />}
                    <IconChevronDown size={14} />
                  </Group>
                </UnstyledButton>
              </Menu.Target>
              <Menu.Dropdown>
                <Menu.Label>
                  <WithInfo id="account-menu">{me.email}</WithInfo>
                </Menu.Label>
                <Menu.Item component={Link} to={profilePage ? '/profile' : '/settings/account'} leftSection={<IconUser size={16} />} rightSection={<ReqInfo id="settings-account" />}>
                  {t('Account')}
                </Menu.Item>
                <Menu.Item component={Link} to={profilePage ? '/profile' : '/settings/goat'} leftSection={<IconSettings size={16} />} rightSection={<ReqInfo id="settings-goat" />}>
                  {t('Customize your goat')}
                </Menu.Item>
                {settingsInMenu && (
                  <Stack gap={6} px="sm" py={6}>
                    <LanguageSwitch signedIn size="xs" />
                    {!lightOnly && (
                      <SegmentedControl
                        size="xs"
                        value={colorScheme}
                        onChange={(v) => setColorScheme(v as 'light' | 'dark' | 'auto')}
                        data={[
                          { value: 'light', label: t('Light') },
                          { value: 'dark', label: t('Dark') },
                          { value: 'auto', label: t('Match system') },
                        ]}
                      />
                    )}
                  </Stack>
                )}
                {helpLinks && (
                  <>
                    <Menu.Item component="a" href="https://github.com/austinjradi/unilink-b#readme" target="_blank" rel="noreferrer" leftSection={<IconHelp size={16} />} rightSection={<ReqInfo id="about" />}>
                      Help
                    </Menu.Item>
                    <Menu.Item component="a" href="https://github.com/austinjradi/unilink-b/issues" target="_blank" rel="noreferrer" leftSection={<IconMessageReport size={16} />}>
                      Send feedback
                    </Menu.Item>
                  </>
                )}
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
      {bottomTabs && (
        <nav className="bottom-tabs" aria-label={t('Menu')}>
          {nav.map((item) => (
            <Link key={item.to} to={item.to} className="bottom-tab" data-active={item.match(pathname) || undefined} aria-current={item.match(pathname) ? 'page' : undefined}>
              {t(item.label)}
            </Link>
          ))}
        </nav>
      )}
    </AppShell>
  );
}
