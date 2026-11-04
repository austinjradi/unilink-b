import { type MouseEvent, useState } from 'react';
import { Badge, Button, Card, Collapse, CopyButton, Divider, Group, Menu, Modal, Select, Stack, Text, TextInput, ThemeIcon, Title } from '@mantine/core';
import { useForm } from '@mantine/form';
import { modals } from '@mantine/modals';
import {
  IconAlertTriangle,
  IconBrandDiscord,
  IconBrandMessenger,
  IconBrandTelegram,
  IconBrandWhatsapp,
  IconChevronDown,
  IconChevronUp,
  IconCircleCheck,
  IconCopy,
  IconDots,
  IconExternalLink,
  IconLink,
  IconPencil,
  IconPlus,
  IconThumbUp,
  IconTool,
  IconTrash,
} from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { LINK_PURPOSES, type LinkPurpose, parseChatLink, CHAT_PLATFORMS } from '@shared/links';
import { Empty, Loading, Tag } from '../../components/ui';
import { fromNow } from '../../lib/format';
import { useAction, useMe } from '../../lib/hooks';
import { type Out, rpc } from '../../lib/rpc';
import { t } from '../../lib/i18n';
import { useVariant } from '../../lib/variants';
import { ReqInfo, WithInfo } from '../../components/ReqInfo';

type ChatLink = Out<typeof rpc.links.list>[number];

// Sent to the server in English; shown translated.
const FLAG_REASONS = ['Expired', 'Broken', 'Not relevant', 'Spam or inappropriate'] as const;

const PLATFORMS: Record<string, { icon: typeof IconLink; color: string }> = {
  WhatsApp: { icon: IconBrandWhatsapp, color: 'green' },
  Discord: { icon: IconBrandDiscord, color: 'indigo' },
  Messenger: { icon: IconBrandMessenger, color: 'blue' },
  Telegram: { icon: IconBrandTelegram, color: 'cyan' },
};

const PURPOSE_COLORS: Record<LinkPurpose, string> = {
  course: 'periwinkle',
  section: 'teal',
  project: 'orange',
  'study-group': 'grape',
  other: 'gray',
};

