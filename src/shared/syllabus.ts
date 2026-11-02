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

const NOT_WORK = /\b(review session|séance de révision|tutorial|no class|pas de cours|no hand-in|office hours)\b/i;

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
    // A review session before the final isn't the final.
    if (NOT_WORK.test(line) && !/\bdue\b|\bremise\b/i.test(line)) continue;
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

// A5: the grading breakdown in a course outline ("Midterm 30%, Final exam 50%"), whether it's a
// table, a list or one sentence. Like the dates, the student reviews it before anything is added.

export interface SchemeItem {
  name: string;
  weight: number;
  dueAt: Date | null;
  line: string;
}

// Percentages that aren't part of the grade: penalties, the letter grade table, totals.
const NOT_A_COMPONENT =
  /\b(?:late|penalt|pénalit|retard|deduct|per day|par jour|total|overall|or above|or higher|and above|or better|ou plus|au moins|at least|minimum|must (?:pass|get|obtain)|attendance is|of the (?:class|students)|tax)\w*/i;
const GRADE_RANGE = /\d\s*(?:-|–|—|to|à)\s*\d+(?:[.,]\d+)?\s*%/i;
const INTRO = /^(?:(?:the\s+)?(?:course\s+)?(?:grading(?:\s+scheme)?|grades?|marking(?:\s+scheme)?|evaluation|assessment|breakdown|évaluation|barème)(?:\s+\w+)?\s*[:–—-]\s*)/i;
const PERCENTS = /\d{1,3}(?:[.,]\d+)?\s*%/g;

function schemeName(line: string, percent: string) {
  const name = line
    .replace(percent, ' ')
    // Keep "(best 5 of 6)": the marks form reads it. Other brackets are just notes.
    .replace(/\(([^)]*)\)/g, (whole, inside: string) => (/\b(?:best|meilleure?s?)\b/i.test(inside) ? whole : ' '))
    .replace(/\b(?:each|chacun(?:e)?)\b/gi, ' ')
    .replace(/\b(?:is|are)?\s*(?:worth|counts?\s+for|will\s+count\s+for|compte\s+pour|vaut)\b/gi, ' ')
    .replace(/\b(?:of|de)\s+(?:the|your|la|votre)\s+(?:final\s+|course\s+|overall\s+)?(?:grade|mark|note)(?:\s+finale)?\b/gi, ' ')
    .replace(/^\s*(?:[•*·>\-–—]+|\d+[.)]\s|and\s|et\s|&\s*)\s*/i, '')
    .replace(/\.{2,}|[|:;,–—\t]+|\s-\s/g, ' ')
    .replace(/^\s*(?:the|le|la|les|l')\s+/i, '')
    .replace(/\s+/g, ' ')
    .replace(/[\s.-]+$/, '')
    .trim();
  return name.charAt(0).toUpperCase() + name.slice(1);
}

export function parseScheme(text: string, term: string): SchemeItem[] {
  const lines = text.split(/\r?\n/).map((raw) => raw.trim()).filter(Boolean);
  // A PDF's table often comes out with the weight on a line of its own.
  const joined = lines.reduce<string[]>((all, line) => {
    if (/^\d{1,3}(?:[.,]\d+)?\s*%$/.test(line) && all.length && !all.at(-1)!.match(PERCENTS)) all[all.length - 1] += ` ${line}`;
    else all.push(line);
    return all;
  }, []);
  // Several in one sentence, unless the others explain the first: "Labs 20% (4 labs, 5% each)".
  const pieces = joined.flatMap((raw) => {
    const line = raw.replace(INTRO, '');
    return (line.match(PERCENTS)?.length ?? 0) > 1 && !/\b(?:each|chacun)/i.test(line) ? line.split(/\s*[;,]\s*(?=\D)|(?<=%\)?)\s+(?=[A-Za-zÀ-ÿ])|\s+and\s+|\s+et\s+/) : [line];
  });

  const items: SchemeItem[] = [];
  for (const line of pieces) {
    const found = line.match(WEIGHT);
    if (!found || line.length > 90 || NOT_A_COMPONENT.test(line) || GRADE_RANGE.test(line)) continue;
    let weight = Number(found[1].replace(',', '.'));
    // "Assignments (4), 5% each" is 20% in all.
    if (/\b(?:each|chacun)/i.test(line) && line.match(PERCENTS)?.length === 1) {
      const count = line.match(/\((\d{1,2})\)|\b(\d{1,2})\s+[a-zà-ÿ]/i);
      if (count) weight *= Number(count[1] ?? count[2]);
    }
    const name = schemeName(line, found[0]);
    if (weight <= 0 || weight > 100 || !/\p{L}{2}/u.test(name) || /^[A-F][+-]?$/.test(name) || name.length > 60) continue;
    if (items.some((item) => item.name.toLowerCase() === name.toLowerCase())) continue;
    const dated = parseSyllabus(line, term)[0];
    items.push({ name: dated ? dated.title : name, weight, dueAt: dated?.dueAt ?? null, line });
  }
  return items;
}
