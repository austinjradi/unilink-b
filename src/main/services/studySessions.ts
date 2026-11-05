import { writeFile } from 'node:fs/promises';
import { and, asc, desc, eq, gte, inArray, isNull, like, lt, ne, or } from 'drizzle-orm';
import { z } from 'zod';
import { goatFor } from '@shared/goat';
import { buildCalendar } from '@shared/ics';
import { isOn } from '@shared/variants';
import { randomInt } from '../crypto';
import type { DB } from '../db/client';
import { classes, courses, enrollments, studySessionMembers, studySessions, users } from '../db/schema';
import { AppError, type AuthedContext, idSchema, nonEmpty, procedure } from '../rpc/core';
import { classLabel, classLabels, isMember, isProfessor, notFound, requireMember, sameCourseSections, sectionCode } from './access';
import { busyChecker } from './calendar';
import { m, type NotifyInput, notify, raw } from './notifications';
import { read, write } from './variantData';

// S3 in version B:
// - A session is open to the whole section, or invite-only: then only people with its
//   invite code can see and join it. Members stay hidden (S1), so the host shares the code
//   wherever they like (a group chat, a DM) instead of picking classmates by email.
// - Every session has a size limit. Once it's full, newcomers join a waitlist and move up
//   automatically when someone leaves.
// - In person (a place) or online (a meeting link, shown only to people going).
// - Who's going is visible only to the people going; everyone else sees how many.
// - A host who leaves hands the session to the next person going instead of cancelling it.
// - A session can repeat weekly. The weeks share one invite code, which joins all the
//   upcoming ones; each week otherwise works like a session of its own.

export const DEFAULT_CAPACITY = 6;
// Like recovery codes: no I, O, 0 or 1, which are easy to mistype.
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

// The session fields, shared by create and update. Each .refine() is a check across several
// fields; its `path` names the field the error belongs to, so the form shows it there.
const details = z
  .object({
    title: nonEmpty('Title', 120),
    description: z.string().trim().max(2000),
    format: z.enum(['in-person', 'online']),
    location: z.string().trim().max(200),
    meetingUrl: z.string().trim().max(500),
    startsAt: z.date(),
    endsAt: z.date(),
    // Null only with 'optional-session-limit'.
    capacity: z.number().int().min(2, 'At least 2 people').max(30, 'At most 30 people').nullable(),
    visibility: z.enum(['class', 'invite']),
    tag: z.string().trim().max(40).nullable().default(null),
  })
  .refine((s) => s.endsAt > s.startsAt, { message: 'The session must end after it starts', path: ['endsAt'] })
  .refine((s) => s.format === 'online' || s.location, { message: 'Where is it? Add a room or place', path: ['location'] })
  .refine((s) => s.format === 'in-person' || /^https:\/\/\S+\.\S+/.test(s.meetingUrl), {
    message: 'Add the meeting link, starting with https://',
    path: ['meetingUrl'],
  });

// A whole study_sessions row.
type SessionRow = typeof studySessions.$inferSelect;

// Switches stay in English, so these aren't written where the French check would ask for a translation.
const SESSION_FULL = 'This session is full.';
const ALREADY_ASKED = 'You already asked to join. The host will decide.';
const CODE_EXPIRED = 'That invite code has expired. Ask the host for a new one.';
const HOST_STAYS = "Hosts can't leave a session. Cancel it instead.";
const NOT_IN_CLASS = "That person isn't in this class.";
const NO_SPOT_OFFERED = 'There is no spot waiting for you.';
const NOT_GOING = 'Only people going can do this.';
const NEEDS_LIMIT = 'At least 2 people';

// 'session-codes-expire': how long a code lasts.
const CODE_LASTS = 7 * 86_400_000;

// What people add under a switch, kept per session.
const offersKey = (id: number) => `variant-session-offers-${id}`;
const invitesKey = (id: number) => `variant-session-invites-${id}`;
const chatKey = (id: number) => `variant-session-chat-${id}`;
const suggestionsKey = (id: number) => `variant-session-suggestions-${id}`;
const codeIssuedKey = (id: number) => `variant-session-code-${id}`;
const goalsKey = (id: number) => `variant-session-goals-${id}`;

