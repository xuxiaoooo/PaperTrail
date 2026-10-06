import assert from 'node:assert/strict';
import {isScholarOneUrl,isEditorialManagerUrl,isWileyUrl,isIeeePortalUrl} from '../../src/readers/portal_urls.mjs';

for (const url of ['https://mc.manuscriptcentral.com/taes',
  'https://mc03.manuscriptcentral.com/scis/', 'https://mc12.manuscriptcentral.com/future-journal']) {
  assert.equal(isScholarOneUrl(url), true);
}
for (const url of ['https://example.com/taes', 'https://mc.manuscriptcentral.com',
  'http://mc.manuscriptcentral.com/taes']) {
  assert.equal(isScholarOneUrl(url), false);
}
console.log('ScholarOne URL recognition passed');

for (const url of ['https://www.editorialmanager.com/example',
  'https://www.editorialmanager.com/another/default.aspx', 'https://www.editorialmanager.com/tim/default2.aspx']) {
  assert.equal(isEditorialManagerUrl(url), true);
}
for (const url of ['https://authors.wiley.com/journal/MRM',
  'https://submission.wiley.com/journal/EXAMPLE',
  'https://authors.wiley.com/dashboard/journal/MRM/']) {
  assert.equal(isWileyUrl(url), true);
}
for (const check of [isScholarOneUrl,isEditorialManagerUrl,isWileyUrl]) {
  assert.equal(check('https://example.com/login'), false);
  assert.equal(check('https://css.paperplaza.net/journals/tac/scripts/login.pl'), false);
  assert.equal(check('https://ojs.example.test/index.php/journal/login'), false);
}
assert.equal(isEditorialManagerUrl('https://www.editorialmanager.com.example.com/journal'), false);
assert.equal(isWileyUrl('https://authors.wiley.com.evil.test/journal/MRM'), false);
console.log('Editorial Manager and Wiley journal entry recognition passed');

assert.equal(isIeeePortalUrl('https://ieee.submission.researchexchange.com/submission/dashboard'), true);
assert.equal(isIeeePortalUrl('https://ieee.submission.researchexchange.com/submission/dashboard?journalCode=JBHI'), true);
assert.equal(isIeeePortalUrl('https://ieee.submission.researchexchange.com/submission/'), true);
assert.equal(isIeeePortalUrl('https://ieee.submission.researchexchange.com.evil.test/submission/dashboard'), false);
assert.equal(isIeeePortalUrl('http://ieee.submission.researchexchange.com/submission/dashboard'), false);
console.log('IEEE Research Exchange portal recognition passed');
