#!/usr/bin/env node
/**
 * normalize-font-weights.mjs — 把散落的合成字重收敛到 3 档（400 / 500 / 600）。
 *
 * 为什么：
 *   SLC 字体栈是 "Geist"(可变字体 100-900) → "PingFang SC"(静态 400/500/600)
 *   → "Microsoft YaHei"。545 档的 550 / 650 / 720 / 750 / 760：
 *     · 拉丁字符命中 Geist 可变轴 → 真的是 550/650，渲染出独特粗细
 *     · 中文字符回落 PingFang → 只有 400/500/600，550→500、650→600
 *   后果：同一行「服务器 12 台」里，英文数字比中文粗半档，字色深浅不齐，
 *   小字号下看起来「发毛/发脏」。VRC 全程只用了 400/500/600（+ logo 的 800），
 *   这是它文字看起来锐利统一的主因之一。
 *
 * 映射：
 *   520, 550           → 500   (中等强调)
 *   650, 720, 750, 760 → 600   (强强调)
 *   700                → 保留   (标准 bold，属有意设计；仅报告不修改)
 *   100 / 800          → 保留   (logo 字标、大号展示数字)
 *
 * 用法：
 *   node scripts/normalize-font-weights.mjs --dry   # 只报告
 *   node scripts/normalize-font-weights.mjs         # 就地改
 */

import { readFileSync, writeFileSync, readdirSync, copyFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "apps", "extension", "src");

const MAP = {
  520: 500,
  550: 500,
  650: 600,
  720: 600,
  750: 600,
  760: 600,
  // 700 保留：标准 bold，且 PingFang 无 700 会回落 600、Geist 有真 700，
  // 这属于「有意选择」而非笔误，交给设计侧决定是否降到 600。
};

// 只统计、不修改的字重（用于报告）
const KEEP_BUT_FLAG = new Set([700]);

// font-weight: <number>  —— 只匹配数字写法，不动 var(--x) 和 normal/bold 关键字
const RE = /(font-weight\s*:\s*)(\d{3})\b/g;

const files = readdirSync(SRC).filter((f) => f.endsWith(".css"));
const dry = process.argv.includes("--dry");

let totalChanged = 0;
let totalSeen = 0;
const report = [];
const kept700 = [];

for (const file of files) {
  const path = join(SRC, file);
  const text = readFileSync(path, "utf8");
  const counts = {};
  let changed = 0;

  // 先记录保留下来的 700（仅报告，便于设计侧决定是否统一到 600）
  for (const m of text.matchAll(/(font-weight\s*:\s*)(700)\b/g)) {
    kept700.push(file);
  }

  const out = text.replace(RE, (whole, prefix, digits) => {
    totalSeen += 1;
    const from = Number(digits);
    const to = MAP[from];
    if (to === undefined || to === from) return whole;
    counts[`${from}→${to}`] = (counts[`${from}→${to}`] ?? 0) + 1;
    changed += 1;
    return `${prefix}${to}`;
  });

  if (changed > 0) {
    totalChanged += changed;
    report.push({ file, changed, counts });
    if (!dry) {
      copyFileSync(path, `${path}.bak`);
      writeFileSync(path, out);
    }
  }
}

console.log("=".repeat(70));
console.log(dry ? "字重归一化（试运行，未写入）" : "字重归一化（已写入，原文件备份为 .bak）");
console.log("=".repeat(70));
console.log(`扫描 ${files.length} 个 CSS，见到 font-weight 数字声明 ${totalSeen} 处，需改 ${totalChanged} 处\n`);

for (const r of report.sort((a, b) => b.changed - a.changed)) {
  const detail = Object.entries(r.counts).map(([k, v]) => `${k}×${v}`).join("  ");
  console.log(`  ${r.file.padEnd(34)} ${String(r.changed).padStart(3)} 处   ${detail}`);
}

if (kept700.length) {
  console.log(`\n保留未改：font-weight: 700 共 ${kept700.length} 处`);
  console.log("  （标准 bold，Geist 有真 700 字形、PingFang 回落 600 → 中英文略不一致，");
  console.log("    但属有意设计；若要彻底统一可把它们并到 600）");
  const byFile700 = {};
  for (const f of kept700) byFile700[f] = (byFile700[f] ?? 0) + 1;
  for (const [f, c] of Object.entries(byFile700).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${f.padEnd(34)} ${c} 处`);
  }
}

console.log("\n收敛后字重取值：");
const finalWeights = new Set();
for (const file of files) {
  const text = dry ? readFileSync(join(SRC, file), "utf8") : readFileSync(join(SRC, file), "utf8");
  for (const m of text.matchAll(/font-weight\s*:\s*(\d{3})\b/g)) finalWeights.add(Number(m[1]));
}
console.log("  " + [...finalWeights].sort((a, b) => a - b).join(" / "));
