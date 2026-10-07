from pathlib import Path
import json, html, re
R=Path(__file__).resolve().parents[1]
G=json.loads((R/'diagrams/diagram_specs.json').read_text())
C=json.loads((R/'contracts/scenario_catalog.json').read_text())['cases']
(R/'review').mkdir(exist_ok=True)
intro='''# Agent 工具与依赖准入检查器：架构、交互与异常图谱

版本 0.2 · 2026-10-07 · 设计基线。配套 `PRD_Architecture_Interaction.md`、`Architecture_Workflow_Atlas.html` 和机器合同。

**产品承诺：对获准的具体任务，检查允许调用什么、实际返回是否满足验收规则，并留下有范围、有来源、有局限的可复核记录。** Agent 提议与解释，后端确定性组件决定权限和事实，区块链保存跨主体可验证的记录承诺。

本图谱包含 12 个视图与 57 种已识别异常。每项异常均有检测点、动作、状态、用户提示、恢复、证据、责任人与验收方法。它是有边界的风险模型，不声称穷尽所有攻击或故障；未知事件进入 SC-O08 / SC-E05，冻结受影响能力后复核。

**当前交付成熟度：** 图、PRD、合同、样例和离线交互设计已制作；后端、真实模型、真实数据、安全控制、数据库恢复、签名器及主网部署尚未通过实际联调。57 项场景均标记 `DESIGN_REQUIRED`，不能作为已通过的安全测试。原有 25 项验收计划与本目录重叠，不相加为 82 项。

## 1. 范围、用户与取舍

| 层级 | 目标 | 本次范围与边界 |
| --- | --- | --- |
| 首要用户 | 需要接入第三方工具的研究 Agent 开发者、平台工程师 | 为一次服务选择提供可解释、可复核的准入与验收 |
| 首要任务 | 查询 Ethereum 地址的原生 ETH 余额 | chainId=1；finalized 固定 Snapshot；精确 wei；只读 |
| 候选 | 管理员预登记的 HTTP RPC 或 MCP 服务 | 最多两个候选、两次候选调用、一次备用切换；默认拒绝任意 URL |
| Agent | 单个受限编排 Agent | 五个模型可见工具；不能签发凭据、改变策略、运行 shell 或签交易 |
| 安全 | 客户端依赖、能力、网络出口、任务验收、证据完整性 | 远程部署 SBOM 未绑定部署时只作声明；不保证发现所有漏洞与注入 |
| Blockchain | Ethereum 数据/身份职责；BOT 独立证据登记 | BOT chainId=677；Ethereum 身份适配尚未完成；两条链不得混写 |
| P1 | 更高价值只读服务的可复用验收模板 | 先证明客户效用，再增加历史数据、索引服务和证明验证 |
| 延后 | 自动安装依赖、stdio、任意网页抓取、交易写入、资金托管 | 需要独立威胁模型与权限设计，不能从当前只读合同直接扩展 |

原生余额适合验证闭环，但两个参考 RPC 已能回答该问题。这个例子不能单独证明商业必要性；必须验证复杂服务集成、人工核查或事故追溯的成本是否下降。市场领先和支付意愿仍是待验证假设。[S8–S9]

## 2. 必须维持的安全不变量

| ID | 不变量 | 主要落实位置 |
| --- | --- | --- |
| I01 | 用户批准 exact revision/specHash/nonce；变更使旧批准失效 | Control、任务事务、D05 |
| I02 | 模型输出只作建议，不生成权限与已验收事实 | 工具允许表、Gateway、Verifier |
| I03 | required 检查未知时不 ALLOW；optional 未知明确展示 | Policy、D04、D10 |
| I04 | 实际连接目标、方法、参数、Snapshot 与短期凭据一致 | Egress、内部签名凭据、D03–D04 |
| I05 | jti 单次消费、预算递增与 DISPATCH_COMMITTED 原子提交 | 数据库短事务、D04 |
| I06 | 新 dispatch 与结果提交均核对 stopEpoch、policyEpoch、leaseGeneration | Worker、Gateway、D06–D07 |
| I07 | 停止 ACK 必须已持久化；已提交的外部调用仍可能被远端处理 | Control；前端不可假显示“已撤回” |
| I08 | PublicReport 不含自身 hash、签名、交易状态或私密令牌 | Evidence、JCS、D08 |
| I09 | 公开登记批准只覆盖确定 reportHash；发送前持久化签名交易 | Publication、Signer、D09 |
| I10 | 历史 CONFIRMED、当前主链、撤销、期限、内容完整性分别核验 | AnchorObservation、VerifyResult |
| I11 | LIVE 不可取 SAMPLE 数据；空配置、缺页、异常不进入默认成功 | 所有适配器与发布门槛 |
| I12 | 新风险优先禁用受影响范围；模型和用户页面不能自行放宽 | Policy 管理权限、事件响应 |

策略在 Run 内固定；安全禁用增加 policyEpoch 后，旧 Run 隔离或停止收尾，恢复时新建任务并重新批准。这样不会偷偷修改旧报告的 policyHash。租约恢复则允许新工作器在同一固定策略下，接管已持久化且摘要正确的响应重新验收；记录接管事件和新代际，不能重发已消费的外部调用。

## 3. 图谱目录

图中灰色为外部或低信任输入，紫色为签名隔离，绿色为通过，黄色为待处理或未知，红色为拒绝。SVG/PNG 使用短英文节点便于工程对齐，中文 Mermaid 与节点表提供完整含义。每个视图只描述一种关系；它们共同构成工作链路，不把所有细节挤在一张总图中。

| 图 | 解决的问题 | 对应工程产物 |
| --- | --- | --- |
'''
mapout={'D01':'权限与模块接口','D02':'Task/Attempt 状态机','D03':'Snapshot 与 InvocationObservation','D04':'准入票据、出口策略、预算事务','D05':'页面状态、操作与反馈','D06':'停止事务与提交守卫','D07':'持久恢复与 fencing','D08':'不可变报告与核验向量','D09':'Publication 与 AnchorObservation','D10':'数据来源、缓存和分页规则','D11':'发布、回滚和提交清单','D12':'用户试点与市场假设'}
for g in G:intro+=f"| {g['id']} {g['title']} | {g['scope']} | {mapout[g['id']]} |\n"
body=intro+'\n'
for g in G:
    mermaid=(R/"diagrams"/(g["id"]+".mmd")).read_text().strip()
    body+=f"## {g['id']}. {g['title']}\n\n{g['scope']}\n\n```mermaid\n{mermaid}\n```\n\n"
    body+='| 图内名称 | 中文含义 |\n| --- | --- |\n'
    for n in g['nodes']:body+=f"| {n['label']} | {n['meaning']} |\n"
    body+='\n'
    for rule in g['rules']:body+='- '+rule+'\n'
    linked=[c['caseId'] for c in C if g['id'] in c['diagrams']]
    body+='\n异常覆盖：'+ '、'.join(linked)+'。详细处理与验收见 `review/Scenario_Coverage.md`。\n\n'
