import { useState } from 'react';
import { ActionIcon, Button, Card, Checkbox, Group, Modal, MultiSelect, NumberInput, Stack, Text, Textarea, TextInput, Title, Tooltip, Select } from '@mantine/core';
import { DateTimePicker } from '@mantine/dates';
import { useForm } from '@mantine/form';
import { modals } from '@mantine/modals';
import { IconFileText, IconListCheck, IconPaperclip, IconPencil, IconPlus, IconTrash } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { Link } from 'react-router';
import { Empty, Loading, Tag } from '../../components/ui';
import { fmtDateTime, fromNow, toDate } from '../../lib/format';
import { useAction, useMe } from '../../lib/hooks';
import { t } from '../../lib/i18n';
import { type Out, rpc } from '../../lib/rpc';
import { useVariant } from '../../lib/variants';
import { ReqInfo, WithInfo } from '../../components/ReqInfo';

type Assignment = Out<typeof rpc.assignments.list>[number];

// What the section's professor posts: instructions and a handout with a due date. Students
// open the handout, plan the work (ST2) and check it off; only the professor changes it.
// 'prof-plan-totals': how much students plan for this section, as totals only.
function PlanTotals({ classId }: { classId: number }) {
  const totals = useQuery({ queryKey: ['planner', 'classTotals', classId], queryFn: () => rpc.planner.classTotals({ classId }) });
  if (!totals.data) return null;
  return (
    <Text size="sm">
      Students have {totals.data.plans} plans for this section, adding up to {Math.round(totals.data.minutes / 6) / 10} hours of planned work. <ReqInfo id="nav-planner" />
    </Text>
  );
}

