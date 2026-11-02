import { useState } from 'react';
import {
  ActionIcon,
  Anchor,
  Autocomplete,
  Button,
  Card,
  Checkbox,
  Code,
  CopyButton,
  Divider,
  Drawer,
  Group,
  Modal,
  NumberInput,
  SegmentedControl,
  Select,
  Stack,
  Text,
  Textarea,
  TextInput,
  Title,
  Tooltip,
} from '@mantine/core';
import { DateTimePicker } from '@mantine/dates';
import { useForm } from '@mantine/form';
import { modals } from '@mantine/modals';
import { IconCalendarPlus, IconClock, IconKey, IconLock, IconMapPin, IconMessageDots, IconVideo } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router';
import dayjs from 'dayjs';
import { fmtDateTime, toDate } from '../lib/format';
import { useAction } from '../lib/hooks';
import { type Out, rpc } from '../lib/rpc';
import { GoatAvatar } from './Goat';
import { Empty, Loading, Tag } from './ui';
import { t, tx } from '../lib/i18n';
import { toStoredTopic } from './Feed';

// S3 study sessions in the layout of the wireframes (A2Team.pdf p. 12–13): rows with the
// class and type tags, when and where, how many are going, and a join/details action.

export type Session = Out<typeof rpc.studySessions.list>[number];

// Stored in English (so search and tags match for everyone), shown translated.
export const SESSION_TAGS = [tx('Assignment'), tx('Midterm'), tx('Final'), tx('Lab'), tx('Project'), tx('Review'), tx('Office hours')];

function when(s: Session) {
  const start = dayjs(s.startsAt);
  return `${start.format('D MMMM HH:mm')}–${dayjs(s.endsAt).format(start.isSame(s.endsAt, 'day') ? 'HH:mm' : 'D MMM HH:mm')}`;
}

const place = (s: Session) => (s.format === 'online' ? t('Online') : s.location);

const joinedMessage = (r: { status: string; weeks?: number }) =>
  r.weeks && r.weeks > 1
    ? t("You joined {{count}} weeks. Where one is full, you're on its waitlist.", { count: r.weeks })
    : r.status === 'going'
      ? t("You're going!")
      : t("It's full, so you're on the waitlist. We'll tell you if a spot opens up.");

export function SessionRow({ session: s, onDetails }: { session: Session; onDetails: () => void }) {
  const join = useAction(() => rpc.studySessions.join({ sessionId: s.id }), { success: joinedMessage });
  return (
    <Group wrap="nowrap" py="md" gap="lg" align="center" style={{ borderBottom: '1.5px solid var(--ul-border)' }}>
      <div style={{ flex: 1.4, minWidth: 0 }}>
        <Group gap={6} mb={6}>
          <Tag>{s.classLabel}</Tag>
          {s.tag && <Tag color="periwinkle">{t(s.tag)}</Tag>}
          {s.visibility === 'invite' && <Tag color="grape">{t('Invite only')}</Tag>}
          {s.seriesId != null && <Tag color="cyan">{t('Weekly')}</Tag>}
          {s.hostIsProfessor && <Tag color="periwinkle">{t('Professor')}</Tag>}
          {s.cancelledAt && <Tag color="red">{t('Cancelled')}</Tag>}
        </Group>
        <Text fw={800} td={s.cancelledAt ? 'line-through' : undefined} lineClamp={1}>
          {s.title}
        </Text>
      </div>
      <div style={{ flex: 1.3, minWidth: 0 }}>
        <Text size="lg" fw={600} lh={1.2}>
          {when(s)}
        </Text>
        <Group gap={4} c="dimmed" wrap="nowrap">
          {s.format === 'online' ? <IconVideo size={14} /> : <IconMapPin size={14} />}
          <Text size="md" lh={1.3} lineClamp={1}>
            {place(s)}
          </Text>
        </Group>
        {s.clash && (
          <Text size="xs" fw={700} c="orange" lineClamp={1}>
            {t('You have {{what}} then', { what: s.clash })}
          </Text>
        )}
      </div>
      <div style={{ width: 100 }}>
        <Text size="lg" fw={600} lh={1.2}>
          {s.goingCount}/{s.capacity}
        </Text>
        <Text size="sm" c="dimmed">
          {s.waitlistCount ? t('+{{count}} waiting', { count: s.waitlistCount }) : t('members')}
        </Text>
      </div>
      <Group gap="xs" wrap="nowrap" w={190} justify="flex-end">
        {!s.cancelledAt && s.myStatus === null && (
          <Button onClick={() => join.mutate()} loading={join.isPending} variant={s.isFull ? 'default' : 'filled'}>
            {s.isFull ? t('Join waitlist') : t('Join')}
          </Button>
        )}
        {s.myStatus === 'waitlisted' && (
          <Text size="sm" fw={800} c="orange">
            {t('Waitlist #{{position}}', { position: s.myWaitlistPosition ?? 1 })}
          </Text>
        )}
        {s.myStatus === 'going' && (
          <Text size="sm" fw={800} c="teal">
            {s.isHost ? t('Hosting') : t('Going')}
          </Text>
        )}
        <Tooltip label={t('Details, people and invite code')}>
          <ActionIcon variant="subtle" size="xl" radius="xl" onClick={onDetails} aria-label={t('Details for {{title}}', { title: s.title })}>
            <IconMessageDots size={30} stroke={1.6} />
          </ActionIcon>
        </Tooltip>
      </Group>
    </Group>
  );
}

