import { readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import initSqlJs, { type SqlJsStatic } from 'sql.js';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase, type DB } from '../src/main/db/client';
import { type Context, dispatch, type RpcClient } from '../src/main/rpc/core';
import { type AppRouter, appRouter } from '../src/main/rpc/router';
import { sweepReminders } from '../src/main/services/notifications';
import { backgroundTick, initialTickState } from '../src/main/services/studyMode';

const PASSWORD = 'correct horse battery';

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
      readText: async (path) => readFile(path, 'utf8'),
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

async function student(name: string, { pronouns = '', faculty = 'Science' as const } = {}) {
  const ctx = newContext();
  const api = clientFor(ctx);
  const email = `${name.toLowerCase()}@mail.mcgill.ca`;
  const { user, recoveryCode } = await api.auth.signUp({ name, email, password: PASSWORD, pronouns, faculty, gradYear: 2028 });
  return { api, user, email, ctx, recoveryCode };
}

// COMP 251 has two sections in Fall 2026; tests use 001 unless they say otherwise.
async function comp251(api: RpcClient<AppRouter>, section = '001') {
  const found = await api.catalogue.search({ query: 'comp251', term: 'Fall 2026', level: null });
  return found.find((c) => c.section === section)!.id;
}

// Several students in the same section.
async function classmates(...names: string[]) {
  const people = [];
  for (const name of names) people.push(await student(name));
  const classId = await comp251(people[0].api);
  for (const p of people) await p.api.classes.join({ classId });
  return { classId, people };
}

const session = (fields: Partial<Parameters<RpcClient<AppRouter>['studySessions']['create']>[0]> = {}) => ({
  title: 'Midterm review',
  description: '',
  format: 'in-person' as const,
  location: 'Trottier 3120',
  meetingUrl: '',
  startsAt: new Date(2026, 9, 7, 18),
  endsAt: new Date(2026, 9, 7, 20),
  capacity: 6,
  visibility: 'class' as const,
  ...fields,
});

const problems = (minutes: number) => ['Problem 1', 'Problem 2', 'Problem 3'].map((title) => ({ title, minutes }));

const titles = async (s: { api: RpcClient<AppRouter> }) => (await s.api.notifications.list()).items.map((n) => n.title);

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
  it('requires a McGill email and a passphrase', async () => {
    const api = clientFor(newContext());
    const fields = { name: 'A', pronouns: '', faculty: 'Arts' as const, gradYear: null };
    await expectCode(api.auth.signUp({ ...fields, email: 'a@gmail.com', password: PASSWORD }), 'BAD_INPUT');
    await expectCode(api.auth.signUp({ ...fields, email: 'a@mail.mcgill.ca', password: 'short1' }), 'BAD_INPUT');
    await expectCode(api.auth.signUp({ ...fields, email: 'a@mail.mcgill.ca', password: 'password1234' }), 'BAD_INPUT');
    await expectCode(api.auth.signUp({ ...fields, email: 'maya.chen@mail.mcgill.ca', password: 'maya loves algorithms' }), 'BAD_INPUT');
    // No digits or symbols needed.
    const { user } = await api.auth.signUp({ ...fields, email: 'maya.chen@mail.mcgill.ca', password: 'purple goat on a bike' });
    expect(user).toMatchObject({ faculty: 'Arts', pronouns: '' });
    expect(user).not.toHaveProperty('recoveryCodeHash');
  });

  it('signs up, out, and back in', async () => {
    const { api, email } = await student('Maya');
    expect((await api.auth.me())?.email).toBe(email);
    await expectCode(api.auth.signUp({ name: 'Maya', email, password: PASSWORD, pronouns: '', faculty: '', gradYear: null }), 'CONFLICT');
    await api.auth.signOut();
    await expectCode(api.classes.mine(), 'UNAUTHORIZED');
    await expectCode(api.auth.signIn({ email, password: 'wrong pass phrase' }), 'UNAUTHORIZED');
    await api.auth.signIn({ email: email.toUpperCase(), password: PASSWORD });
    expect(await api.classes.mine()).toEqual([]);
  });

  it('resets a forgotten password with the recovery code from sign-up', async () => {
    const { api, email, recoveryCode } = await student('Maya');
    expect(recoveryCode).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    await api.auth.signOut();
    await expectCode(api.auth.resetPassword({ email, recoveryCode: 'AAAA-BBBB-CCCC', password: 'brand new phrase' }), 'BAD_INPUT');
    // Case and dashes don't matter, and a fresh code replaces the used one.
    const { recoveryCode: next } = await api.auth.resetPassword({
      email,
      recoveryCode: recoveryCode.toLowerCase().replace(/-/g, ''),
      password: 'brand new phrase',
    });
    expect(next).not.toBe(recoveryCode);
    await expectCode(api.auth.resetPassword({ email, recoveryCode, password: 'another new phrase' }), 'BAD_INPUT');
    await api.auth.signIn({ email, password: 'brand new phrase' });
    // No reset emails; only alerts about the wrong and used-up codes tried along the way.
    expect((await api.notifications.outbox()).map((e) => e.subject)).toEqual(Array(2).fill('UniLink: 1 failed sign-in attempt since you last signed in'));
  });

  it('pauses sign-in after five wrong passwords and says so at the next sign-in', async () => {
    const { api, email } = await student('Maya');
    await api.auth.signOut();
    const wrong = () => api.auth.signIn({ email, password: 'wrong pass phrase' });
    for (let i = 0; i < 2; i++) await expect(wrong()).rejects.toThrow('Email or password is incorrect.');
    await expect(wrong()).rejects.toThrow('2 more tries before sign-in pauses for 15 minutes.');
    await expect(wrong()).rejects.toThrow('1 more try before');
    await expect(wrong()).rejects.toThrow('Too many failed attempts. Try again in 15 minutes.');
    // Paused: even the right password (or a recovery code) waits.
    await expect(api.auth.signIn({ email, password: PASSWORD })).rejects.toThrow('Try again in 15 minutes.');
    clock = new Date(clock.getTime() + 14 * 60_000 + 30_000);
    await expect(api.auth.signIn({ email, password: PASSWORD })).rejects.toThrow('Try again in 1 minute.');

    clock = new Date(clock.getTime() + 60_000);
    await api.auth.signIn({ email, password: PASSWORD });
    expect(await titles({ api })).toEqual(['5 failed sign-in attempts since you last signed in']);
    // The count starts over.
    await api.auth.signOut();
    await expect(wrong()).rejects.toThrow(/^Email or password is incorrect\.$/);
  });

  it('downloads a copy of your data, without passwords', async () => {
    const {
      classId,
      people: [maya],
    } = await classmates('Maya');
    await maya.api.board.create({ classId, kind: 'question', topic: 'Exams', title: 'Final format?', body: 'Anyone know?', visibility: 'class', audienceEmails: [] });
    await maya.api.todos.add({ title: 'Print notes', dueDate: null, classId: null });
    const file = join(tmpdir(), `unilink-data-${maya.user.id}.json`);
    maya.ctx.platform.chooseSaveLocation = async () => file;
    await maya.api.profile.exportData();
    const text = await readFile(file, 'utf8');
    const data = JSON.parse(text);
    expect(data.profile.email).toBe(maya.email);
    expect(data.classes).toMatchObject([{ class: 'COMP 251-001' }]);
    expect(data.posts).toMatchObject([{ class: 'COMP 251-001', title: 'Final format?' }]);
    expect(data.todos).toMatchObject([{ title: 'Print notes' }]);
    expect(text).not.toContain('scrypt');
  });

  it('deletes the account, optionally leaving answers up without a name', async () => {
    const { classId, people } = await classmates('Maya', 'Leo', 'Ana');
    const [maya, leo, ana] = people;
    const { id: postId } = await leo.api.board.create({ classId, kind: 'question', topic: 'Assignments', title: 'Q3?', body: '?', visibility: 'class', audienceEmails: [] });
    await maya.api.board.reply({ postId, body: 'Use a heap' });
    await ana.api.board.reply({ postId, body: 'Or sort first' });
    const [mayaReply, anaReply] = (await leo.api.board.get({ postId })).replies;
    await leo.api.board.accept({ postId, replyId: mayaReply.id });
    await maya.api.calendar.addDeadline({ classId, kind: 'quiz', title: 'Quiz 2', dueAt: new Date(2026, 9, 9, 23, 59), notes: '' });

    await expectCode(maya.api.profile.deleteAccount({ password: 'nope nope nope', keepPosts: true }), 'BAD_INPUT');
    await maya.api.profile.deleteAccount({ password: PASSWORD, keepPosts: true });
    expect(await maya.api.auth.me()).toBeNull();
    await expectCode(maya.api.auth.signIn({ email: maya.email, password: PASSWORD }), 'UNAUTHORIZED');

    const thread = await leo.api.board.get({ postId });
    expect(thread.replies[0]).toMatchObject({ body: 'Use a heap', accepted: true, formerStudent: true, authorEmail: '' });
    const [quiz] = await leo.api.calendar.deadlines();
    expect(quiz).toMatchObject({ title: 'Quiz 2', addedBy: '' });
    expect((await leo.api.classes.get({ classId })).memberCount).toBe(2);

    // Without keeping posts, replies go and the question is open again.
    await leo.api.board.accept({ postId, replyId: anaReply.id });
    await ana.api.profile.deleteAccount({ password: PASSWORD, keepPosts: false });
    const after = await leo.api.board.get({ postId });
    expect(after.replies.map((r) => r.body)).toEqual(['Use a heap']);
    expect(after.acceptedReplyId).toBeNull();
  });
});

