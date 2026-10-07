const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path').resolve(__dirname,'..');
const {keccak256,canonicalize,hashObject} = require('./crypto.js');
const tests = [];
function check(name, fn) {fn();tests.push({name,status:'PASS'});}
check('Keccak-256 empty vector',()=>assert.equal(keccak256(''),'0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470'));
check('Keccak-256 abc vector',()=>assert.equal(keccak256('abc'),'0x4e03657aea45a94fc7d47ba826c8d667c0d1e6e33a64a036ec44f58fa12d6c45'));
check('Ethereum transfer selector',()=>assert.equal(keccak256('transfer(address,uint256)').slice(0,10),'0xa9059cbb'));
check('JCS property order, nested arrays, negative zero',()=>assert.equal(canonicalize({z:[{b:2,a:1}],a:-0}),'\{"a":0,"z":[{"a":1,"b":2}]}'));
check('JCS RFC numeric serialization sample',()=>assert.equal(canonicalize([333333333.33333329,1e30,4.50,2e-3,1e-27]),'[333333333.3333333,1e+30,4.5,0.002,1e-27]'));
check('UTF-16 property sorting',()=>assert.equal(canonicalize({'€':1,'\r':2,'😀':3,'1':4}),'\{"\\r":2,"1":4,"€":1,"😀":3}'));
check('Reject non-finite, non-JSON, lone surrogate and unsafe contract integers',()=>{
  for(const v of [NaN,Infinity,undefined,1n,'\ud800']) assert.throws(()=>hashObject(v));
  assert.throws(()=>hashObject({x:Number.MAX_SAFE_INTEGER+1}));
});
const load = name => JSON.parse(fs.readFileSync(path+'/'+name,'utf8'));
const save = (name,value)=>fs.writeFileSync(path+'/'+name,JSON.stringify(value,null,2)+'\n');
const policy=load('contracts/policy.json'),spec=load('examples/task_spec.json'),report=load('examples/public_report.json');
report.taskSpecHash=hashObject(spec);report.policyHash=hashObject(policy);report.subjectHash=hashObject(report.subjects);
save('examples/public_report.json',report);
const approve=load('examples/approval_request.json');approve.specHash=report.taskSpecHash;save('examples/approval_request.json',approve);
const ticket=load('examples/ticket_claims_internal.json');ticket.taskSpecHash=report.taskSpecHash;ticket.policyHash=report.policyHash;
ticket.snapshotHash=hashObject(report.snapshot);ticket.argumentsHash=hashObject([spec.address,{blockHash:report.snapshot.blockHash,requireCanonical:true}]);save('examples/ticket_claims_internal.json',ticket);
check('SAMPLE report tamper changes digest',()=>{
  const altered=structuredClone(report);altered.acceptedFact.balanceWei='1';assert.notEqual(hashObject(altered),hashObject(report));
});
save('examples/public_report_hash.json',{executionMode:'SAMPLE',algorithm:'keccak256(UTF8(JCS(PublicReport)))',reportHash:hashObject(report),signature:null,anchorReceipt:null});
fs.writeFileSync(path+'/checks/crypto_checks.json',JSON.stringify({scope:'Local demonstration implementation; not a production crypto audit',tests},null,2)+'\n');
console.log(JSON.stringify({cryptoChecks:tests.length,status:'PASS',fixtures:'SAMPLE digests computed'}));
