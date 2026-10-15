// MDPI SuSy author manuscript tables. Reject unknown layouts instead of recording empty reads.
const key = value => String(value || '').normalize('NFKC').toLowerCase().replace(/[^a-z0-9\u3400-\u9fff]/g, '');
const column = (headers, names) => headers.findIndex(header => names.some(name => header === name || header.includes(name)));

export function mdpiRows(tables, journalName = '') {
  const rows = [];
  let recognized = false;
  for (const table of tables) {
    const headers = table.headers.map(key);
    const number = column(headers, ['manuscriptid', 'manuscriptnumber', '稿件编号']);
    const status = column(headers, ['manuscriptstatus', 'status', '稿件状态']);
    if (number < 0 || status < 0) continue;
    recognized = true;
    const journal = column(headers, ['journal', '期刊']);
    const title = column(headers, ['title', '标题']);
    const submitted = column(headers, ['submissiondate', 'submitteddate', 'dateofsubmission']);
    for (const cells of table.rows) {
      const value = index => index < 0 ? '' : String(cells[index] || '').trim();
      if (journal >= 0 && journalName && value(journal) && key(value(journal)) !== key(journalName)) continue;
      if (value(number) && value(status)) rows.push({number:value(number), raw_status:value(status),
        title_en:value(title), submitted_at:value(submitted), status_date:''});
    }
  }
  return {recognized, rows};
}

export async function readMdpiPage(page, journalName) {
  const tables = await page.locator('table').evaluateAll(elements => elements.map(table => {
    const headers = [...table.querySelectorAll('thead th')].map(cell => cell.textContent.trim());
    if (!headers.length) headers.push(...[...table.querySelectorAll('tr:first-child th')].map(cell => cell.textContent.trim()));
    const rows = [...table.querySelectorAll('tbody tr')].map(row => [...row.querySelectorAll('td')].map(cell => cell.textContent.trim()));
    return {headers, rows};
  }));
  return mdpiRows(tables, journalName);
}
