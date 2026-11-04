import { useLocalStorage } from '@mantine/hooks';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import {
  Box,
  Button,
  Card,
  FileInput,
  Group,
  SegmentedControl,
  SimpleGrid,
  Stack,
  Tabs,
  Text,
  ThemeIcon,
  Title,
  UnstyledButton,
  useMantineColorScheme,
  TextInput,
} from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { modals } from '@mantine/modals';
import { IconCheck, IconLogout } from '@tabler/icons-react';
import { useNavigate, useParams } from 'react-router';
import { GOAT_LABELS, GOAT_OPTIONS, type GoatConfig, type GoatPart, goatFor } from '@shared/goat';
import { GoatSvg } from '../components/Goat';
import { SectionCard } from '../components/ui';
import { useAction, useMe } from '../lib/hooks';
import { rpc } from '../lib/rpc';
import { useForcedLocale, useVariant } from '../lib/variants';
import { IntegrationsPanel } from './Integrations';
import { ChangePassword, DeleteAccount, NotificationSettings, PrivacyPanel, ProfileForm } from './Profile';
import { StudyTimeForm } from './Planner';
import { LanguageSwitch } from '../components/LanguageSwitch';
import { t, tx } from '../lib/i18n';
import { ReqInfo, WithInfo } from '../components/ReqInfo';

const TABS = [
  { value: 'general', label: tx('General'), info: 'settings-general' },
  { value: 'account', label: tx('Account'), info: 'settings-account' },
  { value: 'goat', label: tx('Goat'), info: 'settings-goat' },
  { value: 'privacy', label: tx('Privacy'), info: 'settings-privacy' },
  { value: 'notifications', label: tx('Notifications'), info: 'settings-notifications' },
  { value: 'integrations', label: tx('Integrations'), info: 'settings-integrations' },
] as const;

// Settings in the layout of the wireframe (A2Team.pdf p. 11): sections on the left.
// 'separate-profile-page': who you are, apart from how the app behaves.
export function ProfilePage() {
  return (
    <Stack gap="lg">
      <Title order={1} fz={34}>
        {t('Profile')} <ReqInfo id="nav-settings" />
      </Title>
      <ProfileForm />
      <GoatEditor />
      <ChangePassword />
      <DeleteAccount />
    </Stack>
  );
}

// 'photo-avatar': your own photo, kept in this browser.
function PhotoPicker() {
  const me = useMe();
  const [, setPhoto] = useLocalStorage<string | null>({ key: `unilink-photo-${me.id}`, defaultValue: null });
  return (
    <FileInput
      mb="md"
      w={280}
      accept="image/png,image/jpeg,image/webp"
      label={<WithInfo id="settings-goat">Your photo</WithInfo>}
      placeholder="Pick a picture"
      onChange={(file) => {
        if (!file) return setPhoto(null);
        const reader = new FileReader();
        reader.onload = () => setPhoto(String(reader.result));
        reader.readAsDataURL(file);
      }}
    />
  );
}

export function SettingsPage() {
  const secondFactor = useVariant('second-factor');
  const ownProfile = useVariant('separate-profile-page');
  const params = useParams();
  const navigate = useNavigate();
  const tab = TABS.some((tabItem) => tabItem.value === params.tab) ? params.tab! : 'general';
  const me = useMe();
  const signOut = useAction(() => rpc.auth.signOut());
  // Phones: the sections become a row of tabs above the content (sign out stays in the account menu).
  const narrow = useMediaQuery('(max-width: 48em)');

  return (
    <Tabs value={tab} onChange={(v) => navigate(`/settings/${v}`)} orientation={narrow ? 'horizontal' : 'vertical'} variant="pills" radius="lg" keepMounted={false}>
      <Box
        w={narrow ? undefined : 240}
        pr={narrow ? 0 : 'lg'}
        mr={narrow ? 0 : 'lg'}
        mb={narrow ? 'lg' : 0}
        style={narrow ? undefined : { borderRight: '2px solid var(--ul-rule)', minHeight: 'calc(100vh - 140px)' }}
      >
        <Title order={1} fz={34} mb="lg">
          {t('Settings')} <ReqInfo id="nav-settings" />
        </Title>
        <Tabs.List>
          {TABS.filter((tabItem) => !ownProfile || (tabItem.value !== 'account' && tabItem.value !== 'goat')).map((tabItem) => (
            <Tabs.Tab key={tabItem.value} value={tabItem.value} fz="md" fw={700} py="sm" rightSection={<ReqInfo id={tabItem.info} />}>
              {t(tabItem.label)}
            </Tabs.Tab>
          ))}
        </Tabs.List>
        {!narrow && (
          <Box mt="xl">
            <WithInfo id="sign-out">
              <Button variant="subtle" color="gray" leftSection={<IconLogout size={16} />} onClick={() => signOut.mutate()}>
                {t('Sign out')}
              </Button>
            </WithInfo>
          </Box>
        )}
      </Box>

      <Box style={{ flex: 1, minWidth: 0 }}>
        <Title order={2} mb="md">
          {t(TABS.find((tabItem) => tabItem.value === tab)!.label)}
        </Title>
        <Tabs.Panel value="general">
          <GeneralPanel />
        </Tabs.Panel>
        <Tabs.Panel value="account">
          <Stack gap="lg" maw={760}>
            {secondFactor && <TwoStepCard />}
            <ProfileForm />
            {me.role === 'student' && (
              <SectionCard info="free-time" title={t('Free study time')}>
                <StudyTimeForm />
              </SectionCard>
            )}
            <ChangePassword />
            <DeleteAccount />
          </Stack>
        </Tabs.Panel>
        <Tabs.Panel value="goat">
          <GoatEditor />
        </Tabs.Panel>
        <Tabs.Panel value="privacy">
          <Box maw={760}>
            <PrivacyPanel />
          </Box>
        </Tabs.Panel>
        <Tabs.Panel value="notifications">
          <Box maw={760}>
            <NotificationSettings />
          </Box>
        </Tabs.Panel>
        <Tabs.Panel value="integrations">
          <IntegrationsPanel />
        </Tabs.Panel>
      </Box>
    </Tabs>
  );
}

