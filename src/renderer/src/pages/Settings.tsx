import { useState } from 'react';
import {
  Box,
  Button,
  Card,
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
} from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { IconCheck, IconLogout } from '@tabler/icons-react';
import { useNavigate, useParams } from 'react-router';
import { GOAT_LABELS, GOAT_OPTIONS, type GoatConfig, type GoatPart, goatFor } from '@shared/goat';
import { GoatSvg } from '../components/Goat';
import { SectionCard } from '../components/ui';
import { useAction, useMe } from '../lib/hooks';
import { rpc } from '../lib/rpc';
import { IntegrationsPanel } from './Integrations';
import { ChangePassword, DeleteAccount, NotificationSettings, PrivacyPanel, ProfileForm } from './Profile';
import { StudyTimeForm } from './Planner';
import { LanguageSwitch } from '../components/LanguageSwitch';
import { t, tx } from '../lib/i18n';

const TABS = [
  { value: 'general', label: tx('General') },
  { value: 'account', label: tx('Account') },
  { value: 'goat', label: tx('Goat') },
  { value: 'privacy', label: tx('Privacy') },
  { value: 'notifications', label: tx('Notifications') },
  { value: 'integrations', label: tx('Integrations') },
] as const;

// Settings in the layout of the wireframe (A2Team.pdf p. 11): sections on the left.
export function SettingsPage() {
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
        w={narrow ? undefined : 220}
        pr={narrow ? 0 : 'lg'}
        mr={narrow ? 0 : 'lg'}
        mb={narrow ? 'lg' : 0}
        style={narrow ? undefined : { borderRight: '2px solid var(--ul-rule)', minHeight: 'calc(100vh - 140px)' }}
      >
        <Title order={1} fz={34} mb="lg">
          {t('Settings')}
        </Title>
        <Tabs.List>
          {TABS.map((tabItem) => (
            <Tabs.Tab key={tabItem.value} value={tabItem.value} fz="md" fw={700} py="sm">
              {t(tabItem.label)}
            </Tabs.Tab>
          ))}
        </Tabs.List>
        {!narrow && (
          <Button mt="xl" variant="subtle" color="gray" leftSection={<IconLogout size={16} />} onClick={() => signOut.mutate()}>
            {t('Sign out')}
          </Button>
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
            <ProfileForm />
            {me.role === 'student' && (
              <SectionCard title={t('Free study time')}>
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

function GeneralPanel() {
  const { colorScheme, setColorScheme } = useMantineColorScheme();
  return (
    <Stack gap="lg" maw={760}>
      <SectionCard title={t('Language')}>
        <Text size="sm" c="dimmed" mb="sm">
          {t('Used for the whole app, your notifications and emails.')}
        </Text>
        <LanguageSwitch signedIn />
      </SectionCard>
      <SectionCard title={t('Appearance')}>
        <SegmentedControl
          value={colorScheme}
          onChange={(v) => setColorScheme(v as 'light' | 'dark' | 'auto')}
          data={[
            { value: 'light', label: t('Light') },
            { value: 'dark', label: t('Dark') },
            { value: 'auto', label: t('Match system') },
          ]}
        />
      </SectionCard>
      <SectionCard title={t('About UniLink')}>
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
function GoatEditor() {
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
        {t('Your goat shows up next to your posts, replies and study sessions.')}
      </Text>

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
        <Card radius={0} padding="lg" style={{ border: '2px solid var(--ul-rule)', borderTop: '2px dashed var(--ul-border)' }}>
          <SimpleGrid cols={{ base: 3, sm: 4, md: 6 }} spacing="md">
            {(GOAT_OPTIONS[part] as readonly string[]).map((option) => {
              const preview = { ...shown, [part]: option } as GoatConfig;
              const selected = shown[part] === option;
              return (
                <UnstyledButton
                  key={option}
                  onClick={() => save.mutate(preview)}
                  aria-pressed={selected}
                  aria-label={`${t(PART_TABS.find((tabItem) => tabItem.part === part)!.label)}: ${optionLabel(option)}`}
                  style={{ position: 'relative' }}
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
