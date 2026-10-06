import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {readResearchExchangePage} from '../../src/readers/research_exchange_rows.mjs';
import {advanceIeeeLogin} from '../../src/readers/research_exchange_login.mjs';
import {readerCookies as researchExchangeCookies,saveReaderSession as saveResearchExchangeSession} from '../../src/readers/reader_session.mjs';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
process.env.PLAYWRIGHT_BROWSERS_PATH ||= path.join(root,'build/runtime',process.platform==='darwin'?'macos-arm64':'windows-x64','browsers');
const {chromium}=await import('playwright-core');
const browser=await chromium.launch({headless:true});
try {
  const page=await browser.newPage();
  const card=(journal,number,status,title)=>`<div class="submissionsListItem">
    <div class="submissionsListItem-journalInfoTitle">${journal}</div>
    <h2 class="submissionsListItem-title">${title}</h2>
    <div><div class="submissionsListItem-attributeName">Submission Status</div><div class="submissionsListItem-attributeValue">${status}</div></div>
    <div><div class="submissionsListItem-attributeName">Manuscript ID</div><div class="submissionsListItem-attributeValue">${number}</div></div>
  </div>`;
  await page.setContent(card('IEEE Example Journal','JBHI-001.R1','Under Review','A title')+
    card('Another Journal','OTHER-002','Accepted','Other title'));
  assert.deepEqual(await readResearchExchangePage(page,'IEEE Example Journal'),[
    {number:'JBHI-001.R1',raw_status:'Under Review',title_en:'A title',submitted_at:'',status_date:''}]);

  const login=`<form onsubmit="event.preventDefault();document.body.dataset.submissions=Number(document.body.dataset.submissions||0)+1">
    <label>Username<input name="username"></label><label>Password<input type="password"></label>
    <button type="submit">Sign In</button></form>`;
  await page.route('https://www.ieee.org/login-test',route=>route.fulfill({body:'<iframe src="https://signin.ieee.org/login-test"></iframe>',contentType:'text/html'}));
  await page.route('https://signin.ieee.org/login-test',route=>route.fulfill({body:login,contentType:'text/html'}));
  await page.goto('https://www.ieee.org/login-test');
  const frame=page.frame({url:'https://signin.ieee.org/login-test'});
  await frame.locator('input[type="password"]').waitFor();
  const input={username:'synthetic@example.test',password:'synthetic-password'},progress={};
  await advanceIeeeLogin(page,input,progress);
  await advanceIeeeLogin(page,input,progress);
  assert.equal(await frame.locator('input[name="username"]').inputValue(),'synthetic@example.test');
  assert.equal(await frame.locator('body').getAttribute('data-submissions'),'1');
  assert.equal(input.password,'');

  await page.route('https://www.ieee.org/profile/login-test',route=>route.fulfill({body:
    '<h1>Create an IEEE Account</h1><input type="password"><button>Create Account</button><a href="https://services10.ieee.org/login-test">Sign In ›</a>',contentType:'text/html'}));
  await page.route('https://services10.ieee.org/login-test',route=>route.fulfill({body:login,contentType:'text/html'}));
  await page.goto('https://www.ieee.org/profile/login-test');
  const ieeeInput={username:'synthetic@example.test',password:'synthetic-password'},ieeeProgress={};
  await advanceIeeeLogin(page,ieeeInput,ieeeProgress);
  await page.waitForURL('https://services10.ieee.org/login-test');
  assert.equal(ieeeProgress.signInOpened,true);
  await advanceIeeeLogin(page,ieeeInput,ieeeProgress);
  assert.equal(await page.locator('body').getAttribute('data-submissions'),'1');

  await page.route('https://untrusted.example/login-test',route=>route.fulfill({body:login,contentType:'text/html'}));
  await page.goto('https://untrusted.example/login-test');
  await advanceIeeeLogin(page,{username:'synthetic@example.test',password:'synthetic-password'},{});
  assert.equal(await page.locator('input[name="username"]').inputValue(),'');
  assert.equal(await page.locator('input[type="password"]').inputValue(),'');
} finally {await browser.close();}
const profile_dir=await mkdtemp(path.join(tmpdir(),'papertrail-ieee-session-'));
try {
  const input={profile_dir,username:'synthetic@example.test',login_url:'https://ieee.submission.researchexchange.com/submission/dashboard',password:'never-store-password'};
  const cookies=[{name:'session',value:'synthetic-session',domain:'.example.test',path:'/',expires:-1,httpOnly:true,secure:true,sameSite:'Lax'}];
  await saveResearchExchangeSession({cookies:async()=>cookies},input);
  assert.deepEqual(await researchExchangeCookies(input),cookies);
  assert.ok(!(await readFile(path.join(profile_dir,'session-state.json'),'utf8')).includes(input.password));
  const different={...input,username:'another@example.test'};
  assert.deepEqual(await researchExchangeCookies(different),[]);
  assert.equal(different.reset_session,true);
} finally {await rm(profile_dir,{recursive:true,force:true});}
console.log('IEEE dashboard, framed login and session restoration passed');
