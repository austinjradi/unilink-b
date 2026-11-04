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
import { type AssignmentPart, looksLikeExam, minutesForParts } from '@shared/assignment';
import { addDays, ymd } from '@shared/dates';
import { DEFAULT_BUFFER_DAYS, weeklyMinutes } from '@shared/planner';
import { Empty, Loading, PageHeader } from '../components/ui';
import { dayLabel, fmtDateTime, fromNow, toDate } from '../lib/format';
import { FocusButton } from '../components/FocusTask';
import { useAction, useMe } from '../lib/hooks';
import { type Out, rpc } from '../lib/rpc';
import { useUndo } from '../lib/undo';
import { useVariant } from '../lib/variants';
import { ClassSelect } from './Calendar';
import { t, tx } from '../lib/i18n';
import { ReqInfo, WithInfo } from '../components/ReqInfo';

type Assignment = Out<typeof rpc.planner.list>[number];
type Task = Assignment['tasks'][number];

// ST2: assignments split into tasks and scheduled as early as free study time allows.
export function PlannerPage() {
  const me = useMe();
  const list = useQuery({ queryKey: ['planner', 'list'], queryFn: () => rpc.planner.list() });
  const hideFinished = useVariant('hide-finished-plans');
  const offerPlans = useVariant('offer-plan-new-deadline');
  const spread = useVariant('spread-work-evenly');
  const placeYourself = useVariant('place-tasks-yourself');
  const oneADay = useVariant('one-task-a-day');
  const noTakeOff = useVariant('missed-tasks-stay-late');
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

  const active = list.data?.filter((a) => !a.archived && !a.pastDue && a.doneCount < a.tasks.length) ?? [];
  const finished = list.data?.filter((a) => !a.archived && (a.pastDue || a.doneCount === a.tasks.length)) ?? [];
  const archived = list.data?.filter((a) => a.archived) ?? [];

  return (
    <>
      <PageHeader
        info="planner-page"
        title={t('Assignment planner')}
        subtitle={
          <>
            {spread
              ? 'Work is spread evenly over the days before each deadline'
              : placeYourself
                ? 'You place each task on the day you want it'
                : oneADay
                  ? 'One task a day, starting today'
                  : t('Tasks are scheduled as early as your free study time allows ({{hours}} h a week), so you finish ahead of each deadline', {
                      hours: Math.round(weeklyMinutes(me.weeklyStudyMinutes).reduce((a, b) => a + b, 0) / 6) / 10,
                    })}{' '}
            (
            <Anchor component="button" type="button" size="sm" onClick={() => setEditingTime(true)}>
              {t('change')}
            </Anchor>{' '}
            <ReqInfo id="free-time" />
            ). {noTakeOff || placeYourself ? 'Missed tasks stay where they are until you move them.' : t('Missed tasks move to your next free time automatically.')}
          </>
        }
        actions={
          <WithInfo id="planner-new">
            <Button leftSection={<IconPlus size={16} />} onClick={() => setEditing('new')}>
              {t('New assignment')}
            </Button>
          </WithInfo>
        }
      />

      {offerPlans && <PlanOffers planned={list.data ?? []} onPlan={(key) => setParams({ new: '1', from: key })} />}
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
          {finished.length > 0 && !hideFinished && (
            <Accordion variant="contained">
              <Accordion.Item value="finished">
                <Accordion.Control>
                  <WithInfo id="planner-finished">{t('Finished or past due ({{count}})', { count: finished.length })}</WithInfo>
                </Accordion.Control>
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
          {archived.length > 0 && <ArchivedPlans plans={archived} />}
        </Stack>
      )}

      <Modal opened={editing != null} onClose={close} title={editing === 'new' ? <WithInfo id="planner-new">{t('New assignment')}</WithInfo> : <WithInfo id="plan-edit">{t('Edit assignment')}</WithInfo>} size="lg">
        {editing === 'new' && <NewAssignmentForm onDone={close} from={from} />}
        {editing && editing !== 'new' && <EditAssignmentForm assignment={editing} onDone={close} />}
      </Modal>
      <Modal opened={editingTime} onClose={() => setEditingTime(false)} title={<WithInfo id="free-time">{t('Your free study time')}</WithInfo>}>
        {editingTime && <StudyTimeForm onDone={() => setEditingTime(false)} />}
      </Modal>
    </>
  );
}

