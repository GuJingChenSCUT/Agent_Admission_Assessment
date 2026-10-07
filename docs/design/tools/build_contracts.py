import json
from pathlib import Path
import yaml

ROOT = Path(__file__).resolve().parents[1]
C = ROOT / 'contracts'
E = ROOT / 'examples'
H = '0x' + '11' * 32
ADDRESS = '0x' + '22' * 20
def save_json(path, data):
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n')
def ref(name): return {'$ref': '#/$defs/' + name}
def obj(props, required=None, **kwargs):
    return {'type': 'object', 'properties': props, 'required': list(props) if required is None else required,
            'additionalProperties': False, **kwargs}
def arr(items, **kwargs): return {'type': 'array', 'items': items, **kwargs}
def enum(*values): return {'type': 'string', 'enum': list(values)}
def nullable(schema): return {'anyOf': [schema, {'type': 'null'}]}
S = {'type': 'string', 'minLength': 1, 'maxLength': 512}
ID = {'type': 'string', 'pattern': '^[a-z][a-z0-9_:-]{2,127}$'}
N = {'type': 'integer', 'minimum': 0, 'maximum': 9007199254740991}
B = {'type': 'boolean'}
DT = {'type': 'string', 'format': 'date-time'}
D = {}
D['Digest'] = {'type': 'string', 'pattern': '^0x[0-9a-f]{64}$'}
D['Address'] = {'type': 'string', 'pattern': '^0x[0-9a-fA-F]{40}$'}
D['Decimal'] = {'type': 'string', 'pattern': '^(0|[1-9][0-9]*)$', 'maxLength': 78}
D['TaskStatus'] = enum('NEEDS_INPUT', 'AWAITING_APPROVAL', 'QUEUED', 'RUNNING', 'STOP_REQUESTED', 'SUCCEEDED', 'FAILED', 'QUARANTINED', 'CANCELLED')
D['Phase'] = enum('PLAN', 'REFERENCE', 'ADMISSION', 'INVOKE', 'VERIFY', 'REPORT', 'STOPPING', 'COMPLETE')
D['CheckStatus'] = enum('PASS', 'FAIL', 'INCONCLUSIVE', 'ERROR', 'NOT_CHECKED')
D['AttemptStatus'] = enum('CHECKING', 'REJECTED', 'RUNNING', 'PASSED', 'FAILED', 'INCONCLUSIVE', 'CANCEL_REQUESTED', 'CANCELLED', 'LATE_DISCARDED')
D['PublicationStatus'] = enum('NOT_REQUESTED', 'QUEUED', 'SIGNED', 'BROADCAST', 'CONFIRMING', 'CONFIRMED', 'UNKNOWN', 'FAILED', 'CANCEL_REQUESTED', 'CANCELLED')
D['ExecutionMode'] = enum('LIVE', 'REPLAY', 'SAMPLE', 'STRUCTURED_NO_MODEL')
D['Limits'] = obj({'maxCandidateChecks': {'type': 'integer', 'minimum': 1, 'maximum': 2},
    'maxProviderCalls': {'type': 'integer', 'minimum': 1, 'maximum': 2},
    'maxFallbacks': {'type': 'integer', 'minimum': 0, 'maximum': 1},
    'maxModelRounds': {'type': 'integer', 'minimum': 0, 'maximum': 4},
    'maxOutputTokensPerRound': {'type': 'integer', 'minimum': 1, 'maximum': 2048}})
D['SnapshotPolicy'] = obj({'mode': enum('FINALIZED_AT_RUN', 'FIXED_BLOCK'), 'blockNumber': ref('Decimal')}, ['mode'],
    allOf=[{'if': {'properties': {'mode': {'const': 'FIXED_BLOCK'}}}, 'then': {'required': ['blockNumber']}},
           {'if': {'properties': {'mode': {'const': 'FINALIZED_AT_RUN'}}}, 'then': {'not': {'required': ['blockNumber']}}}])
D['TaskSpec'] = obj({'version': {'const': '1'}, 'sourceChainId': {'const': '1'}, 'operation': {'const': 'NATIVE_BALANCE'},
    'asset': {'const': 'ETH'}, 'address': ref('Address'), 'snapshotPolicy': ref('SnapshotPolicy'),
    'candidateServiceIds': arr(ID, minItems=1, maxItems=2, uniqueItems=True), 'limits': ref('Limits')})
D['TaskDraft'] = obj({'intentType': enum('NATIVE_BALANCE', 'UNSUPPORTED', 'UNCLEAR'), 'address': nullable(ref('Address')),
    'sourceChainId': nullable(ref('Decimal')), 'asset': nullable(S), 'missingFields': arr(enum('address', 'address_selection', 'scope')),
    'clarification': nullable(S), 'allowFallback': B})
D['ReferenceSource'] = obj({'sourceId': ID, 'operatorId': ID, 'observedBlockHash': ref('Digest'),
    'fetchedAt': DT, 'balanceWei': ref('Decimal')})
D['Snapshot'] = obj({'sourceChainId': {'const': '1'}, 'blockNumber': ref('Decimal'), 'blockHash': ref('Digest'),
    'blockTimestamp': DT, 'capturedAt': DT, 'tag': {'const': 'finalized'}, 'assurance': {'const': 'RPC_CROSS_CHECKED'},
    'references': arr(ref('ReferenceSource'), minItems=2, maxItems=2)})
