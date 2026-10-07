from pathlib import Path
import json

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'diagrams'
OUT.mkdir(exist_ok=True)
graphs=[]
def graph(id,title,scope,nodes,edges,rules,groups=None):
    # Each node: id, English render label, Chinese explanation, kind.
    graphs.append({'id':id,'title':title,'scope':scope,'nodes':[{'id':n[0],'label':n[1],'meaning':n[2],'kind':n[3] if len(n)>3 else 'process'} for n in nodes],
       'edges':[{'from':e[0],'to':e[1],'label':e[2] if len(e)>2 else ''} for e in edges],'rules':rules,'groups':groups or []})

graph('D01','系统架构与信任边界','区分模型建议、后端权限、外部服务和签名权限；箭头表示受控接口，不代表模型可直连。',[
 ('ui','User workspace','用户输入、补答、批准和停止；没有工具密钥'),('control','Control API','认证、版本、批准、停止和当前任务状态'),
 ('agent','Planner agent','单个编排 Agent，只输出提案和解释','external'),('db','Durable DB + outbox','任务真相、幂等、执行命令、租约与证据引用'),
 ('worker','Run worker','领取执行权并推进固定阶段'),('inspect','Inspection + policy','静态依赖、清单、能力与 required 检查'),
 ('gateway','Execution gateway','凭据、停止 epoch、策略 epoch、租约代际和预算'),('provider','Candidate services','管理员登记的两个候选；返回内容仍不可信','external'),
 ('reference','Reference resolver','两个配置上独立的 RPC 运营者、同一参考区块'),('verify','Deterministic verifier','按明确规则核对范围、数量、请求区块与参考结果'),
 ('evidence','Evidence builder','私有原件与可公开报告；规范化与摘要'),('publish','Publication worker','独立公开批准和持久登记命令'),
 ('signer','Restricted signer','固定链、合约、方法和预算；隔离密钥','security'),('chain','BOT registry','登记事件、回执和当前主链核查','external'),
 ('ethid','Ethereum identity','GCC 主线的身份适配停点；当前未接入','external')],
 [('ui','control','request / stop'),('control','agent','scope'),('agent','control','proposal'),('control','db','atomic state'),
  ('db','worker','run command'),('worker','inspect','admission'),('inspect','gateway','decision'),('worker','reference','fixed snapshot'),
  ('gateway','provider','bounded call'),('provider','verify','untrusted result'),('reference','verify','reference observations'),
  ('verify','db','guarded fact commit'),('verify','evidence','checks + facts'),('evidence','publish','report + approval'),
  ('control','publish','exact-hash consent'),('publish','signer','approved claim'),('signer','chain','persist then send'),
  ('ethid','inspect','identity reference')],
 ['模型不持有 gateway ticket、私钥、服务令牌；gateway_invoke 不是模型工具。','所有外部访问经过各自允许列表；参考源与候选源的独立性要有配置依据。','Ethereum 数据链、Ethereum 身份位置与 BOT 登记链分别记录；图中的 Ethereum 身份节点是交付阻断项。'],
 [{'name':'User surface','nodes':['ui']},{'name':'Control and persistence','nodes':['control','db']},{'name':'Bounded runtime','nodes':['agent','worker','inspect','gateway','reference','verify','evidence']},{'name':'Signing boundary','nodes':['publish','signer']}])

graph('D02','任务主流程与终态','主流程只描述一个已批准的只读任务；详细准入、停止和恢复分别见 D04、D06、D07。',[
 ('intent','User intent','用户提出原生 ETH 余额需求'),('draft','Compile task scope','模型提案经后端 schema 与范围校验'),('complete','Scope complete?','链、地址、资产、模式是否明确','decision'),
 ('clarify','NEEDS_INPUT','补答或选择唯一地址','wait'),('approve','AWAITING_APPROVAL','展示范围、候选、限额、版本和摘要','wait'),
 ('queue','QUEUED','批准和 run outbox 在同一事务中提交'),('ref','Resolve reference','固定参考区块并交叉核对'),('ready','Reference agrees?','参考链、区块和余额能否闭合','decision'),
 ('admit','Admission check','检查当前候选的能力、来源和依赖'),('invoke','Bounded invocation','网关准入与调用'),('accept','Required checks PASS?','本次验收和提交守卫是否全部通过','decision'),
 ('fallback','Fallback still allowed?','同一范围、同一 Snapshot、剩余候选和预算','decision'),('success','SUCCEEDED','只有通过验收的事实进入结果','success'),
 ('classify','Unknown evidence?','没有通过候选时，区分未知与确定失败','decision'),('quarantine','QUARANTINED','必需证据未知或冲突，不能给可用事实','wait'),('failed','FAILED','候选确定失败且无剩余获准路线','failure'),
 ('report','Immutable report','终态证据；公开登记另行批准')],
 [('intent','draft'),('draft','complete'),('complete','clarify','missing'),('clarify','draft','answer + revision'),('complete','approve','complete'),('approve','queue','exact approval'),
  ('queue','ref'),('ref','ready'),('ready','quarantine','no'),('ready','admit','yes'),('admit','invoke','ALLOW'),('invoke','accept'),('accept','success','yes'),
  ('accept','fallback','no'),('admit','fallback','reject / unknown'),('fallback','admit','yes: next candidate'),('fallback','classify','no'),
  ('classify','quarantine','yes'),('classify','failed','no'),('success','report'),('failed','report'),('quarantine','report')],
 ['未支持的资产、链或交易请求在生成可批准范围前返回 UNSUPPORTED_SCOPE。','切换不能增加预算、更改地址或改为 latest；参考冲突不能靠换候选绕过。','遇到确定性禁止规则立即停止该路线；已识别攻击不应由模型解释后放行。'])

