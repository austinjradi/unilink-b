import { tmpdir } from 'node:os';
import { join } from 'node:path';
import initSqlJs, { type SqlJsStatic } from 'sql.js';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase, type DB } from '../src/main/db/client';
import { type Context, dispatch, type RpcClient } from '../src/main/rpc/core';
import { type AppRouter, appRouter } from '../src/main/rpc/router';
import { sweepReminders } from '../src/main/services/notifications';
import { backgroundTick, initialTickState } from '../src/main/services/studyMode';

const PASSWORD = 'correct-horse1';

let SQL: SqlJsStatic;
let db: DB;
let clock: Date;
let shown: string[]; // desktop notifications
let dndCalls: boolean[];

class CallError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
  }
}

// Same proxy shape as the renderer's client, but dispatching in-process.
function clientFor(ctx: Context): RpcClient<AppRouter> {
  const proxy = (path: string[]): unknown =>
    new Proxy(() => {}, {
      get: (_t, key) => (typeof key === 'string' ? proxy([...path, key]) : undefined),
      apply: async (_t, _this, args: unknown[]) => {
        const result = await dispatch(appRouter, path.join('.'), args[0], ctx);
        if (!result.ok) throw new CallError(result.error.message, result.error.code);
        return result.data;
      },
    });
  return proxy([]) as RpcClient<AppRouter>;
}

function newContext(): Context {
  return {
    db,
    session: { userId: null },
    platform: {
      chooseFile: async () => null,
      chooseSaveLocation: async () => null,
      openPath: async () => {},
      showNotification: (n) => shown.push(n.title),
      systemDndSupported: () => true,
      setSystemDnd: async (on) => {
        dndCalls.push(on);
        return true;
      },
    },
    isDev: true,
    filesDir: join(tmpdir(), 'unilink-test-files'), // only created if a test stores an attachment
    now: () => clock,
  };
}

async function student(name: string) {
  const ctx = newContext();
  const api = clientFor(ctx);
  const email = `${name.toLowerCase()}@mail.mcgill.ca`;
  const user = await api.auth.signUp({ name, email, password: PASSWORD });
  return { api, user, email, ctx };
}

async function comp251(api: RpcClient<AppRouter>) {
  const [found] = await api.catalogue.search({ query: 'comp251', term: 'Fall 2026', subject: null });
  return found.id;
}

const expectCode = (promise: Promise<unknown>, code: string) => expect(promise).rejects.toMatchObject({ code });

beforeAll(async () => {
  SQL = await initSqlJs();
});

beforeEach(() => {
  db = openDatabase(new SQL.Database());
  clock = new Date(2026, 9, 5, 9, 0); // Monday 5 October 2026, 9:00
  shown = [];
  dndCalls = [];
});

describe('G4 accounts', () => {
  it('requires a McGill email and a strong password', async () => {
    const api = clientFor(newContext());
    await expectCode(api.auth.signUp({ name: 'A', email: 'a@gmail.com', password: PASSWORD }), 'BAD_INPUT');
    await expectCode(api.auth.signUp({ name: 'A', email: 'a@mail.mcgill.ca', password: 'short' }), 'BAD_INPUT');
  });

  it('signs up, out, and back in', async () => {
    const { api, email } = await student('Maya');
    expect((await api.auth.me())?.email).toBe(email);
    await expectCode(api.auth.signUp({ name: 'Maya', email, password: PASSWORD }), 'CONFLICT');
    await api.auth.signOut();
    await expectCode(api.classes.mine(), 'UNAUTHORIZED');
    await expectCode(api.auth.signIn({ email, password: 'wrong-pass1' }), 'UNAUTHORIZED');
    await api.auth.signIn({ email: email.toUpperCase(), password: PASSWORD });
    expect(await api.classes.mine()).toEqual([]);
  });

  it('resets a forgotten password with a one-time code', async () => {
    const { api, email } = await student('Maya');
    await api.auth.signOut();
    const { devCode } = await api.auth.requestPasswordReset({ email });
    await expectCode(api.auth.resetPassword({ email, code: '000000x', password: 'new-pass-22' }), 'BAD_INPUT');
    await api.auth.resetPassword({ email, code: devCode!, password: 'new-pass-22' });
    await expectCode(api.auth.resetPassword({ email, code: devCode!, password: 'again-pass-33' }), 'BAD_INPUT');
    await api.auth.signIn({ email, password: 'new-pass-22' });
  });

  it('deletes the account and everything in it', async () => {
    const { api, email } = await student('Maya');
    await api.classes.join({ classId: await comp251(api) });
    await expectCode(api.profile.deleteAccount({ password: 'nope-nope1' }), 'BAD_INPUT');
    await api.profile.deleteAccount({ password: PASSWORD });
    expect(await api.auth.me()).toBeNull();
    await expectCode(api.auth.signIn({ email, password: PASSWORD }), 'UNAUTHORIZED');
  });
});

