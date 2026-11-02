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
import { SessionForm } from './Sessions';
import { Tag } from './ui';

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
      <Modal opened={picked != null} onClose={() => setPicked(null)} title={t('Set up the study session')} size="lg">
        {picked && <SessionForm classId={picked.classId} existing={null} fromPoll={picked} onDone={() => setPicked(null)} />}
      </Modal>
    </Stack>
  );
}

function PollCard({ poll, showClass, onPick }: { poll: Poll; showClass: boolean; onPick: (picked: Picked) => void }) {
  const vote = useAction((v: { optionId: number; on: boolean }) => rpc.timePolls.vote(v));
  const remove = useAction(() => rpc.timePolls.remove({ pollId: poll.id }));
  const most = Math.max(...poll.options.map((o) => o.votes));
  return (
    <Card padding="lg">
      <Group justify="space-between" align="flex-start" wrap="nowrap" mb="sm">
        <div style={{ minWidth: 0 }}>
          {showClass && poll.classLabel && (
            <Group mb={6}>
              <Tag>{poll.classLabel}</Tag>
            </Group>
          )}
          <Title order={4}>{poll.title}</Title>
          <Text size="sm" c="dimmed">
            {poll.mine ? t('You asked when works. Pick a time once people have answered.') : t('{{name}} asks: which times work for you?', { name: poll.hostName })}
          </Text>
        </div>
        {poll.mine && (
          <Tooltip label={t('Remove')}>
            <ActionIcon variant="subtle" color="red" size="sm" onClick={() => remove.mutate()} aria-label={t('Delete {{name}}', { name: poll.title })}>
              <IconTrash size={14} />
            </ActionIcon>
          </Tooltip>
        )}
      </Group>
      <Stack gap={8}>
        {poll.options.map((o) => (
          <Group key={o.id} justify="space-between" wrap="nowrap" gap="sm">
            <Checkbox
              label={`${fmtDateTime(o.startsAt)}–${fmtTime(o.endsAt)}`}
              description={o.clash ? t('You have {{what}} then', { what: o.clash }) : undefined}
              styles={{ description: { color: 'var(--mantine-color-orange-text)', fontWeight: 700 } }}
              checked={o.voted}
              onChange={(e) => vote.mutate({ optionId: o.id, on: e.currentTarget.checked })}
            />
            <Group gap="sm" wrap="nowrap">
              <Text size="sm" fw={o.votes > 0 && o.votes === most ? 800 : 500} c={o.votes > 0 && o.votes === most ? 'teal' : 'dimmed'} style={{ whiteSpace: 'nowrap' }}>
                {t('{{count}} can make it', { count: o.votes })}
              </Text>
              {poll.mine && (
                <Button size="compact-xs" variant="light" onClick={() => onPick({ optionId: o.id, classId: poll.classId, title: poll.title, startsAt: o.startsAt, endsAt: o.endsAt })}>
                  {t('Pick this time')}
                </Button>
              )}
            </Group>
          </Group>
        ))}
      </Stack>
    </Card>
  );
}

export function TimePollForm({ classId, onDone }: { classId: number; onDone: () => void }) {
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
        <TextInput label={t('Topic')} placeholder={t('Do Assignment 2 together')} data-autofocus {...form.getInputProps('title')} />
        <Select
          label={t('How long')}
          data={[60, 90, 120, 180].map((minutes) => ({ value: String(minutes), label: t('{{hours}} h', { hours: minutes / 60 }) }))}
          allowDeselect={false}
          {...form.getInputProps('minutes')}
        />
        <Stack gap="xs">
          {form.values.times.map((_, index) => (
            <Group key={index} gap="xs" wrap="nowrap" align="flex-end">
              <DateTimePicker style={{ flex: 1 }} label={index === 0 ? t('Times to offer') : undefined} aria-label={t('Time {{number}}', { number: index + 1 })} valueFormat="ddd D MMM, HH:mm" minDate={new Date()} {...form.getInputProps(`times.${index}`)} />
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
          {form.values.times.length < 5 && (
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
