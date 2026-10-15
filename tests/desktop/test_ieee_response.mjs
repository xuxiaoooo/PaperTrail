import assert from 'node:assert/strict';
import {ieeeLoginFailure} from '../../src/readers/ieee_response.mjs';
assert.equal(ieeeLoginFailure({emptyLoginResponse:true,title:'Create an IEEE Account'}),'verification_required');
assert.equal(ieeeLoginFailure({title:'Access Denied'}),'verification_required');
assert.equal(ieeeLoginFailure({title:'Sign In'}),'login_incomplete');
console.log('IEEE repeated 202 response is routed to manual verification');
