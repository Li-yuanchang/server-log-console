#!/usr/bin/env node
/**
 * audit-color-tokens.mjs — 扫描 extension/src 的 CSS，找出「没走 token 的字面色」，
 * 按色板来源分类，并按【属性语义】给出安全的 token 替换建议。
 *
 * 【为什么必须按属性区分】
 * 同一个 #ffffff 有两种完全相反的语义：
 *   background:#ffffff  → var(--panel)      （浅色面板底，暗色主题下应变深）
 *   color:#ffffff       → var(--on-accent)  （主按钮上的白字，暗色主题下可能变深字）
 * 一律换成同一个 token 会在某个主题下变成「白底白字」或「深底深字」。
 * 同理 #315f8d 出现在 background 是色块、出现在 color 是文字、出现在 border 是描边，
 * 三者应分别落到 --accent / --accent / --line-strong 之类的不同 token。
 *
 * 【三个色板来源】
 *   ① theme-modern.css :root 的 geist 灰 + #0070f3 蓝（本项目权威 token）
 *   ② Tailwind slate/blue（#64748b / #334155 / #0f172a …）
 *   ③ VRC 的 sage/olive（#92988d / #d9ded0 / #fbfbf7 / #426b57 …）—— 从 VRC 抄设计带来
 *
 * 用法：
 *   node scripts/audit-color-tokens.mjs            # 打印报告
 *   node scripts/audit-color-tokens.mjs --json      # 机器可读
 *   node scripts/audit-color-tokens.mjs --apply     # 就地替换（生成 .bak）
 *   node scripts/audit-color-tokens.mjs --apply --only=vrc   # 只替换 VRC 色板
 */

import { readFileSync, writeFileSync, readdirSync, copyFileSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "apps", "extension", "src");

/* ============================================================
   色值 → { 属性类别 → token }
   属性类别：bg / fg / border / shadow
   ============================================================ */

// ③ VRC sage/olive（值取自 VRC apps/web/src/styles.css :root）
// 注意 #426b57 是松绿，本项目 accent 是蓝 —— 跨色相，只在 fg/bg 强调场景替换
const VRC_SAGE = {
  "#f5f6f2": { bg: "--bg" },
  "#fbfbf7": { bg: "--panel" },
  "#eef1e8": { bg: "--panel-muted" },
  "#d9ded0": { border: "--line", bg: "--panel-muted" },
  "#b8c2ae": { border: "--line-strong" },
  "#27302a": { fg: "--ink" },
  "#747b70": { fg: "--ink-soft" },
  "#92988d": { fg: "--ink-muted" },
  "#426b57": { bg: "--accent", fg: "--accent", border: "--accent" },
  "#315743": { bg: "--accent-strong", border: "--accent-strong" },
  "#e5eee6": { bg: "--accent-soft" },
  "#4d6f73": { fg: "--accent", bg: "--accent-soft" },
  "#477a45": { fg: "--green", bg: "--green", border: "--green" },
  "#b77935": { fg: "--amber", bg: "--amber", border: "--amber" },
  "#a5483d": { fg: "--red", bg: "--red-soft", border: "--red" },
  "#223329": { bg: "--ink", fg: "--panel" },
};