describe('S1 classes', () => {
  it('searches sections by code with wildcards, title words and level', async () => {
    const { api } = await student('Maya');
    const codes = async (query: string, level: number | null = null) =>
      (await api.catalogue.search({ query, term: 'Fall 2026', level })).map((c) => c.code);
    expect(await codes('comp251')).toEqual(['COMP 251-001', 'COMP 251-002']);
    expect(await codes('COMP 3XX')).toEqual(['COMP 302-001', 'COMP 303-001', 'COMP 307-001', 'COMP 330-001', 'COMP 360-001']);
    expect(await codes('algorithm')).toEqual(['COMP 251-001', 'COMP 251-002', 'COMP 360-001']);
    expect(await codes('', 500)).toEqual(['COMP 551-001']);
    expect((await codes('MATH')).every((c) => c.startsWith('MATH '))).toBe(true);
  });

  it('joins one section of a course at a time', async () => {
    const { api } = await student('Maya');
    const first = await comp251(api, '001');
    const second = await comp251(api, '002');
    await api.classes.join({ classId: first });
    await expectCode(api.classes.join({ classId: first }), 'CONFLICT');
    await expectCode(api.classes.join({ classId: second }), 'CONFLICT');
    const found = await api.catalogue.search({ query: 'COMP 251', term: 'Fall 2026', level: null });
    expect(found.map((c) => [c.section, c.joined, c.otherSectionId])).toEqual([
      ['001', true, null],
      ['002', false, first],
    ]);

    await api.classes.switchSection({ classId: second });
    expect((await api.classes.mine()).map((c) => c.code)).toEqual(['COMP 251-002']);
    await api.classes.leave({ classId: second });
    expect(await api.classes.mine()).toEqual([]);
  });

  it('shows the class times of each section and which of your classes they clash with', async () => {
    const { api } = await student('Maya');
    const leo = await student('Leo');
    const [comp001, comp002] = [await comp251(api, '001'), await comp251(api, '002')];
    const [math] = await api.catalogue.search({ query: 'MATH 240', term: 'Fall 2026', level: null });
    const lecture = (weekday: number, startTime: string, endTime: string) => ({ weekday, startTime, endTime, location: '' });
    await api.classes.join({ classId: math.id });
    await api.courses.saveMeetings({ classId: math.id, meetings: [lecture(1, '10:05', '11:25'), lecture(3, '10:05', '11:25')] });
    // Leo fills in both COMP 251 sections' times: 001 overlaps Maya's MATH 240, 002 doesn't.
    for (const [classId, start, end] of [[comp001, '11:05', '12:25'], [comp002, '14:35', '15:55']] as const) {
      await leo.api.classes.join({ classId });
      await leo.api.courses.saveMeetings({ classId, meetings: [lecture(2, start, end), lecture(3, start, end)] });
      await leo.api.classes.leave({ classId });
    }
    const found = await api.catalogue.search({ query: 'COMP 251', term: 'Fall 2026', level: null });
    expect(found.map((c) => [c.section, c.times.length, c.clashesWith])).toEqual([
      ['001', 2, ['MATH 240-001']],
      ['002', 2, []],
    ]);
    expect((await api.classes.get({ classId: comp001 })).clashesWith).toEqual(['MATH 240-001']);
  });

  it('keeps classmates anonymous until they post or reply, not when they join a session', async () => {
    const maya = await student('Maya', { pronouns: 'she/her' });
    const leo = await student('Leo');
    const sam = await student('Sam');
    const classId = await comp251(maya.api);
    for (const s of [maya, leo]) await s.api.classes.join({ classId });
    await sam.api.classes.join({ classId: await comp251(sam.api, '002') });

    const { id } = await leo.api.studySessions.create({ classId, ...session() });
    await maya.api.studySessions.join({ sessionId: id });
    expect(await leo.api.classes.classmates({ classId })).toEqual([]);

    await maya.api.board.create({ classId, kind: 'note', topic: 'Logistics', title: 'Hi', body: 'Hello!', visibility: 'class', audienceEmails: [] });
    expect(await leo.api.classes.classmates({ classId })).toEqual([
      { id: maya.user.id, name: 'Maya', email: maya.email, pronouns: 'she/her', faculty: 'Science' },
    ]);
    // Section 002 has its own board.
    await expectCode(sam.api.classes.classmates({ classId }), 'FORBIDDEN');
    expect(await sam.api.board.feed({ classIds: null, topics: [], since: null, search: '' })).toEqual([]);
  });
});

