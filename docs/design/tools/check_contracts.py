import json,re,copy,datetime
from pathlib import Path
from lxml import html
import yaml

pack=Path(__file__).resolve().parents[1]
results=[]
def unique_pairs(pairs):
    out={}
    for k,v in pairs:
        if k in out:raise ValueError('Duplicate JSON key '+k)
        out[k]=v
    return out
def load_json(p):return json.loads(p.read_text(),object_pairs_hook=unique_pairs)
class UniqueYAML(yaml.SafeLoader):pass
def yaml_mapping(loader,node,deep=False):
    pairs=loader.construct_pairs(node,deep=deep)
    return unique_pairs(pairs)
UniqueYAML.add_constructor(yaml.resolver.BaseResolver.DEFAULT_MAPPING_TAG,yaml_mapping)
domain=load_json(pack/'contracts/domain.schema.json')
D=domain['$defs']
api=yaml.load((pack/'contracts/openapi.yaml').read_text(),Loader=UniqueYAML)
tools=yaml.load((pack/'contracts/skill_contracts.yaml').read_text(),Loader=UniqueYAML)
policy=load_json(pack/'contracts/policy.json')
states=load_json(pack/'contracts/state_machines.json')
def check(name,fn):
    fn();results.append({'name':name,'status':'PASS'})
def walk(obj):
    yield obj
    if isinstance(obj,dict):
        for v in obj.values():yield from walk(v)
    if isinstance(obj,list):
        for v in obj:yield from walk(v)
def validate(schema,value,p='$'):
    # Implements only the keywords present in this design contract. Not a standards certification.
    if '$ref' in schema:
        name=schema['$ref'].split('/')[-1];validate(D[name],value,p)
    if 'anyOf' in schema:
        failures=0
        for sub in schema['anyOf']:
            try:validate(sub,value,p);break
            except AssertionError:failures+=1
        assert failures<len(schema['anyOf']),p+' no anyOf branch'
    for sub in schema.get('allOf',[]):validate(sub,value,p)
    if 'if' in schema:
        try:validate(schema['if'],value,p);condition=True
        except AssertionError:condition=False
        if condition and 'then' in schema:validate(schema['then'],value,p)
        if not condition and 'else' in schema:validate(schema['else'],value,p)
    if 'not' in schema:
        try:validate(schema['not'],value,p);matched=True
        except AssertionError:matched=False
        assert not matched,p+' prohibited branch'
    if 'const' in schema:assert json.dumps(value,sort_keys=True)==json.dumps(schema['const'],sort_keys=True),p+' const'
    if 'enum' in schema:assert value in schema['enum'],p+' enum'
    t=schema.get('type')
    predicates={'object':lambda:isinstance(value,dict),'array':lambda:isinstance(value,list),'string':lambda:isinstance(value,str),
        'integer':lambda:isinstance(value,int) and not isinstance(value,bool),'boolean':lambda:isinstance(value,bool),
        'null':lambda:value is None,'number':lambda:isinstance(value,(int,float)) and not isinstance(value,bool)}
    if t:assert predicates[t](),p+' type '+t
    if isinstance(value,dict):
        for required in schema.get('required',[]):assert required in value,p+' missing '+required
        if schema.get('additionalProperties') is False:assert set(value)<=set(schema.get('properties',{})),p+' extra property'
        for key,sub in schema.get('properties',{}).items():
            if key in value:validate(sub,value[key],p+'.'+key)
    if isinstance(value,list):
        if 'minItems' in schema:assert len(value)>=schema['minItems'],p+' minItems'
        if 'maxItems' in schema:assert len(value)<=schema['maxItems'],p+' maxItems'
        if schema.get('uniqueItems'):assert len({json.dumps(v,sort_keys=True) for v in value})==len(value),p+' uniqueItems'
        if 'items' in schema:
            for i,v in enumerate(value):validate(schema['items'],v,p+'['+str(i)+']')
    if isinstance(value,str):
        if 'pattern' in schema:assert re.search(schema['pattern'],value),p+' pattern'
        if 'minLength' in schema:assert len(value)>=schema['minLength'],p+' minLength'
        if 'maxLength' in schema:assert len(value)<=schema['maxLength'],p+' maxLength'
        if schema.get('format')=='date-time':assert datetime.datetime.fromisoformat(value.replace('Z','+00:00')).tzinfo is not None,p+' timezone'
    if isinstance(value,(int,float)) and not isinstance(value,bool):
        if 'minimum' in schema:assert value>=schema['minimum'],p+' minimum'
        if 'maximum' in schema:assert value<=schema['maximum'],p+' maximum'