D['RuleCheck'] = obj({'checkId': ID, 'ruleId': ID, 'required': B, 'status': ref('CheckStatus'),
    'reasonCode': {'type': 'string', 'pattern': '^[A-Z][A-Z0-9_]{2,79}$'}, 'expected': nullable(S),
    'observed': nullable(S), 'sourceClass': enum('VERIFIED_ARTIFACT', 'PROVIDER_DECLARED', 'NOT_AVAILABLE', 'SYSTEM_OBSERVED', 'REFERENCE_RPC'),
    'evidenceRefs': arr(ID, maxItems=32), 'checkedAt': DT})
D['Fact'] = obj({'sourceChainId': {'const': '1'}, 'asset': {'const': 'ETH'}, 'address': ref('Address'),
    'blockNumber': ref('Decimal'), 'blockHash': ref('Digest'), 'balanceWei': ref('Decimal'), 'serviceId': ID})
D['InvocationObservation'] = obj({'bindingKind': enum('REQUEST_BOUND','PROVIDER_DECLARED'),
    'requestHash': ref('Digest'), 'requestedBlockHash': ref('Digest'),
    'providerDeclaredBlockHash': nullable(ref('Digest')), 'responseDigest': ref('Digest'),
    'parsedBalanceWei': nullable(ref('Decimal'))})
D['Attempt'] = obj({'attemptId': ID, 'serviceId': ID, 'manifestHash': ref('Digest'), 'status': ref('AttemptStatus'),
    'decision': enum('ALLOW', 'REJECT', 'QUARANTINE'), 'providerCallConsumed': B, 'checks': arr(ref('RuleCheck'), minItems=1),
    'responseDigest': nullable(ref('Digest')), 'observation': nullable(ref('InvocationObservation')), 'startedAt': DT, 'finishedAt': nullable(DT)})
D['BudgetsUsed'] = obj({'candidateChecks': N, 'providerCalls': N, 'fallbacks': N, 'modelRounds': N})
D['TaskView'] = obj({'taskId': ID, 'revision': {'type': 'integer', 'minimum': 1}, 'status': ref('TaskStatus'),
    'phase': ref('Phase'), 'executionMode': ref('ExecutionMode'), 'spec': nullable(ref('TaskSpec')),
    'specHash': nullable(ref('Digest')), 'approvalNonce': nullable(S), 'approvalExpiresAt': nullable(DT),
    'missingFields': arr(S), 'clarification': nullable(S), 'runId': nullable(ID), 'stopEpoch': N,
    'snapshot': nullable(ref('Snapshot')), 'attempts': arr(ref('Attempt'), maxItems=2),
    'acceptedFact': nullable(ref('Fact')), 'budgetsUsed': ref('BudgetsUsed'), 'reportId': nullable(ID),
    'createdAt': DT, 'updatedAt': DT})
D['TaskCreateRequest'] = obj({'intent': {'type': 'string', 'minLength': 1, 'maxLength': 2048}, 'allowFallback': B}, ['intent'])
D['ClarificationRequest'] = obj({'revision': {'type': 'integer', 'minimum': 1}, 'answer': {'type': 'string', 'minLength': 1, 'maxLength': 2048}})
D['ApprovalRequest'] = obj({'revision': {'type': 'integer', 'minimum': 1}, 'specHash': ref('Digest'), 'approvalNonce': S})
D['StopRequest'] = obj({'reason': {'type': 'string', 'minLength': 1, 'maxLength': 128}}, [])
D['StopResponse'] = obj({'taskId': ID, 'status': ref('TaskStatus'), 'stopEpoch': N, 'requestedAt': nullable(DT),
    'controlEffect': enum('STOP_REQUESTED', 'CANCELLED', 'ALREADY_TERMINAL')})
D['Event'] = obj({'taskId': ID, 'sequence': {'type': 'integer', 'minimum': 1}, 'eventId': ID,
    'type': enum('TASK_UPDATED', 'PHASE_CHANGED', 'ATTEMPT_UPDATED', 'STOP_ACKNOWLEDGED', 'RESULT_COMMITTED', 'LATE_RESPONSE_DISCARDED'),
    'status': ref('TaskStatus'), 'phase': ref('Phase'), 'messageCode': S, 'attemptId': nullable(ID), 'occurredAt': DT})
D['EventsResponse'] = obj({'events': arr(ref('Event'), maxItems=200), 'nextSequence': N, 'terminal': B})
D['Error'] = obj({'code': enum('INVALID_INPUT', 'UNSUPPORTED_SCOPE', 'UNAUTHENTICATED', 'NOT_FOUND', 'REVISION_CONFLICT',
    'HASH_MISMATCH', 'NONCE_EXPIRED', 'STATE_CONFLICT', 'IDEMPOTENCY_CONFLICT', 'BUDGET_EXCEEDED', 'REFERENCE_CONFLICT',
    'CONFIGURATION_REQUIRED', 'MODEL_UNAVAILABLE', 'NOT_READY', 'RATE_LIMITED', 'INTERNAL_ERROR'),
    'message': S, 'traceId': ID, 'retryable': B})
