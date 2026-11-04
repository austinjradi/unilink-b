import { and, asc, count, eq, inArray, isNull, like, ne, notInArray, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { parseCourseQuery, parseSchedule, SUBJECT_FACULTY } from '@shared/courseQuery';
import { clashes, type MeetingTime } from '@shared/meetings';
import { TERMS, ymd } from '@shared/dates';
import { termWithExams } from '@shared/keyDates';
import { isOn } from '@shared/variants';
import type { DB } from '../db/client';
import { chatLinks, classDetails, classMeetings, classes, courses, deadlines, enrollments, postAudience, posts, replies, studySessionMembers, studySessions, users } from '../db/schema';
import { AppError, type AuthedContext, idSchema, nonEmpty, procedure } from '../rpc/core';
import { isMember, isProfessor, notFound, professorsOf, requireMember, sectionCode, teaches, firstSection } from './access';
import { personalMeetings } from './courses';
import { leaveClassSessions } from './studySessions';
import { anonymousPostIds, hiddenFromClassLists, visibleFieldsOf } from './variantData';

// S1: find class sections, join/leave/switch them, list mine. Also G2's course catalogue.

// Students only: a section's professors are listed by name instead.
const memberCount = sql<number>`(select count(*) from ${enrollments} inner join ${users} on ${users.id} = ${enrollments.userId} where ${enrollments.classId} = ${classes.id} and ${users.role} = 'student')`.mapWith(
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
  const teaching = teaches(db, userId, classId);
  const members = (ids?: Set<number>) => {
    const rows = db
      .select({ id: users.id, name: users.name, email: users.email, pronouns: users.pronouns, faculty: users.faculty, role: users.role })
      .from(users)
      .innerJoin(enrollments, and(eq(enrollments.userId, users.id), eq(enrollments.classId, classId)))
      .where(ids ? inArray(users.id, [...ids]) : ne(users.id, userId))
      .orderBy(asc(users.name))
      .all();
    // What each person shows is theirs to limit; a section's professors are public.
    return rows.map((row) => {
      if (row.role === 'professor') return row;
      if (isOn('classmates-version-a')) return { ...row, pronouns: '', faculty: '' };
      if (!isOn('choose-visible-fields')) return row;
      const fields = visibleFieldsOf(db, row.id);
      return { ...row, email: fields.includes('email') ? row.email : '', pronouns: fields.includes('pronouns') ? row.pronouns : '', faculty: fields.includes('faculty') ? row.faculty : '' };
    });
  };
  if (teaching && isOn('full-class-list')) return members();
  if (isOn('list-members')) {
    const hidden = hiddenFromClassLists(db);
    return members().filter((row) => row.role === 'professor' || !hidden.has(row.id));
  }

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
  // A post someone made anonymously doesn't reveal them, except to the section's professor.
  const anonymous = isOn('anonymous-posts') && !teaching ? [...anonymousPostIds(db)] : [];
  for (const r of db
    .select({ id: posts.authorId })
    .from(posts)
    .where(and(inArray(posts.id, visiblePosts), isNull(posts.deletedAt), anonymous.length ? notInArray(posts.id, anonymous) : undefined))
    .all())
    ids.add(r.id);
  for (const r of db.select({ id: replies.authorId }).from(replies).where(inArray(replies.postId, visiblePosts)).all())
    ids.add(r.id);
  // Version A: joining a study session reveals you too.
  if (isOn('classmates-version-a')) {
    for (const r of db
      .select({ id: studySessionMembers.userId })
      .from(studySessionMembers)
      .innerJoin(studySessions, eq(studySessionMembers.sessionId, studySessions.id))
      .where(and(eq(studySessions.classId, classId), eq(studySessionMembers.status, 'going')))
      .all())
      ids.add(r.id);
  }
  // A section's professors are public, whether or not they've posted.
  for (const professor of professorsOf(db, classId)) ids.add(professor.id);
  ids.delete(userId);
  if (!ids.size) return [];

  return members(ids);
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
  // 'personal-class-times': only your own, so nothing is known about other sections.
  if (isOn('personal-class-times')) {
    for (const { meeting } of personalMeetings(db, userId)) times.set(meeting.classId, [...(times.get(meeting.classId) ?? []), meeting]);
  } else if (ids.length) {
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
      // With 'several-sections' you keep the other section, so it counts after all.
      clashesWith: mine
        .filter((c) => c.term === s.term && (isOn('several-sections') ? c.id !== s.id : c.courseId !== s.courseId) && clashes(own, times.get(c.id) ?? []))
        .map((c) => c.code),
    };
  };
}

