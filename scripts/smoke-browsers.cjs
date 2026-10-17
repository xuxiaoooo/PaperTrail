const fs=require('node:fs'),path=require('node:path'),{pathToFileURL}=require('node:url');
const root=path.resolve(__dirname,'..'),target=process.platform==='darwin'?'macos-arm64':'windows-x64';
const runtime=process.env.PAPERTRAIL_TEST_RUNTIME||path.join(root,'build/runtime',target);
(async()=>{
 const tools=await import(pathToFileURL(path.join(runtime,'browser-module/playwright-core/index.mjs')).href);
 const checks=[];
 const browser=await tools.chromium.launch({headless:true,channel:'chrome'});
 try{const page=await browser.newPage();await page.setContent('<title>PaperTrail runtime check</title><p>runtime ready</p>');
  if(await page.title()!=='PaperTrail runtime check')throw new Error('Google Chrome failed');
  checks.push({engine:'Google Chrome',version:browser.version(),ok:true});
 }finally{await browser.close();}
 fs.mkdirSync(path.join(root,'build/test-results'),{recursive:true});
 fs.writeFileSync(path.join(root,'build/test-results/browser-smoke-'+target+'.json'),JSON.stringify(checks,null,2));
 console.log(JSON.stringify(checks));
})().catch(error=>{console.error(error);process.exit(1);});
