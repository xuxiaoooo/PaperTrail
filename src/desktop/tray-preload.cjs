const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('papertrailTray',Object.freeze({
  state:()=>ipcRenderer.invoke('tray:state'),refresh:()=>ipcRenderer.invoke('tray:refresh'),
  open:()=>ipcRenderer.send('tray:open'),quit:()=>ipcRenderer.send('tray:quit'),
  onState:callback=>ipcRenderer.on('tray:state',(_event,state)=>callback(state))
}));
