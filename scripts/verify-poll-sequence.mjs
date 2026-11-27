/**
 * 轮询状态机验证（2026-11-19）
 *
 * 目的：`since` 版本号机制若实现有误，用户会「看到空结果」——比崩溃更糟。
 * 本脚本复刻 useLogViewer.ts 中真实的轮询循环逻辑，驱动真实的
 * LogSearchTaskService，逐拍断言结果是否正确送达。
 *
 * 运行：node scripts/verify-poll-sequence.mjs
 */
import { LogSearchTaskService } from "../apps/gateway/dist/modules/logs/log-search-task.service.js";

let failed = 0;
function check(name, cond, detail = "") {
  if (cond) console.log(`  PASS  ${name}`);
  else { failed += 1; console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`); }
}

const service = new LogSearchTaskService(
  { getServer: () => ({ id: "s", name: "s", basePath: "/tmp" }) },
  { resolve: () => ({ kind: "direct" }) },
  { getMeta: async () => ({ size: 11 * 1024 * 1024 * 1024 }) },
);

function makeTask() {
  return {
    id: "t1",
    request: { filePath: "/v/test.log" },
    status: "running",
    startedAt: Date.now(),
    totalBytes: 11 * 1024 * 1024 * 1024,
    scannedBytes: 0, scannedLines: 0, matchCount: 0,
    chunkLabel: "", progressPhase: "preview_scan", progressPhaseLabel: "",
    progressPhaseIndex: 1, progressPhaseCount: 3,
    phaseScannedBytes: 0, phaseTotalBytes: 1,
    quickPhaseBytes: 5 * 1024 * 1024, previewPhaseBytes: 512 * 1024,
    commandPreview: "", strategyLabel: "", scopeLabel: "",
    matches: [], allLines: [], quickMatches: [], quickAllLines: [],
    quickDone: false, matchTotal: 0, matchDropped: 0, quickMatchTotal: 0,
    resultVersion: 0,
  };
}

const collect = (t, target, n) => {
  for (let i = 1; i <= n; i += 1) {
    service.collectMatch(t, target, { source: "/v/test.log", lineNumber: i, preview: `line ${i}` });
  }
};

/**
 * 复刻前端 useLogViewer.ts 的轮询循环：
 *  - lastResultVersion 初始取创建响应中的版本
 *  - 每次轮询携带 since
 *  - 结果体省略时沿用上一拍快照
 */
function simulatePolling(task, phaseSteps) {
  const seen = { quickShown: false, finalShown: false, finalResult: null, timeline: [] };

  /* 创建响应 */
  let currentTask = service.toResponse(task);
  let lastResultVersion = typeof currentTask.resultVersion === "number" ? currentTask.resultVersion : -1;

  const poll = () => {
    const polled = service.get(task.id, lastResultVersion);
    if (typeof polled.resultVersion === "number") lastResultVersion = polled.resultVersion;
    currentTask = (polled.result || polled.quickResult)
      ? polled
      : { ...polled, result: currentTask.result, quickResult: currentTask.quickResult };
    if (currentTask.quickResult && !seen.quickShown) seen.quickShown = true;
    if (currentTask.result) { seen.finalShown = true; seen.finalResult = currentTask.result; }
    seen.timeline.push({
      status: currentTask.status,
      version: currentTask.resultVersion,
      hasQuick: Boolean(currentTask.quickResult),
      hasResult: Boolean(currentTask.result),
      matchCount: currentTask.matchCount,
    });
    return currentTask;
  };

  for (const step of phaseSteps) {
    step(task);
    while (task.status === "running") {
      poll();
      break; /* 每步只轮询一次，模拟「阶段变化后下一拍拿到更新」 */
    }
  }

  /* 完成态兜底补拉 */
  if (!currentTask.result) {
    currentTask = service.get(task.id);
    seen.finalResult = currentTask.result || null;
    seen.finalShown = Boolean(currentTask.result);
  }
  seen.currentTask = currentTask;
  return seen;
}

console.log("1) 完整四阶段：创建 → 首批 → 尾部 → 全文 → 完成");
{
  const task = makeTask();
  service.tasks.set(task.id, task);

  const phases = [
    (t) => { collect(t, "quick", 100); t.quickDone = true; t.resultVersion += 1; t.progressPhase = "quick_tail"; },
    (t) => { collect(t, "quick", 80); t.resultVersion += 1; t.progressPhase = "full_scan"; },
    (t) => {
      collect(t, "full", 300);
      t.matchCount = t.matchTotal;
      t.resultVersion += 1;
      t.status = "completed";
      t.finishedAt = Date.now();
    },
  ];

  const r = simulatePolling(task, phases);

  check("过程中出现过首批结果", r.quickShown === true);
  check("最终拿到了全文结果", r.finalShown === true);
  check("最终结果命中数正确", r.finalResult?.matches.length === 300, `实际 ${r.finalResult?.matches.length}`);
  check("最终 matchCount 为全文命中数", r.currentTask.matchCount === 300, `实际 ${r.currentTask.matchCount}`);
  console.log("     轮询时间线：");
  for (const s of r.timeline) {
    console.log(`       status=${s.status.padEnd(9)} ver=${s.version} quick=${s.hasQuick ? "Y" : "-"} result=${s.hasResult ? "Y" : "-"} count=${s.matchCount}`);
  }
}

console.log("2) 零命中场景：不能因为没结果而卡住或丢失完成态");
{
  const task = makeTask();
  service.tasks.set(task.id, task);
  const phases = [
    (t) => { t.quickDone = true; t.resultVersion += 1; },
    (t) => { t.resultVersion += 1; },
    (t) => { t.resultVersion += 1; t.status = "completed"; t.finishedAt = Date.now(); },
  ];
  const r = simulatePolling(task, phases);
  check("零命中仍拿到结果对象", r.finalResult !== null);
  check("零命中结果为空数组", r.finalResult?.matches.length === 0);
  check("零命中不被标记截断", r.finalResult?.truncated === false);
}

console.log("3) 大结果集：完成态必须送达（不能被 since 吃掉）");
{
  const task = makeTask();
  service.tasks.set(task.id, task);
  const phases = [
    (t) => { collect(t, "quick", 2000); t.quickDone = true; t.resultVersion += 1; },
    (t) => { t.resultVersion += 1; },
    (t) => {
      collect(t, "full", 8000);   /* 超过 5000 上限 */
      t.matchCount = t.matchTotal;
      t.resultVersion += 1;
      t.status = "completed";
      t.finishedAt = Date.now();
    },
  ];
  const r = simulatePolling(task, phases);
  check("大结果集最终仍送达", r.finalShown === true);
  check("保留条数被截断到上限", r.finalResult?.matches.length === 5000, `实际 ${r.finalResult?.matches.length}`);
  check("truncated 为 true", r.finalResult?.truncated === true);
  check("matchCount 反映真实总数", r.currentTask.matchCount === 8000, `实际 ${r.currentTask.matchCount}`);
}

console.log("4) 连续两次轮询无变化：不应重复下发结果体");
{
  const task = makeTask();
  service.tasks.set(task.id, task);
  collect(task, "full", 10);
  task.status = "completed";
  task.resultVersion = 5;
  task.finishedAt = Date.now();

  const r1 = service.get(task.id, 4);
  const r2 = service.get(task.id, 5);
  const r3 = service.get(task.id, 5);
  check("版本落后时下发", Boolean(r1.result));
  check("版本相同则省略", r2.result === undefined);
  check("再次轮询仍省略", r3.result === undefined);
  check("每次轮询响应体积远小于全量", JSON.stringify(r2).length < JSON.stringify(r1).length / 2,
    `省略=${JSON.stringify(r2).length}B 全量=${JSON.stringify(r1).length}B`);
}

console.log("");
if (failed === 0) {
  console.log("轮询状态机验证通过 ✅");
  process.exit(0);
} else {
  console.log(`失败 ${failed} 项 ❌`);
  process.exit(1);
}
