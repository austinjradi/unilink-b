import { type ReactNode, useState } from 'react';
import {
  ActionIcon,
  Autocomplete,
  Button,
  Card,
  Chip,
  Collapse,
  Divider,
  Drawer,
  Grid,
  Group,
  Modal,
  SegmentedControl,
  Select,
  Stack,
  TagsInput,
  Text,
  Textarea,
  TextInput,
  Title,
  Tooltip,
} from '@mantine/core';
import { useForm } from '@mantine/form';
import { useDebouncedValue } from '@mantine/hooks';
import { modals } from '@mantine/modals';
import { IconLock, IconMessageCircle, IconMessages, IconPencil, IconPlus, IconSearch, IconTrash } from '@tabler/icons-react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router';
import { fromNow } from '../lib/format';
import { t, tx } from '../lib/i18n';
import { useAction } from '../lib/hooks';
import { type Out, rpc } from '../lib/rpc';
import { GoatAvatar } from './Goat';
import { Empty, Loading, Tag } from './ui';

// S4 discussion board in the layout of the wireframes (A2Team.pdf p. 9–10): a feed of
// posts with class and type tags and 🐐 reactions, filters on the right, and threads.

type FeedPost = Out<typeof rpc.board.feed>[number];
type PostDetail = Out<typeof rpc.board.get>;
type Since = 'today' | 'week' | 'month' | null;

const TOPIC_COLORS: Record<string, string> = {
  Assignment: 'orange',
  Midterm: 'red',
  Final: 'grape',
  Lecture: 'periwinkle',
  'Study group': 'teal',
  'Just yapping': 'yellow',
};
export const TopicTag = ({ topic }: { topic: string }) => <Tag color={TOPIC_COLORS[topic] ?? 'gray'}>{t(topic)}</Tag>;

// Suggested types are stored in English so filters work for everyone; map a translated pick back.
export const toStoredTopic = (value: string, suggestions: string[]) =>
  suggestions.find((s) => t(s).toLowerCase() === value.trim().toLowerCase()) ?? value.trim();

function ReactionBar({
  goats,
  goated,
  comments,
  onGoat,
  onComments,
}: {
  goats: number;
  goated: boolean;
  comments?: number;
  onGoat: () => void;
  onComments?: () => void;
}) {
  return (
    <div className="reaction-bar">
      <Tooltip label={goated ? t('Take back your goat') : t('Give a goat')}>
        <button type="button" onClick={onGoat} data-on={goated || undefined} aria-label={t('Goat reactions: {{count}}', { count: goats })}>
          <span aria-hidden>🐐</span> {goats}
        </button>
      </Tooltip>
      {onComments && (
        <button type="button" onClick={onComments} aria-label={t('Replies: {{count}}', { count: comments ?? 0 })}>
          <IconMessageCircle size={16} /> {comments}
        </button>
      )}
    </div>
  );
}

function PostCard({ post, onOpen }: { post: FeedPost; onOpen: () => void }) {
  const react = useAction(() => rpc.board.react({ postId: post.id }));
  return (
    <Card padding="lg">
      <Group align="flex-start" wrap="nowrap" gap="md">
        <GoatAvatar goat={post.authorGoat} size={56} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <Group justify="space-between" wrap="nowrap" gap="xs">
            <Group gap="xs" wrap="nowrap" style={{ minWidth: 0 }}>
              <Text fw={700} truncate>
                {post.authorName}
              </Text>
              <Text size="sm" c="dimmed" style={{ whiteSpace: 'nowrap' }}>
                {fromNow(post.createdAt)}
              </Text>
            </Group>
            <Group gap={6} wrap="nowrap">
              {post.visibility === 'selected' && (
                <Tooltip label={t('Only visible to selected classmates')}>
                  <IconLock size={14} />
                </Tooltip>
              )}
              <Tag>{post.classLabel}</Tag>
              <TopicTag topic={post.topic} />
            </Group>
          </Group>
          <Text fw={800} size="lg" mt={4} className="clickable" onClick={onOpen} style={{ borderRadius: 6 }}>
            {post.title}
          </Text>
          <Text size="sm" mt={4} lineClamp={4} style={{ whiteSpace: 'pre-wrap' }}>
            {post.body}
          </Text>
          <Group mt="sm">
            <ReactionBar
              goats={post.goats}
              goated={post.goated}
              comments={post.replyCount}
              onGoat={() => react.mutate()}
              onComments={onOpen}
            />
          </Group>
        </div>
      </Group>
    </Card>
  );
}

