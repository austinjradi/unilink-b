// G4: account rules shared by the sign-up form and the main process.

import { isOn } from './variants';

const SIMPLE_PASSWORD_RULE = 'At least 8 characters, with a letter and a number';
const METER_MINIMUM = 'At least 8 characters';

// The (mail.)? group makes that part optional, so both kinds
// of address match. The i flag ignores upper and lower case.
export const MCGILL_EMAIL = /^[a-z0-9._%+-]+@(mail\.)?mcgill\.ca$/i;
// Students have @mail.mcgill.ca addresses; professors and staff have @mcgill.ca ones.
export const STAFF_EMAIL = /^[a-z0-9._%+-]+@mcgill\.ca$/i;

// Version B uses passphrase rules (NIST-style): length matters, character classes don't,
// and well-known or personal passwords are refused.
export const MIN_PASSWORD_LENGTH = 12;

// A Set, so checking a password is a single has() call.
const COMMON = new Set([
  'password1234',
  'passwordpassword',
  '123456789012',
  '111111111111',
  'qwertyuiopas',
  'iloveyou1234',
  'mcgillmcgill',
  'mcgill123456',
  'mcgilluniversity',
  'unilinkunilink',
  'unilink12345',
  'letmein12345',
  'welcome12345',
  'abcdefghijkl',
  'abc123abc123',
  'qwerty123456',
  'trustno1trustno1',
  'football1234',
  'montreal1234',
  'sunshine1234',
]);

// Splits the part before @ at dots, underscores, plus and
// minus signs, and keeps words of three letters or more.
const emailWords = (email: string) =>
  email
    .toLowerCase()
    .split('@')[0]
    .split(/[._+-]/)
    .filter((w) => w.length >= 3);

// Each rule is a [label, test] pair. The sign-up form shows the labels as a
// checklist, and the service runs the same tests, so the two can't disagree.
export const PASSWORD_RULES: [label: string, test: (pw: string, email: string) => boolean][] = [
  ['At least 12 characters (a few words work well)', (pw) => pw.length >= MIN_PASSWORD_LENGTH],
  ['Not a common password', (pw) => !COMMON.has(pw.toLowerCase().replace(/\s+/g, '')) && new Set(pw).size > 3],
  ["Doesn't contain your name from your email", (pw, email) => !emailWords(email).some((w) => pw.toLowerCase().includes(w))],
];

export function passwordProblems(password: string, email = ''): string[] {
  // Switches stay in English, so this isn't written where the French check would ask for a translation.
  if (isOn('simple-password-rule')) return password.length >= 8 && /[a-z]/i.test(password) && /\d/.test(password) ? [] : [SIMPLE_PASSWORD_RULE];
  if (isOn('password-strength-meter')) return password.length >= 8 ? [] : [METER_MINIMUM];
  return PASSWORD_RULES.filter(([, test]) => !test(password, email)).map(([label]) => label);
}

// Sign-up profile (G4.1, G4.5).
// `as const` at the end makes this a readonly tuple, so `(typeof
// FACULTIES)[number]` is the union of these exact names.
export const FACULTIES = [
  'Agricultural and Environmental Sciences',
  'Arts',
  'Arts and Science',
  'Dental Medicine and Oral Health Sciences',
  'Education',
  'Engineering',
  'Law',
  'Management',
  'Medicine and Health Sciences',
  'Music',
  'Science',
] as const;

export const PRONOUNS = ['she/her', 'he/him', 'they/them', 'she/they', 'he/they'] as const;
