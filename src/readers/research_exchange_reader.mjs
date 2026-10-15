import {writeFile} from 'node:fs/promises';
import {openReaderContext, closeReaderContext} from './reader_context.mjs';
import {isIeeePortalUrl} from './portal_urls.mjs';
import {readResearchExchangePage} from './research_exchange_rows.mjs';
import {advanceIeeeLogin} from './research_exchange_login.mjs';
import {saveReaderSession} from './reader_session.mjs';
import {runReader} from './reader_worker.mjs';
import {ieeeLoginFailure} from './ieee_response.mjs';
import {matchesTracked} from './manuscript_identity.mjs';

let context, page;

async function read(input) {
  let stage = 'browser', emptyLoginResponse = false;
  const progress = {emailSubmitted:false, passwordSubmitted:false, signInOpened:false};
  try {
    if (!isIeeePortalUrl(input.login_url) || input.login_method !== 'password') throw new Error('unsupported_journal');
    if (!context) {
      context = await openReaderContext(input, {headless:input.interactive !== true,
        chromiumSandbox:true, viewport:{width:1280,height:900}, timeout:30000});
      context.on('close', () => {context = undefined; page = undefined;});
    }
    page = context.pages()[0] || await context.newPage();
    page.setDefaultTimeout(20000);
    page.setDefaultNavigationTimeout(40000);
    const onResponse = response => {
      if (response.request().isNavigationRequest() && /\.ieee\.org$/.test(new URL(response.url()).hostname))
        emptyLoginResponse = response.status() === 202;
    };
    page.on('response', onResponse);
    stage = 'login';
    try {
      // A nearby repeat read can use the already authenticated dashboard.
      if (!await page.locator('.submissionsList').isVisible().catch(() => false))
        await page.goto(input.login_url, {waitUntil:'domcontentloaded'});
      const deadline = Date.now() + (input.interactive ? 240000 : 75000);
      let reloadedEmpty = false;
      while (Date.now() < deadline) {
        if (await page.locator('.submissionsList').isVisible().catch(() => false)) break;
        const reject = page.getByRole('button', {name:/reject.*(?:non-essential|nonessential|non-essential)|拒绝非必要的/i}).first();
        if (await reject.isVisible().catch(() => false)) await reject.click();
        await advanceIeeeLogin(page, input, progress);
        if (emptyLoginResponse && !await page.locator('input').count()) {
          if (!reloadedEmpty) {
            reloadedEmpty = true;
            await page.reload({waitUntil:'domcontentloaded'});
          } else if (!input.interactive) throw new Error('verification_required');
        }
        await page.waitForTimeout(400);
      }
      if (!await page.locator('.submissionsList').isVisible().catch(() => false))
        throw new Error(ieeeLoginFailure({emptyLoginResponse,title:await page.title().catch(()=> '')}));
    } finally {page.removeListener('response', onResponse);}
    input.password = '';
    stage = 'read';
    await saveReaderSession(context, input);
    const found = new Map();
    if (!input.connect_only) for (let batch = 0; batch < 100; batch++) {
      const rows = await readResearchExchangePage(page, input.journal_name);
      for (const row of rows.filter(row => input.tracked.some(paper => matchesTracked(paper, row)))) found.set(row.number, row);
      const count = await page.locator('.submissionsListItem').count();
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      try {
        await page.waitForFunction(previous => document.querySelectorAll('.submissionsListItem').length > previous,
          count, {timeout:8000});
      } catch (error) {if (error.name === 'TimeoutError') break; throw error;}
    }
    process.stdout.write(JSON.stringify({ok:true, rows:[...found.values()]}) + '\n');
  } catch (error) {
    let code = stage === 'browser' ? 'browser_unavailable' : stage === 'read' ? 'read_incomplete' : 'login_incomplete';
    if (['unsupported_journal','credentials_rejected','ieee_login_unavailable','verification_required'].includes(error.message)) code = error.message;
    if (page) {
      const title = await page.title().catch(() => '');
      if (ieeeLoginFailure({title}) === 'verification_required') code = 'verification_required';
      for (const frame of page.frames()) {
        const passwords = frame.locator('input[type="password"]');
        for (const password of await passwords.all()) if (await password.isVisible().catch(() => false)) await password.fill('').catch(() => {});
      }
      const url = new URL(page.url());
      const reason = String(error.message).split('\n')[0].replace(/https?:\/\/[^\s)]+/g, address => {
        try {const parsed = new URL(address); return parsed.origin + parsed.pathname;} catch {return '[website]';}
      });
      await writeFile(input.profile_dir + '/last-read-error.json', JSON.stringify({stage, code,
        error:error.name, reason, path:url.origin + url.pathname, login_submitted:progress.passwordSubmitted,
        sign_in_opened:progress.signInOpened}), {mode:0o600}).catch(() => {});
    }
    process.stdout.write(JSON.stringify({ok:false, code}) + '\n');
    if (!input.keep_browser) process.exitCode = 1;
  } finally {
    input.password = '';
    if (context && !input.keep_browser) {await closeReaderContext(context).catch(() => {}); context = undefined;}
  }
}
await runReader(read, async () => {if (context) await closeReaderContext(context); context = undefined;});