const SINCE_OPTIONS: { value: Exclude<Since, null>; label: string }[] = [
  { value: 'today', label: tx('Today') },
  { value: 'week', label: tx('This week') },
  { value: 'month', label: tx('This month') },
];

function ChipSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <Text size="sm" fw={800} mb={6} px={8} py={2} w="fit-content" style={{ background: 'var(--ul-soft)', borderRadius: 6 }}>
        {title}
      </Text>
      {children}
    </div>
  );
}

function MoreChips<T extends string>({ items, render }: { items: T[]; render: (item: T) => ReactNode }) {
  const [open, setOpen] = useState(false);
  const shown = items.slice(0, 4);
  const rest = items.slice(4);
  return (
    <Stack gap={6} align="flex-start">
      {shown.map(render)}
      {rest.length > 0 && (
        <>
          <Collapse expanded={open}>
            <Stack gap={6} align="flex-start">
              {rest.map(render)}
            </Stack>
          </Collapse>
          <Button variant="subtle" color="gray" size="compact-xs" onClick={() => setOpen((o) => !o)}>
            {open ? t('less') : t('more ({{count}})', { count: rest.length })}
          </Button>
        </>
      )}
    </Stack>
  );
}

export function Feed({ classId, left }: { classId?: number; left?: ReactNode }) {
  const [params, setParams] = useSearchParams();
  const openPost = Number(params.get('post')) || null;
  const setOpenPost = (id: number | null) =>
    setParams(
      (p) => {
        if (id) p.set('post', String(id));
        else p.delete('post');
        return p;
      },
      { replace: true },
    );

  const [search, setSearch] = useState('');
  const [debounced] = useDebouncedValue(search, 200);
  const [classIds, setClassIds] = useState<string[]>([]);
  const [topics, setTopics] = useState<string[]>([]);
  const [since, setSince] = useState<Since>(null);
  const [composing, setComposing] = useState<PostDetail | 'new' | null>(null);

  const classes = useQuery({ queryKey: ['classes', 'mine'], queryFn: () => rpc.classes.mine() });
  const allTopics = useQuery({ queryKey: ['board', 'topics', classId ?? null], queryFn: () => rpc.board.topics({ classId: classId ?? null }) });
  const feed = useQuery({
    queryKey: ['board', 'feed', classId ?? null, classIds, topics, since, debounced],
    queryFn: () =>
      rpc.board.feed({
        classIds: classId ? [classId] : classIds.length ? classIds.map(Number) : null,
        topics,
        since,
        search: debounced,
      }),
    placeholderData: keepPreviousData,
  });

  const filters = (
    <Stack gap="md">
      <Text fw={800} size="xl" ta="center" className="display">
        {t('Filters')}
      </Text>
      <TextInput
        placeholder={t('Search posts')}
        leftSection={<IconSearch size={16} />}
        radius="xl"
        value={search}
        onChange={(e) => setSearch(e.currentTarget.value)}
      />
      {!classId && (
        <ChipSection title={t('Classes')}>
          <Chip.Group multiple value={classIds} onChange={setClassIds}>
            <MoreChips
              items={classes.data?.map((c) => String(c.id)) ?? []}
              render={(id) => {
                const c = classes.data!.find((x) => String(x.id) === id)!;
                return (
                  <Chip key={id} value={id} size="sm" variant="outline">
                    {c.subject} {c.number}
                  </Chip>
                );
              }}
            />
          </Chip.Group>
        </ChipSection>
      )}
      <ChipSection title={t('Type')}>
        <Chip.Group multiple value={topics} onChange={setTopics}>
          <MoreChips
            items={allTopics.data ?? []}
            render={(topic) => (
              <Chip key={topic} value={topic} size="sm" variant="outline">
                {t(topic)}
              </Chip>
            )}
          />
        </Chip.Group>
      </ChipSection>
      <ChipSection title={t('Time')}>
        <Chip.Group value={since ?? ''} onChange={(v) => setSince(((v as string) || null) as Since)}>
          <Stack gap={6} align="flex-start">
            {SINCE_OPTIONS.map((o) => (
              <Chip key={o.value} value={o.value} size="sm" variant="outline" onClick={() => since === o.value && setSince(null)}>
                {t(o.label)}
              </Chip>
            ))}
          </Stack>
        </Chip.Group>
      </ChipSection>
    </Stack>
  );

  return (
    <>
      <Grid gap="lg" columns={24}>
        {left && <Grid.Col span={{ base: 24, lg: 6 }}>{left}</Grid.Col>}
        <Grid.Col span={{ base: 24, lg: left ? 13 : 18 }}>
          <Group justify="space-between" mb="md">
            <Title order={3}>{classId ? t('Discussion') : t('Class discussions')}</Title>
            <Button leftSection={<IconPlus size={16} />} onClick={() => setComposing('new')} disabled={!classes.data?.length}>
              {t('New post')}
            </Button>
          </Group>
          {feed.isPending ? (
            <Loading />
          ) : feed.data?.length ? (
            <Stack gap="md">
              {feed.data.map((p) => (
                <PostCard key={p.id} post={p} onOpen={() => setOpenPost(p.id)} />
              ))}
            </Stack>
          ) : (
            <Card>
              <Empty icon={<IconMessages size={22} />}>
                {search || topics.length || classIds.length || since
                  ? t('No posts match these filters.')
                  : classes.data?.length
                    ? t('No posts yet. Ask a question or start a discussion!')
                    : t('Join your classes to see their discussions here.')}
              </Empty>
            </Card>
          )}
        </Grid.Col>
        <Grid.Col span={{ base: 24, lg: left ? 5 : 6 }}>
          <Card padding="md" style={{ position: 'sticky', top: 88 }}>
            {filters}
          </Card>
        </Grid.Col>
      </Grid>

      <Drawer opened={openPost != null} onClose={() => setOpenPost(null)} position="right" size="xl" title={<Text fw={800}>{t('Post')}</Text>}>
        {openPost != null && <PostThread postId={openPost} onEdit={(p) => setComposing(p)} onDeleted={() => setOpenPost(null)} />}
      </Drawer>

      <Modal opened={composing != null} onClose={() => setComposing(null)} title={composing === 'new' ? t('New post') : t('Edit post')} size="lg">
        {composing && (
          <PostForm
            key={composing === 'new' ? 'new' : composing.id}
            classId={classId ?? null}
            topics={allTopics.data ?? []}
            existing={composing === 'new' ? null : composing}
            onDone={(postId) => {
              setComposing(null);
              setOpenPost(postId);
            }}
          />
        )}
      </Modal>
    </>
  );
}

