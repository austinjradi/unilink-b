import { useEffect, useState } from 'react';
import { ActionIcon, Box, Button, Grid, Group, Modal, Select, Stack, Text, Textarea, TextInput, UnstyledButton } from '@mantine/core';
import { TimeInput } from '@mantine/dates';
import { useForm } from '@mantine/form';
import { modals } from '@mantine/modals';
import { IconFileImport, IconPlus, IconTrash, IconUsers, IconPaperclip } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router';
import dayjs from 'dayjs';
import { finalExamFor } from '@shared/keyDates';
import { Empty, kindColor, Loading, SectionCard, Tag } from '../../components/ui';
import { SyllabusImport } from '../Calendar';
import { fromNow } from '../../lib/format';
import { useAction } from '../../lib/hooks';
import { type Out, rpc } from '../../lib/rpc';
import { t } from '../../lib/i18n';

type Info = Out<typeof rpc.courses.info>;
type Meeting = { weekday: number; startTime: string; endTime: string; location: string };
type Editor = Info['detailsEditedBy'];

// Monday first, in the current language.
const weekdayOptions = () =>
  [1, 2, 3, 4, 5, 6, 0].map((i) => {
    const name = dayjs().day(i).format('dddd');
    return { value: String(i), label: name[0].toUpperCase() + name.slice(1) };
  });

const editorName = (editor: NonNullable<Editor>) => (editor.former ? t('a former student') : editor.name);

// "Shared with COMP 251-001 · edited by Priya Shah 3 days ago"
function SharedNote({ code, editor, when }: { code: string; editor: Editor; when?: Date | null }) {
  return (
    <Text size="xs" c="dimmed" ta="right">
      {t('Shared with {{code}}', { code })}
      {editor && ` · ${when ? t('edited by {{name}} {{when}}', { name: editorName(editor), when: fromNow(when) }) : t('added by {{name}}', { name: editorName(editor) })}`}
    </Text>
  );
}

// A5 course details (shared) + private notes + A3 class times (shared) + S1 classmates and leave.
export function Overview({ classId, cls }: { classId: number; cls: Out<typeof rpc.classes.get> }) {
  const info = useQuery({ queryKey: ['courses', 'info', classId], queryFn: () => rpc.courses.info({ classId }) });
  if (info.isPending || !info.data) return <Loading />;
  return (
    <Grid gap="lg">
      <Grid.Col span={{ base: 12, lg: 7 }}>
        <Stack gap="lg">
          <CourseDetails classId={classId} code={cls.code} info={info.data} />
          <ClassTimes classId={classId} code={cls.code} initial={info.data.meetings} editor={info.data.meetingsEditedBy} canEdit={info.data.canEdit} />
          <MyNotes classId={classId} initial={info.data.notes} />
        </Stack>
      </Grid.Col>
      <Grid.Col span={{ base: 12, lg: 5 }}>
        <Stack gap="lg">
          <ComingUp classId={classId} exam={finalExamFor(`${cls.subject} ${cls.number}`, cls.term)} />
          <MembershipCard cls={cls} />
        </Stack>
      </Grid.Col>
    </Grid>
  );
}

