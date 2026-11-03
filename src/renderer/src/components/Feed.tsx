import { type ClipboardEvent, type ReactNode, useEffect, useState } from 'react';
import {
  ActionIcon,
  Alert,
  Anchor,
  Badge,
  Box,
  Button,
  Card,
  Chip,
  Code,
  Collapse,
  Divider,
  Drawer,
  Grid,
  Group,
  Image,
  Modal,
  MultiSelect,
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
import {
  IconBell,
  IconBellOff,
  IconBellRinging,
  IconCheck,
  IconCircleCheck,
  IconLockOpen,
  IconMessageOff,
  IconPin,
  IconPinnedOff,
  IconSchool,
  IconShieldX,
  IconFilter,
  IconFlag,
  IconLock,
  IconMessageCircle,
  IconMessages,
  IconPencil,
  IconPhoto,
  IconPlus,
  IconSearch,
  IconTrash,
  IconX,
} from '@tabler/icons-react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router';
import { parsePost } from '@shared/postText';
import { MathText } from './MathText';
import { loadDraft, saveDraft } from '../lib/drafts';
import { fromNow } from '../lib/format';
import { t, tx } from '../lib/i18n';
import { useAction, useMe } from '../lib/hooks';
import { type Out, rpc } from '../lib/rpc';
import { GoatAvatar } from './Goat';
import { Empty, Loading, Tag } from './ui';
import type { ReqTopicId } from '../lib/reqTopics';
import { ReqInfo, WithInfo } from './ReqInfo';

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
    <Group gap={4} wrap="nowrap">
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
    <ReqInfo id="post-goat" />
    {onComments && <ReqInfo id="post-replies" />}
    </Group>
  );
}

// Posts are plain text with code and links, as on Ed (shared/postText.ts).
function Body({ text }: { text: string }) {
  return (
    <>
      {parsePost(text).map((part, i) =>
        part.kind === 'code' ? (
          <Code key={i}>{part.text}</Code>
        ) : part.kind === 'block' ? (
          <Code key={i} block my={6}>
            {part.text}
          </Code>
        ) : part.kind === 'math' || part.kind === 'mathblock' ? (
          <MathText key={i} tex={part.text} block={part.kind === 'mathblock'} />
        ) : part.kind === 'link' ? (
          <Anchor key={i} href={part.text} target="_blank" rel="noopener noreferrer" inherit style={{ wordBreak: 'break-all' }} onClick={(e) => e.stopPropagation()}>
            {part.text}
          </Anchor>
        ) : (
          part.text
        ),
      )}
    </>
  );
}

// How code and math will come out, while writing them.
function Preview({ text }: { text: string }) {
  if (!parsePost(text).some((part) => part.kind !== 'text' && part.kind !== 'link')) return null;
  return (
    <Box px="sm" py={6} style={{ border: '1.5px dashed var(--ul-border)', borderRadius: 12 }}>
      <Text size="xs" fw={800} c="dimmed" mb={2}>
        {t('Preview')} <ReqInfo id="post-body" />
      </Text>
      <Text size="sm" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
        <Body text={text} />
      </Text>
    </Box>
  );
}

// A post's or reply's images: click one to see it full size in a new tab.
function Images({ images, height }: { images: { id: number; name: string }[]; height: number }) {
  if (!images.length) return null;
  return (
    <Group gap="xs" mt="xs">
      {images.map((image) => (
        <StoredImage key={image.id} image={image} height={height} />
      ))}
      <ReqInfo id="post-images" />
    </Group>
  );
}

function StoredImage({ image, height }: { image: { id: number; name: string }; height: number }) {
  const url = useQuery({ queryKey: ['board', 'image', image.id], queryFn: () => rpc.board.imageUrl({ id: image.id }), staleTime: Infinity });
  if (!url.data) return null;
  return (
    <Anchor href={url.data} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} aria-label={t('Open {{name}} full size', { name: image.name })}>
      <Image src={url.data} alt={image.name} h={height} w="auto" maw="100%" radius="md" fit="contain" style={{ border: '1.5px solid var(--ul-border)' }} />
    </Anchor>
  );
}

// Images waiting to go out with a post or reply, picked or pasted.
const MAX_IMAGES = 4;

function useImageDraft() {
  const [images, setImages] = useState<{ path: string; name: string }[]>([]);
  const choose = useAction(() => rpc.board.chooseImage(), { onSuccess: (file) => file && setImages((list) => [...list, file].slice(0, MAX_IMAGES)) });
  return {
    images,
    choose,
    remove: (index: number) => setImages((list) => list.filter((_, i) => i !== index)),
    clear: () => setImages([]),
    // A screenshot pasted into the text goes in as an image instead of doing nothing.
    onPaste: (e: ClipboardEvent<HTMLTextAreaElement>) => {
      const files = [...e.clipboardData.files].filter((file) => file.type.startsWith('image/'));
      if (!files.length) return;
      e.preventDefault();
      setImages((list) => [...list, ...files.map((file) => ({ path: window.unilink.addFile(file), name: file.name }))].slice(0, MAX_IMAGES));
    },
  };
}