// The link opens UniLink on the session's invite page (SessionInvite below).
const inviteLink = (code: string) => `${window.location.href.split('#')[0]}#/sessions/join/${code}`;

const inviteMessage = (s: Session) =>
  t('Join my study session "{{title}}" for {{class}} ({{when}}): {{link}}', {
    title: s.title,
    class: s.classLabel,
    when: fmtDateTime(s.startsAt),
    link: inviteLink(s.inviteCode!),
  });

function InviteCode({ session: s }: { session: Session }) {
  const newCode = useAction(() => rpc.studySessions.newCode({ sessionId: s.id }), { success: 'New code made. The old one no longer works.' });
  if (!s.inviteCode) return null;
  return (
    <Card padding="md" style={{ background: 'var(--ul-soft)' }}>
      <Group justify="space-between" wrap="nowrap">
        <div>
          <Group gap={6}>
            <IconKey size={16} />
            <Text fw={800}>{t('Invite code')}</Text>
            <Code fz="lg" fw={700}>
              {s.inviteCode}
            </Code>
          </Group>
          <Text size="xs" c="dimmed" mt={4}>
            {s.visibility === 'invite'
              ? t('Only people with this code can see and join this session. Share it in a group chat or a message.')
              : t('Anyone in the section can join from the list, or with this code.')}
          </Text>
        </div>
        <Stack gap={4}>
          <CopyButton value={s.inviteCode}>
            {({ copied, copy }) => (
              <Button size="xs" variant="light" onClick={copy}>
                {copied ? t('Copied') : t('Copy')}
              </Button>
            )}
          </CopyButton>
          <Tooltip label={t('A message with a link that opens this session, for a group chat')}>
            <CopyButton value={inviteMessage(s)}>
              {({ copied, copy }) => (
                <Button size="xs" variant="light" onClick={copy}>
                  {copied ? t('Copied') : t('Copy invite')}
                </Button>
              )}
            </CopyButton>
          </Tooltip>
          <Button size="xs" variant="subtle" color="gray" onClick={() => newCode.mutate()}>
            {t('New code')}
          </Button>
        </Stack>
      </Group>
    </Card>
  );
}

