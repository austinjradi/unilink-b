import { z } from 'zod';
import { type Params, translate } from '@shared/i18n';
import type { DB } from '../db/client';

// A tiny tRPC-style layer: the renderer calls `rpc.classes.join({ classId })`, the
// preload forwards it over one IPC channel, and the main process validates the
// input with zod before running the handler. Types flow end to end from here.

// A union of string literals: a value of this type can only be
// one of these six strings, and TypeScript checks every use.
export type ErrorCode = 'BAD_INPUT' | 'UNAUTHORIZED' | 'FORBIDDEN' | 'NOT_FOUND' | 'CONFLICT' | 'INTERNAL';

// `key` is the English message (a template when there are params); the renderer
// translates it into the student's language.
// An error meant for the user. Throw it from any service;
// dispatch() turns it into an error result instead of a crash.
export class AppError extends Error {
  // `readonly key: string` in the parameter list is a parameter
  // property: it declares a field and assigns the argument to it in one
  // step. `= 'BAD_INPUT'` is a default value for when no code is passed.
  constructor(
    readonly key: string,
    readonly code: ErrorCode = 'BAD_INPUT',
    readonly params?: Params,
  ) {
    // super() runs Error's own constructor. The English text
    // becomes error.message, which is what logs and tests see.
    super(translate('en', key, params));
  }
}

// Changed in place on purpose: sign-in sets userId, sign-out sets it back to null.
export interface Session {
  userId: number | null;
}

type FileFilter = { name: string; extensions: string[] };

// Native OS integration, injected so services stay testable without Electron.
export interface Platform {
  chooseFile(options: { title: string; filters?: FileFilter[] }): Promise<string | null>;
  chooseSaveLocation(options: { title: string; defaultPath: string; filters?: FileFilter[] }): Promise<string | null>;
  openPath(path: string): Promise<void>;
  // ST2: the text of a picked document (PDF, Word or plain text), or null for kinds it can't read.
  readText(path: string): Promise<string | null>;
  // S4: a URL the page can show a stored file at.
  fileUrl(path: string): Promise<string>;
  // G3: an OS notification; clicking it opens `link` in the app.
  showNotification(n: { title: string; body: string; link: string | null }): void;
  // ST1: system-wide Do Not Disturb. Only GNOME exposes this; elsewhere it's unsupported.
  systemDndSupported(): boolean;
  setSystemDnd(on: boolean): Promise<boolean>;
}

// What every handler receives as its second argument. The
// bridge builds one per tab, and tests build one per student.
export interface Context {
  db: DB;
  session: Session;
  platform: Platform;
  isDev: boolean;
  // Folder for files the app owns (planner attachments).
  filesDir: string;
  now: () => Date;
}

// `extends` adds userId to everything in Context. Handlers made with
// procedure() get this type, so ctx.userId needs no null check.
export interface AuthedContext extends Context {
  userId: number;
}

// Generic parameters: S is the zod schema for the input, O is what the handler returns. `S extends
// z.ZodType` allows only zod schemas, and `= …` gives defaults, so a bare `Procedure` also works.
export interface Procedure<S extends z.ZodType = z.ZodType, O = unknown> {
  input: S;
  requiresAuth: boolean;
  // z.output<S> is the type a schema produces after parsing, with defaults
  // filled in. `O | Promise<O>` lets a handler be synchronous or async.
  handler: (input: z.output<S>, ctx: AuthedContext) => O | Promise<O>;
}

// An index signature: any string key, whose value is a procedure or another
// router. That nesting is what gives rpc.classes.join its two levels.
export interface Router {
  [key: string]: Procedure<z.ZodType, unknown> | Router;
}

// TypeScript infers S and O from the two arguments, so callers never write
// them out. The input type the handler sees comes straight from the schema.
export function publicProcedure<S extends z.ZodType, O>(
  input: S,
  handler: (input: z.output<S>, ctx: Context) => O | Promise<O>,
): Procedure<S, O> {
  return { input, requiresAuth: false, handler };
}