def invariant_report(report):
    spec=report['taskSpec'];fact=report['acceptedFact'];snap=report['snapshot']
    assert (report['result']=='SUCCEEDED') == (fact is not None)
    assert len(report['attempts'])<=spec['limits']['maxCandidateChecks']
    assert sum(a['providerCallConsumed'] for a in report['attempts'])<=spec['limits']['maxProviderCalls']
    assert max(0,len(report['attempts'])-1)<=spec['limits']['maxFallbacks']
    if snap:
        assert len({r['operatorId'] for r in snap['references']})==2
        assert all(r['observedBlockHash']==snap['blockHash'] for r in snap['references'])
        assert len({r['balanceWei'] for r in snap['references']})==1
    if fact:
        assert snap and fact['address']==spec['address'] and fact['blockHash']==snap['blockHash']
        assert fact['blockNumber']==snap['blockNumber'] and fact['balanceWei']==snap['references'][0]['balanceWei']
        assert int(fact['balanceWei'])<2**256
        passed=[a for a in report['attempts'] if a['serviceId']==fact['serviceId'] and a['status']=='PASSED']
        assert len(passed)==1 and all(c['status']=='PASS' for c in passed[0]['checks'] if c['required'])
    assert not {'reportHash','signature','anchorReceipt','owner','prompt'}&set(report)

check('All JSON and YAML files parse without duplicate keys',lambda:[load_json(p) for p in pack.rglob('*.json')])
def domain_refs():
    for node in walk(domain):
        if isinstance(node,dict) and '$ref' in node:assert node['$ref'].startswith('#/$defs/') and node['$ref'].split('/')[-1] in D
check('All domain references resolve',domain_refs)
def api_refs():
    for node in walk(api):
        if isinstance(node,dict) and '$ref' in node:assert node['$ref'].startswith('#/components/schemas/') and node['$ref'].split('/')[-1] in D
    def convert(x):
        if isinstance(x,dict):return {k:('#/$defs/'+v.split('/')[-1] if k=='$ref' else convert(v)) for k,v in x.items()}
        if isinstance(x,list):return [convert(v) for v in x]
        return x
    assert convert(api['components']['schemas'])==D
check('OpenAPI references and component definitions match domain',api_refs)
def api_paths():
    assert api['openapi']=='3.1.0' and len(api['paths'])==12
    ids=[]
    for path,item in api['paths'].items():
        declared={p['name'] for p in item.get('parameters',[]) if p['in']=='path'}
        assert declared==set(re.findall(r'\{(.*?)\}',path)),path
        for method,op in item.items():
            if method=='parameters':continue
            ids.append(op['operationId'])
            assert bool(op['security']) == (not path.startswith('/v1/public/'))
    assert len(ids)==len(set(ids))
    for path in ['/v1/tasks/{taskId}/approve','/v1/evidence/{reportId}/publications']:
        assert any(p['name']=='Idempotency-Key' and p['required'] for p in api['paths'][path]['post']['parameters'])
    assert 'userId' not in D['TaskCreateRequest']['properties'] and 'owner' not in D['TaskCreateRequest']['properties']
check('12 API paths have complete parameters, auth and idempotency',api_paths)
def tool_refs():
    assert len(tools['modelVisible'])==5 and tools['enforcedByServer'] is True
    for t in tools['modelVisible']:
        for key in ['inputSchema','outputSchema']:assert t[key].split('/')[-1] in D
    assert {'wallet','raw gateway','self-modification'}<=set(tools['notMounted'])
