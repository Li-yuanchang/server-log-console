// 生成 macOS 菜单栏托盘图标（正方形终端提示符）
//
// 用法：node scripts/gen-tray-icon.mjs
// 输入：apps/electron/resources/tray-icon.svg（单一真源）
// 输出：apps/electron/resources/trayTemplate.png     (18x18, 1x)
//       apps/electron/resources/trayTemplate@2x.png  (36x36, 2x)
//
// 设计沿革（2026-11-09）：
//   1. 原图标为手绘「三横条 + 折角」，18px 下笔画 12px 但形状空（密度仅 43.7%），
//      视觉评审判定「简陋、生硬」。
//   2. 中途改用 macOS 原生 SF Symbol "terminal"，虽合规但与系统 Terminal 同款、
//      且该符号宽高比 1.33（4:3），在菜单栏里明显过宽（用户反馈「尺寸不对」）。
//   3. 定版改为自绘正方形剪影：外框 15.2×15.2（1:1，与 Warp/VRC 邻居一致），
//      内部 > 与 _ 用 2.1 笔画保证 18px 下不糊。
//
// 关键约束：
//   · Template Image —— 必须纯黑 + 透明 alpha（main.cjs 调 setTemplateImage(true)），
//     禁止彩色；禁止用 opacity 表达层次（半透明会被系统当成灰色，着色后发虚）。
//   · 尺寸 —— 画布 22pt（@2x 44px），视觉主体 16-18pt，四周留 2-3pt 呼吸。
//     视觉主体取 1:1 正方形，不取 SF Symbol 的 4:3，否则同高下会明显偏宽、
//     挤压其他菜单栏项。
//   · 光学补偿 —— 带外框的封闭图形视觉重量高于无框剪影；
//     外框边长取画布的 ~69%（15.2/22），与 Warp 等的开敞剪影观感相当。

import { fileURLToPath } from "url";
import { execFileSync } from "child_process";
import path from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RES = path.join(__dirname, "..", "apps", "electron", "resources");
const svgPath = path.join(RES, "tray-icon.svg");

// 用 rsvg-convert（librsvg）渲染：它支持完整的 SVG 特性且输出硬边，
// 比 sharp 更适合图标（sharp 的 resize 会做重采样，小尺寸下笔画易糊）。
// 安装：brew install librsvg
/* ⚠️ 画布必须是 22pt(@2x 44px) —— 这是 macOS 菜单栏图标的标准画布。
   此前误写成 18/36，导致同样的 SVG 被压缩进更小画布，
   视觉主体只有 12pt，比同排 Warp(16.5pt)/VRC(16pt) 明显偏小。
   macOS 菜单栏图标规范：画布 22pt，视觉主体 16-18pt，四周留 2-3pt 呼吸。 */
const targets = [
  [22, "trayTemplate.png"],    // 1x = 22pt
  [44, "trayTemplate@2x.png"], // 2x = 44px
];

for (const [size, name] of targets) {
  const out = path.join(RES, name);
  try {
    execFileSync("rsvg-convert", ["-w", String(size), "-h", String(size), svgPath, "-o", out]);
    console.log(`✓ ${name}  ${size}×${size}`);
  } catch (err) {
    console.error(`渲染 ${name} 失败：${err.message}`);
    console.error("请先安装 librsvg：brew install librsvg");
    process.exit(1);
  }
}
