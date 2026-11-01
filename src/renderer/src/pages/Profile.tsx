import { useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Center,
  Group,
  Modal,
  NumberInput,
  PasswordInput,
  Select,
  Stack,
  Switch,
  Table,
  Text,
  TextInput,
} from '@mantine/core';
import { useForm } from '@mantine/form';
import { IconAlertTriangle, IconEye, IconMail } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import { passwordProblems } from '@shared/validation';
import { SectionCard } from '../components/ui';
import { fromNow } from '../lib/format';
import { useAction, useMe } from '../lib/hooks';
import { rpc } from '../lib/rpc';
import { t } from '../lib/i18n';

// G4 account settings and G3 notification settings, shown as Settings tabs.

export function PrivacyPanel() {
  return (
    <SectionCard title={t('What classmates see')}>
      <Alert variant="light" icon={<IconEye size={18} />}>
        {t("Your name, McGill email and goat are shown to classmates only when you post or reply on a discussion board, add a public group chat link, or join a study session. There's no member list for your classes. Your grades, notes, course record and planner are private to you.")}
      </Alert>
    </SectionCard>
  );
}

// G3: which notifications show on the desktop and go by email (in-app is always on).
export function NotificationSettings() {
  const prefs = useQuery({ queryKey: ['notifications', 'prefs'], queryFn: () => rpc.notifications.prefs() });
  const outbox = useQuery({ queryKey: ['notifications', 'outbox'], queryFn: () => rpc.notifications.outbox() });
  const [showOutbox, setShowOutbox] = useState(false);
  const set = useAction((v: Parameters<typeof rpc.notifications.setPref>[0]) => rpc.notifications.setPref(v));

  return (
    <SectionCard
      title={t('Notifications')}
      actions={
        <Button size="xs" variant="subtle" leftSection={<IconMail size={14} />} onClick={() => setShowOutbox(true)}>
          {t('Email outbox ({{count}})', { count: outbox.data?.length ?? 0 })}
        </Button>
      }
    >
      <Text size="sm" c="dimmed" mb="sm">
        {t('Everything appears under the bell at the top. Choose what also shows as a desktop notification or is emailed to your McGill address.')}
      </Text>
      <Table verticalSpacing={6}>
        <Table.Thead>
          <Table.Tr>
            <Table.Th />
            <Table.Th ta="center" w={90}>
              {t('Desktop')}
            </Table.Th>
            <Table.Th ta="center" w={90}>
              {t('Email')}
            </Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {prefs.data?.map((p) => (
            <Table.Tr key={p.type}>
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
          ))}
        </Table.Tbody>
      </Table>

      <Modal opened={showOutbox} onClose={() => setShowOutbox(false)} title={t('Email outbox')} size="lg">
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

export function ProfileForm() {
  const me = useMe();
  const form = useForm({
    initialValues: {
      name: me.name,
      program: me.program,
      year: me.year == null ? null : String(me.year),
      studyMinutesPerDay: me.studyMinutesPerDay,
    },
    validate: { name: (v) => (v.trim() ? null : t('Enter your name')) },
  });
  const save = useAction(
    (v: typeof form.values) => rpc.profile.update({ ...v, year: v.year ? Number(v.year) : null, studyMinutesPerDay: Number(v.studyMinutesPerDay) }),
    { success: 'Profile saved', onSuccess: (_d, v) => form.resetDirty(v) },
  );

  return (
    <SectionCard title={t('Profile')}>
      <form onSubmit={form.onSubmit((v) => save.mutate(v))}>
        <Stack>
          <Group grow>
            <TextInput label={t('Name')} {...form.getInputProps('name')} />
            <TextInput label={t('McGill email')} value={me.email} disabled />
          </Group>
          <Group grow>
            <TextInput label={t('Program')} placeholder={t('e.g. Computer Science')} {...form.getInputProps('program')} />
            <Select label={t('Year')} placeholder="—" clearable data={['1', '2', '3', '4', '5', '6']} {...form.getInputProps('year')} />
          </Group>
          <NumberInput
            label={t('Study time per day')}
            description={t('How much time the assignment planner can schedule on a day')}
            suffix=" min"
            min={15}
            max={960}
            step={15}
            w={260}
            {...form.getInputProps('studyMinutesPerDay')}
          />
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
  const form = useForm({
    initialValues: { currentPassword: '', newPassword: '', confirm: '' },
    validate: {
      newPassword: (v) =>
        passwordProblems(v).length
          ? t('Needs: {{rules}}', { rules: passwordProblems(v).map((rule) => t(rule).toLowerCase()).join(', ') })
          : null,
      confirm: (v, values) => (v === values.newPassword ? null : t('Passwords do not match')),
    },
  });
  const save = useAction(
    ({ currentPassword, newPassword }: typeof form.values) => rpc.profile.changePassword({ currentPassword, newPassword }),
    { success: 'Password changed', onSuccess: () => form.reset() },
  );

  return (
    <SectionCard title={t('Change password')}>
      <form onSubmit={form.onSubmit((v) => save.mutate(v))}>
        <Stack>
          <PasswordInput label={t('Current password')} {...form.getInputProps('currentPassword')} />
          <Group grow>
            <PasswordInput label={t('New password')} {...form.getInputProps('newPassword')} />
            <PasswordInput label={t('Confirm new password')} {...form.getInputProps('confirm')} />
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
  const remove = useAction(() => rpc.profile.deleteAccount({ password }), { success: 'Your account and data were deleted.' });

  return (
    <SectionCard title={t('Delete account')}>
      <Text size="sm" c="dimmed" mb="md">
        {t("Permanently deletes your account, classes, links, posts, study sessions, grades and plans. This can't be undone.")}
      </Text>
      <Button color="red" variant="light" onClick={() => setOpen(true)}>
        {t('Delete my account')}
      </Button>
      <Modal opened={open} onClose={() => setOpen(false)} title={t('Delete your account?')}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            remove.mutate();
          }}
        >
          <Stack>
            <Text size="sm">{t("Enter your password to confirm. Everything you've added to UniLink will be deleted.")}</Text>
            <PasswordInput label={t('Password')} value={password} onChange={(e) => setPassword(e.currentTarget.value)} data-autofocus />
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
