#!/usr/bin/env node
/**
 * [release:update] 在线更新发布流水线（docs/在线更新与打包方案.md §4.4）
 *
 * 流程：
 *   1. 读权威版本 apps/electron/package.json（predist 时已由 bump-version.cjs +1 patch）
 *   2. 一致性校验：CHANGELOG.md 顶部条目 / apps/extension/dist/manifest.json
 *   3. 收集 electron-builder 桌面产物 → release/online-update-<ver>/desktop-updates/
 *   4. 打 slc-web-<ver>.tar.gz（gateway/dist + extension/dist）
 *   5. 打 Chrome 扩展 zip（无系统 zip 时降级 tar.gz）
 *   6. 生成 manifest.json（版本/渠道/说明/文件索引）
 *   7. 生成全目录 SHA256SUMS
 *   8. 打印上传指引（包体先传，清单最后传）
 *
 * 用法：
 *   node scripts/prepare-online-update-release.mjs [--dry-run]
 *   npm run release:update [-- --dry-run]
 *
 * Node >= 18，无第三方依赖。
 */
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  access,
  copyFile,
  cp,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { execFile } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PREFIX = "[release:update]";
const DRY_RUN = process.argv.includes("--dry-run");

const ELECTRON_DIR = path.join(ROOT_DIR, "apps", "electron");
const ELECTRON_DIST = path.join(ELECTRON_DIR, "dist");
const EXTENSION_DIST = path.join(ROOT_DIR, "apps", "extension", "dist");
const GATEWAY_DIST = path.join(ROOT_DIR, "apps", "gateway", "dist");

const log = (msg) => console.log(`${PREFIX} ${msg}`);
const warn = (msg) => console.warn(`${PREFIX} WARN ${msg}`);
const fail = (msg) => console.error(`${PREFIX} ERROR ${msg}`);
const die = (msg) => {
  fail(msg);
  process.exit(1);
};

async function pathExists(p) {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

async function readJson(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

function globToRegExp(pattern) {
  const source = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*");
  return new RegExp(`^${source}$`);
}

function parseSemver(value) {
  const m = String(value).trim().match(/^(\d+)\.(\d+)\.(\d+)/);
  return m ? { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]) } : null;
}

function describeDrift(from, to) {
  const a = parseSemver(from);
  const b = parseSemver(to);
  if (a && b && a.major === b.major && a.minor === b.minor && b.patch > a.patch) {
    return `落后 ${b.patch - a.patch} 个 patch`;
  }
  return "版本不一致";
}

/** 解析 CHANGELOG.md 顶部 `## [x.y.z] — 日期` 条目（返回 version/date/正文） */
async function readChangelogTopEntry() {
  const file = path.join(ROOT_DIR, "CHANGELOG.md");
  const text = await readFile(file, "utf8");
  const lines = text.split(/\r?\n/);
  const headingRe = /^##\s+\[(\d+\.\d+\.\d+)\]\s*(?:[—–-]+\s*(\d{4}-\d{2}-\d{2}))?/;
  const idx = lines.findIndex((line) => headingRe.test(line));
  if (idx === -1) return null;
  const match = lines[idx].match(headingRe);
  const notes = [];
  for (let i = idx + 1; i < lines.length; i += 1) {
    if (/^##\s+\[\d+\.\d+\.\d+\]/.test(lines[i])) break;
    notes.push(lines[i]);
  }
  return { version: match[1], date: match[2] ?? null, notes: notes.join("\n").trim() };
}

/**
 * 各平台产物组。安装包模式按 权威版本 过滤，
 * 避免 dist 里历史版本的残留产物（dmg/zip 等）被误收进本次发布。
 */
function buildPlatformGroups(version, productName) {
  return [
    {
      id: "mac",
      label: "macOS",
      manifest: "latest-mac.yml",
      buildHint: "npm --prefix apps/electron run dist:mac",
      patterns: [
        `${productName}-${version}-*.dmg`,
        `${productName}-${version}-*.dmg.blockmap`,
        `${productName}-${version}-*-mac.zip`,
        `${productName}-${version}-*-mac.zip.blockmap`,
      ],
    },
    {
      id: "win",
      label: "Windows",
      manifest: "latest.yml",
      buildHint: "npm --prefix apps/electron run dist:win",
      patterns: [
        `*${version}*.exe`,
        `*${version}*.exe.blockmap`,
        `${productName}-${version}-win.zip`,
        `${productName}-${version}-win.zip.blockmap`,
      ],
    },
    {
      id: "linux",
      label: "Linux",
      manifest: "latest-linux.yml",
      buildHint: "npm --prefix apps/electron run dist:linux",
      patterns: [`${productName}-${version}*.AppImage`],
    },
  ];
}

async function listDistFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (!entry.isFile() && !entry.isSymbolicLink()) continue;
    const full = path.join(dir, entry.name);
    try {
      // stat 跟随符号链接，悬空链接会被跳过
      if ((await stat(full)).isFile()) files.push(entry.name);
    } catch {
      // ignore
    }
  }
  return files;
}

