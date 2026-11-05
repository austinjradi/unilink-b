import { EN } from './en';
import { FR } from './fr';

// English text is the key: t('Add a task…') shows that text in English and looks it up
// in the French dictionary. Plural messages have `_one` / `_other` entries and take a
// `count` param. Used by the renderer and by the main process (notifications, emails).

// `as const` keeps the exact strings instead of widening them to
// string[], so the next line can derive the type 'en' | 'fr' from them.
export const LOCALES = ['en', 'fr'] as const;
// Indexing a tuple type with [number] gives the union of its element types.
export type Locale = (typeof LOCALES)[number];
export const LOCALE_NAMES: Record<Locale, string> = { en: 'English', fr: 'Français' };

// A param can be plain text, text that itself needs translating, or a date to format.
// Plain text or a number, or an object: { t } for text that needs translating too, {
// term } for a term name, { date } for a timestamp to format in the reader's language.
export type Param = string | number | { t: string } | { term: string } | { date: number; style?: 'when' | 'time' };
export type Params = Record<string, Param>;

// A message to render later in the reader's language (notifications, errors).
export type Message = { key: string; params?: Params };

const DICTS: Record<Locale, Record<string, string>> = { en: EN, fr: FR };

export const isLocale = (value: unknown): value is Locale => LOCALES.includes(value as Locale);

function formatDate(locale: Locale, ms: number, style: 'when' | 'time' = 'when') {
  const tag = locale === 'fr' ? 'fr-CA' : 'en-CA';
  const time = new Date(ms).toLocaleTimeString(tag, { hour: '2-digit', minute: '2-digit', hour12: false });
  if (style === 'time') return time;
  const day = new Date(ms).toLocaleDateString(tag, { weekday: 'short', day: 'numeric', month: 'short' });
  return `${day}, ${time}`;
}

// Slow to create, and every plural on a screen needs one.
const pluralRules = new Map<string, Intl.PluralRules>();
function pluralOf(locale: string, count: number) {
  const rules = pluralRules.get(locale) ?? new Intl.PluralRules(locale);
  pluralRules.set(locale, rules);
  return rules.select(count);
}

// Looks the key up in that language's dictionary, then in English,
// then falls back to the key itself, which is English already.
export function translate(locale: Locale, key: string, params?: Params): string {
  const dict = DICTS[locale] ?? EN;
  let entry = key;
  // Intl.PluralRules says which plural category a number takes in a language ('one' covers 1
  // in English, but 0 and 1 in French). The entry with that suffix is used when it exists.
  if (typeof params?.count === 'number') {
    const form = pluralOf(locale, params.count) === 'one' ? 'one' : 'other';
    if (`${key}_${form}` in dict || `${key}_${form}` in EN) entry = `${key}_${form}`;
  }
  const template = dict[entry] ?? EN[entry] ?? key;
  if (!params) return template;
  // The regex finds {{name}} placeholders. The parentheses capture the name, which reaches the
  // callback as its second argument, and the g flag replaces every match, not just the first.
  return template.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => {
    const value = params[name];
    if (value == null) return '';
    if (typeof value !== 'object') return String(value);
    // `'t' in value` checks which kind of object this param is, and narrows its type to match.
    if ('t' in value) return translate(locale, value.t);
    if ('term' in value) return termLabel(locale, value.term);
    return formatDate(locale, value.date, value.style);
  });
}

export const render = (locale: Locale, message: Message) => translate(locale, message.key, message.params);

// "Fall 2026" → "Automne 2026".
export function termLabel(locale: Locale, term: string) {
  const [season, year] = term.split(' ');
  return year ? `${translate(locale, season)} ${year}` : translate(locale, term);
}
