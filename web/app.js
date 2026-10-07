let session = null,
  task = null,
  reportEnvelope = null,
  inventory = null;
let mutationBusy = false,
  reportBusy = false,
  evidenceBusy = false;
let viewEpoch = 0,
  pollEpoch = 0,
  reportEpoch = 0,
  refreshSequence = 0,
  currentFilter = "all",
  approvalRequest = null;
const $ = (id) => document.getElementById(id);
const terminal = new Set(["SUCCEEDED", "FAILED", "QUARANTINED", "CANCELLED"]);
const active = new Set(["QUEUED", "RUNNING", "STOP_REQUESTED"]);
const statusLabels = {
  NEEDS_INPUT: "待补充信息",
  AWAITING_APPROVAL: "待批准",
  QUEUED: "等待执行",
  RUNNING: "正在验收",
  STOP_REQUESTED: "正在停止",
  SUCCEEDED: "验收通过",
  FAILED: "验收未通过",
  QUARANTINED: "结果已隔离",
  CANCELLED: "已停止",
};
const attemptLabels = {
  CHECKING: "准入检查中",
  RUNNING: "查询中",
  PASSED: "验收通过",
  FAILED: "结果拒绝",
  REJECTED: "准入拒绝",
  INCONCLUSIVE: "证据不足",
  CANCELLED: "已停止",
  LATE_DISCARDED: "晚到结果已丢弃",
};
const checkLabels = {
  PASS: "通过",
  FAIL: "未通过",
  NOT_CHECKED: "未检查",
  INCONCLUSIVE: "证据不足",
  ERROR: "检查异常",
};
const ruleLabels = {
  manifest_pin: "服务清单版本",
  capability_match: "能力匹配",
  client_dependency_policy: "客户端依赖策略",
  remote_deployment_provenance: "远程部署来源",
  response_available: "响应可用性",
  response_schema: "响应结构",
  response_scope: "查询范围一致性",
  snapshot_match: "区块一致性",
  balance_match: "余额一致性",
};
const reasonLabels = {
  DATA_SNAPSHOT_MISMATCH: "返回区块与固定参考区块不一致",
  DATA_BALANCE_MISMATCH: "返回余额与参考结果不一致",
  DATA_SCOPE_MISMATCH: "查询地址或资产范围不一致",
  MANIFEST_CHANGED: "服务清单发生变化，原授权不再适用",
  INVALID_WEI: "余额格式或整数范围无效",
  REFERENCE_BALANCE_CONFLICT: "参考来源的余额发生冲突",
  CROSS_BLOCK_COMPARISON_SKIPPED: "区块不同，已跳过金额比较",
  PROVENANCE_NOT_AVAILABLE: "缺少远程部署来源证明",
  PROVIDER_RESPONSE_UNKNOWN: "未取得完整服务响应",
};
const errors = {
  UNSUPPORTED_SCOPE:
    "当前仅支持以太坊主网、原生 ETH、执行时 finalized 区块的只读余额查询。",
  INVALID_TASK_INPUT: "请输入 1–4096 字符的研究任务。",
  LIVE_MODEL_ADAPTER_NOT_CONFIGURED:
    "LIVE 尚未完成接入，无法创建真实任务。请查看接入渠道。",
  SESSION_REQUIRED: "本地会话已失效，请刷新页面建立新会话。",
  CSRF_REQUIRED: "会话验证失败，请刷新页面后重试。",
  EVIDENCE_NOT_READY: "任务尚未生成证据，请稍后重新读取。",
};
const scenarioHelp = {
  normal: "首选服务返回与固定区块一致的数据，直接完成验收。",
  stale_primary: "观察系统如何拒绝过期数据，并在批准范围内切换服务。",
  both_fail: "两个候选均返回不一致的余额，不产生可采用的结果。",
  reference_conflict: "两个参考来源的区块冲突，任务隔离，不采用任何余额。",
  manifest_changed: "首选服务清单变化，准入拒绝后尝试已批准的备用服务。",
  optional_missing:
    "必需检查通过，远程来源证明保留为未检查，不伪装为全部已验证。",
};
const serviceName = (id) =>
  id === "svc_primary"
    ? "首选数据服务"
    : id === "svc_backup"
      ? "备用数据服务"
      : id;
