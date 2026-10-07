'use strict';
const {app,BrowserWindow,Menu,Tray,nativeImage,protocol,net,dialog,ipcMain,shell,screen} = require('electron');
const {spawn} = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const readline = require('node:readline');
const {releaseFor,displayVersion} = require('./update.cjs');
const brand=require('./brand.cjs');
const {dataPath:resolveDataPath}=require('./data-path.cjs');
const {mainSize,popupBounds}=require('./window-layout.cjs');
const {componentsReady,componentCacheDirectory} = require(app.isPackaged?path.join(process.resourcesPath,'src/desktop/browser-components.cjs'):'./browser-components.cjs');

protocol.registerSchemesAsPrivileged([{scheme:'papertrail',privileges:{standard:true,secure:true,supportFetchAPI:true,stream:true}}]);
const project = path.resolve(__dirname,'../..');
const target = process.platform==='darwin'?'macos-arm64':'windows-x64';
const resources = app.isPackaged?process.resourcesPath:project;
const runtime = app.isPackaged?path.join(resources,'runtime'):path.join(project,'build/runtime',target);
const source = app.isPackaged?path.join(resources,'src'):path.join(project,'src');
const assets = app.isPackaged?path.join(resources,'assets'):path.join(project,'assets');
const dataPath=resolveDataPath({appData:app.getPath('appData'),localAppData:process.env.LOCALAPPDATA,
  override:process.env.PAPERTRAIL_TEST_DATA_DIR});
app.setPath('userData',dataPath);
app.setName(brand.name);
const componentCache=componentCacheDirectory({runtime,dataPath,packaged:app.isPackaged,override:process.env.PAPERTRAIL_TEST_COMPONENTS_DIR});
if(process.platform==='win32') app.setAppUserModelId(brand.appId);
const singleInstance = app.requestSingleInstanceLock();
let window, popup, tray, backend, backendBase, quitting=false, stopped=false, mainClosing=false, trayTimer, trayRefresh, lastWindowBounds;
let restartCount=0;
let componentInstaller;
const token=crypto.randomBytes(32).toString('base64url');
const configPath=path.join(dataPath,'desktop-settings.json');
const defaults={keepRunning:true,startAtLogin:false};
function readConfig(){try{return {...defaults,...JSON.parse(fs.readFileSync(configPath,'utf8'))};}catch{return {...defaults};}}
let preferences=readConfig();
function saveConfig(){fs.mkdirSync(dataPath,{recursive:true});fs.writeFileSync(configPath,JSON.stringify(preferences,null,2),{mode:0o600});}
function log(message){fs.mkdirSync(path.join(dataPath,'logs'),{recursive:true});fs.appendFileSync(path.join(dataPath,'logs/desktop.log'),`${new Date().toISOString()} ${message}\n`);}
function syncDock(){if(process.platform==='darwin')app.setActivationPolicy(
  window&&!window.isDestroyed()&&window.isVisible()?'regular':'accessory');}
