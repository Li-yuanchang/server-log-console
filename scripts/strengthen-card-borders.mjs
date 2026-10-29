#!/usr/bin/env node
/**
 * strengthen-card-borders.mjs — 把「卡片/容器」的边框从 --line 提到 --line-strong。
 *
 * 【为什么】
 * sage / sand / basalt 等主题下 --line(#d9ded0) 对 --panel(#fbfbf7) 只有 1.32:1，
 * 而 --line-strong(#b8c2ae) 是 1.78:1，肉眼可辨。
 * VRC 用的也是 1.32:1，但它右侧是密集表格（几十条线交织），累积出结构感；
 * SLC 是稀疏几块卡片，一条孤立的 1.32:1 细线在空旷浅底上几乎看不见 ——
 * 这就是「看着糊成一片」的直接原因。
 *
 * 【改哪些】
 * 只改「卡片级」容器的 border / border-color：
 *   · 有 border-radius（是卡片而非分隔线）
 *   · 类名属于卡片族（见 CARD_HINT）
 * 不改：
 *   · 结构性分隔线（.sidebar-panel 的 border-right、表格行分隔、panel 之间的 border-bottom）
 *   · 输入框（focus 态已有 ring，加深会抢焦点）
 *   · 任何 border-top / border-bottom 单独声明的行分隔线
 *
 * 用法：
 *   node scripts/strengthen-card-borders.mjs --dry
 *   node scripts/strengthen-card-borders.mjs
 */

import { readFileSync, writeFileSync, readdirSync, copyFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "apps", "extension", "src");

// 卡片族类名特征（命中其一即视为「卡片容器」）
const CARD_HINT = /(card|panel|tile|dialog|drawer|popover|dropdown|steps|thumb|block)\b/i;

// 这些是「结构性分隔」或「输入控件」，即便命中 CARD_HINT 也不动
const SKIP_SELECTOR = /(:focus|:hover|:active|input|textarea|select|:checked|disabled|sidebar-panel|table|th\b|td\b|tr\b|row|-line-|divider|separator|scrollbar|resize-handle)/i;

// 只匹配「全边框」或「border-color」，不匹配单边（border-top/bottom/left/right）
const BORDER_RE = /(\n\s*)(border(-color)?)(\s*:\s*)(1px solid )?var\(--line\)/g;

const files = readdirSync(SRC).filter((f) => f.endsWith(".css") && f !== "theme-modern.css" && f !== "theme-modern-v2.css");
const dry = process.argv.includes("--dry");

let total = 0;
const report = [];

for (const file of files) {
  const path = join(SRC, file);
  const text = readFileSync(path, "utf8");
  const lines = text.split("\n");

  // 逐块解析：找到 selector { ... } 块，判断是否卡片
  let changed = 0;
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    out.push(line);

    // 检测 selector 起始（行尾有 {）
    if (line.includes("{") && !line.trim().startsWith("/*")) {
      const selector = line.slice(0, line.indexOf("{")).trim();
      const isCard = CARD_HINT.test(selector) && !SKIP_SELECTOR.test(selector);

      if (isCard) {
        // 读取整个块体
        let depth = 1;
        i += 1;
        while (i < lines.length && depth > 0) {
          const body = lines[i];
          if (body.includes("{")) depth += 1;
          if (body.includes("}")) depth -= 1;

          if (depth > 0) {
            // 只改「全边框」：属性名必须是 border 或 border-color
            const m = body.match(/^(\s*)(border|border-color)(\s*:\s*)(.*var\(--line\).*)$/);
            if (m) {
              const newLine = body.replace(/var\(--line\)/, "var(--line-strong)");
              if (newLine !== body) {
                changed += 1;
                if (changed <= 2) report.push({ file, selector: selector.slice(0, 50), from: body.trim(), to: newLine.trim() });
                out.push(newLine);
                i += 1;
                continue;
              }
            }
          }
          out.push(body);
          i += 1;
        }
        continue;
      }
    }
    i += 1;
  }

  if (changed > 0) {
    total += changed;
    if (!dry) {
      copyFileSync(path, `${path}.bak`);
      writeFileSync(path, out.join("\n"));
    }
    report.push({ file, count: changed, samples: report.filter((r) => r.file === file).slice(0, 2) });
  }
}

// 汇总输出
const byFile = new Map();
for (const r of report) {
  if (!r.count) continue;
  if (!byFile.has(r.file)) byFile.set(r.file, []);
  byFile.get(r.file).push(r);
}

console.log("=".repeat(72));
console.log(dry ? "卡片边框加深（试运行，未写入）" : "卡片边框加深（已写入，备份 .bak）");
console.log("=".repeat(72));
console.log(`共 ${total} 处 border/border-color 从 --line 提到 --line-strong\n`);

for (const [f, items] of byFile) {
  const cnt = items.find((x) => x.count)?.count ?? items.length;
  console.log(`  ${f.padEnd(32)} ${String(cnt).padStart(3)} 处`);
  for (const s of items) {
    if (!s.from) continue;
    console.log(`      ${s.selector}`);
    console.log(`        - ${s.from}`);
    console.log(`        + ${s.to}`);
  }
}

const untouched = files.length - byFile.size;
console.log(`\n未改动文件 ${untouched} 个（无卡片边框或无 --line 用法）`);
