// ST3: a date typed at the end of a new to-do, in English or French: "Read chapter 3 friday",
// "Email the TA tomorrow", "Pay fees by nov 5", "Lire le chapitre 3 demain". Only the end of
// the text counts, so "Ask about Monday's class" stays as it was written.
import { addDays, parseYmd, ymd } from './dates';
import { MONTH, monthIndex } from './syllabus';

// Short forms only where they can't be something else: "Call Sam" isn't due samedi, and
// "Swim in the sun" isn't due Sunday.
const WEEKDAYS: [RegExp, number][] = [
  [/^(sunday|dimanche)$/, 0],
  [/^(monday|lundi)$/, 1],
  [/^(tue|tues|tuesday|mardi)$/, 2],
  [/^(wednesday|mercredi)$/, 3],
  [/^(thu|thurs|thursday|jeudi)$/, 4],
  [/^(fri|friday|vendredi)$/, 5],
  [/^(saturday|samedi)$/, 6],
];

// Words that lead into a date and go with it.
const LEAD = String.raw`(?:\s+(?:on|by|due|next|this|before|le|pour|avant|d'ici))?`;
const RELATIVE: [RegExp, number][] = [
  [new RegExp(String.raw`${LEAD}\s+(?:today|tonight|aujourd'hui|aujourd’hui|ce soir)$`, 'i'), 0],
  [new RegExp(String.raw`${LEAD}\s+(?:tomorrow|tmrw|demain)$`, 'i'), 1],
];
const IN_DAYS = /\s+(?:in|dans)\s+(\d{1,2})\s+(?:days?|jours?)$/i;
const WEEKDAY = new RegExp(String.raw`${LEAD}\s+([a-zé]+)\.?(?:\s+(?:prochain|prochaine))?$`, 'i');
const MONTH_DAY = new RegExp(String.raw`${LEAD}\s+${MONTH}\s+(\d{1,2})(?:st|nd|rd|th)?$`, 'i');
const DAY_MONTH = new RegExp(String.raw`${LEAD}\s+(\d{1,2})(?:st|nd|rd|th|er)?\s+(?:of\s+|de\s+)?${MONTH}$`, 'i');
const ISO = new RegExp(String.raw`${LEAD}\s+(\d{4}-\d{2}-\d{2})$`, 'i');
const EVERY = /(?:^|\s+)(?:every|each|chaque|tous les|toutes les)\s+([a-zé]+)\.?$/i;

export function parseTaskDate(text: string, today: string): { title: string; dueDate: string | null; weekly?: true } {
  const input = text.trim();
  // "Read the notes every friday": the next one, today if it's that day, and then each week.
  const every = input.match(EVERY);
  if (every) {
    const word = every[1].toLowerCase();
    const weekday = WEEKDAYS.find(([re]) => re.test(word) || re.test(word.replace(/s$/, '')))?.[1];
    const title = input.slice(0, every.index).trim();
    // With nothing before it, there's no to-do to repeat: it's just what they typed.
    if (weekday != null) return title ? { title, dueDate: addDays(today, (weekday - parseYmd(today).getDay() + 7) % 7), weekly: true } : { title: input, dueDate: null };
  }
  const found = (match: RegExpMatchArray, dueDate: string | null) => {
    const title = input.slice(0, match.index).trim();
    return title && dueDate ? { title, dueDate } : null;
  };
  // This year's date, or next year's if it has gone by.
  const inMonth = (month: number, day: number) => {
    const year = parseYmd(today).getFullYear();
    for (const y of [year, year + 1]) {
      const date = new Date(y, month, day);
      if (date.getMonth() === month && ymd(date) >= today) return ymd(date);
    }
    return null;
  };

  for (const [re, days] of RELATIVE) {
    const m = input.match(re);
    if (m) return found(m, addDays(today, days)) ?? { title: input, dueDate: null };
  }
  let m = input.match(IN_DAYS);
  if (m) return found(m, addDays(today, Number(m[1]))) ?? { title: input, dueDate: null };
  m = input.match(ISO);
  if (m) return found(m, !Number.isNaN(parseYmd(m[1]).getTime()) && m[1] >= today ? m[1] : null) ?? { title: input, dueDate: null };
  m = input.match(MONTH_DAY);
  if (m) return found(m, inMonth(monthIndex(m[1]) ?? -1, Number(m[2]))) ?? { title: input, dueDate: null };
  m = input.match(DAY_MONTH);
  if (m) return found(m, inMonth(monthIndex(m[2]) ?? -1, Number(m[1]))) ?? { title: input, dueDate: null };
  m = input.match(WEEKDAY);
  if (m) {
    const weekday = WEEKDAYS.find(([re]) => re.test(m![1].toLowerCase()))?.[1];
    if (weekday != null) {
      // The next one to come: on a Monday, "monday" means next week.
      const ahead = (weekday - parseYmd(today).getDay() + 7) % 7 || 7;
      return found(m, addDays(today, ahead)) ?? { title: input, dueDate: null };
    }
  }
  return { title: input, dueDate: null };
}
