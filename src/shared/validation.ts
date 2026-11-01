// G4: account rules shared by the sign-up form and the main process.

export const MCGILL_EMAIL = /^[a-z0-9._%+-]+@(mail\.)?mcgill\.ca$/i;

// Version B uses passphrase rules (NIST-style): length matters, character classes don't,
// and well-known or personal passwords are refused.
export const MIN_PASSWORD_LENGTH = 12;

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

const emailWords = (email: string) =>
  email
    .toLowerCase()
    .split('@')[0]
    .split(/[._+-]/)
    .filter((w) => w.length >= 3);

export const PASSWORD_RULES: [label: string, test: (pw: string, email: string) => boolean][] = [
  ['At least 12 characters (a few words work well)', (pw) => pw.length >= MIN_PASSWORD_LENGTH],
  ['Not a common password', (pw) => !COMMON.has(pw.toLowerCase().replace(/\s+/g, '')) && new Set(pw).size > 3],
  ["Doesn't contain your name from your email", (pw, email) => !emailWords(email).some((w) => pw.toLowerCase().includes(w))],
];

export function passwordProblems(password: string, email = ''): string[] {
  return PASSWORD_RULES.filter(([, test]) => !test(password, email)).map(([label]) => label);
}

// Sign-up profile (G4.1, G4.5).
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