export function SessionDetails({ session: s, onEdit, onClose }: { session: Session; onEdit: () => void; onClose: () => void }) {
  const join = useAction(() => rpc.studySessions.join({ sessionId: s.id }), { success: joinedMessage });
  const leave = useAction(() => rpc.studySessions.leave({ sessionId: s.id }), {
    success: s.myStatus === 'waitlisted' ? t('You left the waitlist') : t('You left the session'),
    onSuccess: onClose,
  });
  const cancel = useAction((laterWeeks: boolean) => rpc.studySessions.cancel({ sessionId: s.id, laterWeeks }), { success: 'Session cancelled', onSuccess: onClose });
  const joinWeeks = useAction(() => rpc.studySessions.joinSeries({ sessionId: s.id }), { success: joinedMessage });
  // "Join every week" when more than this one week is left to join.
  const moreWeeks = s.myStatus === null ? s.weeksToJoin > 1 : s.weeksToJoin > 0;
  const addToCalendar = useAction(() => rpc.studySessions.exportIcs({ sessionId: s.id }), {
    success: (r) => (r ? t('Saved. Open the file to add the session to Google Calendar or another calendar app.') : ''),
  });

  const confirmCancel = () => {
    let laterWeeks = false;
    modals.openConfirmModal({
      title: t('Cancel this session?'),
      children: (
        <Stack gap="sm">
          <Text size="sm">{t("Everyone going or waiting will be told it's cancelled. To step down instead, leave it and the next person going becomes the host.")}</Text>
          {s.seriesId != null && <Checkbox label={t('Also cancel the weeks after this one')} onChange={(e) => (laterWeeks = e.currentTarget.checked)} />}
        </Stack>
      ),
      labels: { confirm: t('Cancel session'), cancel: t('Keep it') },
      confirmProps: { color: 'red' },
      onConfirm: () => cancel.mutate(laterWeeks),
    });
  };

  const confirmLeaveAsHost = () =>
    modals.openConfirmModal({
      title: t('Leave and hand over this session?'),
      children: (
        <Text size="sm">
          {s.goingCount > 1
            ? t('The person who joined first after you becomes the host.')
            : t("Nobody else is going yet, so the session will be cancelled.")}
        </Text>
      ),
      labels: { confirm: t('Leave'), cancel: t('Stay') },
      onConfirm: () => leave.mutate(),
    });

  return (
    <Stack>
      <Group gap={6}>
        <Tag>{s.classLabel}</Tag>
        {s.tag && <Tag color="periwinkle">{t(s.tag)}</Tag>}
        {s.visibility === 'invite' && <Tag color="grape">{t('Invite only')}</Tag>}
        {s.seriesId != null && <Tag color="cyan">{t('Weekly')}</Tag>}
        {s.hostIsProfessor && <Tag color="periwinkle">{t('Professor')}</Tag>}
      </Group>
      <Title order={2}>{s.title}</Title>
      <Group gap="lg" c="dimmed">
        <Group gap={6}>
          <IconClock size={16} />
          <Text>{when(s)}</Text>
        </Group>
        <Group gap={6}>
          {s.format === 'online' ? <IconVideo size={16} /> : <IconMapPin size={16} />}
          {s.meetingUrl ? (
            <Anchor href={s.meetingUrl} target="_blank">
              {t('Join the call')}
            </Anchor>
          ) : (
            <Text>{place(s)}</Text>
          )}
        </Group>
      </Group>
      {s.format === 'online' && !s.meetingUrl && (
        <Text size="xs" c="dimmed">
          {t('The meeting link shows here once you’re going.')}
        </Text>
      )}
      {s.description && <Text style={{ whiteSpace: 'pre-wrap' }}>{s.description}</Text>}
      {s.isHost && !s.cancelledAt && <InviteCode session={s} />}
      <Divider
        label={[
          t('{{count}} of {{capacity}} going', { count: s.goingCount, capacity: s.capacity ?? s.goingCount }),
          s.waitlistCount ? t('{{count}} on the waitlist', { count: s.waitlistCount }) : null,
        ]
          .filter(Boolean)
          .join(' · ')}
        labelPosition="left"
      />
      {s.going.length ? (
        <Stack gap="xs">
          {s.going.map((g) => (
            <Group key={g.userId} gap="sm">
              <GoatAvatar goat={g.goat} size={36} />
              <div>
                <Text size="sm" fw={700}>
                  {g.name} {g.userId === s.hostId && <Text span size="xs" c="dimmed">{t('(host)')}</Text>}
                </Text>
                <Text size="xs" c="dimmed">
                  {g.email}
                </Text>
              </div>
            </Group>
          ))}
        </Stack>
      ) : (
        <Group gap={6} c="dimmed">
          <IconLock size={14} />
          <Text size="sm">
            {s.hostFirstName ? t('Hosted by {{name}}.', { name: s.hostFirstName }) : ''} {t('Join to see who else is going.')}
          </Text>
        </Group>
      )}
      {s.myStatus === 'waitlisted' && (
        <Text size="sm" c="orange" fw={700}>
          {t("You're #{{position}} on the waitlist. You'll be moved in automatically when a spot opens.", { position: s.myWaitlistPosition ?? 1 })}
        </Text>
      )}
      {!s.cancelledAt && (
        <Group mt="md">
          {s.myStatus === null && (
            <Button onClick={() => join.mutate()} loading={join.isPending}>
              {s.isFull ? t('Join waitlist') : t('Join')}
            </Button>
          )}
          {moreWeeks && (
            <Button variant={s.myStatus === null ? 'light' : 'default'} onClick={() => joinWeeks.mutate()} loading={joinWeeks.isPending}>
              {s.myStatus === null ? t('Join every week') : t('Join the later weeks too')}
            </Button>
          )}
          {s.isHost ? (
            <>
              <Button variant="default" onClick={onEdit}>
                {t('Edit')}
              </Button>
              <Button variant="default" onClick={confirmLeaveAsHost}>
                {t('Leave')}
              </Button>
              <Button variant="subtle" color="red" onClick={confirmCancel}>
                {t('Cancel session')}
              </Button>
            </>
          ) : (
            s.myStatus && (
              <Button variant="default" onClick={() => leave.mutate()}>
                {s.myStatus === 'waitlisted' ? t('Leave waitlist') : t('Leave')}
              </Button>
            )
          )}
          {s.myStatus && (
            <Button variant="subtle" leftSection={<IconCalendarPlus size={16} />} onClick={() => addToCalendar.mutate()} loading={addToCalendar.isPending}>
              {t('Add to calendar')}
            </Button>
          )}
        </Group>
      )}
    </Stack>
  );
}

