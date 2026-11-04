import { earnsCredits, type RecordStatus } from './academics';
import { MCGILL_SCALE, minimumFor } from './grades';

// A2: check a student's course record against a program's requirements.

// A limit inside a group, in the catalogue's terms. Without `courses` it's a sentence we couldn't
// turn into a check, shown for the student to check themselves.
export interface GroupRule {
  text: string;
  courses?: string[];
  min?: number; // credits
  max?: number; // credits, or per subject with `perSubject`
  maxCourses?: number;
  perSubject?: boolean;
  minSubjects?: number;
}

export interface RequirementGroup {
  id: string;
  name: string;
  // "required": every listed course. "choose": at least `credits` from the list.
  kind: 'required' | 'choose';
  courses: string[];
  credits?: number;
  rules?: GroupRule[];
}

export interface Program {
  id: string;
  name: string;
  degree: string;
  totalCredits: number;
  // Program courses need at least this grade to count (McGill commonly requires C).
  minProgramGrade: string;
  groups: RequirementGroup[];
}

export interface PlannedCourse {
  code: string;
  credits: number;
  status: RecordStatus;
  grade: string | null;
}

export type CourseState = RecordStatus | 'missing' | 'below-minimum';

export interface RuleResult {
  text: string;
  // Could we check it? If not, the student has to.
  checked: boolean;
  // Met once everything currently planned is passed. A limit counts as met: what's over it just doesn't count.
  met: boolean;
  have: number;
  // What it asks for, in the rule's own unit, for a minimum.
  need: number | null;
  // Its ceiling, for a maximum.
  limit: number | null;
  // "credits", "courses" or "subjects".
  unit: 'credits' | 'courses' | 'subjects';
}

export interface GroupResult {
  id: string;
  name: string;
  kind: RequirementGroup['kind'];
  neededCredits: number;
  courses: { code: string; state: CourseState; credits: number }[];
  credits: Record<RecordStatus, number>;
  rules: RuleResult[];
  // Satisfied once everything currently planned is passed.
  coveredByPlan: boolean;
  // Satisfied by completed courses alone.
  done: boolean;
}

export interface DegreeEvaluation {
  groups: GroupResult[];
  electiveCredits: number;
  credits: Record<RecordStatus, number>;
  missingCredits: number;
  planComplete: boolean;
  graduated: boolean;
}

const STATUS_RANK: Record<RecordStatus, number> = { completed: 0, 'in-progress': 1, planned: 2 };

const LETTERS = new Set<string>(MCGILL_SCALE.map((g) => g.letter));

// Pass/fail grades (P, S) count; letter grades must reach the program minimum.
const meetsMinimum = (c: PlannedCourse, min: string) =>
  c.status !== 'completed' || c.grade == null || !LETTERS.has(c.grade) || minimumFor(c.grade) >= minimumFor(min);

const emptyCredits = (): Record<RecordStatus, number> => ({ completed: 0, 'in-progress': 0, planned: 0 });

const subjectOf = (code: string) => code.split(' ')[0];
const creditsIn = (taken: PlannedCourse[]) => taken.reduce((n, c) => n + c.credits, 0);

// Would one more course go over a limit? What's over a limit doesn't count, and can go toward electives.
function fitsLimits(course: PlannedCourse, chosen: PlannedCourse[], rules: GroupRule[]) {
  return rules.every((rule) => {
    if (!rule.courses?.includes(course.code)) return true;
    const counted = chosen.filter((c) => rule.courses!.includes(c.code) && (!rule.perSubject || subjectOf(c.code) === subjectOf(course.code)));
    if (rule.maxCourses !== undefined && counted.length >= rule.maxCourses) return false;
    return rule.max === undefined || creditsIn(counted) + course.credits <= rule.max;
  });
}

// How a group's chosen courses stand against a rule.
function ruleResult(rule: GroupRule, taken: PlannedCourse[]): RuleResult {
  const base = { text: rule.text, checked: !!rule.courses, need: null, limit: null, unit: 'credits' as const };
  if (!rule.courses) return { ...base, met: true, have: 0 };
  const counted = taken.filter((c) => rule.courses!.includes(c.code));
  if (rule.minSubjects !== undefined) {
    const have = new Set(counted.map((c) => subjectOf(c.code))).size;
    return { ...base, unit: 'subjects', met: have >= rule.minSubjects, have, need: rule.minSubjects };
  }
  if (rule.maxCourses !== undefined) return { ...base, unit: 'courses', met: true, have: counted.length, limit: rule.maxCourses };
  if (rule.max !== undefined) {
    const inOne = rule.perSubject ? counted.map((c) => creditsIn(counted.filter((o) => subjectOf(o.code) === subjectOf(c.code)))) : [creditsIn(counted)];
    return { ...base, met: true, have: Math.max(0, ...inOne), limit: rule.max };
  }
  const have = creditsIn(counted);
  return { ...base, met: have >= (rule.min ?? 0), have, need: rule.min ?? 0 };
}

