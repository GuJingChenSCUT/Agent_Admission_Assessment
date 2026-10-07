import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectLockfile } from '../src/inspection/osv.js';
import { parseStrictJson } from '../src/strict-json.js';
const lock={lockfileVersion:3,packages:{'':{},'node_modules/demo':{version:'1.2.3'}}};
test('OSV adapter consumes all pages and retrieves full records',async()=>{
  const paths=[];const result=await inspectLockfile(lock,async(path,body)=>{paths.push(path);if(path.includes('/vulns/'))return{id:'OSV-1',modified:'2026-01-01T00:00:00Z',affected:[],aliases:['CVE-2026-1']};return body.page_token?{vulns:[{id:'OSV-1'}]}:{next_page_token:'page2'};});
  assert.equal(result.status,'FAIL');assert.equal(result.requests,3);assert.equal(paths.at(-1),'/v1/vulns/OSV-1');
});
test('OSV outage, repeated page or unresolved version never returns PASS',async()=>{
  assert.equal((await inspectLockfile(lock,async()=>{throw Error('timeout')})).status,'INCONCLUSIVE');
  assert.equal((await inspectLockfile(lock,async()=>({next_page_token:'same'}))).status,'INCONCLUSIVE');
  assert.equal((await inspectLockfile({lockfileVersion:3,packages:{x:{version:'^1.0.0'}}},async()=>({}))).status,'INCONCLUSIVE');
});
test('strict JSON rejects duplicate keys, depth and non-finite numbers',()=>{
  assert.throws(()=>parseStrictJson('{"a":1,"a":2}'),/DUPLICATE/);
  assert.throws(()=>parseStrictJson('['.repeat(34)+'0'+']'.repeat(34)),/DEEP/);
  assert.throws(()=>parseStrictJson('{"a":1e9999}'),/FINITE/);
  assert.deepEqual(parseStrictJson('{"a":"literal \\"quote\\"","b":[1,true,null]}'),{a:'literal "quote"',b:[1,true,null]});
});
