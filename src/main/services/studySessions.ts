import { writeFile } from 'node:fs/promises';
import { and, asc, desc, eq, gte, inArray, isNull, like, lt, ne, or } from 'drizzle-orm';
import { z } from 'zod';
import { goatFor } from '@shared/goat';
import { buildCalendar } from '@shared/ics';
import { randomInt } from '../crypto';
import type { DB } from '../db/client';
import { classes, courses, enrollments, studySessionMembers, studySessions, users } from '../db/schema';
import { AppError, type AuthedContext, idSchema, nonEmpty, procedure } from '../rpc/core';
import { classLabel, classLabels, isMember, notFound, requireMember, sectionCode } from './access';
import { m, type NotifyInput, notify } from './notifications';

// S3 in version B:
// - A session is open to the whole section, or invite-only: then only people with its
//   invite code can see and join it. Members stay hidden (S1), so the host shares the code
//   wherever they like (a group chat, a DM) instead of picking classmates by email.
// - Every session has a size limit. Once it's full, newcomers join a waitlist and move up
//   automatically when someone leaves.
// - In person (a place) or online (a meeting link, shown only to people going).
// - Who's going is visible only to the people going; everyone else sees how many.
// - A host who leaves hands the session to the next person going instead of cancelling it.

export const DEFAULT_CAPACITY = 6;
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

const details = z
  .object({
    title: nonEmpty('Title', 120),
    description: z.string().trim().max(2000),
    format: z.enum(['in-person', 'online']),
    location: z.string().trim().max(200),
    meetingUrl: z.string().trim().max(500),
    startsAt: z.date(),
    endsAt: z.date(),
    capacity: z.number().int().min(2, 'At least 2 people').max(30, 'At most 30 people'),
    visibility: z.enum(['class', 'invite']),
    tag: z.string().trim().max(40).nullable().default(null),
  })
  .refine((s) => s.endsAt > s.startsAt, { message: 'The session must end after it starts', path: ['endsAt'] })
  .refine((s) => s.format === 'online' || s.location, { message: 'Where is it? Add a room or place', path: ['location'] })
  .refine((s) => s.format === 'in-person' || /^https:\/\/\S+\.\S+/.test(s.meetingUrl), {
    message: 'Add the meeting link, starting with https://',
    path: ['meetingUrl'],
  });

type SessionRow = typeof studySessions.$inferSelect;

function newInviteCode() {
  return Array.from({ length: 6 }, () => CODE_ALPHABET[randomInt(0, CODE_ALPHABET.length)]).join('');
}

function getSession(db: DB, sessionId: number) {
  return db.select().from(studySessions).where(eq(studySessions.id, sessionId)).get() ?? notFound('study session');
}

function hostedSession(db: DB, userId: number, sessionId: number) {
  const session = getSession(db, sessionId);
  if (session.hostId !== userId) throw new AppError('Only the host can change this session.', 'FORBIDDEN');
  if (session.cancelledAt) throw new AppError('This session was cancelled.');
  return session;
}

function membersOf(db: DB, sessionId: number) {
  return db
    .select()
    .from(studySessionMembers)
    .where(eq(studySessionMembers.sessionId, sessionId))
    .orderBy(asc(studySessionMembers.createdAt))
    .all();
}

function membership(db: DB, sessionId: number, userId: number) {
  return db
    .select()
    .from(studySessionMembers)
    .where(and(eq(studySessionMembers.sessionId, sessionId), eq(studySessionMembers.userId, userId)))
    .get();
}

// Invite-only sessions are visible to the people in them, and to nobody else in the class.
function canSee(db: DB, userId: number, session: SessionRow) {
  return session.visibility === 'class' || !!membership(db, session.id, userId);
}

// Sessions shaped for the class page and the dashboard.
function describe(db: DB, userId: number, rows: SessionRow[]) {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const members = db
    .select({
      sessionId: studySessionMembers.sessionId,
      userId: users.id,
      name: users.name,
      email: users.email,
      avatar: users.avatar,
      status: studySessionMembers.status,
    })
    .from(studySessionMembers)
    .innerJoin(users, eq(studySessionMembers.userId, users.id))
    .where(inArray(studySessionMembers.sessionId, ids))
    .orderBy(asc(studySessionMembers.createdAt))
    .all();
  const labels = classLabels(db);

  return rows.map((s) => {
    const mine = members.filter((m) => m.sessionId === s.id);
    const going = mine.filter((m) => m.status === 'going');
    const waitlist = mine.filter((m) => m.status === 'waitlisted');
    const myStatus = mine.find((m) => m.userId === userId)?.status ?? null;
    const isHost = s.hostId === userId;
    const attending = myStatus === 'going';
    return {
      ...s,
      // Only the host hands out the code, and only people going get the meeting link.
      inviteCode: isHost ? s.inviteCode : null,
      meetingUrl: attending ? s.meetingUrl : '',
      classLabel: labels.get(s.classId) ?? '',
      hostFirstName: going.find((m) => m.userId === s.hostId)?.name.split(' ')[0] ?? null,
      goingCount: going.length,
      waitlistCount: waitlist.length,
      going: attending
        ? going.map(({ userId, name, email, avatar }) => ({ userId, name, email, goat: goatFor(userId, avatar) }))
        : [],
      myStatus,
      // 1 = next in line for a spot.
      myWaitlistPosition: myStatus === 'waitlisted' ? waitlist.findIndex((m) => m.userId === userId) + 1 : null,
      isHost,
      isFull: going.length >= (s.capacity ?? DEFAULT_CAPACITY),
    };
  });
}

