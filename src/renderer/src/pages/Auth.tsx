import { type ReactNode, useState } from 'react';
import {
  Alert,
  Anchor,
  Autocomplete,
  Button,
  Center,
  Code,
  CopyButton,
  Group,
  List,
  Paper,
  PasswordInput,
  Select,
  Stack,
  Text,
  TextInput,
  ThemeIcon,
  Title,
  SegmentedControl,
} from '@mantine/core';
import { useForm } from '@mantine/form';
import { modals } from '@mantine/modals';
import { IconCheck, IconInfoCircle, IconKey, IconX } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { FACULTIES, MCGILL_EMAIL, PASSWORD_RULES, passwordProblems, PRONOUNS, STAFF_EMAIL } from '@shared/validation';
import { GoatAvatar } from '../components/Goat';
import { Logo } from '../components/Layout';
import { useAction } from '../lib/hooks';
import { restoreBackup } from '../lib/backup';
import { rpc } from '../lib/rpc';
import { LanguageSwitch } from '../components/LanguageSwitch';
import { getLocale, t } from '../lib/i18n';

function AuthCard({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <Center mih="100vh" p="md">
      <Paper className="sketch" shadow="sm" p="xl" w={440} radius="xl">
        <Group justify="space-between" mb="lg">
          <Logo />
          <GoatAvatar goat={{ hat: 'grad', eyes: 'happy', horns: 'classic', fur: 'white', background: 'mint' }} size={72} />
        </Group>
        <Group justify="flex-end" mb="sm">
          <LanguageSwitch size="xs" />
        </Group>
        <Title order={3}>{title}</Title>
        <Text c="dimmed" size="sm" mb="lg">
          {subtitle}
        </Text>
        {children}
      </Paper>
    </Center>
  );
}

// Web build: the demo's data lives in this browser (web/bridge.ts).
const confirmReset = () =>
  modals.openConfirmModal({
    title: t('Reset demo data?'),
    children: <Text size="sm">{t('Every account and everything else saved in this browser is deleted, and the demo starts over.')}</Text>,
    labels: { confirm: t('Reset'), cancel: t('Keep') },
    confirmProps: { color: 'red' },
    onConfirm: () => void window.unilink.resetDemo(),
  });

const emailRule = (v: string) => (MCGILL_EMAIL.test(v.trim()) ? null : t('Use your McGill email (@mail.mcgill.ca)'));
const passwordRule = (v: string, values: { email: string }) =>
  passwordProblems(v, values.email).length ? t('Password does not meet the requirements') : null;

function PasswordChecklist({ password, email }: { password: string; email: string }) {
  return (
    <List size="xs" spacing={2} center>
      {PASSWORD_RULES.map(([label, test]) => {
        const ok = password.length > 0 && test(password, email);
        return (
          <List.Item
            key={label}
            c={ok ? 'teal' : 'dimmed'}
            icon={
              <ThemeIcon size={14} radius="xl" color={ok ? 'teal' : 'gray'} variant="light">
                {ok ? <IconCheck size={10} /> : <IconX size={10} />}
              </ThemeIcon>
            }
          >
            {t(label)}
          </List.Item>
        );
      })}
    </List>
  );
}