export function evaluateDegree(
  program: Program,
  records: PlannedCourse[],
  creditsOf: (code: string) => number,
): DegreeEvaluation {
  // One entry per course: the furthest-along attempt that still counts (failed/withdrawn ones don't).
  const best = new Map<string, PlannedCourse>();
  for (const r of records) {
    if (r.status === 'completed' && !earnsCredits(r.grade)) continue;
    const current = best.get(r.code);
    if (!current || STATUS_RANK[r.status] < STATUS_RANK[current.status]) best.set(r.code, r);
  }

  const used = new Set<string>();
  const groups = program.groups.map((group): GroupResult => {
    const credits = emptyCredits();
    const courses: GroupResult['courses'] = [];

    if (group.kind === 'required') {
      for (const code of group.courses) {
        const r = best.get(code);
        if (r && meetsMinimum(r, program.minProgramGrade)) {
          used.add(code);
          credits[r.status] += r.credits;
          courses.push({ code, state: r.status, credits: r.credits });
        } else {
          courses.push({ code, state: r ? 'below-minimum' : 'missing', credits: r?.credits ?? creditsOf(code) });
        }
      }
      const neededCredits = courses.reduce((n, c) => n + c.credits, 0);
      const states = courses.map((c) => c.state);
      const taken = group.courses.flatMap((code) => (used.has(code) && best.get(code)) || []);
      return {
        id: group.id,
        name: group.name,
        kind: group.kind,
        neededCredits,
        courses,
        credits,
        rules: (group.rules ?? []).map((rule) => ruleResult(rule, taken)),
        coveredByPlan: states.every((s) => s === 'completed' || s === 'in-progress' || s === 'planned'),
        done: states.every((s) => s === 'completed'),
      };
    }

    // "choose": take the furthest-along eligible courses until the credit target is met.
    const needed = group.credits ?? 0;
    const eligible = group.courses
      .map((code) => best.get(code))
      .filter((r): r is PlannedCourse => !!r && !used.has(r.code) && meetsMinimum(r, program.minProgramGrade))
      .sort((a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status]);
    const rules = group.rules ?? [];
    const chosen: PlannedCourse[] = [];
    let counted = 0;
    const take = (r: PlannedCourse) => {
      if (counted >= needed || chosen.includes(r) || !fitsLimits(r, chosen, rules)) return;
      chosen.push(r);
      used.add(r.code);
      counted += r.credits;
      credits[r.status] += r.credits;
    };
    // What a minimum asks for goes first, so other courses don't use up the credits it needs.
    for (const rule of rules) {
      for (const r of eligible.filter((c) => rule.courses?.includes(c.code))) {
        if (rule.minSubjects !== undefined) {
          if (!chosen.some((c) => subjectOf(c.code) === subjectOf(r.code))) take(r);
        } else if (rule.min !== undefined && creditsIn(chosen.filter((c) => rule.courses!.includes(c.code))) < rule.min) {
          take(r);
        }
      }
    }
    eligible.forEach(take);
    for (const code of group.courses) {
      const r = best.get(code);
      const state: CourseState = r && used.has(code) ? r.status : r && !meetsMinimum(r, program.minProgramGrade) ? 'below-minimum' : 'missing';
      courses.push({ code, state, credits: r?.credits ?? creditsOf(code) });
    }
    const ruleResults = rules.map((rule) => ruleResult(rule, chosen));
    return {
      id: group.id,
      name: group.name,
      kind: group.kind,
      neededCredits: needed,
      courses,
      credits,
      rules: ruleResults,
      coveredByPlan: counted >= needed && ruleResults.every((rule) => rule.met),
      done: credits.completed >= needed && rules.every((rule) => ruleResult(rule, chosen.filter((c) => c.status === 'completed')).met),
    };
  });

  // Everything else that earns credit counts as electives toward the degree total.
  const totals = emptyCredits();
  let electiveCredits = 0;
  for (const r of best.values()) {
    totals[r.status] += r.credits;
    if (!used.has(r.code)) electiveCredits += r.credits;
  }
  const missingCredits = Math.max(0, program.totalCredits - totals.completed - totals['in-progress'] - totals.planned);

  return {
    groups,
    electiveCredits,
    credits: totals,
    missingCredits,
    planComplete: missingCredits === 0 && groups.every((g) => g.coveredByPlan),
    graduated: totals.completed >= program.totalCredits && groups.every((g) => g.done),
  };
}

// A2: the credits a term it takes to finish by the expected graduation, assuming that's the Winter
// term of that year and courses are taken in Fall and Winter. This term's courses count as done.
export function graduationPace(creditsLeft: number, gradYear: number, currentTerm: string): { terms: number; perTerm: number } | null {
  if (creditsLeft <= 0) return null;
  const [season, year] = currentTerm.split(' ');
  const terms = Math.max(0, 2 * (gradYear - Number(year)) - (season === 'Fall' ? 1 : 0));
  return { terms, perTerm: terms ? Math.ceil(creditsLeft / terms) : creditsLeft };
}