describe('S2 group chat links', () => {
  it('shares links right away and blocks the same chat anywhere in the course', async () => {
    const { classId, people } = await classmates('Maya', 'Leo');
    const [maya, leo] = people;
    const sam = await student('Sam');
    const otherSection = await comp251(sam.api, '002');
    await sam.api.classes.join({ classId: otherSection });

    const { id } = await maya.api.links.add({ classId, url: 'https://discord.gg/abc', label: 'Study server', purpose: 'study-group' });
    expect((await leo.api.links.list({ classId })).map((l) => [l.platform, l.purpose, l.ownerName])).toEqual([['Discord', 'study-group', 'Maya']]);

    await expectCode(leo.api.links.add({ classId, url: 'https://discord.com/invite/abc?utm=x', label: '', purpose: 'course' }), 'CONFLICT');
    await expect(sam.api.links.add({ classId: otherSection, url: 'https://discord.gg/abc', label: '', purpose: 'course' })).rejects.toThrow(
      'Maya already shared this chat in COMP 251-001.',
    );
    await expectCode(leo.api.links.update({ linkId: id, url: 'https://discord.gg/new', label: '', purpose: 'course' }), 'FORBIDDEN');
    await expectCode(leo.api.links.add({ classId, url: 'not a link', label: '', purpose: 'course' }), 'BAD_INPUT');
  });

  it('hides links classmates report more than they vouch for, until the owner fixes them', async () => {
    const { classId, people } = await classmates('Maya', 'Leo', 'Ana', 'Bo');
    const [maya, leo, ana, bo] = people;
    const { id: linkId } = await maya.api.links.add({ classId, url: 'https://chat.whatsapp.com/Grp1', label: '', purpose: 'course' });
    const state = async () => {
      const [l] = await maya.api.links.list({ classId });
      return [l.reports, l.works, l.hidden];
    };

    await expectCode(maya.api.links.vote({ linkId, vote: 'works', reason: null }), 'FORBIDDEN');
    await expectCode(leo.api.links.vote({ linkId, vote: 'report', reason: null }), 'BAD_INPUT');
    await leo.api.links.vote({ linkId, vote: 'report', reason: 'Expired' });
    await ana.api.links.vote({ linkId, vote: 'works', reason: null });
    expect(await state()).toEqual([1, 1, false]);
    expect(await titles(maya)).toEqual([]);

    await bo.api.links.vote({ linkId, vote: 'report', reason: 'Broken' });
    expect(await state()).toEqual([2, 1, true]);
    expect(await titles(maya)).toEqual(['Your WhatsApp link in COMP 251-001 was hidden']);

    // Fixed without changing the URL: reports go, "works" stays.
    await maya.api.links.markFixed({ linkId });
    expect(await state()).toEqual([0, 1, false]);
    // A new chat starts with no votes at all.
    await ana.api.links.vote({ linkId, vote: 'works', reason: null });
    await maya.api.links.update({ linkId, url: 'https://chat.whatsapp.com/Grp2', label: '', purpose: 'section' });
    expect(await state()).toEqual([0, 0, false]);
  });
});

