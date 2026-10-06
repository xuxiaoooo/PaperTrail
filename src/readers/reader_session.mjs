import {readFile, writeFile, chmod} from 'node:fs/promises';
const filename = input => input.profile_dir + '/session-state.json';
export async function readerCookies(input) {
  let saved;
  try {saved = JSON.parse(await readFile(filename(input), 'utf8'));}
  catch {return [];}
  if (saved.username !== input.username || saved.login_url !== input.login_url) {
    input.reset_session = true;
    return [];
  }
  return !input.reset_session && Array.isArray(saved.cookies) ? saved.cookies : [];
}
export async function saveReaderSession(context, input) {
  // Keep session cookies when the visible verification browser closes.
  await writeFile(filename(input), JSON.stringify({username:input.username, login_url:input.login_url,
    cookies:await context.cookies()}), {mode:0o600});
  if (process.platform !== 'win32') await chmod(filename(input),0o600);
}
