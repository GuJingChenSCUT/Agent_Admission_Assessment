const $ = (id) => document.getElementById(id);
const labels = {
  IDLE: "等待输入",
  PLANNING: "解析范围中",
  NEEDS_INPUT: "待补充信息",
  AWAITING_APPROVAL: "等待批准",
  RUNNING: "进行中",
  SUCCEEDED: "验收通过",
  FAILED: "验收未通过",
  QUARANTINED: "已隔离",
  CANCELLED: "已停止",
  CHECKING: "准入检查中",
  ELIGIBLE: "准入通过",
  VERIFYING: "逐项验收中",
  PASSED: "结果通过",
  REJECTED: "准入拒绝",
  INCONCLUSIVE: "证据不足",
  PASS: "通过",
  FAIL: "未通过",
  NOT_CHECKED: "未检查",
};
const terminal = new Set(["SUCCEEDED", "FAILED", "QUARANTINED", "CANCELLED"]);
let state,
  interactiveClock = 0,
  schedule = [],
  nextEvent = 0,
  activeClock = false;
let lastFrame = performance.now(),
  runEpoch = 0,
  reportKey = "",
  currentDigest = null,
  digestEpoch = 0;
let initializedAt = new Date().toISOString();
const hashCache = new Map();
function fresh() {
  return {
    status: "IDLE",
    stage: -1,
    prompt: "",
    spec: null,
    scenario: "stale_primary",
    history: [],
    attempts: [],
    calls: 0,
    switches: 0,
    snapshot: null,
    fact: null,
    title: "",
    detail: "",
    reason: "",
    elapsed: 0,
    report: null,
    tampered: false,
    verified: false,
  };
}
function el(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}
function badge(status) {
  return el("span", labels[status] || status, "badge " + status);
}
function appendHistory(target, event) {
  target.history.push({
    at: event.at,
    title: event.title,
    detail: event.detail,
  });
}
function apply(target, event) {
  target.stage = event.stage;
  target.title = event.title;
  target.detail = event.detail;
  appendHistory(target, event);
  if (event.snapshot) target.snapshot = event.snapshot;
  if (event.attempt) {
    const index = target.attempts.findIndex(
      (a) => a.service === event.attempt.service,
    );
    if (index < 0) target.attempts.push(event.attempt);
    else target.attempts[index] = event.attempt;
  }
  if (event.calls !== undefined) target.calls = event.calls;
  if (event.switches !== undefined) target.switches = event.switches;
  if (event.terminal) {
    target.status = event.terminal;
    target.reason = event.reason;
    target.fact = event.fact || null;
    target.report = makeReport(target);
  }
}
function makeReport(target) {
  return {
    schema: "jianghan-offline-demo/v1",
    executionMode: "SAMPLE",
    source: "SYNTHETIC_SAMPLE",
    productionReport: false,
    createdAt: initializedAt,
    scenario: target.scenario,
    prompt: target.prompt,
    scope: target.spec,
    result: target.status,
    snapshot: target.snapshot,
    attempts: target.attempts,
    acceptedFact: target.fact,
    counters: { calls: target.calls, switches: target.switches },
    trace: target.history,
    limitations: [
      "离线构造样本，未调用模型、RPC、OSV 或钱包。",
      "逐阶段动画用于解释工作流，不是模型内部思维记录。",
      "本报告不是生产 API 的 PublicReport；不能作为真实服务信誉证据。",
      "未附服务签名、密码学状态证明或链上登记。",
    ],
  };
}
async function digest(report) {
  if (!globalThis.crypto?.subtle) return null;
  const bytes = new TextEncoder().encode(JSON.stringify(report));
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
}
function renderEvidence(target) {
  $("evidence").hidden = !target.report;
  if (!target.report) {
    if (reportKey) {
      reportKey = "";
      currentDigest = null;
      digestEpoch++;
    }
    return;
  }
  const key = JSON.stringify(target.report);
  if (key !== reportKey) {
    reportKey = key;
    currentDigest = null;
    const epoch = ++digestEpoch;
    $("report-json").textContent = JSON.stringify(target.report, null, 2);
    $("digest").textContent = "正在计算本地 SHA-256 摘要…";
    const promise = hashCache.get(key) || digest(target.report);
    hashCache.set(key, promise);
    if (hashCache.size > 10) hashCache.delete(hashCache.keys().next().value);
    promise.then((value) => {
      if (epoch !== digestEpoch || key !== reportKey) return;
      currentDigest = value;
      $("digest").textContent = value
        ? "SHA-256  " + value
        : "当前浏览器不支持本地摘要计算。";
      $("verify").disabled = !value;
      $("tamper").disabled = !value;
    });
  }
  $("verify").disabled = !currentDigest;
  $("tamper").disabled = !currentDigest;
  $("download").disabled = false;
  $("integrity").className = target.tampered ? "bad" : "";
  $("integrity").textContent = target.tampered
    ? "篡改副本的摘要不一致 · 原件保留"
    : target.verified
      ? "原件摘要一致 · 完整性核对通过"
      : "";
}
function render(target) {
  state = target;
  if ($("prompt").value !== target.prompt) $("prompt").value = target.prompt;
  const busy = ["PLANNING", "RUNNING"].includes(target.status),
    locked = !["IDLE", "NEEDS_INPUT"].includes(target.status);
  $("prompt").disabled = locked;
  $("scenario").disabled = locked;
  $("fallback").disabled = locked;
  $("example").disabled = locked;
  $("submit").disabled = locked || !target.prompt.trim();
  $("submit").textContent =
    target.status === "NEEDS_INPUT" ? "补充后重新解析 ↗" : "提交委托 ↗";
  $("state-pill").textContent = labels[target.status];
  $("state-pill").className =
    "state-pill" +
    (busy
      ? " running"
      : ["FAILED", "QUARANTINED"].includes(target.status)
        ? " failed"
        : "");
  $("activity").hidden = target.status === "IDLE";
  $("pulse").hidden = !busy;
  $("activity-title").textContent = target.title;
  $("activity-detail").textContent = target.detail;
  $("stop").hidden = !["PLANNING", "RUNNING", "AWAITING_APPROVAL"].includes(
    target.status,
  );
  $("reset").hidden = target.status === "IDLE";
  $("input-hint").textContent =
    target.status === "NEEDS_INPUT"
      ? target.detail
      : "仅处理一个地址的原生 ETH 余额。";
  $("stages").replaceChildren(
    ...STAGES.map((name, i) => {
      const item = el(
        "li",
        undefined,
        i === target.stage ? "active" : i < target.stage ? "done" : "",
      );
      item.append(
        el("span", i < target.stage ? "✓" : String(i + 1), "step-index"),
        el("span", name),
      );
      if (i === target.stage) item.setAttribute("aria-current", "step");
      return item;
    }),
  );
  const act =
    target.stage < 0 ? -1 : target.stage < 2 ? 0 : target.stage < 5 ? 1 : 2;
  $("act-label").textContent =
    ["第一幕 / 约定", "第二幕 / 验收", "第三幕 / 留据"][act] || "等待委托";
  $("act-title").textContent =
    ["要的是这一批。", "交来之后，再核对。", "换个人，仍可复核。"][act] ||
    "约定 → 验收 → 留据";
  $("act-copy").textContent =
    [
      "把地址、区块策略与调用上限写清楚。",
      "交付真实，也须符合本次约定。",
      "结论与依据一同保存，变化能够被发现。",
    ][act] || "写下任务，观察每一步如何推进。";
  $("desk-eyebrow").textContent = [
    "第一幕 / 约定",
    "第二幕 / 验收",
    "第三幕 / 留据",
  ][Math.max(act, 0)];
  $("desk-title").textContent =
    target.status === "IDLE"
      ? "今天，要核对什么？"
      : terminal.has(target.status)
        ? "这份委托，有了记录。"
        : target.status === "AWAITING_APPROVAL"
          ? "先确认，再执行。"
          : "让每一步都有依据。";
  $("scope").hidden =
    !target.spec || target.status === "RUNNING" || terminal.has(target.status);
  if (target.spec) {
    const entries = {
      地址: target.spec.address,
      网络: target.spec.chain,
      资产: "原生 ETH · 只读",
      区块策略: "执行时 finalized · 固定区块哈希",
      候选: target.spec.allowFallback ? "服务 A → 服务 B" : "仅服务 A",
      预算: `最多 ${target.spec.maxProviderCalls} 次业务调用 · ${target.spec.maxFallbacks} 次切换`,
    };
    $("scope-fields").replaceChildren(
      ...Object.entries(entries).flatMap(([k, v]) => [
        el("dt", k),
        el("dd", v),
      ]),
    );
  }
  $("approve").disabled = target.status !== "AWAITING_APPROVAL";
  $("snapshot").hidden = !target.snapshot;
  if (target.snapshot) {
    $("block-number").textContent = target.snapshot.blockNumber;
    $("block-hash").textContent = target.snapshot.blockHash;
  }
  $("attempts").replaceChildren(
    ...target.attempts.map((a) => {
      const box = el("article", undefined, "attempt"),
        heading = el("div", undefined, "attempt-heading");
      heading.append(el("strong", "服务 " + a.service), badge(a.status));
      box.append(heading);
      for (const c of a.checks) {
        const row = el("div", undefined, "check-row");
        row.append(el("span", c.label), badge(c.status), el("p", c.detail));
        box.append(row);
      }
      if (a.observation)
        box.append(
          el(
            "p",
            `交付 hash：${a.observation.blockHash.slice(0, 18)}… · ${a.observation.balanceWei} wei`,
            "observation",
          ),
        );
      return box;
    }),
  );
  $("result").hidden = !terminal.has(target.status);
  $("result").className =
    "result" + (target.status === "SUCCEEDED" ? "" : " failure");
  $("result-label").textContent =
    target.status === "SUCCEEDED"
      ? "案例数据 · 已验收结果"
      : "案例数据 · 本次没有可采用结果";
  $("result-value").textContent = target.fact
    ? "42.125 ETH"
    : labels[target.status];
  $("result-note").textContent =
    target.reason +
    (target.spec
      ? ` 已消费 ${target.calls}/${target.spec.maxProviderCalls} 次业务调用，切换 ${target.switches}/${target.spec.maxFallbacks} 次。`
      : "");
  $("journal-empty").hidden = target.history.length > 0;
  $("event-count").textContent = target.history.length + " 步";
  const eventList = $("events"),
    atBottom =
      eventList.scrollHeight - eventList.scrollTop - eventList.clientHeight <
      60;
  eventList.replaceChildren(
    ...target.history.map((item) => {
      const li = el("li");
      li.append(el("strong", item.title), el("p", item.detail));
      return li;
    }),
  );
  if (atBottom) eventList.scrollTop = eventList.scrollHeight;
  renderEvidence(target);
}
function reset() {
  runEpoch++;
  activeClock = false;
  schedule = [];
  nextEvent = 0;
  interactiveClock = 0;
  initializedAt = new Date().toISOString();
  $("scenario").value = "stale_primary";
  $("fallback").checked = true;
  render(fresh());
}
function startPlan() {
  if (!["IDLE", "NEEDS_INPUT"].includes(state.status)) return;
  runEpoch++;
  const prompt = $("prompt").value,
    parsed = parseDemoPrompt(prompt, $("fallback").checked);
  state = fresh();
  state.prompt = prompt;
  state.scenario = $("scenario").value;
  state.status = "PLANNING";
  interactiveClock = 0;
  nextEvent = 0;
  activeClock = true;
  schedule = [
    {
      at: 0,
      stage: 0,
      title: "正在识别任务范围",
      detail: "读取输入中的地址、资产与只读操作要求。",
    },
  ];
  if (!parsed.ok)
    schedule.push({
      at: 2200,
      stage: 0,
      title: "需要补充或调整任务",
      detail: parsed.error,
      planningError: true,
    });
  else
    schedule.push(
      {
        at: 2000,
        stage: 0,
        title: "已识别一个以太坊地址",
        detail: parsed.spec.address,
      },
      {
        at: 4000,
        stage: 0,
        title: "已整理查询约束",
        detail: `原生 ETH · finalized · ${parsed.spec.allowFallback ? "允许一次备用切换" : "不允许备用切换"}。`,
      },
      {
        at: 6200,
        stage: 1,
        title: "范围已整理，等待批准",
        detail: "请确认地址、候选与预算；批准后才进入查询。",
        plannedSpec: parsed.spec,
      },
    );
  advanceInteractive();
  render(state);
}
function advanceInteractive() {
  while (
    nextEvent < schedule.length &&
    schedule[nextEvent].at <= interactiveClock
  ) {
    const event = schedule[nextEvent++];
    apply(state, event);
    if (event.plannedSpec) {
      state.spec = event.plannedSpec;
      state.status = "AWAITING_APPROVAL";
      activeClock = false;
    }
    if (event.planningError) {
      state.status = "NEEDS_INPUT";
      activeClock = false;
    }
    if (event.terminal) activeClock = false;
    state.elapsed = interactiveClock;
    render(state);
  }
}
function approveDemo() {
  if (state.status !== "AWAITING_APPROVAL") return;
  const offset = interactiveClock;
  state.status = "RUNNING";
  schedule = executionEvents(state.spec, state.scenario).map((event) => ({
    ...event,
    at: event.at + offset,
  }));
  nextEvent = 0;
  activeClock = true;
  appendHistory(state, {
    at: offset,
    title: "本次范围已批准",
    detail: "绑定本次范围，开始执行构造样本的验收流程。",
  });
  advanceInteractive();
}
function stopDemo() {
  if (!["PLANNING", "AWAITING_APPROVAL", "RUNNING"].includes(state.status))
    return;
  runEpoch++;
  activeClock = false;
  schedule = [];
  state.status = "CANCELLED";
  state.fact = null;
  state.reason = "已停止后续案例步骤；原有调用计数保留。";
  state.title = "停止已生效";
  state.detail = state.reason;
  state.attempts = state.attempts.map((a) =>
    ["RUNNING", "CHECKING", "VERIFYING"].includes(a.status)
      ? { ...a, status: "CANCELLED" }
      : a,
  );
  appendHistory(state, {
    at: interactiveClock,
    title: state.title,
    detail: state.detail,
  });
  if (state.spec) state.report = makeReport(state);
  render(state);
}
async function integrityCheck(tamper) {
  if (!state.report || !currentDigest) return;
  const epoch = runEpoch,
    key = reportKey,
    originalDigest = currentDigest,
    copy = JSON.parse(JSON.stringify(state.report));
  if (tamper) copy.limitations.push("副本被修改。");
  const observed = await digest(copy);
  if (epoch !== runEpoch || key !== reportKey) return;
  state.tampered = tamper && observed !== originalDigest;
  state.verified = !tamper && observed === originalDigest;
  renderEvidence(state);
}
function download() {
  if (!state.report) return;
  const data = {
    report: state.report,
    integrity: {
      algorithm: "SHA-256",
      digest: currentDigest,
      encoding: "UTF-8 JSON.stringify(report)",
    },
  };
  const url = URL.createObjectURL(
      new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
    ),
    link = el("a");
  link.href = url;
  link.download = "江汉验关-案例证据.json";
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
$("task-form").addEventListener("submit", (e) => {
  e.preventDefault();
  startPlan();
});
$("prompt").addEventListener("input", () => {
  state.prompt = $("prompt").value;
  $("submit").disabled = !state.prompt.trim();
});
$("example").onclick = () => {
  $("prompt").value = DEMO_PROMPT;
  state.prompt = DEMO_PROMPT;
  $("submit").disabled = false;
  $("prompt").focus();
};
$("approve").onclick = approveDemo;
$("stop").onclick = stopDemo;
$("reset").onclick = () => {
  reset();
  $("prompt").focus();
};
$("verify").onclick = () => void integrityCheck(false);
$("tamper").onclick = () => void integrityCheck(true);
$("download").onclick = download;
for (const [value, label] of Object.entries(SCENARIOS)) {
  const option = el("option", label);
  option.value = value;
  $("scenario").append(option);
}
reset();
function tick(now) {
  const delta = Math.min(Math.max(0, now - lastFrame), 250);
  lastFrame = now;
  if (!document.hidden) {
    if (activeClock) {
      interactiveClock += delta;
      state.elapsed = interactiveClock;
      advanceInteractive();
    }
  }
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);
