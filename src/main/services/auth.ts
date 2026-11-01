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
import { deleteUserFiles } from './planner';
import { leaveClassSessions } from './studySessions';

// G4 in version B:
// - Passwords are passphrases: 12+ characters, no required symbols or digits, but not a
//   common password and not your own name.
// - Sign-up asks for your name, pronouns (optional), faculty and expected graduation year.
// - There's no email reset. Sign-up shows a one-time recovery code; with it you can set a
//   new password, and you get a fresh code each time it's used.
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
      if (!user || !(await verifyPassword(password, user.passwordHash))) {
        throw new AppError('Email or password is incorrect.', 'UNAUTHORIZED');
      }
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
      if (!user?.recoveryCodeHash || user.recoveryCodeHash !== hashRecoveryCode(recoveryCode)) {
        throw new AppError("That email and recovery code don't match.");
      }
      checkPassword(password, email);
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

  changeEmail: procedure(z.object({ email, password: z.string() }), async ({ email, password }, ctx) => {
    const user = await requirePassword(ctx.db, ctx.userId, password);
    if (email === user.email) return publicUser(user);
    if (ctx.db.select({ id: users.id }).from(users).where(eq(users.email, email)).get()) {
      throw new AppError('Another account already uses that email.', 'CONFLICT');
    }
    return publicUser(ctx.db.update(users).set({ email }).where(eq(users.id, ctx.userId)).returning().get());
  }),

  // A lost or used-up recovery code can be replaced while signed in.
  newRecoveryCode: procedure(z.object({ password: z.string() }), async ({ password }, ctx) => {
    await requirePassword(ctx.db, ctx.userId, password);
    return { recoveryCode: issueRecoveryCode(ctx.db, ctx.userId) };
  }),

  // G4.7: cascades remove the rest (enrollments, marks, plans, to-dos, notifications…).
  deleteAccount: procedure(z.object({ password: z.string(), keepPosts: z.boolean() }), async ({ password, keepPosts }, ctx) => {
    await requirePassword(ctx.db, ctx.userId, password);
    await deleteUserFiles(ctx.db, ctx.userId);
    ctx.db.transaction((tx) => keepSharedContributions({ ...ctx, db: tx as unknown as DB }, keepPosts));
    const userId = ctx.userId;
    endSession(ctx);
    ctx.db.delete(users).where(eq(users.id, userId)).run();
  }),
};
