const {_electron}=require('playwright-core');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'papertrail-docs-'));
const images=path.join(root,'docs/images'),performance=path.join(root,'docs/performance');
fs.mkdirSync(images,{recursive:true});fs.mkdirSync(performance,{recursive:true});
let app;
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function memory(pid){
 const rows=execFileSync('ps',['-axo','pid=,ppid=,rss=,args='],{encoding:'utf8'}).split('\n')
  .map(line=>/^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/.exec(line)).filter(Boolean)
  .map(row=>({pid:Number(row[1]),parent:Number(row[2]),rss:Number(row[3]),command:row[4]}));
 const owned=new Set([pid]);
 for(let previous=0;previous!==owned.size;){previous=owned.size;for(const row of rows)if(owned.has(row.parent))owned.add(row.pid);}
 const processes=rows.filter(row=>owned.has(row.pid));
 return {processes:processes.length,residentMiB:Math.round(processes.reduce((sum,row)=>sum+row.rss,0)/1024*10)/10,
  renderers:processes.filter(row=>row.command.includes('--type=renderer')).length,
  readingBrowsers:processes.filter(row=>/runtime\/browsers\//.test(row.command)).length};
}
(async()=>{
 app=await _electron.launch({args:[root],env:{...process.env,PAPERTRAIL_TEST_DATA_DIR:temporary},timeout:60000});
 const page=await app.firstWindow();await page.getByRole('heading',{name:'投稿状态'}).waitFor();
 await page.evaluate(async()=>{
  const post=async(url,body)=>{const result=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const data=await result.json();if(!result.ok)throw new Error(data.error);return data;};
  await post('/api/schedule',{enabled:false});
  for(const [journal,number,initial,status,raw,url] of [
   ['Neural Systems · Demo','DEMO-26-001','submitted','review','Under Review','https://mc.manuscriptcentral.com/papertrail-demo'],
   ['Biomedical Signals · Demo','DEMO-26-002','editor','decision','Decision in Process','https://www.editorialmanager.com/papertrail-demo']]){
   const account=await post('/api/accounts',{journal_name:journal,platform:'自动识别',login_url:url,username:number.toLowerCase()+'@example.test',password:''});
   const paper=await post('/api/manuscripts',{account_id:account.id,number,status:initial});
   await post('/api/manuscripts/'+paper.id,{account_id:account.id,number,status,raw_status:raw});
  }
 });
 await page.reload();await page.getByRole('button',{name:'DEMO-26-001',exact:true}).waitFor();
 await page.locator('.brand img').evaluate(img=>img.decode());
 await page.screenshot({path:path.join(images,'main-window.png')});
 const pid=await app.evaluate(()=>process.pid);await delay(1500);
 const mainOpen=memory(pid);
 await page.getByRole('button',{name:'变化日志',exact:true}).click();
 await page.getByRole('heading',{name:'本地变化日志'}).waitFor();
 await page.screenshot({path:path.join(images,'local-history.png')});
 const controller=await app.evaluate(({app})=>app.getAppPath()+'/src/desktop/main.cjs');
 const closed=page.waitForEvent('close');
 await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(window=>window.webContents.getURL()==='papertrail://app/').close());
 await closed;await delay(2000);
 const background=memory(pid);
 if(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().length)!==0)throw new Error('Background state retained a window');
 const opened=app.waitForEvent('window');
 await app.evaluate((_,file)=>process.getBuiltinModule('module').createRequire(file)(file).toggleTrayPopup(),controller);
 const popup=await opened;await popup.getByText('DEMO-26-002',{exact:true}).waitFor();
 await popup.locator('.brand-mark').evaluate(img=>img.decode());
 await popup.screenshot({path:path.join(images,'menu-bar-overview.png')});
 const record={capturedAt:new Date().toISOString(),version:require('../package.json').version,
  platform:process.platform,architecture:process.arch,osVersion:execFileSync('sw_vers',['-productVersion'],{encoding:'utf8'}).trim(),
  metric:'Sum of process RSS, including the application and its child processes; not physical memory footprint',
  scenario:'Two synthetic manuscripts; no journal login or active reading browser',mainOpen,background};
 fs.writeFileSync(path.join(performance,'current-sample.json'),JSON.stringify(record,null,2)+'\n');
 fs.rmSync(path.join(images,'overview.png'),{force:true});
 console.log(JSON.stringify(record,null,2));
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{
 if(app)await app.close().catch(()=>{});
 fs.rmSync(temporary,{recursive:true,force:true});
});
