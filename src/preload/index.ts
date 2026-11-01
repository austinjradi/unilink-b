import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';

// The whole renderer ↔ main API is one validated RPC channel (see src/main/rpc),
// plus a "navigate" event for clicks on desktop notifications.
contextBridge.exposeInMainWorld('unilink', {
  call: (path: string, input: unknown) => ipcRenderer.invoke('rpc', path, input),
  onNavigate: (callback: (link: string) => void) => {
    const listener = (_event: IpcRendererEvent, link: unknown) => {
      if (typeof link === 'string' && link.startsWith('/')) callback(link);
    };
    ipcRenderer.on('navigate', listener);
    return () => ipcRenderer.removeListener('navigate', listener);
  },
});