// Shows a list of sessions with a details drawer and an edit modal.
export function SessionList({ sessions, empty }: { sessions: Session[]; empty: React.ReactNode }) {
  const [openId, setOpenId] = useState<number | null>(null);
  const [editing, setEditing] = useState<Session | null>(null);
  const open = sessions.find((s) => s.id === openId) ?? null;
  return (
    <>
      {sessions.length ? sessions.map((s) => <SessionRow key={s.id} session={s} onDetails={() => setOpenId(s.id)} />) : empty}
      <Drawer opened={open != null} onClose={() => setOpenId(null)} position="right" size="lg" title={<Text fw={800}>{t('Study session')}</Text>}>
        {open && <SessionDetails session={open} onEdit={() => setEditing(open)} onClose={() => setOpenId(null)} />}
      </Drawer>
      <Modal opened={editing != null} onClose={() => setEditing(null)} title={t('Edit session')} size="lg">
        {editing && <SessionForm classId={editing.classId} existing={editing} onDone={() => setEditing(null)} />}
      </Modal>
    </>
  );
}

// S3.4: invite codes are how people get into sessions, invite-only or not.
export function JoinByCode() {
  const navigate = useNavigate();
  const [code, setCode] = useState('');
  const join = useAction(() => rpc.studySessions.joinByCode({ code }), {
    success: (r) => (r.status === 'going' && r.weeks === 1 ? t('You\'re going to "{{title}}"!', { title: r.title }) : joinedMessage(r)),
    onSuccess: (r) => {
      setCode('');
      navigate(`/classes/${r.classId}/sessions`);
    },
  });
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        join.mutate();
      }}
    >
      <Group gap="xs" wrap="nowrap">
        <TextInput
          size="md"
          radius="xl"
          placeholder={t('Have an invite code?')}
          leftSection={<IconKey size={18} />}
          value={code}
          onChange={(e) => setCode(e.currentTarget.value.toUpperCase())}
          maxLength={8}
          w={210}
          aria-label={t('Invite code')}
        />
        <Button size="md" variant="default" type="submit" disabled={!code.trim()} loading={join.isPending}>
          {t('Join')}
        </Button>
      </Group>
    </form>
  );
}

