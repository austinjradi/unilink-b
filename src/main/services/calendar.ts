import { readFile, rm, writeFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { and, asc, eq, gte, inArray, isNull, lt, or } from 'drizzle-orm';
import { z } from 'zod';
import { addDays, atTime, eachDay, parseYmd, termRange, ymd } from '@shared/dates';
import { translate } from '@shared/i18n';
import { buildCalendar, type IcsEvent, parseCalendar } from '@shared/ics';
import { finalExamFor, KEY_DATES, noClassesOn } from '@shared/keyDates';
import { parseOfficeHours } from '@shared/meetings';
import { isOn } from '@shared/variants';
import type { DB } from '../db/client';
import {
  classDetails,
  classes,
  classMeetings,
  courses,
  deadlineDone,
  deadlines,
  enrollments,
  plannerAssignments,
  plannerTasks,
  studySessionMembers,
  studySessions,
  users,
} from '../db/schema';
import { AppError, idSchema, nonEmpty, procedure } from '../rpc/core';
import { classLabels, FORMER_STUDENT_EMAIL, isMember, isProfessor, notFound, professorsOf, requireMember, teaches, sameCourseSections } from './access';
import { gradedItems, personalMeetings } from './courses';
import { read, write } from './variantData';

// A3: one calendar for class times, deadlines, exams, study sessions and planned work.
// In version B a deadline added to a class is shared with the whole section (one person
// adds "Assignment 2", everyone sees it); deadlines with no class stay private. Each
// student checks shared deadlines off for themselves.
// G2: export to Google Calendar (.ics) and import from myCourses (.ics).

export const DEADLINE_KINDS = ['assignment', 'exam', 'quiz', 'other'] as const;

// 'labs-and-readings' adds these. The column isn't constrained, so nothing else changes.
const EXTRA_KINDS = ['lab', 'reading'] as const;

// Switches stay in English, so these aren't written where the French check would ask for a translation.
const NO_EXTRA_KIND = 'Pick a type from the list.';
const PROFESSOR_ADDS = 'The section’s professor enters its dates.';
const CANT_APPROVE_OWN = 'Someone else has to approve what you added.';

// What people do under a switch, kept in app_state.
const PRIVATE_DEADLINES = 'variant-private-deadlines';
const SHARED_DONE = 'variant-shared-done-deadlines';
const NO_TIME = 'variant-deadlines-no-time';
const PENDING_DEADLINES = 'variant-pending-deadlines';
const CANCELLED_LECTURES = 'variant-cancelled-lectures';
const submissionsKey = (userId: number) => `variant-submissions-${userId}`;
const idSet = (db: DB, key: string) => new Set(read<number[]>(db, key, []));
const addTo = (db: DB, key: string, id: number) => write(db, key, [...idSet(db, key), id]);
const removeFrom = (db: DB, key: string, id: number) => write(db, key, [...idSet(db, key)].filter((other) => other !== id));

const onBreak = (day: string) => !isOn('classes-through-breaks') && noClassesOn(day);

export type CalendarEvent = {
  // A graded item's share of its class's grade.
  weight?: number;
  key: string;
  // "key": the term's key dates that aren't deadlines (classes start, reading break, exams).
  kind: 'class' | 'deadline' | 'session' | 'task' | 'key';
  // For deadlines: assignment/exam/quiz/other, or "graded"/"planner" when they come from A5/ST2,
  // "final" for final exams and "key" for the term's key deadlines (add/drop, withdrawal).
  detail: string;
  title: string;
  start: Date;
  end: Date | null;
  allDay: boolean;
  classId: number | null;
  classLabel: string | null;
  location: string;
  done: boolean;
  // Set for deadlines, which can be checked off (ST3).
  deadlineId: number | null;
  // Who added a shared class deadline (null for your own).
  addedBy: string | null;
};

const ymdSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const deadlineFields = {
  classId: idSchema.nullable(),
  kind: z.enum([...DEADLINE_KINDS, ...EXTRA_KINDS]),
  title: nonEmpty('Title', 200),
  dueAt: z.date(),
  notes: z.string().trim().max(2000),
  // 'ask-to-share-deadline' and 'date-without-time'.
  shared: z.boolean().optional(),
  noTime: z.boolean().optional(),
};

const labels = classLabels;

function myClassIds(db: DB, userId: number) {
  // 'one-class-per-course': what's in any section of a course is in the class.
  if (isOn('one-class-per-course')) {
    const mine = db.select({ id: enrollments.classId }).from(enrollments).where(eq(enrollments.userId, userId)).all();
    return db.select({ id: classes.id }).from(classes).where(inArray(classes.id, mine.flatMap(({ id }) => sameCourseSections(db, id))));
  }
  return db.select({ id: enrollments.classId }).from(enrollments).where(eq(enrollments.userId, userId));
}

// The section's class times, for every class the student is in.
export function myMeetings(db: DB, userId: number) {
  if (isOn('personal-class-times')) return personalMeetings(db, userId);
  return db
    .select({ meeting: classMeetings, term: classes.term })
    .from(classMeetings)
    .innerJoin(classes, eq(classMeetings.classId, classes.id))
    .innerJoin(enrollments, and(eq(enrollments.classId, classes.id), eq(enrollments.userId, userId)))
    .all();
}

// What a student already has on at a given time: one of their classes (not on a break or holiday),
// or a session they're going to. Returns a checker, so a list only looks these up once.
export function busyChecker(db: DB, userId: number) {
  const label = classLabels(db);
  const meetings = myMeetings(db, userId);
  const sessions = db
    .select({ id: studySessions.id, title: studySessions.title, startsAt: studySessions.startsAt, endsAt: studySessions.endsAt })
    .from(studySessionMembers)
    .innerJoin(studySessions, eq(studySessionMembers.sessionId, studySessions.id))
    .where(and(eq(studySessionMembers.userId, userId), eq(studySessionMembers.status, 'going'), isNull(studySessions.cancelledAt)))
    .all();
  return (start: Date, end: Date, exceptSessionId?: number): string | null => {
    const day = ymd(start);
    if (!onBreak(day)) {
      for (const { meeting: m, term } of meetings) {
        const range = termRange(term);
        if (m.weekday !== start.getDay() || day < range.start || day > range.end) continue;
        if (atTime(day, m.startTime) < end && start < atTime(day, m.endTime)) return label.get(m.classId) ?? null;
      }
    }
    return sessions.find((s) => s.id !== exceptSessionId && s.startsAt < end && start < s.endsAt)?.title ?? null;
  };
}

// Your private deadlines plus the shared deadlines of every class you're in, with whether
// you've checked each one off.
export const EXTENSIONS = 'variant-extensions';

export function visibleDeadlines(db: DB, userId: number, from?: Date, to?: Date) {
  // Whoever teaches a section sees what's waiting to go out; nobody else does until it has.
  const teaching = isProfessor(db, userId);
  const privateOnes = isOn('ask-to-share-deadline') ? idSet(db, PRIVATE_DEADLINES) : new Set<number>();
  const pending = isOn('approve-shared-changes') ? idSet(db, PENDING_DEADLINES) : new Set<number>();
  const sharedDone = isOn('shared-deadline-check') ? idSet(db, SHARED_DONE) : new Set<number>();
  const noTime = isOn('date-without-time') ? idSet(db, NO_TIME) : new Set<number>();
  const extensions = isOn('extensions') ? read<Record<string, string>>(db, EXTENSIONS, {}) : {};
  const counts = isOn('professor-sees-checkoffs') && teaching ? db.select({ id: deadlineDone.deadlineId }).from(deadlineDone).all().map((row) => row.id) : [];
  return db
    .select({
      deadline: deadlines,
      doneAt: deadlineDone.doneAt,
      addedByName: users.name,
      addedByEmail: users.email,
    })
    .from(deadlines)
    .innerJoin(users, eq(deadlines.userId, users.id))
    .leftJoin(deadlineDone, and(eq(deadlineDone.deadlineId, deadlines.id), eq(deadlineDone.userId, userId)))
    .where(
      and(
        // Version A: your own, plus what a professor posted.
        isOn('personal-deadlines')
          ? or(eq(deadlines.userId, userId), and(eq(deadlines.official, true), inArray(deadlines.classId, myClassIds(db, userId))))
          : or(and(isNull(deadlines.classId), eq(deadlines.userId, userId)), inArray(deadlines.classId, myClassIds(db, userId))),
        teaching || isOn('draft-visible') ? undefined : isNull(deadlines.releaseAt),
        from ? gte(deadlines.dueAt, from) : undefined,
        to ? lt(deadlines.dueAt, to) : undefined,
      ),
    )
    .orderBy(asc(deadlines.dueAt))
    .all()
    .filter(({ deadline }) => deadline.userId === userId || !privateOnes.has(deadline.id))
    .map(({ deadline, doneAt, addedByName, addedByEmail }) => ({
      ...deadline,
      // 'extensions': someone's own due date.
      dueAt: extensions[`${deadline.id}-${userId}`] ? new Date(extensions[`${deadline.id}-${userId}`]) : deadline.dueAt,
      extended: !!extensions[`${deadline.id}-${userId}`],
      done: isOn('shared-deadline-check') && deadline.classId != null ? sharedDone.has(deadline.id) : doneAt != null,
      doneCount: counts.filter((id) => id === deadline.id).length,
      noTime: noTime.has(deadline.id),
      // 'approve-shared-changes': waiting for someone else in the section.
      pending: pending.has(deadline.id),
      mine: deadline.userId === userId,
      addedBy: deadline.userId === userId ? null : addedByEmail === FORMER_STUDENT_EMAIL ? '' : addedByName,
    }));
}

function collect(db: DB, userId: number, from: Date, to: Date): CalendarEvent[] {
  const label = labels(db);
  const locale = db.select({ locale: users.locale }).from(users).where(eq(users.id, userId)).get()?.locale ?? 'en';
  const labelOf = (id: number | null) => (id == null ? null : (label.get(id) ?? null));
  const events: CalendarEvent[] = [];

  // Weekly class times, only within the class's term and not on breaks or holidays.
  const days = eachDay(ymd(from), ymd(new Date(to.getTime() - 1)));
  for (const { meeting: m, term } of myMeetings(db, userId)) {
    const range = termRange(term);
    for (const day of days) {
      if (parseYmd(day).getDay() !== m.weekday || day < range.start || day > range.end || onBreak(day)) continue;
      const cancelled = isOn('cancel-one-lecture') && read<string[]>(db, CANCELLED_LECTURES, []).includes(`${m.id}|${day}`);
      events.push({
        key: `class-${m.id}-${day}`,
        kind: 'class',
        detail: cancelled ? 'cancelled' : 'class',
        title: `${cancelled ? 'Cancelled: ' : ''}${labelOf(m.classId) ?? 'Class'}`,
        start: atTime(day, m.startTime),
        end: atTime(day, m.endTime),
        allDay: false,
        classId: m.classId,
        classLabel: labelOf(m.classId),
        location: m.location,
        done: false,
        deadlineId: null,
        addedBy: null,
      });
    }
  }

  // 'office-hours-on-calendar': read from the course details, every week of the term.
  if (isOn('office-hours-on-calendar')) {
    for (const row of db.select({ classId: classes.id, term: classes.term, officeHours: classDetails.officeHours }).from(enrollments).innerJoin(classes, eq(enrollments.classId, classes.id)).innerJoin(classDetails, eq(classDetails.classId, classes.id)).where(eq(enrollments.userId, userId)).all()) {
      const hours = parseOfficeHours(row.officeHours ?? '');
      if (!hours) continue;
      const range = termRange(row.term);
      for (const day of days) {
        if (parseYmd(day).getDay() !== hours.weekday || day < range.start || day > range.end) continue;
        events.push({ key: `office-${row.classId}-${day}`, kind: 'class', detail: 'office hours', title: `Office hours: ${labelOf(row.classId) ?? ''}`, start: atTime(day, hours.startTime), end: atTime(day, hours.endTime), allDay: false, classId: row.classId, classLabel: labelOf(row.classId), location: '', done: false, deadlineId: null, addedBy: null });
      }
    }
  }

  for (const d of visibleDeadlines(db, userId, from, to)) {
    if (d.pending && d.userId !== userId) continue;
    events.push({
      key: `deadline-${d.id}`,
      kind: 'deadline',
      detail: d.kind,
      title: d.title,
      start: d.dueAt,
      end: null,
      allDay: d.noTime,
      classId: d.classId,
      classLabel: labelOf(d.classId),
      location: '',
      done: d.done,
      deadlineId: d.id,
      addedBy: d.addedBy,
    });
  }

  // ST2: the days off the planner works around, so they're visible where plans are.
  const daysOff = isOn('calendar-without-plans') ? [] : (db.select({ off: users.daysOff }).from(users).where(eq(users.id, userId)).get()?.off ?? []);
  for (const day of daysOff) {
    if (day < ymd(from) || day > ymd(new Date(to.getTime() - 1))) continue;
    events.push({
      key: `day-off-${day}`,
      kind: 'key',
      detail: 'day-off',
      title: translate(locale, 'Day off'),
      start: parseYmd(day),
      end: null,
      allDay: true,
      classId: null,
      classLabel: null,
      location: '',
      done: false,
      deadlineId: null,
      addedBy: null,
    });
  }

  // A3: the term's key dates, for everyone. Deadlines are due at 23:59; breaks and periods
  // cover each of their days.
  const firstDay = ymd(from);
  const lastDay = ymd(new Date(to.getTime() - 1));
  for (const k of KEY_DATES) {
    if (isOn('hide-key-dates') || (isOn('only-official-dates') && k.approximate)) continue;
    const title = translate(locale, k.title);
    const blank = { end: null, classId: null, classLabel: null, location: '', done: false, deadlineId: null, addedBy: null };
    if (k.type === 'deadline') {
      if (k.date < firstDay || k.date > lastDay) continue;
      events.push({ ...blank, key: `key-${k.term}-${k.date}`, kind: 'deadline', detail: 'key', title, start: atTime(k.date, '23:59'), allDay: false });
      continue;
    }
    for (const day of eachDay(k.date < firstDay ? firstDay : k.date, (k.end ?? k.date) > lastDay ? lastDay : (k.end ?? k.date))) {
      events.push({ ...blank, key: `key-${k.term}-${k.date}-${day}`, kind: 'key', detail: k.type, title, start: parseYmd(day), allDay: true });
    }
  }

  // Final exams of the student's classes, from the exam schedule.
  for (const c of db
    .select({ id: classes.id, term: classes.term, subject: courses.subject, number: courses.number })
    .from(enrollments)
    .innerJoin(classes, eq(enrollments.classId, classes.id))
    .innerJoin(courses, eq(classes.courseId, courses.id))
    .where(eq(enrollments.userId, userId))
    .all()) {
    const exam = isOn('hide-key-dates') || isOn('manual-final-exams') ? null : finalExamFor(`${c.subject} ${c.number}`, c.term);
    if (!exam || exam.date < firstDay || exam.date > lastDay) continue;
    events.push({
      key: `final-${c.id}`,
      kind: 'deadline',
      detail: 'final',
      title: translate(locale, '{{course}} final exam', { course: exam.course }),
      start: atTime(exam.date, exam.start),
      end: atTime(exam.date, exam.end),
      allDay: false,
      classId: c.id,
      classLabel: labelOf(c.id),
      location: exam.location,
      done: false,
      deadlineId: null,
      addedBy: null,
    });
  }

  // Dated parts of each section's shared grading scheme; done once you have a mark.
  const classIds = myClassIds(db, userId).all().map((r) => r.id);
  for (const a of classIds.flatMap((classId) => gradedItems(db, userId, classId))) {
    if (!a.dueAt || a.dueAt < from || a.dueAt >= to) continue;
    events.push({
      key: `assessment-${a.id}`,
      kind: 'deadline',
      detail: 'graded',
      weight: a.weight,
      title: `${a.name} (${a.weight}%)`,
      start: a.dueAt,
      end: null,
      allDay: false,
      classId: a.classId,
      classLabel: labelOf(a.classId),
      location: '',
      done: a.score != null,
      deadlineId: null,
      addedBy: null,
    });
  }

  // An assignment planned out (ST2) is usually one the section already lists: when a class
  // deadline or graded item is due the same day in the same class, it isn't listed twice.
  const separatePlans = isOn('calendar-without-plans');
  const listed = new Set(events.filter((e) => e.kind === 'deadline' && e.classId != null).map((e) => `${e.classId}|${ymd(e.start)}`));
  for (const p of db
    .select()
    .from(plannerAssignments)
    .where(and(eq(plannerAssignments.userId, userId), gte(plannerAssignments.dueAt, from), lt(plannerAssignments.dueAt, to)))
    .all()) {
    if (separatePlans) break;
    if (p.classId != null && listed.has(`${p.classId}|${ymd(p.dueAt)}`)) continue;
    if (events.some((e) => e.key === `deadline-${p.deadlineId}` || e.key === `assessment-${p.assessmentId}`)) continue;
    events.push({
      key: `planner-${p.id}`,
      kind: 'deadline',
      detail: 'planner',
      title: p.title,
      start: p.dueAt,
      end: null,
      allDay: false,
      classId: p.classId,
      classLabel: labelOf(p.classId),
      location: '',
      done: false,
      deadlineId: null,
      addedBy: null,
    });
  }

  for (const { task, title, classId } of db
    .select({ task: plannerTasks, title: plannerAssignments.title, classId: plannerAssignments.classId })
    .from(plannerTasks)
    .innerJoin(plannerAssignments, eq(plannerTasks.assignmentId, plannerAssignments.id))
    .where(
      and(
        eq(plannerAssignments.userId, userId),
        gte(plannerTasks.scheduledFor, ymd(from)),
        lt(plannerTasks.scheduledFor, ymd(to)),
      ),
    )
    .all()) {
    if (separatePlans) break;
    events.push({
      key: `task-${task.id}`,
      kind: 'task',
      detail: `${task.minutes} min`,
      title: `${task.title} · ${title}`,
      start: parseYmd(task.scheduledFor),
      end: null,
      allDay: true,
      classId,
      classLabel: labelOf(classId),
      location: '',
      done: task.doneAt != null,
      deadlineId: null,
      addedBy: null,
    });
  }

  for (const s of db
    .select({ session: studySessions })
    .from(studySessions)
    .innerJoin(
      studySessionMembers,
      and(eq(studySessionMembers.sessionId, studySessions.id), eq(studySessionMembers.userId, userId)),
    )
    .where(
      and(
        eq(studySessionMembers.status, 'going'),
        isNull(studySessions.cancelledAt),
        gte(studySessions.startsAt, from),
        lt(studySessions.startsAt, to),
      ),
    )
    .all()
    .map((r) => r.session)) {
    events.push({
      key: `session-${s.id}`,
      kind: 'session',
      detail: 'study session',
      title: s.title,
      start: s.startsAt,
      end: s.endsAt,
      allDay: false,
      classId: s.classId,
      classLabel: labelOf(s.classId),
      location: s.location,
      done: false,
      deadlineId: null,
      addedBy: null,
    });
  }

  return events.sort((a, b) => Number(b.allDay) - Number(a.allDay) || a.start.getTime() - b.start.getTime());
}

function ownDeadline(db: DB, userId: number, id: number) {
  const row = db.select().from(deadlines).where(eq(deadlines.id, id)).get() ?? notFound('deadline');
  // The section's professor can also correct or remove a class deadline.
  if (row.userId !== userId && !(row.classId != null && (teaches(db, userId, row.classId) || (isOn('anyone-fixes-deadlines') && isMember(db, userId, row.classId))))) {
    throw new AppError('Only the person who added this deadline can change it.', 'FORBIDDEN');
  }
  return row;
}

function seenDeadline(db: DB, userId: number, id: number) {
  const row = db.select().from(deadlines).where(eq(deadlines.id, id)).get() ?? notFound('deadline');
  if (row.classId == null ? row.userId !== userId : (requireMember(db, userId, row.classId), false)) notFound('deadline');
  return row;
}

function assertKind(kind: string) {
  if (!isOn('labs-and-readings') && (EXTRA_KINDS as readonly string[]).includes(kind)) throw new AppError(NO_EXTRA_KIND);
}

function guessKind(title: string): (typeof DEADLINE_KINDS)[number] {
  if (/exam|midterm|final/i.test(title)) return 'exam';
  if (/quiz/i.test(title)) return 'quiz';
  if (/assignment|homework|problem set|due|project|lab|essay|report/i.test(title)) return 'assignment';
  return 'other';
}

export const calendarRouter = {
  range: procedure(z.object({ from: ymdSchema, to: ymdSchema }), ({ from, to }, ctx) =>
    collect(ctx.db, ctx.userId, parseYmd(from), parseYmd(addDays(to, 1))),
  ),

  upcoming: procedure(z.object({ days: z.number().int().min(1).max(120) }), ({ days }, ctx) => {
    const now = ctx.now();
    return collect(ctx.db, ctx.userId, now, new Date(now.getTime() + days * 86_400_000)).filter(
      (e) => e.kind === 'deadline' && !e.done,
    );
  }),

  deadlines: procedure(z.void(), (_input, ctx) => {
    const label = labels(ctx.db);
    return visibleDeadlines(ctx.db, ctx.userId, parseYmd(addDays(ymd(ctx.now()), -7))).map((d) => ({
      ...d,
      classLabel: d.classId ? (label.get(d.classId) ?? null) : null,
    }));
  }),

  addDeadline: procedure(z.object(deadlineFields), ({ shared, noTime, ...fields }, ctx) => {
    if (fields.classId) requireMember(ctx.db, ctx.userId, fields.classId);
    assertKind(fields.kind);
    // 'professor-enters-dates': once a section has a professor, its dates are theirs to enter.
    if (isOn('professor-enters-dates') && fields.classId && professorsOf(ctx.db, fields.classId).length && !teaches(ctx.db, ctx.userId, fields.classId)) {
      throw new AppError(PROFESSOR_ADDS, 'FORBIDDEN');
    }
    const row = ctx.db
      .insert(deadlines)
      .values({ ...fields, kind: fields.kind as (typeof DEADLINE_KINDS)[number], userId: ctx.userId })
      .returning({ id: deadlines.id })
      .get();
    if (isOn('ask-to-share-deadline') && shared === false) addTo(ctx.db, PRIVATE_DEADLINES, row.id);
    if (isOn('date-without-time') && noTime) addTo(ctx.db, NO_TIME, row.id);
    if (isOn('approve-shared-changes') && fields.classId) addTo(ctx.db, PENDING_DEADLINES, row.id);
    return row;
  }),

  updateDeadline: procedure(z.object({ id: idSchema, ...deadlineFields }), ({ id, shared, noTime, ...fields }, ctx) => {
    ownDeadline(ctx.db, ctx.userId, id);
    if (fields.classId) requireMember(ctx.db, ctx.userId, fields.classId);
    assertKind(fields.kind);
    ctx.db.update(deadlines).set({ ...fields, kind: fields.kind as (typeof DEADLINE_KINDS)[number] }).where(eq(deadlines.id, id)).run();
    if (isOn('ask-to-share-deadline')) (shared === false ? addTo : removeFrom)(ctx.db, PRIVATE_DEADLINES, id);
    if (isOn('date-without-time')) (noTime ? addTo : removeFrom)(ctx.db, NO_TIME, id);
  }),

  // 'approve-shared-changes': someone else lets a class deadline through.
  approveDeadline: procedure(z.object({ id: idSchema }), ({ id }, ctx) => {
    const row = seenDeadline(ctx.db, ctx.userId, id);
    if (row.userId === ctx.userId) throw new AppError(CANT_APPROVE_OWN, 'FORBIDDEN');
    removeFrom(ctx.db, PENDING_DEADLINES, id);
  }),

  // 'cancel-one-lecture': one week's class is off, for the whole section. Asking again undoes it.
  toggleLecture: procedure(z.object({ meetingId: z.number().int(), classId: idSchema, day: ymdSchema }), ({ meetingId, classId, day }, ctx) => {
    requireMember(ctx.db, ctx.userId, classId);
    const key = `${meetingId}|${day}`;
    const cancelled = read<string[]>(ctx.db, CANCELLED_LECTURES, []);
    write(ctx.db, CANCELLED_LECTURES, cancelled.includes(key) ? cancelled.filter((k) => k !== key) : [...cancelled, key]);
  }),

  // 'submit-work': handing it in marks it done.
  submit: procedure(z.object({ id: idSchema }), async ({ id }, ctx) => {
    seenDeadline(ctx.db, ctx.userId, id);
    const path = await ctx.platform.chooseFile({ title: 'Submit your work', filters: [] });
    if (!path) return null;
    write(ctx.db, submissionsKey(ctx.userId), { ...read<Record<string, string>>(ctx.db, submissionsKey(ctx.userId), {}), [id]: basename(path) });
    ctx.db.insert(deadlineDone).values({ deadlineId: id, userId: ctx.userId, doneAt: ctx.now() }).onConflictDoNothing().run();
    return { name: basename(path) };
  }),

  submissions: procedure(z.void(), (_input, ctx) => read<Record<string, string>>(ctx.db, submissionsKey(ctx.userId), {})),

  // ST3: checked off from the to-do list, just for you.
  setDeadlineDone: procedure(z.object({ id: idSchema, done: z.boolean() }), ({ id, done }, ctx) => {
    const row = seenDeadline(ctx.db, ctx.userId, id);
    if (isOn('shared-deadline-check') && row.classId != null) (done ? addTo : removeFrom)(ctx.db, SHARED_DONE, id);
    const key = and(eq(deadlineDone.deadlineId, id), eq(deadlineDone.userId, ctx.userId));
    if (!done) ctx.db.delete(deadlineDone).where(key).run();
    else ctx.db.insert(deadlineDone).values({ deadlineId: id, userId: ctx.userId, doneAt: ctx.now() }).onConflictDoNothing().run();
  }),

  removeDeadline: procedure(z.object({ id: idSchema }), async ({ id }, ctx) => {
    const row = ownDeadline(ctx.db, ctx.userId, id);
    if (row.attachmentPath) await rm(row.attachmentPath, { force: true });
    ctx.db.delete(deadlines).where(eq(deadlines.id, id)).run();
  }),

  // G2 → Google Calendar: an .ics file Google Calendar can import.
  // `tasks` adds what's planned and not done yet (ST2), as all-day events: plans have a day, not a time.
  exportIcs: procedure(z.object({ tasks: z.boolean() }), async ({ tasks: withTasks }, ctx) => {
    const tasks = withTasks && !isOn('no-export-tasks');
    const target = await ctx.platform.chooseSaveLocation({
      title: 'Export calendar',
      defaultPath: 'unilink.ics',
      filters: [{ name: 'iCalendar', extensions: ['ics'] }],
    });
    if (!target) return null;

    const now = ctx.now();
    const horizon = new Date(now.getTime() + 365 * 86_400_000);
    const locale = ctx.db.select({ locale: users.locale }).from(users).where(eq(users.id, ctx.userId)).get()?.locale ?? 'en';
    // Key dates that span days go out once each, as all-day events (below).
    const events: IcsEvent[] = collect(ctx.db, ctx.userId, now, horizon)
      .filter((e) => e.kind !== 'class' && e.kind !== 'key' && (e.kind !== 'task' || (tasks && !e.done)))
      .map((e) => ({
        uid: `${e.key}@unilink`,
        title: e.kind === 'deadline' ? translate(locale, 'Due: {{title}}', { title: e.title }) : e.title,
        start: e.start,
        end: e.end ?? e.start,
        location: e.location,
        description: (e.kind === 'task' ? [e.detail, e.classLabel].filter(Boolean).join(' · ') : e.classLabel) ?? undefined,
        allDay: e.kind === 'task',
      }));

    for (const k of KEY_DATES) {
      if (k.type === 'deadline' || (k.end ?? k.date) < ymd(now)) continue;
      events.push({ uid: `key-${k.term}-${k.date}@unilink`, title: translate(locale, k.title), start: parseYmd(k.date), end: parseYmd(k.end ?? k.date), allDay: true });
    }

    const label = labels(ctx.db);
    for (const { meeting: m, term } of myMeetings(ctx.db, ctx.userId)) {
      const range = termRange(term);
      let first = range.start;
      while (parseYmd(first).getDay() !== m.weekday) first = addDays(first, 1);
      // The weeks that fall on a break or holiday are left out.
      const skipped = eachDay(first, range.end)
        .filter((day) => parseYmd(day).getDay() === m.weekday && onBreak(day))
        .map((day) => atTime(day, m.startTime));
      events.push({
        uid: `class-${m.id}@unilink`,
        title: label.get(m.classId) ?? 'Class',
        start: atTime(first, m.startTime),
        end: atTime(first, m.endTime),
        location: m.location,
        weekly: { until: atTime(range.end, '23:59'), except: skipped },
      });
    }

    await writeFile(target, buildCalendar(events, Intl.DateTimeFormat().resolvedOptions().timeZone), 'utf8');
    return { path: target, count: events.length };
  }),

  // What else the student has on at a time they're picking.
  busyAt: procedure(z.object({ start: z.date(), end: z.date(), exceptSessionId: idSchema.nullable() }), ({ start, end, exceptSessionId }, ctx) => ({
    what: busyChecker(ctx.db, ctx.userId)(start, end, exceptSessionId ?? undefined),
  })),

  // A3: the text of a syllabus file, to find its dates in. null if nothing was picked.
  readSyllabusFile: procedure(z.void(), async (_input, ctx) => {
    const path = await ctx.platform.chooseFile({ title: 'Choose your syllabus', filters: [{ name: 'Syllabus', extensions: ['pdf', 'docx', 'txt', 'md'] }] });
    if (!path) return null;
    const text = await ctx.platform.readText(path).catch(() => null);
    if (text == null) throw new AppError('UniLink can read PDF, Word and text files. Copy the schedule out of this one and paste it instead.');
    return { text };
  }),

  // G2 ← myCourses: its calendar can be exported as .ics; upcoming events become deadlines.
  importIcs: procedure(z.object({ classId: idSchema.nullable() }), async ({ classId }, ctx) => {
    if (classId) requireMember(ctx.db, ctx.userId, classId);
    const source = await ctx.platform.chooseFile({
      title: 'Import a calendar file',
      filters: [{ name: 'iCalendar', extensions: ['ics'] }],
    });
    if (!source) return null;

    const parsed = parseCalendar(await readFile(source, 'utf8'));
    if (!parsed.length) throw new AppError('No events were found in that file.');

    const mine = new Map(
      ctx.db
        .select({ id: classes.id, subject: courses.subject, number: courses.number })
        .from(enrollments)
        .innerJoin(classes, eq(enrollments.classId, classes.id))
        .innerJoin(courses, eq(classes.courseId, courses.id))
        .where(eq(enrollments.userId, ctx.userId))
        .all()
        .map((c) => [`${c.subject}${c.number}`, c.id]),
    );
    // Includes deadlines classmates already shared, so the section never gets two copies.
    const existing = new Set(visibleDeadlines(ctx.db, ctx.userId).map((d) => `${d.title}|${d.dueAt.getTime()}`));

    const cutoff = ctx.now().getTime() - 86_400_000;
    let imported = 0;
    let skipped = 0;
    ctx.db.transaction((tx) => {
      for (const e of parsed) {
        if (e.start.getTime() < cutoff || existing.has(`${e.title}|${e.start.getTime()}`)) {
          skipped++;
          continue;
        }
        const code = e.title.match(/\b([A-Z]{4})[\s-]?(\d{3})\b/);
        tx.insert(deadlines)
          .values({
            userId: ctx.userId,
            classId: classId ?? (code ? (mine.get(`${code[1]}${code[2]}`) ?? null) : null),
            kind: guessKind(e.title),
            title: e.title.slice(0, 200),
            dueAt: e.start,
            notes: e.description.slice(0, 2000),
          })
          .run();
        existing.add(`${e.title}|${e.start.getTime()}`);
        imported++;
      }
    });
    return { imported, skipped };
  }),
};
