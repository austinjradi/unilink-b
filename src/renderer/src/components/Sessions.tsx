import { useState } from 'react';
import {
  ActionIcon,
  Autocomplete,
  Button,
  Card,
  Divider,
  Drawer,
  Group,
  Modal,
  NumberInput,
  Select,
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
import { IconClock, IconMapPin, IconMessageDots, IconUsers } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { plural, toDate } from '../lib/format';
import { useAction } from '../lib/hooks';
import { type Out, rpc } from '../lib/rpc';
import { GoatAvatar } from './Goat';
import { Tag } from './ui';

// S3 study sessions in the layout of the wireframes (A2Team.pdf p. 12–13): rows with the
// class and type tags, when and where, how many are going, and a join/details action.

export type Session = Out<typeof rpc.studySessions.list>[number];

export const SESSION_TAGS = ['Assignment', 'Midterm', 'Final', 'Lab', 'Project', 'Review'];

function when(s: Session) {
  const start = dayjs(s.startsAt);
  return `${start.format('D MMMM HH:mm')}–${dayjs(s.endsAt).format(start.isSame(s.endsAt, 'day') ? 'HH:mm' : 'D MMM HH:mm')}`;
}

export function SessionRow({ session: s, onDetails }: { session: Session; onDetails: () => void }) {
  const join = useAction(() => rpc.studySessions.join({ sessionId: s.id }), { success: "You're going!" });
  const decline = useAction(() => rpc.studySessions.leave({ sessionId: s.id }), { success: 'Invitation declined' });
  return (
    <Group wrap="nowrap" py="md" gap="lg" align="center" style={{ borderBottom: '1.5px solid var(--ul-border)' }}>
      <div style={{ flex: 1.4, minWidth: 0 }}>
        <Group gap={6} mb={6}>
          <Tag>{s.classLabel}</Tag>
          {s.tag && <Tag color="periwinkle">{s.tag}</Tag>}
          {s.cancelledAt && <Tag color="red">Cancelled</Tag>}
          {!s.cancelledAt && s.myStatus === 'invited' && <Tag color="yellow">Invited</Tag>}
        </Group>
        <Text fw={800} td={s.cancelledAt ? 'line-through' : undefined} lineClamp={1}>
          {s.title}
        </Text>
      </div>
      <div style={{ flex: 1.3, minWidth: 0 }}>
        <Text size="lg" fw={600} lh={1.2}>
          {when(s)}
        </Text>
        <Text size="md" lh={1.3} c="dimmed" lineClamp={1}>
          {s.location}
        </Text>
      </div>
      <div style={{ width: 100 }}>
        <Text size="lg" fw={600} lh={1.2}>
          {s.going.length}
          {s.capacity ? `/${s.capacity}` : ''}
        </Text>
        <Text size="sm" c="dimmed">
          members
        </Text>
      </div>
      <Group gap="xs" wrap="nowrap" w={170} justify="flex-end">
        {!s.cancelledAt && s.myStatus === null && (
          <Button onClick={() => join.mutate()} disabled={s.isFull} loading={join.isPending}>
            {s.isFull ? 'Full' : 'Join'}
          </Button>
        )}
        {!s.cancelledAt && s.myStatus === 'invited' && (
          <>
            <Button size="xs" onClick={() => join.mutate()} disabled={s.isFull}>
              Accept
            </Button>
            <Button size="xs" variant="default" onClick={() => decline.mutate()}>
              Decline
            </Button>
          </>
        )}
        {s.myStatus === 'going' && (
          <Text size="sm" fw={800} c="teal">
            {s.isHost ? 'Hosting' : 'Going'}
          </Text>
        )}
        <Tooltip label="Details, people and invites">
          <ActionIcon variant="subtle" size="xl" radius="xl" onClick={onDetails} aria-label={`Details for ${s.title}`}>
            <IconMessageDots size={30} stroke={1.6} />
          </ActionIcon>
        </Tooltip>
      </Group>
    </Group>
  );
}

export function SessionDetails({ session: s, onEdit, onClose }: { session: Session; onEdit: () => void; onClose: () => void }) {
  const [inviting, setInviting] = useState(false);
  const join = useAction(() => rpc.studySessions.join({ sessionId: s.id }), { success: "You're going!" });
  const leave = useAction(() => rpc.studySessions.leave({ sessionId: s.id }), { success: 'You left the session', onSuccess: onClose });
  const cancel = useAction(() => rpc.studySessions.cancel({ sessionId: s.id }), { success: 'Session cancelled', onSuccess: onClose });

  const confirmCancel = () =>
    modals.openConfirmModal({
      title: 'Cancel this session?',
      children: <Text size="sm">Everyone going or invited will be told it's cancelled.</Text>,
      labels: { confirm: 'Cancel session', cancel: 'Keep it' },
      confirmProps: { color: 'red' },
      onConfirm: () => cancel.mutate(),
    });

  return (
    <Stack>
      <Group gap={6}>
        <Tag>{s.classLabel}</Tag>
        {s.tag && <Tag color="periwinkle">{s.tag}</Tag>}
      </Group>
      <Title order={2}>{s.title}</Title>
      <Group gap="lg" c="dimmed">
        <Group gap={6}>
          <IconClock size={16} />
          <Text>{when(s)}</Text>
        </Group>
        <Group gap={6}>
          <IconMapPin size={16} />
          <Text>{s.location}</Text>
        </Group>
      </Group>
      {s.description && <Text style={{ whiteSpace: 'pre-wrap' }}>{s.description}</Text>}
      <Divider label={`${s.going.length}${s.capacity ? ` of ${s.capacity}` : ''} going${s.invitedCount ? ` · ${plural(s.invitedCount, 'invite')} pending` : ''}`} labelPosition="left" />
      <Stack gap="xs">
        {s.going.map((g) => (
          <Group key={g.userId} gap="sm">
            <GoatAvatar goat={g.goat} size={36} />
            <div>
              <Text size="sm" fw={700}>
                {g.name} {g.userId === s.hostId && <Text span size="xs" c="dimmed">(host)</Text>}
              </Text>
              <Text size="xs" c="dimmed">
                {g.email}
              </Text>
            </div>
          </Group>
        ))}
      </Stack>
      {!s.cancelledAt && (
        <Group mt="md">
          {s.myStatus !== 'going' && (
            <Button onClick={() => join.mutate()} disabled={s.isFull}>
              {s.myStatus === 'invited' ? 'Accept invitation' : 'Join'}
            </Button>
          )}
          {s.myStatus === 'going' && (
            <Button variant="light" leftSection={<IconUsers size={16} />} onClick={() => setInviting(true)}>
              Invite classmates
            </Button>
          )}
          {s.isHost ? (
            <>
              <Button variant="default" onClick={onEdit}>
                Edit
              </Button>
              <Button variant="subtle" color="red" onClick={confirmCancel}>
                Cancel session
              </Button>
            </>
          ) : (
            s.myStatus && (
              <Button variant="default" onClick={() => leave.mutate()}>
                {s.myStatus === 'invited' ? 'Decline' : 'Leave'}
              </Button>
            )
          )}
        </Group>
      )}
      <Modal opened={inviting} onClose={() => setInviting(false)} title="Invite classmates">
        <InviteForm session={s} onDone={() => setInviting(false)} />
      </Modal>
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
      <Drawer opened={open != null} onClose={() => setOpenId(null)} position="right" size="lg" title={<Text fw={800}>Study session</Text>}>
        {open && <SessionDetails session={open} onEdit={() => setEditing(open)} onClose={() => setOpenId(null)} />}
      </Drawer>
      <Modal opened={editing != null} onClose={() => setEditing(null)} title="Edit session" size="lg">
        {editing && <SessionForm classId={editing.classId} existing={editing} onDone={() => setEditing(null)} />}
      </Modal>
    </>
  );
}

export function SessionForm({ classId, existing, onDone }: { classId: number | null; existing: Session | null; onDone: () => void }) {
  const classes = useQuery({ queryKey: ['classes', 'mine'], queryFn: () => rpc.classes.mine() });
  const tomorrowEvening = dayjs().add(1, 'day').hour(18).minute(0).second(0).toDate();
  const form = useForm({
    initialValues: {
      classId: String(existing?.classId ?? classId ?? ''),
      tag: existing?.tag ?? '',
      title: existing?.title ?? '',
      description: existing?.description ?? '',
      location: existing?.location ?? '',
      startsAt: (existing?.startsAt ?? tomorrowEvening) as Date | string | null,
      endsAt: (existing?.endsAt ?? dayjs(tomorrowEvening).add(2, 'hour').toDate()) as Date | string | null,
      capacity: existing?.capacity ?? ('' as number | string),
    },
    validate: {
      classId: (v) => (v ? null : 'Pick a class'),
      title: (v) => (v.trim() ? null : 'Give it a title'),
      location: (v) => (v.trim() ? null : 'Where is it? A room, a library, or a call link'),
      endsAt: (v, values) => (toDate(v) && toDate(values.startsAt) && toDate(v)! > toDate(values.startsAt)! ? null : 'Must end after it starts'),
    },
  });
  const save = useAction(
    async (v: typeof form.values) => {
      const fields = {
        title: v.title,
        description: v.description,
        location: v.location,
        startsAt: toDate(v.startsAt)!,
        endsAt: toDate(v.endsAt)!,
        capacity: v.capacity === '' ? null : Number(v.capacity),
        tag: v.tag.trim() || null,
      };
      if (existing) await rpc.studySessions.update({ sessionId: existing.id, ...fields });
      else await rpc.studySessions.create({ classId: Number(v.classId), ...fields });
    },
    { success: existing ? 'Session updated' : 'Session created. Invite some classmates!', onSuccess: onDone },
  );

  return (
    <form onSubmit={form.onSubmit((v) => save.mutate(v))}>
      <Stack>
        <Group grow align="flex-start">
          <Select
            label="Class"
            data={classes.data?.map((c) => ({ value: String(c.id), label: `${c.subject} ${c.number}` })) ?? []}
            disabled={!!existing || !!classId}
            allowDeselect={false}
            {...form.getInputProps('classId')}
          />
          <Autocomplete label="Type" placeholder="Assignment, Midterm…" data={SESSION_TAGS} {...form.getInputProps('tag')} />
        </Group>
        <TextInput label="Topic" placeholder="Do Assignment 2 together" data-autofocus {...form.getInputProps('title')} />
        <Textarea label="What's the plan?" autosize minRows={2} {...form.getInputProps('description')} />
        <TextInput label="Location or call link" placeholder="Cybertheque Room 2, or a Zoom link" {...form.getInputProps('location')} />
        <Group grow>
          <DateTimePicker label="Starts" valueFormat="ddd D MMM, HH:mm" minDate={new Date()} {...form.getInputProps('startsAt')} />
          <DateTimePicker label="Ends" valueFormat="ddd D MMM, HH:mm" minDate={new Date()} {...form.getInputProps('endsAt')} />
        </Group>
        <NumberInput label="Max people" description="Leave empty for no limit" min={2} max={500} w={200} {...form.getInputProps('capacity')} />
        <Group justify="flex-end">
          <Button type="submit" loading={save.isPending}>
            {existing ? 'Save' : 'Create session'}
          </Button>
        </Group>
      </Stack>
    </form>
  );
}

function InviteForm({ session, onDone }: { session: Session; onDone: () => void }) {
  const [emails, setEmails] = useState<string[]>([]);
  const classmates = useQuery({ queryKey: ['classes', 'classmates', session.classId], queryFn: () => rpc.classes.classmates({ classId: session.classId }) });
  const invite = useAction(() => rpc.studySessions.invite({ sessionId: session.id, emails }), {
    success: (r) => `Invited ${plural(r.invited, 'classmate')}${r.alreadyIn ? ` (${r.alreadyIn} already in)` : ''}`,
    onSuccess: onDone,
  });

  return (
    <Stack>
      <TagsInput
        label="Their McGill emails"
        description="Classmates must be in this class on UniLink. Press Enter after each email."
        placeholder="first.last@mail.mcgill.ca"
        data={classmates.data?.map((c) => ({ value: c.email, label: `${c.name} (${c.email})` })) ?? []}
        value={emails}
        onChange={setEmails}
        data-autofocus
      />
      <Group justify="flex-end">
        <Button onClick={() => invite.mutate()} disabled={!emails.length} loading={invite.isPending}>
          Send invites
        </Button>
      </Group>
    </Stack>
  );
}

export function SessionsCard({ children }: { children: React.ReactNode }) {
  return (
    <Card padding="lg" style={{ background: 'var(--ul-soft)' }}>
      {children}
    </Card>
  );
}