const offersOf = (db: DB, id: number) => read<number[]>(db, offersKey(id), []);
const invitesOf = (db: DB, id: number) => read<number[]>(db, invitesKey(id), []);
const chatOf = (db: DB, id: number) => read<{ name: string; body: string; at: number }[]>(db, chatKey(id), []);
const suggestionsOf = (db: DB, id: number) => read<{ id: number; name: string; text: string }[]>(db, suggestionsKey(id), []);
const goalsDone = (db: DB, id: number) => read<number[]>(db, goalsKey(id), []);
// When the code was last issued (or the session created), plus a week.
const codeExpiry = (db: DB, session: SessionRow) => read<number>(db, codeIssuedKey(session.id), session.createdAt.getTime()) + CODE_LASTS;

// Who can join: the class, or more under the switches that open it up.
function canJoinSession(db: DB, userId: number, session: SessionRow) {
  if (isOn('open-to-all-mcgill')) return true;
  if (isOn('session-several-sections')) return sameCourseSections(db, session.classId).some((id) => isMember(db, userId, id));
  return isMember(db, userId, session.classId);
}

function requireCanJoin(db: DB, userId: number, session: SessionRow) {
  if (!canJoinSession(db, userId, session)) requireMember(db, userId, session.classId);
}

// Six random characters. Array.from with a length calls the function once per character.
function newInviteCode() {
  return Array.from({ length: 6 }, () => CODE_ALPHABET[randomInt(0, CODE_ALPHABET.length)]).join('');
}

function getSession(db: DB, sessionId: number) {
  return db.select().from(studySessions).where(eq(studySessions.id, sessionId)).get() ?? notFound('study session');
}

// The guard for host-only changes: it has to be your session, and not cancelled.
function hostedSession(db: DB, userId: number, sessionId: number) {
  const session = getSession(db, sessionId);
  if (session.hostId !== userId) throw new AppError('Only the host can change this session.', 'FORBIDDEN');
  if (session.cancelledAt) throw new AppError('This session was cancelled.');
  return session;
}

// In the order people joined, which is also the waitlist's order.
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

// A weekly series shares its code: it stands for the next week still to come.
function sessionByCode(db: DB, code: string, now: Date) {
  const matches = db
    .select()
    .from(studySessions)
    .where(and(eq(studySessions.inviteCode, code.replace(/[\s-]/g, '')), ne(studySessions.inviteCode, '')))
    .orderBy(asc(studySessions.startsAt))
    .all();
  // The first week still on; if there's none, the last week, so an
  // old code still finds its session. .at(-1) is the last item.
  const session = matches.find((s) => !s.cancelledAt && s.endsAt >= now) ?? matches.at(-1);
  if (!session) throw new AppError('No study session has that code. Check it with the host.', 'NOT_FOUND');
  return session;
}

// The weeks of a series from `session` on that haven't ended or been cancelled.
function laterWeeks(db: DB, session: SessionRow, now: Date) {
  if (session.seriesId == null) return [session];
  return db
    .select()
    .from(studySessions)
    .where(
      and(
        eq(studySessions.seriesId, session.seriesId),
        gte(studySessions.startsAt, session.startsAt),
        gte(studySessions.endsAt, now),
        isNull(studySessions.cancelledAt),
      ),
    )
    .orderBy(asc(studySessions.startsAt))
    .all();
}

// Joins every week from `session` on that you're not in yet (going, or waitlisted when full).
function joinWeeks(ctx: AuthedContext, session: SessionRow) {
  const weeks = laterWeeks(ctx.db, session, ctx.now()).filter((s) => !membership(ctx.db, s.id, ctx.userId));
  if (!weeks.length) return joinSession(ctx, session);
  const results = weeks.map((s) => joinSession(ctx, s));
  // The first week's result, plus how many weeks were joined.
  return { ...results[0], weeks: results.length };
}

// Invite-only sessions are visible to the people in them, and to nobody else in the class.
export function canSeeSession(db: DB, userId: number, session: SessionRow) {
  return session.visibility === 'class' || isOn('all-sessions-visible') || !!membership(db, session.id, userId) || invitesOf(db, session.id).includes(userId);
}

// Sessions shaped for the class page and the dashboard.
const NEEDS_NOTICE = 'A new session needs at least an hour’s notice.';
const OFFICE_HOURS_IN_DETAILS = 'Office hours go in the course details.';

