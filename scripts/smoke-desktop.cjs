const {_electron}=require(process.env.PAPERTRAIL_BROWSER_MODULE||'playwright-core');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
const data=fs.mkdtempSync(path.join(os.tmpdir(),'papertrail-desktop-check-'));
const output=path.join(root,'build/test-results');fs.mkdirSync(output,{recursive:true});
const binary=process.env.PAPERTRAIL_TEST_EXECUTABLE;
const report={target:process.platform+'-'+process.arch,packaged:Boolean(binary),checks:[],errors:[],testData:data};
const launch=(hidden=false)=>_electron.launch({...(binary?{executablePath:binary,args:hidden?['--hidden']:[]}:{args:[root,...(hidden?['--hidden']:[])]}),env:{...process.env,
  PAPERTRAIL_TEST_DATA_DIR:data},timeout:60000});
let app;
async function waitForDock(visible){
  if(process.platform!=='darwin')return;
  const deadline=Date.now()+3000;
  while(await app.evaluate(({app})=>app.dock.isVisible())!==visible){
    if(Date.now()>deadline)throw new Error('Dock visibility did not become '+visible);
    await new Promise(resolve=>setTimeout(resolve,50));
  }
}
(async()=>{
  app=await launch();let page=await app.firstWindow();
  page.on('pageerror',error=>report.errors.push(error.message));
  await page.getByRole('heading',{name:'投稿状态'}).waitFor({timeout:30000});
  const geometry=await app.evaluate(({BrowserWindow,screen,app})=>({bounds:BrowserWindow.getAllWindows()[0].getBounds(),area:screen.getPrimaryDisplay().bounds,dock:process.platform==='darwin'?app.dock.isVisible():null,name:app.getName()}));
  assert.ok(Math.abs(geometry.bounds.width-Math.max(320,Math.round(geometry.area.width/4)))<=1);
  assert.ok(Math.abs(geometry.bounds.height-Math.max(480,Math.round(geometry.area.height*2/3)))<=1);
  assert.ok(geometry.bounds.height>geometry.bounds.width);
  assert.equal(geometry.name,'PaperTrail');
  assert.equal(await page.getByText('PaperTrail',{exact:true}).count(),1);
  assert.equal(await page.locator('.brand img').evaluate(img=>img.complete&&img.naturalWidth>0),true);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  if(process.platform==='darwin')assert.equal(geometry.dock,true);
  await page.screenshot({path:path.join(output,binary?'packaged-empty.png':'desktop-empty.png')});
  assert.equal(await page.getByRole('heading',{name:'欢迎使用 PaperTrail'}).count(),0);
  report.checks.push('PaperTrail branding and icon load; window is one quarter of screen width and two thirds of screen height');

  await page.getByRole('button',{name:'期刊账号',exact:true}).click();
  await page.getByRole('button',{name:'添加期刊账号',exact:true}).click();
  await page.getByRole('dialog').getByRole('textbox',{name:'期刊全名'}).fill('Desktop verification journal');
  await page.getByRole('dialog').getByRole('textbox',{name:'投稿网址'}).fill('https://mc.manuscriptcentral.com/verification');
  await page.getByRole('dialog').getByRole('textbox',{name:'登录账号'}).fill('example@example.test');
  await page.getByRole('dialog').getByRole('textbox',{name:'密码'}).fill('synthetic-smoke-password');
  await page.getByRole('dialog').getByRole('button',{name:'保存'}).click();
  await page.getByRole('dialog').waitFor({state:'hidden'});
  await page.getByRole('heading',{name:'Desktop verification journal'}).waitFor();
  report.checks.push('Journal URL and password account save through visible UI');

  await page.getByRole('button',{name:'稿件',exact:true}).click();
  await page.getByRole('button',{name:'添加稿件',exact:true}).first().click();
  await page.getByRole('dialog').getByRole('textbox',{name:'稿件号'}).fill('VERIFY-2026-001');
  await page.getByRole('dialog').getByRole('combobox',{name:'当前状态'}).selectOption('review');
  await page.getByRole('dialog').getByRole('button',{name:'保存'}).click();
  await page.getByRole('dialog').waitFor({state:'hidden'});
  await page.getByRole('listitem').filter({hasText:'VERIFY-2026-001'}).waitFor();
  assert.equal(await page.getByRole('table').count(),0);
  await page.getByRole('listitem').getByText('审稿中',{exact:true}).waitFor();
  await page.getByRole('listitem').getByText('本地尚无变化').waitFor();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  report.checks.push('Number-only manuscript uses a compact card with journal, status, number and local changes');
  await page.screenshot({path:path.join(output,'compact-manuscripts.png')});

  await page.getByRole('button',{name:'VERIFY-2026-001'}).click();
  await page.getByRole('dialog').getByRole('button',{name:'编辑稿件'}).click();
  await page.getByRole('dialog').getByRole('combobox',{name:'当前状态'}).selectOption('decision');
  await page.getByRole('dialog').getByRole('button',{name:'保存'}).click();
  await page.getByRole('dialog').waitFor({state:'hidden'});
  await page.getByRole('listitem').getByText(/变化 .* · 1 次/).waitFor();
  await page.getByRole('button',{name:'变化日志'}).click();
  await page.locator('.log-group summary').click();
  await page.getByText('审稿中 → 等待决定').waitFor();
  report.checks.push('Local status change count, date and log update after editing');
  await page.screenshot({path:path.join(output,binary?'packaged-log.png':'desktop-log.png')});

  await page.getByRole('button',{name:'设置与数据'}).click();
  const state=await page.evaluate(async()=> (await fetch('/api/state')).json());
  assert.equal(state.auto_refresh.enabled,true);
  assert.deepEqual(state.auto_refresh.times,['00:00',...Array.from({length:16},(_,i)=>String(i+8).padStart(2,'0')+':00')]);
  await page.getByRole('dialog').getByRole('button',{name:'删除 00:00'}).click();
  await page.getByRole('dialog').getByLabel('新增刷新时间').fill('12:30');
  await page.getByRole('dialog').getByRole('button',{name:'添加时间点'}).click();
  await page.getByRole('dialog').getByRole('button',{name:'保存'}).click();
  await page.getByRole('dialog').waitFor({state:'hidden'});
  const custom=await page.evaluate(async()=> (await fetch('/api/state')).json());
  assert.ok(custom.auto_refresh.times.includes('12:30'));
  assert.ok(!custom.auto_refresh.times.includes('00:00'));
  report.checks.push('Custom refresh slots are saved through the UI');
  await page.getByRole('button',{name:'设置与数据'}).click();
  const backupFile=path.join(data,'verification.papertrail');
  await app.evaluate(({dialog},file)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:file});},backupFile);
  await page.getByRole('dialog').getByRole('button',{name:'导出备份'}).click();
  await page.getByRole('status').filter({hasText:'备份已保存'}).waitFor();
  assert.ok(fs.statSync(backupFile).size>0);
  await app.evaluate(({dialog},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});dialog.showMessageBox=async()=>({response:0});},backupFile);
  await page.getByRole('dialog').getByRole('button',{name:'恢复备份'}).click();
  await page.getByRole('status').filter({hasText:'恢复'}).waitFor();
  report.checks.push('Native backup and restore work against the local database');
  await app.close();app=null;

  app=await launch();page=await app.firstWindow();
  page.on('pageerror',error=>report.errors.push(error.message));
  await page.getByRole('button',{name:'VERIFY-2026-001'}).waitFor({timeout:30000});
  const restored=await page.evaluate(async()=> (await fetch('/api/state')).json());
  assert.equal(restored.manuscripts.length,1);
  assert.equal(restored.manuscripts[0].change_count,1);
  report.checks.push('Relaunch preserves manuscript and local change history');

  const controller=await app.evaluate(({app})=>app.getAppPath()+'/src/desktop/main.cjs');
  const mainClosed=page.waitForEvent('close');
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL()==='papertrail://app/').close());
  await mainClosed;
  await waitForDock(false);
  const hidden=await app.evaluate(({BrowserWindow,app})=>({windows:BrowserWindow.getAllWindows().length,dock:process.platform==='darwin'?app.dock.isVisible():null}));
  assert.equal(hidden.windows,0);
  if(process.platform==='darwin')assert.equal(hidden.dock,false);
  report.checks.push('Closing the main window releases its renderer and hides the Dock icon');
  const opened=app.waitForEvent('window');
  await app.evaluate((_,file)=>process.getBuiltinModule('module').createRequire(file)(file).toggleTrayPopup(),controller);
  const quick=await opened;
  quick.on('pageerror',error=>report.errors.push(error.message));
  await quick.getByText('VERIFY-2026-001',{exact:true}).waitFor();
  await quick.getByText('等待决定',{exact:true}).waitFor();
  await quick.getByRole('button',{name:'打开主页面'}).waitFor();
  await quick.getByRole('button',{name:'退出',exact:true}).waitFor();
  assert.equal(await quick.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await waitForDock(false);
  await quick.screenshot({path:path.join(output,'tray-overview.png')});
  report.checks.push('Menu-bar popover lists every tracked manuscript with status and footer actions without opening the main window');
  await app.evaluate(()=>{
    const original=globalThis.fetch;
    globalThis.fetch=async(url,options)=>String(url).endsWith('/api/refresh')
      ?new Promise(resolve=>setTimeout(()=>resolve(new Response(JSON.stringify({ok:true,message:'测试刷新完成',issues:[]}))),200))
      :original(url,options);
  });
  await quick.getByRole('button',{name:'刷新投稿状态'}).click();
  await quick.getByRole('status').filter({hasText:'测试刷新完成'}).waitFor();
  assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().length),1);
  report.checks.push('Popover refresh operates without creating a main window');
  const mainOpened=app.waitForEvent('window');
  await quick.getByRole('button',{name:'打开主页面'}).click();
  page=await mainOpened;
  page.on('pageerror',error=>report.errors.push(error.message));
  await page.getByRole('button',{name:'VERIFY-2026-001'}).waitFor();
  await waitForDock(true);
  if(process.platform==='darwin')assert.equal(await app.evaluate(({app})=>app.dock.isVisible()),true);
  assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().length),1);
  report.checks.push('Opening the main page restores the Dock icon and releases the popover');

  await page.getByRole('button',{name:'期刊账号',exact:true}).click();
  await page.getByRole('button',{name:'编辑期刊'}).click();
  await page.getByRole('dialog').getByRole('textbox',{name:'期刊全名'}).fill('Corrected verification journal');
  await page.getByRole('dialog').getByRole('button',{name:'保存'}).click();
  await page.getByRole('heading',{name:'Corrected verification journal'}).waitFor();
  await page.getByRole('button',{name:'编辑期刊'}).click();
  await page.getByRole('dialog').getByRole('button',{name:'删除期刊及全部账号和稿件'}).click();
  await page.getByRole('dialog').getByRole('button',{name:'确认删除'}).click();
  await page.getByRole('heading',{name:'Corrected verification journal'}).waitFor({state:'hidden'});
  const deleted=await page.evaluate(async()=> (await fetch('/api/state')).json());
  assert.deepEqual([deleted.journals,deleted.accounts,deleted.manuscripts,deleted.events],[[],[],[],[]]);
  report.checks.push('Journal rename and cascade deletion remove only local records');
  assert.deepEqual(report.errors,[]);
  await app.close();app=null;
  app=await launch(true);
  const deadline=Date.now()+30000;
  while(!await app.evaluate(({Menu})=>!!Menu.getApplicationMenu()?.getMenuItemById('show-main'))){
    if(Date.now()>deadline)throw new Error('Hidden startup did not become ready');
    await new Promise(resolve=>setTimeout(resolve,50));
  }
  assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().length),0);
  await waitForDock(false);
  if(process.platform==='darwin')assert.equal(await app.evaluate(({app})=>app.dock.isVisible()),false);
  report.checks.push('Hidden startup creates no renderer and no Dock icon');
  const lastWindow=app.waitForEvent('window');
  await app.evaluate((_,file)=>process.getBuiltinModule('module').createRequire(file)(file).toggleTrayPopup(),controller);
  const lastQuick=await lastWindow;
  await lastQuick.getByRole('button',{name:'退出',exact:true}).waitFor();
  const exit=new Promise(resolve=>app.process().once('exit',resolve));
  await lastQuick.getByRole('button',{name:'退出',exact:true}).click();
  await exit;app=null;
  report.checks.push('Popover Exit stops the entire application');
  report.ok=true;
})().catch(error=>{report.ok=false;report.error=error.stack;console.error(error);process.exitCode=1;}).finally(async()=>{
  if(app)await app.close().catch(()=>{});
  fs.writeFileSync(path.join(output,binary?'packaged-smoke.json':'desktop-smoke.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify(report,null,2));
});
