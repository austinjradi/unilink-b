// Collects every piece of English UI text that goes through translation, so a test can
// check the French dictionary covers it. Run `node scripts/i18n-keys.mjs` to list
// keys that are missing a French translation.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const STR = String.raw`('(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*")`;
const unquote = (lit) => lit.slice(1, -1).replace(/\\(['"\\])/g, '$1');

function files(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : /\.(tsx?|mjs)$/.test(name) ? [path] : [];
  });
}

const PATTERNS = [
  // Renderer: t('…'), tx('…'), and useAction success messages.
  new RegExp(String.raw`\b(?:t|tx)\(\s*` + STR, 'g'),
  new RegExp(String.raw`\bsuccess:\s*` + STR, 'g'),
  // Main process: notification messages, translated emails/exports, errors, validation.
  new RegExp(String.raw`\bm\(\s*` + STR, 'g'),
  new RegExp(String.raw`translate\(\s*[\w.]+,\s*` + STR, 'g'),
  new RegExp(String.raw`new AppError\(\s*` + STR, 'g'),
  new RegExp(String.raw`\.(?:regex|min|max|gt|email)\([^)\n]*?,?\s*` + STR + String.raw`\)`, 'g'),
  new RegExp(String.raw`message:\s*` + STR, 'g'),
  new RegExp(String.raw`\{\s*t:\s*` + STR, 'g'),
];

export function collectKeys() {
  const keys = new Set();
  const add = (k) => k && /[A-Za-z]/.test(k) && keys.add(k);
  for (const file of [...files(join(ROOT, 'src/renderer/src')), ...files(join(ROOT, 'src/main')), ...files(join(ROOT, 'src/web'))]) {
    const src = readFileSync(file, 'utf8');
    for (const re of PATTERNS) for (const m of src.matchAll(re)) add(unquote(m[1]));
    for (const m of src.matchAll(new RegExp(String.raw`nonEmpty\(\s*` + STR, 'g'))) {
      add(`${unquote(m[1])} is required`);
      add(`${unquote(m[1])} is too long`);
    }
    for (const m of src.matchAll(new RegExp(String.raw`notFound\(\s*` + STR, 'g'))) add(`That ${unquote(m[1])} no longer exists.`);
  }
  // Labels kept as data and translated where they're shown.
  const shared = (name) => readFileSync(join(ROOT, 'src/shared', name), 'utf8');
  for (const m of shared('notifications.ts').matchAll(/label:\s*'([^']+)'/g)) add(m[1]);
  for (const m of shared('validation.ts').matchAll(/\['([^']+)',\s*\(pw\)/g)) add(m[1]);
  const goatLabels = shared('goat.ts').match(/GOAT_LABELS[^{]*\{([^}]+)\}/)[1];
  for (const m of goatLabels.matchAll(/:\s*'([^']+)'/g)) add(m[1]);
  for (const m of shared('academics.ts').matchAll(/^\s+[A-Z]: '([^']+)',$/gm)) add(m[1]);
  const goat = shared('goat.ts');
  for (const list of ['fur', 'background']) {
    const values = goat.match(new RegExp(`${list}: \\[([^\\]]+)\\]`))[1].match(/'([^']+)'/g).map(unquote);
    for (const v of values) add(v[0].toUpperCase() + v.slice(1));
  }
  for (const season of ['Fall', 'Winter', 'Summer']) add(season);
  const main = (name) => readFileSync(join(ROOT, 'src/main', name), 'utf8');
  for (const m of main('db/programs.ts').matchAll(/name: '([^']+)'/g)) add(m[1]);
  for (const m of main('services/board.ts').match(/SUGGESTED_TOPICS = \[([^\]]+)\]/)[1].matchAll(/'([^']+)'/g)) add(m[1]);
  for (const m of main('services/links.ts').match(/FLAG_REASONS = \[([^\]]+)\]/)[1].matchAll(/'([^']+)'/g)) add(m[1]);
  return [...keys].sort();
}

export const isPlural = (key) => key.includes('{{count}}');

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const missing = process.argv.includes('--all');
  const dir = join(ROOT, 'src/shared/i18n/fr');
  const FR = Object.assign({}, ...readdirSync(dir).map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8'))));
  for (const key of collectKeys()) {
    const needed = isPlural(key) ? [`${key}_one`, `${key}_other`] : [key];
    if (missing || !FR || needed.some((k) => !(k in FR))) console.log(JSON.stringify(key));
  }
}
