import { and, count, eq, inArray, isNull, like, lt, sql } from 'drizzle-orm';
import { addDays, atTime, CURRENT_TERM, TERMS, ymd } from '@shared/dates';
import { GOAT_OPTIONS, type GoatConfig, type GoatPart } from '@shared/goat';
import { type Message, render } from '@shared/i18n';
import { parseChatLink } from '@shared/links';
import { PRONOUNS } from '@shared/validation';
import { randomHex, scryptHexSync } from '../crypto';
import type { Context } from '../rpc/core';
import { sectionCode } from '../services/access';
import { replan } from '../services/planner';
import type { DB } from './client';
import {
  CLASSMATES,
  type ClassmateSeed,
  CORE,
  CORE_SECTIONS,
  FIRST_NAMES,
  LAST_NAMES,
  QUIET_CLASSMATES,
  SECTIONS,
  TRACK_COURSES,
  type Track,
  type Who,
} from './demoContent';
import {
  appState,
  assessments,
  assessmentScores,
  chatLinks,
  chatLinkVotes,
  classDetails,
  classes,
  classMeetings,
  courseInfo,
  courseRecords,
  courses,
  deadlineDone,
  deadlines,
  enrollments,
  notifications,
  plannerAssignments,
  plannerTasks,
  postAudience,
  postReactions,
  posts,
  replies,
  replyReactions,
  studySessionMembers,
  studySessions,
  todos,
  users,
} from './schema';

// The demo starts with a few classmates in COMP 251-001 and MATH 240-001 so the social
// features (S1–S4) and the shared section info (A3–A5) have something in them, then
// adds a few dozen more across the term's sections (demoContent.ts).
// All demo accounts share this password.
export const DEMO_PASSWORD = 'unilink-demo1';

export const DEMO_USERS = [
  { name: 'Alex Tremblay', email: 'alex.tremblay@mail.mcgill.ca', pronouns: 'he/him', faculty: 'Science', gradYear: 2028 },
  { name: 'Priya Shah', email: 'priya.shah@mail.mcgill.ca', pronouns: 'she/her', faculty: 'Engineering', gradYear: 2028 },
  { name: 'Samuel Côté', email: 'samuel.cote@mail.mcgill.ca', pronouns: '', faculty: 'Science', gradYear: 2027 },
] as const;

// A made-up professor who teaches both COMP 251 sections.
export const DEMO_PROFESSOR = { name: 'Daniel Ouellet', email: 'daniel.ouellet@mcgill.ca', faculty: 'Science' } as const;

// Files live outside the database, so seeding can't store them; web/bridge.ts saves these.
const HANDOUT_PATH = '/attachments/comp251-practice-set-5.txt';
const OUTLINE_PATH = '/attachments/comp251-outline.txt';
export const DEMO_HANDOUTS = [
  {
    path: OUTLINE_PATH,
    text: `COMP 251: Algorithms and Data Structures. Course outline, Fall 2026

Instructor: Prof. Daniel Ouellet. Office hours: Wednesdays 13:00 to 14:30.

Schedule
Quiz 5 (myCourses): Nov 24
Practice set 6 due Dec 1 at 11:59 pm
Review session for the final: Dec 3, no hand-in
Reading week: no class Oct 9 to Oct 14
`,
  },
  {
    path: HANDOUT_PATH,
    text: `COMP 251 Practice set 5: shortest paths

Question 1: Dijkstra by hand (30 points)
Run Dijkstra's algorithm on the graph from lecture 14, starting at s. Show the priority queue after each step.

Question 2: Negative edges (30 points)
Give a graph with one negative edge and no negative cycle on which Dijkstra's algorithm returns a wrong answer.

Question 3: Bellman-Ford (40 points)
Prove that after k rounds, Bellman-Ford has found every shortest path that uses at most k edges.
`,
  },
];

const DEMO_GOATS: GoatConfig[] = [
  { hat: 'toque', eyes: 'happy', horns: 'classic', fur: 'cream', background: 'rose' },
  { hat: 'grad', eyes: 'glasses', horns: 'curly', fur: 'caramel', background: 'lavender' },
  { hat: 'tophat', eyes: 'shades', horns: 'nubs', fur: 'charcoal', background: 'mint' },
];

const CORE_EMAILS: Record<Who, string> = {
  alex: DEMO_USERS[0].email,
  priya: DEMO_USERS[1].email,
  samuel: DEMO_USERS[2].email,
};

// "Sofía Ramírez" → sofia.ramirez@mail.mcgill.ca
export const demoEmail = (name: string) =>
  `${name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z ]/g, '')
    .split(' ')
    .join('.')}@mail.mcgill.ca`;

// Bumped when demo content is added; browsers with an older demo get the new part on next load.
// 2: the classmates and sections in demoContent.ts. 3: their planned assignments follow the
// section's graded items. 4: a professor teaching COMP 251. 5: their course outline.
const SEED_KEY = 'demo_seed';
const SEED_VERSION = '5';
const HOUR = 3_600_000;

