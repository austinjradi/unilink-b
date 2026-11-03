import { type ReactNode, type SyntheticEvent, useSyncExternalStore } from 'react';
import { Badge, Group, List, Modal, Stack, Text } from '@mantine/core';
import { IconInfoCircle } from '@tabler/icons-react';
import { t, tx } from '../lib/i18n';
import { BOARD, type BoardId, type BoardItem, REQ_TOPICS, type ReqTopic, type ReqTopicId } from '../lib/reqTopics';

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

// The icon that opens the popup. It's a span so it can sit inside links, tabs, labels and menu
// items, none of which should react to it.
export function ReqInfo({ id }: { id: ReqTopicId }) {
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
      aria-label={t('Requirements for {{title}}', { title: t(REQ_TOPICS[id].title) })}
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

const PRIORITY = { must: tx('Must have'), should: tx('Should have') };
const STATUS = { draft: tx('Draft'), question: tx('Open question') };
const KIND = { feature: tx('Feature story'), named: tx('Named on the board'), beyond: tx('Not on the board') };

function BoardEntry({ id }: { id: BoardId }) {
  const item: BoardItem = BOARD[id];
  const fallback = item.kind === 'named' ? tx('The board names this feature but gives no detail.') : tx('The board gives this requirement a title only.');
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
          {t(item.title)}
        </Text>
        {item.priority && (
          <Badge variant="light" size="xs" color={item.priority === 'must' ? 'periwinkle' : 'gray'}>
            {t(PRIORITY[item.priority])}
          </Badge>
        )}
        {item.status && (
          <Badge variant="light" size="xs" color={item.status === 'question' ? 'orange' : 'gray'}>
            {t(STATUS[item.status])}
          </Badge>
        )}
        {item.kind !== 'requirement' && (
          <Badge variant="light" size="xs" color={onBoard ? 'gray' : 'orange'}>
            {t(KIND[item.kind])}
          </Badge>
        )}
      </Group>
      <Text size="sm" c="dimmed">
        {t(item.text ?? fallback)}
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
      title={topic && t(topic.title)}
      size="lg"
      zIndex={500}
      closeOnEscape={false}
    >
      {topic && (
        <Stack gap="lg">
          <div>
            <Heading>{t('Requirements it implements')}</Heading>
            <Stack gap="sm">
              {topic.board.map((id) => (
                <BoardEntry key={id} id={id} />
              ))}
            </Stack>
            <Text size="sm" mt="sm">
              <b>{t('In this version:')}</b> {t(topic.how)}
            </Text>
          </div>
          <div>
            <Heading>{t('Potential different requirements')}</Heading>
            <List size="sm" spacing={6}>
              {topic.alternatives.map((alternative) => (
                <List.Item key={alternative}>{t(alternative)}</List.Item>
              ))}
            </List>
          </div>
        </Stack>
      )}
    </Modal>
  );
}
