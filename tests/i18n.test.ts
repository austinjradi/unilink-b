import { describe, expect, it } from 'vitest';
import { termLabel, translate } from '@shared/i18n';
import { EN } from '@shared/i18n/en';
import { FR } from '@shared/i18n/fr';
// @ts-expect-error — plain JS helper shared with the CLI.
import { collectKeys, isPlural } from '../scripts/i18n-keys.mjs';

const placeholders = (text: string) => [...text.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort();

describe('French translation', () => {
  const keys: string[] = collectKeys();

  it('finds the UI text to check', () => {
    expect(keys.length).toBeGreaterThan(500);
  });

  it('covers every piece of UI text, with the same placeholders', () => {
    const problems: string[] = [];
    for (const key of keys) {
      const entries = isPlural(key) ? [`${key}_one`, `${key}_other`] : [key];
      for (const entry of entries) {
        if (isPlural(key) && !(entry in EN)) problems.push(`missing English plural: ${entry}`);
        if (!(entry in FR)) problems.push(`missing French: ${entry}`);
        else if (placeholders(FR[entry]).join() !== placeholders(key).join()) problems.push(`placeholders differ: ${entry}`);
      }
    }
    expect(problems).toEqual([]);
  });

  it('has no French entries the app no longer uses', () => {
    const used = new Set(keys.flatMap((k) => (isPlural(k) ? [`${k}_one`, `${k}_other`] : [k])));
    expect(Object.keys(FR).filter((k) => !used.has(k))).toEqual([]);
  });
});

describe('translate()', () => {
  it('fills in params, plurals and nested translations', () => {
    expect(translate('fr', '{{count}} credits', { count: 1 })).toBe('1 crédit');
    expect(translate('fr', '{{count}} credits', { count: 0 })).toBe('0 crédit'); // French: 0 is singular
    expect(translate('en', '{{count}} credits', { count: 0 })).toBe('0 credits');
    expect(translate('fr', 'Reason: {{reason}}. Check it still works, or update it to clear the reports.', { reason: { t: 'Expired' } })).toBe(
      'Raison : Expiré. Vérifiez qu’il fonctionne toujours, ou mettez-le à jour pour effacer les signalements.',
    );
    expect(termLabel('fr', 'Fall 2026')).toBe('Automne 2026');
  });

  it('falls back to English, and leaves unknown text alone', () => {
    expect(translate('fr', 'COMP 251')).toBe('COMP 251');
    expect(translate('en', 'Hi {{name}}', { name: 'Maya' })).toBe('Hi Maya');
  });

  it('formats dates in the reader’s language', () => {
    const date = new Date(2026, 10, 3, 23, 59).getTime();
    expect(translate('en', '{{title}} is due {{when}}', { title: 'Essay', when: { date } })).toMatch(/^Essay is due Tue, Nov 3, 23:59$/);
    expect(translate('fr', '{{title}} is due {{when}}', { title: 'Essai', when: { date } })).toMatch(/^Essai est à remettre le mar\. 3 nov\.?, 23 h 59$/);
  });
});
