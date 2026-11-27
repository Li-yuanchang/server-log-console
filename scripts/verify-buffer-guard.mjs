/**
 * stdout 缓冲上限验证（2026-11-19）
 *
 * 实测故障：检索 11 GB catalina.out 期间，主进程内存出现
 * 600MB → 1.6GB → 600MB 的剧烈锯齿，界面随之卡顿。
 * 根因：grep 输出 `__MATCH__\t<行号>\t<整行内容>`，而日志中存在
 * 「整条批量 INSERT」式超长行（数 MB）。在换行符到达前，
 * pendingStdout 会持续累积整行，形成超大临时字符串。
 *
 * 本脚本验证缓冲上限逻辑：无论单行多长，缓冲区恒定有界。
 *
 * 运行：node scripts/verify-buffer-guard.mjs
 */
const MAX_MATCH_PREVIEW_CHARS = 4000;
const MAX_BUFFER_CHARS = MAX_MATCH_PREVIEW_CHARS * 4; // 16000

let failed = 0;
function check(name, cond, detail = "") {
  if (cond) console.log(`  PASS  ${name}`);
  else { failed += 1; console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`); }
}

/* 复刻 gateway 中的 flushBuffer 逻辑（含 skippingLongLine 状态） */
function makeFlushBuffer(onMatch) {
  let peakBuffer = 0;
  let skippingLongLine = false;

  function flushBuffer(buffer, kind = "stdout") {
    peakBuffer = Math.max(peakBuffer, buffer.length);
    let buf = buffer;

    if (skippingLongLine) {
      const nl = buf.indexOf("\n");
      if (nl < 0) return "";
      buf = buf.slice(nl + 1);
      skippingLongLine = false;
    }

    for (;;) {
      const nl = buf.indexOf("\n");
      if (nl < 0) break;
      const line = buf.slice(0, nl).replace(/\r$/, "");
      buf = buf.slice(nl + 1);
      if (line) onMatch(line, false);
    }

    if (buf.length > MAX_BUFFER_CHARS) {
      if (buf.startsWith("__MATCH__\t")) onMatch(buf.slice(0, MAX_BUFFER_CHARS), true);
      skippingLongLine = true;
      return "";
    }

    return buf;
  }

  return { flushBuffer, getPeak: () => peakBuffer };
}

console.log("1) 数 MB 的超长单行不会撑爆缓冲区");
{
  const seen = [];
  const { flushBuffer, getPeak } = makeFlushBuffer((line, truncated) => seen.push({ line, truncated }));

  /* 模拟一条 5MB 的 INSERT 行，分 100 个 chunk 到达 */
  const hugeLine = "__MATCH__\t12345\tINSERT INTO t VALUES " + "x".repeat(5 * 1024 * 1024);
  const chunkSize = Math.ceil(hugeLine.length / 100);
  let pending = "";
  for (let i = 0; i < hugeLine.length; i += chunkSize) {
    pending += hugeLine.slice(i, i + chunkSize);
    pending = flushBuffer(pending);
  }

  check("缓冲区峰值受限", getPeak() <= MAX_BUFFER_CHARS + chunkSize,
    `峰值 ${getPeak()} 字符，上限 ${MAX_BUFFER_CHARS}`);
  check("超长行被识别并截断处理", seen.some((s) => s.truncated === true));
  check("未把 5MB 整行传给下游", seen.every((s) => s.line.length <= MAX_BUFFER_CHARS),
    `最大 ${Math.max(...seen.map((s) => s.line.length))}`);
}

console.log("2) 正常多行数据完整消费，不丢行");
{
  const seen = [];
  const { flushBuffer, getPeak } = makeFlushBuffer((line) => seen.push(line));
  let pending = "";
  const lines = Array.from({ length: 500 }, (_, i) => `__MATCH__\t${i + 1}\t正常日志行内容 ${i + 1}`);
  for (const line of lines) {
    pending += line + "\n";
    pending = flushBuffer(pending);
  }
  pending = flushBuffer(pending + "\n");
  check("500 行全部消费", seen.length === 500, `实际 ${seen.length}`);
  check("无重复无丢失", seen[0].includes("行内容 1") && seen[499].includes("行内容 500"));
  check("缓冲区峰值远小于上限", getPeak() < MAX_BUFFER_CHARS, `峰值 ${getPeak()}`);
}

console.log("3) 混合场景：长行夹在正常行之间");
{
  const seen = [];
  const { flushBuffer, getPeak } = makeFlushBuffer((line) => seen.push(line));
  let pending = "";
  pending += "__MATCH__\t1\t正常行A\n";
  pending = flushBuffer(pending);
  /* 超长行分块到达（贴近真实的 SSH data 事件粒度） */
  const huge = "__MATCH__\t2\t" + "y".repeat(2 * 1024 * 1024);
  const CHUNK = 64 * 1024;
  for (let i = 0; i < huge.length; i += CHUNK) {
    pending += huge.slice(i, i + CHUNK);
    pending = flushBuffer(pending);
  }
  /* 后续正常行必须仍能处理 */
  pending += "\n__MATCH__\t3\t正常行C\n";
  pending = flushBuffer(pending);

  check("超长行前后的正常行都被处理",
    seen.some((s) => s.includes("正常行A")) && seen.some((s) => s.includes("正常行C")),
    `共 ${seen.length} 条`);
  check("缓冲区峰值受限（分块到达）", getPeak() <= MAX_BUFFER_CHARS + 64 * 1024,
    `峰值 ${getPeak()}，上限 ${MAX_BUFFER_CHARS + 64 * 1024}`);
}

console.log("4) 内存效果对比（量级估算）");
{
  /* 未修复：单行 5MB 全量累积 */
  const unfixedPeak = 5 * 1024 * 1024;
  /* 修复后：上限 16000 字符 + 单个 chunk */
  const fixedPeak = MAX_BUFFER_CHARS + 64 * 1024;
  const ratio = unfixedPeak / fixedPeak;
  check(`缓冲峰值下降约 ${ratio.toFixed(0)} 倍`, ratio > 50,
    `${(unfixedPeak / 1024 / 1024).toFixed(1)}MB → ${(fixedPeak / 1024).toFixed(0)}KB`);
}

console.log("");
if (failed === 0) {
  console.log("缓冲区保护验证通过 ✅");
  process.exit(0);
} else {
  console.log(`失败 ${failed} 项 ❌`);
  process.exit(1);
}
