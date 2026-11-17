#!/usr/bin/env node
/**
 * style-budget.mjs — 样式回归预算守门脚本
 *
 * 【为什么设预算】
 * 团队已经有一套靠人工 grep 维持的收敛纪律（见 docs/style-architecture.md §10/§11）：
 *   1) 字号必须走 --fs-* token（曾经全库 508 处硬编码 font-size、16 种取值，已人工收敛）；
 *   2) 颜色必须走 token，禁止裸色值（scripts/audit-color-tokens.mjs 是配套审计工具）；
 *   3) align-*.css 是迁移期「1:1 对齐补丁批次」，长期目标是折回主样式文件后清零；
 *   4) theme-modern-v2.css 的 --v2-* token 家族（--v2-radius-* / --v2-shadow-pop / --v2-mono）
 *      与既有 token 语义重复，属于「待合并家族」，收权后引用应归 0。
 * 人工纪律的问题在于：只有想起来的时候才查，新文件、新补丁会悄悄把旧债加回来。
 * 本脚本把这些纪律固化成「预算线」：先冻结当前基线，之后任何一项只许降不许升，
 * 涨了就是回归。默认只报告不拦截（先跑通基线、积累事实），加 --strict 才真正拦截。
 *
 * 【检查项与口径】
 *   ① align-*.css 文件数 / 总行数
 *      glob apps/extension/src/align-*.css；行数按 wc -l 口径（末尾换行不计）。
 *   ② 字面色总数（hex + rgb/rgba 字面值出现次数）
 *      文件集沿用 audit-color-tokens 的口径：排除 token 定义源文件
 *      （theme-modern.css / theme-modern-v2.css / fonts.css / styles.css，直接 import 其
 *      SKIP_FILES 保证两边永远同步）。
 *      行级排除（比 audit 工具更严，避免把「定义」误判成「用色」）：
 *        - 块注释（跨行 /* ... *\/，状态机感知）内的内容不计；
 *        - 自定义属性定义行（`  --xxx: value;`，即 token 定义行）整行不计：
 *          token 的取值来源不是「硬编码用色」，styles-base.css :root 的
 *          `--accent: #3b6b5a` 属于定义而非违规；
 *        - var() 兜底值不计：`var(--red, #d41313)` 是「引用 token + 保险丝」，
 *          沿用 audit 工具口径挡掉 hex 兜底；并且额外挡掉 rgba 兜底
 *          （audit 工具只挡 hex 兜底，`var(--ink, rgba(255,255,255,.94))` 里的
 *          rgba(255,255,255) 会被它的色板误判成「新增白色」，本脚本修正该误判，
 *          单独计数展示，不改 audit 工具行为）。
 *      统计对象是「出现次数」：每处 #hex、每处 rgb/rgba() 各计 1，按文件可出 top10。
 *   ③ 裸 font-size 声明数
 *      全部 *.css（含主题文件，theme 文件里的裸字号同样是违规）里
 *      `font-size: ...` 声明，取值不含 var(--fs- 的计数为裸。
 *      排除：注释；token 定义行（--fs-*、--log-font-size、--terminal-font-size 的
 *      定义处允许字面值 —— docs §10.3 的例外，它们是「值的来源」）。
 *      注意：docs §10.3 说「检查命令应返回空 / 残留应为 0」，实测并未归零
 *      （后续新增的 styles-empty-* / dialogs-transfer 等文件又带入了裸字号）。
 *      预算的意义正在于此：先让事实可见，再只许降不许升，一步步逼近 0。
 *      输出会附构成拆解（裸 px 值 / 其他变量引用 / inherit·0 等非长度值）。
 *   ④ --v2-* 重复 token 引用数
 *      所有 *.css 里 --v2-[a-z0-9-]* 的「引用」出现次数；theme-modern-v2.css 里的
 *      定义行（`--v2-radius-s: 6px;`）是定义不是引用，不计。
 *      这是待合并 token 家族：迁移到 --r-* / --mono / 统一阴影 token 后预算归 0。
 *
 * 【用法】
 *   node scripts/style-budget.mjs                    # 报告（默认，不拦截）
 *   node scripts/style-budget.mjs --strict           # 任一项超预算 → exit 1
 *   node scripts/style-budget.mjs --update-baseline  # 用当前实测值重写基线
 *                                                    # （baseline 与 budget 同步为当前值，
 *                                                    #  只应在「确实收敛了一批」后使用）
 *
 * 基线存放在 scripts/style-budget.json，带采集日期与每项 baseline/budget；
 * budget 原则：不高于当前基线（只许降不许升）。
 * 纯 node 实现、无第三方依赖；颜色统计核心复用 audit-color-tokens.mjs
 * 导出的 scanColorLiterals()（该工具已重构为可导出纯函数，CLI 行为不变）。
 */

import { readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { scanColorLiterals, SKIP_FILES } from "./audit-color-tokens.mjs";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = join(SCRIPT_DIR, "..");
const SRC = join(ROOT, "apps", "extension", "src");
const BASELINE_PATH = join(SCRIPT_DIR, "style-budget.json");

/* ============================================================
   正则与工具
   ============================================================ */

const HEX_RE = /#[0-9a-fA-F]{3,8}\b/g;
const RGB_RE = /rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(?:,\s*[\d.]+)?\s*\)/g;
// var(--token, #hex) 兜底 —— 与 audit-color-tokens 完全同款
const VAR_FALLBACK_HEX_RE = /var\(\s*--[a-zA-Z0-9-]+\s*,\s*#[0-9a-fA-F]{3,8}\s*\)/g;
// var(--token, rgba(r,g,b,a)) 兜底 —— audit 工具未覆盖的误判源，这里补上
const VAR_FALLBACK_RGBA_RE = /var\(\s*--[a-zA-Z0-9-]+\s*,\s*rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(?:,\s*[\d.]+)?\s*\)\s*\)/g;
// 自定义属性（token）定义行：值是 token 的取值来源，不算「用色」。
// 代码库约定一行只写一条声明，故整行排除是安全的（theme 文件里的多定义行
// 本来就在 SKIP_FILES 里）。
const CUSTOM_PROP_DEF_RE = /^\s*--[a-zA-Z0-9-]+\s*:/;
// font-size 声明：属性名前面不能是 - 或字母，避免命中 --log-font-size 的尾部
const FONT_SIZE_RE = /(?<![-\w])font-size\s*:\s*([^;{}]+)/g;
const V2_NAME_RE = /--v2-[a-zA-Z0-9-]+/g;

/** 按终端显示宽度补空格（中文按 2 列算），保证表格大致对齐 */
function padDisplay(str, width) {
  const w = displayWidth(str);
  return str + " ".repeat(Math.max(0, width - w));
}

function displayWidth(str) {
  let w = 0;
  for (const ch of str) {
    const c = ch.codePointAt(0);
    w += (c >= 0x1100 && c <= 0x115f) || (c >= 0x2e80 && c <= 0xa4cf) ||
         (c >= 0xac00 && c <= 0xd7a3) || (c >= 0xf900 && c <= 0xfaff) ||
         (c >= 0xfe30 && c <= 0xfe4f) || (c >= 0xff00 && c <= 0xff60) ||
         (c >= 0xffe0 && c <= 0xffe6) ? 2 : 1;
  }
  return w;
}

/**
 * 去掉一行里的块注释内容（跨行 /* ... *\/ 用 state.inBlock 跨行跟踪）。
 * 返回该行的「代码部分」。相比 audit 工具只跳过以注释符开头的行，
 * 这里能正确处理「注释包住整段旧规则」的情况，不会把注释里的旧色值算进预算。
 */
