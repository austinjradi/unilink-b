import { and, count, eq } from 'drizzle-orm';
import { CURRENT_TERM } from '@shared/dates';
import type { GoatConfig } from '@shared/goat';
import { parseChatLink } from '@shared/links';
import { randomHex, scryptHexSync } from '../crypto';
import type { DB } from './client';
import {
  assessments,
  chatLinks,
  chatLinkVotes,
  classDetails,
  classes,
  classMeetings,
  courses,
  deadlines,
  enrollments,
  postReactions,
  posts,
  replies,
  studySessionMembers,
  studySessions,
  users,
} from './schema';

// The demo starts with a few classmates in COMP 251-001 and MATH 240-001 so the social
// features (S1–S4) and the shared section info (A3–A5) have something in them.
// All demo accounts share this password.
export const DEMO_PASSWORD = 'unilink-demo1';

export const DEMO_USERS = [
  { name: 'Alex Tremblay', email: 'alex.tremblay@mail.mcgill.ca', pronouns: 'he/him', faculty: 'Science', gradYear: 2028 },
  { name: 'Priya Shah', email: 'priya.shah@mail.mcgill.ca', pronouns: 'she/her', faculty: 'Engineering', gradYear: 2028 },
  { name: 'Samuel Côté', email: 'samuel.cote@mail.mcgill.ca', pronouns: '', faculty: 'Science', gradYear: 2027 },
] as const;

const DEMO_GOATS: GoatConfig[] = [
  { hat: 'toque', eyes: 'happy', horns: 'classic', fur: 'cream', background: 'rose' },
  { hat: 'grad', eyes: 'glasses', horns: 'curly', fur: 'caramel', background: 'lavender' },
  { hat: 'tophat', eyes: 'shades', horns: 'nubs', fur: 'charcoal', background: 'mint' },
];

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

export function seedDemoData(db: DB) {
  if ((db.select({ n: count() }).from(users).get()?.n ?? 0) > 0) return;

  const comp251 = classId(db, 'COMP', '251');
  const math240 = classId(db, 'MATH', '240');
  const passwordHash = hash(DEMO_PASSWORD);
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
        professor: 'Prof. Giulia Alberini',
        professorEmail: 'giulia.alberini@mcgill.ca',
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
