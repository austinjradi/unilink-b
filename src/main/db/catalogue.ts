// G2: a built-in sample of the McGill course catalogue. Swap this for an import
// of the real eCalendar once the tech team picks a source.
export const CATALOGUE: [subject: string, number: string, title: string, credits: number][] = [
  ['BIOL', '111', 'Principles: Organismal Biology', 3],
  ['BIOL', '112', 'Cell and Molecular Biology', 3],
  ['CHEM', '110', 'General Chemistry 1', 4],
  ['CHEM', '120', 'General Chemistry 2', 4],
  ['COMP', '202', 'Foundations of Programming', 3],
  ['COMP', '206', 'Introduction to Software Systems', 3],
  ['COMP', '250', 'Introduction to Computer Science', 3],
  ['COMP', '251', 'Algorithms and Data Structures', 3],
  ['COMP', '273', 'Introduction to Computer Systems', 3],
  ['COMP', '302', 'Programming Languages and Paradigms', 3],
  ['COMP', '303', 'Software Design', 3],
  ['COMP', '307', 'Principles of Web Development', 3],
  ['COMP', '330', 'Theory of Computation', 3],
  ['COMP', '360', 'Algorithm Design', 3],
  ['COMP', '421', 'Database Systems', 3],
  ['COMP', '424', 'Artificial Intelligence', 3],
  ['COMP', '551', 'Applied Machine Learning', 4],
  ['ECON', '208', 'Microeconomic Analysis and Applications', 3],
  ['ECON', '209', 'Macroeconomic Analysis and Applications', 3],
  ['ECSE', '200', 'Electric Circuits 1', 3],
  ['ECSE', '202', 'Introduction to Software Development', 3],
  ['ECSE', '205', 'Probability and Statistics for Engineers', 3],
  ['ECSE', '222', 'Digital Logic', 3],
  ['MATH', '133', 'Linear Algebra and Geometry', 3],
  ['MATH', '140', 'Calculus 1', 3],
  ['MATH', '141', 'Calculus 2', 4],
  ['MATH', '222', 'Calculus 3', 3],
  ['MATH', '223', 'Linear Algebra', 3],
  ['MATH', '235', 'Algebra 1', 3],
  ['MATH', '240', 'Discrete Structures', 3],
  ['MATH', '323', 'Probability', 3],
  ['MATH', '324', 'Statistics', 3],
  ['MGCR', '211', 'Introduction to Financial Accounting', 3],
  ['PHYS', '131', 'Mechanics and Waves', 4],
  ['PHYS', '142', 'Electromagnetism and Optics', 4],
  ['PSYC', '100', 'Introduction to Psychology', 3],
];

// Lecture sections per course and term. Big 100- and 200-level courses run two.
export function sectionsFor(number: string): string[] {
  return Number(number) < 300 ? ['001', '002'] : ['001'];
}