// S2 in the layout of the wireframe (A2Team.pdf p. 8).
export function GroupChats({ classId, classLabel }: { classId: number; classLabel: string }) {
  const links = useQuery({ queryKey: ['links', classId], queryFn: () => rpc.links.list({ classId }) });
  const [editing, setEditing] = useState<ChatLink | 'new' | null>(null);
  const [showHidden, setShowHidden] = useState(false);
  const noBrowseLinks = useVariant('no-browse-links');
  const shown = links.data?.filter((l) => !l.hidden && !l.pending) ?? [];
  const hidden = links.data?.filter((l) => l.hidden) ?? [];
  const pending = links.data?.filter((l) => l.pending) ?? [];

  return (
    <>
      <Group justify="space-between" align="flex-start" mb="lg">
        <div>
          <Title order={2}>
            {t('Group Chat Links')} <ReqInfo id="chats-header" />
          </Title>
          <Text c="dimmed" maw={560}>
            {t('Find and join the course group chats. Links are shared with the whole section as soon as they’re added. Say which ones still work, and report the ones that don’t.')}
          </Text>
        </div>
        <WithInfo id="chat-add">
          <Button size="md" variant="default" leftSection={<IconPlus size={18} />} onClick={() => setEditing('new')}>
            {t('Add a group link')}
          </Button>
        </WithInfo>
      </Group>

      {links.isPending ? (
        <Loading />
      ) : shown.length || hidden.length || pending.length ? (
        <Stack gap="lg">
          {shown.map((l) => (
            <LinkCard key={l.id} link={l} classLabel={classLabel} onEdit={() => setEditing(l)} />
          ))}
          {pending.length > 0 && (
            <>
              <Text fw={700}>Waiting for approval</Text>
              {pending.map((l) => (
                <LinkCard key={l.id} link={l} classLabel={classLabel} onEdit={() => setEditing(l)} />
              ))}
            </>
          )}
          {hidden.length > 0 && (
            <>
              <WithInfo id="chat-hidden">
                <Button
                  variant="subtle"
                  color="gray"
                  w="fit-content"
                  leftSection={showHidden ? <IconChevronUp size={16} /> : <IconChevronDown size={16} />}
                  onClick={() => setShowHidden((s) => !s)}
                >
                  {t('Hidden after reports ({{count}})', { count: hidden.length })}
                </Button>
              </WithInfo>
              <Collapse expanded={showHidden}>
                <Stack gap="lg">
                  {hidden.map((l) => (
                    <LinkCard key={l.id} link={l} classLabel={classLabel} onEdit={() => setEditing(l)} />
                  ))}
                </Stack>
              </Collapse>
            </>
          )}
        </Stack>
      ) : (
        <Card>
          <Empty icon={<IconBrandWhatsapp size={22} />}>
            {t('No group chats shared yet. Know about a WhatsApp or Discord group for this class? Add it.')}
          </Empty>
        </Card>
      )}

      {!noBrowseLinks && (
        <Group justify="center" mt="xl" gap="lg">
          <Button size="md" variant="default" component={Link} to="/courses/mine" bg="var(--ul-soft)">
            {t('Browse other courses')}
          </Button>
          <Button size="md" color="yellow" variant="light" component={Link} to="/courses/find">
            {t("Can't find your class?")}
          </Button>
          <ReqInfo id="chats-browse" />
        </Group>
      )}

      <Modal opened={editing != null} onClose={() => setEditing(null)} title={editing === 'new' ? <WithInfo id="chat-add">{t('Add a group link')}</WithInfo> : <WithInfo id="chat-manage">{t('Edit link')}</WithInfo>}>
        {editing && (
          <LinkForm key={editing === 'new' ? 'new' : editing.id} classId={classId} existing={editing === 'new' ? null : editing} onDone={() => setEditing(null)} />
        )}
      </Modal>
    </>
  );
}

