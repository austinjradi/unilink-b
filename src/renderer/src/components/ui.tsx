import type { ReactNode } from 'react';
import { Badge, Card, Center, Group, Loader, Stack, Text, ThemeIcon, Title } from '@mantine/core';
import { IconMoodEmpty } from '@tabler/icons-react';

export function PageHeader({ title, subtitle, actions }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <Group justify="space-between" align="flex-start" mb="lg">
      <div>
        <Title order={2}>{title}</Title>
        {subtitle && (
          <Text c="dimmed" mt={4}>
            {subtitle}
          </Text>
        )}
      </div>
      {actions && <Group gap="sm">{actions}</Group>}
    </Group>
  );
}

export function SectionCard({ title, actions, children }: { title: ReactNode; actions?: ReactNode; children: ReactNode }) {
  return (
    <Card withBorder padding="lg">
      <Group justify="space-between" mb="md">
        <Text fw={600}>{title}</Text>
        {actions}
      </Group>
      {children}
    </Card>
  );
}

export function Empty({ children, icon }: { children: ReactNode; icon?: ReactNode }) {
  return (
    <Stack align="center" gap="xs" py="lg">
      <ThemeIcon variant="light" color="gray" size="xl" radius="xl">
        {icon ?? <IconMoodEmpty size={22} />}
      </ThemeIcon>
      <Text c="dimmed" size="sm" ta="center" maw={420}>
        {children}
      </Text>
    </Stack>
  );
}

export function Loading() {
  return (
    <Center py="xl">
      <Loader size="sm" />
    </Center>
  );
}

const KIND_COLORS: Record<string, string> = {
  class: 'indigo',
  assignment: 'orange',
  exam: 'red',
  quiz: 'grape',
  other: 'gray',
  graded: 'pink',
  planner: 'orange',
  session: 'teal',
  task: 'cyan',
};

export const kindColor = (kind: string) => KIND_COLORS[kind] ?? 'gray';

export function KindBadge({ kind }: { kind: string }) {
  const label = kind === 'graded' ? 'graded work' : kind === 'planner' ? 'planner' : kind;
  return (
    <Badge variant="light" color={kindColor(kind)} size="sm">
      {label}
    </Badge>
  );
}
