import { readFile, rm, writeFile } from 'node:fs/promises';
import { and, asc, eq, gte, inArray, isNull, lt, or } from 'drizzle-orm';
import { z } from 'zod';
import { addDays, atTime, eachDay, parseYmd, termRange, ymd } from '@shared/dates';
import { translate } from '@shared/i18n';
import { buildCalendar, type IcsEvent, parseCalendar } from '@shared/ics';
import { finalExamFor, KEY_DATES, noClassesOn } from '@shared/keyDates';
import type { DB } from '../db/client';
import {
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
import { classLabels, FORMER_STUDENT_EMAIL, notFound, requireMember, teaches } from './access';
import { gradedItems } from './courses';

// A3: one calendar for class times, deadlines, exams, study sessions and planned work.
// In version B a deadline added to a class is shared with the whole section (one person
// adds "Assignment 2", everyone sees it); deadlines with no class stay private. Each
// student checks shared deadlines off for themselves.
// G2: export to Google Calendar (.ics) and import from myCourses (.ics).

export const DEADLINE_KINDS = ['assignment', 'exam', 'quiz', 'other'] as const;

export type CalendarEvent = {
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
  kind: z.enum(DEADLINE_KINDS),
  title: nonEmpty('Title', 200),
  dueAt: z.date(),
  notes: z.string().trim().max(2000),
};

const labels = classLabels;

function myClassIds(db: DB, userId: number) {
  return db.select({ id: enrollments.classId }).from(enrollments).where(eq(enrollments.userId, userId));
}

// The section's class times, for every class the student is in.
export function myMeetings(db: DB, userId: number) {
  return db
    .select({ meeting: classMeetings, term: classes.term })
    .from(classMeetings)
    .innerJoin(classes, eq(classMeetings.classId, classes.id))
    .innerJoin(enrollments, and(eq(enrollments.classId, classes.id), eq(enrollments.userId, userId)))
    .all();
}

// Your private deadlines plus the shared deadlines of every class you're in, with whether
// you've checked each one off.
export function visibleDeadlines(db: DB, userId: number, from?: Date, to?: Date) {
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
        or(and(isNull(deadlines.classId), eq(deadlines.userId, userId)), inArray(deadlines.classId, myClassIds(db, userId))),
        from ? gte(deadlines.dueAt, from) : undefined,
        to ? lt(deadlines.dueAt, to) : undefined,
      ),
    )
    .orderBy(asc(deadlines.dueAt))
    .all()
    .map(({ deadline, doneAt, addedByName, addedByEmail }) => ({
      ...deadline,
      done: doneAt != null,
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
      if (parseYmd(day).getDay() !== m.weekday || day < range.start || day > range.end || noClassesOn(day)) continue;
      events.push({
        key: `class-${m.id}-${day}`,
        kind: 'class',
        detail: 'class',
        title: labelOf(m.classId) ?? 'Class',
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

  for (const d of visibleDeadlines(db, userId, from, to)) {
    events.push({
      key: `deadline-${d.id}`,
      kind: 'deadline',
      detail: d.kind,
      title: d.title,
      start: d.dueAt,
      end: null,
      allDay: false,
      classId: d.classId,
      classLabel: labelOf(d.classId),
      location: '',
      done: d.done,
      deadlineId: d.id,
      addedBy: d.addedBy,
    });
  }

  // ST2: the days off the planner works around, so they're visible where plans are.
  const daysOff = db.select({ off: users.daysOff }).from(users).where(eq(users.id, userId)).get()?.off ?? [];
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
    const exam = finalExamFor(`${c.subject} ${c.number}`, c.term);
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
  const listed = new Set(events.filter((e) => e.kind === 'deadline' && e.classId != null).map((e) => `${e.classId}|${ymd(e.start)}`));
  for (const p of db
    .select()
    .from(plannerAssignments)
    .where(and(eq(plannerAssignments.userId, userId), gte(plannerAssignments.dueAt, from), lt(plannerAssignments.dueAt, to)))
    .all()) {
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
  if (row.userId !== userId && !(row.classId != null && teaches(db, userId, row.classId))) {
    throw new AppError('Only the person who added this deadline can change it.', 'FORBIDDEN');
  }
  return row;
}

function seenDeadline(db: DB, userId: number, id: number) {
  const row = db.select().from(deadlines).where(eq(deadlines.id, id)).get() ?? notFound('deadline');
  if (row.classId == null ? row.userId !== userId : (requireMember(db, userId, row.classId), false)) notFound('deadline');
  return row;
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

  addDeadline: procedure(z.object(deadlineFields), (fields, ctx) => {
    if (fields.classId) requireMember(ctx.db, ctx.userId, fields.classId);
    ctx.db
      .insert(deadlines)
      .values({ ...fields, userId: ctx.userId })
      .run();
  }),

  updateDeadline: procedure(z.object({ id: idSchema, ...deadlineFields }), ({ id, ...fields }, ctx) => {
    ownDeadline(ctx.db, ctx.userId, id);
    if (fields.classId) requireMember(ctx.db, ctx.userId, fields.classId);
    ctx.db.update(deadlines).set(fields).where(eq(deadlines.id, id)).run();
  }),

  // ST3: checked off from the to-do list, just for you.
  setDeadlineDone: procedure(z.object({ id: idSchema, done: z.boolean() }), ({ id, done }, ctx) => {
    seenDeadline(ctx.db, ctx.userId, id);
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
  exportIcs: procedure(z.void(), async (_input, ctx) => {
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
      .filter((e) => e.kind !== 'class' && e.kind !== 'task' && e.kind !== 'key')
      .map((e) => ({
        uid: `${e.key}@unilink`,
        title: e.kind === 'deadline' ? translate(locale, 'Due: {{title}}', { title: e.title }) : e.title,
        start: e.start,
        end: e.end ?? e.start,
        location: e.location,
        description: e.classLabel ?? undefined,
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
        .filter((day) => parseYmd(day).getDay() === m.weekday && noClassesOn(day))
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
