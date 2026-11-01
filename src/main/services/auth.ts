import { and, desc, eq, gt, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { GOAT_OPTIONS, type GoatPart, isGoatConfig } from '@shared/goat';
import { LOCALES, translate } from '@shared/i18n';
import { MCGILL_EMAIL, passwordProblems } from '@shared/validation';
import { randomHex, randomInt, scryptHex, sha256Hex as sha256, timingSafeEqualHex } from '../crypto';
import type { DB } from '../db/client';
import { DEMO_PASSWORD, DEMO_USERS } from '../db/demo';
import { appState, authSessions, passwordResets, users } from '../db/schema';
import { AppError, type Context, nonEmpty, procedure, publicProcedure } from '../rpc/core';
import { sendEmail } from './notifications';
import { deleteUserFiles } from './planner';

// G4: sign up, log in/out, password reset, profile, delete account.

const SESSION_KEY = 'session_token';
const RESET_TTL_MS = 15 * 60_000;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomHex(16);
  return `scrypt:${salt}:${await scryptHex(password, salt, 64)}`;
}

async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [, saltHex, keyHex] = stored.split(':');
  return timingSafeEqualHex(await scryptHex(password, saltHex, keyHex.length / 2), keyHex);
}

const email = z
  .string()
  .trim()
  .toLowerCase()
  .regex(MCGILL_EMAIL, 'Use your McGill email (@mail.mcgill.ca or @mcgill.ca)');

const newPassword = z.string().superRefine((pw, ctx) => {
  const problems = passwordProblems(pw);
  if (problems.length) ctx.addIssue({ code: 'custom', message: 'Password needs at least 8 characters, a letter and a number' });
});

export function publicUser(user: typeof users.$inferSelect) {
  const { passwordHash: _, ...rest } = user;
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

export const authRouter = {
  // Dev builds come with demo classmates (see db/demo.ts); the sign-in screen lists them.
  devInfo: publicProcedure(z.void(), (_input, ctx) =>
    ctx.isDev ? { emails: DEMO_USERS.map((u) => u.email), password: DEMO_PASSWORD } : null,
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

  signUp: publicProcedure(
    z.object({ name: nonEmpty('Name', 100), email, password: newPassword, locale: z.enum(LOCALES).default('en') }),
    async ({ name, email, password, locale }, ctx) => {
      if (ctx.db.select().from(users).where(eq(users.email, email)).get()) {
        throw new AppError('An account with this email already exists. Try signing in.', 'CONFLICT');
      }
      const user = ctx.db
        .insert(users)
        .values({ name, email, locale, passwordHash: await hashPassword(password) })
        .returning()
        .get();
      startSession(ctx, user.id);
      return publicUser(user);
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

  // Always "succeeds" so the form doesn't reveal which emails have accounts.
  // Email delivery (G3) isn't built yet, so dev builds hand the code back directly.
  requestPasswordReset: publicProcedure(z.object({ email: z.string().trim().toLowerCase() }), ({ email }, ctx) => {
    const user = ctx.db.select().from(users).where(eq(users.email, email)).get();
    if (!user) return { devCode: null };
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    ctx.db
      .insert(passwordResets)
      .values({ userId: user.id, codeHash: sha256(code), expiresAt: new Date(ctx.now().getTime() + RESET_TTL_MS) })
      .run();
    sendEmail(ctx.db, {
      userId: user.id,
      to: user.email,
      locale: user.locale,
      subject: translate(user.locale, 'Your UniLink password reset code'),
      body: translate(user.locale, "Your code is {{code}}. It expires in 15 minutes. If you didn't ask to reset your password, ignore this email.", { code }),
    });
    return { devCode: ctx.isDev ? code : null };
  }),

  resetPassword: publicProcedure(
    z.object({ email: z.string().trim().toLowerCase(), code: z.string().trim(), password: newPassword }),
    async ({ email, code, password }, ctx) => {
      const user = ctx.db.select().from(users).where(eq(users.email, email)).get();
      const reset =
        user &&
        ctx.db
          .select()
          .from(passwordResets)
          .where(
            and(
              eq(passwordResets.userId, user.id),
              isNull(passwordResets.usedAt),
              gt(passwordResets.expiresAt, ctx.now()),
            ),
          )
          .orderBy(desc(passwordResets.id))
          .get();
      if (!user || !reset || reset.codeHash !== sha256(code)) {
        throw new AppError('That code is invalid or has expired. Request a new one.');
      }
      const passwordHash = await hashPassword(password);
      ctx.db.transaction((tx) => {
        tx.update(users).set({ passwordHash }).where(eq(users.id, user.id)).run();
        tx.update(passwordResets).set({ usedAt: ctx.now() }).where(eq(passwordResets.id, reset.id)).run();
        tx.delete(authSessions).where(eq(authSessions.userId, user.id)).run();
      });
    },
  ),
};

export const profileRouter = {
  update: procedure(
    z.object({
      name: nonEmpty('Name', 100),
      program: z.string().trim().max(100),
      year: z.number().int().min(1).max(8).nullable(),
      studyMinutesPerDay: z.number().int().min(15, 'Plan at least 15 minutes a day').max(16 * 60),
    }),
    (input, ctx) => publicUser(ctx.db.update(users).set(input).where(eq(users.id, ctx.userId)).returning().get()),
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
    z.object({ currentPassword: z.string(), newPassword }),
    async ({ currentPassword, newPassword }, ctx) => {
      await requirePassword(ctx.db, ctx.userId, currentPassword);
      const passwordHash = await hashPassword(newPassword);
      ctx.db.update(users).set({ passwordHash }).where(eq(users.id, ctx.userId)).run();
    },
  ),

  // Cascades remove everything the user created: enrollments, links, posts, plans…
  deleteAccount: procedure(z.object({ password: z.string() }), async ({ password }, ctx) => {
    await requirePassword(ctx.db, ctx.userId, password);
    await deleteUserFiles(ctx.db, ctx.userId);
    endSession(ctx);
    ctx.db.delete(users).where(eq(users.id, ctx.userId)).run();
  }),
};