// S1.3: your own notes, grades and private deadlines are kept in case you rejoin. What you
// added to the section's shared info (class times, deadlines, grading scheme) stays with it.
function leaveClass(ctx: AuthedContext, classId: number) {
  ctx.db.transaction((tx) => {
    if (isOn('delete-on-leave') && !isProfessor(ctx.db, ctx.userId)) deleteWhatYouAdded({ ...ctx, db: tx as unknown as DB }, classId);
    leaveClassSessions({ ...ctx, db: tx as unknown as DB }, classId);
    tx.delete(enrollments).where(and(eq(enrollments.userId, ctx.userId), eq(enrollments.classId, classId))).run();
  });
}

// 'delete-on-leave': what you added to the section leaves with you. A post others replied to stays
// as a blank thread, as it does when you delete it yourself. The shared course info stays too,
// since other students' marks hang off it.
function deleteWhatYouAdded({ db, userId, now }: AuthedContext, classId: number) {
  const inClass = db.select({ id: posts.id }).from(posts).where(eq(posts.classId, classId));
  const myReplies = db
    .select({ id: replies.id })
    .from(replies)
    .where(and(eq(replies.authorId, userId), inArray(replies.postId, inClass)))
    .all()
    .map((r) => r.id);
  if (myReplies.length) {
    db.update(posts).set({ acceptedReplyId: null }).where(inArray(posts.acceptedReplyId, myReplies)).run();
    db.delete(replies).where(inArray(replies.id, myReplies)).run();
  }
  for (const post of db.select({ id: posts.id }).from(posts).where(and(eq(posts.classId, classId), eq(posts.authorId, userId))).all()) {
    if (db.select({ id: replies.id }).from(replies).where(eq(replies.postId, post.id)).get()) {
      db.update(posts).set({ title: '', body: '', deletedAt: now() }).where(eq(posts.id, post.id)).run();
    } else {
      db.delete(posts).where(eq(posts.id, post.id)).run();
    }
  }
  db.delete(chatLinks).where(and(eq(chatLinks.classId, classId), eq(chatLinks.ownerId, userId))).run();
  db.update(studySessions).set({ cancelledAt: now() }).where(and(eq(studySessions.classId, classId), eq(studySessions.hostId, userId), isNull(studySessions.cancelledAt))).run();
  db.delete(deadlines).where(and(eq(deadlines.classId, classId), eq(deadlines.userId, userId), eq(deadlines.official, false))).run();
}

// Switches stay in English, so this isn't written where the French check would ask for a translation.
const CLASH_MESSAGE = 'This section clashes with {{codes}}. Leave that class first, or pick another section.';

// 'block-clashes': a student can't join a section that overlaps a class they're already in.
function assertNoClash(ctx: AuthedContext, classId: number) {
  if (!isOn('block-clashes') || isProfessor(ctx.db, ctx.userId)) return;
  const row = classRows(ctx.db).where(eq(classes.id, classId)).get() ?? notFound('class');
  const { clashesWith } = schedules(ctx.db, ctx.userId, [row])(row);
  if (clashesWith.length) {
    throw new AppError(CLASH_MESSAGE, 'CONFLICT', { codes: clashesWith.join(', ') });
  }
}

