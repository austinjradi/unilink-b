import { termOrder } from './academics';

// 'check-prereqs': a small sample, since the built-in catalogue has no prerequisites or
// term offerings. Real rules would come from the eCalendar, like the rest of the catalogue.
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

// Why a course can't be planned for this term, given the student's record. Null when it can.
export function whyCantPlan(code: string, term: string, record: { code: string; term: string }[]): string | null {
  const rule = SAMPLE_RULES[code];
  if (!rule) return null;
  const season = term.split(' ')[0] as 'Fall' | 'Winter';
  if (rule.offered && !rule.offered.includes(season)) return `${code} is only offered in ${rule.offered.join(' and ')}.`;
  const before = record.filter((r) => termOrder(r.term) < termOrder(term)).map((r) => r.code);
  const missing = (rule.needs ?? []).filter((need) => !before.includes(need));
  return missing.length ? `${code} needs ${missing.join(' and ')} first.` : null;
}