append='''## 4. 数据的权威性、可获得性与同步

“来源权威”“数据完整”“适用于本任务”“证明真实”是不同条件。每份证据保存原件摘要、sourceId、operatorId 或上游、sourceVersion、fetchedAt、适用范围、完整性与新鲜度状态；不要用一个安全分替代这些信息。

| 数据/来源 | 获取与同步设计 | 可以支持的结论 | 不能支持的结论与失败处理 |
| --- | --- | --- | --- |
| Ethereum JSON-RPC 与 EIP-1898 [S1–S2] | 两个配置上独立运营者；逐 Run 固定共同 finalized 区块；取原始请求/响应 | 指定区块请求下的数量交叉一致 | 原生 eth_getBalance 只返回 QUANTITY，不带区块证明；不一致或缺能力则隔离 |
| OSV 官方 API [S3] | 精确生态/包名/版本批量查询；每个查询各自处理 next_page_token；必要时取完整公告 | 在采集时可检索到的已知受影响情况 | 缺页或失败不等于零漏洞；远程服务的实际部署也不能由客户端锁文件证明 |
| 公告上游与官方维护者 | 由公告链接追溯上游，保留 aliases 和修改时间 | 对版本区间与修复声明的来源追踪 | OSV、GHSA、CVE 同源记录不能算多个独立证明 |
| CISA KEV 官方镜像 [S4] | 以官方发布数据与版本记录增量同步；追踪原始政府目录 | 已知被利用漏洞的优先处置线索 | 未列入不代表未被利用或安全；P0 补充信号，不取代 OSV 完整性 |
| 自有 lockfile、构建摘要、SBOM | 不安装包；锁定文件 hash、生成方式和实际构建关联 | 自己控制的具体客户端构建材料 | 外部上传 SBOM 默认只是声明；无部署绑定不能写“远程代码已核验” |
| Ethereum 身份注册 [S5] | 从明确 chainId/registry/agentId 读取，固定观察区块与时间 | 该注册位置的身份引用及当前观察 | 注册不保证能力或善意；当前适配未完成，UI 显示未验证 |
| 本系统调用与停止日志 | 每阶段落库、单调事件序号、请求/响应原件私有保存 | 本系统观察到的行为与决定 | 本系统有漏记或存储故障时不能猜测远端执行结果 |
| BOT 回执与登记事件 [S6] | 核对 chainId、合约、receipt、事件、当前 blockHash 与确认配置 | 记录在该网络的登记事实与当前观察 | hash 无法恢复丢失内容；广播不等于确认；确认不等于内容真实 |

初始同步策略是设计参数：OSV 缓存最长 1 小时；单 Run 参考 RPC 上限 12 次、公告 HTTP 请求上限 20 次；候选调用预算仍是 2 次。完整命中的缓存可复用，但必须满足版本及新鲜度策略；超限而未取全则 required=INCONCLUSIVE。后台更新产生新证据版本，当前 Run 不被静默改写。规模化阶段应先建立版本化公共缓存、批量查询和增量更新，再扩大包生态与任务类型。

数据访问前需记录接口凭据、配额、可用区域、条款与是否可公开再分发；此设计未获得任何服务的无限配额或实时性承诺。API 可访问性是启动 readiness 与持续健康检查的对象，不能由“官网存在”推断。

## 5. 威胁模型与边界

| 边界 | 典型威胁 | 预防/检测/恢复 | 残余风险 |
| --- | --- | --- | --- |
| 用户 → Control | 越权取证、重复批准、旧版本重放、CSRF | owner 从会话派生；对象级鉴权；幂等键与版本；Cookie 部署加 CSRF | 会话被盗仍需限额和撤销；前端不是安全边界 |
| 服务文本 → Agent | 间接提示注入、伪造能力、诱导提权 | 规范化字段；工具允许表；模型建议二次校验；解释用事实引用 | 无法保证检测所有文本攻击；后端权限必须独立成立 |
| 工具/包 → 运行环境 | 安装脚本、污染锁文件、恶意 stdio | P0 不自动安装或执行上传配置；锁文件只读；部署依赖固定 | 自身运行时供应链也要维护；扫描结果不是安全认证 |
| URL/DNS → 网络 | SSRF、重绑定、重定向泄密、元数据读取 | 登记 origin；实际连接地址约束；TLS 主机校验；禁止未获准重定向 | 仅检查一次 DNS 不充分；各出口都须适用，包括参考/公告访问 |
| 响应 → 解析/存储 | 超大内容、解压炸弹、深层 JSON、脚本或日志注入 | 解压后字节/深度/时长限制；unknown→schema；文本渲染；日志白名单 | 大规模拒绝服务仍需平台配额与熔断 |
| Worker → DB/Gateway | 重复消费、旧租约、停止竞争、丢失 ACK | 原子 outbox/CAS；fencing；单次 jti；按原任务核对 | 网络外部副作用无法获得全局 exactly-once 保证 |
| Evidence → 公共存储 | 泄密、可关联地址、内容篡改、URI 丢失 | 私有原件和公开对象分离；精确字段预览；摘要与备份 | 公开副本难以删除；只在明确批准后公开 |
| Publication → Signer/链 | 密钥泄漏、错链、错合约、nonce 冲突、重组 | 隔离签名；链/合约/方法/预算允许表；发送前持久化；当前链再核查 | 单验证者仍是信任点；P0 固定验证者不能假称可在线轮换 |

MCP 官方安全指南支持授权受众、禁止 token passthrough、SSRF 与代理边界等控制；这些属于协议与工程边界，不能仅靠提示词实现。[S7] NIST SSDF 用于组织需求、保护、开发和漏洞响应工作，不是本项目已获认证的证明。[S10]

## 6. 页面、动作与异常反馈

界面主导航为“任务”“运行”“证据”“公开核验”；管理员另有“服务与策略”。用户应随时知道：我批准了什么、现在在哪一步、已消耗多少、能否停止、哪些仍未知。技术细节放在证据展开层，默认先给明确原因和下一步。

| 页面/状态 | 必需显示 | 动作与限制 | 异常反馈 |
| --- | --- | --- | --- |
| 输入/NEEDS_INPUT | 支持链、只读范围、缺少条件 | 补答；不猜地址；不执行 | 不支持转账/ERC20 时明确范围 |
| 批准/AWAITING_APPROVAL | 地址、链、资产、候选、固定区块方式、预算、版本 | 修改或批准；内容变更使 nonce 失效 | 旧版本 409 后重新展示，不自动批准 |
| 批准 ACK_UNKNOWN（仅客户端） | 原 taskId、确认状态未知 | 查询原任务；保留原幂等键 | 不创建另一个任务掩盖不确定性 |
| 运行/QUEUED、RUNNING | 当前阶段、候选与实际消费、来源时间 | 独立停止；查看分项证据 | 模型慢、事件断开不应锁住停止入口 |
| STOP_REQUESTED | 控制已确认、在途请求可能仍被处理 | 查状态；不再新增逻辑调用 | 无 ACK 只能显示停止未确认 |
| SUCCEEDED | 已验收事实、Snapshot、assurance 和局限 | 查看证据；新任务；公开预览 | 不能用“安全可信”覆盖 optional 未验证 |
| FAILED / QUARANTINED | 确定失败或必需未知的具体区别 | 修复配置后新任务；不续用旧批准 | 隔离不自动指控服务恶意 |
| CANCELLED | 已停止本系统后续执行，既有调用记录 | 查看停止证据；新任务 | 不承诺远端撤回或链上删除 |
| 公开预览 | 真正公开字段、reportHash、目标链与费用上限 | 单独确认；关闭预览不产生签名 | 内容变化后重新预览与确认 |
| 登记状态 | QUEUED/SIGNED/BROADCAST/CONFIRMING/UNKNOWN/CONFIRMED | UNKNOWN 查询原 hash；已有广播不提供“撤销交易”假按钮 | 网络、Gas、签名与合约错误分项说明 |
| 公开核验 | 内容、签名、当前链、有效期、撤销、范围各自结果 | 读取原件、导出证据 | 当前 ORPHANED 不被历史确认徽章遮盖 |

合同使用 `CheckStatus.INCONCLUSIVE` 表示证据未知；图里的 UNKNOWN 在核验语境是其人类可读描述，在 Publication 中才是确切状态枚举。ACK_UNKNOWN、offline、loading 均为客户端视图，不增加 TaskStatus。

键盘焦点、按钮名称、颜色之外的文字提示、读取错误与断线提示属于验收要求。当前离线原型完成本地逻辑检查，但尚未做真实浏览器的移动端布局与原生键盘验收；完整图谱不等于所有异常均已做成交互页面。

## 7. 部署、数据模型与工程分工

P0 建议模块化单体 API 加独立 Worker，复用同一个持久数据库和 outbox。将不可信外部访问、模型连接和签名权限分开；不必为每个逻辑模块部署微服务。前端只接 Control；服务令牌、内部 JWS 密钥和链上私钥不进入浏览器或模型上下文。运行栈可沿用已有可运行框架，遵守同一合同；本包未安装或锁定实际生产依赖。

| 环境 | 数据与秘密 | 出口与权限 | 必须证据 |
| --- | --- | --- | --- |
| 本地设计 | 全部 SAMPLE、无秘密 | 无网络的交互 HTML | 文件与逻辑检查记录 |
| 集成 | 专用测试数据、受控真 RPC/模型凭据 | 显式允许源；可控异常服务 | LIVE trace 与可复现故障记录 |
| 演示发布 | 冻结构建、用户输入最小化 | 独立认证与限额；禁止开发私网例外 | 干净环境启动、链接、日志与视频 |
| 主网登记 | 专用低额度 signer，秘密独立管理 | BOT 677、固定合约与方法、费用上限 | 真合约代码、交易、事件、当前链核查 |

| 持久对象 | 关键绑定 | 约束 |
| --- | --- | --- |
| Task / TaskSpec | owner、revision、specHash | 一个批准对应确定范围；审批幂等 |
| Run | taskId、Snapshot、policyHash、epochs、leaseGeneration | 只有当前代际执行；终态不可反写 |
| Attempt / Dispatch | Run、subject、manifest、jti、预算 | 消费与 dispatch 同事务；外部结果未知也记已消费 |
| InvocationObservation | 请求 hash、请求区块、bindingKind、可选服务声明、响应 hash | 原生 RPC 不伪造服务声明；LIVE 通过须可追溯原件 |
| EvidenceArtifact | 私有原始字节、内容 hash、归属任务 | 对象级鉴权、大小与保留策略；不自动执行内容 |
| PublicReport | spec、policy、subject、snapshot、attempt、事实与局限 | 不可变；不含自身 hash 或动态回执 |
| Publication | 批准 reportHash、签名 bytes/txHash、nonce、历史进度 | outbox 持久；批准、发送与取消有独占竞争规则 |
| AnchorObservation | txHash、回执块、当前主链块、checkedAt | 当前核查与历史 CONFIRMED 分离 |
| Event / Outbox | 聚合对象、唯一命令 ID、单调序号 | 至少一次投递时消费者幂等；客户端按序补读 |

责任角色可由一人兼任，但每个交付必须有唯一负责人和复核者。Control/Worker 负责 I01/I05–I07；Data/Verifier 负责固定 Snapshot 与证据完整性；Security/Gateway 负责出口、准入与密钥边界；Chain 负责签名和主链核查；Frontend 负责状态真实性与可恢复交互；QA/PM 负责真实验收、演示与材料。图谱和场景文件是共同合同，字段变更先更新 schema，再更新实现与回归。

工程规则：TypeScript strict；外部结果从 unknown 校验；金额/链/区块使用精确字符串；SQL 参数化；统一 traceId；UTC 记录与单调超时分开；秘密脱敏；版本固定并保留组件来源。事件与日志不能包含访问令牌、完整模型提示或私钥。私有原件保留时长与删除权限需要试点约定；公开报告说明不可保证删除第三方副本。

## 8. 验收、交付与比赛表达

门槛是通过/阻断，不以未实测的百分比代替。停止确认时延、任务 p50/p95、额外 RPC/模型开销先采样；在有数据前不承诺“毫秒级”“99.9%”或“100%防注入”。负向用例通过不代表开放世界无风险。

| 门槛 | 必须可重现的行为 | 阻断时怎么交付 |
| --- | --- | --- |
| G0 来源就绪 | 模型、两参考源、两候选、公告缓存与环境配置已核查 | 对应能力标未接入；不把 SAMPLE 计入真数据成绩 |
| G1 核心闭环 | 同一 scope/snapshot 的真实正常调用与一次受控失败切换 | 缩到能跑通的只读模板，保留真实失败 |
| G2 授权与恢复 | 重复批准、旧 ticket、停止两种竞争、旧租约、消费前后崩溃 | 阻断宣称“可安全自动执行”，列出未覆盖项 |
| G3 证据 | 私有原件可核对、公开 hash 正确、篡改失败、无秘密泄漏 | 不开放公共发布功能 |
| G4 链上 | 正确网络/合约/签名/回执/事件/当前区块，明确确认策略 | 显示发布不可用；不计有效主网部署 |
| G5 交付 | 非作者从干净环境启动、链接可访问、材料与新增工作清晰 | 保留明确范围的演示录像与问题记录 |

建议用同一组正常与受控异常任务比较三种基线：直接调用、一次静态检查、持续任务验收。首轮可各准备至少 10 个正常和 10 个受控异常案例，记录配置和选择理由；这是冒烟与对照设计，样本量不足以宣称普遍检出率。报告正常完成数/总数、错误接纳数/异常数、误拒绝数/正常数、人工介入次数、耗时分布和包括参考/模型/链的总成本。不能通过拒绝所有任务获得虚假的高安全成绩。

| 通用评分维度 | 权重 | 本方案要拿出的事实 | 演示重点 |
| --- | --- | --- | --- |
| 技术完成度 | 20% | 可运行真实闭环、失败与恢复记录 | 正常→失败拒绝→获准备用；运行中停止 |
| 创新性 | 20% | 与直接调用/静态检查的增量对照 | 按任务验收、准入与履约证据的闭环 |
| 场景价值 | 20% | 具体目标用户、当前人工流程、试点收益 | 为什么用户愿意增加这层控制 |
| 赛道结合度 | 20% | Ethereum 真实数据与身份/验证职责；BOT 真登记证据 | 区块链具体承担什么、哪些仍链下 |
| 表达质量 | 20% | 清楚区分已实现/计划、来源/声明、确定/未知 | 用原始证据回答失败原因和边界 |

评分依据来自用户提供的赛手册；分赛题要求作为这些维度的判断依据，不另加权。GCC 主线需要落实 Ethereum 跨主体信任职责，当前身份适配仍是停点；BOT 的主办方 20–25 项目部署目标不转化为本队得分或最低部署数量。BOT 有效部署需真实 Mainnet 浏览器链接、交易记录和适用地址，不能用测试网或领取 Gas 替代。

4 分钟终评建议：0:00–0:30 用户问题与范围；0:30–1:50 真实失败发现及受控切换；1:50–2:25 停止/未知处理；2:25–3:15 证据核对与实际链上状态；3:15–4:00 对照结果、公共物品、已实现边界。六分钟轮评增加原件核查与问答。录像标注 LIVE/REPLAY/SAMPLE，不能把它们混成实时演示。

按手册，2026-10-08 12:00 北京时间截止，建议 11:30 前完成上传。优先固定范围→真实闭环→停止与证据→链上核验→干净环境与材料。09:00 后冻结功能，10:30 前完成交付检查；这些是倒排门槛，不是已完成进度或保证能从零赶工完成。

## 9. 创新与市场验证

Snyk 官方 Agent Scan 已涉及 Agent/MCP/技能安全检查；Socket 官方 MCP 提供依赖风险查询。这足以否定“没有相关产品”的推断，不能反过来仅凭其文档未提及某功能，就断定其没有该能力。[S8–S9]

| 待验证假设 | 本方案可能形成的差异 | 需要收集的证据 | 否证后调整 |
| --- | --- | --- | --- |
| 工具接入有重复人工核查成本 | 可复用的任务验收合同与入口策略 | 真实接入步骤、工时、现有替代工具 | 简化为现有网关/扫描器插件 |
| 静态扫描无法回答当前服务是否履约 | 固定范围的实时观测、交付验收和受控切换 | 同任务的静态/连续对照结果 | 删去无增益检查，减少延迟与成本 |
| 团队需要跨主体核验记录 | 主体绑定、不可变报告、独立核查与可选链上承诺 | 外部团队实际核验/复用、争议处理案例 | 不强迫每次调用上链；保留导出签名报告 |
| 用户愿为持续管理付费 | 托管连接器、私有策略、监控和集成 | 有预算责任人的试点、重复使用和明确采购信号 | 缩小目标客户，暂停规模扩张 |
| 开放案例可形成长期优势 | 可复跑案例、验收模板与贡献标准 | 第三方复用、修正率、贡献和兼容记录 | 优先维护少数可靠模板，避免堆砌数据量 |

首批访谈建议覆盖 3–5 个团队中的 Agent 开发者、平台/安全负责人和实际采购者；分别记录事实、推测和承诺，不把口头兴趣当市场验证。潜在壁垒来自可信模板、集成深度与复核网络；区块链存在本身不会带来先发优势。公共物品部分可开放规则、案例格式、验收器和去敏报告；私有原件、企业策略与秘密保持受控。发布代码前明确自有与第三方许可，未审查组件不承诺任意再分发。

## 10. 变更与证据要求

新增协议、链、资产、可写工具或高风险自动动作时，必须建立新的 TaskSpec、威胁模型、权限、失败分类和验收用例，不在现有原生余额接口中塞入隐式分支。每次事故新增 SC 编号，关联检测规则、修复提交、回归证据与负责人。回滚服务版本不能删除已经公开的链上历史；密钥受损时先冻结新签名，再公开可核对的后续状态。

`review/Scenario_Coverage.md` 是逐场景交接单，`contracts/scenario_catalog.json` 是机器可读版本。通过情况必须补充 testRunId、构建版本、运行模式、输入摘要、断言及原始 trace；当前这些执行证据未生成，不以设计文档代填。

## 11. 原始资料

以下为本次直接核查的一手资料，访问日期 2026-10-07。技术文档支持协议事实与工程约束；本方案架构、预算、分工和市场假设是设计判断。比赛日程与评分以用户提供的手册为依据，未将其当作已经独立核实的官方公告。

- [S1 Ethereum JSON-RPC](https://ethereum.org/developers/docs/apis/json-rpc/)：eth_getBalance 的数量返回及区块参数。
- [S2 EIP-1898](https://eips.ethereum.org/EIPS/eip-1898)：按 blockHash 与 requireCanonical 查询。
- [S3 OSV querybatch](https://google.github.io/osv.dev/post-v1-querybatch/)：每个查询的分页与返回格式。
- [S4 CISA KEV 官方数据仓库](https://github.com/cisagov/kev-data)：政府已知被利用漏洞目录的官方镜像。
- [S5 ERC-8004](https://ercs.ethereum.org/ERCS/erc-8004)：身份/信誉/验证注册及其信任边界。
- [S6 BOT Chain Quick Guide](https://dev-docs.botchain.ai/docs/Developers/quick-guide/)：主网 677 与测试网 968 的区分。
- [S7 MCP Security Best Practices](https://modelcontextprotocol.io/docs/2026-07-28/tutorials/security/security_best_practices)：授权、令牌与网络安全边界。
- [S8 Snyk Agent Scan 官方仓库](https://github.com/snyk/agent-scan)：相邻产品已覆盖的安全检查范围。
- [S9 Socket MCP 官方文档](https://docs.socket.dev/docs/guide-to-socket-mcp)：依赖风险查询能力。
- [S10 NIST SP 800-218 SSDF v1.1](https://csrc.nist.gov/pubs/sp/800/218/final)：安全开发实践的组织依据。

原始 PRD 另列 RFC 8785、RFC 8725、签名实现文档及 AgentDojo/InjecAgent 同行评审论文。本图谱不引用未经同行评审的市场规模或准确率作为已证实事实。
'''
body+=append
(R/'Architecture_Workflow_Atlas.md').write_text(body)
coverage='# 异常场景、恢复与验收追踪\n\n版本 0.2。共 57 项已识别场景，全部为 DESIGN_REQUIRED。不是已执行测试或风险穷尽证明。SC- 为场景编号；D01–D12 为图编号。\n\n'
category=None
for c in C:
    if c['category']!=category:category=c['category'];coverage+='## '+category+'\n\n'
    coverage+=f"### {c['caseId']} · {c['trigger']}\n\n"
    for title,key in [('检测','detector'),('决定','decision'),('期望状态','expectedState'),('用户提示','userMessage'),('恢复','recovery'),('保留证据','evidence'),('责任人','owner'),('验收方法','verification')]:coverage+=f"- **{title}：** {c[key]}\n"
    coverage+=f"- **追踪：** {', '.join(c['diagrams'])}；{c['testId']}；{c['implementationStatus']}\n\n"