// Fills free spots from the waitlist, first come first served.
function promoteWaitlist(db: DB, session: SessionRow) {
  const members = membersOf(db, session.id);
  let free = (session.capacity ?? DEFAULT_CAPACITY) - members.filter((m) => m.status === 'going').length;
  for (const next of members.filter((m) => m.status === 'waitlisted')) {
    if (free <= 0) break;
    db.update(studySessionMembers)
      .set({ status: 'going' })
      .where(and(eq(studySessionMembers.sessionId, session.id), eq(studySessionMembers.userId, next.userId)))
      .run();
    free--;
    notify(db, next.userId, {
      type: 'session-spot',
      title: m('A spot opened up: you\'re going to "{{title}}"', { title: session.title }),
      body: m('{{class}} · {{when}}', { class: classLabel(db, session.classId) ?? '', when: { date: session.startsAt.getTime() } }),
      link: `/classes/${session.classId}/sessions`,
    });
  }
}

function tellEveryone(db: DB, session: SessionRow, exceptUserId: number, message: NotifyInput) {
  for (const member of membersOf(db, session.id)) {
    if (member.userId !== exceptUserId) notify(db, member.userId, message);
  }
}

function cancelSession(db: DB, session: SessionRow, by: number, now: Date) {
  db.update(studySessions).set({ cancelledAt: now }).where(eq(studySessions.id, session.id)).run();
  tellEveryone(db, session, by, {
    type: 'session-cancelled',
    title: m('"{{title}}" was cancelled', { title: session.title }),
    body: m('{{class}} · was planned for {{when}}', {
      class: classLabel(db, session.classId) ?? '',
      when: { date: session.startsAt.getTime() },
    }),
    link: `/classes/${session.classId}/sessions`,
  });
}

// Leaving: a guest's spot goes to the waitlist; a host passes the session on to whoever
// has been going the longest, and it's only cancelled when nobody else is going.
function leaveSession(ctx: AuthedContext, session: SessionRow) {
  const { db, userId } = ctx;
  db.delete(studySessionMembers)
    .where(and(eq(studySessionMembers.sessionId, session.id), eq(studySessionMembers.userId, userId)))
    .run();
  if (session.cancelledAt || session.endsAt < ctx.now()) return;

  if (session.hostId === userId) {
    const next = membersOf(db, session.id).find((member) => member.status === 'going');
    if (!next) {
      cancelSession(db, session, userId, ctx.now());
      return;
    }
    db.update(studySessions).set({ hostId: next.userId }).where(eq(studySessions.id, session.id)).run();
    notify(db, next.userId, {
      type: 'session-host',
      title: m('You\'re now hosting "{{title}}"', { title: session.title }),
      body: m('The host left, so the session is yours. {{class}} · {{when}}', {
        class: classLabel(db, session.classId) ?? '',
        when: { date: session.startsAt.getTime() },
      }),
      link: `/classes/${session.classId}/sessions`,
    });
  }
  promoteWaitlist(db, session);
}

// S1.3: leaving a class leaves its upcoming sessions too.
export function leaveClassSessions(ctx: AuthedContext, classId: number) {
  const rows = ctx.db
    .select({ session: studySessions })
    .from(studySessions)
    .innerJoin(studySessionMembers, eq(studySessionMembers.sessionId, studySessions.id))
    .where(
      and(
        eq(studySessions.classId, classId),
        eq(studySessionMembers.userId, ctx.userId),
        isNull(studySessions.cancelledAt),
        gte(studySessions.endsAt, ctx.now()),
      ),
    )
    .all();
  for (const { session } of rows) leaveSession(ctx, session);
}

