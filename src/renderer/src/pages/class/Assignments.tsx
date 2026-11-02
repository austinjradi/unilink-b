import { useState } from 'react';
import { ActionIcon, Button, Card, Checkbox, Group, Modal, NumberInput, Stack, Text, Textarea, TextInput, Title, Tooltip } from '@mantine/core';
import { DateTimePicker } from '@mantine/dates';
import { useForm } from '@mantine/form';
import { modals } from '@mantine/modals';
import { IconFileText, IconListCheck, IconPaperclip, IconPencil, IconPlus, IconTrash } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { Link } from 'react-router';
import { Empty, Loading, Tag } from '../../components/ui';
import { fmtDateTime, fromNow, toDate } from '../../lib/format';
import { useAction } from '../../lib/hooks';
import { t } from '../../lib/i18n';
import { type Out, rpc } from '../../lib/rpc';

type Assignment = Out<typeof rpc.assignments.list>[number];

// What the section's professor posts: instructions and a handout with a due date. Students
// open the handout, plan the work (ST2) and check it off; only the professor changes it.
export function Assignments({ classId }: { classId: number }) {
  const list = useQuery({ queryKey: ['assignments', classId], queryFn: () => rpc.assignments.list({ classId }) });
  const info = useQuery({ queryKey: ['courses', 'info', classId], queryFn: () => rpc.courses.info({ classId }) });
  const [editing, setEditing] = useState<Assignment | 'new' | null>(null);

  if (list.isPending || !list.data || !info.data) return <Loading />;
  const teaching = info.data.teaching;

  return (
    <Stack gap="lg">
      {teaching && (
        <Group justify="flex-end">
          <Button leftSection={<IconPlus size={16} />} onClick={() => setEditing('new')}>
            {t('Post an assignment')}
          </Button>
        </Group>
      )}
      {list.data.length ? (
        list.data.map((a) => <AssignmentCard key={a.id} assignment={a} teaching={teaching} onEdit={() => setEditing(a)} />)
      ) : (
        <Card>
          <Empty icon={<IconFileText size={22} />}>
            {teaching
              ? t('Nothing posted yet. Everyone in the section gets a notification when you post an assignment.')
              : info.data.managedBy
                ? t("Your professor hasn't posted any assignments here yet.")
                : t("Assignments from your professor show up here, but this section's professor isn't on UniLink yet.")}
          </Empty>
        </Card>
      )}
      <Modal opened={editing != null} onClose={() => setEditing(null)} title={editing && editing !== 'new' ? t('Edit assignment') : t('Post an assignment')} size="lg">
        {editing && <AssignmentForm classId={classId} existing={editing === 'new' ? null : editing} onDone={() => setEditing(null)} />}
      </Modal>
    </Stack>
  );
}

function AssignmentCard({ assignment: a, teaching, onEdit }: { assignment: Assignment; teaching: boolean; onEdit: () => void }) {
  const open = useAction(() => rpc.assignments.openFile({ id: a.id }));
  const setDone = useAction((done: boolean) => rpc.calendar.setDeadlineDone({ id: a.id, done }));
  const remove = useAction(() => rpc.assignments.remove({ id: a.id }), { success: 'Assignment removed' });
  const past = a.dueAt < new Date();

  const confirmRemove = () =>
    modals.openConfirmModal({
      title: t('Remove this assignment?'),
      children: <Text size="sm">{t("It comes off everyone's calendar, and the handout is deleted. Students aren't notified.")}</Text>,
      labels: { confirm: t('Remove'), cancel: t('Keep') },
      confirmProps: { color: 'red' },
      onConfirm: () => remove.mutate(),
    });

  return (
    <Card padding="lg">
      <Group justify="space-between" align="flex-start" wrap="nowrap">
        <div style={{ minWidth: 0 }}>
          <Title order={3} td={a.done ? 'line-through' : undefined}>
            {a.title}
          </Title>
          <Group gap="xs" mt={4}>
            <Text size="sm" c="dimmed">
              {t('Due {{when}}', { when: fmtDateTime(a.dueAt) })} · {fromNow(a.dueAt)}
            </Text>
            {past && <Tag color="gray">{t('Past due')}</Tag>}
          </Group>
        </div>
        {teaching ? (
          <Group gap={4} wrap="nowrap">
            <ActionIcon variant="subtle" onClick={onEdit} aria-label={t('Edit {{name}}', { name: a.title })}>
              <IconPencil size={16} />
            </ActionIcon>
            <ActionIcon variant="subtle" color="red" onClick={confirmRemove} aria-label={t('Delete {{name}}', { name: a.title })}>
              <IconTrash size={16} />
            </ActionIcon>
          </Group>
        ) : (
          <Tooltip label={a.done ? t('Mark as not done') : t('Mark as done')}>
            <Checkbox checked={a.done} onChange={(e) => setDone.mutate(e.currentTarget.checked)} aria-label={t('Mark {{title}} done', { title: a.title })} />
          </Tooltip>
        )}
      </Group>
      {a.notes && (
        <Text mt="sm" style={{ whiteSpace: 'pre-wrap' }}>
          {a.notes}
        </Text>
      )}
      <Group gap="xs" mt="md">
        {a.attachmentName && (
          <Button size="xs" variant="light" leftSection={<IconPaperclip size={14} />} onClick={() => open.mutate()} loading={open.isPending}>
            {a.attachmentName}
          </Button>
        )}
        {!teaching && !past && (
          <Button size="xs" variant="default" leftSection={<IconListCheck size={14} />} component={Link} to={`/planner?new=1&from=deadline-${a.id}`}>
            {t('Plan it')}
          </Button>
        )}
      </Group>
    </Card>
  );
}

