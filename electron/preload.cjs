// Bridge between the sandboxed renderer and the main process.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('native', {
  openDialog: (opts) => ipcRenderer.invoke('dialog:open', opts),
  saveDialog: (opts) => ipcRenderer.invoke('dialog:save', opts),
  readFile: (file) => ipcRenderer.invoke('fs:read', file),
  writeFile: (file, data) => ipcRenderer.invoke('fs:write', file, data),
  getRecent: () => ipcRenderer.invoke('recent:get'),
  addRecent: (file) => ipcRenderer.invoke('recent:add', file),
  clearRecent: () => ipcRenderer.invoke('recent:clear'),
  info: () => ipcRenderer.invoke('app:info'),
  writeRecovery: (data, meta) => ipcRenderer.invoke('recovery:write', data, meta),
  readRecovery: () => ipcRenderer.invoke('recovery:read'),
  clearRecovery: () => ipcRenderer.invoke('recovery:clear'),
  ready: () => ipcRenderer.send('app:ready'),
  setDirty: (dirty) => ipcRenderer.send('app:dirty', dirty),
  setTitle: (title) => ipcRenderer.send('app:title', title),
  setRepresentedFile: (file) => ipcRenderer.send('app:represented', file),
  closeConfirmed: () => ipcRenderer.send('app:close-confirmed'),
  showInFolder: (file) => ipcRenderer.send('shell:show', file),
  openUrl: (url) => ipcRenderer.send('shell:open-url', url),
  onMenu: (cb) => ipcRenderer.on('menu', (_e, command, arg) => cb(command, arg)),
  onOpenPath: (cb) => ipcRenderer.on('open-path', (_e, file) => cb(file)),
  pathSep: process.platform === 'win32' ? '\\' : '/',
  platform: process.platform,
});
