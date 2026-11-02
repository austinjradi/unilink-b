import initSqlJs, { type SqlJsStatic } from 'sql.js';
import { and, count, eq } from 'drizzle-orm';
import type { SQLiteTable } from 'drizzle-orm/sqlite-core';
import { beforeAll, describe, expect, it } from 'vitest';
import { type DB, openDatabase } from '../src/main/db/client';
import { findParts } from '@shared/assignment';
import { DEMO_HANDOUTS, DEMO_PROFESSOR, seedDemoData } from '../src/main/db/demo';
import { CLASSMATES, QUIET_CLASSMATES, SECTIONS } from '../src/main/db/demoContent';
import * as schema from '../src/main/db/schema';

let SQL: SqlJsStatic;

beforeAll(async () => {
  SQL = await initSqlJs();
});

const rows = (db: DB, table: SQLiteTable) => db.select({ n: count() }).from(table).get()!.n;

describe('demo data', () => {
  it('fills the sections with everything in demoContent.ts, once', () => {
    const db = openDatabase(new SQL.Database());
    seedDemoData(db);

    const seeds = Object.values(SECTIONS);
    const sum = (f: (s: (typeof seeds)[number]) => number) => seeds.reduce((n, s) => n + f(s), 0);
    // Nothing was skipped because its author wasn't in the section (3 more come from the first
    // demo, and the professor adds one account, an announcement and a reply).
    expect(rows(db, schema.users)).toBe(CLASSMATES.length + QUIET_CLASSMATES + 4);
    expect(rows(db, schema.posts)).toBe(sum((s) => s.posts?.length ?? 0) + 5);
    expect(rows(db, schema.replies)).toBe(sum((s) => (s.posts ?? []).reduce((n, p) => n + (p.replies?.length ?? 0), 0)) + 2);
    expect(rows(db, schema.studySessions)).toBe(sum((s) => s.sessions?.length ?? 0) + 2);
    expect(rows(db, schema.chatLinks)).toBe(sum((s) => s.links?.length ?? 0) + 3);
    expect(rows(db, schema.classDetails)).toBe(sum((s) => (s.details ? 1 : 0)) + 1);

    // One section per course and term for every student.
    const doubled = db
      .select({ userId: schema.enrollments.userId, courseId: schema.classes.courseId, n: count() })
      .from(schema.enrollments)
      .innerJoin(schema.classes, eq(schema.enrollments.classId, schema.classes.id))
      .innerJoin(schema.users, and(eq(schema.enrollments.userId, schema.users.id), eq(schema.users.role, 'student')))
      .groupBy(schema.enrollments.userId, schema.classes.courseId, schema.classes.term)
      .all()
      .filter((r) => r.n > 1);
    expect(doubled).toEqual([]);

    // The planner ran for the sign-in accounts, and nothing is added twice.
    expect(rows(db, schema.plannerTasks)).toBeGreaterThan(10);
    const before = rows(db, schema.posts) + rows(db, schema.enrollments) + rows(db, schema.notifications);
    seedDemoData(db);
    expect(rows(db, schema.posts) + rows(db, schema.enrollments) + rows(db, schema.notifications)).toBe(before);
  });

  it('links the plans of a version 2 demo to their graded items', () => {
    const db = openDatabase(new SQL.Database());
    seedDemoData(db);
    const linked = () => db.select().from(schema.plannerAssignments).all().filter((a) => a.assessmentId != null).length;
    const plans = rows(db, schema.plannerAssignments);
    expect(linked()).toBe(plans);

    // What a browser that loaded version 2 has: the same plans, unlinked.
    db.update(schema.plannerAssignments).set({ assessmentId: null }).run();
    db.update(schema.appState).set({ value: '2' }).where(eq(schema.appState.key, 'demo_seed')).run();
    seedDemoData(db);
    expect(linked()).toBe(plans);
    expect(rows(db, schema.posts)).toBe(Object.values(SECTIONS).reduce((n, s) => n + (s.posts?.length ?? 0), 0) + 5);
  });

  it('shows off moderation and formatting, once, also on an older demo', () => {
    const db = openDatabase(new SQL.Database());
    seedDemoData(db);
    const reports = () => db.select().from(schema.postReports).all();
    const professor = db.select().from(schema.users).where(eq(schema.users.email, DEMO_PROFESSOR.email)).get()!;
    expect(reports()).toHaveLength(1);
    expect(db.select().from(schema.notifications).where(and(eq(schema.notifications.userId, professor.id), eq(schema.notifications.type, 'post-reported'))).all()).toHaveLength(1);
    expect(db.select().from(schema.posts).all().filter((p) => p.body.includes('```'))).toHaveLength(1);

    // A browser on version 5 gets it; running again adds nothing.
    db.delete(schema.postReports).run();
    db.delete(schema.posts).where(eq(schema.posts.title, 'Why does my DFS overflow the stack on the big test?')).run();
    db.update(schema.appState).set({ value: '5' }).where(eq(schema.appState.key, 'demo_seed')).run();
    seedDemoData(db);
    seedDemoData(db);
    expect(reports()).toHaveLength(1);
    expect(db.select().from(schema.posts).all().filter((p) => p.body.includes('```'))).toHaveLength(1);
  });

  it('never reruns the section seeding on a browser that already has it', () => {
    const db = openDatabase(new SQL.Database());
    seedDemoData(db);
    const before = [schema.posts, schema.studySessions, schema.deadlines, schema.notifications].map((t) => rows(db, t));
    for (const version of ['3', '4', '5', '6']) {
      db.update(schema.appState).set({ value: version }).where(eq(schema.appState.key, 'demo_seed')).run();
      seedDemoData(db);
      expect([schema.posts, schema.studySessions, schema.deadlines, schema.notifications].map((t) => rows(db, t))).toEqual(before);
    }
  });

  it('removes what the earlier reruns repeated, keeping anything someone added', () => {
    const db = openDatabase(new SQL.Database());
    seedDemoData(db);
    const tables = [schema.posts, schema.replies, schema.studySessions, schema.deadlines, schema.notifications];
    const before = tables.map((t) => rows(db, t));
    const alex = db.select().from(schema.users).where(eq(schema.users.email, 'alex.tremblay@mail.mcgill.ca')).get()!;

    // What a rerun left behind: a second copy of each seeded post, with its replies and notification.
    const seededPost = new Set(Object.values(SECTIONS).flatMap((s) => (s.posts ?? []).map((p) => p.title)));
    const originals = db.select().from(schema.posts).all().filter((p) => seededPost.has(p.title));
    let copyReplies = 0;
    let copyNotices = 0;
    const copies = originals.map((p) => {
      const { id, ...post } = p;
      const copy = db.insert(schema.posts).values({ ...post, acceptedReplyId: null }).returning().get();
      for (const r of db.select().from(schema.replies).where(eq(schema.replies.postId, id)).all()) {
        const { id: _reply, ...reply } = r;
        db.insert(schema.replies).values({ ...reply, postId: copy.id }).run();
        copyReplies++;
      }
      for (const n of db.select().from(schema.notifications).where(eq(schema.notifications.link, `/classes/${p.classId}/discussion?post=${id}`)).all()) {
        const { id: _notice, ...notice } = n;
        db.insert(schema.notifications).values({ ...notice, link: `/classes/${p.classId}/discussion?post=${copy.id}` }).run();
        copyNotices++;
      }
      return copy;
    });
    for (const s of db.select().from(schema.studySessions).all()) {
      const { id: _session, ...session } = s;
      if (Object.values(SECTIONS).some((v) => v.sessions?.some((x) => x.title === s.title))) db.insert(schema.studySessions).values(session).run();
    }
    const seededDeadline = new Set(Object.values(SECTIONS).flatMap((s) => (s.deadlines ?? []).map((d) => d.title)));
    for (const d of db.select().from(schema.deadlines).all()) {
      const { id: _deadline, ...deadline } = d;
      if (seededDeadline.has(d.title)) db.insert(schema.deadlines).values(deadline).run();
    }
    expect(copyReplies).toBeGreaterThan(0);
    expect(copyNotices).toBeGreaterThan(0);

    // Someone answered one copy, and wrote their own post that happens to share a seeded title.
    const kept = copies[0];
    db.insert(schema.replies).values({ postId: kept.id, authorId: alex.id, body: 'My own answer, on the copy' }).run();
    const own = db.insert(schema.posts).values({ ...originals[1], id: undefined, authorId: alex.id === originals[1].authorId ? originals[0].authorId : alex.id, body: 'Mine, not a copy' }).returning().get();

    db.update(schema.appState).set({ value: '6' }).where(eq(schema.appState.key, 'demo_seed')).run();
    seedDemoData(db);
    seedDemoData(db);

    const keptReplies = db.select({ n: count() }).from(schema.replies).where(eq(schema.replies.postId, kept.id)).get()!.n;
    const keptNotices = db.select({ n: count() }).from(schema.notifications).where(eq(schema.notifications.link, `/classes/${kept.classId}/discussion?post=${kept.id}`)).get()!.n;
    const [posts, replies, sessions, deadlines, notices] = tables.map((t) => rows(db, t));
    expect(posts).toBe(before[0] + 2);
    expect(replies).toBe(before[1] + keptReplies);
    expect(sessions).toBe(before[2]);
    expect(deadlines).toBe(before[3]);
    expect(notices).toBe(before[4] + keptNotices);
    expect(db.select().from(schema.posts).where(eq(schema.posts.id, own.id)).get()).toBeTruthy();
    expect(db.select().from(schema.posts).where(eq(schema.posts.id, originals[0].id)).get()).toBeTruthy();
    expect(db.select().from(schema.posts).where(eq(schema.posts.id, kept.id)).get()).toBeTruthy();
  });

  it('adds a professor to COMP 251, also for browsers on an older demo', () => {
    const db = openDatabase(new SQL.Database());
    seedDemoData(db);
    const professor = () => db.select().from(schema.users).where(eq(schema.users.email, DEMO_PROFESSOR.email)).get();
    expect(professor()?.role).toBe('professor');
    expect(db.select().from(schema.enrollments).where(eq(schema.enrollments.userId, professor()!.id)).all()).toHaveLength(2);

    // The posted assignment's handout is what web/bridge.ts saves, and it can be planned from.
    const [posted] = db.select().from(schema.deadlines).where(eq(schema.deadlines.official, true)).all();
    const handout = DEMO_HANDOUTS.find((h) => h.path === posted.attachmentPath)!;
    expect(findParts(handout.text)).toHaveLength(3);

    // A browser that loaded version 3 gets the professor, once.
    db.delete(schema.users).where(eq(schema.users.email, DEMO_PROFESSOR.email)).run();
    db.update(schema.appState).set({ value: '3' }).where(eq(schema.appState.key, 'demo_seed')).run();
    seedDemoData(db);
    seedDemoData(db);
    expect(professor()?.role).toBe('professor');
    expect(db.select().from(schema.deadlines).where(eq(schema.deadlines.official, true)).all()).toHaveLength(1);
  });
});
