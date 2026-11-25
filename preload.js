const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getState: () => ipcRenderer.invoke('state:get'),
  addSlot: () => ipcRenderer.invoke('slot:add'),
  removeSlot: (id) => ipcRenderer.invoke('slot:remove', { id }),
  createProject: (id, name) => ipcRenderer.invoke('project:createNew', { id, name }),
  loadProject: (id, folder) => ipcRenderer.invoke('project:loadExisting', { id, folder }),
  pickFolder: (defaultPath) => ipcRenderer.invoke('dialog:pickFolder', { defaultPath }),

  getPrompts: () => ipcRenderer.invoke('prompts:get'),
  savePrompts: (data) => ipcRenderer.invoke('prompts:save', data),
  resetPrompts: () => ipcRenderer.invoke('prompts:reset'),

  getEnv: () => ipcRenderer.invoke('env:get'),
  saveEnv: (text) => ipcRenderer.invoke('env:save', text),

  setActiveTab: (slotId, role) => ipcRenderer.invoke('tab:setActive', { slotId, role }),

  spawn: (id, cols, rows, cwd) => ipcRenderer.invoke('pty:spawn', { id, cols, rows, cwd }),
  write: (id, data) => ipcRenderer.send('pty:write', { id, data }),
  resize: (id, cols, rows) => ipcRenderer.send('pty:resize', { id, cols, rows }),
  onData: (cb) => ipcRenderer.on('pty:data', (_e, payload) => cb(payload)),
  onExit: (cb) => ipcRenderer.on('pty:exit', (_e, payload) => cb(payload)),

  transcribe: (arrayBuf) => ipcRenderer.invoke('voice:transcribe', arrayBuf),
  openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),
});
