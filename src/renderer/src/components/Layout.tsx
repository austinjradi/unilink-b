import type { ReactNode } from 'react';
import { AppShell, Avatar, Group, Menu, NavLink, ScrollArea, Text, ThemeIcon, UnstyledButton } from '@mantine/core';
import {
  IconCalendar,
  IconChecklist,
  IconChevronUp,
  IconHome,
  IconLogout,
  IconPlugConnected,
  IconSchool,
  IconUser,
  IconUsersGroup,
} from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import { Link, useLocation } from 'react-router';
import { useAction, useMe } from '../lib/hooks';
import { rpc } from '../lib/rpc';

const NAV = [
  { to: '/', label: 'Home', icon: IconHome },
  { to: '/classes', label: 'Classes', icon: IconSchool },
  { to: '/calendar', label: 'Calendar', icon: IconCalendar },
  { to: '/planner', label: 'Planner', icon: IconChecklist },
  { to: '/integrations', label: 'Integrations', icon: IconPlugConnected },
];

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
  const classes = useQuery({ queryKey: ['classes', 'mine'], queryFn: () => rpc.classes.mine() });
  const signOut = useAction(() => rpc.auth.signOut());

  const isActive = (to: string) => (to === '/' ? pathname === '/' : pathname === to);

  return (
    <AppShell navbar={{ width: 250, breakpoint: 0 }} padding="lg">
      <AppShell.Navbar p="sm">
        <AppShell.Section mb="md" px="xs" pt="xs">
          <Group gap="xs">
            <ThemeIcon size="lg" radius="md" variant="gradient" gradient={{ from: 'indigo', to: 'red', deg: 135 }}>
              <IconUsersGroup size={20} />
            </ThemeIcon>
            <Text fw={700} size="lg">
              UniLink
            </Text>
          </Group>
        </AppShell.Section>

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
