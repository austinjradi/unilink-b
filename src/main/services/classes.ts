import { and, asc, count, eq, inArray, isNull, like, ne, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { parseCourseQuery } from '@shared/courseQuery';
import { clashes, type MeetingTime } from '@shared/meetings';
import { TERMS } from '@shared/dates';
import type { DB } from '../db/client';
import { classMeetings, classes, courses, enrollments, postAudience, posts, replies, users } from '../db/schema';
import { AppError, type AuthedContext, idSchema, procedure } from '../rpc/core';
import { isMember, notFound, requireMember, sectionCode } from './access';
import { leaveClassSessions } from './studySessions';

// S1: find class sections, join/leave/switch them, list mine. Also G2's course catalogue.

const memberCount = sql<number>`(select count(*) from ${enrollments} where ${enrollments.classId} = ${classes.id})`.mapWith(
  Number,
);

const classColumns = {
  id: classes.id,
  courseId: classes.courseId,
  term: classes.term,
  section: classes.section,
  code: sectionCode,
  subject: courses.subject,
  number: courses.number,
  title: courses.title,
  credits: courses.credits,
  memberCount,
};

function classRows(db: DB) {
  return db.select(classColumns).from(classes).innerJoin(courses, eq(classes.courseId, courses.id));
}

// Version B follows the board's note to the letter: a classmate's name, email, pronouns
// and faculty become visible only once they've posted or replied where you can see it.
// Joining a study session doesn't reveal anyone.
export function visibleClassmates(db: DB, userId: number, classId: number) {
  const visiblePosts = db
    .select({ id: posts.id })
    .from(posts)
    .where(
      and(
        eq(posts.classId, classId),
        or(
          eq(posts.visibility, 'class'),
          eq(posts.authorId, userId),
          inArray(
            posts.id,
            db.select({ id: postAudience.postId }).from(postAudience).where(eq(postAudience.userId, userId)),
          ),
        ),
      ),
    );
  const ids = new Set<number>();
  for (const r of db
    .select({ id: posts.authorId })
    .from(posts)
    .where(and(inArray(posts.id, visiblePosts), isNull(posts.deletedAt)))
    .all())
    ids.add(r.id);
  for (const r of db.select({ id: replies.authorId }).from(replies).where(inArray(replies.postId, visiblePosts)).all())
    ids.add(r.id);
  ids.delete(userId);
  if (!ids.size) return [];

  return db
    .select({ id: users.id, name: users.name, email: users.email, pronouns: users.pronouns, faculty: users.faculty })
    .from(users)
    .innerJoin(enrollments, and(eq(enrollments.userId, users.id), eq(enrollments.classId, classId)))
    .where(inArray(users.id, [...ids]))
    .orderBy(asc(users.name))
    .all();
}

// The section of the same course and term the student is already in, if any.
function sameCourseSection(db: DB, userId: number, classId: number) {
  const target = db.select().from(classes).where(eq(classes.id, classId)).get() ?? notFound('class');
  const current = db
    .select({ id: classes.id, code: sectionCode })
    .from(enrollments)
    .innerJoin(classes, eq(enrollments.classId, classes.id))
    .innerJoin(courses, eq(classes.courseId, courses.id))
    .where(
      and(
        eq(enrollments.userId, userId),
        eq(classes.courseId, target.courseId),
        eq(classes.term, target.term),
        ne(classes.id, classId),
      ),
    )
    .get();
  return { target, current: current ?? null };
}

// Each section's class times (shared by its classmates), and which of the student's other
// classes that term they clash with. Another section of the same course doesn't count:
// switching to this one replaces it.
function schedules(db: DB, userId: number, sections: { id: number; courseId: number; term: string }[]) {
  const terms = [...new Set(sections.map((s) => s.term))];
  const mine = terms.length
    ? db
        .select({ id: classes.id, courseId: classes.courseId, term: classes.term, code: sectionCode })
        .from(enrollments)
        .innerJoin(classes, eq(enrollments.classId, classes.id))
        .innerJoin(courses, eq(classes.courseId, courses.id))
        .where(and(eq(enrollments.userId, userId), inArray(classes.term, terms)))
        .all()
    : [];
  const ids = [...new Set([...sections.map((s) => s.id), ...mine.map((c) => c.id)])];
  const times = new Map<number, MeetingTime[]>();
  if (ids.length) {
    for (const m of db
      .select({ classId: classMeetings.classId, weekday: classMeetings.weekday, startTime: classMeetings.startTime, endTime: classMeetings.endTime })
      .from(classMeetings)
      .where(inArray(classMeetings.classId, ids))
      .orderBy(asc(classMeetings.weekday), asc(classMeetings.startTime))
      .all()) {
      const { classId, ...time } = m;
      times.set(classId, [...(times.get(classId) ?? []), time]);
    }
  }
  return (s: { id: number; courseId: number; term: string }) => {
    const own = times.get(s.id) ?? [];
    return {
      times: own,
      clashesWith: mine
        .filter((c) => c.term === s.term && c.courseId !== s.courseId && clashes(own, times.get(c.id) ?? []))
        .map((c) => c.code),
    };
  };
}

// S1.3: your own notes, grades and private deadlines are kept in case you rejoin. What you
// added to the section's shared info (class times, deadlines, grading scheme) stays with it.
function leaveClass(ctx: AuthedContext, classId: number) {
  ctx.db.transaction((tx) => {
    leaveClassSessions({ ...ctx, db: tx as unknown as DB }, classId);
    tx.delete(enrollments).where(and(eq(enrollments.userId, ctx.userId), eq(enrollments.classId, classId))).run();
  });
}

export const catalogueRouter = {
  terms: procedure(z.void(), () => [...TERMS]),

  stats: procedure(z.void(), (_input, ctx) => ({
    courses: ctx.db.select({ n: count() }).from(courses).get()?.n ?? 0,
    sections: ctx.db.select({ n: count() }).from(classes).get()?.n ?? 0,
    terms: [...TERMS],
  })),

  // S1.1: course codes with wildcards ("COMP 2XX"), or words from the title, filtered by
  // term and course level. One row per section.
  search: procedure(
    z.object({ query: z.string().trim().max(100), term: z.string(), level: z.number().int().nullable() }),
    ({ query, term, level }, ctx) => {
      const parsed = parseCourseQuery(query);
      const mine = new Map(
        ctx.db
          .select({ classId: enrollments.classId, courseId: classes.courseId, term: classes.term })
          .from(enrollments)
          .innerJoin(classes, eq(enrollments.classId, classes.id))
          .where(eq(enrollments.userId, ctx.userId))
          .all()
          .map((r) => [`${r.courseId}|${r.term}`, r.classId]),
      );
      const match =
        parsed.kind === 'code'
          ? and(parsed.subject ? eq(courses.subject, parsed.subject) : undefined, like(courses.number, parsed.number))
          : parsed.words.length
            ? or(
                parsed.subject ? eq(courses.subject, parsed.subject) : undefined,
                and(...parsed.words.map((w) => sql`lower(${courses.title}) like ${`%${w}%`}`)),
              )
            : undefined;
      const rows = classRows(ctx.db)
        .where(and(eq(classes.term, term), level ? like(courses.number, `${String(level)[0]}__`) : undefined, match))
        .orderBy(courses.subject, courses.number, classes.section)
        .limit(80)
        .all();
      const schedule = schedules(ctx.db, ctx.userId, rows);
      return rows.map((c) => {
        const inCourse = mine.get(`${c.courseId}|${c.term}`) ?? null;
        return { ...c, ...schedule(c), joined: inCourse === c.id, otherSectionId: inCourse !== c.id ? inCourse : null };
      });
    },
  ),
};

export const classesRouter = {
  // S1.4
  mine: procedure(z.void(), (_input, ctx) =>
    classRows(ctx.db)
      .innerJoin(enrollments, and(eq(enrollments.classId, classes.id), eq(enrollments.userId, ctx.userId)))
      .orderBy(classes.term, courses.subject, courses.number, classes.section)
      .all(),
  ),

  get: procedure(z.object({ classId: idSchema }), ({ classId }, ctx) => {
    const row = classRows(ctx.db).where(eq(classes.id, classId)).get() ?? notFound('class');
    const otherSection = sameCourseSection(ctx.db, ctx.userId, classId).current;
    const sectionRows = classRows(ctx.db)
      .where(and(eq(classes.courseId, row.courseId), eq(classes.term, row.term)))
      .orderBy(classes.section)
      .all();
    const schedule = schedules(ctx.db, ctx.userId, sectionRows);
    const sections = sectionRows.map((s) => ({ id: s.id, section: s.section, memberCount: s.memberCount, ...schedule(s) }));
    return { ...row, ...schedule(row), joined: isMember(ctx.db, ctx.userId, classId), otherSection, sections };
  }),

  // S1.2: many classes, each once, and only one section of a course per term.
  join: procedure(z.object({ classId: idSchema }), ({ classId }, ctx) => {
    const { current } = sameCourseSection(ctx.db, ctx.userId, classId);
    if (isMember(ctx.db, ctx.userId, classId)) throw new AppError("You're already in this class.", 'CONFLICT');
    if (current) {
      throw new AppError("You're already in {{code}}. Switch sections instead.", 'CONFLICT', { code: current.code });
    }
    ctx.db.insert(enrollments).values({ userId: ctx.userId, classId }).run();
  }),

  // Moving to another section of the same course: leave one, join the other.
  switchSection: procedure(z.object({ classId: idSchema }), ({ classId }, ctx) => {
    const { current } = sameCourseSection(ctx.db, ctx.userId, classId);
    if (!current) throw new AppError("You're not in another section of this course.");
    leaveClass(ctx, current.id);
    ctx.db.insert(enrollments).values({ userId: ctx.userId, classId }).run();
  }),

  leave: procedure(z.object({ classId: idSchema }), ({ classId }, ctx) => {
    requireMember(ctx.db, ctx.userId, classId);
    leaveClass(ctx, classId);
  }),

  classmates: procedure(z.object({ classId: idSchema }), ({ classId }, ctx) => {
    requireMember(ctx.db, ctx.userId, classId);
    return visibleClassmates(ctx.db, ctx.userId, classId);
  }),
};

// Resolves classmates picked by email (S4 selected audiences).
export function enrolledUsersByEmail(db: DB, classId: number, emails: string[]) {
  const wanted = [...new Set(emails.map((e) => e.trim().toLowerCase()))];
  if (!wanted.length) return [];
  const found = db
    .select({ id: users.id, email: users.email })
    .from(users)
    .innerJoin(enrollments, and(eq(enrollments.userId, users.id), eq(enrollments.classId, classId)))
    .where(inArray(users.email, wanted))
    .all();
  const missing = wanted.filter((e) => !found.some((f) => f.email === e));
  if (missing.length) throw new AppError('Not in this class: {{emails}}', 'NOT_FOUND', { emails: missing.join(', ') });
  return found;
}
