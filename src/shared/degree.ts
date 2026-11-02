import { earnsCredits, type RecordStatus } from './academics';
import { MCGILL_SCALE, minimumFor } from './grades';

// A2: check a student's course record against a program's requirements.

export interface RequirementGroup {
  id: string;
  name: string;
  // "required": every listed course. "choose": at least `credits` from the list.
  kind: 'required' | 'choose';
  courses: string[];
  credits?: number;
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

export interface GroupResult {
  id: string;
  name: string;
  kind: RequirementGroup['kind'];
  neededCredits: number;
  courses: { code: string; state: CourseState; credits: number }[];
  credits: Record<RecordStatus, number>;
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
      return {
        id: group.id,
        name: group.name,
        kind: group.kind,
        neededCredits,
        courses,
        credits,
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
    let counted = 0;
    for (const r of eligible) {
      if (counted >= needed) break;
      used.add(r.code);
      counted += r.credits;
      credits[r.status] += r.credits;
    }
    for (const code of group.courses) {
      const r = best.get(code);
      const state: CourseState = r && used.has(code) ? r.status : r && !meetsMinimum(r, program.minProgramGrade) ? 'below-minimum' : 'missing';
      courses.push({ code, state, credits: r?.credits ?? creditsOf(code) });
    }
    return {
      id: group.id,
      name: group.name,
      kind: group.kind,
      neededCredits: needed,
      courses,
      credits,
      coveredByPlan: counted >= needed,
      done: credits.completed >= needed,
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