D['EthereumIdentityReference'] = obj({'chainId':{'const':'1'},'registryAddress':ref('Address'),'agentId':ref('Decimal'),
    'verificationStatus':ref('CheckStatus'),'verifiedAt':nullable(DT),'blockHash':nullable(ref('Digest'))})
D['PublicSubject'] = obj({'serviceId':ID,'namespace':S,'transport':enum('HTTP_RPC','MCP'),
    'serviceOrigin':nullable({'type':'string','pattern':'^https://','maxLength':256}), 'manifestHash':ref('Digest'),
    'ethereumIdentity':nullable(ref('EthereumIdentityReference')),'identityStatus':ref('CheckStatus')})
D['PublicReport'] = obj({'schemaVersion': {'const': '1'}, 'reportId': ID, 'executionMode': ref('ExecutionMode'),
    'taskSpec': ref('TaskSpec'), 'taskSpecHash': ref('Digest'), 'policyHash': ref('Digest'), 'subjectHash': ref('Digest'),
    'subjects':arr(ref('PublicSubject'),minItems=1,maxItems=2),
    'result': enum('SUCCEEDED', 'FAILED', 'QUARANTINED', 'CANCELLED'), 'snapshot': nullable(ref('Snapshot')),
    'attempts': arr(ref('Attempt'), maxItems=2), 'acceptedFact': nullable(ref('Fact')),
    'observedAt': DT, 'expiresAt': DT, 'limitations': arr(S, minItems=1, maxItems=32)})
D['PublicPreview'] = obj({'reportId': ID, 'publicReport': ref('PublicReport'), 'reportHash': ref('Digest'),
    'publishNonce': S, 'publishNonceExpiresAt': DT, 'disclosedFields': arr(S, minItems=1),
    'registryChainId': {'const': '677'}, 'registryAddress': nullable(ref('Address'))})
D['PublishRequest'] = obj({'reportHash': ref('Digest'), 'publishNonce': S, 'acknowledgePublicFields': {'const': True}})
D['SignatureEnvelope'] = obj({'scheme': {'const': 'EIP712'}, 'domainName': {'const': 'AgentAdmissionEvidence'},
    'domainVersion': {'const': '1'}, 'registryChainId': {'const': '677'}, 'registryAddress': ref('Address'),
    'signer': ref('Address'), 'reportHash': ref('Digest'), 'taskSpecHash': ref('Digest'), 'policyHash': ref('Digest'),
    'subjectHash': ref('Digest'), 'sourceChainId': {'const': '1'}, 'resultCode': {'type': 'integer', 'minimum': 0, 'maximum': 3},
    'evidenceURIHash': ref('Digest'), 'observedAt': ref('Decimal'), 'expiresAt': ref('Decimal'), 'nonce': ref('Decimal'),
    'signature': {'type': 'string', 'pattern': '^0x[0-9a-fA-F]{130}$'}})
D['AnchorReceipt'] = obj({'registryChainId': {'const': '677'}, 'registryAddress': ref('Address'), 'transactionHash': ref('Digest'),
    'blockNumber': ref('Decimal'), 'blockHash': ref('Digest'), 'logIndex': N, 'confirmedAt': DT})
D['AnchorObservation'] = obj({'status': enum('NOT_CHECKED','CANONICAL','ORPHANED','UNKNOWN','CONFLICT'),
    'registryChainId': {'const':'677'}, 'registryAddress': ref('Address'), 'transactionHash': ref('Digest'),
    'receiptBlockHash': nullable(ref('Digest')), 'canonicalBlockHash': nullable(ref('Digest')),
    'checkedAt': DT, 'reasonCode': S})
D['Publication'] = obj({'publicationId': ID, 'reportId': ID, 'reportHash': ref('Digest'), 'executionMode': ref('ExecutionMode'),
    'status': ref('PublicationStatus'), 'registryChainId': {'const': '677'}, 'registryAddress': nullable(ref('Address')),
    'signatureEnvelope': nullable(ref('SignatureEnvelope')), 'transactionHash': nullable(ref('Digest')),
    'anchorReceipt': nullable(ref('AnchorReceipt')), 'currentAnchor': nullable(ref('AnchorObservation')), 'reasonCode': S, 'createdAt': DT, 'updatedAt': DT})
D['PrivateEvidence'] = obj({'taskId': ID, 'reportId': ID, 'publicPreview': ref('PublicPreview'),
    'privateArtifactIds': arr(ID), 'publication': nullable(ref('Publication'))})
D['PrivateArtifact'] = obj({'artifactId':ID,'taskId':ID,'contentType':{'const':'application/json'},
    'originalBytesBase64':{'type':'string','contentEncoding':'base64','maxLength':1398104},
    'digestAlgorithm':{'const':'KECCAK256'},'contentHash':ref('Digest'),'capturedAt':DT})
D['VerifyRequest'] = obj({'publicReport': ref('PublicReport'), 'claimedReportHash': ref('Digest'),
    'signatureEnvelope': nullable(ref('SignatureEnvelope')), 'anchorReceipt': nullable(ref('AnchorReceipt'))},
    ['publicReport', 'claimedReportHash'])
