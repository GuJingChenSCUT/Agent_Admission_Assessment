# 2026-10-08 实施与实测记录

本记录对应真实以太坊只读 MVP，不代表整个设计包全部验收项完成。

## 实际网络运行

2026-10-08 08:57:59（北京时间），通过浏览器输入任务、提交、批准、轮询、下载的完整路径得到 `SUCCEEDED`。测试地址为公开零地址 `0x0000000000000000000000000000000000000000`，没有使用个人钱包或发送交易。

| 项目 | 观测 |
| --- | --- |
| chainId | 1 |
| finalized 区块 | 26144163 |
| blockHash | `0xca769c67f5212bd0fad95dae7478228f6519477042763448b3616525fa16b1e1` |
| balanceWei | `14152839525935942570861` |
| 参考 RPC 请求 | 8 |
| 候选探测请求 | 2 |
| 候选业务调用 | 1 |
| OSV 请求 | 1，10 个生产依赖，本次未查询到已知公告 |
| 原件数 | 16 |
| 报告 hash | `0x44b264f5ab2aa33029eed979d9226d67fd7750111ea592bff4239fe18c195796` |

完整证据位于 [`artifacts/live/ui-bundle.json`](../artifacts/live/ui-bundle.json)，界面截图位于 [`artifacts/live/ui-live.png`](../artifacts/live/ui-live.png)。此前 HTTP 实测的首次成功快照保留为 `artifacts/live/first-success-20261008.json`。这些是有时间戳的实测留档，页面不会自动把它们当成新任务结果。

同一轮联调中，dRPC 的 finalized 查询在 12 秒内未完成，系统返回 `QUARANTINED / UPSTREAM_TIMEOUT`，业务调用为 0。之后使用新任务重新运行成功；未修改故障任务的结论。首次迭代也发现 operatorId 与既有 schema 的字符约束不一致，已修正并加入完整 LIVE 报告合同测试。

## 验证

- `pnpm test`：52 项通过，使用受控离线响应。覆盖参考高度差、区块冲突、金额不符、限流切换、OSV 公告/异常/分页、配置绑定变化、停止竞争、总时限、RPC 次数、SSRF/DNS、私有证据访问等。
- `pnpm run check`：schema 与 TypeScript 边界检查通过。
- `pnpm run compile:contract`：编译通过，状态仍为未部署、未审计。
- `scripts/ui-smoke.mjs`：空首屏、显式模式、六场景、停止、响应竞争、报告下载、桌面/手机与华文中宋检查通过。脚本的“LIVE blocked”分支使用未注入 runtime 的隔离应用，验证配置缺失，不代表实际服务器禁用 LIVE。
- `scripts/ui-live-smoke.mjs`：真实浏览器任务成功，页面脚本错误为 0；新建任务后输入与证据再次清空。
- `pnpm verify:bundle artifacts/live/ui-bundle.json`：独立进程 schema、报告摘要、全部原件摘要和引用完整性均 PASS。
- 修改副本中一条原件的 base64 后，离线复核返回 `artifacts: FAIL` 和退出码 1；原件包不受影响。界面另有报告篡改检测。

## 限制

默认 PublicNode 与 dRPC 同时作为参考和候选，来源有重叠。只有 RPC 交叉核对，没有密码学状态证明或服务签名。OSV 没有已知公告不表示依赖绝对安全。PI、五个业务 Agent 的专用接口、MCP、ERC-8004 和 BOT 主网发布未接通。当前服务限本机单实例，尚不是公网多用户生产部署。