function joinSession(ctx: AuthedContext, session: SessionRow) {
  if (session.cancelledAt) throw new AppError('This session was cancelled.');
  if (session.endsAt < ctx.now()) throw new AppError('This session has already ended.');
  const current = membership(ctx.db, session.id, ctx.userId);
  if (current?.status === 'going') throw new AppError("You're already going.", 'CONFLICT');
  if (current?.status === 'waitlisted') throw new AppError("You're already on the waitlist.", 'CONFLICT');
  const [described] = describe(ctx.db, ctx.userId, [session]);
  const status = described.isFull ? ('waitlisted' as const) : ('going' as const);
  ctx.db.insert(studySessionMembers).values({ sessionId: session.id, userId: ctx.userId, status }).run();
  return { status };
}

export const studySessionsRouter = {
  // S3.2: the section's open sessions, plus invite-only ones you're in.
  list: procedure(z.object({ classId: idSchema }), ({ classId }, ctx) => {
    requireMember(ctx.db, ctx.userId, classId);
    const rows = ctx.db
      .select()
      .from(studySessions)
      .where(and(eq(studySessions.classId, classId), gte(studySessions.endsAt, ctx.now())))
      .orderBy(asc(studySessions.startsAt))
      .all()
      .filter((s) => canSee(ctx.db, ctx.userId, s));
    return describe(ctx.db, ctx.userId, rows);
  }),

  // S3.2: the section's sessions from the last month that are over, newest first.
  past: procedure(z.object({ classId: idSchema }), ({ classId }, ctx) => {
    requireMember(ctx.db, ctx.userId, classId);
    const now = ctx.now();
    const rows = ctx.db
      .select()
      .from(studySessions)
      .where(
        and(
          eq(studySessions.classId, classId),
          lt(studySessions.endsAt, now),
          gte(studySessions.endsAt, new Date(now.getTime() - 30 * 86_400_000)),
          isNull(studySessions.cancelledAt),
        ),
      )
      .orderBy(desc(studySessions.startsAt))
      .limit(20)
      .all()
      .filter((s) => canSee(ctx.db, ctx.userId, s));
    return describe(ctx.db, ctx.userId, rows);
  }),

  // Upcoming sessions you're going to or waiting for, across classes.
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

  // "Search for study sessions": open sessions in any of the student's classes.
  browse: procedure(z.object({ search: z.string().trim().max(100) }), ({ search }, ctx) => {
    const classIds = ctx.db.select({ id: enrollments.classId }).from(enrollments).where(eq(enrollments.userId, ctx.userId));
    const term = `%${search}%`;
    const rows = ctx.db
      .select({ session: studySessions })
      .from(studySessions)
      .innerJoin(classes, eq(studySessions.classId, classes.id))
      .innerJoin(courses, eq(classes.courseId, courses.id))
      .where(
        and(
          inArray(studySessions.classId, classIds),
          gte(studySessions.endsAt, ctx.now()),
          isNull(studySessions.cancelledAt),
          search
            ? or(like(studySessions.title, term), like(studySessions.tag, term), like(studySessions.location, term), like(sectionCode, term))
            : undefined,
        ),
      )
      .orderBy(asc(studySessions.startsAt))
      .all()
      .map((r) => r.session)
      .filter((s) => canSee(ctx.db, ctx.userId, s));
    return describe(ctx.db, ctx.userId, rows);
  }),

  // S3.1
  create: procedure(z.object({ classId: idSchema }).and(details), ({ classId, ...input }, ctx) => {
    requireMember(ctx.db, ctx.userId, classId);
    if (input.startsAt < ctx.now()) throw new AppError('Pick a start time in the future.');
    return ctx.db.transaction((tx) => {
      const session = tx
        .insert(studySessions)
        .values({
          ...input,
          location: input.format === 'online' ? '' : input.location,
          meetingUrl: input.format === 'online' ? input.meetingUrl : '',
          classId,
          hostId: ctx.userId,
          inviteCode: newInviteCode(),
        })
        .returning({ id: studySessions.id, inviteCode: studySessions.inviteCode })
        .get();
      tx.insert(studySessionMembers).values({ sessionId: session.id, userId: ctx.userId, status: 'going' }).run();
      return session;
    });
  }),

  // S3.5: moving the time or place tells everyone in it. More room lets the waitlist in.
  update: procedure(z.object({ sessionId: idSchema }).and(details), ({ sessionId, ...input }, ctx) => {
    const before = hostedSession(ctx.db, ctx.userId, sessionId);
    const fields = {
      ...input,
      location: input.format === 'online' ? '' : input.location,
      meetingUrl: input.format === 'online' ? input.meetingUrl : '',
    };
    const going = membersOf(ctx.db, sessionId).filter((member) => member.status === 'going').length;
    if (fields.capacity < going) {
      throw new AppError('{{count}} people are already going. Pick a limit of at least that.', 'BAD_INPUT', { count: going });
    }
    ctx.db.update(studySessions).set(fields).where(eq(studySessions.id, sessionId)).run();
    const after = getSession(ctx.db, sessionId);
    const moved =
      before.startsAt.getTime() !== after.startsAt.getTime() ||
      before.endsAt.getTime() !== after.endsAt.getTime() ||
      before.location !== after.location ||
      before.meetingUrl !== after.meetingUrl;
    if (moved) {
      tellEveryone(ctx.db, after, ctx.userId, {
        type: 'session-changed',
        title: m('"{{title}}" changed', { title: after.title }),
        body: m('Now {{when}} · {{place}}', {
          when: { date: after.startsAt.getTime() },
          place: after.format === 'online' ? { t: 'Online' } : after.location,
        }),
        link: `/classes/${after.classId}/sessions`,
      });
    }
    promoteWaitlist(ctx.db, after);
  }),

  cancel: procedure(z.object({ sessionId: idSchema }), ({ sessionId }, ctx) => {
    const session = hostedSession(ctx.db, ctx.userId, sessionId);
    cancelSession(ctx.db, session, ctx.userId, ctx.now());
  }),

  // S3.3: joining an open session. When it's full you go on the waitlist.
  join: procedure(z.object({ sessionId: idSchema }), ({ sessionId }, ctx) => {
    const session = getSession(ctx.db, sessionId);
    requireMember(ctx.db, ctx.userId, session.classId);
    if (!canSee(ctx.db, ctx.userId, session)) notFound('study session');
    return joinSession(ctx, session);
  }),

  // G2: one session as an .ics file for Google Calendar (or any calendar app), for people
  // going or waiting. The meeting link goes in only for people going, as on the page.
  exportIcs: procedure(z.object({ sessionId: idSchema }), async ({ sessionId }, ctx) => {
    const session = getSession(ctx.db, sessionId);
    const status = membership(ctx.db, sessionId, ctx.userId)?.status;
    if (!status || session.cancelledAt) throw new AppError('Join the session to add it to your calendar.');
    const target = await ctx.platform.chooseSaveLocation({
      title: 'Add to calendar',
      defaultPath: 'study-session.ics',
      filters: [{ name: 'iCalendar', extensions: ['ics'] }],
    });
    if (!target) return null;
    const link = status === 'going' ? session.meetingUrl : '';
    const ics = buildCalendar(
      [
        {
          uid: `session-${session.id}@unilink`,
          title: session.title,
          start: session.startsAt,
          end: session.endsAt,
          location: session.format === 'online' ? link : session.location,
          description: [classLabel(ctx.db, session.classId), session.description, link].filter(Boolean).join('\n\n'),
        },
      ],
      Intl.DateTimeFormat().resolvedOptions().timeZone,
    );
    await writeFile(target, ics, 'utf8');
    return { path: target };
  }),

  // S3.4: the invite code works for open and invite-only sessions alike.
  joinByCode: procedure(z.object({ code: z.string().trim().toUpperCase().min(1, 'Enter the invite code') }), ({ code }, ctx) => {
    const session = ctx.db
      .select()
      .from(studySessions)
      .where(and(eq(studySessions.inviteCode, code.replace(/[\s-]/g, '')), ne(studySessions.inviteCode, '')))
      .get();
    if (!session) throw new AppError('No study session has that code. Check it with the host.', 'NOT_FOUND');
    if (!isMember(ctx.db, ctx.userId, session.classId)) {
      throw new AppError('This session is for {{class}}. Join that class first.', 'FORBIDDEN', {
        class: classLabel(ctx.db, session.classId) ?? '',
      });
    }
    return { ...joinSession(ctx, session), classId: session.classId, title: session.title };
  }),

  // A new code stops the old one from working (for invite-only sessions shared too widely).
  newCode: procedure(z.object({ sessionId: idSchema }), ({ sessionId }, ctx) => {
    hostedSession(ctx.db, ctx.userId, sessionId);
    const inviteCode = newInviteCode();
    ctx.db.update(studySessions).set({ inviteCode }).where(eq(studySessions.id, sessionId)).run();
    return { inviteCode };
  }),

  // Leaving, or getting off the waitlist.
  leave: procedure(z.object({ sessionId: idSchema }), ({ sessionId }, ctx) => {
    const session = getSession(ctx.db, sessionId);
    if (!membership(ctx.db, sessionId, ctx.userId)) throw new AppError("You're not in this session.");
    ctx.db.transaction((tx) => leaveSession({ ...ctx, db: tx as unknown as DB }, session));
  }),
};