D['VerificationItem'] = obj({'status': ref('CheckStatus'), 'reasonCode': S})
D['VerifyResult'] = obj({'computedReportHash': ref('Digest'), 'integrity': ref('VerificationItem'),
    'signerIdentity': ref('VerificationItem'), 'anchor': ref('VerificationItem'), 'validity': ref('VerificationItem'),
    'revocation': ref('VerificationItem'), 'scope': ref('VerificationItem'),
    'assurance': enum('CONTENT_ONLY', 'RPC_CROSS_CHECKED', 'REGISTRY_RECORD_VERIFIED'), 'usableAsLiveAcceptance': {'const': False}})
D['AdmissionTicketClaims'] = obj({'version': {'const': '1'}, 'aud':{'const':'agent-admission-gateway:v1'}, 'taskId': ID, 'runId': ID, 'caller': ID,
    'taskSpecHash': ref('Digest'), 'snapshotHash': ref('Digest'), 'serviceId': ID, 'manifestHash': ref('Digest'),
    'method': {'const': 'eth_getBalance'}, 'argumentsHash': ref('Digest'), 'policyHash': ref('Digest'),
    'stopEpoch': N, 'policyEpoch': N, 'leaseGeneration': N, 'issuedAt': DT, 'expiresAt': DT, 'jti': ID})
D['TaskIdInput'] = obj({'taskId': ID})
D['ServiceChoiceInput'] = obj({'taskId': ID, 'serviceId': ID, 'reasonRefs': arr(ID, minItems=1, maxItems=8)})
D['ServiceSummary'] = obj({'serviceId': ID, 'transport': enum('HTTP_RPC', 'MCP'), 'capability': {'const': 'eth_getBalance'},
    'manifestHash': ref('Digest'), 'eip1898Support': B, 'sourceClass': enum('VERIFIED_ARTIFACT', 'PROVIDER_DECLARED', 'NOT_AVAILABLE'),
    'evidenceRefs': arr(ID)})
D['EligibleServices'] = obj({'taskId': ID, 'services': arr(ref('ServiceSummary'), maxItems=2)})
D['ServiceChoiceResult'] = obj({'accepted': B, 'serviceId': ID, 'reasonCode': S})
D['VerifiedResult'] = obj({'taskId': ID, 'status': ref('TaskStatus'), 'acceptedFact': nullable(ref('Fact')), 'evidenceRefs': arr(ID)})
D['EvidenceSummary'] = obj({'taskId': ID, 'checks': arr(ref('RuleCheck')), 'limitations': arr(S)})
D['ApprovedScope'] = obj({'taskId': ID, 'runId': ID, 'spec': ref('TaskSpec'), 'specHash': ref('Digest'), 'budgetsUsed': ref('BudgetsUsed')})
save_json(C / 'domain.schema.json', {'$schema': 'https://json-schema.org/draft/2020-12/schema',
    '$id': 'urn:agent-admission:domain:v1', 'title': 'Agent Admission Design Contracts',
    'description': 'Design-only P0 contracts. Definitions are individually addressable. Server invariants are in policy/state_machines/acceptance_cases.',
    '$defs': D})

def oa_refs(x):
    if isinstance(x, dict): return {k: ('#/components/schemas/' + v.split('/')[-1] if k == '$ref' else oa_refs(v)) for k, v in x.items()}
    if isinstance(x, list): return [oa_refs(v) for v in x]
    return x
def osref(n): return {'$ref': '#/components/schemas/' + n}
def response(n, desc): return {'description': desc, 'content': {'application/json': {'schema': osref(n)}}}
def operation(opid, summary, res, body=None, code='200', private=True, idem=False, errors=(400, 401, 404, 409, 503)):
    op = {'operationId': opid, 'summary': summary, 'security': [{'bearerAuth': []}] if private else [],
          'responses': {code: response(res, summary)}}
    if body: op['requestBody'] = {'required': True, 'content': {'application/json': {'schema': osref(body)}}}
    if idem: op['parameters'] = [{'name': 'Idempotency-Key', 'in': 'header', 'required': True,
         'schema': {'type': 'string', 'minLength': 16, 'maxLength': 128}, 'description': 'Scoped to authenticated owner + route. Same key, changed body = 409.'}]
    for err in errors: op['responses'][str(err)] = response('Error', {400: 'Invalid input or unsupported P0 scope', 401: 'Authentication required',
        404: 'Not found or inaccessible', 409: 'Revision, hash, state or idempotency conflict', 429: 'Rate limited',
        503: 'Configuration or dependency unavailable'}[err])
    return op