async function matchGroupFiles(group, distFiles) {
  const manifestRe = globToRegExp(group.manifest);
  const manifestHit = distFiles.find((name) => manifestRe.test(name));
  const matched = [];
  const missedPatterns = [];
  for (const pattern of group.patterns) {
    const re = globToRegExp(pattern);
    const hits = distFiles.filter((name) => re.test(name));
    if (hits.length === 0) missedPatterns.push(pattern);
    matched.push(...hits);
  }
  return { manifestHit, matched, missedPatterns };
}

const notNodeModules = (src) => path.basename(src) !== "node_modules";

async function listFilesRecursive(dir) {
  const out = [];
  async function walk(current) {
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) await walk(full);
      else out.push(path.relative(dir, full).split(path.sep).join("/"));
    }
  }
  await walk(dir);
  return out.sort();
}

function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    createReadStream(filePath)
      .on("error", reject)
      .on("data", (chunk) => hash.update(chunk))
      .on("end", () => resolve(hash.digest("hex")));
  });
}

async function zipAvailable() {
  try {
    await execFileAsync("zip", ["-v"], { cwd: ROOT_DIR });
    return true;
  } catch (error) {
    if (error && error.code === "ENOENT") return false;
    return true; // zip 存在但 -v 异常，交给真实打包步骤报错
  }
}

