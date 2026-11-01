import { and, asc, eq, gte, inArray, isNull } from 'drizzle-orm';
import { z } from 'zod';
import type { DB } from '../db/client';
import { classes, courses, studySessionMembers, studySessions, users } from '../db/schema';
import { AppError, idSchema, nonEmpty, procedure } from '../rpc/core';
import { fmtWhen } from '@shared/dates';
import { classLabel, notFound, requireMember } from './access';
import { enrolledUsersByEmail } from './classes';
import { notify } from './notifications';

// S3: host, join and invite classmates to study sessions.

const details = z
  .object({
    title: nonEmpty('Title', 120),
    description: z.string().trim().max(2000),
    location: nonEmpty('Location', 200),
    startsAt: z.date(),
    endsAt: z.date(),
    capacity: z.number().int().min(2).max(500).nullable(),
  })
  .refine((s) => s.endsAt > s.startsAt, { message: 'The session must end after it starts', path: ['endsAt'] });

function getSession(db: DB, sessionId: number) {
  return db.select().from(studySessions).where(eq(studySessions.id, sessionId)).get() ?? notFound('study session');
}

function hostedSession(db: DB, userId: number, sessionId: number) {
  const session = getSession(db, sessionId);
  if (session.hostId !== userId) throw new AppError('Only the host can change this session.', 'FORBIDDEN');
  if (session.cancelledAt) throw new AppError('This session was cancelled.');
  return session;
}

function membership(db: DB, sessionId: number, userId: number) {
  return db
    .select()
    .from(studySessionMembers)
    .where(and(eq(studySessionMembers.sessionId, sessionId), eq(studySessionMembers.userId, userId)))
    .get();
}

// Sessions plus who's going, shaped for the class page and the dashboard.
function describe(db: DB, userId: number, rows: (typeof studySessions.$inferSelect)[]) {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const members = db
    .select({
      sessionId: studySessionMembers.sessionId,
      userId: users.id,
      name: users.name,
      email: users.email,
      status: studySessionMembers.status,
    })
    .from(studySessionMembers)
    .innerJoin(users, eq(studySessionMembers.userId, users.id))
    .where(inArray(studySessionMembers.sessionId, ids))
    .orderBy(asc(users.name))
    .all();
  const labels = new Map(
    db
      .select({ id: classes.id, subject: courses.subject, number: courses.number })
      .from(classes)
      .innerJoin(courses, eq(classes.courseId, courses.id))
      .where(inArray(classes.id, [...new Set(rows.map((r) => r.classId))]))
      .all()
      .map((c) => [c.id, `${c.subject} ${c.number}`]),
  );

  return rows.map((s) => {
    const mine = members.filter((m) => m.sessionId === s.id);
    const going = mine.filter((m) => m.status === 'going');
    return {
      ...s,
      classLabel: labels.get(s.classId) ?? '',
      host: going.find((m) => m.userId === s.hostId) ?? null,
      going: going.map(({ userId, name, email }) => ({ userId, name, email })),
      invitedCount: mine.length - going.length,
      myStatus: mine.find((m) => m.userId === userId)?.status ?? null,
      isHost: s.hostId === userId,
      isFull: s.capacity != null && going.length >= s.capacity,
    };
  });
}

