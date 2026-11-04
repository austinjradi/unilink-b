import { type ReactNode, type SyntheticEvent, useLayoutEffect, useSyncExternalStore } from 'react';
import { Badge, Group, List, Modal, Stack, Text } from '@mantine/core';
import { IconInfoCircle } from '@tabler/icons-react';
import { BOARD, type BoardId, type BoardItem, REQ_TOPICS, type ReqTopic, type ReqTopicId } from '../lib/reqTopics';

// The popups are about the requirements, for whoever's reviewing them, so they stay in English
// even when the app is in French.

// One popup for the whole app. An icon can sit in a menu or popover that closes and unmounts
// as soon as you click elsewhere, so it can't own what it opens.
let shown: { id: ReqTopicId; opened: boolean } | null = null;
const listeners = new Set<() => void>();

function setShown(next: typeof shown) {
  shown = next;
  listeners.forEach((listener) => listener());
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

// Every open Mantine modal closes on Escape. The popup often sits on top of a half-filled form,
// so it takes the key first (registered here, before any modal mounts) and only it closes.
window.addEventListener(
  'keydown',
  (event) => {
    if (event.key !== 'Escape' || !shown?.opened) return;
    event.stopImmediatePropagation();
    setShown({ ...shown, opened: false });
  },
  { capture: true },
);

// The same popup twice on a screen adds nothing, so only the first icon for each topic shows: the
// first post in a list has its icons and the rest don't. A modal, drawer or menu counts as its own
// screen, since it covers the page's icons. An icon that's not on display, like one in the nav on a
// phone, doesn't count, so it can't take the place of one you can see.
const SCREEN = '[role="dialog"], .mantine-Popover-dropdown';

function showFirstIcons() {
  const seen = new Map<Element, Set<string>>();
  const repeats = new Map<HTMLElement, boolean>();
  for (const icon of document.querySelectorAll<HTMLElement>('.req-info')) {
    if (!icon.parentElement?.getClientRects().length) {
      repeats.set(icon, false);
      continue;
    }
    const screen = icon.closest(SCREEN) ?? document.body;
    const topics = seen.get(screen) ?? new Set<string>();
    seen.set(screen, topics);
    repeats.set(icon, topics.has(icon.dataset.topic!));
    topics.add(icon.dataset.topic!);
  }
  repeats.forEach((repeat, icon) => {
    icon.hidden = repeat;
  });
}

// At most once per update, and before the browser paints it.
let queued = false;
function queueShowFirst() {
  if (queued) return;
  queued = true;
  queueMicrotask(() => {
    queued = false;
    showFirstIcons();
  });
}

window.addEventListener('resize', queueShowFirst);

// The icon that opens the popup. It's a span so it can sit inside links, tabs, labels and menu
// items, none of which should react to it.
export function ReqInfo({ id }: { id: ReqTopicId }) {
  // After every render, not just on mount: a list can reorder without anything mounting.
  useLayoutEffect(() => {
    queueShowFirst();
    return queueShowFirst;
  });
  const open = (event: SyntheticEvent) => {
    event.preventDefault();
    event.stopPropagation();
    setShown({ id, opened: true });
  };
  return (
    <span
      role="button"
      tabIndex={0}
      className="req-info"
      data-topic={id}
      lang="en"
      aria-label={`Requirements for ${REQ_TOPICS[id].title}`}
      onClick={open}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') open(event);
      }}
    >
      <IconInfoCircle size={14} aria-hidden />
    </span>
  );
}

// Something with the icon next to it, for what can't hold the icon itself: buttons (a disabled
// one can't be clicked at all) and inputs. `block` fills the row, for full-width controls.
export function WithInfo({ id, block, children }: { id: ReqTopicId; block?: boolean; children: ReactNode }) {
  const Wrapper = block ? 'div' : 'span';
  return (
    <Wrapper className={block ? 'req-with req-with-block' : 'req-with'}>
      {children}
      <ReqInfo id={id} />
    </Wrapper>
  );
}

const PRIORITY = { must: 'Must have', should: 'Should have' };
const STATUS = { draft: 'Draft', question: 'Open question' };
const KIND = { feature: 'Feature story', named: 'Named on the board', beyond: 'Not on the board' };

function BoardEntry({ id }: { id: BoardId }) {
  const item: BoardItem = BOARD[id];
  const fallback = item.kind === 'named' ? 'The board names this feature but gives no detail.' : 'The board gives this requirement a title only.';
  const onBoard = item.kind !== 'beyond';
  return (
    <div>
      <Group gap={6} mb={4}>
        {onBoard && (
          <Badge variant="filled" radius="sm" size="sm">
            {id}
          </Badge>
        )}
        <Text span fw={700} size="sm">
          {item.title}
        </Text>
        {item.priority && (
          <Badge variant="light" size="xs" color={item.priority === 'must' ? 'periwinkle' : 'gray'}>
            {PRIORITY[item.priority]}
          </Badge>
        )}
        {item.status && (
          <Badge variant="light" size="xs" color={item.status === 'question' ? 'orange' : 'gray'}>
            {STATUS[item.status]}
          </Badge>
        )}
        {item.kind !== 'requirement' && (
          <Badge variant="light" size="xs" color={onBoard ? 'gray' : 'orange'}>
            {KIND[item.kind]}
          </Badge>
        )}
      </Group>
      <Text size="sm" c="dimmed">
        {item.text ?? fallback}
      </Text>
    </div>
  );
}

function Heading({ children }: { children: ReactNode }) {
  return (
    <Text fw={800} size="sm" mb="xs" className="display">
      {children}
    </Text>
  );
}

// Mounted once, at the top of the app.
export function ReqInfoHost() {
  const current = useSyncExternalStore(subscribe, () => shown);
  const topic: ReqTopic | null = current && REQ_TOPICS[current.id];
  return (
    <Modal
      opened={!!current?.opened}
      onClose={() => current && setShown({ ...current, opened: false })}
      title={topic?.title}
      lang="en"
      size="lg"
      zIndex={500}
      closeOnEscape={false}
    >
      {topic && (
        <Stack gap="lg">
          <div>
            <Heading>Requirements it implements</Heading>
            <Stack gap="sm">
              {topic.board.map((id) => (
                <BoardEntry key={id} id={id} />
              ))}
            </Stack>
            <Text size="sm" mt="sm">
              <b>In this version:</b> {topic.how}
            </Text>
          </div>
          <div>
            <Heading>Potential different requirements</Heading>
            <List size="sm" spacing={6}>
              {topic.alternatives.map((alternative) => (
                <List.Item key={alternative}>{alternative}</List.Item>
              ))}
            </List>
          </div>
        </Stack>
      )}
    </Modal>
  );
}
