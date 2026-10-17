import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openReaderContext,closeReaderContext} from '../../src/readers/reader_context.mjs';
const root=await mkdtemp(join(tmpdir(),'papertrail-context-'));
try {
 const modulePath=join(root,'fake-browser.mjs');
 await writeFile(modulePath,'export const chromium={async launchPersistentContext(profile,options){return {profile,options,closed:false,addedCookies:[],async cookies(){return [];},async addCookies(cookies){this.addedCookies.push(...cookies);},async close(){this.closed=true;},async clearCookies(){this.cookiesCleared=true;},async addInitScript(){this.storageReset=true;}};}};');
 const input=name=>({browser_module:modulePath,profile_dir:join(root,name),username:name,login_url:'https://mc.manuscriptcentral.com/example'});
 const a=await openReaderContext(input('author-a'),{headless:true});
 const b=await openReaderContext(input('author-b'),{headless:true});
 assert.notEqual(a.profile,b.profile);
 assert.equal(a.options.channel,'chrome');
 await closeReaderContext(a);
 assert.equal(b.closed,false,'Account browser lifetimes are independent');
 const reset=await openReaderContext({...input('changed-author'),reset_session:true},{headless:false});
 assert.ok(reset.cookiesCleared&&reset.storageReset,'Changed account identity clears the old login');
 assert.equal(reset.options.headless,false,'Manual verification remains visible');
 const legacy=join(root,'old-session');
 await mkdir(legacy);
 await writeFile(join(legacy,'session-state.json'),JSON.stringify({username:'new-author',login_url:'https://mc.manuscriptcentral.com/example',cookies:[{name:'session',value:'old-session',domain:'mc.manuscriptcentral.com',path:'/'}]}));
 const migrated=await openReaderContext({...input('new-author'),legacy_session_dir:legacy},{headless:true});
 assert.equal(migrated.addedCookies[0].value,'old-session','Existing login cookies transfer to Chrome');
 await Promise.all([b,reset,migrated].map(closeReaderContext));
 console.log('PASS: per-account profiles, independent lifetime, changed identity, visible verification');
}finally{await rm(root,{recursive:true,force:true});}