function CourseDetails({ classId, code, info }: { classId: number; code: string; info: Info }) {
  const form = useForm({
    initialValues: {
      professor: info.professor,
      professorEmail: info.professorEmail,
      officeHours: info.officeHours,
      location: info.location,
    },
  });
  const readOnly = !info.canEdit;
  const openOutline = useAction(() => rpc.courses.openOutline({ classId }));
  const attachOutline = useAction(async () => {
    const file = await rpc.planner.chooseAttachment();
    if (file) await rpc.courses.attachOutline({ classId, path: file.path });
  });
  const removeOutline = useAction(() => rpc.courses.removeOutline({ classId }));
  const save = useAction((v: typeof form.values) => rpc.courses.saveDetails({ classId, ...v }), {
    success: 'Course details saved for the whole section',
    onSuccess: (_d, v) => form.resetDirty(v),
  });

  return (
    <SectionCard title={t('Course details')} actions={<SharedNote code={code} editor={info.detailsEditedBy} when={info.detailsEditedAt} />}>
      <form onSubmit={form.onSubmit((v) => save.mutate(v))}>
        <Stack>
          <Group grow>
            <TextInput label={t('Professor')} placeholder={t('Prof. Jane Doe')} readOnly={readOnly} {...form.getInputProps('professor')} />
            <TextInput label={t('Professor email')} placeholder={t('jane.doe@mcgill.ca')} readOnly={readOnly} {...form.getInputProps('professorEmail')} />
          </Group>
          <Group grow>
            <TextInput label={t('Office hours')} placeholder={t('Tue 14:00–15:30, McConnell 110N')} readOnly={readOnly} {...form.getInputProps('officeHours')} />
            <TextInput label={t('Lecture location')} placeholder={t('Leacock 132')} readOnly={readOnly} {...form.getInputProps('location')} />
          </Group>
          {(info.outlineName || !readOnly) && (
            <Group gap="xs">
              {info.outlineName && (
                <Button size="xs" variant="light" leftSection={<IconPaperclip size={14} />} onClick={() => openOutline.mutate()} loading={openOutline.isPending}>
                  {info.outlineName}
                </Button>
              )}
              {!readOnly && (
                <Button size="xs" variant="default" onClick={() => attachOutline.mutate()} loading={attachOutline.isPending}>
                  {info.outlineName ? t('Replace the course outline') : t('Attach the course outline')}
                </Button>
              )}
              {!readOnly && info.outlineName && (
                <Button size="xs" variant="subtle" color="red" onClick={() => removeOutline.mutate()}>
                  {t('Remove')}
                </Button>
              )}
            </Group>
          )}
          <Group justify="space-between">
            <Text size="xs" c="dimmed">
              {readOnly ? t('Your professor keeps these up to date.') : info.teaching ? t('Everyone in the section sees these.') : t('Anyone in the section can fill these in or fix them.')}
            </Text>
            {!readOnly && (
              <Button type="submit" disabled={!form.isDirty()} loading={save.isPending}>
                {t('Save details')}
              </Button>
            )}
          </Group>
        </Stack>
      </form>
    </SectionCard>
  );
}

function MyNotes({ classId, initial }: { classId: number; initial: string }) {
  const [notes, setNotes] = useState(initial);
  useEffect(() => setNotes(initial), [initial]);
  const save = useAction(() => rpc.courses.saveNotes({ classId, notes }), { success: 'Notes saved' });
  return (
    <SectionCard title={t('My notes')} actions={<Text size="xs" c="dimmed">{t('Only you see these')}</Text>}>
      <Stack>
        <Textarea autosize minRows={2} placeholder={t('Syllabus highlights, TA names…')} value={notes} onChange={(e) => setNotes(e.currentTarget.value)} aria-label={t('My notes')} />
        <Group justify="flex-end">
          <Button onClick={() => save.mutate()} disabled={notes === initial} loading={save.isPending}>
            {t('Save notes')}
          </Button>
        </Group>
      </Stack>
    </SectionCard>
  );
}

