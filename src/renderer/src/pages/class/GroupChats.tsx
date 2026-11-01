import { useState } from 'react';
import { Badge, Button, Card, Divider, Group, Menu, Modal, Stack, Switch, Text, TextInput, ThemeIcon, Title } from '@mantine/core';
import { useForm } from '@mantine/form';
import { modals } from '@mantine/modals';
import {
  IconAlertTriangle,
  IconBrandDiscord,
  IconBrandMessenger,
  IconBrandTelegram,
  IconBrandWhatsapp,
  IconDots,
  IconExternalLink,
  IconLink,
  IconLock,
  IconPencil,
  IconPlus,
  IconTrash,
  IconWorld,
} from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { parseChatLink } from '@shared/links';
import { Empty, Loading } from '../../components/ui';
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

// S2 in the layout of the wireframe (A2Team.pdf p. 8).
export function GroupChats({ classId, classLabel }: { classId: number; classLabel: string }) {
  const links = useQuery({ queryKey: ['links', classId], queryFn: () => rpc.links.list({ classId }) });
  const [editing, setEditing] = useState<ChatLink | 'new' | null>(null);

  return (
    <>
      <Group justify="space-between" align="flex-start" mb="lg">
        <div>
          <Title order={2}>{t('Group Chat Links')}</Title>
          <Text c="dimmed" maw={560}>
            {t("Find and join the course group chats. Links are shared by students and can be reported if they've expired.")}
          </Text>
        </div>
        <Button size="md" variant="default" leftSection={<IconPlus size={18} />} onClick={() => setEditing('new')}>
          {t('Add a group link')}
        </Button>
      </Group>

      {links.isPending ? (
        <Loading />
      ) : links.data?.length ? (
        <Stack gap="lg">
          {links.data.map((l) => (
            <LinkCard key={l.id} link={l} classLabel={classLabel} onEdit={() => setEditing(l)} />
          ))}
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
  const flag = useAction((reason: (typeof FLAG_REASONS)[number]) => rpc.links.flag({ linkId: link.id, reason }), {
    success: 'Thanks, your classmates will see this link was reported.',
  });
  const unflag = useAction(() => rpc.links.unflag({ linkId: link.id }));
  const toggle = useAction(
    () => rpc.links.update({ linkId: link.id, url: link.url, label: link.label, isPublic: !link.isPublic }),
    { success: link.isPublic ? t('Link is now private') : t('Link shared with the class') },
  );
  const remove = useAction(() => rpc.links.remove({ linkId: link.id }), { success: 'Link removed' });

  const confirmRemove = () =>
    modals.openConfirmModal({
      title: t('Remove this link?'),
      labels: { confirm: t('Remove'), cancel: t('Keep') },
      confirmProps: { color: 'red' },
      onConfirm: () => remove.mutate(),
    });

  const status = !link.isPublic
    ? { label: t('Only you'), color: 'gray' }
    : link.hidden
      ? { label: t('Reported'), color: 'red' }
      : { label: t('Active'), color: 'teal' };

  return (
    <Card padding="lg" radius={44} style={{ borderWidth: 2 }}>
      <Group wrap="nowrap" gap="lg" align="center">
        <ThemeIcon size={84} radius={84} color={platform.color} variant="light">
          <platform.icon size={48} />
        </ThemeIcon>
        <div style={{ flex: 1, minWidth: 0 }}>
          <Group gap="sm" wrap="nowrap">
            <Text fz={28} fw={600} className="display" truncate>
              {link.platform} - {classLabel}
            </Text>
            <Badge size="lg" color={status.color} variant="light" leftSection={!link.isPublic ? <IconLock size={12} /> : undefined}>
              {status.label}
            </Badge>
          </Group>
          <Text fw={700}>{link.label || t('{{platform}} group', { platform: link.platform })}</Text>
          <Text size="sm" c="dimmed" truncate>
            {t('Added by {{name}} {{when}}', { name: link.mine ? t('you') : link.ownerName, when: fromNow(link.createdAt) })} · {link.url}
          </Text>
          {link.flagCount > 0 && (
            <Group gap={4} mt={4} c={link.hidden ? 'red' : 'orange'}>
              <IconAlertTriangle size={14} />
              <Text size="xs" fw={700}>
                {t('Reported by {{count}} classmates', { count: link.flagCount })}
                {link.myFlag ? ` ${t('(including you: {{reason}})', { reason: t(link.myFlag).toLowerCase() })}` : ''}
                {link.mine && `. ${t('Updating the link clears the reports.')}`}
              </Text>
            </Group>
          )}
        </div>
        <Divider orientation="vertical" />
        <Stack gap="sm" w={170}>
          <Button component="a" href={link.url} target="_blank" color="periwinkle" variant="light" leftSection={<IconExternalLink size={16} />}>
            {t('Open link')}
          </Button>
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
                <Menu.Item leftSection={link.isPublic ? <IconLock size={14} /> : <IconWorld size={14} />} onClick={() => toggle.mutate()}>
                  {link.isPublic ? t('Make private') : t('Share with class')}
                </Menu.Item>
                <Menu.Item leftSection={<IconTrash size={14} />} color="red" onClick={confirmRemove}>
                  {t('Remove')}
                </Menu.Item>
              </Menu.Dropdown>
            </Menu>
          ) : link.myFlag ? (
            <Button variant="default" onClick={() => unflag.mutate()}>
              {t('Undo report')}
            </Button>
          ) : (
            <Menu position="bottom-end">
              <Menu.Target>
                <Button variant="default" leftSection={<IconAlertTriangle size={16} />}>
                  {t('Report link')}
                </Button>
              </Menu.Target>
              <Menu.Dropdown>
                <Menu.Label>{t("What's wrong with it?")}</Menu.Label>
                {FLAG_REASONS.map((r) => (
                  <Menu.Item key={r} onClick={() => flag.mutate(r)}>
                    {t(r)}
                  </Menu.Item>
                ))}
              </Menu.Dropdown>
            </Menu>
          )}
        </Stack>
      </Group>
    </Card>
  );
}

function LinkForm({ classId, existing, onDone }: { classId: number; existing: ChatLink | null; onDone: () => void }) {
  const form = useForm({
    initialValues: { url: existing?.url ?? '', label: existing?.label ?? '', isPublic: existing?.isPublic ?? false },
    validate: { url: (v) => (parseChatLink(v) ? null : t('Paste a full link, starting with https://')) },
  });
  const detected = parseChatLink(form.values.url);
  const save = useAction(
    async (v: typeof form.values) => {
      if (existing) await rpc.links.update({ linkId: existing.id, ...v });
      else await rpc.links.add({ classId, ...v });
    },
    { success: existing ? t('Link updated') : t('Link added'), onSuccess: onDone },
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
        <TextInput label={t("What's it for?")} placeholder={t('General course group, study server…')} {...form.getInputProps('label')} />
        <Switch
          label={t('Share with everyone in the class')}
          description={t('Leave off to keep this link to yourself for now.')}
          {...form.getInputProps('isPublic', { type: 'checkbox' })}
        />
        <Group justify="flex-end">
          <Button type="submit" loading={save.isPending}>
            {existing ? t('Save') : t('Add link')}
          </Button>
        </Group>
      </Stack>
    </form>
  );
}

