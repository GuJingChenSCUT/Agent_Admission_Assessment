# Agent 准入检查器设计包 · 0.2

本包交付产品与工程设计、机器合同和离线交互原型。没有后端实现、在线模型调用、真实 RPC 数据或已部署合约。所有 examples 与原型均为 SAMPLE。

1. 先打开 `Architecture_Workflow_Atlas.html` 浏览 12 张图，检索 57 项异常；再读 `Architecture_Workflow_Atlas.md` 和 `PRD_Architecture_Interaction.md`，确定 P0 范围、模块责任与批准/停止规则。
2. 用浏览器直接打开 `Interaction_Prototype.html`。无需安装或联网。可模拟补答、批准、首选失败切换、参考冲突、停止及证据篡改。
3. 后端依照 `contracts/openapi.yaml` 与 `contracts/domain.schema.json` 实现接口；Agent 仅挂载 `contracts/skill_contracts.yaml` 中的五个模型可见工具。
4. 采用 `contracts/policy.json` 作为初始限制样例，部署者补齐真实来源与主网配置。不要把空 registry 或确认配置当作可发布。
5. 依照 `contracts/state_machines.json` 实现状态转换及数据库原子约束，实施 `contracts/acceptance_cases.json` 与 `contracts/scenario_catalog.json` 的后端验收。25 项与 57 项存在重叠，不能相加为独立测试数。
6. `contracts/registry_interface.sol` 只定义合约接口与检查要求。它不是可部署实现或安全审计结论。

## 文件

| 文件 | 用途 |
| --- | --- |
| `PRD_Architecture_Interaction.md` | PRD、逻辑/部署架构、参考核验算法、权限、交互、工程顺序及权威依据 |
| `Architecture_Workflow_Atlas.html` | 离线图谱阅读器，内嵌 12 张 SVG，提供导航、图宽调整和 57 场景检索 |
| `Architecture_Workflow_Atlas.md` | 中文 Mermaid、节点说明、数据/威胁/部署/评分/市场验证矩阵 |
| `diagrams/` | 12 组可编辑 Mermaid、Graphviz DOT 与可显示 SVG/PNG；源数据 diagram_specs.json |
| `review/Scenario_Coverage.md` | 57 项异常的检测、处置、状态、提示、恢复、证据、责任人与验收 |
| `contracts/scenario_catalog.json` | 同一异常目录的机器可读版本；均为 DESIGN_REQUIRED |
| `tools/` | 生成及检查设计材料的源程序；不包含可上线服务 |
| `Interaction_Prototype.html` | 全部内容内嵌的离线原型；没有网络请求 |
| `agent/instructions.md` | 应用 Agent 行为规范；不应作为当前编码助手的技能安装 |
| `contracts/domain.schema.json` | JSON Schema 2020-12；按 `$defs` 名称取单个对象合同 |
| `contracts/openapi.yaml` | OpenAPI 3.1、12 条 API 路径、身份及错误合同 |
| `contracts/skill_contracts.yaml` | 模型可见工具与内部操作边界 |
| `contracts/policy.json` | 初始范围、限额、required/optional 规则及阻断项 |
| `contracts/state_machines.json` | Task、Attempt、Publication 的允许转换 |
| `contracts/acceptance_cases.json` | 25 项产品/安全/恢复验收计划，不能视作已执行后端测试 |
| `contracts/registry_interface.sol` | 自定义证据登记接口，Ethereum 数据链与 BOT 登记链分别绑定 |
| `examples/` | 构造任务、批准、内部凭据及公开报告；没有授权效力 |
| `checks/Design_Verification.md` | 本次实际文件与原型核查结果及未验证范围 |

## 开发提醒

TaskSpec 的大整数均为字符串。报告内容不包含其自身摘要、签名或交易 hash。内部准入凭据不能传给模型或浏览器；公开报告允许不同人核查内容，不授予任何调用权限。

生产哈希与签名应采用经验证的实现，使用 RFC 8785 JCS 与 Ethereum Keccak-256，不使用 SHA3-256 替代。原型附带的本地算法及向量检查用于设计演示，没有经过密码学库审计。

编排运行时设计默认采用 eve，安全模块不依赖模型提示词实现权限。尚未创建实际 eve 项目或安装依赖；保留已有可运行栈时按同一工具合同适配即可。

比赛交付仍需真实代码仓库、可运行链接/视频、环境说明、活动期间新增工作；BOT 部署需真实主网合约和交易/浏览器材料。原型的本地登记队列不能计入有效部署。

图谱中的 UNKNOWN 在证据核验语境对应 INCONCLUSIVE；客户端 ACK_UNKNOWN 不是 TaskStatus。新增 InvocationObservation 区分请求绑定与服务声明；内部凭据增加 policyEpoch/leaseGeneration；AnchorObservation 与历史 Publication 确认分开。上述合同仍属未部署设计。
