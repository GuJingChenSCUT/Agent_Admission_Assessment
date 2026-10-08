const $ = (id) => document.getElementById(id);
const isOperation = document.body.dataset.kind === "operation";
const duration = Number($("seek").max);
let position = 0,
  playing = false,
  last = performance.now(),
  lastScene = -1;
const operationCaptions = [
  [0, "序 / 江汉之滨", "从一份约定，到一次验收。让研究结论带着依据流转。"],
  [
    5,
    "一 / 写下委托",
    "研究员正在复核零地址余额报表，需要一份可引用、可复核的余额记录。",
  ],
  [
    11,
    "一 / 解析范围",
    "识别地址与余额意图，整理只读操作、区块策略和调用上限。",
  ],
  [
    16,
    "二 / 批准确认",
    "地址、候选、区块策略与预算写清楚。批准之后，再进入查询。",
  ],
  [
    21,
    "三 / 固定基准",
    "PublicNode 与 dRPC 对齐同一个 finalized 区块，后续交付沿用该基准。",
  ],
  [
    27,
    "四 / 工具准入",
    "检查清单、客户端依赖和链能力；无法验证的远端来源保留“未检查”。",
  ],
  [33, "五 / 调用验收", "按固定区块查询余额，再核对格式、地址、区块和数值。"],
  [
    40,
    "六 / 证据封存",
    "首选交付通过必需检查。本次业务调用一次，没有使用备用服务。",
  ],
  [
    46,
    "六 / 可复核的交付",
    "16 份原件随报告留存，已通过独立进程的摘要与引用完整性复核。",
  ],
  [50, "终 / 所交有据", "江汉验关。让每一次采用，都有一份可以回头核查的依据。"],
];
const promoCaptions = [
  [0, "江汉 / 托付", "从武汉茶港获得灵感：有约定，有验收，也要有留存的凭据。"],
  [
    7,
    "问题 / 数据交付",
    "Agent 收到响应只是开始。采用之前，需要确认对象、区块和数值。",
  ],
  [
    14,
    "原理 / 约·验·据",
    "把任务约束、工具准入、结果验收和证据留存连成一个闭环。",
  ],
  [
    23,
    "机制 / 有界执行",
    "不符就拒绝采用；只在批准范围内切换备用，失败也留下准确记录。",
  ],
  [
    32,
    "成效 / 真实验证",
    "已跑通以太坊余额核验、依赖公告查询，以及证据包的独立完整性复核。",
  ],
  [
    42,
    "可信 / 清楚的边界",
    "一致性不等于真实性证明。检查到哪里，结论就说到哪里。",
  ],
  [
    50,
    "江汉验关 / 所交有据",
    "面向以太坊研究 Agent。让工具有准入，让数据经验收，让结论有依据。",
  ],
];
const captions = isOperation ? operationCaptions : promoCaptions;
const chapters = isOperation
  ? [
      [0, "江汉之滨"],
      [5, "研究委托"],
      [16, "范围批准"],
      [21, "固定基准"],
      [27, "工具准入"],
      [33, "调用验收"],
      [40, "证据留存"],
    ]
  : [
      [0, "城市与托付"],
      [7, "真实问题"],
      [14, "验收原理"],
      [23, "执行边界"],
      [32, "已见成效"],
      [42, "可信表达"],
      [50, "江汉验关"],
    ];
