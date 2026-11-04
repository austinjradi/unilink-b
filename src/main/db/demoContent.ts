import type { LinkPurpose } from '@shared/links';
import type { FACULTIES } from '@shared/validation';

// The bigger demo: a few dozen classmates spread over the Fall 2026 sections, so most
// classes a visitor joins already have people, shared course info, a busy board, group
// chats and study sessions. db/demo.ts turns this into rows. Times are relative to when
// the demo is first opened ("in 3 days", "5 hours ago"). Professors, rooms' occupants and
// chat invites are made up; every chat link contains "demo".

// A classmate's key ("maya"), or one of the three accounts listed on the sign-in screen.
export type Who = string;

export type Track = 'cs' | 'eng' | 'math' | 'sci' | 'arts';

export interface ClassmateSeed {
  key: Who;
  name: string;
  pronouns: string;
  faculty: (typeof FACULTIES)[number];
  gradYear: number;
  track: Track;
}

export const CLASSMATES: ClassmateSeed[] = [
  { key: 'maya', name: 'Maya Chen', pronouns: 'she/her', faculty: 'Science', gradYear: 2027, track: 'cs' },
  { key: 'jonah', name: 'Jonah Friedman', pronouns: 'he/him', faculty: 'Science', gradYear: 2028, track: 'cs' },
  { key: 'leila', name: 'Leila Haddad', pronouns: 'she/her', faculty: 'Science', gradYear: 2028, track: 'cs' },
  { key: 'noah', name: 'Noah Gagnon', pronouns: '', faculty: 'Science', gradYear: 2029, track: 'cs' },
  { key: 'arjun', name: 'Arjun Mehta', pronouns: 'he/him', faculty: 'Science', gradYear: 2027, track: 'cs' },
  { key: 'emma', name: 'Emma Lavoie', pronouns: 'she/her', faculty: 'Science', gradYear: 2028, track: 'cs' },
  { key: 'kenji', name: 'Kenji Watanabe', pronouns: 'he/him', faculty: 'Science', gradYear: 2028, track: 'cs' },
  { key: 'sofia', name: 'Sofía Ramírez', pronouns: 'she/her', faculty: 'Science', gradYear: 2027, track: 'cs' },
  { key: 'david', name: 'David Okafor', pronouns: 'he/him', faculty: 'Science', gradYear: 2027, track: 'cs' },
  { key: 'chloe', name: 'Chloé Bergeron', pronouns: 'she/her', faculty: 'Science', gradYear: 2029, track: 'cs' },
  { key: 'ines', name: 'Inès Benali', pronouns: 'she/her', faculty: 'Arts and Science', gradYear: 2028, track: 'cs' },
  { key: 'marcus', name: 'Marcus Lee', pronouns: 'he/they', faculty: 'Science', gradYear: 2028, track: 'cs' },
  { key: 'olivia', name: 'Olivia Nguyen', pronouns: 'she/her', faculty: 'Engineering', gradYear: 2028, track: 'eng' },
  { key: 'ethan', name: 'Ethan Roy', pronouns: 'he/him', faculty: 'Engineering', gradYear: 2029, track: 'eng' },
  { key: 'fatima', name: 'Fatima Siddiqui', pronouns: 'she/her', faculty: 'Engineering', gradYear: 2027, track: 'eng' },
  { key: 'lucas', name: 'Lucas Pelletier', pronouns: 'he/him', faculty: 'Engineering', gradYear: 2028, track: 'eng' },
  { key: 'amara', name: 'Amara Eze', pronouns: 'she/her', faculty: 'Engineering', gradYear: 2029, track: 'eng' },
  { key: 'tomas', name: 'Tomás Silva', pronouns: 'he/him', faculty: 'Engineering', gradYear: 2028, track: 'eng' },
  { key: 'hana', name: 'Hana Kim', pronouns: '', faculty: 'Engineering', gradYear: 2027, track: 'eng' },
  { key: 'gabriel', name: 'Gabriel Fortin', pronouns: 'he/him', faculty: 'Science', gradYear: 2027, track: 'math' },
  { key: 'zoe', name: 'Zoë Kaplan', pronouns: 'she/her', faculty: 'Science', gradYear: 2028, track: 'math' },
  { key: 'yusuf', name: 'Yusuf Demir', pronouns: 'he/him', faculty: 'Science', gradYear: 2029, track: 'math' },
  { key: 'clara', name: 'Clara Dubois', pronouns: 'she/her', faculty: 'Science', gradYear: 2028, track: 'math' },
  { key: 'rohan', name: 'Rohan Iyer', pronouns: 'he/him', faculty: 'Science', gradYear: 2027, track: 'math' },
  { key: 'lily', name: 'Lily Thompson', pronouns: 'she/her', faculty: 'Science', gradYear: 2030, track: 'sci' },
  { key: 'felix', name: 'Félix Morin', pronouns: 'he/him', faculty: 'Science', gradYear: 2030, track: 'sci' },
  { key: 'aisha', name: 'Aisha Mohamed', pronouns: 'she/her', faculty: 'Science', gradYear: 2030, track: 'sci' },
  { key: 'ben', name: 'Ben Goldberg', pronouns: 'he/him', faculty: 'Science', gradYear: 2029, track: 'sci' },
  { key: 'nadia', name: 'Nadia Popescu', pronouns: 'she/her', faculty: 'Science', gradYear: 2030, track: 'sci' },
  { key: 'owen', name: 'Owen MacDonald', pronouns: 'he/him', faculty: 'Science', gradYear: 2030, track: 'sci' },
  { key: 'mia', name: 'Mia Rossi', pronouns: 'she/her', faculty: 'Science', gradYear: 2029, track: 'sci' },
  { key: 'julien', name: 'Julien Lefebvre', pronouns: '', faculty: 'Science', gradYear: 2030, track: 'sci' },
  { key: 'sarah', name: 'Sarah Cohen', pronouns: 'she/her', faculty: 'Arts', gradYear: 2028, track: 'arts' },
  { key: 'william', name: 'William Tran', pronouns: 'he/him', faculty: 'Management', gradYear: 2028, track: 'arts' },
  { key: 'camille', name: 'Camille Girard', pronouns: 'she/her', faculty: 'Arts', gradYear: 2029, track: 'arts' },
  { key: 'daniel', name: 'Daniel Park', pronouns: 'he/him', faculty: 'Management', gradYear: 2027, track: 'arts' },
  { key: 'elena', name: 'Elena Petrova', pronouns: 'she/her', faculty: 'Arts', gradYear: 2028, track: 'arts' },
  { key: 'kofi', name: 'Kofi Mensah', pronouns: 'he/him', faculty: 'Arts', gradYear: 2029, track: 'arts' },
  { key: 'grace', name: "Grace O'Brien", pronouns: 'she/her', faculty: 'Arts', gradYear: 2030, track: 'arts' },
  { key: 'theo', name: 'Théo Martin', pronouns: 'they/them', faculty: 'Arts', gradYear: 2028, track: 'arts' },
];

// Classmates who joined but haven't posted. They fill out class sizes, study sessions and
// 🐐 counts, and stay anonymous like anyone who hasn't posted (S1).
export const QUIET_CLASSMATES = 90;

export const FIRST_NAMES = [
  'Adam', 'Alice', 'Amélie', 'Antoine', 'Ava', 'Benjamin', 'Camila', 'Charles', 'Charlotte', 'Daniela', 'Dylan', 'Élodie',
  'Eli', 'Emily', 'Eric', 'Farah', 'Florence', 'Gabrielle', 'Hamza', 'Hugo', 'Isaac', 'Isabella', 'Jacob', 'Jasmine',
  'Jérémie', 'Julia', 'Justin', 'Karan', 'Laura', 'Léa', 'Liam', 'Lina', 'Louis', 'Lucy', 'Malik', 'Marie', 'Mathis',
  'Max', 'Mohammed', 'Nathan', 'Nina', 'Noor', 'Olivier', 'Oscar', 'Paul', 'Rachel', 'Raphaël', 'Rebecca', 'Ryan',
  'Sam', 'Simon', 'Sophie', 'Stella', 'Tara', 'Thomas', 'Victoria', 'Vincent', 'Wei', 'Xavier', 'Yasmine', 'Zack',
];

export const LAST_NAMES = [
  'Abbott', 'Ahmed', 'Allard', 'Baker', 'Beaulieu', 'Bélanger', 'Bouchard', 'Brown', 'Campbell', 'Caron', 'Chan',
  'Chowdhury', 'Clark', 'Cloutier', 'Cohen', 'Côté', 'Desjardins', 'Diallo', 'Dumont', 'Evans', 'Ferreira',
  'Fischer', 'Gill', 'Gupta', 'Hall', 'Hébert', 'Hughes', 'Ito', 'Jensen', 'Joshi', 'Khan', 'Lambert', 'Langlois', 'Li',
  'Liu', 'Lopez', 'Mercier', 'Miller', 'Moreau', 'Morris', 'Murphy', 'Nadeau', 'Ortiz', 'Patel', 'Paquette', 'Poirier',
  'Rahman', 'Reid', 'Robinson', 'Sanchez', 'Santos', 'Schmidt', 'Singh', 'Smith', 'Tanaka', 'Turcotte', 'Wang', 'Wilson',
  'Wong', 'Yang', 'Zhang',
];

// Courses each kind of student picks from, on top of the sections they post in.
export const TRACK_COURSES: Record<Track, string[]> = {
  cs: ['COMP 202', 'COMP 206', 'COMP 250', 'COMP 251', 'COMP 273', 'COMP 302', 'COMP 303', 'COMP 330', 'COMP 360', 'COMP 421', 'COMP 424', 'COMP 551', 'MATH 240', 'MATH 323'],
  eng: ['ECSE 200', 'ECSE 202', 'ECSE 205', 'ECSE 222', 'MATH 141', 'MATH 222', 'MATH 223', 'PHYS 142', 'COMP 206', 'COMP 250'],
  math: ['MATH 222', 'MATH 223', 'MATH 235', 'MATH 240', 'MATH 323', 'MATH 324', 'COMP 250', 'COMP 251'],
  sci: ['BIOL 111', 'BIOL 112', 'CHEM 110', 'CHEM 120', 'MATH 133', 'MATH 140', 'MATH 141', 'PHYS 131', 'PHYS 142', 'PSYC 100', 'COMP 202'],
  arts: ['ECON 208', 'ECON 209', 'MGCR 211', 'PSYC 100', 'MATH 133', 'MATH 140', 'COMP 202'],
};