// 'offer-plan-new-deadline': deadlines with no plan yet.
function PlanOffers({ planned, onPlan }: { planned: Assignment[]; onPlan: (key: string) => void }) {
  const upcoming = useQuery({ queryKey: ['calendar', 'upcoming', 60], queryFn: () => rpc.calendar.upcoming({ days: 60 }) });
  const offers = (upcoming.data ?? []).filter((e) => e.deadlineId != null && !planned.some((p) => p.deadlineId === e.deadlineId));
  if (!offers.length) return null;
  return (
    <Card withBorder padding="md" mb="md">
      <Text fw={700} mb="xs">
        New deadlines with no plan <ReqInfo id="plan-start-from" />
      </Text>
      <Stack gap={4}>
        {offers.slice(0, 5).map((e) => (
          <Group key={e.key} justify="space-between" wrap="nowrap">
            <Text size="sm">{e.title}</Text>
            <Button size="compact-xs" variant="light" component="a" href={`#/planner?new=1&from=${e.key}`} onClick={() => onPlan(e.key)}>
              {t('Plan it')}
            </Button>
          </Group>
        ))}
      </Stack>
    </Card>
  );
}

// 'archive-plans': out of the way, but still there.
function ArchivedPlans({ plans }: { plans: Assignment[] }) {
  const restore = useAction((assignmentId: number) => rpc.planner.setArchived({ assignmentId, archived: false }));
  return (
    <Card withBorder padding="md">
      <Text fw={700} mb="xs">
        Archived <ReqInfo id="plan-delete" />
      </Text>
      <Stack gap={4}>
        {plans.map((plan) => (
          <Group key={plan.id} justify="space-between" wrap="nowrap">
            <Text size="sm">{plan.title}</Text>
            <Button size="compact-xs" variant="default" onClick={() => restore.mutate(plan.id)}>
              Restore
            </Button>
          </Group>
        ))}
      </Stack>
    </Card>
  );
}

// 'weekly-time-grid': blocks of two hours through the day, which add up to the minutes.
const GRID_HOURS = [8, 10, 12, 14, 16, 18, 20];
function WeeklyGrid({ minutes, onChange }: { minutes: number[]; onChange: (minutes: number[]) => void }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: `52px repeat(7, 1fr)`, gap: 2 }}>
      <div />
      {[1, 2, 3, 4, 5, 6, 0].map((day) => (
        <Text key={day} size="xs" fw={700} ta="center">
          {dayjs().day(day).format('ddd')}
        </Text>
      ))}
      {GRID_HOURS.map((hour, row) => (
        <div key={hour} style={{ display: 'contents' }}>
          <Text size="xs" c="dimmed" ta="right" pr={4}>
            {hour}:00
          </Text>
          {[1, 2, 3, 4, 5, 6, 0].map((day) => {
            const on = minutes[day] / 120 > row;
            return (
              <button
                key={day}
                type="button"
                aria-pressed={on}
                aria-label={`${dayjs().day(day).format('dddd')} ${hour}:00`}
                onClick={() => onChange(minutes.map((m, i) => (i === day ? (on ? row : row + 1) * 120 : m)))}
                style={{ height: 22, borderRadius: 4, cursor: 'pointer', border: '1px solid var(--ul-border)', background: on ? 'var(--mantine-color-teal-5)' : 'transparent' }}
              />
            );
          })}
        </div>
      ))}
    </div>
  );
}

