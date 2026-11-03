import { Fragment, useState } from 'react';
import {
  Alert,
  Autocomplete,
  Button,
  Card,
  Center,
  Checkbox,
  Group,
  Modal,
  PasswordInput,
  Select,
  Stack,
  Switch,
  Table,
  Text,
  TextInput,
} from '@mantine/core';
import { useForm } from '@mantine/form';
import { IconAlertTriangle, IconDownload, IconEye, IconMail, IconRestore } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import { FACULTIES, passwordProblems, PRONOUNS } from '@shared/validation';
import { SectionCard } from '../components/ui';
import { fromNow } from '../lib/format';
import { restoreBackup } from '../lib/backup';
import { clearDrafts } from '../lib/drafts';
import { useAction, useMe } from '../lib/hooks';
import { rpc } from '../lib/rpc';
import { t, tx } from '../lib/i18n';
import { ReqInfo, WithInfo } from '../components/ReqInfo';

// G4 account settings and G3 notification settings, shown as Settings tabs.

export function PrivacyPanel() {
  const download = useAction(() => rpc.profile.exportData(), { success: (r) => (r ? t('Saved a copy of your data.') : '') });
  return (
    <Stack gap="lg">
      <SectionCard info="privacy-visible" title={t('What classmates see')}>
        <Alert variant="light" icon={<IconEye size={18} />}>
          {t("Your name, McGill email, pronouns, faculty and goat are shown to classmates only once you post or reply on a discussion board. Joining a study session doesn't reveal you: only the other people going see who's there. Group chat links you share show your name. There's no member list for your classes. Your grades, notes, course record and planner are private to you.")}
        </Alert>
      </SectionCard>
      {/* G4: alongside deleting your account and data (Settings → Account). */}
      <SectionCard info="privacy-download" title={t('Your data')}>
        <Text size="sm" c="dimmed" mb="sm">
          {t('Download a copy of everything UniLink keeps about you: your profile, classes, course record, marks, notes, plans, to-dos, posts, replies, links and study sessions.')}
        </Text>
        <Button variant="default" w="fit-content" leftSection={<IconDownload size={16} />} onClick={() => download.mutate()} loading={download.isPending}>
          {t('Download my data')}
        </Button>
      </SectionCard>
      {/* There's no server, so this is the only copy of anything anyone keeps here. */}
      <SectionCard info="backup-download" title={t('Back up this browser')}>
        <Text size="sm" c="dimmed" mb="sm">
          {t('Everything in UniLink is saved only in this browser, so clearing its data would lose it. A backup keeps it all in one file you can restore here or on another computer. It holds every account used in this browser, with notes and marks, so keep it somewhere private.')}
        </Text>
        <Group gap="xs">
          <Button variant="default" leftSection={<IconDownload size={16} />} onClick={() => void window.unilink.downloadBackup()}>
            {t('Download a backup')}
          </Button>
          <WithInfo id="backup-restore">
            <Button variant="default" leftSection={<IconRestore size={16} />} onClick={restoreBackup}>
              {t('Restore a backup')}
            </Button>
          </WithInfo>
        </Group>
      </SectionCard>
    </Stack>
  );
}

const NOTIFICATION_GROUPS = {
  sessions: tx('Study Sessions'),
  discussion: tx('Discussion and group chats'),
  plans: tx('Plans and deadlines'),
  professor: tx('From your professor'),
  account: tx('Account'),
};