// The three sign-in accounts' Fall 2026 sections (all three share COMP 251-001).
export const CORE_SECTIONS: Record<Who, string[]> = {
  alex: ['COMP 251-001', 'COMP 273-001', 'COMP 302-001', 'MATH 240-001', 'MATH 323-001'],
  priya: ['COMP 251-001', 'COMP 303-001', 'ECSE 205-001', 'ECSE 222-001', 'MATH 222-001'],
  samuel: ['COMP 251-001', 'MATH 235-001', 'MATH 240-001', 'MATH 323-001', 'MATH 324-001'],
};

export type Topic = 'Lectures' | 'Assignments' | 'Exams' | 'Labs and tutorials' | 'Logistics' | 'Off-topic';

export interface PostSeed {
  by: Who;
  kind: 'question' | 'note';
  topic: Topic;
  title: string;
  body: string;
  hoursAgo: number;
  replies?: [by: Who, body: string][];
  // Index into replies of the answer the asker accepted.
  accepted?: number;
  goats?: number;
  // Selected audience; the post is visible to the whole section when omitted.
  to?: Who[];
}

export interface SessionSeed {
  by: Who;
  title: string;
  description: string;
  tag: 'Assignment' | 'Midterm' | 'Final' | 'Lab' | 'Project' | 'Review';
  // A room for in-person sessions, a meeting link for online ones.
  where: string;
  online?: boolean;
  inDays: number;
  start: string;
  hours: number;
  capacity: number;
  // People going, the host included; anyone past capacity waits.
  going: number;
  waitlist?: number;
  // Invite-only sessions use this code; open ones get a random one.
  inviteCode?: string;
}

export interface SectionSeed {
  details?: { by: Who; professor: string; email: string; officeHours: string; location: string; daysAgo: number };
  times?: { by: Who; days: number[]; start: string; end: string; location: string };
  scheme?: { by: Who; items: [name: string, weight: number, dueInDays: number | null][] };
  deadlines?: { by: Who; kind: 'assignment' | 'exam' | 'quiz' | 'other'; title: string; inDays: number; time: string; notes?: string }[];
  links?: { by: Who; url: string; purpose: LinkPurpose; label: string; works?: number; reports?: string[] }[];
  sessions?: SessionSeed[];
  posts?: PostSeed[];
}

const MWF = [1, 3, 5];
const TR = [2, 4];

