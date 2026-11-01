import { useState } from 'react';
import { ActionIcon, Button, Group, Menu, Modal, Select, Stack, Table, Text, Textarea, TextInput } from '@mantine/core';
import { DateTimePicker } from '@mantine/dates';
import { useForm } from '@mantine/form';
import { IconChevronLeft, IconChevronRight, IconDownload, IconPencil, IconPlus, IconTrash, IconUpload } from '@tabler/icons-react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { addDays, eachDay, ymd } from '@shared/dates';
import { Empty, KindBadge, kindColor, Loading, PageHeader, SectionCard } from '../components/ui';
import { fmtDateTime, fmtTime, toDate } from '../lib/format';
import { useAction } from '../lib/hooks';
import { type Out, rpc } from '../lib/rpc';

type Deadline = Out<typeof rpc.calendar.deadlines>[number];

const KINDS = [
  { value: 'assignment', label: 'Assignment' },
  { value: 'exam', label: 'Exam' },
  { value: 'quiz', label: 'Quiz' },
  { value: 'other', label: 'Other' },
];

const mondayOf = (d: Date) => ymd(dayjs(d).subtract((d.getDay() + 6) % 7, 'day').toDate());

// A3: week view of everything with a date, plus manual deadlines. G2 import/export lives here too.
export function CalendarPage() {
  const [weekStart, setWeekStart] = useState(() => mondayOf(new Date()));
  const [editing, setEditing] = useState<Deadline | 'new' | null>(null);
  const weekEnd = addDays(weekStart, 6);
  const today = ymd(new Date());

  const events = useQuery({
    queryKey: ['calendar', weekStart, weekEnd],
    queryFn: () => rpc.calendar.range({ from: weekStart, to: weekEnd }),
    placeholderData: keepPreviousData,
  });
  const deadlines = useQuery({ queryKey: ['calendar', 'deadlines'], queryFn: () => rpc.calendar.deadlines() });
  const remove = useAction((id: number) => rpc.calendar.removeDeadline({ id }), { success: 'Deadline removed' });
  const exportIcs = useAction(() => rpc.calendar.exportIcs(), {
    success: (r) => (r ? `Exported ${r.count} events. Import the file into Google Calendar.` : ''),
  });
  const importIcs = useAction(() => rpc.calendar.importIcs({ classId: null }), {
    success: (r) => (r ? `Imported ${r.imported} deadlines${r.skipped ? ` (skipped ${r.skipped} past or duplicate)` : ''}` : ''),
  });

  return (
    <>
      <PageHeader
        title="Calendar"
        subtitle="Class times, deadlines, exams, study sessions and planned work in one place."
        actions={
          <>
            <Menu position="bottom-end">
              <Menu.Target>
                <Button variant="default">Sync</Button>
              </Menu.Target>
              <Menu.Dropdown>
                <Menu.Item leftSection={<IconDownload size={14} />} onClick={() => exportIcs.mutate()}>
                  Export for Google Calendar (.ics)
                </Menu.Item>
                <Menu.Item leftSection={<IconUpload size={14} />} onClick={() => importIcs.mutate()}>
                  Import from myCourses (.ics)
                </Menu.Item>
              </Menu.Dropdown>
            </Menu>
            <Button leftSection={<IconPlus size={16} />} onClick={() => setEditing('new')}>
              Add deadline
            </Button>
          </>
        }
      />

      <Group justify="space-between" mb="sm">
        <Group gap="xs">
          <ActionIcon variant="default" onClick={() => setWeekStart(addDays(weekStart, -7))} aria-label="Previous week">
            <IconChevronLeft size={16} />
          </ActionIcon>
          <Button variant="default" size="xs" onClick={() => setWeekStart(mondayOf(new Date()))}>
            This week
          </Button>
          <ActionIcon variant="default" onClick={() => setWeekStart(addDays(weekStart, 7))} aria-label="Next week">
            <IconChevronRight size={16} />
          </ActionIcon>
        </Group>
        <Text fw={600}>
          {dayjs(weekStart).format('D MMM')} – {dayjs(weekEnd).format('D MMM YYYY')}
        </Text>
      </Group>

      <div className="week-grid">
        {eachDay(weekStart, weekEnd).map((day) => {
          const dayEvents = events.data?.filter((e) => ymd(e.start) === day) ?? [];
          return (
            <div key={day} className="week-day" data-today={day === today || undefined}>
              <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
                {dayjs(day).format('ddd')}
              </Text>
              <Text fw={700} mb="xs">
                {dayjs(day).format('D')}
              </Text>
              {dayEvents.map((e) => (
                <div
                  key={e.key}
                  className="event"
                  data-done={e.done || undefined}
                  style={{ ['--event-color' as string]: `var(--mantine-color-${kindColor(e.kind === 'deadline' ? e.detail : e.kind)}-6)` }}
                  title={[e.title, e.classLabel, e.location].filter(Boolean).join('\n')}
                >
                  <Text size="xs" fw={600} lineClamp={2}>
                    {e.kind === 'deadline' ? `Due: ${e.title}` : e.title}
                  </Text>
                  <Text size="xs" c="dimmed">
                    {e.allDay ? e.detail : e.end ? `${fmtTime(e.start)}–${fmtTime(e.end)}` : fmtTime(e.start)}
                    {e.classLabel && e.classLabel !== e.title ? ` · ${e.classLabel}` : ''}
                  </Text>
                </div>
              ))}
            </div>
          );
        })}
      </div>

      <Group gap="md" mt="sm">
        {['class', 'session', 'task', 'assignment', 'exam', 'quiz', 'graded'].map((k) => (
          <KindBadge key={k} kind={k} />
        ))}
      </Group>

      <Stack mt="xl">
        <SectionCard title="Your deadlines">
          <Text size="sm" c="dimmed" mb="sm">
            Graded work from each class's Grades tab and planner due dates appear on the calendar automatically. Add
            anything else here.
          </Text>
          {deadlines.isPending ? (
            <Loading />
          ) : deadlines.data?.length ? (
            <Table verticalSpacing="xs">
              <Table.Tbody>
                {deadlines.data.map((d) => (
                  <Table.Tr key={d.id} opacity={d.dueAt < new Date() ? 0.5 : 1}>
                    <Table.Td fw={500}>{d.title}</Table.Td>
                    <Table.Td>{d.classLabel ?? '—'}</Table.Td>
                    <Table.Td>
                      <KindBadge kind={d.kind} />
                    </Table.Td>
                    <Table.Td>{fmtDateTime(d.dueAt)}</Table.Td>
                    <Table.Td>
                      <Group gap={4} justify="flex-end" wrap="nowrap">
                        <ActionIcon variant="subtle" onClick={() => setEditing(d)} aria-label="Edit">
                          <IconPencil size={16} />
                        </ActionIcon>
                        <ActionIcon variant="subtle" color="red" onClick={() => remove.mutate(d.id)} aria-label="Delete">
                          <IconTrash size={16} />
                        </ActionIcon>
                      </Group>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          ) : (
            <Empty>No deadlines added yet.</Empty>
          )}
        </SectionCard>
      </Stack>

      <Modal opened={editing != null} onClose={() => setEditing(null)} title={editing === 'new' ? 'Add deadline' : 'Edit deadline'}>
        {editing && <DeadlineForm key={editing === 'new' ? 'new' : editing.id} existing={editing === 'new' ? null : editing} onDone={() => setEditing(null)} />}
      </Modal>
    </>
  );
}

export function ClassSelect({ value, onChange, label = 'Class' }: { value: number | null; onChange: (v: number | null) => void; label?: string }) {
  const classes = useQuery({ queryKey: ['classes', 'mine'], queryFn: () => rpc.classes.mine() });
  return (
    <Select
      label={label}
      placeholder="None"
      clearable
      data={classes.data?.map((c) => ({ value: String(c.id), label: `${c.subject} ${c.number} · ${c.title}` })) ?? []}
      value={value == null ? null : String(value)}
      onChange={(v) => onChange(v ? Number(v) : null)}
    />
  );
}

function DeadlineForm({ existing, onDone }: { existing: Deadline | null; onDone: () => void }) {
  const form = useForm({
    initialValues: {
      title: existing?.title ?? '',
      kind: (existing?.kind ?? 'assignment') as Deadline['kind'],
      classId: existing?.classId ?? null,
      dueAt: (existing?.dueAt ?? dayjs().add(7, 'day').hour(23).minute(59).second(0).toDate()) as Date | string | null,
      notes: existing?.notes ?? '',
    },
    validate: {
      title: (v) => (v.trim() ? null : 'Add a title'),
      dueAt: (v) => (v ? null : 'Pick a date'),
    },
  });
  const save = useAction(
    (v: typeof form.values) => {
      const fields = { ...v, dueAt: toDate(v.dueAt)! };
      return existing ? rpc.calendar.updateDeadline({ id: existing.id, ...fields }) : rpc.calendar.addDeadline(fields);
    },
    { success: 'Deadline saved', onSuccess: onDone },
  );

  return (
    <form onSubmit={form.onSubmit((v) => save.mutate(v))}>
      <Stack>
        <TextInput label="Title" placeholder="Assignment 3" data-autofocus {...form.getInputProps('title')} />
        <Group grow>
          <Select label="Type" data={KINDS} allowDeselect={false} {...form.getInputProps('kind')} />
          <DateTimePicker label="Due" valueFormat="ddd D MMM YYYY, HH:mm" {...form.getInputProps('dueAt')} />
        </Group>
        <ClassSelect value={form.values.classId} onChange={(v) => form.setFieldValue('classId', v)} />
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
