#!/usr/bin/env node
/**
 * normalize-overlay-whites.mjs — 把「浅色面板背景」的半透明白/近白，改用 token 派生。
 *
 * 【为什么需要】
 * sage / sand / basalt 等暖色主题的 --panel 是偏暖的米白（如 #fbfbf7），
 * 但 CSS 里大量写着 rgba(248,250,252,0.96)（Tailwind slate-50，冷白）或
 * rgba(255,255,255,0.96)（纯中性白）。叠在暖色底上会把这些区域「拉回冷白」，
 * 一屏之内出现两套色温 —— 实测截图里暖白占 56.9%、中性白占 34.9%，
 * 这就是「看起来脏」的物理来源。
 *
 * 【为什么不能无脑全改】
 * 同一个 rgba(255,255,255,0.05) 有两种含义：
 *   · 浅色面板背景  → 要改成 color-mix(in srgb, var(--panel) N%, transparent)
 *   · 深色终端上的微弱高光（--shell 底） → 必须保留，改成 --panel 会变成一块白斑
 * 判据：alpha >= 0.5 视为「面板底色」（要改）；alpha < 0.5 视为「高光/描边」（保留）。
 * 另外 Terminal / tsc / pip 等深色区域的 rgba(255,255,255,0.0x) 全部保留。
 *
 * 用法：
 *   node scripts/normalize-overlay-whites.mjs --dry
 *   node scripts/normalize-overlay-whites.mjs
 */

import { readFileSync, writeFileSync, readdirSync, copyFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "apps", "extension", "src");

// 这些文件的 rgba(255,255,255,...) 都作用在深色底（终端 / 日志 / 代码编辑器）上，整体跳过
const DARK_SURFACE_FILES = new Set([
  "styles-tsc.css",              // 终端配色（高亮、滚动条、光标）
  "styles-terminal-workspace.css",
  "theme-modern.css",
  "theme-modern-v2.css",
]);

// 冷白 / 中性白的 rgb 三元组
const COOL_WHITES = [
  [255, 255, 255],
  [248, 250, 252], // slate-50
  [249, 250, 251], // gray-50
  [250, 250, 250], // neutral-50
  [251, 252, 253],
  [240, 245, 250],
  [245, 248, 251],
];

const RGBA_RE = /rgba\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*([\d.]+)\s*\)/g;

const files = readdirSync(SRC).filter((f) => f.endsWith(".css") && !DARK_SURFACE_FILES.has(f));
const dry = process.argv.includes("--dry");

let totalReplaced = 0;
let totalSkipped = 0;
const report = [];

for (const file of files) {
  const path = join(SRC, file);
  const lines = readFileSync(path, "utf8").split("\n");
  let replaced = 0;
  let skipped = 0;
  const samples = [];

  const out = lines.map((line, idx) => {
    const trimmed = line.trim();
    if (trimmed.startsWith("*") || trimmed.startsWith("/*") || trimmed.startsWith("//")) return line;

    // 只看 background 声明行（含 background / background-color）
    if (!/background/i.test(line)) return line;

    return line.replace(RGBA_RE, (whole, r, g, b, alpha) => {
      const rgb = [Number(r), Number(g), Number(b)];
      const isCoolWhite = COOL_WHITES.some((c) => c[0] === rgb[0] && c[1] === rgb[1] && c[2] === rgb[2]);
      if (!isCoolWhite) return whole;

      const a = Number(alpha);
      // alpha < 0.5 → 高光/蒙层，保留
      if (a < 0.5) {
        skipped += 1;
        return whole;
      }

      const pct = Math.round(a * 100);
      // 接近完全不透明的直接用 --panel，否则用 color-mix 保留透感
      const replacement = pct >= 95
        ? "var(--panel)"
        : `color-mix(in srgb, var(--panel) ${pct}%, transparent)`;

      replaced += 1;
      if (samples.length < 3) samples.push(`${idx + 1}: ${whole} → ${replacement}`);
      return replacement;
    });
  });

  if (replaced > 0) {
    report.push({ file, replaced, skipped, samples });
    totalReplaced += replaced;
    totalSkipped += skipped;
    if (!dry) {
      copyFileSync(path, `${path}.bak`);
      writeFileSync(path, out.join("\n"));
    }
  }
}

console.log("=".repeat(72));
console.log(dry ? "半透明白 → token（试运行）" : "半透明白 → token（已写入，备份 .bak）");
console.log("=".repeat(72));
console.log(`扫描 ${files.length} 个 CSS（跳过深色面板文件 ${DARK_SURFACE_FILES.size} 个）`);
console.log(`替换 ${totalReplaced} 处，保留（alpha<0.5 的高光/蒙层）${totalSkipped} 处\n`);

for (const r of report.sort((a, b) => b.replaced - a.replaced)) {
  console.log(`  ${r.file.padEnd(32)} 改 ${String(r.replaced).padStart(3)}  留 ${String(r.skipped).padStart(2)}`);
  for (const s of r.samples) console.log(`      ${s}`);
}
