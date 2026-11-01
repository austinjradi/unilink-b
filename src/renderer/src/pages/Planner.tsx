import { useState } from 'react';
import {
  Accordion,
  ActionIcon,
  Alert,
  Anchor,
  Badge,
  Button,
  Card,
  Checkbox,
  Group,
  Menu,
  Modal,
  NumberInput,
  Progress,
  SegmentedControl,
  Stack,
  Text,
  Textarea,
  TextInput,
  Tooltip,
} from '@mantine/core';
import { DateInput, DateTimePicker } from '@mantine/dates';
import { useForm } from '@mantine/form';
import { modals } from '@mantine/modals';
import {
  IconAlertTriangle,
  IconChecklist,
  IconDots,
  IconPaperclip,
  IconPencil,
  IconPin,
  IconPlus,
  IconRefresh,
  IconTrash,
} from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { Link } from 'react-router';
import { addDays, ymd } from '@shared/dates';
import { Empty, Loading, PageHeader } from '../components/ui';
import { dayLabel, fmtDateTime, fromNow, plural, toDate } from '../lib/format';
import { useAction, useMe } from '../lib/hooks';
import { type Out, rpc } from '../lib/rpc';
import { ClassSelect } from './Calendar';

type Assignment = Out<typeof rpc.planner.list>[number];
type Task = Assignment['tasks'][number];

// ST2: assignments split into tasks and spread over the days before they're due.
export function PlannerPage() {
  const me = useMe();
  const list = useQuery({ queryKey: ['planner', 'list'], queryFn: () => rpc.planner.list() });
  const [editing, setEditing] = useState<Assignment | 'new' | null>(null);

  const active = list.data?.filter((a) => !a.pastDue && a.doneCount < a.tasks.length) ?? [];
  const finished = list.data?.filter((a) => a.pastDue || a.doneCount === a.tasks.length) ?? [];

  return (
    <>
      <PageHeader
        title="Assignment planner"
        subtitle={
          <>
            Work is spread across the days before each deadline, within your {me.studyMinutesPerDay} minutes of study
            time a day (<Anchor component={Link} to="/profile" size="sm">change</Anchor>). Missed tasks move forward
            automatically.
          </>
        }
        actions={
          <Button leftSection={<IconPlus size={16} />} onClick={() => setEditing('new')}>
            New assignment
          </Button>
        }
      />

      {list.isPending ? (
        <Loading />
      ) : !list.data?.length ? (
        <Card withBorder>
          <Empty icon={<IconChecklist size={22} />}>
            Add an assignment, split it into tasks (e.g. one per problem), and UniLink will schedule them before the
            deadline with a spare day as a buffer.
          </Empty>
        </Card>
      ) : (
        <Stack gap="md">
          {active.map((a) => (
            <AssignmentCard key={a.id} assignment={a} onEdit={() => setEditing(a)} />
          ))}
          {finished.length > 0 && (
            <Accordion variant="contained">
              <Accordion.Item value="finished">
                <Accordion.Control>Finished or past due ({finished.length})</Accordion.Control>
                <Accordion.Panel>
                  <Stack gap="md">
                    {finished.map((a) => (
                      <AssignmentCard key={a.id} assignment={a} onEdit={() => setEditing(a)} />
                    ))}
                  </Stack>
                </Accordion.Panel>
              </Accordion.Item>
            </Accordion>
          )}
        </Stack>
      )}

      <Modal opened={editing != null} onClose={() => setEditing(null)} title={editing === 'new' ? 'New assignment' : 'Edit assignment'} size="lg">
        {editing === 'new' && <NewAssignmentForm onDone={() => setEditing(null)} />}
        {editing && editing !== 'new' && <EditAssignmentForm assignment={editing} onDone={() => setEditing(null)} />}
      </Modal>
    </>
  );
}