const tone = (value) =>
  ["SUCCEEDED", "PASSED", "PASS"].includes(value)
    ? "good"
    : ["FAILED", "FAIL", "REJECTED", "ERROR"].includes(value)
      ? "bad"
      : [
            "QUARANTINED",
            "INCONCLUSIVE",
            "RUNNING",
            "CHECKING",
            "STOP_REQUESTED",
          ].includes(value)
        ? "warn"
        : "";
function node(tag, text, className) {
  const el = document.createElement(tag);
  if (text !== undefined) el.textContent = text;
  if (className) el.className = className;
  return el;
}
function badge(text, kind = "") {
  const el = node("span", text, "pill");
  el.dataset.tone = kind;
  return el;
}
function definitionList(entries) {
  return Object.entries(entries).flatMap(([key, value]) => [
    node("dt", key),
    node("dd", String(value)),
  ]);
}
function setStatus(id, text, kind = "") {
  $(id).textContent = text;
  $(id).dataset.tone = kind;
}
function showError(e) {
  const message = e?.message || String(e);
  $("error").textContent =
    errors[message] ||
    (message === "Failed to fetch"
      ? "无法连接本地服务，请检查服务运行状态后重试。"
      : message);
  $("error").hidden = false;
}
function clearError() {
  $("error").hidden = true;
}
async function api(path, options = {}) {
  const headers = {
    "content-type": "application/json",
    ...(options.headers || {}),
  };
  if (session?.csrfToken) headers["x-csrf-token"] = session.csrfToken;
  const response = await fetch(path, {
    ...options,
    headers,
    credentials: "same-origin",
    signal: AbortSignal.timeout(15000),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "HTTP_" + response.status);
  return body;
}
function syncControls() {
  const running = active.has(task?.status);
  const canCreate = Boolean(session) && session.executionMode === "SAMPLE";
  $("create").disabled = !canCreate || mutationBusy || running;
  $("create").textContent = running
    ? "请等待当前任务结束"
    : task
      ? "生成新的任务范围 →"
      : "生成任务范围 →";
  for (const id of ["intent", "fallback", "scenario"])
    $(id).disabled = !canCreate || mutationBusy || running;
  $("approve").disabled = mutationBusy || task?.status !== "AWAITING_APPROVAL";
  $("clarify").disabled = mutationBusy || task?.status !== "NEEDS_INPUT";
  $("stop").disabled =
    mutationBusy || !["QUEUED", "RUNNING"].includes(task?.status);
  $("refresh").disabled = mutationBusy || !task;
  $("load-evidence").disabled =
    mutationBusy || reportBusy || evidenceBusy || !terminal.has(task?.status);
  for (const id of ["verify", "tamper", "download"])
    $(id).disabled =
      !reportEnvelope || evidenceBusy || reportBusy || mutationBusy;
}
function resetEvidence() {
  reportEpoch++;
  reportEnvelope = null;
  reportBusy = false;
  evidenceBusy = false;
  $("evidence-empty").hidden = false;
  $("evidence-body").hidden = true;
  $("report").textContent = "";
  $("report-hash").textContent = "";
  $("checks").replaceChildren();
  $("verify-detail").textContent = "";
  setStatus("integrity", "尚未核对");
  syncControls();
}
function renderTask(next) {
  task = next;
  setStatus(
    "status",
    statusLabels[task.status] || task.status,
    tone(task.status),
  );
  $("task-id").textContent = task.taskId + " · v" + task.revision;
  $("budget").textContent =
    "候选 " +
    (task.counters?.checks || 0) +
    " / 2 · 调用 " +
    (task.counters?.providerCalls || 0) +
    " / 2 · 切换 " +
    (task.counters?.fallbacks || 0) +
    " / " +
    (task.spec?.limits?.maxFallbacks ?? 1);
  $("run-empty").hidden = true;
  const stage = terminal.has(task.status)
    ? 3
    : active.has(task.status)
      ? 2
      : task.status === "AWAITING_APPROVAL"
        ? 1
        : 0;
  document.querySelectorAll("[data-stage]").forEach((el) => {
    const i = Number(el.dataset.stage);
    el.classList.toggle("current", i === stage);
    el.classList.toggle("done", i < stage);
    if (i === stage) el.setAttribute("aria-current", "step");
    else el.removeAttribute("aria-current");
  });
  $("scope").hidden = !task.spec || task.status !== "AWAITING_APPROVAL";
  $("clarification").hidden = task.status !== "NEEDS_INPUT";
  $("question").textContent = task.draft?.clarification || "";
  if (task.spec) {
    $("revision").textContent = "VERSION " + task.revision;
    $("fields").replaceChildren(
      ...definitionList({
        数据链: "Ethereum mainnet · 1",
        资产: task.spec.asset,
        查询地址: task.spec.address,
        区块策略: "执行时 finalized · 固定 hash",
        候选服务: task.spec.candidateServiceIds.map(serviceName).join(" → "),
        调用预算:
          "最多 " +
          task.spec.limits.maxProviderCalls +
          " 次 · 最多切换 " +
          task.spec.limits.maxFallbacks +
          " 次",
        范围摘要: task.specHash,
      }),
    );
  }
  $("providers").replaceChildren(
    ...(task.spec?.candidateServiceIds || []).map((id) => {
      const attempt = task.attempts?.find((a) => a.serviceId === id),
        card = node("div", undefined, "provider"),
        row = node("div", undefined, "provider-heading");
      row.append(
        node("strong", serviceName(id)),
        badge(
          attempt
            ? attemptLabels[attempt.status] || attempt.status
            : "尚未调用",
          tone(attempt?.status),
        ),
      );
      const issue = attempt?.checks?.find(
        (c) => c.required && c.status !== "PASS",
      );
      const info = issue
        ? "原因：" + (reasonLabels[issue.reasonCode] || issue.reasonCode)
        : attempt?.status === "PASSED"
          ? "必需规则已通过；可选项请查看证据明细。"
          : "在批准范围内，使用同一地址与区块。";
      card.append(row, node("small", info));
      return card;
    }),
  );
  const fact = task.acceptedFact;
  $("fact").hidden = !fact;
  if (fact) {
    const wei = BigInt(fact.balanceWei),
      fraction = (wei % 10n ** 18n)
        .toString()
        .padStart(18, "0")
        .replace(/0+$/, "");
    $("amount").textContent =
      (wei / 10n ** 18n).toString() + (fraction ? "." + fraction : "") + " ETH";
    $("fact-label").textContent =
      task.mode === "SAMPLE" ? "SAMPLE 已验收结果 · 构造数据" : "已验收结果";
    $("fact-meta").textContent =
      serviceName(fact.serviceId) +
      " · 区块 " +
      fact.blockNumber +
      " · " +
      fact.balanceWei +
      " wei";
  }
  const outcomes = {
    SUCCEEDED: "仅采用通过必需规则的事实。可选未验证项仍保留在证据中。",
    FAILED: "候选均未通过验收，本次没有可采用的余额。",
    QUARANTINED: "必要证据未能闭合，结果已隔离。请查看执行记录。",
    CANCELLED: "已停止后续执行。此前发出的请求可能已被远端处理。",
  };
  $("outcome").hidden = !outcomes[task.status];
  $("outcome").textContent = outcomes[task.status] || "";
  $("stop-note").textContent =
    task.status === "STOP_REQUESTED"
      ? "停止请求已提交，正在等待工作器确认。"
      : active.has(task.status)
        ? "停止会阻止后续执行；已消费的调用预算不会返还。"
        : "";
  const events = task.events || [];
  $("event-details").hidden = !events.length;
  $("event-count").textContent = events.length + " 条";
  $("events").replaceChildren(
    ...events.map((event) => {
      const li = node("li", event.message),
        at = new Date(event.at);
      li.append(
        node(
          "small",
          (Number.isNaN(at.getTime())
            ? event.at
            : at.toLocaleTimeString("zh-CN", { hour12: false })) +
            " · " +
            event.type,
        ),
      );
      return li;
    }),
  );
  syncControls();
  if (terminal.has(task.status) && !reportEnvelope && !reportBusy)
    void loadEvidence();
}
async function loadEvidence() {
  if (!task || reportBusy || evidenceBusy || !terminal.has(task.status)) return;
  const id = task.taskId,
    epoch = ++reportEpoch;
  reportBusy = true;
  syncControls();
  try {
    const envelope = await api("/v1/tasks/" + id + "/evidence");
    if (id !== task?.taskId || epoch !== reportEpoch) return;
    reportEnvelope = envelope;
    $("evidence-empty").hidden = true;
    $("evidence-body").hidden = false;
    $("report").textContent = JSON.stringify(envelope, null, 2);
    $("report-hash").textContent = envelope.reportHash;
    setStatus("integrity", "尚未核对");
    $("verify-detail").textContent = "";
    renderChecks(envelope.report);
  } catch (e) {
    if (id === task?.taskId && epoch === reportEpoch) showError(e);
  } finally {
    if (epoch === reportEpoch) {
      reportBusy = false;
      syncControls();
    }
  }
}
function renderChecks(report) {
  $("checks").replaceChildren(
    ...(report.attempts || []).map((attempt) => {
      const details = node("details", undefined, "attempt-checks");
      details.append(
        node(
          "summary",
          serviceName(attempt.serviceId) +
            " · " +
            (attemptLabels[attempt.status] || attempt.status) +
            " · " +
            attempt.checks.length +
            " 项",
        ),
      );
      for (const check of attempt.checks) {
        const row = node("div", undefined, "rule");
        row.append(
          node(
            "span",
            (ruleLabels[check.ruleId] || check.ruleId) +
              (check.required ? " · 必需" : " · 可选"),
          ),
          badge(checkLabels[check.status] || check.status, tone(check.status)),
          node("small", check.ruleId + " / " + check.reasonCode),
        );
        details.append(row);
      }
      return details;
    }),
  );
}
async function refresh() {
  if (!task || mutationBusy) return false;
  const id = task.taskId,
    epoch = viewEpoch,
    sequence = ++refreshSequence;
  try {
    const next = await api("/v1/tasks/" + id);
    if (
      epoch !== viewEpoch ||
      id !== task?.taskId ||
      sequence !== refreshSequence
    )
      return false;
    renderTask(next);
    setStatus("connection", "本地服务已连接", "good");
    return true;
  } catch (e) {
    if (
      epoch === viewEpoch &&
      id === task?.taskId &&
      sequence === refreshSequence
    ) {
      showError(e);
      setStatus("connection", "状态刷新失败", "bad");
      $("stop-note").textContent = "自动刷新暂停，请点击“刷新状态”重试。";
    }
    return false;
  }
}
async function poll() {
  const epoch = ++pollEpoch;
  while (epoch === pollEpoch && active.has(task?.status)) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    if (epoch !== pollEpoch || mutationBusy) return;
    if (!(await refresh())) return;
  }
}
async function mutate(action) {
  if (mutationBusy) return;
  mutationBusy = true;
  viewEpoch++;
  pollEpoch++;
  clearError();
  syncControls();
  try {
    await action();
  } catch (e) {
    showError(e);
  } finally {
    mutationBusy = false;
    syncControls();
    if (active.has(task?.status)) void poll();
  }
}
$("task-form").addEventListener("submit", (event) => {
  event.preventDefault();
  if ($("create").disabled) return;
  void mutate(async () => {
    const next = await api("/v1/tasks", {
      method: "POST",
      body: JSON.stringify({
        text: $("intent").value,
        allowFallback: $("fallback").checked,
        scenario: $("scenario").value,
      }),
    });
    resetEvidence();
    approvalRequest = null;
    $("answer").value = "";
    renderTask(next);
    (next.status === "NEEDS_INPUT" ? $("answer") : $("scope")).scrollIntoView({
      block: "nearest",
    });
    if (next.status === "NEEDS_INPUT") $("answer").focus();
  });
});
$("clarification").addEventListener("submit", (event) => {
  event.preventDefault();
  if ($("clarify").disabled) return;
  void mutate(async () => {
    const next = await api("/v1/tasks/" + task.taskId + "/clarifications", {
      method: "POST",
      body: JSON.stringify({
        revision: task.revision,
        text: $("answer").value,
      }),
    });
    approvalRequest = null;
    renderTask(next);
  });
});
$("approve").onclick = () => {
  if ($("approve").disabled) return;
  void mutate(async () => {
    const body = {
      revision: task.revision,
      specHash: task.specHash,
      approvalNonce: task.approvalNonce,
    };
    const fingerprint = JSON.stringify([task.taskId, body]);
    if (approvalRequest?.fingerprint !== fingerprint)
      approvalRequest = { fingerprint, key: crypto.randomUUID() };
    renderTask(
      await api("/v1/tasks/" + task.taskId + "/approve", {
        method: "POST",
        headers: { "idempotency-key": approvalRequest.key },
        body: JSON.stringify(body),
      }),
    );
  });
};
$("stop").onclick = () => {
  if (!$("stop").disabled)
    void mutate(async () =>
      renderTask(
        await api("/v1/tasks/" + task.taskId + "/stop", {
          method: "POST",
          body: "{}",
        }),
      ),
    );
};
$("refresh").onclick = async () => {
  clearError();
  pollEpoch++;
  await refresh();
  if (active.has(task?.status)) void poll();
};
$("load-evidence").onclick = () => {
  clearError();
  void loadEvidence();
};
async function verifyReport(tamper) {
  if (!reportEnvelope || evidenceBusy) return;
  clearError();
  evidenceBusy = true;
  syncControls();
  const envelope = reportEnvelope,
    epoch = reportEpoch,
    copy = structuredClone(envelope.report);
  // Alter a valid field even when failed/cancelled reports have no acceptedFact.
  if (tamper)
    copy.limitations = [
      ...copy.limitations,
      "Tamper demonstration: modified local copy.",
    ];
  try {
    const checked = await api("/v1/public/evidence/verify", {
      method: "POST",
      body: JSON.stringify({ report: copy, reportHash: envelope.reportHash }),
    });
    if (epoch !== reportEpoch || envelope !== reportEnvelope) return;
    setStatus(
      "integrity",
      tamper
        ? checked.integrity === "FAIL"
          ? "篡改已检出 · 原件保留"
          : "篡改未被检出"
        : checked.integrity === "PASS"
          ? "内容摘要一致"
          : "内容摘要不一致",
      checked.integrity === "PASS" && !tamper ? "good" : "bad",
    );
    $("verify-detail").textContent =
      "结构：" +
      (checkLabels[checked.schema] || checked.schema) +
      " · 内容：" +
      (checkLabels[checked.integrity] || checked.integrity) +
      " · 报告有效期：" +
      (checked.validity === "PASS" ? "有效" : "已过期或无效") +
      "。签名与链上状态尚未核对。";
  } catch (e) {
    if (epoch === reportEpoch) showError(e);
  } finally {
    if (epoch === reportEpoch) {
      evidenceBusy = false;
      syncControls();
    }
  }
}
$("verify").onclick = () => void verifyReport(false);
$("tamper").onclick = () => void verifyReport(true);
$("download").onclick = () => {
  if (!reportEnvelope) return;
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(reportEnvelope, null, 2)], {
      type: "application/json",
    }),
  );
  const link = node("a");
  link.href = url;
  link.download = reportEnvelope.report.reportId + ".json";
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
$("scenario").onchange = () => {
  $("scenario-help").textContent = scenarioHelp[$("scenario").value];
};
function renderInventory(filter = currentFilter) {
  currentFilter = filter;
  document
    .querySelectorAll("[data-filter]")
    .forEach((el) =>
      el.setAttribute("aria-pressed", String(el.dataset.filter === filter)),
    );
  if (!inventory) return;
  const channels = inventory.channels.filter(
    (c) => filter === "all" || c.stage === filter,
  );
  $("catalog-summary").textContent =
    inventory.channels.length +
    " 类接入能力 · LIVE 未就绪 · 当前显示 " +
    channels.length +
    " 类";
  $("catalog-empty").hidden = channels.length !== 0;
  $("integrations").replaceChildren(
    ...channels.map((channel) => {
      const card = node("article", undefined, "integration-card"),
        heading = node("div", undefined, "card-heading");
      heading.append(
        node("span", channel.icon, "integration-icon"),
        badge(channel.status, channel.stage === "adapter" ? "warn" : ""),
      );
      const details = node("details");
      details.append(node("summary", "查看接入方式与下一步"));
      const dl = node("dl");
      dl.append(
        ...definitionList({
          协议: channel.transport,
          接入: channel.setup,
          下一步: channel.next,
        }),
      );
      details.append(dl);
      card.append(
        heading,
        node("h3", channel.title),
        node("p", channel.description),
        details,
      );
      if (channel.docs && channel.docs.startsWith("https://")) {
        const link = node("a", "官方规范 ↗");
        link.href = channel.docs;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        card.append(link);
      }
      return card;
    }),
  );
  $("service-catalog").replaceChildren(
    ...inventory.services.map((service) => {
      const card = node("div", undefined, "service-entry"),
        heading = node("div", undefined, "card-heading");
      heading.append(
        node("strong", service.name),
        badge(service.status === "SAMPLE_FIXTURE" ? "构造数据" : "未验证"),
      );
      card.append(
        heading,
        node("code", service.id + " · " + service.operation),
        node(
          "p",
          "来源：服务端配置 · Ethereum 1。" +
            (service.endpointConfigured
              ? "RPC 配置已填写，尚未联调。"
              : "真实 RPC 尚未配置。"),
        ),
      );
      return card;
    }),
  );
}
document
  .querySelectorAll("[data-filter]")
  .forEach((el) => (el.onclick = () => renderInventory(el.dataset.filter)));