const make = (tag, text, className) => {
  const n = document.createElement(tag);
  n.textContent = text;
  if (className) n.className = className;
  return n;
};
for (const [at, title] of chapters) {
  const b = make("button", title);
  b.dataset.at = at;
  b.onclick = () => seek(at);
  $("chapters").append(b);
}
function showScene(index) {
  if (index === lastScene) return;
  lastScene = index;
  document.querySelectorAll("[data-scene]").forEach((n) => {
    const active = Number(n.dataset.scene) === index;
    n.hidden = !active;
    n.classList.toggle("active", active);
  });
}
function operation(t) {
  showScene(t < 5 ? 0 : 1);
  if (t < 5) return;
  const record = RECORDED_BUNDLE.report;
  const address = record.taskSpec.address;
  const prompt = `我在复核以太坊零地址的余额报表。请核验 ${address} 在执行时 finalized 区块的原生 ETH 余额；首选服务失败时，最多切换一次备用。请保留区块、查询响应与验收依据，供研究引用。`;
  $("prompt").value = prompt.slice(
    0,
    Math.min(prompt.length, Math.floor(((t - 5) / 6) * prompt.length)),
  );
  const stage =
    t < 16 ? 0 : t < 21 ? 1 : t < 27 ? 2 : t < 33 ? 3 : t < 40 ? 4 : 5;
  const panels = [
    "request",
    "scope",
    "reference",
    "checks",
    "checks",
    "evidence",
  ];
  for (const id of new Set(panels))
    $(id + "-panel").hidden = panels[stage] !== id;
  document.querySelectorAll("#workflow li").forEach((n, i) => {
    n.classList.toggle("active", i === stage);
    n.classList.toggle("done", i < stage);
    if (i === stage) n.setAttribute("aria-current", "step");
    else n.removeAttribute("aria-current");
  });
  $("status-pill").textContent =
    t < 11
      ? "等待输入"
      : t < 16
        ? "解析范围中"
        : t < 20
          ? "等待批准"
          : t < 21
            ? "范围已批准"
            : t < 27
              ? "对齐参考中"
              : t < 33
                ? "准入检查中"
                : t < 36
                  ? "查询进行中"
                  : t < 40
                    ? "逐项验收中"
                    : "验收通过";
  $("card-kicker").textContent = [
    "RESEARCH REQUEST",
    "APPROVED SCOPE",
    "FIXED REFERENCE",
    "SERVICE ADMISSION",
    "DELIVERY ACCEPTANCE",
    "EVIDENCE PACKAGE",
  ][stage];
  $("card-title").textContent = [
    "请核对这份研究所需的数据。",
    "先确认，再执行。",
    "要的是同一个区块。",
    "先检查，才进入调用。",
    "收到响应，再核对交付。",
    "这份委托，有了依据。",
  ][stage];
  $("process").hidden = t < 11;
  $("process-title").textContent =
    t < 13 ? "已识别研究对象" : t < 14.5 ? "正在提取查询约束" : "范围已整理";
  $("process-detail").textContent =
    t < 13
      ? "以太坊主网 · 零地址 · 原生 ETH 余额"
      : t < 14.5
        ? "执行时 finalized · 只读 · 允许一次备用切换"
        : "等待批准后，才能发起服务查询";
  $("scope-address").textContent = address;
  $("approval").textContent =
    t < 20 ? "范围已整理 · 等待批准" : "✓ 本次范围已批准";
  $("approval").classList.toggle("confirmed", t >= 20);
  $("block-number").textContent = record.snapshot.blockNumber;
  $("block-hash").textContent = record.snapshot.blockHash;
  const admission = [
    ["服务清单", "批准版本与当前版本一致", "通过"],
    ["客户端依赖", "OSV 查询 10 个依赖，未返回已知公告", "通过"],
    ["链与区块能力", "以太坊主网 · 固定区块探测通过", "通过"],
    ["远端来源", "未提供可验证的部署证明", "未检查"],
  ];
  const checks = [
    ["响应格式", "返回值符合无符号整数格式", "通过"],
    ["查询范围", "与批准地址、原生 ETH 资产一致", "通过"],
    ["固定区块", "与约定区块哈希一致", "通过"],
    ["余额核对", "与同区块参考余额一致", "通过"],
  ];
  let rows =
    stage === 3
      ? admission.slice(0, Math.min(4, Math.floor((t - 27) / 1.5) + 1))
      : t < 36
        ? []
        : checks.slice(0, Math.min(4, Math.floor(t - 36) + 1));
  $("check-rows").replaceChildren(
    ...rows.map(([label, detail, status]) => {
      const row = make(
        "div",
        "",
        "check-row" + (status === "未检查" ? " unchecked" : ""),
      );
      row.append(
        make("span", label),
        make("p", detail),
        make("span", status === "通过" ? "✓ 通过" : status),
      );
      return row;
    }),
  );
  $("service-status").textContent =
    t < 33
      ? "准入检查中"
      : t < 36
        ? "请求已发出"
        : t < 40
          ? "交付核对中"
          : "结果通过";
  $("query-strip").hidden = t < 33 || t >= 36;
  $("call-budget").firstChild.textContent = "业务调用 ";
  $("call-budget").querySelector("b").textContent = t < 33 ? "0 / 2" : "1 / 2";
  const wei = BigInt(record.acceptedFact.balanceWei);
  const whole = (wei / 1000000000000000000n).toLocaleString("en-US");
  const fraction = (wei % 1000000000000000000n).toString().padStart(18, "0");
  $("balance").textContent = "≈ " + whole + "." + fraction.slice(0, 8) + " ETH";
  $("fact-detail").textContent =
    "精确值 " +
    record.acceptedFact.balanceWei +
    " wei · 区块 " +
    record.snapshot.blockNumber;
  $("report-hash").textContent = RECORDED_BUNDLE.reportHash;
}
function render() {
  $("seek").value = String(position);
  $("seek").setAttribute(
    "aria-valuetext",
    captions.filter((c) => c[0] <= position).at(-1)[1],
  );
  document.body.classList.toggle("paused", !playing);
  $("play").textContent = playing
    ? "暂停 ❚❚"
    : position >= duration
      ? "重播 ▶"
      : "播放 ▶";
  const caption = captions.filter((c) => c[0] <= position).at(-1);
  $("chapter-label").textContent = caption[1];
  $("caption").textContent = caption[2];
  const selected = chapters.filter((c) => c[0] <= position).at(-1)[0];
  document.querySelectorAll("#chapters button").forEach((b) => {
    b.classList.toggle("selected", Number(b.dataset.at) === selected);
    b.setAttribute("aria-pressed", String(Number(b.dataset.at) === selected));
  });
  if (isOperation) operation(position);
  else {
    const index = captions.indexOf(caption);
    showScene(index);
    document
      .querySelector(".promo-art")
      .classList.toggle("hero", index === 0 || index === 6);
    document
      .querySelector(".promo-art")
      .classList.toggle("quiet", index > 0 && index < 6);
  }
}
function seek(value) {
  position = Math.max(0, Math.min(duration, value));
  if (position >= duration) playing = false;
  last = performance.now();
  render();
}
$("play").onclick = () => {
  if (position >= duration) position = 0;
  playing = !playing;
  last = performance.now();
  render();
};
$("replay").onclick = () => {
  playing = true;
  seek(0);
};
$("seek").oninput = () => seek(Number($("seek").value));
$("fullscreen").onclick = async () => {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen();
  } catch {
    $("fullscreen").textContent = "请使用 F11";
  }
};
document.addEventListener("keydown", (e) => {
  if (["INPUT", "TEXTAREA", "BUTTON", "A"].includes(e.target.tagName)) return;
  if (e.code === "Space") {
    e.preventDefault();
    $("play").click();
  }
  if (e.code === "ArrowRight") {
    e.preventDefault();
    seek(position + 5);
  }
  if (e.code === "ArrowLeft") {
    e.preventDefault();
    seek(position - 5);
  }
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    playing = false;
    render();
  }
  last = performance.now();
});
if (isOperation)
  $("download").onclick = () => {
    const link = document.createElement("a");
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(RECORDED_BUNDLE, null, 2)], {
        type: "application/json",
      }),
    );
    link.href = url;
    link.download = "江汉验关-实测证据包.json";
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
const params = new URLSearchParams(location.search);
if (params.get("export") === "1") document.body.classList.add("export");
if (params.get("autoplay") === "1") playing = true;
render();
function tick(now) {
  const delta = Math.min(Math.max(0, now - last), 250);
  last = now;
  if (playing && !document.hidden) {
    position = Math.min(duration, position + delta / 1000);
    if (position >= duration) playing = false;
    render();
  }
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);