describe('S3 study sessions', () => {
  it('checks the format, place and size', async () => {
    const { classId, people } = await classmates('Maya');
    const [maya] = people;
    await expectCode(maya.api.studySessions.create({ classId, ...session({ location: '' }) }), 'BAD_INPUT');
    await expectCode(maya.api.studySessions.create({ classId, ...session({ format: 'online', meetingUrl: 'zoom' }) }), 'BAD_INPUT');
    await expectCode(maya.api.studySessions.create({ classId, ...session({ capacity: 50 }) }), 'BAD_INPUT');
    await expectCode(maya.api.studySessions.create({ classId, ...session({ startsAt: new Date(2026, 9, 1) }) }), 'BAD_INPUT');
    const { inviteCode } = await maya.api.studySessions.create({ classId, ...session({ format: 'online', meetingUrl: 'https://mcgill.zoom.us/j/1', location: 'ignored' }) });
    expect(inviteCode).toMatch(/^[A-Z2-9]{6}$/);
    const [s] = await maya.api.studySessions.list({ classId });
    expect(s).toMatchObject({ format: 'online', location: '', meetingUrl: 'https://mcgill.zoom.us/j/1', inviteCode });
  });

  it('fills up, keeps a waitlist, and hands over hosting', async () => {
    const { classId, people } = await classmates('Maya', 'Leo', 'Ana');
    const [maya, leo, ana] = people;
    const { id: sessionId } = await maya.api.studySessions.create({ classId, ...session({ capacity: 2 }) });

    expect(await leo.api.studySessions.join({ sessionId })).toEqual({ status: 'going' });
    expect(await ana.api.studySessions.join({ sessionId })).toEqual({ status: 'waitlisted' });
    await expectCode(ana.api.studySessions.join({ sessionId }), 'CONFLICT');

    // Only people going see who's going; the code is the host's to share.
    const [forAna] = await ana.api.studySessions.list({ classId });
    expect(forAna).toMatchObject({ goingCount: 2, waitlistCount: 1, myStatus: 'waitlisted', myWaitlistPosition: 1, going: [], inviteCode: null, hostFirstName: 'Maya' });
    const [forLeo] = await leo.api.studySessions.list({ classId });
    expect(forLeo.going.map((g) => g.name)).toEqual(['Maya', 'Leo']);
    expect(forLeo.inviteCode).toBeNull();

    // A spot opens and the waitlist moves up.
    await leo.api.studySessions.leave({ sessionId });
    expect((await ana.api.studySessions.list({ classId }))[0].myStatus).toBe('going');
    expect(await titles(ana)).toEqual(['A spot opened up: you\'re going to "Midterm review"']);

    // The host leaving passes the session on instead of cancelling it.
    await maya.api.studySessions.leave({ sessionId });
    const [after] = await ana.api.studySessions.list({ classId });
    expect(after).toMatchObject({ hostId: ana.user.id, isHost: true, cancelledAt: null, goingCount: 1 });
    expect((await titles(ana))[0]).toBe('You\'re now hosting "Midterm review"');

    // …and the last person leaving cancels it.
    await ana.api.studySessions.leave({ sessionId });
    expect((await leo.api.studySessions.list({ classId }))[0].cancelledAt).not.toBeNull();
  });

  it('adds a session to your calendar as an .ics file, with the link only for people going', async () => {
    const {
      classId,
      people: [maya, jonah],
    } = await classmates('Maya', 'Jonah');
    const { id } = await maya.api.studySessions.create({
      classId,
      ...session({ format: 'online', location: '', meetingUrl: 'https://mcgill.zoom.us/j/555' }),
    });
    await expectCode(jonah.api.studySessions.exportIcs({ sessionId: id }), 'BAD_INPUT');

    const file = join(tmpdir(), `unilink-session-${id}.ics`);
    maya.ctx.platform.chooseSaveLocation = async () => file;
    await maya.api.studySessions.exportIcs({ sessionId: id });
    const ics = await readFile(file, 'utf8');
    expect(ics).toContain('SUMMARY:Midterm review');
    expect(ics).toContain('https://mcgill.zoom.us/j/555');
  });

  it('keeps invite-only sessions to people with the code', async () => {
    const { classId, people } = await classmates('Maya', 'Leo');
    const [maya, leo] = people;
    const sam = await student('Sam');
    await sam.api.classes.join({ classId: await comp251(sam.api, '002') });

    const { id: sessionId, inviteCode } = await maya.api.studySessions.create({ classId, ...session({ visibility: 'invite' }) });
    expect(await leo.api.studySessions.list({ classId })).toEqual([]);
    expect(await leo.api.studySessions.browse({ search: '' })).toEqual([]);
    await expectCode(leo.api.studySessions.join({ sessionId }), 'NOT_FOUND');
    await expectCode(leo.api.studySessions.joinByCode({ code: 'ZZZZZZ' }), 'NOT_FOUND');
    await expectCode(sam.api.studySessions.joinByCode({ code: inviteCode }), 'FORBIDDEN');

    // The invite link's preview shows the session, without the code, the people or the meeting link.
    const preview = await sam.api.studySessions.byCode({ code: inviteCode });
    expect(preview).toMatchObject({ id: sessionId, title: 'Midterm review', inClass: false, myStatus: null, inviteCode: null, going: [], goingCount: 1 });
    expect((await leo.api.studySessions.byCode({ code: inviteCode })).inClass).toBe(true);
    await expectCode(leo.api.studySessions.byCode({ code: 'ZZZZZZ' }), 'NOT_FOUND');

    expect(await leo.api.studySessions.joinByCode({ code: ` ${inviteCode.toLowerCase()} ` })).toMatchObject({ status: 'going', classId });
    expect((await leo.api.studySessions.list({ classId })).map((s) => s.id)).toEqual([sessionId]);

    const { inviteCode: fresh } = await maya.api.studySessions.newCode({ sessionId });
    await leo.api.studySessions.leave({ sessionId });
    await expectCode(leo.api.studySessions.joinByCode({ code: inviteCode }), 'NOT_FOUND');
    await leo.api.studySessions.joinByCode({ code: fresh });
  });

  it('tells everyone when the time or place changes, and only the host edits', async () => {
    const { classId, people } = await classmates('Maya', 'Leo');
    const [maya, leo] = people;
    const { id: sessionId } = await maya.api.studySessions.create({ classId, ...session() });
    await leo.api.studySessions.join({ sessionId });
    await expectCode(leo.api.studySessions.update({ sessionId, ...session() }), 'FORBIDDEN');
    await expectCode(maya.api.studySessions.update({ sessionId, ...session({ capacity: 1 }) }), 'BAD_INPUT');

    await maya.api.studySessions.update({ sessionId, ...session({ description: 'Bring snacks' }) });
    expect(await titles(leo)).toEqual([]);
    await maya.api.studySessions.update({ sessionId, ...session({ location: 'McLennan 2nd floor' }) });
    expect(await titles(leo)).toEqual(['"Midterm review" changed']);
  });
});

