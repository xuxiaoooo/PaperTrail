// Each account retains its existing browser profile and its own authenticated context.
import {mkdir,chmod} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {readerCookies,saveReaderSession} from './reader_session.mjs';
import {browserLaunchOptions} from './browser_launch.mjs';
const sessions=new WeakMap();
export async function openReaderContext(input,options) {
  await mkdir(input.profile_dir,{recursive:true,mode:0o700});
  if(process.platform!=='win32') await chmod(input.profile_dir,0o700);
  const module=await import(pathToFileURL(input.browser_module).href);
  const type=module[input.browser_engine==='firefox'?'firefox':'chromium'];
  const cookies=await readerCookies(input);
  const context=await type.launchPersistentContext(input.profile_dir,browserLaunchOptions(type,options));
  if(input.reset_session) {
    await context.clearCookies();
    await context.addInitScript(()=>{sessionStorage.clear();localStorage.clear();});
  }
  if(cookies.length)await context.addCookies(cookies);
  sessions.set(context,{profile_dir:input.profile_dir,username:input.username,login_url:input.login_url});
  return context;
}
export async function closeReaderContext(context) {
  const identity=sessions.get(context);
  try{if(identity)await saveReaderSession(context,identity);}catch{}
  finally{sessions.delete(context);await context.close();}
}