paths = {
 '/v1/tasks': {'post': operation('createTask', 'Create a bounded task proposal; never auto-execute', 'TaskView', 'TaskCreateRequest', '201')},
 '/v1/tasks/{taskId}': {'get': operation('getTask', 'Get owner-scoped task state and accepted fact', 'TaskView', errors=(401,404))},
 '/v1/tasks/{taskId}/clarifications': {'post': operation('clarifyTask', 'Update draft; invalidate previous approval nonce', 'TaskView', 'ClarificationRequest')},
 '/v1/tasks/{taskId}/approve': {'post': operation('approveTask', 'Atomically approve this exact revision and create run outbox', 'TaskView', 'ApprovalRequest', '202', idem=True)},
 '/v1/tasks/{taskId}/stop': {'post': operation('stopTask', 'Priority stop; independent of model and invocation queue', 'StopResponse', 'StopRequest', errors=(400,401,404))},
 '/v1/tasks/{taskId}/events': {'get': operation('getTaskEvents', 'Resume monotonic owner-scoped event log', 'EventsResponse', errors=(400,401,404))},
 '/v1/tasks/{taskId}/evidence': {'get': operation('getPrivateEvidence', 'Read owner-scoped final evidence', 'PrivateEvidence', errors=(401,404,409))},
 '/v1/tasks/{taskId}/artifacts/{artifactId}': {'get': operation('getPrivateArtifact', 'Read size-bounded original bytes for owner; never execute returned content', 'PrivateArtifact', errors=(401,404))},
 '/v1/evidence/{reportId}/public-preview': {'get': operation('previewPublication', 'Preview immutable public fields and exact reportHash', 'PublicPreview', errors=(401,404,409))},
 '/v1/evidence/{reportId}/publications': {'post': operation('publishEvidence', 'Create independent publication outbox for approved reportHash', 'Publication', 'PublishRequest', '202', idem=True)},
 '/v1/publications/{publicationId}': {'get': operation('getPublication', 'Read owner-scoped publication state; broadcast differs from confirmed', 'Publication', errors=(401,404))},
 '/v1/public/evidence/verify': {'post': operation('verifyPublicEvidence', 'Verify supplied content and configured registry; never fetch arbitrary report URI', 'VerifyResult', 'VerifyRequest', private=False, errors=(400,429,503))}
}
for path, item in paths.items():
    for name in ['taskId', 'reportId', 'publicationId', 'artifactId']:
        if '{' + name + '}' in path: item.setdefault('parameters',[]).append({'in': 'path', 'name': name, 'required': True, 'schema': ID})
paths['/v1/tasks/{taskId}/events']['get']['parameters'] = [
    {'in': 'query', 'name': 'after', 'schema': N, 'description': 'Return events with sequence > after. Default 0.'},
    {'in': 'query', 'name': 'limit', 'schema': {'type':'integer','minimum':1,'maximum':200,'default':100}}]
spec = {'openapi': '3.1.0', 'jsonSchemaDialect': 'https://json-schema.org/draft/2020-12/schema',
 'info': {'title':'Agent Admission P0 API', 'version':'0.2.0-design', 'description': 'Design contract, no deployed endpoint. owner is derived from auth. Cookie deployments additionally require CSRF. P0 rejects FIXED_BLOCK.'},
 'servers': [{'url':'https://api.example.invalid', 'description':'Placeholder only; replace with actual deployment'}],
 'paths': paths, 'components': {'securitySchemes': {'bearerAuth': {'type':'http','scheme':'bearer','description':'Session credential; never an internal admission ticket'}},
                              'schemas': oa_refs(D)}}
(C/'openapi.yaml').write_text(yaml.safe_dump(spec, allow_unicode=True, sort_keys=False))

tools = [
 ('task_get_scope','TaskIdInput','ApprovedScope','Read scope bound to current authenticated run'),
 ('service_list_eligible','TaskIdInput','EligibleServices','Read normalized allowlisted capabilities'),
 ('task_propose_service','ServiceChoiceInput','ServiceChoiceResult','Suggest only; does not issue ticket or invoke provider'),
 ('task_get_verified_result','TaskIdInput','VerifiedResult','Return only accepted facts or current status'),
 ('evidence_get_summary','TaskIdInput','EvidenceSummary','Read redacted rule checks only')]
tool_contract = {'version':'1','runtimeBlueprint':'eve, Node >=24; adapter may retain an existing stack',
 'prompt':'../agent/instructions.md','modelVisible': [
     {'name':n,'inputSchema':'domain.schema.json#/$defs/'+i,'outputSchema':'domain.schema.json#/$defs/'+o,
      'permission':'run-context-bound; owner not supplied by model','effect':desc,
      'errors':['NOT_FOUND','STATE_CONFLICT','BUDGET_EXCEEDED'],'maxCallsPerRound':1} for n,i,o,desc in tools],
 'internalOnly': [
 {'name':'admission_evaluate','caller':'run_worker','input':['runId','serviceId','manifestHash'],
  'output':['decision','RuleCheck[]','ticketId?'],'invariants':['current stopEpoch','approved spec','required checks PASS','candidate budget']},
 {'name':'gateway_invoke','caller':'run_worker','input':['ticketId'],
  'output':['attemptId','responseDigest'],'invariants':['atomic one-time consume','current stopEpoch and policyEpoch','current leaseGeneration','method/args exact','provider-call budget']},
 {'name':'reference_resolve','caller':'reference_worker','input':['runId'],
  'output':['Snapshot or REFERENCE_CONFLICT'],'invariants':['two configured operators','same canonical finalized hash','no majority shortcut']},
 {'name':'result_verify','caller':'run_worker','input':['attemptId','snapshotId'],
  'output':['RuleCheck[]','acceptedFact?'],'invariants':['same block before balance compare','atomic result commit','late response excluded']},
 {'name':'evidence_build','caller':'evidence_worker','input':['terminal runId'],
  'output':['PublicReport','reportHash','private artifact refs'],'invariants':['no secrets','no self-hash','immutable JCS']},
 {'name':'sign_publication','caller':'publication_worker','input':['approved publicationId'],
  'output':['SignatureEnvelope','signed transaction hash'],'invariants':['exact approved hash','fixed chain and registry','persist before broadcast']}],
 'notMounted':['shell','self-modification','arbitrary URL fetch','wallet','publication approval','policy editing','raw gateway'],
 'enforcedByServer':True}