// G3: which notifications show on the desktop and go by email (in-app is always on).
export function NotificationSettings() {
  const prefs = useQuery({ queryKey: ['notifications', 'prefs'], queryFn: () => rpc.notifications.prefs() });
  const outbox = useQuery({ queryKey: ['notifications', 'outbox'], queryFn: () => rpc.notifications.outbox() });
  const [showOutbox, setShowOutbox] = useState(false);
  const set = useAction((v: Parameters<typeof rpc.notifications.setPref>[0]) => rpc.notifications.setPref(v));

  return (
    <SectionCard
      info="settings-notifications"
      title={t('Notifications')}
      actions={
        <WithInfo id="email-outbox">
          <Button size="xs" variant="subtle" leftSection={<IconMail size={14} />} onClick={() => setShowOutbox(true)}>
            {t('Email outbox ({{count}})', { count: outbox.data?.length ?? 0 })}
          </Button>
        </WithInfo>
      }
    >
      <Text size="sm" c="dimmed" mb="sm">
        {t('Everything appears under the bell at the top. Choose what also shows as a desktop notification or is emailed to your McGill address.')}
      </Text>
      <Table verticalSpacing={6}>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>
              <ReqInfo id="notif-types" />
            </Table.Th>
            <Table.Th ta="center" w={90}>
              <WithInfo id="notif-desktop">{t('Desktop')}</WithInfo>
            </Table.Th>
            <Table.Th ta="center" w={90}>
              <WithInfo id="notif-email">{t('Email')}</WithInfo>
            </Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {prefs.data?.map((p, i, all) => (
            <Fragment key={p.type}>
            {p.group !== all[i - 1]?.group && (
              <Table.Tr>
                <Table.Td colSpan={3} pt="md">
                  <Text size="xs" fw={800} c="dimmed" tt="uppercase">
                    {t(NOTIFICATION_GROUPS[p.group])}
                  </Text>
                </Table.Td>
              </Table.Tr>
            )}
            <Table.Tr>
              <Table.Td>
                <Text size="sm">{t(p.label)}</Text>
              </Table.Td>
              <Table.Td>
                <Center>
                  <Switch
                    checked={p.desktop}
                    onChange={(e) => set.mutate({ type: p.type, desktop: e.currentTarget.checked, email: p.email })}
                    aria-label={`${t(p.label)}: ${t('Desktop')}`}
                  />
                </Center>
              </Table.Td>
              <Table.Td>
                <Center>
                  <Switch
                    checked={p.email}
                    onChange={(e) => set.mutate({ type: p.type, desktop: p.desktop, email: e.currentTarget.checked })}
                    aria-label={`${t(p.label)}: ${t('Email')}`}
                  />
                </Center>
              </Table.Td>
            </Table.Tr>
            </Fragment>
          ))}
        </Table.Tbody>
      </Table>

      <Modal opened={showOutbox} onClose={() => setShowOutbox(false)} title={<WithInfo id="email-outbox">{t('Email outbox')}</WithInfo>} size="lg">
        <Alert variant="light" color="yellow" icon={<IconAlertTriangle size={18} />} mb="md">
          {t("Emails aren't actually sent yet: that needs a mail server, which this local-only version of UniLink doesn't have. This is what would have been sent to you.")}
        </Alert>
        {outbox.data?.length ? (
          <Stack gap="sm">
            {outbox.data.map((m) => (
              <Card key={m.id} withBorder padding="sm">
                <Text size="sm" fw={600}>
                  {m.subject}
                </Text>
                <Text size="xs" c="dimmed" mb={4}>
                  {t('To {{email}}', { email: m.toEmail })} · {fromNow(m.createdAt)}
                </Text>
                <Text size="sm" style={{ whiteSpace: 'pre-wrap' }}>
                  {m.body}
                </Text>
              </Card>
            ))}
          </Stack>
        ) : (
          <Text c="dimmed" size="sm">
            {t('No emails yet.')}
          </Text>
        )}
      </Modal>
    </SectionCard>
  );
}

export const facultyOptions = () => FACULTIES.map((f) => ({ value: f, label: t(f) }));

export const gradYearOptions = () => {
  const year = new Date().getFullYear();
  return Array.from({ length: 7 }, (_, i) => String(year + i));
};

export function ProfileForm() {
  const me = useMe();
  const form = useForm({
    initialValues: {
      name: me.name,
      pronouns: me.pronouns,
      faculty: (me.faculty || null) as string | null,
      gradYear: me.gradYear == null ? null : String(me.gradYear),
    },
    validate: { name: (v) => (v.trim() ? null : t('Enter your name')) },
  });
  const save = useAction(
    (v: typeof form.values) =>
      rpc.profile.update({
        name: v.name,
        pronouns: v.pronouns,
        faculty: (v.faculty ?? '') as Parameters<typeof rpc.profile.update>[0]['faculty'],
        gradYear: v.gradYear ? Number(v.gradYear) : null,
      }),
    { success: 'Profile saved', onSuccess: (_d, v) => form.resetDirty(v) },
  );

  return (
    <SectionCard info="profile-form" title={t('Profile')}>
      <form onSubmit={form.onSubmit((v) => save.mutate(v))}>
        <Stack>
          <Group grow>
            <TextInput label={<WithInfo id="profile-name">{t('Name')}</WithInfo>} {...form.getInputProps('name')} />
            <Autocomplete label={<WithInfo id="signup-pronouns">{t('Pronouns')}</WithInfo>} placeholder={t('Optional')} data={[...PRONOUNS]} {...form.getInputProps('pronouns')} />
          </Group>
          <Group grow>
            <Select label={<WithInfo id="signup-faculty">{t('Faculty')}</WithInfo>} placeholder="—" clearable data={facultyOptions()} {...form.getInputProps('faculty')} />
            {me.role === 'student' && <Select label={<WithInfo id="signup-grad">{t('Expected graduation')}</WithInfo>} placeholder="—" clearable data={gradYearOptions()} {...form.getInputProps('gradYear')} />}
          </Group>
          <Group justify="flex-end">
            <Button type="submit" disabled={!form.isDirty()} loading={save.isPending}>
              {t('Save profile')}
            </Button>
          </Group>
        </Stack>
      </form>
    </SectionCard>
  );
}

