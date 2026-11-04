import { useEffect, useState } from 'react';
import { ActionIcon, Box, Button, Grid, Group, Modal, Select, Stack, Text, Textarea, TextInput, UnstyledButton, CopyButton, Tooltip, Card, Checkbox } from '@mantine/core';
import { TimeInput } from '@mantine/dates';
import { useForm } from '@mantine/form';
import { modals } from '@mantine/modals';
import { IconFileImport, IconPlus, IconTrash, IconUsers, IconPaperclip, IconLink } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router';
import dayjs from 'dayjs';
import { finalExamFor } from '@shared/keyDates';
import { Empty, kindColor, Loading, SectionCard, Tag } from '../../components/ui';
import { SyllabusImport } from '../Calendar';
import { fromNow } from '../../lib/format';
import { useAction } from '../../lib/hooks';
import { type Out, rpc } from '../../lib/rpc';
import { joinCodeFor } from '@shared/joinCode';
import { t } from '../../lib/i18n';
import { useShowCount, useVariant } from '../../lib/variants';
import { ClassListOptOut } from '../../components/ClassListOptOut';
import { ReqInfo, WithInfo } from '../../components/ReqInfo';

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
      {editor && ` · ${when ? t('edited by {{name}} {{when}}', { name: editorName(editor), when: fromNow(when) }) : t('added by {{name}}', { name: editorName(editor) })}`}{' '}
      <ReqInfo id="shared-note" />
    </Text>
  );
}