function describe(db: DB, userId: number, allRows: SessionRow[], now: Date) {
  // 'office-hours-details-only': a professor's time is in the course details, not here.
  const professors = new Set(isOn('office-hours-details-only') ? db.select({ id: users.id }).from(users).where(eq(users.role, 'professor')).all().map((u) => u.id) : []);
  const rows = allRows.filter((s) => !professors.has(s.hostId));
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  // One query for the members of every session at once, instead
  // of one per session. Each session picks out its own below.
  const members = db
    .select({
      sessionId: studySessionMembers.sessionId,
      userId: users.id,
      name: users.name,
      email: users.email,
      avatar: users.avatar,
      role: users.role,
      status: studySessionMembers.status,
    })
    .from(studySessionMembers)
    .innerJoin(users, eq(studySessionMembers.userId, users.id))
    .where(inArray(studySessionMembers.sessionId, ids))
    .orderBy(asc(studySessionMembers.createdAt))
    .all();
  const labels = classLabels(db);
  const busy = busyChecker(db, userId);

  // For "Join every week": the upcoming weeks of each series, and the ones you're in.
  // `(id): id is number =>` is an inline type guard, so after
  // filter() TypeScript knows the array holds no nulls.
  const seriesIds = [...new Set(rows.map((r) => r.seriesId).filter((id): id is number => id != null))];
  const weeks = seriesIds.length
    ? db
        .select({ id: studySessions.id, seriesId: studySessions.seriesId, startsAt: studySessions.startsAt, endsAt: studySessions.endsAt })
        .from(studySessions)
        .where(and(inArray(studySessions.seriesId, seriesIds), isNull(studySessions.cancelledAt)))
        .all()
    : [];
  const myWeeks = new Set(
    weeks.length
      ? db
          .select({ id: studySessionMembers.sessionId })
          .from(studySessionMembers)
          .where(and(eq(studySessionMembers.userId, userId), inArray(studySessionMembers.sessionId, weeks.map((w) => w.id))))
          .all()
          .map((r) => r.id)
      : [],
  );

  return rows.map((s) => {
    const mine = members.filter((m) => m.sessionId === s.id);
    const going = mine.filter((m) => m.status === 'going');
    const waitlist = mine.filter((m) => m.status === 'waitlisted');
    const myStatus = mine.find((m) => m.userId === userId)?.status ?? null;
    const isHost = s.hostId === userId;
    const attending = myStatus === 'going';
    const offers = isOn('confirm-waitlist-spot') ? offersOf(db, s.id) : [];
    const limit = s.capacity ?? (isOn('optional-session-limit') ? Infinity : DEFAULT_CAPACITY);
    return {
      ...s,
      // Only the host hands out the code, and only people going get the meeting link.
      inviteCode: isHost ? s.inviteCode : null,
      meetingUrl: attending || isOn('meeting-link-for-all') ? s.meetingUrl : '',
      classLabel: labels.get(s.classId) ?? '',
      // A class or another session of yours at the same time.
      clash: s.cancelledAt || s.endsAt < now ? null : busy(s.startsAt, s.endsAt, s.id),
      hostFirstName: going.find((m) => m.userId === s.hostId)?.name.split(' ')[0] ?? null,
      hostIsProfessor: going.find((m) => m.userId === s.hostId)?.role === 'professor',
      goingCount: going.length,
      waitlistCount: waitlist.length,
      // Only people going see who else is. Everyone else gets an empty list, and the count above.
      going: attending || isOn('everyone-sees-going')
        ? going.map(({ userId, name, email, avatar }) => ({ userId, name, email, goat: goatFor(userId, avatar) }))
        : [],
      myStatus,
      // 1 = next in line for a spot.
      myWaitlistPosition: myStatus === 'waitlisted' ? waitlist.findIndex((m) => m.userId === userId) + 1 : null,
      isHost,
      isFull: going.length + offers.length >= limit,
      canJoin: canJoinSession(db, userId, s),
      spotOffered: offers.includes(userId),
      requests: isHost && isOn('host-approves-joins') ? mine.filter((m) => m.status === 'invited').map((m) => ({ userId: m.userId, name: m.name, email: m.email })) : [],
      chat: attending && isOn('session-chat') ? chatOf(db, s.id) : [],
      suggestions: isHost && isOn('suggest-session-change') ? suggestionsOf(db, s.id) : [],
      codeExpiresAt: isHost && isOn('session-codes-expire') ? new Date(codeExpiry(db, s)) : null,
      goalsDone: isOn('session-goal-checklist') ? goalsDone(db, s.id) : [],
      // Weeks from this one on that you could still join.
      weeksToJoin:
        s.seriesId == null || s.cancelledAt
          ? 0
          : weeks.filter((w) => w.seriesId === s.seriesId && w.startsAt >= s.startsAt && w.endsAt >= now && !myWeeks.has(w.id)).length,
    };
  });
}

