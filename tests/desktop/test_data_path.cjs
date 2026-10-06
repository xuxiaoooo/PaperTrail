const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {dataPath}=require('../../src/desktop/data-path.cjs');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'papertrail-migration-test-'));
try{
  const previous=path.join(root,'PaperdeskDesktop');
  fs.mkdirSync(path.join(previous,'browser-profiles/account'),{recursive:true});
  fs.writeFileSync(path.join(previous,'paperdesk.sqlite3'),'saved manuscript records');
  fs.writeFileSync(path.join(previous,'paperdesk.sqlite3-wal'),'pending database pages');
  fs.writeFileSync(path.join(previous,'desktop-settings.json'),'{"keepRunning":true}');
  fs.writeFileSync(path.join(previous,'browser-profiles/account/session-state.json'),'saved login session');
  fs.writeFileSync(path.join(previous,'browser-profiles/account/SingletonLock'),'old process lock');
  const migrated=dataPath({appData:root});
  assert.equal(migrated,path.join(root,'PaperTrail'));
  assert.equal(fs.readFileSync(path.join(migrated,'papertrail.sqlite3'),'utf8'),'saved manuscript records');
  assert.equal(fs.readFileSync(path.join(migrated,'papertrail.sqlite3-wal'),'utf8'),'pending database pages');
  assert.equal(fs.readFileSync(path.join(migrated,'browser-profiles/account/session-state.json'),'utf8'),'saved login session');
  assert.equal(fs.existsSync(path.join(migrated,'browser-profiles/account/SingletonLock')),false);
  assert.ok(fs.existsSync(path.join(previous,'paperdesk.sqlite3')));
  fs.writeFileSync(path.join(migrated,'papertrail.sqlite3'),'newer records');
  assert.equal(dataPath({appData:root}),migrated);
  assert.equal(fs.readFileSync(path.join(migrated,'papertrail.sqlite3'),'utf8'),'newer records');
  assert.equal(dataPath({appData:root,override:'/isolated-test-data'}),'/isolated-test-data');
  const windows=path.join(root,'windows');
  assert.equal(dataPath({appData:root,localAppData:windows,platform:'win32'}),path.join(windows,'PaperTrail'));
  console.log('Data migration preserves records, settings and login sessions; relaunch never replaces new records');
}finally{fs.rmSync(root,{recursive:true,force:true});}