graph('D03','参考区块与数据验收','原生 eth_getBalance 返回数量，不返回状态证明；请求绑定、服务声明和证明必须分开。',[
 ('scope','Approved chain + address','已批准 Ethereum 1 和地址'),('a','Reference operator A','读取 chainId、finalized 头、目标区块和余额','external'),('b','Reference operator B','不同运营者；不能仅以 URL 不同认定独立','external'),
 ('heads','Compatible finalized heads?','核对链、头偏差和可共同核对高度','decision'),('hash','Same canonical block hash?','共同高度两边区块 hash 一致','decision'),
 ('balance','Same reference balance?','在固定 blockHash 对照两份余额','decision'),('snapshot','Pin immutable Snapshot','保留区块、时间、来源、请求和响应摘要'),
 ('candidate','Parse candidate response','原件分别保留；校验 schema、范围和整数格式，失败不得进入验收'),('binding','Binding kind?','区分原生 RPC 请求绑定与服务自行声明','decision'),
 ('rpc','REQUEST_BOUND','核对实际发送的区块参数；不能声称服务提供了证明'),('declared','PROVIDER_DECLARED','检查服务声明的链、地址和区块是否相符'),
 ('compare','Compare exact wei','按本次参考值比较，不使用浮点','decision'),('accepted','Required data checks PASS','仅返回已解析的验收结果给 D02；提交仍需 epochs 与租约守卫','success'),('mismatch','Verification FAIL','确定的范围或数量失配；返回 D02 决定是否获准切换','failure'),('quarantine','INCONCLUSIVE','冲突、来源不可用或必需能力不足','wait')],
 [('scope','a'),('scope','b'),('a','heads'),('b','heads'),('heads','hash','yes'),('heads','quarantine','no'),('hash','balance','yes'),('hash','quarantine','no'),
  ('balance','snapshot','yes'),('balance','quarantine','no'),('snapshot','candidate'),('candidate','mismatch','malformed / wrong scope'),('candidate','binding','parsed'),('binding','rpc','raw RPC'),('binding','declared','enriched service'),('rpc','compare'),('declared','compare','scope matches'),('declared','mismatch','scope mismatch'),('compare','accepted','equal'),('compare','mismatch','different')],
 ['原生 RPC 把旧值返回但恰与当前值相同，不能据此判断其内部使用了哪个区块；只记录可观察到的一致性。','服务明确声明错误区块时拒绝该声明，并跳过跨区块金额比较；参考 RPC 交叉核对不等于密码学状态证明。','finalized 的区块时间早于当前时间是正常情况；不以单一墙钟阈值把 finalized 判为过期。'])

graph('D04','准入与网络出口控制','检查结果必须决定后端能否连接和提交，不能只作为 UI 分数。',[
 ('subject','Registered subject','固定命名空间、origin、transport、manifestHash'),('egress','Egress policy','HTTPS、获准 origin、解析地址与重定向策略'),('safe','Destination allowed?','连接目标是否仍在允许范围','decision'),
 ('reject','REJECT','明确禁止或确定失配；不得调用','failure'),('checks','Capability + dependency checks','精确版本、完整公告页、声明来源类别'),('required','Required evidence resolved?','必需检查是否具备可用结果','decision'),
 ('unknown','QUARANTINE','未知不是通过；可选未知单独展示','wait'),('pass','Required checks PASS?','所有必需规则通过；无覆盖性禁用','decision'),
 ('ticket','Issue one-call ticket','绑定 spec、snapshot、policy、manifest、caller、epochs 和代际'),('guard','Gateway guard','核验签名、当前权限、过期、预算与单次 jti'),
 ('dispatch','Atomic consume + dispatch','短事务登记消费、预算和逻辑调用开始'),('call','Bounded provider call','无额外跟随重定向；限制时长、字节与解析深度'),('result','Store response then verify','返回只作不可信数据；原件私有保存')],
 [('subject','egress'),('egress','safe'),('safe','reject','no'),('safe','checks','yes'),('checks','required'),('required','unknown','no'),
  ('required','pass','yes'),('pass','reject','no'),('pass','ticket','yes'),('ticket','guard'),('guard','reject','invalid / revoked'),
  ('guard','dispatch','current'),('dispatch','call'),('call','result')],
 ['公开环境拒绝内网、loopback、link-local 和云元数据目标；开发例外不能带入发布配置。','DNS 校验应约束实际连接地址并保留 TLS 主机校验；只提前查 DNS 再由客户端重新解析仍有窗口。','不把用户 token 原样转给其他 audience；不自动安装包或启动上传的 stdio 配置。'])

graph('D05','用户界面与断线交互','这里的连接状态属于客户端视图，不能写入后端 TaskStatus 冒充真实任务终态。',[
 ('form','Task input','输入需求；只读范围说明'),('draft','Scope or clarification','缺失条件补答；明确范围后展示批准卡'),('edit','Edit scope','增加 revision，作废旧摘要与 nonce'),('approve','Approve exact scope','提交同一版本、摘要、nonce 和幂等键'),
 ('ack','Acknowledgement known?','是否收到并能核对后端确认','decision'),('unknown','ACK_UNKNOWN view','显示确认状态未知；保留原 taskId 和键','wait'),('reconcile','Query task + resume events','续读 sequence，去重并查询当前任务'),
 ('running','Running workspace','显示阶段、预算和独立停止入口'),('stop','Request stop','立即发送控制请求；未 ACK 不显示已停止'),('terminal','Terminal evidence','成功、失败、隔离、取消分别说明'),
 ('preview','Public field preview','公开字段与精确 reportHash'),('publish','Publication panel','签名、广播、确认、UNKNOWN 独立显示'),('read','Public verification','摘要、签名、当前主链、撤销、期限与范围')],
 [('form','draft'),('draft','edit','change'),('edit','draft','new revision'),('draft','approve','complete'),('approve','ack'),('ack','unknown','timeout / disconnect'),
  ('unknown','reconcile','same task / same key'),('reconcile','running','running'),('ack','running','accepted'),('ack','draft','rejected / 409'),('running','stop','user stops'),
  ('stop','reconcile','await server truth'),('running','terminal','completed'),('reconcile','terminal','terminal'),('terminal','preview','explicit intent'),('preview','publish','exact-hash consent'),('publish','read','record available')],
 ['普通请求忙碌、事件断开或模型慢均不能禁用独立停止操作；鉴权过期时明确停止尚未确认。','批准 ACK 丢失后查原任务；安全重试使用原幂等键。已发生的状态不能由页面返回或刷新撤回。','公开后原始地址等字段可能被第三方保存；确认前展示真正将公开的字段。'])

