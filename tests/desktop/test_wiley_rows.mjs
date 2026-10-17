import assert from 'node:assert/strict';
import {readWileyPage, wileyRows} from '../../src/readers/wiley_rows.mjs';

assert.deepEqual(wileyRows([
  {number:'M-001', raw_status:'Under Review', title_en:'Example', publication:'Example Journal'},
  {number:'', raw_status:'Submitted', publication:'Example Journal'},
  {number:'M-002', raw_status:'', publication:'Example Journal'}
], 'Example Journal'), [{number:'M-001', raw_status:'Under Review', title_en:'Example', submitted_at:'', status_date:''}]);

const {chromium} = await import('playwright-core');
const browser = await chromium.launch({headless:true,channel:'chrome'});
try {
  const page = await browser.newPage();
  await page.setContent(`<section data-testid="article-card-123">
    <h2 data-testid="article-title">A manuscript title</h2>
    <div data-testid="article-metadata-publication"><span>Example Journal</span></div>
    <div data-testid="metadata-value-manuscriptId">M-001.R1</div>
    <div data-testid="article-status-container"><span data-testid="status-chip-under-review">Under Review</span></div>
  </section>`);
  assert.deepEqual(await readWileyPage(page), [{number:'M-001.R1', raw_status:'Under Review',
    title_en:'A manuscript title', submitted_at:'', status_date:''}]);
} finally { await browser.close(); }
console.log('Wiley dashboard card extraction passed');