describe('S1 classes', () => {
  it('finds classes by code or name and joins each only once', async () => {
    const { api } = await student('Maya');
    expect((await api.catalogue.search({ query: 'COMP 251', term: 'Fall 2026', subject: null }))[0].title).toBe(
      'Algorithms and Data Structures',
    );
    expect((await api.catalogue.search({ query: 'discrete', term: 'Fall 2026', subject: 'MATH' }))[0].number).toBe('240');

    const classId = await comp251(api);
    await api.classes.join({ classId });
    await expectCode(api.classes.join({ classId }), 'CONFLICT');
    expect((await api.classes.mine()).map((c) => c.id)).toEqual([classId]);
    expect((await api.catalogue.search({ query: '251', term: 'Fall 2026', subject: null }))[0].joined).toBe(true);
    await api.classes.leave({ classId });
    expect(await api.classes.mine()).toEqual([]);
  });

  it('keeps classmates anonymous until they post', async () => {
    const maya = await student('Maya');
    const leo = await student('Leo');
    const classId = await comp251(maya.api);
    await maya.api.classes.join({ classId });
    await leo.api.classes.join({ classId });
    expect((await maya.api.classes.get({ classId })).memberCount).toBe(2);
    expect(await maya.api.classes.classmates({ classId })).toEqual([]);

    await leo.api.board.create({ classId, topic: 'General', title: 'Hi', body: 'Hello all', visibility: 'class', audienceEmails: [] });
    expect((await maya.api.classes.classmates({ classId })).map((c) => c.email)).toEqual([leo.email]);
  });
});

describe('S2 group chat links', () => {
  it('handles privacy, duplicates, flags and ownership', async () => {
    const maya = await student('Maya');
    const others = await Promise.all(['Leo', 'Ana', 'Raj'].map(student));
    const classId = await comp251(maya.api);
    for (const s of [maya, ...others]) await s.api.classes.join({ classId });
    const leo = others[0].api;

    await expectCode(maya.api.links.add({ classId, url: 'not a link', label: '', isPublic: false }), 'BAD_INPUT');
    const { id } = await maya.api.links.add({ classId, url: 'https://discord.gg/abc', label: 'Ours', isPublic: false });
    expect(await leo.links.list({ classId })).toEqual([]);
    await expectCode(leo.links.add({ classId, url: 'http://discord.gg/abc/', label: '', isPublic: true }), 'CONFLICT');

    await maya.api.links.update({ linkId: id, url: 'https://discord.gg/abc', label: 'Ours', isPublic: true });
    expect((await leo.links.list({ classId }))[0]).toMatchObject({ platform: 'Discord', ownerName: 'Maya', mine: false });
    await expectCode(leo.links.remove({ linkId: id }), 'FORBIDDEN');

    for (const s of others) await s.api.links.flag({ linkId: id, reason: 'Expired' });
    expect((await maya.api.links.list({ classId }))[0]).toMatchObject({ flagCount: 3, hidden: true });
    await maya.api.links.update({ linkId: id, url: 'https://discord.gg/new', label: 'Ours', isPublic: true });
    expect((await leo.links.list({ classId }))[0]).toMatchObject({ flagCount: 0, hidden: false });
  });
});

