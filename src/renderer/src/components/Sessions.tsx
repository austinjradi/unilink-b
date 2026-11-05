import { useState } from 'react';
import { addDays, ymd } from '@shared/dates';
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
  SimpleGrid,
  Stack,
  TagsInput,
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
import { useVariant } from '../lib/variants';
import { GoatAvatar } from './Goat';
import { Empty, Loading, Tag } from './ui';
import { t, tx } from '../lib/i18n';
import { toStoredTopic } from './Feed';
import { ReqInfo, WithInfo } from './ReqInfo';

// S3 study sessions in the layout of the wireframes (A2Team.pdf p. 12–13): rows with the
// class and type tags, when and where, how many are going, and a join/details action.

// One session as describe() in the service shapes it, already limited to what this viewer may see.
export type Session = Out<typeof rpc.studySessions.list>[number];

// Stored in English (so search and tags match for everyone), shown translated.
export const SESSION_TAGS = [tx('Assignment'), tx('Midterm'), tx('Final'), tx('Lab'), tx('Project'), tx('Review'), tx('Office hours')];

// "7 October 18:00–20:00", repeating the date only when the session ends on
// another day. isSame(…, 'day') compares calendar days, not exact times.
function when(s: Session) {
  const start = dayjs(s.startsAt);
  return `${start.format('D MMMM HH:mm')}–${dayjs(s.endsAt).format(start.isSame(s.endsAt, 'day') ? 'HH:mm' : 'D MMM HH:mm')}`;
}

const place = (s: Session) => (s.format === 'online' ? t('Online') : s.location);

// Nested ternaries choose the toast text from what joining returned.
const joinedMessage = (r: { status: string; weeks?: number }) =>
  r.status === 'invited'
    ? 'You asked to join. The host will decide.'
    : r.weeks && r.weeks > 1
    ? t("You joined {{count}} weeks. Where one is full, you're on its waitlist.", { count: r.weeks })
    : r.status === 'going'
      ? t("You're going!")
      : t("It's full, so you're on the waitlist. We'll tell you if a spot opens up.");

// What someone not in a session can do about it, under the switches that change that.
function SessionStatus({ session: s }: { session: Session }) {
  const join = useAction(() => rpc.studySessions.join({ sessionId: s.id }), { success: joinedMessage });
  const confirm = useAction(() => rpc.studySessions.confirmSpot({ sessionId: s.id }));
  const noWaitlist = useVariant('optional-session-limit');
  if (s.cancelledAt) return null;
  if (s.myStatus === null && !s.canJoin) {
    return (
      <WithInfo id="session-join">
        <Button component={Link} to={`/classes/${s.classId}`} variant="default">
          {t('Go to {{code}}', { code: s.classLabel })}
        </Button>
      </WithInfo>
    );
  }
  if (s.myStatus === null) {
    return (
      <WithInfo id="session-join">
        <Button onClick={() => join.mutate()} loading={join.isPending} disabled={s.isFull && noWaitlist} variant={s.isFull ? 'default' : 'filled'}>
          {s.isFull && noWaitlist ? 'Full' : s.isFull ? t('Join waitlist') : t('Join')}
        </Button>
      </WithInfo>
    );
  }
  if (s.myStatus === 'invited') {
    return (
      <WithInfo id="session-status">
        <Text size="sm" fw={800} c="orange">
          Asked to join
        </Text>
      </WithInfo>
    );
  }
  if (s.spotOffered) {
    return (
      <WithInfo id="session-capacity">
        <Button onClick={() => confirm.mutate()} loading={confirm.isPending}>
          Take the spot
        </Button>
      </WithInfo>
    );
  }
  if (s.myStatus === 'waitlisted') {
    return (
      <WithInfo id="session-status">
        <Text size="sm" fw={800} c="orange">
          {t('Waitlist #{{position}}', { position: s.myWaitlistPosition ?? 1 })}
        </Text>
      </WithInfo>
    );
  }
  return (
    <WithInfo id="session-status">
      <Text size="sm" fw={800} c="teal">
        {s.isHost ? t('Hosting') : t('Going')}
      </Text>
    </WithInfo>
  );
}

// 'session-cards': each session as a card, with who's hosting up front.
function SessionCard({ session: s, onDetails }: { session: Session; onDetails: () => void }) {
  return (
    <Card padding="md">
      <Group justify="space-between" wrap="nowrap" mb={6}>
        <Text fw={800} size="sm">
          {s.hostFirstName ? `Hosted by ${s.hostFirstName}` : s.classLabel} <ReqInfo id="session-row" />
        </Text>
        <Tag>{s.classLabel}</Tag>
      </Group>
      <Text fw={800} lineClamp={2}>
        {s.title}
      </Text>
      <Text size="sm" c="dimmed">
        {when(s)} · {place(s)}
      </Text>
      <Text size="sm" c="dimmed" mb="sm">
        {s.capacity ? `${s.goingCount}/${s.capacity}` : s.goingCount} {t('members')}
      </Text>
      <Group justify="space-between">
        <SessionStatus session={s} />
        <Button size="xs" variant="subtle" onClick={onDetails}>
          Details
        </Button>
      </Group>
    </Card>
  );
}