(R/'review/Scenario_Coverage.md').write_text(coverage)
# A self-contained, offline diagram reader; not a live application.
e=html.escape
cards=[]
for i,g in enumerate(G):
    svg=(R/'diagrams'/f"{g['id']}.svg").read_text();svg=svg[svg.index('<svg'):]
    svg=re.sub(r'id="([^"]+)"',lambda m: 'id="'+g['id']+'_'+m.group(1)+'"',svg)
    svg=svg.replace('<svg ',f'<svg role="img" aria-label="{e(g["title"])}" ',1)
    legends=''.join(f'<tr><td>{e(n["label"])}</td><td>{e(n["meaning"])}</td></tr>' for n in g['nodes'])
    rules=''.join('<li>'+e(r)+'</li>' for r in g['rules'])
    linked=[c for c in C if g['id'] in c['diagrams']]
    refs=''.join(f'<button class="case-jump" data-case="{c["caseId"]}">{c["caseId"]}</button>' for c in linked)
    cards.append(f'<section id="{g["id"]}" class="diagram-panel" {"hidden" if i else ""}><div class="eyebrow">{g["id"]} / DESIGN VIEW</div><h2>{e(g["title"])}</h2><p>{e(g["scope"])}</p><div class="diagram-frame">{svg}</div><div class="rules"><h3>不可省略的规则</h3><ul>{rules}</ul></div><details><summary>节点含义 · {len(g["nodes"])} 个</summary><table><thead><tr><th>图内名称</th><th>中文含义</th></tr></thead><tbody>{legends}</tbody></table></details><div class="related"><h3>关联异常场景</h3>{refs}</div></section>')
