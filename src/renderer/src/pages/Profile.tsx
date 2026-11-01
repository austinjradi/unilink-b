import { useState } from 'react';
import { Alert, Button, Grid, Group, Modal, NumberInput, PasswordInput, Select, Stack, Text, TextInput } from '@mantine/core';
import { useForm } from '@mantine/form';
import { IconEye } from '@tabler/icons-react';
import { passwordProblems } from '@shared/validation';
import { PageHeader, SectionCard } from '../components/ui';
import { useAction, useMe } from '../lib/hooks';
import { rpc } from '../lib/rpc';

// G4: view and edit profile, change password, delete account.
export function ProfilePage() {
  return (
    <>
      <PageHeader title="Profile and account" />
      <Grid gap="lg">
        <Grid.Col span={{ base: 12, lg: 7 }}>
          <Stack gap="lg">
            <ProfileForm />
            <ChangePassword />
          </Stack>
        </Grid.Col>
        <Grid.Col span={{ base: 12, lg: 5 }}>
          <Stack gap="lg">
            <SectionCard title="What classmates see">
              <Alert variant="light" icon={<IconEye size={18} />}>
                Your name and McGill email are shown to classmates only when you post or reply on a discussion board, add
                a public group chat link, or join a study session. Your grades, notes and planner are private to you.
              </Alert>
            </SectionCard>
            <DeleteAccount />
          </Stack>
        </Grid.Col>
      </Grid>
    </>
  );
}

function ProfileForm() {
  const me = useMe();
  const form = useForm({
    initialValues: {
      name: me.name,
      program: me.program,
      year: me.year == null ? null : String(me.year),
      studyMinutesPerDay: me.studyMinutesPerDay,
    },
    validate: { name: (v) => (v.trim() ? null : 'Enter your name') },
  });
  const save = useAction(
    (v: typeof form.values) => rpc.profile.update({ ...v, year: v.year ? Number(v.year) : null, studyMinutesPerDay: Number(v.studyMinutesPerDay) }),
    { success: 'Profile saved', onSuccess: (_d, v) => form.resetDirty(v) },
  );

  return (
    <SectionCard title="Profile">
      <form onSubmit={form.onSubmit((v) => save.mutate(v))}>
        <Stack>
          <Group grow>
            <TextInput label="Name" {...form.getInputProps('name')} />
            <TextInput label="McGill email" value={me.email} disabled />
          </Group>
          <Group grow>
            <TextInput label="Program" placeholder="e.g. Computer Science" {...form.getInputProps('program')} />
            <Select label="Year" placeholder="—" clearable data={['1', '2', '3', '4', '5', '6']} {...form.getInputProps('year')} />
          </Group>
          <NumberInput
            label="Study time per day"
            description="How much time the assignment planner can schedule on a day"
            suffix=" min"
            min={15}
            max={960}
            step={15}
            w={260}
            {...form.getInputProps('studyMinutesPerDay')}
          />
          <Group justify="flex-end">
            <Button type="submit" disabled={!form.isDirty()} loading={save.isPending}>
              Save profile
            </Button>
          </Group>
        </Stack>
      </form>
    </SectionCard>
  );
}

function ChangePassword() {
  const form = useForm({
    initialValues: { currentPassword: '', newPassword: '', confirm: '' },
    validate: {
      newPassword: (v) => (passwordProblems(v).length ? `Needs: ${passwordProblems(v).join(', ').toLowerCase()}` : null),
      confirm: (v, values) => (v === values.newPassword ? null : 'Passwords do not match'),
    },
  });
  const save = useAction(
    ({ currentPassword, newPassword }: typeof form.values) => rpc.profile.changePassword({ currentPassword, newPassword }),
    { success: 'Password changed', onSuccess: () => form.reset() },
  );

  return (
    <SectionCard title="Change password">
      <form onSubmit={form.onSubmit((v) => save.mutate(v))}>
        <Stack>
          <PasswordInput label="Current password" {...form.getInputProps('currentPassword')} />
          <Group grow>
            <PasswordInput label="New password" {...form.getInputProps('newPassword')} />
            <PasswordInput label="Confirm new password" {...form.getInputProps('confirm')} />
          </Group>
          <Group justify="flex-end">
            <Button type="submit" variant="default" loading={save.isPending}>
              Change password
            </Button>
          </Group>
        </Stack>
      </form>
    </SectionCard>
  );
}

function DeleteAccount() {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const remove = useAction(() => rpc.profile.deleteAccount({ password }), { success: 'Your account and data were deleted.' });

  return (
    <SectionCard title="Delete account">
      <Text size="sm" c="dimmed" mb="md">
        Permanently deletes your account, classes, links, posts, study sessions, grades and plans. This can't be undone.
      </Text>
      <Button color="red" variant="light" onClick={() => setOpen(true)}>
        Delete my account
      </Button>
      <Modal opened={open} onClose={() => setOpen(false)} title="Delete your account?">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            remove.mutate();
          }}
        >
          <Stack>
            <Text size="sm">Enter your password to confirm. Everything you've added to UniLink will be deleted.</Text>
            <PasswordInput label="Password" value={password} onChange={(e) => setPassword(e.currentTarget.value)} data-autofocus />
            <Group justify="flex-end">
              <Button variant="default" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" color="red" disabled={!password} loading={remove.isPending}>
                Delete everything
              </Button>
            </Group>
          </Stack>
        </form>
      </Modal>
    </SectionCard>
  );
}
