import { useState } from 'react';
import { ActionIcon, Group, Highlight, Modal, Stack, Text, TextInput, Tooltip, UnstyledButton } from '@mantine/core';
import { useDebouncedValue, useHotkeys } from '@mantine/hooks';
import { IconBook, IconCalendarDue, IconListCheck, IconMessage, IconMessages, IconPercentage, IconSearch, IconUsersGroup } from '@tabler/icons-react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { fmtDateTime } from '../lib/format';
import { t, tx } from '../lib/i18n';
import { type Out, rpc } from '../lib/rpc';

type Result = Out<typeof rpc.search.everything>[number];

const GROUPS: { kind: Result['kind']; label: string; icon: typeof IconBook }[] = [
  { kind: 'class', label: tx('Courses'), icon: IconBook },
  { kind: 'post', label: tx('Discussion'), icon: IconMessage },
  { kind: 'deadline', label: tx('Deadlines'), icon: IconCalendarDue },
  { kind: 'graded', label: tx('Grades'), icon: IconPercentage },
  { kind: 'session', label: tx('Study Sessions'), icon: IconUsersGroup },
  { kind: 'plan', label: tx('Planner'), icon: IconListCheck },
  { kind: 'chat', label: tx('Group chats'), icon: IconMessages },
];

// One box for everything, from the search icon or Ctrl/Cmd+K. Enter opens the first result.
export function GlobalSearch() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [debounced] = useDebouncedValue(query, 150);
  useHotkeys([['mod+K', () => setOpen(true)]], []);
  const results = useQuery({
    queryKey: ['search', debounced],
    queryFn: () => rpc.search.everything({ query: debounced }),
    enabled: open && debounced.trim().length >= 2,
    placeholderData: keepPreviousData,
  });
  const list = debounced.trim().length >= 2 ? (results.data ?? []) : [];
  const go = (to: string) => {
    setOpen(false);
    setQuery('');
    navigate(to);
  };

  return (
    <>
      <Tooltip label={t('Search everything (Ctrl+K)')}>
        <ActionIcon variant="subtle" color="gray" size="lg" onClick={() => setOpen(true)} aria-label={t('Search everything')}>
          <IconSearch size={20} />
        </ActionIcon>
      </Tooltip>
      <Modal opened={open} onClose={() => setOpen(false)} title={t('Search everything')} size="lg" zIndex={400}>
        <Stack gap="md">
          <TextInput
            data-autofocus
            radius="xl"
            leftSection={<IconSearch size={16} />}
            placeholder={t('Courses, posts, deadlines, sessions…')}
            aria-label={t('Search everything')}
            value={query}
            onChange={(e) => setQuery(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && list[0]) go(list[0].to);
            }}
          />
          {debounced.trim().length >= 2 && !results.isPending && !list.length && (
            <Text size="sm" c="dimmed" ta="center" py="sm">
              {t('Nothing matches "{{query}}".', { query: debounced.trim() })}
            </Text>
          )}
          {GROUPS.map(({ kind, label, icon: Icon }) => {
            const items = list.filter((r) => r.kind === kind);
            if (!items.length) return null;
            return (
              <div key={kind}>
                <Text size="xs" fw={800} c="dimmed" tt="uppercase" mb={4}>
                  {t(label)}
                </Text>
                <Stack gap={0}>
                  {items.map((r) => (
                    <UnstyledButton key={`${kind}-${r.id}`} className="clickable" px={8} py={6} style={{ borderRadius: 8 }} onClick={() => go(r.to)}>
                      <Group gap="sm" wrap="nowrap">
                        <Icon size={16} style={{ flex: 'none' }} />
                        <div style={{ minWidth: 0 }}>
                          <Highlight highlight={debounced.trim()} size="sm" fw={700} lineClamp={1}>
                            {r.title}
                          </Highlight>
                          {(r.sub || r.when) && (
                            <Text size="xs" c="dimmed" truncate>
                              {[r.sub, r.when && fmtDateTime(r.when)].filter(Boolean).join(' · ')}
                            </Text>
                          )}
                        </div>
                      </Group>
                    </UnstyledButton>
                  ))}
                </Stack>
              </div>
            );
          })}
        </Stack>
      </Modal>
    </>
  );
}
