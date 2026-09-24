import { contextBridge, ipcRenderer } from 'electron';
import type { EngineBridge } from '../shared/types';

const bridge: EngineBridge = {
  onStart: (cb) => ipcRenderer.on('engine:start', (_e, o) => cb(o)),
  onPause: (cb) => ipcRenderer.on('engine:pause', () => cb()),
  onResume: (cb) => ipcRenderer.on('engine:resume', () => cb()),
  onStop: (cb) => ipcRenderer.on('engine:stop', () => cb()),
  onSystemPcm: (cb) =>
    ipcRenderer.on('engine:sys-pcm', (_e, pcm: Uint8Array) => {
      // Buffer Node → ArrayBuffer indépendant
      const copy = new Uint8Array(pcm.byteLength);
      copy.set(pcm);
      cb(copy.buffer);
    }),
  segment: (s) => ipcRenderer.send('engine:segment', s),
  levels: (l) => ipcRenderer.send('engine:levels', l),
  status: (ch, ok, error) => ipcRenderer.send('engine:status', ch, ok, error),
  stopped: () => ipcRenderer.send('engine:stopped'),
  log: (msg) => ipcRenderer.send('engine:log', msg),
};

contextBridge.exposeInMainWorld('engine', bridge);