describe('S3 study sessions', () => {
  it('hosts, invites by email, and enforces capacity', async () => {
    const maya = await student('Maya');
    const leo = await student('Leo');
    const ana = await student('Ana');
    const classId = await comp251(maya.api);
    for (const s of [maya, leo, ana]) await s.api.classes.join({ classId });

    const startsAt = new Date(2026, 9, 7, 18);
    const { id: sessionId } = await maya.api.studySessions.create({
      classId,
      title: 'Midterm review',
      description: '',
      location: 'Trottier 3120',
      startsAt,
      endsAt: new Date(2026, 9, 7, 20),
      capacity: 2,
    });

    await expectCode(maya.api.studySessions.invite({ sessionId, emails: ['nobody@mail.mcgill.ca'] }), 'NOT_FOUND');
    expect(await maya.api.studySessions.invite({ sessionId, emails: [leo.email, ana.email] })).toEqual({
      invited: 2,
      alreadyIn: 0,
    });
    expect((await leo.api.studySessions.mine())[0]).toMatchObject({ myStatus: 'invited', title: 'Midterm review' });

    await leo.api.studySessions.join({ sessionId });
    await expectCode(ana.api.studySessions.join({ sessionId }), 'CONFLICT'); // full
    await leo.api.studySessions.leave({ sessionId });
    await ana.api.studySessions.join({ sessionId });
    expect((await maya.api.studySessions.list({ classId }))[0].going.map((g) => g.name)).toEqual(['Ana', 'Maya']);
    await expectCode(maya.api.studySessions.leave({ sessionId }), 'BAD_INPUT');
  });
});

describe('S4 discussion board', () => {
  it('shows selected-audience posts only to that audience', async () => {
    const maya = await student('Maya');
    const leo = await student('Leo');
    const ana = await student('Ana');
    const classId = await comp251(maya.api);
    for (const s of [maya, leo, ana]) await s.api.classes.join({ classId });

    const { id: postId } = await maya.api.board.create({
      classId,
      topic: 'Assignment 2',
      title: 'Q3 hint?',
      body: 'Stuck on 3b',
      visibility: 'selected',
      audienceEmails: [leo.email],
    });
    const feed = { classIds: [classId], topics: [], since: null, search: '' };
    expect((await leo.api.board.feed(feed)).map((p) => p.id)).toEqual([postId]);
    expect(await ana.api.board.feed(feed)).toEqual([]);
    await expectCode(ana.api.board.get({ postId }), 'NOT_FOUND');

    await leo.api.board.reply({ postId, parentId: null, body: 'Think about the recurrence' });
    const post = await maya.api.board.get({ postId });
    expect(post.replies.map((r) => r.authorName)).toEqual(['Leo']);
    expect(post.audience.map((a) => a.email)).toEqual([leo.email]);
    expect(await leo.api.board.topics({ classId })).toContain('Assignment 2');
  });

  it('runs the home feed with filters, goat reactions and threaded replies', async () => {
    const maya = await student('Maya');
    const leo = await student('Leo');
    const c251 = await comp251(maya.api);
    const [m240] = await maya.api.catalogue.search({ query: 'MATH 240', term: 'Fall 2026', subject: null });
    for (const s of [maya, leo]) for (const classId of [c251, m240.id]) await s.api.classes.join({ classId });

    const post = (classId: number, topic: string, title: string) =>
      leo.api.board.create({ classId, topic, title, body: '…', visibility: 'class', audienceEmails: [] });
    const { id: hw } = await post(c251, 'Assignment', 'A2 is long');
    await post(m240.id, 'Just yapping', 'Prof uses AI slides?');

    const all = { classIds: null, topics: [], since: null, search: '' };
    expect((await maya.api.board.feed(all)).map((p) => `${p.classLabel} ${p.topic}`)).toEqual([
      'MATH 240 Just yapping',
      'COMP 251 Assignment',
    ]);
    expect((await maya.api.board.feed({ ...all, topics: ['Assignment'] })).map((p) => p.id)).toEqual([hw]);
    expect((await maya.api.board.feed({ ...all, classIds: [m240.id] })).length).toBe(1);
    expect((await maya.api.board.feed({ ...all, search: 'long' })).map((p) => p.id)).toEqual([hw]);

    // One goat per student, toggled.
    await maya.api.board.react({ postId: hw });
    await leo.api.board.react({ postId: hw });
    await maya.api.board.react({ postId: hw });
    await maya.api.board.react({ postId: hw });
    expect((await maya.api.board.feed(all)).find((p) => p.id === hw)).toMatchObject({ goats: 2, goated: true });

    // Replies to replies stay one level deep.
    await maya.api.board.reply({ postId: hw, parentId: null, body: 'Agreed' });
    const first = (await leo.api.board.get({ postId: hw })).replies[0];
    await leo.api.board.reply({ postId: hw, parentId: first.id, body: 'Start early' });
    const nested = (await leo.api.board.get({ postId: hw })).replies[1];
    await maya.api.board.reply({ postId: hw, parentId: nested.id, body: 'Will do' });
    await maya.api.board.reactReply({ replyId: first.id });
    const thread = (await maya.api.board.get({ postId: hw })).replies;
    expect(thread.map((r) => [r.body, r.parentId])).toEqual([
      ['Agreed', null],
      ['Start early', first.id],
      ['Will do', first.id],
    ]);
    expect(thread[0]).toMatchObject({ goats: 1, goated: true });
    expect((await maya.api.notifications.list()).items.map((n) => n.title)).toContain(
      'Leo replied to your reply on "A2 is long"',
    );

    // Deleting the top reply removes its thread.
    await maya.api.board.removeReply({ replyId: first.id });
    expect((await leo.api.board.get({ postId: hw })).replies).toEqual([]);
  });
});