graph('D06','停止竞争与晚到结果','竞争由数据库事务决定，不根据 UI 到达顺序猜测。',[
 ('request','Stop arrives','用户请求停止'),('state','Task already terminal?','先读取并锁定当前状态','decision'),('terminal','Return terminal fact','成功先提交则保持 SUCCEEDED','success'),
 ('epoch','Commit stopEpoch + revoke','写 STOP_REQUESTED；撤销未消费凭据'),('ack','ACK stop request','只有持久化成功才发送确认'),('race','Response commit guard','比较 task、stopEpoch、policyEpoch、leaseGeneration'),
 ('late','LATE_DISCARDED','停止先提交时不接纳晚到结果','wait'),('cleanup','Finish local work','不接受新 dispatch，不再切换'),('cancel','CANCELLED','本系统后续工作已收尾'),
 ('dbfail','Stop not acknowledged','持久化失败则告知状态未知并查原任务','failure')],
 [('request','state'),('state','terminal','yes'),('state','epoch','no'),('epoch','ack','durable'),('epoch','dbfail','write fails'),
  ('ack','race','in-flight response'),('race','late','guard mismatch'),('late','cleanup'),('ack','cleanup','no response'),('cleanup','cancel')],
 ['停止前已经 DISPATCH_COMMITTED 的请求可能继续发出或被远端处理；不承诺网络层撤回。','停止 ACK 后禁止新的逻辑 dispatch；外部晚到值不得生成成功结果或触发下一次调用。','终态报告不回写历史；后续发现产生独立事件或新报告版本。'])

graph('D07','工作器崩溃与持久恢复','恢复先检查已持久化的事实，再决定是否可执行下一步；不能靠重放整个 Agent 会话恢复权限。',[
 ('restart','Worker restart / lease expiry','进程退出、部署中断、超时租约'),('storage','Storage healthy?','数据库完整性、可写性与队列一致性','decision'),('freeze','Freeze new dispatch','数据库异常时停止新执行与新签名','failure'),
 ('lease','Acquire new fenced lease','增加 leaseGeneration，旧代际失效'),('committed','Fact already committed?','是否已有合法终态','decision'),('return','Return durable outcome','重复命令返回既有结果','success'),
 ('stored','Response stored?','是否有同一 Attempt 的完整私有响应','decision'),('verify','Re-run deterministic verifier','只重算校验，不重发外部请求'),('sent','Dispatch committed?','票据是否已消费并登记调用开始','decision'),
 ('dispatch','Execute pending dispatch','未消费时仍需核对当前授权和 epochs'),('uncertain','External outcome unknown','已消费且无响应；调用预算不退回','wait'),('next','Approved fallback available?','在剩余预算和固定 Snapshot 内','decision'),('fallback','New candidate + new ticket','最多一次备用切换'),('quarantine','QUARANTINED','无法恢复必需证据时保留不确定性','wait')],
 [('restart','storage'),('storage','freeze','no'),('storage','lease','yes'),('lease','committed'),('committed','return','yes'),('committed','stored','no'),
  ('stored','verify','yes'),('stored','sent','no'),('sent','dispatch','no'),('sent','uncertain','yes'),('uncertain','next'),('next','fallback','yes'),('next','quarantine','no')],
 ['旧工作器即使仍存活，也不能用旧 leaseGeneration 消费凭据或提交事实。','JSON-RPC 的 request id 不是远端任务查询接口；没有服务查询能力时不能声称已查回原调用。','恢复演练必须覆盖提交前后崩溃、重复 outbox 和损坏存储；本图是设计要求，不是已恢复成功的证据。'])

graph('D08','证据链与公共核验','把内容、主体、链上位置、时效和任务事实分开，使失败位置可定位。',[
 ('raw','Private raw artifacts','原始请求/响应、查询时间、来源、字节摘要'),('bundle','Build immutable public report','脱敏后保留范围、Snapshot、Subject、检查和局限'),('hash','Canonicalize + hash','JCS 与 Keccak-256；内容不含自身 hash 或链上状态'),
 ('integrity','Content hash matches?','下载的公开对象是否与承诺相符','decision'),('reject','Integrity FAIL','停止信任该内容；保留原声明和原因','failure'),
 ('signature','Signer + domain','登记链、合约、验证者、消息字段与签名'),('anchor','Current chain observation','receipt、目标合约、事件、区块 hash 当前是否匹配'),
 ('time','Validity + revocation','有效期、撤销记录及核查时间'),('scope','Scope + assurance','链、地址、Snapshot、方法、规则版本与来源级别'),
 ('vector','Verification vector','分别输出 PASS / FAIL / UNKNOWN，不压成安全总分'),('reuse','Historical selection signal','可参考历史观测；新调用仍需准入与验收')],
 [('raw','bundle'),('bundle','hash'),('hash','integrity'),('integrity','reject','no'),('integrity','signature','yes'),('integrity','anchor','yes'),('integrity','time','yes'),('integrity','scope','yes'),('signature','vector'),('anchor','vector'),('time','vector'),('scope','vector'),('vector','reuse')],
 ['未签名的报告也可核对内容；其 signer 与 anchor 仍为未验证。','URI 丢失时链上 hash 不能恢复原文；明确显示内容不可用。','单验证者证据和双 RPC 一致性均有信任假设，不能写成无条件真实或密码学状态证明。'])

