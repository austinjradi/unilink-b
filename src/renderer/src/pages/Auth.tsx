import { type ReactNode, useState } from 'react';
import {
  Alert,
  Anchor,
  Button,
  Center,
  Code,
  Group,
  List,
  Paper,
  PasswordInput,
  PinInput,
  Stack,
  Text,
  TextInput,
  ThemeIcon,
  Title,
} from '@mantine/core';
import { useForm } from '@mantine/form';
import { IconCheck, IconInfoCircle, IconX } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router';
import { MCGILL_EMAIL, PASSWORD_RULES, passwordProblems } from '@shared/validation';
import { GoatAvatar } from '../components/Goat';
import { Logo } from '../components/Layout';
import { useAction } from '../lib/hooks';
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

const emailRule = (v: string) => (MCGILL_EMAIL.test(v.trim()) ? null : t('Use your McGill email (@mail.mcgill.ca)'));
const passwordRule = (v: string) => (passwordProblems(v).length ? t('Password does not meet the requirements') : null);

function PasswordChecklist({ password }: { password: string }) {
  return (
    <List size="xs" spacing={2} center>
      {PASSWORD_RULES.map(([label, test]) => {
        const ok = test(password);
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
          <PasswordInput label={t('Password')} required {...form.getInputProps('password')} />
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
            <Alert variant="light" icon={<IconInfoCircle />} title={t('Dev build: demo classmates')}>
              <Text size="xs">
                {devInfo.data.emails.join(', ')}
                <br />
                {t('Password:')} <Code>{devInfo.data.password}</Code>
              </Text>
            </Alert>
          )}
        </Stack>
      </form>
    </AuthCard>
  );
}

export function SignUp() {
  const form = useForm({
    initialValues: { name: '', email: '', password: '', confirm: '' },
    validate: {
      name: (v) => (v.trim() ? null : t('Enter your name')),
      email: emailRule,
      password: passwordRule,
      confirm: (v, values) => (v === values.password ? null : t('Passwords do not match')),
    },
  });
  const signUp = useAction(({ name, email, password }: typeof form.values) => rpc.auth.signUp({ name, email, password, locale: getLocale() }), {
    success: 'Welcome to UniLink! Start by joining your classes.',
  });

  return (
    <AuthCard title={t('Create your account')} subtitle={t('UniLink is for McGill students. Use your McGill email.')}>
      <form onSubmit={form.onSubmit((v) => signUp.mutate(v))}>
        <Stack>
          <TextInput label={t('Full name')} required {...form.getInputProps('name')} />
          <TextInput label={t('McGill email')} placeholder={t('first.last@mail.mcgill.ca')} required {...form.getInputProps('email')} />
          <div>
            <PasswordInput label={t('Password')} required mb={6} {...form.getInputProps('password')} />
            <PasswordChecklist password={form.values.password} />
          </div>
          <PasswordInput label={t('Confirm password')} required {...form.getInputProps('confirm')} />
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
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState<{ devCode: string | null } | null>(null);
  const form = useForm({
    initialValues: { code: '', password: '' },
    validate: { code: (v) => (v.length === 6 ? null : t('Enter the 6-digit code')), password: passwordRule },
  });

  const request = useAction((address: string) => rpc.auth.requestPasswordReset({ email: address }), {
    onSuccess: (data) => setSent(data),
  });
  const reset = useAction((v: typeof form.values) => rpc.auth.resetPassword({ email, ...v }), {
    success: 'Password updated. Sign in with your new password.',
    onSuccess: () => navigate('/'),
  });

  return (
    <AuthCard title={t('Reset your password')} subtitle={t("We'll send a one-time code to your McGill email.")}>
      {!sent ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            request.mutate(email);
          }}
        >
          <Stack>
            <TextInput label={t('McGill email')} required value={email} onChange={(e) => setEmail(e.currentTarget.value)} />
            <Group justify="space-between">
              <Anchor component={Link} to="/" size="sm">
                {t('Back to sign in')}
              </Anchor>
              <Button type="submit" loading={request.isPending}>
                {t('Send code')}
              </Button>
            </Group>
          </Stack>
        </form>
      ) : (
        <form onSubmit={form.onSubmit((v) => reset.mutate(v))}>
          <Stack>
            <Text size="sm">
              {t('If {{email}} has an account, a code is on its way. It expires in 15 minutes.', { email })}
            </Text>
            {sent.devCode && (
              <Alert variant="light" icon={<IconInfoCircle />} title={t("Dev build: email isn't wired up yet")}>
                {t('Your code is')} <Code>{sent.devCode}</Code>
              </Alert>
            )}
            <div>
              <Text size="sm" fw={500} mb={4}>
                {t('Code')}
              </Text>
              <PinInput length={6} type="number" {...form.getInputProps('code')} />
              {form.errors.code && (
                <Text c="red" size="xs" mt={4}>
                  {form.errors.code}
                </Text>
              )}
            </div>
            <div>
              <PasswordInput label={t('New password')} required mb={6} {...form.getInputProps('password')} />
              <PasswordChecklist password={form.values.password} />
            </div>
            <Button type="submit" loading={reset.isPending}>
              {t('Set new password')}
            </Button>
          </Stack>
        </form>
      )}
    </AuthCard>
  );
}
