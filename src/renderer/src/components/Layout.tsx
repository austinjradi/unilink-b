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
// The tabs as data, one entry each, with the entry type written inline. `match`
// decides whether a tab is the current one, and studentOnly hides it from professors.
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

// "Ada Lovelace" becomes "AL": split on whitespace, take each first letter, keep two.
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
  // onSaveProblem returns an unsubscribe function, and returning it from the
  // arrow makes it this effect's cleanup. setProblem itself is the listener.
  useEffect(() => window.unilink.onSaveProblem(setProblem), []);
  // `void` throws away keepData's promise, because an effect must return nothing or a cleanup function.
  useEffect(() => void window.unilink.keepData(), []);
  // A component that returns null renders nothing.
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
  // refetchInterval polls every 15 seconds, because study mode turns itself on and off as classes
  // start and end. Three components in this file use the same key, so they share one cached result.
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

// children is whatever sits between <Layout> and </Layout>: the
// current page. ReactNode is the type for anything React can render.
export function Layout({ children }: { children: ReactNode }) {
  const me = useMe();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const signOut = useAction(() => rpc.auth.signOut());
  // Mantine's useNetwork reports whether the browser is online, and re-renders when that changes.
  const network = useNetwork();

  // Clicking a desktop notification opens what it's about.
  // navigate is a dependency, so if it ever changed, the
  // old subscription would be removed and a new one made.
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
  // True after 15 minutes with no mouse or keyboard input.
  const idle = useIdle(15 * 60_000);
  // Like useState, but saved in localStorage under that key and shared by every
  // component using it. Destructuring only the first item ignores the setter.
  const [photo] = useLocalStorage<string | null>({ key: `unilink-photo-${me.id}`, defaultValue: null });
  useEffect(() => {
    // The eslint-disable line below silences the rule that wants every
    // value used here listed as a dependency. signOut can be a new object
    // on any render, so listing it would re-run this effect needlessly.
    if (autoSignOut && idle) signOut.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoSignOut, idle]);
  const calm = useVariant('calm-focus-view');
  const scrollingTabs = useVariant('scrolling-tabs');
  const bottomTabs = useVariant('bottom-tabs');
  const settingsInMenu = useVariant('settings-in-account-menu');
  const lightOnly = useVariant('light-only');
  const helpLinks = useVariant('help-links');
  // Mantine's light and dark setting: the current value and a function to change it.
  const { colorScheme, setColorScheme } = useMantineColorScheme();
  // The tabs to show: student-only tabs go for professors,
  // and so do tabs that a switch moves elsewhere.
  const nav = NAV.filter((item) => (me.role === 'student' || !item.studentOnly) && (academics || item.to !== '/academics') && (!sessionsOnlyOnClass || item.to !== '/sessions') && (!plannerInCalendar || item.to !== '/planner') && (!calculatorOnlyInClass || item.to !== '/calculator') && (!studyToggle || item.to !== '/study-mode'));
  const listOpen = useListOpen();
  useEffect(() => {
    // The requirements list puts it back when it closes, and this takes over from there.
    if (listOpen) return;
    // document.title is the name on the browser tab. Like every effect,
    // this runs after render, whenever its dependencies change.
    document.title = section ? `${t(section.label)} · UniLink` : 'UniLink';
  }, [section, listOpen]);

  return (
    // AppShell is Mantine's page frame: a fixed header and a main area. `padding={{ base: 'sm',
    // sm: 'lg' }}` is a responsive value, small on phones and larger from the sm breakpoint up.
    <AppShell header={{ height: 72 }} padding={{ base: 'sm', sm: 'lg' }} className={bottomTabs ? 'with-bottom-tabs' : scrollingTabs ? 'with-scrolling-tabs' : undefined}>
      {/* A skip link: hidden until reached with Tab, it lets */}
      {/* keyboard users jump past the header to the page. */}
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
            {/* `data-active={… || undefined}` leaves the attribute off rather */}
            {/* than writing data-active="false", so CSS can select [data-active]. */}
            {/* aria-current tells screen readers which tab is the current page. */}
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
            {/* Menu is a compound component: Menu.Target is */}
            {/* what opens it, Menu.Dropdown is what appears. */}
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

      {/* tabIndex={-1} lets the skip link move focus here */}
      {/* with focus(), without adding this to the Tab order. */}
      <AppShell.Main id="content" tabIndex={-1} style={{ outline: 'none' }}>
        <Box maw={1400} mx="auto">
          <SaveProblem />
          {/* The page that matched the current route. */}
          {children}
        </Box>
      </AppShell.Main>
      {/* `condition && <JSX>` renders the JSX only when the */}
      {/* condition is true. With false, React renders nothing. */}
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