describe('A3–A5 calendar and grades', () => {
  it('puts class times, graded work and deadlines on one calendar', async () => {
    const { api } = await student('Maya');
    const classId = await comp251(api);
    await api.classes.join({ classId });
    await api.courses.saveMeetings({
      classId,
      meetings: [
        { weekday: 1, startTime: '10:05', endTime: '11:25', location: 'Leacock 132' },
        { weekday: 3, startTime: '10:05', endTime: '11:25', location: 'Leacock 132' },
      ],
    });
    await api.courses.addAssessment({ classId, name: 'Midterm', weight: 30, score: null, dueAt: new Date(2026, 9, 8, 18) });
    await api.calendar.addDeadline({ classId, kind: 'quiz', title: 'Quiz 2', dueAt: new Date(2026, 9, 9, 23, 59), notes: '' });

    const week = await api.calendar.range({ from: '2026-10-05', to: '2026-10-11' });
    expect(week.map((e) => `${e.kind}:${e.title}`)).toEqual([
      'class:COMP 251',
      'class:COMP 251',
      'deadline:Midterm (30%)',
      'deadline:Quiz 2',
    ]);
    expect((await api.calendar.upcoming({ days: 7 })).length).toBe(2);
  });
});

describe('ST2 assignment planner', () => {
  it('plans tasks before the deadline and re-plans missed ones', async () => {
    const { api } = await student('Maya');
    await api.planner.create({
      title: 'Problem set 3',
      classId: null,
      dueAt: new Date(2026, 9, 8, 23, 59), // Thursday
      notes: '',
      bufferDays: 1,
      tasks: ['Problem 1', 'Problem 2', 'Problem 3'].map((title) => ({ title, minutes: 60 })),
      attachmentPath: null,
    });
    let [plan] = await api.planner.list();
    expect(plan.tasks.map((t) => t.scheduledFor)).toEqual(['2026-10-05', '2026-10-06', '2026-10-07']);

    // Two days pass and nothing gets done: the leftovers move to the days that remain.
    await api.planner.setDone({ taskId: plan.tasks[0].id, done: true });
    clock = new Date(2026, 9, 7, 9, 0);
    [plan] = await api.planner.list();
    expect(plan.tasks.filter((t) => !t.doneAt).map((t) => t.scheduledFor)).toEqual(['2026-10-07', '2026-10-07']);
    expect(plan.tight).toBe(false);

    // A task moved by hand stays there through re-plans.
    const last = plan.tasks[2];
    await api.planner.moveTask({ taskId: last.id, day: '2026-10-08' });
    await api.planner.update({ ...plan, assignmentId: plan.id, dueAt: new Date(2026, 9, 9, 23, 59) });
    [plan] = await api.planner.list();
    expect(plan.tasks.find((t) => t.id === last.id)).toMatchObject({ scheduledFor: '2026-10-08', pinned: true });
  });

  it('moves work off a day that a study session has filled up', async () => {
    const { api } = await student('Maya');
    const classId = await comp251(api);
    await api.classes.join({ classId });
    await api.planner.create({
      title: 'Problem set 3',
      classId,
      dueAt: new Date(2026, 9, 8, 23, 59),
      notes: '',
      bufferDays: 1,
      tasks: ['Problem 1', 'Problem 2', 'Problem 3'].map((title) => ({ title, minutes: 60 })),
      attachmentPath: null,
    });

    // A 2-hour session on Tuesday uses the whole 120-minute study budget.
    await api.studySessions.create({
      classId,
      title: 'Review',
      description: '',
      location: 'Library',
      startsAt: new Date(2026, 9, 6, 18),
      endsAt: new Date(2026, 9, 6, 20),
      capacity: null,
    });
    const [plan] = await api.planner.list();
    expect(plan.tasks.map((t) => t.scheduledFor)).toEqual(['2026-10-05', '2026-10-07', '2026-10-07']);
    expect(plan.overloaded).toBe(false);
  });
});

