// McGill's standard letter-grade scale (A4).
// Ordered from the highest minimum down, so find() returns the first letter whose
// minimum a percentage reaches. `as const` keeps the exact letters and numbers as types.
export const MCGILL_SCALE = [
  { letter: 'A', min: 85, gpa: 4.0 },
  { letter: 'A-', min: 80, gpa: 3.7 },
  { letter: 'B+', min: 75, gpa: 3.3 },
  { letter: 'B', min: 70, gpa: 3.0 },
  { letter: 'B-', min: 65, gpa: 2.7 },
  { letter: 'C+', min: 60, gpa: 2.3 },
  { letter: 'C', min: 55, gpa: 2.0 },
  { letter: 'D', min: 50, gpa: 1.0 },
  { letter: 'F', min: 0, gpa: 0.0 },
] as const;

// Indexed access types: [number] is any element of the array,
// and ['letter'] its letter, giving 'A' | 'A-' | … | 'F'.
export type Letter = (typeof MCGILL_SCALE)[number]['letter'];

export type GradeScale = readonly { letter: string; min: number; gpa: number }[];

// If nothing matches, the last entry (F). The scale
// parameter defaults to McGill's when it isn't passed.
export function letterFor(percent: number, scale: GradeScale = MCGILL_SCALE) {
  return scale.find((g) => percent >= g.min) ?? scale[scale.length - 1];
}

// 'course-cutoffs': McGill's scale, with a course's own minimum for any letter it sets.
export function scaleWith(cutoffs: Record<string, number> | null | undefined): GradeScale {
  if (!cutoffs) return MCGILL_SCALE;
  return MCGILL_SCALE.map((g) => ({ ...g, min: cutoffs[g.letter] ?? g.min })).sort((a, b) => b.min - a.min);
}

// 'drop-lowest': the lowest mark so far doesn't count, and the others share its weight.
// `T extends GradedItem`: any item type with at least a weight and a
// score works, and the same type comes back, extra fields included.
export function dropLowest<T extends GradedItem>(items: T[]): T[] {
  const graded = items.filter((i) => i.score != null);
  if (graded.length < 2) return items;
  const lowest = graded.reduce((low, i) => (i.score! < low.score! ? i : low));
  const total = items.reduce((sum, i) => sum + i.weight, 0);
  const rest = total - lowest.weight;
  if (rest <= 0) return items;
  return items.map((i) => (i === lowest ? { ...i, weight: 0 } : { ...i, weight: (i.weight * total) / rest }));
}

export function minimumFor(letter: string): number {
  return MCGILL_SCALE.find((g) => g.letter === letter)?.min ?? 0;
}

export interface GradedItem {
  weight: number;
  score: number | null;
  // Version B: a section can have a second grading scheme ("whichever is higher"), with its
  // own weight for each component (0 if it doesn't count there). null when there's only one.
  altWeight?: number | null;
}

export interface Requirement {
  letter: string;
  // Average needed on everything not yet graded, in %.
  needed: number | null;
  status: 'secured' | 'possible' | 'out-of-reach';
  // Which grading scheme gets there (0 = the main one, 1 = the second one).
  scheme: number;
}

export interface GradeSummary {
  totalWeight: number;
  gradedWeight: number;
  // Version B: weights that add up to less than 100% leave "unlisted" work, which counts as
  // still to come (not graded yet) instead of the listed weights being scaled up to 100%.
  unlistedWeight: number;
  // Everything not graded yet, including unlisted work.
  remainingWeight: number;
  // Average on graded work only, in %.
  currentAverage: number | null;
  // Final grade range if everything left scores 0% / 100%.
  worstFinal: number;
  bestFinal: number;
  requirements: Requirement[];
  // With two schemes, each one's own summary; the fields above take the better of the two.
  schemes: GradeSummary[];
}

const round1 = (n: number) => Math.round(n * 10) / 10;

function totals(items: GradedItem[]) {
  const totalWeight = items.reduce((sum, i) => sum + i.weight, 0);
  const gradedWeight = items.filter((i) => i.score != null).reduce((sum, i) => sum + i.weight, 0);
  // Percentage points of the final grade already earned.
  const earned = items.reduce((sum, i) => sum + (i.score == null ? 0 : (i.weight * i.score) / 100), 0);
  return { totalWeight, gradedWeight, earned, remainingWeight: Math.max(0, 100 - gradedWeight) };
}

export const hasSecondScheme = (items: GradedItem[]) => items.some((i) => i.altWeight != null);

// The components under each scheme: one, or two when the section has a second scheme.
function schemesOf(items: GradedItem[]): GradedItem[][] {
  const main = items.map(({ weight, score }) => ({ weight, score }));
  return hasSecondScheme(items) ? [main, items.map((i) => ({ weight: i.altWeight ?? 0, score: i.score }))] : [main];
}

