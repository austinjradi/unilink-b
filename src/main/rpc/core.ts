import { z } from 'zod';
import { type Params, translate } from '@shared/i18n';
import type { DB } from '../db/client';

// A tiny tRPC-style layer: the renderer calls `rpc.classes.join({ classId })`, the
// preload forwards it over one IPC channel, and the main process validates the
// input with zod before running the handler. Types flow end to end from here.

export type ErrorCode = 'BAD_INPUT' | 'UNAUTHORIZED' | 'FORBIDDEN' | 'NOT_FOUND' | 'CONFLICT' | 'INTERNAL';

// `key` is the English message (a template when there are params); the renderer
// translates it into the student's language.
export class AppError extends Error {
  constructor(
    readonly key: string,
    readonly code: ErrorCode = 'BAD_INPUT',
    readonly params?: Params,
  ) {
    super(translate('en', key, params));
  }
}

export interface Session {
  userId: number | null;
}

type FileFilter = { name: string; extensions: string[] };

// Native OS integration, injected so services stay testable without Electron.
export interface Platform {
  chooseFile(options: { title: string; filters?: FileFilter[] }): Promise<string | null>;
  chooseSaveLocation(options: { title: string; defaultPath: string; filters?: FileFilter[] }): Promise<string | null>;
  openPath(path: string): Promise<void>;
  // ST2: the text of a picked document (PDF or plain text), or null for kinds it can't read.
  readText(path: string): Promise<string | null>;
  // S4: a URL the page can show a stored file at.
  fileUrl(path: string): Promise<string>;
  // G3: an OS notification; clicking it opens `link` in the app.
  showNotification(n: { title: string; body: string; link: string | null }): void;
  // ST1: system-wide Do Not Disturb. Only GNOME exposes this; elsewhere it's unsupported.
  systemDndSupported(): boolean;
  setSystemDnd(on: boolean): Promise<boolean>;
}

export interface Context {
  db: DB;
  session: Session;
  platform: Platform;
  isDev: boolean;
  // Folder for files the app owns (planner attachments).
  filesDir: string;
  now: () => Date;
}

export interface AuthedContext extends Context {
  userId: number;
}

export interface Procedure<S extends z.ZodType = z.ZodType, O = unknown> {
  input: S;
  requiresAuth: boolean;
  handler: (input: z.output<S>, ctx: AuthedContext) => O | Promise<O>;
}

export interface Router {
  [key: string]: Procedure<z.ZodType, unknown> | Router;
}

export function publicProcedure<S extends z.ZodType, O>(
  input: S,
  handler: (input: z.output<S>, ctx: Context) => O | Promise<O>,
): Procedure<S, O> {
  return { input, requiresAuth: false, handler };
}

export function procedure<S extends z.ZodType, O>(
  input: S,
  handler: (input: z.output<S>, ctx: AuthedContext) => O | Promise<O>,
): Procedure<S, O> {
  return { input, requiresAuth: true, handler };
}

export type RpcResult =
  | { ok: true; data: unknown }
  | { ok: false; error: { code: ErrorCode; message: string; key: string; params?: Params } };

export type RpcClient<R> = {
  [K in keyof R]: R[K] extends Procedure<infer S, infer O>
    ? (...args: undefined extends z.input<S> ? [input?: z.input<S>] : [input: z.input<S>]) => Promise<Awaited<O>>
    : RpcClient<R[K]>;
};

const fail = (code: ErrorCode, message: string, params?: Params): RpcResult => ({
  ok: false,
  error: { code, message: translate('en', message, params), key: message, params },
});

function isProcedure(node: unknown): node is Procedure {
  return typeof node === 'object' && node != null && 'handler' in node;
}

export async function dispatch(router: Router, path: string, rawInput: unknown, ctx: Context): Promise<RpcResult> {
  const node = path.split('.').reduce<unknown>((n, key) => (n as Router | undefined)?.[key], router);
  if (!isProcedure(node)) return fail('NOT_FOUND', `Unknown procedure "${path}"`);

  try {
    if (node.requiresAuth && ctx.session.userId == null) {
      throw new AppError('Your session has ended. Please sign in again.', 'UNAUTHORIZED');
    }
    const input = node.input.parse(rawInput);
    const data = await node.handler(input, { ...ctx, userId: ctx.session.userId ?? -1 });
    return { ok: true, data };
  } catch (err) {
    if (err instanceof z.ZodError) return fail('BAD_INPUT', err.issues[0]?.message ?? 'Invalid input');
    if (err instanceof AppError) return fail(err.code, err.key, err.params);
    console.error(`[rpc] ${path} failed:`, err);
    return fail('INTERNAL', 'Something went wrong. Please try again.');
  }
}

// --- Shared input pieces -------------------------------------------------------

export const idSchema = z.number().int().positive();
export const nonEmpty = (label: string, max = 200) =>
  z.string().trim().min(1, `${label} is required`).max(max, `${label} is too long`);
