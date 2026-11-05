import type { Params } from '@shared/i18n';
import type { ErrorCode, RpcClient } from '../../../main/rpc/core';
import type { AppRouter } from '../../../main/rpc/router';
import { t } from './i18n';

// The main process sends the English message as a key; show it in the current language.
// What a failed call throws in React. `code` is the kind of failure (FORBIDDEN,
// CONFLICT…), and the message is already translated, so it can go straight into a toast.
export class RpcError extends Error {
  constructor(
    readonly code: ErrorCode,
    readonly key: string,
    readonly params?: Params,
  ) {
    super(t(key, params));
    // The name shown in the console, instead of plain Error.
    this.name = 'RpcError';
  }
}

// `rpc.classes.join({ classId })` becomes window.unilink.call('classes.join', { classId }).
// A Proxy is an object whose basic operations, like reading a
// property or calling it, run functions of your own (called traps).
// Here, each property read returns a new proxy with one more path segment,
// and calling one sends the call. So rpc.classes.join({ classId }) reads
// 'classes', then 'join', then calls with the path ['classes', 'join'].
function proxy(path: string[]): unknown {
  // The target is an empty function, because only a proxy
  // around a function can be called (the apply trap).
  return new Proxy(() => {}, {
    // Never look like a promise, or `await rpc.x` would try to call `.then`.
    // The get trap runs on every property read. A key can
    // also be a Symbol, which is never part of a path.
    get: (_target, key) => (typeof key === 'string' && key !== 'then' ? proxy([...path, key]) : undefined),
    // The apply trap runs when the proxy is called like a function. args[0] is the input object.
    apply: async (_target, _this, args: unknown[]) => {
      const result = await window.unilink.call(path.join('.'), args[0]);
      if (!result.ok) throw new RpcError(result.error.code, result.error.key ?? result.error.message, result.error.params);
      return result.data;
    },
  });
}

// At runtime this is just the proxy. The cast gives it the typed shape of the whole
// router, which is what makes autocomplete and type errors work in components.
export const rpc = proxy([]) as RpcClient<AppRouter>;

// Output type of a procedure, e.g. Out<typeof rpc.classes.mine>.
// ReturnType gives Promise<…>, and Awaited unwraps the promise, leaving what the call resolves to.
export type Out<F extends (...args: never[]) => Promise<unknown>> = Awaited<ReturnType<F>>;