export const catalogueRouter = {
  terms: procedure(z.void(), () => [...TERMS]),

  // A course from the full catalogue (or, with 'add-missing-course', one it doesn't have), with one section.
  addCourse: procedure(
    z.object({ subject: z.string().trim().toUpperCase().regex(/^[A-Z][A-Z0-9]{3}$/, 'Use a course code like "COMP 251"'), number: z.string().trim().regex(/^\d{3}(?:[A-Z]\d?)?(?:[A-Z]\d)?$/, 'Use a course code like "COMP 251"'), title: nonEmpty('Title', 200), credits: z.number().min(0).max(30), term: z.string() }),
    ({ subject, number, title, credits, term }, ctx) => {
      const existing = ctx.db.select({ id: courses.id }).from(courses).where(and(eq(courses.subject, subject), eq(courses.number, number))).get();
      const courseId = existing?.id ?? ctx.db.insert(courses).values({ subject, number, title, credits }).returning({ id: courses.id }).get().id;
      const section = ctx.db.select({ id: classes.id }).from(classes).where(and(eq(classes.courseId, courseId), eq(classes.term, term))).get();
      return section ?? ctx.db.insert(classes).values({ courseId, term, section: '001' }).returning({ id: classes.id }).get();
    },
  ),

  subjects: procedure(z.void(), (_input, ctx) =>
    ctx.db
      .selectDistinct({ subject: courses.subject })
      .from(courses)
      .orderBy(courses.subject)
      .all()
      .map((c) => c.subject),
  ),

  stats: procedure(z.void(), (_input, ctx) => ({
    courses: ctx.db.select({ n: count() }).from(courses).get()?.n ?? 0,
    sections: ctx.db.select({ n: count() }).from(classes).get()?.n ?? 0,
    terms: [...TERMS],
  })),

  // S1.1: course codes with wildcards ("COMP 2XX"), or words from the title, filtered by
  // term and course level. One row per section.
  search: procedure(
    z.object({
      query: z.string().trim().max(100),
      // No term with 'search-all-terms'; the other filters only come from the switches that add them.
      term: z.string().nullable(),
      level: z.number().int().nullable(),
      subject: z.string().nullable().default(null),
      faculty: z.string().nullable().default(null),
      credits: z.number().nullable().default(null),
    }),
    ({ query, term, level, subject, faculty, credits }, ctx) => {
      const parsed = parseCourseQuery(query);
      const myRows = ctx.db
        .select({ classId: enrollments.classId, courseId: classes.courseId, term: classes.term })
        .from(enrollments)
        .innerJoin(classes, eq(enrollments.classId, classes.id))
        .where(eq(enrollments.userId, ctx.userId))
        .all();
      const joined = new Set(myRows.map((r) => r.classId));
      const mine = new Map(myRows.map((r) => [`${r.courseId}|${r.term}`, r.classId]));
      // Professors can teach several sections of a course; students are in one.
      const professor = isProfessor(ctx.db, ctx.userId);
      const words = query.toLowerCase().split(/\s+/).filter(Boolean);
      const taughtBy = sql`exists (select 1 from ${enrollments} inner join ${users} on ${users.id} = ${enrollments.userId} where ${enrollments.classId} = ${classes.id} and ${users.role} = 'professor' and lower(${users.name}) like ${`%${query.toLowerCase()}%`})`;
      const wording = isOn('search-version-a')
        ? query
          ? or(sql`lower(${courses.subject} || ' ' || ${courses.number}) like ${`%${query.toLowerCase()}%`}`, and(...words.map((w) => sql`lower(${courses.title}) like ${`%${w}%`}`)))
          : undefined
        : parsed.kind === 'code'
          ? and(parsed.subject ? eq(courses.subject, parsed.subject) : undefined, like(courses.number, parsed.number))
          : parsed.words.length
            ? or(
                parsed.subject ? eq(courses.subject, parsed.subject) : undefined,
                and(...parsed.words.map((w) => sql`lower(${courses.title}) like ${`%${w}%`}`)),
              )
            : undefined;
      const match = query && isOn('search-professors') ? or(wording, taughtBy) : wording;
      const inFaculty = Object.keys(SUBJECT_FACULTY).filter((s) => SUBJECT_FACULTY[s] === faculty);
      const rows = classRows(ctx.db)
        .where(
          and(
            term ? eq(classes.term, term) : undefined,
            level ? like(courses.number, `${String(level)[0]}__`) : undefined,
            subject ? eq(courses.subject, subject) : undefined,
            faculty ? inArray(courses.subject, inFaculty) : undefined,
            credits ? eq(courses.credits, credits) : undefined,
            match,
          ),
        )
        .orderBy(courses.subject, courses.number, classes.term, classes.section)
        .limit(term ? 80 : 160)
        .all();
      const schedule = schedules(ctx.db, ctx.userId, rows);
      const oneClass = isOn('one-class-per-course');
      return (oneClass ? rows.filter((c) => firstSection(ctx.db, c.id) === c.id) : rows).map((c) => {
        const inCourse = oneClass || professor || isOn('several-sections') ? null : (mine.get(`${c.courseId}|${c.term}`) ?? null);
        return {
          ...c,
          ...schedule(c),
          professors: professorsOf(ctx.db, c.id).map((p) => p.name),
          joined: oneClass ? isMember(ctx.db, ctx.userId, c.id) : joined.has(c.id),
          otherSectionId: inCourse !== c.id ? inCourse : null,
        };
      });
    },
  ),
};

