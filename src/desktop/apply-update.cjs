'use strict';
// Detached helper: wait until the running bundle exits, replace atomically, and restart.
const fs=require('node:fs');
const {spawnSync}=require('node:child_process');
const {setTimeout:sleep}=require('node:timers/promises');

async function apply({pid,target,stage,backup,marker,workspace},openApp=target=>spawnSync('/usr/bin/open',[target],{timeout:15000})){
  let exited=false;
  for(let attempt=0;attempt<300;attempt++){
    try{process.kill(pid,0);}catch(error){if(error.code==='ESRCH'){exited=true;break;}}
    await sleep(200);
  }
  if(!exited)throw new Error('当前应用未退出，安装已取消');
  if(!fs.existsSync(stage)||!fs.existsSync(target))throw new Error('更新文件或当前应用缺失');
  fs.renameSync(target,backup);
  try{
    fs.renameSync(stage,target);
    if(marker)fs.writeFileSync(marker,JSON.stringify({target,backup,workspace}),{mode:0o600});
    const opened=openApp(target);
    if(opened.status!==0)throw new Error('新版未能启动');
  }catch(error){
    if(fs.existsSync(target))fs.renameSync(target,stage);
    fs.renameSync(backup,target);
    if(marker)fs.rmSync(marker,{force:true});
    throw error;
  }
  // The new app removes the backup after its backend has started successfully.
}
if(require.main===module){
  apply(JSON.parse(process.argv[2])).catch(error=>{
    const message='PaperTrail update failed: '+error.message+'\n';
    fs.appendFileSync(process.argv[3],message,{mode:0o600});
    process.exitCode=1;
  });
}
module.exports={apply};
