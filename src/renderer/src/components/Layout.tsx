import { type ReactNode, useEffect } from 'react';
import { AppShell, Avatar, Button, Group, Menu, NavLink, Paper, ScrollArea, Text, ThemeIcon, UnstyledButton } from '@mantine/core';
import {
  IconCalendar,
  IconCertificate,
  IconChecklist,
  IconChevronUp,
  IconFocus2,
  IconHome,
  IconLogout,
  IconPlugConnected,
  IconSchool,
  IconUser,
  IconUsersGroup,
} from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import { Link, useLocation, useNavigate } from 'react-router';
import { fmtTime } from '../lib/format';
import { useAction, useMe } from '../lib/hooks';
import { rpc } from '../lib/rpc';
import { NotificationBell } from './NotificationBell';

const NAV = [
  { to: '/', label: 'Home', icon: IconHome },
  { to: '/classes', label: 'Classes', icon: IconSchool },
  { to: '/calendar', label: 'Calendar', icon: IconCalendar },
  { to: '/planner', label: 'Planner', icon: IconChecklist },
  { to: '/academics', label: 'Academics', icon: IconCertificate },
  { to: '/focus', label: 'Study mode', icon: IconFocus2 },
  { to: '/integrations', label: 'Integrations', icon: IconPlugConnected },
];

// ST1: shown while study mode is on.
function StudyModeChip() {
  const status = useQuery({ queryKey: ['studyMode', 'status'], queryFn: () => rpc.studyMode.status(), refetchInterval: 15_000 });
  const stop = useAction(() => rpc.studyMode.stop(), { success: 'Study mode off' });
  if (!status.data?.active) return null;
  return (
    <Paper withBorder p="xs" mx="xs" mb="sm" bg="var(--mantine-color-teal-light)">
      <Group justify="space-between" wrap="nowrap" gap="xs">
        <UnstyledButton component={Link} to="/focus" style={{ minWidth: 0 }}>
          <Text size="xs" fw={700} c="teal">
            Study mode on
          </Text>
          <Text size="xs" truncate>
            {status.data.label} · until {fmtTime(status.data.until!)}
          </Text>
        </UnstyledButton>
        <Button size="compact-xs" variant="white" color="teal" onClick={() => stop.mutate()}>
          Stop
        </Button>
      </Group>
    </Paper>
  );
}

export const initials = (name: string) =>
  name
    .split(/\s+/)
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

export function Layout({ children }: { children: ReactNode }) {
  const me = useMe();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const classes = useQuery({ queryKey: ['classes', 'mine'], queryFn: () => rpc.classes.mine() });
  const signOut = useAction(() => rpc.auth.signOut());

  // Clicking a desktop notification opens what it's about.
  useEffect(() => window.unilink.onNavigate((link) => navigate(link)), [navigate]);

  const isActive = (to: string) => (to === '/' || to === '/classes' ? pathname === to : pathname.startsWith(to));

  return (
    <AppShell navbar={{ width: 250, breakpoint: 0 }} padding="lg">
      <AppShell.Navbar p="sm">
        <AppShell.Section mb="md" px="xs" pt="xs">
          <Group justify="space-between">
            <Group gap="xs">
              <ThemeIcon size="lg" radius="md" variant="gradient" gradient={{ from: 'indigo', to: 'red', deg: 135 }}>
                <IconUsersGroup size={20} />
              </ThemeIcon>
              <Text fw={700} size="lg">
                UniLink
              </Text>
            </Group>
            <NotificationBell />
          </Group>
        </AppShell.Section>
        <StudyModeChip />

        <AppShell.Section grow component={ScrollArea}>
          {NAV.map(({ to, label, icon: Icon }) => (
            <div key={to}>
              <NavLink
                component={Link}
                to={to}
                label={label}
                active={isActive(to)}
                leftSection={<Icon size={18} stroke={1.6} />}
                style={{ borderRadius: 'var(--mantine-radius-md)' }}
              />
              {to === '/classes' &&
                classes.data?.map((c) => (
                  <NavLink
                    key={c.id}
                    component={Link}
                    to={`/classes/${c.id}`}
                    label={`${c.subject} ${c.number}`}
                    description={c.term}
                    active={pathname.startsWith(`/classes/${c.id}`)}
                    pl={42}
                    style={{ borderRadius: 'var(--mantine-radius-md)' }}
                  />
                ))}
            </div>
          ))}
        </AppShell.Section>

        <AppShell.Section>
          <Menu position="top-start" width={220}>
            <Menu.Target>
              <UnstyledButton w="100%" p="xs" className="clickable" style={{ borderRadius: 'var(--mantine-radius-md)' }}>
                <Group gap="sm" wrap="nowrap">
                  <Avatar color="indigo" radius="xl">
                    {initials(me.name)}
                  </Avatar>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <Text size="sm" fw={500} truncate>
                      {me.name}
                    </Text>
                    <Text size="xs" c="dimmed" truncate>
                      {me.email}
                    </Text>
                  </div>
                  <IconChevronUp size={14} />
                </Group>
              </UnstyledButton>
            </Menu.Target>
            <Menu.Dropdown>
              <Menu.Item component={Link} to="/profile" leftSection={<IconUser size={16} />}>
                Profile and account
              </Menu.Item>
              <Menu.Item leftSection={<IconLogout size={16} />} onClick={() => signOut.mutate()}>
                Sign out
              </Menu.Item>
            </Menu.Dropdown>
          </Menu>
        </AppShell.Section>
      </AppShell.Navbar>

      <AppShell.Main>{children}</AppShell.Main>
    </AppShell>
  );
}
