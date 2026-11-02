import { writeFile } from 'node:fs/promises';
import { and, eq, inArray, isNotNull } from 'drizzle-orm';
import { z } from 'zod';
import { GOAT_OPTIONS, type GoatPart, isGoatConfig } from '@shared/goat';
import { LOCALES } from '@shared/i18n';
import { FACULTIES, MCGILL_EMAIL, passwordProblems } from '@shared/validation';
import { randomHex, randomInt, scryptHex, sha256Hex as sha256, timingSafeEqualHex } from '../crypto';
import type { DB } from '../db/client';
import { DEMO_PASSWORD, DEMO_USERS } from '../db/demo';
import {
  appState,
  assessments,
  authSessions,
  chatLinks,
  classDetails,
  classMeetings,
  deadlines,
  enrollments,
  posts,
  replies,
  users,
} from '../db/schema';
import { AppError, type AuthedContext, type Context, nonEmpty, procedure, publicProcedure } from '../rpc/core';
import { formerStudentId } from './access';
import { collectMyData } from './myData';
import { deleteUserFiles } from './planner';
import { m, notify } from './notifications';
import { leaveClassSessions } from './studySessions';

// G4 in version B:
// - Passwords are passphrases: 12+ characters, no required symbols or digits, but not a
//   common password and not your own name.
// - Sign-up asks for your name, pronouns (optional), faculty and expected graduation year.
// - There's no email reset. Sign-up shows a one-time recovery code; with it you can set a
//   new password, and you get a fresh code each time it's used.
// - Five wrong passwords or recovery codes in a row pause sign-in and resets for 15 minutes,
//   and the next sign-in tells you how many attempts failed.
// - You can change your McGill email, with your password.
// - Deleting your account deletes your data. You can choose to leave your posts and replies
//   up without your name, so classmates keep the answers. What you added to a section's
//   shared info (class times, deadlines, grading scheme) stays, credited to "a former student".

const SESSION_KEY = 'session_token';
const RECOVERY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export async function hashPassword(password: string): Promise<string> {
  const salt = randomHex(16);
  return `scrypt:${salt}:${await scryptHex(password, salt, 64)}`;
}

async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, saltHex, keyHex] = stored.split(':');
  if (scheme !== 'scrypt' || !saltHex || !keyHex) return false;
  return timingSafeEqualHex(await scryptHex(password, saltHex, keyHex.length / 2), keyHex);
}

// "K7QD-9WXM-3HFA": 12 random characters (60 bits), so a fast hash is enough to store it.
function newRecoveryCode() {
  const chars = Array.from({ length: 12 }, () => RECOVERY_ALPHABET[randomInt(0, RECOVERY_ALPHABET.length)]).join('');
  return chars.match(/.{4}/g)!.join('-');
}

const hashRecoveryCode = (code: string) => sha256(code.toUpperCase().replace(/[^A-Z0-9]/g, ''));

const email = z
  .string()
  .trim()
  .toLowerCase()
  .regex(MCGILL_EMAIL, 'Use your McGill email (@mail.mcgill.ca or @mcgill.ca)');

const profileFields = {
  name: nonEmpty('Name', 100),
  pronouns: z.string().trim().max(40),
  faculty: z.union([z.literal(''), z.enum(FACULTIES)]),
  gradYear: z.number().int().min(2020).max(2040).nullable(),
};

const MAX_ATTEMPTS = 5;
const PAUSE_MINUTES = 15;

type UserRow = typeof users.$inferSelect;

function checkNotPaused(ctx: Context, user: UserRow) {
  const left = (user.lockedUntil?.getTime() ?? 0) - ctx.now().getTime();
  if (left > 0) {
    throw new AppError('Too many failed attempts. Try again in {{count}} minutes.', 'UNAUTHORIZED', { count: Math.ceil(left / 60_000) });
  }
}