function activateNav(id) {
  document.querySelectorAll(".nav-link").forEach((el) => {
    const selected = el.hash === "#" + id;
    el.classList.toggle("active", selected);
    if (selected) el.setAttribute("aria-current", "location");
    else el.removeAttribute("aria-current");
  });
}
document
  .querySelectorAll(".nav-link")
  .forEach((el) => (el.onclick = () => activateNav(el.hash.slice(1))));
const observer = new IntersectionObserver(
  (entries) => {
    for (const entry of entries)
      if (entry.isIntersecting) activateNav(entry.target.id);
  },
  { rootMargin: "-10% 0px -65% 0px", threshold: 0 },
);
document
  .querySelectorAll(".page-section")
  .forEach((el) => observer.observe(el));
const deploymentKeys = {
  mode: "运行模式",
  database: "本地数据库",
  model: "模型适配",
  rpc: "RPC 数据",
  dependencyScan: "依赖扫描",
  registry: "证据登记",
  publicSigning: "公开签名",
  ethereumIdentity: "以太坊身份",
  authentication: "访问方式",
  production: "生产就绪",
};
const deploymentValues = {
  SAMPLE: "SAMPLE · 构造数据",
  LIVE: "LIVE · 受阻",
  SQLITE_WAL: "SQLite WAL 已启用",
  BLOCKED_NOT_CONFIGURED: "尚未配置",
  SAMPLE_FIXTURES: "构造数据",
  NOT_VALIDATED: "尚未验证",
  ADAPTER_ONLY: "仅适配器，待接入",
  UNDEPLOYED: "未部署",
  BLOCKED: "未接通",
  NOT_IMPLEMENTED: "待实现",
  LOCAL_SESSION_ONLY: "仅本地浏览器会话",
  NOT_READY: "尚未就绪",
};
(async function init() {
  try {
    session = await api("/v1/session");
    setStatus("connection", "本地服务已连接", "good");
    $("banner").textContent =
      session.executionMode === "SAMPLE"
        ? "SAMPLE 演示环境 · 地址、区块、余额及检查观测均为构造数据。本次运行不调用外部 Agent、RPC、OSV 或钱包。"
        : "LIVE 接入尚未完成 · 任务创建已禁用，请查看接入渠道与部署就绪明细。";
    $("scenario-control").hidden = session.executionMode !== "SAMPLE";
    syncControls();
    const results = await Promise.allSettled([
      api("/v1/deployment"),
      api("/v1/integrations"),
    ]);
    if (results[0].status === "fulfilled")
      $("deployment").replaceChildren(
        ...definitionList(
          Object.fromEntries(
            Object.entries(results[0].value).map(([key, value]) => [
              deploymentKeys[key] || key,
              deploymentValues[value] || value,
            ]),
          ),
        ),
      );
    else {
      $("deployment").replaceChildren(node("dd", "部署状态读取失败"));
      showError(results[0].reason);
    }
    if (results[1].status === "fulfilled") {
      inventory = results[1].value;
      renderInventory();
    } else {
      $("catalog-summary").textContent =
        "接入目录读取失败，请重启更新后的后端并刷新页面。";
      showError(results[1].reason);
    }
  } catch (e) {
    setStatus("connection", "本地服务未连接", "bad");
    $("banner").textContent = "连接失败，请确认本地服务已启动，再刷新页面。";
    showError(e);
  }
})();