describe('S4 discussion board', () => {
  it('shows selected-audience posts only to that audience', async () => {
    const { classId, people } = await classmates('Maya', 'Leo', 'Ana');
    const [maya, leo, ana] = people;
    const { id: postId } = await maya.api.board.create({
      classId,
      kind: 'question',
      topic: 'Assignments',
      title: 'Group for A2?',
      body: 'Want to pair up?',
      visibility: 'selected',
      audienceEmails: [leo.email],
    });
    expect((await leo.api.board.get({ postId })).audience.map((a) => a.name)).toEqual(['Leo']);
    await expectCode(ana.api.board.get({ postId }), 'NOT_FOUND');
    expect(await ana.api.board.feed({ classIds: null, topics: [], since: null, search: '' })).toEqual([]);
    await expectCode(
      maya.api.board.create({ classId, kind: 'question', topic: 'Assignments', title: 'x', body: 'y', visibility: 'selected', audienceEmails: ['nobody@mail.mcgill.ca'] }),
      'NOT_FOUND',
    );
  });

  it('files posts under fixed topics and resolves questions with an accepted answer', async () => {
    const { classId, people } = await classmates('Maya', 'Leo', 'Ana');
    const [maya, leo, ana] = people;
    const post = { classId, title: 'Q3 hint?', body: 'Stuck on 3b', visibility: 'class' as const, audienceEmails: [] };
    await expectCode(maya.api.board.create({ ...post, kind: 'question', topic: 'Assignment 2' }), 'BAD_INPUT');
    const { id: postId } = await maya.api.board.create({ ...post, kind: 'question', topic: 'Assignments' });

    await leo.api.board.reply({ postId, body: 'Think about the recurrence' });
    await ana.api.board.reply({ postId, body: 'Draw the recursion tree' });
    await maya.api.board.reply({ postId, body: 'Thanks both!' });
    let thread = await maya.api.board.get({ postId });
    expect(thread.replies.map((r) => r.body)).toEqual(['Think about the recurrence', 'Draw the recursion tree', 'Thanks both!']);
    const unresolved = () => maya.api.board.feed({ classIds: [classId], topics: [], since: null, search: '', unresolved: true });
    expect((await unresolved()).map((p) => p.id)).toEqual([postId]);

    const [, anaReply, ownReply] = thread.replies;
    await expectCode(leo.api.board.accept({ postId, replyId: anaReply.id }), 'FORBIDDEN');
    await expectCode(maya.api.board.accept({ postId, replyId: ownReply.id }), 'BAD_INPUT');
    await maya.api.board.accept({ postId, replyId: anaReply.id });
    thread = await leo.api.board.get({ postId });
    expect(thread.replies.map((r) => [r.body, r.accepted])).toEqual([
      ['Draw the recursion tree', true],
      ['Think about the recurrence', false],
      ['Thanks both!', false],
    ]);
    expect(await unresolved()).toEqual([]);
    // Replying followed the thread, so Ana also heard about Maya's thanks.
    expect(await titles(ana)).toEqual(['Your answer to "Q3 hint?" was accepted', 'Maya replied in "Q3 hint?"']);

    // Notes don't have answers; deleting the accepted reply reopens the question.
    const { id: noteId } = await maya.api.board.create({ ...post, kind: 'note', topic: 'Logistics' });
    await leo.api.board.reply({ postId: noteId, body: 'Nice' });
    const [noteReply] = (await maya.api.board.get({ postId: noteId })).replies;
    await expectCode(maya.api.board.accept({ postId: noteId, replyId: noteReply.id }), 'BAD_INPUT');
    await ana.api.board.removeReply({ replyId: anaReply.id });
    expect((await unresolved()).map((p) => p.id)).toEqual([postId]);
  });

  it('lets you edit your own replies', async () => {
    const {
      classId,
      people: [maya, leo],
    } = await classmates('Maya', 'Leo');
    const { id: postId } = await maya.api.board.create({ classId, kind: 'question', topic: 'Exams', title: 'Calculators allowed?', body: '?', visibility: 'class', audienceEmails: [] });
    await leo.api.board.reply({ postId, body: 'Yes, any non-programable one.' });
    const [reply] = (await maya.api.board.get({ postId })).replies;
    await expectCode(maya.api.board.editReply({ replyId: reply.id, body: 'No' }), 'FORBIDDEN');
    await leo.api.board.editReply({ replyId: reply.id, body: 'Yes, any non-programmable one.' });
    expect((await maya.api.board.get({ postId })).replies[0]).toMatchObject({ body: 'Yes, any non-programmable one.', editedAt: clock });
  });

  it('marks posts new until you open the class discussion', async () => {
    const {
      classId,
      people: [maya, leo],
    } = await classmates('Maya', 'Leo');
    const ask = (title: string) => leo.api.board.create({ classId, kind: 'question', topic: 'Exams', title, body: '?', visibility: 'class', audienceEmails: [] });
    await ask('Is the final cumulative?');
    expect((await maya.api.board.feed({ classIds: null, topics: [], since: null, search: '', unresolved: false })).map((p) => p.isNew)).toEqual([true]);
    expect(await maya.api.board.newCounts()).toEqual([{ classId, count: 1 }]);
    expect(await leo.api.board.newCounts()).toEqual([]); // not your own posts

    await maya.api.board.seen({ classId });
    expect(await maya.api.board.newCounts()).toEqual([]);
    clock = new Date(clock.getTime() + 60_000);
    await ask('Office hours moved?');
    expect(await maya.api.board.newCounts()).toEqual([{ classId, count: 1 }]);
  });

  it('keeps the replies when a post is deleted', async () => {
    const { classId, people } = await classmates('Maya', 'Leo');
    const [maya, leo] = people;
    const post = { classId, kind: 'question' as const, topic: 'Exams', body: '?', visibility: 'class' as const, audienceEmails: [] };
    const { id: answered } = await maya.api.board.create({ ...post, title: 'Cumulative final?' });
    const { id: lonely } = await maya.api.board.create({ ...post, title: 'Calculators allowed?' });
    await leo.api.board.reply({ postId: answered, body: 'Yes, everything since week 1' });

    expect(await maya.api.board.remove({ postId: answered })).toEqual({ kept: true });
    expect(await maya.api.board.remove({ postId: lonely })).toEqual({ kept: false });
    await expectCode(leo.api.board.get({ postId: lonely }), 'NOT_FOUND');
    const kept = await leo.api.board.get({ postId: answered });
    expect(kept).toMatchObject({ title: '', body: '' });
    expect(kept.deletedAt).not.toBeNull();
    expect(kept.replies.map((r) => r.body)).toEqual(['Yes, everything since week 1']);
    await expectCode(maya.api.board.update({ postId: answered, kind: 'question', topic: 'Exams', title: 'Back', body: '!' }), 'BAD_INPUT');
    // A blanked post no longer reveals its author.
    expect((await leo.api.classes.classmates({ classId })).map((c) => c.name)).toEqual([]);
  });

  it('runs the home feed across classes with filters and goat reactions', async () => {
    const maya = await student('Maya');
    const leo = await student('Leo');
    const comp = await comp251(maya.api);
    const [math] = await maya.api.catalogue.search({ query: 'MATH 240', term: 'Fall 2026', level: null });
    for (const s of [maya, leo]) await s.api.classes.join({ classId: comp });
    await maya.api.classes.join({ classId: math.id });

    const base = { body: 'Body', visibility: 'class' as const, audienceEmails: [] };
    const { id: first } = await leo.api.board.create({ ...base, classId: comp, kind: 'question', topic: 'Assignments', title: 'A2 Q1' });
    clock = new Date(2026, 9, 5, 10, 0);
    await maya.api.board.create({ ...base, classId: math.id, kind: 'note', topic: 'Exams', title: 'Midterm room' });

    const feed = (input: Partial<Parameters<typeof maya.api.board.feed>[0]> = {}) =>
      maya.api.board.feed({ classIds: null, topics: [], since: null, search: '', ...input });
    expect((await feed()).map((p) => `${p.classLabel}: ${p.title}`)).toEqual(['MATH 240-001: Midterm room', 'COMP 251-001: A2 Q1']);
    expect((await feed({ topics: ['Assignments'] })).map((p) => p.title)).toEqual(['A2 Q1']);
    expect((await feed({ search: 'room' })).map((p) => p.title)).toEqual(['Midterm room']);
    expect(await maya.api.board.topics({ classId: null })).toEqual(['Lectures', 'Assignments', 'Exams', 'Labs and tutorials', 'Logistics', 'Off-topic']);

    await maya.api.board.react({ postId: first });
    expect((await feed({ topics: ['Assignments'] }))[0]).toMatchObject({ goats: 1, goated: true, kind: 'question' });
    await maya.api.board.react({ postId: first });
    expect((await feed({ topics: ['Assignments'] }))[0].goats).toBe(0);
  });
});

describe('S4 similar posts', () => {
  it('suggests posts in the class like the one being written, if you can see them', async () => {
    const { classId, people } = await classmates('Maya', 'Leo', 'Ana');
    const [maya, leo, ana] = people;
    const post = (title: string, extra = {}) =>
      maya.api.board.create({ classId, kind: 'question', topic: 'Exams', title, body: 'Anyone know?', visibility: 'class', audienceEmails: [], ...extra });
    const { id: open } = await post('Is the midterm cumulative up to graphs?');
    await post('Midterm cheat sheet allowed?');
    await post('Is the midterm cumulative? Asking for Ana', { visibility: 'selected', audienceEmails: [ana.email] });
    const titles = async (s: typeof leo, title: string) => (await s.api.board.similar({ classId, title })).map((p) => p.title);
    expect(await titles(leo, 'cumulative midterm?')).toEqual(['Is the midterm cumulative up to graphs?']);
    expect(await titles(ana, 'cumulative midterm?')).toEqual(['Is the midterm cumulative? Asking for Ana', 'Is the midterm cumulative up to graphs?']);
    expect(await titles(leo, 'midterm')).toEqual([]);
    expect((await leo.api.board.similar({ classId, title: 'graphs on the midterm' }))[0]).toMatchObject({ id: open, acceptedReplyId: null });
  });
});

