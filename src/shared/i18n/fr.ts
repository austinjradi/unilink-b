// French translations, keyed by the English text. Plurals use `_one` / `_other`
// (in French, 0 and 1 are singular). `npm test` checks every key in the app is covered;
// `node scripts/i18n-keys.mjs` lists any that are missing.
import part1 from './fr/part1.json';
import part2 from './fr/part2.json';
import part3 from './fr/part3.json';
import part4 from './fr/part4.json';
import versionB from './fr/version-b.json';
import web from './fr/web.json';

export const FR: Record<string, string> = { ...part1, ...part2, ...part3, ...part4, ...web, ...versionB };
