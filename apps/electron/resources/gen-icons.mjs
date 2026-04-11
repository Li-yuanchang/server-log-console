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
const traySvg = readFileSync(RES + "tray-icon.svg");
// @2x = 44x44
await sharp(traySvg, { density: 72 * 4 })
  .resize(44, 44)
  .png()
  .toFile(RES + "trayTemplate@2x.png");
console.log("✓ trayTemplate@2x.png");
// @1x = 22x22
await sharp(traySvg, { density: 72 * 4 })
  .resize(22, 22)
  .png()
  .toFile(RES + "trayTemplate.png");
console.log("✓ trayTemplate.png");

console.log("\nDone! Now run: iconutil to generate .icns");
