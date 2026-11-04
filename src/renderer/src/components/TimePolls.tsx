import { useState } from 'react';
import { ActionIcon, Button, Card, Checkbox, Group, Modal, Select, Stack, Text, TextInput, Title, Tooltip } from '@mantine/core';
import { DateTimePicker } from '@mantine/dates';
import { useForm } from '@mantine/form';
import { IconPlus, IconTrash } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { fmtDateTime, fmtTime, toDate } from '../lib/format';
import { useAction } from '../lib/hooks';
import { t } from '../lib/i18n';
import { type Out, rpc } from '../lib/rpc';
import { useVariant } from '../lib/variants';
import { SessionForm } from './Sessions';
import { Tag } from './ui';
import { ReqInfo, WithInfo } from './ReqInfo';

type Poll = Out<typeof rpc.timePolls.list>[number];
type Picked = { optionId: number; classId: number; title: string; startsAt: Date; endsAt: Date };

// S3: offer a few times before setting up a session, and let the section say which work.
// With no classId, the open questions in all of a student's sections.
export function TimePolls({ classId }: { classId: number | null }) {
  const polls = useQuery({ queryKey: ['timePolls', classId], queryFn: () => rpc.timePolls.list({ classId }) });
  const [picked, setPicked] = useState<Picked | null>(null);
  if (!polls.data?.length) return null;
  return (
    <Stack gap="sm" mb="md">
      {polls.data.map((poll) => (
        <PollCard key={poll.id} poll={poll} showClass={classId == null} onPick={setPicked} />
      ))}
      <Modal opened={picked != null} onClose={() => setPicked(null)} title={<WithInfo id="poll-pick">{t('Set up the study session')}</WithInfo>} size="lg">
        {picked && <SessionForm classId={picked.classId} existing={null} fromPoll={picked} onDone={() => setPicked(null)} />}
      </Modal>
    </Stack>
  );
}

// 'availability-grid': the offered times as a grid of days and hours, shaded by how many are free.
function AvailabilityGrid({ poll, onPick }: { poll: Poll; onPick: (picked: Picked) => void }) {
  const vote = useAction((v: { optionId: number; on: boolean }) => rpc.timePolls.vote(v));
  const [picking, setPicking] = useState(false);
  const days = [...new Set(poll.options.map((o) => dayjs(o.startsAt).format('YYYY-MM-DD')))];
  const hours = [...new Set(poll.options.map((o) => dayjs(o.startsAt).format('HH:mm')))].sort();
  const most = Math.max(1, ...poll.options.map((o) => o.votes));
  const optionAt = (day: string, hour: string) => poll.options.find((o) => dayjs(o.startsAt).format('YYYY-MM-DD') === day && dayjs(o.startsAt).format('HH:mm') === hour);
  return (
    <Stack gap="xs">
      <div style={{ display: 'grid', gridTemplateColumns: `56px repeat(${days.length}, minmax(44px, 1fr))`, gap: 2, overflowX: 'auto' }}>
        <div />
        {days.map((day) => (
          <Text key={day} size="xs" fw={700} ta="center">
            {dayjs(day).format('ddd D')}
          </Text>
        ))}
        {hours.map((hour) => (
          <div key={hour} style={{ display: 'contents' }}>
            <Text size="xs" c="dimmed" ta="right" pr={4}>
              {hour}
            </Text>
            {days.map((day) => {
              const option = optionAt(day, hour);
              if (!option) return <div key={day} />;
              return (
                <button
                  key={day}
                  type="button"
                  title={`${option.votes} free${option.voters.length ? `: ${option.voters.join(', ')}` : ''}`}
                  aria-pressed={option.voted}
                  aria-label={`${dayjs(option.startsAt).format('ddd D, HH:mm')}: ${option.votes} free`}
                  onClick={() => (picking ? onPick({ optionId: option.id, classId: poll.classId, title: poll.title, startsAt: option.startsAt, endsAt: option.endsAt }) : vote.mutate({ optionId: option.id, on: !option.voted }))}
                  style={{
                    height: 24,
                    borderRadius: 4,
                    cursor: 'pointer',
                    border: option.voted ? '2px solid var(--mantine-color-teal-6)' : '1px solid var(--ul-border)',
                    background: option.votes ? `color-mix(in srgb, var(--mantine-color-teal-5) ${Math.round((option.votes / most) * 80)}%, transparent)` : 'transparent',
                    fontSize: 11,
                  }}
                >
                  {option.votes || ''}
                </button>
              );
            })}
          </div>
        ))}
      </div>
      <Text size="xs" c="dimmed">
        {picking ? 'Click the time to go with.' : 'Click the times you’re free. Darker means more people are.'}
      </Text>
      {poll.mine && (
        <Button size="compact-xs" variant="light" w="fit-content" onClick={() => setPicking((on) => !on)}>
          {picking ? t('Cancel') : t('Pick this time')}
        </Button>
      )}
    </Stack>
  );
}

