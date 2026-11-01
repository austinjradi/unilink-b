// McGill's standard letter-grade scale (A4).
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

export type Letter = (typeof MCGILL_SCALE)[number]['letter'];

export function letterFor(percent: number) {
  return MCGILL_SCALE.find((g) => percent >= g.min) ?? MCGILL_SCALE[MCGILL_SCALE.length - 1];
}

export function minimumFor(letter: string): number {
  return MCGILL_SCALE.find((g) => g.letter === letter)?.min ?? 0;
}

export interface GradedItem {
  weight: number;
  score: number | null;
}

export interface Requirement {
  letter: string;
  // Average needed on everything not yet graded, in %.
  needed: number | null;
  status: 'secured' | 'possible' | 'out-of-reach';
}

export interface GradeSummary {
  totalWeight: number;
  gradedWeight: number;
  remainingWeight: number;
  // Average on graded work only, in %.
  currentAverage: number | null;
  // Final grade range if every remaining item scores 0% / 100%.
  worstFinal: number;
  bestFinal: number;
  requirements: Requirement[];
}

const round1 = (n: number) => Math.round(n * 10) / 10;

// "Explore different scenarios": the final grade if everything left averages `average`%.
export function finalIfRemainingAverages(items: GradedItem[], average: number): number {
  const totalWeight = items.reduce((sum, i) => sum + i.weight, 0);
  if (!totalWeight) return 0;
  const earned = items.reduce((sum, i) => sum + (i.score == null ? (i.weight * average) / 100 : (i.weight * i.score) / 100), 0);
  return round1((earned / totalWeight) * 100);
}

export function summarize(items: GradedItem[]): GradeSummary {
  const totalWeight = items.reduce((sum, i) => sum + i.weight, 0);
  const graded = items.filter((i) => i.score != null);
  const gradedWeight = graded.reduce((sum, i) => sum + i.weight, 0);
  const earned = graded.reduce((sum, i) => sum + (i.weight * (i.score ?? 0)) / 100, 0);
  const remainingWeight = totalWeight - gradedWeight;
  const scale = totalWeight > 0 ? 100 / totalWeight : 0;

  const requirements = MCGILL_SCALE.filter((g) => g.min > 0).map((g): Requirement => {
    const pointsNeeded = g.min / scale - earned;
    if (pointsNeeded <= 0) return { letter: g.letter, needed: 0, status: 'secured' };
    if (remainingWeight <= 0) return { letter: g.letter, needed: null, status: 'out-of-reach' };
    const needed = (pointsNeeded / remainingWeight) * 100;
    return { letter: g.letter, needed: round1(needed), status: needed > 100 ? 'out-of-reach' : 'possible' };
  });

  return {
    totalWeight: round1(totalWeight),
    gradedWeight: round1(gradedWeight),
    remainingWeight: round1(remainingWeight),
    currentAverage: gradedWeight > 0 ? round1((earned / gradedWeight) * 100) : null,
    worstFinal: round1(earned * scale),
    bestFinal: round1((earned + remainingWeight) * scale),
    requirements,
  };
}
