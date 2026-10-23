/**
 * 打包前清理旧的 Windows 产物（对齐 vrc 的 clean-electron-windows-output.mjs）。
 * 背景：electron-builder 的 win 输出（win-unpacked / latest.yml / *.exe / *-win.zip）
 * 会与 mac 产物留在同一 dist 目录。若上一次 win 构建失败或版本已变，
 * 残留文件会被后续 release:update 当成当前版本产物误收，故每次 win 打包前先清干净。
 */
const fs = require("fs");
const path = require("path");

const OUTPUT_DIR = path.join(__dirname, "dist");
const WIN_ARTIFACT_PATTERN = /^(?:win-unpacked|win-ia32-unpacked|win-arm64-unpacked|latest\.yml)$/i;
// 产物名形如 SLC-0.3.293-win-x64-setup.exe / SLC-0.3.293-win-x64.zip
const WIN_FILE_PATTERN = /^(?:SLC|ServerLogConsole)[- ].*(?:win|setup|portable).*\.(?:exe|zip)(?:\.blockmap)?$/i;

if (!fs.existsSync(OUTPUT_DIR)) {
  console.log("[clean-win-output] dist 目录不存在，跳过");
  return;
}

let removed = 0;
for (const entry of fs.readdirSync(OUTPUT_DIR)) {
  if (!WIN_ARTIFACT_PATTERN.test(entry) && !WIN_FILE_PATTERN.test(entry)) continue;
  fs.rmSync(path.join(OUTPUT_DIR, entry), { recursive: true, force: true });
  console.log(`[clean-win-output] removed ${entry}`);
  removed += 1;
}
console.log(`[clean-win-output] done (${removed} entries)`);