function closePopup(){clearInterval(trayTimer);trayTimer=null;if(popup&&!popup.isDestroyed())popup.destroy();popup=null;}
async function showWindow(){
  closePopup();
  if(!window||window.isDestroyed())await createWindow();
  if(window.isMinimized())window.restore();window.show();syncDock();window.focus();
}
async function action(name){await showWindow();window?.webContents.send('desktop:action',name);}
async function api(endpoint,body,timeout=30000){
  if(!backendBase)throw new Error('后台尚未就绪，请稍候');
  const response=await fetch(backendBase+endpoint,{method:body===undefined?'GET':'POST',
    headers:{'X-PaperTrail-Token':token,'Content-Type':'application/json'},
    body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(timeout)});
  const value=await response.json();if(!response.ok)throw new Error(value.error||'操作未完成');return value;
}
function startBackend(){return new Promise((resolve,reject)=>{
  const python=process.platform==='darwin'?path.join(runtime,'python/bin/python3'):path.join(runtime,'python/python.exe');
  const node=process.platform==='darwin'?path.join(runtime,'node/bin/node'):path.join(runtime,'node/node.exe');
  if(!fs.existsSync(python)||!fs.existsSync(node))return reject(new Error('运行组件缺失，请重新安装完整安装包。'));
  const env={...process.env,PAPERTRAIL_DATA_DIR:dataPath,PAPERTRAIL_SESSION_TOKEN:token,
    PAPERTRAIL_NODE:node,PAPERTRAIL_BROWSER_MODULE:path.join(runtime,'browser-module/playwright-core/index.mjs'),
    PAPERTRAIL_KEYCHAIN_HELPER:path.join(runtime,'keychain-helper'),
    PAPERTRAIL_TIMEZONE:Intl.DateTimeFormat().resolvedOptions().timeZone,
    PLAYWRIGHT_BROWSERS_PATH:componentCache,PYTHONTZPATH:path.join(runtime,'tzdata/zoneinfo'),
    PYTHONUTF8:'1',PYTHONUNBUFFERED:'1',PYTHONDONTWRITEBYTECODE:'1'};
  delete env.PYTHONHOME;delete env.PYTHONPATH;
  const child=spawn(python,['-B','-c','import sys,runpy,os; script=sys.argv.pop(1); sys.path.insert(0,os.path.dirname(script)); runpy.run_path(script,run_name="__main__")',path.join(source,'backend/server.py'),'--port','0'],{
    cwd:path.join(source,'backend'),env,stdio:['ignore','pipe','pipe'],windowsHide:true,detached:process.platform!=='win32'});
  backend=child;
  let ready=false;
  const timeout=setTimeout(()=>{child.kill();reject(new Error('后台启动超时，请重新打开PaperTrail。'));},25000);
  readline.createInterface({input:child.stdout}).on('line',line=>{
    try{const event=JSON.parse(line);if(event.type==='ready'&&Number.isInteger(event.port)){
      ready=true;clearTimeout(timeout);backendBase='http://127.0.0.1:'+event.port;resolve();
    }}catch{/* Only the readiness event is used. */}
  });
  child.stderr.on('data',data=>log('backend: '+String(data).slice(0,8000)));
  child.on('error',error=>{clearTimeout(timeout);reject(error);});
  child.on('exit',()=>{
    clearTimeout(timeout);
    if(!ready)return reject(new Error('后台未能启动，请查看应用数据目录中的日志。'));
    if(quitting)return;
    backendBase=null;
    if(restartCount++<1)startBackend().then(()=>{window?.reload();popup?.reload();}).catch(error=>dialog.showErrorBox(brand.name,error.message));
    else dialog.showErrorBox('后台已停止','请退出并重新打开PaperTrail。已保存的稿件保留在本机。');
  });
});}
async function stopBackend(){
  if(stopped)return;stopped=true;
  closePopup();
  if(componentInstaller&&componentInstaller.exitCode===null){
    if(process.platform==='win32')await new Promise(resolve=>spawn('taskkill',['/pid',String(componentInstaller.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'}).once('exit',resolve));
    else {try{process.kill(-componentInstaller.pid,'SIGTERM');}catch{componentInstaller.kill();}}
  }
  const child=backend;
  if(!child || child.exitCode!==null)return;
  try{await api('/api/shutdown',{});}catch{}
  await Promise.race([new Promise(resolve=>child.once('exit',resolve)),new Promise(resolve=>setTimeout(resolve,10000))]);
  if(child.exitCode===null){
    if(process.platform==='win32')await new Promise(resolve=>spawn('taskkill',['/pid',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'}).once('exit',resolve));
    else {try{process.kill(-child.pid,'SIGTERM');}catch{child.kill('SIGTERM');}}
  }
}
function allowExternal(url){try{return new URL(url).protocol==='https:';}catch{return false;}}
function createWindow(setup=false){
  mainClosing=false;
  const area=screen.getPrimaryDisplay().bounds;
  const size=setup?{width:480,height:380}:mainSize(area);
  window=new BrowserWindow({...size,...(!setup&&lastWindowBounds?lastWindowBounds:{}),minWidth:320,minHeight:400,show:false,
    title:brand.name+' · Manuscripts',backgroundColor:'#f6f5f2',icon:path.join(assets,'icon.png'),
    ...(process.platform==='darwin'?{titleBarStyle:'hiddenInset',trafficLightPosition:{x:12,y:13}}:{}),
    ...(process.platform==='win32'?{titleBarStyle:'hidden',titleBarOverlay:{color:'#ffffff',symbolColor:'#354a3d',height:42},autoHideMenuBar:true}:{}),
    webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true,backgroundThrottling:true}});
  window.once('ready-to-show',()=>{window.show();syncDock();});
  window.on('close',()=>{mainClosing=true;lastWindowBounds=window.getBounds();});
  window.on('closed',()=>{window=null;syncDock();});
  window.on('show',syncDock);window.on('hide',syncDock);
  window.webContents.setWindowOpenHandler(({url})=>{if(allowExternal(url))shell.openExternal(url);return {action:'deny'};});
  window.webContents.on('will-navigate',(event,url)=>{if(!url.startsWith('papertrail://app/')){event.preventDefault();if(allowExternal(url))shell.openExternal(url);}});
  window.webContents.on('render-process-gone',()=>{if(!quitting)window.reload();});
  return setup?window.loadFile(path.join(__dirname,'setup.html')):window.loadURL('papertrail://app/');
}
async function prepareComponents(){
  if(componentsReady(path.join(runtime,'browser-module/playwright-core'),componentCache))return;
  await createWindow(true);
  while(!quitting){
    try{
      await new Promise((resolve,reject)=>{
        const node=process.platform==='darwin'?path.join(runtime,'node/bin/node'):path.join(runtime,'node/node.exe');
        const child=spawn(node,[path.join(source,'desktop/install-components.cjs'),componentCache],{
          windowsHide:true,detached:process.platform!=='win32',stdio:['ignore','pipe','pipe']});
        componentInstaller=child;
        readline.createInterface({input:child.stdout}).on('line',line=>{
          try{const event=JSON.parse(line);if(!window?.isDestroyed())window?.webContents.send('desktop:setup-progress',event);}catch{}
        });
        child.stderr.on('data',data=>log('components: '+String(data).slice(0,4000)));
        child.on('error',reject);
        child.on('exit',code=>{componentInstaller=null;code===0?resolve():reject(new Error('请检查网络连接。已完成的组件会保留，重试会继续准备。'));});
      });
      return;
    }catch(error){
      if(quitting)return;
      const choice=await dialog.showMessageBox(window,{type:'warning',buttons:['重试','退出'],defaultId:0,cancelId:1,
        message:'组件下载未完成',detail:error.message});
      if(choice.response!==0){app.quit();return;}
    }
  }
}
function createMenus(){
  const applicationMenu=[{label:brand.name,submenu:[{label:'关于 '+brand.name,click:()=>action('about')},{label:'设置',accelerator:'CmdOrCtrl+,',click:()=>action('settings')},{type:'separator'},{label:'退出 '+brand.name,accelerator:'CmdOrCtrl+Q',click:()=>app.quit()}]},
    {label:'编辑',submenu:[{role:'undo'},{role:'redo'},{type:'separator'},{role:'cut'},{role:'copy'},{role:'paste'},{role:'selectAll'}]},
    {label:'窗口',submenu:[{role:'minimize'},{id:'show-main',label:'显示主窗口',click:showWindow},{role:'togglefullscreen'}]},
    {label:'帮助',submenu:[{label:'备份与恢复',click:()=>action('profile')},{label:'检查更新',click:()=>checkUpdates()},{label:'打开数据目录',click:()=>shell.openPath(dataPath)}]}];
  if(!app.isPackaged)applicationMenu[2].submenu.push({role:'toggleDevTools'});
  Menu.setApplicationMenu(Menu.buildFromTemplate(applicationMenu));
  if(process.platform==='win32')for(const current of BrowserWindow.getAllWindows())current.setMenuBarVisibility(false);
  const trayImage=process.platform==='darwin'?nativeImage.createFromPath(path.join(assets,'trayTemplate.png')):
    nativeImage.createFromPath(path.join(assets,'icon.png')).resize({width:20,height:20});
  if(process.platform==='darwin')trayImage.setTemplateImage(true);
  tray=new Tray(trayImage);tray.setToolTip(brand.name);
  tray.on('click',()=>toggleTrayPopup());tray.on('right-click',()=>toggleTrayPopup());
}
function trayPopupBounds(height){
  const anchor=tray.getBounds();
  const display=anchor.width>0&&anchor.height>0?
    screen.getDisplayNearestPoint({x:anchor.x+anchor.width/2,y:anchor.y+anchor.height/2}):screen.getPrimaryDisplay();
  return popupBounds(anchor,display.workArea,height);
}
async function updateTray(){
  const state=await api('/api/overview');
  if(popup&&!popup.isDestroyed()){
    const height=Math.min(520,Math.max(190,state.manuscripts.length*84+114));
    popup.setBounds(trayPopupBounds(height));popup.webContents.send('tray:state',state);
  }
  return state;
}
async function toggleTrayPopup(){
  if(popup&&!popup.isDestroyed()){closePopup();return;}
  popup=new BrowserWindow({...trayPopupBounds(220),show:false,frame:false,resizable:false,movable:false,
    minimizable:false,maximizable:false,fullscreenable:false,skipTaskbar:true,alwaysOnTop:true,hasShadow:true,
    ...(process.platform==='darwin'?{type:'panel'}:{}),title:brand.name+' · Overview',backgroundColor:'#ffffff',
    webPreferences:{preload:path.join(__dirname,'tray-preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
  const current=popup;
  current.on('blur',closePopup);
  current.on('closed',()=>{if(popup===current)popup=null;clearInterval(trayTimer);trayTimer=null;syncDock();});
  current.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  current.webContents.on('will-navigate',(event,url)=>{if(url!=='papertrail://app/tray.html')event.preventDefault();});
  current.once('ready-to-show',async()=>{
    try{await updateTray();}catch{}
    if(current.isDestroyed())return;
    current.show();current.focus();syncDock();
    trayTimer=setInterval(()=>updateTray().catch(()=>{}),10000);
  });
  try{await current.loadURL('papertrail://app/tray.html');}
  catch(error){if(!current.isDestroyed()){log('popover: '+error.message);closePopup();}}
}
async function refreshFromTray(){
  if(trayRefresh)return trayRefresh;
  trayRefresh=(async()=>{
    try{return await api('/api/refresh',{},420000);}catch(error){return {error:error.message};}
    finally{trayRefresh=null;await updateTray().catch(()=>{});window?.webContents.send('desktop:action','reload');}
  })();
  return trayRefresh;
}
async function backupData(){
  const chosen=await dialog.showSaveDialog(window,{title:'备份稿件和设置',defaultPath:`${brand.englishName}-${new Date().toISOString().slice(0,10)}.papertrail`,filters:[{name:brand.name+' 备份',extensions:['papertrail']}]});
  if(chosen.canceled)return {cancelled:true};
  const result=await api('/api/backup/export',{});fs.writeFileSync(chosen.filePath,Buffer.from(result.data,'base64'),{mode:0o600});
  return {ok:true,message:'备份已保存，包含稿件、历史和设置。'};
}
async function restoreData(){
  let data;
  {const chosen=await dialog.showOpenDialog(window,{title:'选择 '+brand.name+' 备份',properties:['openFile'],filters:[{name:brand.name+' 备份',extensions:['papertrail','paperdesk']}]});
    if(chosen.canceled)return {cancelled:true};
    if(fs.statSync(chosen.filePaths[0]).size>128*1024*1024)throw new Error('备份文件过大');
    data=fs.readFileSync(chosen.filePaths[0]).toString('base64');}
  const choice=await dialog.showMessageBox(window,{type:'question',buttons:['恢复数据','取消'],defaultId:1,cancelId:1,
    message:'用备份恢复稿件和设置？',
    detail:'当前数据会先备份到本机。恢复后需要重新保存投稿账号密码。'});
  if(choice.response!==0)return {cancelled:true};
  return api('/api/backup/restore',{data});
}
async function checkUpdates(){
  const config=JSON.parse(fs.readFileSync(path.join(resources,app.isPackaged?'release-config.json':'build/config/release-config.json'),'utf8'));
  if(!config.updateManifestUrl){
    await dialog.showMessageBox(window,{message:'PaperTrail '+displayVersion(app.getVersion()),detail:'当前使用本地构建版本，尚未配置在线更新。'});
    return {configured:false};
  }
  try{
    if(!allowExternal(config.updateManifestUrl))throw new Error('更新地址需要使用 HTTPS');
    const response=await fetch(config.updateManifestUrl,{signal:AbortSignal.timeout(15000)});
    if(!response.ok)throw new Error('暂时无法检查更新');
    const result=releaseFor(await response.json(),target,app.getVersion());
    if(!result.newer){await dialog.showMessageBox(window,{message:'已是最新版本',detail:displayVersion(app.getVersion())});return result;}
    const choice=await dialog.showMessageBox(window,{type:'info',buttons:['下载新版','稍后'],cancelId:1,message:'发现 '+brand.name+' '+result.version,detail:result.notes||'下载后覆盖安装，稿件和设置会保留。'});
    if(choice.response===0)await shell.openExternal(result.url);return result;
  }catch(error){await dialog.showMessageBox(window,{type:'warning',message:'检查更新未完成',detail:error.message});return {error:error.message};}
}
function registerIpc(){
  function handle(name,callback){ipcMain.handle('desktop:'+name,async(event,value)=>{
    if(!event.senderFrame?.url.startsWith('papertrail://app/'))throw new Error('无效页面');
    try{return await callback(value);}catch(error){return {error:error.message};}
  });}
  handle('info',()=>({version:displayVersion(app.getVersion()),platform:process.platform,arch:process.arch,preferences,brand}));
  handle('preferences',value=>{
    if(typeof value?.keepRunning!=='boolean'||typeof value?.startAtLogin!=='boolean')throw new Error('设置格式无效');
    if(app.isPackaged)app.setLoginItemSettings({openAtLogin:value.startAtLogin,args:['--hidden']});
    preferences={keepRunning:value.keepRunning,startAtLogin:app.isPackaged&&value.startAtLogin};saveConfig();return {ok:true,preferences};
  });
  handle('backup',backupData);handle('restore',restoreData);
  handle('updates',checkUpdates);handle('open-data',()=>shell.openPath(dataPath));
  const fromTray=event=>event.senderFrame?.url==='papertrail://app/tray.html';
  ipcMain.handle('tray:state',event=>{if(!fromTray(event))throw new Error('无效页面');return updateTray();});
  ipcMain.handle('tray:refresh',event=>{if(!fromTray(event))throw new Error('无效页面');return refreshFromTray();});
  ipcMain.on('tray:open',event=>{if(fromTray(event))showWindow();});
  ipcMain.on('tray:quit',event=>{if(fromTray(event))app.quit();});
}
if(!singleInstance){app.quit();}else{
  app.on('second-instance',showWindow);
  app.on('activate',()=>{if(!quitting&&!mainClosing&&(!popup||popup.isDestroyed())&&window&&!window.isDestroyed())showWindow();});
  app.on('window-all-closed',()=>{if(!backendBase||!preferences.keepRunning)app.quit();});
  app.on('before-quit',event=>{if(stopped)return;event.preventDefault();quitting=true;stopBackend().finally(()=>app.quit());});
  app.whenReady().then(async()=>{
    if(process.platform==='darwin')app.dock.setIcon(path.join(assets,'icon.png'));
    syncDock();
    await prepareComponents();
    if(quitting)return;
    await startBackend();
    if(app.isPackaged)app.setLoginItemSettings({openAtLogin:preferences.startAtLogin,args:['--hidden']});
    protocol.handle('papertrail',async request=>{
      const requested=new URL(request.url);
      if(requested.hostname!=='app')return new Response('Not found',{status:404});
      if(!backendBase)return new Response('服务正在恢复',{status:503});
      const headers={'X-PaperTrail-Token':token};
      for(const name of ['content-type','x-papertrail-filename'])if(request.headers.has(name))headers[name]=request.headers.get(name);
      return net.fetch(backendBase+requested.pathname+requested.search,{method:request.method,headers,
        body:['GET','HEAD'].includes(request.method)?undefined:await request.arrayBuffer()});
    });
    registerIpc();createMenus();
    if(window&&!window.isDestroyed())window.loadURL('papertrail://app/');
    else if(!process.argv.includes('--hidden'))await createWindow();
    syncDock();
  }).catch(error=>{dialog.showErrorBox(brand.name+' 未能启动',error.message);app.quit();});
}
module.exports={showWindow,toggleTrayPopup};
