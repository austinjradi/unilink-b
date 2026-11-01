import { useEffect, useState } from 'react';
import { ActionIcon, Button, Grid, Group, Select, Stack, Text, Textarea, TextInput } from '@mantine/core';
import { TimeInput } from '@mantine/dates';
import { useForm } from '@mantine/form';
import { modals } from '@mantine/modals';
import { IconPlus, IconTrash } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import dayjs from 'dayjs';
import { Loading, SectionCard } from '../../components/ui';
import { useAction } from '../../lib/hooks';
import { type Out, rpc } from '../../lib/rpc';
import { t } from '../../lib/i18n';

type Info = Out<typeof rpc.courses.info>;
type Meeting = { weekday: number; startTime: string; endTime: string; location: string };

// Monday first, in the current language.
const weekdayOptions = () =>
  [1, 2, 3, 4, 5, 6, 0].map((i) => {
    const name = dayjs().day(i).format('dddd');
    return { value: String(i), label: name[0].toUpperCase() + name.slice(1) };
  });

// A5 course details + A3 class times + S1 leave.
export function Overview({ classId, cls }: { classId: number; cls: Out<typeof rpc.classes.get> }) {
  const info = useQuery({ queryKey: ['courses', 'info', classId], queryFn: () => rpc.courses.info({ classId }) });
  if (info.isPending || !info.data) return <Loading />;
  return (
    <Grid gap="lg">
      <Grid.Col span={{ base: 12, lg: 7 }}>
        <Stack gap="lg">
          <CourseDetails classId={classId} info={info.data} />
          <ClassTimes classId={classId} initial={info.data.meetings} />
        </Stack>
      </Grid.Col>
      <Grid.Col span={{ base: 12, lg: 5 }}>
        <MembershipCard cls={cls} />
      </Grid.Col>
    </Grid>
  );
}

function CourseDetails({ classId, info }: { classId: number; info: Info }) {
  const form = useForm({
    initialValues: {
      professor: info.professor,
      professorEmail: info.professorEmail,
      officeHours: info.officeHours,
      location: info.location,
      notes: info.notes,
    },
  });
  const save = useAction((v: typeof form.values) => rpc.courses.saveInfo({ classId, ...v }), {
    success: 'Course details saved',
    onSuccess: (_d, v) => form.resetDirty(v),
  });

  return (
    <SectionCard title={t('Course details')} actions={<Text size="xs" c="dimmed">{t('Only you see these')}</Text>}>
      <form onSubmit={form.onSubmit((v) => save.mutate(v))}>
        <Stack>
          <Group grow>
            <TextInput label={t('Professor')} placeholder={t('Prof. Jane Doe')} {...form.getInputProps('professor')} />
            <TextInput label={t('Professor email')} placeholder={t('jane.doe@mcgill.ca')} {...form.getInputProps('professorEmail')} />
          </Group>
          <Group grow>
            <TextInput label={t('Office hours')} placeholder={t('Tue 14:00–15:30, McConnell 110N')} {...form.getInputProps('officeHours')} />
            <TextInput label={t('Lecture location')} placeholder={t('Leacock 132')} {...form.getInputProps('location')} />
          </Group>
          <Textarea label={t('Notes')} autosize minRows={2} placeholder={t('Syllabus highlights, TA names…')} {...form.getInputProps('notes')} />
          <Group justify="flex-end">
            <Button type="submit" disabled={!form.isDirty()} loading={save.isPending}>
              {t('Save details')}
            </Button>
          </Group>
        </Stack>
      </form>
    </SectionCard>
  );
}