// A5 course details (shared) + private notes + A3 class times (shared) + S1 classmates and leave.
export function Overview({ classId, cls }: { classId: number; cls: Out<typeof rpc.classes.get> }) {
  const info = useQuery({ queryKey: ['courses', 'info', classId], queryFn: () => rpc.courses.info({ classId }) });
  const comingUpOnlyOnCalendar = useVariant('coming-up-only-on-calendar');
  const onMyCourses = useVariant('course-info-on-mycourses');
  const noNotes = useVariant('no-my-notes');
  const hideKeyDates = useVariant('hide-key-dates');
  const manualFinals = useVariant('manual-final-exams');
  const noFinal = hideKeyDates || manualFinals;
  if (info.isPending || !info.data) return <Loading />;
  return (
    <Grid gap="lg">
      <Grid.Col span={{ base: 12, lg: 7 }}>
        <Stack gap="lg">
          {onMyCourses ? (
            <SectionCard info="tab-overview" title={t('Course details')}>
              <Button component="a" href="https://mycourses2.mcgill.ca" target="_blank" rel="noopener noreferrer" variant="default">
                Open this course on myCourses
              </Button>
            </SectionCard>
          ) : (
            <CourseDetails classId={classId} code={cls.code} info={info.data} />
          )}
          <ClassTimes classId={classId} code={cls.code} initial={info.data.meetings} editor={info.data.meetingsEditedBy} canEdit={info.data.canEdit} />
          {!noNotes && <MyNotes classId={classId} initial={info.data.notes} sharing={info.data.sharingNotes} others={info.data.sharedNotes} />}
        </Stack>
      </Grid.Col>
      <Grid.Col span={{ base: 12, lg: 5 }}>
        <Stack gap="lg">
          {comingUpOnlyOnCalendar ? (
            <SectionCard info="coming-up" title={t('Coming up')}>
              <Button component={Link} to="/calendar" variant="default">
                {t('Calendar')}
              </Button>
            </SectionCard>
          ) : (
            <ComingUp classId={classId} exam={noFinal ? null : finalExamFor(`${cls.subject} ${cls.number}`, cls.term, cls.section)} />
          )}
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
  const personal = useVariant('personal-class-times');
  const linkOutline = useVariant('link-outline');
  const readOnly = !info.canEdit && !personal;
  const approve = useAction(() => rpc.courses.approveDetails({ classId }));
  const setLink = useAction((url: string) => rpc.courses.setOutlineLink({ classId, url }));
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
    <SectionCard info="course-details" title={t('Course details')} actions={<SharedNote code={code} editor={info.detailsEditedBy} when={info.detailsEditedAt} />}>
      <form onSubmit={form.onSubmit((v) => save.mutate(v))}>
        <Stack>
          <Group grow>
            <TextInput label={<WithInfo id="detail-professor">{t('Professor')}</WithInfo>} placeholder={t('Prof. Jane Doe')} readOnly={readOnly} {...form.getInputProps('professor')} />
            <TextInput label={<WithInfo id="detail-professor">{t('Professor email')}</WithInfo>} placeholder={t('jane.doe@mcgill.ca')} readOnly={readOnly} {...form.getInputProps('professorEmail')} />
          </Group>
          <Group grow>
            <TextInput label={<WithInfo id="detail-office-hours">{t('Office hours')}</WithInfo>} placeholder={t('Tue 14:00–15:30, McConnell 110N')} readOnly={readOnly} {...form.getInputProps('officeHours')} />
            <TextInput label={<WithInfo id="detail-location">{t('Lecture location')}</WithInfo>} placeholder={t('Leacock 132')} readOnly={readOnly} {...form.getInputProps('location')} />
          </Group>
          {info.proposedDetails && (
            <Group justify="space-between">
              <Text size="sm">
                Proposed: {[info.proposedDetails.details.professor, info.proposedDetails.details.officeHours, info.proposedDetails.details.location].filter(Boolean).join(' · ')}
              </Text>
              {info.proposedDetails.mine ? (
                <Text size="xs" c="dimmed">
                  Waiting for a classmate's approval
                </Text>
              ) : (
                <Button size="compact-xs" onClick={() => approve.mutate()}>
                  Approve
                </Button>
              )}
            </Group>
          )}
          {linkOutline && (
            <Group gap="xs" align="flex-end">
              <TextInput style={{ flex: 1 }} label={<WithInfo id="detail-outline">Link to the outline</WithInfo>} placeholder="https://mycourses2.mcgill.ca/…" defaultValue={info.outlineLink} readOnly={readOnly} onBlur={(e) => e.currentTarget.value !== info.outlineLink && setLink.mutate(e.currentTarget.value)} />
              {info.outlineLink && (
                <Button size="xs" variant="light" component="a" href={info.outlineLink} target="_blank" rel="noopener noreferrer">
                  Open
                </Button>
              )}
            </Group>
          )}
          {!linkOutline && (info.outlineName || !readOnly) && (
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
              <ReqInfo id="detail-outline" />
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

function MyNotes({ classId, initial, sharing, others }: { classId: number; initial: string; sharing: boolean; others: { name: string; notes: string }[] }) {
  const canShare = useVariant('share-my-notes');
  const share = useAction((on: boolean) => rpc.courses.shareNotes({ classId, share: on }));
  const [notes, setNotes] = useState(initial);
  useEffect(() => setNotes(initial), [initial]);
  const save = useAction(() => rpc.courses.saveNotes({ classId, notes }), { success: 'Notes saved' });
  return (
    <SectionCard info="my-notes" title={t('My notes')} actions={<Text size="xs" c="dimmed">{t('Only you see these')}</Text>}>
      {canShare && <Checkbox mb="xs" label="Share my notes with the section" checked={sharing} onChange={(e) => share.mutate(e.currentTarget.checked)} />}
      {canShare && others.map((other) => (
        <Text key={other.name} size="sm" mb="xs" style={{ whiteSpace: 'pre-wrap' }}>
          <b>{other.name}:</b> {other.notes}
        </Text>
      ))}
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

function ClassTimes({ classId, code, initial, editor, canEdit: canEditShared }: { classId: number; code: string; initial: Meeting[]; editor: Editor; canEdit: boolean }) {
  const strip = (ms: Meeting[]) => ms.map(({ weekday, startTime, endTime, location }) => ({ weekday, startTime, endTime, location }));
  const [rows, setRows] = useState<Meeting[]>(strip(initial));
  useEffect(() => setRows(strip(initial)), [initial]);
  const dirty = JSON.stringify(rows) !== JSON.stringify(strip(initial));

  const personal = useVariant('personal-class-times');
  const canEdit = canEditShared || personal;
  const needsApproval = useVariant('approve-shared-changes');
  const info = useQuery({ queryKey: ['courses', 'info', classId], queryFn: () => rpc.courses.info({ classId }), enabled: needsApproval });
  const approve = useAction(() => rpc.courses.approveMeetings({ classId }));
  const save = useAction(() => rpc.courses.saveMeetings({ classId, meetings: rows }), {
    success: personal ? () => 'Saved. Only you see these times.' : needsApproval ? () => 'Sent. Someone else in the section has to approve them.' : () => t('Class times saved. They now show on everyone’s calendar in this section.'),
  });
  const update = (i: number, patch: Partial<Meeting>) => setRows((r) => r.map((m, j) => (j === i ? { ...m, ...patch } : m)));

  return (
    <SectionCard
      info="class-times"
      title={personal ? 'Your class times' : t('Class times')}
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
            <ReqInfo id="class-time-row" />
            {canEdit && (
              <ActionIcon variant="subtle" color="red" onClick={() => setRows((r) => r.filter((_, j) => j !== i))} aria-label={t('Remove')} mb={4}>
                <IconTrash size={16} />
              </ActionIcon>
            )}
          </Group>
        ))}
        {info.data?.proposedTimes && (
          <Card padding="sm" mt="xs" style={{ background: 'var(--ul-soft)' }}>
            <Group justify="space-between">
              <Text size="sm">
                Proposed: {info.data.proposedTimes.meetings.map((m) => `${dayjs().day(m.weekday).format('ddd')} ${m.startTime}–${m.endTime}`).join(', ')}
              </Text>
              {info.data.proposedTimes.mine ? (
                <Text size="xs" c="dimmed">
                  Waiting for a classmate's approval
                </Text>
              ) : (
                <Button size="compact-xs" onClick={() => approve.mutate()}>
                  Approve
                </Button>
              )}
            </Group>
          </Card>
        )}
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
  const noSyllabus = useVariant('no-syllabus-import');
  const professorDates = useVariant('professor-enters-dates');
  const due = useQuery({ queryKey: ['calendar', 'upcoming', 60], queryFn: () => rpc.calendar.upcoming({ days: 60 }) });
  const sessions = useQuery({ queryKey: ['studySessions', classId], queryFn: () => rpc.studySessions.list({ classId }) });
  const polls = useQuery({ queryKey: ['timePolls', classId], queryFn: () => rpc.timePolls.list({ classId }) });
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
      info="coming-up"
      title={t('Coming up')}
      actions={
        !noSyllabus &&
        !professorDates && (
          <WithInfo id="syllabus-import">
            <Button size="compact-xs" variant="subtle" leftSection={<IconFileImport size={14} />} onClick={() => setImporting(true)}>
              {t('Dates from a syllabus')}
            </Button>
          </WithInfo>
        )
      }
    >
      <Modal opened={importing} onClose={() => setImporting(false)} title={<WithInfo id="syllabus-import">{t('Import dates from a syllabus')}</WithInfo>} size="xl">
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
      {/* S3: a time still being worked out has no date to sort by. */}
      {polls.data?.map((poll) => (
        <UnstyledButton key={poll.id} className="clickable" px={6} py={4} mt={6} style={{ borderRadius: 8 }} onClick={() => navigate(`/classes/${classId}/sessions`)}>
          <Group gap="sm" wrap="nowrap">
            <Box w={9} h={9} style={{ flex: 'none', borderRadius: 9, background: `var(--mantine-color-${kindColor('session')}-4)` }} />
            <Text size="sm" fw={700} style={{ flex: 1, minWidth: 0 }} truncate>
              {t('When works for “{{title}}”?', { title: poll.title })} <ReqInfo id="poll-card" />
            </Text>
            <Text size="xs" c="dimmed" style={{ whiteSpace: 'nowrap' }}>
              {poll.options.some((o) => o.voted) ? t('Answered') : t('Answer')}
            </Text>
          </Group>
        </UnstyledButton>
      ))}
      {/* A3: from the exam schedule (Calendar → Key dates). */}
      {exam && (
        <UnstyledButton className="clickable" px={6} py={4} mt={6} style={{ borderRadius: 8 }} onClick={() => navigate('/calendar')}>
          <Group gap="sm" wrap="nowrap">
            <Box w={9} h={9} style={{ flex: 'none', borderRadius: 9, background: 'var(--mantine-color-red-4)' }} />
            <Text size="sm" fw={800} style={{ flex: 1, minWidth: 0 }} truncate>
              {t('Final exam')} · {exam.location} <ReqInfo id="final-exam" />
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
  const joinCode = useVariant('join-code');
  const navigate = useNavigate();
  const showCount = useShowCount();
  const versionA = useVariant('classmates-version-a');
  const listMembers = useVariant('list-members');
  const fullList = useVariant('full-class-list');
  const deleteOnLeave = useVariant('delete-on-leave');
  const classmates = useQuery({ queryKey: ['classes', 'classmates', cls.id], queryFn: () => rpc.classes.classmates({ classId: cls.id }) });
  const leave = useAction(() => rpc.classes.leave({ classId: cls.id }), {
    success: t('Left {{code}}', { code: cls.code }),
    onSuccess: () => navigate('/classes'),
  });

  const confirmLeave = () =>
    modals.openConfirmModal({
      title: <WithInfo id="leave-class">{t('Leave {{code}}?', { code: cls.code })}</WithInfo>,
      children: (
        <Text size="sm">
          {cls.teaching
            ? t("What you posted stays with the section. If no other professor teaches it, its students go back to editing the shared course info together.")
            : deleteOnLeave
              ? "Your posts, replies, group chat links, the sessions you host and your deadlines in this section will be deleted. This can't be undone. The shared course info stays, since other students' marks depend on it."
              : t("You'll stop seeing its group chats, sessions and discussion. Sessions you're hosting pass to the next person going. What you added to the shared course info stays with the section; your notes, marks and private deadlines are kept in case you rejoin.")}
        </Text>
      ),
      labels: { confirm: cls.teaching ? t('Stop teaching') : t('Leave class'), cancel: t('Stay') },
      confirmProps: { color: 'red' },
      onConfirm: () => leave.mutate(),
    });

  const others = cls.sections.filter((s) => s.id !== cls.id);

  return (
    <SectionCard info="classmates-card" title={cls.teaching ? t('Your students') : t('Your classmates')}>
      {showCount(cls.memberCount) && (
        <Text size="sm" mb="xs">
          {t('{{count}} students from {{code}} are on UniLink.', { count: cls.memberCount, code: cls.code })} <ReqInfo id="course-members" />
        </Text>
      )}
      <Text size="sm" c="dimmed" mb="md">
        {listMembers
          ? 'Everyone in this section, except anyone who has opted out.'
          : cls.teaching && fullList
            ? 'Everyone enrolled in this section.'
            : versionA
              ? "A classmate's name and email appear here once they post, reply or join a study session."
              : cls.teaching
                ? t("There's no class list here. A student's name, email, pronouns and faculty appear once they post or reply on the discussion board.")
                : t("There's no member list. A classmate's name, email, pronouns and faculty appear here once they post or reply on the discussion board.")}
      </Text>
      {listMembers && !cls.teaching && <ClassListOptOut />}
      {classmates.data?.length ? (
        <Stack gap="xs" mb="lg">
          {classmates.data.map((c) => (
            <div key={c.id}>
              <Text size="sm" fw={700}>
                {c.name} <ReqInfo id="author-card" /> {c.role === 'professor' && <Tag color="periwinkle">{t('Professor')}</Tag>}
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
        {cls.teaching && (
          <WithInfo id="copy-class-link">
            <CopyButton value={joinCode ? joinCodeFor(cls.id) : `${window.location.href.split('#')[0]}#/classes/${cls.id}`}>
              {({ copied, copy }) => (
                <Tooltip label={joinCode ? 'Students type it on the Find page to open this section.' : t('Put it on your syllabus: it opens this section, with a button to join.')}>
                  <Button variant="default" leftSection={<IconLink size={16} />} onClick={copy}>
                    {copied ? t('Copied') : joinCode ? `Join code: ${joinCodeFor(cls.id)}` : t('Copy a link for students')}
                  </Button>
                </Tooltip>
              )}
            </CopyButton>
          </WithInfo>
        )}
        <WithInfo id="leave-class">
          <Button variant="light" color="red" onClick={confirmLeave}>
            {cls.teaching ? t('Stop teaching') : t('Leave class')}
          </Button>
        </WithInfo>
        {others.map((s) => (
          <WithInfo key={s.id} id="sections-list">
            <Button variant="default" component={Link} to={`/classes/${s.id}`}>
              {t('See section {{section}}', { section: s.section })}
            </Button>
          </WithInfo>
        ))}
      </Group>
    </SectionCard>
  );
}
