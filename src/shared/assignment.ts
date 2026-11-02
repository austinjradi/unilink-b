// ST2 "upload the file": finds the problems in an assignment handout ("Question 1 (20 points)",
// "Problem 2.", "Q3)", "Exercice 4 [10 pts]") so each one can become a task. Only headings
// that start a line count, so "as in Question 2" in the text isn't a second Question 2, and
// sub-parts like "Problem 1.2" aren't problems of their own.

export interface AssignmentPart {
  title: string;
  points: number | null;
}

const HEADING = /^(?:#+\s*|[*_]{1,2})?(question|problem|probl[eè]me|exercise|exercice|task|t[aâ]che|q)\s*#?\s*(\d{1,2})(?![\d.,]\d)/i;
const POINTS = /[([]?\s*(\d{1,3}(?:[.,]\d+)?)\s*(?:points?|pts?\.?|marks?|%)\s*[)\]]?/i;
// Longer than this, the rest of the heading line is the question itself, not its name.
const MAX_NAME = 50;

export function findParts(text: string): AssignmentPart[] {
  const found: { keyword: string; number: number; title: string; points: number | null }[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    const m = line.match(HEADING);
    if (!m) continue;
    const label = m[0].replace(/^[#*_\s]+/, '');
    const pointsMatch = line.match(POINTS);
    const name = line
      .slice(m[0].length)
      .replace(pointsMatch?.[0] ?? '', ' ')
      .replace(/^[\s.:)\-–—*_]+|[\s.:*_]+$/g, '')
      .replace(/\s+/g, ' ');
    found.push({
      keyword: m[1].toLowerCase(),
      number: Number(m[2]),
      title: name && name.length <= MAX_NAME ? `${label}: ${name}` : label,
      points: pointsMatch ? Number(pointsMatch[1].replace(',', '.')) : null,
    });
  }

  // A handout can use more than one word ("Question 1" in the text, "Task 1" in a checklist):
  // the one with the most numbered headings wins.
  const byKeyword = new Map<string, Set<number>>();
  for (const f of found) byKeyword.set(f.keyword, (byKeyword.get(f.keyword) ?? new Set()).add(f.number));
  const keyword = [...byKeyword].sort((a, b) => b[1].size - a[1].size)[0]?.[0];

  // The first heading with each number (a solutions section can repeat them).
  const seen = new Set<number>();
  return found
    .filter((f) => f.keyword === keyword && !seen.has(f.number) && seen.add(f.number))
    .map(({ title, points }) => ({ title, points }));
}

// Minutes for each part: `minutes` each, or shared out by points when every part has them
// (a 30-point question gets twice the time of a 15-point one), in 15-minute steps.
export function minutesForParts(parts: AssignmentPart[], minutes: number) {
  const total = parts.reduce((sum, p) => sum + (p.points ?? 0), 0);
  if (!total || parts.some((p) => !p.points)) return parts.map(() => minutes);
  return parts.map((p) => Math.min(600, Math.max(15, Math.round((minutes * parts.length * p.points!) / total / 15) * 15)));
}
