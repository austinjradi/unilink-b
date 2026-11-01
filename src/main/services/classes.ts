import { and, asc, count, eq, inArray, isNull, ne, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { TERMS } from '@shared/dates';
import type { DB } from '../db/client';
import {
  classes,
  courses,
  enrollments,
  postAudience,
  posts,
  replies,
  studySessionMembers,
  studySessions,
  users,
} from '../db/schema';
import { AppError, idSchema, procedure } from '../rpc/core';
import { isMember, notFound, requireMember } from './access';

// S1: find classes, join/leave them, list mine. Also G2's course catalogue.

const memberCount = sql<number>`(select count(*) from ${enrollments} where ${enrollments.classId} = ${classes.id})`.mapWith(
  Number,
);

const classColumns = {
  id: classes.id,
  term: classes.term,
  subject: courses.subject,
  number: courses.number,
  title: courses.title,
  credits: courses.credits,
  memberCount,
};

function classRows(db: DB) {
  return db.select(classColumns).from(classes).innerJoin(courses, eq(classes.courseId, courses.id));
}

// Classmates stay anonymous until they interact: their name and email only
// become visible to you once they've posted or replied where you can see it,
// or joined one of the class's study sessions.
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
  for (const r of db.select({ id: posts.authorId }).from(posts).where(inArray(posts.id, visiblePosts)).all()) ids.add(r.id);
  for (const r of db.select({ id: replies.authorId }).from(replies).where(inArray(replies.postId, visiblePosts)).all())
    ids.add(r.id);
  for (const r of db
    .select({ id: studySessionMembers.userId })
    .from(studySessionMembers)
    .innerJoin(studySessions, eq(studySessionMembers.sessionId, studySessions.id))
    .where(and(eq(studySessions.classId, classId), eq(studySessionMembers.status, 'going')))
    .all())
    ids.add(r.id);
  ids.delete(userId);
  if (!ids.size) return [];

  return db
    .select({ id: users.id, name: users.name, email: users.email })
    .from(users)
    .innerJoin(enrollments, and(eq(enrollments.userId, users.id), eq(enrollments.classId, classId)))
    .where(inArray(users.id, [...ids]))
    .orderBy(asc(users.name))
    .all();
}

export const catalogueRouter = {
  terms: procedure(z.void(), () => [...TERMS]),

  subjects: procedure(z.void(), (_input, ctx) =>
    ctx.db
      .selectDistinct({ subject: courses.subject })
      .from(courses)
      .orderBy(courses.subject)
      .all()
      .map((r) => r.subject),
  ),

  stats: procedure(z.void(), (_input, ctx) => ({
    courses: ctx.db.select({ n: count() }).from(courses).get()?.n ?? 0,
    terms: [...TERMS],
  })),

  // S1.1: search by course code ("COMP 251", "comp251") or by name, with filters.
  search: procedure(
    z.object({ query: z.string().trim().max(100), term: z.string(), subject: z.string().nullable() }),
    ({ query, term, subject }, ctx) => {
      const compact = `%${query.replace(/\s+/g, '').toLowerCase()}%`;
      const words = `%${query.toLowerCase()}%`;
      const mine = new Set(
        ctx.db
          .select({ classId: enrollments.classId })
          .from(enrollments)
          .where(eq(enrollments.userId, ctx.userId))
          .all()
          .map((r) => r.classId),
      );
      return classRows(ctx.db)
        .where(
          and(
            eq(classes.term, term),
            subject ? eq(courses.subject, subject) : undefined,
            query
              ? or(
                  sql`lower(${courses.subject} || ${courses.number}) like ${compact}`,
                  sql`lower(${courses.title}) like ${words}`,
                )
              : undefined,
          ),
        )
        .orderBy(courses.subject, courses.number)
        .limit(60)
        .all()
        .map((c) => ({ ...c, joined: mine.has(c.id) }));
    },
  ),
};

export const classesRouter = {
  // S1.4
  mine: procedure(z.void(), (_input, ctx) =>
    classRows(ctx.db)
      .innerJoin(enrollments, and(eq(enrollments.classId, classes.id), eq(enrollments.userId, ctx.userId)))
      .orderBy(classes.term, courses.subject, courses.number)
      .all(),
  ),

  get: procedure(z.object({ classId: idSchema }), ({ classId }, ctx) => {
    const row = classRows(ctx.db).where(eq(classes.id, classId)).get() ?? notFound('class');
    return { ...row, joined: isMember(ctx.db, ctx.userId, classId) };
  }),

  // S1.2: a student can join many classes, but each one only once.
  join: procedure(z.object({ classId: idSchema }), ({ classId }, ctx) => {
    if (!ctx.db.select({ id: classes.id }).from(classes).where(eq(classes.id, classId)).get()) notFound('class');
    if (isMember(ctx.db, ctx.userId, classId)) throw new AppError("You're already in this class.", 'CONFLICT');
    ctx.db.insert(enrollments).values({ userId: ctx.userId, classId }).run();
  }),

  // S1.3: your own notes, grades and class times for the class are kept in case you rejoin.
  leave: procedure(z.object({ classId: idSchema }), ({ classId }, ctx) => {
    requireMember(ctx.db, ctx.userId, classId);
    ctx.db.transaction((tx) => {
      tx.delete(enrollments).where(and(eq(enrollments.userId, ctx.userId), eq(enrollments.classId, classId))).run();
      // Pending invitations to this class's sessions no longer make sense.
      tx.delete(studySessionMembers)
        .where(
          and(
            eq(studySessionMembers.userId, ctx.userId),
            inArray(
              studySessionMembers.sessionId,
              tx
                .select({ id: studySessions.id })
                .from(studySessions)
                .where(and(eq(studySessions.classId, classId), ne(studySessions.hostId, ctx.userId))),
            ),
          ),
        )
        .run();
      // Sessions you were hosting can't go ahead without you.
      tx.update(studySessions)
        .set({ cancelledAt: ctx.now() })
        .where(
          and(
            eq(studySessions.classId, classId),
            eq(studySessions.hostId, ctx.userId),
            isNull(studySessions.cancelledAt),
          ),
        )
        .run();
    });
  }),

  classmates: procedure(z.object({ classId: idSchema }), ({ classId }, ctx) => {
    requireMember(ctx.db, ctx.userId, classId);
    return visibleClassmates(ctx.db, ctx.userId, classId);
  }),
};

// Resolves classmates picked by email (S3 invites, S4 selected audiences).
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
