import { useState } from 'react';
import { ActionIcon, Alert, Anchor, Badge, Button, Card, Group, Menu, Modal, Stack, Switch, Text, TextInput } from '@mantine/core';
import { useForm } from '@mantine/form';
import { modals } from '@mantine/modals';
import {
  IconBrandDiscord,
  IconBrandMessenger,
  IconBrandTelegram,
  IconBrandWhatsapp,
  IconDots,
  IconExternalLink,
  IconFlag,
  IconLink,
  IconLock,
  IconPencil,
  IconPlus,
  IconTrash,
  IconWorld,
} from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import { parseChatLink } from '@shared/links';
import { Empty, Loading, SectionCard } from '../../components/ui';
import { fromNow, plural } from '../../lib/format';
import { useAction } from '../../lib/hooks';
import { type Out, rpc } from '../../lib/rpc';

type Link = Out<typeof rpc.links.list>[number];

const FLAG_REASONS = ['Expired', 'Broken', 'Not relevant', 'Spam or inappropriate'] as const;

const PLATFORM_ICONS: Record<string, typeof IconLink> = {
  WhatsApp: IconBrandWhatsapp,
  Discord: IconBrandDiscord,
  Messenger: IconBrandMessenger,
  Telegram: IconBrandTelegram,
};
const PLATFORM_COLORS: Record<string, string> = { WhatsApp: 'green', Discord: 'indigo', Messenger: 'blue', Telegram: 'cyan' };

// S2: group chat links for a class.
export function GroupChats({ classId }: { classId: number }) {
  const links = useQuery({ queryKey: ['links', classId], queryFn: () => rpc.links.list({ classId }) });
  const [editing, setEditing] = useState<Link | 'new' | null>(null);

  return (
    <SectionCard
      title="Group chats"
      actions={
        <Button size="xs" leftSection={<IconPlus size={14} />} onClick={() => setEditing('new')}>
          Add a link
        </Button>
      }
    >
      {links.isPending ? (
        <Loading />
      ) : links.data?.length ? (
        <Stack gap="sm">
          {links.data.map((l) => (
            <LinkCard key={l.id} link={l} onEdit={() => setEditing(l)} />
          ))}
        </Stack>
      ) : (
        <Empty icon={<IconBrandWhatsapp size={22} />}>
          No group chats shared yet. Know about a WhatsApp or Discord group for this class? Add it.
        </Empty>
      )}

      <Modal opened={editing != null} onClose={() => setEditing(null)} title={editing === 'new' ? 'Add a group chat' : 'Edit link'}>
        {editing && (
          <LinkForm
            key={editing === 'new' ? 'new' : editing.id}
            classId={classId}
            existing={editing === 'new' ? null : editing}
            onDone={() => setEditing(null)}
          />
        )}
      </Modal>
    </SectionCard>
  );
}