// ② Tailwind slate / blue / gray
const TAILWIND = {
  // --- slate 文字 ---
  "#0f172a": { fg: "--ink" },
  "#1e293b": { fg: "--ink" },
  "#172033": { fg: "--ink" },
  "#1f2f46": { fg: "--ink" },
  "#334155": { fg: "--ink-soft" },
  "#475569": { fg: "--ink-soft" },
  "#64748b": { fg: "--ink-muted" },
  "#7a8694": { fg: "--ink-muted" },
  "#94a3b8": { fg: "--ink-muted" },
  "#9ca3af": { fg: "--ink-muted" },
  "#708095": { fg: "--ink-muted" },
  "#132033": { fg: "--ink" },

  // --- slate 线 ---
  "#cbd5e1": { border: "--line-strong" },
  "#d4d4d4": { border: "--line-strong" },
  "#c5d2e0": { border: "--line-strong" },
  "#b7c8da": { border: "--line-strong" },
  "#d7dde5": { border: "--line" },
  "#d8dde4": { border: "--line" },
  "#d8e0ea": { border: "--line" },
  "#d9e0e8": { border: "--line" },
  "#dde3ea": { border: "--line" },
  "#e1e6ec": { border: "--line" },
  "#e2e8f0": { border: "--line" },
  "#eaeaea": { border: "--line" },

  // --- 浅色背景 ---
  "#f1f5f9": { bg: "--panel-muted" },
  "#f3f5f8": { bg: "--panel-muted" },
  "#f4f7fa": { bg: "--panel-muted" },
  "#f5f9ff": { bg: "--panel-muted" },
  "#f6f9fd": { bg: "--panel-muted" },
  "#eef4fa": { bg: "--panel-muted" },
  "#f0f3f7": { bg: "--panel-muted" },
  "#e9edf2": { bg: "--panel-muted" },
  "#edf3f9": { bg: "--panel-muted" },
  "#eef3f8": { bg: "--panel-muted" },
  "#f8fafc": { bg: "--bg" },
  "#fafafa": { bg: "--bg" },
  "#fbfcfd": { bg: "--panel" },
  "#fbfcfe": { bg: "--panel" },
  "#fbfdff": { bg: "--panel" },
  "#f8fbff": { bg: "--panel" },
  "#f8fbfd": { bg: "--panel" },
  "#f6f8fa": { bg: "--bg" },
  "#f4f8fc": { bg: "--panel-muted" },
  "#f0f5fa": { bg: "--panel-muted" },
  "#f7f9fc": { bg: "--panel" },
  "#f5f8fb": { bg: "--panel" },
  "#ffffff": { bg: "--panel", fg: "--on-accent" },
  "#fff": { bg: "--panel", fg: "--on-accent" },

  // --- blue 强调 ---
  "#0070f3": { bg: "--accent", fg: "--accent", border: "--accent" },
  "#0060df": { bg: "--accent-strong", border: "--accent-strong" },
  "#2563eb": { bg: "--accent", fg: "--accent", border: "--accent" },
  "#3b82f6": { bg: "--accent", fg: "--accent", border: "--accent" },
  "#315f8d": { bg: "--accent", fg: "--accent", border: "--accent" },
  "#467cac": { bg: "--accent" },
  "#4aa3ff": { fg: "--accent" },
  "#60a5fa": { fg: "--accent" },
  "#93c5fd": { fg: "--accent" },
  "#eef6ff": { bg: "--accent-soft" },
  "#bfdbfe": { bg: "--accent-soft" },
  "#203044": { bg: "--accent-soft" },

  // --- 语义色 ---
  "#0a7b3e": { fg: "--green", bg: "--green", border: "--green" },
  "#22c55e": { bg: "--green-dot" },
  "#34d399": { bg: "--green-dot", fg: "--green" },
  "#4ade80": { fg: "--green", bg: "--green-dot" },
  "#86efac": { fg: "--green" },
  "#d41313": { fg: "--red", bg: "--red", border: "--red" },
  "#f87171": { fg: "--red" },
  "#fecaca": { fg: "--red", bg: "--red-soft" },
  "#fee2e2": { bg: "--red-soft" },
  "#b45309": { fg: "--amber", bg: "--amber", border: "--amber" },
  "#f59e0b": { fg: "--amber", bg: "--amber", border: "--amber" },
  "#fbbf24": { fg: "--amber", bg: "--amber", border: "--amber" },
  "#fcd34d": { fg: "--amber" },
  "#fde68a": { bg: "--amber-soft" },
  "#ffe19b": { bg: "--amber-soft" },
  "#ffe08a": { bg: "--amber-soft" },
  "#ffb84d": { bg: "--amber" },
  "#f5a623": { bg: "--amber" },
  "#fff7ed": { bg: "--amber-soft" },
};

/* ============================================================ */

const SKIP_FILES = new Set([
  "theme-modern.css",      // token 定义源，字面色在这里是「定义」不是「硬编码」
  "theme-modern-v2.css",
  "fonts.css",
  "styles.css",            // @import 清单
]);

