// Read the author's Wiley Research Exchange dashboard without opening a submission.
import {mkdir, chmod, writeFile} from 'node:fs/promises';
import {openReaderContext, closeReaderContext} from './reader_context.mjs';
import {isWileyUrl} from './portal_urls.mjs';
import {readWileyPage} from './wiley_rows.mjs';
import {runReader} from './reader_worker.mjs';

let context, page;
const baseNumber = value => String(value || '').replace(/(?:\.R|R)\d+$/i, '');
const tracked = (input, row) => input.tracked.some(paper =>
  paper.number && baseNumber(paper.number) === baseNumber(row.number));

async function read(input) {
  let stage = 'browser';
  let submittedPassword = false;
  try {
    if (!isWileyUrl(input.login_url) || input.login_method !== 'password')
      throw new Error('unsupported_journal');
    await mkdir(input.profile_dir, {recursive: true, mode: 0o700});
    if (process.platform !== 'win32') await chmod(input.profile_dir, 0o700);
    if (!context) {
      context = await openReaderContext(input, {
        headless: input.interactive !== true, chromiumSandbox: true,
        viewport: {width: 1280, height: 900}, timeout: 30000
      });
      context.on('close', () => { context = undefined; page = undefined; });
    }
    page = context.pages()[0] || await context.newPage();
    page.setDefaultTimeout(12000);
    page.setDefaultNavigationTimeout(40000);
    stage = 'login';
    await page.goto(input.login_url, {waitUntil: 'domcontentloaded'});
    const cards = page.locator('[data-testid^="article-card-"]');
    const email = page.locator('#email-input, input[type="email"]').first();
    const password = page.locator('input[type="password"]').first();
    const deadline = Date.now() + (input.interactive ? 240000 : 85000);
    let submittedEmail = false;
    while (Date.now() < deadline) {
      if (await cards.count()) break;
      const url = page.url();
      const signedIn = /(?:authors|submission)\.wiley\.com$/.test(new URL(url).hostname);
      const emptyDashboard = await page.getByText(/you have no submissions|no submissions found|no manuscripts found/i).first().isVisible().catch(() => false);
      if (signedIn && emptyDashboard) break;
      if (await email.isVisible().catch(() => false) && !submittedEmail) {
        await email.fill(input.username);
        const continueButton = page.locator('#sign-in-btn').first();
        if (await continueButton.isVisible().catch(() => false)) await continueButton.click();
        else await email.press('Enter');
        submittedEmail = true;
      } else if (await password.isVisible().catch(() => false) && !submittedPassword) {
        stage = 'credentials';
        await password.fill(input.password);
        input.password = '';
        const submit = page.locator('#sign-in-btn, button[type="submit"]').first();
        if (await submit.isVisible().catch(() => false)) await submit.click();
        else await password.press('Enter');
        submittedPassword = true;
      } else if (signedIn && await page.getByRole('link', {name: /my submissions/i}).first().isVisible().catch(() => false)) {
        await page.getByRole('link', {name: /my submissions/i}).first().click();
      } else if (!submittedEmail && !submittedPassword) {
        const signIn = page.getByRole('button', {name: /sign in|log in/i}).first();
        if (await signIn.isVisible().catch(() => false)) await signIn.click();
      }
      if (await page.getByText(/incorrect password|invalid password|invalid credentials|incorrect email/i).first().isVisible().catch(() => false))
        throw new Error('credentials_rejected');
      await page.waitForTimeout(500);
    }
    input.password = '';
    if (!await cards.count() && !await page.getByText(/you have no submissions|no submissions found|no manuscripts found/i).first().isVisible().catch(() => false))
      throw new Error('login_incomplete');
    stage = 'read';
    const collected = new Map();
    for (let current = 1; current <= 100; current++) {
      for (const row of (await readWileyPage(page)).filter(row => tracked(input, row)))
        collected.set(row.number, row);
      if (input.tracked.every(paper => [...collected.values()].some(row =>
        baseNumber(row.number) === baseNumber(paper.number)))) break;
      const next = page.locator(`[data-testid="pagination-item-${current + 1}"]`).first();
      if (!await next.isVisible().catch(() => false) || await next.isDisabled().catch(() => true)) break;
      const firstCard = await cards.first().getAttribute('data-testid').catch(() => '');
      await next.click();
      if (firstCard) await page.waitForFunction(previous =>
        document.querySelector('[data-testid^="article-card-"]')?.getAttribute('data-testid') !== previous,
        firstCard, {timeout: 12000}).catch(() => {});
    }
    process.stdout.write(JSON.stringify({ok: true, rows: [...collected.values()]}) + '\n');
  } catch (error) {
    let code = stage === 'browser' ? 'browser_unavailable' : stage === 'read' ? 'read_incomplete' : 'login_incomplete';
    if (['unsupported_journal', 'credentials_rejected'].includes(error.message)) code = error.message;
    if (page) {
      const title = await page.title().catch(() => '');
      if (/just a moment|请稍候/i.test(title) || await page.getByText(/verify you are human|security check|verification code|two.factor/i).first().isVisible().catch(() => false))
        code = 'verification_required';
      const secret = page.locator('input[type="password"]');
      if (await secret.isVisible().catch(() => false)) await secret.fill('').catch(() => {});
      await writeFile(input.profile_dir + '/last-read-error.json', JSON.stringify({stage, error: error.name, title}), {mode: 0o600}).catch(() => {});
      await page.screenshot({path: input.profile_dir + '/last-read-error.png'}).catch(() => {});
    }
    process.stdout.write(JSON.stringify({ok: false, code}) + '\n');
    if (!input.keep_browser) process.exitCode = 1;
  } finally {
    input.password = '';
    if (context && !input.keep_browser) {
      await closeReaderContext(context).catch(() => {});
      context = undefined;
    }
  }
}

await runReader(read, async () => {
  if (context) await closeReaderContext(context);
  context = undefined;
});