function LinkCard({ link, onEdit }: { link: Link; onEdit: () => void }) {
  const Icon = PLATFORM_ICONS[link.platform] ?? IconLink;
  const flag = useAction((reason: (typeof FLAG_REASONS)[number]) => rpc.links.flag({ linkId: link.id, reason }), {
    success: 'Thanks, your classmates will see this link was reported.',
  });
  const unflag = useAction(() => rpc.links.unflag({ linkId: link.id }));
  const toggle = useAction(
    () => rpc.links.update({ linkId: link.id, url: link.url, label: link.label, isPublic: !link.isPublic }),
    { success: link.isPublic ? 'Link is now private' : 'Link shared with the class' },
  );
  const remove = useAction(() => rpc.links.remove({ linkId: link.id }), { success: 'Link removed' });

  const confirmRemove = () =>
    modals.openConfirmModal({
      title: 'Remove this link?',
      labels: { confirm: 'Remove', cancel: 'Keep' },
      confirmProps: { color: 'red' },
      onConfirm: () => remove.mutate(),
    });

  return (
    <Card withBorder padding="md" opacity={link.hidden ? 0.7 : 1}>
      <Group justify="space-between" wrap="nowrap" align="flex-start">
        <Group wrap="nowrap" align="flex-start">
          <Icon size={28} color={`var(--mantine-color-${PLATFORM_COLORS[link.platform] ?? 'gray'}-6)`} />
          <div style={{ minWidth: 0 }}>
            <Group gap="xs">
              <Text fw={600}>{link.label || `${link.platform} group`}</Text>
              <Badge size="xs" variant="light" color={PLATFORM_COLORS[link.platform] ?? 'gray'}>
                {link.platform}
              </Badge>
              {!link.isPublic && (
                <Badge size="xs" variant="outline" color="gray" leftSection={<IconLock size={10} />}>
                  Only you
                </Badge>
              )}
            </Group>
            <Anchor href={link.url} target="_blank" size="sm" style={{ wordBreak: 'break-all' }}>
              {link.url} <IconExternalLink size={12} />
            </Anchor>
            <Text size="xs" c="dimmed">
              Added by {link.mine ? 'you' : link.ownerName} {fromNow(link.createdAt)}
            </Text>
          </div>
        </Group>

        {link.mine ? (
          <Menu position="bottom-end">
            <Menu.Target>
              <ActionIcon variant="subtle" aria-label="Link options">
                <IconDots size={16} />
              </ActionIcon>
            </Menu.Target>
            <Menu.Dropdown>
              <Menu.Item leftSection={<IconPencil size={14} />} onClick={onEdit}>
                Edit
              </Menu.Item>
              <Menu.Item leftSection={link.isPublic ? <IconLock size={14} /> : <IconWorld size={14} />} onClick={() => toggle.mutate()}>
                {link.isPublic ? 'Make private' : 'Share with class'}
              </Menu.Item>
              <Menu.Item leftSection={<IconTrash size={14} />} color="red" onClick={confirmRemove}>
                Remove
              </Menu.Item>
            </Menu.Dropdown>
          </Menu>
        ) : link.myFlag ? (
          <Button size="xs" variant="subtle" color="gray" onClick={() => unflag.mutate()}>
            Undo report
          </Button>
        ) : (
          <Menu position="bottom-end">
            <Menu.Target>
              <Button size="xs" variant="subtle" color="gray" leftSection={<IconFlag size={14} />}>
                Report
              </Button>
            </Menu.Target>
            <Menu.Dropdown>
              <Menu.Label>What's wrong with it?</Menu.Label>
              {FLAG_REASONS.map((r) => (
                <Menu.Item key={r} onClick={() => flag.mutate(r)}>
                  {r}
                </Menu.Item>
              ))}
            </Menu.Dropdown>
          </Menu>
        )}
      </Group>

      {link.flagCount > 0 && (
        <Alert mt="sm" p="xs" color={link.hidden ? 'red' : 'yellow'} variant="light" icon={<IconFlag size={16} />}>
          <Text size="xs">
            Reported by {plural(link.flagCount, 'classmate')}
            {link.myFlag ? ` (including you: ${link.myFlag.toLowerCase()})` : ''}.
            {link.hidden && ' It may no longer work.'}
            {link.mine && ' Updating the link clears the reports.'}
          </Text>
        </Alert>
      )}
    </Card>
  );
}

function LinkForm({ classId, existing, onDone }: { classId: number; existing: Link | null; onDone: () => void }) {
  const form = useForm({
    initialValues: { url: existing?.url ?? '', label: existing?.label ?? '', isPublic: existing?.isPublic ?? false },
    validate: { url: (v) => (parseChatLink(v) ? null : 'Paste a full link, starting with https://') },
  });
  const detected = parseChatLink(form.values.url);
  const save = useAction(
    async (v: typeof form.values) => {
      if (existing) await rpc.links.update({ linkId: existing.id, ...v });
      else await rpc.links.add({ classId, ...v });
    },
    { success: existing ? 'Link updated' : 'Link added', onSuccess: onDone },
  );

  return (
    <form onSubmit={form.onSubmit((v) => save.mutate(v))}>
      <Stack>
        <TextInput
          label="Invite link"
          placeholder="https://chat.whatsapp.com/…"
          data-autofocus
          description={detected ? `Detected: ${detected.platform}` : 'WhatsApp, Discord, Messenger, Telegram, Teams…'}
          {...form.getInputProps('url')}
        />
        <TextInput label="Name" placeholder="e.g. Lecture 001 group" {...form.getInputProps('label')} />
        <Switch
          label="Share with everyone in the class"
          description="Leave off to keep this link to yourself for now."
          {...form.getInputProps('isPublic', { type: 'checkbox' })}
        />
        <Group justify="flex-end">
          <Button type="submit" loading={save.isPending}>
            {existing ? 'Save' : 'Add link'}
          </Button>
        </Group>
      </Stack>
    </form>
  );
}