export function SessionForm({
  classId,
  existing,
  fromPoll,
  onDone,
}: {
  classId: number | null;
  existing: Session | null;
  // Setting up the session for a time picked from a poll (see TimePolls.tsx).
  fromPoll?: { optionId: number; title: string; startsAt: Date; endsAt: Date };
  onDone: () => void;
}) {
  const classes = useQuery({ queryKey: ['classes', 'mine'], queryFn: () => rpc.classes.mine() });
  const tomorrowEvening = dayjs().add(1, 'day').hour(18).minute(0).second(0).toDate();
  const form = useForm({
    initialValues: {
      classId: String(existing?.classId ?? classId ?? ''),
      tag: existing?.tag ? t(existing.tag) : '',
      title: existing?.title ?? fromPoll?.title ?? '',
      description: existing?.description ?? '',
      format: (existing?.format ?? 'in-person') as 'in-person' | 'online',
      location: existing?.location ?? '',
      meetingUrl: existing?.meetingUrl ?? '',
      visibility: (existing?.visibility ?? 'class') as 'class' | 'invite',
      startsAt: (existing?.startsAt ?? fromPoll?.startsAt ?? tomorrowEvening) as Date | string | null,
      endsAt: (existing?.endsAt ?? fromPoll?.endsAt ?? dayjs(tomorrowEvening).add(2, 'hour').toDate()) as Date | string | null,
      capacity: (existing?.capacity ?? 6) as number | string,
      weeks: '1',
    },
    validate: {
      classId: (v) => (v ? null : t('Pick a class')),
      title: (v) => (v.trim() ? null : t('Give it a title')),
      location: (v, values) => (values.format === 'online' || v.trim() ? null : t('Where is it? Add a room or place')),
      meetingUrl: (v, values) => (values.format === 'in-person' || /^https:\/\/\S+\.\S+/.test(v.trim()) ? null : t('Add the meeting link, starting with https://')),
      capacity: (v) => (typeof v === 'number' && v >= 2 && v <= 30 ? null : t('Between 2 and 30 people')),
      endsAt: (v, values) => (toDate(v) && toDate(values.startsAt) && toDate(v)! > toDate(values.startsAt)! ? null : t('Must end after it starts')),
    },
  });
  const save = useAction(
    async (v: typeof form.values) => {
      const fields = {
        title: v.title,
        description: v.description,
        format: v.format,
        location: v.location,
        meetingUrl: v.meetingUrl,
        visibility: v.visibility,
        startsAt: toDate(v.startsAt)!,
        endsAt: toDate(v.endsAt)!,
        capacity: Number(v.capacity),
        tag: v.tag.trim() ? toStoredTopic(v.tag, SESSION_TAGS) : null,
      };
      if (existing) await rpc.studySessions.update({ sessionId: existing.id, ...fields });
      else {
        const created = await rpc.studySessions.create({ classId: Number(v.classId), weeks: Number(v.weeks), ...fields });
        if (fromPoll) await rpc.timePolls.decide({ optionId: fromPoll.optionId, sessionId: created.id });
      }
    },
    {
      success: existing
        ? t('Session updated. Everyone in it hears about a new time or place.')
        : fromPoll
          ? t('Session created. Everyone who answered has been told.')
          : t('Session created. Share its invite code from the details.'),
      onSuccess: onDone,
    },
  );

  return (
    <form onSubmit={form.onSubmit((v) => save.mutate(v))}>
      <Stack>
        <Group grow align="flex-start">
          <Select
            label={t('Class')}
            data={classes.data?.map((c) => ({ value: String(c.id), label: c.code })) ?? []}
            disabled={!!existing || !!classId}
            allowDeselect={false}
            {...form.getInputProps('classId')}
          />
          <Autocomplete label={t('Type')} placeholder={t('Assignment, Midterm…')} data={SESSION_TAGS.map((tag) => t(tag))} {...form.getInputProps('tag')} />
        </Group>
        <TextInput label={t('Topic')} placeholder={t('Do Assignment 2 together')} data-autofocus {...form.getInputProps('title')} />
        <Textarea label={t("What's the plan?")} autosize minRows={2} {...form.getInputProps('description')} />
        <SegmentedControl
          data={[
            { value: 'in-person', label: t('In person') },
            { value: 'online', label: t('Online') },
          ]}
          {...form.getInputProps('format')}
        />
        {form.values.format === 'in-person' ? (
          <TextInput label={t('Where')} placeholder={t('Cybertheque Room 2')} {...form.getInputProps('location')} />
        ) : (
          <TextInput
            label={t('Meeting link')}
            description={t('Only people going see it.')}
            placeholder="https://mcgill.zoom.us/j/…"
            {...form.getInputProps('meetingUrl')}
          />
        )}
        <Group grow>
          <DateTimePicker label={t('Starts')} valueFormat="ddd D MMM, HH:mm" minDate={new Date()} {...form.getInputProps('startsAt')} />
          <DateTimePicker label={t('Ends')} valueFormat="ddd D MMM, HH:mm" minDate={new Date()} {...form.getInputProps('endsAt')} />
        </Group>
        {!existing && !fromPoll && (
          <Select
            label={t('Repeats')}
            description={t('Weekly sessions share one invite code, which joins every week.')}
            data={[
              { value: '1', label: t("Doesn't repeat") },
              ...[2, 3, 4, 6, 8, 10, 12].map((n) => ({ value: String(n), label: t('Every week, {{count}} times', { count: n }) })),
            ]}
            allowDeselect={false}
            {...form.getInputProps('weeks')}
          />
        )}
        <Group grow align="flex-start">
          <NumberInput label={t('Max people')} description={t('Others join a waitlist once it’s full')} min={2} max={30} {...form.getInputProps('capacity')} />
          {!fromPoll && (
            <Select
              label={t('Who can see it')}
              data={[
                { value: 'class', label: t('Everyone in the section') },
                { value: 'invite', label: t('Only people with the invite code') },
              ]}
              allowDeselect={false}
              {...form.getInputProps('visibility')}
            />
          )}
        </Group>
        <Group justify="flex-end">
          <Button type="submit" loading={save.isPending}>
            {existing ? t('Save') : t('Create session')}
          </Button>
        </Group>
      </Stack>
    </form>
  );
}