async function main() {
  log(DRY_RUN ? "dry-run：只做一致性检查与计划打印，不写任何文件" : "开始汇总在线更新发布产物");

  // ---------- 1. 权威版本 ----------
  const electronPackage = await readJson(path.join(ELECTRON_DIR, "package.json"));
  const version = String(electronPackage.version ?? "").trim();
  if (!version) die("无法读取权威版本：apps/electron/package.json 缺少 version 字段");
  const productName = String(electronPackage.build?.productName ?? "SLC");
  const outputDir = path.join(ROOT_DIR, "release", `online-update-${version}`);
  const desktopUpdatesDir = path.join(outputDir, "desktop-updates");
  log(`权威版本: ${version}（apps/electron/package.json，productName=${productName}）`);

  // ---------- 2. 一致性校验 ----------
  const problems = [];
  const changelog = await readChangelogTopEntry();
  if (!changelog) {
    problems.push("CHANGELOG.md 未找到顶部 `## [x.y.z]` 版本条目；应补 CHANGELOG 条目（版本 + 日期 + 发布说明）");
  } else if (changelog.version !== version) {
    problems.push(
      `CHANGELOG.md 顶部条目版本 ${changelog.version} ≠ 权威版本 ${version}（${describeDrift(changelog.version, version)}）；应补 CHANGELOG 条目后再发布`
    );
  }

  const extensionDistExists = await pathExists(EXTENSION_DIST);
  if (extensionDistExists) {
    const extensionManifestPath = path.join(EXTENSION_DIST, "manifest.json");
    let extensionManifest = null;
    try {
      extensionManifest = await readJson(extensionManifestPath);
    } catch {
      warn(`apps/extension/dist/manifest.json 解析失败，视为缺失`);
    }
    if (!extensionManifest) {
      problems.push(`apps/extension/dist/manifest.json 缺失/损坏；请重新构建扩展：npm --prefix apps/extension run build`);
    } else if (extensionManifest.version !== version) {
      problems.push(
        `apps/extension/dist/manifest.json version=${extensionManifest.version} ≠ 权威版本 ${version}；请重新构建扩展（构建时会自动注入权威版本）：npm --prefix apps/extension run build`
      );
    }
  } else {
    problems.push(`apps/extension/dist 不存在；请先构建扩展：npm --prefix apps/extension run build`);
  }

  const electronDistExists = await pathExists(ELECTRON_DIST);
  if (!electronDistExists) {
    problems.push(
      `apps/electron/dist 不存在；请先构建桌面安装包（npm --prefix apps/electron run dist:mac / dist:win / dist:linux）`
    );
  }

  if (problems.length > 0) {
    for (const problem of problems) {
      if (DRY_RUN) warn(problem);
      else fail(problem);
    }
    if (!DRY_RUN) die("版本一致性校验失败，已中止；请按上方指引修复后重试");
  }

  // ---------- 3. 桌面产物收集计划 ----------
  const distFiles = electronDistExists ? await listDistFiles(ELECTRON_DIST) : [];
  const groups = buildPlatformGroups(version, productName);
  const groupMatches = [];
  const collectedDesktop = [];
  log("--- 桌面产物收集计划（apps/electron/dist → desktop-updates/）---");
  for (const group of groups) {
    const match = await matchGroupFiles(group, distFiles);
    groupMatches.push({ group, match });
    if (!match.manifestHit && match.matched.length === 0) {
      if (DRY_RUN) {
        warn(`将需要 ${group.manifest} 及 ${group.patterns.join(" / ")}（先 ${group.buildHint}）`);
      } else {
        warn(`${group.label} 组未发现任何构建产物，跳过该组（如需发布请先 ${group.buildHint}）`);
      }
    } else if (!match.manifestHit) {
      warn(
        `${group.label} 组发现 ${match.matched.length} 个产物但缺少 ${group.manifest}（electron-updater 依赖该清单），整组跳过；请重新执行 ${group.buildHint}`
      );
    } else {
      const names = [match.manifestHit, ...match.matched];
      if (DRY_RUN) log(`${group.label} 组: 将收集 ${names.length} 个文件: ${names.join(", ")}`);
      else log(`${group.label} 组: 收集 ${names.length} 个文件: ${names.join(", ")}`);
      if (match.missedPatterns.length > 0) {
        warn(`${group.label} 组以下模式未匹配到产物: ${match.missedPatterns.join(" / ")}`);
      }
      collectedDesktop.push(...names);
    }
  }

  // ---------- 4/5. Web 包与扩展包计划 ----------
  const gatewayDistExists = await pathExists(GATEWAY_DIST);
  const webTarName = `slc-web-${version}.tar.gz`;
  const hasZip = await zipAvailable();
  const extensionPkgName = hasZip
    ? `server-log-console-extension-v${version}.zip`
    : `server-log-console-extension-v${version}.tar.gz`;
  log("--- Web/扩展包计划 ---");
  if (gatewayDistExists) {
    log(`slc-web: 收入 gateway/dist ✓`);
  } else {
    warn(`apps/gateway/dist 不存在，slc-web 包将只含 extension/dist`);
  }
  if (!extensionDistExists && DRY_RUN) {
    warn(`将需要 apps/extension/dist（先 npm --prefix apps/extension run build）`);
  } else {
    log(`slc-web: 收入 extension/dist ✓`);
  }
  log(`扩展包格式: ${hasZip ? "zip（系统 zip 可用）" : "tar.gz（系统未找到 zip 命令，降级）"}`);
  log("--- 计划产物 ---");
  log(`  ${path.relative(ROOT_DIR, desktopUpdatesDir)}/  （desktop: ${collectedDesktop.length} 个文件）`);
  log(`  ${path.relative(ROOT_DIR, path.join(outputDir, webTarName))}`);
  log(`  ${path.relative(ROOT_DIR, path.join(outputDir, extensionPkgName))}`);
  log(`  ${path.relative(ROOT_DIR, path.join(outputDir, "manifest.json"))}`);
  log(`  ${path.relative(ROOT_DIR, path.join(outputDir, "SHA256SUMS"))}`);

  if (DRY_RUN) {
    log("dry-run 结束，未写入任何文件");
    return;
  }

  // ---------- 3. 收集桌面产物（真实执行） ----------
  await mkdir(desktopUpdatesDir, { recursive: true });
  for (const { group, match } of groupMatches) {
    if (!match.manifestHit) continue; // 跳过的组已在上面 WARN
    const names = [match.manifestHit, ...match.matched];
    for (const name of names) {
      await copyFile(path.join(ELECTRON_DIST, name), path.join(desktopUpdatesDir, name));
    }
  }
  if (collectedDesktop.length === 0) {
    warn("没有任何平台产物被收集，desktop-updates/ 为空；本次发布仅含 Web/扩展包");
  }

  // ---------- 4. slc-web tar.gz ----------
  const webTarPath = path.join(outputDir, webTarName);
  const stagingDir = path.join(outputDir, ".staging-web");
  try {
    await mkdir(path.join(stagingDir, "gateway"), { recursive: true });
    await mkdir(path.join(stagingDir, "extension"), { recursive: true });
    if (gatewayDistExists) {
      await cp(GATEWAY_DIST, path.join(stagingDir, "gateway", "dist"), {
        recursive: true,
        filter: notNodeModules,
      });
    } else {
      warn("gateway/dist 不存在，已跳过；web 包仅含 extension/dist");
    }
    await cp(EXTENSION_DIST, path.join(stagingDir, "extension", "dist"), {
      recursive: true,
      filter: notNodeModules,
    });
    await execFileAsync("tar", ["-czf", webTarPath, "-C", stagingDir, "gateway", "extension"]);
  } finally {
    await rm(stagingDir, { recursive: true, force: true });
  }
  log(`Web 增量包: ${path.relative(ROOT_DIR, webTarPath)}（tar 内路径 gateway/dist、extension/dist）`);

  // ---------- 5. Chrome 扩展 zip ----------
  let extensionPkgPath = path.join(outputDir, extensionPkgName);
  if (hasZip) {
    await execFileAsync("zip", ["-r", "-q", extensionPkgPath, "."], { cwd: EXTENSION_DIST });
    log(`扩展包: ${path.relative(ROOT_DIR, extensionPkgPath)}`);
  } else {
    const topLevel = (await readdir(EXTENSION_DIST, { withFileTypes: true })).map((e) => e.name);
    await execFileAsync("tar", ["-czf", extensionPkgPath, "-C", EXTENSION_DIST, ...topLevel]);
    warn(`系统未找到 zip 命令，扩展包降级为 tar.gz: ${path.basename(extensionPkgPath)}`);
  }

  // ---------- 6. manifest.json ----------
  const today = new Date().toISOString().slice(0, 10);
  const releaseManifest = {
    version,
    channel: "stable",
    releaseDate: changelog?.date ?? today,
    releaseNotes: changelog?.notes ?? "",
    files: {
      desktop: collectedDesktop,
      web: webTarName,
      extension: path.basename(extensionPkgPath),
    },
  };
  const manifestPath = path.join(outputDir, "manifest.json");
  await writeFile(manifestPath, `${JSON.stringify(releaseManifest, null, 2)}\n`);
  log(
    `清单: ${path.relative(ROOT_DIR, manifestPath)}（channel=stable, releaseDate=${releaseManifest.releaseDate}${changelog?.date ? "" : ", CHANGELOG 无日期，使用今天"}）`
  );

  // ---------- 7. SHA256SUMS ----------
  const allFiles = await listFilesRecursive(outputDir);
  const checksumLines = [];
  for (const rel of allFiles) {
    if (rel === "SHA256SUMS") continue;
    checksumLines.push(`${await sha256File(path.join(outputDir, rel))}  ${rel}`);
  }
  await writeFile(path.join(outputDir, "SHA256SUMS"), `${checksumLines.join("\n")}\n`);
  log(`校验和: ${path.relative(ROOT_DIR, path.join(outputDir, "SHA256SUMS"))}（${checksumLines.length} 个文件）`);

  let totalBytes = 0;
  for (const rel of allFiles) {
    totalBytes += (await stat(path.join(outputDir, rel))).size;
  }
  log(`产物目录: ${path.relative(ROOT_DIR, outputDir)}（共 ${allFiles.length + 1} 个文件，${(totalBytes / 1024 / 1024).toFixed(1)} MiB）`);

  // ---------- 8. 上传指引 ----------
  const updateHost = "<更新主机>";
  log("--- 上传指引（顺序关键：包体先传，清单最后传）---");
  log(`1) 先传桌面安装包/增量包（体积大，immutable）:`);
  log(`   rsync -avP ${path.relative(ROOT_DIR, desktopUpdatesDir)}/ ${updateHost}:<更新源目录>/desktop-updates/`);
  if (collectedDesktop.some((name) => name.startsWith("latest"))) {
    log(`   （若担心清单随包提前暴露，可加 --exclude 'latest*'，清单放第 3 步再传）`);
  }
  log(`2) 再传 Web 增量包与扩展包:`);
  log(`   rsync -avP ${path.relative(ROOT_DIR, path.join(outputDir, webTarName))} ${path.relative(ROOT_DIR, extensionPkgPath)} ${updateHost}:<更新源目录>/desktop-updates/`);
  log(`3) 最后传清单（顺序关键：清单先到而包未到，客户端会 404）:`);
  log(`   rsync -avP ${path.relative(ROOT_DIR, desktopUpdatesDir)}/latest*.yml ${path.relative(ROOT_DIR, manifestPath)} ${path.relative(ROOT_DIR, path.join(outputDir, "SHA256SUMS"))} ${updateHost}:<更新源目录>/desktop-updates/`);
  log(`4) 上传后抽查:`);
  log(`   curl -fsSL https://${updateHost}/desktop-updates/latest-mac.yml`);
  log(`   curl -fsSL https://${updateHost}/desktop-updates/manifest.json`);
  log(`   curl -fsSL https://${updateHost}/desktop-updates/SHA256SUMS`);
  log(`本地完整性自检: cd ${path.relative(process.cwd(), outputDir)} && shasum -a 256 -c SHA256SUMS`);
  log(`缓存策略提醒: latest*.yml / manifest.json / SHA256SUMS 配 no-cache，安装包 immutable（方案 §4.1）`);
  log("完成");
}

main().catch((error) => {
  fail(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
});
