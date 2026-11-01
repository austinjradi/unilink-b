import { contextBridge, ipcRenderer } from 'electron';

// The whole renderer ↔ main API is one validated RPC channel (see src/main/rpc).
contextBridge.exposeInMainWorld('unilink', {
  call: (path: string, input: unknown) => ipcRenderer.invoke('rpc', path, input),
});
