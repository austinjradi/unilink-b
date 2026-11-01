import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';

dayjs.extend(relativeTime);

export const fmtDateTime = (d: Date) => dayjs(d).format('ddd D MMM, HH:mm');
export const fmtDate = (d: Date | string) => dayjs(d).format('ddd D MMM');
export const fmtTime = (d: Date) => dayjs(d).format('HH:mm');
export const fromNow = (d: Date) => dayjs(d).fromNow();

// Mantine date pickers hand back "YYYY-MM-DD HH:mm:ss" strings.
export const toDate = (value: string | Date | null | undefined) => (value ? dayjs(value).toDate() : null);

export function dayLabel(day: string, today: string) {
  const diff = dayjs(day).diff(dayjs(today), 'day');
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  return fmtDate(day);
}

export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