graph('D09','链上登记与结果不明','Publication 表示登记工作进度；AnchorObservation 表示后来某次对当前主链的核对。',[
 ('preview','Preview exact reportHash','用户看到公开字段'),('approve','Approve publication','独立 nonce 与幂等键'),('queued','QUEUED','批准和 publication outbox 原子提交'),('signed','SIGNED + persisted tx','保存签名 bytes、txHash、nonce 后才发送'),
 ('broadcast','BROADCAST','RPC 接收不等于链上成功'),('unknown','UNKNOWN','超时或网络分歧；按原 txHash 查询','wait'),('confirm','CONFIRMING','收据、合约、事件及确认策略'),
 ('success','CONFIRMED history','在记录的核查时间符合确认策略','success'),('failed','FAILED','明确 revert 或不匹配事件；不冒充成功','failure'),('cancel','CANCELLED locally','仅能取消尚未广播且确认无发送竞争的工作','wait'),
 ('observe','Observe current chain again','公开核验时检查 blockHash 与撤销'),('current','CANONICAL / ORPHANED / UNKNOWN','当前链状态独立展示，不篡改历史报告')],
 [('preview','approve'),('approve','queued'),('queued','signed'),('queued','cancel','cancel before signing'),('signed','broadcast','send'),('signed','cancel','unsent + exclusive lock'),
  ('signed','unknown','send uncertain'),('broadcast','confirm'),('broadcast','unknown','timeout'),('unknown','confirm','original tx found'),('confirm','success','policy met'),('confirm','failed','revert / mismatch'),
  ('confirm','unknown','conflict'),('success','observe'),('observe','current')],
 ['P0 不自动提价换 nonce；同一已批准交易的重发恢复策略需记录，费用上限变化需新授权。','广播后的“停止”不能撤回已公开记录。撤销是一条新的公开记录，也不会删除旧数据。','确认后若重组，当前显示 ORPHANED 或 UNKNOWN；不能继续用历史 CONFIRMED 单独证明当前仍有效。'])

graph('D10','数据采集与同步','大量数据的价值来自来源、版本和可复核性；缓存命中不能代替新鲜度规则。',[
 ('catalog','Source catalog','RPC、OSV、上游公告、CISA、身份注册与构建材料'),('ingest','Bounded ingestion','允许列表、速率、重试上限和资源预算'),('complete','Complete and valid?','schema、分页、版本/区间、来源时间与摘要','decision'),
 ('incomplete','INCOMPLETE / STALE','缺页、限流、解析失败或过期；禁止当作无风险','wait'),('cache','Versioned evidence cache','sourceId、sourceVersion、modified、fetchedAt、hash'),('pin','Pin run evidence','Run 固定使用的来源版本与策略'),
 ('join','Normalize and deduplicate','CVE/GHSA/OSV alias 去重；不算多份独立证据'),('evaluate','Return resolved evidence','完整材料交给 D04 确定性规则，按观测给 PASS/FAIL，不因 required 就隔离'),('decision','Required or optional?','按任务策略决定阻断与展示','decision'),
 ('block','QUARANTINE','必需数据无法闭合','wait'),('annotate','Continue with limitation','可选缺失明确未验证'),('refresh','Background refresh','到期或变更触发；安全禁用只能收紧权限')],
 [('catalog','ingest'),('ingest','complete'),('complete','cache','yes'),('complete','incomplete','no'),('cache','pin'),('pin','join'),('incomplete','decision'),
  ('decision','block','required'),('decision','annotate','optional'),('cache','refresh'),('refresh','ingest','update'),('join','evaluate','apply deterministic rules')],
 ['OSV querybatch 按每个查询项继续分页；截断不能等同无公告。','客户端锁文件、服务方 SBOM 声明和远程实际部署证明是三类材料；来源权威不能补足部署关联。','参考 RPC、模型、依赖源及候选服务各有独立预算；“最多两次服务调用”不表示总外部请求只有两次。'])

graph('D11','构建部署与交付停点','同一产物进入测试与演示，使用明确的 LIVE、REPLAY、SAMPLE 标识。',[
 ('contract','Freeze reviewed contracts','范围、规则、接口、测试与 owner'),('build','Reproducible build','锁文件、构建标识、来源说明与 secrets 检查'),('verify','Contract + adversarial tests','正常路径、停止、恢复、未知与越权'),('pass','Release gate passes?','必须控制是否真实通过','decision'),
 ('fix','Fix or reduce claimed scope','失败项回到 owner；不改为绿色演示','failure'),('stage','Staging with real dependencies','真实模型、两个参考源、两个候选、持久库'),('accept','End-to-end acceptance','非作者操作；保留 trace、耗时、成本和接管次数'),
 ('deploy','Deploy exact artifact','分别记录应用 URL、链、合约、回执和配置'),('monitor','Readiness + recovery check','出口、数据库、签名器、预算与审计'),('submit','Competition materials','仓库、启动、视频、运行链接、新增工作、链上材料'),('rollback','Operational rollback','应用可回退；迁移按兼容方案，链上记录保留')],
 [('contract','build'),('build','verify'),('verify','pass'),('pass','fix','no'),('fix','build'),('pass','stage','yes'),('stage','accept'),('accept','deploy','passed'),
  ('accept','fix','failed'),('deploy','monitor'),('monitor','submit','healthy'),('monitor','rollback','fault'),('rollback','fix')],
 ['本地 schema/逻辑检查、浏览器检查、实际 API 和链上确认分别登记，不互相替代。','主网 gas 不足或配置缺失显示 blocked；赛后补部署不改变比赛作品截止时间。','GCC 以服务验收和 Ethereum 信任职责为主线；BOT 部署材料只证明相应链上的真实接入。'])

