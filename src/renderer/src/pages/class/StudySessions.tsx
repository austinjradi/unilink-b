import { useState } from 'react';
import { Avatar, Badge, Button, Card, Group, Modal, NumberInput, Stack, TagsInput, Text, Textarea, TextInput, Tooltip } from '@mantine/core';
import { DateTimePicker } from '@mantine/dates';
import { useForm } from '@mantine/form';
import { modals } from '@mantine/modals';
import { IconClock, IconMapPin, IconPlus, IconUsersGroup } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { initials } from '../../components/Layout';
import { Empty, Loading, SectionCard } from '../../components/ui';
import { fmtDateTime, fmtTime, plural, toDate } from '../../lib/format';
import { useAction } from '../../lib/hooks';
import { type Out, rpc } from '../../lib/rpc';

type Session = Out<typeof rpc.studySessions.list>[number];

// S3: host, join, and invite classmates to study sessions.
export function StudySessions({ classId }: { classId: number }) {
  const sessions = useQuery({ queryKey: ['studySessions', classId], queryFn: () => rpc.studySessions.list({ classId }) });
  const [editing, setEditing] = useState<Session | 'new' | null>(null);
  const [inviting, setInviting] = useState<Session | null>(null);

  return (
    <SectionCard
      title="Upcoming study sessions"
      actions={
        <Button size="xs" leftSection={<IconPlus size={14} />} onClick={() => setEditing('new')}>
          Host a session
        </Button>
      }
    >
      {sessions.isPending ? (
        <Loading />
      ) : sessions.data?.length ? (
        <Stack gap="sm">
          {sessions.data.map((s) => (
            <SessionCard key={s.id} session={s} onEdit={() => setEditing(s)} onInvite={() => setInviting(s)} />
          ))}
        </Stack>
      ) : (
        <Empty icon={<IconUsersGroup size={22} />}>No sessions planned. Host one and invite your classmates!</Empty>
      )}

      <Modal opened={editing != null} onClose={() => setEditing(null)} title={editing === 'new' ? 'Host a study session' : 'Edit session'} size="lg">
        {editing && (
          <SessionForm
            key={editing === 'new' ? 'new' : editing.id}
            classId={classId}
            existing={editing === 'new' ? null : editing}
            onDone={() => setEditing(null)}
          />
        )}
      </Modal>
      <Modal opened={inviting != null} onClose={() => setInviting(null)} title="Invite classmates">
        {inviting && <InviteForm classId={classId} session={inviting} onDone={() => setInviting(null)} />}
      </Modal>
    </SectionCard>
  );
}