function hash(password: string) {
  const salt = randomHex(16);
  return `scrypt:${salt}:${scryptHexSync(password, salt, 64)}`;
}

function classId(db: DB, subject: string, number: string, section = '001') {
  return db
    .select({ id: classes.id })
    .from(classes)
    .innerJoin(courses, eq(classes.courseId, courses.id))
    .where(
      and(eq(courses.subject, subject), eq(courses.number, number), eq(classes.term, CURRENT_TERM), eq(classes.section, section)),
    )
    .get()!.id;
}

// The same demo for every visitor: a small seeded generator instead of Math.random.
function seededRandom(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function seedDemoData(db: DB) {
  const marker = db.select({ value: appState.value }).from(appState).where(eq(appState.key, SEED_KEY)).get()?.value;
  if (marker === SEED_VERSION) return;
  const passwordHash = hash(DEMO_PASSWORD);
  if (marker === '2') {
    linkSeededPlans(db);
  } else if (marker !== '3') {
    // Databases from before the marker already have the first three classmates.
    const fresh = !marker && (db.select({ n: count() }).from(users).get()?.n ?? 0) === 0;
    if (fresh) seedFirstClassmates(db, passwordHash);
    seedSections(db, passwordHash);
  }
  seedProfessor(db, passwordHash);
  db.update(classDetails)
    .set({ outlineName: 'comp251-outline.txt', outlinePath: OUTLINE_PATH })
    .where(and(eq(classDetails.classId, classId(db, 'COMP', '251', '001')), isNull(classDetails.outlinePath)))
    .run();
  followSeededThreads(db);
  db.insert(appState)
    .values({ key: SEED_KEY, value: SEED_VERSION })
    .onConflictDoUpdate({ target: appState.key, set: { value: SEED_VERSION } })
    .run();
}

function seedFirstClassmates(db: DB, passwordHash: string) {
  const comp251 = classId(db, 'COMP', '251');
  const math240 = classId(db, 'MATH', '240');
  const at = (daysFromNow: number, hour: number, minute = 0) => {
    const d = new Date();
    d.setDate(d.getDate() + daysFromNow);
    d.setHours(hour, minute, 0, 0);
    return d;
  };
  const link = (url: string) => parseChatLink(url)!;

  db.transaction((tx) => {
    const [alex, priya, samuel] = DEMO_USERS.map(
      (u, i) =>
        tx
          .insert(users)
          .values({ ...u, passwordHash, avatar: DEMO_GOATS[i] })
          .returning()
          .get().id,
    );
    for (const userId of [alex, priya, samuel]) tx.insert(enrollments).values({ userId, classId: comp251 }).run();
    tx.insert(enrollments).values({ userId: samuel, classId: math240 }).run();

    // A3/A5: what the section shares, entered once by one classmate.
    tx.insert(classMeetings)
      .values([
        { userId: priya, classId: comp251, weekday: 2, startTime: '10:05', endTime: '11:25', location: 'Leacock 132' },
        { userId: priya, classId: comp251, weekday: 4, startTime: '10:05', endTime: '11:25', location: 'Leacock 132' },
      ])
      .run();
    tx.insert(classDetails)
      .values({
        classId: comp251,
        professor: `Prof. ${DEMO_PROFESSOR.name}`,
        professorEmail: DEMO_PROFESSOR.email,
        officeHours: 'Wed 13:00–14:30, McConnell 110N',
        location: 'Leacock 132',
        updatedById: priya,
        updatedAt: at(-3, 20),
      })
      .run();
    tx.insert(assessments)
      .values([
        { userId: priya, classId: comp251, name: 'Assignment 1', weight: 10, dueAt: at(-10, 23, 59), position: 0 },
        { userId: priya, classId: comp251, name: 'Assignment 2', weight: 10, dueAt: at(5, 23, 59), position: 1 },
        { userId: priya, classId: comp251, name: 'Midterm', weight: 30, dueAt: at(12, 18), position: 2 },
        { userId: priya, classId: comp251, name: 'Final exam', weight: 40, dueAt: null, position: 3 },
      ])
      .run();
    tx.insert(deadlines)
      .values({
        userId: alex,
        classId: comp251,
        kind: 'quiz',
        title: 'Quiz 3 (myCourses, graphs)',
        dueAt: at(3, 23, 59),
        notes: 'Open for 24 hours, 30 minutes once started.',
      })
      .run();

    // S2: links are public right away, tagged with what they're for.
    const [whatsapp] = tx
      .insert(chatLinks)
      .values([
        { classId: comp251, ownerId: alex, ...link('https://chat.whatsapp.com/DemoComp251Fall'), purpose: 'course', label: 'COMP 251 Fall 2026', isPublic: true },
        { classId: comp251, ownerId: priya, ...link('https://discord.gg/comp251-demo'), purpose: 'study-group', label: 'Study server', isPublic: true },
        { classId: math240, ownerId: samuel, ...link('https://discord.gg/math240-demo'), purpose: 'section', label: 'MATH 240 help', isPublic: true },
      ])
      .returning()
      .all();
    tx.insert(chatLinkVotes)
      .values([
        { linkId: whatsapp.id, userId: priya, vote: 'works', createdAt: at(-1, 12) },
        { linkId: whatsapp.id, userId: samuel, vote: 'works', createdAt: at(-2, 9) },
      ])
      .run();

    // S3: an open session with one spot left, and an invite-only one you'd need the code for.
    const open = tx
      .insert(studySessions)
      .values({
        classId: comp251,
        hostId: priya,
        title: 'Assignment 2 work session',
        description: 'Going through the dynamic programming questions together. Bring your attempts!',
        format: 'in-person',
        location: 'Trottier 3rd floor, room 3120',
        startsAt: at(2, 18),
        endsAt: at(2, 20),
        capacity: 3,
        visibility: 'class',
        inviteCode: 'PRIYA2',
        tag: 'Assignment',
      })
      .returning()
      .get();
    tx.insert(studySessionMembers)
      .values([
        { sessionId: open.id, userId: priya, status: 'going', createdAt: at(-2, 10) },
        { sessionId: open.id, userId: alex, status: 'going', createdAt: at(-1, 10) },
      ])
      .run();
    const invite = tx
      .insert(studySessions)
      .values({
        classId: comp251,
        hostId: alex,
        title: 'Midterm review (project team)',
        description: 'Past midterms, timed. Ask me for the code.',
        format: 'online',
        location: '',
        meetingUrl: 'https://mcgill.zoom.us/j/1234567890',
        startsAt: at(8, 19),
        endsAt: at(8, 21),
        capacity: 4,
        visibility: 'invite',
        inviteCode: 'ALEXMT',
        tag: 'Midterm',
      })
      .returning()
      .get();
    tx.insert(studySessionMembers)
      .values([
        { sessionId: invite.id, userId: alex, status: 'going' },
        { sessionId: invite.id, userId: samuel, status: 'going' },
      ])
      .run();

    // S4: a resolved question, an open one, and a note.
    const question = tx
      .insert(posts)
      .values({
        classId: comp251,
        authorId: alex,
        kind: 'question',
        topic: 'Assignments',
        title: 'Master theorem: which case applies to T(n) = 2T(n/2) + n log n?',
        body: 'I keep landing between case 2 and case 3. Does the basic master theorem even cover this one, or do we need the extended version from lecture 6?',
        visibility: 'class',
        createdAt: at(-1, 15),
      })
      .returning()
      .get();
    const answer = tx
      .insert(replies)
      .values({
        postId: question.id,
        authorId: samuel,
        body: "It's the extended case 2: f(n) = Θ(n log n) = Θ(n^(log_b a) · log^1 n), so T(n) = Θ(n log² n).",
        createdAt: at(-1, 16),
      })
      .returning()
      .get();
    tx.update(posts).set({ acceptedReplyId: answer.id }).where(eq(posts.id, question.id)).run();
    tx.insert(postReactions)
      .values([
        { postId: question.id, userId: priya },
        { postId: question.id, userId: samuel },
      ])
      .run();
    tx.insert(posts)
      .values({
        classId: comp251,
        authorId: priya,
        kind: 'question',
        topic: 'Exams',
        title: 'Is the midterm cumulative up to graphs?',
        body: 'The syllabus says "up to week 6" but week 6 started BFS/DFS. Anyone asked the prof?',
        visibility: 'class',
        createdAt: at(0, 9),
      })
      .run();
    tx.insert(posts)
      .values({
        classId: comp251,
        authorId: priya,
        kind: 'note',
        topic: 'Logistics',
        title: 'Class times and the grading scheme are filled in',
        body: 'I added our lecture times and the syllabus breakdown under Overview and Grades. Fix anything I got wrong!',
        visibility: 'class',
        createdAt: at(-3, 20),
      })
      .run();
  });
}

// The quiet classmates (demoContent.ts), generated the same way in every browser.
export function quietClassmates(): ClassmateSeed[] {
  const rand = seededRandom(240);
  const pick = <T>(items: readonly T[]) => items[Math.floor(rand() * items.length)];
  const tracks: Track[] = ['cs', 'cs', 'cs', 'sci', 'sci', 'arts', 'arts', 'eng', 'math'];
  const taken = new Set([...CLASSMATES.map((c) => demoEmail(c.name)), ...DEMO_USERS.map((u) => u.email)]);
  const quiet: ClassmateSeed[] = [];
  while (quiet.length < QUIET_CLASSMATES) {
    const name = `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)}`;
    if (taken.has(demoEmail(name))) continue;
    taken.add(demoEmail(name));
    const track = pick(tracks);
    const faculty = track === 'eng' ? 'Engineering' : track === 'arts' ? (rand() < 0.3 ? 'Management' : 'Arts') : 'Science';
    quiet.push({ key: `quiet-${quiet.length}`, name, pronouns: rand() < 0.6 ? pick(PRONOUNS.slice(0, 3)) : '', faculty, gradYear: 2027 + Math.floor(rand() * 4), track });
  }
  return quiet;
}

// Version 4: a professor who runs COMP 251-001 and -002: the scheme and details are theirs,
// with a posted assignment, a pinned announcement, an answer and an endorsed reply on the board.
function seedProfessor(db: DB, passwordHash: string) {
  if (db.select({ id: users.id }).from(users).where(eq(users.email, DEMO_PROFESSOR.email)).get()) return;
  const sections = [classId(db, 'COMP', '251', '001'), classId(db, 'COMP', '251', '002')];
  const [comp251] = sections;
  const now = new Date();
  db.transaction((tx) => {
    const professor = tx
      .insert(users)
      .values({
        ...DEMO_PROFESSOR,
        role: 'professor',
        passwordHash,
        avatar: { hat: 'grad', eyes: 'glasses', horns: 'classic', fur: 'white', background: 'mint' },
      })
      .returning()
      .get().id;
    for (const section of sections) {
      tx.insert(enrollments).values({ userId: professor, classId: section }).run();
      const edit = { professor: `Prof. ${DEMO_PROFESSOR.name}`, professorEmail: DEMO_PROFESSOR.email, updatedById: professor, updatedAt: now };
      tx.insert(classDetails).values({ classId: section, ...edit }).onConflictDoUpdate({ target: classDetails.classId, set: edit }).run();
    }

    tx.insert(deadlines)
      .values({
        userId: professor,
        classId: comp251,
        kind: 'assignment',
        title: 'Practice set 5: shortest paths',
        dueAt: atTime(addDays(ymd(now), 9), '23:59'),
        notes: "Not graded, but the midterm's graph questions look a lot like these. Solutions go up the day after it's due.",
        official: true,
        attachmentName: 'comp251-practice-set-5.txt',
        attachmentPath: HANDOUT_PATH,
        createdAt: new Date(now.getTime() - 26 * HOUR),
      })
      .run();
    tx.insert(posts)
      .values({
        classId: comp251,
        authorId: professor,
        kind: 'note',
        topic: 'Exams',
        title: 'Midterm: what to bring',
        body: 'Your McGill ID and a pen. One letter-size cheat sheet is allowed, both sides, handwritten or typed. No calculators.',
        visibility: 'class',
        pinnedAt: now,
        createdAt: new Date(now.getTime() - 5 * HOUR),
      })
      .run();

    // Answers an open question and vouches for a classmate's answer, if the threads are still there.
    const open = tx.select({ id: posts.id }).from(posts).where(and(eq(posts.classId, comp251), eq(posts.title, 'Is the midterm cumulative up to graphs?'))).get();
    if (open) {
      tx.insert(replies)
        .values({ postId: open.id, authorId: professor, body: 'Yes, up to and including BFS and DFS. Nothing on shortest paths.', createdAt: new Date(now.getTime() - 3 * HOUR) })
        .run();
    }
    const solved = tx.select({ accepted: posts.acceptedReplyId }).from(posts).where(and(eq(posts.classId, comp251), like(posts.title, 'Master theorem:%'))).get();
    if (solved?.accepted) tx.update(replies).set({ endorsedAt: now }).where(eq(replies.id, solved.accepted)).run();
  });
}

// S4: classmates follow the threads they started or replied in, as they would in the app.
function followSeededThreads(db: DB) {
  db.run(sql`
    insert or ignore into post_follows (post_id, user_id, following)
    select id, author_id, 1 from posts where deleted_at is null
    union select post_id, author_id, 1 from replies`);
}

// Version 2 of the demo seeded the sign-in accounts' plans without saying which graded item
// each one is for; link them so they follow it like plans made in the app.
function linkSeededPlans(db: DB) {
  for (const [key, seed] of Object.entries(CORE)) {
    const user = db.select({ id: users.id }).from(users).where(eq(users.email, CORE_EMAILS[key])).get();
    if (!user) continue;
    for (const plan of seed.plans) {
      const assignment = db
        .select()
        .from(plannerAssignments)
        .where(and(eq(plannerAssignments.userId, user.id), eq(plannerAssignments.title, plan.title), isNull(plannerAssignments.assessmentId)))
        .get();
      if (!assignment?.classId || !plan.follows) continue;
      const source = db
        .select({ id: assessments.id })
        .from(assessments)
        .where(and(eq(assessments.classId, assignment.classId), eq(assessments.name, plan.follows)))
        .get();
      if (source) db.update(plannerAssignments).set({ assessmentId: source.id }).where(eq(plannerAssignments.id, assignment.id)).run();
    }
  }
}

const m = (key: string, params?: Message['params']): Message => ({ key, params });
const raw = (text: string): Message => ({ key: '{{text}}', params: { text: text.length > 140 ? `${text.slice(0, 140)}…` : text } });

// Everything in demoContent.ts: the other classmates, which sections they're in, what each
// section shares and discusses, and the sign-in accounts' own records and plans. Rows that
// already exist are left alone, so this also tops up databases from an older demo.
function seedSections(db: DB, passwordHash: string) {
  const now = new Date();
  const today = ymd(now);
  const at = (days: number, time: string) => atTime(addDays(today, days), time);
  const ago = (hours: number) => new Date(now.getTime() - hours * HOUR);
  const rand = seededRandom(2026);
  const shuffled = <T>(items: T[]) =>
    items
      .map((item) => [rand(), item] as const)
      .sort((a, b) => a[0] - b[0])
      .map(([, item]) => item);
  const goat = (): GoatConfig => {
    const part = <K extends GoatPart>(k: K) => GOAT_OPTIONS[k][Math.floor(rand() * GOAT_OPTIONS[k].length)] as GoatConfig[K];
    return { hat: part('hat'), eyes: part('eyes'), horns: part('horns'), fur: part('fur'), background: part('background') };
  };

  const sections = new Map(
    db
      .select({ id: classes.id, courseId: classes.courseId, code: sectionCode })
      .from(classes)
      .innerJoin(courses, eq(classes.courseId, courses.id))
      .where(eq(classes.term, CURRENT_TERM))
      .all()
      .map((s) => [s.code, s]),
  );
  const sectionsOf = (course: string) => [...sections.values()].filter((s) => s.code.startsWith(`${course}-`));

  const everyone = [...CLASSMATES, ...quietClassmates()];
  const ids = new Map<Who, number>();
  const plans: { assignmentId: number; userId: number }[] = [];

  db.transaction((tx) => {
    tx.insert(users)
      .values(
        everyone.map((c, i) => ({
          name: c.name,
          email: demoEmail(c.name),
          pronouns: c.pronouns,
          faculty: c.faculty,
          gradYear: c.gradYear,
          passwordHash,
          // Some never customized their goat and get the default one for their id.
          avatar: i % 4 === 3 || i >= CLASSMATES.length + QUIET_CLASSMATES / 2 ? null : goat(),
          createdAt: ago(24 * (30 + i)),
        })),
      )
      .onConflictDoNothing()
      .run();
    const emails = new Map<Who, string>([...Object.entries(CORE_EMAILS), ...everyone.map((c) => [c.key, demoEmail(c.name)] as const)]);
    const found = tx
      .select({ id: users.id, email: users.email, name: users.name })
      .from(users)
      .where(inArray(users.email, [...emails.values()]))
      .all();
    for (const [key, email] of emails) {
      const user = found.find((u) => u.email === email);
      if (user) ids.set(key, user.id);
    }
    const names = new Map(found.map((u) => [u.id, u.name]));
    const demoIds = new Set(ids.values());

    // S1: one section per course and term, as the app requires.
    const sectionOf = new Map<string, number>(); // "userId|courseId" → class id
    const members = new Map<number, number[]>(); // demo accounts only
    const join = (userId: number, classId: number) => {
      if (!members.has(classId)) members.set(classId, []);
      members.get(classId)!.push(userId);
    };
    for (const e of tx
      .select({ userId: enrollments.userId, classId: enrollments.classId, courseId: classes.courseId })
      .from(enrollments)
      .innerJoin(classes, eq(enrollments.classId, classes.id))
      .where(eq(classes.term, CURRENT_TERM))
      .all()) {
      sectionOf.set(`${e.userId}|${e.courseId}`, e.classId);
      if (demoIds.has(e.userId)) join(e.userId, e.classId);
    }
    const enroll = (userId: number, code: string) => {
      const section = sections.get(code);
      if (!section) return false;
      const current = sectionOf.get(`${userId}|${section.courseId}`);
      if (current !== undefined) return current === section.id;
      tx.insert(enrollments)
        .values({ userId, classId: section.id, joinedAt: ago(24 * (20 + rand() * 40)) })
        .run();
      sectionOf.set(`${userId}|${section.courseId}`, section.id);
      join(userId, section.id);
      return true;
    };

    for (const [key, codes] of Object.entries(CORE_SECTIONS)) {
      const userId = ids.get(key);
      if (userId) for (const code of codes) enroll(userId, code);
    }
    // Whoever writes something in a section is in it.
    for (const [code, seed] of Object.entries(SECTIONS)) {
      const authors = [
        seed.details?.by,
        seed.times?.by,
        seed.scheme?.by,
        ...(seed.deadlines ?? []).map((d) => d.by),
        ...(seed.links ?? []).map((l) => l.by),
        ...(seed.sessions ?? []).map((s) => s.by),
        ...(seed.posts ?? []).flatMap((p) => [p.by, ...(p.replies ?? []).map(([by]) => by), ...(p.to ?? [])]),
      ];
      for (const key of new Set(authors)) {
        const userId = key ? ids.get(key) : undefined;
        if (userId) enroll(userId, code);
      }
    }
    // Then four or five courses each, mostly in the first section.
    for (const c of everyone) {
      const userId = ids.get(c.key);
      if (!userId) continue;
      let taking = [...sectionOf.keys()].filter((k) => k.startsWith(`${userId}|`)).length;
      const wanted = rand() < 0.5 ? 4 : 5;
      for (const course of shuffled(TRACK_COURSES[c.track])) {
        if (taking >= wanted) break;
        const options = sectionsOf(course);
        if (!options.length) continue;
        const section = options.length > 1 && rand() > 0.65 ? options[1 + Math.floor(rand() * (options.length - 1))] : options[0];
        if (enroll(userId, section.code)) taking++;
      }
    }

    const notices: { userId: number; type: string; title: Message; body: Message; link: string; createdAt: Date }[] = [];
    // The sign-in accounts go to at most one session they didn't set up, so their free
    // time (and the plans that use it, ST2) isn't all taken by sessions.
    const coreIds = new Set(Object.keys(CORE_EMAILS).map((key) => ids.get(key)));
    const sessionsJoined = new Map<number, number>();

    for (const [code, seed] of Object.entries(SECTIONS)) {
      const section = sections.get(code);
      if (!section) continue;
      const classId = section.id;
      const people = members.get(classId) ?? [];
      const by = (key: Who) => {
        const userId = ids.get(key);
        return userId && people.includes(userId) ? userId : null;
      };
      const others = (...not: number[]) => shuffled(people.filter((id) => !not.includes(id)));

      // A5: shared details, wiki-style; left alone if the section already filled them in.
      if (seed.details) {
        const { by: editor, daysAgo, email, ...details } = seed.details;
        const updatedById = by(editor);
        if (updatedById) {
          tx.insert(classDetails)
            .values({ classId, ...details, professorEmail: email, updatedById, updatedAt: ago(24 * daysAgo) })
            .onConflictDoNothing()
            .run();
        }
      }
      // A3: lecture times, entered once for the section.
      const hasTimes = tx.select({ id: classMeetings.id }).from(classMeetings).where(eq(classMeetings.classId, classId)).get();
      const timesBy = seed.times ? by(seed.times.by) : null;
      if (seed.times && timesBy && !hasTimes) {
        const { days, start, end, location } = seed.times;
        tx.insert(classMeetings)
          .values(days.map((weekday) => ({ userId: timesBy, classId, weekday, startTime: start, endTime: end, location })))
          .run();
      }
      // A4/A5: the shared grading scheme.
      const hasScheme = tx.select({ id: assessments.id }).from(assessments).where(eq(assessments.classId, classId)).get();
      const schemeBy = seed.scheme ? by(seed.scheme.by) : null;
      if (seed.scheme && schemeBy && !hasScheme) {
        tx.insert(assessments)
          .values(
            seed.scheme.items.map(([name, weight, due], position) => ({
              userId: schemeBy,
              classId,
              name,
              weight,
              dueAt: due == null ? null : at(due, /midterm|exam/i.test(name) ? '18:30' : '23:59'),
              position,
            })),
          )
          .run();
      }
      // A3: class deadlines everyone in the section sees.
      for (const d of seed.deadlines ?? []) {
        const userId = by(d.by);
        if (!userId) continue;
        tx.insert(deadlines)
          .values({ userId, classId, kind: d.kind, title: d.title, dueAt: at(d.inDays, d.time), notes: d.notes ?? '', createdAt: ago(24 * (2 + rand() * 6)) })
          .run();
      }
      // S2: group chats, with classmates vouching for them or reporting them.
      for (const l of seed.links ?? []) {
        const ownerId = by(l.by);
        const parsed = parseChatLink(l.url);
        if (!ownerId || !parsed) continue;
        const link = tx
          .insert(chatLinks)
          .values({ classId, ownerId, ...parsed, purpose: l.purpose, label: l.label, isPublic: true, createdAt: ago(24 * (4 + rand() * 20)) })
          .onConflictDoNothing()
          .returning()
          .get();
        if (!link) continue;
        const votes = [
          ...Array.from({ length: l.works ?? 0 }, () => ({ vote: 'works' as const, reason: null })),
          ...(l.reports ?? []).map((reason) => ({ vote: 'report' as const, reason })),
        ];
        const voters = others(ownerId);
        const rows = votes.slice(0, voters.length).map((v, i) => ({ linkId: link.id, userId: voters[i], ...v, createdAt: ago(rand() * 24 * 6) }));
        if (rows.length) tx.insert(chatLinkVotes).values(rows).run();
      }
      // S3: sessions with people going, a waitlist when full, and invite-only ones.
      for (const s of seed.sessions ?? []) {
        const hostId = by(s.by);
        if (!hostId) continue;
        const startsAt = at(s.inDays, s.start);
        const createdAt = ago(24 * (3 + rand() * 5));
        const session = tx
          .insert(studySessions)
          .values({
            classId,
            hostId,
            title: s.title,
            description: s.description,
            tag: s.tag,
            format: s.online ? 'online' : 'in-person',
            location: s.online ? '' : s.where,
            meetingUrl: s.online ? s.where : '',
            startsAt,
            endsAt: new Date(startsAt.getTime() + s.hours * HOUR),
            capacity: s.capacity,
            visibility: s.inviteCode ? 'invite' : 'class',
            inviteCode: s.inviteCode ?? inviteCode(rand),
            createdAt,
          })
          .returning()
          .get();
        const line = [hostId, ...others(hostId).filter((id) => !coreIds.has(id) || !sessionsJoined.get(id))];
        const going = line.slice(0, Math.min(s.going, s.capacity));
        for (const id of going.slice(1)) if (coreIds.has(id)) sessionsJoined.set(id, 1);
        const waiting = line.slice(going.length, going.length + (s.waitlist ?? 0));
        const joinedAt = (i: number) => new Date(createdAt.getTime() + i * 3 * HOUR);
        tx.insert(studySessionMembers)
          .values([
            ...going.map((userId, i) => ({ sessionId: session.id, userId, status: 'going' as const, createdAt: joinedAt(i) })),
            ...waiting.map((userId, i) => ({ sessionId: session.id, userId, status: 'waitlisted' as const, createdAt: joinedAt(going.length + i) })),
          ])
          .run();
      }
      // S4: questions and notes, replies, accepted answers and 🐐 reactions.
      for (const p of seed.posts ?? []) {
        const authorId = by(p.by);
        if (!authorId) continue;
        const createdAt = ago(p.hoursAgo);
        const audience = (p.to ?? []).map(by).filter((id): id is number => id != null);
        const post = tx
          .insert(posts)
          .values({ classId, authorId, kind: p.kind, topic: p.topic, title: p.title, body: p.body, visibility: p.to ? 'selected' : 'class', createdAt })
          .returning()
          .get();
        if (audience.length) tx.insert(postAudience).values(audience.map((userId) => ({ postId: post.id, userId }))).run();
        const readers = p.to ? audience : others(authorId);
        const link = `/classes/${classId}/discussion?post=${post.id}`;

        const replyRows = p.replies ?? [];
        const gap = Math.min(p.hoursAgo / (replyRows.length + 1), 6);
        const replyIds = replyRows.map(([key, body], i) => {
          const replier = by(key);
          if (!replier) return null;
          const repliedAt = new Date(createdAt.getTime() + gap * (i + 1) * HOUR);
          const reply = tx.insert(replies).values({ postId: post.id, authorId: replier, body, createdAt: repliedAt }).returning().get();
          const fans = readers.filter((id) => id !== replier).slice(0, Math.floor(rand() * 4));
          if (fans.length) tx.insert(replyReactions).values(fans.map((userId) => ({ replyId: reply.id, userId }))).run();
          if (replier !== authorId) {
            notices.push({
              userId: authorId,
              type: 'reply',
              title: m('{{name}} replied to "{{title}}"', { name: names.get(replier) ?? '', title: p.title }),
              body: raw(body),
              link,
              createdAt: repliedAt,
            });
          }
          return { id: reply.id, authorId: replier, body, at: repliedAt };
        });
        const accepted = p.accepted != null ? replyIds[p.accepted] : null;
        if (p.kind === 'question' && accepted) {
          tx.update(posts).set({ acceptedReplyId: accepted.id }).where(eq(posts.id, post.id)).run();
          if (accepted.authorId !== authorId) {
            notices.push({
              userId: accepted.authorId,
              type: 'answer-accepted',
              title: m('Your answer to "{{title}}" was accepted', { title: p.title }),
              body: raw(accepted.body),
              link,
              createdAt: new Date(Math.min(accepted.at.getTime() + 0.5 * HOUR, now.getTime())),
            });
          }
        }
        const goats = readers.slice(0, p.goats ?? Math.floor(rand() * 3));
        if (goats.length) tx.insert(postReactions).values(goats.map((userId) => ({ postId: post.id, userId }))).run();
      }
    }

    // G3: what the board activity above would have notified; older ones are already read.
    if (notices.length) {
      tx.insert(notifications)
        .values(
          notices.map((n) => ({
            userId: n.userId,
            type: n.type,
            title: render('en', n.title),
            body: render('en', n.body),
            i18n: { title: n.title, body: n.body },
            link: n.link,
            createdAt: n.createdAt,
            readAt: now.getTime() - n.createdAt.getTime() > 12 * HOUR ? now : null,
            deliveredAt: n.createdAt,
          })),
        )
        .run();
    }

    const catalogue = new Map(
      tx
        .select()
        .from(courses)
        .all()
        .map((c) => [`${c.subject} ${c.number}`, c]),
    );
    for (const [key, seed] of Object.entries(CORE)) {
      const userId = ids.get(key);
      if (!userId) continue;
      const mine = (code: string) => {
        const section = sections.get(code);
        return section && sectionOf.get(`${userId}|${section.courseId}`) === section.id ? section.id : null;
      };

      // A2, and ST2's free time
      tx.update(users)
        .set({ degreeProgramId: seed.program })
        .where(and(eq(users.id, userId), isNull(users.degreeProgramId)))
        .run();
      tx.update(users)
        .set({ weeklyStudyMinutes: seed.weekly })
        .where(and(eq(users.id, userId), isNull(users.weeklyStudyMinutes)))
        .run();

      // A1: past terms, this term's classes, and next term's plan.
      const recorded = new Set(
        tx
          .select({ code: courseRecords.code, term: courseRecords.term })
          .from(courseRecords)
          .where(eq(courseRecords.userId, userId))
          .all()
          .map((r) => `${r.code}|${r.term}`),
      );
      const records = [
        ...seed.records.map(([code, term, grade]) => ({ code, term, grade, status: 'completed' as const })),
        ...CORE_SECTIONS[key].map((code) => ({ code: code.slice(0, -4), term: CURRENT_TERM as string, grade: null, status: 'in-progress' as const })),
        ...seed.planned.map((code) => ({ code, term: TERMS[1] as string, grade: null, status: 'planned' as const })),
      ].filter((r) => catalogue.has(r.code) && !recorded.has(`${r.code}|${r.term}`));
      if (records.length) {
        tx.insert(courseRecords)
          .values(records.map((r) => ({ ...r, userId, title: catalogue.get(r.code)!.title, credits: catalogue.get(r.code)!.credits })))
          .run();
      }

      // A4: private marks on the section's shared scheme.
      for (const [code, marks] of Object.entries(seed.marks)) {
        const classId = mine(code);
        if (!classId) continue;
        for (const a of tx.select().from(assessments).where(eq(assessments.classId, classId)).all()) {
          const score = marks[a.name];
          if (score != null) tx.insert(assessmentScores).values({ assessmentId: a.id, userId, score }).onConflictDoNothing().run();
        }
      }

      // A5: private notes and target grades.
      for (const [code, [targetGrade, notes]] of Object.entries(seed.notes)) {
        const classId = mine(code);
        if (classId) tx.insert(courseInfo).values({ userId, classId, targetGrade, notes }).onConflictDoNothing().run();
      }

      // A3: their own deadlines, and the class deadlines already behind them checked off.
      const myDeadlines = new Set(
        tx
          .select({ title: deadlines.title })
          .from(deadlines)
          .where(eq(deadlines.userId, userId))
          .all()
          .map((d) => d.title),
      );
      for (const d of seed.privateDeadlines) {
        if (myDeadlines.has(d.title)) continue;
        tx.insert(deadlines).values({ userId, classId: null, kind: d.kind, title: d.title, dueAt: at(d.inDays, d.time), notes: d.notes }).run();
      }
      const myClasses = CORE_SECTIONS[key].map(mine).filter((id): id is number => id != null);
      const past = tx
        .select({ id: deadlines.id })
        .from(deadlines)
        .where(and(inArray(deadlines.classId, myClasses), lt(deadlines.dueAt, now)))
        .all();
      if (past.length) tx.insert(deadlineDone).values(past.map((d) => ({ deadlineId: d.id, userId }))).onConflictDoNothing().run();

      // ST3
      const myTodos = new Set(
        tx
          .select({ title: todos.title })
          .from(todos)
          .where(eq(todos.userId, userId))
          .all()
          .map((t) => t.title),
      );
      const todoRows = seed.todos
        .filter(([title]) => !myTodos.has(title))
        .map(([title, inDays, code, done], i) => ({
          userId,
          title,
          dueDate: inDays == null ? null : addDays(today, inDays),
          classId: code ? mine(code) : null,
          doneAt: done ? ago(6 + i) : null,
          createdAt: ago(48 + i),
        }));
      if (todoRows.length) tx.insert(todos).values(todoRows).run();

      // ST2: assignments broken into tasks; they're planned once this transaction is done.
      const myPlans = new Set(
        tx
          .select({ title: plannerAssignments.title })
          .from(plannerAssignments)
          .where(eq(plannerAssignments.userId, userId))
          .all()
          .map((a) => a.title),
      );
      for (const plan of seed.plans) {
        if (myPlans.has(plan.title)) continue;
        const classId = mine(plan.section);
        const source = classId && plan.follows
          ? tx.select().from(assessments).where(and(eq(assessments.classId, classId), eq(assessments.name, plan.follows))).get()
          : undefined;
        const dueAt = source?.dueAt ?? at(plan.inDays, '23:59');
        const assignment = tx
          .insert(plannerAssignments)
          .values({
            userId,
            classId,
            title: plan.title,
            dueAt,
            notes: plan.notes,
            bufferDays: 1,
            assessmentId: source?.dueAt ? source.id : null,
            createdAt: ago(30),
          })
          .returning()
          .get();
        // The first few are already done today. The rest wait on the due date until their
        // plan runs, so they don't crowd out the plans made before them.
        tx.insert(plannerTasks)
          .values(
            plan.tasks.map(([title, minutes], position) => {
              const done = position < (plan.done ?? 0);
              return { assignmentId: assignment.id, title, minutes, position, scheduledFor: done ? today : ymd(dueAt), doneAt: done ? ago(3) : null };
            }),
          )
          .run();
        plans.push({ assignmentId: assignment.id, userId });
      }
    }
  });

  for (const { assignmentId, userId } of plans) {
    replan({ db, userId, now: () => now } as unknown as Context & { userId: number }, assignmentId);
  }
}

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const inviteCode = (rand: () => number) => Array.from({ length: 6 }, () => CODE_ALPHABET[Math.floor(rand() * CODE_ALPHABET.length)]).join('');
