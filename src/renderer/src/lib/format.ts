import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import { groupMeetings, type MeetingTime } from '@shared/meetings';
import { t } from './i18n';

dayjs.extend(relativeTime);

// Date patterns are translated too, since French puts the day before the month.
export const fmtDateTime = (d: Date) => dayjs(d).format(t('ddd, MMM D, HH:mm'));
export const fmtDate = (d: Date | string) => dayjs(d).format(t('ddd, MMM D'));
export const fmtTime = (d: Date) => dayjs(d).format('HH:mm');
export const fromNow = (d: Date) => dayjs(d).fromNow();

// Mantine date pickers hand back "YYYY-MM-DD HH:mm:ss" strings.
export const toDate = (value: string | Date | null | undefined) => (value ? dayjs(value).toDate() : null);

export function dayLabel(day: string, today: string) {
  const diff = dayjs(day).diff(dayjs(today), 'day');
  if (diff === 0) return t('Today');
  if (diff === 1) return t('Tomorrow');
  if (diff === -1) return t('Yesterday');
  return fmtDate(day);
}

// Weekly class times: "Mon, Wed 10:05–11:25 · Fri 13:35–14:25".
export const fmtMeetings = (meetings: MeetingTime[]) =>
  groupMeetings(meetings)
    .map((g) => `${g.weekdays.map((d) => dayjs().day(d).format('ddd')).join(', ')} ${g.startTime}–${g.endTime}`)
    .join(' · ');
