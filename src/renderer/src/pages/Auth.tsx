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
import { IconCheck, IconInfoCircle, IconUsersGroup, IconX } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router';
import { MCGILL_EMAIL, PASSWORD_RULES, passwordProblems } from '@shared/validation';
import { useAction } from '../lib/hooks';
import { rpc } from '../lib/rpc';

function AuthCard({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <Center mih="100vh" p="md" bg="var(--mantine-color-gray-light)">
      <Paper withBorder shadow="sm" p="xl" w={420} radius="lg">
        <Group gap="xs" mb="lg">
          <ThemeIcon size="lg" variant="gradient" gradient={{ from: 'indigo', to: 'red', deg: 135 }}>
            <IconUsersGroup size={20} />
          </ThemeIcon>
          <Text fw={700} size="lg">
            UniLink
          </Text>
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

const emailRule = (v: string) => (MCGILL_EMAIL.test(v.trim()) ? null : 'Use your McGill email (@mail.mcgill.ca)');
const passwordRule = (v: string) => (passwordProblems(v).length ? 'Password does not meet the requirements' : null);

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
            {label}
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
    <AuthCard title="Welcome back" subtitle="Sign in with your McGill email.">
      <form onSubmit={form.onSubmit((v) => signIn.mutate(v))}>
        <Stack>
          <TextInput label="McGill email" placeholder="first.last@mail.mcgill.ca" required {...form.getInputProps('email')} />
          <PasswordInput label="Password" required {...form.getInputProps('password')} />
          <Group justify="space-between">
            <Anchor component={Link} to="/reset" size="sm">
              Forgot password?
            </Anchor>
            <Button type="submit" loading={signIn.isPending}>
              Sign in
            </Button>
          </Group>
          <Text size="sm" ta="center">
            New to UniLink?{' '}
            <Anchor component={Link} to="/signup">
              Create an account
            </Anchor>
          </Text>
          {devInfo.data && (
            <Alert variant="light" icon={<IconInfoCircle />} title="Dev build: demo classmates">
              <Text size="xs">
                {devInfo.data.emails.join(', ')}
                <br />
                Password: <Code>{devInfo.data.password}</Code>
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
      name: (v) => (v.trim() ? null : 'Enter your name'),
      email: emailRule,
      password: passwordRule,
      confirm: (v, values) => (v === values.password ? null : 'Passwords do not match'),
    },
  });
  const signUp = useAction(({ name, email, password }: typeof form.values) => rpc.auth.signUp({ name, email, password }), {
    success: 'Welcome to UniLink! Start by joining your classes.',
  });

  return (
    <AuthCard title="Create your account" subtitle="UniLink is for McGill students. Use your McGill email.">
      <form onSubmit={form.onSubmit((v) => signUp.mutate(v))}>
        <Stack>
          <TextInput label="Full name" required {...form.getInputProps('name')} />
          <TextInput label="McGill email" placeholder="first.last@mail.mcgill.ca" required {...form.getInputProps('email')} />
          <div>
            <PasswordInput label="Password" required mb={6} {...form.getInputProps('password')} />
            <PasswordChecklist password={form.values.password} />
          </div>
          <PasswordInput label="Confirm password" required {...form.getInputProps('confirm')} />
          <Button type="submit" loading={signUp.isPending}>
            Create account
          </Button>
          <Text size="sm" ta="center">
            Already have an account?{' '}
            <Anchor component={Link} to="/">
              Sign in
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
    validate: { code: (v) => (v.length === 6 ? null : 'Enter the 6-digit code'), password: passwordRule },
  });

  const request = useAction((address: string) => rpc.auth.requestPasswordReset({ email: address }), {
    onSuccess: (data) => setSent(data),
  });
  const reset = useAction((v: typeof form.values) => rpc.auth.resetPassword({ email, ...v }), {
    success: 'Password updated. Sign in with your new password.',
    onSuccess: () => navigate('/'),
  });

  return (
    <AuthCard title="Reset your password" subtitle="We'll send a one-time code to your McGill email.">
      {!sent ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            request.mutate(email);
          }}
        >
          <Stack>
            <TextInput label="McGill email" required value={email} onChange={(e) => setEmail(e.currentTarget.value)} />
            <Group justify="space-between">
              <Anchor component={Link} to="/" size="sm">
                Back to sign in
              </Anchor>
              <Button type="submit" loading={request.isPending}>
                Send code
              </Button>
            </Group>
          </Stack>
        </form>
      ) : (
        <form onSubmit={form.onSubmit((v) => reset.mutate(v))}>
          <Stack>
            <Text size="sm">
              If <b>{email}</b> has an account, a code is on its way. It expires in 15 minutes.
            </Text>
            {sent.devCode && (
              <Alert variant="light" icon={<IconInfoCircle />} title="Dev build: email isn't wired up yet">
                Your code is <Code>{sent.devCode}</Code>
              </Alert>
            )}
            <div>
              <Text size="sm" fw={500} mb={4}>
                Code
              </Text>
              <PinInput length={6} type="number" {...form.getInputProps('code')} />
              {form.errors.code && (
                <Text c="red" size="xs" mt={4}>
                  {form.errors.code}
                </Text>
              )}
            </div>
            <div>
              <PasswordInput label="New password" required mb={6} {...form.getInputProps('password')} />
              <PasswordChecklist password={form.values.password} />
            </div>
            <Button type="submit" loading={reset.isPending}>
              Set new password
            </Button>
          </Stack>
        </form>
      )}
    </AuthCard>
  );
}
