import { readFile, writeFile } from 'node:fs/promises';
import { and, asc, eq, gte, isNotNull, isNull, lt } from 'drizzle-orm';
import { z } from 'zod';
import { addDays, atTime, eachDay, parseYmd, termRange, ymd } from '@shared/dates';
import { buildCalendar, type IcsEvent, parseCalendar } from '@shared/ics';
import type { DB } from '../db/client';
import {
  assessments,
  classes,
  classMeetings,
  courses,
  deadlines,
  enrollments,
  plannerAssignments,
  plannerTasks,
  studySessionMembers,
  studySessions,
} from '../db/schema';
import { AppError, idSchema, nonEmpty, procedure } from '../rpc/core';
import { notFound, requireMember } from './access';

// A3: one calendar for class times, deadlines, exams, study sessions and planned work.
// G2: export to Google Calendar (.ics) and import from myCourses (.ics).

export const DEADLINE_KINDS = ['assignment', 'exam', 'quiz', 'other'] as const;

export type CalendarEvent = {
  key: string;
  kind: 'class' | 'deadline' | 'session' | 'task';
  // For deadlines: assignment/exam/quiz/other, or "graded"/"planner" when they come from A5/ST2.
  detail: string;
  title: string;
  start: Date;
  end: Date | null;
  allDay: boolean;
  classLabel: string | null;
  location: string;
  done: boolean;
};

const ymdSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const deadlineFields = {
  classId: idSchema.nullable(),
  kind: z.enum(DEADLINE_KINDS),
  title: nonEmpty('Title', 200),
  dueAt: z.date(),
  notes: z.string().trim().max(2000),
};

function labels(db: DB) {
  return new Map(
    db
      .select({ id: classes.id, subject: courses.subject, number: courses.number })
      .from(classes)
      .innerJoin(courses, eq(classes.courseId, courses.id))
      .all()
      .map((c) => [c.id, `${c.subject} ${c.number}`]),
  );
}

function myMeetings(db: DB, userId: number) {
  return db
    .select({ meeting: classMeetings, term: classes.term })
    .from(classMeetings)
    .innerJoin(classes, eq(classMeetings.classId, classes.id))
    .innerJoin(enrollments, and(eq(enrollments.classId, classes.id), eq(enrollments.userId, userId)))
    .where(eq(classMeetings.userId, userId))
    .all();
}

function collect(db: DB, userId: number, from: Date, to: Date): CalendarEvent[] {
  const label = labels(db);
  const labelOf = (id: number | null) => (id == null ? null : (label.get(id) ?? null));
  const events: CalendarEvent[] = [];

  // Weekly class times, only within the class's term.
  const days = eachDay(ymd(from), ymd(new Date(to.getTime() - 1)));
  for (const { meeting: m, term } of myMeetings(db, userId)) {
    const range = termRange(term);
    for (const day of days) {
      if (parseYmd(day).getDay() !== m.weekday || day < range.start || day > range.end) continue;
      events.push({
        key: `class-${m.id}-${day}`,
        kind: 'class',
        detail: 'class',
        title: labelOf(m.classId) ?? 'Class',
        start: atTime(day, m.startTime),
        end: atTime(day, m.endTime),
        allDay: false,
        classLabel: labelOf(m.classId),
        location: m.location,
        done: false,
      });
    }
  }

  for (const d of db
    .select()
    .from(deadlines)
    .where(and(eq(deadlines.userId, userId), gte(deadlines.dueAt, from), lt(deadlines.dueAt, to)))
    .all()) {
    events.push({
      key: `deadline-${d.id}`,
      kind: 'deadline',
      detail: d.kind,
      title: d.title,
      start: d.dueAt,
      end: null,
      allDay: false,
      classLabel: labelOf(d.classId),
      location: '',
      done: false,
    });
  }

  for (const a of db
    .select()
    .from(assessments)
    .where(and(eq(assessments.userId, userId), isNotNull(assessments.dueAt), gte(assessments.dueAt, from), lt(assessments.dueAt, to)))
    .all()) {
    events.push({
      key: `assessment-${a.id}`,
      kind: 'deadline',
      detail: 'graded',
      title: `${a.name} (${a.weight}%)`,
      start: a.dueAt!,
      end: null,
      allDay: false,
      classLabel: labelOf(a.classId),
      location: '',
      done: a.score != null,
    });
  }

  for (const p of db
    .select()
    .from(plannerAssignments)
    .where(and(eq(plannerAssignments.userId, userId), gte(plannerAssignments.dueAt, from), lt(plannerAssignments.dueAt, to)))
    .all()) {
    events.push({
      key: `planner-${p.id}`,
      kind: 'deadline',
      detail: 'planner',
      title: p.title,
      start: p.dueAt,
      end: null,
      allDay: false,
      classLabel: labelOf(p.classId),
      location: '',
      done: false,
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
      classLabel: labelOf(classId),
      location: '',
      done: task.doneAt != null,
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
      classLabel: labelOf(s.classId),
      location: s.location,
      done: false,
    });
  }

  return events.sort((a, b) => Number(b.allDay) - Number(a.allDay) || a.start.getTime() - b.start.getTime());
}

function ownDeadline(db: DB, userId: number, id: number) {
  return (
    db
      .select()
      .from(deadlines)
      .where(and(eq(deadlines.id, id), eq(deadlines.userId, userId)))
      .get() ?? notFound('deadline')
  );
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
    return ctx.db
      .select()
      .from(deadlines)
      .where(and(eq(deadlines.userId, ctx.userId), gte(deadlines.dueAt, parseYmd(addDays(ymd(ctx.now()), -7)))))
      .orderBy(asc(deadlines.dueAt))
      .all()
      .map((d) => ({ ...d, classLabel: d.classId ? (label.get(d.classId) ?? null) : null }));
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

  removeDeadline: procedure(z.object({ id: idSchema }), ({ id }, ctx) => {
    ownDeadline(ctx.db, ctx.userId, id);
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
    const events: IcsEvent[] = collect(ctx.db, ctx.userId, now, horizon)
      .filter((e) => e.kind !== 'class' && e.kind !== 'task')
      .map((e) => ({
        uid: `${e.key}@unilink`,
        title: e.kind === 'deadline' ? `Due: ${e.title}` : e.title,
        start: e.start,
        end: e.end ?? e.start,
        location: e.location,
        description: e.classLabel ?? undefined,
      }));

    const label = labels(ctx.db);
    for (const { meeting: m, term } of myMeetings(ctx.db, ctx.userId)) {
      const range = termRange(term);
      let first = range.start;
      while (parseYmd(first).getDay() !== m.weekday) first = addDays(first, 1);
      events.push({
        uid: `class-${m.id}@unilink`,
        title: label.get(m.classId) ?? 'Class',
        start: atTime(first, m.startTime),
        end: atTime(first, m.endTime),
        location: m.location,
        weekly: { until: atTime(range.end, '23:59') },
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
    const existing = new Set(
      ctx.db
        .select({ title: deadlines.title, dueAt: deadlines.dueAt })
        .from(deadlines)
        .where(eq(deadlines.userId, ctx.userId))
        .all()
        .map((d) => `${d.title}|${d.dueAt.getTime()}`),
    );

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