describe('A1–A2 course record and degree plan', () => {
  it('imports current classes and checks the record against a program', async () => {
    const { api } = await student('Maya');
    await api.classes.join({ classId: await comp251(api) });
    expect(await api.record.importClasses()).toEqual({ added: 1 });
    expect(await api.record.importClasses()).toEqual({ added: 0 });

    await api.record.add({ code: 'comp250', title: '', credits: 3, term: 'Winter 2026', status: 'completed', grade: 'A' });
    await expectCode(
      api.record.add({ code: 'COMP 250', title: '', credits: 3, term: 'Winter 2026', status: 'planned', grade: null }),
      'CONFLICT',
    );
    expect((await api.record.list()).map((r) => `${r.code} ${r.status}`).sort()).toEqual([
      'COMP 250 completed',
      'COMP 251 in-progress',
    ]);

    expect(await api.degree.evaluate()).toBeNull();
    await api.degree.select({ programId: 'sample-cs-major' });
    const { evaluation } = (await api.degree.evaluate())!;
    const core = evaluation.groups[0].courses;
    expect(core.find((c) => c.code === 'COMP 251')?.state).toBe('in-progress');
    expect(core.find((c) => c.code === 'COMP 330')?.state).toBe('missing');
    expect(evaluation.missingCredits).toBe(84);
  });
});

describe('ST3 to-do list', () => {
  it("shows today's planned work and own tasks first, with progress", async () => {
    const { api } = await student('Maya');
    await api.planner.create({
      title: 'Problem set 3',
      classId: null,
      dueAt: new Date(2026, 9, 8, 23, 59),
      notes: '',
      bufferDays: 1,
      tasks: ['Problem 1', 'Problem 2', 'Problem 3'].map((title) => ({ title, minutes: 60 })),
      attachmentPath: null,
    });
    await api.todos.add({ title: 'Email the TA', dueDate: null, classId: null });
    await api.todos.add({ title: 'Buy a calculator', dueDate: '2026-10-09', classId: null });

    let { today, later } = await api.todos.today();
    expect(today.map((t) => t.title)).toEqual(['Problem 1', 'Email the TA']);
    expect(today[0].progress).toEqual({ done: 0, total: 3 });
    expect(later.map((t) => t.title)).toEqual(['Buy a calculator']);

    await api.planner.setDone({ taskId: today[0].id, done: true });
    await api.todos.setDone({ id: today[1].id, done: true });
    ({ today } = await api.todos.today());
    expect(today.map((t) => [t.title, t.done])).toEqual([
      ['Problem 1', true],
      ['Email the TA', true],
    ]);
    expect(today[0].progress).toEqual({ done: 1, total: 3 });
  });

  it('checks off deadlines', async () => {
    const { api } = await student('Maya');
    await api.calendar.addDeadline({ classId: null, kind: 'quiz', title: 'Quiz 2', dueAt: new Date(2026, 9, 7, 12), notes: '' });
    const [deadline] = await api.calendar.upcoming({ days: 7 });
    await api.calendar.setDeadlineDone({ id: deadline.deadlineId!, done: true });
    expect(await api.calendar.upcoming({ days: 7 })).toEqual([]);
  });
});

