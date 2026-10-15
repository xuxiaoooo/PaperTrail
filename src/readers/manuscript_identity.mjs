export const titleKey = value => String(value || '').normalize('NFKC').trim().replace(/\s+/g,' ').toLowerCase();
export const numberSeries = value => String(value || '').normalize('NFKC').trim().toLowerCase()
  .replace(/(?:[._-]?r(?:ev(?:ision)?)?[._ -]*\d+|\s*\(r\d+\))$/i,'').replace(/[ ._-]+$/,'');

export function matchesTracked(paper,row){
  if(paper.number && row.number && numberSeries(paper.number)===numberSeries(row.number))return true;
  return Boolean(titleKey(paper.title_en) && titleKey(paper.title_en)===titleKey(row.title_en||row.title));
}

