/**
 * 大日志检索上限控制验证（2026-11-19）
 *
 * 目的：验证「命中超限只计数、不保留」的核心修复，确保：
 *  1. 命中总数精确（matchCount / matchTotal 不受保留上限影响）
 *  2. 常驻数组长度被限制在上限内（内存不再随命中数线性增长）
 *  3. truncated 标记正确
 *  4. toResponse 的版本号语义：版本未变时不下发结果体
 *
 * 运行：node scripts/verify-search-limits.mjs
 * 说明：通过直接实例化编译后的服务类，并用假数据驱动私有方法，
 *       不依赖真实 SSH / 服务器，属于本地单元级验证。
 */
import { LogSearchTaskService } from "../apps/gateway/dist/modules/logs/log-search-task.service.js";

const MAX_STORED_MATCHES = 5000;
const MAX_STORED_QUICK_MATCHES = 2000;
const MAX_STORED_RESULT_LINES = 20000;

let failed = 0;
function check(name, condition, detail = "") {
  if (condition) {
    console.log(`  PASS  ${name}`);
  } else {
    failed += 1;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

/** 构造最小可用的任务状态（只填上限逻辑用到的字段） */
function makeTask() {
  return {
    id: "test-task",
    request: { filePath: "/var/log/test.log" },
    status: "running",
    startedAt: Date.now(),
    totalBytes: 11 * 1024 * 1024 * 1024,
    scannedBytes: 0,
    scannedLines: 0,
    matchCount: 0,
    chunkLabel: "",
    progressPhase: "full_scan",
    progressPhaseLabel: "全文扫描",
    progressPhaseIndex: 1,
    progressPhaseCount: 1,
    phaseScannedBytes: 0,
    phaseTotalBytes: 1,
    quickPhaseBytes: 0,
    previewPhaseBytes: 0,
    commandPreview: "grep ...",
    strategyLabel: "分片扫描",
    scopeLabel: "test",
    matches: [],
    allLines: [],
    quickMatches: [],
    quickAllLines: [],
    quickDone: false,
    matchTotal: 0,
    matchDropped: 0,
    quickMatchTotal: 0,
    resultVersion: 0,
  };
}

const service = new LogSearchTaskService(
  /* serverRegistry */ { getServer: () => ({ id: "s", name: "s", basePath: "/tmp" }) },
  /* strategyResolver */ { resolve: () => ({ kind: "direct" }) },
  /* logSliceService */ { getMeta: async () => ({ size: 1024 }) },
);

const collectMatch = (task, target, match, ctx = []) =>
  service.collectMatch(task, target, match, ctx);
const getCachedFinalResult = (task) => service.getCachedFinalResult(task);
const toResponse = (task, since) => service.toResponse(task, since);

console.log("1) 命中数超上限后只计数、不保留");
{
  const task = makeTask();
  const total = MAX_STORED_MATCHES + 1234;
  for (let i = 1; i <= total; i += 1) {
    collectMatch(task, "full", { source: "/var/log/test.log", lineNumber: i, preview: `line ${i}` });
  }
  check("保留条数被限制在上限", task.matches.length === MAX_STORED_MATCHES, `实际 ${task.matches.length}`);
  check("命中总数精确", task.matchTotal === total, `实际 ${task.matchTotal}`);
  check("丢弃数正确", task.matchDropped === total - MAX_STORED_MATCHES, `实际 ${task.matchDropped}`);
  check("allLines 不超过上限", task.allLines.length <= MAX_STORED_RESULT_LINES, `实际 ${task.allLines.length}`);
  check(
    "超限后 matchCount 仍持续增长（界面命中数不停滞）",
    task.matchCount === total,
    `期望 ${total}，实际 ${task.matchCount}`,
  );

  const result = getCachedFinalResult(task);
  check("truncated 标记为 true", result.truncated === true);
}

console.log("1b) matchCount 只取全文结果，不把首批快搜重复计入");
{
  const task = makeTask();
  /* 先走首批快搜阶段 */
  for (let i = 1; i <= 100; i += 1) {
    collectMatch(task, "quick", { source: "/var/log/test.log", lineNumber: i, preview: `q ${i}` });
  }
  const afterQuick = task.matchCount;
  check("首批阶段不影响全文命中数", afterQuick === 0, `实际 ${afterQuick}`);

  /* 再走全文扫描；若把 quick 加进来会产生重复计数 */
  for (let i = 1; i <= 300; i += 1) {
    collectMatch(task, "full", { source: "/var/log/test.log", lineNumber: i, preview: `f ${i}` });
  }
  check("全文阶段命中数准确", task.matchCount === 300, `实际 ${task.matchCount}`);
  check("quick 通道独立计数", task.quickMatchTotal === 100, `实际 ${task.quickMatchTotal}`);
}

console.log("2) 未超上限时不被截断");
{
  const task = makeTask();
  const total = 100;
  for (let i = 1; i <= total; i += 1) {
    collectMatch(task, "full", { source: "/var/log/test.log", lineNumber: i, preview: `line ${i}` });
  }
  check("保留全部命中", task.matches.length === total, `实际 ${task.matches.length}`);
  const result = getCachedFinalResult(task);
  check("truncated 为 false", result.truncated === false);
}

console.log("3) 上下文行也受上限约束（contextLines=20 的放大场景）");
{
  const task = makeTask();
  /* 每条命中带 20 行上下文，若不设限会产生 21 倍膨胀 */
  for (let i = 1; i <= 3000; i += 1) {
    const ctx = [];
    for (let c = 20; c >= 1; c -= 1) {
      ctx.push({ lineNumber: Math.max(1, i - c), preview: `ctx ${i - c}`, isMatch: false });
    }
    collectMatch(task, "full", { source: "/var/log/test.log", lineNumber: i, preview: `line ${i}` }, ctx);
  }
  check("allLines 被限制", task.allLines.length <= MAX_STORED_RESULT_LINES, `实际 ${task.allLines.length}`);
  check("命中数仍精确", task.matchTotal === 3000, `实际 ${task.matchTotal}`);
}

console.log("4) 首批结果上限（quick 通道）");
{
  const task = makeTask();
  const total = MAX_STORED_QUICK_MATCHES + 500;
  for (let i = 1; i <= total; i += 1) {
    collectMatch(task, "quick", { source: "/var/log/test.log", lineNumber: i, preview: `q ${i}` });
  }
  check("quick 保留数受限", task.quickMatches.length === MAX_STORED_QUICK_MATCHES, `实际 ${task.quickMatches.length}`);
  check("quick 总数精确", task.quickMatchTotal === total, `实际 ${task.quickMatchTotal}`);
}

console.log("5) 结果缓存：同样数据不重复构建");
{
  const task = makeTask();
  for (let i = 1; i <= 10; i += 1) {
    collectMatch(task, "full", { source: "/var/log/test.log", lineNumber: i, preview: `line ${i}` });
  }
  const first = getCachedFinalResult(task);
  const second = getCachedFinalResult(task);
  check("缓存命中返回同一对象", first === second);
}

console.log("6) 版本号语义：版本未变则不下发结果体");
{
  const task = makeTask();
  for (let i = 1; i <= 5; i += 1) {
    collectMatch(task, "full", { source: "/var/log/test.log", lineNumber: i, preview: `line ${i}` });
  }
  task.status = "completed";
  task.resultVersion = 3;
  task.finishedAt = Date.now();

  const withResult = toResponse(task, 0);
  check("since 落后时下发结果", Boolean(withResult.result));

  const withoutResult = toResponse(task, 3);
  check("since 相同则省略结果体", withoutResult.result === undefined);
  check("省略时仍返回进度信息", withoutResult.resultVersion === 3 && withoutResult.status === "completed");
}

console.log("7) 任务回收：过期任务被清理");
{
  const task = makeTask();
  task.status = "completed";
  task.finishedAt = Date.now() - 11 * 60 * 1000;
  task.startedAt = task.finishedAt;
  service.tasks.set(task.id, task);
  service.pruneExpiredTasks();
  check("过期任务已删除", service.tasks.has(task.id) === false);
}

console.log("8) 短路优化：跳过解析后计数仍必须准确");
{
  const task = makeTask();
  /* 模拟流式消费点：超过上限走 countOverflowMatch，否则走 collectMatch */
  const feed = (n) => {
    for (let i = 1; i <= n; i += 1) {
      if (service.isMatchCapReached(task, "full")) {
        service.countOverflowMatch(task, "full");
      } else {
        collectMatch(task, "full", { source: "/v/t.log", lineNumber: i, preview: `l${i}` });
      }
    }
  };
  feed(MAX_STORED_MATCHES + 777);
  check("短路后保留数仍为上限", task.matches.length === MAX_STORED_MATCHES, `实际 ${task.matches.length}`);
  check("短路后命中总数精确", task.matchTotal === MAX_STORED_MATCHES + 777, `实际 ${task.matchTotal}`);
  check("短路后 matchCount 精确", task.matchCount === MAX_STORED_MATCHES + 777, `实际 ${task.matchCount}`);
  check("丢弃数与超限数一致", task.matchDropped === 777, `实际 ${task.matchDropped}`);
}

console.log("");
if (failed === 0) {
  console.log("全部通过 ✅");
  process.exit(0);
} else {
  console.log(`失败 ${failed} 项 ❌`);
  process.exit(1);
}