export function ChangePassword() {
  const me = useMe();
  const form = useForm({
    initialValues: { currentPassword: '', newPassword: '', confirm: '' },
    validate: {
      newPassword: (v) =>
        passwordProblems(v, me.email).length
          ? t('Needs: {{rules}}', { rules: passwordProblems(v, me.email).map((rule) => t(rule).toLowerCase()).join(', ') })
          : null,
      confirm: (v, values) => (v === values.newPassword ? null : t('Passwords do not match')),
    },
  });
  const save = useAction(
    ({ currentPassword, newPassword }: typeof form.values) => rpc.profile.changePassword({ currentPassword, newPassword }),
    { success: 'Password changed', onSuccess: () => form.reset() },
  );

  return (
    <SectionCard info="profile-password" title={t('Change password')}>
      <form onSubmit={form.onSubmit((v) => save.mutate(v))}>
        <Stack>
          <PasswordInput visibilityToggleButtonProps={{ 'aria-label': t('Show or hide the password') }} label={t('Current password')} {...form.getInputProps('currentPassword')} />
          <Group grow>
            <PasswordInput visibilityToggleButtonProps={{ 'aria-label': t('Show or hide the password') }} label={<WithInfo id="signup-password">{t('New password')}</WithInfo>} description={t('At least 12 characters. A short phrase is easiest to remember.')} {...form.getInputProps('newPassword')} />
            <PasswordInput visibilityToggleButtonProps={{ 'aria-label': t('Show or hide the password') }} label={t('Confirm new password')} {...form.getInputProps('confirm')} />
          </Group>
          <Group justify="flex-end">
            <Button type="submit" variant="default" loading={save.isPending}>
              {t('Change password')}
            </Button>
          </Group>
        </Stack>
      </form>
    </SectionCard>
  );
}

export function DeleteAccount() {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [keepPosts, setKeepPosts] = useState(false);
  const me = useMe();
  const remove = useAction(() => rpc.profile.deleteAccount({ password, keepPosts }), {
    success: 'Your account and data were deleted.',
    onSuccess: () => clearDrafts(me.id),
  });

  return (
    <SectionCard info="delete-account" title={t('Delete account')}>
      <Text size="sm" c="dimmed" mb="md">
        {t("Permanently deletes your account, classes, links, posts, grades and plans. Sessions you host pass to the next person going. This can't be undone.")}
      </Text>
      <Button color="red" variant="light" onClick={() => setOpen(true)}>
        {t('Delete my account')}
      </Button>
      <Modal opened={open} onClose={() => setOpen(false)} title={<WithInfo id="delete-account">{t('Delete your account?')}</WithInfo>}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            remove.mutate();
          }}
        >
          <Stack>
            <Text size="sm">{t('Enter your password to confirm.')}</Text>
            <PasswordInput visibilityToggleButtonProps={{ 'aria-label': t('Show or hide the password') }} label={t('Password')} value={password} onChange={(e) => setPassword(e.currentTarget.value)} data-autofocus />
            <Checkbox
              checked={keepPosts}
              onChange={(e) => setKeepPosts(e.currentTarget.checked)}
              label={<WithInfo id="delete-keep-posts">{t('Leave my posts and replies up, without my name')}</WithInfo>}
              description={t('Classmates keep the answers you gave. They show as "Former student".')}
            />
            <Text size="xs" c="dimmed">
              {t('Class times, deadlines and grading schemes you added for a section stay with it, credited to a former student.')} <ReqInfo id="delete-shared" />
            </Text>
            <Group justify="flex-end">
              <Button variant="default" onClick={() => setOpen(false)}>
                {t('Cancel')}
              </Button>
              <Button type="submit" color="red" disabled={!password} loading={remove.isPending}>
                {t('Delete everything')}
              </Button>
            </Group>
          </Stack>
        </form>
      </Modal>
    </SectionCard>
  );
}
