from pathlib import Path
import json,re,subprocess
from lxml import etree,html
P=Path(__file__).resolve().parents[1]
W=P/'checks'
G=json.loads((P/'diagrams/diagram_specs.json').read_text()); C=json.loads((P/'contracts/scenario_catalog.json').read_text())['cases']; results=[]
def check(name,fn):fn();results.append({'name':name,'status':'PASS'})
def catalog():
 assert len(C)==57 and len({c['caseId'] for c in C})==57 and len({c['testId'] for c in C})==57
 for c in C:
  for key in ['detector','decision','expectedState','userMessage','recovery','evidence','owner','verification']:assert c[key].strip(),(c['caseId'],key)
  assert c['implementationStatus']=='DESIGN_REQUIRED'
 assert {c['caseId'] for c in C}>={'SC-O08','SC-E05'}
check('57 distinct scenarios retain detection, response, recovery, ownership and planned-only status',catalog)
def graph_consistency():
 ids={g['id'] for g in G};assert len(ids)==12
 for c in C:assert set(c['diagrams'])<=ids
 for g in G:
  ns={n['id'] for n in g['nodes']};assert len(ns)==len(g['nodes'])
  assert all(e['from'] in ns and e['to'] in ns for e in g['edges'])
  assert any(g['id'] in c['diagrams'] for c in C)
  m=(P/'diagrams'/(g['id']+'.mmd')).read_text();assert m.startswith('flowchart TD')
  for n in g['nodes']:assert n['id'] in m
check('12 diagram definitions, Mermaid nodes and scenario references are consistent',graph_consistency)
def rendered():
 data=json.loads((P/'checks/diagram_render_checks.json').read_text());assert len(data)==12
 for x in data:
  assert x['status']=='RENDERED' and x['maxHorizontalNodes']<=5
  tree=etree.parse(str(P/'diagrams'/(x['id']+'.svg')))
  assert tree.getroot().tag.endswith('svg')
  assert (P/'diagrams'/(x['id']+'.png')).stat().st_size>1000
check('12 SVG files parse, PNGs exist and layouts use at most five aligned nodes',rendered)
s=(P/'Architecture_Workflow_Atlas.html').read_text();doc=html.fromstring(s)
def html_structure():
 ids=[e.get('id') for e in doc.xpath('//*[@id]')];assert len(ids)==len(set(ids))
 assert len(doc.xpath('//*[contains(concat(" ",normalize-space(@class)," ")," diagram-panel ")]'))==12
 assert len(doc.xpath('//*[contains(concat(" ",normalize-space(@class)," ")," case ")]'))==57
 for e in doc.xpath('//*[@data-view]'):assert e.get('data-view') in ids
 for e in doc.xpath('//*[@data-case]'):assert e.get('data-case') in ids
 for e in doc.xpath('//label[@for]'):assert e.get('for') in ids
 assert not doc.xpath('//script[@src]|//link[@href]|//iframe|//img[@src]')
 assert not any(p in s for p in ['CASECARDS','>CARDS<','>NAV<','>SOURCES<','fetch('])
check('Offline atlas has unique embedded SVG IDs, linked controls and 57 complete case cards',html_structure)
def js_syntax():
 code='\n'.join(el.text or '' for el in doc.xpath('//script'))
 p=W/'atlas_script.js';p.write_text(code);subprocess.run(['node','--check',str(p)],check=True,capture_output=True)
check('Atlas inline JavaScript parses; this is not a browser interaction test',js_syntax)
def contracts():
 d=json.loads((P/'contracts/domain.schema.json').read_text())['$defs']
 assert {'leaseGeneration','policyEpoch','stopEpoch'}<=set(d['AdmissionTicketClaims']['required'])
 assert set(d['InvocationObservation']['properties']['bindingKind']['enum'])=={'REQUEST_BOUND','PROVIDER_DECLARED'}
 assert 'currentAnchor' in d['Publication']['required']
 assert 'currentAnchor' not in d['PublicReport']['properties']
 assert d['VerifyResult']['properties']['usableAsLiveAcceptance']=={'const':False}
check('New fencing, response binding and current-chain contracts preserve evidence separation',contracts)
def docs():
 md=(P/'Architecture_Workflow_Atlas.md').read_text();p=(P/'PRD_Architecture_Interaction.md').read_text()
 assert md.count('```mermaid')==12
 for c in C:assert c['caseId'] in (P/'review/Scenario_Coverage.md').read_text()
 for term in ['leaseGeneration','policyEpoch','AnchorObservation','REQUEST_BOUND','PROVIDER_DECLARED']:assert term in md and term in p
 assert '版本 0.2' in md and '版本 0.2' in p
 for n in range(1,11):assert f'[S{n} ' in md
check('Atlas, PRD, full scenario document and ten primary references are present',docs)
(P/'checks/atlas_checks.json').write_text(json.dumps({'scope':'Design, graph and static artifact validation only. No backend or actual browser execution.','tests':results},ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'checks':len(results),'status':'PASS'}))