function AssignmentForm({ classId, existing, onDone }: { classId: number; existing: Assignment | null; onDone: () => void }) {
  const [file, setFile] = useState<{ path: string; name: string } | null>(null);
  const form = useForm({
    initialValues: {
      title: existing?.title ?? '',
      dueAt: (existing?.dueAt ?? dayjs().add(14, 'day').hour(23).minute(59).second(0).toDate()) as Date | string | null,
      notes: existing?.notes ?? '',
      weight: '' as number | string,
    },
    validate: {
      title: (v) => (v.trim() ? null : t('Name the assignment')),
      dueAt: (v) => (toDate(v) && (existing || toDate(v)! > new Date()) ? null : t('Pick a due date in the future')),
    },
  });
  const choose = useAction(() => rpc.planner.chooseAttachment(), { onSuccess: (picked) => picked && setFile(picked) });
  const save = useAction(
    async (v: typeof form.values) => {
      const fields = { title: v.title, dueAt: toDate(v.dueAt)!, notes: v.notes, attachmentPath: file?.path ?? null };
      if (existing) await rpc.assignments.update({ id: existing.id, ...fields });
      else await rpc.assignments.post({ classId, ...fields, weight: v.weight === '' ? null : Number(v.weight) });
    },
    { success: existing ? t('Assignment saved. Students are told if the due date moved.') : t('Posted. Everyone in the section has been notified.'), onSuccess: onDone },
  );

  const fileName = file?.name ?? existing?.attachmentName;
  return (
    <form onSubmit={form.onSubmit((v) => save.mutate(v))}>
      <Stack>
        <TextInput label={t('Assignment')} placeholder={t('Problem set 3')} data-autofocus {...form.getInputProps('title')} />
        <Group grow align="flex-start">
          <DateTimePicker label={t('Due')} valueFormat="ddd D MMM YYYY, HH:mm" {...form.getInputProps('dueAt')} />
          {!existing && (
            <NumberInput
              label={t('Weight')}
              description={t('Adds it to the grading scheme. Leave empty if it isn’t graded.')}
              suffix="%"
              min={0}
              max={100}
              decimalScale={2}
              {...form.getInputProps('weight')}
            />
          )}
        </Group>
        <Textarea label={t('Instructions')} autosize minRows={3} {...form.getInputProps('notes')} />
        <Group gap="xs">
          <Button variant="default" size="xs" leftSection={<IconPaperclip size={14} />} onClick={() => choose.mutate()}>
            {fileName ? t('Change file') : t('Attach the assignment file')}
          </Button>
          {fileName && (
            <Text size="sm" c="dimmed">
              {fileName}
            </Text>
          )}
        </Group>
        <Text size="xs" c="dimmed">
          {t('Students can read the numbered problems in a PDF or text handout when they plan it.')}
        </Text>
        <Group justify="flex-end">
          <Button type="submit" loading={save.isPending}>
            {existing ? t('Save') : t('Post')}
          </Button>
        </Group>
      </Stack>
    </form>
  );
}
