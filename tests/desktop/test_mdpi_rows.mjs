import assert from 'node:assert/strict';
import {mdpiRows} from '../../src/readers/mdpi_rows.mjs';
const table={headers:['Manuscript-ID','Journal','Title','Submission Date','Manuscript Status'],rows:[
  ['sensors-123456','Sensors','First paper','2026-09-30','Under review'],
  ['plants-765432','Plants','Another paper','2026-10-01','Pending major revisions']
]};
assert.deepEqual(mdpiRows([table],'Sensors'),{recognized:true,rows:[{
  number:'sensors-123456',title_en:'First paper',submitted_at:'2026-09-30',raw_status:'Under review',status_date:''
}]});
assert.deepEqual(mdpiRows([{headers:['Unrelated','Title'],rows:[['x','y']]}]),{recognized:false,rows:[]});
console.log('MDPI SuSy table selection and layout guard passed');
