import {readFile, writeFile, chmod} from 'node:fs/promises';
const filename = directory => directory + '/session-state.json';
export async function readerCookies(input) {
  let saved;
  for(const directory of [input.profile_dir,input.legacy_session_dir].filter(Boolean)){
    try{saved=JSON.parse(await readFile(filename(directory),'utf8'));break;}
    catch(error){if(error.code!=='ENOENT')return [];}
  }
  if(!saved)return [];
  if (saved.username !== input.username || saved.login_url !== input.login_url) {
    input.reset_session = true;
    return [];
  }
  return !input.reset_session && Array.isArray(saved.cookies) ? saved.cookies : [];
}
export async function saveReaderSession(context, input) {
  // Keep session cookies when the visible verification browser closes.
  await writeFile(filename(input.profile_dir), JSON.stringify({username:input.username, login_url:input.login_url,
    cookies:await context.cookies()}), {mode:0o600});
  if (process.platform !== 'win32') await chmod(filename(input.profile_dir),0o600);
}