// The same, except it requires a signed-in user and the handler gets an AuthedContext.
export function procedure<S extends z.ZodType, O>(
  input: S,
  handler: (input: z.output<S>, ctx: AuthedContext) => O | Promise<O>,
): Procedure<S, O> {
  return { input, requiresAuth: true, handler };
}

// A discriminated union: both shapes have `ok`, and checking it narrows the type. After
// `if (result.ok)`, TypeScript knows `data` exists; in the else branch, `error` does.
export type RpcResult =
  | { ok: true; data: unknown }
  | { ok: false; error: { code: ErrorCode; message: string; key: string; params?: Params } };

// A mapped type: `[K in keyof R]` visits every key of a router R. `R[K]
// extends Procedure<infer S, infer O>` asks whether that entry is a procedure
// and, if so, captures its schema type as S and its output type as O.
// A procedure becomes an async function from the schema's input to
// the handler's output (Awaited unwraps a promise if the handler was
// async). Anything else is a nested router, so the type calls itself.
export type RpcClient<R> = {
  [K in keyof R]: R[K] extends Procedure<infer S, infer O>
    // If undefined is a valid input (z.void(), or a schema where everything is
    // optional), the argument is optional: `[input?: …]`. Otherwise it's required.
    ? (...args: undefined extends z.input<S> ? [input?: z.input<S>] : [input: z.input<S>]) => Promise<Awaited<O>>
    : RpcClient<R[K]>;
};

// Builds an error result. `key` keeps the English template so the renderer
// can translate it, and `message` is the English text for logs and tests.
const fail = (code: ErrorCode, message: string, params?: Params): RpcResult => ({
  ok: false,
  error: { code, message: translate('en', message, params), key: message, params },
});

// A type guard. The return type `node is Procedure` means that wherever
// this returns true, TypeScript treats node as a Procedure from then on.
function isProcedure(node: unknown): node is Procedure {
  return typeof node === 'object' && node != null && 'handler' in node;
}

// Runs one call. It never throws: every outcome, an unknown
// path or a bug included, comes back as an RpcResult.
export async function dispatch(router: Router, path: string, rawInput: unknown, ctx: Context): Promise<RpcResult> {
  // Walks the router one key at a time: 'classes.join' becomes router.classes,
  // then router.classes.join. `?.` gives undefined as soon as a key is missing.
  const node = path.split('.').reduce<unknown>((n, key) => (n as Router | undefined)?.[key], router);
  if (!isProcedure(node)) return fail('NOT_FOUND', `Unknown procedure "${path}"`);

  try {
    if (node.requiresAuth && ctx.session.userId == null) {
      throw new AppError('Your session has ended. Please sign in again.', 'UNAUTHORIZED');
    }
    // parse() validates and returns cleaned data (trimmed strings, defaults
    // filled in), or throws a ZodError that the catch below turns into BAD_INPUT.
    const input = node.input.parse(rawInput);
    // `{ ...ctx, userId }` copies ctx into a new object with userId added,
    // so handlers can't change the tab's shared ctx by accident. -1 is
    // never a real user, and only public procedures run without one.
    const data = await node.handler(input, { ...ctx, userId: ctx.session.userId ?? -1 });
    return { ok: true, data };
  } catch (err) {
    // Only the first validation problem is reported. Its
    // message is an English key, like every other error.
    if (err instanceof z.ZodError) return fail('BAD_INPUT', err.issues[0]?.message ?? 'Invalid input');
    if (err instanceof AppError) return fail(err.code, err.key, err.params);
    console.error(`[rpc] ${path} failed:`, err);
    return fail('INTERNAL', 'Something went wrong. Please try again.');
  }
}

// --- Shared input pieces -------------------------------------------------------

// Reusable schemas: ids are positive whole numbers. nonEmpty(label) is a function,
// so each use puts its own label into the messages ("Title is required").
export const idSchema = z.number().int().positive();
export const nonEmpty = (label: string, max = 200) =>
  z.string().trim().min(1, `${label} is required`).max(max, `${label} is too long`);
