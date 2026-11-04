import type { Program } from '@shared/degree';

// A2: SAMPLE programs for demonstrating degree planning. They are illustrative only and
// are NOT official McGill requirements; the real programs are in the imported catalogue
// (shared/catalogue), and services/academics.ts offers both.
export const PROGRAMS: Program[] = [
  {
    id: 'sample-cs-major',
    name: 'Computer Science, Major (sample)',
    degree: 'B.Sc.',
    totalCredits: 90,
    minProgramGrade: 'C',
    groups: [
      {
        id: 'core',
        name: 'Required courses',
        kind: 'required',
        courses: [
          'COMP 202', 'COMP 206', 'COMP 250', 'COMP 251', 'COMP 273', 'COMP 302', 'COMP 303',
          'COMP 330', 'COMP 360', 'MATH 133', 'MATH 140', 'MATH 141', 'MATH 240',
        ],
      },
      {
        id: 'complementary',
        name: 'Complementary courses',
        kind: 'choose',
        credits: 12,
        courses: ['COMP 307', 'COMP 421', 'COMP 424', 'COMP 551', 'MATH 222', 'MATH 223', 'MATH 323', 'MATH 324'],
      },
    ],
  },
  {
    id: 'sample-software-eng',
    name: 'Software Engineering (sample)',
    degree: 'B.Eng.',
    totalCredits: 120,
    minProgramGrade: 'C',
    groups: [
      {
        id: 'core',
        name: 'Required courses',
        kind: 'required',
        courses: [
          'COMP 206', 'COMP 250', 'COMP 251', 'COMP 302', 'COMP 303', 'ECSE 200', 'ECSE 202', 'ECSE 205',
          'ECSE 222', 'MATH 133', 'MATH 140', 'MATH 141', 'MATH 222', 'MATH 240', 'PHYS 131', 'PHYS 142',
        ],
      },
      {
        id: 'technical',
        name: 'Technical complementaries',
        kind: 'choose',
        credits: 9,
        courses: ['COMP 307', 'COMP 330', 'COMP 360', 'COMP 421', 'COMP 424', 'COMP 551'],
      },
      {
        id: 'science',
        name: 'Science complementary',
        kind: 'choose',
        credits: 4,
        courses: ['CHEM 110', 'CHEM 120', 'BIOL 111', 'BIOL 112'],
      },
    ],
  },
  {
    id: 'sample-math-major',
    name: 'Mathematics, Major (sample)',
    degree: 'B.Sc.',
    totalCredits: 90,
    minProgramGrade: 'C',
    groups: [
      {
        id: 'core',
        name: 'Required courses',
        kind: 'required',
        courses: ['MATH 133', 'MATH 140', 'MATH 141', 'MATH 222', 'MATH 223', 'MATH 235', 'MATH 240', 'MATH 323', 'MATH 324'],
      },
      {
        id: 'complementary',
        name: 'Complementary courses',
        kind: 'choose',
        credits: 6,
        courses: ['COMP 202', 'COMP 250', 'COMP 360', 'ECON 208', 'ECON 209'],
      },
    ],
  },
];
