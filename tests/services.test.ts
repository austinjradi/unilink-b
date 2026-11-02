import { readdir, readFile, writeFile } from 'node:fs/promises';
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
      fileUrl: async (path) => `file://${path}`,
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

  it('matches a pasted schedule against the catalogue for review', async () => {
    const { api } = await student('Maya');
    const in251 = await comp251(api, '002');
    await api.classes.join({ classId: in251 });
    const [math] = await api.catalogue.search({ query: 'MATH 240', term: 'Fall 2026', level: null });
    await api.classes.join({ classId: math.id });
    const rows = await api.classes.matchSchedule({ term: 'Fall 2026', text: 'COMP 251 001\nMATH 240 001\nCOMP 202\nCOMP 202 009\nZZZZ 999' });
    expect(rows.map((r) => [r.label, r.status, r.otherCode])).toEqual([
      ['COMP 251-001', 'other-section', 'COMP 251-002'],
      ['MATH 240-001', 'joined', null],
      ['COMP 202-009', 'missing', null],
      ['ZZZZ 999', 'missing', null],
    ]);
    const [fresh] = await api.classes.matchSchedule({ term: 'Fall 2026', text: 'COMP 202' });
    expect(fresh).toMatchObject({ label: 'COMP 202-001', status: 'new', title: 'Foundations of Programming' });
    await api.classes.join({ classId: fresh.classId! });
    expect((await api.classes.mine()).map((c) => c.code)).toContain('COMP 202-001');
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
      { id: maya.user.id, name: 'Maya', email: maya.email, pronouns: 'she/her', faculty: 'Science', role: 'student' },
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

  it('repeats a session weekly, with one code that joins every week', async () => {
    const { classId, people } = await classmates('Maya', 'Leo', 'Ana');
    const [maya, leo, ana] = people;
    const start = new Date(2026, 9, 6, 18);
    const { id, inviteCode } = await maya.api.studySessions.create({
      classId,
      weeks: 3,
      ...session({ startsAt: start, endsAt: new Date(2026, 9, 6, 20), visibility: 'invite', capacity: 2 }),
    });
    const weeks = await maya.api.studySessions.list({ classId });
    expect(weeks.map((w) => [w.startsAt.getDate(), w.seriesId, w.inviteCode])).toEqual([
      [6, id, inviteCode],
      [13, id, inviteCode],
      [20, id, inviteCode],
    ]);

    // The shared code joins all three weeks.
    expect(await leo.api.studySessions.joinByCode({ code: inviteCode })).toMatchObject({ status: 'going', weeks: 3 });
    expect((await leo.api.studySessions.list({ classId })).map((w) => w.myStatus)).toEqual(['going', 'going', 'going']);

    // The weeks are full (2 people), so the code puts Ana on every week's waitlist.
    expect(await ana.api.studySessions.joinByCode({ code: inviteCode })).toMatchObject({ status: 'waitlisted', weeks: 3 });

    // Cancelling "this and later weeks" from week 2 leaves week 1.
    await maya.api.studySessions.cancel({ sessionId: weeks[1].id, laterWeeks: true });
    expect((await maya.api.studySessions.list({ classId })).map((w) => [w.startsAt.getDate(), w.cancelledAt != null])).toEqual([
      [6, false],
      [13, true],
      [20, true],
    ]);
    // A new code works for the whole series.
    const { inviteCode: fresh } = await maya.api.studySessions.newCode({ sessionId: id });
    expect((await maya.api.studySessions.list({ classId })).every((w) => w.inviteCode === fresh)).toBe(true);
  });

  it('joins the later weeks of an open series from any week', async () => {
    const { classId, people } = await classmates('Maya', 'Leo');
    const [maya, leo] = people;
    await maya.api.studySessions.create({ classId, weeks: 4, ...session({ startsAt: new Date(2026, 9, 6, 18), endsAt: new Date(2026, 9, 6, 20) }) });
    const [first, second] = await leo.api.studySessions.list({ classId });
    expect(first.weeksToJoin).toBe(4);
    await leo.api.studySessions.join({ sessionId: first.id });
    expect((await leo.api.studySessions.list({ classId }))[0].weeksToJoin).toBe(3);
    expect(await leo.api.studySessions.joinSeries({ sessionId: second.id })).toMatchObject({ weeks: 3 });
    expect((await leo.api.studySessions.list({ classId })).map((w) => [w.myStatus, w.weeksToJoin])).toEqual([
      ['going', 0],
      ['going', 0],
      ['going', 0],
      ['going', 0],
    ]);
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
    const pick = (audienceEmails: string[]) =>
      maya.api.board.create({ classId, kind: 'question', topic: 'Assignments', title: 'Group for A2?', body: 'Want to pair up?', visibility: 'selected', audienceEmails });
    // Nobody has posted yet, so nobody can be picked. A classmate and a stranger get the same
    // answer, so typing emails can't reveal who's in the class (S1).
    await expect(pick([leo.email])).rejects.toThrow(`in this class: ${leo.email}`);
    await expect(pick(['nobody@mail.mcgill.ca'])).rejects.toThrow('in this class: nobody@mail.mcgill.ca');

    await leo.api.board.create({ classId, kind: 'note', topic: 'Logistics', title: 'Hi', body: 'Hello!', visibility: 'class', audienceEmails: [] });
    const { id: postId } = await pick([leo.email, maya.email]);
    expect((await leo.api.board.get({ postId })).audience.map((a) => a.name)).toEqual(['Leo']);
    await expectCode(ana.api.board.get({ postId }), 'NOT_FOUND');
    expect((await ana.api.board.feed({ classIds: null, topics: [], since: null, search: '' })).map((p) => p.title)).toEqual(['Hi']);
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

describe('S4 images', () => {
  const tmpFile = async (name: string, size = 10) => {
    const file = join(tmpdir(), name);
    await writeFile(file, Buffer.alloc(size));
    return file;
  };
  const post = { kind: 'question' as const, topic: 'Exams', title: 'What does this error mean?', body: 'See the screenshot.', visibility: 'class' as const, audienceEmails: [] };

  it('adds images to posts and replies, for whoever can see them', async () => {
    const { classId, people } = await classmates('Maya', 'Leo', 'Ana');
    const [maya, leo, ana] = people;
    const png = await tmpFile('unilink-test-error.png');
    const { id: postId } = await maya.api.board.create({ ...post, classId, images: [png] });
    await leo.api.board.reply({ postId, body: 'Same here', images: [await tmpFile('unilink-test-mine.jpg')] });

    const [fromFeed] = await ana.api.board.feed({ classIds: [classId], topics: [], since: null, search: '' });
    expect(fromFeed.images.map((image) => image.name)).toEqual(['unilink-test-error.png']);
    const thread = await ana.api.board.get({ postId });
    expect(thread.images.map((image) => image.name)).toEqual(['unilink-test-error.png']);
    expect(thread.replies[0].images.map((image) => image.name)).toEqual(['unilink-test-mine.jpg']);
    expect(await ana.api.board.imageUrl({ id: thread.images[0].id })).toContain('unilink-test-error.png');

    // A private post's image is as private as the post.
    await leo.api.board.create({ ...post, classId, title: 'Hi' });
    const { id: secret } = await maya.api.board.create({ ...post, classId, visibility: 'selected', audienceEmails: [leo.email], images: [png] });
    const [hidden] = (await leo.api.board.get({ postId: secret })).images;
    expect(await leo.api.board.imageUrl({ id: hidden.id })).toContain('.png');
    await expectCode(ana.api.board.imageUrl({ id: hidden.id }), 'NOT_FOUND');
  });

  it('only takes reasonable image files, and checks before posting anything', async () => {
    const { classId, people } = await classmates('Maya');
    const [maya] = people;
    const good = await tmpFile('unilink-test-ok.png');
    await expect(maya.api.board.create({ ...post, classId, images: [good, await tmpFile('unilink-test.svg')] })).rejects.toThrow('PNG, JPEG, GIF or WebP');
    await expect(maya.api.board.create({ ...post, classId, images: [await tmpFile('unilink-test-big.png', 6 * 1024 * 1024)] })).rejects.toThrow('up to 5 MB');
    await expectCode(maya.api.board.create({ ...post, classId, images: Array(5).fill(good) }), 'BAD_INPUT');
    expect(await maya.api.board.feed({ classIds: [classId], topics: [], since: null, search: '' })).toEqual([]);
  });

  it('deletes images with what they belong to, keeping the rest of the thread', async () => {
    const { classId, people } = await classmates('Maya', 'Leo');
    const [maya, leo] = people;
    const png = await tmpFile('unilink-test-gone.png');
    const stored = async () => (await readdir(maya.ctx.filesDir)).filter((name) => name.endsWith('unilink-test-gone.png')).length;
    const before = await stored();

    const { id: postId } = await maya.api.board.create({ ...post, classId, images: [png] });
    await leo.api.board.reply({ postId, body: 'Me too', images: [png] });
    expect(await stored()).toBe(before + 2);

    // Maya deletes her post: her image goes, Leo's reply and image stay.
    expect(await maya.api.board.remove({ postId })).toEqual({ kept: true });
    let thread = await leo.api.board.get({ postId });
    expect(thread.images).toEqual([]);
    expect(thread.replies[0].images).toHaveLength(1);
    expect(await stored()).toBe(before + 1);

    await leo.api.board.removeReply({ replyId: thread.replies[0].id });
    thread = await leo.api.board.get({ postId });
    expect(thread.replies).toEqual([]);
    expect(await stored()).toBe(before);
  });
});

describe('S4 similar posts', () => {
  it('suggests posts in the class like the one being written, if you can see them', async () => {
    const { classId, people } = await classmates('Maya', 'Leo', 'Ana');
    const [maya, leo, ana] = people;
    await ana.api.board.create({ classId, kind: 'note', topic: 'Logistics', title: 'Hello', body: 'Hi all', visibility: 'class', audienceEmails: [] });
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

    // Muting a class silences its replies, but not what else happens in it.
    await sam.api.courses.setMuteReplies({ classId, muted: true });
    expect((await sam.api.courses.info({ classId })).muteReplies).toBe(true);
    const before = (await titles(sam)).length;
    await ana.api.board.reply({ postId, body: 'One more thing' });
    expect(await titles(sam)).toHaveLength(before);
    await sam.api.courses.setMuteReplies({ classId, muted: false });
    await ana.api.board.reply({ postId, body: 'And another' });
    expect(await titles(sam)).toHaveLength(before + 1);

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

  it('sums up your classes this term, with your own marks and targets only', async () => {
    const { classId, people } = await classmates('Maya', 'Leo');
    const [maya, leo] = people;
    await maya.api.courses.addAssessment({ classId, name: 'Midterm', weight: 40, dueAt: null });
    await maya.api.courses.addAssessment({ classId, name: 'Final', weight: 60, dueAt: null });
    const [midterm] = await maya.api.courses.assessments({ classId });
    await maya.api.courses.setScore({ id: midterm.id, score: 90 });
    await maya.api.courses.setTarget({ classId, targetGrade: 'A-' });

    const { classes } = await maya.api.courses.standing();
    expect(classes).toMatchObject([
      { classId, code: 'COMP 251-001', credits: 3, target: 'A-', hasScheme: true, currentAverage: 90, worstFinal: 36, bestFinal: 96, goal: { letter: 'A-', needed: 73.3, status: 'possible' } },
    ]);
    expect((await leo.api.courses.standing()).classes).toMatchObject([{ target: 'A', currentAverage: null, worstFinal: 0, bestFinal: 100 }]);

    // A section with no scheme yet, and the course record's CGPA alongside.
    await maya.api.classes.join({ classId: (await maya.api.catalogue.search({ query: 'MATH 240', term: 'Fall 2026', level: null }))[0].id });
    await maya.api.record.add({ code: 'COMP 202', title: '', credits: 3, term: 'Winter 2026', status: 'completed', grade: 'B' });
    const standing = await maya.api.courses.standing();
    expect(standing.classes.map((c) => c.hasScheme)).toEqual([true, false]);
    expect([standing.cgpa, standing.cgpaCredits]).toEqual([3, 3]);
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

describe('Professors', () => {
  async function professor(name: string) {
    const ctx = newContext();
    const api = clientFor(ctx);
    const email = `${name.toLowerCase()}@mcgill.ca`;
    const { user } = await api.auth.signUp({ name, email, password: PASSWORD, pronouns: '', faculty: 'Science', gradYear: null, role: 'professor' });
    return { api, user, email, ctx };
  }

  // A professor teaching COMP 251-001, with two students in it.
  async function taught() {
    const { classId, people } = await classmates('Maya', 'Leo');
    const prof = await professor('Ouellet');
    await prof.api.classes.join({ classId });
    return { classId, prof, maya: people[0], leo: people[1] };
  }

  const question = { kind: 'question' as const, topic: 'Exams', title: 'Is it open book?', body: 'Anyone know?', visibility: 'class' as const, audienceEmails: [] };

  it('signs professors up with a @mcgill.ca email, and they can teach several sections', async () => {
    const api = clientFor(newContext());
    await expect(
      api.auth.signUp({ name: 'Maya', email: 'maya@mail.mcgill.ca', password: PASSWORD, pronouns: '', faculty: '', gradYear: null, role: 'professor' }),
    ).rejects.toThrow('Professor accounts use a @mcgill.ca email');

    const { api: prof, user } = await professor('Ouellet');
    expect(user.role).toBe('professor');
    const [first, second] = [await comp251(prof, '001'), await comp251(prof, '002')];
    await prof.classes.join({ classId: first });
    await prof.classes.join({ classId: second });
    expect((await prof.classes.mine()).map((c) => [c.code, c.memberCount])).toEqual([['COMP 251-001', 0], ['COMP 251-002', 0]]);
    expect(await prof.classes.get({ classId: first })).toMatchObject({ teaching: true, otherSection: null, professors: [{ name: 'Ouellet' }] });
    expect((await prof.catalogue.search({ query: 'COMP 251', term: 'Fall 2026', level: null })).map((c) => [c.joined, c.otherSectionId])).toEqual([[true, null], [true, null]]);
    expect(await prof.courses.info({ classId: first })).toMatchObject({ professor: 'Prof. Ouellet', professorEmail: 'ouellet@mcgill.ca', teaching: true, canEdit: true });
  });

  it('is public to the section, and can be picked as a post audience', async () => {
    const { classId, prof, maya } = await taught();
    expect((await maya.api.classes.classmates({ classId })).map((c) => [c.name, c.role])).toEqual([['Ouellet', 'professor']]);
    const { id } = await maya.api.board.create({ ...question, classId, visibility: 'selected', audienceEmails: [prof.email] });
    expect((await prof.api.board.get({ postId: id })).title).toBe('Is it open book?');
    expect((await maya.api.classes.get({ classId })).memberCount).toBe(2);
  });

  it('takes over the grading scheme, details and class times from the section', async () => {
    const { classId, prof, maya, leo } = await taught();
    const { id: other } = await maya.api.board.create({ ...question, classId });
    expect(other).toBeGreaterThan(0);
    const component = { classId, name: 'Midterm', weight: 30, dueAt: null };
    await expectCode(maya.api.courses.addAssessment(component), 'FORBIDDEN');
    await expectCode(maya.api.courses.saveDetails({ classId, professor: 'Someone', professorEmail: '', officeHours: '', location: '' }), 'FORBIDDEN');
    await expectCode(maya.api.courses.saveMeetings({ classId, meetings: [] }), 'FORBIDDEN');
    await expectCode(maya.api.courses.setSecondScheme({ classId, on: true }), 'FORBIDDEN');
    expect(await maya.api.courses.info({ classId })).toMatchObject({ canEdit: false, teaching: false, managedBy: 'Ouellet' });

    await prof.api.courses.addAssessment(component);
    await prof.api.courses.addAssessment({ ...component, name: 'Final', weight: 70 });
    // Told once a day, however many changes there are.
    const changed = 'The grading scheme for COMP 251-001 changed';
    expect((await titles(leo)).filter((title) => title === changed)).toHaveLength(1);

    // Marks stay the student's own, and private from the professor.
    const [midterm] = await maya.api.courses.assessments({ classId });
    await maya.api.courses.setScore({ id: midterm.id, score: 80 });
    await expectCode(maya.api.courses.updateAssessment({ id: midterm.id, name: 'Midterm', weight: 20, altWeight: null, dueAt: null }), 'FORBIDDEN');
    await expectCode(prof.api.courses.setScore({ id: midterm.id, score: 90 }), 'BAD_INPUT');
    expect((await prof.api.courses.assessments({ classId }))[0].score).toBeNull();
    // Unlike a student, the professor can remove a component that has marks on it.
    await prof.api.courses.removeAssessment({ id: midterm.id });
    expect((await maya.api.courses.assessments({ classId })).map((a) => a.name)).toEqual(['Final']);

    // When the only professor leaves, the section goes back to wiki-style.
    await prof.api.classes.leave({ classId });
    await maya.api.courses.addAssessment({ ...component, name: 'Quiz', weight: 10 });
  });

  it('posts assignments with a handout to everyone in the section', async () => {
    const { classId, prof, maya, leo } = await taught();
    const file = join(tmpdir(), 'unilink-test-a3.txt');
    await writeFile(file, 'Question 1 (10 points)\nQuestion 2 (20 points)\n');
    const assignment = { classId, title: 'Assignment 3', dueAt: new Date(2026, 9, 20, 23, 59), notes: 'Show your work.', weight: 10, attachmentPath: file };

    await expectCode(maya.api.assignments.post(assignment), 'FORBIDDEN');
    await expectCode(prof.api.assignments.post({ ...assignment, dueAt: new Date(2026, 0, 1) }), 'BAD_INPUT');
    const { id } = await prof.api.assignments.post(assignment);

    // On the class's list and the calendar, in the scheme, and everyone's been told.
    expect(await leo.api.assignments.list({ classId })).toMatchObject([{ id, title: 'Assignment 3', notes: 'Show your work.', attachmentName: 'unilink-test-a3.txt', official: true, done: false }]);
    expect((await leo.api.calendar.deadlines()).map((d) => d.title)).toEqual(['Assignment 3']);
    expect((await leo.api.courses.assessments({ classId })).map((a) => [a.name, a.weight])).toEqual([['Assignment 3', 10]]);
    expect(await titles(maya)).toContain('New assignment: Assignment 3');

    // A student plans from it: the handout's problems are there to read.
    const handout = await maya.api.assignments.handout({ deadlineId: id });
    expect(handout?.name).toBe('unilink-test-a3.txt');
    expect((await maya.api.planner.readParts({ path: handout!.path }))?.map((part) => part.title)).toEqual(['Question 1', 'Question 2']);
    await maya.api.planner.create({ title: 'Assignment 3', classId, dueAt: assignment.dueAt, notes: '', tasks: [{ title: 'Question 1', minutes: 30 }], attachmentPath: handout!.path, deadlineId: id, assessmentId: null });

    // Only the professor changes it. Moving the date tells students, and plans follow.
    await expectCode(maya.api.assignments.update({ id, title: 'Mine now', dueAt: assignment.dueAt, notes: '', attachmentPath: null }), 'FORBIDDEN');
    await expectCode(maya.api.calendar.removeDeadline({ id }), 'FORBIDDEN');
    const later = new Date(2026, 9, 27, 23, 59);
    await prof.api.assignments.update({ id, title: 'Assignment 3', dueAt: later, notes: 'Show your work.', attachmentPath: null });
    expect((await titles(leo)).some((title) => title.startsWith('"Assignment 3" is now due'))).toBe(true);
    expect((await maya.api.planner.list())[0].dueAt).toEqual(later);

    await expectCode(maya.api.assignments.remove({ id }), 'FORBIDDEN');
    await prof.api.assignments.remove({ id });
    expect(await leo.api.assignments.list({ classId })).toEqual([]);
  });

  it('copies a grading scheme to another section it teaches, if that one has none', async () => {
    const { classId, prof, maya } = await taught();
    const other = await comp251(prof.api, '002');
    await prof.api.classes.join({ classId: other });
    const leo = await student('Sam');
    await leo.api.classes.join({ classId: other });

    await expectCode(prof.api.courses.copyScheme({ fromClassId: classId, toClassId: other }), 'BAD_INPUT'); // nothing to copy yet
    await prof.api.courses.addAssessment({ classId, name: 'Midterm', weight: 30, altWeight: null, dueAt: new Date(2026, 9, 20) });
    await prof.api.courses.addAssessment({ classId, name: 'Final', weight: 70, dueAt: null });
    await expectCode(maya.api.courses.copyScheme({ fromClassId: classId, toClassId: other }), 'FORBIDDEN');

    await prof.api.courses.copyScheme({ fromClassId: classId, toClassId: other });
    expect((await leo.api.courses.assessments({ classId: other })).map((a) => [a.name, a.weight, a.dueAt])).toEqual([
      ['Midterm', 30, new Date(2026, 9, 20)],
      ['Final', 70, null],
    ]);
    expect(await titles(leo)).toContain('The grading scheme for COMP 251-002 changed');
    // Doing it again would erase marks, so it's refused.
    await expectCode(prof.api.courses.copyScheme({ fromClassId: classId, toClassId: other }), 'CONFLICT');

    // It needs to be a section they teach.
    const stranger = await professor('Khoury');
    await expectCode(stranger.api.courses.copyScheme({ fromClassId: classId, toClassId: other }), 'FORBIDDEN');
  });

  it('shows students their plan, and the professor a count of who is done, only in larger sections', async () => {
    const { classId, prof, maya, leo } = await taught();
    const dueAt = new Date(2026, 9, 20, 23, 59);
    const { id } = await prof.api.assignments.post({ classId, title: 'A3', dueAt, notes: '', weight: null, attachmentPath: null });
    expect((await maya.api.assignments.list({ classId }))[0]).toMatchObject({ planned: false, progress: null });

    await maya.api.planner.create({ title: 'A3', classId, dueAt, notes: '', tasks: [{ title: 'Start', minutes: 30 }], attachmentPath: null, deadlineId: id, assessmentId: null });
    expect((await maya.api.assignments.list({ classId }))[0].planned).toBe(true);
    expect((await leo.api.assignments.list({ classId }))[0].planned).toBe(false);

    // Two students: too few for a count that couldn't point at someone.
    await maya.api.calendar.setDeadlineDone({ id, done: true });
    expect((await prof.api.assignments.list({ classId }))[0].progress).toBeNull();
    for (const name of ['Ana', 'Sam', 'Noor']) {
      const other = await student(name);
      await other.api.classes.join({ classId });
    }
    expect((await prof.api.assignments.list({ classId }))[0].progress).toEqual({ done: 1, total: 5 });
    // Students never see it, and the professor checking it off wouldn't count.
    expect((await leo.api.assignments.list({ classId }))[0].progress).toBeNull();
    await prof.api.calendar.setDeadlineDone({ id, done: true });
    expect((await prof.api.assignments.list({ classId }))[0].progress).toEqual({ done: 1, total: 5 });
  });

  it('tags what a professor shares', async () => {
    const { classId, prof, maya } = await taught();
    await prof.api.links.add({ classId, url: 'https://discord.gg/official251', label: 'Official', purpose: 'course' });
    expect((await maya.api.links.list({ classId })).map((l) => [l.ownerName, l.ownerRole])).toEqual([['Ouellet', 'professor']]);
    await prof.api.studySessions.create({ classId, weeks: 2, ...session({ title: 'Office hours', tag: 'Office hours', startsAt: new Date(2026, 9, 6, 14), endsAt: new Date(2026, 9, 6, 15) }) });
    expect((await maya.api.studySessions.list({ classId })).map((s) => [s.title, s.hostIsProfessor, s.seriesId != null])).toEqual([['Office hours', true, true], ['Office hours', true, true]]);
  });

  it('corrects class deadlines students added, but not private ones', async () => {
    const { classId, prof, maya } = await taught();
    const deadline = { kind: 'assignment' as const, title: 'A wrong date', dueAt: new Date(2026, 9, 20, 23, 59), notes: '' };
    await maya.api.calendar.addDeadline({ ...deadline, classId });
    await maya.api.calendar.addDeadline({ ...deadline, classId: null, title: 'Private' });
    const [shared, own] = await maya.api.calendar.deadlines();
    await prof.api.calendar.removeDeadline({ id: shared.id });
    await expectCode(prof.api.calendar.removeDeadline({ id: own.id }), 'FORBIDDEN');
  });

  it('announces, pins, locks, endorses and removes on the discussion board', async () => {
    const { classId, prof, maya, leo } = await taught();
    const feed = (s: typeof maya) => s.api.board.feed({ classIds: [classId], topics: [], since: null, search: '' });
    const { id: postId } = await maya.api.board.create({ ...question, classId });
    await leo.api.board.create({ ...question, classId, title: 'A later question' });

    // A professor's note to the section is an announcement; a student's isn't.
    const { id: noteId } = await prof.api.board.create({ ...question, classId, kind: 'note', title: 'No class Friday' });
    expect(await titles(leo)).toContain('COMP 251-001: No class Friday');
    await maya.api.board.create({ ...question, classId, kind: 'note', title: 'Notes from Tuesday' });
    expect(await titles(leo)).not.toContain('COMP 251-001: Notes from Tuesday');
    expect((await feed(maya)).find((p) => p.id === noteId)?.authorRole).toBe('professor');

    // Pinned first, on that class's board.
    await expectCode(maya.api.board.pin({ postId, pinned: true }), 'FORBIDDEN');
    await prof.api.board.pin({ postId, pinned: true });
    expect((await feed(leo))[0].id).toBe(postId);
    await prof.api.board.pin({ postId, pinned: false });
    expect((await feed(leo))[0].id).not.toBe(postId);

    // Locked: no more from students, but the professor can still answer.
    await leo.api.board.reply({ postId, body: 'I think so' });
    await expectCode(leo.api.board.lock({ postId, locked: true }), 'FORBIDDEN');
    await prof.api.board.lock({ postId, locked: true });
    await expectCode(maya.api.board.reply({ postId, body: 'Thanks' }), 'FORBIDDEN');
    await prof.api.board.reply({ postId, body: 'It is not.' });
    await prof.api.board.lock({ postId, locked: false });

    // Endorsed replies come right after an accepted answer; the author hears about it.
    let thread = await prof.api.board.get({ postId });
    expect(thread.canModerate).toBe(true);
    expect((await maya.api.board.get({ postId })).canModerate).toBe(false);
    const [leoReply, profReply] = thread.replies;
    await expectCode(maya.api.board.endorse({ replyId: profReply.id, endorsed: true }), 'FORBIDDEN');
    await prof.api.board.endorse({ replyId: profReply.id, endorsed: true });
    thread = await maya.api.board.get({ postId });
    expect(thread.replies.map((r) => [r.body, r.endorsed])).toEqual([['It is not.', true], ['I think so', false]]);
    await prof.api.board.endorse({ replyId: leoReply.id, endorsed: true });
    expect(await titles(leo)).toContain('Ouellet endorsed your reply in "Is it open book?"');

    // Removing a reply tells its author why.
    await expectCode(maya.api.board.removeReplyAsProfessor({ replyId: leoReply.id, reason: '' }), 'FORBIDDEN');
    await prof.api.board.removeReplyAsProfessor({ replyId: leoReply.id, reason: 'That answer gives away the solution.' });
    const removedReply = (await leo.api.notifications.list()).items.find((n) => n.title.includes('removed your reply'));
    expect(removedReply).toMatchObject({ title: 'Ouellet removed your reply in "Is it open book?"', body: 'That answer gives away the solution.' });

    // A post with replies stays as a blank thread; one without is gone.
    await expectCode(leo.api.board.removeAsProfessor({ postId, reason: '' }), 'FORBIDDEN');
    expect(await prof.api.board.removeAsProfessor({ postId, reason: 'Off topic' })).toEqual({ kept: true });
    expect(await maya.api.board.get({ postId })).toMatchObject({ title: '', body: '', removedByProfessor: true });
    expect(await titles(maya)).toContain('Ouellet removed your post "Is it open book?"');
    await expectCode(maya.api.board.update({ postId, ...question }), 'BAD_INPUT');
    const { id: lonely } = await leo.api.board.create({ ...question, classId, title: 'Nobody replied' });
    expect(await prof.api.board.removeAsProfessor({ postId: lonely, reason: '' })).toEqual({ kept: false });
    await expectCode(leo.api.board.get({ postId: lonely }), 'NOT_FOUND');
  });

  it('leaves private posts private, and only moderates its own sections', async () => {
    const { classId, prof, maya, leo } = await taught();
    await leo.api.board.create({ ...question, classId, title: 'Hello' });
    const { id: secret } = await maya.api.board.create({ ...question, classId, visibility: 'selected', audienceEmails: [leo.email] });
    await expectCode(prof.api.board.get({ postId: secret }), 'NOT_FOUND');
    await expectCode(prof.api.board.removeAsProfessor({ postId: secret, reason: '' }), 'NOT_FOUND');

    const elsewhere = await professor('Khoury');
    const { id: post } = await maya.api.board.create({ ...question, classId });
    await expectCode(elsewhere.api.board.pin({ postId: post, pinned: true }), 'FORBIDDEN');
    await expectCode(elsewhere.api.assignments.post({ classId, title: 'A', dueAt: new Date(2026, 9, 20), notes: '', weight: null, attachmentPath: null }), 'FORBIDDEN');
    await expectCode(elsewhere.api.courses.addAssessment({ classId, name: 'Quiz', weight: 5, dueAt: null }), 'FORBIDDEN');
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

  it('gives exams a heads-up three days ahead, once, and never to whoever teaches them', async () => {
    const { classId, people } = await classmates('Maya');
    const [maya] = people;
    const authed = { ...maya.ctx, userId: maya.user.id };
    // Clock: Monday 5 October, 9:00. Too far off, then within three days, then the day before.
    await maya.api.calendar.addDeadline({ classId: null, kind: 'exam', title: 'Physics test', dueAt: new Date(2026, 9, 8, 8), notes: '' });
    await maya.api.calendar.addDeadline({ classId: null, kind: 'assignment', title: 'Essay', dueAt: new Date(2026, 9, 8, 8), notes: '' });
    await maya.api.courses.addAssessment({ classId, name: 'Midterm', weight: 30, dueAt: new Date(2026, 9, 7, 18) });
    await maya.api.courses.addAssessment({ classId, name: 'Lab report', weight: 10, dueAt: new Date(2026, 9, 7, 18) });
    await maya.api.courses.addAssessment({ classId, name: 'Final', weight: 60, dueAt: new Date(2026, 10, 7, 18) });
    sweepReminders(authed);
    sweepReminders(authed);
    expect(await titles(maya)).toEqual(['Midterm is in 2 days', 'Physics test is in 3 days']);

    // A mark on it means it's over; a checked-off exam is too.
    const [physics] = await maya.api.calendar.deadlines();
    await maya.api.calendar.setDeadlineDone({ id: physics.id, done: true });
    clock = new Date(2026, 9, 5, 10);
    sweepReminders(authed);
    expect(await titles(maya)).toHaveLength(2);

    // The schedule's final exam too, then its day-before reminder as well.
    clock = new Date(2026, 11, 11, 15); // COMP 251's final is Monday 14 December at 14:00
    sweepReminders(authed);
    expect((await titles(maya))[0]).toBe('COMP 251 final exam is in 3 days');
    clock = new Date(2026, 11, 13, 15);
    sweepReminders(authed);
    expect((await titles(maya))[0]).toBe('"COMP 251 final exam" starts tomorrow at 14:00');

    // A professor teaching the class hears about none of it.
    const ctx = newContext();
    const prof = clientFor(ctx);
    const { user } = await prof.auth.signUp({ name: 'Ouellet', email: 'ouellet@mcgill.ca', password: PASSWORD, pronouns: '', faculty: 'Science', gradYear: null, role: 'professor' });
    await prof.classes.join({ classId });
    await prof.calendar.addDeadline({ classId, kind: 'exam', title: 'Quiz day', dueAt: new Date(2026, 11, 14, 9), notes: '' });
    sweepReminders({ ...ctx, userId: user.id });
    expect(await titles({ api: prof })).toEqual([]);
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
