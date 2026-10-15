const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {Readable,Transform}=require('node:stream');
const {pipeline}=require('node:stream/promises');
const {execFile}=require('node:child_process');
const {promisify}=require('node:util');
const run=promisify(execFile);
function compareVersions(left, right) {
  const parse = value => {
    const match = /^(\d+)\.(\d+)(?:\.(\d+))?$/.exec(value);
    if (!match) throw new Error('版本格式无效');
    return {numbers: [Number(match[1]),Number(match[2]),Number(match[3]||0)]};
  };
  const a = parse(left), b = parse(right);
  for (let i=0;i<3;i++) if(a.numbers[i]!==b.numbers[i]) return Math.sign(a.numbers[i]-b.numbers[i]);
  return 0;
}
function releaseFor(manifest, platform, version) {
  if(manifest.format!=='papertrail-updates-v1' || typeof manifest.version!=='string') throw new Error('更新信息格式无效');
  const newer=compareVersions(manifest.version,version)>0;
  const url=manifest.downloads?.[platform];
  if(newer && (!url || new URL(url).protocol!=='https:')) throw new Error('更新下载地址无效');
  return {newer, version:manifest.version, url, notes:String(manifest.notes||'').slice(0,3000)};
}
function githubReleaseFor(release,platform,installed){
  if(release.draft||release.prerelease||!/^v\d+\.\d+(?:\.\d+)?$/.test(release.tag_name||''))
    throw new Error('GitHub 发布版本无效');
  const version=release.tag_name.slice(1);
  const newer=compareVersions(version,installed)>0;
  const suffix=platform==='macos-arm64'?'-Mac.dmg':platform==='windows-x64'?'-Windows.exe':null;
  if(!suffix)throw new Error('当前平台暂无安装包');
  if(!newer)return {newer,version};
  const asset=release.assets?.find(item=>item.name===`PaperTrail-${displayVersion(version)}${suffix}`);
  if(!asset||!Number.isSafeInteger(asset.size)||asset.size<1||asset.size>1_500_000_000)
    throw new Error('GitHub Release 中没有适用的安装包');
  const url=new URL(asset.browser_download_url);
  if(url.protocol!=='https:'||url.hostname!=='github.com'||
      !url.pathname.startsWith(`/xuxiaoooo/PaperTrail/releases/download/${release.tag_name}/`))
    throw new Error('更新下载地址无效');
  const digest=/^sha256:([a-f0-9]{64})$/i.exec(asset.digest||'');
  if(!digest)throw new Error('安装包缺少 SHA-256 校验值');
  return {newer,version,url:url.href,name:asset.name,size:asset.size,sha256:digest[1].toLowerCase(),
    notes:String(release.body||'').slice(0,3000)};
}
async function downloadVerified(release,directory,request=fetch,onProgress=()=>{}){
  fs.mkdirSync(directory,{recursive:true,mode:0o700});
  const temporary=path.join(directory,release.name+'.part');
  const final=path.join(directory,release.name);
  const response=await request(release.url,{signal:AbortSignal.timeout(30*60*1000)});
  if(!response.ok||!response.body)throw new Error('安装包下载失败');
  const hash=crypto.createHash('sha256');let received=0;
  const digest=new Transform({transform(chunk,_encoding,callback){
    received+=chunk.length;
    if(received>release.size){callback(new Error('下载文件超过发布记录大小'));return;}
    hash.update(chunk);onProgress(received,release.size);callback(null,chunk);
  }});
  try{
    await pipeline(Readable.fromWeb(response.body),digest,fs.createWriteStream(temporary,{mode:0o600}));
    if(received!==release.size||hash.digest('hex')!==release.sha256)throw new Error('安装包校验失败，未安装');
    fs.renameSync(temporary,final);
    return final;
  }catch(error){fs.rmSync(temporary,{force:true});throw error;}
}
async function stageMacUpdate(release,dmg,target,workspace){
  if(path.basename(target)!=='PaperTrail.app')throw new Error('请先把 PaperTrail 安装到本机应用目录');
  fs.mkdirSync(workspace,{recursive:true});
  const mount=fs.mkdtempSync(path.join(workspace,'mounted-'));
  const stage=path.join(path.dirname(target),`.PaperTrail-${release.version}-update.app`);
  let attached=false;
  try{
    await run('/usr/bin/hdiutil',['attach','-readonly','-nobrowse','-mountpoint',mount,dmg],{timeout:120000});
    attached=true;
    const source=path.join(mount,'PaperTrail.app');
    if(!fs.existsSync(source))throw new Error('安装包内没有 PaperTrail.app');
    const info=path.join(source,'Contents/Info.plist');
    const [id,version]=await Promise.all([
      run('/usr/bin/plutil',['-extract','CFBundleIdentifier','raw','-o','-',info]),
      run('/usr/bin/plutil',['-extract','CFBundleShortVersionString','raw','-o','-',info])
    ]);
    if(id.stdout.trim()!=='org.papertrail.desktop'||compareVersions(version.stdout.trim(),release.version)!==0)
      throw new Error('安装包中的应用身份或版本不匹配');
    await run('/usr/bin/codesign',['--verify','--deep','--strict',source],{timeout:120000});
    fs.rmSync(stage,{recursive:true,force:true});
    await run('/usr/bin/ditto',[source,stage],{timeout:300000});
    await run('/usr/bin/codesign',['--verify','--deep','--strict',stage],{timeout:120000});
    return stage;
  }catch(error){fs.rmSync(stage,{recursive:true,force:true});throw error;}
  finally{
    if(attached)await run('/usr/bin/hdiutil',['detach',mount,'-quiet'],{timeout:60000}).catch(()=>{});
    try{fs.rmdirSync(mount);}catch{}
  }
}
function displayVersion(version){return version.replace(/^(\d+\.\d+)\.0$/,'$1');}
module.exports={compareVersions,releaseFor,githubReleaseFor,downloadVerified,stageMacUpdate,displayVersion};
