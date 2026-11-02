// A3 "imported from my syllabus": finds the dated items in a pasted syllabus schedule
// ("Assignment 2 (10%) due Oct 6 at 11:59 pm", "Midterm – Thursday, October 22, 6:30pm").
// It reads one line at a time; the student reviews what it found before anything is added.

export type SyllabusKind = 'assignment' | 'exam' | 'quiz' | 'other';

export interface SyllabusItem {
  title: string;
  kind: SyllabusKind;
  dueAt: Date;
  // Whether the line gave a time; otherwise it's due at 23:59.
  timed: boolean;
  weight: number | null;
  line: string;
}

const MONTHS: [RegExp, number][] = [
  [/^jan(uary|vier)?$/, 0],
  [/^f[eé]v(rier)?$|^feb(ruary)?$/, 1],
  [/^mar(ch|s)?$/, 2],
  [/^apr(il)?$|^avr(il)?$/, 3],
  [/^ma[yi]$/, 4],
  [/^june?$|^juin$/, 5],
  [/^july?$|^juil(let)?$/, 6],
  [/^aug(ust)?$|^ao[uû]t?$/, 7],
  [/^sep(t(ember)?)?$|^sept(embre)?$/, 8],
  [/^oct(ober|obre)?$/, 9],
  [/^nov(ember|embre)?$/, 10],
  [/^d[eé]c(ember|embre)?$/, 11],
];

export const MONTH = String.raw`(jan(?:uary|vier)?|f[eé]v(?:rier)?|feb(?:ruary)?|mar(?:ch|s)?|apr(?:il)?|avr(?:il)?|ma[yi]|june?|juin|july?|juil(?:let)?|aug(?:ust)?|ao[uû]t?|sept?(?:ember|embre)?|oct(?:ober|obre)?|nov(?:ember|embre)?|d[eé]c(?:ember|embre)?)\.?`;
const WEEKDAY = String.raw`(?:(?:mon|tues?|wed(?:nes)?|thu(?:rs)?|fri|sat(?:ur)?|sun)(?:day)?\.?,?\s+)?`;
// "October 22", "Oct. 22nd, 2026", "22 October", "le 22 octobre", "2026-10-22". Dates like
// "10/6" are left out: they're read day-first in French and month-first in English.
const DATE_PATTERNS: { re: RegExp; read: (m: RegExpMatchArray) => { month: number; day: number; year?: number } | null }[] = [
  { re: /\b(\d{4})-(\d{2})-(\d{2})\b/, read: (m) => ({ year: +m[1], month: +m[2] - 1, day: +m[3] }) },
  {
    re: new RegExp(String.raw`\b${WEEKDAY}${MONTH}\s+(\d{1,2})(?:st|nd|rd|th)?\b(?:,?\s+(\d{4}))?`, 'i'),
    read: (m) => monthDay(m[1], m[2], m[3]),
  },
  {
    re: new RegExp(String.raw`\b(\d{1,2})(?:st|nd|rd|th|er)?\s+(?:de\s+)?${MONTH}\b(?:,?\s+(\d{4}))?`, 'i'),
    read: (m) => monthDay(m[2], m[1], m[3]),
  },
];

// January is 0; undefined if it isn't a month, in English or French.
export function monthIndex(monthText: string) {
  const name = monthText.toLowerCase().replace(/\.$/, '');
  return MONTHS.find(([re]) => re.test(name))?.[1];
}

function monthDay(monthText: string, dayText: string, yearText?: string) {
  const month = monthIndex(monthText);
  return month == null ? null : { month, day: +dayText, year: yearText ? +yearText : undefined };
}

// "11:59 pm", "6:30pm", "18h30", "14:00", "noon", "midnight"
const TIME = /\b(\d{1,2})(?:[:h](\d{2}))?\s*(a\.?m\.?|p\.?m\.?)|\b(\d{1,2})[:h](\d{2})\b|\b(noon|midi|midnight|minuit)\b/i;

