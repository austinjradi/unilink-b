import { termOrder } from './academics';

// 'check-prereqs': a small sample, since the catalogue PDF has no prerequisites or term offerings.
// Real rules would need another source. For the rest of the catalogue see `prereqOf`.
const SAMPLE_RULES: Record<string, { needs?: string[]; offered?: ('Fall' | 'Winter')[] }> = {
  'COMP 206': { needs: ['COMP 202'] },
  'COMP 250': { needs: ['COMP 202'] },
  'COMP 251': { needs: ['COMP 250', 'MATH 240'] },
  'COMP 273': { needs: ['COMP 206'] },
  'COMP 302': { needs: ['COMP 250'] },
  'COMP 303': { needs: ['COMP 206', 'COMP 250'] },
  'COMP 307': { needs: ['COMP 206', 'COMP 250'], offered: ['Winter'] },
  'COMP 330': { needs: ['COMP 251'], offered: ['Fall'] },
  'COMP 360': { needs: ['COMP 251'], offered: ['Winter'] },
  'COMP 421': { needs: ['COMP 206', 'COMP 251'], offered: ['Winter'] },
  'COMP 424': { needs: ['COMP 206', 'MATH 323'], offered: ['Winter'] },
  'COMP 551': { needs: ['COMP 251', 'MATH 323'], offered: ['Fall'] },
  'MATH 141': { needs: ['MATH 140'] },
  'MATH 222': { needs: ['MATH 141'] },
  'MATH 223': { needs: ['MATH 133'] },
  'MATH 323': { needs: ['MATH 141'] },
  'MATH 324': { needs: ['MATH 323'], offered: ['Fall'] },
};

// The rest of the catalogue, from scripts/catalogue/infer.py. "stated" and "general" are the
// catalogue's own words on `page`, "co" allows both at once, and the others are estimates: the
// other half of a two-term course, an earlier part by title, or a lower-level course in the subject.
export type PrereqHow = 'stated' | 'general' | 'co' | 'two-term' | 'title' | 'level';

export interface PrereqRule {
  how: PrereqHow;
  // Alternatives, each a set of courses to take together.
  any: string[][];
  page?: number;
}

export interface PrereqData {
  rules: Record<string, PrereqRule>;
  // The lowest level each subject has, for the "level" estimate.
  lowest: Record<string, number>;
}

const SAMPLE_PREREQ = (code: string): PrereqRule | null => (SAMPLE_RULES[code]?.needs ? { how: 'stated', any: [SAMPLE_RULES[code].needs!] } : null);

const levelOf = (code: string) => Number(code.split(' ')[1]?.[0]) * 100;

// What comes before a course, or null when nothing does: at 100 and 200 level that's the usual answer.
export function prereqOf(code: string, data: PrereqData | undefined): PrereqRule | null {
  const sample = SAMPLE_PREREQ(code);
  if (sample || !data) return sample;
  if (data.rules[code]) return data.rules[code];
  const level = levelOf(code);
  return level >= 300 && data.lowest[code.split(' ')[0]] < level ? { how: 'level', any: [] } : null;
}

const earlierCodes = (term: string, record: { code: string; term: string }[], alongside: boolean) =>
  record.filter((r) => termOrder(r.term) < termOrder(term) || (alongside && r.term === term)).map((r) => r.code);

// The rule a planned course doesn't meet yet, if any.
export function unmetPrereq(code: string, term: string, record: { code: string; term: string }[], data: PrereqData | undefined): PrereqRule | null {
  const rule = prereqOf(code, data);
  if (!rule) return null;
  const before = earlierCodes(term, record, rule.how === 'co');
  if (rule.how === 'level') {
    const subject = code.split(' ')[0];
    return before.some((c) => c.split(' ')[0] === subject && levelOf(c) < levelOf(code)) ? null : rule;
  }
  return rule.any.some((set) => set.every((need) => before.includes(need))) ? null : rule;
}

// "A / B + C": A, or both B and C. Reads the same in both languages.
export const prereqCourses = (rule: PrereqRule) => rule.any.map((set) => set.join(' + ')).join(' / ');

// Why a course can't be planned for this term, given the student's record. Null when it can.
// Only what the catalogue says outright can stop a plan; estimates are just shown beside it.
export function whyCantPlan(code: string, term: string, record: { code: string; term: string }[], data?: PrereqData): string | null {
  const rule = SAMPLE_RULES[code];
  if (!rule) {
    const stated = data?.rules[code];
    if (stated?.how !== 'stated' || !unmetPrereq(code, term, record, data)) return null;
    return `${code} needs ${prereqCourses(stated)} first (catalogue, page ${stated.page}).`;
  }
  const season = term.split(' ')[0] as 'Fall' | 'Winter';
  if (rule.offered && !rule.offered.includes(season)) return `${code} is only offered in ${rule.offered.join(' and ')}.`;
  const before = record.filter((r) => termOrder(r.term) < termOrder(term)).map((r) => r.code);
  const missing = (rule.needs ?? []).filter((need) => !before.includes(need));
  return missing.length ? `${code} needs ${missing.join(' and ')} first.` : null;
}
