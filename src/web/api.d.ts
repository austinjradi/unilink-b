import type { RpcResult } from '../main/rpc/core';

declare global {
  interface Window {
    unilink: {
      call: (path: string, input: unknown) => Promise<RpcResult>;
      // Returns an unsubscribe function.
      onNavigate: (callback: (link: string) => void) => () => void;
      // Web build only: forgets everything saved in this browser and starts over.
      addFile: (file: File) => string;
      resetDemo: () => Promise<void>;
    };
  }
}

export {};
