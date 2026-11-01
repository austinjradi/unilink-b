import { type ReactNode, useState } from 'react';
import {
  ActionIcon,
  Anchor,
  Button,
  Card,
  Chip,
  Collapse,
  Divider,
  Drawer,
  Grid,
  Group,
  Modal,
  Popover,
  SegmentedControl,
  Select,
  Stack,
  TagsInput,
  Text,
  Textarea,
  TextInput,
  Title,
  Tooltip,
  UnstyledButton,
} from '@mantine/core';
import { useForm } from '@mantine/form';
import { useDebouncedValue } from '@mantine/hooks';
import { modals } from '@mantine/modals';
import { IconCheck, IconCircleCheck, IconLock, IconMessageCircle, IconMessages, IconPencil, IconPlus, IconSearch, IconTrash } from '@tabler/icons-react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router';
import { fromNow } from '../lib/format';
import { t, tx } from '../lib/i18n';
import { useAction } from '../lib/hooks';
import { type Out, rpc } from '../lib/rpc';
import { GoatAvatar } from './Goat';
import { Empty, Loading, Tag } from './ui';

// S4 discussion board in the layout of the wireframes (A2Team.pdf p. 9–10): a feed of
// posts with class and topic tags and 🐐 reactions, filters on the right, and threads.
// Version B: questions and notes, fixed topics, flat replies and accepted answers.

type FeedPost = Out<typeof rpc.board.feed>[number];
type PostDetail = Out<typeof rpc.board.get>;
type Since = 'today' | 'week' | 'month' | null;

