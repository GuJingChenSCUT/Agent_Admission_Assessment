# 前端精进验证记录 · 2026-10-08

## 交付变化

- 响应式研究工作台：任务范围、批准、执行进度、候选服务状态、余额结果与证据核对。
- 接入渠道目录：只读展示 JSON-RPC、MCP、HTTP Agent、ERC-8004、OSV 和公共登记的真实实现阶段，可按适配器 / 待实现筛选。
- 新增会话内 `GET /v1/integrations`，不读取外部服务，不返回 RPC 地址或凭据，不把配置存在视为健康检查通过。
- 前端请求代际隔离、重复操作抑制、幂等批准键复用、停止后的旧响应隔离，以及新任务的证据清理。
- 成功、失败与停止报告均支持内容摘要核对；篡改测试只改副本，原始报告可下载。

## 实际执行结果

| 检查 | 结果 |
| --- | --- |
| `pnpm test` | 30 项通过，0 失败 |
| `pnpm run check` | schema 与 TypeScript 检查通过 |
| `git diff --check` | 通过 |
| `node scripts/ui-smoke.mjs` | 无头 Edge 浏览器流程通过 |
| 1440px 桌面与 360px 手机 | 无横向溢出，截图已人工查看 |

浏览器测试使用独立内存数据库，不修改已有用户任务。覆盖六个 SAMPLE 场景、禁止切换的预算、补答、停止、旧刷新响应不能覆盖停止、新任务不能接收旧报告、下载内容与原件一致、失败报告篡改检测、LIVE 禁用状态。测试运行期间没有页面脚本异常，SAMPLE 页面没有向外部服务发起请求。

截图保存在 `artifacts/ui/desktop.png`、`mobile.png`、`run.png`、`connections.png` 与 `mobile-result.png`。

## 复现 UI 测试

UI 测试使用 Playwright，但不新增生产依赖。环境已有 Playwright 时可直接运行 `node scripts/ui-smoke.mjs`。若工具运行时提供独立安装，设置 `PLAYWRIGHT_MODULE` 为其 `index.mjs` 的完整 file URL；使用系统 Edge 时设置 `EDGE_PATH` 为浏览器可执行文件路径。脚本会自行启动临时服务并在结束后清理浏览器与数据库。

此次变更没有完成真实 RPC、外部 Agent、MCP、ERC-8004 或主网登记接入；目录中的规划能力不会触发真实调用。