function stripBlockComments(line, state) {
  let out = "";
  let rest = line;
  while (rest.length) {
    if (state.inBlock) {
      const end = rest.indexOf("*/");
      if (end === -1) { rest = ""; break; }
      state.inBlock = false;
      rest = rest.slice(end + 2);
      continue;
    }
    const start = rest.indexOf("/*");
    if (start === -1) { out += rest; break; }
    out += rest.slice(0, start);
    state.inBlock = true;
    rest = rest.slice(start + 2);
  }
  return out;
}

/** 所有 CSS 文件名（排序，保证基线 JSON 里 perFile 顺序稳定） */
function listAllCss() {
  return readdirSync(SRC).filter((f) => f.endsWith(".css")).sort();
}

/* ============================================================
   指标采集
   ============================================================ */

/** ① align-*.css：文件数 + 行数（wc -l 口径：末尾换行不计） */
function collectAlign() {
  const files = listAllCss().filter((f) => /^align-.*\.css$/.test(f));
  const perFile = {};
  let total = 0;
  for (const f of files) {
    const content = readFileSync(join(SRC, f), "utf8");
    const n = content.split("\n").length - (content.endsWith("\n") ? 1 : 0);
    perFile[f] = n;
    total += n;
  }
  return { count: files.length, perFile, total };
}

/**
 * ② 字面色总数：hex + rgb/rgba 字面值出现次数。
 * 口径见文件头注释：排除 token 定义源文件、注释、token 定义行、var() 兜底值。
 */
function collectLiteralColors() {
  const files = listAllCss().filter((f) => !SKIP_FILES.has(f));
  const perFile = {};
  let total = 0, hexTotal = 0, rgbaTotal = 0, hexFallback = 0, rgbaFallback = 0;
  for (const f of files) {
    const state = { inBlock: false };
    const lines = readFileSync(join(SRC, f), "utf8").split("\n");
    lines.forEach((raw) => {
      let code = stripBlockComments(raw, state);
      if (!code.trim()) return;
      if (CUSTOM_PROP_DEF_RE.test(code)) return; // token 定义行：--xxx: ...;
      // 先挡 var() 兜底值（hex 与 rgba 两种形式），避免把「引用 token + 保险丝」算成新增字面色
      code = code.replace(VAR_FALLBACK_HEX_RE, () => { hexFallback += 1; return "__FBH__"; });
      code = code.replace(VAR_FALLBACK_RGBA_RE, () => { rgbaFallback += 1; return "__FBR__"; });
      const hexes = code.match(HEX_RE) ?? [];
      const rgbs = code.match(RGB_RE) ?? [];
      hexTotal += hexes.length;
      rgbaTotal += rgbs.length;
      const n = hexes.length + rgbs.length;
      if (n) {
        perFile[f] = (perFile[f] ?? 0) + n;
        total += n;
      }
    });
  }
  return { total, perFile, hexTotal, rgbaTotal, hexFallback, rgbaFallback };
}

