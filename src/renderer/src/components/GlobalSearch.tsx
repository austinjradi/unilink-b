import { useEffect, useState } from 'react';
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
  const found = debounced.trim().length >= 2 ? (results.data ?? []) : [];
  // In the order they're shown, so Enter and the arrow keys follow what's on screen.
  const list = GROUPS.flatMap((g) => found.filter((r) => r.kind === g.kind));
  const [active, setActive] = useState(0);
  useEffect(() => setActive(0), [debounced]);
  const optionId = (r: Result) => `search-${r.kind}-${r.id}`;
  useEffect(() => {
    if (list[active]) document.getElementById(optionId(list[active]))?.scrollIntoView({ block: 'nearest' });
  }, [active, list]);
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
            role="combobox"
            aria-expanded={list.length > 0}
            aria-controls="search-results"
            aria-activedescendant={list[active] ? optionId(list[active]) : undefined}
            value={query}
            onChange={(e) => setQuery(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && list[active]) go(list[active].to);
              if (!list.length || (e.key !== 'ArrowDown' && e.key !== 'ArrowUp')) return;
              e.preventDefault();
              setActive((a) => (a + (e.key === 'ArrowDown' ? 1 : -1) + list.length) % list.length);
            }}
          />
          {debounced.trim().length >= 2 && !results.isPending && !list.length && (
            <Text size="sm" c="dimmed" ta="center" py="sm">
              {t('Nothing matches "{{query}}".', { query: debounced.trim() })}
            </Text>
          )}
          <Stack gap="md" id="search-results" role="listbox" aria-label={t('Search everything')}>
          {GROUPS.map(({ kind, label, icon: Icon }) => {
            const items = list.filter((r) => r.kind === kind);
            if (!items.length) return null;
            return (
              <div key={kind} role="group" aria-label={t(label)}>
                <Text size="xs" fw={800} c="dimmed" tt="uppercase" mb={4}>
                  {t(label)}
                </Text>
                <Stack gap={0}>
                  {items.map((r) => (
                    <UnstyledButton
                      key={`${kind}-${r.id}`}
                      id={optionId(r)}
                      role="option"
                      aria-selected={list[active] === r}
                      className="clickable"
                      px={8}
                      py={6}
                      style={{ borderRadius: 8, background: list[active] === r ? 'var(--mantine-color-gray-light)' : undefined }}
                      onMouseEnter={() => setActive(list.indexOf(r))}
                      onClick={() => go(r.to)}
                    >
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
        </Stack>
      </Modal>
    </>
  );
}