export function SessionsCard({ children }: { children: React.ReactNode }) {
  return (
    <Card padding="lg" style={{ background: 'var(--ul-soft)' }}>
      {children}
    </Card>
  );
}

// S3.4: what an invite link opens. The session as anyone in the section would see it, and
// a way in: join it, or join its class first.
export function SessionInvite({ code }: { code: string }) {
  const navigate = useNavigate();
  const invite = useQuery({ queryKey: ['studySessions', 'invite', code], queryFn: () => rpc.studySessions.byCode({ code }) });
  const join = useAction(() => rpc.studySessions.joinByCode({ code }), {
    success: (r) => (r.status === 'going' && r.weeks === 1 ? t('You\'re going to "{{title}}"!', { title: r.title }) : joinedMessage(r)),
    onSuccess: (r) => navigate(`/classes/${r.classId}/sessions`),
  });

  if (invite.isPending) return <Loading />;
  if (!invite.data) return <Empty>{invite.error?.message}</Empty>;
  const s = invite.data;
  const open = (
    <Button component={Link} to={`/classes/${s.classId}/sessions`} variant="light">
      {t('Open')}
    </Button>
  );

  return (
    <Card padding="xl" maw={620}>
      <Stack>
        <Group gap={6}>
          <Tag>{s.classLabel}</Tag>
          {s.tag && <Tag color="periwinkle">{t(s.tag)}</Tag>}
          {s.visibility === 'invite' && <Tag color="grape">{t('Invite only')}</Tag>}
          {s.seriesId != null && <Tag color="cyan">{t('Weekly')}</Tag>}
          {s.cancelledAt && <Tag color="red">{t('Cancelled')}</Tag>}
        </Group>
        <Title order={2}>{s.title}</Title>
        <Group gap="lg" c="dimmed">
          <Group gap={6}>
            <IconClock size={16} />
            <Text>{when(s)}</Text>
          </Group>
          <Group gap={6}>
            {s.format === 'online' ? <IconVideo size={16} /> : <IconMapPin size={16} />}
            <Text>{place(s)}</Text>
          </Group>
        </Group>
        {s.description && <Text style={{ whiteSpace: 'pre-wrap' }}>{s.description}</Text>}
        {s.myStatus === null && s.weeksToJoin > 1 && (
          <Text size="sm">{t('Every week. Joining adds you to the {{count}} weeks still to come.', { count: s.weeksToJoin })}</Text>
        )}
        <Text size="sm" c="dimmed">
          {[
            s.hostFirstName ? t('Hosted by {{name}}.', { name: s.hostFirstName }) : null,
            t('{{count}} of {{capacity}} going', { count: s.goingCount, capacity: s.capacity ?? s.goingCount }),
            s.waitlistCount ? t('{{count}} on the waitlist', { count: s.waitlistCount }) : null,
          ]
            .filter(Boolean)
            .join(' · ')}
        </Text>
        <Divider />
        {s.cancelledAt ? (
          <Text c="red">{t('This session was cancelled.')}</Text>
        ) : s.endsAt < new Date() ? (
          <Text c="dimmed">{t('This session is over.')}</Text>
        ) : s.myStatus === 'going' ? (
          <Group justify="space-between">
            <Text fw={800} c="teal">
              {s.isHost ? t('Hosting') : t("You're going!")}
            </Text>
            {open}
          </Group>
        ) : s.myStatus === 'waitlisted' ? (
          <Group justify="space-between">
            <Text fw={800} c="orange">
              {t('Waitlist #{{position}}', { position: s.myWaitlistPosition ?? 1 })}
            </Text>
            {open}
          </Group>
        ) : !s.inClass ? (
          <Group justify="space-between">
            <Text size="sm">{t('This session is for {{class}}. Join that class first.', { class: s.classLabel })}</Text>
            <Button component={Link} to={`/classes/${s.classId}`} variant="light">
              {t('Go to {{code}}', { code: s.classLabel })}
            </Button>
          </Group>
        ) : (
          <Group justify="flex-end">
            <Button onClick={() => join.mutate()} loading={join.isPending} variant={s.isFull ? 'default' : 'filled'}>
              {s.isFull ? t('Join waitlist') : t('Join')}
            </Button>
          </Group>
        )}
      </Stack>
    </Card>
  );
}
