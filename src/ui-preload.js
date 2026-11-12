'use strict';

// Bridge between the top bar (src/ui) and the main process.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('bb', {
  onState: (fn) => ipcRenderer.on('ui:state', (_e, s) => fn(s)),
  ready: () => ipcRenderer.send('ui:ready'),
  next: () => ipcRenderer.send('ui:nav', 'next'),
  prev: () => ipcRenderer.send('ui:nav', 'prev'),
  select: (i) => ipcRenderer.send('ui:select', i),
  mute: () => ipcRenderer.send('ui:mute'),
  login: () => ipcRenderer.send('ui:login'),
  sites: () => ipcRenderer.send('ui:sites'),
  reload: () => ipcRenderer.send('ui:reload'),
  importCookies: () => ipcRenderer.send('ui:import-cookies'),
  setupNext: () => ipcRenderer.send('ui:setup-next'),
  setupBack: () => ipcRenderer.send('ui:setup-back'),
  setupFinish: () => ipcRenderer.send('ui:setup-finish'),
});
