/**
 * 打包前准备：从根 CHANGELOG.md 顶部条目生成用户可读的 release-notes.md。
 * 该文件经 build.releaseInfo.releaseNotesFile 写入 latest-mac.yml 的 releaseNotes，
 * 并随 asar 分发（主进程在「已是最新」状态兜底展示）。
 * 转换规则：仅保留 新增/修复 小节（验证等内部信息不对外）；"- **标题** — 描述" 转 "- 标题：描述"。
 */
const fs = require("fs");
const path = require("path");

const CHANGELOG = path.resolve(__dirname, "..", "..", "CHANGELOG.md");
const OUTPUT = path.join(__dirname, "release-notes.md");

const content = fs.readFileSync(CHANGELOG, "utf8");
const lines = content.split(/\r?\n/);

// 定位顶部版本节（## [x.y.z] ...）的起止
const headIndex = lines.findIndex((line) => /^## \[\d+\.\d+\.\d+\]/.test(line));
if (headIndex === -1) throw new Error("CHANGELOG.md 未找到版本条目（## [x.y.z]）");
let endIndex = lines.length;
for (let i = headIndex + 1; i < lines.length; i++) {
  if (/^## \[\d+\.\d+\.\d+\]/.test(lines[i])) { endIndex = i; break; }
}

const out = [];
let currentSection = null; // "新增" | "修复" | 其他（跳过）
let introDone = false;
for (let i = headIndex + 1; i < endIndex; i++) {
  const line = lines[i].trim();
  if (!line || line.startsWith("更新时间：")) continue;
  const section = line.match(/^###\s*(.+)$/);
  if (section) {
    const name = section[1].trim();
    currentSection = name === "新增" || name === "修复" ? name : null;
    if (currentSection) out.push("", `${currentSection}:`);
    continue;
  }
  if (line.startsWith("## ")) continue;
  if (!currentSection) {
    // 小节之前的首段：版本标题行（只取第一段）
    if (!introDone) { out.push(line.replace(/\*\*/g, "")); introDone = true; }
    continue;
  }
  if (/^[-*]\s+/.test(line)) {
    out.push("- " + line.replace(/^[-*]\s+/, "").replace(/\*\*/g, "").replace(/\s+—\s+/g, "："));
  }
}

fs.writeFileSync(OUTPUT, `${out.join("\n").trim()}\n`, "utf8");
console.log(`[prepare-release-notes] release-notes.md <- CHANGELOG ${/^\[(.+?)\]/.exec(lines[headIndex] ?? "")?.[1] ?? ""}（${out.length} 行）`);
