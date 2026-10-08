const $ = (id) => document.getElementById(id);
const film = document.body.dataset.mode === "film";
const labels = {
  IDLE: "等待输入",
  PLANNING: "解析范围中",
  NEEDS_INPUT: "待补充信息",
  AWAITING_APPROVAL: "等待批准",
  RUNNING: "演练进行中",
  SUCCEEDED: "演练验收通过",
  FAILED: "演练验收未通过",
  QUARANTINED: "演练已隔离",
  CANCELLED: "演练已停止",
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
let playing = false,
  filmTime = 0,
  rate = 1,
  lastFrame = performance.now(),
  lastFilmKey = "",
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
const time = (ms) => {
  const n = Math.max(0, Math.floor(ms / 1000));
  return (
    String(Math.floor(n / 60)).padStart(2, "0") +
    ":" +
    String(n % 60).padStart(2, "0")
  );
};
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
      $("verify").disabled = film || !value;
      $("tamper").disabled = film || !value;
    });
  }
  $("verify").disabled = film || !currentDigest;
  $("tamper").disabled = film || !currentDigest;
  $("download").disabled = film;
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
    locked = film || !["IDLE", "NEEDS_INPUT"].includes(target.status);
  $("prompt").disabled = locked;
  $("scenario").disabled = locked;
  $("fallback").disabled = locked;
  $("example").disabled = locked;
  $("submit").disabled = locked || !target.prompt.trim();
  $("submit").textContent =
    target.status === "NEEDS_INPUT" ? "补充后重新解析 ↗" : "提交演练任务 ↗";
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
  $("elapsed").textContent = time(target.elapsed);
  $("stop").hidden =
    film ||
    !["PLANNING", "RUNNING", "AWAITING_APPROVAL"].includes(target.status);
  $("reset").hidden = film || target.status === "IDLE";
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
      候选: target.spec.allowFallback
        ? "演练服务 A → 演练服务 B"
        : "仅演练服务 A",
      预算: `最多 ${target.spec.maxProviderCalls} 次业务调用 · ${target.spec.maxFallbacks} 次切换`,
    };
    $("scope-fields").replaceChildren(
      ...Object.entries(entries).flatMap(([k, v]) => [
        el("dt", k),
        el("dd", v),
      ]),
    );
  }
  $("approve").disabled = film || target.status !== "AWAITING_APPROVAL";
  $("snapshot").hidden = !target.snapshot;
  if (target.snapshot) {
    $("block-number").textContent = target.snapshot.blockNumber;
    $("block-hash").textContent = target.snapshot.blockHash;
  }
  $("attempts").replaceChildren(
    ...target.attempts.map((a) => {
      const box = el("article", undefined, "attempt"),
        heading = el("div", undefined, "attempt-heading");
      heading.append(el("strong", "演练服务 " + a.service), badge(a.status));
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
      ? "SAMPLE · 已验收的构造数据"
      : "SAMPLE · 本次没有可采用结果";
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
      li.append(
        el("time", time(item.at)),
        el("strong", item.title),
        el("p", item.detail),
      );
      return li;
    }),
  );
  if (atBottom || film) eventList.scrollTop = eventList.scrollHeight;
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
        detail: "请确认地址、候选与预算；批准后才进入演练查询。",
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
    title: "本次演练范围已批准",
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
  state.reason = "已停止后续模拟步骤；原有调用计数保留。";
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
  if (tamper) copy.limitations.push("演练副本被修改。");
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
  link.download = "江汉验关-离线演练证据.json";
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const filmExecution = executionEvents(
  parseDemoPrompt(DEMO_PROMPT).spec,
  "stale_primary",
);
const captions = [
  [
    0,
    "序章 / 东方茶港",
    "一份茶港的托付，先有约定，再经验收，最后留下凭据。",
    "intro",
  ],
  [
    8,
    "第一幕 / 写下委托",
    "从一个明确的问题开始：这个地址，在指定区块有多少 ETH？",
    "workspace",
  ],
  [
    18,
    "第一幕 / 解析范围",
    "先识别地址，再核对资产与权限。把用户的话整理成可批准的范围。",
    "workspace",
  ],
  [
    25,
    "第一幕 / 人工批准",
    "地址、区块策略、候选与预算都写清楚；先确认，再执行。",
    "scope",
  ],
  [
    34,
    "脚本演示 / 点击批准",
    "定时脚本模拟批准动作。此文件全程使用样本，不产生外部调用。",
    "scope",
  ],
  [
    38,
    "第二幕 / 固定基准",
    "两份参考样本对齐同一个 finalized 区块。此后，所有候选沿用同一基准。",
    "activity",
  ],
  [
    47,
    "第二幕 / 工具准入",
    "先核对服务清单和能力。未验证的来源仍标记为未检查。",
    "attempts",
  ],
  [
    57,
    "第二幕 / 检查交付",
    "收到响应，不代表结果可用。接着核对地址、区块与金额。",
    "attempts",
  ],
  [
    61,
    "第二幕 / 拒绝错块",
    "茶是真的，也可能不是订的那一批。区块不符，直接拒绝，不跨块比金额。",
    "attempts",
  ],
  [
    64,
    "第二幕 / 有界切换",
    "在原批准范围内换用备用服务。换服务，不换地址，也不换区块。",
    "attempts",
  ],
  [
    77,
    "第二幕 / 再次验收",
    "备用交付逐项通过，才进入可采用的事实。失败记录也会保留下来。",
    "attempts",
  ],
  [
    84,
    "第三幕 / 证据封存",
    "把这次范围、尝试与规则一起保存。每个结论，都能找到它的依据。",
    "activity",
  ],
  [
    90,
    "第三幕 / 查看证据",
    "42.125 ETH 是本片的构造样本结果。报告持续标注 SAMPLE 与能力边界。",
    "result",
  ],
  [
    94,
    "第三幕 / 核对原件",
    "在本地重新计算报告摘要，确认原件的内容完整性。",
    "evidence",
  ],
  [
    99,
    "第三幕 / 改动可被发现",
    "现在只改一份副本。摘要随内容改变，篡改被检出，原件仍然保留。",
    "evidence",
  ],
  [
    105,
    "终章 / 所交有据",
    "江汉验关：让 Agent 的每一次委托，都经过验收，留下依据。",
    "result",
  ],
];
function filmState(seconds) {
  const target = fresh();
  target.elapsed = seconds * 1000;
  if (seconds < 8) return target;
  const length = Math.min(
    DEMO_PROMPT.length,
    Math.floor(((seconds - 8) / 10) * DEMO_PROMPT.length),
  );
  target.prompt = DEMO_PROMPT.slice(0, length);
  if (seconds < 18) return target;
  target.prompt = DEMO_PROMPT;
  target.status = "PLANNING";
  const planning = [
    {
      at: 18000,
      stage: 0,
      title: "正在识别任务范围",
      detail: "读取输入中的地址与余额意图。",
    },
    {
      at: 20000,
      stage: 0,
      title: "已识别一个以太坊地址",
      detail: DEMO_ADDRESS,
    },
    {
      at: 22000,
      stage: 0,
      title: "已整理查询约束",
      detail: "原生 ETH · finalized · 最多两次业务调用与一次切换。",
    },
  ];
  for (const event of planning)
    if (event.at <= seconds * 1000) apply(target, event);
  if (seconds >= 24) {
    target.spec = parseDemoPrompt(DEMO_PROMPT).spec;
    target.stage = 1;
    target.status = "AWAITING_APPROVAL";
    target.title = "范围已整理，等待批准";
    target.detail = "先确认授权范围，再执行任务。";
    appendHistory(target, {
      at: 24000,
      title: target.title,
      detail: target.detail,
    });
  }
  if (seconds >= 34) {
    target.title = "脚本正在演示批准动作";
    target.detail = "定时版使用固定演示脚本，无外部调用。";
    appendHistory(target, {
      at: 34000,
      title: "演练范围已由脚本批准",
      detail: target.detail,
    });
  }
  if (seconds >= 38) {
    target.status = "RUNNING";
    for (const event of filmExecution) {
      if (event.at + 38000 > seconds * 1000) break;
      apply(target, { ...event, at: event.at + 38000 });
    }
  }
  return target;
}
let checkedFilmEpoch = -1;
async function filmIntegrity(kind) {
  const epoch = runEpoch;
  if (!state.report || checkedFilmEpoch === epoch) return;
  checkedFilmEpoch = epoch;
  const original = state.report,
    copy = JSON.parse(JSON.stringify(original));
  if (kind === "tamper") copy.limitations.push("演示脚本修改副本。");
  const [a, b] = await Promise.all([digest(original), digest(copy)]);
  if (epoch !== runEpoch || !state.report) return;
  if (!a || !b) {
    $("integrity").textContent = "此浏览器不支持本地摘要计算。";
    return;
  }
  state.verified = kind === "verify" && a === b;
  state.tampered = kind === "tamper" && a !== b;
  renderEvidence(state);
}
function renderFilm(force = false) {
  document.body.classList.toggle("paused", !playing);
  $("elapsed").textContent = time(filmTime * 1000);
  $("seek").value = String(filmTime);
  $("timecode").textContent = time(filmTime * 1000) + " / 01:50";
  $("play").textContent = playing
    ? "暂停 ❚❚"
    : filmTime >= 110
      ? "重播 ▶"
      : "开始播放 ▶";
  const target = filmState(filmTime),
    caption = captions.filter((c) => c[0] <= filmTime).at(-1);
  const key = [
    target.prompt,
    target.history.length,
    caption[0],
    filmTime >= 94,
    filmTime >= 99,
  ].join("|");
  if (force || key !== lastFilmKey) {
    const captionChanged = lastFilmKey.split("|").at(-3) !== String(caption[0]);
    lastFilmKey = key;
    runEpoch++;
    checkedFilmEpoch = -1;
    render(target);
    $("caption-chapter").textContent = caption[1];
    $("caption-text").textContent = caption[2];
    document.querySelectorAll(".chapters button").forEach((button) => {
      const times = [...document.querySelectorAll(".chapters button")].map(
        (b) => Number(b.dataset.time),
      );
      const active =
        Number(button.dataset.time) ===
        times.filter((t) => t <= filmTime).at(-1);
      button.classList.toggle("selected", active);
    });
    document
      .querySelectorAll(".film-emphasis")
      .forEach((n) => n.classList.remove("film-emphasis"));
    if (filmTime >= 34 && filmTime < 38)
      $("approve").classList.add("film-emphasis");
    if (captionChanged || force) {
      const focus = $(caption[3]);
      if (focus && !focus.hidden)
        focus.scrollIntoView({ block: "start", behavior: "instant" });
    }
  }
  if (filmTime >= 94) void filmIntegrity(filmTime >= 99 ? "tamper" : "verify");
}
function seek(value) {
  filmTime = Math.max(0, Math.min(110, value));
  lastFrame = performance.now();
  renderFilm(true);
}
$("task-form").addEventListener("submit", (e) => {
  e.preventDefault();
  if (!film) startPlan();
});
$("prompt").addEventListener("input", () => {
  if (!film) {
    state.prompt = $("prompt").value;
    $("submit").disabled = !state.prompt.trim();
  }
});
$("example").onclick = () => {
  if (film) return;
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
if (film) {
  $("cinema").hidden = false;
  $("sample-settings").hidden = true;
  $("mode-note").textContent = "定时脚本 · 01:50 · 字幕演示";
  $("example").hidden = true;
  $("submit").hidden = true;
  $("input-hint").textContent = "定时脚本将演示输入、确认与验收。";
  $("play").onclick = () => {
    if (filmTime >= 110) seek(0);
    playing = !playing;
    lastFrame = performance.now();
    renderFilm();
  };
  $("replay").onclick = () => {
    playing = true;
    seek(0);
  };
  $("seek").oninput = () => seek(Number($("seek").value));
  $("speed").onchange = () => {
    rate = Number($("speed").value);
  };
  document
    .querySelectorAll(".chapters button")
    .forEach(
      (button) => (button.onclick = () => seek(Number(button.dataset.time))),
    );
  $("fullscreen").onclick = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch {
      $("fullscreen").textContent = "请用 F11 全屏";
    }
  };
  document.addEventListener("keydown", (event) => {
    if (
      ["INPUT", "TEXTAREA", "SELECT", "BUTTON", "A"].includes(
        event.target.tagName,
      )
    )
      return;
    if (event.code === "Space") {
      event.preventDefault();
      $("play").click();
    }
    if (event.code === "ArrowRight") {
      event.preventDefault();
      seek(filmTime + 5);
    }
    if (event.code === "ArrowLeft") {
      event.preventDefault();
      seek(filmTime - 5);
    }
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      playing = false;
      renderFilm();
    }
    lastFrame = performance.now();
  });
  state = fresh();
  renderFilm(true);
  if (new URLSearchParams(location.search).get("autoplay") === "1")
    playing = true;
} else reset();
function tick(now) {
  const delta = Math.min(Math.max(0, now - lastFrame), 250);
  lastFrame = now;
  if (!document.hidden) {
    if (film && playing) {
      filmTime = Math.min(110, filmTime + (delta / 1000) * rate);
      if (filmTime >= 110) playing = false;
      renderFilm();
    }
    if (!film && activeClock) {
      interactiveClock += delta;
      state.elapsed = interactiveClock;
      advanceInteractive();
      $("elapsed").textContent = time(interactiveClock);
    }
  }
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);