// 'session-calendar-view': the next four weeks as a calendar.
// Four weeks from this Monday: Array.from({ length: 28 }, …) makes
// the 28 days, and each day lists the sessions that start on it.
function SessionCalendar({ sessions, onOpen }: { sessions: Session[]; onOpen: (id: number) => void }) {
  const today = dayjs();
  // dayjs counts days from Sunday as 0, so (day() + 6) % 7 is the number of days since Monday.
  const monday = ymd(today.subtract((today.day() + 6) % 7, 'day').toDate());
  const days = Array.from({ length: 28 }, (_, i) => addDays(monday, i));
  return (
    <SimpleGrid cols={7} spacing={4}>
      {days.map((day) => (
        <Card key={day} padding={6} mih={84}>
          <Text size="xs" c="dimmed" fw={700}>
            {dayjs(day).format('ddd D')}
          </Text>
          {sessions
            .filter((s) => ymd(new Date(s.startsAt)) === day)
            .map((s) => (
              <Button key={s.id} size="compact-xs" variant="light" fullWidth justify="flex-start" mt={2} onClick={() => onOpen(s.id)} title={s.title}>
                {dayjs(s.startsAt).format('HH:mm')} {s.title}
              </Button>
            ))}
        </Card>
      ))}
    </SimpleGrid>
  );
}