function LinkCard({ link, classLabel, onEdit }: { link: ChatLink; classLabel: string; onEdit: () => void }) {
  const profEdits = useVariant('prof-edit-links');
  const me = useMe();
  const platform = PLATFORMS[link.platform] ?? { icon: IconLink, color: 'gray' };
  const works = useAction(() => rpc.links.vote({ linkId: link.id, vote: 'works', reason: null }), {
    success: 'Thanks for checking!',
  });
  const report = useAction((reason: (typeof FLAG_REASONS)[number]) => rpc.links.vote({ linkId: link.id, vote: 'report', reason }), {
    success: 'Thanks, your report was added to the link.',
  });
  const unvote = useAction(() => rpc.links.unvote({ linkId: link.id }));
  const fixed = useAction(() => rpc.links.markFixed({ linkId: link.id }), { success: 'Reports cleared' });
  const remove = useAction(() => rpc.links.remove({ linkId: link.id }), { success: 'Link removed' });
  const share = useAction(() => rpc.links.share({ linkId: link.id }));
  const approve = useAction(() => rpc.links.approve({ linkId: link.id }));
  const decide = useAction((keep: boolean) => rpc.links.decide({ linkId: link.id, keep }));
  const plain = useVariant('plain-link-list');
  const noPurpose = useVariant('no-link-purpose');
  const noName = useVariant('no-link-name');
  const hideOwner = useVariant('hide-link-owner');
  const warnLeaving = useVariant('warn-leaving-site');
  const noCopy = useVariant('no-copy-link');
  const anyoneFixes = useVariant('anyone-fixes-links');
  const noWorks = useVariant('no-works-votes');

  const openLink = (event: MouseEvent) => {
    if (!warnLeaving) return;
    event.preventDefault();
    modals.openConfirmModal({
      title: <WithInfo id="chat-open">You’re leaving UniLink</WithInfo>,
      children: <Text size="sm">This opens {new URL(link.url).hostname}, which isn’t part of UniLink.</Text>,
      labels: { confirm: 'Open it', cancel: 'Stay here' },
      onConfirm: () => window.open(link.url, '_blank', 'noopener'),
    });
  };

  const confirmRemove = () =>
    modals.openConfirmModal({
      title: <WithInfo id="chat-manage">{t('Remove this link?')}</WithInfo>,
      labels: { confirm: t('Remove'), cancel: t('Keep') },
      confirmProps: { color: 'red' },
      onConfirm: () => remove.mutate(),
    });

  const status = link.hidden
    ? { label: t('Hidden'), color: 'red' }
    : link.likelyBroken
      ? { label: 'Likely broken', color: 'orange' }
      : link.works > 0 && !noWorks
        ? { label: t('Works'), color: 'teal' }
        : { label: t('New'), color: 'gray' };

  const copyName = useVariant('copy-with-name');
  const name = noName || !link.label ? t('{{platform}} group', { platform: link.platform }) : link.label;
  const actions = (
    <>
      <WithInfo id="chat-open" block>
        <Button component="a" href={link.url} target="_blank" color="periwinkle" variant="light" leftSection={<IconExternalLink size={16} />} onClick={openLink}>
          {t('Open link')}
        </Button>
      </WithInfo>
      {/* To pass the chat on to a classmate outside UniLink. */}
      {!noCopy && (
        <WithInfo id="chat-copy" block>
          <CopyButton value={copyName ? `${name}: ${link.url}` : link.url}>
            {({ copied, copy }) => (
              <Button variant="default" color={copied ? 'teal' : undefined} leftSection={copied ? <IconCircleCheck size={16} /> : <IconCopy size={16} />} onClick={copy}>
                {copied ? t('Copied') : t('Copy')}
              </Button>
            )}
          </CopyButton>
        </WithInfo>
      )}
      {link.pending && !link.mine && (
        <WithInfo id="chat-add" block>
          <Button onClick={() => approve.mutate()} loading={approve.isPending}>
            Approve
          </Button>
        </WithInfo>
      )}
      {link.canDecide && (
        <WithInfo id="chat-report" block>
          <Group gap={6} grow>
            <Button variant="default" onClick={() => decide.mutate(true)}>
              Keep
            </Button>
            <Button variant="light" color="red" onClick={() => decide.mutate(false)}>
              Take down
            </Button>
          </Group>
        </WithInfo>
      )}
      {anyoneFixes && !link.mine && (
        <WithInfo id="chat-manage" block>
          <Button variant="default" leftSection={<IconPencil size={16} />} onClick={onEdit}>
            Fix this link
          </Button>
        </WithInfo>
      )}
      {link.mine || (profEdits && me.role === 'professor') ? (
        <WithInfo id="chat-manage" block>
          <Menu position="bottom-end">
            <Menu.Target>
              <Button variant="default" leftSection={<IconDots size={16} />}>
                {t('Manage')}
              </Button>
            </Menu.Target>
            <Menu.Dropdown>
              <Menu.Item leftSection={<IconPencil size={14} />} onClick={onEdit}>
                {t('Edit')}
              </Menu.Item>
              {!link.isPublic && (
                <Menu.Item leftSection={<IconLink size={14} />} onClick={() => share.mutate()}>
                  Share with the class
                </Menu.Item>
              )}
              {link.reports > 0 && (
                <Menu.Item leftSection={<IconTool size={14} />} onClick={() => fixed.mutate()}>
                  {t('Mark as fixed')}
                </Menu.Item>
              )}
              <Menu.Item leftSection={<IconTrash size={14} />} color="red" onClick={confirmRemove}>
                {t('Remove')}
              </Menu.Item>
            </Menu.Dropdown>
          </Menu>
        </WithInfo>
      ) : link.myVote && !(noWorks && link.myVote === 'works') ? (
        <WithInfo id={link.myVote === 'works' ? 'chat-works' : 'chat-report'} block>
          <Button variant="default" onClick={() => unvote.mutate()}>
            {link.myVote === 'works' ? t('Undo “works”') : t('Undo report')}
          </Button>
        </WithInfo>
      ) : (
        <>
          {!noWorks && (
            <WithInfo id="chat-works" block>
              <Button variant="default" leftSection={<IconThumbUp size={16} />} onClick={() => works.mutate()} loading={works.isPending}>
                {t('It works')}
              </Button>
            </WithInfo>
          )}
          <WithInfo id="chat-report" block>
            <Menu position="bottom-end">
              <Menu.Target>
                <Button variant="default" leftSection={<IconAlertTriangle size={16} />}>
                  {t('Report link')}
                </Button>
              </Menu.Target>
              <Menu.Dropdown>
                <Menu.Label>{t("What's wrong with it?")}</Menu.Label>
                {FLAG_REASONS.map((r) => (
                  <Menu.Item key={r} onClick={() => report.mutate(r)}>
                    {t(r)}
                  </Menu.Item>
                ))}
              </Menu.Dropdown>
            </Menu>
          </WithInfo>
        </>
      )}
    </>
  );

  if (plain) {
    return (
      <Card padding="sm" style={{ opacity: link.hidden ? 0.75 : 1 }}>
        <Group justify="space-between" gap="sm">
          <Group gap="xs" style={{ minWidth: 0 }}>
            <platform.icon size={18} />
            <Text fw={700}>{name}</Text>
            <Text size="sm" c="dimmed">
              {link.platform}
            </Text>
            <WithInfo id="chat-status">
              <Badge size="sm" color={status.color} variant="light">
                {status.label}
              </Badge>
            </WithInfo>
            {link.reports > 0 && <Text size="xs" c="orange">{t('Reported by {{count}} classmates', { count: link.reports })}</Text>}
          </Group>
          <Group gap="xs" className="link-actions">
            {actions}
          </Group>
        </Group>
      </Card>
    );
  }

  return (
    <Card padding="lg" radius={44} style={{ borderWidth: 2, opacity: link.hidden ? 0.75 : 1 }}>
      <Group wrap="nowrap" gap="lg" align="center">
        <ThemeIcon size={84} radius={84} color={platform.color} variant="light">
          <platform.icon size={48} />
        </ThemeIcon>
        <div style={{ flex: 1, minWidth: 0 }}>
          <Group gap="sm" wrap="nowrap">
            <Text fz={28} fw={600} className="display" truncate>
              {link.platform} - {classLabel}
            </Text>
            <ReqInfo id="chat-platform" />
            <WithInfo id="chat-status">
              <Badge size="lg" color={status.color} variant="light">
                {status.label}
              </Badge>
            </WithInfo>
          </Group>
          <Group gap="xs">
            <WithInfo id="chat-label">
              <Text fw={700}>{name}</Text>
            </WithInfo>
            {!noPurpose && (
              <WithInfo id="chat-purpose">
                <Tag color={PURPOSE_COLORS[link.purpose]}>{t(LINK_PURPOSES[link.purpose])}</Tag>
              </WithInfo>
            )}
            {!link.isPublic && <Tag>Only you can see this</Tag>}
            {link.ownerRole === 'professor' && !hideOwner && (
              <WithInfo id="chat-from-prof">
                <Tag color="periwinkle">{t('From the professor')}</Tag>
              </WithInfo>
            )}
          </Group>
          <WithInfo id="chat-added-by">
            <Text size="sm" c="dimmed" truncate>
              {hideOwner && !link.mine ? fromNow(link.createdAt) : t('Added by {{name}} {{when}}', { name: link.mine ? t('you') : link.ownerName, when: fromNow(link.createdAt) })}
              {!noCopy && ` · ${link.url}`}
            </Text>
          </WithInfo>
          <Group gap="md" mt={4}>
            {link.works > 0 && !noWorks && (
              <Group gap={4} c="teal">
                <IconCircleCheck size={14} />
                <Text size="xs" fw={700}>
                  {t('{{count}} classmates say it works', { count: link.works })}
                  {link.lastWorkedAt && ` · ${t('last checked {{when}}', { when: fromNow(link.lastWorkedAt) })}`} <ReqInfo id="chat-works" />
                </Text>
              </Group>
            )}
            {link.reports > 0 && (
              <Group gap={4} c={link.hidden ? 'red' : 'orange'}>
                <IconAlertTriangle size={14} />
                <Text size="xs" fw={700}>
                  {t('Reported by {{count}} classmates', { count: link.reports })}
                  {link.myVote === 'report' && link.myReason ? ` ${t('(including you: {{reason}})', { reason: t(link.myReason).toLowerCase() })}` : ''}
                  {link.mine && `. ${t('Fix the link, or mark it fixed if it works.')}`} <ReqInfo id="chat-report" />
                </Text>
              </Group>
            )}
          </Group>
        </div>
        <Divider orientation="vertical" />
        <Stack gap="sm" w={190}>
          {actions}
        </Stack>
      </Group>
    </Card>
  );
}

