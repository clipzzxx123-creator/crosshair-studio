const { contextBridge, ipcRenderer } = require('electron');

const on = (channel) => (cb) => {
  const fn = (_e, payload) => cb(payload);
  ipcRenderer.on(channel, fn);
  return () => ipcRenderer.removeListener(channel, fn);
};

contextBridge.exposeInMainWorld('api', {
  isElectron: true,
  platform: process.platform,
  load: () => ipcRenderer.invoke('data:load'),
  save: (data) => ipcRenderer.invoke('data:save', data),
  listDisplays: () => ipcRenderer.invoke('displays:list'),
  appInfo: () => ipcRenderer.invoke('app:info'),
  setOpenAtLogin: (on) => ipcRenderer.invoke('app:setOpenAtLogin', on),
  getUpdate: () => ipcRenderer.invoke('update:get'),
  checkUpdate: () => ipcRenderer.invoke('update:check'),
  installUpdate: () => ipcRenderer.invoke('update:install'),
  onUpdateState: on('update:state'),
  inputStatus: () => ipcRenderer.invoke('input:status'),
  requestInputAccess: () => ipcRenderer.invoke('input:requestAccess'),
  saveFile: (opts) => ipcRenderer.invoke('file:save', opts),
  scopeStatus: () => ipcRenderer.invoke('scope:status'),
  requestScreenAccess: () => ipcRenderer.invoke('scope:requestScreenAccess'),
  reportScopeError: (msg) => ipcRenderer.send('scope:error', msg),
  onDataChanged: on('data:changed'),
  onOverlayUpdate: on('overlay:update'),
  onOverlayInput: on('overlay:input'),
  onOverlayScope: on('overlay:scope'),
  onOverlayCursor: on('overlay:cursor'),
});