export const SECTIONS: Record<string, SectionSeed> = {
  // Already has its details, times, scheme and first posts from the original demo.
  'COMP 251-001': {
    deadlines: [
      { by: 'kenji', kind: 'quiz', title: 'Quiz 4 (myCourses, shortest paths)', inDays: 10, time: '23:59', notes: 'Same format as quiz 3.' },
    ],
    links: [
      { by: 'emma', url: 'https://chat.whatsapp.com/DemoComp251Sec001', purpose: 'section', label: 'Section 001 only', works: 3 },
      { by: 'noah', url: 'https://discord.gg/demo-old-comp251-w26', purpose: 'other', label: 'Winter 2026 server', reports: ['Expired invite', 'Old term, nobody posts there'] },
    ],
    sessions: [
      {
        by: 'arjun',
        title: 'DP practice problems',
        description: 'We pick three problems from the practice set and solve them on the whiteboard. No prep needed.',
        tag: 'Assignment',
        where: 'Schulich Library, group room 4C',
        inDays: 1,
        start: '16:00',
        hours: 2,
        capacity: 6,
        going: 5,
      },
      {
        by: 'leila',
        title: 'Midterm review: graphs and MSTs',
        description: "Going through last year's midterm, then BFS/DFS edge cases and Kruskal vs Prim. Cameras optional.",
        tag: 'Midterm',
        where: 'https://mcgill.zoom.us/j/5550101251',
        online: true,
        inDays: 10,
        start: '18:30',
        hours: 2,
        capacity: 12,
        going: 8,
      },
      {
        by: 'samuel',
        title: 'Quiet co-working for 251',
        description: 'Work on whatever 251 thing you need to. We take a break every 50 minutes to ask each other questions.',
        tag: 'Review',
        where: 'Trottier 2100',
        inDays: 4,
        start: '13:00',
        hours: 3,
        capacity: 4,
        going: 4,
        waitlist: 2,
      },
      {
        by: 'priya',
        title: 'Assignment 1 walkthrough',
        description: 'Comparing approaches after the deadline.',
        tag: 'Assignment',
        where: 'Trottier 3120',
        inDays: -9,
        start: '17:00',
        hours: 1.5,
        capacity: 8,
        going: 5,
      },
    ],
    posts: [
      {
        by: 'samuel',
        kind: 'note',
        topic: 'Lectures',
        title: 'Lecture 14 notes on Dijkstra, with the proof the slides skip',
        body: "I wrote up the correctness proof for Dijkstra that we rushed through on Thursday, plus a worked example showing the priority queue after each step. It's in the study server under #notes. Corrections welcome.",
        hoursAgo: 30,
        goats: 6,
        replies: [
          ['jonah', 'This is great, the loop invariant finally makes sense.'],
          ['leila', 'Small thing: in step 4 the distance to E should be 7, not 8 (it goes through C).'],
          ['samuel', 'Good catch, fixed!'],
        ],
      },
      {
        by: 'jonah',
        kind: 'question',
        topic: 'Assignments',
        title: 'A2 Q3: can we assume edge weights are distinct?',
        body: "The MST question says \"prove your algorithm returns the unique MST\" but doesn't say the weights are distinct. Without that the MST isn't unique, right?",
        hoursAgo: 20,
        goats: 3,
        replies: [
          ['priya', "The TA said in tutorial that you can assume distinct weights unless the question says otherwise. I'd state the assumption at the top of your answer to be safe."],
          ['arjun', 'Agreed. If you want to be thorough, say how ties would be broken (by edge index, say) so the proof still works.'],
        ],
        accepted: 0,
      },
      {
        by: 'leila',
        kind: 'question',
        topic: 'Exams',
        title: 'Are we allowed a cheat sheet for the midterm?',
        body: "Couldn't find it in the outline. Anyone know?",
        hoursAgo: 9,
        replies: [
          ['alex', 'The course outline says one letter-size page, both sides, handwritten or typed.'],
          ['emma', 'Typed is allowed? Nice, I was about to handwrite mine in size 6 font 😅'],
        ],
        accepted: 0,
      },
      {
        by: 'arjun',
        kind: 'question',
        topic: 'Lectures',
        title: 'Where does the α(n) bound for union-find come from?',
        body: 'I get path compression and union by rank separately, but the inverse Ackermann bound feels like it comes out of nowhere. Is the proof examinable or just the result?',
        hoursAgo: 52,
        goats: 2,
        replies: [
          ['samuel', "Just the result, the prof said so in Tuesday's lecture. CLRS 21.4 has the full proof if you're curious, but it's long."],
          ['kenji', "If you want intuition first, the O(log* n) potential-function argument is much friendlier and it's the same idea."],
        ],
        accepted: 0,
      },
      {
        by: 'emma',
        kind: 'question',
        topic: 'Logistics',
        title: 'Are Friday TA office hours back this week?',
        body: 'They were cancelled last Friday. Does anyone know if they are on again this Friday at the usual time?',
        hoursAgo: 4,
      },
      {
        by: 'kenji',
        kind: 'note',
        topic: 'Off-topic',
        title: 'Competitive programming club meets Wednesdays',
        body: 'If you liked the DP lectures: the competitive programming club practises Wednesdays at 18:00 in Trottier 0060. Beginners very welcome, and sometimes there is pizza.',
        hoursAgo: 70,
        goats: 4,
        replies: [
          ['jonah', "Is it okay to come if I've never done a contest?"],
          ['kenji', 'Absolutely, most people start that way.'],
        ],
      },
      {
        by: 'priya',
        kind: 'question',
        topic: 'Logistics',
        title: 'Room for the Sunday before the midterm?',
        body: 'Only asking you two: should I book a Schulich group room for the Sunday before the midterm? I can get one 13:00–17:00.',
        hoursAgo: 26,
        to: ['alex', 'samuel'],
        replies: [
          ['alex', 'Works for me!'],
          ['samuel', "I'm in. I'll bring the past exams."],
        ],
        accepted: 1,
      },
    ],
  },

  'COMP 251-002': {
    details: {
      by: 'olivia',
      professor: 'Prof. Daniel Ouellet',
      email: 'daniel.ouellet@mcgill.ca',
      officeHours: 'Mon 15:00–16:30, McConnell 234',
      location: 'Stewart Biology S1/4',
      daysAgo: 12,
    },
    times: { by: 'olivia', days: MWF, start: '13:35', end: '14:25', location: 'Stewart Biology S1/4' },
    scheme: {
      by: 'rohan',
      items: [
        ['Assignment 1', 5, -24],
        ['Assignment 2', 5, -5],
        ['Assignment 3', 5, 12],
        ['Assignment 4', 5, 26],
        ['Midterm', 25, 7],
        ['Final exam', 55, null],
      ],
    },
    links: [{ by: 'olivia', url: 'https://discord.gg/demo-comp251-sec002', purpose: 'section', label: 'COMP 251 sec 002', works: 3 }],
    sessions: [
      {
        by: 'rohan',
        title: 'A3 help, office-hours style',
        description: "Bring what you've tried so far. I took 251 last year and I'm happy to help with the proofs.",
        tag: 'Assignment',
        where: 'Burnside 1B39',
        inDays: 3,
        start: '17:00',
        hours: 2,
        capacity: 8,
        going: 3,
      },
    ],
    posts: [
      {
        by: 'olivia',
        kind: 'question',
        topic: 'Exams',
        title: 'Does section 002 write the same midterm as 001?',
        body: 'Ours is a week earlier than theirs. Same exam or different?',
        hoursAgo: 26,
        replies: [['rohan', 'Different exam and time, same material up to and including MSTs (from the announcement on myCourses).']],
        accepted: 0,
      },
      {
        by: 'rohan',
        kind: 'note',
        topic: 'Lectures',
        title: 'Annotated slides for weeks 1–8',
        body: "I added my margin notes and the board examples to the slides. They're pinned in the Discord.",
        hoursAgo: 100,
        goats: 5,
        replies: [['hana', 'Thank you!! The amortized analysis part is so much clearer.']],
      },
      { by: 'hana', kind: 'question', topic: 'Assignments', title: 'Is the A3 autograder down?', body: 'It has been stuck on "queued" for an hour.', hoursAgo: 2 },
    ],
  },

  'COMP 202-001': {
    details: {
      by: 'lily',
      professor: 'Prof. Marie-Claude Lévesque',
      email: 'mc.levesque@mcgill.ca',
      officeHours: 'Tue 14:00–15:30, Trottier 3060',
      location: 'Leacock 132',
      daysAgo: 20,
    },
    times: { by: 'lily', days: MWF, start: '10:35', end: '11:25', location: 'Leacock 132' },
    scheme: {
      by: 'aisha',
      items: [
        ['Assignment 1', 8, -30],
        ['Assignment 2', 8, -12],
        ['Assignment 3', 8, 9],
        ['Assignment 4', 8, 27],
        ['Weekly quizzes', 8, null],
        ['Midterm', 20, -5],
        ['Final exam', 40, null],
      ],
    },
    deadlines: [
      { by: 'lily', kind: 'quiz', title: 'Weekly quiz 8 (myCourses)', inDays: 2, time: '23:59' },
      { by: 'owen', kind: 'other', title: 'Coding lab 6 check-in', inDays: 4, time: '16:00', notes: 'Show the TA your loop exercises.' },
    ],
    links: [
      { by: 'lily', url: 'https://chat.whatsapp.com/DemoComp202Fall26', purpose: 'course', label: 'COMP 202 Fall 2026', works: 5 },
      { by: 'owen', url: 'https://discord.gg/demo-comp202-tutorials', purpose: 'study-group', label: 'Tutorial help', works: 2 },
    ],
    sessions: [
      {
        by: 'aisha',
        title: 'A3 debugging help (bring your laptop)',
        description: "We'll go through common errors together: NullPointerException, off-by-one loops, Scanner weirdness.",
        tag: 'Assignment',
        where: 'Trottier 0100',
        inDays: 2,
        start: '15:00',
        hours: 2,
        capacity: 10,
        going: 7,
      },
      {
        by: 'felix',
        title: 'Floor study group',
        description: 'For people on our floor in residence. Code is in the floor chat.',
        tag: 'Review',
        where: 'Molson Hall, 4th floor lounge',
        inDays: 1,
        start: '20:00',
        hours: 2,
        capacity: 5,
        going: 3,
        inviteCode: 'MLSN4F',
      },
      {
        by: 'owen',
        title: 'Midterm corrections together',
        description: 'Going over what we got wrong.',
        tag: 'Midterm',
        where: 'https://mcgill.zoom.us/j/5550100202',
        online: true,
        inDays: -2,
        start: '19:00',
        hours: 1,
        capacity: 10,
        going: 4,
      },
    ],
    posts: [
      {
        by: 'felix',
        kind: 'question',
        topic: 'Assignments',
        title: 'NullPointerException when I call my method from main',
        body: 'My Account class compiles, but as soon as I call deposit() from main I get a NullPointerException on the line with transactions.add(t). I declared `private ArrayList<Transaction> transactions;` at the top. What am I missing?',
        hoursAgo: 5,
        goats: 2,
        replies: [
          ['aisha', 'You declared the list but never created it. Add `transactions = new ArrayList<>();` in your constructor.'],
          ['felix', 'That was it, thank you!! 🙏'],
        ],
        accepted: 0,
      },
      {
        by: 'lily',
        kind: 'question',
        topic: 'Exams',
        title: 'When do midterm grades come out?',
        body: 'Has anyone heard anything?',
        hoursAgo: 28,
        replies: [['owen', 'The prof said by next Wednesday on myCourses.']],
        accepted: 0,
      },
      {
        by: 'aisha',
        kind: 'note',
        topic: 'Lectures',
        title: 'Cheat sheet: String methods we have seen so far',
        body: 'charAt, substring (the end index is exclusive!), indexOf, equals vs ==, toUpperCase, compareTo, and length() for Strings vs length for arrays. Hope it helps for the quizzes.',
        hoursAgo: 60,
        goats: 9,
        replies: [
          ['mia', 'length() vs length got me on quiz 3, thanks'],
          ['ben', "Could you add compareTo? It was on last year's final."],
          ['aisha', 'Added!'],
        ],
      },
      {
        by: 'ben',
        kind: 'question',
        topic: 'Labs and tutorials',
        title: 'Do we need to go to tutorials in person?',
        body: 'I have a conflict with my chem lab every other week.',
        hoursAgo: 75,
        replies: [['nadia', "They're optional, but the TA goes over hints for the assignment, so it's worth catching the recording."]],
        accepted: 0,
      },
      { by: 'julien', kind: 'question', topic: 'Assignments', title: 'Is ArrayList allowed in A3?', body: 'The instructions only mention arrays.', hoursAgo: 1.5 },
    ],
  },

  'COMP 202-002': {
    details: {
      by: 'kofi',
      professor: 'Prof. Samir Khoury',
      email: 'samir.khoury@mcgill.ca',
      officeHours: 'Thu 10:00–11:30, McConnell 320',
      location: 'Bronfman 151',
      daysAgo: 15,
    },
    times: { by: 'kofi', days: TR, start: '14:35', end: '15:55', location: 'Bronfman 151' },
    scheme: {
      by: 'kofi',
      items: [
        ['Assignment 1', 7.5, -28],
        ['Assignment 2', 7.5, -10],
        ['Assignment 3', 7.5, 11],
        ['Assignment 4', 7.5, 29],
        ['Midterm', 25, -6],
        ['Final exam', 45, null],
      ],
    },
    links: [{ by: 'kofi', url: 'https://chat.whatsapp.com/DemoComp202Sec002', purpose: 'section', label: 'Section 002', works: 2 }],
    posts: [
      {
        by: 'grace',
        kind: 'question',
        topic: 'Assignments',
        title: 'Scanner skips my nextLine() input',
        body: 'After I read an int with nextInt(), the next nextLine() returns an empty string right away. Is this a bug in my code?',
        hoursAgo: 14,
        goats: 3,
        replies: [
          ['kofi', 'Classic one! nextInt() leaves the newline in the buffer. Call nextLine() once more right after nextInt() to use it up.'],
          ['grace', 'Wow, thank you, I spent an hour on this.'],
        ],
        accepted: 0,
      },
      {
        by: 'camille',
        kind: 'note',
        topic: 'Logistics',
        title: 'Section 002 tutorial room changed',
        body: 'Tutorials are in Burnside 1B45 starting this week (the email went to spam for a few of us).',
        hoursAgo: 40,
        goats: 4,
      },
    ],
  },

  'COMP 206-001': {
    details: {
      by: 'marcus',
      professor: 'Prof. Rachel Ng',
      email: 'rachel.ng@mcgill.ca',
      officeHours: 'Fri 11:00–12:00, Trottier 3104',
      location: 'Leacock 26',
      daysAgo: 18,
    },
    times: { by: 'marcus', days: TR, start: '11:35', end: '12:55', location: 'Leacock 26' },
    scheme: {
      by: 'ines',
      items: [
        ['Assignment 1', 7.5, -20],
        ['Assignment 2', 7.5, -6],
        ['Assignment 3', 7.5, 8],
        ['Assignment 4', 7.5, 22],
        ['Mini-project', 15, 29],
        ['Midterm', 20, -11],
        ['Final exam', 35, null],
      ],
    },
    links: [
      { by: 'ines', url: 'https://discord.gg/demo-comp206-fall26', purpose: 'course', label: 'COMP 206 server', works: 4 },
      { by: 'chloe', url: 'https://chat.whatsapp.com/DemoComp206Team7', purpose: 'project', label: 'Team 7 (mini-project)' },
    ],
    sessions: [
      {
        by: 'marcus',
        title: 'Bash scripting practice',
        description: 'Loops, arguments, grep and pipes. We do the practice sheet from tutorial 5.',
        tag: 'Assignment',
        where: 'Trottier 3120',
        inDays: 5,
        start: '18:00',
        hours: 2,
        capacity: 8,
        going: 4,
      },
      {
        by: 'chloe',
        title: 'Mini-project team sync',
        description: 'Team 7 only: splitting up the parser and the file I/O.',
        tag: 'Project',
        where: 'https://teams.microsoft.com/l/meetup-join/demo-comp206-team7',
        online: true,
        inDays: 2,
        start: '19:00',
        hours: 1,
        capacity: 3,
        going: 3,
        inviteCode: 'TEAM7Q',
      },
    ],
    posts: [
      {
        by: 'noah',
        kind: 'question',
        topic: 'Assignments',
        title: 'Segfault only on the SOCS server, not on my laptop',
        body: 'My C program for A3 runs fine on my Mac but segfaults on mimi. I use strcpy into a `char buf[20]`. Any ideas?',
        hoursAgo: 7,
        goats: 2,
        replies: [
          ['marcus', "Probably an off-by-one: strcpy writes the terminating '\\0' too, so a 20-character input needs buf[21]. macOS often hides it. Run it under valgrind on mimi."],
          ['noah', 'valgrind found it, it was exactly that. Thanks!'],
        ],
        accepted: 0,
      },
      {
        by: 'chloe',
        kind: 'question',
        topic: 'Lectures',
        title: 'git rebase or merge for the mini-project?',
        body: 'Our team keeps getting merge conflicts. Should we rebase instead?',
        hoursAgo: 33,
        replies: [
          ['ines', 'For a 3-person project, merging is simpler. Rebasing gives a clean history, but only rebase branches nobody else has pulled.'],
          ['marcus', '+1. And never force-push main 😅'],
        ],
        accepted: 0,
      },
      {
        by: 'marcus',
        kind: 'note',
        topic: 'Off-topic',
        title: 'Vim survival guide',
        body: 'Since half of us got stuck in vim during the lab: `i` to type, `Esc` then `:wq` to save and quit, `:q!` to quit without saving. Or set `export EDITOR=nano` in your .bashrc.',
        hoursAgo: 90,
        goats: 11,
        replies: [['chloe', 'the :q! saved my life']],
      },
      { by: 'ines', kind: 'question', topic: 'Exams', title: 'Is the final cumulative?', body: 'Or only the C part of the course?', hoursAgo: 3 },
    ],
  },

  'COMP 250-001': {
    details: {
      by: 'zoe',
      professor: 'Prof. Anna Kowalski',
      email: 'anna.kowalski@mcgill.ca',
      officeHours: 'Wed 10:00–11:30, McConnell 110N',
      location: 'Leacock 132',
      daysAgo: 25,
    },
    times: { by: 'zoe', days: MWF, start: '12:35', end: '13:25', location: 'Leacock 132' },
    scheme: {
      by: 'zoe',
      items: [
        ['Assignment 1', 10, -21],
        ['Assignment 2', 10, -3],
        ['Assignment 3', 10, 17],
        ['Midterm', 25, -13],
        ['Final exam', 45, null],
      ],
    },
    links: [{ by: 'amara', url: 'https://discord.gg/demo-comp250-fall26', purpose: 'course', label: 'COMP 250 Fall 2026', works: 3 }],
    sessions: [
      {
        by: 'zoe',
        title: 'A3 linked lists help',
        description: 'Drawing the pointers on paper first, then coding. Bring your attempt.',
        tag: 'Assignment',
        where: 'Schulich Library, room 304',
        inDays: 6,
        start: '14:00',
        hours: 2,
        capacity: 6,
        going: 2,
      },
    ],
    posts: [
      {
        by: 'ethan',
        kind: 'question',
        topic: 'Assignments',
        title: 'Big-O of a nested loop where j goes up to i',
        body: 'for i from 0 to n, for j from 0 to i. Is that O(n²) or O(n log n)?',
        hoursAgo: 18,
        replies: [['yusuf', 'O(n²): the inner loop runs 0 + 1 + … + (n−1) = n(n−1)/2 times in total.']],
        accepted: 0,
      },
      {
        by: 'amara',
        kind: 'question',
        topic: 'Lectures',
        title: 'Why do we need both hashCode and equals?',
        body: 'If equals already compares the objects, what is hashCode for?',
        hoursAgo: 45,
        goats: 3,
        replies: [
          ['ethan', 'HashMap uses hashCode to find the bucket and equals to compare keys inside it. If equal objects had different hash codes, get() would look in the wrong bucket.'],
          ['yusuf', "And the contract only goes one way: equal objects must have equal hash codes, but equal hash codes don't mean equal objects."],
        ],
        accepted: 0,
      },
      {
        by: 'zoe',
        kind: 'note',
        topic: 'Exams',
        title: 'My attempt at the practice midterm solutions',
        body: "Not official! Typed up my answers to the practice midterm. Tell me if you think something's wrong.",
        hoursAgo: 340,
        goats: 7,
        replies: [
          ['amara', 'Q5 should be O(log n), the loop halves i each time.'],
          ['zoe', "Oops, you're right, fixed."],
        ],
      },
      { by: 'yusuf', kind: 'question', topic: 'Assignments', title: 'A3: can our linked list keep a tail pointer?', body: "The starter code doesn't have one.", hoursAgo: 1 },
    ],
  },

  'COMP 273-001': {
    details: {
      by: 'david',
      professor: 'Prof. Victor Lam',
      email: 'victor.lam@mcgill.ca',
      officeHours: 'Tue 13:00–14:00, McConnell 107',
      location: 'Trottier 0100',
      daysAgo: 22,
    },
    times: { by: 'david', days: TR, start: '08:35', end: '09:55', location: 'Trottier 0100' },
    scheme: {
      by: 'david',
      items: [
        ['Assignment 1', 10, -18],
        ['Assignment 2', 10, 4],
        ['Assignment 3', 10, 24],
        ['Midterm', 25, -8],
        ['Final exam', 45, null],
      ],
    },
    links: [
      { by: 'sofia', url: 'https://discord.gg/demo-comp273-fall26', purpose: 'course', label: 'COMP 273', works: 3 },
      { by: 'leila', url: 'https://chat.whatsapp.com/DemoComp273Study', purpose: 'study-group', label: 'MIPS study group', works: 1 },
    ],
    sessions: [
      {
        by: 'david',
        title: 'A2 MIPS debugging',
        description: "Bring your .asm file. We'll step through it in MARS together.",
        tag: 'Assignment',
        where: 'Trottier 3120',
        inDays: 2,
        start: '18:00',
        hours: 2,
        capacity: 6,
        going: 6,
        waitlist: 1,
      },
      {
        by: 'sofia',
        title: 'Final review kickoff',
        description: 'Making a plan for the final: who summarizes which lectures.',
        tag: 'Final',
        where: 'https://mcgill.zoom.us/j/5550100273',
        online: true,
        inDays: 16,
        start: '19:00',
        hours: 1,
        capacity: 20,
        going: 5,
      },
    ],
    posts: [
      {
        by: 'alex',
        kind: 'question',
        topic: 'Assignments',
        title: "MARS keeps saying 'address out of range' on lw",
        body: "In A2 I load from an array with `lw $t1, 0($t0)` inside a loop and MARS throws 'address out of range 0x00000000'. I set $t0 with `la $t0, arr` before the loop.",
        hoursAgo: 22,
        replies: [
          ['david', "Check that nothing overwrites $t0 inside the loop. If you call a function, $t registers aren't preserved: save it on the stack or use an $s register."],
          ['alex', 'That was it, my print function clobbered $t0. Thanks!'],
        ],
        accepted: 0,
      },
      {
        by: 'david',
        kind: 'note',
        topic: 'Lectures',
        title: 'Single-cycle datapath, colour-coded',
        body: 'I redrew the datapath from lecture 11 with each instruction type in a different colour. It is in the Discord under #resources.',
        hoursAgo: 80,
        goats: 8,
        replies: [['leila', 'this is beautiful']],
      },
      {
        by: 'leila',
        kind: 'question',
        topic: 'Exams',
        title: 'Are midterm grades out?',
        body: 'Nothing on myCourses for me yet.',
        hoursAgo: 6,
        replies: [['david', 'Posted this morning, check the Grades tab. The average was 71%.']],
        accepted: 0,
      },
      {
        by: 'sofia',
        kind: 'question',
        topic: 'Lectures',
        title: "Quick way to spot two's complement overflow?",
        body: 'When adding two numbers, how do we tell quickly that it overflowed?',
        hoursAgo: 50,
        replies: [['alex', 'It can only overflow when both numbers have the same sign, and then it did if the result has the other sign.']],
        accepted: 0,
      },
    ],
  },

  'COMP 302-001': {
    details: {
      by: 'maya',
      professor: 'Prof. Isabelle Fournier',
      email: 'isabelle.fournier@mcgill.ca',
      officeHours: 'Thu 15:00–16:30, McConnell 104',
      location: 'Rutherford Physics 112',
      daysAgo: 16,
    },
    times: { by: 'maya', days: MWF, start: '14:35', end: '15:25', location: 'Rutherford Physics 112' },
    scheme: {
      by: 'kenji',
      items: [
        ['Homework (best 5 of 6)', 30, null],
        ['Midterm', 20, -6],
        ['Final exam', 50, null],
      ],
    },
    links: [{ by: 'kenji', url: 'https://discord.gg/demo-comp302-ocaml', purpose: 'study-group', label: 'OCaml help', works: 4 }],
    sessions: [
      {
        by: 'maya',
        title: 'HW5 help (unofficial office hours)',
        description: 'I can help with continuations and higher-order functions.',
        tag: 'Assignment',
        where: 'Trottier 3120',
        inDays: 3,
        start: '16:00',
        hours: 2,
        capacity: 10,
        going: 6,
      },
    ],
    posts: [
      {
        by: 'kenji',
        kind: 'question',
        topic: 'Assignments',
        title: 'My tail-recursive sum still overflows the stack',
        body: 'let rec sum acc = function [] -> acc | x :: xs -> x + sum acc xs. It still overflows on big lists. Why?',
        hoursAgo: 15,
        replies: [
          ['maya', "Your recursive call isn't in tail position: `x + sum acc xs` still has to add after the call returns. Try `sum (acc + x) xs`."],
          ['kenji', 'Ahh, that makes sense now.'],
        ],
        accepted: 0,
      },
      {
        by: 'maya',
        kind: 'note',
        topic: 'Lectures',
        title: 'Continuations finally clicked for me with this',
        body: 'A continuation is "what to do with the answer once you have it". Instead of returning, you hand the answer to k. Success and failure continuations are just two different "what to do next" functions.',
        hoursAgo: 55,
        goats: 6,
        replies: [
          ['arjun', 'This plus the tree example made it click, thank you'],
          ['alex', 'Saving this for the final'],
        ],
      },
      { by: 'arjun', kind: 'question', topic: 'Exams', title: 'Is lazy programming on the final?', body: 'We only had one lecture on it.', hoursAgo: 8 },
    ],
  },

  'COMP 303-001': {
    details: {
      by: 'fatima',
      professor: 'Prof. Thomas Brennan',
      email: 'thomas.brennan@mcgill.ca',
      officeHours: 'By appointment (email first)',
      location: 'Leacock 219',
      daysAgo: 10,
    },
    times: { by: 'fatima', days: TR, start: '13:05', end: '14:25', location: 'Leacock 219' },
    scheme: {
      by: 'priya',
      items: [
        ['Design exercises', 20, null],
        ['Project milestone 1', 15, -9],
        ['Project milestone 2', 15, 13],
        ['Final exam', 50, null],
      ],
    },
    links: [{ by: 'fatima', url: 'https://chat.whatsapp.com/DemoComp303Orbit', purpose: 'project', label: 'Team Orbit' }],
    sessions: [
      {
        by: 'fatima',
        title: 'Team Orbit: milestone 2 pomodoros',
        description: 'Four 25-minute rounds, then a demo to each other.',
        tag: 'Project',
        where: 'https://mcgill.zoom.us/j/5550100303',
        online: true,
        inDays: 1,
        start: '19:00',
        hours: 2,
        capacity: 4,
        going: 4,
        inviteCode: 'ORBIT3',
      },
    ],
    posts: [
      {
        by: 'priya',
        kind: 'question',
        topic: 'Assignments',
        title: 'How detailed should the UML for milestone 2 be?',
        body: 'Every class and method, or just the main ones?',
        hoursAgo: 12,
        replies: [['fatima', 'Our TA said class diagrams with the key methods only, no getters and setters.']],
        accepted: 0,
      },
      {
        by: 'fatima',
        kind: 'note',
        topic: 'Off-topic',
        title: 'Looking for one more teammate for the project',
        body: "We're three people building a JavaFX study planner and looking for a fourth. Reply here if you're interested!",
        hoursAgo: 120,
        replies: [
          ['lucas', "Still looking? I'm in!"],
          ['fatima', 'Yes! Sending you the code for our session.'],
        ],
      },
      {
        by: 'lucas',
        kind: 'question',
        topic: 'Lectures',
        title: 'Strategy vs State pattern?',
        body: 'The class diagrams look identical to me.',
        hoursAgo: 30,
        goats: 2,
        replies: [['priya', 'Same structure, different intent: with Strategy the caller picks an algorithm; with State the object switches its own behaviour as its state changes.']],
        accepted: 0,
      },
    ],
  },

  'COMP 421-001': {
    details: {
      by: 'david',
      professor: 'Prof. Laila Rahimi',
      email: 'laila.rahimi@mcgill.ca',
      officeHours: 'Mon 11:00–12:00, McConnell 202',
      location: 'Trottier 0060',
      daysAgo: 30,
    },
    times: { by: 'david', days: TR, start: '16:05', end: '17:25', location: 'Trottier 0060' },
    scheme: {
      by: 'arjun',
      items: [
        ['Project deliverable 1', 10, -14],
        ['Project deliverable 2', 10, 3],
        ['Project deliverable 3', 15, 25],
        ['Midterm', 25, -4],
        ['Final exam', 40, null],
      ],
    },
    sessions: [
      {
        by: 'david',
        title: 'Deliverable 2 SQL review',
        description: "Checking each other's queries before we submit.",
        tag: 'Project',
        where: 'https://mcgill.zoom.us/j/5550100421',
        online: true,
        inDays: 2,
        start: '20:00',
        hours: 1.5,
        capacity: 6,
        going: 3,
      },
    ],
    posts: [
      {
        by: 'arjun',
        kind: 'question',
        topic: 'Assignments',
        title: 'Can we use a trigger for the deliverable 2 constraint?',
        body: "Our constraint spans two tables, so a CHECK won't work.",
        hoursAgo: 10,
        replies: [['david', "Yes, as long as you explain in the report why a CHECK constraint can't do it."]],
        accepted: 0,
      },
      {
        by: 'david',
        kind: 'note',
        topic: 'Lectures',
        title: 'BCNF decomposition, step by step',
        body: 'Wrote out the decomposition example from lecture with the attribute closures at every step.',
        hoursAgo: 70,
        goats: 4,
        replies: [['arjun', 'The closure table made it make sense, thanks']],
      },
    ],
  },

  'COMP 551-001': {
    details: {
      by: 'maya',
      professor: 'Prof. Mehdi Alavi',
      email: 'mehdi.alavi@mcgill.ca',
      officeHours: 'Fri 14:00–15:00, McConnell 108',
      location: 'Strathcona Anatomy M-1',
      daysAgo: 9,
    },
    times: { by: 'maya', days: TR, start: '11:35', end: '12:55', location: 'Strathcona Anatomy M-1' },
    scheme: {
      by: 'sofia',
      items: [
        ['Mini-project 1', 15, -16],
        ['Mini-project 2', 15, 1],
        ['Mini-project 3', 15, 20],
        ['Quizzes', 10, null],
        ['Midterm', 20, 8],
        ['Final exam', 25, null],
      ],
    },
    sessions: [
      {
        by: 'maya',
        title: 'Mini-project 2 report writing',
        description: 'Quiet writing session, then we swap reports for feedback.',
        tag: 'Project',
        where: 'Schulich Library, group room 2B',
        inDays: 0,
        start: '19:00',
        hours: 2,
        capacity: 6,
        going: 4,
      },
    ],
    posts: [
      {
        by: 'sofia',
        kind: 'question',
        topic: 'Assignments',
        title: 'Logistic regression accuracy stuck at 50%',
        body: 'Mini-project 2: our model predicts the same class for everything. Gradient descent runs, the loss barely moves.',
        hoursAgo: 16,
        replies: [
          ['maya', 'Are you normalizing the features? With raw pixel values and a fixed learning rate it can just stall.'],
          ['sofia', 'That plus a smaller learning rate fixed it, 88% now!'],
        ],
        accepted: 0,
      },
      {
        by: 'maya',
        kind: 'note',
        topic: 'Logistics',
        title: 'Group formation spreadsheet for mini-project 3',
        body: "If you still need a group of 3, add your name and what you'd like to work on to the sheet pinned in the course Discord.",
        hoursAgo: 200,
        goats: 3,
      },
    ],
  },

  'MATH 240-001': {
    details: {
      by: 'samuel',
      professor: 'Prof. Olivier Bastien',
      email: 'olivier.bastien@mcgill.ca',
      officeHours: 'Wed 14:30–16:00, Burnside 1005',
      location: 'Leacock 232',
      daysAgo: 14,
    },
    times: { by: 'samuel', days: MWF, start: '09:35', end: '10:25', location: 'Leacock 232' },
    scheme: {
      by: 'gabriel',
      items: [
        ['Assignment 1', 5, -28],
        ['Assignment 2', 5, -14],
        ['Assignment 3', 5, 1],
        ['Assignment 4', 5, 15],
        ['Midterm', 25, -10],
        ['Final exam', 55, null],
      ],
    },
    deadlines: [{ by: 'samuel', kind: 'quiz', title: 'WeBWorK 7 (counting)', inDays: 3, time: '23:00' }],
    links: [{ by: 'zoe', url: 'https://chat.whatsapp.com/DemoMath240Fall26', purpose: 'course', label: 'MATH 240 Fall 2026', works: 4 }],
    sessions: [
      {
        by: 'gabriel',
        title: 'Assignment 3 problem session',
        description: 'We each present one problem. Induction and counting.',
        tag: 'Assignment',
        where: 'Burnside 1B23',
        inDays: 0,
        start: '17:00',
        hours: 2,
        capacity: 8,
        going: 5,
      },
    ],
    posts: [
      {
        by: 'samuel',
        kind: 'note',
        topic: 'Lectures',
        title: 'Strong vs weak induction: when to use which',
        body: 'Rule of thumb from tutorial: if proving P(n) only needs P(n−1), weak induction. If you need some smaller case you cannot pin down (like in the prime factorization proof), strong induction.',
        hoursAgo: 40,
        goats: 7,
        replies: [
          ['gabriel', 'Also: strong induction often needs more base cases. Check the smallest n where the inductive step actually works.'],
          ['alex', 'this saved my A3 Q2'],
        ],
      },
      {
        by: 'gabriel',
        kind: 'question',
        topic: 'Assignments',
        title: 'A3 Q4: is a graph with one vertex connected?',
        body: 'Feels like a trick question.',
        hoursAgo: 11,
        replies: [['samuel', "By the course notes' convention, yes: a single vertex is connected. The question only uses n ≥ 1, so you don't need to worry about the empty graph."]],
        accepted: 0,
      },
      { by: 'zoe', kind: 'question', topic: 'Exams', title: 'Good pigeonhole problems for practice?', body: 'The textbook ones feel too easy compared to the midterm.', hoursAgo: 3 },
      {
        by: 'alex',
        kind: 'question',
        topic: 'Lectures',
        title: 'Why is the number of derangements about n!/e?',
        body: "It came up at the end of Friday's lecture without an explanation.",
        hoursAgo: 64,
        goats: 2,
        replies: [['samuel', 'Inclusion–exclusion gives D(n) = n! Σ (−1)^k / k!, and that sum is the Taylor series of e^(−1) cut off at n.']],
        accepted: 0,
      },
    ],
  },

  'MATH 133-001': {
    details: {
      by: 'lily',
      professor: 'Prof. Sophie Lambert',
      email: 'sophie.lambert@mcgill.ca',
      officeHours: 'Mon 13:00–14:00, Burnside 1123',
      location: 'Leacock 132',
      daysAgo: 19,
    },
    times: { by: 'lily', days: MWF, start: '08:35', end: '09:25', location: 'Leacock 132' },
    scheme: {
      by: 'nadia',
      items: [
        ['WeBWorK', 10, null],
        ['Written assignments', 10, null],
        ['Midterm', 25, -7],
        ['Final exam', 55, null],
      ],
    },
    links: [{ by: 'owen', url: 'https://chat.whatsapp.com/DemoMath133Fall26', purpose: 'course', label: 'MATH 133', works: 6 }],
    sessions: [
      {
        by: 'nadia',
        title: 'WeBWorK 8 together',
        description: 'Eigenvalues and diagonalization.',
        tag: 'Assignment',
        where: 'Burnside 1B36',
        inDays: 1,
        start: '15:00',
        hours: 1.5,
        capacity: 8,
        going: 5,
      },
    ],
    posts: [
      {
        by: 'nadia',
        kind: 'question',
        topic: 'Lectures',
        title: 'When is a set of vectors a basis?',
        body: 'I keep mixing up spanning and independence.',
        hoursAgo: 20,
        replies: [['lily', 'It has to span the space and be linearly independent. In Rⁿ that means exactly n independent vectors.']],
        accepted: 0,
      },
      {
        by: 'owen',
        kind: 'question',
        topic: 'Exams',
        title: 'Will we get a formula sheet for the final?',
        body: 'There was none for the midterm.',
        hoursAgo: 26,
        replies: [['nadia', 'No formula sheet for the final either, it says so in the outline.']],
        accepted: 0,
      },
      {
        by: 'lily',
        kind: 'note',
        topic: 'Lectures',
        title: 'Row reduction checklist',
        body: '1. Leftmost non-zero column. 2. Swap a non-zero entry to the top. 3. Scale to get a leading 1. 4. Zero out everything below. Repeat on the rows below, then go back up for reduced form.',
        hoursAgo: 100,
        goats: 5,
      },
    ],
  },

  'MATH 140-001': {
    details: {
      by: 'camille',
      professor: 'Prof. Jean-François Ouimet',
      email: 'jf.ouimet@mcgill.ca',
      officeHours: 'Thu 13:00–14:30, Burnside 1220',
      location: 'Leacock 132',
      daysAgo: 21,
    },
    times: { by: 'camille', days: MWF, start: '11:35', end: '12:25', location: 'Leacock 132' },
    scheme: {
      by: 'william',
      items: [
        ['WeBWorK', 10, null],
        ['Midterm', 25, -12],
        ['Final exam', 65, null],
      ],
    },
    links: [{ by: 'camille', url: 'https://discord.gg/demo-math140-fall26', purpose: 'course', label: 'Calc 1 Discord', works: 6 }],
    sessions: [
      {
        by: 'william',
        title: 'Calc 1 problem-solving night',
        description: 'Related rates and optimization. Everyone brings one problem they found hard.',
        tag: 'Review',
        where: 'https://mcgill.zoom.us/j/5550100140',
        online: true,
        inDays: 4,
        start: '19:00',
        hours: 2,
        capacity: 15,
        going: 6,
      },
    ],
    posts: [
      {
        by: 'sarah',
        kind: 'question',
        topic: 'Lectures',
        title: "Is L'Hôpital's rule allowed on the final?",
        body: 'Some of the practice questions solve limits without it.',
        hoursAgo: 6,
        replies: [['william', "Only where the question doesn't say \"without L'Hôpital\". The prof said limits in part A have to be done with algebra."]],
        accepted: 0,
      },
      {
        by: 'william',
        kind: 'question',
        topic: 'Assignments',
        title: 'WeBWorK says my derivative is wrong but it matches Wolfram',
        body: 'I typed sin^2(x)*cos(x) and it marks it wrong.',
        hoursAgo: 29,
        replies: [
          ['camille', 'WeBWorK is picky: write (sin(x))^2*cos(x), with the parentheses and the *.'],
          ['william', 'Parentheses. It was the parentheses.'],
        ],
        accepted: 0,
      },
      {
        by: 'grace',
        kind: 'note',
        topic: 'Exams',
        title: 'Past finals with solutions',
        body: 'The Math and Stats department website has past MATH 140 finals with solutions going back to 2015.',
        hoursAgo: 80,
        goats: 9,
      },
    ],
  },

  'MATH 141-001': {
    times: { by: 'ethan', days: TR, start: '08:35', end: '09:55', location: 'Leacock 132' },
    posts: [
      {
        by: 'ethan',
        kind: 'question',
        topic: 'Lectures',
        title: 'Integration by parts: how do I choose u?',
        body: 'I always pick the wrong one and the integral gets worse.',
        hoursAgo: 13,
        replies: [['amara', 'LIATE: logs, inverse trig, algebraic, trig, exponential. Pick u from whichever comes first in that list.']],
        accepted: 0,
      },
      { by: 'ben', kind: 'question', topic: 'Exams', title: 'Which series tests do we need to know?', body: 'Ratio, root, comparison, integral... all of them?', hoursAgo: 4 },
    ],
  },

  'MATH 222-001': {
    times: { by: 'priya', days: MWF, start: '08:35', end: '09:25', location: 'Burnside 1B45' },
    scheme: {
      by: 'olivia',
      items: [
        ['WeBWorK', 10, null],
        ['Midterm', 30, -9],
        ['Final exam', 60, null],
      ],
    },
    posts: [
      {
        by: 'olivia',
        kind: 'question',
        topic: 'Lectures',
        title: 'Lagrange multipliers with two constraints?',
        body: 'Do we just add a second λ?',
        hoursAgo: 21,
        replies: [['priya', 'Yes: ∇f = λ∇g + μ∇h, plus both constraint equations. Five equations, five unknowns in 3D.']],
        accepted: 0,
      },
    ],
  },

  'MATH 223-001': {
    times: { by: 'clara', days: TR, start: '16:05', end: '17:25', location: 'Burnside 1B23' },
    posts: [
      {
        by: 'clara',
        kind: 'question',
        topic: 'Lectures',
        title: 'Intuition for the Jordan normal form?',
        body: 'The algorithm makes sense but I have no idea what it means.',
        hoursAgo: 35,
        replies: [['gabriel', 'Think of it as "as diagonal as possible": each block is an eigenvalue plus a nilpotent part that shifts vectors along a chain.']],
        accepted: 0,
      },
    ],
  },

  'MATH 235-001': {
    times: { by: 'samuel', days: TR, start: '13:05', end: '14:25', location: 'Burnside 1B36' },
    posts: [
      {
        by: 'samuel',
        kind: 'note',
        topic: 'Exams',
        title: 'Group theory flashcards',
        body: 'Made flashcards for every definition and theorem up to quotient groups. The link is in my reply below.',
        hoursAgo: 45,
        goats: 4,
        replies: [['samuel', 'They are in the MATH 240 WhatsApp too, since half of us are in both.']],
      },
      {
        by: 'zoe',
        kind: 'question',
        topic: 'Assignments',
        title: 'Is every group of order 4 abelian?',
        body: 'Trying to avoid listing all the multiplication tables.',
        hoursAgo: 7,
        replies: [['samuel', "Yes: it's either cyclic (ℤ/4) or the Klein four-group, and both are abelian. Look at the possible orders of elements."]],
        accepted: 0,
      },
    ],
  },

  'MATH 323-001': {
    details: {
      by: 'rohan',
      professor: 'Prof. Natalia Ivanova',
      email: 'natalia.ivanova@mcgill.ca',
      officeHours: 'Tue 15:30–17:00, Burnside 1025',
      location: 'Burnside 1B45',
      daysAgo: 11,
    },
    times: { by: 'rohan', days: MWF, start: '12:35', end: '13:25', location: 'Burnside 1B45' },
    scheme: {
      by: 'rohan',
      items: [
        ['Assignment 1', 5, -20],
        ['Assignment 2', 5, -6],
        ['Assignment 3', 5, 8],
        ['Assignment 4', 5, 22],
        ['Midterm', 30, -11],
        ['Final exam', 50, null],
      ],
    },
    sessions: [
      {
        by: 'rohan',
        title: 'Probability problem marathon',
        description: 'Three hours, twenty problems, snacks provided.',
        tag: 'Review',
        where: 'Burnside 1B39',
        inDays: 3,
        start: '14:00',
        hours: 3,
        capacity: 10,
        going: 4,
      },
    ],
    posts: [
      {
        by: 'rohan',
        kind: 'question',
        topic: 'Assignments',
        title: 'A3 Q2: Poisson approximation or the exact binomial?',
        body: 'n = 200, p = 0.01. The question says "approximately".',
        hoursAgo: 9,
        replies: [['samuel', 'It says approximate, so Poisson with λ = np = 2. Give the exact value too if you want to show they match.']],
        accepted: 0,
      },
      {
        by: 'alex',
        kind: 'note',
        topic: 'Exams',
        title: "Formula sheet I'm making for the final",
        body: 'Distributions, means and variances, plus the conditional expectation identities. Will keep adding to it.',
        hoursAgo: 30,
        goats: 6,
        replies: [
          ['rohan', 'Can you add the moment generating functions table?'],
          ['alex', 'Done!'],
        ],
      },
      {
        by: 'clara',
        kind: 'question',
        topic: 'Lectures',
        title: 'Why do variances only add for independent variables?',
        body: 'Var(X + Y) = Var X + Var Y only works sometimes?',
        hoursAgo: 50,
        replies: [['gabriel', 'Var(X+Y) = Var X + Var Y + 2 Cov(X, Y). The covariance is 0 when they are independent (being uncorrelated is actually enough).']],
        accepted: 0,
      },
    ],
  },

  'MATH 324-001': {
    times: { by: 'gabriel', days: TR, start: '14:35', end: '15:55', location: 'Burnside 1205' },
    posts: [
      {
        by: 'gabriel',
        kind: 'question',
        topic: 'Lectures',
        title: 'Unbiased vs consistent estimators',
        body: 'Can an estimator be consistent but biased?',
        hoursAgo: 19,
        replies: [['samuel', 'Yes. The MLE of the variance divides by n, so it is biased, but the bias goes to 0 and it is consistent.']],
        accepted: 0,
      },
    ],
  },

  'ECSE 222-001': {
    details: {
      by: 'olivia',
      professor: 'Prof. Ahmed Farouk',
      email: 'ahmed.farouk@mcgill.ca',
      officeHours: 'Wed 11:30–12:30, McConnell 603',
      location: 'McConnell 204',
      daysAgo: 17,
    },
    times: { by: 'olivia', days: MWF, start: '10:35', end: '11:25', location: 'McConnell 204' },
    scheme: {
      by: 'tomas',
      items: [
        ['Lab 1', 5, -25],
        ['Lab 2', 5, -11],
        ['Lab 3', 5, 3],
        ['Lab 4', 10, 17],
        ['Midterm', 25, -9],
        ['Final exam', 50, null],
      ],
    },
    deadlines: [{ by: 'olivia', kind: 'quiz', title: 'Lab 3 pre-lab quiz', inDays: 2, time: '09:00' }],
    links: [
      { by: 'tomas', url: 'https://discord.gg/demo-ecse222-fall26', purpose: 'course', label: 'ECSE 222', works: 5 },
      { by: 'lucas', url: 'https://chat.whatsapp.com/DemoEcse222Lab4', purpose: 'study-group', label: 'Lab partners (section 4)' },
    ],
    sessions: [
      {
        by: 'olivia',
        title: 'Lab 3 prep: VHDL state machines',
        description: 'Writing the FSM for lab 3 before our lab slot.',
        tag: 'Lab',
        where: 'McConnell 13',
        inDays: 1,
        start: '17:00',
        hours: 2,
        capacity: 6,
        going: 4,
      },
      {
        by: 'tomas',
        title: 'Midterm debrief',
        description: 'Comparing answers.',
        tag: 'Midterm',
        where: 'McConnell 13',
        inDays: -6,
        start: '16:00',
        hours: 1,
        capacity: 8,
        going: 5,
      },
    ],
    posts: [
      {
        by: 'lucas',
        kind: 'question',
        topic: 'Labs and tutorials',
        title: "VHDL: 'signal is not declared', but it is",
        body: "Quartus says my signal count_next is not declared even though it's in the architecture. It's used inside a process.",
        hoursAgo: 17,
        replies: [
          ['olivia', "Is it declared between \"architecture … is\" and \"begin\"? If it's after begin, Quartus complains."],
          ['lucas', 'It was after begin 🤦 thanks'],
        ],
        accepted: 0,
      },
      {
        by: 'priya',
        kind: 'question',
        topic: 'Labs and tutorials',
        title: 'Which lab section has free DE1-SoC boards on Fridays?',
        body: 'I want to finish lab 3 early.',
        hoursAgo: 5,
        replies: [['tomas', 'Friday afternoon (section 4) usually has a few free boards after 15:00.']],
      },
      {
        by: 'tomas',
        kind: 'note',
        topic: 'Lectures',
        title: 'K-map practice generator',
        body: 'I made a little page that generates random 4-variable K-maps with solutions. Link is in the course Discord.',
        hoursAgo: 95,
        goats: 10,
      },
    ],
  },

  'ECSE 205-001': {
    details: {
      by: 'fatima',
      professor: 'Prof. Rebecca Holt',
      email: 'rebecca.holt@mcgill.ca',
      officeHours: 'Thu 09:30–10:30, McConnell 541',
      location: 'Rutherford Physics 112',
      daysAgo: 13,
    },
    times: { by: 'fatima', days: MWF, start: '13:35', end: '14:25', location: 'Rutherford Physics 112' },
    scheme: {
      by: 'priya',
      items: [
        ['Assignments', 20, null],
        ['Midterm', 30, -3],
        ['Final exam', 50, null],
      ],
    },
    posts: [
      { by: 'hana', kind: 'question', topic: 'Exams', title: 'Do we know the midterm average yet?', body: 'Just curious how it went for everyone.', hoursAgo: 2 },
      {
        by: 'priya',
        kind: 'note',
        topic: 'Lectures',
        title: "Bayes' theorem examples from tutorial",
        body: 'Typed up the three examples from Thursday: the medical test, the spam filter and the faulty machines.',
        hoursAgo: 48,
        goats: 5,
        replies: [['ethan', 'Thanks Priya, the medical test one finally clicked']],
      },
      {
        by: 'fatima',
        kind: 'question',
        topic: 'Assignments',
        title: 'Assignment 3 Q5: P(A | B) or P(B | A)?',
        body: 'The wording confuses me: "the probability that a part is defective given it failed the test".',
        hoursAgo: 21,
        replies: [['priya', "That's P(defective | failed). You know P(failed | defective) from the question, so it's Bayes."]],
        accepted: 0,
      },
    ],
  },

  'ECSE 200-001': {
    times: { by: 'amara', days: TR, start: '08:35', end: '09:55', location: 'McConnell 204' },
    posts: [
      {
        by: 'amara',
        kind: 'question',
        topic: 'Assignments',
        title: 'Thevenin equivalent with a dependent source?',
        body: "Can't just short the sources like usual.",
        hoursAgo: 23,
        replies: [['tomas', 'Turn off only the independent sources, then put a test voltage across the terminals and compute V/I.']],
        accepted: 0,
      },
    ],
  },

  'PHYS 131-001': {
    details: {
      by: 'mia',
      professor: 'Prof. Martin Gauthier',
      email: 'martin.gauthier@mcgill.ca',
      officeHours: 'Fri 10:00–11:00, Rutherford Physics 225',
      location: 'Rutherford Physics 112',
      daysAgo: 24,
    },
    times: { by: 'mia', days: TR, start: '11:35', end: '12:55', location: 'Rutherford Physics 112' },
    scheme: {
      by: 'felix',
      items: [
        ['Labs', 15, null],
        ['Assignments', 15, null],
        ['Midterm', 25, -15],
        ['Final exam', 45, null],
      ],
    },
    links: [{ by: 'felix', url: 'https://chat.whatsapp.com/DemoPhys131Fall26', purpose: 'course', label: 'PHYS 131', works: 4 }],
    sessions: [
      {
        by: 'mia',
        title: 'Lab report writing session',
        description: 'Uncertainty propagation and graphs for lab 4.',
        tag: 'Lab',
        where: 'Schulich Library, group room 3A',
        inDays: 2,
        start: '13:00',
        hours: 2,
        capacity: 6,
        going: 3,
      },
    ],
    posts: [
      {
        by: 'felix',
        kind: 'question',
        topic: 'Labs and tutorials',
        title: 'How many significant figures in the lab report?',
        body: 'My calculator gives 9.8164 m/s².',
        hoursAgo: 19,
        replies: [['mia', 'Match your uncertainty: if it is ±0.02, report two decimals, so 9.82 ± 0.02 m/s².']],
        accepted: 0,
      },
      {
        by: 'mia',
        kind: 'question',
        topic: 'Lectures',
        title: "Why doesn't the normal force do work on an incline?",
        body: 'It pushes on the block the whole way down.',
        hoursAgo: 38,
        replies: [['owen', "It's always perpendicular to the displacement, so F · d = 0."]],
        accepted: 0,
      },
      {
        by: 'julien',
        kind: 'note',
        topic: 'Exams',
        title: 'Kinematics summary sheet',
        body: 'One page with the constant-acceleration equations, projectile motion and relative velocity.',
        hoursAgo: 110,
        goats: 6,
      },
    ],
  },

  'CHEM 110-001': {
    times: { by: 'aisha', days: MWF, start: '15:35', end: '16:25', location: 'Otto Maass 112' },
    scheme: {
      by: 'aisha',
      items: [
        ['Labs', 20, null],
        ['Online quizzes', 10, null],
        ['Midterm', 25, -10],
        ['Final exam', 45, null],
      ],
    },
    deadlines: [{ by: 'aisha', kind: 'quiz', title: 'Online quiz 6 (thermochemistry)', inDays: 4, time: '23:59' }],
    posts: [
      {
        by: 'aisha',
        kind: 'question',
        topic: 'Labs and tutorials',
        title: 'Do we need to bring our own goggles?',
        body: 'First lab is next week.',
        hoursAgo: 30,
        replies: [['nadia', "Yes, buy them at the bookstore. The lab doesn't lend them."]],
        accepted: 0,
      },
      {
        by: 'lily',
        kind: 'question',
        topic: 'Lectures',
        title: 'Hybridization of the carbon in CO₂?',
        body: 'Is it sp or sp²?',
        hoursAgo: 12,
        replies: [['ben', 'sp: two electron domains around the carbon (two double bonds), so it is linear.']],
        accepted: 0,
      },
      { by: 'owen', kind: 'note', topic: 'Logistics', title: 'Lab safety quiz has to be done before your first lab', body: "It's on myCourses, 10 questions.", hoursAgo: 70 },
    ],
  },

  'BIOL 112-001': {
    posts: [
      {
        by: 'nadia',
        kind: 'question',
        topic: 'Logistics',
        title: 'Is the textbook required?',
        body: 'It is $180 at the bookstore.',
        hoursAgo: 58,
        replies: [['mia', 'The library has two copies on reserve, and the older edition is fine.']],
        accepted: 0,
      },
    ],
  },

  'ECON 208-001': {
    details: {
      by: 'daniel',
      professor: 'Prof. Diane Archambault',
      email: 'diane.archambault@mcgill.ca',
      officeHours: 'Tue 10:00–11:30, Leacock 443',
      location: 'Leacock 132',
      daysAgo: 23,
    },
    times: { by: 'daniel', days: TR, start: '14:35', end: '15:55', location: 'Leacock 132' },
    scheme: {
      by: 'sarah',
      items: [
        ['Problem sets', 10, null],
        ['Midterm 1', 20, -20],
        ['Midterm 2', 20, 10],
        ['Final exam', 50, null],
      ],
    },
    links: [{ by: 'daniel', url: 'https://chat.whatsapp.com/DemoEcon208Fall26', purpose: 'course', label: 'ECON 208', works: 7 }],
    sessions: [
      {
        by: 'elena',
        title: 'Midterm 2 review',
        description: 'Chapters 6–10. We go through the practice midterm question by question.',
        tag: 'Midterm',
        where: 'McLennan Library, 4th floor group room',
        inDays: 7,
        start: '16:00',
        hours: 2,
        capacity: 8,
        going: 5,
      },
    ],
    posts: [
      {
        by: 'daniel',
        kind: 'question',
        topic: 'Lectures',
        title: 'Why does elasticity change along a straight demand curve?',
        body: 'The slope is constant, so I expected elasticity to be too.',
        hoursAgo: 34,
        replies: [['elena', 'Elasticity is (ΔQ/Q) / (ΔP/P). On a straight line the slope is constant but P/Q changes, so elasticity changes.']],
        accepted: 0,
      },
      {
        by: 'sarah',
        kind: 'note',
        topic: 'Exams',
        title: 'What Midterm 2 covers',
        body: 'From the announcement: chapters 6–10, nothing on consumer theory from chapter 5.',
        hoursAgo: 22,
        goats: 8,
        replies: [
          ['kofi', 'Thanks! Did she say anything about graphs?'],
          ['sarah', 'Bring a ruler, there are graphing questions.'],
        ],
      },
      {
        by: 'theo',
        kind: 'question',
        topic: 'Off-topic',
        title: 'Anyone selling the textbook?',
        body: 'Any edition from the last five years.',
        hoursAgo: 60,
        replies: [['william', 'I have a used copy, message me on the WhatsApp.']],
        accepted: 0,
      },
    ],
  },

  'PSYC 100-001': {
    details: {
      by: 'grace',
      professor: 'Prof. Hannah Weiss',
      email: 'hannah.weiss@mcgill.ca',
      officeHours: 'Mon 14:00–15:00, Stewart Biology N7/12',
      location: 'Leacock 132',
      daysAgo: 27,
    },
    times: { by: 'grace', days: TR, start: '16:05', end: '17:25', location: 'Leacock 132' },
    scheme: {
      by: 'theo',
      items: [
        ['Quizzes', 20, null],
        ['Midterm', 35, -2],
        ['Final exam', 45, null],
      ],
    },
    links: [{ by: 'grace', url: 'https://chat.whatsapp.com/DemoPsyc100Fall26', purpose: 'course', label: 'PSYC 100', works: 5 }],
    posts: [
      {
        by: 'grace',
        kind: 'question',
        topic: 'Exams',
        title: 'Is the midterm all multiple choice?',
        body: 'And how long is it?',
        hoursAgo: 50,
        replies: [['camille', 'Yes, 60 multiple-choice questions in 75 minutes.']],
        accepted: 0,
      },
      {
        by: 'theo',
        kind: 'note',
        topic: 'Lectures',
        title: 'Mnemonic for the brain lobes',
        body: 'Frontal = Future planning, Parietal = Position and touch, Occipital = Optics, Temporal = Tunes (hearing) and memory.',
        hoursAgo: 24,
        goats: 12,
      },
      { by: 'elena', kind: 'question', topic: 'Logistics', title: 'Deadline for research participation credits?', body: "Can't find it in the syllabus.", hoursAgo: 4 },
    ],
  },

  'MGCR 211-001': {
    times: { by: 'daniel', days: MWF, start: '13:35', end: '14:25', location: 'Bronfman 46' },
    sessions: [
      {
        by: 'daniel',
        title: 'Accounting cycle practice',
        description: 'Journal entries to trial balance, start to finish.',
        tag: 'Review',
        where: 'Bronfman 245',
        inDays: 3,
        start: '17:30',
        hours: 1.5,
        capacity: 6,
        going: 3,
      },
    ],
    posts: [
      {
        by: 'william',
        kind: 'question',
        topic: 'Assignments',
        title: 'Debits and credits always confuse me',
        body: 'Is there a rule that always works?',
        hoursAgo: 27,
        replies: [['daniel', 'Assets and expenses go up with debits; liabilities, equity and revenue go up with credits.']],
        accepted: 0,
      },
    ],
  },
};

