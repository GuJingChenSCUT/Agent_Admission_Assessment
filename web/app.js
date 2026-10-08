let session = null,
  task = null,
  reportEnvelope = null;
let mutationBusy = false,
  reportBusy = false,
  evidenceBusy = false;
let viewEpoch = 0,
  pollEpoch = 0,
  reportEpoch = 0,
  refreshSequence = 0,
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
  reference_consensus: "参考来源交叉核对",
  execution_complete: "执行完整性",
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
  RATE_LIMITED: "服务限流，本次无法完成核验",
  UPSTREAM_TIMEOUT: "上游查询超时",
  UPSTREAM_UNAVAILABLE: "上游服务不可用",
  RPC_REMOTE_ERROR: "服务拒绝当前 RPC 查询",
  REFERENCE_HASH_CONFLICT: "参考来源的区块哈希不一致",
  REFERENCE_HEAD_SKEW: "参考来源的 finalized 高度相差超过 32 个区块",
  LIVE_BINDING_CHANGED: "服务配置或依赖版本已改变，请新建任务",
  KNOWN_ADVISORY_FOUND: "生产依赖存在已知漏洞记录",
  ADVISORY_SOURCE_UNAVAILABLE: "未能取得完整漏洞记录",
  REQUEST_ABORTED: "请求已取消或超过运行时限",
};
const errors = {
  UNSUPPORTED_SCOPE:
    "当前仅支持以太坊主网、原生 ETH、执行时 finalized 区块的只读余额查询。",
  INVALID_TASK_INPUT: "请输入 1–4096 字符的研究任务。",
  LIVE_RUNTIME_NOT_CONFIGURED: "实际任务暂不可用，请联系管理员配置执行服务。",
  RUN_CAPACITY_REACHED: "当前运行名额已满，请稍后再次批准。",
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
const serviceName = (id) => {
  const label =
    id === "svc_primary"
      ? "首选数据服务"
      : id === "svc_backup"
        ? "备用数据服务"
        : id;
  const operator =
    task?.mode === "LIVE" &&
    task.serviceBindings?.find((s) => s.id === id)?.operatorId;
  const known = {
    "rpc_ethereum-rpc_publicnode_com": "PublicNode",
    rpc_eth_drpc_org: "dRPC",
  };
  return operator ? label + " · " + (known[operator] || operator) : label;
};
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
  const canCreate = Boolean(session);
  $("create").disabled =
    !canCreate || mutationBusy || running || !$("intent").value.trim();
  $("new-task").hidden = !task;
  $("new-task").disabled = mutationBusy || running;
  $("create").textContent = running
    ? "请等待当前任务结束"
    : task
      ? "提交新的任务 →"
      : "提交任务 →";
  for (const id of [
    "intent",
    "fallback",
    "scenario",
    "execution-kind",
    "fill-example",
  ])
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
  $("evidence").hidden = true;
  $("evidence-nav").hidden = true;
  $("evidence-empty").hidden = true;
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
  $("run-panel").hidden = false;
  $("pipeline").hidden = false;
  $("workspace-grid").classList.remove("idle");
  $("budget").hidden = !task.runId;
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
    ...(task.runId ? task.spec?.candidateServiceIds || [] : []).map((id) => {
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
      (fraction.length > 8 ? "≈ " : "") +
      (wei / 10n ** 18n).toLocaleString("en-US") +
      (fraction ? "." + fraction.slice(0, 8) : "") +
      " ETH";
    $("fact-label").textContent =
      task.mode === "SAMPLE"
        ? "SAMPLE 已验收结果 · 构造数据"
        : "LIVE 已验收结果 · RPC 交叉核对";
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
      const li = node(
          "li",
          event.message +
            (event.details?.code
              ? " 原因：" +
                (reasonLabels[event.details.code] || event.details.code)
              : ""),
        ),
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
    $("evidence").hidden = false;
    $("evidence-nav").hidden = false;
    $("signature-status").textContent = "未附签名";
    $("anchor-status").textContent = "未附登记回执";
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
        executionMode: $("execution-kind").value,
        ...($("execution-kind").value === "SAMPLE"
          ? { scenario: $("scenario").value }
          : {}),
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
$("download").onclick = async () => {
  if (!reportEnvelope) return;
  const id = task.taskId,
    epoch = reportEpoch;
  evidenceBusy = true;
  syncControls();
  clearError();
  try {
    const bundle = await api("/v1/tasks/" + id + "/evidence-bundle");
    if (id !== task?.taskId) return;
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(bundle, null, 2)], {
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
  } catch (e) {
    if (id === task?.taskId) showError(e);
  } finally {
    if (epoch === reportEpoch) {
      evidenceBusy = false;
      syncControls();
    }
  }
};
$("scenario").onchange = () => {
  $("scenario-help").textContent = scenarioHelp[$("scenario").value];
};
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

function updateMode() {
  const sample = $("execution-kind").value === "SAMPLE";
  $("scenario-control").hidden = !sample;
  $("banner").hidden = !sample;
  $("banner").textContent = sample
    ? "流程演练 · 本次使用构造数据，不代表外部服务的真实观测。"
    : "";
  $("scenario-help").textContent = scenarioHelp[$("scenario").value];
  syncControls();
}
$("intent").addEventListener("input", syncControls);
$("execution-kind").addEventListener("change", updateMode);
$("fill-example").onclick = () => {
  $("intent").value =
    "请核对 0x2222222222222222222222222222222222222222 的 ETH 余额，使用执行时 finalized 区块。";
  syncControls();
  $("intent").focus();
};
$("new-task").onclick = () => {
  if (mutationBusy || active.has(task?.status)) return;
  viewEpoch++;
  pollEpoch++;
  task = null;
  approvalRequest = null;
  resetEvidence();
  clearError();
  $("intent").value = "";
  $("answer").value = "";
  $("execution-kind").value = "LIVE";
  $("scenario").value = "normal";
  $("fallback").checked = true;
  $("scenario-control").open = false;
  for (const id of ["run-panel", "pipeline", "scope", "clarification"])
    $(id).hidden = true;
  for (const id of [
    "providers",
    "events",
    "amount",
    "fact-meta",
    "status",
    "task-id",
    "budget",
  ])
    $(id).replaceChildren();
  $("workspace-grid").classList.add("idle");
  updateMode();
  $("intent").focus();
};
(async function init() {
  try {
    session = await api("/v1/session");
    setStatus("connection", "本地工作台", "good");
    syncControls();
  } catch (e) {
    setStatus("connection", "连接中断", "bad");
    showError(e);
  }
})();