export function SignIn() {
  const form = useForm({ initialValues: { email: '', password: '' } });
  const signIn = useAction((values: typeof form.values) => rpc.auth.signIn(values));
  const devInfo = useQuery({ queryKey: ['devInfo'], queryFn: () => rpc.auth.devInfo() });

  return (
    <AuthCard title={t('Welcome back')} subtitle={t('Sign in with your McGill email.')}>
      <form onSubmit={form.onSubmit((v) => signIn.mutate(v))}>
        <Stack>
          <TextInput label={t('McGill email')} placeholder={t('first.last@mail.mcgill.ca')} required {...form.getInputProps('email')} />
          <PasswordInput visibilityToggleButtonProps={{ 'aria-label': t('Show or hide the password') }} label={t('Password')} required {...form.getInputProps('password')} />
          <Group justify="space-between">
            <Anchor component={Link} to="/reset" size="sm">
              {t('Forgot password?')}
            </Anchor>
            <Button type="submit" loading={signIn.isPending}>
              {t('Sign in')}
            </Button>
          </Group>
          <Text size="sm" ta="center">
            {t('New to UniLink?')}{' '}
            <Anchor component={Link} to="/signup">
              {t('Create an account')}
            </Anchor>
          </Text>
          {devInfo.data && (
            <Alert variant="light" icon={<IconInfoCircle />} title={t('Demo: sign in as a classmate or professor')}>
              <Group gap={6} mb="xs">
                {devInfo.data.accounts.map((a) => (
                  <Button
                    key={a.email}
                    size="compact-sm"
                    variant="default"
                    disabled={signIn.isPending}
                    onClick={() => signIn.mutate({ email: a.email, password: devInfo.data!.password })}
                  >
                    {a.professor ? t('{{name}} (professor)', { name: a.name }) : a.name}
                  </Button>
                ))}
              </Group>
              <Text size="xs">
                {devInfo.data.accounts.map((a) => a.email).join(', ')}
                <br />
                {t('Password:')} <Code>{devInfo.data.password}</Code> {t('(every demo account uses it)')}
              </Text>
              <Text size="xs" c="dimmed" mt="xs">
                {t('Everything is saved in this browser only.')}{' '}
                <Anchor component="button" type="button" size="xs" onClick={confirmReset}>
                  {t('Reset demo data')}
                </Anchor>{' '}
                ·{' '}
                <Anchor component="button" type="button" size="xs" onClick={restoreBackup}>
                  {t('Restore a backup')}
                </Anchor>
              </Text>
            </Alert>
          )}
        </Stack>
      </form>
    </AuthCard>
  );
}

// G4.4 in version B: shown once at sign-up and after each reset. It's the only way to
// reset a forgotten password, since UniLink doesn't email reset codes.
export function RecoveryCodeNotice({ code }: { code: string }) {
  return (
    <Alert variant="light" color="yellow" icon={<IconKey size={18} />} title={t('Save your recovery code')}>
      <Text size="sm" mb="xs">
        {t("If you forget your password, this code lets you set a new one. It's shown only once, so keep it somewhere safe (a password manager is ideal).")}
      </Text>
      <Group gap="sm">
        <Code fz="lg" fw={700}>
          {code}
        </Code>
        <CopyButton value={code}>
          {({ copied, copy }) => (
            <Button size="xs" variant="light" color="yellow" onClick={copy}>
              {copied ? t('Copied') : t('Copy')}
            </Button>
          )}
        </CopyButton>
      </Group>
    </Alert>
  );
}

function showRecoveryCode(code: string) {
  modals.open({
    title: t('One more thing'),
    closeOnClickOutside: false,
    closeOnEscape: false,
    withCloseButton: false,
    children: (
      <Stack>
        <RecoveryCodeNotice code={code} />
        <Button onClick={() => modals.closeAll()}>{t("I've saved it")}</Button>
      </Stack>
    ),
  });
}