function AssignmentCard({ assignment: a, onEdit }: { assignment: Assignment; onEdit: () => void }) {
  const today = ymd(new Date());
  const [adding, setAdding] = useState('');
  const replan = useAction(() => rpc.planner.replan({ assignmentId: a.id }), { success: 'Plan rebuilt from today' });
  const remove = useAction(() => rpc.planner.remove({ assignmentId: a.id }), { success: 'Assignment deleted' });
  const open = useAction(() => rpc.planner.openAttachment({ assignmentId: a.id }));
  const addTask = useAction(() => rpc.planner.addTask({ assignmentId: a.id, title: adding, minutes: 60 }), {
    onSuccess: () => setAdding(''),
  });

  const days = [...new Set(a.tasks.map((t) => t.scheduledFor))].sort();
  const confirmDelete = () =>
    modals.openConfirmModal({
      title: `Delete "${a.title}"?`,
      children: <Text size="sm">Its tasks and attachment are deleted too.</Text>,
      labels: { confirm: 'Delete', cancel: 'Keep' },
      confirmProps: { color: 'red' },
      onConfirm: () => remove.mutate(),
    });

  return (
    <Card withBorder padding="lg">
      <Group justify="space-between" align="flex-start" mb="sm">
        <div>
          <Group gap="xs">
            <Text fw={700} size="lg">
              {a.title}
            </Text>
            {a.classLabel && <Badge variant="light">{a.classLabel}</Badge>}
          </Group>
          <Text size="sm" c={a.pastDue ? 'red' : 'dimmed'}>
            Due {fmtDateTime(a.dueAt)} ({fromNow(a.dueAt)}) · {plural(a.bufferDays, 'buffer day')}
          </Text>
        </div>
        <Group gap="xs">
          {a.attachmentName && (
            <Button size="xs" variant="default" leftSection={<IconPaperclip size={14} />} onClick={() => open.mutate()}>
              {a.attachmentName}
            </Button>
          )}
          <Menu position="bottom-end">
            <Menu.Target>
              <ActionIcon variant="subtle" aria-label="Assignment options">
                <IconDots size={18} />
              </ActionIcon>
            </Menu.Target>
            <Menu.Dropdown>
              <Menu.Item leftSection={<IconPencil size={14} />} onClick={onEdit}>
                Edit details and due date
              </Menu.Item>
              <Menu.Item leftSection={<IconRefresh size={14} />} onClick={() => replan.mutate()}>
                Re-plan from scratch
              </Menu.Item>
              <Menu.Item leftSection={<IconTrash size={14} />} color="red" onClick={confirmDelete}>
                Delete
              </Menu.Item>
            </Menu.Dropdown>
          </Menu>
        </Group>
      </Group>

      <Group gap="xs" mb="md">
        <Progress value={a.tasks.length ? (a.doneCount / a.tasks.length) * 100 : 0} style={{ flex: 1 }} color="teal" />
        <Text size="xs" c="dimmed">
          {a.doneCount}/{a.tasks.length} done
        </Text>
      </Group>

      {!a.pastDue && (a.tight || a.overloaded) && (
        <Alert color="yellow" variant="light" icon={<IconAlertTriangle size={18} />} mb="md" p="xs">
          <Text size="sm">
            {a.tight && 'Some work lands on your buffer day before the deadline. '}
            {a.overloaded && 'Some days have more work than your daily study time. Consider starting early or moving tasks.'}
          </Text>
        </Alert>
      )}

      <Stack gap="sm">
        {days.map((day) => (
          <div key={day}>
            <Text size="xs" fw={700} tt="uppercase" c={day < today ? 'red' : day === today ? 'indigo' : 'dimmed'} mb={4}>
              {dayLabel(day, today)}
            </Text>
            <Stack gap={4}>
              {a.tasks
                .filter((t) => t.scheduledFor === day)
                .map((t) => (
                  <TaskRow key={t.id} task={t} dueDay={ymd(a.dueAt)} />
                ))}
            </Stack>
          </div>
        ))}
      </Stack>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (adding.trim()) addTask.mutate();
        }}
      >
        <Group mt="md" gap="xs">
          <TextInput size="xs" placeholder="Add a task…" value={adding} onChange={(e) => setAdding(e.currentTarget.value)} style={{ flex: 1 }} />
          <Button size="xs" variant="light" type="submit" disabled={!adding.trim()} loading={addTask.isPending}>
            Add
          </Button>
        </Group>
      </form>
    </Card>
  );
}

