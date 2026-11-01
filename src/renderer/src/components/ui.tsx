import type { CSSProperties, ReactNode } from 'react';
import { Anchor, Badge, Breadcrumbs, Card, Center, Group, Loader, Stack, Text, ThemeIcon, Title } from '@mantine/core';
import { IconMoodEmpty } from '@tabler/icons-react';
import { Link } from 'react-router';
import { t, tx } from '../lib/i18n';
import { KIND_COLORS } from '../theme';

export function PageHeader({
  title,
  subtitle,
  actions,
  crumbs,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  crumbs?: { label: string; to?: string }[];
}) {
  return (
    <div style={{ marginBottom: 'var(--mantine-spacing-lg)' }}>
      {crumbs && (
        <Breadcrumbs mb={6} separatorMargin={6}>
          {crumbs.map((c) =>
            c.to ? (
              <Anchor key={c.label} component={Link} to={c.to} size="sm" c="dimmed" fw={600}>
                {c.label}
              </Anchor>
            ) : (
              <Text key={c.label} size="sm" fw={700}>
                {c.label}
              </Text>
            ),
          )}
        </Breadcrumbs>
      )}
      <Group justify="space-between" align="flex-start">
        <div>
          <Title order={1} fz={34}>
            {title}
          </Title>
          {subtitle && (
            <Text c="dimmed" mt={2}>
              {subtitle}
            </Text>
          )}
        </div>
        {actions && <Group gap="sm">{actions}</Group>}
      </Group>
    </div>
  );
}

export function SectionCard({ title, actions, children }: { title: ReactNode; actions?: ReactNode; children: ReactNode }) {
  return (
    <Card padding="lg">
      <Group justify="space-between" mb="md">
        <Text fw={800} size="lg" className="display">
          {title}
        </Text>
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

// Class codes and post/session types, as outlined tags.
export function Tag({ children, color }: { children: ReactNode; color?: string }) {
  return (
    <span
      className="tag"
      style={
        color
          ? { background: `var(--mantine-color-${color}-light)`, color: `var(--mantine-color-${color}-light-color)` }
          : undefined
      }
    >
      {children}
    </span>
  );
}

export const kindColor = (kind: string) => KIND_COLORS[kind] ?? 'gray';

// Pastel fill for calendar chips.
export const chipStyle = (kind: string): CSSProperties =>
  ({
    '--chip-bg': `var(--mantine-color-${kindColor(kind)}-light)`,
    '--chip-fg': `var(--mantine-color-${kindColor(kind)}-light-color)`,
  }) as CSSProperties;

const KIND_LABELS: Record<string, string> = {
  class: tx('class'),
  session: tx('session'),
  task: tx('task'),
  assignment: tx('assignment'),
  exam: tx('exam'),
  quiz: tx('quiz'),
  other: tx('other'),
  graded: tx('graded work'),
  planner: tx('planner'),
};

export function KindBadge({ kind }: { kind: string }) {
  return (
    <Badge variant="light" color={kindColor(kind)} size="sm">
      {t(KIND_LABELS[kind] ?? kind)}
    </Badge>
  );
}
