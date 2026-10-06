// Research Exchange Submission dashboard cards, including the IEEE Author Portal.
const key = value => String(value || '').normalize('NFKC').toLowerCase()
  .replace(/&/g, 'and').replace(/[^a-z0-9\u3400-\u9fff]/g, '');

export function researchExchangeRows(cards, journalName = '') {
  const expected = key(journalName);
  return cards.filter(card => !expected || !card.journal || key(card.journal) === expected)
    .map(card => ({number:String(card.number || '').trim(),
      raw_status:String(card.raw_status || '').trim(), title_en:String(card.title_en || '').trim(),
      submitted_at:'', status_date:''}))
    .filter(row => row.number && row.raw_status);
}

export async function readResearchExchangePage(page, journalName) {
  const cards = await page.locator('.submissionsListItem').evaluateAll(elements => elements.map(card => {
    const values = new Map([...card.querySelectorAll('.submissionsListItem-attributeName')]
      .map(label => [label.textContent.trim().toLowerCase().replace(/:$/, ''),
        label.parentElement.querySelector('.submissionsListItem-attributeValue')?.textContent.trim() || '']));
    return {journal:card.querySelector('.submissionsListItem-journalInfoTitle')?.textContent,
      title_en:card.querySelector('.submissionsListItem-title')?.textContent,
      number:values.get('manuscript id'), raw_status:values.get('submission status')};
  }));
  return researchExchangeRows(cards, journalName);
}