function LinkForm({ classId, existing, onDone }: { classId: number; existing: ChatLink | null; onDone: () => void }) {
  const form = useForm({
    initialValues: { url: existing?.url ?? '', label: existing?.label ?? '', purpose: (existing?.purpose ?? 'course') as LinkPurpose, platform: existing?.platform ?? '' },
    validate: { url: (v) => (parseChatLink(v) ? null : t('Paste a full link, starting with https://')) },
  });
  const detected = parseChatLink(form.values.url);
  const noPurpose = useVariant('no-link-purpose');
  const noName = useVariant('no-link-name');
  const pickPlatform = useVariant('pick-link-platform');
  const twoPlatforms = useVariant('whatsapp-discord-only');
  const sameUrlOnly = useVariant('link-same-url-only');
  const privateLinks = useVariant('private-links');
  const approval = useVariant('approve-links');
  const save = useAction(
    async (v: typeof form.values) => {
      const fields = { ...v, platform: v.platform || undefined };
      if (existing) await rpc.links.update({ linkId: existing.id, ...fields });
      else await rpc.links.add({ classId, ...fields });
    },
    { success: existing ? t('Link updated') : t('Link shared with the class'), onSuccess: onDone },
  );

  return (
    <form onSubmit={form.onSubmit((v) => save.mutate(v))}>
      <Stack>
        <TextInput
          label={<WithInfo id="chat-url">{t('Invite link')}</WithInfo>}
          placeholder="https://chat.whatsapp.com/…"
          data-autofocus
          description={pickPlatform ? undefined : detected ? t('Detected: {{platform}}', { platform: detected.platform }) : twoPlatforms ? 'WhatsApp or Discord' : 'WhatsApp, Discord, Messenger, Telegram, Teams…'}
          {...form.getInputProps('url')}
        />
        {pickPlatform && <Select label={<WithInfo id="chat-platform">Platform</WithInfo>} placeholder={detected?.platform ?? 'Pick one'} data={CHAT_PLATFORMS} clearable {...form.getInputProps('platform')} />}
        {!noPurpose && (
          <Select
            label={<WithInfo id="chat-purpose">{t('Who is it for?')}</WithInfo>}
            data={(Object.keys(LINK_PURPOSES) as LinkPurpose[]).map((p) => ({ value: p, label: t(LINK_PURPOSES[p]) }))}
            allowDeselect={false}
            {...form.getInputProps('purpose')}
          />
        )}
        {!noName && <TextInput label={<WithInfo id="chat-label">{t('Name')}</WithInfo>} placeholder={t('General course group, study server…')} {...form.getInputProps('label')} />}
        <Text size="xs" c="dimmed">
          {privateLinks
            ? 'Only you see the link until you share it with the class.'
            : approval
              ? 'Someone else in the section has to approve the link before it appears.'
              : sameUrlOnly
                ? 'Everyone in this section will see the link right away.'
                : t('Everyone in this section will see the link right away. Each chat can be shared once per course, across all sections.')}{' '}
          <ReqInfo id="chat-add" />
        </Text>
        <Group justify="flex-end">
          <Button type="submit" loading={save.isPending}>
            {existing ? t('Save') : t('Share link')}
          </Button>
        </Group>
      </Stack>
    </form>
  );
}