export function Assignments({ classId }: { classId: number }) {
  const planTotals = useVariant('prof-plan-totals');
  const studentsPost = useVariant('students-post-assignments');
  const list = useQuery({ queryKey: ['assignments', classId], queryFn: () => rpc.assignments.list({ classId }) });
  const info = useQuery({ queryKey: ['courses', 'info', classId], queryFn: () => rpc.courses.info({ classId }) });
  const [editing, setEditing] = useState<Assignment | 'new' | null>(null);

  if (list.isPending || !list.data || !info.data) return <Loading />;
  const teaching = info.data.teaching;

  return (
    <Stack gap="lg">
      {teaching && planTotals && <PlanTotals classId={classId} />}
      {(teaching || studentsPost) && (
        <Group justify="flex-end">
          <WithInfo id="assignment-post">
            <Button leftSection={<IconPlus size={16} />} onClick={() => setEditing('new')}>
              {t('Post an assignment')}
            </Button>
          </WithInfo>
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
      <Modal opened={editing != null} onClose={() => setEditing(null)} title={editing && editing !== 'new' ? <WithInfo id="assignment-manage">{t('Edit assignment')}</WithInfo> : <WithInfo id="assignment-post">{t('Post an assignment')}</WithInfo>} size="lg">
        {editing && <AssignmentForm classId={classId} teaching={teaching} existing={editing === 'new' ? null : editing} onDone={() => setEditing(null)} />}
      </Modal>
    </Stack>
  );
}

// 'extensions': a later due date for one student.
function ExtensionPicker({ id }: { id: number }) {
  const [open, setOpen] = useState(false);
  const [who, setWho] = useState<string | null>(null);
  const [until, setUntil] = useState<Date | string | null>(null);
  const people = useQuery({ queryKey: ['assignments', 'extensions', id], queryFn: () => rpc.assignments.extensions({ id }), enabled: open });
  const save = useAction(() => rpc.assignments.setExtension({ id, userId: Number(who), until: toDate(until) }), { success: () => 'Saved. They’ve been told.', onSuccess: () => setWho(null) });
  if (!open) {
    return (
      <WithInfo id="assignment-due">
        <Button size="xs" variant="default" onClick={() => setOpen(true)}>
          Give someone more time
        </Button>
      </WithInfo>
    );
  }
  const given = people.data?.filter((p) => p.until) ?? [];
  return (
    <Stack gap={4} w="100%">
      <Group gap="xs" align="flex-end">
        <Select size="xs" label="Student" searchable data={(people.data ?? []).map((p) => ({ value: String(p.id), label: p.name }))} value={who} onChange={setWho} />
        <DateTimePicker size="xs" label="New due date" valueFormat="ddd D MMM YYYY, HH:mm" clearable value={until} onChange={setUntil} />
        <Button size="xs" variant="default" disabled={!who} onClick={() => save.mutate()} loading={save.isPending}>
          Save
        </Button>
      </Group>
      {given.length > 0 && (
        <Text size="xs" c="dimmed">
          {given.map((p) => `${p.name}: ${fmtDateTime(new Date(p.until!))}`).join(' · ')}
        </Text>
      )}
    </Stack>
  );
}

function AssignmentCard({ assignment: a, teaching, onEdit }: { assignment: Assignment; teaching: boolean; onEdit: () => void }) {
  const me = useMe();
  const studentsPost = useVariant('students-post-assignments');
  const canExtend = useVariant('extensions');
  const notifiesRemoved = useVariant('notify-assignment-removed');
  const open = useAction(() => rpc.assignments.openFile({ id: a.id }));
  const setDone = useAction((done: boolean) => rpc.calendar.setDeadlineDone({ id: a.id, done }));
  const remove = useAction(() => rpc.assignments.remove({ id: a.id }), { success: 'Assignment removed' });
  const sendNow = useAction(() => rpc.assignments.update({ id: a.id, title: a.title, dueAt: a.dueAt, notes: a.notes ?? '', releaseAt: null, attachmentPath: null }), {
    success: 'Posted. Everyone in the section has been notified.',
  });
  const past = a.dueAt < new Date();
  const canSubmit = useVariant('submit-work');
  const planByHand = useVariant('plan-date-by-hand');
  const submissions = useQuery({ queryKey: ['calendar', 'submissions'], queryFn: () => rpc.calendar.submissions(), enabled: canSubmit });
  const submit = useAction(() => rpc.calendar.submit({ id: a.id }), { success: (r) => (r ? `Submitted ${r.name}` : '') });
  const submitted = submissions.data?.[a.id];

  const confirmRemove = () =>
    modals.openConfirmModal({
      title: <WithInfo id="assignment-manage">{t('Remove this assignment?')}</WithInfo>,
      children: <Text size="sm">{notifiesRemoved ? 'It comes off everyone’s calendar, the handout is deleted, and students are told.' : t("It comes off everyone's calendar, and the handout is deleted. Students aren't notified.")}</Text>,
      labels: { confirm: t('Remove'), cancel: t('Keep') },
      confirmProps: { color: 'red' },
      onConfirm: () => remove.mutate(),
    });

  return (
    <Card padding="lg">
      <Group justify="space-between" align="flex-start" wrap="nowrap">
        <div style={{ minWidth: 0 }}>
          <Title order={3} td={a.done ? 'line-through' : undefined}>
            {a.title} <ReqInfo id="assignment-card" />
          </Title>
          <Group gap="xs" mt={4}>
            <Text size="sm" c="dimmed">
              {t('Due {{when}}', { when: fmtDateTime(a.dueAt) })} · {fromNow(a.dueAt)}
            </Text>
            {past && <Tag color="gray">{t('Past due')}</Tag>}
            {a.extended && <Tag color="teal">Your own due date</Tag>}
            {a.releaseAt && (
              <WithInfo id="assignment-later">
                <Tag color="grape">{teaching ? t('Goes out {{when}}', { when: fmtDateTime(a.releaseAt) }) : `Draft, final ${fmtDateTime(a.releaseAt)}`}</Tag>
              </WithInfo>
            )}
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
            <ReqInfo id="assignment-manage" />
          </Group>
        ) : (
          <Group gap="xs" wrap="nowrap">
            {studentsPost && a.userId === me.id && (
          <Group gap={4} wrap="nowrap">
            <ActionIcon variant="subtle" onClick={onEdit} aria-label={t('Edit {{name}}', { name: a.title })}>
              <IconPencil size={16} />
            </ActionIcon>
            <ActionIcon variant="subtle" color="red" onClick={confirmRemove} aria-label={t('Delete {{name}}', { name: a.title })}>
              <IconTrash size={16} />
            </ActionIcon>
            <ReqInfo id="assignment-manage" />
          </Group>
            )}
          <WithInfo id="assignment-done">
            {canSubmit && (
              <Button size="xs" variant={submitted ? 'default' : 'filled'} mr="xs" onClick={() => submit.mutate()} loading={submit.isPending}>
                {submitted ? `Submitted: ${submitted}` : 'Submit your work'}
              </Button>
            )}
            <Tooltip label={a.done ? t('Mark as not done') : t('Mark as done')}>
              <Checkbox checked={a.done} onChange={(e) => setDone.mutate(e.currentTarget.checked)} aria-label={t('Mark {{title}} done', { title: a.title })} />
            </Tooltip>
          </WithInfo>
          </Group>
        )}
      </Group>
      {a.notes && (
        <Text mt="sm" style={{ whiteSpace: 'pre-wrap' }}>
          {a.notes}
        </Text>
      )}
      <Group gap="xs" mt="md">
        {a.attachmentName && (
          <WithInfo id="assignment-file">
            <Button size="xs" variant="light" leftSection={<IconPaperclip size={14} />} onClick={() => open.mutate()} loading={open.isPending}>
              {a.attachmentName}
            </Button>
          </WithInfo>
        )}
        {a.handoutLink && (
          <WithInfo id="assignment-file">
            <Button size="xs" variant="light" component="a" href={a.handoutLink} target="_blank" rel="noreferrer" leftSection={<IconPaperclip size={14} />}>
              The handout
            </Button>
          </WithInfo>
        )}
        {teaching && canExtend && <ExtensionPicker id={a.id} />}
        {a.who && !a.releaseAt && (
          <Text size="sm" c="dimmed">
            Checked off: {a.who.done.join(', ') || 'nobody yet'} · Not yet: {a.who.waiting.join(', ') || 'nobody'} <ReqInfo id="assignment-progress" />
          </Text>
        )}
        {!teaching && !planByHand && (a.planned || !past) && (
          <WithInfo id="assignment-plan">
            <Button size="xs" variant="default" leftSection={<IconListCheck size={14} />} component={Link} to={a.planned ? '/planner' : `/planner?new=1&from=deadline-${a.id}`}>
              {a.planned ? t('See my plan') : t('Plan it')}
            </Button>
          </WithInfo>
        )}
        {teaching && a.releaseAt && (
          <WithInfo id="assignment-later">
            <Button size="xs" variant="light" onClick={() => sendNow.mutate()} loading={sendNow.isPending}>
              {t('Send it out now')}
            </Button>
          </WithInfo>
        )}
        {a.progress && !a.releaseAt && (
          <Text size="sm" c="dimmed">
            {t('{{done}} of {{count}} students checked it off', { done: a.progress.done, count: a.progress.total })} <ReqInfo id="assignment-progress" />
          </Text>
        )}
      </Group>
    </Card>
  );
}

