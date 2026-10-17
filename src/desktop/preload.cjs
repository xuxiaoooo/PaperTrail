const {contextBridge, ipcRenderer} = require('electron');
contextBridge.exposeInMainWorld('papertrail', Object.freeze({
  info: () => ipcRenderer.invoke('desktop:info'),
  preferences: value => ipcRenderer.invoke('desktop:preferences', value),
  backup: () => ipcRenderer.invoke('desktop:backup'),
  restore: () => ipcRenderer.invoke('desktop:restore'),
  checkUpdates: () => ipcRenderer.invoke('desktop:updates'),
  openDataFolder: () => ipcRenderer.invoke('desktop:open-data'),
  onAction: callback => ipcRenderer.on('desktop:action', (_event, action) => callback(action)),
}));