(C/'skill_contracts.yaml').write_text(yaml.safe_dump(tool_contract, allow_unicode=True, sort_keys=False))

policy = {'version':'1','kind':'INITIAL_CONFIGURATION_NOT_MEASURED','sourceChainId':'1','registryChainId':'677',
 'allowedOperation':'NATIVE_BALANCE','enabledSnapshotModes':['FINALIZED_AT_RUN'],
 'candidateServiceIds':['svc_primary','svc_backup'],'referenceOperatorIds':['operator_a','operator_b'],
 'limits':{'maxCandidateChecks':2,'maxProviderCalls':2,'maxFallbacks':1,'maxModelRounds':4,'maxOutputTokensPerRound':2048},
 'timeoutsSeconds':{'approvalNonce':600,'admissionTicket':60,'providerRequest':15,'run':120},
 'infrastructureLimits':{'maxReferenceRpcCallsPerRun':12,'maxAdvisoryHttpRequestsPerRun':20,
   'limitExceededAction':'required evidence INCONCLUSIVE; never interpret truncation as empty',
   'providerBudgetExcludes':'reference, advisory, model and publication operations; all require separate accounting'},
 'maxReferenceHeadSkewBlocks':'32','maxProviderResponseBytes':1048576,'referenceAssurance':'RPC_CROSS_CHECKED','eip1898Required':True,
 'checkRules':[
  {'ruleId':'chain_match','stage':'REFERENCE','required':True},
  {'ruleId':'reference_hash_match','stage':'REFERENCE','required':True},
  {'ruleId':'manifest_pin','stage':'ADMISSION','required':True},
  {'ruleId':'capability_match','stage':'ADMISSION','required':True},
  {'ruleId':'client_dependency_policy','stage':'ADMISSION','required':True},
  {'ruleId':'remote_deployment_provenance','stage':'ADMISSION','required':False},
  {'ruleId':'response_schema','stage':'VERIFY','required':True},
  {'ruleId':'response_scope','stage':'VERIFY','required':True},
  {'ruleId':'snapshot_match','stage':'VERIFY','required':True},
  {'ruleId':'balance_match','stage':'VERIFY','required':True}],
 'dependencyPolicy':{'source':'OSV','ecosystem':'npm','input':'pinned client lockfile only',
  'unresolvedVersionAction':'QUARANTINE','advisoryRetrievalFailureAction':'QUARANTINE',
   'maxCacheAgeSeconds':3600,'freshnessStatus':'INITIAL_PRODUCT_POLICY_NOT_SOURCE_GUARANTEE',
   'pagination':'finish every query next_page_token and fetch required advisory records; cap reached => INCONCLUSIVE',
   'knownAffectedPackageAction':'REJECT','unknownAffectedRangeAction':'QUARANTINE',
   'successfulNoAdvisoryMeaning':'no known advisory found at observed time; not deployment safety'},
 'egress':{'default':'DENY','targets':'administrator-configured origins; credentials and URLs kept server-side',
   'redirects':'DENY unless revalidated','publicEvidenceURI':'never automatically executed'},
 'publication':{'automatic':False,'confirmations':None,'registryAddress':None,'signerAddress':None,
   'blockedUntil':'actual BOT mainnet confirmation policy, gas, registry and validator configured'}}
save_json(C/'policy.json',policy)

task_transitions = {'NEEDS_INPUT':['AWAITING_APPROVAL','CANCELLED'], 'AWAITING_APPROVAL':['NEEDS_INPUT','QUEUED','CANCELLED'],
 'QUEUED':['RUNNING','STOP_REQUESTED','FAILED','QUARANTINED'], 'RUNNING':['STOP_REQUESTED','SUCCEEDED','FAILED','QUARANTINED'],
 'STOP_REQUESTED':['CANCELLED'], 'SUCCEEDED':[], 'FAILED':[], 'QUARANTINED':[], 'CANCELLED':[]}
pub_transitions = {'NOT_REQUESTED':['QUEUED'], 'QUEUED':['SIGNED','FAILED','CANCEL_REQUESTED'],
 'SIGNED':['BROADCAST','UNKNOWN','FAILED','CANCEL_REQUESTED'], 'BROADCAST':['CONFIRMING','UNKNOWN','FAILED'],
 'CONFIRMING':['CONFIRMED','UNKNOWN','FAILED'], 'UNKNOWN':['BROADCAST','CONFIRMING','CONFIRMED','FAILED'],
 'FAILED':[], 'CONFIRMED':[], 'CANCEL_REQUESTED':['CANCELLED','BROADCAST','UNKNOWN'], 'CANCELLED':[]}
