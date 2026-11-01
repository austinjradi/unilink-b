import { useState } from 'react';
import {
  ActionIcon,
  Autocomplete,
  Badge,
  Button,
  Chip,
  Divider,
  Drawer,
  Group,
  Modal,
  Paper,
  SegmentedControl,
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
import { IconLock, IconMessage, IconMessages, IconPencil, IconPlus, IconSearch, IconTrash } from '@tabler/icons-react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router';
import { Empty, Loading, SectionCard } from '../../components/ui';
import { fromNow } from '../../lib/format';
import { useAction } from '../../lib/hooks';
import { type Out, rpc } from '../../lib/rpc';

type PostDetail = Out<typeof rpc.board.get>;

// S4: Ed-style discussion board for a class.
export function Discussion({ classId }: { classId: number }) {
  const [topic, setTopic] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [debounced] = useDebouncedValue(search, 200);
  // The open post lives in the URL (?post=12) so notification links can open it.
  const [params, setParams] = useSearchParams();
  const openPost = Number(params.get('post')) || null;
  const setOpenPost = (id: number | null) => setParams(id ? { post: String(id) } : {}, { replace: true });
  const [composing, setComposing] = useState<PostDetail | 'new' | null>(null);

  const topics = useQuery({ queryKey: ['board', 'topics', classId], queryFn: () => rpc.board.topics({ classId }) });
  const posts = useQuery({
    queryKey: ['board', 'list', classId, topic, debounced],
    queryFn: () => rpc.board.list({ classId, topic, search: debounced }),
    placeholderData: keepPreviousData,
  });

  return (
    <SectionCard
      title="Discussion"
      actions={
        <Button size="xs" leftSection={<IconPlus size={14} />} onClick={() => setComposing('new')}>
          New post
        </Button>
      }
    >
      <Group mb="md" justify="space-between">
        <Chip.Group value={topic ?? 'all'} onChange={(v) => setTopic(v === 'all' ? null : (v as string))}>
          <Group gap={6}>
            <Chip value="all" size="xs">
              All topics
            </Chip>
            {topics.data?.map((t) => (
              <Chip key={t} value={t} size="xs">
                {t}
              </Chip>
            ))}
          </Group>
        </Chip.Group>
        <TextInput
          size="xs"
          placeholder="Search posts"
          leftSection={<IconSearch size={14} />}
          value={search}
          onChange={(e) => setSearch(e.currentTarget.value)}
          w={220}
        />
      </Group>

      {posts.isPending ? (
        <Loading />
      ) : posts.data?.length ? (
        <Stack gap={6}>
          {posts.data.map((p) => (
            <Paper key={p.id} withBorder p="sm" className="clickable" onClick={() => setOpenPost(p.id)}>
              <Group justify="space-between" wrap="nowrap">
                <div style={{ minWidth: 0 }}>
                  <Group gap="xs" wrap="nowrap">
                    {p.visibility === 'selected' && (
                      <Tooltip label="Only visible to selected classmates">
                        <IconLock size={14} />
                      </Tooltip>
                    )}
                    <Text fw={600} truncate>
                      {p.title}
                    </Text>
                  </Group>
                  <Text size="xs" c="dimmed">
                    {p.authorName} · {fromNow(p.createdAt)}
                    {p.editedAt && ' · edited'}
                  </Text>
                </div>
                <Group gap="xs" wrap="nowrap">
                  <Badge variant="light" size="sm">
                    {p.topic}
                  </Badge>
                  <Group gap={4} c="dimmed" w={44} justify="flex-end">
                    <IconMessage size={14} />
                    <Text size="xs">{p.replyCount}</Text>
                  </Group>
                </Group>
              </Group>
            </Paper>
          ))}
        </Stack>
      ) : (
        <Empty icon={<IconMessages size={22} />}>
          {search || topic ? 'No posts match.' : 'No posts yet. Ask a question or start a discussion!'}
        </Empty>
      )}

      <Drawer opened={openPost != null} onClose={() => setOpenPost(null)} position="right" size="xl" title="Post">
        {openPost != null && (
          <PostView postId={openPost} onEdit={(p) => setComposing(p)} onDeleted={() => setOpenPost(null)} />
        )}
      </Drawer>

      <Modal opened={composing != null} onClose={() => setComposing(null)} title={composing === 'new' ? 'New post' : 'Edit post'} size="lg">
        {composing && (
          <PostForm
            key={composing === 'new' ? 'new' : composing.id}
            classId={classId}
            topics={topics.data ?? []}
            existing={composing === 'new' ? null : composing}
            onDone={(postId) => {
              setComposing(null);
              setOpenPost(postId);
            }}
          />
        )}
      </Modal>
    </SectionCard>
  );
}

function PostView({ postId, onEdit, onDeleted }: { postId: number; onEdit: (p: PostDetail) => void; onDeleted: () => void }) {
  const post = useQuery({ queryKey: ['board', 'post', postId], queryFn: () => rpc.board.get({ postId }) });
  const [reply, setReply] = useState('');
  const send = useAction(() => rpc.board.reply({ postId, body: reply }), { onSuccess: () => setReply('') });
  const remove = useAction(() => rpc.board.remove({ postId }), { success: 'Post deleted', onSuccess: onDeleted });
  const removeReply = useAction((replyId: number) => rpc.board.removeReply({ replyId }));

  if (post.isPending) return <Loading />;
  if (!post.data) return <Text c="red">{post.error?.message}</Text>;
  const p = post.data;

  const confirmDelete = () =>
    modals.openConfirmModal({
      title: 'Delete this post?',
      children: <Text size="sm">Its replies will be deleted too.</Text>,
      labels: { confirm: 'Delete', cancel: 'Keep' },
      confirmProps: { color: 'red' },
      onConfirm: () => remove.mutate(),
    });

  return (
    <Stack>
      <div>
        <Group justify="space-between" align="flex-start">
          <Badge variant="light">{p.topic}</Badge>
          {p.mine && (
            <Group gap={4}>
              <ActionIcon variant="subtle" onClick={() => onEdit(p)} aria-label="Edit post">
                <IconPencil size={16} />
              </ActionIcon>
              <ActionIcon variant="subtle" color="red" onClick={confirmDelete} aria-label="Delete post">
                <IconTrash size={16} />
              </ActionIcon>
            </Group>
          )}
        </Group>
        <Title order={3} mt="xs">
          {p.title}
        </Title>
        <Text size="xs" c="dimmed">
          {p.authorName} ({p.authorEmail}) · {fromNow(p.createdAt)}
          {p.editedAt && ` · edited ${fromNow(p.editedAt)}`}
        </Text>
        {p.visibility === 'selected' && (
          <Group gap={4} mt={4} c="dimmed">
            <IconLock size={12} />
            <Text size="xs">Visible to {p.mine ? p.audience.map((a) => a.name).join(', ') : 'you and a few classmates'}</Text>
          </Group>
        )}
      </div>
      <Text style={{ whiteSpace: 'pre-wrap' }}>{p.body}</Text>

      <Divider label={`${p.replies.length} ${p.replies.length === 1 ? 'reply' : 'replies'}`} labelPosition="left" />
      {p.replies.map((r) => (
        <Paper key={r.id} withBorder p="sm" bg="var(--mantine-color-default-hover)">
          <Group justify="space-between" mb={4}>
            <Text size="xs" fw={600}>
              {r.authorName} <Text span c="dimmed" fw={400}>· {fromNow(r.createdAt)}</Text>
            </Text>
            {r.mine && (
              <ActionIcon size="sm" variant="subtle" color="red" onClick={() => removeReply.mutate(r.id)} aria-label="Delete reply">
                <IconTrash size={14} />
              </ActionIcon>
            )}
          </Group>
          <Text size="sm" style={{ whiteSpace: 'pre-wrap' }}>
            {r.body}
          </Text>
        </Paper>
      ))}
      <Textarea placeholder="Write a reply…" autosize minRows={2} value={reply} onChange={(e) => setReply(e.currentTarget.value)} />
      <Group justify="flex-end">
        <Button onClick={() => send.mutate()} disabled={!reply.trim()} loading={send.isPending}>
          Reply
        </Button>
      </Group>
    </Stack>
  );
}

function PostForm({
  classId,
  topics,
  existing,
  onDone,
}: {
  classId: number;
  topics: string[];
  existing: PostDetail | null;
  onDone: (postId: number) => void;
}) {
  const classmates = useQuery({ queryKey: ['classes', 'classmates', classId], queryFn: () => rpc.classes.classmates({ classId }) });
  const form = useForm({
    initialValues: {
      topic: existing?.topic ?? '',
      title: existing?.title ?? '',
      body: existing?.body ?? '',
      visibility: (existing?.visibility ?? 'class') as 'class' | 'selected',
      audienceEmails: [] as string[],
    },
    validate: {
      topic: (v) => (v.trim() ? null : 'Pick or type a topic, e.g. "Assignment 2"'),
      title: (v) => (v.trim() ? null : 'Add a title'),
      body: (v) => (v.trim() ? null : 'Write something'),
      audienceEmails: (v, values) => (values.visibility === 'selected' && !existing && !v.length ? 'Add at least one classmate' : null),
    },
  });
  const save = useAction(
    async (v: typeof form.values) => {
      if (existing) {
        await rpc.board.update({ postId: existing.id, topic: v.topic, title: v.title, body: v.body });
        return { id: existing.id };
      }
      return rpc.board.create({ classId, ...v });
    },
    { success: existing ? 'Post updated' : 'Posted', onSuccess: (r) => onDone(r.id) },
  );

  return (
    <form onSubmit={form.onSubmit((v) => save.mutate(v))}>
      <Stack>
        <Autocomplete label="Topic" placeholder="Assignment 2, Midterm, Lecture 5…" data={topics} {...form.getInputProps('topic')} />
        <TextInput label="Title" data-autofocus {...form.getInputProps('title')} />
        <Textarea label="Post" autosize minRows={5} {...form.getInputProps('body')} />
        {!existing && (
          <>
            <SegmentedControl
              data={[
                { value: 'class', label: 'Whole class' },
                { value: 'selected', label: 'Selected classmates' },
              ]}
              {...form.getInputProps('visibility')}
            />
            {form.values.visibility === 'selected' && (
              <TagsInput
                label="Who can see it"
                description="McGill emails of classmates in this class. Press Enter after each."
                data={classmates.data?.map((c) => ({ value: c.email, label: `${c.name} (${c.email})` })) ?? []}
                {...form.getInputProps('audienceEmails')}
              />
            )}
          </>
        )}
        <Group justify="flex-end">
          <Button type="submit" loading={save.isPending}>
            {existing ? 'Save' : 'Post'}
          </Button>
        </Group>
      </Stack>
    </form>
  );
}