check('Five model tools have resolvable narrow contracts',tool_refs)
def state_enum():
    for key,name in [('task','TaskStatus'),('attempt','AttemptStatus'),('publication','PublicationStatus')]:
        table=states[key];assert set(table)==set(D[name]['enum'])
        assert all(target in table for values in table.values() for target in values)
    assert states['task']['STOP_REQUESTED']==['CANCELLED']
    assert all(states['task'][terminal]==[] for terminal in ['SUCCEEDED','FAILED','QUARANTINED','CANCELLED'])
check('State tables match enums and preserve terminal task facts',state_enum)
def fixtures():
    for file,name in [('task_spec.json','TaskSpec'),('public_report.json','PublicReport'),('approval_request.json','ApprovalRequest'),('ticket_claims_internal.json','AdmissionTicketClaims')]:
        v=load_json(pack/'examples'/file);validate(D[name],v)
    invariant_report(load_json(pack/'examples/public_report.json'))
check('Four JSON fixture types and report business invariants',fixtures)
def scenario_reports():
    reports=load_json(pack/'checks/scenario_reports.json')
    for report in reports:validate(D['PublicReport'],report);invariant_report(report)
check('All generated prototype reports obey schema subset and invariants',scenario_reports)
def must_reject(name,value):
    try:validate(D[name],value)
    except AssertionError:return
    raise AssertionError('Unexpectedly accepted invalid '+name)
check('Reject user-supplied owner',lambda:must_reject('TaskCreateRequest',{'intent':'query','owner':'attacker'}))
check('Reject incomplete approval',lambda:must_reject('ApprovalRequest',{'revision':1,'approvalNonce':'x'}))
bad_limits=copy.deepcopy(policy['limits']);bad_limits['maxProviderCalls']=3
check('Reject provider budget over cap',lambda:must_reject('Limits',bad_limits))
bad_fact=load_json(pack/'examples/public_report.json')['acceptedFact'];bad_fact['balanceWei']=42125000000000000000
check('Reject numeric balance instead of decimal string',lambda:must_reject('Fact',bad_fact))
bad_spec=load_json(pack/'examples/task_spec.json');bad_spec['snapshotPolicy']['blockNumber']='1'
check('Reject extra block number in finalized-at-run policy',lambda:must_reject('TaskSpec',bad_spec))
def docs():
    text=(pack/'PRD_Architecture_Interaction.md').read_text()
    for path in api['paths']:assert '`'+path+'`' in text,path
    assert all(f'FR{i:02}' in text for i in range(1,17))
    plan=load_json(pack/'contracts/acceptance_cases.json');assert len(plan['cases'])==25
    assert plan['status']=='TEST_PLAN_NOT_BACKEND_EXECUTION'
check('PRD covers 12 APIs, 16 requirements and 25 planned cases',docs)
def static_html():
    text=(pack/'Interaction_Prototype.html').read_text();doc=html.fromstring(text)
    ids=[n.get('id') for n in doc.xpath('//*[@id]')];assert len(ids)==len(set(ids))
    for label in doc.xpath('//label[@for]'):assert label.get('for') in ids
    for element in doc.xpath('//*[@aria-controls]'):assert element.get('aria-controls') in ids
    for element in doc.xpath('//script[@src]|//link[@href]|//img[@src]|//iframe[@src]'):assert not element.get('src',element.get('href','')).startswith(('http:','https:'))
    assert 'max-width:650px' in text and 'max-width:1120px' in text and 'focus-visible' in text
    assert '未连接模型、RPC、钱包或主网' in text and 'fetch(' not in text
check('Static HTML labels, IDs, sample disclosure, no external assets',static_html)
summary={'scope':'Structural consistency plus local validator for only the schema keywords used here. Not full OpenAPI/JSON Schema standard certification.',
    'domainDefinitions':len(D),'apiPaths':len(api['paths']),'plannedBackendCases':25,'tests':results}
(pack/'checks/contract_checks.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'passed':len(results),'domainDefinitions':len(D),'apiPaths':len(api['paths']),'status':'PASS'}))
