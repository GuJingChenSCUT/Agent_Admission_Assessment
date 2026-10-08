# API 说明（本地 MVP）

服务只监听 `127.0.0.1`。浏览器先 `GET /v1/session`，服务返回 HttpOnly `aa_session` cookie 和一次性 CSRF token；后续非 GET 请求必须带 `x-csrf-token`。当前会话 owner 由服务端随机派生，浏览器不能在 JSON 中指定 owner。

## TaskSpec

当前只接受 `NATIVE_BALANCE`、`sourceChainId="1"`、`asset="ETH"`、`FINALIZED_AT_RUN`。输入缺地址或多个地址会停在 `NEEDS_INPUT`；ERC-20、转账、任意 URL、其他链、历史/`latest` 请求会返回 `UNSUPPORTED_SCOPE`。

## 路径

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/v1/session` | 建立本地会话，返回 CSRF 与运行模式 |
| GET | `/v1/model` | PI 适配器配置状态；只读，无模型调用 |
| POST | `/v1/model/drafts` | PI 预留草稿入口；未注入适配器返回 503；不创建任务或执行工具，见 `pi-api.md` |
| GET | `/v1/deployment` | 读取真实就绪状态，不计算综合安全分数 |
| GET | `/v1/integrations` | 会话内只读接入能力目录与候选元数据；不抓取外部服务，不返回 RPC 地址、密钥或健康检查结论 |
| POST | `/v1/tasks` | `text`、`allowFallback`、`executionMode`、SAMPLE `scenario`；创建草稿。显式 LIVE 不会退回 SAMPLE |
| GET | `/v1/tasks/:id` | owner 隔离的任务视图；不返回 ticket、owner 或原件 |
| POST | `/v1/tasks/:id/clarifications` | `{revision,text}`；旧 revision 拒绝 |
| POST | `/v1/tasks/:id/approve` | `{revision,specHash,approvalNonce}`，必须有 `Idempotency-Key` |
| POST | `/v1/tasks/:id/stop` | 不经过模型；持久化 stop epoch |
| GET | `/v1/tasks/:id/events?after=N` | 脱敏、单调 sequence 事件 |
| GET | `/v1/tasks/:id/evidence` | 终态 PublicReport envelope |
| GET | `/v1/tasks/:id/artifacts/:artifactId` | owner 受控原始响应，返回 base64 和摘要 |
| POST | `/v1/public/evidence/verify` | 分别核对 schema、内容摘要、签名与链上状态 |
| POST | `/v1/evidence/:reportId/publications` | 当前返回 `503 SIGNER_NOT_CONFIGURED`，不会广播 |

批准 body 必须精确绑定当前 `revision`、`specHash`、短期 `approvalNonce`；同一幂等键与请求摘要重复会返回原运行，不同请求摘要返回冲突。内部 ticket 不经过浏览器、模型或公开报告。

## 状态

`NEEDS_INPUT → AWAITING_APPROVAL → QUEUED → RUNNING → SUCCEEDED | FAILED | QUARANTINED`。`QUEUED/RUNNING → STOP_REQUESTED → CANCELLED`。停止与成功竞争时，以先完成的 SQLite 状态提交为准；已广播链上记录不会被本地 stop 撤销。
