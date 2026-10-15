import assert from 'node:assert/strict';
import {numberSeries,matchesTracked} from '../../src/readers/manuscript_identity.mjs';
for(const revision of ['MS-123.R1','MS-123R2','MS-123-R3','MS-123_Rev4','MS-123 (R5)'])
  assert.equal(numberSeries(revision),'ms-123');
const paper={number:'MS-123',title_en:'A Stable Title'};
assert.equal(matchesTracked(paper,{number:'MS-123-Rev2',title_en:'Changed Title'}),true);
assert.equal(matchesTracked(paper,{number:'NEW-456',title_en:'A stable title'}),true);
assert.equal(matchesTracked(paper,{number:'OTHER-1',title_en:'Different paper'}),false);
console.log('Reader manuscript identity follows revision suffixes and unique-title fallback');