// What the three sign-in accounts keep for themselves: past courses (A1), a program (A2),
// marks (A4), notes and target grades (A5), plans (ST2), to-dos (ST3) and private deadlines.
export interface CoreSeed {
  program: string;
  // ST2: free study minutes per weekday, Sunday first.
  weekly: number[];
  records: [code: string, term: string, grade: string | null][];
  planned: string[];
  marks: Record<string, Record<string, number>>;
  notes: Record<string, [target: string, notes: string]>;
  // `follows` names the section's graded item the plan was made from; it takes that due date.
  plans: { section: string; title: string; follows?: string; inDays: number; notes: string; tasks: [title: string, minutes: number][]; done?: number }[];
  todos: [title: string, inDays: number | null, section: string | null, done?: boolean][];
  privateDeadlines: { kind: 'assignment' | 'exam' | 'quiz' | 'other'; title: string; inDays: number; time: string; notes: string }[];
}

export const CORE: Record<Who, CoreSeed> = {
  alex: {
    program: 'computer-science-major-b-sc',
    weekly: [240, 150, 120, 150, 120, 60, 240],
    records: [
      ['COMP 202', 'Fall 2025', 'A'],
      ['MATH 133', 'Fall 2025', 'A-'],
      ['MATH 140', 'Fall 2025', 'B+'],
      ['PHYS 131', 'Fall 2025', 'B'],
      ['PSYC 100', 'Fall 2025', 'A'],
      ['COMP 206', 'Winter 2026', 'B+'],
      ['COMP 250', 'Winter 2026', 'A-'],
      ['MATH 141', 'Winter 2026', 'B'],
      ['ECON 208', 'Winter 2026', 'A-'],
    ],
    planned: ['COMP 303', 'COMP 330', 'COMP 421'],
    marks: {
      'COMP 251-001': { 'Assignment 1': 88 },
      'COMP 273-001': { 'Assignment 1': 82, Midterm: 74 },
      'COMP 302-001': { Midterm: 81 },
      'MATH 240-001': { 'Assignment 1': 95, 'Assignment 2': 90, Midterm: 86 },
      'MATH 323-001': { 'Assignment 1': 100, 'Assignment 2': 85, Midterm: 78 },
    },
    notes: {
      'COMP 251-001': ['A-', 'TA office hours Fri 14:00. Midterm cheat sheet: one page, both sides.'],
      'COMP 273-001': ['B+', 'Bring the green sheet to the final.'],
      'MATH 323-001': ['A', ''],
    },
    plans: [
      {
        section: 'COMP 251-001',
        title: 'COMP 251 Assignment 2',
        follows: 'Assignment 2',
        inDays: 5,
        notes: 'Greedy proofs and MSTs. Check the A2 Q3 thread on the board.',
        tasks: [
          ['Q1: recurrences', 45],
          ['Q2: greedy exchange argument', 60],
          ['Q3: MST algorithm and proof', 60],
          ['Q4: dynamic programming', 90],
          ['Write up and proofread', 30],
        ],
        done: 1,
      },
      {
        section: 'COMP 273-001',
        title: 'COMP 273 Assignment 2 (MIPS)',
        follows: 'Assignment 2',
        inDays: 4,
        notes: '',
        tasks: [
          ['Read the handout and starter code', 20],
          ['Part 1: string functions', 60],
          ['Part 2: recursion', 60],
          ['Test in MARS', 40],
        ],
      },
    ],
    todos: [
      ['Email the TA about my A1 regrade', 0, 'COMP 251-001'],
      ['Print the MATH 240 practice midterm', -1, 'MATH 240-001', true],
      ['Book a Schulich room for Sunday', 2, null],
      ['Renew library books', null, null],
      ['Finish WeBWorK 7', 3, 'MATH 240-001'],
      ['Buy a green sheet for COMP 273', -3, 'COMP 273-001', true],
    ],
    privateDeadlines: [
      { kind: 'other', title: 'Summer internship application (Shopify)', inDays: 14, time: '17:00', notes: 'CV + cover letter + transcript.' },
      { kind: 'other', title: 'Residence housing deposit', inDays: 20, time: '23:59', notes: '' },
    ],
  },
  priya: {
    program: 'software-engineering-major-b-sc',
    weekly: [240, 150, 180, 150, 180, 90, 240],
    records: [
      ['MATH 133', 'Fall 2025', 'A'],
      ['MATH 140', 'Fall 2025', 'A'],
      ['PHYS 131', 'Fall 2025', 'A-'],
      ['CHEM 110', 'Fall 2025', 'B+'],
      ['ECSE 202', 'Fall 2025', 'A-'],
      ['COMP 250', 'Winter 2026', 'A'],
      ['COMP 206', 'Winter 2026', 'A'],
      ['MATH 141', 'Winter 2026', 'A-'],
      ['PHYS 142', 'Winter 2026', 'B+'],
      ['ECSE 200', 'Winter 2026', 'B+'],
    ],
    planned: ['COMP 302', 'MATH 240', 'COMP 421'],
    marks: {
      'COMP 251-001': { 'Assignment 1': 94 },
      'COMP 303-001': { 'Project milestone 1': 91 },
      'ECSE 222-001': { 'Lab 1': 100, 'Lab 2': 92, Midterm: 84 },
      'ECSE 205-001': { Midterm: 89 },
      'MATH 222-001': { Midterm: 77 },
    },
    notes: {
      'COMP 303-001': ['A', 'Team Orbit: Fatima, Lucas, me. Stand-up Tuesdays after class.'],
      'ECSE 222-001': ['A', 'Lab section 4, Fridays.'],
    },
    plans: [
      {
        section: 'ECSE 222-001',
        title: 'Lab 3 report',
        follows: 'Lab 3',
        inDays: 3,
        notes: 'FSM diagram, VHDL listing, simulation screenshots.',
        tasks: [
          ['Draw the state diagram', 30],
          ['Write the VHDL', 75],
          ['Simulate in ModelSim', 45],
          ['Write the report', 45],
        ],
        done: 1,
      },
      {
        section: 'COMP 303-001',
        title: 'Project milestone 2: my part',
        follows: 'Project milestone 2',
        inDays: 13,
        notes: "I'm doing the persistence layer.",
        tasks: [
          ['UML for the storage classes', 60],
          ['JSON serializer', 90],
          ['Unit tests', 90],
          ['Code review with Lucas', 45],
          ['Update the README', 30],
        ],
      },
    ],
    todos: [
      ['Reserve the Schulich room for Sunday', 1, 'COMP 251-001'],
      ['Ask Prof. Holt about the midterm regrade', 2, 'ECSE 205-001'],
      ['Pick up my DE1-SoC board', -2, 'ECSE 222-001', true],
      ['Register for the hackathon', null, null],
    ],
    privateDeadlines: [{ kind: 'other', title: 'Engineering co-op résumé review', inDays: 6, time: '12:00', notes: 'Engineering Career Centre, Frank Dawson Adams 22.' }],
  },
  samuel: {
    program: 'mathematics-major-b-sc',
    weekly: [120, 120, 90, 120, 90, 60, 180],
    records: [
      ['MATH 133', 'Fall 2024', 'A'],
      ['MATH 140', 'Fall 2024', 'A'],
      ['COMP 202', 'Fall 2024', 'A-'],
      ['PHYS 131', 'Fall 2024', 'B+'],
      ['MATH 141', 'Winter 2025', 'A'],
      ['COMP 250', 'Winter 2025', 'B+'],
      ['PSYC 100', 'Winter 2025', 'A-'],
      ['MATH 222', 'Fall 2025', 'A'],
      ['MATH 223', 'Fall 2025', 'A-'],
      ['ECON 208', 'Fall 2025', 'B+'],
      ['COMP 206', 'Winter 2026', 'B'],
      ['MATH 324', 'Winter 2026', 'W'],
    ],
    planned: ['COMP 330', 'COMP 360'],
    marks: {
      'COMP 251-001': { 'Assignment 1': 97 },
      'MATH 240-001': { 'Assignment 1': 100, 'Assignment 2': 100, Midterm: 93 },
      'MATH 323-001': { 'Assignment 1': 95, 'Assignment 2': 90, Midterm: 88 },
    },
    notes: {
      'MATH 240-001': ['A', 'Help sessions: Wednesday afternoons with Gabriel.'],
      'MATH 324-001': ['A-', 'Retaking after withdrawing last winter. Start problem sets early!'],
    },
    plans: [
      {
        section: 'MATH 323-001',
        title: 'MATH 323 Assignment 3',
        follows: 'Assignment 3',
        inDays: 8,
        notes: '',
        tasks: [
          ['Q1–Q2: Poisson and binomial', 60],
          ['Q3–Q4: continuous distributions', 75],
          ['Q5: moment generating functions', 60],
          ['Check answers with Rohan', 30],
        ],
      },
    ],
    todos: [
      ['Upload the Dijkstra notes to the study server', -1, 'COMP 251-001', true],
      ['Bring past exams on Sunday', 3, 'COMP 251-001'],
      ['Reply to Zoë about pigeonhole problems', 0, 'MATH 240-001'],
    ],
    privateDeadlines: [{ kind: 'other', title: 'NSERC summer research application', inDays: 25, time: '17:00', notes: 'Ask Prof. Bastien for a reference letter first.' }],
  },
};