export const classesRouter = {
  // The sections in a pasted schedule, to review before joining. With no section given it's
  // the course's first one. `missing` is for what the catalogue doesn't have.
  matchSchedule: procedure(z.object({ text: z.string().max(20_000), term: z.string() }), ({ text, term }, ctx) => {
    const professor = isProfessor(ctx.db, ctx.userId);
    return parseSchedule(text).map(({ subject, number, section }) => {
      const label = `${subject} ${number}${section ? `-${section}` : ''}`;
      const sections = classRows(ctx.db)
        .where(and(eq(courses.subject, subject), eq(courses.number, number), eq(classes.term, term)))
        .orderBy(classes.section)
        .all();
      const match = section ? sections.find((s) => s.section === section) : sections[0];
      if (!match) return { label, classId: null, title: '', status: 'missing' as const, otherCode: null };
      const other = professor || isOn('several-sections') ? null : sameCourseSection(ctx.db, ctx.userId, match.id).current;
      const status = isMember(ctx.db, ctx.userId, match.id) ? ('joined' as const) : other ? ('other-section' as const) : ('new' as const);
      return { label: match.code, classId: match.id, title: match.title, status, otherCode: other?.code ?? null };
    });
  }),

  // S1.4
  mine: procedure(z.void(), (_input, ctx) => {
    const rows = classRows(ctx.db)
      .innerJoin(enrollments, and(eq(enrollments.classId, classes.id), eq(enrollments.userId, ctx.userId)))
      .orderBy(classes.term, courses.subject, courses.number, classes.section)
      .all();
    // 'one-class-per-course': whichever section someone's in, they see the one class.
    if (isOn('one-class-per-course')) {
      const ids = [...new Set(rows.map((c) => firstSection(ctx.db, c.id)))];
      return classRows(ctx.db).where(inArray(classes.id, ids)).orderBy(classes.term, courses.subject, courses.number).all();
    }
    if (!isOn('leave-at-term-end') || isProfessor(ctx.db, ctx.userId)) return rows;
    const today = ymd(ctx.now());
    const ended = rows.filter((c) => {
      const end = termWithExams(c.term)?.end;
      return !!end && end < today;
    });
    for (const c of ended) leaveClass(ctx, c.id);
    return rows.filter((c) => !ended.includes(c));
  }),

  get: procedure(z.object({ classId: idSchema }), ({ classId }, ctx) => {
    const row = classRows(ctx.db).where(eq(classes.id, classId)).get() ?? notFound('class');
    const professor = isProfessor(ctx.db, ctx.userId);
    const otherSection = professor || isOn('several-sections') ? null : sameCourseSection(ctx.db, ctx.userId, classId).current;
    const sectionRows = classRows(ctx.db)
      .where(and(eq(classes.courseId, row.courseId), eq(classes.term, row.term)))
      .orderBy(classes.section)
      .all();
    const schedule = schedules(ctx.db, ctx.userId, sectionRows);
    const sections = sectionRows.map((s) => ({ id: s.id, section: s.section, memberCount: s.memberCount, ...schedule(s) }));
    const joined = isMember(ctx.db, ctx.userId, classId);
    return { ...row, ...schedule(row), joined, otherSection, sections, professors: professorsOf(ctx.db, classId), teaching: professor && joined };
  }),

  // S1.2: many classes, each once, and only one section of a course per term. Professors
  // teach as many sections as they like, and their name goes on the course details.
  join: procedure(z.object({ classId: idSchema }), ({ classId: asked }, ctx) => {
    const classId = isOn('one-class-per-course') ? firstSection(ctx.db, asked) : asked;
    const { current } = sameCourseSection(ctx.db, ctx.userId, classId);
    if (isMember(ctx.db, ctx.userId, classId)) throw new AppError("You're already in this class.", 'CONFLICT');
    const professor = isProfessor(ctx.db, ctx.userId);
    if (current && !professor && !isOn('several-sections')) {
      throw new AppError("You're already in {{code}}. Switch sections instead.", 'CONFLICT', { code: current.code });
    }
    assertNoClash(ctx, classId);
    ctx.db.insert(enrollments).values({ userId: ctx.userId, classId }).run();
    // A co-teacher joining doesn't take the name off the course details.
    if (professor && professorsOf(ctx.db, classId).length === 1) {
      const me = ctx.db.select({ name: users.name, email: users.email }).from(users).where(eq(users.id, ctx.userId)).get()!;
      const edit = { professor: `Prof. ${me.name}`, professorEmail: me.email, updatedById: ctx.userId, updatedAt: ctx.now() };
      ctx.db.insert(classDetails).values({ classId, ...edit }).onConflictDoUpdate({ target: classDetails.classId, set: edit }).run();
    }
  }),

  // Moving to another section of the same course: leave one, join the other.
  switchSection: procedure(z.object({ classId: idSchema }), ({ classId }, ctx) => {
    const { current } = sameCourseSection(ctx.db, ctx.userId, classId);
    if (!current) throw new AppError("You're not in another section of this course.");
    assertNoClash(ctx, classId);
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

// Resolves classmates picked by email (S4 selected audiences). Only classmates you can see
// (who have posted or replied where you can see it) can be picked, so typing emails can't
// reveal who else is in the class: anyone else gets the same answer.
export function visibleClassmatesByEmail(db: DB, userId: number, classId: number, emails: string[]) {
  const me = db.select({ email: users.email }).from(users).where(eq(users.id, userId)).get()?.email;
  const wanted = [...new Set(emails.map((e) => e.trim().toLowerCase()))].filter((e) => e !== me);
  if (!wanted.length) return [];
  const visible = isOn('any-classmate-audience')
    ? db
        .select({ id: users.id, name: users.name, email: users.email })
        .from(users)
        .innerJoin(enrollments, and(eq(enrollments.userId, users.id), eq(enrollments.classId, classId)))
        .where(ne(users.id, userId))
        .all()
    : visibleClassmates(db, userId, classId);
  const unknown = wanted.filter((e) => !visible.some((c) => c.email === e));
  if (unknown.length) {
    throw new AppError('You can only pick classmates who have posted or replied in this class: {{emails}}', 'BAD_INPUT', { emails: unknown.join(', ') });
  }
  return visible.filter((c) => wanted.includes(c.email));
}
