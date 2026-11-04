import { memo, useEffect, useMemo, useState } from 'react';
import { Accordion, Badge, Button, Container, Group, Paper, SegmentedControl, SimpleGrid, Stack, Switch, Text, TextInput, Title } from '@mantine/core';
import { IconArrowLeft, IconSearch } from '@tabler/icons-react';
import { clearVariants, setVariant } from '@shared/variants';
import { type ListAlternative, type ListFilter, type ListFeature, type ListTopic, requirementList, type TopicView, topicView } from '../lib/reqList';
import { setListOpen } from '../lib/reqView';
import { useVariantsOn } from '../lib/variants';
import { BoardEntry, useApply } from './ReqInfo';

// Takes the website's place: everything it implements, what it could do instead, and a switch for
// each. Like the popups, it's for whoever's reviewing the requirements, so it stays in English.

const LIST = requirementList();
const ALL_TOPICS = LIST.flatMap((feature) => feature.groups.flatMap((group) => group.topics));
const ALL_ALTERNATIVES = new Map(ALL_TOPICS.flatMap((topic) => topic.alternatives.map((a) => [a.text, a] as const)));

const FILTERS: { value: ListFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'implemented', label: 'Implemented' },
  { value: 'inactive', label: 'Not active' },
  { value: 'on', label: 'Switched on' },
];

function AlternativeSwitch({ alternative, active }: { alternative: ListAlternative; active: boolean }) {
  const apply = useApply();
  const id = alternative.variant;
  return (
    <Switch
      size="xs"
      label={alternative.text}
      description={alternative.reason ?? undefined}
      checked={active}
      disabled={!id}
      onChange={() => {
        if (id) apply(() => setVariant(id, !active));
      }}
    />
  );
}

function BlockLabel({ children }: { children: string }) {
  return (
    <Text size="xs" fw={800} tt="uppercase" c="dimmed" mb={6}>
      {children}
    </Text>
  );
}

// Only what's changed draws again when a switch flips, even with every section open.
const TopicCard = memo(
  function TopicCard({ topic, view }: { topic: ListTopic; view: TopicView; viewKey: string }) {
    const changed = view.active.length > 0;
    const both = view.built && view.inactive.length > 0;
    return (
      <Paper withBorder p="sm" radius="md">
        <Group gap={6} mb="xs">
          <Text fw={700} size="sm">
            {topic.title}
          </Text>
          {changed && (
            <Badge size="xs" variant="filled">
              Changed
            </Badge>
          )}
          {topic.board.slice(1).map((board) => (
            <Badge key={board} size="xs" variant="light" color="gray">
              Also {board}
            </Badge>
          ))}
        </Group>
        <SimpleGrid cols={{ base: 1, sm: both ? 2 : 1 }} spacing="md">
          {view.built && (
            <div>
              <BlockLabel>Implemented</BlockLabel>
              <Text size="sm" c={changed ? 'dimmed' : undefined} mb={changed ? 'xs' : 0}>
                {changed && 'As built: '}
                {topic.how}
              </Text>
              <Stack gap="xs">
                {view.active.map((alternative) => (
                  <AlternativeSwitch key={alternative.text} alternative={alternative} active />
                ))}
              </Stack>
            </div>
          )}
          {view.inactive.length > 0 && (
            <div>
              <BlockLabel>Not active</BlockLabel>
              <Stack gap="xs">
                {view.inactive.map((alternative) => (
                  <AlternativeSwitch key={alternative.text} alternative={alternative} active={false} />
                ))}
              </Stack>
            </div>
          )}
        </SimpleGrid>
      </Paper>
    );
  },
  (before, after) => before.topic === after.topic && before.viewKey === after.viewKey,
);

const keyOf = (view: TopicView) => `${view.built}|${view.active.map((a) => a.text).join('|')}|${view.inactive.map((a) => a.text).join('|')}`;

function FeaturePanel({ feature, views }: { feature: ListFeature; views: Map<string, TopicView> }) {
  return (
    <Stack gap="md">
      <BoardEntry id={feature.id} />
      {feature.groups.map((group) => {
        const shown = group.topics.filter((topic) => views.has(topic.id));
        if (!shown.length) return null;
        return (
          <Stack key={group.board} gap="xs">
            {group.board !== feature.id && <BoardEntry id={group.board} />}
            {shown.map((topic) => {
              const view = views.get(topic.id)!;
              return <TopicCard key={topic.id} topic={topic} view={view} viewKey={keyOf(view)} />;
            })}
          </Stack>
        );
      })}
    </Stack>
  );
}