// ST2 "free time": minutes the planner may use on each weekday, Monday first on screen.
export function StudyTimeForm({ onDone }: { onDone?: () => void }) {
  const me = useMe();
  const [minutes, setMinutes] = useState(weeklyMinutes(me.weeklyStudyMinutes));
  const [daysOff, setDaysOff] = useState<string[]>(me.daysOff ?? []);
  const oneBudget = useVariant('one-daily-budget');
  const grid = useVariant('weekly-time-grid');
  const askCommitments = useVariant('other-commitments');
  const savedCommitments = useQuery({ queryKey: ['planner', 'commitments'], queryFn: () => rpc.planner.commitments(), enabled: askCommitments });
  const [commitments, setCommitments] = useState<number[] | null>(null);
  const busy = commitments ?? savedCommitments.data ?? [0, 0, 0, 0, 0, 0, 0];
  const save = useAction(
    async () => {
      await rpc.planner.setAvailability({ minutes });
      await rpc.planner.setDaysOff({ days: daysOff });
      if (askCommitments) await rpc.planner.setCommitments({ minutes: busy });
    },
    {
      success: 'Free time saved. Your plans were updated.',
      onSuccess: () => onDone?.(),
    },
  );
  const aroundClasses = useQuery({ queryKey: ['planner', 'aroundClasses'], queryFn: () => rpc.planner.freeTimeAroundClasses() });
  const total = minutes.reduce((a, b) => a + b, 0);
  return (
    <Stack>
      <Text size="sm" c="dimmed">
        {t('Minutes you can study on each day of the week. Study sessions you join count toward them.')} <ReqInfo id="free-weekday" />
      </Text>
      {aroundClasses.data && (
        <Group gap="xs">
          <WithInfo id="free-start-classes">
            <Button size="xs" variant="light" onClick={() => setMinutes(aroundClasses.data!)}>
              {t('Start from my class times')}
            </Button>
          </WithInfo>
          <Text size="xs" c="dimmed" style={{ flex: '1 1 220px' }}>
            {t('Four hours on a day with no classes, less your time in class, and at least an hour. Change anything before you save.')}
          </Text>
        </Group>
      )}
      {oneBudget && (
        <NumberInput label="Minutes a day" min={0} max={960} step={30} w={160} value={minutes.every((m) => m === minutes[0]) ? minutes[0] : 120} onChange={(v) => setMinutes(minutes.map(() => Number(v) || 0))} />
      )}
      {grid && <WeeklyGrid minutes={minutes} onChange={setMinutes} />}
      <SimpleGrid cols={{ base: 4, xs: 7 }} spacing="xs" display={oneBudget || grid ? 'none' : undefined}>
        {[1, 2, 3, 4, 5, 6, 0].map((day) => (
          <NumberInput
            key={day}
            label={dayjs().day(day).format('ddd')}
            min={0}
            max={960}
            step={30}
            hideControls
            styles={{ input: { paddingInline: 6, textAlign: 'center' } }}
            value={minutes[day]}
            onChange={(v) => setMinutes((m) => m.map((x, i) => (i === day ? Number(v) || 0 : x)))}
          />
        ))}
      </SimpleGrid>
      {askCommitments && (
        <div>
          <Text size="sm" fw={500} mb={4}>
            Minutes at work or other commitments <ReqInfo id="free-start-classes" />
          </Text>
          <SimpleGrid cols={{ base: 4, xs: 7 }} spacing="xs">
            {[1, 2, 3, 4, 5, 6, 0].map((day) => (
              <NumberInput key={day} aria-label={dayjs().day(day).format('dddd')} label={dayjs().day(day).format('ddd')} min={0} max={960} step={30} hideControls value={busy[day]} onChange={(v) => setCommitments(busy.map((x, i) => (i === day ? Number(v) || 0 : x)))} />
            ))}
          </SimpleGrid>
        </div>
      )}
      <DatePickerInput
        type="multiple"
        label={<WithInfo id="free-days-off">{t('Days off')}</WithInfo>}
        description={t('Days you won’t study at all, like a trip. Plans move around them.')}
        placeholder={t('Pick days')}
        valueFormat="D MMM"
        minDate={new Date()}
        clearable
        value={daysOff}
        onChange={(days) => setDaysOff(days.map((day) => day.slice(0, 10)))}
      />
      <Group justify="space-between">
        <Text size="sm">
          {t('{{hours}} h a week', { hours: Math.round(total / 6) / 10 })} <ReqInfo id="free-time" />
        </Text>
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
  const [addingMinutes, setAddingMinutes] = useState<number | string>(60);
  const askMinutes = useVariant('ask-new-task-minutes');
  const dailyReplan = useVariant('daily-replan');
  const archive = useVariant('archive-plans');
  const byMinutes = useVariant('progress-by-minutes');
  const asPercent = useVariant('plan-percent');
  const noEstimates = useVariant('one-task-a-day');
  const setArchived = useAction(() => rpc.planner.setArchived({ assignmentId: a.id, archived: true }));
  const answerMove = useAction((move: boolean) => rpc.planner.answerMove({ assignmentId: a.id, move }));
  const replan = useAction(() => rpc.planner.replan({ assignmentId: a.id }), { success: 'Plan rebuilt from today' });
  const remove = useAction(() => rpc.planner.remove({ assignmentId: a.id }), { success: 'Assignment deleted' });
  const open = useAction(() => rpc.planner.openAttachment({ assignmentId: a.id }));
  const addTask = useAction(() => rpc.planner.addTask({ assignmentId: a.id, title: adding, minutes: askMinutes ? Number(addingMinutes) || 60 : 60 }), {
    onSuccess: () => setAdding(''),
  });

  const days = [...new Set(a.tasks.map((task) => task.scheduledFor))].sort();
  const confirmDelete = () =>
    modals.openConfirmModal({
      title: <WithInfo id="plan-delete">{t('Delete "{{title}}"?', { title: a.title })}</WithInfo>,
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
              {a.title} <ReqInfo id="plan-card" />
            </Text>
            {a.classLabel && (
              <WithInfo id="plan-class">
                <Badge variant="light">{a.classLabel}</Badge>
              </WithInfo>
            )}
            {(a.deadlineId != null || a.assessmentId != null) && (
              <WithInfo id="plan-follows">
                <Tooltip label={t("Follows the section's due date: if a classmate moves it, this plan moves too.")} multiline w={260}>
                  <Badge variant="outline" color="gray" leftSection={<IconLink size={12} />}>
                    {t('Follows the class deadline')}
                  </Badge>
                </Tooltip>
              </WithInfo>
            )}
          </Group>
          <Text size="sm" c={a.pastDue ? 'red' : 'dimmed'}>
            {t('Due {{when}} ({{relative}})', { when: fmtDateTime(a.dueAt), relative: fromNow(a.dueAt) })} ·{' '}
            {t('{{count}} buffer days', { count: a.bufferDays })} <ReqInfo id="plan-buffer" />
          </Text>
        </div>
        <Group gap="xs">
          {a.attachmentName && (
            <WithInfo id="plan-file">
              <Button size="xs" variant="default" leftSection={<IconPaperclip size={14} />} onClick={() => open.mutate()}>
                {a.attachmentName}
              </Button>
            </WithInfo>
          )}
          <Menu position="bottom-end">
            <Menu.Target>
              <ActionIcon variant="subtle" aria-label={t('Assignment options')}>
                <IconDots size={18} />
              </ActionIcon>
            </Menu.Target>
            <Menu.Dropdown>
              <Menu.Item leftSection={<IconPencil size={14} />} rightSection={<ReqInfo id="plan-edit" />} onClick={onEdit}>
                {t('Edit details and due date')}
              </Menu.Item>
              {!dailyReplan && (
                <Menu.Item leftSection={<IconRefresh size={14} />} rightSection={<ReqInfo id="plan-replan" />} onClick={() => replan.mutate()}>
                  {t('Re-plan from scratch')}
                </Menu.Item>
              )}
              {archive ? (
                <Menu.Item leftSection={<IconTrash size={14} />} rightSection={<ReqInfo id="plan-delete" />} onClick={() => setArchived.mutate()}>
                  Archive
                </Menu.Item>
              ) : (
                <Menu.Item leftSection={<IconTrash size={14} />} rightSection={<ReqInfo id="plan-delete" />} color="red" onClick={confirmDelete}>
                  {t('Delete')}
                </Menu.Item>
              )}
            </Menu.Dropdown>
          </Menu>
        </Group>
      </Group>

      <Group gap="xs" mb="md">
        <Progress value={progress(a, byMinutes)} style={{ flex: 1 }} color="teal" />
        <Text size="xs" c="dimmed">
          {asPercent
            ? `${Math.round(progress(a, byMinutes))}%`
            : byMinutes
            ? `${a.tasks.filter((task) => task.doneAt).reduce((sum, task) => sum + task.minutes, 0)}/${a.tasks.reduce((sum, task) => sum + task.minutes, 0)} min done`
            : t('{{done}}/{{total}} done', { done: a.doneCount, total: a.tasks.length })}{' '}
          <ReqInfo id="plan-progress" />
        </Text>
      </Group>
      {a.movedTo && (
        <Alert color="blue" variant="light" mb="md" p="xs">
          <Group justify="space-between">
            <Text size="sm">The deadline moved to {fmtDateTime(a.movedTo)}. Move this plan too? <ReqInfo id="plan-follows" /></Text>
            <Group gap={4}>
              <Button size="compact-xs" onClick={() => answerMove.mutate(true)}>
                Move it
              </Button>
              <Button size="compact-xs" variant="default" onClick={() => answerMove.mutate(false)}>
                Keep my date
              </Button>
            </Group>
          </Group>
        </Alert>
      )}

      {!a.pastDue && (a.tight || a.overloaded) && (
        <Alert color="yellow" variant="light" icon={<IconAlertTriangle size={18} />} mb="md" p="xs">
          <Text size="sm">
            {a.tight && `${t('Some work lands on your buffer day before the deadline.')} `}
            {a.overloaded && t('Some days have more work than your free study time. Add free time or move tasks.')} <ReqInfo id="plan-warning" />
          </Text>
        </Alert>
      )}

      <Stack gap="sm">
        {days.map((day) => (
          <div key={day}>
            <Text size="xs" fw={700} tt="uppercase" c={day < today ? 'red' : day === today ? 'indigo' : 'dimmed'} mb={4}>
              {dayLabel(day, today)} <ReqInfo id="plan-day" />
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
          {askMinutes && !noEstimates && <NumberInput size="xs" w={100} suffix=" min" min={5} max={600} step={15} aria-label="Minutes" value={addingMinutes} onChange={setAddingMinutes} />}
          <WithInfo id="plan-add-task">
            <Button size="xs" variant="light" type="submit" disabled={!adding.trim()} loading={addTask.isPending}>
              {t('Add')}
            </Button>
          </WithInfo>
        </Group>
      </form>
    </Card>
  );
}

const progress = (a: Assignment, byMinutes: boolean) => {
  if (!a.tasks.length) return 0;
  if (!byMinutes) return (a.doneCount / a.tasks.length) * 100;
  const total = a.tasks.reduce((sum, task) => sum + task.minutes, 0);
  return (a.tasks.filter((task) => task.doneAt).reduce((sum, task) => sum + task.minutes, 0) / total) * 100;
};

// What most exam plans come down to; the student can change any of it before saving.
const EXAM_STEPS = [
  { title: tx('Go through the lecture notes'), minutes: 120 },
  { title: tx('Redo the assignments and practice problems'), minutes: 120 },
  { title: tx('Write a past exam, timed'), minutes: 120 },
  { title: tx('Go over what you got wrong'), minutes: 60 },
];

function TaskRow({ task, dueDay }: { task: Task; dueDay: string }) {
  const undo = useUndo();
  const noEstimates = useVariant('one-task-a-day');
  const skipTasks = useVariant('skip-tasks');
  const taskNotes = useVariant('task-notes');
  const staysLate = useVariant('missed-tasks-stay-late');
  const skip = useAction(() => rpc.planner.skipTask({ taskId: task.id }));
  const saveNote = useAction((note: string) => rpc.planner.setTaskNote({ taskId: task.id, note }));
  const [note, setNote] = useState(task.note);
  const late = staysLate && !task.doneAt && task.scheduledFor < ymd(new Date());
  const setDone = useAction((done: boolean) => rpc.planner.setDone({ taskId: task.id, done }));
  const move = useAction((day: string) => rpc.planner.moveTask({ taskId: task.id, day }), { success: 'Task moved. It will stay on that day.' });
  const remove = useAction(() => rpc.planner.removeTask({ taskId: task.id }), {
    onSuccess: () => {
      if (!task.doneAt) undo(t('Task deleted'), () => rpc.planner.addTask({ assignmentId: task.assignmentId, title: task.title, minutes: task.minutes }));
    },
  });

  return (
    // On narrow screens the minutes, day and delete wrap under the task instead of squeezing it.
    <Group gap="sm" pl="xs" style={{ rowGap: 4 }}>
      <Checkbox checked={!!task.doneAt} onChange={(e) => setDone.mutate(e.currentTarget.checked)} aria-label={t('Done')} />
      <Text size="sm" style={{ flex: '1 1 160px' }} td={task.doneAt ? 'line-through' : undefined} c={task.doneAt ? 'dimmed' : undefined}>
        {task.title} <ReqInfo id="plan-task" />
        {task.skipped && (
          <Badge size="xs" ml={6} variant="light" color="gray">
            Skipped
          </Badge>
        )}
        {late && (
          <Badge size="xs" ml={6} variant="light" color="red">
            Late
          </Badge>
        )}
      </Text>
      {taskNotes && <TextInput size="xs" w={180} placeholder="Notes" aria-label="Notes for this task" value={note} onChange={(e) => setNote(e.currentTarget.value)} onBlur={() => note !== task.note && saveNote.mutate(note)} />}
      {task.pinned && (
        <WithInfo id="plan-task-pin">
          <Tooltip label={t('You placed this task by hand, so re-plans leave it here')}>
            <IconPin size={14} color="var(--mantine-color-dimmed)" />
          </Tooltip>
        </WithInfo>
      )}
      {!noEstimates && (
        <WithInfo id="plan-task-minutes">
          <Badge size="sm" variant="default">
            {task.minutes} min
          </Badge>
        </WithInfo>
      )}
      <WithInfo id="plan-task-move">
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
      </WithInfo>
      {!task.doneAt && <FocusButton taskId={task.id} title={task.title} />}
      <WithInfo id="plan-task-delete">
        <ActionIcon variant="subtle" color="red" size="sm" onClick={() => (skipTasks ? skip.mutate() : remove.mutate())} aria-label={skipTasks ? 'Skip task' : t('Delete task')}>
          <IconTrash size={14} />
        </ActionIcon>
      </WithInfo>
    </Group>
  );
}

type TaskDraft = { title: string; minutes: number };

function NewAssignmentForm({ onDone, from }: { onDone: () => void; from: string | null }) {
  const byHand = useVariant('plan-date-by-hand');
  const onlyPosted = useVariant('only-posted-assignments');
  const pickFromList = useVariant('pick-assignment-from-list');
  const oneBuffer = useVariant('one-buffer-day');
  const spread = useVariant('spread-work-evenly');
  const autoBuffer = useVariant('proportional-buffer');
  const keepFileOnly = useVariant('keep-file-only');
  const perDay = useVariant('one-task-per-day-split');
  const noExamSteps = useVariant('no-exam-steps');
  const fromPast = useVariant('estimate-from-past');
  const sharedLists = useVariant('share-task-lists');
  const previewIt = useVariant('preview-plan');
  const needsClass = useVariant('require-class-for-plan');
  const taskNotes = useVariant('task-notes');
  const noEstimates = useVariant('one-task-a-day');
  const [attachment, setAttachment] = useState<{ path: string; name: string } | null>(null);
  const form = useForm({
    initialValues: {
      title: '',
      classId: null as number | null,
      dueAt: dayjs().add(4, 'day').hour(23).minute(59).second(0).toDate() as Date | string | null,
      bufferDays: oneBuffer || spread ? 1 : DEFAULT_BUFFER_DAYS,
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
      classId: (v) => (needsClass && !v ? t('Pick a class') : null),
    },
  });
  const v = form.values;
  const dueDay = toDate(v.dueAt);
  const daysToWork = dueDay ? Math.max(1, dayjs(addDays(ymd(dueDay), -v.bufferDays)).diff(dayjs(ymd(new Date())), 'day') + 1) : 1;
  const tasks: TaskDraft[] =
    perDay
      ? Array.from({ length: daysToWork }, (_, i) => ({ title: `${v.title.trim() || t('Part')}: day ${i + 1}`, minutes: v.partMinutes }))
      : v.mode === 'parts'
      ? Array.from({ length: Math.max(1, v.parts) }, (_, i) => ({ title: `${v.partLabel.trim() || t('Part')} ${i + 1}`, minutes: v.partMinutes }))
      : v.custom.filter((task) => task.title.trim());

  // Most assignments are already on the calendar (a class deadline or a graded item), so
  // the form can start from one of them.
  const upcoming = useQuery({ queryKey: ['calendar', 'upcoming', 60], queryFn: () => rpc.calendar.upcoming({ days: 60 }) });
  // Not the term's key dates (add/drop, withdrawal): there's nothing to plan for those.
  const deadlineRows = useQuery({ queryKey: ['calendar', 'deadlines'], queryFn: () => rpc.calendar.deadlines(), enabled: onlyPosted });
  const posted = new Set((deadlineRows.data ?? []).filter((d) => d.official).map((d) => d.id));
  const sources = (upcoming.data ?? []).filter((e) => e.detail !== 'planner' && e.detail !== 'key' && (!onlyPosted || (e.deadlineId != null && posted.has(e.deadlineId))));
  // 'estimate-from-past': what tasks took in earlier plans for this class.
  const past = useQuery({ queryKey: ['planner', 'list'], queryFn: () => rpc.planner.list(), enabled: fromPast });
  const pastTasks = (past.data ?? []).filter((plan) => plan.classId === v.classId).flatMap((plan) => plan.tasks);
  const pastAverage = pastTasks.length ? Math.round(pastTasks.reduce((sum, task) => sum + task.minutes, 0) / pastTasks.length / 5) * 5 : null;
  const classmatesLists = useQuery({
    queryKey: ['planner', 'sharedLists', v.classId, v.title],
    queryFn: () => rpc.planner.sharedLists({ classId: v.classId!, title: v.title }),
    enabled: sharedLists && !!v.classId && !!v.title.trim(),
  });
  const preview = useQuery({
    queryKey: ['planner', 'preview', v.dueAt, v.bufferDays, tasks],
    queryFn: () => rpc.planner.preview({ dueAt: toDate(v.dueAt)!, bufferDays: v.bufferDays, tasks }),
    enabled: previewIt && !!toDate(v.dueAt) && tasks.length > 0,
  });
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
      if (!keepFileOnly) read.mutate(file.path);
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
      if (!keepFileOnly) read.mutate(file.path);
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
        ...(follows && !byHand && toDate(v.dueAt)?.getTime() === follows.due.getTime()
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
        {sources.length > 0 && !byHand && (
          <Select
            label={<WithInfo id="plan-start-from">{t('Start from a deadline')}</WithInfo>}
            description={t('Fills in the name, class and due date')}
            placeholder={t('Optional')}
            searchable
            clearable
            data={sources.map((e) => ({ value: e.key, label: [e.title, e.classLabel, dayjs(e.start).format(t('ddd, MMM D'))].filter(Boolean).join(' · ') }))}
            value={picked}
            onChange={startFrom}
          />
        )}
        {!(pickFromList || onlyPosted) && <TextInput label={<WithInfo id="plan-title">{t('Assignment')}</WithInfo>} placeholder={t('Problem set 3')} data-autofocus {...form.getInputProps('title')} />}
        <Group grow align="flex-start">
          <ClassSelect info="plan-class" value={v.classId} onChange={(id) => form.setFieldValue('classId', id)} />
          <DateTimePicker label={<WithInfo id="plan-due">{t('Due')}</WithInfo>} valueFormat="ddd D MMM YYYY, HH:mm" minDate={new Date()} {...form.getInputProps('dueAt')} />
        </Group>
        {autoBuffer ? (
          <Text size="xs" c="dimmed">
            The last 10% of the time before the deadline is kept free. <ReqInfo id="plan-buffer" />
          </Text>
        ) : (
          <NumberInput
            label={<WithInfo id="plan-buffer">{t('Buffer days')}</WithInfo>}
            description={t('Days kept free right before the deadline')}
            min={0}
            max={7}
            w={220}
            {...form.getInputProps('bufferDays')}
          />
        )}

        <div>
          <Group gap="xs">
            <WithInfo id="plan-file">
              <Button variant="default" size="xs" leftSection={<IconPaperclip size={14} />} onClick={() => choose.mutate()}>
                {attachment ? t('Change file') : t('Attach the assignment file')}
              </Button>
            </WithInfo>
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
            <Alert color="teal" variant="light" icon={<IconListNumbers size={18} />} mt="xs" p="xs" title={<WithInfo id="plan-found">{t('Found {{count}} problems in the file', { count: found.length })}</WithInfo>}>
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
            {t('How should it be split?')} <ReqInfo id="plan-split" />
          </Text>
          {sharedLists && !!classmatesLists.data?.length && (
            <Group gap={4} mb="sm">
              {classmatesLists.data.map((list, i) => (
                <Button key={i} size="xs" variant="light" onClick={() => form.setValues({ mode: 'custom', custom: list })}>
                  Use a classmate's {list.length} tasks
                </Button>
              ))}
              <ReqInfo id="plan-custom-tasks" />
            </Group>
          )}
          {fromPast && pastAverage != null && (
            <Group gap={4} mb="sm">
              <Button size="xs" variant="light" onClick={() => form.setValues({ partMinutes: pastAverage })}>
                Tasks in this class took about {pastAverage} min
              </Button>
              <ReqInfo id="plan-parts" />
            </Group>
          )}
          {looksLikeExam(v.title) && !noExamSteps && (
            <Group gap={4} mb="sm">
              <Button
                size="xs"
                variant="light"
                onClick={() => form.setValues({ mode: 'custom', custom: EXAM_STEPS.map((step) => ({ title: t(step.title), minutes: step.minutes })) })}
              >
                {t('Studying for an exam? Start from these steps')}
              </Button>
              <ReqInfo id="plan-exam-steps" />
            </Group>
          )}
          <Group gap={4} mb="sm" display={perDay ? 'none' : undefined}>
            <SegmentedControl
              data={[
                { value: 'parts', label: t('Equal parts') },
                { value: 'custom', label: t('My own tasks') },
              ]}
              {...form.getInputProps('mode')}
            />
            <ReqInfo id={v.mode === 'parts' ? 'plan-parts' : 'plan-custom-tasks'} />
          </Group>
          {perDay ? null : v.mode === 'parts' ? (
            <Group grow>
              <NumberInput label={<WithInfo id="plan-parts">{t('Number of parts')}</WithInfo>} min={1} max={50} {...form.getInputProps('parts')} />
              <TextInput label={<WithInfo id="plan-parts">{t('Each part is a…')}</WithInfo>} {...form.getInputProps('partLabel')} />
              {!noEstimates && <NumberInput label={<WithInfo id="plan-task-minutes">{t('Minutes each')}</WithInfo>} min={5} max={600} step={15} {...form.getInputProps('partMinutes')} />}
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
              <WithInfo id="plan-custom-tasks">
                <Button size="xs" variant="subtle" leftSection={<IconPlus size={14} />} onClick={() => form.insertListItem('custom', { title: '', minutes: 60 })} w="fit-content">
                  {t('Add task')}
                </Button>
              </WithInfo>
            </Stack>
          )}
          <Text size="xs" c="dimmed" mt="xs">
            {t('{{count}} tasks', { count: tasks.length })} · {t('{{count}} working days before the deadline', { count: workDays })}
            {workDays > 0 && tasks.length > 0 && ` · ${t('starting with your next free time')}`} <ReqInfo id="plan-summary" />
          </Text>
          {previewIt && !!preview.data?.length && (
            <Stack gap={2} mt="xs">
              {preview.data.map((row) => (
                <Text key={row.title} size="xs">
                  {dayjs(row.day).format('ddd D MMM')}: {row.title}
                </Text>
              ))}
            </Stack>
          )}
        </div>

        {!taskNotes && <Textarea label={<WithInfo id="plan-notes">{t('Notes')}</WithInfo>} autosize minRows={2} {...form.getInputProps('notes')} />}
        <Group justify="flex-end">
          <WithInfo id="planner-page">
            <Button type="submit" loading={create.isPending} disabled={!tasks.length}>
              {t('Plan it')}
            </Button>
          </WithInfo>
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
        <TextInput label={<WithInfo id="plan-title">{t('Assignment')}</WithInfo>} {...form.getInputProps('title')} />
        <Group grow align="flex-start">
          <ClassSelect info="plan-class" value={form.values.classId} onChange={(id) => form.setFieldValue('classId', id)} />
          <DateTimePicker label={<WithInfo id="plan-due">{t('Due')}</WithInfo>} valueFormat="ddd D MMM YYYY, HH:mm" {...form.getInputProps('dueAt')} />
        </Group>
        <NumberInput label={<WithInfo id="plan-buffer">{t('Buffer days')}</WithInfo>} min={0} max={7} w={220} {...form.getInputProps('bufferDays')} />
        <Textarea label={<WithInfo id="plan-notes">{t('Notes')}</WithInfo>} autosize minRows={2} {...form.getInputProps('notes')} />
        <Group justify="flex-end">
          <Button type="submit" loading={save.isPending}>
            {t('Save')}
          </Button>
        </Group>
      </Stack>
    </form>
  );
}
