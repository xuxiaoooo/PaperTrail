import assert from 'node:assert/strict';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {openReaderContext, closeReaderContext} from '../../src/readers/reader_context.mjs';
import {ensureEditorialManagerLogin} from '../../src/readers/editorial_manager_login.mjs';
import {readEditorialManagerTable} from '../../src/readers/editorial_manager_rows.mjs';
import {readerCookies, saveReaderSession} from '../../src/readers/reader_session.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const target = process.platform === 'darwin' ? 'macos-arm64' : 'windows-x64';
const runtime = process.env.PAPERTRAIL_TEST_RUNTIME || path.join(root, 'build/runtime', target);
const profile = await mkdtemp(path.join(os.tmpdir(), 'papertrail-em-login-'));
const input = {profile_dir: profile,
  browser_module: path.join(runtime, 'browser-module/playwright-core/index.mjs'),
  username: 'fixture-author', password: '', interactive: false};
const base = 'https://www.editorialmanager.com/fixture/';
input.login_url = base;
let context, loginPosts = 0, mode = 'frame-form', restoreQueue = false;
const open = async () => {
  const cookies = await readerCookies(input);
  context = await openReaderContext(input, {headless: true});
  if (cookies.length) await context.addCookies(cookies);
  await context.route(base + '**', async route => {
    const request = route.request(), url = new URL(request.url());
    let authenticated = /fixture-session=valid/.test(request.headers().cookie || '') || url.pathname.endsWith('/manual-success');
    const headers = {'content-type': 'text/html'};
    if (request.method() === 'POST') {
      loginPosts++;
      const fields = new URLSearchParams(request.postData());
      assert.equal(fields.get('username'), input.username);
      assert.equal(fields.get('password'), 'synthetic-secret');
      if (!['rejected-form','manual-login'].includes(mode)) {
        authenticated = true;
        headers['set-cookie'] = 'fixture-session=valid; '+(mode === 'modern-menu' ? '' : 'Max-Age=3600; ')+'Path=/; Secure; HttpOnly';
      }
    }
    let body;
    if (mode === 'rejected-form' && request.method() === 'POST') body = '<p>The Username or Password you entered does not match any records in our database.</p>';
    else if (mode === 'manual-login' && request.method() === 'POST') body = `<p>The Username or Password you entered does not match any records in our database.</p><a href="${base}manual-success">Complete manual login</a>`;
    else if (authenticated && ['modern-menu','manual-login'].includes(mode)) body = '<header>Fixture Author <a onclick="void(0)">Logout</a></header><nav><a href="main">Main Menu</a></nav><main></main>';
    else if (authenticated) body = restoreQueue ? `<table id="datatable"><thead><tr>
      <th>Manuscript Number</th><th>Title</th><th>Initial Date Submitted</th><th>Current Status</th>
      </tr></thead><tbody><tr><td>TEST-001</td><td>Fixture manuscript</td><td>02 Oct 2026</td><td>Under Review</td></tr></tbody></table>`
      : '<h1>Author Main Menu</h1><a href="#">Submissions Being Processed</a>';
    else if (mode === 'landing' && !url.pathname.endsWith('/login')) body = `<a href="${base}login">Login</a>`;
    else if (mode === 'frame-form' && !url.pathname.endsWith('/login')) body = `<iframe id="content" src="${base}login"></iframe>`;
    else if (mode === 'collapsed-form' && !url.pathname.endsWith('/login')) body = `<iframe id="content" src="${base}login"></iframe>`;
    else if (mode === 'collapsed-form') body = `<button aria-expanded="false" onclick="this.setAttribute('aria-expanded','true');document.querySelector('form').hidden=false">▶ Alternatively, use your username and password</button>
      <form hidden method="post" action="${base}login"><input name="username"><input type="password" name="password"><button>Author Login</button></form>`;
    else body = `<form method="post" action="${base}login"><input name="username"><input type="password" name="password"><button>Author Login</button></form>`;
    await route.fulfill({headers, body});
  });
  return context.pages()[0] || await context.newPage();
};
const login = async page => {
  input.password = 'synthetic-secret';
  await page.goto(base);
  await ensureEditorialManagerLogin(page, input, {timeout: 5000});
  assert.equal(input.password, '');
};
try {
  let page = await open();
  await login(page);
  assert.equal(loginPosts, 1); // Embedded form with no top-level Login link or logout selector.
  await closeReaderContext(context); context = undefined;
  restoreQueue = true;
  page = await open();
  await login(page);
  assert.equal(loginPosts, 1); // Persisted cookie survives an actual browser restart.
  assert.equal((await readEditorialManagerTable(page))[0].number, 'TEST-001');
  await context.clearCookies();
  mode = 'landing'; restoreQueue = false;
  await login(page);
  assert.equal(loginPosts, 2); // Expired session opens the landing page's Login link.
  await context.clearCookies(); mode = 'top-form';
  await login(page);
  assert.equal(loginPosts, 3); // Direct login form also works without a navigation link.
  await context.clearCookies(); mode = 'collapsed-form';
  await login(page);
  assert.equal(loginPosts, 4); // Elsevier's default hides the EM password form behind an expandable button.
  await context.clearCookies(); mode = 'rejected-form';
  await assert.rejects(login(page), {message: 'invalid_credentials'});
  assert.equal(loginPosts, 5);
  assert.equal(input.password, '');
  await context.clearCookies(); mode = 'modern-menu';
  await login(page);
  assert.equal(loginPosts, 6); // Current EM header exposes Logout before the author content is loaded.
  assert.equal(await page.locator('iframe').count(), 0);
  assert.equal((await context.cookies()).find(c=>c.name==='fixture-session').expires, -1);
  await saveReaderSession(context, input);
  assert.ok(!(await readFile(path.join(profile, 'session-state.json'), 'utf8')).includes('synthetic-secret'));
  await closeReaderContext(context); context = undefined;
  page = await open();
  input.password = '';
  await page.goto(base);
  await ensureEditorialManagerLogin(page, input, {timeout: 5000});
  assert.equal(loginPosts, 6); // Verification remains valid after closing the window, including session-only cookies.
  const otherJournal = {...input, login_url: 'https://www.editorialmanager.com/another/'};
  assert.deepEqual(await readerCookies(otherJournal), []);
  assert.equal(otherJournal.reset_session, true);
  await context.clearCookies(); mode = 'manual-login'; input.interactive = true;
  const manualLogin = login(page);
  await page.getByRole('link', {name: 'Complete manual login'}).click();
  await manualLogin;
  assert.equal(loginPosts, 7); // A visible window lets the user correct a rejected password and complete login.
  console.log('EM modern header, manual-login recovery, session-only cookie restoration and credential rejection passed.');
} finally {
  if (context) await closeReaderContext(context);
  await rm(profile, {recursive: true, force: true});
}