// Counts a wrong password or recovery code; every fifth in a row pauses sign-in. `error`
// gets the tries left when there are two or fewer, so it can warn.
function failedAttempt(ctx: Context, user: UserRow, error: (triesLeft: number | null) => AppError): never {
  const failed = user.failedSignIns + 1;
  const left = MAX_ATTEMPTS - (failed % MAX_ATTEMPTS);
  const pause = left === MAX_ATTEMPTS;
  ctx.db
    .update(users)
    .set({ failedSignIns: failed, ...(pause ? { lockedUntil: new Date(ctx.now().getTime() + PAUSE_MINUTES * 60_000) } : {}) })
    .where(eq(users.id, user.id))
    .run();
  if (pause) throw new AppError('Too many failed attempts. Try again in {{count}} minutes.', 'UNAUTHORIZED', { count: PAUSE_MINUTES });
  throw error(left <= 2 ? left : null);
}

// A successful sign-in or reset starts the count over, and says if anyone got it wrong before.
function clearAttempts(ctx: Context, user: UserRow) {
  if (!user.failedSignIns && !user.lockedUntil) return;
  ctx.db.update(users).set({ failedSignIns: 0, lockedUntil: null }).where(eq(users.id, user.id)).run();
  if (user.failedSignIns) {
    notify(ctx.db, user.id, {
      type: 'sign-in-attempts',
      title: m('{{count}} failed sign-in attempts since you last signed in', { count: user.failedSignIns }),
      body: m("If that wasn't you, change your password under Settings → Account."),
      link: '/settings/account',
    });
  }
}

function checkPassword(password: string, address: string) {
  if (passwordProblems(password, address).length) {
    throw new AppError("Use at least 12 characters that aren't a common password or your name");
  }
}

export function publicUser(user: typeof users.$inferSelect) {
  const { passwordHash: _, recoveryCodeHash: __, ...rest } = user;
  return rest;
}

function findUser(db: DB, id: number) {
  return db.select().from(users).where(eq(users.id, id)).get();
}

function startSession(ctx: Context, userId: number) {
  const token = randomHex(32);
  ctx.db.insert(authSessions).values({ tokenHash: sha256(token), userId }).run();
  ctx.db
    .insert(appState)
    .values({ key: SESSION_KEY, value: token })
    .onConflictDoUpdate({ target: appState.key, set: { value: token } })
    .run();
  ctx.session.userId = userId;
}

function endSession(ctx: Context) {
  const saved = ctx.db.select().from(appState).where(eq(appState.key, SESSION_KEY)).get();
  if (saved) ctx.db.delete(authSessions).where(eq(authSessions.tokenHash, sha256(saved.value))).run();
  ctx.db.delete(appState).where(eq(appState.key, SESSION_KEY)).run();
  ctx.session.userId = null;
}

// Picks up the session remembered from the last launch, if it's still valid.
function restoreSession(ctx: Context) {
  const saved = ctx.db.select().from(appState).where(eq(appState.key, SESSION_KEY)).get();
  if (!saved) return;
  const row = ctx.db.select().from(authSessions).where(eq(authSessions.tokenHash, sha256(saved.value))).get();
  ctx.session.userId = row?.userId ?? null;
}

async function requirePassword(db: DB, userId: number, password: string) {
  const user = findUser(db, userId);
  if (!user || !(await verifyPassword(password, user.passwordHash))) {
    throw new AppError('That password is incorrect.');
  }
  return user;
}

function issueRecoveryCode(db: DB, userId: number) {
  const code = newRecoveryCode();
  db.update(users).set({ recoveryCodeHash: hashRecoveryCode(code) }).where(eq(users.id, userId)).run();
  return code;
}

