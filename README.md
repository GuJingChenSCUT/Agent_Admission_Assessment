# Agent Admission Assessment

面向以太坊研究 Agent 的工具与依赖准入、受限调用、固定区块结果验收和公共证据框架。当前实现严格收窄到设计基线的 P0：Ethereum 主网原生 ETH 余额，只读、`FINALIZED_AT_RUN`、最多两次候选调用和一次切换。

## 当前实现边界

- `SAMPLE` 模式提供可重复的离线演示，明确标记构造数据，不伪装成在线 RPC 或已上链结果。
- `LIVE` 模式只有在配置两家参考 RPC 与获准服务端点后才会运行；缺少任何必需来源时进入 `QUARANTINED`。
- 模型不持有执行凭据，也不能改变任务范围、候选服务、预算、停止状态或发布状态。本仓库先提供结构化编排入口，模型适配器可按 `docs/design/contracts/skill_contracts.yaml` 接入。
- 证据报告的开发哈希使用 Node 内置 `sha256` 并标注 `hashAlgorithm: sha256-dev-only`。生产部署必须替换为经过验证的 RFC 8785 JCS + Ethereum Keccak-256 实现，未替换前不能宣称符合链上登记合同。
- `chain-contracts/EvidenceRegistry.sol` 是自定义追加式登记合约草案，未部署、未审计、未连接 BOT Chain。

## 运行

```powershell
Copy-Item .env.example .env
npm start
```

打开 `http://localhost:8787/` 查看控制台，或打开 `/prototype.html` 查看设计包中的离线交互原型。

API 的最小闭环如下：

1. `POST /v1/tasks` 创建任务草稿。
2. 缺少地址时调用 `POST /v1/tasks/:taskId/clarifications`；完整任务调用 `POST /v1/tasks/:taskId/approve`。
3. 通过 `GET /v1/tasks/:taskId` 和 `/events` 查看确定性运行状态。
4. 运行中调用 `POST /v1/tasks/:taskId/stop`；停止请求不等待模型或外部调用。
5. 终态调用 `/evidence` 和 `/public-preview`，摘要核对与公开发布仍是独立步骤。

## 验证

```powershell
npm test
npm run check
```

设计文件、原始附件和生成检查工具位于 `docs/design/`；用户原始材料和空仓库元数据的不可变备份位于 `backups/20261007-before-implementation/`。

## 证据与部署声明

本版本不包含在线模型、真实 RPC 联调、签名器、BOT 主网交易或已部署合约。提交比赛材料时，必须以实际 trace、合约地址、交易回执和区块浏览器链接替换对应的 BLOCKED 项。