function PollCard({ poll, showClass, onPick }: { poll: Poll; showClass: boolean; onPick: (picked: Picked) => void }) {
  const grid = useVariant('availability-grid');
  const vote = useAction((v: { optionId: number; on: boolean }) => rpc.timePolls.vote(v));
  const remove = useAction(() => rpc.timePolls.remove({ pollId: poll.id }));
  const most = Math.max(...poll.options.map((o) => o.votes));
  return (
    <Card padding="lg">
      <Group justify="space-between" align="flex-start" wrap="nowrap" mb="sm">
        <div style={{ minWidth: 0 }}>
          {showClass && poll.classLabel && (
            <Group mb={6}>
              <WithInfo id="post-class">
                <Tag>{poll.classLabel}</Tag>
              </WithInfo>
            </Group>
          )}
          <Title order={4}>
            {poll.title} <ReqInfo id="poll-card" />
          </Title>
          <Text size="sm" c="dimmed">
            {poll.mine ? t('You asked when works. Pick a time once people have answered.') : t('{{name}} asks: which times work for you?', { name: poll.hostName })}
          </Text>
        </div>
        {poll.mine && (
          <WithInfo id="poll-remove">
            <Tooltip label={t('Remove')}>
              <ActionIcon variant="subtle" color="red" size="sm" onClick={() => remove.mutate()} aria-label={t('Delete {{name}}', { name: poll.title })}>
                <IconTrash size={14} />
              </ActionIcon>
            </Tooltip>
          </WithInfo>
        )}
      </Group>
      {poll.closesAt && (
        <Text size="xs" c="dimmed" mb="xs">
          Closes on its own {dayjs(poll.closesAt).format('MMM D')}.
        </Text>
      )}
      {grid && <AvailabilityGrid poll={poll} onPick={onPick} />}
      <Stack gap={8} display={grid ? 'none' : undefined}>
        {poll.options.map((o) => (
          <Group key={o.id} justify="space-between" wrap="nowrap" gap="sm">
            <Checkbox
              label={<WithInfo id="poll-vote">{`${fmtDateTime(o.startsAt)}–${fmtTime(o.endsAt)}`}</WithInfo>}
              description={o.clash ? t('You have {{what}} then', { what: o.clash }) : undefined}
              styles={{ description: { color: 'var(--mantine-color-orange-text)', fontWeight: 700 } }}
              checked={o.voted}
              onChange={(e) => vote.mutate({ optionId: o.id, on: e.currentTarget.checked })}
            />
            <Group gap="sm" wrap="nowrap">
              {o.voters.length > 0 && (
                <Text size="xs" c="dimmed">
                  {o.voters.join(', ')}
                </Text>
              )}
              <Text size="sm" fw={o.votes > 0 && o.votes === most ? 800 : 500} c={o.votes > 0 && o.votes === most ? 'teal' : 'dimmed'} style={{ whiteSpace: 'nowrap' }}>
                {t('{{count}} can make it', { count: o.votes })}
              </Text>
              {poll.mine && (
                <WithInfo id="poll-pick">
                  <Button size="compact-xs" variant="light" onClick={() => onPick({ optionId: o.id, classId: poll.classId, title: poll.title, startsAt: o.startsAt, endsAt: o.endsAt })}>
                    {t('Pick this time')}
                  </Button>
                </WithInfo>
              )}
            </Group>
          </Group>
        ))}
      </Stack>
    </Card>
  );
}