export function SignUp() {
  const form = useForm({
    initialValues: {
      role: 'student' as 'student' | 'professor',
      name: '',
      email: '',
      pronouns: '',
      faculty: null as string | null,
      gradYear: null as string | null,
      password: '',
      confirm: '',
    },
    validate: {
      name: (v) => (v.trim() ? null : t('Enter your name')),
      email: (v, values) =>
        emailRule(v) ?? (values.role === 'professor' && !STAFF_EMAIL.test(v.trim()) ? t('Professor accounts use a @mcgill.ca email, not @mail.mcgill.ca.') : null),
      faculty: (v) => (v ? null : t('Pick your faculty')),
      password: passwordRule,
      confirm: (v, values) => (v === values.password ? null : t('Passwords do not match')),
    },
  });
  const signUp = useAction(
    (v: typeof form.values) =>
      rpc.auth.signUp({
        role: v.role,
        name: v.name,
        email: v.email,
        password: v.password,
        pronouns: v.pronouns,
        faculty: (v.faculty ?? '') as Parameters<typeof rpc.auth.signUp>[0]['faculty'],
        gradYear: v.role === 'student' && v.gradYear ? Number(v.gradYear) : null,
        locale: getLocale(),
      }),
    {
      success: (r) => (r.user.role === 'professor' ? t('Welcome to UniLink! Start by adding the sections you teach.') : t('Welcome to UniLink! Start by joining your classes.')),
      onSuccess: (r) => showRecoveryCode(r.recoveryCode),
    },
  );
  const year = new Date().getFullYear();
  const professor = form.values.role === 'professor';

  return (
    <AuthCard
      title={t('Create your account')}
      subtitle={professor ? t('Teach your sections on UniLink: run the grading scheme, post assignments and moderate the discussion.') : t('UniLink is for McGill students. Use your McGill email.')}
    >
      <form onSubmit={form.onSubmit((v) => signUp.mutate(v))}>
        <Stack>
          <SegmentedControl
            data={[
              { value: 'student', label: t('Student') },
              { value: 'professor', label: t('Professor') },
            ]}
            aria-label={t('I am a')}
            {...form.getInputProps('role')}
          />
          <Group grow align="flex-start">
            <TextInput label={t('Full name')} required {...form.getInputProps('name')} />
            <Autocomplete label={t('Pronouns')} placeholder={t('Optional')} data={[...PRONOUNS]} {...form.getInputProps('pronouns')} />
          </Group>
          <TextInput label={t('McGill email')} placeholder={professor ? t('jane.doe@mcgill.ca') : t('first.last@mail.mcgill.ca')} required {...form.getInputProps('email')} />
          <Group grow align="flex-start">
            <Select label={t('Faculty')} required searchable data={FACULTIES.map((f) => ({ value: f, label: t(f) }))} {...form.getInputProps('faculty')} />
            {!professor && (
              <Select
                label={t('Expected graduation')}
                placeholder="—"
                clearable
                data={Array.from({ length: 7 }, (_, i) => String(year + i))}
                {...form.getInputProps('gradYear')}
              />
            )}
          </Group>
          <Text size="xs" c="dimmed" mt={-6}>
            {professor
              ? t('Students in your sections see your name, email, pronouns and faculty.')
              : t('Classmates see your name, email, pronouns and faculty once you post or reply in a class.')}
          </Text>
          <div>
            <PasswordInput visibilityToggleButtonProps={{ 'aria-label': t('Show or hide the password') }} label={t('Password')} required mb={6} {...form.getInputProps('password')} />
            <PasswordChecklist password={form.values.password} email={form.values.email} />
          </div>
          <PasswordInput visibilityToggleButtonProps={{ 'aria-label': t('Show or hide the password') }} label={t('Confirm password')} required {...form.getInputProps('confirm')} />
          <Button type="submit" loading={signUp.isPending}>
            {t('Create account')}
          </Button>
          <Text size="sm" ta="center">
            {t('Already have an account?')}{' '}
            <Anchor component={Link} to="/">
              {t('Sign in')}
            </Anchor>
          </Text>
        </Stack>
      </form>
    </AuthCard>
  );
}

export function ResetPassword() {
  const [newCode, setNewCode] = useState<string | null>(null);
  const form = useForm({
    initialValues: { email: '', recoveryCode: '', password: '' },
    validate: {
      email: emailRule,
      recoveryCode: (v) => (v.replace(/[^a-z0-9]/gi, '').length === 12 ? null : t('Enter the 12-character recovery code')),
      password: passwordRule,
    },
  });
  const reset = useAction((v: typeof form.values) => rpc.auth.resetPassword(v), {
    success: 'Password updated. Sign in with your new password.',
    onSuccess: (r) => setNewCode(r.recoveryCode),
  });

  return (
    <AuthCard title={t('Reset your password')} subtitle={t('Use the recovery code you saved when you created your account.')}>
      {newCode ? (
        <Stack>
          <RecoveryCodeNotice code={newCode} />
          <Text size="sm">{t('Your old recovery code no longer works. This new one replaces it.')}</Text>
          <Button component={Link} to="/">
            {t('Back to sign in')}
          </Button>
        </Stack>
      ) : (
        <form onSubmit={form.onSubmit((v) => reset.mutate(v))}>
          <Stack>
            <TextInput label={t('McGill email')} required {...form.getInputProps('email')} />
            <TextInput label={t('Recovery code')} placeholder="XXXX-XXXX-XXXX" required {...form.getInputProps('recoveryCode')} />
            <div>
              <PasswordInput visibilityToggleButtonProps={{ 'aria-label': t('Show or hide the password') }} label={t('New password')} required mb={6} {...form.getInputProps('password')} />
              <PasswordChecklist password={form.values.password} email={form.values.email} />
            </div>
            <Group justify="space-between">
              <Anchor component={Link} to="/" size="sm">
                {t('Back to sign in')}
              </Anchor>
              <Button type="submit" loading={reset.isPending}>
                {t('Set new password')}
              </Button>
            </Group>
            <Text size="xs" c="dimmed">
              {t("Lost your recovery code too? There's no email reset in this version of UniLink. In the demo you can sign up again with another address.")}
            </Text>
          </Stack>
        </form>
      )}
    </AuthCard>
  );
}
