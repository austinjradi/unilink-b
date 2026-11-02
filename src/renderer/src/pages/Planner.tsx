import { useEffect, useState } from 'react';
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
  Select,
  SimpleGrid,
  Stack,
  Text,
  Textarea,
  TextInput,
  Tooltip,
} from '@mantine/core';
import { DateInput, DatePickerInput, DateTimePicker } from '@mantine/dates';
import { useForm } from '@mantine/form';
import { modals } from '@mantine/modals';
import {
  IconAlertTriangle,
  IconChecklist,
  IconDots,
  IconLink,
  IconListNumbers,
  IconPaperclip,
  IconPencil,
  IconPin,
  IconPlus,
  IconRefresh,
  IconTrash,
} from '@tabler/icons-react';
import { useMutation, useQuery } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { useSearchParams } from 'react-router';
import { type AssignmentPart, minutesForParts } from '@shared/assignment';
import { addDays, ymd } from '@shared/dates';
import { DEFAULT_BUFFER_DAYS, weeklyMinutes } from '@shared/planner';
import { Empty, Loading, PageHeader } from '../components/ui';
import { dayLabel, fmtDateTime, fromNow, toDate } from '../lib/format';
import { FocusButton } from '../components/FocusTask';
import { useAction, useMe } from '../lib/hooks';
import { type Out, rpc } from '../lib/rpc';
import { ClassSelect } from './Calendar';
import { t } from '../lib/i18n';

type Assignment = Out<typeof rpc.planner.list>[number];
type Task = Assignment['tasks'][number];

