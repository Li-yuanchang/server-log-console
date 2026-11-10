#!/usr/bin/env node
// Generate all icon PNGs from SVG sources using sharp
import { readFileSync } from "fs";
import { execSync } from "child_process";

// Dynamic import sharp from npx cache
const sharp = (await import("sharp")).default;

const RES = new URL(".", import.meta.url).pathname;
const ICONS = RES + "icons/";

// --- App icon (full square, no transparency) ---
const appSvg = readFileSync(RES + "icon.svg");
for (const size of [1024, 512, 256, 128, 64, 48, 32, 16]) {
  await sharp(appSvg, { density: Math.round((72 * size) / 1024) * 4 })
    .resize(size, size)
    .png()
    .toFile(ICONS + `icon-${size}.png`);
  console.log(`✓ icon-${size}.png`);
}

// --- Tray icon (transparent background, black only) ---
/* 2026-11-09 定版：自绘正方形剪影（外框 + 提示符），单一真源 = tray-icon.svg。
   生成请用独立脚本 scripts/gen-tray-icon.mjs —— 它走 rsvg-convert 输出硬边，
   比 sharp 的 resize 重采样更适合 22pt 小图标（笔画不糊）。
   本文件跳过托盘图标渲染，避免两套生成逻辑产出不一致的 PNG。

   沿革：手绘「三横条」版在 18px 下形状空、被研判「简陋生硬」；中途试过
   SF Symbol "terminal"，但宽高比 4:3 在菜单栏里偏宽；最终定版自绘 1:1 剪影。
   详见 scripts/gen-tray-icon.mjs 顶部设计说明。 */
console.log("⏭  trayTemplate*.png 由 scripts/gen-tray-icon.mjs 生成，此处跳过");

console.log("\nDone! Now run: iconutil to generate .icns");
