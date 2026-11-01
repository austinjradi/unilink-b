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
import { IconCheck, IconLogout } from '@tabler/icons-react';
import { useNavigate, useParams } from 'react-router';
import { GOAT_LABELS, GOAT_OPTIONS, type GoatConfig, type GoatPart, goatFor } from '@shared/goat';
import { GoatSvg } from '../components/Goat';
import { SectionCard } from '../components/ui';
import { useAction, useMe } from '../lib/hooks';
import { rpc } from '../lib/rpc';
import { IntegrationsPanel } from './Integrations';
import { ChangePassword, DeleteAccount, NotificationSettings, PrivacyPanel, ProfileForm } from './Profile';
import { StudyModePanel } from './StudyMode';

const TABS = [
  { value: 'general', label: 'General' },
  { value: 'account', label: 'Account' },
  { value: 'goat', label: 'Goat' },
  { value: 'privacy', label: 'Privacy' },
  { value: 'notifications', label: 'Notifications' },
  { value: 'study-mode', label: 'Study mode' },
  { value: 'integrations', label: 'Integrations' },
] as const;

// Settings in the layout of the wireframe (A2Team.pdf p. 11): sections on the left.
export function SettingsPage() {
  const params = useParams();
  const navigate = useNavigate();
  const tab = TABS.some((t) => t.value === params.tab) ? params.tab! : 'general';
  const signOut = useAction(() => rpc.auth.signOut());

  return (
    <Tabs value={tab} onChange={(v) => navigate(`/settings/${v}`)} orientation="vertical" variant="pills" radius="lg" keepMounted={false}>
      <Box w={220} pr="lg" mr="lg" style={{ borderRight: '2px solid var(--ul-ink)', minHeight: 'calc(100vh - 140px)' }}>
        <Title order={1} fz={34} mb="lg">
          Settings
        </Title>
        <Tabs.List>
          {TABS.map((t) => (
            <Tabs.Tab key={t.value} value={t.value} fz="md" fw={700} py="sm">
              {t.label}
            </Tabs.Tab>
          ))}
        </Tabs.List>
        <Button mt="xl" variant="subtle" color="gray" leftSection={<IconLogout size={16} />} onClick={() => signOut.mutate()}>
          Sign out
        </Button>
      </Box>

      <Box style={{ flex: 1, minWidth: 0 }}>
        <Title order={2} mb="md">
          {TABS.find((t) => t.value === tab)!.label}
        </Title>
        <Tabs.Panel value="general">
          <GeneralPanel />
        </Tabs.Panel>
        <Tabs.Panel value="account">
          <Stack gap="lg" maw={760}>
            <ProfileForm />
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
        <Tabs.Panel value="study-mode">
          <StudyModePanel />
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
      <SectionCard title="Appearance">
        <SegmentedControl
          value={colorScheme}
          onChange={(v) => setColorScheme(v as 'light' | 'dark' | 'auto')}
          data={[
            { value: 'light', label: 'Light' },
            { value: 'dark', label: 'Dark' },
            { value: 'auto', label: 'Match system' },
          ]}
        />
      </SectionCard>
      <SectionCard title="About UniLink">
        <Text size="sm" c="dimmed">
          UniLink brings McGill students' classes, classmates, deadlines, grades and study planning into one place. Built
          by the pls.sleep(NOW) team.
        </Text>
      </SectionCard>
    </Stack>
  );
}

const PART_TABS: { part: GoatPart; label: string }[] = [
  { part: 'hat', label: 'Hat' },
  { part: 'eyes', label: 'Eyes' },
  { part: 'horns', label: 'Horns' },
  { part: 'fur', label: 'Fur' },
  { part: 'background', label: 'Background' },
];

const optionLabel = (option: string) => GOAT_LABELS[option] ?? option[0].toUpperCase() + option.slice(1);

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
      <Box w={300} h={300} style={{ border: '3px solid var(--ul-ink)', borderRadius: 24, overflow: 'hidden' }}>
        <GoatSvg goat={shown} />
      </Box>
      <Text c="dimmed" size="sm">
        Your goat shows up next to your posts, replies and study sessions.
      </Text>

      <Box w="100%" maw={760}>
        <Group gap={0} grow>
          {PART_TABS.map((t) => (
            <UnstyledButton
              key={t.part}
              onClick={() => setPart(t.part)}
              py="sm"
              ta="center"
              style={{
                borderTopLeftRadius: 999,
                borderTopRightRadius: 999,
                border: '2px solid var(--ul-ink)',
                borderBottom: 'none',
                marginRight: -2,
                background: part === t.part ? 'var(--ul-soft)' : 'transparent',
              }}
            >
              <Text fw={700} className="display" fz="lg">
                {t.label}
              </Text>
            </UnstyledButton>
          ))}
        </Group>
        <Card radius={0} padding="lg" style={{ border: '2px solid var(--ul-ink)', borderTop: '2px dashed var(--ul-border)' }}>
          <SimpleGrid cols={{ base: 3, sm: 4, md: 6 }} spacing="md">
            {(GOAT_OPTIONS[part] as readonly string[]).map((option) => {
              const preview = { ...shown, [part]: option } as GoatConfig;
              const selected = shown[part] === option;
              return (
                <UnstyledButton
                  key={option}
                  onClick={() => save.mutate(preview)}
                  aria-pressed={selected}
                  aria-label={`${PART_TABS.find((t) => t.part === part)!.label}: ${optionLabel(option)}`}
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