function SessionCard({ session: s, onEdit, onInvite }: { session: Session; onEdit: () => void; onInvite: () => void }) {
  const join = useAction(() => rpc.studySessions.join({ sessionId: s.id }), { success: "You're going!" });
  const leave = useAction(() => rpc.studySessions.leave({ sessionId: s.id }), {
    success: s.myStatus === 'invited' ? 'Invitation declined' : 'You left the session',
  });
  const cancel = useAction(() => rpc.studySessions.cancel({ sessionId: s.id }), { success: 'Session cancelled' });
  const sameDay = dayjs(s.startsAt).isSame(s.endsAt, 'day');

  const confirmCancel = () =>
    modals.openConfirmModal({
      title: 'Cancel this session?',
      children: <Text size="sm">Everyone going or invited will see it as cancelled.</Text>,
      labels: { confirm: 'Cancel session', cancel: 'Keep it' },
      confirmProps: { color: 'red' },
      onConfirm: () => cancel.mutate(),
    });

  return (
    <Card withBorder padding="md" opacity={s.cancelledAt ? 0.6 : 1}>
      <Group justify="space-between" align="flex-start" wrap="nowrap">
        <div style={{ minWidth: 0 }}>
          <Group gap="xs" mb={4}>
            <Text fw={600} td={s.cancelledAt ? 'line-through' : undefined}>
              {s.title}
            </Text>
            {s.cancelledAt && <Badge color="red" variant="light" size="sm">Cancelled</Badge>}
            {!s.cancelledAt && s.myStatus === 'going' && <Badge color="teal" variant="light" size="sm">{s.isHost ? 'Hosting' : 'Going'}</Badge>}
            {!s.cancelledAt && s.myStatus === 'invited' && <Badge color="indigo" variant="light" size="sm">Invited</Badge>}
            {!s.cancelledAt && s.isFull && <Badge color="gray" variant="light" size="sm">Full</Badge>}
          </Group>
          <Group gap="md" c="dimmed">
            <Group gap={4}>
              <IconClock size={14} />
              <Text size="sm">
                {fmtDateTime(s.startsAt)} – {sameDay ? fmtTime(s.endsAt) : fmtDateTime(s.endsAt)}
              </Text>
            </Group>
            <Group gap={4}>
              <IconMapPin size={14} />
              <Text size="sm">{s.location}</Text>
            </Group>
          </Group>
          {s.description && (
            <Text size="sm" mt="xs" style={{ whiteSpace: 'pre-wrap' }}>
              {s.description}
            </Text>
          )}
          <Group gap="xs" mt="sm">
            <Avatar.Group spacing={6}>
              {s.going.slice(0, 5).map((g) => (
                <Tooltip key={g.userId} label={`${g.name} · ${g.email}`}>
                  <Avatar size="sm" radius="xl" color="teal">
                    {initials(g.name)}
                  </Avatar>
                </Tooltip>
              ))}
            </Avatar.Group>
            <Text size="xs" c="dimmed">
              {s.going.length}
              {s.capacity ? `/${s.capacity}` : ''} going · hosted by {s.isHost ? 'you' : (s.host?.name ?? 'a classmate')}
              {s.invitedCount > 0 && ` · ${plural(s.invitedCount, 'invite')} pending`}
            </Text>
          </Group>
        </div>

        {!s.cancelledAt && (
          <Stack gap={6} align="flex-end">
            {s.isHost ? (
              <>
                <Button size="xs" variant="light" onClick={onInvite}>Invite</Button>
                <Group gap={6}>
                  <Button size="xs" variant="default" onClick={onEdit}>Edit</Button>
                  <Button size="xs" variant="subtle" color="red" onClick={confirmCancel}>Cancel</Button>
                </Group>
              </>
            ) : s.myStatus === 'going' ? (
              <>
                <Button size="xs" variant="light" onClick={onInvite}>Invite</Button>
                <Button size="xs" variant="default" onClick={() => leave.mutate()}>Leave</Button>
              </>
            ) : (
              <Group gap={6}>
                <Button size="xs" onClick={() => join.mutate()} disabled={s.isFull} loading={join.isPending}>
                  {s.myStatus === 'invited' ? 'Accept' : 'Join'}
                </Button>
                {s.myStatus === 'invited' && (
                  <Button size="xs" variant="default" onClick={() => leave.mutate()}>Decline</Button>
                )}
              </Group>
            )}
          </Stack>
        )}
      </Group>
    </Card>
  );
}

function SessionForm({ classId, existing, onDone }: { classId: number; existing: Session | null; onDone: () => void }) {
  const tomorrowEvening = dayjs().add(1, 'day').hour(18).minute(0).second(0).toDate();
  const form = useForm({
    initialValues: {
      title: existing?.title ?? '',
      description: existing?.description ?? '',
      location: existing?.location ?? '',
      startsAt: (existing?.startsAt ?? tomorrowEvening) as Date | string | null,
      endsAt: (existing?.endsAt ?? dayjs(tomorrowEvening).add(2, 'hour').toDate()) as Date | string | null,
      capacity: existing?.capacity ?? ('' as number | string),
    },
    validate: {
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
      };
      if (existing) await rpc.studySessions.update({ sessionId: existing.id, ...fields });
      else await rpc.studySessions.create({ classId, ...fields });
    },
    { success: existing ? 'Session updated' : 'Session created. Invite some classmates!', onSuccess: onDone },
  );

  return (
    <form onSubmit={form.onSubmit((v) => save.mutate(v))}>
      <Stack>
        <TextInput label="Title" placeholder="Midterm review" data-autofocus {...form.getInputProps('title')} />
        <Textarea label="What's the plan?" autosize minRows={2} {...form.getInputProps('description')} />
        <TextInput label="Location" placeholder="Schulich Library, 3rd floor" {...form.getInputProps('location')} />
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

function InviteForm({ classId, session, onDone }: { classId: number; session: Session; onDone: () => void }) {
  const [emails, setEmails] = useState<string[]>([]);
  const classmates = useQuery({ queryKey: ['classes', 'classmates', classId], queryFn: () => rpc.classes.classmates({ classId }) });
  const invite = useAction(() => rpc.studySessions.invite({ sessionId: session.id, emails }), {
    success: (r) => `Invited ${plural(r.invited, 'classmate')}${r.alreadyIn ? ` (${r.alreadyIn} already in)` : ''}`,
    onSuccess: onDone,
  });

  return (
    <Stack>
      <TagsInput
        label="McGill emails"
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
