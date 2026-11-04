import { type ReactNode, useState, useEffect } from 'react';
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
  Progress, Modal,
} from '@mantine/core';
import { useForm } from '@mantine/form';
import { modals } from '@mantine/modals';
import { IconCheck, IconInfoCircle, IconKey, IconX } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { FACULTIES, MCGILL_EMAIL, PASSWORD_RULES, passwordProblems, PRONOUNS, STAFF_EMAIL } from '@shared/validation';
import { GoatAvatar } from '../components/Goat';
import { Logo } from '../components/Layout';
import { useAction } from '../lib/hooks';
import { restoreBackup } from '../lib/backup';
import { rpc } from '../lib/rpc';
import { LanguageSwitch } from '../components/LanguageSwitch';
import { getLocale, t } from '../lib/i18n';
import { isOn } from '@shared/variants';
import { useVariant } from '../lib/variants';
import { ReqInfo, WithInfo } from '../components/ReqInfo';

function AuthCard({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <Center mih="100vh" p="md">
      <Paper className="sketch" shadow="sm" p="xl" w={440} radius="xl">
        <Group justify="space-between" mb="lg">
          <WithInfo id="nav-logo">
            <Logo />
          </WithInfo>
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

// 'guided-tour': what the app is, for someone who hasn't got a ready-made account to look around in.
const TOUR = [
  { title: 'Your classes', text: 'Join your sections, then find each class’s times, classmates and links on its page.' },
  { title: 'Discussions', text: 'Ask questions, share notes and form groups with the people in your classes.' },
  { title: 'Sessions', text: 'Set up a study session, or join one someone else is hosting.' },
  { title: 'Calendar and planner', text: 'See every deadline in one place, and split big work into tasks that fit your week.' },
  { title: 'Grades', text: 'Enter your marks to see where you stand and what you need on the final.' },
];

function GuidedTour() {
  const [step, setStep] = useState<number | null>(null);
  return (
    <>
      <WithInfo id="demo-accounts">
        <Button variant="default" onClick={() => setStep(0)}>
          Take the tour
        </Button>
      </WithInfo>
      <Modal opened={step != null} onClose={() => setStep(null)} title={step != null ? TOUR[step].title : ''}>
        <Text size="sm" mb="md">
          {step != null && TOUR[step].text}
        </Text>
        <Group justify="space-between">
          <Text size="xs" c="dimmed">
            {(step ?? 0) + 1} of {TOUR.length}
          </Text>
          <Button onClick={() => setStep(step! + 1 < TOUR.length ? step! + 1 : null)}>{step! + 1 < TOUR.length ? 'Next' : 'Done'}</Button>
        </Group>
      </Modal>
    </>
  );
}

// Web build: the demo's data lives in this browser (web/bridge.ts).
// 'type-to-reset': a harder button to press by accident.
function TypedReset() {
  const [typed, setTyped] = useState('');
  return (
    <Stack>
      <Text size="sm">Every account and everything else saved in this browser is deleted, and the demo starts over.</Text>
      <TextInput label="Type RESET to confirm" value={typed} onChange={(e) => setTyped(e.currentTarget.value)} data-autofocus />
      <Button color="red" disabled={typed !== 'RESET'} onClick={() => void window.unilink.resetDemo()}>
        Reset
      </Button>
    </Stack>
  );
}

const confirmReset = () =>
  isOn('type-to-reset') ? modals.open({ title: 'Reset demo data?', children: <TypedReset /> }) : modals.openConfirmModal({
    title: t('Reset demo data?'),
    children: <Text size="sm">{t('Every account and everything else saved in this browser is deleted, and the demo starts over.')}</Text>,
    labels: { confirm: t('Reset'), cancel: t('Keep') },
    confirmProps: { color: 'red' },
    onConfirm: () => void window.unilink.resetDemo(),
  });

// 'short-email': a student's address if there is one, otherwise a professor's.
async function fullEmail(typed: string) {
  const name = typed.trim();
  if (name.includes('@')) return name;
  const student = `${name}@mail.mcgill.ca`;
  return (await rpc.auth.emailExists({ email: student })) ? student : `${name}@mcgill.ca`;
}

const emailRule = (v: string) => (MCGILL_EMAIL.test(v.trim()) ? null : t('Use your McGill email (@mail.mcgill.ca)'));
const passwordRule = (v: string, values: { email: string }) =>
  passwordProblems(v, values.email).length ? t('Password does not meet the requirements') : null;

// 'password-strength-meter': length and variety, as a bar.
const strength = (password: string) => Math.min(100, password.length * 5 + [/[a-z]/, /[A-Z]/, /\d/, /[^a-zA-Z0-9]/].filter((re) => re.test(password)).length * 10);

function PasswordChecklist({ password, email }: { password: string; email: string }) {
  const simple = useVariant('simple-password-rule');
  const meter = useVariant('password-strength-meter');
  if (simple) {
    return (
      <Text size="xs" c={passwordProblems(password, email).length ? 'dimmed' : 'teal'} mt={4}>
        At least 8 characters, with a letter and a number.
      </Text>
    );
  }
  if (meter) return <Progress mt={6} size="sm" value={strength(password)} color={strength(password) < 50 ? 'red' : strength(password) < 80 ? 'yellow' : 'teal'} aria-label="Password strength" />;
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

// 'confirm-email' and 'verify-professors': there's no real mail, so this demo shows what the email says.
function ConfirmEmail({ email: known, demoCode }: { email: string; demoCode: string | null }) {
  const [email, setEmail] = useState(known);
  const [code, setCode] = useState('');
  const [shown, setShown] = useState(demoCode);
  const confirm = useAction(() => rpc.auth.confirmEmail({ email, code }));
  const resend = useAction(() => rpc.auth.resendConfirmation({ email }), { onSuccess: (r) => setShown(r.code) });
  return (
    <Stack>
      <Text size="sm">We sent a code to confirm your email. The account starts working once you enter it.</Text>
      {shown && (
        <Alert variant="light" icon={<IconInfoCircle />} title={<WithInfo id="signup-role">Demo: there&apos;s no real mail</WithInfo>}>
          The email says your code is <Code>{shown}</Code>
        </Alert>
      )}
      {!known && <TextInput label={t('McGill email')} value={email} onChange={(e) => setEmail(e.currentTarget.value)} />}
      <TextInput label="Code" data-autofocus value={code} onChange={(e) => setCode(e.currentTarget.value)} />
      <Group justify="space-between">
        <Anchor component="button" type="button" size="sm" onClick={() => resend.mutate()}>
          Send a new code
        </Anchor>
        <Button disabled={!code.trim() || !email.trim()} loading={confirm.isPending} onClick={() => confirm.mutate()}>
          Confirm
        </Button>
      </Group>
    </Stack>
  );
}

export function SignIn() {
  const form = useForm({ initialValues: { email: '', password: '', totp: '', answer: '' } });
  const secondFactor = useVariant('second-factor');
  const shortEmail = useVariant('short-email');
  const askQuestion = useVariant('sign-in-question');
  const confirmsEmail = useVariant('confirm-email');
  const verifiesProfessors = useVariant('verify-professors');
  const [confirming, setConfirming] = useState(false);
  const oneForm = useVariant('one-sign-in-form');
  const navigate = useNavigate();
  const signIn = useAction(async (values: typeof form.values) => {
    const email = shortEmail ? await fullEmail(values.email) : values.email;
    if (oneForm && !(await rpc.auth.emailExists({ email }))) {
      navigate(`/signup?email=${encodeURIComponent(email)}`);
      return null;
    }
    return rpc.auth.signIn({ ...values, email });
  });
  const [question, setQuestion] = useState<string | null>(null);
  const attempted = signIn.submittedAt;
  useEffect(() => {
    if (!askQuestion || !attempted || signIn.isPending || !form.values.email) return;
    void rpc.auth.signInQuestion({ email: form.values.email }).then((q) => setQuestion(q?.text ?? null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [askQuestion, attempted, signIn.isPending]);
  const devInfo = useQuery({ queryKey: ['devInfo'], queryFn: () => rpc.auth.devInfo() });
  const tour = useVariant('guided-tour');
  const studentsOnly = useVariant('students-only');
  const noProfessors = useVariant('no-professor-features');
  const emptyStart = useVariant('empty-start');
  const ownReset = useVariant('reset-own-data');

  return (
    <AuthCard title={t('Welcome back')} subtitle={t('Sign in with your McGill email.')}>
      <form onSubmit={form.onSubmit((v) => signIn.mutate(v))}>
        <Stack>
          <TextInput label={<WithInfo id="signin-email">{t('McGill email')}</WithInfo>} placeholder={shortEmail ? 'first.last' : t('first.last@mail.mcgill.ca')} required {...form.getInputProps('email')} />
          <PasswordInput visibilityToggleButtonProps={{ 'aria-label': t('Show or hide the password') }} label={<WithInfo id="signin-password">{t('Password')}</WithInfo>} required {...form.getInputProps('password')} />
          {secondFactor && <TextInput label={<WithInfo id="signin-password">Code from your authenticator app</WithInfo>} description="Only if you've set one up." autoComplete="one-time-code" {...form.getInputProps('totp')} />}
          {question && <TextInput label={question} required {...form.getInputProps('answer')} />}
          <Group justify="space-between">
            <WithInfo id="signin-forgot">
              <Anchor component={Link} to="/reset" size="sm">
                {t('Forgot password?')}
              </Anchor>
            </WithInfo>
            <WithInfo id="signin-password">
              <Button type="submit" loading={signIn.isPending}>
                {t('Sign in')}
              </Button>
            </WithInfo>
          </Group>
          <Text size="sm" ta="center">
            {t('New to UniLink?')}{' '}
            <Anchor component={Link} to="/signup">
              {t('Create an account')}
            </Anchor>{' '}
            <ReqInfo id="signin-create" />
          </Text>
          {(confirmsEmail || verifiesProfessors) && (
            <Anchor component="button" type="button" size="sm" onClick={() => setConfirming(true)}>
              Have a confirmation code?
            </Anchor>
          )}
          <Modal opened={confirming} onClose={() => setConfirming(false)} title="Confirm your email">
            <ConfirmEmail email="" demoCode={null} />
          </Modal>
          {tour && <GuidedTour />}
          {(tour || emptyStart) && (
            <Text size="xs" c="dimmed">
              {t('Everything is saved in this browser only.')}{' '}
              <Anchor component="button" type="button" size="xs" onClick={restoreBackup}>
                {t('Restore a backup')}
              </Anchor>{' '}
              <ReqInfo id="backup-restore" />
            </Text>
          )}
          {devInfo.data && !tour && !emptyStart && (
            <Alert variant="light" icon={<IconInfoCircle />} title={<WithInfo id="demo-accounts">{t('Demo: sign in as a classmate or professor')}</WithInfo>}>
              <Group gap={6} mb="xs">
                {devInfo.data.accounts.filter((a) => !a.professor || (!studentsOnly && !noProfessors)).map((a) => (
                  <Button
                    key={a.email}
                    size="compact-sm"
                    variant="default"
                    disabled={signIn.isPending}
                    onClick={() => signIn.mutate({ email: a.email, password: devInfo.data!.password, totp: '', answer: '' })}
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
              <Text size="xs" mt="xs">
                {t('Try it: sign in as the professor and post an assignment, then sign out and sign in as a student to see it arrive.')}
              </Text>
              <Text size="xs" c="dimmed" mt="xs">
                {t('Everything is saved in this browser only.')}{' '}
                {!ownReset && (
                  <>
                    <Anchor component="button" type="button" size="xs" onClick={confirmReset}>
                      {t('Reset demo data')}
                    </Anchor>{' '}
                    <ReqInfo id="demo-reset" /> ·{' '}
                  </>
                )}
                <Anchor component="button" type="button" size="xs" onClick={restoreBackup}>
                  {t('Restore a backup')}
                </Anchor>{' '}
                <ReqInfo id="backup-restore" />
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
    <Alert variant="light" color="yellow" icon={<IconKey size={18} />} title={<WithInfo id="recovery-code">{t('Save your recovery code')}</WithInfo>}>
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
  const noConfirm = useVariant('no-confirm-password');
  const resetByCode = useVariant('reset-by-email-code');
  const resetByLink = useVariant('reset-by-email-link');
  const versionAProfile = useVariant('version-a-profile');
  const minimal = useVariant('minimal-signup');
  const displayName = useVariant('display-name');
  const anyUniversity = useVariant('other-universities');
  const hideExtras = versionAProfile || minimal;
  const [params] = useSearchParams();
  const versionA = useVariant('classmates-version-a');
  const listMembers = useVariant('list-members');
  const form = useForm({
    initialValues: {
      role: 'student' as 'student' | 'professor',
      name: '',
      email: params.get('email') ?? '',
      pronouns: '',
      faculty: null as string | null,
      gradYear: null as string | null,
      password: '',
      confirm: '',
    },
    validate: {
      name: (v) => (v.trim() ? null : t('Enter your name')),
      email: (v, values) =>
        (anyUniversity ? null : emailRule(v)) ?? (values.role === 'professor' && !STAFF_EMAIL.test(v.trim()) ? t('Professor accounts use a @mcgill.ca email, not @mail.mcgill.ca.') : null),
      faculty: (v) => (hideExtras || v ? null : t('Pick your faculty')),
      password: passwordRule,
      confirm: (v, values) => (noConfirm || v === values.password ? null : t('Passwords do not match')),
    },
  });
  const [confirming, setConfirming] = useState<{ email: string; code: string | null } | null>(null);
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
      success: (r) => r.needsConfirming ? 'Check your email for a code.' : (r.user.role === 'professor' ? t('Welcome to UniLink! Start by adding the sections you teach.') : t('Welcome to UniLink! Start by joining your classes.')),
      onSuccess: (r) => {
        // A reset by email needs no code to keep.
        if (!resetByCode && !resetByLink) showRecoveryCode(r.recoveryCode);
        if (r.needsConfirming) setConfirming({ email: r.user.email, code: r.confirmCode });
      },
    },
  );
  const year = new Date().getFullYear();
  const professor = form.values.role === 'professor';
  const studentsOnly = useVariant('students-only');
  const noProfessors = useVariant('no-professor-features');

  return (
    <AuthCard
      title={t('Create your account')}
      subtitle={professor ? t('Teach your sections on UniLink: run the grading scheme, post assignments and moderate the discussion.') : t('UniLink is for McGill students. Use your McGill email.')}
    >
      <Modal opened={confirming != null} onClose={() => setConfirming(null)} title="Confirm your email">
        {confirming && <ConfirmEmail email={confirming.email} demoCode={confirming.code} />}
      </Modal>
      <form onSubmit={form.onSubmit((v) => signUp.mutate(v))}>
        <Stack>
          {!studentsOnly && !noProfessors && <WithInfo id="signup-role" block>
            <SegmentedControl
              data={[
                { value: 'student', label: t('Student') },
                { value: 'professor', label: t('Professor') },
              ]}
              aria-label={t('I am a')}
              {...form.getInputProps('role')}
            />
          </WithInfo>}
          <Group grow align="flex-start">
            <TextInput label={<WithInfo id="signup-name">{displayName ? 'The name you go by' : t('Full name')}</WithInfo>} required {...form.getInputProps('name')} />
            {!hideExtras && (
            <Autocomplete label={<WithInfo id="signup-pronouns">{t('Pronouns')}</WithInfo>} placeholder={t('Optional')} data={[...PRONOUNS]} {...form.getInputProps('pronouns')} />
            )}
          </Group>
          <TextInput label={<WithInfo id="signup-email">{anyUniversity ? 'School email' : t('McGill email')}</WithInfo>} placeholder={professor ? t('jane.doe@mcgill.ca') : t('first.last@mail.mcgill.ca')} required {...form.getInputProps('email')} />
          {!hideExtras && (
          <Group grow align="flex-start">
            <Select label={<WithInfo id="signup-faculty">{t('Faculty')}</WithInfo>} required searchable data={FACULTIES.map((f) => ({ value: f, label: t(f) }))} {...form.getInputProps('faculty')} />
            {!professor && (
              <Select
                label={<WithInfo id="signup-grad">{t('Expected graduation')}</WithInfo>}
                placeholder="—"
                clearable
                data={Array.from({ length: 7 }, (_, i) => String(year + i))}
                {...form.getInputProps('gradYear')}
              />
            )}
          </Group>
          )}
          <Text size="xs" c="dimmed" mt={-6}>
            {professor
              ? t('Students in your sections see your name, email, pronouns and faculty.')
              : versionA
                ? 'Classmates see your name and email once you post, reply or join a study session.'
                : listMembers
                  ? 'Classmates in your sections see your name, email, pronouns and faculty, unless you leave yourself off class lists.'
                  : t('Classmates see your name, email, pronouns and faculty once you post or reply in a class.')}{' '}
            <ReqInfo id="signup-visibility" />
          </Text>
          <div>
            <PasswordInput visibilityToggleButtonProps={{ 'aria-label': t('Show or hide the password') }} label={<WithInfo id="signup-password">{t('Password')}</WithInfo>} required mb={6} {...form.getInputProps('password')} />
            <PasswordChecklist password={form.values.password} email={form.values.email} />
          </div>
          {!noConfirm && <PasswordInput visibilityToggleButtonProps={{ 'aria-label': t('Show or hide the password') }} label={<WithInfo id="signup-confirm">{t('Confirm password')}</WithInfo>} required {...form.getInputProps('confirm')} />}
          <WithInfo id="signin-create" block>
            <Button type="submit" loading={signUp.isPending}>
              {t('Create account')}
            </Button>
          </WithInfo>
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

// 'reset-by-email-code' and 'reset-by-email-link': the demo shows what the email would say.
function EmailReset({ byLink }: { byLink: boolean }) {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [email, setEmail] = useState(params.get('email') ?? '');
  const [typedCode, setSecret] = useState('');
  const secret = params.get('token') ?? typedCode;
  const [password, setPassword] = useState('');
  const [sent, setSent] = useState(false);
  const [demo, setDemo] = useState<string | null>(null);
  const request = useAction(() => rpc.auth.requestReset({ email }), {
    onSuccess: (r) => {
      setSent(true);
      setDemo(r.secret);
    },
  });
  const reset = useAction(() => rpc.auth.resetWithEmail({ email, secret, password }), {
    success: 'Password updated. Sign in with your new password.',
    onSuccess: () => navigate('/'),
  });
  const hasLink = byLink && !!params.get('token');
  return (
    <AuthCard title={t('Reset your password')} subtitle={byLink ? 'We’ll email you a link.' : 'We’ll email you a 6-digit code that works for 15 minutes.'}>
      <Stack>
        {!hasLink && <TextInput label={<WithInfo id="reset-form">{t('McGill email')}</WithInfo>} value={email} onChange={(e) => setEmail(e.currentTarget.value)} />}
        {!hasLink && (
          <Button variant={sent ? 'default' : 'filled'} disabled={!email.trim()} loading={request.isPending} onClick={() => request.mutate()}>
            {sent ? 'Send another' : byLink ? 'Email me a link' : 'Email me a code'}
          </Button>
        )}
        {sent && !hasLink && <Text size="sm">If that email has an account, the message is on its way.</Text>}
        {demo && !hasLink && (
          <Alert variant="light" icon={<IconInfoCircle />} title="Demo: there's no real mail">
            {byLink ? (
              <Anchor component={Link} to={`/reset?email=${encodeURIComponent(email)}&token=${demo}`} size="sm">
                Open the link from the email
              </Anchor>
            ) : (
              <>
                The email says your code is <Code>{demo}</Code>
              </>
            )}
          </Alert>
        )}
        {!byLink && sent && <TextInput label="Code" value={secret} onChange={(e) => setSecret(e.currentTarget.value)} />}
        {(hasLink || (!byLink && sent)) && (
          <div>
            <PasswordInput label={t('New password')} value={password} onChange={(e) => setPassword(e.currentTarget.value)} />
            <PasswordChecklist password={password} email={email} />
          </div>
        )}
        <Group justify="space-between">
          <Anchor component={Link} to="/" size="sm">
            {t('Back to sign in')}
          </Anchor>
          {(hasLink || (!byLink && sent)) && (
            <Button disabled={!secret.trim() || !password} loading={reset.isPending} onClick={() => reset.mutate()}>
              {t('Set new password')}
            </Button>
          )}
        </Group>
      </Stack>
    </AuthCard>
  );
}

export function ResetPassword() {
  const byCode = useVariant('reset-by-email-code');
  const byLink = useVariant('reset-by-email-link');
  return byCode || byLink ? <EmailReset byLink={byLink} /> : <RecoveryReset />;
}

function RecoveryReset() {
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
            <TextInput label={<WithInfo id="reset-form">{t('McGill email')}</WithInfo>} required {...form.getInputProps('email')} />
            <TextInput label={<WithInfo id="recovery-code">{t('Recovery code')}</WithInfo>} placeholder="XXXX-XXXX-XXXX" required {...form.getInputProps('recoveryCode')} />
            <div>
              <PasswordInput visibilityToggleButtonProps={{ 'aria-label': t('Show or hide the password') }} label={<WithInfo id="signup-password">{t('New password')}</WithInfo>} required mb={6} {...form.getInputProps('password')} />
              <PasswordChecklist password={form.values.password} email={form.values.email} />
            </div>
            <Group justify="space-between">
              <Anchor component={Link} to="/" size="sm">
                {t('Back to sign in')}
              </Anchor>
              <WithInfo id="reset-form">
                <Button type="submit" loading={reset.isPending}>
                  {t('Set new password')}
                </Button>
              </WithInfo>
            </Group>
            <Text size="xs" c="dimmed">
              {t("Lost your recovery code too? There's no email reset in this version of UniLink. In the demo you can sign up again with another address.")} <ReqInfo id="recovery-code" />
            </Text>
          </Stack>
        </form>
      )}
    </AuthCard>
  );
}
