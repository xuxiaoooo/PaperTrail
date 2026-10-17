const path=require('node:path'),{spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');
const brand=require('../src/desktop/brand.cjs');
const executable=process.platform==='darwin'
 ?path.join(root,'build/work/macos-arm64/mac-arm64',brand.englishName+'.app/Contents/MacOS/'+brand.englishName)
 :path.join(root,'build/work/windows-x64/win-unpacked',brand.englishName+'.exe');
const runtime=process.platform==='darwin'?path.resolve(executable,'../../Resources/runtime'):path.join(path.dirname(executable),'resources/runtime');
const result=spawnSync(process.execPath,[path.join(root,'scripts/smoke-desktop.cjs')],{
 cwd:root,stdio:'inherit',env:{...process.env,PAPERTRAIL_TEST_EXECUTABLE:executable,PAPERTRAIL_TEST_RUNTIME:runtime}});
if(result.error)throw result.error;
process.exit(result.status===null?1:result.status);