function TaskRow({ task: t, dueDay }: { task: Task; dueDay: string }) {
  const setDone = useAction((done: boolean) => rpc.planner.setDone({ taskId: t.id, done }));
  const move = useAction((day: string) => rpc.planner.moveTask({ taskId: t.id, day }), { success: 'Task moved. It will stay on that day.' });
  const remove = useAction(() => rpc.planner.removeTask({ taskId: t.id }));

  return (
    <Group gap="sm" wrap="nowrap" pl="xs">
      <Checkbox checked={!!t.doneAt} onChange={(e) => setDone.mutate(e.currentTarget.checked)} aria-label="Done" />
      <Text size="sm" style={{ flex: 1 }} td={t.doneAt ? 'line-through' : undefined} c={t.doneAt ? 'dimmed' : undefined}>
        {t.title}
      </Text>
      {t.pinned && (
        <Tooltip label="You placed this task by hand, so re-plans leave it here">
          <IconPin size={14} color="var(--mantine-color-dimmed)" />
        </Tooltip>
      )}
      <Badge size="sm" variant="default">
        {t.minutes} min
      </Badge>
      <DateInput
        size="xs"
        w={120}
        value={t.scheduledFor}
        onChange={(v) => v && move.mutate(ymd(toDate(v)!))}
        valueFormat="ddd D MMM"
        maxDate={dueDay}
        aria-label="Move to day"
        disabled={!!t.doneAt}
      />
      <ActionIcon variant="subtle" color="red" size="sm" onClick={() => remove.mutate()} aria-label="Delete task">
        <IconTrash size={14} />
      </ActionIcon>
    </Group>
  );
}

type TaskDraft = { title: string; minutes: number };

function NewAssignmentForm({ onDone }: { onDone: () => void }) {
  const [attachment, setAttachment] = useState<{ path: string; name: string } | null>(null);
  const form = useForm({
    initialValues: {
      title: '',
      classId: null as number | null,
      dueAt: dayjs().add(4, 'day').hour(23).minute(59).second(0).toDate() as Date | string | null,
      bufferDays: 1,
      notes: '',
      mode: 'parts' as 'parts' | 'custom',
      parts: 3,
      partLabel: 'Problem',
      partMinutes: 60,
      custom: [{ title: '', minutes: 60 }] as TaskDraft[],
    },
    validate: {
      title: (v) => (v.trim() ? null : 'Name the assignment'),
      dueAt: (v) => (toDate(v) && toDate(v)! > new Date() ? null : 'Pick a due date in the future'),
    },
  });
  const v = form.values;
  const tasks: TaskDraft[] =
    v.mode === 'parts'
      ? Array.from({ length: Math.max(1, v.parts) }, (_, i) => ({ title: `${v.partLabel.trim() || 'Part'} ${i + 1}`, minutes: v.partMinutes }))
      : v.custom.filter((t) => t.title.trim());

  const choose = useAction(() => rpc.planner.chooseAttachment(), { onSuccess: (file) => file && setAttachment(file) });
  const create = useAction(
    () =>
      rpc.planner.create({
        title: v.title,
        classId: v.classId,
        dueAt: toDate(v.dueAt)!,
        bufferDays: v.bufferDays,
        notes: v.notes,
        tasks,
        attachmentPath: attachment?.path ?? null,
      }),
    { success: `Planned ${plural(tasks.length, 'task')} before the deadline`, onSuccess: onDone },
  );

  const due = toDate(v.dueAt);
  const workDays = due ? Math.max(0, dayjs(addDays(ymd(due), -v.bufferDays)).diff(dayjs(ymd(new Date())), 'day') + 1) : 0;

  return (
    <form onSubmit={form.onSubmit(() => create.mutate())}>
      <Stack>
        <TextInput label="Assignment" placeholder="Problem set 3" data-autofocus {...form.getInputProps('title')} />
        <Group grow align="flex-start">
          <ClassSelect value={v.classId} onChange={(id) => form.setFieldValue('classId', id)} />
          <DateTimePicker label="Due" valueFormat="ddd D MMM YYYY, HH:mm" minDate={new Date()} {...form.getInputProps('dueAt')} />
        </Group>
        <NumberInput
          label="Buffer days"
          description="Days kept free right before the deadline"
          min={0}
          max={7}
          w={220}
          {...form.getInputProps('bufferDays')}
        />

        <div>
          <Text size="sm" fw={500} mb={6}>
            How should it be split?
          </Text>
          <SegmentedControl
            data={[
              { value: 'parts', label: 'Equal parts' },
              { value: 'custom', label: 'My own tasks' },
            ]}
            {...form.getInputProps('mode')}
            mb="sm"
          />
          {v.mode === 'parts' ? (
            <Group grow>
              <NumberInput label="Number of parts" min={1} max={50} {...form.getInputProps('parts')} />
              <TextInput label="Each part is a…" {...form.getInputProps('partLabel')} />
              <NumberInput label="Minutes each" min={5} max={600} step={15} {...form.getInputProps('partMinutes')} />
            </Group>
          ) : (
            <Stack gap="xs">
              {v.custom.map((_, i) => (
                <Group key={i} gap="xs" wrap="nowrap">
                  <TextInput placeholder={`Task ${i + 1}`} style={{ flex: 1 }} {...form.getInputProps(`custom.${i}.title`)} />
                  <NumberInput w={110} suffix=" min" min={5} max={600} step={15} {...form.getInputProps(`custom.${i}.minutes`)} />
                  <ActionIcon variant="subtle" color="red" onClick={() => form.removeListItem('custom', i)} disabled={v.custom.length === 1} aria-label="Remove task">
                    <IconTrash size={16} />
                  </ActionIcon>
                </Group>
              ))}
              <Button size="xs" variant="subtle" leftSection={<IconPlus size={14} />} onClick={() => form.insertListItem('custom', { title: '', minutes: 60 })} w="fit-content">
                Add task
              </Button>
            </Stack>
          )}
          <Text size="xs" c="dimmed" mt="xs">
            {plural(tasks.length, 'task')} over {plural(workDays, 'working day')} before the deadline
            {workDays > 0 && tasks.length > 0 && `: about ${Math.ceil(tasks.length / workDays)} per day`}.
          </Text>
        </div>

        <Group gap="xs">
          <Button variant="default" size="xs" leftSection={<IconPaperclip size={14} />} onClick={() => choose.mutate()}>
            {attachment ? 'Change file' : 'Attach the assignment file'}
          </Button>
          {attachment && (
            <Text size="sm" c="dimmed">
              {attachment.name}
            </Text>
          )}
        </Group>
        <Textarea label="Notes" autosize minRows={2} {...form.getInputProps('notes')} />
        <Group justify="flex-end">
          <Button type="submit" loading={create.isPending} disabled={!tasks.length}>
            Plan it
          </Button>
        </Group>
      </Stack>
    </form>
  );
}