// --- Thread (p. 10): the post, replies, and one level of replies to replies -----------

function ReplyBox({ postId, parentId, onDone, autoFocus }: { postId: number; parentId: number | null; onDone?: () => void; autoFocus?: boolean }) {
  const [body, setBody] = useState('');
  const send = useAction(() => rpc.board.reply({ postId, parentId, body }), {
    onSuccess: () => {
      setBody('');
      onDone?.();
    },
  });
  return (
    <Group align="flex-end" gap="xs" wrap="nowrap">
      <Textarea
        placeholder={parentId ? t('Reply to this…') : t('Write a reply…')}
        autosize
        minRows={1}
        value={body}
        onChange={(e) => setBody(e.currentTarget.value)}
        style={{ flex: 1 }}
        autoFocus={autoFocus}
      />
      <Button onClick={() => send.mutate()} disabled={!body.trim()} loading={send.isPending}>
        {t('Reply')}
      </Button>
    </Group>
  );
}

type Reply = PostDetail['replies'][number];

function ReplyItem({ reply, postId, children }: { reply: Reply; postId: number; children?: ReactNode }) {
  const [replying, setReplying] = useState(false);
  const react = useAction(() => rpc.board.reactReply({ replyId: reply.id }));
  const remove = useAction(() => rpc.board.removeReply({ replyId: reply.id }));
  return (
    <div>
      <Group align="flex-start" wrap="nowrap" gap="sm">
        <GoatAvatar goat={reply.authorGoat} size={44} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <Group gap="xs">
            <Text fw={700} size="sm">
              {reply.authorName}
            </Text>
            <Text size="xs" c="dimmed">
              {fromNow(reply.createdAt)}
            </Text>
          </Group>
          <Text size="sm" style={{ whiteSpace: 'pre-wrap' }}>
            {reply.body}
          </Text>
          <Group gap="xs" mt={6}>
            <ReactionBar goats={reply.goats} goated={reply.goated} onGoat={() => react.mutate()} />
            <Button size="compact-xs" variant="subtle" color="gray" onClick={() => setReplying((r) => !r)}>
              {t('Reply')}
            </Button>
            {reply.mine && (
              <ActionIcon size="sm" variant="subtle" color="red" onClick={() => remove.mutate()} aria-label={t('Delete reply')}>
                <IconTrash size={14} />
              </ActionIcon>
            )}
          </Group>
          {replying && (
            <div style={{ marginTop: 8 }}>
              <ReplyBox postId={postId} parentId={reply.id} onDone={() => setReplying(false)} autoFocus />
            </div>
          )}
        </div>
      </Group>
      {children}
    </div>
  );
}