/** ③ 裸 font-size：取值不含 var(--fs- 的声明数，附构成拆解 */
function collectBareFontSize() {
  const files = listAllCss();
  const perFile = {};
  const buckets = { pxLiteral: [], varRef: [], nonLength: [] };
  let total = 0;
  for (const f of files) {
    const state = { inBlock: false };
    const lines = readFileSync(join(SRC, f), "utf8").split("\n");
    lines.forEach((raw, idx) => {
      const code = stripBlockComments(raw, state);
      if (!code.trim()) return;
      if (CUSTOM_PROP_DEF_RE.test(code)) return; // token 定义行（含 --fs-* / --log-font-size / --terminal-font-size 取值来源）
      for (const m of code.matchAll(FONT_SIZE_RE)) {
        const value = m[1].trim();
        if (/var\(\s*--fs-/.test(value)) continue; // 已走字号 token
        total += 1;
        perFile[f] = (perFile[f] ?? 0) + 1;
        const pos = `${f}:${idx + 1} font-size: ${value}`;
        const bare = value.replace(/!important\s*$/i, "").trim();
        if (/var\(/.test(value)) buckets.varRef.push(pos);          // 引用其它变量（目前只有 --log/--terminal-font-size）
        else if (/^-?\d+(\.\d+)?(px|rem|em|%)$/.test(bare)) buckets.pxLiteral.push(pos); // 纯 px 字面值，真正的「裸字号」
        else buckets.nonLength.push(pos);                            // inherit / 0 等非长度值
      }
    });
  }
  return { total, perFile, buckets };
}

/** ④ --v2-* 重复 token 引用数：引用计 1，定义行 LHS 不计（定义数单独记录） */
function collectV2Refs() {
  const files = listAllCss();
  const perFile = {};
  const defs = {};
  let total = 0, defTotal = 0;
  for (const f of files) {
    const state = { inBlock: false };
    const lines = readFileSync(join(SRC, f), "utf8").split("\n");
    lines.forEach((raw) => {
      const code = stripBlockComments(raw, state);
      if (!code.trim()) return;
      const defMatch = code.match(/^\s*(--[a-zA-Z0-9-]+)\s*:/);
      const defName = defMatch ? defMatch[1] : null;
      for (const m of code.matchAll(V2_NAME_RE)) {
        const isDefinition =
          defName !== null && defName.startsWith("--v2-") && m.index === code.indexOf(defName);
        if (isDefinition) {
          defs[f] = (defs[f] ?? 0) + 1;
          defTotal += 1;
          continue;
        }
        perFile[f] = (perFile[f] ?? 0) + 1;
        total += 1;
      }
    });
  }
  return { total, perFile, defs, defTotal };
}

/* ============================================================
   基线读写
   ============================================================ */

/**
 * 组装当前实测值（--update-baseline 与正常报告共用，保证口径一致）。
 * 另：audit-color-tokens 的扫描核心（scanColorLiterals）在 main() 的
 * 「参照」一节里调用，输出色板可替换数 / rgba 半透明 / 未归类色，
 * 方便和原工具的数字对账。
 */
function measure() {
  const align = collectAlign();
  const colors = collectLiteralColors();
  const font = collectBareFontSize();
  const v2 = collectV2Refs();
  return { align, colors, font, v2 };
}

function buildBaseline(m) {
  // 用本地时区日期（ISO 串是 UTC，会差一天）
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  return {
    collectedAt: today,
    generator: "node scripts/style-budget.mjs --update-baseline",
    sourceDir: "apps/extension/src",
    notes: [
      "预算原则：任一指标 current 不得超过 budget；budget 不高于 baseline（只许降不许升）。",
      "align-* 是迁移期 1:1 对齐补丁批次，长期目标是折回主样式文件后清零（target 0）。",
      "字面色口径 = CSS 规则体里非 token 定义行的 hex/rgb(a) 字面值；排除注释、",
      "自定义属性定义行、var() 兜底值（hex 与 rgba），文件集与 audit-color-tokens 的 SKIP_FILES 同步。",
      "裸 font-size：docs §10.3 团队口径应为 0，采集日实测尚有存量（后续新文件带回），只许降。",
      "--v2-* 是待合并 token 家族（--v2-radius-* / --v2-shadow-pop / --v2-mono），迁移后预算归 0。",
    ],
    metrics: {
      alignFiles: {
        label: "align-*.css 文件数",
        baseline: m.align.count,
        budget: m.align.count,
        target: 0,
        perFile: m.align.perFile,
      },
      alignLines: {
        label: "align-*.css 总行数",
        baseline: m.align.total,
        budget: m.align.total,
        target: 0,
        perFile: m.align.perFile,
      },
      literalColors: {
        label: "字面色总数（hex+rgb/rgba）",
        baseline: m.colors.total,
        budget: m.colors.total,
        perFile: m.colors.perFile,
      },
      bareFontSize: {
        label: "裸 font-size 声明数",
        baseline: m.font.total,
        budget: m.font.total,
        target: 0,
        pxLiteral: m.font.buckets.pxLiteral.length,
        perFile: m.font.perFile,
      },
      v2TokenRefs: {
        label: "--v2-* 重复 token 引用数",
        baseline: m.v2.total,
        budget: m.v2.total,
        target: 0,
        definitions: m.v2.defTotal,
        perFile: m.v2.perFile,
      },
    },
  };
}

function loadBaseline() {
  if (!existsSync(BASELINE_PATH)) {
    console.error(`缺少基线文件 ${BASELINE_PATH}`);
    console.error("请先运行：node scripts/style-budget.mjs --update-baseline");
    process.exit(1);
  }
  return JSON.parse(readFileSync(BASELINE_PATH, "utf8"));
}

/* ============================================================
   报告与主流程
   ============================================================ */

function renderTable(rows) {
  console.log("");
  console.log("  指标                            当前    基线    预算   状态");
  console.log("  " + "-".repeat(58));
  for (const r of rows) {
    const status = r.over ? "超预算" : (r.delta < 0 ? `正常(较基线${r.delta})` : "正常");
    console.log(
      `  ${padDisplay(r.label, 30)} ${String(r.current).padStart(6)} ${String(r.baseline).padStart(6)} ${String(r.budget).padStart(6)}   ${status}`
    );
  }
  console.log("  " + "-".repeat(58));
}

function topEntries(perFile, n) {
  return Object.entries(perFile).sort((a, b) => b[1] - a[1]).slice(0, n);
}

function main() {
  const args = process.argv.slice(2);
  const strict = args.includes("--strict");
  const update = args.includes("--update-baseline");

  const m = measure();

  if (update) {
    const baseline = buildBaseline(m);
    writeFileSync(BASELINE_PATH, JSON.stringify(baseline, null, 2) + "\n");
    console.log(`基线已写入 ${BASELINE_PATH}（采集日期 ${baseline.collectedAt}）`);
    console.log("budget = 当前实测值。只应在确实完成一批收敛、要把预算线往下压时使用。");
    return;
  }

  const baseline = loadBaseline();
  const M = baseline.metrics;
  const current = {
    alignFiles: m.align.count,
    alignLines: m.align.total,
    literalColors: m.colors.total,
    bareFontSize: m.font.total,
    v2TokenRefs: m.v2.total,
  };

  const rows = [];
  const over = [];
  for (const key of Object.keys(current)) {
    const meta = M[key];
    if (!meta) {
      console.error(`基线里缺少指标 ${key}，请重新生成基线：node scripts/style-budget.mjs --update-baseline`);
      process.exit(1);
    }
    const c = current[key];
    const row = {
      label: meta.label,
      current: c,
      baseline: meta.baseline,
      budget: meta.budget,
      delta: c - meta.baseline,
      over: c > meta.budget,
    };
    rows.push(row);
    if (row.over) over.push(row);
  }

  console.log("=".repeat(64));
  console.log(" 样式回归预算守门（style-budget）");
  console.log(` 基线采集日期：${baseline.collectedAt}    扫描目录：${baseline.sourceDir}/*.css`);
  console.log(` 运行模式：${strict ? "--strict（超预算将 exit 1）" : "报告（不拦截）"}`);
  console.log(" 预算原则：不高于基线，只许降不许升；收敛后用 --update-baseline 重新固化");
  console.log("=".repeat(64));

  renderTable(rows);

  /* ---------- 明细 ---------- */

  console.log("");
  console.log("—— 明细 · align 文件行数（预算目标 0：折回主样式后删除补丁文件）——");
  for (const [f, n] of Object.entries(m.align.perFile).sort((a, b) => b[1] - a[1])) {
    const base = M.alignLines.perFile[f];
    const diff = base !== undefined && n !== base ? `（基线 ${base}，${n > base ? "+" : ""}${n - base}）` : "";
    console.log(`    ${padDisplay(f, 30)} ${String(n).padStart(5)}  ${diff}`);
  }

  console.log("");
  console.log("—— 明细 · 字面色 top10 文件（hex+rgb/rgba 出现次数）——");
  for (const [f, n] of topEntries(m.colors.perFile, 10)) {
    const base = M.literalColors.perFile[f];
    const diff = base !== undefined && n !== base ? `（基线 ${base}，${n > base ? "+" : ""}${n - base}）` : "";
    console.log(`    ${padDisplay(f, 30)} ${String(n).padStart(5)}  ${diff}`);
  }

  const b = m.font.buckets;
  console.log("");
  console.log(`—— 明细 · 裸 font-size 构成（总计 ${m.font.total}）——`);
  console.log(`    纯 px 字面值          ${String(b.pxLiteral.length).padStart(5)}   ← 真正要清零的部分`);
  console.log(`    其它变量引用          ${String(b.varRef.length).padStart(5)}   ← 如 var(--log-font-size)，属于可配置来源`);
  console.log(`    非长度值(inherit/0等) ${String(b.nonLength.length).padStart(5)}`);
  for (const [f, n] of topEntries(m.font.perFile, 5)) {
    console.log(`    ${padDisplay(f, 30)} ${String(n).padStart(5)}`);
  }

  console.log("");
  console.log(`—— 明细 · --v2-* 重复 token 引用（定义 ${m.v2.defTotal} 处不计，迁移后目标 0）——`);
  for (const [f, n] of Object.entries(m.v2.perFile).sort((a, b2) => b2[1] - a[1])) {
    const defNote = m.v2.defs[f] ? `（含定义 ${m.v2.defs[f]} 处未计）` : "";
    console.log(`    ${padDisplay(f, 30)} ${String(n).padStart(5)}  ${defNote}`);
  }

  /* ---------- 参照：audit-color-tokens 口径对账（信息展示，不计预算） ---------- */
  const audit = scanColorLiterals(SRC);
  const hexHits = audit.hits.filter((h) => h.rawKind === "hex").length;
  const rgbaHits = audit.hits.filter((h) => h.rawKind === "rgba").length;
  const unknownOccurrences = [...audit.unknown.values()].reduce((s, n) => s + n, 0);
  console.log("");
  console.log("—— 参照 · audit-color-tokens 口径（信息展示，不计预算）——");
  console.log(`    色板可自动替换 hex   ${String(hexHits).padStart(5)}   （工具可给 token 替换建议）`);
  console.log(`    rgba 半透明（色板内）${String(rgbaHits).padStart(5)}`);
  console.log(`    未归类 hex 字面色    ${String(unknownOccurrences).padStart(5)}   （${audit.unknown.size} 种色值，工具只计数不给建议）`);
  console.log(`    var() hex 兜底值     ${String(m.colors.hexFallback).padStart(5)}   （audit 工具口径：已走 token 不动）`);
  console.log(`    var() rgba 兜底值    ${String(m.colors.rgbaFallback).padStart(5)}   （audit 工具会误判成色板白，本脚本已排除）`);
  console.log("");

  if (over.length) {
    console.log("!! 以下指标超过预算线：");
    for (const r of over) {
      console.log(`   ${r.label}: 当前 ${r.current} > 预算 ${r.budget}（基线 ${r.baseline}）`);
    }
    if (strict) {
      console.log("--strict 模式：判定为样式回归，拦截。");
      process.exit(1);
    }
    console.log("当前为报告模式不拦截；请收敛后再提交，或说明预算变更理由。");
  } else if (rows.some((r) => r.delta < 0)) {
    console.log("有指标较基线下降：确认收敛稳定后可运行 --update-baseline 把预算线同步压低。");
  }
}

main();
