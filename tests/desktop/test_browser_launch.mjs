import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {browserLaunchOptions} from '../../src/readers/browser_launch.mjs';
const root=mkdtempSync(join(tmpdir(),'papertrail-browser-identity-'));
try{
 const ini=join(root,'Contents/Resources/browser/papertrail.ini');
 mkdirSync(join(root,'Contents/Resources/browser'),{recursive:true});
 writeFileSync(ini,'[App]\nName=PaperTrail\n');
 const firefox={name:()=> 'firefox',executablePath:()=>join(root,'Contents/MacOS/firefox')};
 const chromium={name:()=> 'chromium'};
 const options={headless:false,env:{PAPERTRAIL_EXAMPLE_FLAG:'kept'}};
 const scoped=browserLaunchOptions(firefox,options,'darwin');
 assert.equal(scoped.env.XUL_APP_FILE,ini);
 assert.equal(scoped.env.PAPERTRAIL_EXAMPLE_FLAG,'kept');
 assert.equal(scoped.headless,false);
 assert.equal(options.env.XUL_APP_FILE,undefined);
 assert.equal(browserLaunchOptions(firefox,options,'win32'),options);
 assert.equal(browserLaunchOptions(chromium,options,'darwin'),options);
 console.log('Firefox owns its app registry; caller options and other browser engines are preserved');
}finally{rmSync(root,{recursive:true,force:true});}
