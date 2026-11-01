import type { RpcResult } from '../main/rpc/core';

declare global {
  interface Window {
    unilink: {
      call: (path: string, input: unknown) => Promise<RpcResult>;
      // Returns an unsubscribe function.
      onNavigate: (callback: (link: string) => void) => () => void;
    };
  }
}

export {};