function PostThread({ postId, onEdit, onDeleted }: { postId: number; onEdit: (p: PostDetail) => void; onDeleted: () => void }) {
  const post = useQuery({ queryKey: ['board', 'post', postId], queryFn: () => rpc.board.get({ postId }) });
  const react = useAction(() => rpc.board.react({ postId }));
  const remove = useAction(() => rpc.board.remove({ postId }), { success: 'Post deleted', onSuccess: onDeleted });

  if (post.isPending) return <Loading />;
  if (!post.data) return <Text c="red">{post.error?.message}</Text>;
  const p = post.data;
  const top = p.replies.filter((r) => r.parentId == null);

  const confirmDelete = () =>
    modals.openConfirmModal({
      title: t('Delete this post?'),
      children: <Text size="sm">{t('Its replies will be deleted too.')}</Text>,
      labels: { confirm: t('Delete'), cancel: t('Keep') },
      confirmProps: { color: 'red' },
      onConfirm: () => remove.mutate(),
    });

  return (
    <Stack gap="lg">
      <Group align="flex-start" wrap="nowrap" gap="md">
        <GoatAvatar goat={p.authorGoat} size={64} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <Group justify="space-between" wrap="nowrap">
            <Group gap="xs">
              <Text fw={700}>{p.authorName}</Text>
              <Text size="sm" c="dimmed">
                {fromNow(p.createdAt)}
                {p.editedAt && ` · ${t('edited')}`}
              </Text>
            </Group>
            <Group gap={6} wrap="nowrap">
              <Tag>{p.classLabel}</Tag>
              <TopicTag topic={p.topic} />
              {p.mine && (
                <>
                  <ActionIcon variant="subtle" onClick={() => onEdit(p)} aria-label={t('Edit post')}>
                    <IconPencil size={16} />
                  </ActionIcon>
                  <ActionIcon variant="subtle" color="red" onClick={confirmDelete} aria-label={t('Delete post')}>
                    <IconTrash size={16} />
                  </ActionIcon>
                </>
              )}
            </Group>
          </Group>
          <Title order={3} mt={4}>
            {p.title}
          </Title>
          {p.visibility === 'selected' && (
            <Group gap={4} mt={2} c="dimmed">
              <IconLock size={12} />
              <Text size="xs">
                {t('Visible to {{who}}', { who: p.mine ? p.audience.map((a) => a.name).join(', ') : t('you and a few classmates') })}
              </Text>
            </Group>
          )}
          <Text mt="xs" style={{ whiteSpace: 'pre-wrap' }}>
            {p.body}
          </Text>
          <Group mt="sm">
            <ReactionBar goats={p.goats} goated={p.goated} comments={p.replies.length} onGoat={() => react.mutate()} />
          </Group>
        </div>
      </Group>

      <Divider />
      <ReplyBox postId={postId} parentId={null} />
      {top.map((r) => {
        const children = p.replies.filter((c) => c.parentId === r.id);
        return (
          <ReplyItem key={r.id} reply={r} postId={postId}>
            {children.length > 0 && (
              <Stack gap="md" mt="md" className="thread">
                {children.map((c) => (
                  <ReplyItem key={c.id} reply={c} postId={postId} />
                ))}
              </Stack>
            )}
          </ReplyItem>
        );
      })}
    </Stack>
  );
}