export function SessionRow({ session: s, onDetails }: { session: Session; onDetails: () => void }) {
  const noClashNotes = useVariant('no-session-clash-notes');
  return (
    <Group wrap="nowrap" py="md" gap="lg" align="center" style={{ borderBottom: '1.5px solid var(--ul-border)' }}>
      <div style={{ flex: 1.4, minWidth: 0 }}>
        <Group gap={6} mb={6}>
          <WithInfo id="post-class"><Tag>{s.classLabel}</Tag></WithInfo>
          {s.tag && <WithInfo id="session-type"><Tag color="periwinkle">{t(s.tag)}</Tag></WithInfo>}
          {s.visibility === 'invite' && <WithInfo id="session-visibility"><Tag color="grape">{t('Invite only')}</Tag></WithInfo>}
          {s.seriesId != null && <WithInfo id="session-weekly"><Tag color="cyan">{t('Weekly')}</Tag></WithInfo>}
          {s.hostIsProfessor && <WithInfo id="session-from-prof"><Tag color="periwinkle">{t('Professor')}</Tag></WithInfo>}
          {s.cancelledAt && <WithInfo id="session-cancel"><Tag color="red">{t('Cancelled')}</Tag></WithInfo>}
        </Group>
        <Text fw={800} td={s.cancelledAt ? 'line-through' : undefined} lineClamp={1}>
          {s.title} <ReqInfo id="session-row" />
        </Text>
      </div>
      <div style={{ flex: 1.3, minWidth: 0 }}>
        <Text size="lg" fw={600} lh={1.2}>
          {when(s)} <ReqInfo id="session-time" />
        </Text>
        <Group gap={4} c="dimmed" wrap="nowrap">
          {s.format === 'online' ? <IconVideo size={14} /> : <IconMapPin size={14} />}
          <Text size="md" lh={1.3} lineClamp={1}>
            {place(s)}
          </Text>
          <ReqInfo id="session-format" />
        </Group>
        {s.clash && !noClashNotes && (
          <WithInfo id="session-clash">
            <Text size="xs" fw={700} c="orange" lineClamp={1}>
              {t('You have {{what}} then', { what: s.clash })}
            </Text>
          </WithInfo>
        )}
      </div>
      <div style={{ width: 100 }}>
        <Text size="lg" fw={600} lh={1.2}>
          {s.capacity ? `${s.goingCount}/${s.capacity}` : s.goingCount} <ReqInfo id="session-capacity" />
        </Text>
        <Text size="sm" c="dimmed">
          {s.waitlistCount ? t('+{{count}} waiting', { count: s.waitlistCount }) : t('members')}
        </Text>
      </div>
      <Group gap="xs" wrap="nowrap" w={240} justify="flex-end">
        <SessionStatus session={s} />
        <WithInfo id="session-details">
          <Tooltip label={t('Details, people and invite code')}>
            <ActionIcon variant="subtle" size="xl" radius="xl" onClick={onDetails} aria-label={t('Details for {{title}}', { title: s.title })}>
              <IconMessageDots size={30} stroke={1.6} />
            </ActionIcon>
          </Tooltip>
        </WithInfo>
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

// 'session-invite-by-email' and 'session-invite-notification': the classmate hears through UniLink.
function InviteClassmate({ session: s }: { session: Session }) {
  const [email, setEmail] = useState('');
  const invite = useAction(() => rpc.studySessions.invite({ sessionId: s.id, email }), { success: () => 'Invited', onSuccess: () => setEmail('') });
  return (
    <Group align="flex-end" gap="xs">
      <TextInput
        label={<WithInfo id="session-invite-message">Invite a classmate</WithInfo>}
        placeholder="first.last@mail.mcgill.ca"
        value={email}
        onChange={(e) => setEmail(e.currentTarget.value)}
        style={{ flex: 1 }}
      />
      <Button variant="default" disabled={!email.trim()} onClick={() => invite.mutate()} loading={invite.isPending}>
        Invite
      </Button>
    </Group>
  );
}

function InviteCode({ session: s }: { session: Session }) {
  const newCode = useAction(() => rpc.studySessions.newCode({ sessionId: s.id }), { success: 'New code made. The old one no longer works.' });
  const byEmail = useVariant('session-invite-by-email');
  if (byEmail) return <InviteClassmate session={s} />;
  if (!s.inviteCode) return null;
  return (
    <Card padding="md" style={{ background: 'var(--ul-soft)' }}>
      <Group justify="space-between" wrap="nowrap">
        <div>
          <Group gap={6}>
            <IconKey size={16} />
            <Text fw={800}>
              {t('Invite code')} <ReqInfo id="session-invite-code" />
            </Text>
            <Code fz="lg" fw={700}>
              {s.inviteCode}
            </Code>
          </Group>
          <Text size="xs" c="dimmed" mt={4}>
            {s.visibility === 'invite'
              ? t('Only people with this code can see and join this session. Share it in a group chat or a message.')
              : t('Anyone in the section can join from the list, or with this code.')}
            {s.codeExpiresAt && ` This code expires ${dayjs(s.codeExpiresAt).format('MMM D')}.`}
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
          <WithInfo id="session-invite-message">
            <Tooltip label={t('A message with a link that opens this session, for a group chat')}>
              <CopyButton value={inviteMessage(s)}>
                {({ copied, copy }) => (
                  <Button size="xs" variant="light" onClick={copy}>
                    {copied ? t('Copied') : t('Copy invite')}
                  </Button>
                )}
              </CopyButton>
            </Tooltip>
          </WithInfo>
          <WithInfo id="session-new-code">
            <Button size="xs" variant="subtle" color="gray" onClick={() => newCode.mutate()}>
              {t('New code')}
            </Button>
          </WithInfo>
        </Stack>
      </Group>
    </Card>
  );
}

// 'host-approves-joins': the people waiting for the host's answer.
function JoinRequests({ session: s }: { session: Session }) {
  const decide = useAction((v: { userId: number; approve: boolean }) => rpc.studySessions.decideJoin({ sessionId: s.id, ...v }));
  if (!s.requests.length) return null;
  return (
    <Card padding="sm" style={{ background: 'var(--ul-soft)' }}>
      <Text size="sm" fw={800} mb={4}>
        Asking to join <ReqInfo id="session-join" />
      </Text>
      <Stack gap={6}>
        {s.requests.map((request) => (
          <Group key={request.userId} justify="space-between" wrap="nowrap">
            <Text size="sm">{request.name}</Text>
            <Group gap={4}>
              <Button size="compact-xs" onClick={() => decide.mutate({ userId: request.userId, approve: true })}>
                Approve
              </Button>
              <Button size="compact-xs" variant="default" onClick={() => decide.mutate({ userId: request.userId, approve: false })}>
                Decline
              </Button>
            </Group>
          </Group>
        ))}
      </Stack>
    </Card>
  );
}

// 'session-chat': for coordinating inside UniLink, for the people going.
function SessionChat({ session: s }: { session: Session }) {
  const [body, setBody] = useState('');
  const send = useAction(() => rpc.studySessions.chat({ sessionId: s.id, body }), { onSuccess: () => setBody('') });
  return (
    <Stack gap={6}>
      <Divider label={<WithInfo id="session-details">Chat</WithInfo>} labelPosition="left" />
      {s.chat.map((message) => (
        <Text key={message.at} size="sm">
          <b>{message.name}:</b> {message.body}
        </Text>
      ))}
      <Group gap="xs" wrap="nowrap">
        <TextInput placeholder="Write a message…" aria-label="Write a message" value={body} onChange={(e) => setBody(e.currentTarget.value)} style={{ flex: 1 }} />
        <Button variant="default" disabled={!body.trim()} onClick={() => send.mutate()} loading={send.isPending}>
          Send
        </Button>
      </Group>
    </Stack>
  );
}

// 'suggest-session-change': anyone going suggests, the host answers.
function Suggestions({ session: s }: { session: Session }) {
  const [text, setText] = useState('');
  const suggest = useAction(() => rpc.studySessions.suggest({ sessionId: s.id, text }), { success: () => 'Sent to the host', onSuccess: () => setText('') });
  const answer = useAction((v: { id: number; accept: boolean }) => rpc.studySessions.answerSuggestion({ sessionId: s.id, ...v }));
  if (s.isHost) {
    if (!s.suggestions.length) return null;
    return (
      <Stack gap={6}>
        <Divider label={<WithInfo id="session-edit">Suggested changes</WithInfo>} labelPosition="left" />
        {s.suggestions.map((suggestion) => (
          <Group key={suggestion.id} justify="space-between" wrap="nowrap">
            <Text size="sm">
              <b>{suggestion.name}:</b> {suggestion.text}
            </Text>
            <Group gap={4} style={{ flex: 'none' }}>
              <Button size="compact-xs" onClick={() => answer.mutate({ id: suggestion.id, accept: true })}>
                Accept
              </Button>
              <Button size="compact-xs" variant="default" onClick={() => answer.mutate({ id: suggestion.id, accept: false })}>
                Dismiss
              </Button>
            </Group>
          </Group>
        ))}
      </Stack>
    );
  }
  if (s.myStatus !== 'going') return null;
  return (
    <Group gap="xs" wrap="nowrap">
      <TextInput placeholder="Suggest a change to the host…" aria-label="Suggest a change to the host" value={text} onChange={(e) => setText(e.currentTarget.value)} style={{ flex: 1 }} />
      <Button variant="default" disabled={!text.trim()} onClick={() => suggest.mutate()} loading={suggest.isPending}>
        Suggest
      </Button>
      <ReqInfo id="session-edit" />
    </Group>
  );
}

// 'session-goal-checklist': the plan as goals anyone going can tick off.
function GoalChecklist({ session: s }: { session: Session }) {
  const toggle = useAction((index: number) => rpc.studySessions.toggleGoal({ sessionId: s.id, index }));
  const goals = s.description.split('\n').map((line) => line.replace(/^- /, '').trim()).filter(Boolean);
  return (
    <Stack gap={4}>
      {goals.map((goal, i) => (
        <Checkbox key={goal} label={goal} checked={s.goalsDone.includes(i)} disabled={s.myStatus !== 'going'} onChange={() => toggle.mutate(i)} />
      ))}
    </Stack>
  );
}

// The full view of one session, with every action this viewer is allowed.
export function SessionDetails({ session: s, onEdit, onClose }: { session: Session; onEdit: () => void; onClose: () => void }) {
  const noWeeks = useVariant('one-off-sessions');
  const hostStays = useVariant('hosts-cannot-leave');
  const chooseNext = useVariant('choose-next-host');
  const chat = useVariant('session-chat');
  const suggestChanges = useVariant('suggest-session-change');
  const checklist = useVariant('session-goal-checklist');
  const notifyInvite = useVariant('session-invite-notification');
  const join = useAction(() => rpc.studySessions.join({ sessionId: s.id }), { success: joinedMessage });
  const leave = useAction((nextHostId?: number) => rpc.studySessions.leave({ sessionId: s.id, nextHostId }), {
    success: s.myStatus === 'waitlisted' ? t('You left the waitlist') : t('You left the session'),
    onSuccess: onClose,
  });
  const cancel = useAction((laterWeeks: boolean) => rpc.studySessions.cancel({ sessionId: s.id, laterWeeks }), { success: 'Session cancelled', onSuccess: onClose });
  const joinWeeks = useAction(() => rpc.studySessions.joinSeries({ sessionId: s.id }), { success: joinedMessage });
  // "Join every week" when more than this one week is left to join.
  const moreWeeks = !noWeeks && (s.myStatus === null ? s.weeksToJoin > 1 : s.weeksToJoin > 0);
  const addToCalendar = useAction(() => rpc.studySessions.exportIcs({ sessionId: s.id }), {
    success: (r) => (r ? t('Saved. Open the file to add the session to Google Calendar or another calendar app.') : ''),
  });

  const confirmCancel = () => {
    let laterWeeks = false;
    modals.openConfirmModal({
      title: <WithInfo id="session-cancel">{t('Cancel this session?')}</WithInfo>,
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

  const confirmLeaveAsHost = () => {
    let nextHostId: number | undefined;
    const others = s.going.filter((g) => g.userId !== s.hostId);
    modals.openConfirmModal({
      title: <WithInfo id="session-host-leave">{t('Leave and hand over this session?')}</WithInfo>,
      children: (
        <Stack gap="sm">
          <Text size="sm">
            {s.goingCount > 1
              ? chooseNext
                ? 'Pick who takes over.'
                : t('The person who joined first after you becomes the host.')
              : t("Nobody else is going yet, so the session will be cancelled.")}
          </Text>
          {chooseNext && others.length > 0 && <Select aria-label="Who takes over" placeholder="Whoever joined first" data={others.map((g) => ({ value: String(g.userId), label: g.name }))} onChange={(v) => (nextHostId = v ? Number(v) : undefined)} comboboxProps={{ withinPortal: false }} />}
        </Stack>
      ),
      labels: { confirm: t('Leave'), cancel: t('Stay') },
      onConfirm: () => leave.mutate(nextHostId),
    });
  };

  return (
    <Stack>
      <Group gap={6}>
        <WithInfo id="post-class"><Tag>{s.classLabel}</Tag></WithInfo>
        {s.tag && <WithInfo id="session-type"><Tag color="periwinkle">{t(s.tag)}</Tag></WithInfo>}
        {s.visibility === 'invite' && <WithInfo id="session-visibility"><Tag color="grape">{t('Invite only')}</Tag></WithInfo>}
        {s.seriesId != null && <WithInfo id="session-weekly"><Tag color="cyan">{t('Weekly')}</Tag></WithInfo>}
        {s.hostIsProfessor && <WithInfo id="session-from-prof"><Tag color="periwinkle">{t('Professor')}</Tag></WithInfo>}
      </Group>
      <Title order={2}>
        {s.title} <ReqInfo id="session-title" />
      </Title>
      <Group gap="lg" c="dimmed">
        <Group gap={6}>
          <IconClock size={16} />
          <Text>{when(s)}</Text>
          <ReqInfo id="session-time" />
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
          <ReqInfo id={s.format === 'online' ? 'session-meeting-link' : 'session-where'} />
        </Group>
      </Group>
      {s.format === 'online' && !s.meetingUrl && (
        <Text size="xs" c="dimmed">
          {t('The meeting link shows here once you’re going.')} <ReqInfo id="session-meeting-link" />
        </Text>
      )}
      {s.description && checklist && <GoalChecklist session={s} />}
      {s.description && !checklist && (
        <Text style={{ whiteSpace: 'pre-wrap' }}>
          {s.description} <ReqInfo id="session-plan" />
        </Text>
      )}
      {s.isHost && !s.cancelledAt && <InviteCode session={s} />}
      {s.isHost && !s.cancelledAt && notifyInvite && <InviteClassmate session={s} />}
      <JoinRequests session={s} />
      <Divider
        label={
          <WithInfo id="session-going">
            {[
              t('{{count}} of {{capacity}} going', { count: s.goingCount, capacity: s.capacity ?? s.goingCount }),
              s.waitlistCount ? t('{{count}} on the waitlist', { count: s.waitlistCount }) : null,
            ]
              .filter(Boolean)
              .join(' · ')}
          </WithInfo>
        }
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
            {s.hostFirstName ? t('Hosted by {{name}}.', { name: s.hostFirstName }) : ''} {t('Join to see who else is going.')} <ReqInfo id="session-going" />
          </Text>
        </Group>
      )}
      {s.myStatus === 'waitlisted' && (
        <Text size="sm" c="orange" fw={700}>
          {t("You're #{{position}} on the waitlist. You'll be moved in automatically when a spot opens.", { position: s.myWaitlistPosition ?? 1 })} <ReqInfo id="session-status" />
        </Text>
      )}
      {chat && s.myStatus === 'going' && <SessionChat session={s} />}
      {suggestChanges && !s.cancelledAt && <Suggestions session={s} />}
      {!s.cancelledAt && (
        <Group mt="md">
          {s.myStatus === null && s.canJoin && (
            <WithInfo id="session-join">
              <Button onClick={() => join.mutate()} loading={join.isPending}>
                {s.isFull ? t('Join waitlist') : t('Join')}
              </Button>
            </WithInfo>
          )}
          {moreWeeks && (
            <WithInfo id="session-join-weeks">
              <Button variant={s.myStatus === null ? 'light' : 'default'} onClick={() => joinWeeks.mutate()} loading={joinWeeks.isPending}>
                {s.myStatus === null ? t('Join every week') : t('Join the later weeks too')}
              </Button>
            </WithInfo>
          )}
          {s.isHost ? (
            <>
              <WithInfo id="session-edit">
                <Button variant="default" onClick={onEdit}>
                  {t('Edit')}
                </Button>
              </WithInfo>
              {!hostStays && (
                <WithInfo id="session-host-leave">
                  <Button variant="default" onClick={confirmLeaveAsHost}>
                    {t('Leave')}
                  </Button>
                </WithInfo>
              )}
              <WithInfo id="session-cancel">
                <Button variant="subtle" color="red" onClick={confirmCancel}>
                  {t('Cancel session')}
                </Button>
              </WithInfo>
            </>
          ) : (
            s.myStatus && (
              <WithInfo id="session-leave">
                <Button variant="default" onClick={() => leave.mutate(undefined)}>
                  {s.myStatus === 'waitlisted' ? t('Leave waitlist') : t('Leave')}
                </Button>
              </WithInfo>
            )
          )}
          {s.myStatus && (
            <WithInfo id="session-ics">
              <Button variant="subtle" leftSection={<IconCalendarPlus size={16} />} onClick={() => addToCalendar.mutate()} loading={addToCalendar.isPending}>
                {t('Add to calendar')}
              </Button>
            </WithInfo>
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
  const calendar = useVariant('session-calendar-view');
  const cards = useVariant('session-cards');
  return (
    <>
      {!sessions.length ? (
        empty
      ) : calendar ? (
        <SessionCalendar sessions={sessions} onOpen={setOpenId} />
      ) : cards ? (
        <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="md">
          {sessions.map((s) => (
            <SessionCard key={s.id} session={s} onDetails={() => setOpenId(s.id)} />
          ))}
        </SimpleGrid>
      ) : (
        sessions.map((s) => <SessionRow key={s.id} session={s} onDetails={() => setOpenId(s.id)} />)
      )}
      <Drawer opened={open != null} onClose={() => setOpenId(null)} position="right" size="lg" title={<Text fw={800}>{t('Study session')} <ReqInfo id="session-details" /></Text>}>
        {open && <SessionDetails session={open} onEdit={() => setEditing(open)} onClose={() => setOpenId(null)} />}
      </Drawer>
      <Modal opened={editing != null} onClose={() => setEditing(null)} title={<WithInfo id="session-edit">{t('Edit session')}</WithInfo>} size="lg">
        {editing && <SessionForm classId={editing.classId} existing={editing} onDone={() => setEditing(null)} />}
      </Modal>
    </>
  );
}

// S3.4: invite codes are how people get into sessions, invite-only or not.
export function JoinByCode() {
  const byEmail = useVariant('session-invite-by-email');
  return byEmail ? null : <CodeBox />;
}

function CodeBox() {
  const navigate = useNavigate();
  const [code, setCode] = useState('');
  const join = useAction(() => rpc.studySessions.joinByCode({ code }), {
    success: (r) => (r.status === 'going' && r.weeks === 1 ? t('You\'re going to "{{title}}"!', { title: r.title }) : joinedMessage(r)),
    onSuccess: (r) => {
      setCode('');
      navigate(r.inClass ? `/classes/${r.classId}/sessions` : '/sessions');
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
        <ReqInfo id="session-join-code" />
      </Group>
    </form>
  );
}

// One form for creating a session, editing one, or setting one up for the time a poll chose.
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
  // Filling in the rest later only applies to making a new one.
  const quick = useVariant('quick-session-form') && !existing;
  const fixedTypes = useVariant('fixed-session-types');
  const allVisible = useVariant('all-sessions-visible');
  const oneOff = useVariant('one-off-sessions');
  const separateWeeks = useVariant('separate-weekly-sessions');
  const noClashNotes = useVariant('no-session-clash-notes');
  const onePlaceField = useVariant('session-place-one-field');
  const pickBuilding = useVariant('pick-session-building');
  const startAndLength = useVariant('session-start-and-length');
  const optionalLimit = useVariant('optional-session-limit');
  const autoTitle = useVariant('auto-session-title');
  const checklist = useVariant('session-goal-checklist');
  const [lengthMinutes, setLengthMinutes] = useState('120');
  const [goals, setGoals] = useState<string[]>(() => (existing?.description ?? '').split('\n').map((line) => line.replace(/^- /, '').trim()).filter(Boolean));
  // The default start: tomorrow at 18:00. dayjs values
  // never change in place; each call returns a new date.
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
      // Mantine's date pickers can hand back a string, so these fields allow
      // a Date, a string or null. toDate() converts them when they're used.
      startsAt: (existing?.startsAt ?? fromPoll?.startsAt ?? tomorrowEvening) as Date | string | null,
      endsAt: (existing?.endsAt ?? fromPoll?.endsAt ?? dayjs(tomorrowEvening).add(2, 'hour').toDate()) as Date | string | null,
      capacity: (existing?.capacity ?? 6) as number | string,
      weeks: '1',
    },
    validate: {
      classId: (v) => (v ? null : t('Pick a class')),
      title: (v) => (quick || autoTitle || v.trim() ? null : t('Give it a title')),
      location: (v, values) => (quick || values.format === 'online' || v.trim() ? null : t('Where is it? Add a room or place')),
      meetingUrl: (v, values) => (onePlaceField || values.format === 'in-person' || /^https:\/\/\S+\.\S+/.test(v.trim()) ? null : t('Add the meeting link, starting with https://')),
      capacity: (v) => ((optionalLimit && v === '') || (typeof v === 'number' && v >= 2 && v <= 30) ? null : t('Between 2 and 30 people')),
      // `toDate(v)!` asserts that the date exists, which
      // the && checks before it have just made sure of.
      endsAt: (v, values) => (startAndLength || (toDate(v) && toDate(values.startsAt) && toDate(v)! > toDate(values.startsAt)!) ? null : t('Must end after it starts')),
    },
  });
  const start = toDate(form.values.startsAt);
  const end = toDate(form.values.endsAt);
  // Warns about a clash while the time is being picked. The times are in the key as numbers
  // (getTime()), so every change asks again, and `enabled` waits for a valid range.
  const busy = useQuery({
    queryKey: ['calendar', 'busyAt', start?.getTime(), end?.getTime(), existing?.id],
    queryFn: () => rpc.calendar.busyAt({ start: start!, end: end!, exceptSessionId: existing?.id ?? null }),
    enabled: !!start && !!end && start < end,
  });
  // Builds the procedure's input from the form values, then creates or updates.
  // For a poll, it also records the chosen time, once the session exists.
  const save = useAction(
    async (v: typeof form.values) => {
      const className = classes.data?.find((c) => String(c.id) === v.classId)?.code ?? '';
      const startsAt = toDate(v.startsAt)!;
      // 'session-place-one-field': a link means a call, anything else is a place.
      const isCall = onePlaceField && /^https:\/\//.test(v.location.trim());
      const fields = {
        title: quick ? v.title.trim() || 'Study session' : autoTitle ? `${className} ${v.tag.trim() || 'study session'}` : v.title,
        description: checklist ? goals.map((goal) => `- ${goal}`).join('\n') : v.description,
        format: isCall ? ('online' as const) : onePlaceField ? ('in-person' as const) : v.format,
        location: quick ? v.location.trim() || 'To be decided' : isCall ? '' : v.location,
        meetingUrl: isCall ? v.location.trim() : v.meetingUrl,
        visibility: allVisible ? ('class' as const) : v.visibility,
        startsAt,
        endsAt: startAndLength ? new Date(startsAt.getTime() + Number(lengthMinutes) * 60_000) : toDate(v.endsAt)!,
        capacity: v.capacity === '' ? null : Number(v.capacity),
        // A tag picked in French is stored as its English original, so tags match for everyone.
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
            label={<WithInfo id="session-class">{t('Class')}</WithInfo>}
            data={classes.data?.map((c) => ({ value: String(c.id), label: c.code })) ?? []}
            disabled={!!existing || !!classId}
            allowDeselect={false}
            {...form.getInputProps('classId')}
          />
          {!quick &&
            (fixedTypes ? (
              <Select label={<WithInfo id="session-type">{t('Type')}</WithInfo>} placeholder={t('Assignment, Midterm…')} data={SESSION_TAGS.map((tag) => t(tag))} clearable {...form.getInputProps('tag')} />
            ) : (
              <Autocomplete label={<WithInfo id="session-type">{t('Type')}</WithInfo>} placeholder={t('Assignment, Midterm…')} data={SESSION_TAGS.map((tag) => t(tag))} {...form.getInputProps('tag')} />
            ))}
        </Group>
        {!quick && !autoTitle && (
          <TextInput label={<WithInfo id="session-title">{t('Topic')}</WithInfo>} placeholder={t('Do Assignment 2 together')} data-autofocus {...form.getInputProps('title')} />
        )}
        {!quick && !checklist && (
          <Textarea label={<WithInfo id="session-plan">{t("What's the plan?")}</WithInfo>} autosize minRows={2} {...form.getInputProps('description')} />
        )}
        {!quick && checklist && <TagsInput label={<WithInfo id="session-plan">Goals</WithInfo>} description="Press Enter after each." value={goals} onChange={setGoals} />}
        {!quick && onePlaceField && <TextInput label={<WithInfo id="session-where">Where</WithInfo>} placeholder="A room, or a call link" {...form.getInputProps('location')} />}
        {!quick && !onePlaceField && (
          <>
          <WithInfo id="session-format" block>
            <SegmentedControl
              data={[
                { value: 'in-person', label: t('In person') },
                { value: 'online', label: t('Online') },
              ]}
              {...form.getInputProps('format')}
            />
          </WithInfo>
          {form.values.format === 'in-person' ? (
            pickBuilding ? (
              <Select label={<WithInfo id="session-where">{t('Where')}</WithInfo>} placeholder="Pick a room" data={BOOKABLE_ROOMS} searchable {...form.getInputProps('location')} />
            ) : (
              <TextInput label={<WithInfo id="session-where">{t('Where')}</WithInfo>} placeholder={t('Cybertheque Room 2')} {...form.getInputProps('location')} />
            )
          ) : (
            <TextInput
              label={<WithInfo id="session-meeting-link">{t('Meeting link')}</WithInfo>}
              description={t('Only people going see it.')}
              placeholder="https://mcgill.zoom.us/j/…"
              {...form.getInputProps('meetingUrl')}
            />
          )}
          </>
        )}
        <Group grow>
          <DateTimePicker label={<WithInfo id="session-time">{t('Starts')}</WithInfo>} valueFormat="ddd D MMM, HH:mm" minDate={new Date()} {...form.getInputProps('startsAt')} />
          {startAndLength ? (
            <Select label={<WithInfo id="session-time">How long</WithInfo>} data={[60, 90, 120, 180].map((minutes) => ({ value: String(minutes), label: `${minutes / 60} h` }))} allowDeselect={false} value={lengthMinutes} onChange={(v) => v && setLengthMinutes(v)} />
          ) : (
            <DateTimePicker label={<WithInfo id="session-time">{t('Ends')}</WithInfo>} valueFormat="ddd D MMM, HH:mm" minDate={new Date()} {...form.getInputProps('endsAt')} />
          )}
        </Group>
        {busy.data?.what && !noClashNotes && (
          <Text size="xs" fw={700} c="orange" mt={-8}>
            {t('You have {{what}} then', { what: busy.data.what })} <ReqInfo id="session-clash" />
          </Text>
        )}
        {!existing && !fromPoll && !quick && !oneOff && (
          <Select
            label={<WithInfo id="session-weekly">{t('Repeats')}</WithInfo>}
            description={separateWeeks ? 'Each week is its own session, with its own code.' : t('Weekly sessions share one invite code, which joins every week.')}
            data={[
              { value: '1', label: t("Doesn't repeat") },
              ...[2, 3, 4, 6, 8, 10, 12].map((n) => ({ value: String(n), label: t('Every week, {{count}} times', { count: n }) })),
            ]}
            allowDeselect={false}
            {...form.getInputProps('weeks')}
          />
        )}
        {!quick && <Group grow align="flex-start">
          <NumberInput label={<WithInfo id="session-capacity">{t('Max people')}</WithInfo>} description={optionalLimit ? 'Optional. Once it’s full, nobody else can join.' : t('Others join a waitlist once it’s full')} min={2} max={30} {...form.getInputProps('capacity')} />
          {!fromPoll && !allVisible && (
            <Select
              label={<WithInfo id="session-visibility">{t('Who can see it')}</WithInfo>}
              data={[
                { value: 'class', label: t('Everyone in the section') },
                { value: 'invite', label: t('Only people with the invite code') },
              ]}
              allowDeselect={false}
              {...form.getInputProps('visibility')}
            />
          )}
        </Group>}
        <Group justify="flex-end">
          <Button type="submit" loading={save.isPending}>
            {existing ? t('Save') : t('Create session')}
          </Button>
        </Group>
      </Stack>
    </form>
  );
}

// 'pick-session-building': a sample of McGill's buildings and bookable rooms.
const BOOKABLE_ROOMS = ['Burnside Hall 1B45', 'Cybertheque Room 2', 'Leacock 132', 'McConnell Engineering 304', 'McLennan Library 3rd floor', 'Redpath Library Room A', 'Rutherford Physics 112', 'Schulich Library Room 2', 'Trottier 3120'];

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
    onSuccess: (r) => navigate(r.inClass ? `/classes/${r.classId}/sessions` : '/sessions'),
  });
  const outsideClass = useVariant('invite-outside-class');

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
          <WithInfo id="post-class"><Tag>{s.classLabel}</Tag></WithInfo>
          {s.tag && <WithInfo id="session-type"><Tag color="periwinkle">{t(s.tag)}</Tag></WithInfo>}
          {s.visibility === 'invite' && <WithInfo id="session-visibility"><Tag color="grape">{t('Invite only')}</Tag></WithInfo>}
          {s.seriesId != null && <WithInfo id="session-weekly"><Tag color="cyan">{t('Weekly')}</Tag></WithInfo>}
          {s.cancelledAt && <WithInfo id="session-cancel"><Tag color="red">{t('Cancelled')}</Tag></WithInfo>}
        </Group>
        <Title order={2}>
          {s.title} <ReqInfo id="session-invite-page" />
        </Title>
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
        ) : !s.inClass && !outsideClass ? (
          <Group justify="space-between">
            <Text size="sm">{t('This session is for {{class}}. Join that class first.', { class: s.classLabel })}</Text>
            <Button component={Link} to={`/classes/${s.classId}`} variant="light">
              {t('Go to {{code}}', { code: s.classLabel })}
            </Button>
          </Group>
        ) : (
          <Group justify="flex-end">
            <WithInfo id="session-join">
              <Button onClick={() => join.mutate()} loading={join.isPending} variant={s.isFull ? 'default' : 'filled'}>
                {s.isFull ? t('Join waitlist') : t('Join')}
              </Button>
            </WithInfo>
          </Group>
        )}
      </Stack>
    </Card>
  );
}
