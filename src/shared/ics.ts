// G2: minimal iCalendar export (to Google Calendar) and import (from myCourses).

export interface IcsEvent {
  uid: string;
  title: string;
  start: Date;
  end: Date;
  description?: string;
  location?: string;
  // Weekly recurrence for class times.
  weekly?: { until: Date };
}

const pad = (n: number) => String(n).padStart(2, '0');

function localStamp(d: Date): string {
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T${pad(d.getHours())}${pad(d.getMinutes())}00`;
}

function utcStamp(d: Date): string {
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

function escapeText(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

const encoder = new TextEncoder();

// Lines longer than 75 octets must be folded; continuation lines start with a space (RFC 5545 §3.1).
function fold(line: string): string {
  const parts: string[] = [];
  let current = '';
  let octets = 0;
  for (const char of line) {
    const size = encoder.encode(char).length;
    if (octets + size > (parts.length ? 74 : 75)) {
      parts.push(current);
      current = '';
      octets = 0;
    }
    current += char;
    octets += size;
  }
  parts.push(current);
  return parts.join('\r\n ');
}

export function buildCalendar(events: IcsEvent[], timeZone: string): string {
  const now = utcStamp(new Date());
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//UniLink//EN', 'CALSCALE:GREGORIAN', 'X-WR-CALNAME:UniLink'];
  for (const e of events) {
    lines.push(
      'BEGIN:VEVENT',
      `UID:${e.uid}`,
      `DTSTAMP:${now}`,
      `DTSTART;TZID=${timeZone}:${localStamp(e.start)}`,
      `DTEND;TZID=${timeZone}:${localStamp(e.end)}`,
      `SUMMARY:${escapeText(e.title)}`,
    );
    if (e.description) lines.push(`DESCRIPTION:${escapeText(e.description)}`);
    if (e.location) lines.push(`LOCATION:${escapeText(e.location)}`);
    if (e.weekly) lines.push(`RRULE:FREQ=WEEKLY;UNTIL=${utcStamp(e.weekly.until)}`);
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}

export interface ParsedEvent {
  uid: string | null;
  title: string;
  start: Date;
  description: string;
}

function unescapeText(text: string): string {
  return text.replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1');
}

function parseStamp(value: string): Date | null {
  const m = value.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/);
  if (!m) return null;
  const [, y, mo, d, h = '23', mi = '59', s = '00', z] = m;
  const parts = [Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s)] as const;
  // Date-only values are deadlines "on that day", so treat them as due at 23:59.
  return z ? new Date(Date.UTC(...parts)) : new Date(...parts);
}

export function parseCalendar(text: string): ParsedEvent[] {
  const lines = text.replace(/\r?\n[ \t]/g, '').split(/\r?\n/);
  const events: ParsedEvent[] = [];
  let current: Record<string, string> | null = null;

  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') current = {};
    else if (line === 'END:VEVENT' && current) {
      const start = current.DTSTART ? parseStamp(current.DTSTART) : null;
      if (start && current.SUMMARY) {
        events.push({
          uid: current.UID ?? null,
          title: unescapeText(current.SUMMARY),
          start,
          description: unescapeText(current.DESCRIPTION ?? ''),
        });
      }
      current = null;
    } else if (current) {
      const colon = line.indexOf(':');
      if (colon > 0) current[line.slice(0, colon).split(';')[0].toUpperCase()] = line.slice(colon + 1);
    }
  }
  return events;
}