// Fills free spots from the waitlist, first come first served.
function promoteWaitlist(db: DB, session: SessionRow) {
  const members = membersOf(db, session.id);
  // Spots left: the limit (or the default) minus the people
  // going. Infinity, under a switch, means no limit.
  let free = (session.capacity ?? (isOn('optional-session-limit') ? Infinity : DEFAULT_CAPACITY)) - members.filter((m) => m.status === 'going').length;
  // 'confirm-waitlist-spot': the next people are offered the spot, and it stays open until they answer.
  if (isOn('confirm-waitlist-spot')) {
    const offers = offersOf(db, session.id).filter((id) => members.some((m) => m.userId === id && m.status === 'waitlisted'));
    free -= offers.length;
    for (const next of members.filter((m) => m.status === 'waitlisted' && !offers.includes(m.userId))) {
      if (free <= 0) break;
      offers.push(next.userId);
      free--;
      notify(db, next.userId, {
        type: 'session-spot',
        title: raw(`A spot opened up in "${session.title}". Do you still want it?`),
        link: `/classes/${session.classId}/sessions`,
      });
    }
    write(db, offersKey(session.id), offers);
    return;
  }
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
  if (isOn('delete-cancelled-sessions')) db.delete(studySessions).where(eq(studySessions.id, session.id)).run();
}

