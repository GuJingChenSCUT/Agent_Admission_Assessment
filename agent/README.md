# 编排适配边界

当前用户输入由 SAMPLE 有限规则解析器处理，没有在线模型调用；LIVE 模式拒绝创建任务。
`ports.ts` 是后续 eve 或其他运行时的适配合同。不得挂载 shell、任意 URL、策略修改、公开发布或钱包工具。
五个模型可见入口应根据服务端上下文派生 owner，不能由模型参数声明 owner。
PI 接入另有 `PiDraftAdapter`、`GET /v1/model` 与 `POST /v1/model/drafts`；目前是可注入、可测试的服务端预留入口，未连接任何 PI 产品。具体合同见 `docs/pi-api.md`。仅输出草稿，不授权工具执行。
在线实现需要限制 4 轮、每轮 2048 输出 tokens；输出须通过设计包 TaskDraft schema，并核对地址来自用户输入。
实现后才能解除 LIVE 阻断；只装运行时不构成在线 Agent 验收。