// 'second-factor': turning on the authenticator code for sign-in.
function TwoStepCard() {
  const status = useQuery({ queryKey: ['profile', 'totp'], queryFn: () => rpc.profile.totpStatus() });
  const [setup, setSetup] = useState<{ secret: string; link: string } | null>(null);
  const [code, setCode] = useState('');
  const start = useAction(() => rpc.profile.startTotp(), { onSuccess: setSetup });
  const confirm = useAction(() => rpc.profile.confirmTotp({ code }), {
    success: () => 'Authenticator code is on',
    onSuccess: () => {
      setSetup(null);
      setCode('');
    },
  });
  const remove = useAction(() => rpc.profile.removeTotp(), { success: () => 'Authenticator code is off' });
  return (
    <SectionCard info="signup-password" title="Authenticator app">
      {status.data?.on ? (
        <Group justify="space-between">
          <Text size="sm">Signing in also asks for a code from your app.</Text>
          <Button variant="default" onClick={() => remove.mutate()}>
            Turn off
          </Button>
        </Group>
      ) : setup ? (
        <Stack gap="xs">
          <Text size="sm">
            Add this key to your authenticator app: <b style={{ wordBreak: 'break-all' }}>{setup.secret}</b>
          </Text>
          <Group align="flex-end" gap="xs">
            <TextInput label="Code from the app" value={code} onChange={(e) => setCode(e.currentTarget.value)} />
            <Button disabled={!code.trim()} loading={confirm.isPending} onClick={() => confirm.mutate()}>
              Turn on
            </Button>
          </Group>
        </Stack>
      ) : (
        <Button variant="default" onClick={() => start.mutate()} loading={start.isPending}>
          Set up an authenticator app
        </Button>
      )}
    </SectionCard>
  );
}

function GeneralPanel() {
  const { colorScheme, setColorScheme } = useMantineColorScheme();
  const forcedLocale = useForcedLocale();
  const inMenu = useVariant('settings-in-account-menu');
  const lightOnly = useVariant('light-only');
  const ownReset = useVariant('reset-own-data');
  const resetMine = useAction(() => rpc.profile.resetMine(), { success: () => 'Your data was reset' });
  const confirmReset = () =>
    modals.openConfirmModal({
      title: 'Reset your data?',
      children: <Text size="sm">Your classes, plans, marks and to-dos are deleted. You keep your account, and your posts stay up with no name on them. Other accounts in this browser aren&apos;t touched.</Text>,
      labels: { confirm: t('Reset'), cancel: t('Keep') },
      confirmProps: { color: 'red' },
      onConfirm: () => resetMine.mutate(),
    });
  return (
    <Stack gap="lg" maw={760}>
      {!inMenu && !forcedLocale && <SectionCard info="language" title={t('Language')}>
        <Text size="sm" c="dimmed" mb="sm">
          {t('Used for the whole app, your notifications and emails.')}
        </Text>
        <LanguageSwitch signedIn />
      </SectionCard>}
      {!inMenu && !lightOnly && <SectionCard info="appearance" title={t('Appearance')}>
        <SegmentedControl
          value={colorScheme}
          onChange={(v) => setColorScheme(v as 'light' | 'dark' | 'auto')}
          data={[
            { value: 'light', label: t('Light') },
            { value: 'dark', label: t('Dark') },
            { value: 'auto', label: t('Match system') },
          ]}
        />
      </SectionCard>}
      {ownReset && (
        <SectionCard info="demo-reset" title="Reset my data">
          <Button variant="light" color="red" onClick={confirmReset}>
            Reset my data
          </Button>
        </SectionCard>
      )}
      <SectionCard info="about" title={t('About UniLink')}>
        <Text size="sm" c="dimmed">
          {t("UniLink brings McGill students' classes, classmates, deadlines, grades and study planning into one place. Built by the pls.sleep(NOW) team.")}
        </Text>
      </SectionCard>
    </Stack>
  );
}