describe('S4 following threads', () => {
  it('tells everyone following a thread about new replies, until they unfollow', async () => {
    const { classId, people } = await classmates('Maya', 'Leo', 'Ana', 'Sam');
    const [maya, leo, ana, sam] = people;
    const { id: postId } = await maya.api.board.create({
      classId,
      kind: 'question',
      topic: 'Exams',
      title: 'Is the midterm cumulative?',
      body: 'Up to graphs?',
      visibility: 'class',
      audienceEmails: [],
    });
    expect((await maya.api.board.get({ postId })).following).toBe(true);

    // Leo replies (and so follows); Sam follows without replying; Ana does neither.
    await leo.api.board.reply({ postId, body: 'I think so' });
    await sam.api.board.follow({ postId, following: true });
    await ana.api.board.reply({ postId, body: 'The prof said yes in lecture' });
    expect(await titles(maya)).toEqual(['Ana replied to "Is the midterm cumulative?"', 'Leo replied to "Is the midterm cumulative?"']);
    expect(await titles(leo)).toEqual(['Ana replied in "Is the midterm cumulative?"']);
    expect(await titles(sam)).toEqual(['Ana replied in "Is the midterm cumulative?"']);

    // Unfollowing sticks, even after replying again; the feed can show only followed threads.
    const followed = (s: typeof leo) => s.api.board.feed({ classIds: [classId], topics: [], since: null, search: '', following: true });
    expect((await followed(leo)).map((p) => p.id)).toEqual([postId]);
    await leo.api.board.follow({ postId, following: false });
    await leo.api.board.reply({ postId, body: 'Thanks Ana' });
    expect((await leo.api.board.get({ postId })).following).toBe(false);
    expect(await followed(leo)).toEqual([]);
    await sam.api.board.reply({ postId, body: 'Same question for the final' });
    expect(await titles(leo)).toHaveLength(1);
    expect(await titles(ana)).toEqual(['Sam replied in "Is the midterm cumulative?"', 'Leo replied in "Is the midterm cumulative?"']);

    // Leaving the class stops them too.
    await ana.api.classes.leave({ classId });
    await maya.api.board.reply({ postId, body: 'Thanks all!' });
    expect(await titles(ana)).toHaveLength(2);
  });
});