function ClassTimes({ classId, code, initial, editor, canEdit }: { classId: number; code: string; initial: Meeting[]; editor: Editor; canEdit: boolean }) {
  const strip = (ms: Meeting[]) => ms.map(({ weekday, startTime, endTime, location }) => ({ weekday, startTime, endTime, location }));
  const [rows, setRows] = useState<Meeting[]>(strip(initial));
  useEffect(() => setRows(strip(initial)), [initial]);
  const dirty = JSON.stringify(rows) !== JSON.stringify(strip(initial));

  const save = useAction(() => rpc.courses.saveMeetings({ classId, meetings: rows }), {
    success: 'Class times saved. They now show on everyone’s calendar in this section.',
  });
  const update = (i: number, patch: Partial<Meeting>) => setRows((r) => r.map((m, j) => (j === i ? { ...m, ...patch } : m)));

  return (
    <SectionCard
      title={t('Class times')}
      actions={
        <Group gap="sm">
          <SharedNote code={code} editor={editor} />
          {canEdit && (
            <Button
              size="xs"
              variant="light"
              leftSection={<IconPlus size={14} />}
              onClick={() => setRows((r) => [...r, { weekday: 1, startTime: '10:00', endTime: '11:30', location: '' }])}
            >
              {t('Add time')}
            </Button>
          )}
        </Group>
      }
    >
      <Stack gap="xs">
        {rows.length === 0 && (
          <Text size="sm" c="dimmed">
            {canEdit
              ? t("Nobody has added this section's lectures, tutorials or labs yet. Add them once and they show on everyone's calendar.")
              : t("Your professor hasn't added this section's class times yet.")}
          </Text>
        )}
        {rows.map((m, i) => (
          <Group key={i} gap="xs" wrap="nowrap" align="flex-end">
            <Select
              data={weekdayOptions()}
              value={String(m.weekday)}
              onChange={(v) => v && update(i, { weekday: Number(v) })}
              w={130}
              disabled={!canEdit}
              allowDeselect={false}
              aria-label={t('Day')}
            />
            <TimeInput value={m.startTime} onChange={(e) => update(i, { startTime: e.currentTarget.value })} aria-label={t('Start')} w={110} readOnly={!canEdit} />
            <Text c="dimmed">–</Text>
            <TimeInput value={m.endTime} onChange={(e) => update(i, { endTime: e.currentTarget.value })} aria-label={t('End')} w={110} readOnly={!canEdit} />
            <TextInput
              placeholder={t('Location')}
              value={m.location}
              onChange={(e) => update(i, { location: e.currentTarget.value })}
              style={{ flex: 1 }}
              aria-label={t('Location')}
              readOnly={!canEdit}
            />
            {canEdit && (
              <ActionIcon variant="subtle" color="red" onClick={() => setRows((r) => r.filter((_, j) => j !== i))} aria-label={t('Remove')} mb={4}>
                <IconTrash size={16} />
              </ActionIcon>
            )}
          </Group>
        ))}
        {canEdit && (dirty || rows.length > 0) && (
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

// What's next in this class: its deadlines and graded work (A3/A5) and study sessions (S3).
function ComingUp({ classId, exam }: { classId: number; exam: ReturnType<typeof finalExamFor> }) {
  const navigate = useNavigate();
  const [importing, setImporting] = useState(false);
  const due = useQuery({ queryKey: ['calendar', 'upcoming', 60], queryFn: () => rpc.calendar.upcoming({ days: 60 }) });
  const sessions = useQuery({ queryKey: ['studySessions', classId], queryFn: () => rpc.studySessions.list({ classId }) });
  if (due.isPending || sessions.isPending) return null;
  const items = [
    ...(due.data ?? [])
      .filter((e) => e.classId === classId && e.detail !== 'final')
      .map((e) => ({ key: e.key, title: e.title, when: e.start, kind: e.detail, to: e.detail === 'graded' ? 'grades' : null })),
    ...(sessions.data ?? []).map((s) => ({ key: `s${s.id}`, title: s.title, when: s.startsAt, kind: 'session', to: 'sessions' })),
  ]
    .sort((a, b) => a.when.getTime() - b.when.getTime())
    .slice(0, 6);

  return (
    <SectionCard
      title={t('Coming up')}
      actions={
        <Button size="compact-xs" variant="subtle" leftSection={<IconFileImport size={14} />} onClick={() => setImporting(true)}>
          {t('Dates from a syllabus')}
        </Button>
      }
    >
      <Modal opened={importing} onClose={() => setImporting(false)} title={t('Import dates from a syllabus')} size="xl">
        {importing && <SyllabusImport initialClassId={classId} onDone={() => setImporting(false)} />}
      </Modal>
      {items.length ? (
        <Stack gap={4}>
          {items.map((i) => (
            <UnstyledButton
              key={i.key}
              className="clickable"
              px={6}
              py={4}
              style={{ borderRadius: 8 }}
              onClick={() => navigate(i.to ? `/classes/${classId}/${i.to}` : '/calendar')}
            >
              <Group gap="sm" wrap="nowrap">
                <Box w={9} h={9} style={{ flex: 'none', borderRadius: 9, background: `var(--mantine-color-${kindColor(i.kind)}-4)` }} />
                <Text size="sm" fw={700} style={{ flex: 1, minWidth: 0 }} truncate>
                  {i.title}
                </Text>
                <Text size="xs" c="dimmed" style={{ whiteSpace: 'nowrap' }}>
                  {dayjs(i.when).format(t('ddd, MMM D · HH:mm'))}
                </Text>
              </Group>
            </UnstyledButton>
          ))}
        </Stack>
      ) : (
        <Text size="sm" c="dimmed">
          {t('Nothing due and no study sessions planned yet.')}
        </Text>
      )}
      {/* A3: from the exam schedule (Calendar → Key dates). */}
      {exam && (
        <UnstyledButton className="clickable" px={6} py={4} mt={6} style={{ borderRadius: 8 }} onClick={() => navigate('/calendar')}>
          <Group gap="sm" wrap="nowrap">
            <Box w={9} h={9} style={{ flex: 'none', borderRadius: 9, background: 'var(--mantine-color-red-4)' }} />
            <Text size="sm" fw={800} style={{ flex: 1, minWidth: 0 }} truncate>
              {t('Final exam')} · {exam.location}
            </Text>
            <Text size="xs" c="dimmed" style={{ whiteSpace: 'nowrap' }}>
              {dayjs(exam.date).format(t('ddd, MMM D'))} · {exam.start}
            </Text>
          </Group>
        </UnstyledButton>
      )}
    </SectionCard>
  );
}

function MembershipCard({ cls }: { cls: Out<typeof rpc.classes.get> }) {
  const navigate = useNavigate();
  const classmates = useQuery({ queryKey: ['classes', 'classmates', cls.id], queryFn: () => rpc.classes.classmates({ classId: cls.id }) });
  const leave = useAction(() => rpc.classes.leave({ classId: cls.id }), {
    success: t('Left {{code}}', { code: cls.code }),
    onSuccess: () => navigate('/classes'),
  });

  const confirmLeave = () =>
    modals.openConfirmModal({
      title: t('Leave {{code}}?', { code: cls.code }),
      children: (
        <Text size="sm">
          {cls.teaching
            ? t("What you posted stays with the section. If no other professor teaches it, its students go back to editing the shared course info together.")
            : t("You'll stop seeing its group chats, sessions and discussion. Sessions you're hosting pass to the next person going. What you added to the shared course info stays with the section; your notes, marks and private deadlines are kept in case you rejoin.")}
        </Text>
      ),
      labels: { confirm: cls.teaching ? t('Stop teaching') : t('Leave class'), cancel: t('Stay') },
      confirmProps: { color: 'red' },
      onConfirm: () => leave.mutate(),
    });

  const others = cls.sections.filter((s) => s.id !== cls.id);

  return (
    <SectionCard title={cls.teaching ? t('Your students') : t('Your classmates')}>
      <Text size="sm" mb="xs">
        {t('{{count}} students from {{code}} are on UniLink.', { count: cls.memberCount, code: cls.code })}
      </Text>
      <Text size="sm" c="dimmed" mb="md">
        {cls.teaching
          ? t("There's no class list here. A student's name, email, pronouns and faculty appear once they post or reply on the discussion board.")
          : t("There's no member list. A classmate's name, email, pronouns and faculty appear here once they post or reply on the discussion board.")}
      </Text>
      {classmates.data?.length ? (
        <Stack gap="xs" mb="lg">
          {classmates.data.map((c) => (
            <div key={c.id}>
              <Text size="sm" fw={700}>
                {c.name} {c.role === 'professor' && <Tag color="periwinkle">{t('Professor')}</Tag>}
                {c.pronouns && (
                  <Text span size="xs" c="dimmed" fw={500}>
                    {' '}
                    ({c.pronouns})
                  </Text>
                )}
              </Text>
              <Text size="xs" c="dimmed">
                {[c.email, c.faculty && t(c.faculty)].filter(Boolean).join(' · ')}
              </Text>
            </div>
          ))}
        </Stack>
      ) : (
        <Empty icon={<IconUsers size={22} />}>{t('Nobody has posted yet.')}</Empty>
      )}
      <Group>
        <Button variant="light" color="red" onClick={confirmLeave}>
          {cls.teaching ? t('Stop teaching') : t('Leave class')}
        </Button>
        {others.map((s) => (
          <Button key={s.id} variant="default" component={Link} to={`/classes/${s.id}`}>
            {t('See section {{section}}', { section: s.section })}
          </Button>
        ))}
      </Group>
    </SectionCard>
  );
}
