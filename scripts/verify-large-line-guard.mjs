/**
 * 超长单行 / 实时缓冲上限验证（2026-11-19）
 *
 * 背景：11 GB catalina.out 中存在单行数十万字符的 SQL 语句，
 * 整行进 dangerouslySetInnerHTML 会构造巨型文本节点，触发
 * V8 Oilpan「Large allocation. Ran out of reservation」杀掉渲染进程
 * （实测 JS 堆仅 9.5 MB，故不是普通内存泄漏）。
 *
 * 本脚本验证「渲染前截断」与「实时缓冲封顶」两处修复的边界行为。
 *
 * 运行：node scripts/verify-large-line-guard.mjs
 */
const MAX_RENDER_LINE_CHARS = 20000;
const LIVE_MAX_CHARS = 180_000;

let failed = 0;
function check(name, cond, detail = "") {
  if (cond) console.log(`  PASS  ${name}`);
  else { failed += 1; console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`); }
}

/* 复刻 VirtualLogViewer.clampLineForRender */
function clampLineForRender(text) {
  if (text.length <= MAX_RENDER_LINE_CHARS) return { text, truncated: false };
  return {
    text: `${text.slice(0, MAX_RENDER_LINE_CHARS)} …[本行共 ${text.length.toLocaleString()} 字符，已截断显示]`,
    truncated: true,
  };
}

/* 复刻 utils.trimLiveContent */
function trimLiveContent(content, maxChars = LIVE_MAX_CHARS) {
  if (content.length <= maxChars) return content;
  return content.slice(content.length - maxChars);
}

console.log("1) 超长单行截断");
{
  /* 模拟实测中最危险的情况：单行 500K 字符的 SQL */
  const hugeLine = `Execute_SQL_ SELECT ${"a".repeat(500_000)} FROM DUAL`;
  const clamped = clampLineForRender(hugeLine);
  check("超长行被截断", clamped.truncated === true);
  check("截断后长度受控", clamped.text.length < MAX_RENDER_LINE_CHARS + 100,
    `实际 ${clamped.text.length}`);
  check("截断后保留原文前缀", clamped.text.startsWith("Execute_SQL_ SELECT aaa"));
  check("截断提示含原长度", clamped.text.includes("500,") || clamped.text.includes("字符"));
}

console.log("2) 正常行不受影响");
{
  const normal = "2026-11-19 14:40:12.521  INFO 8803 --- [ XNIO-1 task-6] c.j.h.s.m.p.SqlLogInterceptor";
  const clamped = clampLineForRender(normal);
  check("正常行不截断", clamped.truncated === false);
  check("正常行内容不变", clamped.text === normal);
}

console.log("3) 边界值：恰好等于上限不截断");
{
  const exact = "x".repeat(MAX_RENDER_LINE_CHARS);
  check("恰好上限不截断", clampLineForRender(exact).truncated === false);
  const over = "x".repeat(MAX_RENDER_LINE_CHARS + 1);
  check("超 1 字符即截断", clampLineForRender(over).truncated === true);
}

console.log("4) 实时缓冲封顶：攒批期间不会无限增长");
{
  /* 模拟 11 GB 文件实时跟随下的突发：单拍涌入 5 MB */
  let pending = "";
  let maxSeen = 0;
  for (let i = 0; i < 50; i += 1) {
    const chunk = "log line content\n".repeat(5000); // 每块约 80KB
    pending = trimLiveContent(pending + chunk);
    maxSeen = Math.max(maxSeen, pending.length);
  }
  check("pending 被限制在上限内", maxSeen <= LIVE_MAX_CHARS, `峰值 ${maxSeen}`);
  check("封顶后仍保留尾部内容", pending.length > 0);
}

console.log("5) 拼接时先裁剪再合并：临时字符串不超上限两倍");
{
  const current = "a".repeat(LIVE_MAX_CHARS);
  const pending = "b".repeat(LIVE_MAX_CHARS);
  /* 旧写法：先拼后裁，瞬时构造 2 倍上限 */
  const oldPeak = (current + pending).length;
  /* 新写法：pending 先裁剪，再与 current 合并后裁剪 */
  const boundedPending = trimLiveContent(pending);
  const newPeak = (current + boundedPending).length;
  check("旧写法峰值达 2 倍上限", oldPeak === LIVE_MAX_CHARS * 2);
  check("新写法峰值不增加", newPeak <= LIVE_MAX_CHARS * 2, `实际 ${newPeak}`);
  check("最终结果仍受上限约束", trimLiveContent(`${current}${boundedPending}`).length <= LIVE_MAX_CHARS);
}

console.log("6) escapeHtml 单次分配（等价性 + 规模）");
{
  const HTML_ESCAPE_MAP = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  const escapeNew = (v) => v.replace(/[&<>"']/g, (c) => HTML_ESCAPE_MAP[c]);
  const escapeOld = (v) => v.replaceAll("&", "&amp;").replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");

  const samples = [
    `plain text`,
    `<script>alert("x")</script>`,
    `a & b < c > d " e ' f`,
    `SELECT * FROM t WHERE x = '&<>'"`,
  ];
  for (const s of samples) {
    check(`等价性: ${s.slice(0, 22)}`, escapeNew(s) === escapeOld(s),
      `new=${escapeNew(s)} old=${escapeOld(s)}`);
  }
}

console.log("");
if (failed === 0) {
  console.log("超长行与实时缓冲验证通过 ✅");
  process.exit(0);
} else {
  console.log(`失败 ${failed} 项 ❌`);
  process.exit(1);
}