function PostForm({
  classId,
  topics,
  existing,
  onDone,
}: {
  classId: number | null;
  topics: string[];
  existing: PostDetail | null;
  onDone: (postId: number) => void;
}) {
  const myClasses = useQuery({ queryKey: ['classes', 'mine'], queryFn: () => rpc.classes.mine() });
  const form = useForm({
    initialValues: {
      classId: String(existing?.classId ?? classId ?? ''),
      topic: existing ? t(existing.topic) : '',
      title: existing?.title ?? '',
      body: existing?.body ?? '',
      visibility: (existing?.visibility ?? 'class') as 'class' | 'selected',
      audienceEmails: [] as string[],
    },
    validate: {
      classId: (v) => (v ? null : t('Pick a class')),
      topic: (v) => (v.trim() ? null : t('Pick or type a type, e.g. "Assignment"')),
      title: (v) => (v.trim() ? null : t('Add a title')),
      body: (v) => (v.trim() ? null : t('Write something')),
      audienceEmails: (v, values) => (values.visibility === 'selected' && !existing && !v.length ? t('Add at least one classmate') : null),
    },
  });
  const classmates = useQuery({
    queryKey: ['classes', 'classmates', form.values.classId],
    queryFn: () => rpc.classes.classmates({ classId: Number(form.values.classId) }),
    enabled: !!form.values.classId,
  });
  const save = useAction(
    async (v: typeof form.values) => {
      const topic = toStoredTopic(v.topic, topics);
      if (existing) {
        await rpc.board.update({ postId: existing.id, topic, title: v.title, body: v.body });
        return { id: existing.id };
      }
      return rpc.board.create({ ...v, topic, classId: Number(v.classId) });
    },
    { success: existing ? 'Post updated' : 'Posted', onSuccess: (r) => onDone(r.id) },
  );

  return (
    <form onSubmit={form.onSubmit((v) => save.mutate(v))}>
      <Stack>
        <Group grow align="flex-start">
          <Select
            label={t('Class')}
            data={myClasses.data?.map((c) => ({ value: String(c.id), label: `${c.subject} ${c.number}` })) ?? []}
            disabled={!!existing || !!classId}
            allowDeselect={false}
            {...form.getInputProps('classId')}
          />
          <Autocomplete
            label={t('Type')}
            placeholder={t('Assignment, Midterm, Just yapping…')}
            data={topics.map((topic) => t(topic))}
            {...form.getInputProps('topic')}
          />
        </Group>
        <TextInput label={t('Title')} data-autofocus {...form.getInputProps('title')} />
        <Textarea label={t('Post')} autosize minRows={5} {...form.getInputProps('body')} />
        {!existing && (
          <>
            <SegmentedControl
              data={[
                { value: 'class', label: t('Whole class') },
                { value: 'selected', label: t('Selected classmates') },
              ]}
              {...form.getInputProps('visibility')}
            />
            {form.values.visibility === 'selected' && (
              <TagsInput
                label={t('Who can see it')}
                description={t('McGill emails of classmates in this class. Press Enter after each.')}
                data={classmates.data?.map((c) => ({ value: c.email, label: `${c.name} (${c.email})` })) ?? []}
                {...form.getInputProps('audienceEmails')}
              />
            )}
          </>
        )}
        <Group justify="flex-end">
          <Button type="submit" loading={save.isPending}>
            {existing ? t('Save') : t('Post')}
          </Button>
        </Group>
      </Stack>
    </form>
  );
}
