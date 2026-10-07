import { config } from "./config.js";

// Inventory only: never fetch endpoints, expose credentials, or imply a health check.
export function integrationInventory(mode) {
  return {
    executionMode: mode,
    liveReady: false,
    channels: [
      {
        id: "rpc",
        icon: "RPC",
        title: "以太坊数据服务",
        transport: "Ethereum JSON-RPC / HTTPS",
        stage: "adapter",
        status: "适配器待联调",
        description:
          "查询链、finalized 区块与 ETH 余额。当前任务使用构造数据，不会向 RPC 发起请求。",
        setup: "管理员在服务端配置候选 RPC 与两个独立参考来源。",
        next: "完成网络出口限制、能力探测与固定区块验收后，再开放 LIVE。",
        docs: "https://ethereum.org/developers/docs/apis/json-rpc/",
      },
      {
        id: "mcp",
        icon: "MCP",
        title: "MCP 工具服务",
        transport: "MCP / Streamable HTTP（规划）",
        stage: "planned",
        status: "待实现",
        description:
          "发现服务公开的工具及参数结构。工具声明只作为候选信息，不代表工具可靠。",
        setup: "计划由后端连接管理员允许的 MCP 服务，获取工具列表。",
        next: "实现 MCP 客户端、身份验证、权限映射与调用结果验收。当前不支持安装或执行任意命令。",
        docs: "https://modelcontextprotocol.io/specification/latest",
      },
      {
        id: "agent",
        icon: "API",
        title: "外部 Agent / HTTP API",
        transport: "服务专用 HTTPS API（规划）",
        stage: "planned",
        status: "待实现",
        description:
          "将外部 Agent 的受限能力映射为工具，例如返回指定区块的结构化余额观测。",
        setup: "需要服务接口说明、鉴权方式、权限范围与返回 schema。",
        next: "实现服务专用适配器；API Key 仅保存在服务端。当前没有通用 URL 抓取入口。",
        docs: null,
      },
      {
        id: "identity",
        icon: "ID",
        title: "链上 Agent 身份",
        transport: "ERC-8004 / Ethereum（规划）",
        stage: "planned",
        status: "待实现",
        description:
          "通过注册信息发现 Agent 身份和服务线索，再进入本地候选审核。注册不保证能力或信誉真实。",
        setup: "需要核对目标链的注册合约与 Agent 注册文件。",
        next: "实现注册表读取、来源验证与本地策略映射；不自动信任评分。",
        docs: "https://ercs.ethereum.org/ERCS/erc-8004",
      },
      {
        id: "osv",
        icon: "OSV",
        title: "依赖漏洞信息",
        transport: "OSV HTTPS API",
        stage: "adapter",
        status: "适配器待接入",
        description:
          "静态检查固定版本依赖的已知漏洞记录。当前演示没有发出 OSV 网络查询。",
        setup: "接入受控锁文件和 OSV 查询适配器，保留来源与查询时间。",
        next: "完成生产网络出口、缓存及失败策略；漏洞记录缺失不等于依赖安全。",
        docs: "https://google.github.io/osv.dev/api/",
      },
      {
        id: "registry",
        icon: "SIG",
        title: "公共证据登记",
        transport: "EIP-712 / BOT Chain 677",
        stage: "planned",
        status: "未部署",
        description: "自定义登记合约草案已提供；签名器和链上发布尚未接通。",
        setup: "需要签名器托管、目标链兼容性核验与部署回执。",
        next: "完成审计及部署，再独立批准发布。现有合约不宣称兼容 ERC-8004。",
        docs: "https://eips.ethereum.org/EIPS/eip-712",
      },
    ],
    services: config.services.map((service, i) => ({
      id: service.id,
      name: i === 0 ? "首选数据服务" : "备用数据服务",
      source: "SERVER_CONFIG",
      transport: "HTTP_RPC",
      endpointConfigured: Boolean(service.origin),
      status: mode === "SAMPLE" ? "SAMPLE_FIXTURE" : "NOT_VALIDATED",
      operation: "eth_getBalance",
      chainId: "1",
    })),
  };
}