casecards=[]
for c in C:
    content=''.join(f'<dt>{title}</dt><dd>{e(c[key])}</dd>' for title,key in [('检测','detector'),('决定','decision'),('期望状态','expectedState'),('用户提示','userMessage'),('恢复','recovery'),('证据','evidence'),('责任人','owner'),('验收','verification')])
    search=e(' '.join(str(v) for v in c.values()).lower(),quote=True)
    casecards.append(f'<details class="case" id="{c["caseId"]}" data-category="{e(c["category"])}" data-search="{search}"><summary><span class="code">{c["caseId"]}</span> {e(c["trigger"])}</summary><div class="case-body"><span class="badge">DESIGN_REQUIRED · 尚待实现与实测</span><dl>{content}</dl><p class="muted">{e(c["testId"])} · 图 {e(", ".join(c["diagrams"]))}</p></div></details>')
nav=''.join(f'<button class="nav-item {"active" if i==0 else ""}" data-view="{g["id"]}" aria-pressed="{str(i==0).lower()}"><b>{g["id"]}</b><span>{e(g["title"])}</span></button>' for i,g in enumerate(G))
options=''.join(f'<option>{e(cat)}</option>' for cat in dict.fromkeys(c['category'] for c in C))
source_links=re.findall(r'- \[(S\d+ [^\]]+)\]\((https://[^)]+)\)',append)
links=''.join(f'<li><a href="{e(url)}" target="_blank" rel="noopener noreferrer">{e(label)}</a></li>' for label,url in source_links)
page='''<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Agent 准入检查器 · 架构与异常图谱</title><style>
:root{--ink:#17304b;--muted:#576a80;--line:#d6e0eb;--blue:#1c53a1;--paper:#f4f7fb}*{box-sizing:border-box}body{margin:0;font:16px/1.65 system-ui,-apple-system,"Noto Sans CJK SC","Microsoft YaHei",sans-serif;color:var(--ink);background:var(--paper)}button,input,select{font:inherit}button{cursor:pointer}button:focus-visible,a:focus-visible,input:focus-visible,summary:focus-visible,select:focus-visible{outline:3px solid #c27819;outline-offset:3px}[hidden]{display:none!important}header{padding:36px max(24px,calc((100vw - 1440px)/2));background:#142e49;color:white}header h1{font-size:clamp(25px,3vw,40px);line-height:1.3;margin:10px 0 14px}header p{max-width:900px;margin:8px 0;color:#e0ebf7}.eyebrow{font-size:12px;font-weight:700;letter-spacing:.12em;color:#56769b}header .eyebrow{color:#a9c4e7}.badge{display:inline-block;font-size:12px;border:1px solid #bd9651;background:#fff4df;color:#754e12;border-radius:5px;padding:4px 8px}.metrics{display:flex;gap:12px;flex-wrap:wrap;margin-top:22px}.metrics span{border:1px solid #52708f;border-radius:7px;padding:8px 13px;font-size:14px}.shell{max-width:1488px;margin:auto;padding:24px;display:grid;grid-template-columns:252px minmax(0,1fr);gap:24px}aside{align-self:start;position:sticky;top:18px}nav{display:grid;gap:6px}.nav-item{border:1px solid transparent;background:transparent;text-align:left;padding:9px;border-radius:7px;display:flex;gap:9px;color:var(--muted);font-size:14px}.nav-item b{color:#6b829e}.nav-item.active{background:#e7effb;border-color:#b6cceb;color:var(--blue)}.sidebar-note{font-size:13px;color:var(--muted);margin-top:18px}.toolbar{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:14px;font-size:13px;color:var(--muted)}.toolbar label{display:flex;align-items:center;gap:8px}.diagram-panel,#cases,#engineering{background:white;border:1px solid var(--line);border-radius:12px;padding:24px;margin-bottom:24px;min-width:0}h2{font-size:25px;line-height:1.4;margin:7px 0 10px}h3{font-size:17px;margin:20px 0 9px}p{overflow-wrap:anywhere}.diagram-frame{background:#f8fafc;border:1px solid #e4ebf3;border-radius:8px;overflow:auto;margin:22px 0;max-height:1050px}.diagram-frame svg{display:block;width:100%;height:auto;min-width:610px}.rules{padding:2px 18px 10px;border-left:3px solid #4b77b0;background:#f4f7fc}.rules ul{padding-left:21px}.rules li+li{margin-top:6px}summary{cursor:pointer;font-weight:600;padding:12px 0}table{width:100%;border-collapse:collapse;font-size:14px}th,td{text-align:left;padding:9px 11px;border-bottom:1px solid var(--line);vertical-align:top}th{background:#f4f7fb}td:first-child{width:32%;overflow-wrap:anywhere}.case-jump{border:1px solid var(--line);border-radius:5px;background:#f7f9fc;padding:4px 8px;margin:0 7px 7px 0;color:var(--blue);font-size:12px}.section-link{display:block;color:var(--blue);padding:8px;text-decoration:none}.filters{display:flex;gap:12px;flex-wrap:wrap;margin:16px 0}.filters label{flex:1;min-width:170px;font-size:13px;color:var(--muted)}.filters input,.filters select{display:block;width:100%;border:1px solid #acbfd5;border-radius:6px;background:white;padding:10px;color:var(--ink);margin-top:4px}.case{border-top:1px solid var(--line)}.case summary{font-size:15px}.code{font-family:ui-monospace,monospace;font-size:12px;background:#edf3fc;color:var(--blue);padding:3px 5px;border-radius:4px;margin-right:6px}.case-body{padding:6px 0 17px}dl{display:grid;grid-template-columns:80px minmax(0,1fr);gap:6px 12px;font-size:14px}dt{font-weight:600}dd{margin:0;overflow-wrap:anywhere}.muted{color:var(--muted);font-size:13px}.notice{border-left:3px solid #bf9651;padding:10px 14px;background:#fff8e9}.pill-row{display:flex;gap:9px;flex-wrap:wrap}.pill-row span{font-size:12px;padding:3px 8px;border:1px solid var(--line);border-radius:20px}.footer{font-size:13px;color:var(--muted);padding:0 24px 30px;max-width:1488px;margin:auto}.sources{columns:2;padding-left:22px;font-size:13px}.sources a{color:var(--blue)}@media(max-width:850px){.shell{grid-template-columns:1fr;padding:14px;gap:15px}aside{position:static}nav{grid-template-columns:repeat(2,minmax(0,1fr))}.diagram-panel,#cases,#engineering{padding:17px}.sources{columns:1}header{padding:25px 20px}.nav-item{font-size:12px}.sidebar-note{margin-top:8px}}@media print{aside,.toolbar,.filters{display:none}.shell{display:block}.diagram-panel[hidden]{display:block!important}.diagram-frame{max-height:none;overflow:visible}.diagram-frame svg{min-width:0}header{background:white;color:#17304b}header p{color:#17304b}.case{break-inside:avoid}}
</style></head><body><header><div class="eyebrow">AGENT ADMISSION / DESIGN BASELINE 0.2</div><h1>从准入到验收，<br>让每个异常都有处理路径。</h1><p>架构、交互、停止、恢复、证据与链上登记的完整设计视图。模型提出建议，后端执行规则，公开记录保留来源和边界。</p><div class="metrics"><span><b>12</b> 个架构与工作流视图</span><span><b>57</b> 种已识别异常</span><span>ETH 只读 P0 · BOT 独立登记</span></div></header><div class="shell"><aside><nav aria-label="图谱导航">NAV</nav><a class="section-link" href="#cases">异常目录与验收 →</a><a class="section-link" href="#engineering">数据、交付与来源 →</a><p class="sidebar-note">灰色：外部或低信任输入<br>黄色：未知 / 待处理<br>红色：拒绝　绿色：通过<br>紫色：签名隔离</p><p class="sidebar-note">设计边界不等于实现证据。所有异常场景尚待后端实测。</p></aside><main><div class="toolbar"><span>内嵌 SVG · 中文节点解释可展开 · 无需联网</span><label for="zoom">图宽 <input id="zoom" type="range" min="80" max="180" step="10" value="100"><output id="zoom-value" for="zoom">100%</output></label></div>CARDS<section id="cases"><div class="eyebrow">SCENARIO REGISTER</div><h2>异常不是旁注，是验收合同。</h2><p>每项对应检测、动作、状态、提示、恢复、证据、责任人和测试编号。下面是设计要求，没有将其标为已通过测试。</p><div class="filters"><label for="query">搜索场景、状态或责任人<input id="query" type="search" placeholder="例如：停止、DNS、UNKNOWN、nonce"></label><label for="category">场景类别<select id="category"><option value="">全部类别</option>OPTIONS</select></label></div><p id="case-count" class="muted" role="status" aria-live="polite">显示 57 / 57 项</p>CASECARDS</section><section id="engineering"><div class="eyebrow">REVIEW & DELIVERY</div><h2>可复核的来源，可落实的停点。</h2><div class="notice"><strong>当前是设计交付。</strong> 已制作图谱、合同和离线原型；真实后端、模型、RPC、OSV、数据库恢复、签名和主网联调仍待完成。57 项场景均为 DESIGN_REQUIRED。图谱的交互只有导航、缩放与检索，不执行 Agent 任务。</div><h3>需要保留的三个边界</h3><ol><li>原生 RPC 只返回余额数量；请求绑定与服务自行声明分别记录，不能伪造区块证明。</li><li>旧租约不得消费票据或提交结果；数据库未持久化停止时不能显示已停止。</li><li>历史确认与当前主链核验分开；链上 hash 既不保证内容真实，也不能恢复丢失原文。</li></ol><h3>交付门槛</h3><table><thead><tr><th>门槛</th><th>必须拿出的证据</th></tr></thead><tbody><tr><td>G0–G1 来源与闭环</td><td>真数据、模型与受控异常 trace；固定范围和区块</td></tr><tr><td>G2–G3 权限与证据</td><td>停止、旧租约、崩溃恢复、原件摘要和篡改拒绝</td></tr><tr><td>G4 链上</td><td>真网络、合约、交易、匹配事件与当前区块核验</td></tr><tr><td>G5 提交</td><td>干净环境启动、可访问链接、视频、新增工作和提交回执</td></tr></tbody></table><h3>市场判断</h3><p>已有 Snyk Agent Scan、Socket MCP 等相邻产品。候选差异在任务验收、受限执行与可复核履约记录，先发优势尚待试点证明。两参考源已经能回答原生余额，不能用这个技术示例独自证明商业需求。</p><h3>一手资料</h3><ul class="sources">SOURCES</ul><p class="muted">访问日期 2026-10-07；比赛安排依照用户提供的手册。2026-10-08 12:00 北京时间截止，建议 11:30 前提交。评分五项各 20%，BOT 主办方整体部署目标不是本队评分指标。</p></section></main></div><div class="footer">完整工程交接见同包 PRD、Scenario_Coverage.md、JSON/OpenAPI 合同与检查记录。未知新事件进入 SC-O08 / SC-E05；不以有限清单声称所有风险都已覆盖。</div><script>
(()=>{const buttons=[...document.querySelectorAll('[data-view]')],panels=[...document.querySelectorAll('.diagram-panel')];function show(id){buttons.forEach(b=>{let on=b.dataset.view===id;b.classList.toggle('active',on);b.setAttribute('aria-pressed',String(on))});panels.forEach(p=>p.hidden=p.id!==id)}buttons.forEach(b=>b.addEventListener('click',()=>{show(b.dataset.view);document.querySelector('main').scrollIntoView({behavior:'smooth',block:'start'})}));let z=document.getElementById('zoom');z.addEventListener('input',()=>{document.getElementById('zoom-value').textContent=z.value+'%';document.querySelectorAll('.diagram-frame svg').forEach(s=>s.style.width=z.value+'%')});let q=document.getElementById('query'),cat=document.getElementById('category'),cases=[...document.querySelectorAll('.case')];function filter(){let n=0;const term=q.value.trim().toLowerCase();cases.forEach(c=>{c.hidden=!!((cat.value&&c.dataset.category!==cat.value)||(term&&!c.dataset.search.includes(term)));if(!c.hidden)n++});document.getElementById('case-count').textContent='显示 '+n+' / '+cases.length+' 项'}q.addEventListener('input',filter);cat.addEventListener('change',filter);document.querySelectorAll('[data-case]').forEach(b=>b.addEventListener('click',()=>{q.value=b.dataset.case;cat.value='';filter();const c=document.getElementById(b.dataset.case);c.open=true;c.scrollIntoView({behavior:'smooth',block:'center'})}));})();
</script></body></html>'''
for k,v in [('NAV',nav),('CARDS',''.join(cards)),('OPTIONS',options),('CASECARDS',''.join(casecards)),('SOURCES',links)]:
    # Distinct sentinels prevent CARDS from replacing suffix of CASECARDS.
    if k=='CARDS':page=page.replace('>CARDS<section','>'+v+'<section')
    else:page=page.replace(k,v)
(R/'Architecture_Workflow_Atlas.html').write_text(page)
print(json.dumps({'markdownBytes':len(body.encode()),'htmlBytes':len(page.encode()),'scenarioBytes':len(coverage.encode())}))