// Leaving: a guest's spot goes to the waitlist; a host passes the session on to whoever
// has been going the longest, and it's only cancelled when nobody else is going.
function leaveSession(ctx: AuthedContext, session: SessionRow, nextHostId?: number) {
  const { db, userId } = ctx;
  db.delete(studySessionMembers)
    .where(and(eq(studySessionMembers.sessionId, session.id), eq(studySessionMembers.userId, userId)))
    .run();
  if (session.cancelledAt || session.endsAt < ctx.now()) return;

  if (session.hostId === userId) {
    const others = membersOf(db, session.id).filter((member) => member.status === 'going');
    // The person the host picked, if any, otherwise whoever joined first.
    const next = others.find((member) => member.userId === nextHostId) ?? others[0];
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

// Refuses a cancelled or finished session and a second join, then adds you as going,
// or waitlisted when it's full. `as const` keeps each status as its literal type.
function joinSession(ctx: AuthedContext, session: SessionRow) {
  if (session.cancelledAt) throw new AppError('This session was cancelled.');
  if (session.endsAt < ctx.now()) throw new AppError('This session has already ended.');
  const current = membership(ctx.db, session.id, ctx.userId);
  if (current?.status === 'going') throw new AppError("You're already going.", 'CONFLICT');
  if (current?.status === 'waitlisted') throw new AppError("You're already on the waitlist.", 'CONFLICT');
  if (current?.status === 'invited') throw new AppError(ALREADY_ASKED, 'CONFLICT');
  const [described] = describe(ctx.db, ctx.userId, [session], ctx.now());
  // 'host-approves-joins': asking is the `invited` state, until the host decides.
  if (isOn('host-approves-joins') && session.hostId !== ctx.userId) {
    ctx.db.insert(studySessionMembers).values({ sessionId: session.id, userId: ctx.userId, status: 'invited' }).run();
    notify(ctx.db, session.hostId, {
      type: 'session-changed',
      title: raw(`Someone asked to join "${session.title}"`),
      link: `/classes/${session.classId}/sessions`,
    });
    return { status: 'invited' as const };
  }
  if (described.isFull && isOn('optional-session-limit')) throw new AppError(SESSION_FULL, 'CONFLICT');
  const status = described.isFull ? ('waitlisted' as const) : ('going' as const);
  ctx.db.insert(studySessionMembers).values({ sessionId: session.id, userId: ctx.userId, status }).run();
  return { status };
}

// Every read (list, past, mine, browse, byCode) returns sessions through
// describe(), so each screen gets the same view of who can see what.
export const studySessionsRouter = {
  // S3.2: the section's open sessions, plus invite-only ones you're in.
  list: procedure(z.object({ classId: idSchema }), ({ classId }, ctx) => {
    requireMember(ctx.db, ctx.userId, classId);
    const rows = ctx.db
      .select()
      .from(studySessions)
      .where(and(isOn('session-several-sections') ? inArray(studySessions.classId, sameCourseSections(ctx.db, classId)) : eq(studySessions.classId, classId), gte(studySessions.endsAt, ctx.now())))
      .orderBy(asc(studySessions.startsAt))
      .all()
      .filter((s) => canSeeSession(ctx.db, ctx.userId, s));
    return describe(ctx.db, ctx.userId, rows, ctx.now());
  }),

  // S3.2: the section's sessions from the last month that are over, newest first.
  past: procedure(z.object({ classId: idSchema }), ({ classId }, ctx) => {
    requireMember(ctx.db, ctx.userId, classId);
    if (isOn('hide-past-sessions')) return [];
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
      .filter((s) => canSeeSession(ctx.db, ctx.userId, s));
    return describe(ctx.db, ctx.userId, rows, ctx.now());
  }),

  // Upcoming sessions you're going to or waiting for, across classes.
  mine: procedure(z.void(), (_input, ctx) => {
    // No .all(): this unfinished query becomes a subquery inside inArray() below.
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
    return describe(ctx.db, ctx.userId, mine, ctx.now());
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
      .innerJoin(users, eq(studySessions.hostId, users.id))
      .where(
        and(
          isOn('campus-wide-sessions') || isOn('open-to-all-mcgill') ? undefined : inArray(studySessions.classId, classIds),
          gte(studySessions.endsAt, ctx.now()),
          isNull(studySessions.cancelledAt),
          search
            ? or(like(studySessions.title, term), like(studySessions.tag, term), like(studySessions.location, term), like(sectionCode, term), isOn('search-session-host') ? like(users.name, term) : undefined)
            : undefined,
        ),
      )
      .orderBy(asc(studySessions.startsAt))
      .all()
      .map((r) => r.session)
      .filter((s) => canSeeSession(ctx.db, ctx.userId, s));
    const found = describe(ctx.db, ctx.userId, rows, ctx.now());
    return isOn('hide-clashing-sessions') ? found.filter((s) => !s.clash) : found;
  }),

  // S3.1
  // `weeks` > 1 makes a weekly series: the same time each week, sharing one invite code.
  create: procedure(
    z.object({ classId: idSchema, weeks: z.number().int().min(1).max(14).default(1) }).and(details),
    ({ classId, weeks: asked, ...input }, ctx) => {
      requireMember(ctx.db, ctx.userId, classId);
      if (isOn('office-hours-details-only') && isProfessor(ctx.db, ctx.userId)) throw new AppError(OFFICE_HOURS_IN_DETAILS);
      if (input.startsAt < ctx.now()) throw new AppError('Pick a start time in the future.');
      if (isOn('session-notice') && input.startsAt.getTime() - ctx.now().getTime() < 60 * 60_000) throw new AppError(NEEDS_NOTICE);
      if (input.capacity == null && !isOn('optional-session-limit')) throw new AppError(NEEDS_LIMIT);
      const weeks = isOn('one-off-sessions') ? 1 : asked;
      const separate = isOn('separate-weekly-sessions');
      const inviteCode = newInviteCode();
      // The same weekday and clock time n weeks later. Building the date from its parts, instead
      // of adding 7 days of milliseconds, keeps the time right across a daylight-saving change.
      const inWeeks = (date: Date, n: number) => new Date(date.getFullYear(), date.getMonth(), date.getDate() + 7 * n, date.getHours(), date.getMinutes());
      return ctx.db.transaction((tx) => {
        // One row per week, all in this transaction, with the host added as going to each.
        const created = Array.from({ length: weeks }, (_, n) => {
          const session = tx
            .insert(studySessions)
            .values({
              ...input,
              startsAt: inWeeks(input.startsAt, n),
              endsAt: inWeeks(input.endsAt, n),
              location: input.format === 'online' ? '' : input.location,
              meetingUrl: input.format === 'online' ? input.meetingUrl : '',
              classId,
              hostId: ctx.userId,
              inviteCode: separate ? newInviteCode() : inviteCode,
            })
            .returning({ id: studySessions.id, inviteCode: studySessions.inviteCode })
            .get();
          tx.insert(studySessionMembers).values({ sessionId: session.id, userId: ctx.userId, status: 'going' }).run();
          return session;
        });
        // The series id is the first week's id, which only exists
        // once the rows are inserted, hence this second step.
        if (weeks > 1 && !separate) {
          tx.update(studySessions).set({ seriesId: created[0].id }).where(inArray(studySessions.id, created.map((s) => s.id))).run();
        }
        return created[0];
      });
    },
  ),

  // S3.5: moving the time or place tells everyone in it. More room lets the waitlist in.
  // .and() combines two schemas: the session's id plus every session field.
  update: procedure(z.object({ sessionId: idSchema }).and(details), ({ sessionId, ...input }, ctx) => {
    const before = hostedSession(ctx.db, ctx.userId, sessionId);
    const fields = {
      ...input,
      location: input.format === 'online' ? '' : input.location,
      meetingUrl: input.format === 'online' ? input.meetingUrl : '',
    };
    const going = membersOf(ctx.db, sessionId).filter((member) => member.status === 'going').length;
    if (fields.capacity != null && fields.capacity < going) {
      throw new AppError('{{count}} people are already going. Pick a limit of at least that.', 'BAD_INPUT', { count: going });
    }
    ctx.db.update(studySessions).set(fields).where(eq(studySessions.id, sessionId)).run();
    const after = getSession(ctx.db, sessionId);
    // Only changes people have to act on (the time or the place) notify them. A new title doesn't.
    const moved =
      before.startsAt.getTime() !== after.startsAt.getTime() ||
      before.endsAt.getTime() !== after.endsAt.getTime() ||
      before.location !== after.location ||
      before.meetingUrl !== after.meetingUrl;
    if (moved && !isOn('hosts-cannot-leave')) {
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

  // One session, or with `laterWeeks` every week of its series from this one on.
  cancel: procedure(z.object({ sessionId: idSchema, laterWeeks: z.boolean().default(false) }), ({ sessionId, laterWeeks: all }, ctx) => {
    const session = hostedSession(ctx.db, ctx.userId, sessionId);
    const weeks = all ? laterWeeks(ctx.db, session, ctx.now()).filter((s) => s.hostId === ctx.userId) : [session];
    ctx.db.transaction((tx) => {
      for (const week of weeks) cancelSession(tx as unknown as DB, week, ctx.userId, ctx.now());
    });
  }),

  // A weekly series: join this week and every later one you're not in yet.
  joinSeries: procedure(z.object({ sessionId: idSchema }), ({ sessionId }, ctx) => {
    const session = getSession(ctx.db, sessionId);
    requireCanJoin(ctx.db, ctx.userId, session);
    if (!canSeeSession(ctx.db, ctx.userId, session)) notFound('study session');
    // Every week is joined, or none is.
    return ctx.db.transaction((tx) => joinWeeks({ ...ctx, db: tx as unknown as DB }, session));
  }),

  // S3.3: joining an open session. When it's full you go on the waitlist.
  join: procedure(z.object({ sessionId: idSchema }), ({ sessionId }, ctx) => {
    const session = getSession(ctx.db, sessionId);
    requireCanJoin(ctx.db, ctx.userId, session);
    if (!canSeeSession(ctx.db, ctx.userId, session)) notFound('study session');
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
      // The browser's time zone name, such as America/Toronto,
      // so calendar apps put the event at the right time.
      Intl.DateTimeFormat().resolvedOptions().timeZone,
    );
    await writeFile(target, ics, 'utf8');
    return { path: target };
  }),

  // S3.4: the invite code works for open and invite-only sessions alike.
  // What an invite link shows before joining: the session (as anyone in the section would
  // see it), and whether you're in its class yet.
  byCode: procedure(z.object({ code: z.string().trim().toUpperCase() }), ({ code }, ctx) => {
    const session = sessionByCode(ctx.db, code, ctx.now());
    // describe() works on a list, so this passes one session and destructures the one result.
    const [described] = describe(ctx.db, ctx.userId, [session], ctx.now());
    return { ...described, inClass: isMember(ctx.db, ctx.userId, session.classId) };
  }),

  joinByCode: procedure(z.object({ code: z.string().trim().toUpperCase().min(1, 'Enter the invite code') }), ({ code }, ctx) => {
    const session = sessionByCode(ctx.db, code, ctx.now());
    if (isOn('session-codes-expire') && codeExpiry(ctx.db, session) < ctx.now().getTime()) throw new AppError(CODE_EXPIRED, 'FORBIDDEN');
    if (!isMember(ctx.db, ctx.userId, session.classId) && !isOn('invite-outside-class') && !canJoinSession(ctx.db, ctx.userId, session)) {
      throw new AppError('This session is for {{class}}. Join that class first.', 'FORBIDDEN', {
        class: classLabel(ctx.db, session.classId) ?? '',
      });
    }
    const joined = ctx.db.transaction((tx) => joinWeeks({ ...ctx, db: tx as unknown as DB }, session));
    return { weeks: 1, ...joined, classId: session.classId, title: session.title, inClass: isMember(ctx.db, ctx.userId, session.classId) };
  }),

  // A new code stops the old one from working (for invite-only sessions shared too widely).
  newCode: procedure(z.object({ sessionId: idSchema }), ({ sessionId }, ctx) => {
    const session = hostedSession(ctx.db, ctx.userId, sessionId);
    const inviteCode = newInviteCode();
    ctx.db
      .update(studySessions)
      .set({ inviteCode })
      // A series shares one code, so the new code goes on every week of it.
      .where(session.seriesId == null ? eq(studySessions.id, sessionId) : eq(studySessions.seriesId, session.seriesId))
      .run();
    if (isOn('session-codes-expire')) write(ctx.db, codeIssuedKey(sessionId), ctx.now().getTime());
    return { inviteCode };
  }),

  // Leaving, or getting off the waitlist.
  leave: procedure(z.object({ sessionId: idSchema, nextHostId: idSchema.optional() }), ({ sessionId, nextHostId }, ctx) => {
    const session = getSession(ctx.db, sessionId);
    if (!membership(ctx.db, sessionId, ctx.userId)) throw new AppError("You're not in this session.");
    if (session.hostId === ctx.userId && isOn('hosts-cannot-leave')) throw new AppError(HOST_STAYS, 'FORBIDDEN');
    if (isOn('leave-tells-host') && session.hostId !== ctx.userId) {
      const leaving = ctx.db.select({ name: users.name }).from(users).where(eq(users.id, ctx.userId)).get();
      notify(ctx.db, session.hostId, { type: 'session-changed', title: raw(`${leaving?.name} left "${session.title}"`), link: `/classes/${session.classId}/sessions` });
    }
    if (isOn('confirm-waitlist-spot')) write(ctx.db, offersKey(sessionId), offersOf(ctx.db, sessionId).filter((id) => id !== ctx.userId));
    ctx.db.transaction((tx) => leaveSession({ ...ctx, db: tx as unknown as DB }, session, isOn('choose-next-host') ? nextHostId : undefined));
  }),

  // 'confirm-waitlist-spot': taking the spot you were offered.
  confirmSpot: procedure(z.object({ sessionId: idSchema }), ({ sessionId }, ctx) => {
    const offers = offersOf(ctx.db, sessionId);
    if (!offers.includes(ctx.userId)) throw new AppError(NO_SPOT_OFFERED);
    write(ctx.db, offersKey(sessionId), offers.filter((id) => id !== ctx.userId));
    ctx.db.update(studySessionMembers).set({ status: 'going' }).where(and(eq(studySessionMembers.sessionId, sessionId), eq(studySessionMembers.userId, ctx.userId))).run();
  }),

  // 'host-approves-joins': the host lets someone in, or doesn't.
  decideJoin: procedure(z.object({ sessionId: idSchema, userId: idSchema, approve: z.boolean() }), ({ sessionId, userId, approve }, ctx) => {
    const session = hostedSession(ctx.db, ctx.userId, sessionId);
    const asking = and(eq(studySessionMembers.sessionId, sessionId), eq(studySessionMembers.userId, userId));
    if (!approve) {
      ctx.db.delete(studySessionMembers).where(asking).run();
    } else {
      const [described] = describe(ctx.db, ctx.userId, [session], ctx.now());
      ctx.db.update(studySessionMembers).set({ status: described.isFull ? 'waitlisted' : 'going' }).where(asking).run();
    }
    notify(ctx.db, userId, {
      type: 'session-changed',
      title: raw(approve ? `You're in "${session.title}"` : `The host of "${session.title}" said no this time`),
      link: `/classes/${session.classId}/sessions`,
    });
  }),

  // 'session-invite-by-email' and 'session-invite-notification': tell a classmate through UniLink.
  invite: procedure(z.object({ sessionId: idSchema, email: z.string().trim().toLowerCase() }), ({ sessionId, email }, ctx) => {
    const session = hostedSession(ctx.db, ctx.userId, sessionId);
    const person = ctx.db.select({ id: users.id }).from(users).where(eq(users.email, email)).get();
    if (!person || !isMember(ctx.db, person.id, session.classId)) throw new AppError(NOT_IN_CLASS);
    write(ctx.db, invitesKey(sessionId), [...new Set([...invitesOf(ctx.db, sessionId), person.id])]);
    notify(ctx.db, person.id, {
      type: 'session-changed',
      title: raw(`You're invited to "${session.title}"`),
      link: `/classes/${session.classId}/sessions`,
    });
  }),

  // 'session-chat': for the people going.
  chat: procedure(z.object({ sessionId: idSchema, body: nonEmpty('Reply', 1000) }), ({ sessionId, body }, ctx) => {
    if (membership(ctx.db, sessionId, ctx.userId)?.status !== 'going') throw new AppError(NOT_GOING, 'FORBIDDEN');
    const me = ctx.db.select({ name: users.name }).from(users).where(eq(users.id, ctx.userId)).get();
    write(ctx.db, chatKey(sessionId), [...chatOf(ctx.db, sessionId), { name: me?.name ?? '', body, at: ctx.now().getTime() }]);
  }),

  // 'suggest-session-change': anyone going suggests, the host decides.
  suggest: procedure(z.object({ sessionId: idSchema, text: nonEmpty('Reply', 500) }), ({ sessionId, text }, ctx) => {
    const session = getSession(ctx.db, sessionId);
    if (membership(ctx.db, sessionId, ctx.userId)?.status !== 'going') throw new AppError(NOT_GOING, 'FORBIDDEN');
    const me = ctx.db.select({ name: users.name }).from(users).where(eq(users.id, ctx.userId)).get();
    const list = suggestionsOf(ctx.db, sessionId);
    write(ctx.db, suggestionsKey(sessionId), [...list, { id: (list.at(-1)?.id ?? 0) + 1, name: me?.name ?? '', text }]);
    notify(ctx.db, session.hostId, { type: 'session-changed', title: raw(`${me?.name ?? 'Someone'} suggested a change to "${session.title}"`), body: raw(text), link: `/classes/${session.classId}/sessions` });
  }),

  answerSuggestion: procedure(z.object({ sessionId: idSchema, id: z.number().int(), accept: z.boolean() }), ({ sessionId, id, accept }, ctx) => {
    const session = hostedSession(ctx.db, ctx.userId, sessionId);
    const list = suggestionsOf(ctx.db, sessionId);
    const suggestion = list.find((s) => s.id === id);
    write(ctx.db, suggestionsKey(sessionId), list.filter((s) => s.id !== id));
    if (accept && suggestion) {
      tellEveryone(ctx.db, session, ctx.userId, { type: 'session-changed', title: raw(`The host of "${session.title}" accepted a change`), body: raw(suggestion.text), link: `/classes/${session.classId}/sessions` });
    }
  }),

  // 'session-goal-checklist': anyone going ticks off a goal for everyone.
  toggleGoal: procedure(z.object({ sessionId: idSchema, index: z.number().int().min(0) }), ({ sessionId, index }, ctx) => {
    if (membership(ctx.db, sessionId, ctx.userId)?.status !== 'going') throw new AppError(NOT_GOING, 'FORBIDDEN');
    const done = goalsDone(ctx.db, sessionId);
    write(ctx.db, goalsKey(sessionId), done.includes(index) ? done.filter((i) => i !== index) : [...done, index]);
  }),
};
