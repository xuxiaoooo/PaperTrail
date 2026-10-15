const path = require('node:path');
const root=path.resolve(__dirname,'../..');
const windows=process.argv.includes('--win');
const target=windows?'windows-x64':'macos-arm64';
const offline=process.env.PAPERTRAIL_PACKAGE_MODE==='offline';
const version=require('../../package.json').version.replace(/\.0$/,'');
const brand=require('../../src/desktop/brand.cjs');
const runtime=path.join(root,'build/runtime',target);
const {componentsReady}=require('../../src/desktop/browser-components.cjs');
if(offline&&!componentsReady(path.join(runtime,'browser-module/playwright-core'),path.join(runtime,'browsers'),windows?'win32':'darwin')){
  throw new Error('Prepare the complete native browser runtime before building the offline installer.');
}
if(!require('node:fs').existsSync(path.join(runtime,'browser-module/playwright-core/index.mjs')))
  throw new Error('Prepare the Playwright module before building.');
const output=windows?(offline?'windows-x64-offline':'windows-x64'):(offline?'macos-arm64-offline':'macos-arm64');
module.exports={
  appId:brand.appId,productName:brand.name,executableName:brand.englishName,
  directories:{output:path.join(root,'build/work',output),buildResources:path.join(root,'assets')},
  asar:true,npmRebuild:false,
  files:['src/desktop/**','package.json','!**/node_modules/**'],
  extraResources:[
    {from:'LICENSE',to:'LICENSE'},
    {from:'src/backend',to:'src/backend',filter:['**/*.py']},
    {from:'src/readers',to:'src/readers',filter:['**/*.mjs']},
    {from:'src/ui',to:'src/ui'},
    {from:'src/desktop',to:'src/desktop',filter:['install-components.cjs','browser-components.cjs','apply-update.cjs']},
    {from:`build/runtime/${target}`,to:'runtime',filter:['**/*','!browsers{,/**/*}','!**/__pycache__/**','!**/*.pyc','!**/.DS_Store','!**/.links/**','!**/test/**','!**/tests/**']},
    ...(offline?[{from:path.join(runtime,'browsers'),to:'runtime/browsers',filter:['**/*','!.links{,/**/*}','!**/.DS_Store']}]:[]),
    {from:'assets',to:'assets',filter:['icon.png','trayTemplate.png','trayTemplate@2x.png']},
    {from:'build/config/release-config.json',to:'release-config.json'},
    {from:'docs/第三方组件说明.md',to:'THIRD-PARTY-NOTICES.md'}
  ],
  artifactName:`${brand.englishName}-${version}-Mac${offline?'-Offline':''}.dmg`,
  mac:{target:[{target:'dmg',arch:['arm64']}],category:'public.app-category.productivity',
    minimumSystemVersion:'14.0',icon:'assets/icon.icns',
    identity:process.env.CSC_NAME||'-',hardenedRuntime:true,
    entitlements:'build/config/entitlements.mac.plist',entitlementsInherit:'build/config/entitlements.mac.plist',
    notarize:!!process.env.APPLE_API_KEY},
  dmg:{title:brand.name,window:{width:540,height:360},contents:[
    {x:150,y:170,type:'file'},{x:390,y:170,type:'link',path:'/Applications'}]},
  win:{target:[{target:'nsis',arch:['x64']}],icon:'assets/icon.ico',
    signAndEditExecutable:true,signExecutable:!!process.env.CSC_LINK},
  nsis:{oneClick:false,perMachine:false,allowToChangeInstallationDirectory:true,
    include:'build/config/installer.nsh',
    createDesktopShortcut:true,createStartMenuShortcut:true,shortcutName:brand.name,
    deleteAppDataOnUninstall:false,artifactName:`${brand.englishName}-${version}-Windows${offline?'-Offline':''}.exe`},
  publish:null
};
