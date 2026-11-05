import type { RpcResult } from '../main/rpc/core';

// `declare global` adds to types that exist everywhere. This merges a `unilink` property into the
// browser's own Window interface, so `window.unilink` is typed in every file without an import.
declare global {
  interface Window {
    unilink: {
      call: (path: string, input: unknown) => Promise<RpcResult>;
      // Returns an unsubscribe function.
      onNavigate: (callback: (link: string) => void) => () => void;
      // Web build only: forgets everything saved in this browser and starts over.
      addFile: (file: File) => string;
      resetDemo: () => Promise<void>;
      // Called with true when this browser isn't saving what's done here, and false once it is.
      // Returns an unsubscribe function.
      onSaveProblem: (listener: (problem: boolean) => void) => () => void;
      // Asks the browser not to clear what's saved here to free up space.
      keepData: () => Promise<void>;
      // Downloads everything saved in this browser as one file.
      downloadBackup: (passphrase?: string) => Promise<void>;
      // Replaces everything saved in this browser and reloads. false if the file isn't a backup.
      restoreBackup: (file: File, passphrase?: string) => Promise<boolean>;
    };
  }
}

// An empty export makes this file a module, which `declare global` requires.
export {};