export const studySessionsRouter = {
  // S3.2
  list: procedure(z.object({ classId: idSchema }), ({ classId }, ctx) => {
    requireMember(ctx.db, ctx.userId, classId);
    const rows = ctx.db
      .select()
      .from(studySessions)
      .where(and(eq(studySessions.classId, classId), gte(studySessions.endsAt, ctx.now())))
      .orderBy(asc(studySessions.startsAt))
      .all();
    return describe(ctx.db, ctx.userId, rows);
  }),

  // Upcoming sessions you're going to or invited to, across classes.
  mine: procedure(z.void(), (_input, ctx) => {
    const sessionIds = ctx.db
      .select({ id: studySessionMembers.sessionId })
      .from(studySessionMembers)
      .where(eq(studySessionMembers.userId, ctx.userId));
    const mine = ctx.db
      .select()
      .from(studySessions)
      .where(
        and(inArray(studySessions.id, sessionIds), gte(studySessions.endsAt, ctx.now()), isNull(studySessions.cancelledAt)),
      )
      .orderBy(asc(studySessions.startsAt))
      .all();
    return describe(ctx.db, ctx.userId, mine);
  }),

  // S3.1
  create: procedure(z.object({ classId: idSchema }).and(details), ({ classId, ...input }, ctx) => {
    requireMember(ctx.db, ctx.userId, classId);
    if (input.startsAt < ctx.now()) throw new AppError('Pick a start time in the future.');
    return ctx.db.transaction((tx) => {
      const session = tx
        .insert(studySessions)
        .values({ ...input, classId, hostId: ctx.userId })
        .returning({ id: studySessions.id })
        .get();
      tx.insert(studySessionMembers).values({ sessionId: session.id, userId: ctx.userId, status: 'going' }).run();
      return session;
    });
  }),

  // S3.5
  update: procedure(z.object({ sessionId: idSchema }).and(details), ({ sessionId, ...input }, ctx) => {
    hostedSession(ctx.db, ctx.userId, sessionId);
    ctx.db.update(studySessions).set(input).where(eq(studySessions.id, sessionId)).run();
  }),

  cancel: procedure(z.object({ sessionId: idSchema }), ({ sessionId }, ctx) => {
    const session = hostedSession(ctx.db, ctx.userId, sessionId);
    ctx.db.update(studySessions).set({ cancelledAt: ctx.now() }).where(eq(studySessions.id, sessionId)).run();
    const members = ctx.db
      .select({ userId: studySessionMembers.userId })
      .from(studySessionMembers)
      .where(eq(studySessionMembers.sessionId, sessionId))
      .all();
    for (const m of members) {
      if (m.userId === ctx.userId) continue;
      notify(ctx.db, m.userId, {
        type: 'session-cancelled',
        title: `"${session.title}" was cancelled`,
        body: `${classLabel(ctx.db, session.classId) ?? ''} · was planned for ${fmtWhen(session.startsAt)}`,
        link: `/classes/${session.classId}/sessions`,
      });
    }
  }),

  // S3.3: also how an invitation is accepted.
  join: procedure(z.object({ sessionId: idSchema }), ({ sessionId }, ctx) => {
    const session = getSession(ctx.db, sessionId);
    requireMember(ctx.db, ctx.userId, session.classId);
    if (session.cancelledAt) throw new AppError('This session was cancelled.');
    if (session.endsAt < ctx.now()) throw new AppError('This session has already ended.');
    const [described] = describe(ctx.db, ctx.userId, [session]);
    if (described.myStatus === 'going') throw new AppError("You're already going.", 'CONFLICT');
    if (described.isFull) throw new AppError('This session is full.', 'CONFLICT');
    ctx.db
      .insert(studySessionMembers)
      .values({ sessionId, userId: ctx.userId, status: 'going' })
      .onConflictDoUpdate({
        target: [studySessionMembers.sessionId, studySessionMembers.userId],
        set: { status: 'going' },
      })
      .run();
  }),

  // Leaving, or declining an invitation.
  leave: procedure(z.object({ sessionId: idSchema }), ({ sessionId }, ctx) => {
    const session = getSession(ctx.db, sessionId);
    if (session.hostId === ctx.userId) throw new AppError("Hosts can't leave. Cancel the session instead.");
    ctx.db
      .delete(studySessionMembers)
      .where(and(eq(studySessionMembers.sessionId, sessionId), eq(studySessionMembers.userId, ctx.userId)))
      .run();
  }),

  // S3.4: anyone going can invite classmates by McGill email.
  invite: procedure(
    z.object({ sessionId: idSchema, emails: z.array(z.string()).min(1, 'Add at least one email') }),
    ({ sessionId, emails }, ctx) => {
      const session = getSession(ctx.db, sessionId);
      if (session.cancelledAt) throw new AppError('This session was cancelled.');
      if (membership(ctx.db, sessionId, ctx.userId)?.status !== 'going') {
        throw new AppError('Join the session before inviting others.', 'FORBIDDEN');
      }
      const invitees = enrolledUsersByEmail(ctx.db, session.classId, emails).filter((u) => u.id !== ctx.userId);
      const fresh = invitees.filter((u) => !membership(ctx.db, sessionId, u.id));
      if (fresh.length) {
        ctx.db
          .insert(studySessionMembers)
          .values(fresh.map((u) => ({ sessionId, userId: u.id, status: 'invited' as const, invitedById: ctx.userId })))
          .run();
        const inviter = ctx.db.select({ name: users.name }).from(users).where(eq(users.id, ctx.userId)).get()?.name;
        for (const u of fresh) {
          notify(ctx.db, u.id, {
            type: 'session-invite',
            title: `${inviter ?? 'A classmate'} invited you to "${session.title}"`,
            body: `${classLabel(ctx.db, session.classId) ?? ''} · ${fmtWhen(session.startsAt)} · ${session.location}`,
            link: `/classes/${session.classId}/sessions`,
          });
        }
      }
      return { invited: fresh.length, alreadyIn: invitees.length - fresh.length };
    },
  ),
};