// Hands everything the section shares over to the former-student placeholder, and (when
// asked) the student's posts and replies too, before the account row and the rest go.
function keepSharedContributions(ctx: AuthedContext, keepPosts: boolean) {
  const { db, userId } = ctx;
  const former = formerStudentId(db);
  for (const { classId } of db.select({ classId: enrollments.classId }).from(enrollments).where(eq(enrollments.userId, userId)).all()) {
    leaveClassSessions(ctx, classId);
  }
  db.update(classMeetings).set({ userId: former }).where(eq(classMeetings.userId, userId)).run();
  db.update(deadlines).set({ userId: former }).where(and(eq(deadlines.userId, userId), isNotNull(deadlines.classId))).run();
  db.update(assessments).set({ userId: former }).where(eq(assessments.userId, userId)).run();
  db.update(classDetails).set({ updatedById: former }).where(eq(classDetails.updatedById, userId)).run();
  if (keepPosts) {
    db.update(posts).set({ authorId: former }).where(eq(posts.authorId, userId)).run();
    db.update(replies).set({ authorId: former }).where(eq(replies.authorId, userId)).run();
  } else {
    // Their replies go, so questions they answered are open again.
    const theirReplies = db.select({ id: replies.id }).from(replies).where(eq(replies.authorId, userId));
    db.update(posts).set({ acceptedReplyId: null }).where(inArray(posts.acceptedReplyId, theirReplies)).run();
  }
  // Group chat links are the student's own, so they go with the account.
  db.delete(chatLinks).where(eq(chatLinks.ownerId, userId)).run();
}

export const authRouter = {
  // Demo classmates (see db/demo.ts); the sign-in screen lists them as one-click sign-ins.
  devInfo: publicProcedure(z.void(), (_input, ctx) =>
    ctx.isDev ? { accounts: DEMO_USERS.map(({ name, email }) => ({ name, email })), password: DEMO_PASSWORD } : null,
  ),

  me: publicProcedure(z.void(), (_input, ctx) => {
    if (ctx.session.userId == null) restoreSession(ctx);
    if (ctx.session.userId == null) return null;
    const user = findUser(ctx.db, ctx.session.userId);
    if (!user) {
      endSession(ctx);
      return null;
    }
    return publicUser(user);
  }),

  // Returns the recovery code once; it's never shown again.
  signUp: publicProcedure(
    z.object({ ...profileFields, email, password: z.string(), locale: z.enum(LOCALES).default('en') }),
    async ({ email, password, ...fields }, ctx) => {
      checkPassword(password, email);
      if (ctx.db.select().from(users).where(eq(users.email, email)).get()) {
        throw new AppError('An account with this email already exists. Try signing in.', 'CONFLICT');
      }
      const user = ctx.db
        .insert(users)
        .values({ ...fields, email, passwordHash: await hashPassword(password) })
        .returning()
        .get();
      const recoveryCode = issueRecoveryCode(ctx.db, user.id);
      startSession(ctx, user.id);
      return { user: publicUser(user), recoveryCode };
    },
  ),

  signIn: publicProcedure(
    z.object({ email: z.string().trim().toLowerCase(), password: z.string() }),
    async ({ email, password }, ctx) => {
      const user = ctx.db.select().from(users).where(eq(users.email, email)).get();
      if (!user) throw new AppError('Email or password is incorrect.', 'UNAUTHORIZED');
      checkNotPaused(ctx, user);
      if (!(await verifyPassword(password, user.passwordHash))) {
        failedAttempt(ctx, user, (left) =>
          left
            ? new AppError('Email or password is incorrect. {{count}} more tries before sign-in pauses for 15 minutes.', 'UNAUTHORIZED', { count: left })
            : new AppError('Email or password is incorrect.', 'UNAUTHORIZED'),
        );
      }
      clearAttempts(ctx, user);
      startSession(ctx, user.id);
      return publicUser(user);
    },
  ),

  signOut: publicProcedure(z.void(), (_input, ctx) => endSession(ctx)),

  // G4.4 with the recovery code. Signs out everywhere and hands back a fresh code.
  resetPassword: publicProcedure(
    z.object({ email: z.string().trim().toLowerCase(), recoveryCode: z.string().trim(), password: z.string() }),
    async ({ email, recoveryCode, password }, ctx) => {
      const user = ctx.db.select().from(users).where(eq(users.email, email)).get();
      if (!user?.recoveryCodeHash) throw new AppError("That email and recovery code don't match.");
      checkNotPaused(ctx, user);
      if (user.recoveryCodeHash !== hashRecoveryCode(recoveryCode)) {
        failedAttempt(ctx, user, (left) =>
          left
            ? new AppError("That email and recovery code don't match. {{count}} more tries before sign-in pauses for 15 minutes.", 'BAD_INPUT', { count: left })
            : new AppError("That email and recovery code don't match."),
        );
      }
      checkPassword(password, email);
      clearAttempts(ctx, user);
      const passwordHash = await hashPassword(password);
      ctx.db.transaction((tx) => {
        tx.update(users).set({ passwordHash }).where(eq(users.id, user.id)).run();
        tx.delete(authSessions).where(eq(authSessions.userId, user.id)).run();
      });
      return { recoveryCode: issueRecoveryCode(ctx.db, user.id) };
    },
  ),
};