describe('G3 notifications', () => {
  it('notifies about invitations and replies, emailing by preference', async () => {
    const maya = await student('Maya');
    const leo = await student('Leo');
    const classId = await comp251(maya.api);
    for (const s of [maya, leo]) await s.api.classes.join({ classId });

    const { id: sessionId } = await maya.api.studySessions.create({
      classId,
      title: 'Midterm review',
      description: '',
      location: 'Trottier 3120',
      startsAt: new Date(2026, 9, 7, 18),
      endsAt: new Date(2026, 9, 7, 20),
      capacity: null,
    });
    await maya.api.studySessions.invite({ sessionId, emails: [leo.email] });
    const { id: postId } = await maya.api.board.create({
      classId,
      topic: 'Assignment 2',
      title: 'Q3 hint?',
      body: 'Stuck on 3b',
      visibility: 'class',
      audienceEmails: [],
    });
    await leo.api.board.reply({ postId, body: 'Think about the recurrence' });
    await maya.api.board.reply({ postId, body: 'Thanks!' }); // replying to yourself: no notification

    expect((await leo.api.notifications.list()).items.map((n) => n.title)).toEqual([
      'Maya invited you to "Midterm review"',
    ]);
    const mine = await maya.api.notifications.list();
    expect(mine.items.map((n) => n.title)).toEqual(['Leo replied to "Q3 hint?"']);
    expect(mine.unread).toBe(1);

    // Invitations are emailed by default; replies aren't until switched on.
    expect((await leo.api.notifications.outbox()).map((e) => e.subject)).toEqual([
      'UniLink: Maya invited you to "Midterm review"',
    ]);
    expect(await maya.api.notifications.outbox()).toEqual([]);
    await maya.api.notifications.setPref({ type: 'reply', desktop: false, email: true });
    await leo.api.board.reply({ postId, body: 'Or draw the recursion tree' });
    expect((await maya.api.notifications.outbox()).length).toBe(1);

    await maya.api.notifications.markAllRead();
    expect((await maya.api.notifications.list()).unread).toBe(0);
  });

  it('reminds about a deadline once', async () => {
    const { api, ctx, user } = await student('Maya');
    await api.calendar.addDeadline({ classId: null, kind: 'assignment', title: 'Essay', dueAt: new Date(2026, 9, 6, 8), notes: '' });
    const authed = { ...ctx, userId: user.id };
    sweepReminders(authed);
    sweepReminders(authed);
    expect((await api.notifications.list()).items.map((n) => n.title)).toEqual(['Essay is due tomorrow at 08:00']);
  });
});

describe('ST1 study mode', () => {
  it('turns on for class, holds notifications, and uses Do Not Disturb', async () => {
    const maya = await student('Maya');
    const leo = await student('Leo');
    const classId = await comp251(maya.api);
    for (const s of [maya, leo]) await s.api.classes.join({ classId });
    await maya.api.courses.saveMeetings({
      classId,
      meetings: [{ weekday: 1, startTime: '10:05', endTime: '11:25', location: 'Leacock 132' }],
    });
    await maya.api.studyMode.updateSettings({ autoForClasses: true, autoForSessions: true, silenceNotifications: true, systemDnd: true });

    const state = initialTickState();
    await backgroundTick(maya.ctx, state);
    expect(state.studyActive).toBe(false);

    clock = new Date(2026, 9, 5, 10, 30); // in class
    await backgroundTick(maya.ctx, state);
    expect(state.studyActive).toBe(true);
    expect(dndCalls).toEqual([true]);
    expect(shown).toEqual(['Study mode on: COMP 251']);

    // An invitation arriving mid-class waits.
    const { id: sessionId } = await leo.api.studySessions.create({
      classId,
      title: 'Review',
      description: '',
      location: 'Library',
      startsAt: new Date(2026, 9, 7, 18),
      endsAt: new Date(2026, 9, 7, 20),
      capacity: null,
    });
    await leo.api.studySessions.invite({ sessionId, emails: [maya.email] });
    await backgroundTick(maya.ctx, state);
    expect(shown).toHaveLength(1);

    // Switching it off by hand releases what was held and stays off for this class.
    await maya.api.studyMode.stop();
    await backgroundTick(maya.ctx, state);
    expect(state.studyActive).toBe(false);
    expect(dndCalls).toEqual([true, false]);
    expect(shown.slice(1)).toEqual(['Leo invited you to "Review"', 'Study mode off']);
    expect((await maya.api.studyMode.status()).pausedWindow?.label).toBe('COMP 251');

    // Per-class opt-out: next Monday's class leaves study mode off.
    await maya.api.studyMode.setClassAuto({ classId, enabled: false });
    clock = new Date(2026, 9, 12, 10, 30);
    await backgroundTick(maya.ctx, state);
    expect(state.studyActive).toBe(false);
  });

  it('runs focus sessions started by hand', async () => {
    const { api } = await student('Maya');
    await api.studyMode.start({ minutes: 50 });
    expect(await api.studyMode.status()).toMatchObject({ active: true, reason: 'manual', until: new Date(2026, 9, 5, 9, 50) });
    await api.studyMode.stop();
    expect((await api.studyMode.status()).active).toBe(false);
  });
});