// "Explore different scenarios": the final grade if everything left averages `average`%,
// under whichever scheme gives more.
export function finalIfRemainingAverages(items: GradedItem[], average: number): { final: number; scheme: number } {
  return schemesOf(items)
    .map((scheme, index) => {
      const { earned, remainingWeight } = totals(scheme);
      return { final: round1(earned + (remainingWeight * average) / 100), scheme: index };
    })
    .reduce((best, s) => (s.final > best.final ? s : best));
}

function summarizeScheme(items: GradedItem[], scheme: number, scale: GradeScale): GradeSummary {
  const { totalWeight, gradedWeight, earned, remainingWeight } = totals(items);

  const requirements = scale.filter((g) => g.min > 0).map((g): Requirement => {
    const pointsNeeded = g.min - earned;
    if (pointsNeeded <= 0) return { letter: g.letter, needed: 0, status: 'secured', scheme };
    if (remainingWeight <= 0) return { letter: g.letter, needed: null, status: 'out-of-reach', scheme };
    const needed = (pointsNeeded / remainingWeight) * 100;
    return { letter: g.letter, needed: round1(needed), status: needed > 100 ? 'out-of-reach' : 'possible', scheme };
  });

  return {
    totalWeight: round1(totalWeight),
    gradedWeight: round1(gradedWeight),
    unlistedWeight: round1(Math.max(0, 100 - totalWeight)),
    remainingWeight: round1(remainingWeight),
    currentAverage: gradedWeight > 0 ? round1((earned / gradedWeight) * 100) : null,
    worstFinal: round1(earned),
    bestFinal: round1(earned + remainingWeight),
    requirements,
    schemes: [],
  };
}

const RANK = { secured: 0, possible: 1, 'out-of-reach': 2 } as const;

// With two schemes the grade is whichever is higher, so each target takes the scheme that
// needs the least; the weights shown are the main scheme's.
// The calculator's core: current average, best and worst possible final, and what's needed
// for each letter. With two schemes, each figure comes from whichever scheme does better.
export function summarize(items: GradedItem[], scale: GradeScale = MCGILL_SCALE): GradeSummary {
  const schemes = schemesOf(items).map((scheme, index) => summarizeScheme(scheme, index, scale));
  if (schemes.length === 1) return schemes[0];
  const [main, alt] = schemes;
  const higher = (a: number | null, b: number | null) => (a == null ? b : b == null ? a : Math.max(a, b));
  return {
    ...main,
    currentAverage: higher(main.currentAverage, alt.currentAverage),
    worstFinal: Math.max(main.worstFinal, alt.worstFinal),
    bestFinal: Math.max(main.bestFinal, alt.bestFinal),
    requirements: main.requirements.map((r, i) => {
      const other = alt.requirements[i];
      const better = RANK[other.status] < RANK[r.status] || (other.status === 'possible' && r.status === 'possible' && other.needed! < r.needed!);
      return better ? other : r;
    }),
    schemes,
  };
}

const round2 = (n: number) => Math.round(n * 100) / 100;

// 'scale-to-listed-total': weights that don't reach 100% are scaled up until they do.
export function scaleWeights<T extends GradedItem>(items: T[]): T[] {
  const total = items.reduce((sum, i) => sum + i.weight, 0);
  if (!total || total >= 100) return items;
  return items.map((i) => ({ ...i, weight: (i.weight * 100) / total }));
}

// A term's grade point average on McGill's scale, weighted by credits, over the classes that
// have a percentage to go on. null when none does.
export function termGpa(classes: { credits: number; percent: number | null }[]): number | null {
  const counted = classes.filter((c) => c.percent != null);
  const credits = counted.reduce((sum, c) => sum + c.credits, 0);
  if (!credits) return null;
  return round2(counted.reduce((sum, c) => sum + letterFor(c.percent!).gpa * c.credits, 0) / credits);
}

// The CGPA once a term's GPA joins the record so far.
export function cgpaWith(past: { gpa: number | null; credits: number }, term: { gpa: number | null; credits: number }): number | null {
  if (term.gpa == null || !term.credits) return past.gpa;
  if (past.gpa == null || !past.credits) return term.gpa;
  return round2((past.gpa * past.credits + term.gpa * term.credits) / (past.credits + term.credits));
}

// A component made of several marks, like weekly quizzes: what they come to, counting only the
// `best` highest when the syllabus drops the rest. Until there are more marks than that, all count.
export function markFromParts(marks: number[], best: number | null): { score: number; dropped: number[] } | null {
  if (!marks.length) return null;
  const sorted = [...marks].sort((a, b) => b - a);
  const counted = best != null && best < sorted.length ? sorted.slice(0, best) : sorted;
  return {
    score: round2(counted.reduce((sum, mark) => sum + mark, 0) / counted.length),
    dropped: sorted.slice(counted.length),
  };
}