const HEX_RE = /#[0-9a-fA-F]{3,8}\b/g;
const VAR_FALLBACK_RE = /var\(\s*--[a-zA-Z0-9-]+\s*,\s*(#[0-9a-fA-F]{3,8})\s*\)/g;
const RGBA_RE = /rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*(?:,\s*[\d.]+)?\s*\)/g;

// 属性识别：按 CSS 属性名归类到 bg / fg / border / shadow
const PROP_RE = /(background-color|background-image|background|border-top-color|border-bottom-color|border-left-color|border-right-color|border-color|border-top|border-bottom|border-left|border-right|border|outline-color|outline|box-shadow|text-shadow|fill|stroke|color)\s*:\s*([^;{}]*)/gi;

function classifyProp(prop) {
  const p = prop.toLowerCase();
  if (p === "color" || p === "fill" || p === "stroke" || p === "outline-color") return "fg";
  if (p.startsWith("background")) return "bg";
  if (p.startsWith("border") || p === "outline") return "border";
  if (p.includes("shadow")) return "shadow";
  return "bg";
}

function expandShortHex(hex) {
  if (hex.length === 4) return `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`;
  if (hex.length === 9) return hex.slice(0, 7);
  return hex;
}

function rgbToHex(r, g, b) {
  return `#${[r, g, b].map((v) => Number(v).toString(16).padStart(2, "0")).join("")}`;
}

/** 找出某行里某个 hex 所属的属性类别 */
function findPropKind(line, hexToken) {
  const target = hexToken.toLowerCase();
  let lastKind = null;
  for (const m of line.matchAll(PROP_RE)) {
    const val = m[2] ?? "";
    if (val.toLowerCase().includes(target)) {
      lastKind = classifyProp(m[1]);
    }
  }
  return lastKind ?? "bg";
}

const files = readdirSync(SRC).filter((f) => f.endsWith(".css") && !SKIP_FILES.has(f));

const hits = [];
const unknown = new Map();
let fallbackCount = 0;

for (const file of files) {
  const lines = readFileSync(join(SRC, file), "utf8").split("\n");
  lines.forEach((line, i) => {
    const trimmed = line.trim();
    if (trimmed.startsWith("*") || trimmed.startsWith("/*") || trimmed.startsWith("//")) return;

    // 保护 var() fallback，不把它们当硬编码也不替换
    let scanLine = line;
    for (const m of line.matchAll(VAR_FALLBACK_RE)) {
      fallbackCount += 1;
      scanLine = scanLine.replace(m[0], "__VAR__");
    }

    for (const m of scanLine.matchAll(HEX_RE)) {
      const hex = expandShortHex(m[0].toLowerCase());
      const vrc = VRC_SAGE[hex];
      const tw = TAILWIND[hex];
      const table = vrc ? VRC_SAGE : tw ? TAILWIND : null;
      if (!table) {
        unknown.set(hex, (unknown.get(hex) ?? 0) + 1);
        continue;
      }
      const kind = findPropKind(scanLine, m[0]);
      const token = table[hex][kind] ?? table[hex].bg ?? table[hex].fg ?? table[hex].border;
      if (!token) {
        unknown.set(hex, (unknown.get(hex) ?? 0) + 1);
        continue;
      }
      hits.push({
        file, line: i + 1, hex: m[0], norm: hex, kind, token,
        palette: vrc ? "VRC-sage" : "tailwind",
        rawKind: "hex",
        source: line.trim(),
      });
    }

    // rgba 里的三元组：只报告，不自动替换（透明度语义需人工判断）
    for (const m of scanLine.matchAll(RGBA_RE)) {
      const hex = rgbToHex(m[1], m[2], m[3]);
      const vrc = VRC_SAGE[hex];
      const tw = TAILWIND[hex];
      if (!vrc && !tw) continue;
      const table = vrc ? VRC_SAGE : TAILWIND;
      const kind = findPropKind(scanLine, hex);
      hits.push({
        file, line: i + 1, hex, norm: hex, kind, token: table[hex][kind] ?? table[hex].bg,
        palette: vrc ? "VRC-sage" : "tailwind",
        rawKind: "rgba",
        source: line.trim(),
      });
    }
  });
}

const args = process.argv.slice(2);
const asJson = args.includes("--json");
const apply = args.includes("--apply");
const onlyArg = args.find((a) => a.startsWith("--only="));
const onlyPalette = onlyArg ? onlyArg.split("=")[1] : null;

if (asJson) {
  console.log(JSON.stringify({ hits, unknown: Object.fromEntries(unknown) }, null, 2));
  process.exit(0);
}

/* ---------- 报告 ---------- */

const hexOnly = hits.filter((h) => h.rawKind === "hex");
const rgbaOnly = hits.filter((h) => h.rawKind === "rgba");
const byPalette = { "VRC-sage": [], tailwind: [] };
for (const h of hexOnly) (byPalette[h.palette] ??= []).push(h);

console.log("=".repeat(78));
console.log("色板审计：未走 token 的字面色（已按属性语义分类）");
console.log("=".repeat(78));
console.log(`扫描 apps/extension/src/*.css，排除 ${[...SKIP_FILES].join(", ")}`);
console.log(`可自动替换（裸 hex）：${hexOnly.length} 处   |   VRC-sage ${(byPalette["VRC-sage"] ?? []).length}  |  tailwind ${(byPalette.tailwind ?? []).length}`);
console.log(`需人工判断（rgba 半透明）：${rgbaOnly.length} 处`);
console.log(`var() fallback 兜底值（已走 token，不动）：${fallbackCount} 处`);
console.log(`未归类色：${unknown.size} 种`);
console.log("");

for (const palette of ["VRC-sage", "tailwind"]) {
  const list = byPalette[palette] ?? [];
  if (!list.length) continue;
  console.log("-".repeat(78));
  console.log(palette === "VRC-sage"
    ? "③ VRC sage/olive 色板（与本项目色温冲突，优先清理）"
    : "② Tailwind slate/blue 色板（与本项目 geist 灰重复，收敛到 token）");
  console.log("-".repeat(78));

  const byFile = new Map();
  for (const h of list) {
    if (!byFile.has(h.file)) byFile.set(h.file, []);
    byFile.get(h.file).push(h);
  }
  for (const [file, items] of [...byFile.entries()].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`\n${file}  (${items.length} 处)`);
    for (const h of items) {
      console.log(`  ${String(h.line).padStart(5)}  ${h.hex.padEnd(8)} [${h.kind}] → var(${h.token})`);
      console.log(`         ${h.source.slice(0, 96)}`);
    }
  }
  console.log("");
}

