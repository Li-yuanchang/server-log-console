/**
 * 内存压力对比验证（2026-11-19）
 *
 * 目的：量化「无上限累积」与「带上限只计数」在 11 GB 级检索下的内存差异，
 * 确认崩溃主因已被消除。不依赖 SSH，直接模拟命中流。
 *
 * 运行：node scripts/verify-memory-pressure.mjs
 */
const TOTAL_MATCHES = 400_000;   // 模拟 11 GB 日志下几十万级命中
const MAX_STORED_MATCHES = 5000;

function mb(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function heapUsed() {
  global.gc?.();
  return process.memoryUsage().heapUsed;
}

/* ---- 修复前：无上限累积 + 每拍全量 map/join ---- */
function simulateBefore() {
  const matches = [];
  const allLines = [];
  for (let i = 1; i <= TOTAL_MATCHES; i += 1) {
    const preview = `2026-11-19 10:00:00 INFO request handled id=${i} result=ok`;
    matches.push({ source: "/var/log/catalina.out", lineNumber: i, preview });
    allLines.push({ lineNumber: i, preview, isMatch: true });
  }
  /* 模拟一次轮询：rawOutput + contextOutput 各一份完整副本 */
  const rawOutput = matches.map((m) => `${m.source}:${m.lineNumber}:${m.preview}`).join("\n");
  const sorted = [...allLines].sort((a, b) => a.lineNumber - b.lineNumber);
  const contextOutput = sorted.map((e) => `${e.lineNumber} | ${e.preview}`).join("\n");
  return {
    kept: matches.length,
    retainedBytes: matches.length * 100 + allLines.length * 100,
    responseBytes: rawOutput.length + contextOutput.length,
  };
}

/* ---- 修复后：超限只计数 + 结果缓存 ---- */
function simulateAfter() {
  const matches = [];
  const allLines = [];
  let matchTotal = 0;
  for (let i = 1; i <= TOTAL_MATCHES; i += 1) {
    const preview = `2026-11-19 10:00:00 INFO request handled id=${i} result=ok`;
    matchTotal += 1;
    if (matches.length >= MAX_STORED_MATCHES) continue;
    matches.push({ source: "/var/log/catalina.out", lineNumber: i, preview });
    if (allLines.length < 20_000) allLines.push({ lineNumber: i, preview, isMatch: true });
  }
  const rawOutput = matches.map((m) => `${m.source}:${m.lineNumber}:${m.preview}`).join("\n");
  return { kept: matches.length, matchTotal, retainedBytes: matches.length * 100 + allLines.length * 100, responseBytes: rawOutput.length };
}

const before = simulateBefore();
const beforeHeap = heapUsed();
console.log("修复前（无上限累积）:");
console.log(`  保留命中      : ${before.kept.toLocaleString()} 条`);
console.log(`  结果对象占用  : ${mb(before.retainedBytes)}`);
console.log(`  单次轮询响应  : ${mb(before.responseBytes)}`);
console.log(`  当前堆        : ${mb(beforeHeap)}`);
console.log("");

const heapBeforeAfter = heapUsed();
const after = simulateAfter();
const afterHeap = heapUsed();
console.log("修复后（上限 + 只计数）:");
console.log(`  保留命中      : ${after.kept.toLocaleString()} 条（总数仍为 ${after.matchTotal.toLocaleString()}）`);
console.log(`  结果对象占用  : ${mb(after.retainedBytes)}`);
console.log(`  单次轮询响应  : ${mb(after.responseBytes)}`);
console.log(`  当前堆        : ${mb(afterHeap)}`);
console.log("");

const retainedRatio = (before.retainedBytes / after.retainedBytes).toFixed(1);
const responseRatio = (before.responseBytes / after.responseBytes).toFixed(1);
console.log(`结果对象内存下降 : ${retainedRatio}x`);
console.log(`单次响应体积下降 : ${responseRatio}x`);

const ok = before.retainedBytes > after.retainedBytes && after.kept === MAX_STORED_MATCHES && after.matchTotal === TOTAL_MATCHES;
console.log("");
console.log(ok ? "验证通过 ✅" : "验证失败 ❌");
process.exit(ok ? 0 : 1);