// A3: a week worth warning about on the semester view. Weights are each a share of a different
// class, so their sum only says how much is riding on that week.
export function isBusyWeek(due: { weight?: number }[]): boolean {
  return due.length >= 4 || due.reduce((sum, d) => sum + (d.weight ?? 0), 0) >= 30;
}

// G2 ← myCourses: the marks in a pasted grades page, with the name on the same line as the mark
// ("Assignment 1  18 / 20  90 %") or the line before it. Only the first mark on a line counts:
// the others are the same one in other columns. A mark with no grade yet ("- / 20") is skipped.
const PASTED_FRACTION = /(\d+(?:[.,]\d+)?)\s*\/\s*(\d+(?:[.,]\d+)?)/;
const PASTED_PERCENT = /(\d+(?:[.,]\d+)?)\s*%/;

export function parsePastedGrades(text: string): { name: string; score: number }[] {
  const number = (found: string) => Number(found.replace(',', '.'));
  const grades: { name: string; score: number }[] = [];
  let heading: string | null = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const fraction = line.match(PASTED_FRACTION);
    const percent = line.match(PASTED_PERCENT);
    const found = fraction && (!percent || fraction.index! <= percent.index!) ? fraction : percent;
    if (!found) {
      if (/\p{L}{2}/u.test(line) && !/^[-–—]\s*\/\s*\d/.test(line) && line.length <= 80) heading = line;
      continue;
    }
    const before = line.slice(0, found.index).replace(/[\s:|\t–—-]+$/, '').trim();
    const name: string | null = /\p{L}{2}/u.test(before) ? before : heading;
    heading = null;
    if (!name) continue;
    const score = found === fraction ? (number(found[1]) / number(found[2])) * 100 : number(found[1]);
    if (!Number.isFinite(score) || score < 0 || score > 150) continue;
    if (!grades.some((g) => g.name.toLowerCase() === name.toLowerCase())) grades.push({ name, score: round2(score) });
  }
  return grades;
}

// Which component of the scheme a pasted name means: the same name, or else one that contains the other
// ("Midterm Exam" and "Midterm"). Not if that could be more than one.
export function matchComponent<T extends { name: string }>(name: string, components: T[]): T | null {
  const clean = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const wanted = clean(name);
  const exact = components.find((c) => clean(c.name) === wanted);
  if (exact) return exact;
  const close = components.filter((c) => clean(c.name).includes(wanted) || wanted.includes(clean(c.name)));
  return close.length === 1 ? close[0] : null;
}

// What a component's name says about it, like "Homework (best 5 of 6)".
export function bestFromName(name: string): number | null {
  const found = name.match(/\bbest\s+(\d{1,2})\s+(?:of|out of)\s+\d|\b(\d{1,2})\s+meilleure?s?\s+(?:sur|de)\s+\d/i);
  return found ? Number(found[1] ?? found[2]) : null;
}

// Several marks as a student would type them: "8/10 9/10 7.5/10", with spaces, semicolons, line
// breaks or commas between them. A comma inside one mark stays a decimal comma ("8,5").
export function parseMarks(text: string): { marks: number[]; unreadable: string[] } {
  const tokens = text
    .split(/[\s;]+/)
    .map((token) => token.replace(/,+$/, ''))
    .filter(Boolean)
    .flatMap((token) => ((token.match(/,/g)?.length ?? 0) > 1 ? token.split(',').filter(Boolean) : [token]));
  const marks: number[] = [];
  const unreadable: string[] = [];
  for (const token of tokens) {
    const mark = parseMark(token);
    if (mark == null) unreadable.push(token);
    else marks.push(mark);
  }
  return { marks, unreadable };
}

// A mark as a student would type it: "88", "88%" or "44/50". null for an empty box (no mark
// yet), undefined for something that can't be read as a mark.
export function parseMark(text: string): number | null | undefined {
  const input = text.trim().replace(/,/g, '.').replace(/\s+/g, '');
  if (!input) return null;
  const fraction = input.match(/^(\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?)$/);
  const percent = input.match(/^(\d+(?:\.\d+)?)%?$/);
  const value = fraction && Number(fraction[2]) > 0 ? (Number(fraction[1]) / Number(fraction[2])) * 100 : percent ? Number(percent[1]) : NaN;
  // Bonus marks can go over 100, up to what the service accepts.
  return Number.isNaN(value) || value > 150 ? undefined : Math.round(value * 100) / 100;
}