if (rgbaOnly.length) {
  console.log("-".repeat(78));
  console.log("rgba 半透明色（需人工决定透明度语义，脚本不自动改）");
  console.log("-".repeat(78));
  const byHex = new Map();
  for (const h of rgbaOnly) {
    const k = h.norm;
    if (!byHex.has(k)) byHex.set(k, []);
    byHex.get(k).push(h);
  }
  for (const [hex, items] of [...byHex.entries()].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`  ${hex}  ${items.length} 处   建议改 color-mix(in srgb, var(${items[0].token}) N%, transparent)`);
    for (const h of items.slice(0, 4)) {
      console.log(`      ${h.file}:${h.line}  ${h.source.slice(0, 84)}`);
    }
    if (items.length > 4) console.log(`      … 另 ${items.length - 4} 处`);
  }
  console.log("");
}

if (unknown.size) {
  console.log("-".repeat(78));
  console.log("未归类色（项目自有 / 一次性色，需人工确认）");
  console.log("-".repeat(78));
  for (const [hex, c] of [...unknown.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30)) {
    console.log(`  ${hex.padEnd(10)} × ${c}`);
  }
  console.log("");
}

/* ---------- 替换 ---------- */

if (apply) {
  console.log("=".repeat(78));
  console.log(`开始就地替换${onlyPalette ? `（仅 ${onlyPalette}）` : ""}`);
  console.log("=".repeat(78));

  const targets = hexOnly.filter((h) => !onlyPalette || h.palette === onlyPalette);

  // file → Map(小写hex → token)；同一文件里同一 hex 可能有不同属性语义，
  // 所以键用 "hex|kind"
  const perFile = new Map();
  for (const h of targets) {
    if (!perFile.has(h.file)) perFile.set(h.file, new Map());
    perFile.get(h.file).set(`${h.norm}|${h.kind}`, h.token);
  }

  let grandTotal = 0;
  for (const [file, map] of perFile) {
    const path = join(SRC, file);
    copyFileSync(path, `${path}.bak`);
    const lines = readFileSync(path, "utf8").split("\n");
    let count = 0;

    const out = lines.map((line) => {
      const trimmed = line.trim();
      if (trimmed.startsWith("*") || trimmed.startsWith("/*") || trimmed.startsWith("//")) return line;

      // 先把 var() fallback 藏起来
      const slots = [];
      let protectedLine = line.replace(VAR_FALLBACK_RE, (m) => {
        slots.push(m);
        return `__FB${slots.length - 1}__`;
      });

      const replacedLine = protectedLine.replace(HEX_RE, (m) => {
        const norm = expandShortHex(m.toLowerCase());
        const kind = findPropKind(protectedLine, m);
        const token = map.get(`${norm}|${kind}`) ?? map.get(`${norm}|bg`);
        if (!token) return m;
        count += 1;
        return `var(${token})`;
      });

      // 还原 fallback
      return replacedLine.replace(/__FB(\d+)__/g, (_, idx) => slots[Number(idx)]);
    });

    writeFileSync(path, out.join("\n"));
    grandTotal += count;
    console.log(`  ${file.padEnd(32)} ${String(count).padStart(4)} 处`);
  }
  console.log(`\n合计替换 ${grandTotal} 处。备份为 *.bak，回退：for f in apps/extension/src/*.bak; do mv "$f" "\${f%.bak}"; done`);
}