graph('D12','创新假设与市场验证','原生余额查询是控制与验收试验，商业价值需在真实接入成本和失败损失中验证。',[
 ('user','Target teams','链上数据/Agent 平台团队与安全负责人'),('pain','Measure current work','接入审查、结果核对、故障切换、事后追溯'),('baseline','Three baselines','直接调用、静态扫描、准入加持续验收'),
 ('pilot','Matched pilot cases','相同样本、来源、任务和故障分布'),('measure','Measure utility + cost','完成率、误接纳、误拒绝、时延、成本、人工介入'),('value','Net value demonstrated?','验证收益是否超过额外查询与运营成本','decision'),
 ('narrow','Narrow or change use case','廉价余额无需第三方验收时收窄商业承诺','wait'),('adopt','Repeat paid use','自愿复用和付费试点；不是主观打分'),('moat','Reusable evidence assets','开放规则、可重放案例、服务历史与集成积累')],
 [('user','pain'),('pain','baseline'),('baseline','pilot'),('pilot','measure'),('measure','value'),('value','narrow','no'),('narrow','pain','reframe'),('value','adopt','yes'),('adopt','moat'),('moat','pilot','new evidence')],
 ['已有依赖安全与 Agent/MCP 扫描产品；不能以产品名称不同推断市场空白。','候选差异化是任务相关验收、受限执行、可复核的公共失败记录与停止恢复；仍需需求和成本证据。','开放方法与案例形成公共物品；企业收费可来自托管、私有策略、监控和集成，不能以收集隐私日志建立壁垒。'])

(OUT/'diagram_specs.json').write_text(json.dumps(graphs,ensure_ascii=False,indent=2)+'\n')
for g in graphs:
    lines=['flowchart TD']
    for n in g['nodes']:
        label=n['meaning'].split('；')[0]
        if len(label)>26:label=label[:24]+'…'
        label=n['id']+' '+label
        label=label.replace('"','＂')
        if n['kind']=='decision':lines.append(f'  {n["id"]}{{"{label}"}}')
        else:lines.append(f'  {n["id"]}["{label}"]')
    for e in g['edges']:
        label=e['label'].replace('"','＂')
        lines.append(f'  {e["from"]} -->'+(f'|"{label}"|' if label else '')+f' {e["to"]}')
    (OUT/(g['id']+'.mmd')).write_text('\n'.join(lines)+'\n')

cases=[]
def case(id,category,trigger,detect,decision,state,ui,recovery,evidence,diagram,owner,test,priority='P0'):
    cases.append(dict(caseId='SC-'+id,testId='AT-'+id,category=category,trigger=trigger,detector=detect,decision=decision,
      expectedState=state,userMessage=ui,recovery=recovery,evidence=evidence,diagrams=diagram.split(','),owner=owner,
      verification=test,priority=priority,implementationStatus='DESIGN_REQUIRED'))

