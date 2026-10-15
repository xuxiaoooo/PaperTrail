import {openReaderContext,closeReaderContext} from './reader_context.mjs';
import {isMdpiSusyUrl} from './portal_urls.mjs';
import {readMdpiPage} from './mdpi_rows.mjs';
import {runReader} from './reader_worker.mjs';
import {matchesTracked} from './manuscript_identity.mjs';

let context, page;
const trustedLogin = value => {
  try {const url=new URL(value);return url.protocol==='https:' && ['login.mdpi.com','susy.mdpi.com'].includes(url.hostname);} catch {return false;}
};

async function read(input) {
  let stage='browser', responseStatus=0;
  try {
    if (!isMdpiSusyUrl(input.login_url) || input.login_method !== 'password') throw new Error('unsupported_journal');
    if (!context) {
      context=await openReaderContext(input,{headless:input.interactive!==true,channel:'chromium',
        chromiumSandbox:true,viewport:{width:1280,height:900},timeout:30000});
      context.on('close',()=>{context=undefined;page=undefined;});
    }
    page=context.pages()[0] || await context.newPage();
    page.setDefaultTimeout(15000);
    page.setDefaultNavigationTimeout(40000);
    stage='login';
    const dashboard='https://susy.mdpi.com/user/manuscripts/status';
    const current=new URL(page.url());
    if (current.origin!=='https://susy.mdpi.com' || !current.pathname.startsWith('/user/manuscripts/')) {
      const response=await page.goto(dashboard,{waitUntil:'domcontentloaded'});
      responseStatus=response?.status() || 0;
    }
    const deadline=Date.now()+(input.interactive?240000:75000);
    let submitted=false,authenticated=false,sawChallenge=false;
    while (Date.now()<deadline) {
      const title=await page.title().catch(()=>'');
      if ([202,403,429].includes(responseStatus) || /access denied|just a moment|security check|verify you are human/i.test(title)) {
        sawChallenge=true;
        if(!input.interactive)throw new Error('verification_required');
        responseStatus=0;await page.waitForTimeout(500);continue;
      }
      if (page.url().startsWith('https://susy.mdpi.com/user/manuscripts/') &&
          (await page.locator('table').count() || await page.getByText(/no manuscripts|no records/i).count() ||
           await page.locator('a[href*="/user/manuscripts/status"]').count())) {
        authenticated=true;break;
      }
      if (trustedLogin(page.url()) && await page.getByText(/invalid credentials|incorrect password|incorrect email|wrong password/i).first().isVisible().catch(()=>false))
        throw new Error('credentials_rejected');
      if (trustedLogin(page.url()) && !submitted) {
        const email=page.locator('input[type="email"],input[name="email"],input[name="username"]').first();
        const password=page.locator('input[type="password"]').first();
        const button=page.getByRole('button',{name:/sign in|log in|login/i}).first();
        if (await email.isVisible().catch(()=>false) && await password.isVisible().catch(()=>false) &&
            await button.isVisible().catch(()=>false)) {
          await email.fill(input.username);await password.fill(input.password);input.password='';
          submitted=true;await button.click({noWaitAfter:true});
        }
      }
      await page.waitForTimeout(500);
    }
    if (!authenticated) throw new Error(sawChallenge?'verification_required':'login_incomplete');
    if (!page.url().includes('/status')) {
      const response=await page.goto(dashboard,{waitUntil:'domcontentloaded'});
      if([202,403,429].includes(response?.status()))throw new Error('verification_required');
    }
    input.password='';
    stage='read';
    const found=new Map();let recognized=false;
    if (!input.connect_only) for (let index=0;index<30;index++) {
      const result=await readMdpiPage(page,input.journal_name);
      recognized ||= result.recognized;
      for (const row of result.rows.filter(row=>input.tracked.some(paper=>matchesTracked(paper,row)))) found.set(row.number,row);
      const next=page.getByRole('link',{name:/^next(?: page)?$|^下一页$/i}).first();
      if (!await next.isVisible().catch(()=>false) || await next.getAttribute('aria-disabled')==='true') break;
      await Promise.all([page.waitForLoadState('domcontentloaded').catch(()=>{}),next.click()]);
    }
    if (!input.connect_only && !recognized && !await page.getByText(/no manuscripts|no records/i).count())
      throw new Error('unrecognized_table');
    process.stdout.write(JSON.stringify({ok:true,rows:[...found.values()]})+'\n');
  } catch (error) {
    const code=['unsupported_journal','verification_required','login_incomplete','unrecognized_table','credentials_rejected'].includes(error.message)
      ? error.message : stage==='browser'?'browser_unavailable':stage==='read'?'read_incomplete':'login_incomplete';
    process.stdout.write(JSON.stringify({ok:false,code})+'\n');
    if (!input.keep_browser) process.exitCode=1;
  } finally {
    input.password='';
    if(context&&!input.keep_browser){await closeReaderContext(context).catch(()=>{});context=undefined;}
  }
}
await runReader(read,async()=>{if(context)await closeReaderContext(context);context=undefined;});
