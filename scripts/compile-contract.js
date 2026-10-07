import fs from 'node:fs';
import path from 'node:path';
import solc from 'solc';
const source=fs.readFileSync(new URL('../chain-contracts/EvidenceRegistry.sol',import.meta.url),'utf8');
const input={language:'Solidity',sources:{'EvidenceRegistry.sol':{content:source}},settings:{evmVersion:'cancun',viaIR:true,optimizer:{enabled:true,runs:200},outputSelection:{'*':{'*':['abi','evm.bytecode.object']}}}};
const output=JSON.parse(solc.compile(JSON.stringify(input),{import:(name)=>{
  if(!name.startsWith('@openzeppelin/contracts/') || name.includes('..'))return{error:'Import not allowed'};
  try{return{contents:fs.readFileSync(path.resolve('node_modules',name),'utf8')}}catch{return{error:'Import not found'}};
}}));
const errors=(output.errors||[]).filter(e=>e.severity==='error');
if(errors.length){console.error(errors.map(e=>e.formattedMessage).join('\n'));process.exit(1);}
const artifact=output.contracts['EvidenceRegistry.sol'].EvidenceRegistry;
fs.mkdirSync('artifacts',{recursive:true});
fs.writeFileSync('artifacts/EvidenceRegistry.json',JSON.stringify({contractName:'EvidenceRegistry',compiler:solc.version(),evmVersion:'cancun',abi:artifact.abi,bytecode:'0x'+artifact.evm.bytecode.object,status:'UNDEPLOYED_UNAUDITED'},null,2));
console.log('EvidenceRegistry EIP-712 compiled; UNDEPLOYED_UNAUDITED.');

