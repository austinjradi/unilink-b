import { type ReactNode, type SyntheticEvent, useLayoutEffect, useSyncExternalStore } from 'react';
import { Badge, Button, Group, List, Modal, Stack, Text } from '@mantine/core';
import { IconAdjustments, IconBrandGithub, IconEye, IconEyeOff, IconInfoCircle, IconListDetails } from '@tabler/icons-react';
import { useQueryClient } from '@tanstack/react-query';
import { clearVariants, NOT_SWITCHABLE, setVariant, variantFor, VARIANTS } from '@shared/variants';
import { BOARD, type BoardId, type BoardItem, REQ_TOPICS, type ReqTopic, type ReqTopicId } from '../lib/reqTopics';
import { setInfoHidden, setListOpen, useInfoHidden, useListOpen } from '../lib/reqView';
import { useVariantsOn } from '../lib/variants';

// The popups are about the requirements, for whoever's reviewing them, so they stay in English
// even when the app is in French.

// One popup for the whole app. An icon can sit in a menu or popover that closes and unmounts
// as soon as you click elsewhere, so it can't own what it opens. No id is the list of switches.
// A module-level store, like the switches: any icon can open the
// one popup, and ReqInfoHost subscribes to it to draw the popup.
let shown: { id: ReqTopicId | null; opened: boolean } | null = null;
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
// `{ capture: true }` runs this listener first, on the event's way down the page, before
// Mantine's own Escape handlers. stopImmediatePropagation() then stops theirs from running.
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

// Works on the DOM directly rather than through React: it groups icons by
// screen and topic, and hides every repeat after the first one on display.
function showFirstIcons() {
  const groups = new Map<Element, Map<string, HTMLElement[]>>();
  for (const icon of document.querySelectorAll<HTMLElement>('.req-info')) {
    const screen = icon.closest(SCREEN) ?? document.body;
    const topics = groups.get(screen) ?? new Map<string, HTMLElement[]>();
    groups.set(screen, topics);
    topics.set(icon.dataset.topic!, [...(topics.get(icon.dataset.topic!) ?? []), icon]);
  }
  const repeats = new Map<HTMLElement, boolean>();
  // Checking what's on display makes the browser lay out the page, so it's only for topics that repeat.
  for (const topics of groups.values()) {
    for (const icons of topics.values()) {
      let found = false;
      for (const icon of icons) {
        const onDisplay = icons.length > 1 && !!icon.parentElement?.getClientRects().length;
        repeats.set(icon, found && onDisplay);
        found ||= onDisplay;
      }
    }
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
  // A microtask runs as soon as the current code finishes and before the
  // browser paints, so many icons rendering at once lead to a single pass.
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
  // No dependency array, so this runs after every render. useLayoutEffect
  // runs before the browser paints, so a hidden repeat never flashes on
  // screen. Returning the same function also runs it on unmount.
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

export function BoardEntry({ id }: { id: BoardId }) {
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

// Switching changes what the services return, so everything on screen is fetched again.
export function useApply() {
  const queryClient = useQueryClient();
  return (change: () => void) => {
    change();
    void queryClient.invalidateQueries();
  };
}

function Alternative({ text }: { text: string }) {
  const apply = useApply();
  const on = useVariantsOn();
  const id = variantFor(text);
  const active = !!id && on.includes(id);
  return (
    <List.Item>
      {text}
      {id && (
        <Group gap="xs" mt={4} mb={4}>
          <Button size="compact-xs" variant={active ? 'default' : 'light'} onClick={() => apply(() => setVariant(id, !active))}>
            {active ? 'Switch back' : 'Switch to this'}
          </Button>
          {active && (
            <Badge variant="filled" size="xs">
              On
            </Badge>
          )}
        </Group>
      )}
      {NOT_SWITCHABLE[text] && (
        <Text size="xs" c="dimmed">
          {NOT_SWITCHABLE[text]}
        </Text>
      )}
    </List.Item>
  );
}

// Everything that's switched on. Switching something on can take away the icon that leads back
// to it, so this is reachable from anywhere.
function Changes() {
  const apply = useApply();
  const on = useVariantsOn();
  if (!on.length) return <Text size="sm">The site is back to how this version was built.</Text>;
  return (
    <Stack gap="sm">
      {on.map((id) => (
        <Group key={id} justify="space-between" wrap="nowrap" align="flex-start">
          <Text size="sm">{VARIANTS[id].alternative}</Text>
          <Button size="compact-xs" variant="default" style={{ flex: 'none' }} onClick={() => apply(() => setVariant(id, false))}>
            Switch back
          </Button>
        </Group>
      ))}
      <Button variant="light" w="fit-content" onClick={() => apply(clearVariants)}>
        Switch everything back
      </Button>
    </Stack>
  );
}

function ChangesPill() {
  const count = useVariantsOn().length;
  if (!count) return null;
  return (
    <Button size="compact-sm" radius="xl" leftSection={<IconAdjustments size={14} />} onClick={() => setShown({ id: null, opened: true })}>
      {count === 1 ? '1 requirement change on' : `${count} requirement changes on`}
    </Button>
  );
}

// Always reachable, even with the info buttons hidden, since it's what brings them back.
function Dock() {
  const infoHidden = useInfoHidden();
  const listOpen = useListOpen();
  // The site's icons were hidden along with it, so count them again now they're back.
  useLayoutEffect(queueShowFirst, [listOpen]);
  if (listOpen) return null;
  return (
    <div className="req-dock" lang="en">
      <Button size="compact-sm" radius="xl" variant="default" aria-label="Requirements" leftSection={<IconListDetails size={14} />} onClick={() => setListOpen(true)}>
        <span className="req-dock-label">Requirements</span>
      </Button>
      <Button
        size="compact-sm"
        radius="xl"
        variant="default"
        aria-label={infoHidden ? 'Show info buttons' : 'Hide info buttons'}
        leftSection={infoHidden ? <IconEye size={14} /> : <IconEyeOff size={14} />}
        onClick={() => setInfoHidden(!infoHidden)}
      >
        <span className="req-dock-label">{infoHidden ? 'Show info buttons' : 'Hide info buttons'}</span>
      </Button>
      <Button
        component="a"
        href="https://github.com/austinjradi/unilink-b"
        target="_blank"
        rel="noreferrer"
        size="compact-sm"
        radius="xl"
        variant="default"
        aria-label="GitHub"
        leftSection={<IconBrandGithub size={14} />}
      >
        <span className="req-dock-label">GitHub</span>
      </Button>
      <ChangesPill />
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
  const topic: ReqTopic | null = current?.id ? REQ_TOPICS[current.id] : null;
  return (
    <>
      <Dock />
      <Modal
        opened={!!current?.opened}
        onClose={() => current && setShown({ ...current, opened: false })}
        title={topic ? topic.title : 'Requirement changes'}
        lang="en"
        size="lg"
        zIndex={500}
        closeOnEscape={false}
      >
        {current && !topic && <Changes />}
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
                  <Alternative key={alternative} text={alternative} />
                ))}
              </List>
            </div>
          </Stack>
        )}
      </Modal>
    </>
  );
}
