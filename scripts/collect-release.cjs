const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..'),version=require('../package.json').version.replace(/\.0$/,'');
const brand=require('../src/desktop/brand.cjs');
const outputs=[['macos-arm64',`${brand.englishName}-${version}-Mac.dmg`],
 ['macos-arm64-offline',`${brand.englishName}-${version}-Mac-Offline.dmg`],
 ['windows-x64',`${brand.englishName}-${version}-Windows.exe`],
 ['windows-x64-offline',`${brand.englishName}-${version}-Windows-Offline.exe`]];
async function main(){
 const artifacts=[],checksums=[];
 for(const [buildTarget,file] of outputs){
  const target=buildTarget.replace(/-offline$/,'');
  const source=path.join(root,'build/work',buildTarget,file);
  if(!fs.existsSync(source))continue;
  const directory=path.join(root,'release',buildTarget);fs.mkdirSync(directory,{recursive:true});
  const destination=path.join(directory,file);
  fs.copyFileSync(source,destination);
  const hash=crypto.createHash('sha256');
  for await(const chunk of fs.createReadStream(destination))hash.update(chunk);
  const sha256=hash.digest('hex');
  artifacts.push({target,variant:buildTarget.endsWith('-offline')?'offline':'slim',
    file:buildTarget+'/'+file,bytes:fs.statSync(source).size,sha256});
  checksums.push(`${sha256}  ${buildTarget}/${file}`);
 }
 if(!artifacts.length)throw new Error('No installers have been built.');
 const release=path.join(root,'release');
 fs.writeFileSync(path.join(release,'release-manifest.json'),JSON.stringify({version,channel:'stable',artifacts},null,2));
 fs.writeFileSync(path.join(release,'SHA256SUMS.txt'),checksums.join('\n')+'\n');
 const downloads=Object.fromEntries(artifacts.filter(item=>item.variant==='slim').map(item=>
  [item.target,`https://github.com/xuxiaoooo/PaperTrail/releases/download/v${require('../package.json').version}/${path.basename(item.file)}`]));
 fs.writeFileSync(path.join(release,'updates.json'),JSON.stringify({format:'papertrail-updates-v1',version,
  notes:'PaperTrail 1.2：MDPI、稿件修订追踪、自定义刷新及自动安装更新。',downloads},null,2)+'\n');
 console.log(JSON.stringify(artifacts,null,2));
}
main().catch(error=>{console.error(error);process.exitCode=1;});
