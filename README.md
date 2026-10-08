# Agent Admission Assessment

面向以太坊研究 Agent 的工具准入与数据验收框架。基于 2026-10-07 设计包，提供可以实际运行的本地后端与中文工作台。

## 运行

需要 Node.js 24+、pnpm 11.25.0。

```sh
pnpm install --frozen-lockfile
pnpm start
```

打开 http://127.0.0.1:8787 。页面从空任务开始。输入一个以太坊地址的 ETH 余额查询，提交、检查范围、点击批准后，才发起真实 RPC 与 OSV 查询。默认 LIVE 使用 PublicNode 和 dRPC，无需密钥；公开服务可能限流或超时，失败会隔离，不退回 SAMPLE。选择“流程演练”才使用构造数据，不发生外部调用。原始离线原型在 /prototype.html 。

可选配置复制 `.env.example` 为 `.env`。服务只监听本机回环地址，使用本地浏览器会话和 CSRF；不具备生产账户系统。重启后需新建浏览器会话，历史私有任务保留在本地数据库中，暂不提供跨会话恢复 UI。

## 离线演示

双击 `web/demo.html` 可体验逐阶段案例验收；`web/demo-film.html` 为 54 秒实测记录回放；`web/promo.html` 为独立的 56 秒项目宣传片。三者均为单文件 HTML，无外部请求，正式服务也提供同名路径。视频版在 `artifacts/films/`，均含中文字幕。操作片数据来自已保存的 LIVE 证据，交互页使用构造案例。来源与使用方法见 [展示说明](docs/demo-guide.md)。修改后运行 `pnpm build:demos`，视频导出运行 `pnpm export:films`。

## 已实现

前端以“江汉关·东方茶港”为文化意象，采用本地华文中宋；未安装时回退到思源宋体或宋体。页面不预填 prompt，不预生成候选结果与证据，技术接入资料保留在开发文档中。外部网站初查见 [五个测试网站](docs/agent-site-observations-20261008.md)，PI 预留入口见 [PI API](docs/pi-api.md)。

- Ethereum 原生 ETH / finalized 任务范围提案、补答、版本摘要与 nonce 批准。
- SQLite WAL 短事务、幂等批准、停止 epoch、工作器代际隔离和中断隔离恢复。
- 内部 HS256 单次票据绑定调用者、任务、参数、策略、服务清单和快照；预算随消费原子扣除。
- 同区块结果逐项验收；旧区块拒绝，跨区块金额不比较；最多切换一次。
- 六个 SAMPLE 场景；真实后端 API、会话隔离、CSRF、原始响应私有保存。
- 对齐设计 schema 的公开报告，JCS / Keccak-256 内容核对、篡改检测和下载。
- EIP-712 自定义 EvidenceRegistry 合约源码与编译脚本；未部署、未审计。
- 测试、CI、Agent TypeScript 接口边界与设计文档归档。
- PI 草稿适配预留：会话/CSRF、输出 schema、用户地址约束、超时与取消；未接通真实 PI 服务。
- LIVE 双参考对齐 finalized 高度，再用 EIP-1898 固定 hash 查询；候选链/区块探测、同 hash 余额验收。
- HTTPS 出口、DNS 公网地址检查与连接固定、禁重定向、大小/时间/次数限制，停止时取消在途请求。
- pnpm 生产依赖闭包的真实 OSV 批量查询、公告分页与完整记录；已知漏洞阻断，查询不可用则隔离。
- 任务批准绑定真实服务清单、策略与锁文件版本；私有证据包保留网络原件，支持另一进程离线复核。

## 实现范围

**真实以太坊只读服务已接通并实测通过。** 当前范围是 Ethereum 主网、原生 ETH、一个地址、执行时 finalized 区块。范围由确定性规则解析；PI 名称尚未唯一确认，未猜测其协议，也未声称使用模型。五个业务 Agent 网站、MCP、ERC-8004 身份、独立签名器与 BOT 主网发布仍需各自适配。

默认参考与候选共用 PublicNode/dRPC，只有两个运营来源，不是四个独立来源；即使自定义 operatorId，也不能证明基础设施独立。RPC 一致不是状态证明。依赖扫描只针对本项目锁文件中的生产依赖，不证明远程服务代码或本机已安装字节安全。配置、执行链路与失败语义见 [真实服务运行说明](docs/live-service.md)。

公共发布 API 在签名器未配置时返回 503，不广播交易。合约需验证 BOT 677 对 Cancun EVM 的支持后才能部署；编译成功不代表目标链兼容或安全审计通过。

## 验证

```sh
pnpm test
pnpm run check
pnpm run compile:contract
pnpm test:live
pnpm verify:bundle artifacts/live/latest-report.json
```

`pnpm test` 使用离线受控响应验证错误与竞争条件；`pnpm test:live` 才会主动访问公网，使用零地址跑完整 HTTP 流程并保存实测证据。网络失败会明确返回非零退出码。`verify:bundle` 在独立进程核对报告与原件字节，不宣称验证签名或数据真伪。浏览器验证脚本见 `scripts/ui-smoke.mjs`、`scripts/ui-live-smoke.mjs`。测试数不等于设计包全部 57 项验收完成。

## 目录

| 目录 | 内容 |
| --- | --- |
| src/ | Control API、持久化、运行器、网关、验收和证据 |
| agent/ | 编排运行时适配端口；没有任意 shell 或钱包能力 |
| web/ | 接入后端的中文工作台与原始 SAMPLE 原型 |
| chain-contracts/ | 自定义 EIP-712 登记合约 |
| scripts/、test/ | 合同检查、编译和测试 |
| docs/design/ | 原始 PRD、机器合同、图谱、场景目录及设计核查记录 |
| docs/ | 实现基线、API、验证记录和后续接入计划 |

原始材料已在本地 `backups/20261007-before-implementation/` 保存并计算 SHA-256；备份及旧 Git 元数据不作为运行输入。
设计包的旧核查报告只证明原设计文件，不能当成本次后端验收。
所有依据、边界与模块映射见 [实现基线](docs/implementation-baseline.md)，实际 API 见 [API 说明](docs/API.md)。

## 协议与来源

依据 Ethereum JSON-RPC、EIP-1898、RFC 8785、RFC 8725、OpenZeppelin EIP-712/ECDSA 等原始规范。完整参考链接保留在设计包和实现基线中。
自定义合约不宣称 ERC-8004 兼容；公开哈希不证明报告内容真实；两个 RPC 一致不构成密码学状态证明。