describe('A3–A5 shared section info', () => {
  it("puts the term's key dates and your final exams on the calendar", async () => {
    const { api } = await student('Maya');
    await api.classes.join({ classId: await comp251(api) });

    // Withdrawal is a deadline at 23:59; the reading break covers each of its days.
    const october = await api.calendar.range({ from: '2026-10-01', to: '2026-10-31' });
    expect(october.filter((e) => e.detail === 'key').map((e) => [e.title, e.start])).toEqual([
      ['Last day to withdraw (W, no refund)', new Date(2026, 9, 27, 23, 59)],
    ]);
    expect(october.filter((e) => e.kind === 'key').map((e) => e.start.getDate())).toEqual([9, 10, 11, 12, 13, 14]);

    const december = await api.calendar.range({ from: '2026-12-01', to: '2026-12-31' });
    expect(december.filter((e) => e.detail === 'final')).toMatchObject([
      { title: 'COMP 251 final exam', classLabel: 'COMP 251-001', location: 'Field House', start: new Date(2026, 11, 14, 14, 0), end: new Date(2026, 11, 14, 17, 0) },
    ]);
  });

  it('shares class times and course details with the section, but not notes', async () => {
    const { classId, people } = await classmates('Maya', 'Leo');
    const [maya, leo] = people;
    const sam = await student('Sam');
    await sam.api.classes.join({ classId: await comp251(sam.api, '002') });

    await maya.api.courses.saveMeetings({
      classId,
      meetings: [
        { weekday: 1, startTime: '10:05', endTime: '11:25', location: 'Leacock 132' },
        { weekday: 3, startTime: '10:05', endTime: '11:25', location: 'Leacock 132' },
      ],
    });
    await maya.api.courses.saveDetails({ classId, professor: 'Prof. Alberini', professorEmail: '', officeHours: 'Wed 13:00', location: 'Leacock 132' });
    await maya.api.courses.saveNotes({ classId, notes: 'Ask about the bonus' });

    const week = { from: '2026-10-05', to: '2026-10-11' };
    // (The term's key dates are on everyone's calendar; see the A3 key dates test.)
    const own = <T extends { kind: string; detail: string }>(events: T[]) => events.filter((e) => e.kind !== 'key' && e.detail !== 'key');
    expect(own(await leo.api.calendar.range(week)).map((e) => `${e.kind}:${e.title}`)).toEqual(['class:COMP 251-001', 'class:COMP 251-001']);
    expect(own(await sam.api.calendar.range(week))).toEqual([]);
    // No class on the reading break (Oct 9–14) or Labour Day.
    const classDays = async (from: string, to: string) =>
      (await leo.api.calendar.range({ from, to })).filter((e) => e.kind === 'class').map((e) => e.start.getDate());
    expect(await classDays('2026-10-12', '2026-10-18')).toEqual([]);
    expect(await classDays('2026-09-07', '2026-09-13')).toEqual([9]);
    const info = await leo.api.courses.info({ classId });
    expect(info).toMatchObject({ professor: 'Prof. Alberini', notes: '', detailsEditedBy: { name: 'Maya', former: false }, meetingsEditedBy: { name: 'Maya', former: false } });

    // Anyone in the section can fix them.
    await leo.api.courses.saveMeetings({ classId, meetings: [{ weekday: 2, startTime: '10:05', endTime: '11:25', location: 'Leacock 132' }] });
    expect((await maya.api.courses.info({ classId })).meetingsEditedBy?.name).toBe('Leo');
  });

  it('shares the grading scheme while keeping marks private', async () => {
    const { classId, people } = await classmates('Maya', 'Leo');
    const [maya, leo] = people;
    await maya.api.courses.addAssessment({ classId, name: 'Midterm', weight: 30, dueAt: new Date(2026, 9, 8, 18) });
    await expectCode(leo.api.courses.addAssessment({ classId, name: 'Final', weight: 80, dueAt: null }), 'BAD_INPUT');
    const [midterm] = await leo.api.courses.assessments({ classId });
    expect(midterm).toMatchObject({ name: 'Midterm', weight: 30, score: null, addedBy: { name: 'Maya', former: false } });

    await leo.api.courses.setScore({ id: midterm.id, score: 80 });
    expect((await maya.api.courses.assessments({ classId }))[0].score).toBeNull();
    expect((await leo.api.courses.assessments({ classId }))[0].score).toBe(80);

    // Can't be removed once a classmate has a mark on it, but anyone can fix it.
    await expectCode(maya.api.courses.removeAssessment({ id: midterm.id }), 'CONFLICT');
    await maya.api.courses.updateAssessment({ id: midterm.id, name: 'Midterm exam', weight: 25, dueAt: null });
    expect((await leo.api.courses.assessments({ classId }))[0]).toMatchObject({ name: 'Midterm exam', weight: 25, score: 80 });
    await leo.api.courses.removeAssessment({ id: midterm.id });
    expect(await maya.api.courses.assessments({ classId })).toEqual([]);
  });

  it('adds a second grading scheme, whichever is higher, for the whole section', async () => {
    const { classId, people } = await classmates('Maya', 'Leo');
    const [maya, leo] = people;
    await maya.api.courses.addAssessment({ classId, name: 'Midterm', weight: 25, dueAt: null });
    await maya.api.courses.addAssessment({ classId, name: 'Final', weight: 70, dueAt: null });
    const weights = async () => (await leo.api.courses.assessments({ classId })).map((a) => [a.name, a.weight, a.altWeight]);

    // Turning it on copies the main weights; then the final replaces the midterm in scheme 2.
    await leo.api.courses.setSecondScheme({ classId, on: true });
    const [midterm, final] = await leo.api.courses.assessments({ classId });
    await leo.api.courses.updateAssessment({ id: midterm.id, name: 'Midterm', weight: 25, altWeight: 0, dueAt: null });
    await expectCode(leo.api.courses.updateAssessment({ id: final.id, name: 'Final', weight: 70, altWeight: 110, dueAt: null }), 'BAD_INPUT');
    await leo.api.courses.updateAssessment({ id: final.id, name: 'Final', weight: 70, altWeight: 100, dueAt: null });
    expect(await weights()).toEqual([['Midterm', 25, 0], ['Final', 70, 100]]);
    // A 5% quiz fits scheme 1 but not a full scheme 2, unless it doesn't count there.
    await expectCode(maya.api.courses.addAssessment({ classId, name: 'Quiz', weight: 5, altWeight: 5, dueAt: null }), 'BAD_INPUT');
    await maya.api.courses.addAssessment({ classId, name: 'Quiz', weight: 5, altWeight: 0, dueAt: null });

    await maya.api.courses.setSecondScheme({ classId, on: false });
    expect(await weights()).toEqual([['Midterm', 25, null], ['Final', 70, null], ['Quiz', 5, null]]);
  });

  it('shares class deadlines, checked off by each student', async () => {
    const { classId, people } = await classmates('Maya', 'Leo');
    const [maya, leo] = people;
    await maya.api.calendar.addDeadline({ classId, kind: 'quiz', title: 'Quiz 2', dueAt: new Date(2026, 9, 9, 23, 59), notes: '' });
    await maya.api.calendar.addDeadline({ classId: null, kind: 'other', title: 'Dentist', dueAt: new Date(2026, 9, 8, 9), notes: '' });

    const [quiz] = await leo.api.calendar.upcoming({ days: 7 });
    expect(quiz).toMatchObject({ title: 'Quiz 2', classLabel: 'COMP 251-001', addedBy: 'Maya' });
    expect((await maya.api.calendar.upcoming({ days: 7 })).map((e) => [e.title, e.addedBy])).toEqual([
      ['Dentist', null],
      ['Quiz 2', null],
    ]);

    await leo.api.calendar.setDeadlineDone({ id: quiz.deadlineId!, done: true });
    expect(await leo.api.calendar.upcoming({ days: 7 })).toEqual([]);
    expect((await maya.api.calendar.upcoming({ days: 7 })).length).toBe(2);
    await expectCode(leo.api.calendar.removeDeadline({ id: quiz.deadlineId! }), 'FORBIDDEN');
  });
});