function EditAssignmentForm({ assignment: a, onDone }: { assignment: Assignment; onDone: () => void }) {
  const form = useForm({
    initialValues: {
      title: a.title,
      classId: a.classId,
      dueAt: a.dueAt as Date | string | null,
      bufferDays: a.bufferDays,
      notes: a.notes,
    },
    validate: { title: (v) => (v.trim() ? null : 'Name the assignment'), dueAt: (v) => (v ? null : 'Pick a due date') },
  });
  const save = useAction(
    (v: typeof form.values) => rpc.planner.update({ assignmentId: a.id, ...v, dueAt: toDate(v.dueAt)! }),
    { success: 'Saved. The remaining tasks were re-planned if the due date changed.', onSuccess: onDone },
  );

  return (
    <form onSubmit={form.onSubmit((v) => save.mutate(v))}>
      <Stack>
        <TextInput label="Assignment" {...form.getInputProps('title')} />
        <Group grow align="flex-start">
          <ClassSelect value={form.values.classId} onChange={(id) => form.setFieldValue('classId', id)} />
          <DateTimePicker label="Due" valueFormat="ddd D MMM YYYY, HH:mm" {...form.getInputProps('dueAt')} />
        </Group>
        <NumberInput label="Buffer days" min={0} max={7} w={220} {...form.getInputProps('bufferDays')} />
        <Textarea label="Notes" autosize minRows={2} {...form.getInputProps('notes')} />
        <Group justify="flex-end">
          <Button type="submit" loading={save.isPending}>
            Save
          </Button>
        </Group>
      </Stack>
    </form>
  );
}