// ST2: assignments split into tasks and scheduled as early as free study time allows.
export function PlannerPage() {
  const me = useMe();
  const list = useQuery({ queryKey: ['planner', 'list'], queryFn: () => rpc.planner.list() });
  // "Add event/assignment" on the calendar links here with ?new=1, and "Plan it" on a
  // deadline adds &from=<the deadline's calendar key>.
  const [params, setParams] = useSearchParams();
  const [editing, setEditing] = useState<Assignment | 'new' | null>(params.get('new') ? 'new' : null);
  const [from] = useState(params.get('from'));
  const [editingTime, setEditingTime] = useState(false);
  const close = () => {
    setEditing(null);
    if (params.get('new')) setParams({}, { replace: true });
  };

  const active = list.data?.filter((a) => !a.pastDue && a.doneCount < a.tasks.length) ?? [];
  const finished = list.data?.filter((a) => a.pastDue || a.doneCount === a.tasks.length) ?? [];

  return (
    <>
      <PageHeader
        title={t('Assignment planner')}
        subtitle={
          <>
            {t('Tasks are scheduled as early as your free study time allows ({{hours}} h a week), so you finish ahead of each deadline', {
              hours: Math.round(weeklyMinutes(me.weeklyStudyMinutes).reduce((a, b) => a + b, 0) / 6) / 10,
            })}{' '}
            (
            <Anchor component="button" type="button" size="sm" onClick={() => setEditingTime(true)}>
              {t('change')}
            </Anchor>
            ). {t('Missed tasks move to your next free time automatically.')}
          </>
        }
        actions={
          <Button leftSection={<IconPlus size={16} />} onClick={() => setEditing('new')}>
            {t('New assignment')}
          </Button>
        }
      />

      {list.isPending ? (
        <Loading />
      ) : !list.data?.length ? (
        <Card withBorder>
          <Empty icon={<IconChecklist size={22} />}>
            {t('Add an assignment, split it into tasks (e.g. one per problem), and UniLink will schedule them as soon as you have free time, keeping two spare days before the deadline.')}
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
                <Accordion.Control>{t('Finished or past due ({{count}})', { count: finished.length })}</Accordion.Control>
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

      <Modal opened={editing != null} onClose={close} title={editing === 'new' ? t('New assignment') : t('Edit assignment')} size="lg">
        {editing === 'new' && <NewAssignmentForm onDone={close} from={from} />}
        {editing && editing !== 'new' && <EditAssignmentForm assignment={editing} onDone={close} />}
      </Modal>
      <Modal opened={editingTime} onClose={() => setEditingTime(false)} title={t('Your free study time')}>
        {editingTime && <StudyTimeForm onDone={() => setEditingTime(false)} />}
      </Modal>
    </>
  );
}

// ST2 "free time": minutes the planner may use on each weekday, Monday first on screen.
export function StudyTimeForm({ onDone }: { onDone?: () => void }) {
  const me = useMe();
  const [minutes, setMinutes] = useState(weeklyMinutes(me.weeklyStudyMinutes));
  const [daysOff, setDaysOff] = useState<string[]>(me.daysOff ?? []);
  const save = useAction(
    async () => {
      await rpc.planner.setAvailability({ minutes });
      await rpc.planner.setDaysOff({ days: daysOff });
    },
    {
      success: 'Free time saved. Your plans were updated.',
      onSuccess: () => onDone?.(),
    },
  );
  const total = minutes.reduce((a, b) => a + b, 0);
  return (
    <Stack>
      <Text size="sm" c="dimmed">
        {t('Minutes you can study on each day of the week. Study sessions you join count toward them.')}
      </Text>
      <SimpleGrid cols={{ base: 4, xs: 7 }} spacing="xs">
        {[1, 2, 3, 4, 5, 6, 0].map((day) => (
          <NumberInput
            key={day}
            label={dayjs().day(day).format('ddd')}
            min={0}
            max={960}
            step={30}
            hideControls
            value={minutes[day]}
            onChange={(v) => setMinutes((m) => m.map((x, i) => (i === day ? Number(v) || 0 : x)))}
          />
        ))}
      </SimpleGrid>
      <DatePickerInput
        type="multiple"
        label={t('Days off')}
        description={t('Days you won’t study at all, like a trip. Plans move around them.')}
        placeholder={t('Pick days')}
        valueFormat="D MMM"
        minDate={new Date()}
        clearable
        value={daysOff}
        onChange={(days) => setDaysOff(days.map((day) => day.slice(0, 10)))}
      />
      <Group justify="space-between">
        <Text size="sm">{t('{{hours}} h a week', { hours: Math.round(total / 6) / 10 })}</Text>
        <Button onClick={() => save.mutate()} loading={save.isPending}>
          {t('Save free time')}
        </Button>
      </Group>
    </Stack>
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

  const days = [...new Set(a.tasks.map((task) => task.scheduledFor))].sort();
  const confirmDelete = () =>
    modals.openConfirmModal({
      title: t('Delete "{{title}}"?', { title: a.title }),
      children: <Text size="sm">{t('Its tasks and attachment are deleted too.')}</Text>,
      labels: { confirm: t('Delete'), cancel: t('Keep') },
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
            {(a.deadlineId != null || a.assessmentId != null) && (
              <Tooltip label={t("Follows the section's due date: if a classmate moves it, this plan moves too.")} multiline w={260}>
                <Badge variant="outline" color="gray" leftSection={<IconLink size={12} />}>
                  {t('Follows the class deadline')}
                </Badge>
              </Tooltip>
            )}
          </Group>
          <Text size="sm" c={a.pastDue ? 'red' : 'dimmed'}>
            {t('Due {{when}} ({{relative}})', { when: fmtDateTime(a.dueAt), relative: fromNow(a.dueAt) })} ·{' '}
            {t('{{count}} buffer days', { count: a.bufferDays })}
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
              <ActionIcon variant="subtle" aria-label={t('Assignment options')}>
                <IconDots size={18} />
              </ActionIcon>
            </Menu.Target>
            <Menu.Dropdown>
              <Menu.Item leftSection={<IconPencil size={14} />} onClick={onEdit}>
                {t('Edit details and due date')}
              </Menu.Item>
              <Menu.Item leftSection={<IconRefresh size={14} />} onClick={() => replan.mutate()}>
                {t('Re-plan from scratch')}
              </Menu.Item>
              <Menu.Item leftSection={<IconTrash size={14} />} color="red" onClick={confirmDelete}>
                {t('Delete')}
              </Menu.Item>
            </Menu.Dropdown>
          </Menu>
        </Group>
      </Group>

      <Group gap="xs" mb="md">
        <Progress value={a.tasks.length ? (a.doneCount / a.tasks.length) * 100 : 0} style={{ flex: 1 }} color="teal" />
        <Text size="xs" c="dimmed">
          {t('{{done}}/{{total}} done', { done: a.doneCount, total: a.tasks.length })}
        </Text>
      </Group>

      {!a.pastDue && (a.tight || a.overloaded) && (
        <Alert color="yellow" variant="light" icon={<IconAlertTriangle size={18} />} mb="md" p="xs">
          <Text size="sm">
            {a.tight && `${t('Some work lands on your buffer day before the deadline.')} `}
            {a.overloaded && t('Some days have more work than your free study time. Add free time or move tasks.')}
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
                .filter((task) => task.scheduledFor === day)
                .map((task) => (
                  <TaskRow key={task.id} task={task} dueDay={ymd(a.dueAt)} />
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
          <TextInput size="xs" placeholder={t('Add a task…')} aria-label={t('Add a task…')} value={adding} onChange={(e) => setAdding(e.currentTarget.value)} style={{ flex: 1 }} />
          <Button size="xs" variant="light" type="submit" disabled={!adding.trim()} loading={addTask.isPending}>
            {t('Add')}
          </Button>
        </Group>
      </form>
    </Card>
  );
}

function TaskRow({ task, dueDay }: { task: Task; dueDay: string }) {
  const setDone = useAction((done: boolean) => rpc.planner.setDone({ taskId: task.id, done }));
  const move = useAction((day: string) => rpc.planner.moveTask({ taskId: task.id, day }), { success: 'Task moved. It will stay on that day.' });
  const remove = useAction(() => rpc.planner.removeTask({ taskId: task.id }));

  return (
    // On narrow screens the minutes, day and delete wrap under the task instead of squeezing it.
    <Group gap="sm" pl="xs" style={{ rowGap: 4 }}>
      <Checkbox checked={!!task.doneAt} onChange={(e) => setDone.mutate(e.currentTarget.checked)} aria-label={t('Done')} />
      <Text size="sm" style={{ flex: '1 1 160px' }} td={task.doneAt ? 'line-through' : undefined} c={task.doneAt ? 'dimmed' : undefined}>
        {task.title}
      </Text>
      {task.pinned && (
        <Tooltip label={t('You placed this task by hand, so re-plans leave it here')}>
          <IconPin size={14} color="var(--mantine-color-dimmed)" />
        </Tooltip>
      )}
      <Badge size="sm" variant="default">
        {task.minutes} min
      </Badge>
      <DateInput
        size="xs"
        w={120}
        value={task.scheduledFor}
        onChange={(v) => v && move.mutate(ymd(toDate(v)!))}
        valueFormat="ddd D MMM"
        maxDate={dueDay}
        aria-label={t('Move to day')}
        disabled={!!task.doneAt}
      />
      {!task.doneAt && <FocusButton taskId={task.id} title={task.title} />}
      <ActionIcon variant="subtle" color="red" size="sm" onClick={() => remove.mutate()} aria-label={t('Delete task')}>
        <IconTrash size={14} />
      </ActionIcon>
    </Group>
  );
}

type TaskDraft = { title: string; minutes: number };

function NewAssignmentForm({ onDone, from }: { onDone: () => void; from: string | null }) {
  const [attachment, setAttachment] = useState<{ path: string; name: string } | null>(null);
  const form = useForm({
    initialValues: {
      title: '',
      classId: null as number | null,
      dueAt: dayjs().add(4, 'day').hour(23).minute(59).second(0).toDate() as Date | string | null,
      bufferDays: DEFAULT_BUFFER_DAYS,
      notes: '',
      mode: 'parts' as 'parts' | 'custom',
      parts: 3,
      partLabel: t('Problem'),
      partMinutes: 60,
      custom: [{ title: '', minutes: 60 }] as TaskDraft[],
    },
    validate: {
      title: (v) => (v.trim() ? null : t('Name the assignment')),
      dueAt: (v) => (toDate(v) && toDate(v)! > new Date() ? null : t('Pick a due date in the future')),
    },
  });
  const v = form.values;
  const tasks: TaskDraft[] =
    v.mode === 'parts'
      ? Array.from({ length: Math.max(1, v.parts) }, (_, i) => ({ title: `${v.partLabel.trim() || t('Part')} ${i + 1}`, minutes: v.partMinutes }))
      : v.custom.filter((task) => task.title.trim());

  // Most assignments are already on the calendar (a class deadline or a graded item), so
  // the form can start from one of them.
  const upcoming = useQuery({ queryKey: ['calendar', 'upcoming', 60], queryFn: () => rpc.calendar.upcoming({ days: 60 }) });
  // Not the term's key dates (add/drop, withdrawal): there's nothing to plan for those.
  const sources = (upcoming.data ?? []).filter((e) => e.detail !== 'planner' && e.detail !== 'key');
  // A plan started from a class deadline or graded item keeps following its due date,
  // unless the student picks a different date here.
  const [follows, setFollows] = useState<{ deadlineId: number | null; assessmentId: number | null; due: Date } | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const startFrom = (key: string | null) => {
    setPicked(key);
    const source = sources.find((e) => e.key === key);
    const assessmentId = source?.key.startsWith('assessment-') ? Number(source.key.slice('assessment-'.length)) : null;
    setFollows(source && (source.deadlineId != null || assessmentId != null) ? { deadlineId: source.deadlineId, assessmentId, due: source.start } : null);
    if (!source) return;
    form.setValues({
      title: source.detail === 'graded' ? source.title.replace(/ \([\d.]+%\)$/, '') : source.title,
      classId: source.classId,
      dueAt: source.start,
    });
    // An assignment the professor posted brings its handout, and the problems in it.
    if (source.deadlineId == null) return;
    rpc.assignments.handout({ deadlineId: source.deadlineId }).then((file) => {
      if (!file) return;
      setAttachment(file);
      setFound(null);
      read.mutate(file.path);
    });
  };

  // Opened from a deadline's "Plan it": start from that deadline once the list is in.
  const fromReady = from != null && sources.some((e) => e.key === from);
  useEffect(() => {
    if (fromReady) startFrom(from);
  }, [fromReady]);

  // Problems found in the attached file, offered as tasks until the student uses or dismisses them.
  const [found, setFound] = useState<AssignmentPart[] | null>(null);
  const read = useMutation({ mutationFn: (path: string) => rpc.planner.readParts({ path }), onSuccess: setFound });
  const choose = useAction(() => rpc.planner.chooseAttachment(), {
    onSuccess: (file) => {
      if (!file) return;
      setAttachment(file);
      setFound(null);
      read.mutate(file.path);
    },
  });
  const applyFound = (parts: AssignmentPart[]) => {
    const minutes = minutesForParts(parts, v.partMinutes);
    form.setValues({ mode: 'custom', custom: parts.map((p, i) => ({ title: p.title, minutes: minutes[i] })) });
    setFound(null);
  };
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
        ...(follows && toDate(v.dueAt)?.getTime() === follows.due.getTime()
          ? { deadlineId: follows.deadlineId, assessmentId: follows.assessmentId }
          : { deadlineId: null, assessmentId: null }),
      }),
    { success: t('Planned {{count}} tasks before the deadline', { count: tasks.length }), onSuccess: onDone },
  );

  const due = toDate(v.dueAt);
  const workDays = due ? Math.max(0, dayjs(addDays(ymd(due), -v.bufferDays)).diff(dayjs(ymd(new Date())), 'day') + 1) : 0;

  return (
    <form onSubmit={form.onSubmit(() => create.mutate())}>
      <Stack>
        {sources.length > 0 && (
          <Select
            label={t('Start from a deadline')}
            description={t('Fills in the name, class and due date')}
            placeholder={t('Optional')}
            searchable
            clearable
            data={sources.map((e) => ({ value: e.key, label: [e.title, e.classLabel, dayjs(e.start).format(t('ddd, MMM D'))].filter(Boolean).join(' · ') }))}
            value={picked}
            onChange={startFrom}
          />
        )}
        <TextInput label={t('Assignment')} placeholder={t('Problem set 3')} data-autofocus {...form.getInputProps('title')} />
        <Group grow align="flex-start">
          <ClassSelect value={v.classId} onChange={(id) => form.setFieldValue('classId', id)} />
          <DateTimePicker label={t('Due')} valueFormat="ddd D MMM YYYY, HH:mm" minDate={new Date()} {...form.getInputProps('dueAt')} />
        </Group>
        <NumberInput
          label={t('Buffer days')}
          description={t('Days kept free right before the deadline')}
          min={0}
          max={7}
          w={220}
          {...form.getInputProps('bufferDays')}
        />

        <div>
          <Group gap="xs">
            <Button variant="default" size="xs" leftSection={<IconPaperclip size={14} />} onClick={() => choose.mutate()}>
              {attachment ? t('Change file') : t('Attach the assignment file')}
            </Button>
            {attachment && (
              <Text size="sm" c="dimmed">
                {attachment.name}
              </Text>
            )}
          </Group>
          {read.isPending && (
            <Text size="xs" c="dimmed" mt={6}>
              {t('Looking for problems in the file…')}
            </Text>
          )}
          {found?.length === 0 && (
            <Text size="xs" c="dimmed" mt={6}>
              {t('No numbered questions or problems in this file. Split it below.')}
            </Text>
          )}
          {read.data === null && (
            <Text size="xs" c="dimmed" mt={6}>
              {t('UniLink can find the problems in PDF, Word and text files. Split this one below.')}
            </Text>
          )}
          {found && found.length > 0 && (
            <Alert color="teal" variant="light" icon={<IconListNumbers size={18} />} mt="xs" p="xs" title={t('Found {{count}} problems in the file', { count: found.length })}>
              <Text size="sm" lineClamp={3}>
                {found.map((p) => (p.points ? `${p.title} (${t('{{count}} pts', { count: p.points })})` : p.title)).join(' · ')}
              </Text>
              <Group gap="xs" mt="xs">
                <Button size="xs" onClick={() => applyFound(found)}>
                  {t('Use them as tasks')}
                </Button>
                <Button size="xs" variant="subtle" color="gray" onClick={() => setFound(null)}>
                  {t('Dismiss')}
                </Button>
              </Group>
            </Alert>
          )}
        </div>

        <div>
          <Text size="sm" fw={500} mb={6}>
            {t('How should it be split?')}
          </Text>
          <SegmentedControl
            data={[
              { value: 'parts', label: t('Equal parts') },
              { value: 'custom', label: t('My own tasks') },
            ]}
            {...form.getInputProps('mode')}
            mb="sm"
          />
          {v.mode === 'parts' ? (
            <Group grow>
              <NumberInput label={t('Number of parts')} min={1} max={50} {...form.getInputProps('parts')} />
              <TextInput label={t('Each part is a…')} {...form.getInputProps('partLabel')} />
              <NumberInput label={t('Minutes each')} min={5} max={600} step={15} {...form.getInputProps('partMinutes')} />
            </Group>
          ) : (
            <Stack gap="xs">
              {v.custom.map((_, i) => (
                <Group key={i} gap="xs" wrap="nowrap">
                  <TextInput placeholder={t('Task {{number}}', { number: i + 1 })} style={{ flex: 1 }} {...form.getInputProps(`custom.${i}.title`)} />
                  <NumberInput w={110} suffix=" min" min={5} max={600} step={15} {...form.getInputProps(`custom.${i}.minutes`)} />
                  <ActionIcon variant="subtle" color="red" onClick={() => form.removeListItem('custom', i)} disabled={v.custom.length === 1} aria-label={t('Remove task')}>
                    <IconTrash size={16} />
                  </ActionIcon>
                </Group>
              ))}
              <Button size="xs" variant="subtle" leftSection={<IconPlus size={14} />} onClick={() => form.insertListItem('custom', { title: '', minutes: 60 })} w="fit-content">
                {t('Add task')}
              </Button>
            </Stack>
          )}
          <Text size="xs" c="dimmed" mt="xs">
            {t('{{count}} tasks', { count: tasks.length })} · {t('{{count}} working days before the deadline', { count: workDays })}
            {workDays > 0 && tasks.length > 0 && ` · ${t('starting with your next free time')}`}
          </Text>
        </div>

        <Textarea label={t('Notes')} autosize minRows={2} {...form.getInputProps('notes')} />
        <Group justify="flex-end">
          <Button type="submit" loading={create.isPending} disabled={!tasks.length}>
            {t('Plan it')}
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
    validate: { title: (v) => (v.trim() ? null : t('Name the assignment')), dueAt: (v) => (v ? null : t('Pick a due date')) },
  });
  const save = useAction(
    (v: typeof form.values) => rpc.planner.update({ assignmentId: a.id, ...v, dueAt: toDate(v.dueAt)! }),
    { success: 'Saved. The remaining tasks were re-planned if the due date changed.', onSuccess: onDone },
  );

  return (
    <form onSubmit={form.onSubmit((v) => save.mutate(v))}>
      <Stack>
        <TextInput label={t('Assignment')} {...form.getInputProps('title')} />
        <Group grow align="flex-start">
          <ClassSelect value={form.values.classId} onChange={(id) => form.setFieldValue('classId', id)} />
          <DateTimePicker label={t('Due')} valueFormat="ddd D MMM YYYY, HH:mm" {...form.getInputProps('dueAt')} />
        </Group>
        <NumberInput label={t('Buffer days')} min={0} max={7} w={220} {...form.getInputProps('bufferDays')} />
        <Textarea label={t('Notes')} autosize minRows={2} {...form.getInputProps('notes')} />
        <Group justify="flex-end">
          <Button type="submit" loading={save.isPending}>
            {t('Save')}
          </Button>
        </Group>
      </Stack>
    </form>
  );
}