const PART_TABS: { part: GoatPart; label: string }[] = [
  { part: 'hat', label: tx('Hat') },
  { part: 'eyes', label: tx('Eyes') },
  { part: 'horns', label: tx('Horns') },
  { part: 'fur', label: tx('Fur') },
  { part: 'background', label: tx('Background') },
];

const optionLabel = (option: string) => t(GOAT_LABELS[option] ?? option[0].toUpperCase() + option.slice(1));

// The goat dress-up screen from the wireframe: preview on top, part tabs, option tiles.
// 'goat-random': one of each part, out of what's unlocked.
const randomGoat = (limit: number | null) =>
  Object.fromEntries(
    (Object.keys(GOAT_OPTIONS) as GoatPart[]).map((part) => {
      const options = GOAT_OPTIONS[part] as readonly string[];
      const pool = limit ? options.slice(0, limit) : options;
      return [part, pool[Math.floor(Math.random() * pool.length)]];
    }),
  ) as unknown as GoatConfig;

function GoatEditor() {
  const unlocks = useVariant('goat-unlocks');
  const canRandomize = useVariant('goat-random');
  const hasPhoto = useVariant('photo-avatar');
  const activity = useQuery({ queryKey: ['profile', 'activity'], queryFn: () => rpc.profile.activity(), enabled: unlocks });
  const unlocked = 2 + Math.floor((activity.data?.count ?? 0) / 3);
  const me = useMe();
  const goat = goatFor(me.id, me.avatar);
  const [part, setPart] = useState<GoatPart>('hat');
  const save = useAction((next: GoatConfig) => rpc.profile.setAvatar(next));

  // Show the pending choice right away instead of waiting for the save.
  const shown = save.isPending && save.variables ? save.variables : goat;

  return (
    <Stack align="center" gap="lg">
      <Box w={300} h={300} style={{ border: '3px solid var(--ul-rule)', borderRadius: 24, overflow: 'hidden' }}>
        <GoatSvg goat={shown} />
      </Box>
      <Text c="dimmed" size="sm">
        {t('Your goat shows up next to your posts, replies and study sessions.')} <ReqInfo id="settings-goat" />
      </Text>
      {canRandomize && (
        <Button variant="default" onClick={() => save.mutate(randomGoat(unlocks ? unlocked : null))}>
          Random goat
        </Button>
      )}

      <Box w="100%" maw={760}>
        <Group gap={0} grow>
          {PART_TABS.map((tabItem) => (
            <UnstyledButton
              key={tabItem.part}
              onClick={() => setPart(tabItem.part)}
              py="sm"
              ta="center"
              style={{
                borderTopLeftRadius: 999,
                borderTopRightRadius: 999,
                border: '2px solid var(--ul-rule)',
                borderBottom: 'none',
                marginRight: -2,
                background: part === tabItem.part ? 'var(--ul-soft)' : 'transparent',
              }}
            >
              <Text fw={700} className="display" fz="lg">
                {t(tabItem.label)}
              </Text>
            </UnstyledButton>
          ))}
        </Group>
        {hasPhoto && <PhotoPicker />}
        <Card radius={0} padding="lg" style={{ border: '2px solid var(--ul-rule)', borderTop: '2px dashed var(--ul-border)' }}>
          <Group justify="flex-end" mb="xs">
            <ReqInfo id="goat-parts" />
          </Group>
          <SimpleGrid cols={{ base: 3, sm: 4, md: 6 }} spacing="md">
            {(GOAT_OPTIONS[part] as readonly string[]).map((option, optionIndex) => {
              const locked = unlocks && optionIndex >= unlocked;
              const preview = { ...shown, [part]: option } as GoatConfig;
              const selected = shown[part] === option;
              return (
                <UnstyledButton
                  key={option}
                  onClick={() => !locked && save.mutate(preview)}
                  disabled={locked}
                  title={locked ? `Post or reply ${optionIndex * 3 - (activity.data?.count ?? 0)} more times to unlock` : undefined}
                  aria-pressed={selected}
                  aria-label={`${t(PART_TABS.find((tabItem) => tabItem.part === part)!.label)}: ${optionLabel(option)}`}
                  style={{ position: 'relative', opacity: locked ? 0.3 : 1 }}
                >
                  <Box
                    style={{
                      aspectRatio: '1',
                      borderRadius: 12,
                      overflow: 'hidden',
                      border: selected ? '3px solid var(--mantine-color-teal-6)' : '1.5px solid var(--ul-border)',
                      background: 'var(--ul-soft)',
                    }}
                  >
                    <GoatSvg goat={preview} background={part === 'background'} />
                  </Box>
                  {selected && (
                    <ThemeIcon size={24} radius="xl" color="teal" style={{ position: 'absolute', top: -8, right: -8 }}>
                      <IconCheck size={16} />
                    </ThemeIcon>
                  )}
                  <Text size="xs" ta="center" fw={700} mt={4}>
                    {optionLabel(option)}
                  </Text>
                </UnstyledButton>
              );
            })}
          </SimpleGrid>
        </Card>
      </Box>
    </Stack>
  );
}
