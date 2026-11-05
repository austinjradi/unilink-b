import { type CSSProperties, type MouseEvent, type ReactNode, useState } from 'react';
import { Anchor, Badge, Breadcrumbs, Card, Center, Group, Loader, Stack, Text, ThemeIcon, Title, UnstyledButton } from '@mantine/core';
import { IconAlertTriangle, IconMoodEmpty } from '@tabler/icons-react';
import { Link } from 'react-router';
import { t, tx } from '../lib/i18n';
import { KIND_COLORS } from '../theme';
import type { ReqTopicId } from '../lib/reqTopics';
import { useVariant } from '../lib/variants';
import { ReqInfo } from './ReqInfo';

// A props type written inline. `?` marks optional props,
// and ReactNode accepts text, elements, or nothing.
export function PageHeader({
  title,
  subtitle,
  actions,
  crumbs,
  info,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  crumbs?: { label: string; to?: string }[];
  info?: ReqTopicId;
}) {
  return (
    <div style={{ marginBottom: 'var(--mantine-spacing-lg)' }}>
      {/* Each crumb with a `to` is a link; one without is plain text. */}
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
            {/* `<>…</>` is a fragment: it groups a space and */}
            {/* the icon without adding an element to the page. */}
            {info && <> <ReqInfo id={info} /></>}
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

export function SectionCard({ title, actions, children, info }: { title: ReactNode; actions?: ReactNode; children: ReactNode; info?: ReqTopicId }) {
  return (
    <Card padding="lg">
      <Group justify="space-between" mb="md">
        <Text fw={800} size="lg" className="display">
          {title}
          {info && <> <ReqInfo id={info} /></>}
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
// Mantine's colours are CSS variables named after the colour, so a colour
// name is enough to build the right variable for light or dark mode.
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
// Custom properties like --chip-bg aren't part of React's CSSProperties
// type, so the object is cast to it. styles.css reads the variables.
export const chipStyle = (kind: string): CSSProperties =>
  ({
    '--chip-bg': `var(--mantine-color-${kindColor(kind)}-light)`,
    '--chip-fg': `var(--mantine-color-${kindColor(kind)}-light-color)`,
  }) as CSSProperties;

// tx() only marks text for translation, because a constant
// is created once. The label is translated when it's shown.
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
  final: tx('final exam'),
  key: tx('key date'),
};

export function KindBadge({ kind }: { kind: string }) {
  return (
    <Badge variant="light" color={kindColor(kind)} size="sm">
      {t(KIND_LABELS[kind] ?? kind)}
    </Badge>
  );
}

// S1: a section whose shared class times overlap classes the student is already in.
export function ClashNote({ codes }: { codes: string[] }) {
  const hidden = useVariant('no-clash-notes');
  if (hidden || !codes.length) return null;
  return (
    <Group gap={4} wrap="nowrap" c="orange">
      <IconAlertTriangle size={12} style={{ flexShrink: 0 }} />
      <Text size="xs" inherit>
        {t('Clashes with {{codes}}', { codes: codes.join(', ') })}
      </Text>
      <ReqInfo id="clash-note" />
    </Group>
  );
}

// 'gpa-hidden': a number stays covered until it's clicked.
export function Covered({ children }: { children: ReactNode }) {
  const hides = useVariant('gpa-hidden');
  const [shown, setShown] = useState(false);
  if (!hides || shown) return <>{children}</>;
  return (
    <UnstyledButton component="span" fw={700} aria-label="Show this" onClick={(e: MouseEvent) => {
      e.stopPropagation();
      setShown(true);
    }}>
      ••••
    </UnstyledButton>
  );
}