function AssignmentForm({ classId, teaching, existing, onDone }: { classId: number; teaching: boolean; existing: Assignment | null; onDone: () => void }) {
  const noWeight = useVariant('no-assignment-weight');
  const draftVisible = useVariant('draft-visible');
  const sharedAssignment = useVariant('shared-assignment');
  const linkOnly = useVariant('handout-link');
  const [file, setFile] = useState<{ path: string; name: string } | null>(null);
  // A professor's other sections, to post the same assignment to.
  const [also, setAlso] = useState<string[]>([]);
  const mine = useQuery({ queryKey: ['classes', 'mine'], queryFn: () => rpc.classes.mine() });
  const others = (mine.data ?? []).filter((c) => c.id !== classId);
  const form = useForm({
    initialValues: {
      title: existing?.title ?? '',
      dueAt: (existing?.dueAt ?? dayjs().add(14, 'day').hour(23).minute(59).second(0).toDate()) as Date | string | null,
      notes: existing?.notes ?? '',
      weight: '' as number | string,
      releaseAt: (existing?.releaseAt ?? null) as Date | string | null,
      handoutLink: existing?.handoutLink ?? '',
    },
    validate: {
      title: (v) => (v.trim() ? null : t('Name the assignment')),
      dueAt: (v) => (toDate(v) && (existing || toDate(v)! > new Date()) ? null : t('Pick a due date in the future')),
      handoutLink: (v) => (!v.trim() || /^https?:\/\//.test(v.trim()) ? null : 'Use a full link, starting with https://'),
    },
  });
  const choose = useAction(() => rpc.planner.chooseAttachment(), { onSuccess: (picked) => picked && setFile(picked) });
  const save = useAction(
    async (v: typeof form.values) => {
      const fields = { title: v.title, dueAt: toDate(v.dueAt)!, notes: v.notes, releaseAt: toDate(v.releaseAt), attachmentPath: file?.path ?? null, handoutLink: v.handoutLink.trim() || null };
      if (existing) {
        await rpc.assignments.update({ id: existing.id, ...fields });
        return [];
      }
      const weight = v.weight === '' ? null : Number(v.weight);
      await rpc.assignments.post({ classId, ...fields, weight });
      // One section not taking it (no room left in its scheme, say) doesn't undo the others.
      const failed: string[] = [];
      for (const id of also) {
        await rpc.assignments.post({ classId: Number(id), ...fields, weight }).catch(() => failed.push(others.find((c) => String(c.id) === id)?.code ?? id));
      }
      return failed;
    },
    {
      success: (failed) =>
        existing
          ? t('Assignment saved. Students are told if the due date moved.')
          : [toDate(form.values.releaseAt) ? (draftVisible ? 'Scheduled. Students see it as a draft until then.' : t('Scheduled. Students see nothing until then.')) : t('Posted. Everyone in the section has been notified.'), failed.length ? t('Not added: {{titles}}', { titles: failed.join(', ') }) : ''].filter(Boolean).join(' '),
      onSuccess: onDone,
    },
  );

  const fileName = file?.name ?? existing?.attachmentName;
  return (
    <form onSubmit={form.onSubmit((v) => save.mutate(v))}>
      <Stack>
        <TextInput label={<WithInfo id="assignment-post">{t('Assignment')}</WithInfo>} placeholder={t('Problem set 3')} data-autofocus {...form.getInputProps('title')} />
        <Group grow align="flex-end">
          <DateTimePicker label={<WithInfo id="assignment-due">{t('Due')}</WithInfo>} valueFormat="ddd D MMM YYYY, HH:mm" {...form.getInputProps('dueAt')} />
          {!existing && teaching && !noWeight && (
            <NumberInput
              label={<WithInfo id="assignment-weight">{t('Weight')}</WithInfo>}
              description={t('Adds it to the grading scheme. Leave empty if it isn’t graded.')}
              suffix="%"
              min={0}
              max={100}
              decimalScale={2}
              {...form.getInputProps('weight')}
            />
          )}
        </Group>
        <Textarea label={<WithInfo id="assignment-card">{t('Instructions')}</WithInfo>} autosize minRows={3} {...form.getInputProps('notes')} />
        {(!existing || existing.releaseAt) && (
          <DateTimePicker
            label={<WithInfo id="assignment-later">{t('Send it out later')}</WithInfo>}
            description={draftVisible ? 'Leave this empty to send it out now. Until then, students see it marked as a draft, with no notification.' : t('Leave this empty to send it out now. Until then, students see nothing and get no notification.')}
            placeholder={t('Now')}
            valueFormat="ddd D MMM YYYY, HH:mm"
            minDate={new Date()}
            clearable
            {...form.getInputProps('releaseAt')}
          />
        )}
        {!existing && teaching && !sharedAssignment && others.length > 0 && (
          <MultiSelect label={<WithInfo id="assignment-also">{t('Also post to')}</WithInfo>} placeholder={t('Optional')} data={others.map((c) => ({ value: String(c.id), label: c.code }))} value={also} onChange={setAlso} clearable />
        )}
        {linkOnly && <TextInput label={<WithInfo id="assignment-file">Link to the handout</WithInfo>} placeholder="https://mycourses2.mcgill.ca/…" {...form.getInputProps('handoutLink')} />}
        <Group gap="xs" display={linkOnly ? 'none' : undefined}>
          <WithInfo id="assignment-file">
            <Button variant="default" size="xs" leftSection={<IconPaperclip size={14} />} onClick={() => choose.mutate()}>
              {fileName ? t('Change file') : t('Attach the assignment file')}
            </Button>
          </WithInfo>
          {fileName && (
            <Text size="sm" c="dimmed">
              {fileName}
            </Text>
          )}
        </Group>
        {!linkOnly && (
          <Text size="xs" c="dimmed">
            {t('Students can read the numbered problems in a PDF, Word or text handout when they plan it.')}
          </Text>
        )}
        <Group justify="flex-end">
          <Button type="submit" loading={save.isPending}>
            {existing ? t('Save') : t('Post')}
          </Button>
        </Group>
      </Stack>
    </form>
  );
}