// 'availability-grid': offers every hour in a range of days, instead of a few chosen times.
function GridPollForm({ classId, onDone }: { classId: number; onDone: () => void }) {
  const [title, setTitle] = useState('');
  const [days, setDays] = useState('5');
  const [from, setFrom] = useState('9');
  const [until, setUntil] = useState('18');
  const hours = Array.from({ length: Math.max(0, Number(until) - Number(from)) }, (_, i) => Number(from) + i);
  const tomorrow = dayjs().add(1, 'day').startOf('day');
  const times = Array.from({ length: Number(days) }, (_, d) => hours.map((h) => tomorrow.add(d, 'day').hour(h).toDate())).flat();
  const create = useAction(() => rpc.timePolls.create({ classId, title, minutes: 60, times }), { success: 'Asked. Everyone in the section can answer on this page.', onSuccess: onDone });
  return (
    <Stack>
      <TextInput label={<WithInfo id="poll-create">{t('Topic')}</WithInfo>} placeholder={t('Do Assignment 2 together')} value={title} onChange={(e) => setTitle(e.currentTarget.value)} data-autofocus />
      <Group grow>
        <Select label="Days, from tomorrow" data={['3', '5', '7', '10', '14']} allowDeselect={false} value={days} onChange={(v) => v && setDays(v)} />
        <Select label="From" data={['8', '9', '10', '11', '12', '13', '14', '15', '16', '17', '18'].map((h) => ({ value: h, label: `${h}:00` }))} allowDeselect={false} value={from} onChange={(v) => v && setFrom(v)} />
        <Select label="Until" data={['12', '14', '16', '18', '20', '22'].map((h) => ({ value: h, label: `${h}:00` }))} allowDeselect={false} value={until} onChange={(v) => v && setUntil(v)} />
      </Group>
      <Group justify="flex-end">
        <Button onClick={() => create.mutate()} disabled={!title.trim() || !times.length} loading={create.isPending}>
          {t('Ask the section')}
        </Button>
      </Group>
    </Stack>
  );
}

export function TimePollForm({ classId, onDone }: { classId: number; onDone: () => void }) {
  const grid = useVariant('availability-grid');
  return grid ? <GridPollForm classId={classId} onDone={onDone} /> : <OfferedTimesForm classId={classId} onDone={onDone} />;
}

function OfferedTimesForm({ classId, onDone }: { classId: number; onDone: () => void }) {
  const tenTimes = useVariant('poll-ten-times');
  const evening = (days: number) => dayjs().add(days, 'day').hour(18).minute(0).second(0).millisecond(0).toDate();
  const form = useForm({
    initialValues: {
      title: '',
      minutes: '120',
      times: [evening(1), evening(2)] as (Date | string | null)[],
    },
    validate: {
      title: (v) => (v.trim() ? null : t('Give it a title')),
      times: (list) => (list.every((v) => toDate(v) && toDate(v)! > new Date()) ? null : t('Pick times in the future.')),
    },
  });
  const create = useAction(
    (v: typeof form.values) => rpc.timePolls.create({ classId, title: v.title, minutes: Number(v.minutes), times: v.times.map((time) => toDate(time)!) }),
    { success: 'Asked. Everyone in the section can answer on this page.', onSuccess: onDone },
  );
  return (
    <form onSubmit={form.onSubmit((v) => create.mutate(v))}>
      <Stack>
        <TextInput label={<WithInfo id="poll-create">{t('Topic')}</WithInfo>} placeholder={t('Do Assignment 2 together')} data-autofocus {...form.getInputProps('title')} />
        <Select
          label={<WithInfo id="poll-length">{t('How long')}</WithInfo>}
          data={[60, 90, 120, 180].map((minutes) => ({ value: String(minutes), label: t('{{hours}} h', { hours: minutes / 60 }) }))}
          allowDeselect={false}
          {...form.getInputProps('minutes')}
        />
        <Stack gap="xs">
          {form.values.times.map((_, index) => (
            <Group key={index} gap="xs" wrap="nowrap" align="flex-end">
              <DateTimePicker style={{ flex: 1 }} label={index === 0 ? <WithInfo id="poll-times">{t('Times to offer')}</WithInfo> : undefined} aria-label={t('Time {{number}}', { number: index + 1 })} valueFormat="ddd D MMM, HH:mm" minDate={new Date()} {...form.getInputProps(`times.${index}`)} />
              {form.values.times.length > 2 && (
                <ActionIcon variant="subtle" color="red" mb={6} onClick={() => form.removeListItem('times', index)} aria-label={t('Remove time {{number}}', { number: index + 1 })}>
                  <IconTrash size={14} />
                </ActionIcon>
              )}
            </Group>
          ))}
          {form.errors.times && (
            <Text size="xs" c="red">
              {form.errors.times}
            </Text>
          )}
          {form.values.times.length < (tenTimes ? 10 : 5) && (
            <Button variant="subtle" size="compact-sm" w="fit-content" leftSection={<IconPlus size={14} />} onClick={() => form.insertListItem('times', evening(form.values.times.length + 1))}>
              {t('Add another time')}
            </Button>
          )}
        </Stack>
        <Group justify="flex-end">
          <Button type="submit" loading={create.isPending}>
            {t('Ask the section')}
          </Button>
        </Group>
      </Stack>
    </form>
  );
}
