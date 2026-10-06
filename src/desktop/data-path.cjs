'use strict';
const fs=require('node:fs'),path=require('node:path');

function dataPath({appData,localAppData,platform=process.platform,override}){
  if(override)return override;
  const base=platform==='win32'?(localAppData||appData):appData;
  const destination=path.join(base,'PaperTrail');
  if(fs.existsSync(path.join(destination,'papertrail.sqlite3')))return destination;
  // These names exist only to carry saved accounts and history into the new identity.
  const previous=['PaperdeskDesktop','Paperdesk'].map(name=>path.join(base,name))
    .find(folder=>fs.existsSync(path.join(folder,'paperdesk.sqlite3')));
  if(!previous||fs.existsSync(destination))return destination;
  fs.mkdirSync(base,{recursive:true});
  const temporary=fs.mkdtempSync(path.join(base,'.papertrail-migration-'));
  try{
    fs.cpSync(previous,temporary,{recursive:true,filter:file=>
      !/^(Singleton.*|DevToolsActivePort|lock|\.parentlock|parent\.lock)$/.test(path.basename(file))});
    for(const suffix of ['', '-wal', '-shm']){
      const old=path.join(temporary,'paperdesk.sqlite3'+suffix);
      if(fs.existsSync(old))fs.renameSync(old,path.join(temporary,'papertrail.sqlite3'+suffix));
    }
    if(platform!=='win32')fs.chmodSync(temporary,0o700);
    fs.renameSync(temporary,destination);
  }catch(error){fs.rmSync(temporary,{recursive:true,force:true});throw error;}
  return destination;
}
module.exports={dataPath};
