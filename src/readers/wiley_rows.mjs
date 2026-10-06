const key = value => String(value || '').normalize('NFKC').toLowerCase()
  .replace(/&/g, 'and').replace(/[^a-z0-9\u3400-\u9fff]/g, '');

export function wileyRows(cards, journalName = '') {
  const expected = key(journalName);
  const rows = [];
  for (const card of cards) {
    if (expected && card.publication && key(card.publication) !== expected) continue;
    const number = String(card.number || '').trim();
    const raw_status = String(card.raw_status || '').trim();
    if (!number || !raw_status) continue;
    rows.push({
      number, raw_status, title_en: String(card.title_en || '').trim(),
      submitted_at: '', status_date: ''
    });
  }
  return rows;
}

export async function readWileyPage(page, journalName) {
  const cards = await page.locator('[data-testid^="article-card-"]').evaluateAll(elements =>
    elements.map(card => ({
      number: card.querySelector('[data-testid="metadata-value-manuscriptId"]')?.textContent,
      raw_status: card.querySelector('[data-testid="article-status-container"] [data-testid^="status-chip-"]')?.textContent,
      title_en: card.querySelector('[data-testid="article-title"]')?.textContent,
      publication: card.querySelector('[data-testid="article-metadata-publication"] span')?.textContent
        || card.querySelector('[data-testid="article-metadata-publication"]')?.textContent?.replace(/^Publication:\s*/i, '')
    }))
  );
  return wileyRows(cards, journalName);
}