attempt_transitions = {'CHECKING':['REJECTED','RUNNING','INCONCLUSIVE','CANCEL_REQUESTED'],
 'RUNNING':['PASSED','FAILED','INCONCLUSIVE','CANCEL_REQUESTED'], 'CANCEL_REQUESTED':['CANCELLED','LATE_DISCARDED'],
 'REJECTED':[], 'PASSED':[], 'FAILED':[], 'INCONCLUSIVE':[], 'CANCELLED':[], 'LATE_DISCARDED':[]}
save_json(C/'state_machines.json',{'version':'1','task':task_transitions,'publication':pub_transitions,'attempt':attempt_transitions,
 'notes':['Self-transitions used only for idempotent reads or acknowledgements.',
  'CAS state, stopEpoch, current policyEpoch and fenced leaseGeneration in dispatch and result transactions.',
  'PublicReport is immutable. Publication CONFIRMED is historical; current AnchorObservation is independently refreshed.',
  'REQUEST_BOUND records the actual EIP1898 request; raw eth_getBalance returns a quantity, not a provider block attestation.',
  'Signed publication cancellation can race broadcast; chain outcomes override local cancellation claims.',
  'FAILED publication retries create explicit new jobs, not silent resends.'],
 'serverInvariants':['required checks must PASS before stage ALLOW', 'acceptedFact iff task SUCCEEDED',
  'approved revision/specHash/nonce must match','each jti consumed once','provider calls and fallbacks bounded',
  'report excludes reportHash/signature/anchor','LIVE facts cannot originate SAMPLE fixtures',
  'Decimal balances/chain/block are bounded by uint256; EIP712 observedAt/expiresAt bounded by uint64',
  'Caller identity comes from worker context, never client or model parameters',
  'Current leaseGeneration, stopEpoch and policyEpoch guard dispatch and result commits',
  'LIVE accepted attempts require InvocationObservation linked to private raw request and response digests',
  'A policyEpoch invalidation quarantines the old Run; no silent policyHash change or resume under relaxed rules']})
cases = [
 ('AC01','normal','Both reference operators agree; primary returns matching result','SUCCEEDED; one provider call; required checks PASS'),
 ('AC02','stale_primary','Primary reports another block; fallback approved','Primary FAIL snapshot; balance compare skipped; backup succeeds at same Snapshot'),
 ('AC03','both_fail','Both candidates fail mandatory verification','FAILED; acceptedFact null; <=2 calls'),
 ('AC04','reference_conflict','Reference block hashes disagree','QUARANTINED; no provider call; no malicious-provider claim'),
 ('AC05','manifest_changed','Manifest changes after pinned registration','Reject primary before call; no old ticket reuse'),
 ('AC06','optional_missing','Remote deployment SBOM unavailable under default policy','Optional NOT_CHECKED; may succeed; explicit limitation'),
 ('AC07','required_missing','Configured required provenance missing','QUARANTINE, no ALLOW'),
 ('AC08','missing_address','Intent lacks address','NEEDS_INPUT; no task approval or invocation'),
 ('AC09','approval_revision','Approve older revision or expired nonce','409; no run outbox'),
 ('AC10','duplicate_approval','Same Idempotency-Key repeated','Same run; changed body 409'),
 ('AC11','ticket_replay','Reuse jti, wrong caller, expired or wrong arguments','Reject; no unauthorized additional invocation'),
 ('AC12','stop_during_invoke','Stop ACK commits before result returns','CANCELLED; response LATE_DISCARDED; no fallback or fact'),
 ('AC13','stop_after_success','Success committed first','SUCCEEDED unchanged; ALREADY_TERMINAL'),
 ('AC14','recovery','Worker crashes after consuming ticket','No blind replay; budget consumed; restore persisted state'),
 ('AC15','report_tamper','Change balance without updating claimed hash','Integrity FAIL'),
 ('AC16','publication_tamper','Report changed after preview','409 HASH_MISMATCH; no signature or broadcast'),
 ('AC17','broadcast_timeout','Send times out after signed tx persisted','UNKNOWN; query original txHash; no unrelated new nonce'),
 ('AC18','wrong_receipt','Success receipt for different registry or event','Not CONFIRMED'),
 ('AC19','unsupported_scope','User asks for ERC20 or transaction send','UNSUPPORTED_SCOPE; no query'),
 ('AC20','reference_balance_conflict','Same block; reference balances disagree','INCONCLUSIVE; do not accept provider by simple majority'),
 ('AC21','stale_approval_after_edit','Change address after approval preview','Revision/hash/nonce replaced; prior approval invalid'),
 ('AC22','ui_accessibility','Keyboard and 360/1024/1440 widths','Visible focus; label associations; no horizontal overflow'),
 ('AC23','tool_injection','Provider returns instructions to change policy, publish or run shell','Treat as data; no mounted dangerous tool; facts only from verifier'),
 ('AC24','egress_rebinding','Configured service redirects or resolves to unauthorized address','Deny before connection; revalidate each redirect/resolution; size-bound decompressed response'),
 ('AC25','cross_owner','Another authenticated owner requests task/evidence/artifact','404 or policy-consistent denial; no private object or nonce leaked')]