case('T01','任务与授权','需求缺地址或有多个地址','TaskDraft 编译器','补答，不创建执行命令','NEEDS_INPUT','请明确本次核验地址','用户补答，增加 revision','缺失字段、revision、无调用记录','D02,D05','Control/Agent','无地址输入后检查 providerCalls=0')
case('T02','任务与授权','ERC20、其他链、转账或任意 URL','范围编译器','拒绝未支持范围','不生成可批准 TaskSpec','当前只支持原生 ETH 余额只读核验','修改需求后重建提案','UNSUPPORTED_SCOPE 与解析范围','D02,D04','Control','未支持意图无法生成 gateway ticket')
case('T03','任务与授权','用户修改已展示的范围','revision/specHash 比较','旧批准和 nonce 失效','AWAITING_APPROVAL 或 NEEDS_INPUT','范围已变化，请核对新版本','重新批准新版本','旧/新摘要、revision、事件','D05','Control/Web','旧批准请求返回 409，未入队')
case('T04','任务与授权','批准重复点击或 ACK 丢失','owner+route+Idempotency-Key','同键同体返回既有 Run','当前持久状态','正在核对原任务是否已获准','查原 task；必要时原键重试','请求摘要、幂等记录、唯一 Run','D05,D07','Control','重复/并发批准只生成一个 outbox')
case('T05','任务与授权','相同幂等键携带不同请求体','幂等摘要比较','409，不产生新动作','当前状态不变','该请求键已用于其他内容','更正客户端状态，不自动换键执行','原/新请求摘要、traceId','D05','Control','同键不同 hash 不签票据')
case('T06','任务与授权','跨 owner 读取/批准/停止/下载原件','每个对象的归属校验','拒绝，不泄露存在性或 nonce','当前状态不变','无权访问此任务','使用合法会话或任务','访问主体、对象引用、拒绝原因','D01,D05','Control','第二账号不能获取任何私有报告')
case('T07','任务与授权','票据过期、重放、caller 或参数不符','Gateway 验签及原子 jti 消费','拒绝 dispatch','Attempt REJECTED','本次调用授权无效','同范围重新评估并签新票据，计入预算','jti、绑定字段摘要、拒绝码','D04,D07','Gateway','重放及并发消费仅最多一次成功')
case('T08','任务与授权','批准后策略禁用或新风险紧急收紧','policyEpoch 与当前 denylist','撤销未消费票据，禁止放宽','QUARANTINED 或停止收尾','安全策略已收紧，本次暂停','修复后生成新范围/批准','策略版本、epoch、禁用原因','D04,D10','Policy','旧票据不能穿越安全禁用')
case('A01','Agent','模型连接未配置','启动 readiness 与模型适配器','阻断在线创建；不得伪装模型输出','创建返回 CONFIGURATION_REQUIRED','在线模型尚未配置','配置后重试；结构化模式需显式标注','配置存在性，不记录秘密','D01,D11','Agent','LIVE 创建不会返回 SAMPLE 提案')
case('A02','Agent','模型超时或 429','适配器计时和预算','有限重试；超限失败','创建失败或 Run FAILED','模型暂不可用，尚未执行新工具','预算内重试；否则新任务','请求次数、耗时、模型错误码','D02,D11','Agent','计入模型预算，停止入口仍可用')
case('A03','Agent','模型输出不符合 schema 或猜测地址','确定性编译器','不批准非法结构','NEEDS_INPUT 或 INVALID_INPUT','需要补充或修正范围','有限纠正一次或用户补答','原提案私有、校验错误','D02,D05','Agent/Control','额外字段与猜测值不能进入 TaskSpec')
case('A04','Agent','工具描述/响应包含越权指令','文本隔离与工具允许表','当数据处理；后端拒绝越权','当前受控流程或 QUARANTINED','服务内容含不可信指令，已限制处理','跳过可疑候选或结束','摘要、来源、命中规则、工具审计','D01,D04','Agent/Gateway','诱导 shell、提预算、签名均无可调用权限')
case('A05','Agent','模型循环调用或重复选择服务','服务器模型/工具预算','终止新模型动作','FAILED 或确定性报告完成','已达到任务预算','不自动增加预算；用户另开任务','回合、token、候选和调用计数','D02,D04','Worker','超过 4 回合/2 次候选调用被阻止')
case('A06','Agent','解释包含无依据金额或错误引用','报告事实引用校验','丢弃解释，模板回退','事实状态保持不变','显示已核验事实与范围','重建确定性说明','解释版本、事实 ID、失配原因','D08','Evidence','虚构数字不进入正常结果或 PublicReport')
case('A07','Agent','Agent 运行时自动暴露 shell 或自修改','启动时能力清单比对','readiness 失败，拒绝运行','CONFIGURATION_REQUIRED','运行能力超出获准配置','移除扩展后重新部署','有效工具清单、构建版本','D01,D11','Agent/Ops','非五个允许工具导致发布阻断')
case('N01','网络','TLS 证书或主机校验失败','受限 HTTP 客户端','不关闭验证，不降级 HTTP','Attempt INCONCLUSIVE','服务连接身份无法核对','允许的备用路线或隔离','TLS 原因码、origin、时间','D04','Gateway','错误证书不能继续取得响应')
case('N02','网络','DNS rebinding、私有地址或云元数据目标','实际连接地址约束','连接前拒绝','Attempt REJECTED','服务目标不符合网络策略','管理员修正登记，用户不可放行','解析集合、实际目标、规则','D04','Network','只校验域名而实际连接私网的测试必须失败')
case('N03','网络','跨 origin 重定向或 metadata URL','出口策略与逐跳校验','默认不跟随；不得携带原令牌','Attempt REJECTED','服务跳转超出允许范围','管理员新增独立配置后重试','Location 摘要、目标、拒绝码','D04','Network','令牌不流向重定向目标')
case('N04','网络','JSON 超大、压缩膨胀、超深或重复 key','流式字节/解压/解析限制','中止并记录无效数据','Attempt FAILED 或 INCONCLUSIVE','响应超出安全处理范围','可用备用服务；不提高限额','字节计数、内容摘要、解析码','D04','Gateway','1 MiB 与深度上限触发后不继续缓冲')
case('N05','网络','连接超时、半开、断流或读取中断','请求 deadline 与完整性检查','不假装得到空余额；计入已提交调用','Attempt INCONCLUSIVE','服务响应不完整或超时','同快照获准备用；无路则 QUARANTINED','dispatch、耗时、已收字节、错误','D02,D07','Gateway','超时不返还已消费预算，不重用 jti')
case('N06','网络','服务 429 或 5xx','HTTP/RPC 分类','候选调用不盲目重发','Attempt INCONCLUSIVE','服务暂不可用','使用获准备用；新尝试计预算','状态码、Retry-After、尝试记录','D02,D04','Gateway','自动库重试不能使实际调用超过 2 次')
case('N07','网络','浏览器事件流断开或消息乱序','sequence、游标与任务查询','保持最后状态并标记连接过期','客户端 DISCONNECTED；Task 不改写','连接已中断，显示的是上次状态','按游标续读并查询当前 Task','事件序号、更新时间','D05','Web','乱序/重复事件不能把终态倒退成运行中')
case('N08','网络','用户停止时鉴权过期或控制请求失败','停止响应与会话校验','不显示已停止','客户端 STOP_ACK_UNKNOWN','停止请求尚未确认','恢复认证并查询原任务；控制路径仍优先','stop 请求 ID、响应状态、当前任务','D05,D06','Web/Control','网络失败不直接写本地 CANCELLED')
case('D01','数据','两个参考源链 ID 或区块 hash 冲突','Reference resolver','不使用多数掩盖冲突','QUARANTINED','参考来源不一致，暂不能判断','修复来源后新任务','各参考原件、运营者、区块 hash','D03','Data','参考冲突时 providerCalls=0')
case('D02','数据','finalized 头偏差超过配置窗口','头高度与源健康检查','不退回 latest','QUARANTINED','参考节点同步状态不满足策略','修复节点或等待后新任务','两端高度、窗口、采集时间','D03','Data','超窗时不能构造 PASS Snapshot')
case('D03','数据','同一参考区块的余额仍不一致','两份精确 wei 比较','不凭候选多数判真','QUARANTINED','同区块参考余额不一致','排查独立性与节点后重试','两份数量及相同 hash','D03','Data','参考数量冲突时无 acceptedFact')
case('D04','数据','服务明确声明错误区块','PROVIDER_DECLARED 绑定核对','拒绝快照声明，跳过跨区块余额比较','Attempt FAILED','返回声明不属于本次目标区块','同 Snapshot 备用候选','期望/声明 blockHash、bindingKind','D03','Verifier','错误块不同时再报虚构余额错误')
case('D05','数据','原生 RPC 仅返回数量，或旧值恰好相同','适配器 bindingKind 分类','只声称请求绑定与数值一致性','按参考对照决定；不产生 PROOF_VERIFIED','未提供密码学状态证明','后续可增加可信区块头与证明方案','原始 RPC 请求/响应、请求 hash','D03,D08','Verifier','自身附加的 blockHash 不能升级为服务证明')
case('D06','数据','地址/资产/chainId 或整数格式错误','规范化与精度校验','确定性拒绝，不做浮点补正','Attempt FAILED','返回内容不符合本次查询范围','获准备用或结束','schema 错误、范围和原件摘要','D03,D04','Verifier','溢出、浮点、错误地址与负数均被拒绝')
case('D07','数据','OSV 限流、缺页、超时、缓存过期','完整性和 fetchedAt 策略','必需信息未知时阻断','QUARANTINED','依赖公告检查尚未完成','后台有界续页/更新；不可静默略过','分页 token 进度、源版本、时间','D10','Data','只取得第一页不能显示无已知公告')
case('D08','数据','锁文件版本无法确定或公告区间不清','生态/包名/精确版本解析','不按包名猜测安全性','QUARANTINED','无法确认本次依赖版本的受影响情况','补齐锁文件或维护者资料','锁文件 hash、版本、区间依据','D04,D10','Inspection','unknown 版本不能返回依赖 PASS')
case('D09','数据','远程 SBOM 缺失或无法绑定真实部署','来源分类与策略 required 标志','可选缺失显示未验证；必需缺失阻断','可继续或 QUARANTINED','远程部署来源未验证','补部署证明；不能用客户端锁文件顶替','VERIFIED_ARTIFACT/PROVIDER_DECLARED/NOT_AVAILABLE','D04,D10','Inspection','两种策略分别验收，不能一律放行或全拒')
case('D10','数据','同一公告出现在 OSV/GHSA/CVE 多个入口','aliases 与上游 provenance 去重','去重并保留来源链','状态按独立规则判定','同源记录合并展示','增量合并与原件追溯','aliases、upstreamId、抓取时间','D10','Data','不把同一公告算多份独立证据')
case('O01','运行与恢复','数据库写失败、磁盘满或损坏','readiness、事务返回、存储完整性','冻结新 dispatch 和签名；不能假 ACK','无可靠新终态，客户端状态未知','服务无法持久化本次操作','运维恢复后核查原任务','错误码、最后成功提交位置','D06,D07,D11','Ops','停止落库失败时不返回已确认停止')
case('O02','运行与恢复','工作器在票据消费前退出','lease 与 dispatch 记录','新代际恢复未完成命令','当前 Run 恢复执行','任务恢复中','重新核对 scope/epochs 后调用','leaseGeneration、jti、未消费证明','D07','Worker','恢复不创造重复 Run')
case('O03','运行与恢复','票据已消费但响应未落库时退出','DISPATCH_COMMITTED 与响应缺口','承认外部结果未知；预算不退款','Attempt INCONCLUSIVE','原调用结果未知','同范围新票据备用或隔离','dispatch 时间、预算、恢复原因','D07','Worker','不能复用原 jti 自动重发')
case('O04','运行与恢复','响应已存但事实尚未提交时退出','原件摘要与验证记录','重算确定性验收','按校验结果进入终态','正在恢复已收到的结果','不再访问候选服务','原件 hash、规则版本、提交守卫','D07','Worker/Verifier','恢复不得增加 providerCalls')
case('O05','运行与恢复','旧工作器在新租约后仍提交','leaseGeneration fencing','拒绝旧代际消费和提交','当前 Run 不被旧进程改写','显示当前有效运行状态','由当前租约继续','旧/新代际、拒绝原因','D04,D07','Worker','双工作器竞争只能一方提交')
case('O06','运行与恢复','停止与成功提交同时发生','数据库 CAS 的提交顺序','先提交的合法转换胜出','SUCCEEDED 或 STOP_REQUESTED/CANCELLED','展示后端确定状态','晚到结果丢弃或返回已有成功','事务顺序、epochs、事件','D06','Control/Worker','同时触发两种顺序都验证')
case('O07','运行与恢复','系统时间跳变或时钟偏差','UTC 记录与单调 deadline','超范围凭据不继续使用','QUARANTINED 或鉴权拒绝','时间条件不满足本次授权','修复时钟后重新签发，不改旧记录','时间源、偏差、过期值','D04,D07','Ops','向后调墙钟不能延长运行预算')
case('O08','运行与恢复','未分类异常或未知错误码','顶层异常边界与状态事务','停止新动作，保留可诊断原因','FAILED 或 QUARANTINED；无法落库则未知','任务未能完成，提供 traceId','分类复核后才能新任务','已完成阶段、traceId、脱敏错误','D02,D07','Worker','异常不落入默认 ALLOW 分支')
case('B01','区块链与证据','RPC 指向错误网络或测试网','chainId/合约代码/配置比对','阻断签名与发布','Publication FAILED 或未创建','登记网络配置不符','纠正配置并新审批','实测 chainId、代码 hash、配置版本','D09,D11','Chain','不能把测试网交易作为 BOT Mainnet')
case('B02','区块链与证据','Gas 不足或 signer 不可用','签名前 readiness','不生成成功交易','QUEUED 等待或 FAILED','登记暂不可用，任务结果保留','补足获准资源后显式重试','余额/预算检查、错误码','D09','Chain','无 txHash 时无浏览器成功链接')
case('B03','区块链与证据','签名后广播超时','已存 signed bytes 与 txHash','按原 hash 核查，拒绝新无关 nonce','UNKNOWN','登记结果尚不明确','有界查询或同一原始交易恢复','原 txHash、nonce、bytes 摘要','D09','Chain','超时不能重复创建第二笔登记')
case('B04','区块链与证据','交易明确 revert 或事件不匹配','receipt 与目标事件解码','不显示登记成功','FAILED','交易失败或记录不匹配','修复后另建显式 publication job','receipt status、address、topics、logIndex','D09','Chain','只看 receipt.status=1 不足以 CONFIRMED')
case('B05','区块链与证据','确认前链重组或 RPC 分歧','当前 canonical hash 对照','继续核查，保留不确定性','CONFIRMING 或 UNKNOWN','主链确认尚未闭合','按同一交易持续检查','旧/新区块 hash、观察时间','D09','Chain','不以单一 RPC 一次回应完成确认')
case('B06','区块链与证据','曾确认记录后来脱离主链','当前 AnchorObservation','保留历史，当前标为 ORPHANED/UNKNOWN','Publication 历史不改；当前核验失败/未知','该登记当前不在已核对主链上','复核同 tx 或新批准记录','checkedAt、旧/当前 blockHash','D08,D09','Chain','历史 CONFIRMED 不覆盖当前孤块观察')
case('B07','区块链与证据','nonce 被其他 signer 作业占用或交易替换','专用 signer nonce 管理','停止猜测；核对同账户同 nonce','UNKNOWN 或明确 FAILED','登记交易需要复核','仅按受控策略恢复；费用变更新授权','sender、nonce、原/替代 txHash','D09','Chain','不能将不同 payload 的替代交易归属本报告')
case('B08','区块链与证据','公开报告被篡改或预览后内容变化','规范化 hash 与批准快照','拒绝签名/发布或公共核验失败','不新建 publication；integrity FAIL','内容与原摘要不符','恢复原件或生成新报告再批准','基准/实际摘要、报告版本','D08,D09','Evidence','改一位金额后旧批准不能使用')
case('B09','区块链与证据','URI 丢失、内容过期或撤销','公共读取、时间与撤销核对','各层独立给出不可用/失效','Verification UNKNOWN/FAIL','内容不可用或记录已失效','允许重新取原件；新任务须重新验收','URI/内容摘要、到期、撤销事件','D08','Evidence','链上 hash 存在不能冒充原文可访问')
case('B10','区块链与证据','验证者密钥受损或主体解绑','可信验证者配置与事件/身份追踪','冻结新签名与该主体信任','新发布 blocked；旧报告标记复核','验证者可信状态发生变化','独立审查、撤销/新 registry；旧记录保留','信任配置版本、事件、受影响摘要','D08,D09','Security','P0 固定验证者不能假称具备在线密钥轮换')
case('B11','区块链与证据','刷分、关联验证者或同名服务混淆','全局 Subject 引用与来源相关性','不聚合成无条件安全分','历史信号有限使用','身份或来源独立性未验证','收集可重放案例与独立验证者','namespace、identityRegistry、agentId、时间窗','D01,D08,D12','Evidence/Product','两个私有 svc_primary 别名不能合并信誉')
case('E01','交付与商业','将 SAMPLE/REPLAY 当 LIVE 展示','运行模式与来源来源记录','阻断不实验收声明','交付项 BLOCKED','当前为样例或回放模式','真实联调后单独记录成绩','executionMode、原始 trace、构建号','D11','QA','模型/RPC 未连不能计在线成功')
case('E02','交付与商业','主网部署材料缺项或迟交','交付清单与截止时间','标记缺项，不把主办方目标当单队分数','交付项 BLOCKED','缺少可核验部署/提交材料','按实际完成范围提交并联系工作人员处理异常','仓库、链接、交易、视频、提交回执','D11','PM','10 月 8 日 12:00 北京时间前材料可访问')
case('E03','交付与商业','两参考 RPC 已能直接回答简单余额','成本与基线对照','限定技术演示的商业结论','市场假设待验证','先证明接入/核对/追溯成本收益','转向高价值任务模板与托管验收','人工步骤、总成本、重复使用证据','D12','Product','直接调用与本系统在同任务下对照')
case('E04','交付与商业','声明无人竞争或已获先发优势','原厂产品与用户访谈核对','撤回未经验证的领先表述','市场假设待验证','差异化仍需试点证明','验证购买角色、替代方案和付费意愿','竞品日期、访谈事实、试点结果','D12','Product','不能把未检索到功能作为竞品不存在的证明')
case('E05','交付与商业','未知新风险不在当前清单','事件复盘与变更评审','先冻结受影响能力，再补规则与回归','受影响任务隔离','该能力正在复核','新增场景、规则、测试和版本后开放','新场景 ID、责任人、回归与变更记录','D07,D11','Security/PM','没有“其他情况默认通过”分支')

catalog={'version':'0.2','scope':'Ethereum native ETH read-only tasks with registered HTTP/MCP services; all cases are design/acceptance requirements, not evidence of implemented backend controls.',
 'exhaustiveness':'Finite set of identified scenarios. Unknown incidents use SC-E05/SC-O08; this is not proof that every possible failure or attack is covered.',
 'cases':cases}
(ROOT/'contracts/scenario_catalog.json').write_text(json.dumps(catalog,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'diagrams':len(graphs),'scenarios':len(cases)}))
