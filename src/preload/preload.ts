import { contextBridge, ipcRenderer } from 'electron';
import type { MinuteAPI } from '../shared/types';

const invoke = (channel: string, ...args: unknown[]) => ipcRenderer.invoke(channel, ...args);

const api: MinuteAPI = {
  info: () => invoke('info'),
  settings: {
    get: () => invoke('settings:get'),
    set: (patch) => invoke('settings:set', patch),
    chooseStorageDir: () => invoke('settings:chooseStorageDir'),
  },
  secrets: {
    status: () => invoke('secrets:status'),
    set: (name, value) => invoke('secrets:set', name, value),
    test: (name) => invoke('secrets:test', name),
    listModels: (p) => invoke('secrets:listModels', p),
  },
  meetings: {
    list: () => invoke('meetings:list'),
    get: (id) => invoke('meetings:get', id),
    update: (id, patch) => invoke('meetings:update', id, patch),
    remove: (id) => invoke('meetings:remove', id),
    trash: (id) => invoke('meetings:trash', id),
    restore: (id) => invoke('meetings:restore', id),
    purge: (id) => invoke('meetings:purge', id),
    emptyTrash: () => invoke('meetings:emptyTrash'),
    merge: (a, b) => invoke('meetings:merge', a, b),
    split: (id, segId) => invoke('meetings:split', id, segId),
    editSegment: (id, segId, text) => invoke('meetings:editSegment', id, segId, text),
    deleteSegment: (id, segId) => invoke('meetings:deleteSegment', id, segId),
    reveal: (id) => invoke('meetings:reveal', id),
    exportTo: (id, format) => invoke('meetings:export', id, format),
    copy: (id, opts) => invoke('meetings:copy', id, opts),
    search: (q) => invoke('meetings:search', q),
    retryPending: (id) => invoke('meetings:retry', id),
  },
  recorder: {
    state: () => invoke('recorder:state'),
    start: (opts) => invoke('recorder:start', opts),
    stop: () => invoke('recorder:stop'),
    pause: () => invoke('recorder:pause'),
    resume: () => invoke('recorder:resume'),
    bookmark: (label) => invoke('recorder:bookmark', label),
  },
  ai: {
    run: (req) => invoke('ai:run', req),
    cancel: (id) => invoke('ai:cancel', id),
  },
  windows: {
    toggleCompact: () => invoke('compact:toggle'),
    enterCompact: () => invoke('compact:enter'),
    exitCompact: (opts) => invoke('compact:exit', opts),
    setCompactShape: (shape) => invoke('compact:shape', shape),
    compactLayout: () => invoke('compact:layout'),
    compactDrag: (phase, x, y, vx, vy) => ipcRenderer.send('compact:drag', phase, x, y, vx, vy),
    compactResize: (phase, dx, dy, corner) => ipcRenderer.send('compact:resize', phase, dx, dy, corner),
    compactAck: () => ipcRenderer.send('compact:ack'),
    compactFocus: (on) => ipcRenderer.send('compact:focus', on),
    showMain: (id) => invoke('windows:showMain', id),
    openSettings: (section) => invoke('windows:settings', section),
    openExternal: (url) => invoke('windows:openExternal', url),
    openPrivacySettings: (kind) => invoke('windows:privacy', kind),
  },
  diag: {
    report: (input) => invoke('diag:report', input),
  },
  updates: {
    state: () => invoke('updates:state'),
    check: () => invoke('updates:check'),
    install: () => invoke('updates:install'),
  },
  local: {
    status: () => invoke('local:status'),
    install: (model) => invoke('local:install', model),
    remove: (model) => invoke('local:remove', model),
    llm: () => invoke('local:llm'),
    notice: () => invoke('privacy:notice'),
  },
  calendar: {
    state: () => invoke('calendar:state'),
    refresh: () => invoke('calendar:refresh'),
    test: (url) => invoke('calendar:test', url),
    connectGoogle: () => invoke('calendar:connectGoogle'),
    disconnect: (url) => invoke('calendar:disconnect', url),
    googleClient: () => invoke('calendar:googleClient'),
    setGoogleClient: (id, secret) => invoke('calendar:setGoogleClient', id, secret),
  },
  vocabulary: {
    suggestions: () => invoke('vocabulary:suggestions'),
  },
  natively: {
    detect: () => invoke('natively:detect'),
    importAll: () => invoke('natively:import'),
  },
  audioUrl: (meetingId, file) => `minute-audio://m/${encodeURIComponent(meetingId)}/${encodeURIComponent(file)}`,
  on: ((event: string, cb: (payload: unknown) => void) => {
    const listener = (_e: Electron.IpcRendererEvent, payload: unknown) => cb(payload);
    ipcRenderer.on(event, listener);
    return () => ipcRenderer.removeListener(event, listener);
  }) as MinuteAPI['on'],
};

contextBridge.exposeInMainWorld('minute', api);
