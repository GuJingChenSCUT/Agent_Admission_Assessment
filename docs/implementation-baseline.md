# Implementation baseline

这份代码把设计包中的 P0 收窄范围落实成可运行的单机服务：Ethereum mainnet（chainId `1`）原生 ETH `eth_getBalance`，执行时 `finalized` 快照，两个配置候选，最多两次调用和一次切换。`SAMPLE` 是可复现构造演示；当前 HTTP 入口在 `LIVE` 下直接返回 `503 LIVE_MODEL_ADAPTER_NOT_CONFIGURED`，不会用 SAMPLE 代替 LIVE。

## 模块与设计合同

| 模块 | 实现 | 主要不变量 |
| --- | --- | --- |
| HTTP Control | `src/http-api.js` | 本地会话、CSRF、owner 隔离、严格 JSON 字段、事件序号 |
| Domain | `src/domain.js`、`src/control.js` | 明确 TaskSpec、revision、approval nonce、状态转换、停止 epoch |
| Durable store | `src/store.js` | SQLite WAL、短事务、回滚、原始响应 artifact 与任务归属绑定 |
| Worker | `src/runtime.js` | lease generation fencing；外部调用在事务外；晚到结果不能提交 |
| Gateway | `src/gateway.js` | HS256 内部短期票据绑定任务、运行、策略、快照、参数、代际和 jti；单次消费 |
| Reference/Verifier | `src/reference.js`、`src/verifier.js` | chainId、同一 blockHash、schema、范围和整数精度逐项核验 |
| Evidence | `src/evidence.js` | PublicReport 与原始 artifact 分离；RFC 8785 JCS + Ethereum Keccak-256 |
| Registry | `chain-contracts/EvidenceRegistry.sol` | 自定义追加登记、EIP-712、固定验证者、nonce、过期和撤销 |

## 真实接入前的阻断项

当前代码没有把以下状态伪装成已完成：在线模型适配器、OSV 增量查询和缓存策略、真实远程 manifest/provenance、Ethereum 身份/信誉适配、签名器密钥托管、BOT Chain 677 部署与交易确认。`GET /v1/deployment` 会列出这些状态；证据报告会把限制放入 `limitations`。

合约 artifact 只表示 Solidity 编译成功，状态仍是 `UNDEPLOYED_UNAUDITED`。部署前必须审计 EIP-712 domain、validator 权限、nonce、时间窗口、BOT 主网地址、Gas 预算和事件索引，再提供真实交易回执与区块浏览器链接。

## 规范与权威资料

实现约束对应以下公开规范，业务取舍以仓库 `docs/design/PRD_Architecture_Interaction.md` 为准：

- [Ethereum JSON-RPC](https://ethereum.org/developers/docs/apis/json-rpc/) 与 [EIP-1898](https://eips.ethereum.org/EIPS/eip-1898)：固定区块 hash、`requireCanonical` 和数量格式。
- [OSV API](https://google.github.io/osv.dev/post-v1-querybatch/)：依赖公告查询、分页与来源边界。
- [RFC 8785 JCS](https://www.rfc-editor.org/rfc/rfc8785)：报告摘要的规范化 JSON。
- [OpenZeppelin EIP-712/ECDSA](https://docs.openzeppelin.com/contracts/5.x/api/utils/cryptography)：登记合约签名验证实现。
- [ERC-8004](https://ercs.ethereum.org/ERCS/erc-8004)：身份、验证、反馈与女巫风险边界；本项目不宣称自定义登记合约符合该 ERC。
- [MCP Security Best Practices](https://modelcontextprotocol.io/docs/tutorials/security/security_best_practices)：token passthrough、SSRF、重定向和不可信工具声明。

## 验收入口

```powershell
node --test
node scripts/check-schema.js
node scripts/compile-contract.js
```

测试覆盖正常通过、旧区块切换、全部失败、参考冲突、清单变化、来源缺失、幂等批准、票据重放、跨 owner、CSRF、停止竞争、进程恢复和报告篡改。