function ImageDraft({ draft }: { draft: ReturnType<typeof useImageDraft> }) {
  return (
    <Group gap="xs">
      <WithInfo id="post-images">
        <Button size="xs" variant="default" leftSection={<IconPhoto size={14} />} onClick={() => draft.choose.mutate()} disabled={draft.images.length >= MAX_IMAGES}>
          {t('Add image')}
        </Button>
      </WithInfo>
      {!draft.images.length && (
        <Text size="xs" c="dimmed">
          {t('or paste a screenshot into the text')}
        </Text>
      )}
      {draft.images.map((image, i) => (
        <Badge
          key={image.path}
          variant="light"
          color="gray"
          tt="none"
          rightSection={
            <ActionIcon size={14} variant="transparent" color="gray" onClick={() => draft.remove(i)} aria-label={t('Remove {{name}}', { name: image.name })}>
              <IconX size={12} />
            </ActionIcon>
          }
        >
          {image.name}
        </Badge>
      ))}
    </Group>
  );
}

// A student reports a post or reply to the professor, who sees the reason but not who gave it.
function confirmReport(title: string, onConfirm: (reason: string) => void) {
  let reason = '';
  modals.openConfirmModal({
    title: <WithInfo id="post-report">{title}</WithInfo>,
    children: (
      <Stack gap="sm">
        <Text size="sm">{t('This goes to the section’s professor. They see your reason, not your name.')}</Text>
        <Textarea label={t('What’s wrong with it?')} placeholder={t('Optional')} autosize minRows={2} maxLength={500} onChange={(e) => (reason = e.currentTarget.value)} />
      </Stack>
    ),
    labels: { confirm: t('Report'), cancel: t('Cancel') },
    onConfirm: () => onConfirm(reason),
  });
}

function ReportButton({ reported, size, onReport }: { reported: boolean; size?: 'sm'; onReport: () => void }) {
  const label = reported ? t('You reported this') : t('Report to the professor');
  return (
    <WithInfo id="post-report">
      <Tooltip label={label}>
        <ActionIcon size={size} variant="subtle" color="gray" disabled={reported} onClick={onReport} aria-label={label}>
          <IconFlag size={size ? 14 : 16} />
        </ActionIcon>
      </Tooltip>
    </WithInfo>
  );
}

// What the professor sees on something students reported.
function ReportNotice({ reasons, onDismiss }: { reasons: string[]; onDismiss: () => void }) {
  if (!reasons.length) return null;
  const written = reasons.filter(Boolean);
  return (
    <Alert color="orange" variant="light" icon={<IconFlag size={16} />} p="xs" mb="xs" title={<WithInfo id="post-report-notice">{t('Reported by {{count}} students', { count: reasons.length })}</WithInfo>}>
      {written.map((reason, i) => (
        <Text key={i} size="sm" style={{ whiteSpace: 'pre-wrap' }}>
          “{reason}”
        </Text>
      ))}
      <Button size="compact-xs" variant="subtle" color="gray" mt={4} onClick={onDismiss}>
        {t('It’s fine, dismiss')}
      </Button>
    </Alert>
  );
}

type Author = Pick<FeedPost, 'authorName' | 'authorEmail' | 'authorPronouns' | 'authorFaculty' | 'authorGradYear' | 'authorRole' | 'formerStudent' | 'authorGoat'>;

// A professor's removal asks why; the author is told, with the reason if there is one.
function confirmRemoval(title: string, onConfirm: (reason: string) => void) {
  let reason = '';
  modals.openConfirmModal({
    title: <WithInfo id="mod-remove">{title}</WithInfo>,
    children: (
      <Stack gap="sm">
        <Text size="sm">{t("Its author is told. This can't be undone.")}</Text>
        <Textarea label={t('Tell them why')} placeholder={t('Optional')} autosize minRows={2} maxLength={500} onChange={(e) => (reason = e.currentTarget.value)} />
      </Stack>
    ),
    labels: { confirm: t('Remove'), cancel: t('Keep') },
    confirmProps: { color: 'red' },
    onConfirm: () => onConfirm(reason),
  });
}

