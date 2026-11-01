import { useEffect, useState } from 'react';
import { ActionIcon, Button, Grid, Group, Select, Stack, Text, Textarea, TextInput } from '@mantine/core';
import { TimeInput } from '@mantine/dates';
import { useForm } from '@mantine/form';
import { modals } from '@mantine/modals';
import { IconPlus, IconTrash } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { WEEKDAYS } from '@shared/dates';
import { Loading, SectionCard } from '../../components/ui';
import { plural } from '../../lib/format';
import { useAction } from '../../lib/hooks';
import { type Out, rpc } from '../../lib/rpc';

type Info = Out<typeof rpc.courses.info>;
type Meeting = { weekday: number; startTime: string; endTime: string; location: string };

const WEEKDAY_OPTIONS = WEEKDAYS.map((label, i) => ({ value: String(i), label })).slice(1).concat({ value: '0', label: 'Sunday' });

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
    <SectionCard title="Course details" actions={<Text size="xs" c="dimmed">Only you see these</Text>}>
      <form onSubmit={form.onSubmit((v) => save.mutate(v))}>
        <Stack>
          <Group grow>
            <TextInput label="Professor" placeholder="Prof. Jane Doe" {...form.getInputProps('professor')} />
            <TextInput label="Professor email" placeholder="jane.doe@mcgill.ca" {...form.getInputProps('professorEmail')} />
          </Group>
          <Group grow>
            <TextInput label="Office hours" placeholder="Tue 14:00–15:30, McConnell 110N" {...form.getInputProps('officeHours')} />
            <TextInput label="Lecture location" placeholder="Leacock 132" {...form.getInputProps('location')} />
          </Group>
          <Textarea label="Notes" autosize minRows={2} placeholder="Syllabus highlights, TA names…" {...form.getInputProps('notes')} />
          <Group justify="flex-end">
            <Button type="submit" disabled={!form.isDirty()} loading={save.isPending}>
              Save details
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
      title="Class times"
      actions={
        <Button
          size="xs"
          variant="light"
          leftSection={<IconPlus size={14} />}
          onClick={() => setRows((r) => [...r, { weekday: 1, startTime: '10:00', endTime: '11:30', location: '' }])}
        >
          Add time
        </Button>
      }
    >
      <Stack gap="xs">
        {rows.length === 0 && (
          <Text size="sm" c="dimmed">
            Add your weekly lectures, tutorials and labs to see them on your calendar.
          </Text>
        )}
        {rows.map((m, i) => (
          <Group key={i} gap="xs" wrap="nowrap" align="flex-end">
            <Select
              data={WEEKDAY_OPTIONS}
              value={String(m.weekday)}
              onChange={(v) => v && update(i, { weekday: Number(v) })}
              w={130}
              allowDeselect={false}
              aria-label="Day"
            />
            <TimeInput value={m.startTime} onChange={(e) => update(i, { startTime: e.currentTarget.value })} aria-label="Start" w={110} />
            <Text c="dimmed">–</Text>
            <TimeInput value={m.endTime} onChange={(e) => update(i, { endTime: e.currentTarget.value })} aria-label="End" w={110} />
            <TextInput
              placeholder="Location"
              value={m.location}
              onChange={(e) => update(i, { location: e.currentTarget.value })}
              style={{ flex: 1 }}
              aria-label="Location"
            />
            <ActionIcon variant="subtle" color="red" onClick={() => setRows((r) => r.filter((_, j) => j !== i))} aria-label="Remove" mb={4}>
              <IconTrash size={16} />
            </ActionIcon>
          </Group>
        ))}
        {(dirty || rows.length > 0) && (
          <Group justify="flex-end" mt="xs">
            <Button onClick={() => save.mutate()} disabled={!dirty} loading={save.isPending}>
              Save class times
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
    success: `Left ${cls.subject} ${cls.number}`,
    onSuccess: () => navigate('/classes'),
  });

  const confirmLeave = () =>
    modals.openConfirmModal({
      title: `Leave ${cls.subject} ${cls.number}?`,
      children: (
        <Text size="sm">
          You'll stop seeing its group chats, sessions and discussion. Any sessions you're hosting are cancelled. Your
          own notes, class times and grades are kept in case you rejoin.
        </Text>
      ),
      labels: { confirm: 'Leave class', cancel: 'Stay' },
      confirmProps: { color: 'red' },
      onConfirm: () => leave.mutate(),
    });

  return (
    <SectionCard title="Your classmates">
      <Text size="sm" mb="xs">
        {plural(cls.memberCount, 'student')} from {cls.subject} {cls.number} are on UniLink.
      </Text>
      <Text size="sm" c="dimmed" mb="lg">
        To keep things private, you won't see a member list. Classmates' names and emails appear once they post on
        the discussion board or join a study session.
      </Text>
      <Button variant="light" color="red" onClick={confirmLeave}>
        Leave class
      </Button>
    </SectionCard>
  );
}
