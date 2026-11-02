import { useState } from 'react';
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
import { LINK_PURPOSES, type LinkPurpose, parseChatLink } from '@shared/links';
import { Empty, Loading, Tag } from '../../components/ui';
import { fromNow } from '../../lib/format';
import { useAction } from '../../lib/hooks';
import { type Out, rpc } from '../../lib/rpc';
import { t } from '../../lib/i18n';

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
  const shown = links.data?.filter((l) => !l.hidden) ?? [];
  const hidden = links.data?.filter((l) => l.hidden) ?? [];

  return (
    <>
      <Group justify="space-between" align="flex-start" mb="lg">
        <div>
          <Title order={2}>{t('Group Chat Links')}</Title>
          <Text c="dimmed" maw={560}>
            {t('Find and join the course group chats. Links are shared with the whole section as soon as they’re added. Say which ones still work, and report the ones that don’t.')}
          </Text>
        </div>
        <Button size="md" variant="default" leftSection={<IconPlus size={18} />} onClick={() => setEditing('new')}>
          {t('Add a group link')}
        </Button>
      </Group>

      {links.isPending ? (
        <Loading />
      ) : shown.length || hidden.length ? (
        <Stack gap="lg">
          {shown.map((l) => (
            <LinkCard key={l.id} link={l} classLabel={classLabel} onEdit={() => setEditing(l)} />
          ))}
          {hidden.length > 0 && (
            <>
              <Button
                variant="subtle"
                color="gray"
                w="fit-content"
                leftSection={showHidden ? <IconChevronUp size={16} /> : <IconChevronDown size={16} />}
                onClick={() => setShowHidden((s) => !s)}
              >
                {t('Hidden after reports ({{count}})', { count: hidden.length })}
              </Button>
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

      <Group justify="center" mt="xl" gap="lg">
        <Button size="md" variant="default" component={Link} to="/courses/mine" bg="var(--ul-soft)">
          {t('Browse other courses')}
        </Button>
        <Button size="md" color="yellow" variant="light" component={Link} to="/courses/find">
          {t("Can't find your class?")}
        </Button>
      </Group>

      <Modal opened={editing != null} onClose={() => setEditing(null)} title={editing === 'new' ? t('Add a group link') : t('Edit link')}>
        {editing && (
          <LinkForm key={editing === 'new' ? 'new' : editing.id} classId={classId} existing={editing === 'new' ? null : editing} onDone={() => setEditing(null)} />
        )}
      </Modal>
    </>
  );
}

function LinkCard({ link, classLabel, onEdit }: { link: ChatLink; classLabel: string; onEdit: () => void }) {
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

  const confirmRemove = () =>
    modals.openConfirmModal({
      title: t('Remove this link?'),
      labels: { confirm: t('Remove'), cancel: t('Keep') },
      confirmProps: { color: 'red' },
      onConfirm: () => remove.mutate(),
    });

  const status = link.hidden
    ? { label: t('Hidden'), color: 'red' }
    : link.works > 0
      ? { label: t('Works'), color: 'teal' }
      : { label: t('New'), color: 'gray' };

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
            <Badge size="lg" color={status.color} variant="light">
              {status.label}
            </Badge>
          </Group>
          <Group gap="xs">
            <Text fw={700}>{link.label || t('{{platform}} group', { platform: link.platform })}</Text>
            <Tag color={PURPOSE_COLORS[link.purpose]}>{t(LINK_PURPOSES[link.purpose])}</Tag>
            {link.ownerRole === 'professor' && <Tag color="periwinkle">{t('From the professor')}</Tag>}
          </Group>
          <Text size="sm" c="dimmed" truncate>
            {t('Added by {{name}} {{when}}', { name: link.mine ? t('you') : link.ownerName, when: fromNow(link.createdAt) })} · {link.url}
          </Text>
          <Group gap="md" mt={4}>
            {link.works > 0 && (
              <Group gap={4} c="teal">
                <IconCircleCheck size={14} />
                <Text size="xs" fw={700}>
                  {t('{{count}} classmates say it works', { count: link.works })}
                  {link.lastWorkedAt && ` · ${t('last checked {{when}}', { when: fromNow(link.lastWorkedAt) })}`}
                </Text>
              </Group>
            )}
            {link.reports > 0 && (
              <Group gap={4} c={link.hidden ? 'red' : 'orange'}>
                <IconAlertTriangle size={14} />
                <Text size="xs" fw={700}>
                  {t('Reported by {{count}} classmates', { count: link.reports })}
                  {link.myVote === 'report' && link.myReason ? ` ${t('(including you: {{reason}})', { reason: t(link.myReason).toLowerCase() })}` : ''}
                  {link.mine && `. ${t('Fix the link, or mark it fixed if it works.')}`}
                </Text>
              </Group>
            )}
          </Group>
        </div>
        <Divider orientation="vertical" />
        <Stack gap="sm" w={170}>
          <Button component="a" href={link.url} target="_blank" color="periwinkle" variant="light" leftSection={<IconExternalLink size={16} />}>
            {t('Open link')}
          </Button>
          {/* To pass the chat on to a classmate outside UniLink. */}
          <CopyButton value={link.url}>
            {({ copied, copy }) => (
              <Button variant="default" color={copied ? 'teal' : undefined} leftSection={copied ? <IconCircleCheck size={16} /> : <IconCopy size={16} />} onClick={copy}>
                {copied ? t('Copied') : t('Copy')}
              </Button>
            )}
          </CopyButton>
          {link.mine ? (
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
          ) : link.myVote ? (
            <Button variant="default" onClick={() => unvote.mutate()}>
              {link.myVote === 'works' ? t('Undo “works”') : t('Undo report')}
            </Button>
          ) : (
            <>
              <Button variant="default" leftSection={<IconThumbUp size={16} />} onClick={() => works.mutate()} loading={works.isPending}>
                {t('It works')}
              </Button>
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
            </>
          )}
        </Stack>
      </Group>
    </Card>
  );
}

function LinkForm({ classId, existing, onDone }: { classId: number; existing: ChatLink | null; onDone: () => void }) {
  const form = useForm({
    initialValues: { url: existing?.url ?? '', label: existing?.label ?? '', purpose: (existing?.purpose ?? 'course') as LinkPurpose },
    validate: { url: (v) => (parseChatLink(v) ? null : t('Paste a full link, starting with https://')) },
  });
  const detected = parseChatLink(form.values.url);
  const save = useAction(
    async (v: typeof form.values) => {
      if (existing) await rpc.links.update({ linkId: existing.id, ...v });
      else await rpc.links.add({ classId, ...v });
    },
    { success: existing ? t('Link updated') : t('Link shared with the class'), onSuccess: onDone },
  );

  return (
    <form onSubmit={form.onSubmit((v) => save.mutate(v))}>
      <Stack>
        <TextInput
          label={t('Invite link')}
          placeholder="https://chat.whatsapp.com/…"
          data-autofocus
          description={detected ? t('Detected: {{platform}}', { platform: detected.platform }) : 'WhatsApp, Discord, Messenger, Telegram, Teams…'}
          {...form.getInputProps('url')}
        />
        <Select
          label={t('Who is it for?')}
          data={(Object.keys(LINK_PURPOSES) as LinkPurpose[]).map((p) => ({ value: p, label: t(LINK_PURPOSES[p]) }))}
          allowDeselect={false}
          {...form.getInputProps('purpose')}
        />
        <TextInput label={t('Name')} placeholder={t('General course group, study server…')} {...form.getInputProps('label')} />
        <Text size="xs" c="dimmed">
          {t('Everyone in this section will see the link right away. Each chat can be shared once per course, across all sections.')}
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