describe('ST2 assignment planner', () => {
  it('front-loads tasks into free time and re-plans missed ones', async () => {
    const { api } = await student('Maya');
    // Due Thursday; with the default 2-day buffer, work fits Monday and Tuesday (90 min free each).
    await api.planner.create({ title: 'Problem set 3', classId: null, dueAt: new Date(2026, 9, 8, 23, 59), notes: '', tasks: problems(45), attachmentPath: null });
    let [plan] = await api.planner.list();
    expect(plan.bufferDays).toBe(2);
    expect(plan.tasks.map((t) => t.scheduledFor)).toEqual(['2026-10-05', '2026-10-05', '2026-10-06']);

    // A day passes with only the first problem done: the rest move to the next free time.
    await api.planner.setDone({ taskId: plan.tasks[0].id, done: true });
    clock = new Date(2026, 9, 6, 9, 0);
    [plan] = await api.planner.list();
    expect(plan.tasks.filter((t) => !t.doneAt).map((t) => t.scheduledFor)).toEqual(['2026-10-06', '2026-10-06']);
    expect(plan.tight || plan.overloaded).toBe(false);
  });

  it('moves a plan when a classmate moves the class deadline it follows', async () => {
    const {
      classId,
      people: [maya, jonah],
    } = await classmates('Maya', 'Jonah');
    const deadline = (due: Date) => ({ classId, kind: 'assignment' as const, title: 'Problem set 4', dueAt: due, notes: '' });
    await jonah.api.calendar.addDeadline(deadline(new Date(2026, 9, 9, 23, 59)));
    const [shared] = await maya.api.calendar.deadlines();
    await maya.api.planner.create({
      title: 'Problem set 4',
      classId,
      dueAt: shared.dueAt,
      notes: '',
      tasks: problems(45),
      attachmentPath: null,
      deadlineId: shared.id,
      assessmentId: null,
    });

    // Jonah pushes it back a week: Maya's plan takes the new date and tells her.
    await jonah.api.calendar.updateDeadline({ id: shared.id, ...deadline(new Date(2026, 9, 16, 23, 59)) });
    let [plan] = await maya.api.planner.list();
    expect(plan.dueAt).toEqual(new Date(2026, 9, 16, 23, 59));
    expect((await titles(maya)).some((title) => title.startsWith('"Problem set 4" is now due'))).toBe(true);
    // It's listed once, as the class deadline.
    expect((await maya.api.calendar.upcoming({ days: 30 })).filter((e) => e.detail !== 'key').map((e) => e.title)).toEqual(['Problem set 4']);

    // Picking her own date stops following it.
    await maya.api.planner.update({ assignmentId: plan.id, title: plan.title, classId, dueAt: new Date(2026, 9, 14, 12), notes: '', bufferDays: 2 });
    await jonah.api.calendar.updateDeadline({ id: shared.id, ...deadline(new Date(2026, 9, 20, 23, 59)) });
    [plan] = await maya.api.planner.list();
    expect(plan.dueAt).toEqual(new Date(2026, 9, 14, 12));
  });

  it('follows free time set per weekday', async () => {
    const { api } = await student('Maya');
    await api.planner.create({ title: 'Essay', classId: null, dueAt: new Date(2026, 9, 12, 23, 59), notes: '', tasks: problems(90), attachmentPath: null });
    let [plan] = await api.planner.list();
    expect(plan.tasks.map((t) => t.scheduledFor)).toEqual(['2026-10-05', '2026-10-06', '2026-10-07']);

    // No time on Tuesdays and Wednesdays, a long Monday: everything is re-planned.
    await expectCode(api.planner.setAvailability({ minutes: [0, 0, 0, 0, 0, 0, 0] }), 'BAD_INPUT');
    await api.planner.setAvailability({ minutes: [60, 180, 0, 0, 90, 60, 60] });
    expect((await api.auth.me())?.weeklyStudyMinutes).toEqual([60, 180, 0, 0, 90, 60, 60]);
    [plan] = await api.planner.list();
    expect(plan.tasks.map((t) => t.scheduledFor)).toEqual(['2026-10-05', '2026-10-05', '2026-10-08']);
  });

  it('moves work off a day that a study session has filled up', async () => {
    const { classId, people } = await classmates('Maya');
    const [maya] = people;
    await maya.api.planner.create({ title: 'Problem set 3', classId, dueAt: new Date(2026, 9, 9, 23, 59), notes: '', tasks: problems(45), attachmentPath: null });
    // A 90-minute session on Tuesday uses all of Tuesday's free time.
    await maya.api.studySessions.create({ classId, ...session({ startsAt: new Date(2026, 9, 6, 18), endsAt: new Date(2026, 9, 6, 19, 30) }) });
    const [plan] = await maya.api.planner.list();
    expect(plan.tasks.map((t) => t.scheduledFor)).toEqual(['2026-10-05', '2026-10-05', '2026-10-07']);
    expect(plan.overloaded).toBe(false);
  });

  it('finds the problems in an attached handout', async () => {
    const { api, ctx } = await student('Maya');
    const file = join(tmpdir(), 'unilink-test-handout.txt');
    await writeFile(file, 'Assignment 2\nQuestion 1 (10 points)\nQuestion 2 (20 points)\n');
    expect(await api.planner.readParts({ path: file })).toEqual([
      { title: 'Question 1', points: 10 },
      { title: 'Question 2', points: 20 },
    ]);
    // Files it can't read (a Word document here) aren't an error, just nothing found.
    ctx.platform.readText = async () => null;
    expect(await api.planner.readParts({ path: file })).toBeNull();
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
      tasks: problems(60),
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
  it('notifies about waitlist spots and replies, emailing by preference', async () => {
    const { classId, people } = await classmates('Maya', 'Leo', 'Ana');
    const [maya, leo, ana] = people;

    const { id: sessionId } = await maya.api.studySessions.create({ classId, ...session({ capacity: 2 }) });
    await leo.api.studySessions.join({ sessionId });
    await ana.api.studySessions.join({ sessionId });
    await leo.api.studySessions.leave({ sessionId });
    const { id: postId } = await maya.api.board.create({ classId, kind: 'question', topic: 'Assignments', title: 'Q3 hint?', body: 'Stuck on 3b', visibility: 'class', audienceEmails: [] });
    await leo.api.board.reply({ postId, body: 'Think about the recurrence' });
    await maya.api.board.reply({ postId, body: 'Thanks!' }); // replying to yourself: no notification

    expect(await titles(ana)).toEqual(['A spot opened up: you\'re going to "Midterm review"']);
    const mine = await maya.api.notifications.list();
    expect(mine.items.map((n) => n.title)).toEqual(['Leo replied to "Q3 hint?"']);
    expect(mine.unread).toBe(1);

    // Waitlist spots are emailed by default; replies aren't until switched on.
    expect((await ana.api.notifications.outbox()).map((e) => e.subject)).toEqual(['UniLink: A spot opened up: you\'re going to "Midterm review"']);
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
    expect(await titles({ api })).toEqual(['Essay is due tomorrow at 08:00']);
  });

  it('reminds about a final exam the day before', async () => {
    const { api, ctx, user } = await student('Maya');
    await api.classes.join({ classId: await comp251(api) });
    clock = new Date(2026, 11, 13, 15, 0); // COMP 251's final is Monday 14 December at 14:00
    sweepReminders({ ...ctx, userId: user.id });
    expect(await titles({ api })).toEqual(['"COMP 251 final exam" starts tomorrow at 14:00']);
  });
});

describe('ST1 study mode', () => {
  it('turns on for class, holds notifications, and uses Do Not Disturb', async () => {
    const { classId, people } = await classmates('Maya', 'Leo');
    const [maya, leo] = people;
    // Leo enters the section's class times; they switch study mode on for Maya too.
    await leo.api.courses.saveMeetings({
      classId,
      meetings: [{ weekday: 1, startTime: '10:05', endTime: '11:25', location: 'Leacock 132' }],
    });
    await maya.api.studyMode.updateSettings({ autoForClasses: true, autoForSessions: true, silenceNotifications: true, systemDnd: true });
    const { id: postId } = await maya.api.board.create({ classId, kind: 'question', topic: 'Lectures', title: 'Slides?', body: 'Where are they?', visibility: 'class', audienceEmails: [] });

    const state = initialTickState();
    await backgroundTick(maya.ctx, state);
    expect(state.studyActive).toBe(false);

    clock = new Date(2026, 9, 5, 10, 30); // in class
    await backgroundTick(maya.ctx, state);
    expect(state.studyActive).toBe(true);
    expect(dndCalls).toEqual([true]);
    expect(shown).toEqual(['Study mode on: COMP 251-001']);

    // A reply arriving mid-class waits.
    await leo.api.board.reply({ postId, body: 'On myCourses' });
    await backgroundTick(maya.ctx, state);
    expect(shown).toHaveLength(1);

    // Switching it off by hand releases what was held and stays off for this class.
    await maya.api.studyMode.stop();
    await backgroundTick(maya.ctx, state);
    expect(state.studyActive).toBe(false);
    expect(dndCalls).toEqual([true, false]);
    expect(shown.slice(1)).toEqual(['Leo replied to "Slides?"', 'Study mode off']);
    expect((await maya.api.studyMode.status()).pausedWindow?.label).toBe('COMP 251-001');

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