export function RequirementsView() {
  const apply = useApply();
  const on = useVariantsOn();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<ListFilter>('all');
  // The first feature, and whatever's already been switched.
  const [opened, setOpened] = useState<string[]>(() => LIST.filter((feature, index) => index === 0 || feature.groups.some((group) => group.topics.some((topic) => topic.alternatives.some((a) => a.variant && on.includes(a.variant))))).map((feature) => feature.id));

  useEffect(() => {
    const before = document.title;
    document.title = 'Requirements · UniLink';
    return () => {
      document.title = before;
    };
  }, []);

  const views = useMemo(() => {
    const shown = new Map<string, TopicView>();
    for (const topic of ALL_TOPICS) {
      const view = topicView(topic, on, filter, search);
      if (view) shown.set(topic.id, view);
    }
    return shown;
  }, [on, filter, search]);

  const features = LIST.filter((feature) => feature.groups.some((group) => group.topics.some((topic) => views.has(topic.id))));
  // A search or the switched-on list is short, and it's there to be read.
  const openEverything = search.trim() !== '' || filter === 'on';
  const inactiveCount = [...ALL_ALTERNATIVES.values()].filter((a) => !a.variant || !on.includes(a.variant)).length;
  const noSwitch = [...ALL_ALTERNATIVES.values()].filter((a) => !a.variant).length;

  return (
    <Container component="main" size="lg" pb="xl" lang="en">
      <Group className="req-page-bar" justify="space-between" wrap="nowrap">
        <Title order={1} size="h2" className="display">
          Requirements
        </Title>
        <Button style={{ flex: 'none' }} leftSection={<IconArrowLeft size={16} />} onClick={() => setListOpen(false)}>
          <span>
            Back<span className="req-page-back-rest"> to the website</span>
          </span>
        </Button>
      </Group>
      <Text c="dimmed" mb="xs">
        The website is hidden while this list is open. Flip a switch to move a requirement between implemented and not active, then go back to see the site with it.
      </Text>
      <Text size="sm" mb="md">
        <b>{ALL_TOPICS.length}</b> requirements implemented · <b>{inactiveCount}</b> alternatives not active, <b>{noSwitch}</b> of them with no switch · <b>{on.length}</b> switched on
      </Text>
      <Group mb="md" gap="sm" align="center">
        <TextInput style={{ flex: '1 1 220px' }} leftSection={<IconSearch size={16} />} placeholder="Search requirements" aria-label="Search requirements" value={search} onChange={(e) => setSearch(e.currentTarget.value)} />
        <SegmentedControl size="xs" data={FILTERS} value={filter} onChange={(value) => setFilter(value as ListFilter)} aria-label="Which requirements to show" />
        {!openEverything && (
          <Button variant="subtle" size="compact-sm" onClick={() => setOpened(opened.length === LIST.length ? [] : LIST.map((feature) => feature.id))}>
            {opened.length === LIST.length ? 'Close all' : 'Open all'}
          </Button>
        )}
        {on.length > 0 && (
          <Button variant="light" size="compact-sm" onClick={() => apply(clearVariants)}>
            Switch everything back
          </Button>
        )}
      </Group>
      {features.length === 0 ? (
        <Text c="dimmed">{filter === 'on' && !search.trim() ? 'Nothing is switched on, so the site is as it was built.' : 'No requirements match that.'}</Text>
      ) : (
        <Accordion multiple variant="separated" keepMounted={false} value={openEverything ? features.map((feature) => feature.id) : opened} onChange={(next) => !openEverything && setOpened(next)}>
          {features.map((feature) => {
            const topics = feature.groups.flatMap((group) => group.topics).filter((topic) => views.has(topic.id));
            const switched = topics.filter((topic) => topic.alternatives.some((a) => a.variant && on.includes(a.variant))).length;
            return (
              <Accordion.Item key={feature.id} value={feature.id}>
                <Accordion.Control>
                  <Group justify="space-between" gap="xs">
                    <Text fw={800} className="display">
                      {feature.title}
                    </Text>
                    <Group gap={6}>
                      <Text size="xs" c="dimmed">
                        {topics.length === 1 ? '1 requirement' : `${topics.length} requirements`}
                      </Text>
                      {switched > 0 && (
                        <Badge size="xs" variant="filled">
                          {switched} changed
                        </Badge>
                      )}
                    </Group>
                  </Group>
                </Accordion.Control>
                <Accordion.Panel>
                  <FeaturePanel feature={feature} views={views} />
                </Accordion.Panel>
              </Accordion.Item>
            );
          })}
        </Accordion>
      )}
    </Container>
  );
}
