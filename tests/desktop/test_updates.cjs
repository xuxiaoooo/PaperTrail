const assert=require('node:assert/strict');
const {compareVersions,releaseFor,displayVersion}=require('../../src/desktop/update.cjs');
const {githubReleaseFor,downloadVerified}=require('../../src/desktop/update.cjs');
const {apply}=require('../../src/desktop/apply-update.cjs');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
assert.ok(compareVersions('1.1','1.0.0')>0);
assert.ok(compareVersions('2.0','1.9')>0);
assert.ok(compareVersions('1.1.0','1.0.9')>0);
assert.equal(compareVersions('1.0.0','1.0.0'),0);
assert.equal(compareVersions('1.0','1.0.0'),0);
assert.equal(displayVersion('1.0.0'),'1.0');
assert.equal(displayVersion('1.1.0'),'1.1');
assert.throws(()=>releaseFor({format:'papertrail-updates-v1',version:'2.0.0',downloads:{'windows-x64':'file:///private'}},'windows-x64','1.0.0'));
assert.equal(releaseFor({format:'papertrail-updates-v1',version:'1.1',downloads:{'windows-x64':'https://example.test/setup.exe'}},'windows-x64','1.0.0').newer,true);
const payload=Buffer.from('synthetic installer');
const sha256=crypto.createHash('sha256').update(payload).digest('hex');
const release={tag_name:'v1.2.0',draft:false,prerelease:false,body:'Release notes',assets:[{
 name:'PaperTrail-1.2-Mac.dmg',size:payload.length,digest:'sha256:'+sha256,
 browser_download_url:'https://github.com/xuxiaoooo/PaperTrail/releases/download/v1.2.0/PaperTrail-1.2-Mac.dmg'
}]};
const selected=githubReleaseFor(release,'macos-arm64','1.1.0');
assert.equal(selected.version,'1.2.0');
assert.equal(githubReleaseFor(release,'macos-arm64','1.2.0').newer,false);
assert.throws(()=>githubReleaseFor({...release,assets:[{...release.assets[0],digest:''}]},'macos-arm64','1.1.0'),/SHA-256/);
assert.throws(()=>githubReleaseFor({...release,assets:[{...release.assets[0],browser_download_url:'https://evil.test/file'}]},'macos-arm64','1.1.0'),/下载地址/);
(async()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'papertrail-update-'));
 try{
  const request=async()=>new Response(payload,{status:200});
  const file=await downloadVerified(selected,directory,request);
  assert.deepEqual(fs.readFileSync(file),payload);
  await assert.rejects(downloadVerified({...selected,sha256:'0'.repeat(64)},directory,request),/校验失败/);
  assert.equal(fs.existsSync(file+'.part'),false);
  const target=path.join(directory,'PaperTrail.app'),stage=path.join(directory,'staged.app');
  const backup=path.join(directory,'previous.app'),marker=path.join(directory,'pending.json');
  fs.mkdirSync(target);fs.writeFileSync(path.join(target,'version'),'old');
  fs.mkdirSync(stage);fs.writeFileSync(path.join(stage,'version'),'new');
  await apply({pid:99999999,target,stage,backup,marker},()=>({status:0}));
  assert.equal(fs.readFileSync(path.join(target,'version'),'utf8'),'new');
  assert.equal(fs.readFileSync(path.join(backup,'version'),'utf8'),'old');
  fs.renameSync(target,stage);fs.renameSync(backup,target);fs.rmSync(marker,{force:true});
  await assert.rejects(apply({pid:99999999,target,stage,backup,marker},()=>({status:1})),/未能启动/);
  assert.equal(fs.readFileSync(path.join(target,'version'),'utf8'),'old');
  assert.equal(fs.readFileSync(path.join(stage,'version'),'utf8'),'new');
  assert.equal(fs.existsSync(marker),false);
 }finally{fs.rmSync(directory,{recursive:true,force:true});}
 console.log('Version selection, GitHub asset validation and SHA-256 download passed.');
})().catch(error=>{console.error(error);process.exitCode=1;});