function readTime(line: string): { hour: number; minute: number; text: string } | null {
  const m = line.match(TIME);
  if (!m) return null;
  if (m[6]) {
    const word = m[6].toLowerCase();
    return word === 'noon' || word === 'midi' ? { hour: 12, minute: 0, text: m[0] } : { hour: 23, minute: 59, text: m[0] };
  }
  if (m[3]) {
    let hour = +m[1] % 12;
    if (m[3].toLowerCase().startsWith('p')) hour += 12;
    return { hour, minute: m[2] ? +m[2] : 0, text: m[0] };
  }
  const hour = +m[4];
  return hour < 24 ? { hour, minute: +m[5], text: m[0] } : null;
}

const KINDS: [RegExp, SyllabusKind][] = [
  [/\b(midterm|mi-session|final|exam|examen|test)\b/i, 'exam'],
  [/\b(quiz|quizzes|webwork|questionnaire)\b/i, 'quiz'],
  [/\b(assignment|homework|hw\d*|problem set|pset|project|projet|lab|labo|report|rapport|essay|paper|devoir|tp\d*|deliverable|milestone|presentation)\b/i, 'assignment'],
];

const WEIGHT = /\(?\b(\d{1,3}(?:[.,]\d+)?)\s*%\)?/;

// The start and end year of a term like "Fall 2026" or "Winter 2027", for dates with no year.
function yearFor(month: number, term: string) {
  const year = Number(term.split(' ')[1]) || new Date().getFullYear();
  return term.startsWith('Fall') && month < 6 ? year + 1 : year;
}

export function parseSyllabus(text: string, term: string): SyllabusItem[] {
  const items: SyllabusItem[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    let date: { month: number; day: number; year?: number } | null = null;
    let dateText = '';
    for (const { re, read } of DATE_PATTERNS) {
      const m = line.match(re);
      const found = m && read(m);
      if (found && found.day >= 1 && found.day <= 31) {
        date = found;
        dateText = m![0];
        break;
      }
    }
    if (!date) continue;
    const kind = KINDS.find(([re]) => re.test(line))?.[1] ?? 'other';
    // Lines with a date but nothing to hand in or write (holidays, readings) are skipped.
    if (kind === 'other' && !/\bdue\b|\bremise\b|\bdeadline\b/i.test(line)) continue;

    const time = readTime(line.replace(dateText, ' '));
    const weightMatch = line.match(WEIGHT);
    const year = date.year ?? yearFor(date.month, term);
    const dueAt = new Date(year, date.month, date.day, time?.hour ?? 23, time?.minute ?? 59);
    if (Number.isNaN(dueAt.getTime()) || dueAt.getDate() !== date.day) continue;

    let title = line
      .replace(dateText, ' ')
      .replace(new RegExp(TIME.source, 'gi'), ' ')
      .replace(weightMatch?.[0] ?? '', ' ')
      .replace(/^(?:[\s•*·>\-–—]+|\d+[.)]\s+)/, ' ')
      .replace(/\b(?:is\s+)?due(?:\s+(?:on|by|at|before))?\b|\b(?:à remettre|remise)(?:\s+(?:le|avant))?/gi, ' ')
      .replace(/\s[-–—]\s|[|:;,()–—]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      // Leftovers from "… due Oct 6 at 11:59 pm" or "… le 6 octobre à 23 h 59".
      .replace(/^(?:on|at|by|le|à)\s+|\s+(?:on|at|by|le|à)$/gi, '')
      .trim();
    if (title.length > 120) title = `${title.slice(0, 117)}…`;
    if (!title) title = kind === 'other' ? 'Deadline' : kind[0].toUpperCase() + kind.slice(1);

    items.push({ title, kind, dueAt, timed: time != null, weight: weightMatch ? Number(weightMatch[1].replace(',', '.')) : null, line });
  }
  return items;
}
