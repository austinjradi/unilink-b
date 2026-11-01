import { randomBytes, scryptSync } from 'node:crypto';
import { and, count, eq } from 'drizzle-orm';
import { CURRENT_TERM } from '@shared/dates';
import type { GoatConfig } from '@shared/goat';
import type { DB } from './client';
import { chatLinks, classes, courses, enrollments, postReactions, posts, replies, studySessionMembers, studySessions, users } from './schema';

// Dev builds start with a few classmates in COMP 251 and MATH 240 so the social
// features (S1–S4) have someone to interact with. All demo accounts share this password.
export const DEMO_PASSWORD = 'unilink-demo1';

export const DEMO_USERS = [
  { name: 'Alex Tremblay', email: 'alex.tremblay@mail.mcgill.ca', program: 'Computer Science', year: 2 },
  { name: 'Priya Shah', email: 'priya.shah@mail.mcgill.ca', program: 'Software Engineering', year: 2 },
  { name: 'Samuel Côté', email: 'samuel.cote@mail.mcgill.ca', program: 'Mathematics and CS', year: 3 },
];

const DEMO_GOATS: GoatConfig[] = [
  { hat: 'toque', eyes: 'happy', horns: 'classic', fur: 'cream', background: 'rose' },
  { hat: 'grad', eyes: 'glasses', horns: 'curly', fur: 'caramel', background: 'lavender' },
  { hat: 'tophat', eyes: 'shades', horns: 'nubs', fur: 'charcoal', background: 'mint' },
];

function hash(password: string) {
  const salt = randomBytes(16);
  return `scrypt:${salt.toString('hex')}:${scryptSync(password, salt, 64).toString('hex')}`;
}

function classId(db: DB, subject: string, number: string) {
  return db
    .select({ id: classes.id })
    .from(classes)
    .innerJoin(courses, eq(classes.courseId, courses.id))
    .where(and(eq(courses.subject, subject), eq(courses.number, number), eq(classes.term, CURRENT_TERM)))
    .get()!.id;
}

export function seedDemoData(db: DB) {
  if ((db.select({ n: count() }).from(users).get()?.n ?? 0) > 0) return;

  const comp251 = classId(db, 'COMP', '251');
  const math240 = classId(db, 'MATH', '240');
  const passwordHash = hash(DEMO_PASSWORD);
  const at = (daysFromNow: number, hour: number) => {
    const d = new Date();
    d.setDate(d.getDate() + daysFromNow);
    d.setHours(hour, 0, 0, 0);
    return d;
  };

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

    tx.insert(chatLinks)
      .values([
        { classId: comp251, ownerId: alex, url: 'https://chat.whatsapp.com/DemoComp251Fall', platform: 'WhatsApp', label: 'COMP 251 Fall 2026', isPublic: true },
        { classId: comp251, ownerId: priya, url: 'https://discord.gg/comp251-demo', platform: 'Discord', label: 'Study server', isPublic: true },
        { classId: math240, ownerId: samuel, url: 'https://discord.gg/math240-demo', platform: 'Discord', label: 'MATH 240 help', isPublic: true },
      ])
      .run();

    const session = tx
      .insert(studySessions)
      .values({
        classId: comp251,
        hostId: priya,
        title: 'Assignment 2 work session',
        description: 'Going through the dynamic programming questions together. Bring your attempts!',
        location: 'Trottier 3rd floor, room 3120',
        startsAt: at(2, 18),
        endsAt: at(2, 20),
        capacity: 6,
        tag: 'Assignment',
      })
      .returning()
      .get();
    tx.insert(studySessionMembers)
      .values([
        { sessionId: session.id, userId: priya, status: 'going' },
        { sessionId: session.id, userId: alex, status: 'going' },
      ])
      .run();

    const post = tx
      .insert(posts)
      .values({
        classId: comp251,
        authorId: alex,
        topic: 'Assignment 2',
        title: 'Master theorem: which case applies to T(n) = 2T(n/2) + n log n?',
        body: "I keep landing between case 2 and case 3. Does the basic master theorem even cover this one, or do we need the extended version from lecture 6?",
        visibility: 'class',
      })
      .returning()
      .get();
    tx.insert(replies)
      .values({
        postId: post.id,
        authorId: samuel,
        body: "It's the extended case 2: f(n) = Θ(n log n) = Θ(n^(log_b a) · log^1 n), so T(n) = Θ(n log² n).",
      })
      .run();
    tx.insert(postReactions)
      .values([
        { postId: post.id, userId: priya },
        { postId: post.id, userId: samuel },
      ])
      .run();
    tx.insert(posts)
      .values({
        classId: comp251,
        authorId: priya,
        topic: 'Midterm',
        title: 'Is the midterm cumulative up to graphs?',
        body: 'The syllabus says "up to week 6" but week 6 started BFS/DFS. Anyone asked the prof?',
        visibility: 'class',
      })
      .run();
  });
}