function ClassTimes({ classId, initial }: { classId: number; initial: Meeting[] }) {
  const strip = (ms: Meeting[]) => ms.map(({ weekday, startTime, endTime, location }) => ({ weekday, startTime, endTime, location }));
  const [rows, setRows] = useState<Meeting[]>(strip(initial));
  useEffect(() => setRows(strip(initial)), [initial]);
  const dirty = JSON.stringify(rows) !== JSON.stringify(strip(initial));

  const save = useAction(() => rpc.courses.saveMeetings({ classId, meetings: rows }), {
    success: 'Class times saved. They now show on your calendar.',
  });
  const update = (i: number, patch: Partial<Meeting>) => setRows((r) => r.map((m, j) => (j === i ? { ...m, ...patch } : m)));

  return (
    <SectionCard
      title={t('Class times')}
      actions={
        <Button
          size="xs"
          variant="light"
          leftSection={<IconPlus size={14} />}
          onClick={() => setRows((r) => [...r, { weekday: 1, startTime: '10:00', endTime: '11:30', location: '' }])}
        >
          {t('Add time')}
        </Button>
      }
    >
      <Stack gap="xs">
        {rows.length === 0 && (
          <Text size="sm" c="dimmed">
            {t('Add your weekly lectures, tutorials and labs to see them on your calendar.')}
          </Text>
        )}
        {rows.map((m, i) => (
          <Group key={i} gap="xs" wrap="nowrap" align="flex-end">
            <Select
              data={weekdayOptions()}
              value={String(m.weekday)}
              onChange={(v) => v && update(i, { weekday: Number(v) })}
              w={130}
              allowDeselect={false}
              aria-label={t('Day')}
            />
            <TimeInput value={m.startTime} onChange={(e) => update(i, { startTime: e.currentTarget.value })} aria-label={t('Start')} w={110} />
            <Text c="dimmed">–</Text>
            <TimeInput value={m.endTime} onChange={(e) => update(i, { endTime: e.currentTarget.value })} aria-label={t('End')} w={110} />
            <TextInput
              placeholder={t('Location')}
              value={m.location}
              onChange={(e) => update(i, { location: e.currentTarget.value })}
              style={{ flex: 1 }}
              aria-label={t('Location')}
            />
            <ActionIcon variant="subtle" color="red" onClick={() => setRows((r) => r.filter((_, j) => j !== i))} aria-label={t('Remove')} mb={4}>
              <IconTrash size={16} />
            </ActionIcon>
          </Group>
        ))}
        {(dirty || rows.length > 0) && (
          <Group justify="flex-end" mt="xs">
            <Button onClick={() => save.mutate()} disabled={!dirty} loading={save.isPending}>
              {t('Save class times')}
            </Button>
          </Group>
        )}
      </Stack>
    </SectionCard>
  );
}

function MembershipCard({ cls }: { cls: Out<typeof rpc.classes.get> }) {
  const navigate = useNavigate();
  const leave = useAction(() => rpc.classes.leave({ classId: cls.id }), {
    success: t('Left {{code}}', { code: `${cls.subject} ${cls.number}` }),
    onSuccess: () => navigate('/classes'),
  });

  const confirmLeave = () =>
    modals.openConfirmModal({
      title: t('Leave {{code}}?', { code: `${cls.subject} ${cls.number}` }),
      children: (
        <Text size="sm">
          {t("You'll stop seeing its group chats, sessions and discussion. Any sessions you're hosting are cancelled. Your own notes, class times and grades are kept in case you rejoin.")}
        </Text>
      ),
      labels: { confirm: t('Leave class'), cancel: t('Stay') },
      confirmProps: { color: 'red' },
      onConfirm: () => leave.mutate(),
    });

  return (
    <SectionCard title={t('Your classmates')}>
      <Text size="sm" mb="xs">
        {t('{{count}} students from {{code}} are on UniLink.', { count: cls.memberCount, code: `${cls.subject} ${cls.number}` })}
      </Text>
      <Text size="sm" c="dimmed" mb="lg">
        {t("To keep things private, you won't see a member list. Classmates' names and emails appear once they post on the discussion board or join a study session.")}
      </Text>
      <Button variant="light" color="red" onClick={confirmLeave}>
        {t('Leave class')}
      </Button>
    </SectionCard>
  );
}