const TOPIC_COLORS: Record<string, string> = {
  Lectures: 'periwinkle',
  Assignments: 'orange',
  Exams: 'red',
  'Labs and tutorials': 'teal',
  Logistics: 'grape',
  'Off-topic': 'yellow',
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

type Author = Pick<FeedPost, 'authorName' | 'authorEmail' | 'authorPronouns' | 'authorFaculty' | 'authorGradYear' | 'formerStudent' | 'authorGoat'>;

// G4.5 "view profile": a classmate's name opens what they share once they've posted (S1).
function AuthorName({ who, size }: { who: Author; size?: 'sm' }) {
  if (who.formerStudent) {
    return (
      <Text fw={700} size={size}>
        {t('Former student')}
      </Text>
    );
  }
  return (
    <Popover position="bottom-start" shadow="md" width={280}>
      <Popover.Target>
        <UnstyledButton style={{ minWidth: 0 }}>
          <Text fw={700} size={size} truncate className="author-link">
            {who.authorName}
          </Text>
        </UnstyledButton>
      </Popover.Target>
      <Popover.Dropdown>
        <Group wrap="nowrap" align="flex-start" gap="sm">
          <GoatAvatar goat={who.authorGoat} size={56} />
          <div style={{ minWidth: 0 }}>
            <Text fw={800}>{who.authorName}</Text>
            {who.authorPronouns && (
              <Text size="xs" c="dimmed">
                {who.authorPronouns}
              </Text>
            )}
            {who.authorFaculty && <Text size="sm">{t(who.authorFaculty)}</Text>}
            {who.authorGradYear && (
              <Text size="sm">
                {t('Expected graduation')} {who.authorGradYear}
              </Text>
            )}
            <Anchor href={`mailto:${who.authorEmail}`} size="sm" style={{ wordBreak: 'break-all' }}>
              {who.authorEmail}
            </Anchor>
          </div>
        </Group>
      </Popover.Dropdown>
    </Popover>
  );
}

// "Question · Answered" / "Question · Unanswered" / "Note".
function KindTag({ post }: { post: { kind: string; acceptedReplyId: number | null; deletedAt: Date | null } }) {
  if (post.kind === 'note') return <Tag color="gray">{t('Note')}</Tag>;
  return post.acceptedReplyId ? (
    <Tag color="teal">
      <IconCheck size={12} style={{ verticalAlign: -1 }} /> {t('Answered')}
    </Tag>
  ) : (
    <Tag color="orange">{post.deletedAt ? t('Question') : t('Unanswered')}</Tag>
  );
}

function PostCard({ post, onOpen }: { post: FeedPost; onOpen: () => void }) {
  const react = useAction(() => rpc.board.react({ postId: post.id }));
  return (
    <Card padding="lg">
      <Group align="flex-start" wrap="nowrap" gap="md">
        <GoatAvatar goat={post.authorGoat} size={56} />
        <div style={{ flex: 1, minWidth: 0 }}>
          {/* The tags drop below the name on narrow screens instead of running off the card. */}
          <Group justify="space-between" gap="xs" style={{ rowGap: 4 }}>
            <Group gap="xs" wrap="nowrap" style={{ minWidth: 0 }}>
              {post.deletedAt ? <Text fw={700}>{t('Deleted post')}</Text> : <AuthorName who={post} />}
              <Text size="sm" c="dimmed" style={{ whiteSpace: 'nowrap' }}>
                {fromNow(post.createdAt)}
              </Text>
            </Group>
            <Group gap={6}>
              {post.visibility === 'selected' && (
                <Tooltip label={t('Only visible to selected classmates')}>
                  <IconLock size={14} />
                </Tooltip>
              )}
              <Tag>{post.classLabel}</Tag>
              <TopicTag topic={post.topic} />
              <KindTag post={post} />
            </Group>
          </Group>
          <UnstyledButton display="block" mt={4} className="clickable" onClick={onOpen} style={{ borderRadius: 6 }}>
            <Text fw={800} size="lg" c={post.deletedAt ? 'dimmed' : undefined}>
              {post.deletedAt ? t('The author deleted this post. Its replies are still here.') : post.title}
            </Text>
          </UnstyledButton>
          {!post.deletedAt && (
            <Text size="sm" mt={4} lineClamp={4} style={{ whiteSpace: 'pre-wrap' }}>
              {post.body}
            </Text>
          )}
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
  const [unresolved, setUnresolved] = useState(false);
  const [composing, setComposing] = useState<PostDetail | 'new' | null>(null);

  const classes = useQuery({ queryKey: ['classes', 'mine'], queryFn: () => rpc.classes.mine() });
  const allTopics = useQuery({ queryKey: ['board', 'topics', classId ?? null], queryFn: () => rpc.board.topics({ classId: classId ?? null }) });
  const feed = useQuery({
    queryKey: ['board', 'feed', classId ?? null, classIds, topics, since, debounced, unresolved],
    queryFn: () =>
      rpc.board.feed({
        classIds: classId ? [classId] : classIds.length ? classIds.map(Number) : null,
        topics,
        since,
        search: debounced,
        unresolved,
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
                    {c.code}
                  </Chip>
                );
              }}
            />
          </Chip.Group>
        </ChipSection>
      )}
      <ChipSection title={t('Questions')}>
        <Chip size="sm" variant="outline" checked={unresolved} onChange={setUnresolved}>
          {t('Unanswered only')}
        </Chip>
      </ChipSection>
      <ChipSection title={t('Topic')}>
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
                {search || topics.length || classIds.length || since || unresolved
                  ? t('No posts match these filters.')
                  : classes.data?.length
                    ? t('No posts yet. Ask a question or start a discussion!')
                    : t('Join your classes to see their discussions here.')}
              </Empty>
              {classes.data?.length === 0 && (
                <Group justify="center" mb="md">
                  <Button component={Link} to="/courses/find" variant="light" leftSection={<IconSearch size={16} />}>
                    {t('Find your courses')}
                  </Button>
                </Group>
              )}
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

// --- Thread (p. 10): the post and one flat list of replies, the accepted answer first ----

function ReplyBox({ postId, isQuestion }: { postId: number; isQuestion: boolean }) {
  const [body, setBody] = useState('');
  const send = useAction(() => rpc.board.reply({ postId, body }), { onSuccess: () => setBody('') });
  return (
    <Group align="flex-end" gap="xs" wrap="nowrap">
      <Textarea
        placeholder={isQuestion ? t('Write an answer…') : t('Write a reply…')}
        autosize
        minRows={1}
        value={body}
        onChange={(e) => setBody(e.currentTarget.value)}
        style={{ flex: 1 }}
      />
      <Button onClick={() => send.mutate()} disabled={!body.trim()} loading={send.isPending}>
        {t('Reply')}
      </Button>
    </Group>
  );
}

type Reply = PostDetail['replies'][number];

function ReplyItem({ reply, postId, canAccept }: { reply: Reply; postId: number; canAccept: boolean }) {
  const react = useAction(() => rpc.board.reactReply({ replyId: reply.id }));
  const remove = useAction(() => rpc.board.removeReply({ replyId: reply.id }));
  const accept = useAction(() => rpc.board.accept({ postId, replyId: reply.accepted ? null : reply.id }), {
    success: reply.accepted ? t('Answer unmarked') : t('Marked as the answer'),
  });
  return (
    <Card
      padding="sm"
      withBorder={reply.accepted}
      style={reply.accepted ? { borderColor: 'var(--mantine-color-teal-5)', background: 'var(--mantine-color-teal-light)' } : { background: 'transparent' }}
    >
      {reply.accepted && (
        <Group gap={4} c="teal" mb={6}>
          <IconCircleCheck size={16} />
          <Text size="xs" fw={800}>
            {t('Accepted answer')}
          </Text>
        </Group>
      )}
      <Group align="flex-start" wrap="nowrap" gap="sm">
        <GoatAvatar goat={reply.authorGoat} size={44} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <Group gap="xs">
            <AuthorName who={reply} size="sm" />
            <Text size="xs" c="dimmed">
              {fromNow(reply.createdAt)}
            </Text>
          </Group>
          <Text size="sm" style={{ whiteSpace: 'pre-wrap' }}>
            {reply.body}
          </Text>
          <Group gap="xs" mt={6}>
            <ReactionBar goats={reply.goats} goated={reply.goated} onGoat={() => react.mutate()} />
            {canAccept && !reply.mine && (
              <Button size="compact-xs" variant="subtle" color="teal" leftSection={<IconCheck size={12} />} onClick={() => accept.mutate()}>
                {reply.accepted ? t('Unmark answer') : t('Accept answer')}
              </Button>
            )}
            {reply.mine && (
              <ActionIcon size="sm" variant="subtle" color="red" onClick={() => remove.mutate()} aria-label={t('Delete reply')}>
                <IconTrash size={14} />
              </ActionIcon>
            )}
          </Group>
        </div>
      </Group>
    </Card>
  );
}

function PostThread({ postId, onEdit, onDeleted }: { postId: number; onEdit: (p: PostDetail) => void; onDeleted: () => void }) {
  const post = useQuery({ queryKey: ['board', 'post', postId], queryFn: () => rpc.board.get({ postId }) });
  const react = useAction(() => rpc.board.react({ postId }));
  const remove = useAction(() => rpc.board.remove({ postId }), {
    success: (r) => (r.kept ? t('Post deleted. Its replies stay up.') : t('Post deleted')),
    onSuccess: (r) => !r.kept && onDeleted(),
  });

  if (post.isPending) return <Loading />;
  if (!post.data) return <Text c="red">{post.error?.message}</Text>;
  const p = post.data;
  const isQuestion = p.kind === 'question';

  const confirmDelete = () =>
    modals.openConfirmModal({
      title: t('Delete this post?'),
      children: (
        <Text size="sm">
          {p.replies.length ? t("Your post is blanked but its replies stay, so classmates keep the answers.") : t('It has no replies, so it’s removed completely.')}
        </Text>
      ),
      labels: { confirm: t('Delete'), cancel: t('Keep') },
      confirmProps: { color: 'red' },
      onConfirm: () => remove.mutate(),
    });

  return (
    <Stack gap="lg">
      <Group align="flex-start" wrap="nowrap" gap="md">
        <GoatAvatar goat={p.authorGoat} size={64} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <Group justify="space-between" gap="xs" style={{ rowGap: 4 }}>
            <Group gap="xs">
              {p.deletedAt ? <Text fw={700}>{t('Deleted post')}</Text> : <AuthorName who={p} />}
              <Text size="sm" c="dimmed">
                {fromNow(p.createdAt)}
                {p.editedAt && ` · ${t('edited')}`}
              </Text>
            </Group>
            <Group gap={6}>
              <Tag>{p.classLabel}</Tag>
              <TopicTag topic={p.topic} />
              <KindTag post={p} />
              {p.mine && !p.deletedAt && (
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
          <Title order={3} mt={4} c={p.deletedAt ? 'dimmed' : undefined}>
            {p.deletedAt ? t('The author deleted this post. Its replies are still here.') : p.title}
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

      {p.mine && isQuestion && !p.acceptedReplyId && p.replies.some((r) => !r.mine) && (
        <Text size="xs" c="dimmed">
          {t('Did a reply answer your question? Accept it so classmates find it first.')}
        </Text>
      )}
      <Divider label={isQuestion ? t('Answers') : t('Replies')} labelPosition="left" />
      <ReplyBox postId={postId} isQuestion={isQuestion} />
      {p.replies.map((r) => (
        <ReplyItem key={r.id} reply={r} postId={postId} canAccept={p.mine && isQuestion && !p.deletedAt} />
      ))}
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
      kind: (existing?.kind ?? 'question') as 'question' | 'note',
      topic: existing?.topic ?? '',
      title: existing?.title ?? '',
      body: existing?.body ?? '',
      visibility: (existing?.visibility ?? 'class') as 'class' | 'selected',
      audienceEmails: [] as string[],
    },
    validate: {
      classId: (v) => (v ? null : t('Pick a class')),
      topic: (v) => (v ? null : t('Pick a topic')),
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
      if (existing) {
        await rpc.board.update({ postId: existing.id, kind: v.kind, topic: v.topic, title: v.title, body: v.body });
        return { id: existing.id };
      }
      return rpc.board.create({ ...v, classId: Number(v.classId) });
    },
    { success: existing ? 'Post updated' : 'Posted', onSuccess: (r) => onDone(r.id) },
  );

  return (
    <form onSubmit={form.onSubmit((v) => save.mutate(v))}>
      <Stack>
        <SegmentedControl
          data={[
            { value: 'question', label: t('Question') },
            { value: 'note', label: t('Note') },
          ]}
          {...form.getInputProps('kind')}
        />
        <Text size="xs" c="dimmed" mt={-8}>
          {form.values.kind === 'question'
            ? t('You can accept the reply that answers it.')
            : t('For sharing something: notes, tips, announcements.')}
        </Text>
        <Group grow align="flex-start">
          <Select
            label={t('Class')}
            data={myClasses.data?.map((c) => ({ value: String(c.id), label: c.code })) ?? []}
            disabled={!!existing || !!classId}
            allowDeselect={false}
            {...form.getInputProps('classId')}
          />
          <Select
            label={t('Topic')}
            placeholder={t('Pick a topic')}
            data={topics.map((topic) => ({ value: topic, label: t(topic) }))}
            allowDeselect={false}
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
