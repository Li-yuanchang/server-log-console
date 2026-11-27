/**
 * Invalid string length 修复验证（2026-11-19）
 *
 * 实测故障：11 GB catalina.out 检索「贾晶晶」得到 124 条命中，
 * 每条是超长批量 INSERT 语句（含大量中文字段值）。
 * 服务端拼 rawOutput / 前端拼 content 时字符串超过 V8 上限
 * （约 5.12 亿字符），抛 `RangeError: Invalid string length`，
 * 界面显示「检索失败」，但检索实际已成功完成（扫描 11.2 GB / 276 秒）。
 *
 * 本脚本验证：截断后不再触发该错误，且信息损失可控。
 *
 * 运行：node scripts/verify-string-length-guard.mjs
 */
const MAX_MATCH_PREVIEW_CHARS = 4000;
const MAX_JOINED_CONTENT_CHARS = 64 * 1024 * 1024;
const V8_MAX_STRING = 512 * 1024 * 1024;

let failed = 0;
function check(name, cond, detail = "") {
  if (cond) console.log(`  PASS  ${name}`);
  else { failed += 1; console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`); }
}

/* 复刻 gateway clampPreview */
function clampPreview(text) {
  if (text.length <= MAX_MATCH_PREVIEW_CHARS) return text;
  return `${text.slice(0, MAX_MATCH_PREVIEW_CHARS)} …[截断，原长 ${text.length} 字符]`;
}

/* 复刻前端 joinMatchesSafely */
function joinMatchesSafely(matches) {
  const parts = [];
  let size = 0;
  for (const match of matches) {
    const line = `${match.lineNumber} | ${match.preview}`;
    if (size + line.length + 1 > MAX_JOINED_CONTENT_CHARS) {
      parts.push(`…[结果过多，已省略剩余 ${matches.length - parts.length} 条，请收窄检索条件]`);
      break;
    }
    parts.push(line);
    size += line.length + 1;
  }
  return parts.join("\n");
}

console.log("1) 复现原始故障：124 条 × 5M 字符 = 620M，超 V8 上限");
{
  const perLine = 5 * 1024 * 1024;
  const n = 124;
  const total = perLine * n;
  check("未截断时总量确实超过 V8 上限", total > V8_MAX_STRING,
    `${(total / 1024 / 1024).toFixed(0)}M 字符 > ${V8_MAX_STRING / 1024 / 1024}M`);

  /* 实际触发一次，确认错误信息与用户看到的一致 */
  let errorMessage = "";
  try {
    const huge = "x".repeat(perLine);
    const joined = Array.from({ length: n }, () => huge).join("\n");
    void joined;
  } catch (error) {
    errorMessage = error.message;
  }
  check("确实抛出 Invalid string length", errorMessage === "Invalid string length", errorMessage);
}

console.log("2) 修复后：入口截断，总量可控");
{
  const perLine = 5 * 1024 * 1024;
  const n = 124;
  const matches = Array.from({ length: n }, (_, i) => ({
    lineNumber: i + 1,
    preview: clampPreview("INSERT INTO t VALUES " + "y".repeat(perLine)),
  }));

  const totalChars = matches.reduce((sum, m) => sum + m.preview.length, 0);
  check("截断后单条不超上限", matches.every((m) => m.preview.length <= MAX_MATCH_PREVIEW_CHARS + 60),
    `最大 ${Math.max(...matches.map((m) => m.preview.length))}`);
  check("截断后总量远低于 V8 上限", totalChars < V8_MAX_STRING,
    `${(totalChars / 1024).toFixed(0)}K 字符`);

  /* 关键：拼接不再抛错 */
  let joined = "";
  let threw = false;
  try {
    joined = joinMatchesSafely(matches);
  } catch { threw = true; }
  check("拼接不再抛出异常", threw === false);
  check("拼接结果可正常使用", joined.length > 0 && joined.includes("|"));
  check("124 条全部保留（远未触及 64M 上限）", !joined.includes("已省略剩余"),
    `joined=${(joined.length / 1024).toFixed(0)}K 字符`);
}

console.log("3) 截断保留了可诊断信息");
{
  const sqlPrefix = "INSERT INTO `t_business` VALUES ";
  const sqlLine = sqlPrefix + "z".repeat(1_000_000);
  const clamped = clampPreview(sqlLine);
  check("保留语句开头（可判断是什么操作）", clamped.startsWith("INSERT INTO `t_business` VALUES zzz"));
  check("标注原长度（便于判断是否需单独查看）",
    clamped.includes(`原长 ${sqlLine.length} 字符`),
    `期望包含「原长 ${sqlLine.length} 字符」，实际：${clamped.slice(-40)}`);
  check("截断后长度受控", clamped.length < MAX_MATCH_PREVIEW_CHARS + 60,
    `实际 ${clamped.length}`);
}

console.log("4) 正常长度的日志行完全不受影响");
{
  const normal = "2026-11-12 20:03:19.000  INFO 8803 --- [XNIO-1 task-6] c.j.h.s.m.p.SqlLogInterceptor : Execute_SQL 耗时 12ms";
  check("正常行原样保留", clampPreview(normal) === normal);
  check("边界：恰好 4000 字符不截断", clampPreview("a".repeat(4000)).length === 4000);
  check("边界：4001 字符截断", clampPreview("a".repeat(4001)).includes("截断"));
}

console.log("5) 前端兜底：即使服务端漏掉，也不会崩");
{
  /* 模拟历史任务或异常路径传入的海量数据 */
  const matches = Array.from({ length: 30000 }, (_, i) => ({
    lineNumber: i + 1,
    preview: "c".repeat(3000),
  }));
  let result = "";
  let threw = false;
  try {
    result = joinMatchesSafely(matches);
  } catch { threw = true; }
  check("极端数据下不抛异常", threw === false);
  check("触发省略提示", result.includes("已省略剩余"),
    `结果长度 ${(result.length / 1024 / 1024).toFixed(1)}M 字符`);
  check("输出仍低于 V8 上限", result.length < V8_MAX_STRING);
}

console.log("");
if (failed === 0) {
  console.log("字符串长度保护验证通过 ✅");
  process.exit(0);
} else {
  console.log(`失败 ${failed} 项 ❌`);
  process.exit(1);
}
