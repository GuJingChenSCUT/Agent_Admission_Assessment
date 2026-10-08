// Offline demonstration model. No network, model, wallet or production API calls.
export const DEMO_ADDRESS = "0x2222222222222222222222222222222222222222";
export const DEMO_PROMPT = `我在复核一份以太坊地址余额报表。请核验 ${DEMO_ADDRESS} 在执行时 finalized 区块的原生 ETH 余额；首选失败时最多切换一次备用，并保留验收依据供研究引用。`;
export const DEMO_HASH = "0x" + "11".repeat(32);
export const DEMO_WEI = "42125000000000000000";
export const STAGES = [
  "范围解析",
  "批准确认",
  "固定基准",
  "准入检查",
  "调用验收",
  "证据封存",
];
export const SCENARIOS = {
  stale_primary: "首选区块不符 → 备用通过",
  normal: "首选正常 → 直接通过",
  wrong_primary: "首选金额不符 → 备用通过",
  both_fail: "两家金额均不符 → 停止采用",
  reference_conflict: "参考来源冲突 → 隔离",
  rate_limited: "首选限流 → 备用通过",
  manifest_changed: "首选清单变化 → 准入拒绝",
};
export function parseDemoPrompt(text, allowFallback = true) {
  const input = text.trim();
  if (!input || input.length > 4096)
    return { ok: false, error: "请输入 1–4096 字符的任务。" };
  if (
    /(https?:|erc[-\s]?20|usdt|usdc|transfer|转账|发送交易|solana|polygon|bitcoin|bnb|bot\s*chain|arbitrum|optimism|sepolia|base\b|其他链|历史|昨天|yesterday|latest|pending)/i.test(
      input,
    )
  )
    return {
      ok: false,
      error:
        "当前演示仅支持以太坊主网、原生 ETH、执行时 finalized 区块的只读余额核验。",
    };
  const addresses = [
    ...new Set(
      (input.match(/\b0x[0-9a-fA-F]{40}(?![0-9a-fA-F])/g) || []).map((a) =>
        a.toLowerCase(),
      ),
    ),
  ];
  if (!addresses.length)
    return {
      ok: false,
      error:
        "尚未识别到完整地址。请补充一个 0x 开头、40 位十六进制字符的地址。",
    };
  if (addresses.length > 1)
    return { ok: false, error: "识别到多个地址。请明确本次核验的一个地址。" };
  if (!/(余额|balance)/i.test(input))
    return {
      ok: false,
      error: "请明确要求“查询 ETH 余额”，避免把其他地址任务误解为余额核验。",
    };
  const fallback =
    allowFallback &&
    !/(不(?:要|允许)?切换|禁用备用|不要备用|仅用首选|只用首选|no\s+fallback)/i.test(
      input,
    );
  return {
    ok: true,
    spec: {
      address: addresses[0],
      chain: "Ethereum mainnet · 1",
      asset: "ETH",
      snapshotPolicy: "FINALIZED_AT_RUN",
      allowFallback: fallback,
      maxProviderCalls: fallback ? 2 : 1,
      maxFallbacks: fallback ? 1 : 0,
    },
  };
}
export function validateDemoObservation(spec, observation) {
  const scope = observation.address === spec.address;
  const block = observation.blockHash === DEMO_HASH;
  return [
    {
      label: "查询地址",
      status: scope ? "PASS" : "FAIL",
      detail: scope ? "与批准地址一致" : "地址不一致",
    },
    {
      label: "区块哈希",
      status: block ? "PASS" : "FAIL",
      detail: block ? "与固定参考区块一致" : "交付区块与本次约定不符",
    },
    {
      label: "余额一致性",
      status:
        !scope || !block
          ? "NOT_CHECKED"
          : observation.balanceWei === DEMO_WEI
            ? "PASS"
            : "FAIL",
      detail:
        !scope || !block
          ? "范围不一致，跳过金额比较"
          : observation.balanceWei === DEMO_WEI
            ? "与两份参考样本一致"
            : "与同区块参考金额不一致",
    },
  ];
}
export function executionEvents(spec, scenario) {
  if (!Object.hasOwn(SCENARIOS, scenario)) throw Error("UNKNOWN_DEMO_SCENARIO");
  const events = [];
  let at = 0,
    calls = 0,
    switches = 0;
  const add = (seconds, stage, title, detail, patch = {}) => {
    at += seconds;
    events.push({ at: at * 1000, stage, title, detail, ...patch });
  };
  add(
    0,
    2,
    "读取两份参考样本",
    "对照主网标识与 finalized 头；当前使用构造样本。",
  );
  add(3, 2, "对齐参考区块", "分别核对同一高度的区块哈希，避免跨区块比较。");
  if (scenario === "reference_conflict") {
    add(3, 2, "参考来源发生冲突", "两份样本的哈希不一致，无法建立比较基准。", {
      terminal: "QUARANTINED",
      reason: "参考证据不足；未调用候选服务。",
      referenceConflict: true,
    });
    return events;
  }
  add(3, 2, "固定本次验收基准", "后续候选沿用同一地址、同一 blockHash。", {
    snapshot: {
      blockNumber: "24500000",
      blockHash: DEMO_HASH,
      balanceWei: DEMO_WEI,
      source: "SYNTHETIC_SAMPLE",
    },
  });
  const candidates = spec.allowFallback ? ["A", "B"] : ["A"];
  for (const service of candidates) {
    if (service === "B") {
      switches++;
      add(
        3,
        3,
        "切换已批准的备用服务",
        "重新做准入检查；地址与参考区块保持不变。",
        { switches },
      );
    }
    add(
      3,
      3,
      `检查服务 ${service} 的准入条件`,
      "核对清单版本、能力声明及客户端依赖检查样本。",
      {
        attempt: { service, status: "CHECKING", checks: [], observation: null },
      },
    );
    if (scenario === "manifest_changed" && service === "A") {
      add(
        3,
        3,
        "首选服务清单变化",
        "本次授权绑定的版本不一致；在业务调用前拒绝。",
        {
          attempt: {
            service,
            status: "REJECTED",
            checks: [
              {
                label: "清单版本",
                status: "FAIL",
                detail: "与批准时的摘要不一致",
              },
            ],
            observation: null,
          },
        },
      );
      continue;
    }
    const admission = [
      { label: "服务清单", status: "PASS", detail: "与批准版本一致 · 案例" },
      {
        label: "能力与依赖",
        status: "PASS",
        detail: "样本通过；未查询 OSV",
      },
      {
        label: "远程部署来源",
        status: "NOT_CHECKED",
        detail: "可选项，缺少来源证明",
      },
    ];
    add(
      3,
      3,
      `服务 ${service} 准入检查完成`,
      "必需项通过，可选未验证项继续保留。",
      {
        attempt: {
          service,
          status: "ELIGIBLE",
          checks: admission,
          observation: null,
        },
      },
    );
    calls++;
    add(
      3,
      4,
      `向服务 ${service} 发起案例调用`,
      "消费一次调用预算，传入固定地址与区块哈希。",
      {
        calls,
        attempt: {
          service,
          status: "RUNNING",
          checks: admission,
          observation: null,
        },
      },
    );
    if (scenario === "rate_limited" && service === "A") {
      add(
        4,
        4,
        "首选服务返回限流",
        "本次可用性不足，记录为 INCONCLUSIVE，不归类为数据造假。",
        {
          attempt: {
            service,
            status: "INCONCLUSIVE",
            checks: [
              ...admission,
              {
                label: "响应可用性",
                status: "INCONCLUSIVE",
                detail: "RATE_LIMITED · 故障注入",
              },
            ],
            observation: null,
          },
        },
      );
      continue;
    }
    const observation = {
      address: spec.address,
      blockHash:
        scenario === "stale_primary" && service === "A"
          ? "0x" + "55".repeat(32)
          : DEMO_HASH,
      balanceWei:
        scenario === "both_fail" ||
        (scenario === "wrong_primary" && service === "A")
          ? "42125000000000000001"
          : DEMO_WEI,
    };
    add(
      4,
      4,
      `收到服务 ${service} 的交付样本`,
      "已收到不代表已采用；下一步逐项核对范围、区块与金额。",
      {
        attempt: {
          service,
          status: "VERIFYING",
          checks: admission,
          observation,
        },
      },
    );
    const verification = validateDemoObservation(spec, observation),
      passed = verification.every((c) => c.status === "PASS");
    add(
      4,
      4,
      passed
        ? `服务 ${service} 的结果通过验收`
        : `拒绝服务 ${service} 的本次交付`,
      passed
        ? "必需规则全部通过，可以采用该事实。"
        : verification.find((c) => c.status === "FAIL").detail + "。",
      {
        attempt: {
          service,
          status: passed ? "PASSED" : "FAILED",
          checks: [...admission, ...verification],
          observation,
        },
      },
    );
    if (passed) {
      add(
        3,
        5,
        "整理验收证据",
        "把范围、参考样本、尝试记录与限制写入本地报告。",
      );
      add(
        3,
        5,
        "本次完成",
        "结果已经过样本规则核对，证据包现在可查看与下载。",
        {
          terminal: "SUCCEEDED",
          fact: { ...observation, service },
          reason: "只采用本次必需检查通过的事实。",
        },
      );
      return events;
    }
  }
  add(
    3,
    5,
    "保留失败记录，停止采用",
    "获准候选已耗尽；本次没有可采用的余额。",
    {
      terminal: scenario === "rate_limited" ? "QUARANTINED" : "FAILED",
      reason: "保留检查记录，不输出通过的余额。",
    },
  );
  return events;
}