export const profileRouter = {
  update: procedure(z.object(profileFields), (input, ctx) =>
    publicUser(ctx.db.update(users).set(input).where(eq(users.id, ctx.userId)).returning().get()),
  ),

  // Settings → General: language for the UI, notifications and emails.
  setLocale: procedure(z.object({ locale: z.enum(LOCALES) }), ({ locale }, ctx) => {
    ctx.db.update(users).set({ locale }).where(eq(users.id, ctx.userId)).run();
  }),

  // Settings → Goat.
  setAvatar: procedure(
    z.object(
      Object.fromEntries(
        (Object.keys(GOAT_OPTIONS) as GoatPart[]).map((part) => [part, z.enum(GOAT_OPTIONS[part] as unknown as [string, ...string[]])]),
      ) as Record<GoatPart, z.ZodEnum>,
    ),
    (avatar, ctx) => {
      if (!isGoatConfig(avatar)) throw new AppError('That goat outfit is not available.');
      ctx.db.update(users).set({ avatar }).where(eq(users.id, ctx.userId)).run();
    },
  ),

  changePassword: procedure(
    z.object({ currentPassword: z.string(), newPassword: z.string() }),
    async ({ currentPassword, newPassword }, ctx) => {
      const user = await requirePassword(ctx.db, ctx.userId, currentPassword);
      checkPassword(newPassword, user.email);
      const passwordHash = await hashPassword(newPassword);
      ctx.db.update(users).set({ passwordHash }).where(eq(users.id, ctx.userId)).run();
    },
  ),

  // G4.7: cascades remove the rest (enrollments, marks, plans, to-dos, notifications…).
  // G4: a copy of everything UniLink keeps about you, as JSON, before (or instead of) deleting it.
  exportData: procedure(z.void(), async (_input, ctx) => {
    const target = await ctx.platform.chooseSaveLocation({
      title: 'Download my data',
      defaultPath: 'unilink-my-data.json',
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (!target) return null;
    await writeFile(target, JSON.stringify(collectMyData(ctx.db, ctx.userId), null, 2), 'utf8');
    return { path: target };
  }),

  deleteAccount: procedure(z.object({ password: z.string(), keepPosts: z.boolean() }), async ({ password, keepPosts }, ctx) => {
    await requirePassword(ctx.db, ctx.userId, password);
    await deleteUserFiles(ctx.db, ctx.userId);
    ctx.db.transaction((tx) => keepSharedContributions({ ...ctx, db: tx as unknown as DB }, keepPosts));
    const userId = ctx.userId;
    endSession(ctx);
    ctx.db.delete(users).where(eq(users.id, userId)).run();
  }),
};