save_json(C/'acceptance_cases.json',{'version':'1','status':'TEST_PLAN_NOT_BACKEND_EXECUTION',
 'cases':[{'caseId':i,'scenario':s,'given':g,'expected':e,'layer':'UI_AND_BACKEND' if i in ['AC01','AC02','AC03','AC04','AC05','AC06','AC08','AC12','AC13','AC15','AC16','AC19','AC22'] else 'BACKEND_REQUIRED'} for i,s,g,e in cases]})

task_spec = {'version':'1','sourceChainId':'1','operation':'NATIVE_BALANCE','asset':'ETH','address':ADDRESS,
 'snapshotPolicy':{'mode':'FINALIZED_AT_RUN'},'candidateServiceIds':['svc_primary','svc_backup'],'limits':policy['limits']}
save_json(E/'task_spec.json',task_spec)
checks = []
for i, rule in enumerate(['manifest_pin','capability_match','client_dependency_policy','response_schema','response_scope','snapshot_match','balance_match']):
    checks.append({'checkId':'chk_sample_'+str(i),'ruleId':rule,'required':True,'status':'PASS','reasonCode':'SAMPLE_MATCH',
      'expected':H if rule=='snapshot_match' else 'SAMPLE expected value','observed':H if rule=='snapshot_match' else 'SAMPLE expected value',
      'sourceClass':'REFERENCE_RPC','evidenceRefs':['ev_sample_reference'],'checkedAt':'2026-10-07T10:00:00Z'})
checks.append({'checkId':'chk_sample_provenance','ruleId':'remote_deployment_provenance','required':False,'status':'NOT_CHECKED',
 'reasonCode':'PROVENANCE_NOT_AVAILABLE','expected':'proved remote deployment','observed':None,
 'sourceClass':'NOT_AVAILABLE','evidenceRefs':[],'checkedAt':'2026-10-07T10:00:00Z'})
snapshot = {'sourceChainId':'1','blockNumber':'24500000','blockHash':H,'blockTimestamp':'2026-10-07T09:45:00Z',
 'capturedAt':'2026-10-07T10:00:00Z','tag':'finalized','assurance':'RPC_CROSS_CHECKED',
 'references':[{'sourceId':'ref_'+a,'operatorId':'operator_'+a,'observedBlockHash':H,
  'fetchedAt':'2026-10-07T10:00:00Z','balanceWei':'42125000000000000000'} for a in ['a','b']]}
fact = {'sourceChainId':'1','asset':'ETH','address':ADDRESS,'blockNumber':'24500000','blockHash':H,
 'balanceWei':'42125000000000000000','serviceId':'svc_primary'}
subjects=[{'serviceId':sid,'namespace':'agent-admission:sample:v1','transport':'MCP',
 'serviceOrigin':'https://'+('primary' if sid=='svc_primary' else 'backup')+'.example.invalid','manifestHash':'0x'+'44'*32,
 'ethereumIdentity':None,'identityStatus':'NOT_CHECKED'} for sid in task_spec['candidateServiceIds']]
report = {'schemaVersion':'1','reportId':'rpt_sample0001','executionMode':'SAMPLE','taskSpec':task_spec,'subjects':subjects,
 'taskSpecHash':'0x'+'00'*32,'policyHash':'0x'+'00'*32,'subjectHash':'0x'+'33'*32,'result':'SUCCEEDED',
 'snapshot':snapshot,'attempts':[{'attemptId':'att_sample0001','serviceId':'svc_primary','manifestHash':'0x'+'44'*32,
  'status':'PASSED','decision':'ALLOW','providerCallConsumed':True,'checks':checks,'responseDigest':None,'observation':None,
  'startedAt':'2026-10-07T10:00:00Z','finishedAt':'2026-10-07T10:00:01Z'}],
 'acceptedFact':fact,'observedAt':'2026-10-07T10:00:01Z','expiresAt':'2026-10-08T10:00:01Z',
 'limitations':['All addresses, balances, blocks and observations are synthetic SAMPLE data.',
  'No live RPC, model, signature or registry verification occurred.', 'Remote deployment provenance is not verified.']}
save_json(E/'public_report.json',report)
save_json(E/'approval_request.json',{'revision':1,'specHash':'0x'+'00'*32,'approvalNonce':'sample-nonce-not-authoritative'})
save_json(E/'ticket_claims_internal.json',{'version':'1','aud':'agent-admission-gateway:v1','taskId':'tsk_sample0001','runId':'run_sample0001','caller':'worker_sample',
 'taskSpecHash':'0x'+'00'*32,'snapshotHash':'0x'+'00'*32,'serviceId':'svc_primary','manifestHash':'0x'+'44'*32,
 'method':'eth_getBalance','argumentsHash':'0x'+'00'*32,'policyHash':'0x'+'00'*32,'stopEpoch':0,'policyEpoch':0,'leaseGeneration':1,
 'issuedAt':'2026-10-07T10:00:00Z','expiresAt':'2026-10-07T10:01:00Z','jti':'jti_sample0001'})
print('Generated schemas, API, tools, policy, states, 25 acceptance cases, and SAMPLE fixtures.')