// G4.5 "view profile": a classmate's name opens what they share once they've posted (S1).
function AuthorName({ who, size }: { who: Author; size?: 'sm' }) {
  if (who.formerStudent) {
    return (
      <Text fw={700} size={size}>
        {t('Former student')} <ReqInfo id="former-student" />
      </Text>
    );
  }
  return (
    <Popover position="bottom-start" shadow="md" width={280}>
      <Popover.Target>
        <UnstyledButton style={{ minWidth: 0 }}>
          <Group gap={6} wrap="nowrap">
            <Text fw={700} size={size} truncate className="author-link">
              {who.authorName}
            </Text>
            {who.authorRole === 'professor' && (
              <Tag color="periwinkle">
                <IconSchool size={12} style={{ verticalAlign: -2 }} /> {t('Professor')}
              </Tag>
            )}
            <ReqInfo id="author-card" />
          </Group>
        </UnstyledButton>
      </Popover.Target>
      <Popover.Dropdown>
        <Group wrap="nowrap" align="flex-start" gap="sm">
          <GoatAvatar goat={who.authorGoat} size={56} />
          <div style={{ minWidth: 0 }}>
            <Text fw={800}>
              {who.authorName} <ReqInfo id="author-card" />
            </Text>
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
function KindTag({ post }: { post: { kind: string; acceptedReplyId: number | null; professorAnswered: boolean; deletedAt: Date | null; authorRole: string; visibility: string } }) {
  // A professor's note to the whole section went out to everyone.
  if (post.kind === 'note' && post.authorRole === 'professor' && post.visibility === 'class') return <Tag color="periwinkle">{t('Announcement')}</Tag>;
  if (post.kind === 'note') return <Tag color="gray">{t('Note')}</Tag>;
  return post.acceptedReplyId || post.professorAnswered ? (
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
              {post.deletedAt ? <WithInfo id={post.removedByProfessor ? 'mod-remove' : 'post-delete'}><Text fw={700}>{post.removedByProfessor ? t('Removed post') : t('Deleted post')}</Text></WithInfo> : <AuthorName who={post} />}
              <Text size="sm" c="dimmed" style={{ whiteSpace: 'nowrap' }}>
                {fromNow(post.createdAt)}
              </Text>
              {post.isNew && (
                <WithInfo id="post-new-badge">
                  <Badge size="xs" variant="filled" style={{ flex: 'none' }}>
                    {t('New')}
                  </Badge>
                </WithInfo>
              )}
            </Group>
            <Group gap={6}>
              {post.visibility === 'selected' && (
                <WithInfo id="post-visibility">
                  <Tooltip label={t('Only visible to selected classmates')}>
                    <IconLock size={14} />
                  </Tooltip>
                </WithInfo>
              )}
              {post.pinnedAt && (
                <WithInfo id="post-pin">
                  <Tag color="yellow">
                    <IconPin size={12} style={{ verticalAlign: -2 }} /> {t('Pinned')}
                  </Tag>
                </WithInfo>
              )}
              {post.reports > 0 && (
                <WithInfo id="post-report-notice">
                  <Tag color="red">
                    <IconFlag size={12} style={{ verticalAlign: -2 }} /> {t('{{count}} reports', { count: post.reports })}
                  </Tag>
                </WithInfo>
              )}
              {post.lockedAt && (
                <WithInfo id="post-lock">
                  <Tooltip label={t('Locked: only the professor can reply')}>
                    <IconMessageOff size={14} />
                  </Tooltip>
                </WithInfo>
              )}
              <WithInfo id="post-class">
                <Tag>{post.classLabel}</Tag>
              </WithInfo>
              <WithInfo id="post-topic">
                <TopicTag topic={post.topic} />
              </WithInfo>
              <WithInfo id="post-kind">
                <KindTag post={post} />
              </WithInfo>
            </Group>
          </Group>
          <UnstyledButton display="block" mt={4} className="clickable" onClick={onOpen} style={{ borderRadius: 6 }}>
            <Text fw={800} size="lg" c={post.deletedAt ? 'dimmed' : undefined}>
              {post.removedByProfessor
                ? t('A professor removed this post. Its replies are still here.')
                : post.deletedAt
                  ? t('The author deleted this post. Its replies are still here.')
                  : post.title}{' '}
              <ReqInfo id="post-card" />
            </Text>
          </UnstyledButton>
          {!post.deletedAt && (
            <Text component="div" size="sm" mt={4} lineClamp={4} style={{ whiteSpace: 'pre-wrap' }}>
              <Body text={post.body} />
            </Text>
          )}
          <Images images={post.images} height={110} />
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

function ChipSection({ title, info, children }: { title: string; info: ReqTopicId; children: ReactNode }) {
  return (
    <div>
      <Text size="sm" fw={800} mb={6} px={8} py={2} w="fit-content" style={{ background: 'var(--ul-soft)', borderRadius: 6 }}>
        {title} <ReqInfo id={info} />
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
  const professor = useMe().role === 'professor';
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
  const [following, setFollowing] = useState(false);
  const [reported, setReported] = useState(false);
  const [sort, setSort] = useState<'new' | 'top'>('new');
  // Below the wide layout the filters would sit under every post, so they open in a drawer.
  const [filtersOpen, setFiltersOpen] = useState(false);
  const activeFilters = classIds.length + topics.length + (since ? 1 : 0) + (unresolved ? 1 : 0) + (following ? 1 : 0) + (reported ? 1 : 0) + (search.trim() ? 1 : 0);
  const [composing, setComposing] = useState<PostDetail | 'new' | null>(null);

  const classes = useQuery({ queryKey: ['classes', 'mine'], queryFn: () => rpc.classes.mine() });
  const info = useQuery({ queryKey: ['courses', 'info', classId], queryFn: () => rpc.courses.info({ classId: classId! }), enabled: !!classId });
  const setMuted = useAction((muted: boolean) => rpc.courses.setMuteReplies({ classId: classId!, muted }), {
    success: (_r, muted) => (muted ? t('Replies from this class are muted. Assignments, announcements and deadlines still come through.') : t('Replies from this class are back on')),
  });
  const allTopics = useQuery({ queryKey: ['board', 'topics', classId ?? null], queryFn: () => rpc.board.topics({ classId: classId ?? null }) });
  const feed = useQuery({
    queryKey: ['board', 'feed', classId ?? null, classIds, topics, since, debounced, unresolved, following, reported, sort],
    queryFn: () =>
      rpc.board.feed({
        classIds: classId ? [classId] : classIds.length ? classIds.map(Number) : null,
        topics,
        since,
        search: debounced,
        unresolved,
        following,
        reported,
        sort,
      }),
    placeholderData: keepPreviousData,
  });
  // Opening a class's discussion marks it seen once the posts are on screen; they keep their
  // New badge until the next visit.
  const loaded = feed.isSuccess;
  useEffect(() => {
    if (classId && loaded) rpc.board.seen({ classId }).catch(() => {});
  }, [classId, loaded]);

  const filters = (
    <Stack gap="md">
      <Text fw={800} size="xl" ta="center" className="display">
        {t('Filters')} <ReqInfo id="feed-filters" />
      </Text>
      <WithInfo id="feed-search" block>
        <TextInput
          placeholder={t('Search posts')}
          aria-label={t('Search posts')}
          leftSection={<IconSearch size={16} />}
          radius="xl"
          value={search}
          onChange={(e) => setSearch(e.currentTarget.value)}
        />
      </WithInfo>
      {!classId && (
        <ChipSection title={t('Classes')} info="feed-classes">
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
      <ChipSection title={t('Questions')} info="feed-unanswered">
        <Chip size="sm" variant="outline" checked={unresolved} onChange={setUnresolved}>
          {t('Unanswered only')}
        </Chip>
      </ChipSection>
      <ChipSection title={t('Threads')} info="feed-following">
        <Chip size="sm" variant="outline" checked={following} onChange={setFollowing}>
          {t('Ones I follow')}
        </Chip>
        {professor && (
          <WithInfo id="feed-reported">
            <Chip size="sm" variant="outline" mt={6} checked={reported} onChange={setReported}>
              {t('Reported by students')}
            </Chip>
          </WithInfo>
        )}
      </ChipSection>
      <ChipSection title={t('Topic')} info="feed-topic">
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
      <ChipSection title={t('Time')} info="feed-time">
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
            <Title order={3}>
              {classId ? t('Discussion') : t('Class discussions')} <ReqInfo id="feed-board" />
            </Title>
            <Group gap="sm">
              {classId && info.data && (
                <WithInfo id="feed-mute">
                  <Tooltip label={info.data.muteReplies ? t('Turn reply notifications from this class back on') : t('Mute reply notifications from this class')}>
                    <ActionIcon
                      variant={info.data.muteReplies ? 'light' : 'subtle'}
                      color={info.data.muteReplies ? 'orange' : 'gray'}
                      size="lg"
                      radius="xl"
                      onClick={() => setMuted.mutate(!info.data.muteReplies)}
                      aria-label={info.data.muteReplies ? t('Turn reply notifications from this class back on') : t('Mute reply notifications from this class')}
                    >
                      {info.data.muteReplies ? <IconBellOff size={18} /> : <IconBell size={18} />}
                    </ActionIcon>
                  </Tooltip>
                </WithInfo>
              )}
              <Button hiddenFrom="lg" variant="default" leftSection={<IconFilter size={16} />} rightSection={<ReqInfo id="feed-filters" />} onClick={() => setFiltersOpen(true)}>
                {activeFilters ? t('Filters ({{count}})', { count: activeFilters }) : t('Filters')}
              </Button>
              <WithInfo id="feed-sort">
                <SegmentedControl
                  size="xs"
                  value={sort}
                  onChange={(v) => setSort(v as 'new' | 'top')}
                  data={[
                    { value: 'new', label: t('Newest') },
                    { value: 'top', label: t('Most 🐐') },
                  ]}
                  aria-label={t('Sort posts')}
                />
              </WithInfo>
              <WithInfo id="post-new">
                <Button leftSection={<IconPlus size={16} />} onClick={() => setComposing('new')} disabled={!classes.data?.length}>
                  {t('New post')}
                </Button>
              </WithInfo>
            </Group>
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
                {search || topics.length || classIds.length || since || unresolved || following || reported
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
        <Grid.Col span={{ base: 24, lg: left ? 5 : 6 }} visibleFrom="lg">
          <Card padding="md" style={{ position: 'sticky', top: 88 }}>
            {filters}
          </Card>
        </Grid.Col>
      </Grid>

      <Drawer opened={filtersOpen} onClose={() => setFiltersOpen(false)} position="bottom" size="auto" hiddenFrom="lg" withCloseButton>
        {filters}
      </Drawer>

      <Drawer opened={openPost != null} onClose={() => setOpenPost(null)} position="right" size="xl" title={<Text fw={800}>{t('Post')} <ReqInfo id="post-card" /></Text>}>
        {openPost != null && <PostThread postId={openPost} onEdit={(p) => setComposing(p)} onDeleted={() => setOpenPost(null)} />}
      </Drawer>

      <Modal opened={composing != null} onClose={() => setComposing(null)} title={composing === 'new' ? <WithInfo id="post-new">{t('New post')}</WithInfo> : <WithInfo id="post-edit">{t('Edit post')}</WithInfo>} size="lg">
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
            onOpenPost={(postId) => {
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
  const me = useMe();
  const draftName = `reply-${postId}`;
  const [body, setBody] = useState(() => loadDraft<string>(me.id, draftName) ?? '');
  const write = (text: string) => {
    setBody(text);
    saveDraft(me.id, draftName, text.trim() ? text : null);
  };
  const draft = useImageDraft();
  const send = useAction(() => rpc.board.reply({ postId, body, images: draft.images.map((image) => image.path) }), {
    onSuccess: () => {
      write('');
      draft.clear();
    },
  });
  return (
    <Stack gap={6}>
      <Group align="flex-end" gap="xs" wrap="nowrap">
        <Textarea
          placeholder={isQuestion ? t('Write an answer…') : t('Write a reply…')}
          aria-label={isQuestion ? t('Write an answer…') : t('Write a reply…')}
          autosize
          minRows={1}
          value={body}
          onChange={(e) => write(e.currentTarget.value)}
          onPaste={draft.onPaste}
          style={{ flex: 1 }}
        />
        <WithInfo id="reply-box">
          <Button onClick={() => send.mutate()} disabled={!body.trim()} loading={send.isPending}>
            {t('Reply')}
          </Button>
        </WithInfo>
      </Group>
      <Preview text={body} />
      <ImageDraft draft={draft} />
    </Stack>
  );
}

type Reply = PostDetail['replies'][number];

function ReplyItem({ reply, postId, canAccept, canModerate, canReport }: { reply: Reply; postId: number; canAccept: boolean; canModerate: boolean; canReport: boolean }) {
  const react = useAction(() => rpc.board.reactReply({ replyId: reply.id }));
  const remove = useAction(() => rpc.board.removeReply({ replyId: reply.id }));
  const [draft, setDraft] = useState<string | null>(null);
  const edit = useAction(() => rpc.board.editReply({ replyId: reply.id, body: draft ?? '' }), { onSuccess: () => setDraft(null) });
  const accept = useAction(() => rpc.board.accept({ postId, replyId: reply.accepted ? null : reply.id }), {
    success: reply.accepted ? t('Answer unmarked') : t('Marked as the answer'),
  });
  const endorse = useAction(() => rpc.board.endorse({ replyId: reply.id, endorsed: !reply.endorsed }));
  const removeAsProfessor = useAction((reason: string) => rpc.board.removeReplyAsProfessor({ replyId: reply.id, reason }), { success: 'Reply removed' });
  const report = useAction((reason: string) => rpc.board.report({ postId, replyId: reply.id, reason }), { success: 'Reported. Thanks for telling the professor.' });
  const dismiss = useAction(() => rpc.board.dismissReports({ postId, replyId: reply.id }));
  return (
    <Card
      padding="sm"
      withBorder={reply.accepted}
      style={reply.accepted ? { borderColor: 'var(--mantine-color-teal-5)', background: 'var(--mantine-color-teal-light)' } : { background: 'transparent' }}
    >
      <ReportNotice reasons={reply.reports} onDismiss={() => dismiss.mutate()} />
      {reply.accepted && (
        <Group gap={4} c="teal" mb={6}>
          <IconCircleCheck size={16} />
          <Text size="xs" fw={800}>
            {t('Accepted answer')} <ReqInfo id="reply-accept" />
          </Text>
        </Group>
      )}
      {reply.endorsed && (
        <Group gap={4} c="periwinkle" mb={6}>
          <IconSchool size={16} />
          <Text size="xs" fw={800}>
            {t('Endorsed by the professor')} <ReqInfo id="reply-endorse" />
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
              {reply.editedAt && ` · ${t('edited')}`}
            </Text>
          </Group>
          {draft != null ? (
            <Stack gap={6} mt={4}>
              <Textarea autosize minRows={2} value={draft} onChange={(e) => setDraft(e.currentTarget.value)} aria-label={t('Edit reply')} />
              <Group gap="xs">
                <Button size="compact-xs" onClick={() => edit.mutate()} loading={edit.isPending} disabled={!draft.trim()}>
                  {t('Save')}
                </Button>
                <Button size="compact-xs" variant="subtle" color="gray" onClick={() => setDraft(null)}>
                  {t('Cancel')}
                </Button>
              </Group>
            </Stack>
          ) : (
            <Text component="div" size="sm" style={{ whiteSpace: 'pre-wrap' }}>
              <Body text={reply.body} />
            </Text>
          )}
          <Images images={reply.images} height={140} />
          <Group gap="xs" mt={6}>
            <ReactionBar goats={reply.goats} goated={reply.goated} onGoat={() => react.mutate()} />
            {canAccept && !reply.mine && (
              <WithInfo id="reply-accept">
                <Button size="compact-xs" variant="subtle" color="teal" leftSection={<IconCheck size={12} />} onClick={() => accept.mutate()}>
                  {reply.accepted ? t('Unmark answer') : t('Accept answer')}
                </Button>
              </WithInfo>
            )}
            {reply.mine && draft == null && (
              <WithInfo id="reply-edit">
                <ActionIcon size="sm" variant="subtle" onClick={() => setDraft(reply.body)} aria-label={t('Edit reply')}>
                  <IconPencil size={14} />
                </ActionIcon>
              </WithInfo>
            )}
            {reply.mine && (
              <WithInfo id="reply-edit">
                <ActionIcon size="sm" variant="subtle" color="red" onClick={() => remove.mutate()} aria-label={t('Delete reply')}>
                  <IconTrash size={14} />
                </ActionIcon>
              </WithInfo>
            )}
            {canReport && !reply.mine && (
              <ReportButton size="sm" reported={reply.reportedByMe} onReport={() => confirmReport(t('Report this reply?'), (reason) => report.mutate(reason))} />
            )}
            {canModerate && (
              <WithInfo id="reply-endorse">
                <Button size="compact-xs" variant="subtle" leftSection={<IconSchool size={12} />} onClick={() => endorse.mutate()}>
                  {reply.endorsed ? t('Take back endorsement') : t('Endorse')}
                </Button>
              </WithInfo>
            )}
            {canModerate && !reply.mine && (
              <WithInfo id="mod-remove">
                <Tooltip label={t('Remove this reply')}>
                  <ActionIcon
                    size="sm"
                    variant="subtle"
                    color="red"
                    onClick={() => confirmRemoval(t('Remove this reply?'), (reason) => removeAsProfessor.mutate(reason))}
                    aria-label={t('Remove this reply')}
                  >
                    <IconShieldX size={14} />
                  </ActionIcon>
                </Tooltip>
              </WithInfo>
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
  const follow = useAction((following: boolean) => rpc.board.follow({ postId, following }), {
    success: (_r, following) => (following ? t('You’ll be notified of new replies') : t('You won’t be notified of new replies')),
  });
  const remove = useAction(() => rpc.board.remove({ postId }), {
    success: (r) => (r.kept ? t('Post deleted. Its replies stay up.') : t('Post deleted')),
    onSuccess: (r) => !r.kept && onDeleted(),
  });
  const pin = useAction((pinned: boolean) => rpc.board.pin({ postId, pinned }));
  const lock = useAction((locked: boolean) => rpc.board.lock({ postId, locked }));
  const report = useAction((reason: string) => rpc.board.report({ postId, replyId: null, reason }), { success: 'Reported. Thanks for telling the professor.' });
  const dismiss = useAction(() => rpc.board.dismissReports({ postId, replyId: null }));
  const removeAsProfessor = useAction((reason: string) => rpc.board.removeAsProfessor({ postId, reason }), {
    success: 'Post removed',
    onSuccess: (r) => !r.kept && onDeleted(),
  });

  if (post.isPending) return <Loading />;
  if (!post.data) return <Text c="red">{post.error?.message}</Text>;
  const p = post.data;
  const isQuestion = p.kind === 'question';

  const confirmDelete = () =>
    modals.openConfirmModal({
      title: <WithInfo id="post-delete">{t('Delete this post?')}</WithInfo>,
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
      <ReportNotice reasons={p.reports} onDismiss={() => dismiss.mutate()} />
      <Group align="flex-start" wrap="nowrap" gap="md">
        <GoatAvatar goat={p.authorGoat} size={64} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <Group justify="space-between" gap="xs" style={{ rowGap: 4 }}>
            <Group gap="xs">
              {p.deletedAt ? <WithInfo id={p.removedByProfessor ? 'mod-remove' : 'post-delete'}><Text fw={700}>{p.removedByProfessor ? t('Removed post') : t('Deleted post')}</Text></WithInfo> : <AuthorName who={p} />}
              <Text size="sm" c="dimmed">
                {fromNow(p.createdAt)}
                {p.editedAt && ` · ${t('edited')}`}
              </Text>
            </Group>
            <Group gap={6}>
              {p.pinnedAt && (
                <WithInfo id="post-pin">
                  <Tag color="yellow">
                    <IconPin size={12} style={{ verticalAlign: -2 }} /> {t('Pinned')}
                  </Tag>
                </WithInfo>
              )}
              <WithInfo id="post-class">
                <Tag>{p.classLabel}</Tag>
              </WithInfo>
              <WithInfo id="post-topic">
                <TopicTag topic={p.topic} />
              </WithInfo>
              <WithInfo id="post-kind">
                <KindTag post={p} />
              </WithInfo>
              {p.canReport && !p.mine && !p.deletedAt && (
                <ReportButton reported={p.reportedByMe} onReport={() => confirmReport(t('Report this post?'), (reason) => report.mutate(reason))} />
              )}
              {p.canModerate && !p.deletedAt && (
                <>
                  <WithInfo id="post-pin">
                    <Tooltip label={p.pinnedAt ? t('Unpin') : t('Pin to the top of the class board')}>
                      <ActionIcon variant="subtle" onClick={() => pin.mutate(!p.pinnedAt)} aria-label={p.pinnedAt ? t('Unpin') : t('Pin to the top of the class board')}>
                        {p.pinnedAt ? <IconPinnedOff size={16} /> : <IconPin size={16} />}
                      </ActionIcon>
                    </Tooltip>
                  </WithInfo>
                  <WithInfo id="post-lock">
                    <Tooltip label={p.lockedAt ? t('Let students reply again') : t('Lock: stop students replying')}>
                      <ActionIcon variant="subtle" onClick={() => lock.mutate(!p.lockedAt)} aria-label={p.lockedAt ? t('Let students reply again') : t('Lock: stop students replying')}>
                        {p.lockedAt ? <IconLockOpen size={16} /> : <IconMessageOff size={16} />}
                      </ActionIcon>
                    </Tooltip>
                  </WithInfo>
                  {!p.mine && (
                    <WithInfo id="mod-remove">
                      <Tooltip label={t('Remove this post')}>
                        <ActionIcon
                          variant="subtle"
                          color="red"
                          onClick={() => confirmRemoval(t('Remove this post?'), (reason) => removeAsProfessor.mutate(reason))}
                          aria-label={t('Remove this post')}
                        >
                          <IconShieldX size={16} />
                        </ActionIcon>
                      </Tooltip>
                    </WithInfo>
                  )}
                </>
              )}
              {p.mine && !p.deletedAt && (
                <>
                  <WithInfo id="post-edit">
                    <ActionIcon variant="subtle" onClick={() => onEdit(p)} aria-label={t('Edit post')}>
                      <IconPencil size={16} />
                    </ActionIcon>
                  </WithInfo>
                  <WithInfo id="post-delete">
                    <ActionIcon variant="subtle" color="red" onClick={confirmDelete} aria-label={t('Delete post')}>
                      <IconTrash size={16} />
                    </ActionIcon>
                  </WithInfo>
                </>
              )}
            </Group>
          </Group>
          <Title order={3} mt={4} c={p.deletedAt ? 'dimmed' : undefined}>
            {p.removedByProfessor
              ? t('A professor removed this post. Its replies are still here.')
              : p.deletedAt
                ? t('The author deleted this post. Its replies are still here.')
                : p.title}
          </Title>
          {p.visibility === 'selected' && (
            <Group gap={4} mt={2} c="dimmed">
              <IconLock size={12} />
              <Text size="xs">
                {t('Visible to {{who}}', { who: p.mine ? p.audience.map((a) => a.name).join(', ') : t('you and a few classmates') })} <ReqInfo id="post-visibility" />
              </Text>
            </Group>
          )}
          <Text component="div" mt="xs" style={{ whiteSpace: 'pre-wrap' }}>
            <Body text={p.body} />
          </Text>
          <Images images={p.images} height={220} />
          <Group mt="sm" justify="space-between">
            <ReactionBar goats={p.goats} goated={p.goated} comments={p.replies.length} onGoat={() => react.mutate()} />
            <WithInfo id="thread-follow">
              <Tooltip label={p.following ? t('Stop getting notified of new replies') : t('Get notified of new replies')}>
                <Button
                  size="xs"
                  variant={p.following ? 'light' : 'default'}
                  leftSection={p.following ? <IconBellRinging size={14} /> : <IconBell size={14} />}
                  onClick={() => follow.mutate(!p.following)}
                  loading={follow.isPending}
                >
                  {p.following ? t('Following') : t('Follow')}
                </Button>
              </Tooltip>
            </WithInfo>
          </Group>
        </div>
      </Group>

      {p.mine && isQuestion && !p.acceptedReplyId && !p.professorAnswered && p.replies.some((r) => !r.mine) && (
        <Text size="xs" c="dimmed">
          {t('Did a reply answer your question? Accept it so classmates find it first.')} <ReqInfo id="reply-accept" />
        </Text>
      )}
      <Divider label={<WithInfo id="post-replies">{isQuestion ? t('Answers') : t('Replies')}</WithInfo>} labelPosition="left" />
      {p.lockedAt && (
        <Group gap={6} c="dimmed">
          <IconMessageOff size={14} />
          <Text size="sm">{p.canModerate ? t("You locked this thread, so students can't reply. You still can.") : t('The professor locked this thread.')} <ReqInfo id="post-lock" /></Text>
        </Group>
      )}
      {(!p.lockedAt || p.canModerate) && <ReplyBox key={postId} postId={postId} isQuestion={isQuestion} />}
      {p.replies.map((r) => (
        <ReplyItem key={r.id} reply={r} postId={postId} canAccept={p.mine && isQuestion && !p.deletedAt} canModerate={p.canModerate} canReport={p.canReport} />
      ))}
    </Stack>
  );
}

function PostForm({
  classId,
  topics,
  existing,
  onDone,
  onOpenPost,
}: {
  classId: number | null;
  topics: string[];
  existing: PostDetail | null;
  onDone: (postId: number) => void;
  onOpenPost: (postId: number) => void;
}) {
  const me = useMe();
  const professor = me.role === 'professor';
  const draft = useImageDraft();
  // A professor's announcement can go to their other sections too, each its own thread.
  const [also, setAlso] = useState<string[]>([]);
  const myClasses = useQuery({ queryKey: ['classes', 'mine'], queryFn: () => rpc.classes.mine() });
  const blank = {
    classId: String(existing?.classId ?? classId ?? ''),
    kind: (existing?.kind ?? 'question') as 'question' | 'note',
    topic: existing?.topic ?? '',
    title: existing?.title ?? '',
    body: existing?.body ?? '',
    visibility: (existing?.visibility ?? 'class') as 'class' | 'selected',
    audienceEmails: [] as string[],
  };
  // A new post picks up where the last one was left. (Images aren't kept, only the text.)
  const draftName = `post-${classId ?? 'home'}`;
  const [restored, setRestored] = useState(() => (existing ? null : loadDraft<typeof blank>(me.id, draftName)));
  const form = useForm({
    initialValues: restored ?? blank,
    onValuesChange: (values) => {
      if (!existing) saveDraft(me.id, draftName, values.title.trim() || values.body.trim() ? values : null);
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
  // "Already asked?" while writing a new post's title.
  const [title] = useDebouncedValue(form.values.title, 300);
  const similar = useQuery({
    queryKey: ['board', 'similar', form.values.classId, title],
    queryFn: () => rpc.board.similar({ classId: Number(form.values.classId), title }),
    enabled: !existing && !!form.values.classId && title.trim().length >= 6,
  });
  const save = useAction(
    async (v: typeof form.values) => {
      if (existing) {
        await rpc.board.update({ postId: existing.id, kind: v.kind, topic: v.topic, title: v.title, body: v.body });
        return { id: existing.id };
      }
      const images = draft.images.map((image) => image.path);
      const created = await rpc.board.create({ ...v, classId: Number(v.classId), images });
      if (v.kind === 'note' && v.visibility === 'class') {
        for (const id of also) await rpc.board.create({ ...v, classId: Number(id), images });
      }
      return created;
    },
    {
      success: existing ? 'Post updated' : 'Posted',
      onSuccess: (r) => {
        if (!existing) saveDraft(me.id, draftName, null);
        onDone(r.id);
      },
    },
  );

  return (
    <form onSubmit={form.onSubmit((v) => save.mutate(v))}>
      <Stack>
        {restored && (
          <Group gap="xs">
            <Text size="xs" c="dimmed">
              {t('Your draft is back, as you left it.')} <ReqInfo id="post-draft" />
            </Text>
            <Anchor
              component="button"
              type="button"
              size="xs"
              onClick={() => {
                form.setValues(blank);
                saveDraft(me.id, draftName, null);
                setRestored(null);
              }}
            >
              {t('Discard it')}
            </Anchor>
          </Group>
        )}
        <WithInfo id="post-kind" block>
          <SegmentedControl
            data={[
              { value: 'question', label: t('Question') },
              { value: 'note', label: professor ? t('Announcement') : t('Note') },
            ]}
            {...form.getInputProps('kind')}
          />
        </WithInfo>
        <Text size="xs" c="dimmed" mt={-8}>
          {form.values.kind === 'question'
            ? t('You can accept the reply that answers it.')
            : professor
              ? t('Everyone in the section gets a notification.')
              : t('For sharing something: notes, tips, announcements.')}
        </Text>
        <Group grow align="flex-start">
          <Select
            label={<WithInfo id="post-pick-class">{t('Class')}</WithInfo>}
            data={myClasses.data?.map((c) => ({ value: String(c.id), label: c.code })) ?? []}
            disabled={!!existing || !!classId}
            allowDeselect={false}
            {...form.getInputProps('classId')}
          />
          <Select
            label={<WithInfo id="post-topic">{t('Topic')}</WithInfo>}
            placeholder={t('Pick a topic')}
            data={topics.map((topic) => ({ value: topic, label: t(topic) }))}
            allowDeselect={false}
            {...form.getInputProps('topic')}
          />
        </Group>
        <TextInput label={<WithInfo id="post-title">{t('Title')}</WithInfo>} data-autofocus {...form.getInputProps('title')} />
        {!existing && !!similar.data?.length && (
          <Card padding="sm" mt={-6} style={{ background: 'var(--ul-soft)' }}>
            <Text size="sm" fw={700} mb={4}>
              {t('Already asked? Similar posts in this class:')} <ReqInfo id="post-similar" />
            </Text>
            <Stack gap={4}>
              {similar.data.map((p) => (
                <Group key={p.id} gap={6} wrap="nowrap">
                  {p.acceptedReplyId ? (
                    <IconCircleCheck size={14} color="var(--mantine-color-teal-6)" style={{ flexShrink: 0 }} />
                  ) : (
                    <IconMessageCircle size={14} style={{ flexShrink: 0 }} />
                  )}
                  <Anchor component="button" type="button" size="sm" ta="left" lineClamp={1} onClick={() => onOpenPost(p.id)}>
                    {p.title}
                  </Anchor>
                  {p.acceptedReplyId != null && (
                    <Text size="xs" c="teal" style={{ flexShrink: 0 }}>
                      {t('Answered')}
                    </Text>
                  )}
                </Group>
              ))}
            </Stack>
          </Card>
        )}
        <Textarea
          label={<WithInfo id="post-body">{t('Post')}</WithInfo>}
          description={t('Put code between `backticks`, or between lines of ``` for a block. Put math between dollar signs, like $O(n \\log n)$.')}
          autosize
          minRows={5}
          onPaste={existing ? undefined : draft.onPaste}
          {...form.getInputProps('body')}
        />
        <Preview text={form.values.body} />
        {!existing && <ImageDraft draft={draft} />}
        {!existing && (
          <>
            <WithInfo id="post-visibility" block>
              <SegmentedControl
                data={[
                  { value: 'class', label: t('Whole class') },
                  { value: 'selected', label: t('Selected classmates') },
                ]}
                {...form.getInputProps('visibility')}
              />
            </WithInfo>
            {professor && form.values.kind === 'note' && form.values.visibility === 'class' && (myClasses.data?.length ?? 0) > 1 && (
              <MultiSelect
                label={<WithInfo id="post-also">{t('Also post to')}</WithInfo>}
                placeholder={t('Optional')}
                data={(myClasses.data ?? []).filter((c) => String(c.id) !== form.values.classId).map((c) => ({ value: String(c.id), label: c.code }))}
                value={also}
                onChange={setAlso}
                clearable
              />
            )}
            {form.values.visibility === 'selected' && (
              <TagsInput
                label={<WithInfo id="post-audience">{t('Who can see it')}</WithInfo>}
                description={t('Classmates who have posted or replied in this class. Press Enter after each.')}
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
