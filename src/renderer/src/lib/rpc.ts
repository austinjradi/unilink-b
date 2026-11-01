import type { Params } from '@shared/i18n';
import type { ErrorCode, RpcClient } from '../../../main/rpc/core';
import type { AppRouter } from '../../../main/rpc/router';
import { t } from './i18n';

// The main process sends the English message as a key; show it in the current language.
export class RpcError extends Error {
  constructor(
    readonly code: ErrorCode,
    readonly key: string,
    readonly params?: Params,
  ) {
    super(t(key, params));
    this.name = 'RpcError';
  }
}

// `rpc.classes.join({ classId })` becomes window.unilink.call('classes.join', { classId }).
function proxy(path: string[]): unknown {
  return new Proxy(() => {}, {
    // Never look like a promise, or `await rpc.x` would try to call `.then`.
    get: (_target, key) => (typeof key === 'string' && key !== 'then' ? proxy([...path, key]) : undefined),
    apply: async (_target, _this, args: unknown[]) => {
      const result = await window.unilink.call(path.join('.'), args[0]);
      if (!result.ok) throw new RpcError(result.error.code, result.error.key ?? result.error.message, result.error.params);
      return result.data;
    },
  });
}

export const rpc = proxy([]) as RpcClient<AppRouter>;

// Output type of a procedure, e.g. Out<typeof rpc.classes.mine>.
export type Out<F extends (...args: never[]) => Promise<unknown>> = Awaited<ReturnType<F>>;
