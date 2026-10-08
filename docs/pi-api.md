# PI 接入预留与现有 API 检查

核对日期：2026-10-08。

现有后端已经有 `/v1/tasks`、批准、停止、事件和证据接口；此前 `agent/ports.ts` 只有编排接口定义，没有 PI 的远程请求实现。本次新增以下**本系统本地入口**，不是 PI 官方 API 地址：

| 方法 | 路径               | 行为                                                                                                 |
| ---- | ------------------ | ---------------------------------------------------------------------------------------------------- |
| GET  | `/v1/model`        | 只读返回 PI 适配器是否注入、仅生成草稿的权限；不调用模型                                             |
| POST | `/v1/model/drafts` | 输入 `{text, allowFallback}`；显式调用注入的适配器，返回通过校验的 TaskDraft；不创建任务、不执行工具 |

两个接口均需要现有本地会话。POST 还需要 `x-csrf-token`；浏览器不能提交 provider URL、API Key、owner、shell 或工具权限。未注入适配器时返回 `503 PI_ADAPTER_NOT_CONFIGURED`，不会返回伪造的模型答案。

## 服务端适配合同

`agent/ports.ts` 中的 `PiDraftAdapter` 对应 `createApplication({modelAdapter})`：

```ts
interface PiDraftAdapter {
  extract(
    input: string,
    options: {
      signal: AbortSignal;
      maxOutputTokens: 2048;
    },
  ): Promise<TaskDraft>;
}
```

实现放在服务端，启动时注入。当前 `src/server.js` 没有注入真实实现，因此入口保持未配置。默认 10 秒超时、断连取消、每会话最多一个并行请求；适配器必须尊重 signal 和输出上限，处理远端响应大小及鉴权。底层错误会脱敏。草稿需符合 schema，不能新增或猜测地址，不能把以太坊 ETH 范围扩大，不能擅自启用备用切换。现阶段仍以保守的本地范围规则核对模型输出。

成功响应形如：`{provider:"PI", draft:TaskDraft, requiresApproval:true, executionStarted:false}`。此响应仅是草稿。模型接通后，还需完成独立 RPC / 工具准入集成，才能开放实际执行。前端实际任务明确提交 `executionMode:"LIVE"`，不会因服务器默认 SAMPLE 而生成演练结果。

## 仍需确认的信息

“PI”名称无法唯一识别具体平台或框架，尚未假定它是某个模型服务、Pi SDK 或某种兼容协议。请提供官方文档 / Base URL、模型或运行时标识、鉴权规范、请求与响应示例、流式格式及限额。密钥通过服务端环境或秘密管理配置，不写入页面、公开文档或仓库。

在这些资料确认前，不填写猜测的 PI 远端路径，不安装猜测的 SDK，不宣称真实模型已接通。
