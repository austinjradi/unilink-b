// G4: account rules shared by the sign-up form and the main process.

export const MCGILL_EMAIL = /^[a-z0-9._%+-]+@(mail\.)?mcgill\.ca$/i;

export const PASSWORD_RULES: [label: string, test: (pw: string) => boolean][] = [
  ['At least 8 characters', (pw) => pw.length >= 8],
  ['At least one letter', (pw) => /[a-z]/i.test(pw)],
  ['At least one number', (pw) => /\d/.test(pw)],
];

export function passwordProblems(password: string): string[] {
  return PASSWORD_RULES.filter(([, test]) => !test(password)).map(([label]) => label);
}
