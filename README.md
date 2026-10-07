# Agent Admission Assessment

面向以太坊研究 Agent 的工具准入与数据验收框架。基于 2026-10-07 设计包，提供可以实际运行的本地后端与中文工作台。

## 运行

需要 Node.js 24+、pnpm 11.25.0。

```sh
pnpm install --frozen-lockfile
pnpm start
```

打开 http://127.0.0.1:8787 。默认 SAMPLE，界面中的地址、区块、余额与检查观测为构造数据；不调用模型、RPC、OSV、钱包或主网。原始离线原型在 /prototype.html 。

可选配置复制 `.env.example` 为 `.env`。服务只监听本机回环地址，使用本地浏览器会话和 CSRF；不具备生产账户系统。重启后需新建浏览器会话，历史私有任务保留在本地数据库中，暂不提供跨会话恢复 UI。

## 已实现

前端提供任务进度、候选验收结果、证据核对及可筛选的接入渠道目录。外部服务来源、当前状态和后续接入要求见 [接入说明](docs/external-integrations.md)。

- Ethereum 原生 ETH / finalized 任务范围提案、补答、版本摘要与 nonce 批准。
- SQLite WAL 短事务、幂等批准、停止 epoch、工作器代际隔离和中断隔离恢复。
- 内部 HS256 单次票据绑定调用者、任务、参数、策略、服务清单和快照；预算随消费原子扣除。
- 同区块结果逐项验收；旧区块拒绝，跨区块金额不比较；最多切换一次。
- 六个 SAMPLE 场景；真实后端 API、会话隔离、CSRF、原始响应私有保存。
- 对齐设计 schema 的公开报告，JCS / Keccak-256 内容核对、篡改检测和下载。
- EIP-712 自定义 EvidenceRegistry 合约源码与编译脚本；未部署、未审计。
- 测试、CI、Agent TypeScript 接口边界与设计文档归档。

## 当前阻断项

**这是一份可运行的框架，不是已完成真实主网集成的比赛成品。** LIVE 在创建任务时返回配置错误；不会静默换成 SAMPLE。在线模型/eve 适配、OSV 生产接入、真实候选能力探测、受限网络出口、Ethereum/ERC-8004 身份绑定、独立签名器和 BOT 主网部署均未验收。参考 RPC 模块仅作为未联调适配器提供。

公共发布 API 在签名器未配置时返回 503，不广播交易。合约需验证 BOT 677 对 Cancun EVM 的支持后才能部署；编译成功不代表目标链兼容或安全审计通过。

## 验证

```sh
pnpm test
pnpm run check
pnpm run compile:contract
```

当前测试涵盖正常/失败/切换、参考冲突、版本变化、幂等与过期批准、票据重放、停止竞争、SQLite 回滚、进程中断、跨会话访问和报告篡改。测试数不等于设计包全部 57 项验收完成。

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

