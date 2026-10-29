const { app, BrowserWindow, Menu, Tray, nativeImage, ipcMain, shell, dialog } = require("electron");
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const http = require("http");
const crypto = require("crypto");
const { pathToFileURL } = require("url");

if (app && app.setName) app.setName("日志控制台");

const PORT = 4040;
const HOST = "127.0.0.1";

/* ============================================================
   凭证加密密钥与访问令牌托管
   ------------------------------------------------------------
   背景：gateway 以 ELECTRON_RUN_AS_NODE=1 运行，该模式下拿不到 Electron 的
   加密能力，所以密钥与令牌必须由主进程在这里派生，再通过环境变量注入给 gateway。
   - 主密钥：0600 权限的明文文件（~/.server-log-console/master.key）。
     ⚠️ 2026-10-29 起**不加密**（用户决策，详见下方 TODO(凭证静态加密)）。
   - 访问令牌：桌面端自动生成并注入，前端无需配置。
   ============================================================ */

const CONFIG_DIR = process.env.SERVER_LOG_CONFIG_HOME
  || path.join(app.getPath("home"), ".server-log-console");

function ensureDirSync(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  } catch { /* 已存在 */ }
}

/* ============================================================
   TODO(凭证静态加密) — 2026-10-29 暂时移除，后期重新设计
   ------------------------------------------------------------
   现状：**不加密**。SSH 密码/私钥以明文（`slc-v1` 前缀已不再产生）存放在
   ~/.server-log-console/ 下，文件权限 0600、仅当前用户可读。

   为什么先移除（用户决策）：
     ① macOS 上 safeStorage 每次启动都弹钥匙串授权，打扰严重；
     ② 加密链路脆弱 —— 历史遗留使 master.key（gateway 兜底生成）与
        master.key.enc（Electron 加密）并存且内容不同；切换读取优先级会
        直接导致全部凭证解密失败（实测「改完后 SSH 全部认证失败」）；
     ③ 密钥一旦与凭证错配就无法恢复（钥匙串拒绝解密时密钥永久丢失）。

   重新设计时的硬性要求：
     · 不每次启动弹系统授权（考虑单次解锁 + 会话内缓存，或 OS 级免密白名单）；
     · 密钥必须有版本号与完整性校验，**禁止**双密钥并存；
     · 迁移失败要能安全回退到明文并明确告警，绝不能让用户「突然连不上」；
     · 提供一键「重置凭证」出口，避免密钥丢失后只能手工删文件。
   ============================================================ */

/** 读取或创建访问令牌 */
function ensureGatewayToken() {
  ensureDirSync(CONFIG_DIR);
  const tokenPath = path.join(CONFIG_DIR, "gateway-auth.json");
  try {
    const parsed = JSON.parse(fs.readFileSync(tokenPath, "utf8"));
    if (parsed && typeof parsed.token === "string" && parsed.token.trim()) {
      return parsed.token.trim();
    }
  } catch { /* 不存在或损坏，重新生成 */ }

  const token = crypto.randomBytes(32).toString("base64url");
  try {
    fs.writeFileSync(tokenPath, JSON.stringify({ token }, null, 2) + "\n", { encoding: "utf8", mode: 0o600 });
    fs.chmodSync(tokenPath, 0o600);
    probe("gateway token generated");
  } catch (error) {
    probe(`gateway token write failed: ${error && error.message ? error.message : String(error)}`);
  }
  return token;
}

/** 提供给 gateway 的环境变量（进程内 import 与 spawn 共用）。
 *
 *  2026-10-29：**不再注入 SLC_MASTER_KEY**（用户决策：暂时去掉凭证加密）。
 *  gateway 的 SecretCipher 在拿不到密钥时会退回明文读写，凭证照常可用、
 *  也不会再去生成/读取 master.key，彻底避免「密钥错配 → 突然连不上」。
 *  仅注入访问令牌（鉴权必需，与凭证加密无关）。
 *
 *  TODO(凭证静态加密) 见文件上方 §TODO(凭证静态加密) 的完整要求。
 */
function buildGatewaySecretEnv() {
  try {
    return {
      GATEWAY_TOKEN: ensureGatewayToken()
    };
  } catch (error) {
    probe(`secret env build failed: ${error && error.message ? error.message : String(error)}`);
    return {};
  }
}
const GATEWAY_URL = `http://${HOST}:${PORT}`;

let mainWindow = null;
let gatewayProcess = null;
let tray = null;
let isAlwaysOnTop = false;
let isQuitting = false;
let gatewayStartPromise = null;
let viewerPipWindow = null;
let transferPipWindow = null;
const terminalPipWindows = new Map();

function listPipWindows() {
  const windows = [];
  if (viewerPipWindow && !viewerPipWindow.isDestroyed()) {
    windows.push(viewerPipWindow);
  }
  for (const win of terminalPipWindows.values()) {
    if (win && !win.isDestroyed()) {
      windows.push(win);
    }
  }
  return windows;
}

function findFocusedPipWindow() {
  return listPipWindows().find((win) => win.isFocused()) || null;
}

function resolveInspectableWindow(targetWindow = null) {
  if (targetWindow && !targetWindow.isDestroyed()) return targetWindow;
  const focusedWindow = BrowserWindow.getFocusedWindow();
  if (focusedWindow === mainWindow) return focusedWindow;
  if (focusedWindow && listPipWindows().includes(focusedWindow)) return focusedWindow;
  const focusedPipWindow = findFocusedPipWindow();
  if (focusedPipWindow) return focusedPipWindow;
  if (mainWindow && !mainWindow.isDestroyed()) return mainWindow;
  return null;
}

function toggleDevTools(targetWindow = null) {
  const win = resolveInspectableWindow(targetWindow);
  if (!win) return;
  if (!win.isFocused()) win.focus();
  win.webContents.toggleDevTools();
}

function bindDevToolsShortcut(win) {
  if (!win || win.isDestroyed()) return;
  win.webContents.on("before-input-event", (_event, input) => {
    const isDevToolsShortcut = (input.meta || input.control) && input.shift && String(input.key || "").toLowerCase() === "i";
    if (isDevToolsShortcut) {
      toggleDevTools(win);
    }
  });
}

function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    if (process.platform === "darwin" && app.dock) {
      void app.dock.show();
    }
    createWindow();
    return;
  }
  if (process.platform === "darwin" && app.dock) {
    void app.dock.show();
  }
  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }
  mainWindow.show();
  mainWindow.focus();
  if (process.platform === "darwin") {
    app.focus({ steal: true });
  }
}

function hideMainWindowToTray() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }
  mainWindow.hide();
  if (process.platform === "darwin" && app.dock) {
    app.dock.hide();
  }
}

function probe(message) {
  try {
    fs.appendFileSync("/tmp/slc-main-probe.txt", `${new Date().toISOString()} ${message}\n`);
  } catch {}
}

process.on("uncaughtException", (error) => {
  probe(`uncaughtException ${error && error.stack ? error.stack : String(error)}`);
});

process.on("unhandledRejection", (error) => {
  probe(`unhandledRejection ${error && error.stack ? error.stack : String(error)}`);
});

probe("top-level loaded");

// --- Paths ---
function getExtensionDistDir() {
  return app.isPackaged
    ? path.join(process.resourcesPath, "extension", "dist")
    : path.join(__dirname, "..", "extension", "dist");
}

/**
 * 允许的导航目标 = 应用自身入口（extension/dist 下的 file://）与 about:。
 * 2026-10-15：此前 will-navigate 直接放行**所有** file:// —— 把外部文件拖到非落点
 * 区域时，浏览器默认导航行为会让窗口跳到该文件的 file:// URL，整个 UI 被替换，
 * 只能强杀重启（用户反馈「遮罩常驻、切换目录都不行、只能强杀」）。
 * 收紧为「仅放行应用自己的入口」，其余一律拦截。
 * 注意：资源（JS/CSS chunk）属子资源加载、不是导航，不受影响；应用也从未 loadURL。
 */
function isAppEntryUrl(url) {
  if (url === "about:blank" || url.startsWith("about:")) {
    return true;
  }
  try {
    if (new URL(url).protocol !== "file:") {
      return false;
    }
    const entryDir = pathToFileURL(path.join(getExtensionDistDir(), path.sep)).href;
    return url.startsWith(entryDir);
  } catch {
    return false;
  }
}

function getGatewayEntry() {
  return app.isPackaged
    ? path.join(process.resourcesPath, "gateway", "dist", "index.js")
    : path.join(__dirname, "..", "gateway", "dist", "index.js");
}

function getGatewayCwd() {
  return app.isPackaged
    ? path.join(process.resourcesPath, "gateway")
    : path.join(__dirname, "..", "gateway");
}

// --- Gateway lifecycle (fire-and-forget) ---
function checkHealth() {
  return new Promise((resolve) => {
    const req = http.get(`${GATEWAY_URL}/health`, { timeout: 2000 }, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => {
        if (res.statusCode !== 200) {
          resolve(false);
          return;
        }
        try { resolve(JSON.parse(body).ok === true); } catch { resolve(false); }
      });
    });
    req.on("error", () => resolve(false));
    req.on("timeout", () => { req.destroy(); resolve(false); });
  });
}

async function waitForGatewayReady(maxAttempts = 20, delayMs = 500) {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    if (await checkHealth()) {
      probe(`gateway health ok attempt=${attempt}`);
      return true;
    }

    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  probe(`gateway health failed after ${maxAttempts} attempts`);
  return false;
}

/**
 * 网关日志桥接（2026-10-21）。
 *
 * 问题：startGateway() 优先走 importGatewayInProcess()，网关与本进程同体，
 * 其 console.* 只写到 stdout —— 打包后的 app 里没有任何地方能看到。
 * 只有 spawnGatewayProcess() 才会把子进程 stdout/stderr pipe 到 probe。
 * 实测探针里 `gateway import start` 有 9 条、`gateway spawn start` 0 条，
 * 即网关日志长期是黑洞，「连接卡住」这类问题因此完全无法定位。
 *
 * 方案：给 console 挂一层旁路，**仅**把网关（in-process）产生的日志追加进探针文件。
 *  - probe() 用 fs.appendFileSync，不经过 console，故不会递归；
 *  - 统一加 `gateway log` 前缀，便于 grep 区分主进程与网关；
 *  - 幂等：重复调用只桥接一次（避免 startGateway 重入时套娃）。
 */
let gatewayConsoleBridged = false;
function bridgeInProcessGatewayConsole() {
  if (gatewayConsoleBridged) {
    return;
  }
  gatewayConsoleBridged = true;
  for (const level of ["log", "info", "warn", "error"]) {
    const original = console[level].bind(console);
    console[level] = (...args) => {
      original(...args);
      try {
        const text = args
          .map((value) => (value instanceof Error ? (value.stack || value.message) : typeof value === "string" ? value : JSON.stringify(value)))
          .join(" ");
        probe(`gateway log[${level}] ${text}`);
      } catch {
        /* 序列化失败不影响主流程 */
      }
    };
  }
}

async function importGatewayInProcess(entry) {
  probe(`gateway import start ${entry}`);
  process.env.PORT = String(PORT);
  process.env.HOST = HOST;
  process.env.ELECTRON = "1";
  process.env.EXTENSION_DIST_DIR = getExtensionDistDir();
  /* 主密钥与访问令牌：主进程派生后注入（gateway 侧拿不到 Electron 环境） */
  const secretEnv = buildGatewaySecretEnv();
  if (secretEnv.SLC_MASTER_KEY) process.env.SLC_MASTER_KEY = secretEnv.SLC_MASTER_KEY;
  if (secretEnv.GATEWAY_TOKEN) process.env.GATEWAY_TOKEN = secretEnv.GATEWAY_TOKEN;
  /* 加载前先挂桥：网关在 import 期间就会打印启动横幅与路由注册日志 */
  bridgeInProcessGatewayConsole();
  await import(`${pathToFileURL(entry).href}?ts=${Date.now()}`);
  probe("gateway import resolved");
  return waitForGatewayReady();
}

async function spawnGatewayProcess(entry, cwd) {
  probe(`gateway spawn start ${entry}`);
  const nodeBin = process.execPath;

  gatewayProcess = spawn(nodeBin, [entry], {
    cwd,
    env: {
      ...process.env,
      PORT: String(PORT),
      HOST,
      ELECTRON: "1",
      ELECTRON_RUN_AS_NODE: "1",
      EXTENSION_DIST_DIR: getExtensionDistDir(),
      /* 与进程内 import 同一套密钥与令牌 */
      ...buildGatewaySecretEnv(),
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });

  gatewayProcess.stdout.on("data", (d) => {
    const line = d.toString().trim();
    console.log(`[gw] ${line}`);
    probe(`gateway stdout ${line}`);
  });
  gatewayProcess.stderr.on("data", (d) => {
    const line = d.toString().trim();
    console.error(`[gw] ${line}`);
    probe(`gateway stderr ${line}`);
  });
  gatewayProcess.on("error", (error) => {
    probe(`gateway spawn error ${error && error.stack ? error.stack : String(error)}`);
  });
  gatewayProcess.on("exit", (code, signal) => {
    probe(`gateway exit code=${code} signal=${signal || ""}`);
    console.log(`Gateway exited with code ${code}`);
    gatewayProcess = null;
  });

  return waitForGatewayReady();
}

async function startGateway() {
  if (gatewayStartPromise) {
    return gatewayStartPromise;
  }

  if (await checkHealth()) {
    console.log("Gateway already running");
    probe("gateway already running");
    return true;
  }

  const entry = getGatewayEntry();
  const cwd = getGatewayCwd();
  console.log(`Starting gateway: ${entry}`);

  gatewayStartPromise = (async () => {
    try {
      const imported = await importGatewayInProcess(entry);
      if (imported) {
        return true;
      }
      probe("gateway import path unhealthy, falling back to spawn");
      return await spawnGatewayProcess(entry, cwd);
    } catch (error) {
      probe(`gateway import failed ${error && error.stack ? error.stack : String(error)}`);
      return await spawnGatewayProcess(entry, cwd);
    } finally {
      gatewayStartPromise = null;
    }
  })();

  return gatewayStartPromise;
}

// --- Desktop auto update ---
let autoUpdater = null;
try {
  autoUpdater = require("electron-updater").autoUpdater;
} catch (error) {
  probe(`electron-updater load failed ${error && error.stack ? error.stack : String(error)}`);
}

// 更新源可变：包内配置为出厂默认，用户可在设置中心编辑（userData/update-source.json 覆盖）
let desktopUpdateUrl = resolveDesktopUpdateUrl();
// 包内版本说明（release-notes.md 随 asar 分发，prepare-release-notes.cjs 从 CHANGELOG 生成）
const BUNDLED_RELEASE_NOTES = readBundledReleaseNotes();
let desktopUpdateState = buildInitialDesktopUpdateState();
let desktopUpdaterConfigured = false;

configureDesktopUpdater();
registerDesktopUpdateIpc();

function readBundledReleaseNotes() {
  try {
    return fs.readFileSync(path.join(__dirname, "release-notes.md"), "utf8").trim();
  } catch {
    return "";
  }
}

function buildInitialDesktopUpdateState() {
  if (!app.isPackaged) {
    return { status: "unavailable", error: "开发模式不支持自动更新", updateInfo: null, progress: null };
  }
  if (!desktopUpdateUrl || !autoUpdater) {
    return { status: "unavailable", error: autoUpdater ? "未配置更新源" : "更新组件不可用", updateInfo: null, progress: null };
  }
  return { status: "idle", error: null, updateInfo: null, progress: null };
}

function isDesktopUpdateSupported() {
  return Boolean(app.isPackaged && desktopUpdateUrl && autoUpdater);
}

function buildDesktopUpdateSnapshot() {
  return {
    status: desktopUpdateState.status,
    error: desktopUpdateState.error,
    appInfo: {
      version: app.getVersion(),
      platform: process.platform,
      arch: process.arch,
      packaged: app.isPackaged,
    },
    updateInfo: desktopUpdateState.updateInfo,
    progress: desktopUpdateState.progress,
    updateUrl: desktopUpdateUrl || null,
    bundledReleaseNotes: BUNDLED_RELEASE_NOTES || null,
  };
}

function updateDesktopUpdateState(patch) {
  desktopUpdateState = { ...desktopUpdateState, ...patch };
  const snapshot = buildDesktopUpdateSnapshot();
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send("slc:update:state", snapshot);
    }
  }
}

function configureDesktopUpdater() {
  if (desktopUpdaterConfigured || !autoUpdater) return;
  desktopUpdaterConfigured = true;

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowPrerelease = false;
  if (desktopUpdateUrl) {
    ensureDesktopUpdaterConfig();
    autoUpdater.setFeedURL({ provider: "generic", url: desktopUpdateUrl, channel: "latest" });
  }

  // 更新器日志落到 /tmp/slc-main-probe.txt，排查下载/安装交接问题（此前 ShipIt 未被唤起时无任何线索）
  autoUpdater.logger = {
    info: (m) => probe(`updater info ${formatUpdaterLog(m)}`),
    warn: (m) => probe(`updater warn ${formatUpdaterLog(m)}`),
    error: (m) => probe(`updater error ${formatUpdaterLog(m)}`),
    debug: (m) => probe(`updater debug ${formatUpdaterLog(m)}`),
  };

  autoUpdater.on("checking-for-update", () => {
    updateDesktopUpdateState({ status: "checking", error: null });
  });
  autoUpdater.on("update-available", (info) => {
    updateDesktopUpdateState({
      status: "available",
      error: null,
      updateInfo: {
        version: info?.version || "",
        releaseDate: info?.releaseDate || "",
        releaseNotes: normalizeReleaseNotes(info?.releaseNotes),
      },
      progress: null,
    });
  });
  autoUpdater.on("update-not-available", () => {
    updateDesktopUpdateState({ status: "up-to-date", error: null, updateInfo: null, progress: null });
  });
  autoUpdater.on("download-progress", (progress) => {
    updateDesktopUpdateState({
      status: "downloading",
      error: null,
      progress: {
        percent: normalizeUpdatePercent(progress?.percent),
        transferred: Number(progress?.transferred) || 0,
        total: Number(progress?.total) || 0,
        bytesPerSecond: Number(progress?.bytesPerSecond) || 0,
      },
    });
  });
  autoUpdater.on("update-downloaded", (info) => {
    const lastProgress = desktopUpdateState.progress;
    updateDesktopUpdateState({
      status: "ready",
      error: null,
      updateInfo: {
        version: info?.version || desktopUpdateState.updateInfo?.version || "",
        releaseDate: info?.releaseDate || desktopUpdateState.updateInfo?.releaseDate || "",
        releaseNotes: normalizeReleaseNotes(info?.releaseNotes) || desktopUpdateState.updateInfo?.releaseNotes || "",
      },
      progress: lastProgress ? { ...lastProgress, percent: 100 } : null,
    });
  });
  autoUpdater.on("error", (error) => {
    // check/download 的失败主要由 IPC 的 try/catch 结算，这里兜底处理事件先于 promise reject 的场景
    if (desktopUpdateState.status === "checking") {
      settleDesktopUpdateFailure(error, "check");
    } else if (desktopUpdateState.status === "downloading") {
      settleDesktopUpdateFailure(error, "download");
    }
  });
}

// IPC 独立注册：即使 electron-updater 加载失败（autoUpdater 为 null），渲染层仍能拿到状态快照
function registerDesktopUpdateIpc() {
  ipcMain.handle("slc:update:get-state", () => buildDesktopUpdateSnapshot());
  ipcMain.handle("slc:update:check", async () => {
    if (!isDesktopUpdateSupported()) return buildDesktopUpdateSnapshot();
    try {
      await autoUpdater.checkForUpdates();
    } catch (error) {
      settleDesktopUpdateFailure(error, "check");
    }
    return buildDesktopUpdateSnapshot();
  });
  ipcMain.handle("slc:update:download", async () => {
    if (desktopUpdateState.status !== "available") return buildDesktopUpdateSnapshot();
    updateDesktopUpdateState({ status: "downloading", error: null, progress: { percent: 0, transferred: 0, total: 0, bytesPerSecond: 0 } });
    try {
      await autoUpdater.downloadUpdate();
    } catch (error) {
      settleDesktopUpdateFailure(error, "download");
    }
    return buildDesktopUpdateSnapshot();
  });
  ipcMain.handle("slc:update:install", async () => {
    if (desktopUpdateState.status !== "ready") return buildDesktopUpdateSnapshot();
    // 与 vrc 完全一致：置位让主窗口 close 拦截放行，然后交给 quitAndInstall 自行完成
    // 「武装 Squirrel/ShipIt + 退出进程」。**绝不额外 app.quit()/app.exit() 强杀** ——
    // 进程必须在 quitAndInstall 把更新交给系统安装器期间保持存活，过早强杀会掐断交接，
    // 表现为包已下载校验但 ShipIt 从未被唤起、版本不生效。
    isQuitting = true;
    setImmediate(() => {
      probe("install quitAndInstall called");
      try {
        autoUpdater.quitAndInstall(false, true);
      } catch (error) {
        probe(`quitAndInstall failed ${error && error.stack ? error.stack : String(error)}`);
      }
    });
    return buildDesktopUpdateSnapshot();
  });
  // 设置中心编辑更新源：立即热切换 feed 并持久化到 userData；清空 = 恢复出厂内置链路
  ipcMain.handle("slc:update:set-source", (_event, rawUrl) => {
    const url = typeof rawUrl === "string" ? rawUrl.trim() : "";
    if (url && !/^https?:\/\//i.test(url)) return buildDesktopUpdateSnapshot();
    if (desktopUpdateState.status === "downloading" || desktopUpdateState.status === "ready") {
      return buildDesktopUpdateSnapshot();
    }
    desktopUpdateUrl = url;
    persistUpdateSourceOverride(url);
    if (url && autoUpdater) {
      ensureDesktopUpdaterConfig();
      autoUpdater.setFeedURL({ provider: "generic", url, channel: "latest" });
    }
    desktopUpdateState = buildInitialDesktopUpdateState();
    updateDesktopUpdateState({});
    return buildDesktopUpdateSnapshot();
  });
}

function readUpdateSourceOverride() {
  try {
    const file = path.join(app.getPath("userData"), "update-source.json");
    if (!fs.existsSync(file)) return "";
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    return typeof parsed?.updateUrl === "string" ? parsed.updateUrl.trim() : "";
  } catch {
    return "";
  }
}

function persistUpdateSourceOverride(url) {
  try {
    const file = path.join(app.getPath("userData"), "update-source.json");
    if (url) {
      fs.writeFileSync(file, `${JSON.stringify({ updateUrl: url }, null, 2)}\n`, "utf8");
    } else {
      fs.rmSync(file, { force: true });
    }
  } catch (error) {
    probe(`persist update-source failed ${error && error.stack ? error.stack : String(error)}`);
  }
}

function settleDesktopUpdateFailure(error, operation) {
  const message = readableDesktopUpdateError(error);
  // 检查阶段失败降级为 unavailable（更新源可能只是暂时不可达），下载失败才进入 error
  if (operation === "check") {
    updateDesktopUpdateState({ status: "unavailable", error: message, updateInfo: null, progress: null });
    return;
  }
  if (desktopUpdateState.status === "error") return;
  updateDesktopUpdateState({ status: "error", error: message, progress: null });
}

function ensureDesktopUpdaterConfig() {
  const packagedConfigPath = path.join(process.resourcesPath, "app-update.yml");
  if (fs.existsSync(packagedConfigPath)) {
    autoUpdater.updateConfigPath = packagedConfigPath;
    return;
  }

  // 未配置 publish 时 electron-builder 不会生成 app-update.yml，运行时写 userData 兜底
  const fallbackConfigPath = path.join(app.getPath("userData"), "app-update.yml");
  const fallbackConfig = [
    "provider: generic",
    `url: ${JSON.stringify(desktopUpdateUrl)}`,
    "updaterCacheDirName: slc-updater",
    "",
  ].join("\n");
  fs.mkdirSync(path.dirname(fallbackConfigPath), { recursive: true });
  if (!fs.existsSync(fallbackConfigPath) || fs.readFileSync(fallbackConfigPath, "utf8") !== fallbackConfig) {
    fs.writeFileSync(fallbackConfigPath, fallbackConfig, "utf8");
  }
  autoUpdater.updateConfigPath = fallbackConfigPath;
}

function resolveDesktopUpdateUrl() {
  // 设置中心保存的自定义更新源优先（userData/update-source.json），清空该文件即恢复出厂链路
  const overrideUrl = readUpdateSourceOverride();
  if (overrideUrl) return overrideUrl;

  const envUrl = process.env.SLC_UPDATE_URL?.trim();
  if (envUrl) return envUrl;

  const candidates = [
    app.isPackaged ? path.join(process.resourcesPath, "update-config", "update-config.json") : "",
    path.join(__dirname, "update-config.local.json"),
    path.resolve(__dirname, "..", "..", ".env.local"),
  ].filter(Boolean);

  for (const file of candidates) {
    const url = readDesktopUpdateUrlFile(file);
    if (url) return url;
  }
  return "";
}

function readDesktopUpdateUrlFile(file) {
  try {
    if (!fs.existsSync(file)) return "";
    const content = fs.readFileSync(file, "utf8");
    if (file.endsWith(".json")) {
      const parsed = JSON.parse(content);
      const url = typeof parsed === "string" ? parsed : parsed?.updateUrl;
      return typeof url === "string" ? url.trim() : "";
    }
    const line = content
      .split(/\r?\n/)
      .map((item) => item.trim())
      .find((item) => item && !item.startsWith("#") && item.startsWith("SLC_UPDATE_URL="));
    if (!line) return "";
    return line.slice("SLC_UPDATE_URL=".length).trim().replace(/^['"]|['"]$/g, "");
  } catch {
    return "";
  }
}

function normalizeReleaseNotes(value) {
  if (typeof value === "string") return value.trim();
  if (!Array.isArray(value)) return "";
  return value
    .map((item) => (typeof item === "string" ? item : item?.note))
    .filter((item) => typeof item === "string" && item.trim())
    .join("\n")
    .trim();
}

function normalizeUpdatePercent(value) {
  const percent = Number(value);
  if (!Number.isFinite(percent)) return 0;
  return Math.max(0, Math.min(100, Math.round(percent * 10) / 10));
}

/** electron-updater 的 logger 接收 string 或任意对象，统一成单行字符串后写入 probe 日志 */
function formatUpdaterLog(value) {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (value instanceof Error) return value.stack || value.message;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function readableDesktopUpdateError(error) {
  const message = error instanceof Error ? error.message : String(error || "");
  if (/checksum|sha512/i.test(message)) return "更新包校验失败";
  if (/signature|code sign/i.test(message)) return "更新包签名验证失败";
  if (/404|ENOENT/i.test(message)) return "更新源文件不存在";
  if (/ETIMEDOUT|ENOTFOUND|ECONNREFUSED|EAI_AGAIN/i.test(message)) return "无法连接更新源";
  return message || "更新失败，请稍后重试";
}

function buildMenu() {
  const template = [
    {
      label: app.name,
      submenu: [
        { role: "about" },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    {
      label: "编辑",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
      ],
    },
    {
      label: "视图",
      submenu: [
        {
          label: isAlwaysOnTop ? "取消置顶" : "窗口置顶",
          accelerator: "CmdOrCtrl+Shift+T",
          click: () => toggleAlwaysOnTop(),
        },
        { type: "separator" },
        { role: "reload" },
        { role: "forceReload" },
        {
          label: "开发者工具",
          accelerator: "CmdOrCtrl+Shift+I",
          click: (_item, browserWindow) => toggleDevTools(browserWindow || null),
        },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    {
      label: "窗口",
      submenu: [
        { role: "minimize" },
        { role: "zoom" },
        { role: "close" },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function toggleAlwaysOnTop() {
  isAlwaysOnTop = !isAlwaysOnTop;
  if (mainWindow) {
    mainWindow.setAlwaysOnTop(isAlwaysOnTop, "floating");
    mainWindow.webContents.send("pin-changed", isAlwaysOnTop);
  }
  buildMenu();
}

ipcMain.handle("toggle-pin", () => {
  toggleAlwaysOnTop();
  return isAlwaysOnTop;
});

ipcMain.handle("get-pin", () => isAlwaysOnTop);

/* 前端取网关访问令牌：桌面端从 file:// 打开时也要能通过 Bearer 鉴权。
   只回给已加载的本地页面，且不写探针日志。 */
/* 上传进度广播：主窗口渲染层把进度推给主进程，主进程转发给上传进度小窗。
   大文件上传时进度刷新很密（每个 chunk 一次），这里做节流，
   避免小窗因高频 IPC 消息卡顿（实测 200ms 一次人眼已足够平滑）。 */
let transferProgressThrottle = 0;
ipcMain.on("slc:transfer:progress", (_event, payload) => {
  if (!transferPipWindow || transferPipWindow.isDestroyed()) return;
  const now = Date.now();
  /* 完成/失败/取消等终态必须立即送达，不做节流 */
  const isTerminalState = payload && (payload.stage === "done" || payload.stage === "error" || payload.stage === "canceled");
  if (!isTerminalState && now - transferProgressThrottle < 200) return;
  transferProgressThrottle = now;
  transferPipWindow.webContents.send("slc:transfer:progress", payload);
});

/* 小窗发起的控制（暂停/继续/取消）转回主窗口执行 */
ipcMain.on("slc:transfer:control", (_event, action) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("slc:transfer:control", action);
  }
});

ipcMain.handle("slc:gateway-token", () => {
  try {
    return ensureGatewayToken();
  } catch {
    return null;
  }
});

// --- 窗口控制（2026-10-24 方案 B：Windows 自绘标题栏）---
/* Windows 主窗口无边框后，最小化/最大化/关闭由网页按钮经这里触发。
   按 event.sender 定位窗口：目前只有主窗口渲染控制按钮，PiP 小窗保持
   系统原生标题栏，但这样写之后 PiP 想接入也不用改主进程。 */
ipcMain.handle("slc:win:minimize", (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win && !win.isDestroyed()) win.minimize();
});

ipcMain.handle("slc:win:toggle-maximize", (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win || win.isDestroyed()) return false;
  if (win.isMaximized()) {
    win.unmaximize();
  } else {
    win.maximize();
  }
  return win.isMaximized();
});

ipcMain.handle("slc:win:close", (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win && !win.isDestroyed()) win.close();
});

ipcMain.handle("slc:win:is-maximized", (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  return Boolean(win && !win.isDestroyed() && win.isMaximized());
});


ipcMain.handle("save-file", async (_event, buffer, defaultName) => {
  const win = BrowserWindow.getFocusedWindow() || mainWindow;
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    defaultPath: defaultName,
    properties: ["createDirectory", "showOverwriteConfirmation"],
  });
  if (canceled || !filePath) return { ok: false, canceled: true };
  fs.writeFileSync(filePath, Buffer.from(buffer));
  return { ok: true, filePath };
});

ipcMain.handle("reveal-local-path", async (_event, targetPath) => {
  if (typeof targetPath !== "string" || !targetPath.trim()) {
    return { ok: false, message: "本地路径为空" };
  }
  if (!fs.existsSync(targetPath)) {
    return { ok: false, message: "本地路径不存在" };
  }
  try {
    shell.showItemInFolder(targetPath);
    return { ok: true };
  } catch (error) {
    return { ok: false, message: error && error.message ? error.message : "无法定位本地文件" };
  }
});

// --- Local File Browser ---
ipcMain.handle("local-browse", async (_event, dirPath) => {
  const target = dirPath || app.getPath("home");
  try {
    const entries = fs.readdirSync(target, { withFileTypes: true });
    const items = entries
      .filter((e) => !e.name.startsWith("."))
      .map((e) => ({
        name: e.name,
        isDirectory: e.isDirectory(),
        size: e.isFile() ? fs.statSync(path.join(target, e.name)).size : 0,
        modifiedTime: fs.statSync(path.join(target, e.name)).mtime?.toISOString() || ""
      }))
      .sort((a, b) => {
        if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
    return { ok: true, path: target, entries: items };
  } catch (error) {
    return { ok: false, message: error && error.message ? error.message : "无法浏览目录" };
  }
});

ipcMain.handle("local-read-file", async (_event, filePath) => {
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    const stat = fs.statSync(filePath);
    return { ok: true, content, size: stat.size, modifiedTime: stat.mtime?.toISOString() || "" };
  } catch (error) {
    return { ok: false, message: error && error.message ? error.message : "无法读取文件" };
  }
});

ipcMain.handle("local-pick-directory", async () => {
  const win = BrowserWindow.getFocusedWindow() || mainWindow;
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    properties: ["openDirectory", "createDirectory"]
  });
  if (canceled || !filePaths.length) return { ok: false, canceled: true };
  return { ok: true, path: filePaths[0] };
});

ipcMain.handle("local-pick-files", async () => {
  const win = BrowserWindow.getFocusedWindow() || mainWindow;
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    properties: ["openFile", "multiSelections"]
  });
  if (canceled || !filePaths.length) return { ok: false, canceled: true };
  const files = filePaths.map((filePath) => {
    const stat = fs.statSync(filePath);
    return {
      path: filePath,
      name: path.basename(filePath),
      size: stat.size,
      modifiedTime: stat.mtime?.toISOString() || ""
    };
  });
  return { ok: true, files };
});

// --- PiP Window ---
ipcMain.handle("open-pip-window", (_event, config = {}) => {
  const pipMode = config.mode || "viewer";
  const isTerminalMode = pipMode === "terminal";
  const isUtilityMode = pipMode === "utility";
  /* 上传进度小窗：只做监视与暂停/取消，**不接受拖放** ——
     独立窗口没有目录浏览器，拖进去容易传错地方。
     因此这里只带 serverId + directoryPath 作为上下文展示，不做落点。 */
  const isTransferMode = pipMode === "transfer";
  const terminalSessionId = String(config.terminalSessionId || "").trim();
  if (isTerminalMode && !terminalSessionId) {
    return { ok: false, message: "缺少终端会话标识" };
  }

  const existingWindow = isTerminalMode
    ? terminalPipWindows.get(terminalSessionId)
    : isTransferMode
      ? transferPipWindow
      : viewerPipWindow;
  if (existingWindow && !existingWindow.isDestroyed()) {
    if (!isTerminalMode) {
      const nextPipState = {
        ...lastPipState,
        ...(Object.prototype.hasOwnProperty.call(config, "errorHighlight") ? { errorHighlight: Boolean(config.errorHighlight) } : {}),
        ...(Object.prototype.hasOwnProperty.call(config, "liveFollow") ? { liveFollow: Boolean(config.liveFollow) } : {}),
      };
      lastPipState = nextPipState;
      existingWindow.webContents.send("pip-state-update", nextPipState);
    }
    existingWindow.focus();
    return { ok: true };
  }

  const query = new URLSearchParams();
  query.set("pip", pipMode);
  if (config.serverId) query.set("serverId", config.serverId);
  if (config.filePath) query.set("filePath", config.filePath);
  if (config.directoryPath) query.set("directoryPath", config.directoryPath);
  if (config.bastionId) query.set("bastionId", config.bastionId);
  if (config.terminalSessionId) query.set("terminalSessionId", config.terminalSessionId);
  if (config.utilityPanel) query.set("utilityPanel", config.utilityPanel);
  if (config.activeLogView) query.set("activeLogView", config.activeLogView);
  const effectiveErrorHighlight = Object.prototype.hasOwnProperty.call(config, "errorHighlight")
    ? Boolean(config.errorHighlight)
    : Boolean(lastPipState.errorHighlight);
  const effectiveLiveFollow = Object.prototype.hasOwnProperty.call(config, "liveFollow")
    ? Boolean(config.liveFollow)
    : Boolean(lastPipState.liveFollow);
  if (!isTerminalMode) {
    lastPipState = {
      ...lastPipState,
      errorHighlight: effectiveErrorHighlight,
      liveFollow: effectiveLiveFollow,
    };
  }
  if (effectiveErrorHighlight) query.set("errorHighlight", "1");
  if (effectiveLiveFollow) query.set("liveFollow", "1");
  const indexFile = path.join(getExtensionDistDir(), "index.html");

  const nextPipWindow = new BrowserWindow({
    width: config.width || 980,
    height: config.height || 680,
    minWidth: 720,
    minHeight: 420,
    title: config.title || "日志控制台",
    alwaysOnTop: isUtilityMode || isTransferMode ? false : true,
    /* 标题栏按平台分三套（2026-10-24，与主窗口方案 B 一致）：
       - macOS：hiddenInset，红绿灯浮在内容上（头部用 padding-left 88px 让位）。
       - Windows：hidden 无边框 —— hiddenInset 在 Windows 不受支持会退回原生
         标题栏，多出一条与 UI 无关的系统条（用户反馈「大量空白、标题分离」）。
         无边框后窗口按钮由网页自绘（WindowControls，slc:win:* IPC），
         头部直接顶到窗口最上沿，与 mac 结构一致。
       - Linux / 工具小窗：保持系统默认边框。 */
    titleBarStyle: isUtilityMode
      ? "default"
      : process.platform === "darwin"
        ? "hiddenInset"
        : process.platform === "win32"
          ? "hidden"
          : "default",
    ...(isUtilityMode || process.platform !== "darwin" ? {} : { trafficLightPosition: { x: 12, y: 12 } }),
    /* 小窗同样隐藏系统菜单栏（2026-10-23 用户反馈「小窗顶部 wind 快捷键没去掉」）：
       主窗口早已设了 autoHideMenuBar，但 PiP 这里漏了 —— Windows 下小窗顶部
       因此仍有一条「文件/编辑/视图/窗口」菜单栏，占掉一块高度、还把小窗内容压扁。
       与主窗口保持一致：Windows/Linux 隐藏（按 Alt 仍可唤出），macOS 无影响。 */
    autoHideMenuBar: process.platform !== "darwin",
    // 终端小窗保持深色底；日志/工具小窗跟随浅色主题，避免黑窗与主题割裂
    backgroundColor: isTerminalMode ? "#0a0a0a" : "#fafafa",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false,
    },
  });

  if (isTerminalMode) {
    terminalPipWindows.set(terminalSessionId, nextPipWindow);
  } else if (isTransferMode) {
    transferPipWindow = nextPipWindow;
  } else {
    viewerPipWindow = nextPipWindow;
  }

  bindDevToolsShortcut(nextPipWindow);
  /* 最大化状态推送（2026-10-24）：Windows 自绘标题栏的按钮要在
     最大化/还原图标间切换；每个小窗推给自己的 webContents。 */
  const pushPipMaximizeState = () => {
    if (!nextPipWindow.isDestroyed()) {
      nextPipWindow.webContents.send("slc:win:maximize-changed", nextPipWindow.isMaximized());
    }
  };
  nextPipWindow.on("maximize", pushPipMaximizeState);
  nextPipWindow.on("unmaximize", pushPipMaximizeState);
  nextPipWindow.webContents.on("render-process-gone", (_event, details) => {
    probe(`pip render-process-gone ${pipMode} ${details.reason} ${details.exitCode}`);
    if (isQuitting || details.reason === "clean-exit") return;
    if (!nextPipWindow.isDestroyed()) {
      nextPipWindow.close();
    }
  });
  nextPipWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url === "about:blank" || url.startsWith("about:")) {
      return { action: "allow" };
    }
    shell.openExternal(url);
    return { action: "deny" };
  });
  nextPipWindow.webContents.on("will-navigate", (event, url) => {
    if (isAppEntryUrl(url)) return;
    event.preventDefault();
    probe(`pip will-navigate blocked ${url}`);
    if (!url.startsWith("file:")) {
      shell.openExternal(url);
    }
  });
  nextPipWindow.loadFile(indexFile, { query: Object.fromEntries(query.entries()) });

  nextPipWindow.on("closed", () => {
    if (isTerminalMode) {
      if (terminalPipWindows.get(terminalSessionId) === nextPipWindow) {
        terminalPipWindows.delete(terminalSessionId);
      }
    } else if (isTransferMode && transferPipWindow === nextPipWindow) {
      transferPipWindow = null;
    } else if (viewerPipWindow === nextPipWindow) {
      viewerPipWindow = null;
      // Forward last known PiP state to main window before reset
      if (mainWindow && !mainWindow.isDestroyed() && Object.keys(lastPipState).length) {
        mainWindow.webContents.send("pip-state-update", lastPipState);
        lastPipState = {};
      }
    }
    if (mainWindow) {
      mainWindow.webContents.send("pip-window-closed", {
        mode: pipMode,
        terminalSessionId: isTerminalMode ? terminalSessionId : undefined,
        serverId: config.serverId || undefined,
      });
    }
  });

  return { ok: true };
});

ipcMain.handle("close-pip-window", (_event, config = {}) => {
  const pipMode = config.mode || (config.terminalSessionId ? "terminal" : "viewer");
  if (pipMode === "terminal") {
    const terminalSessionId = String(config.terminalSessionId || "").trim();
    if (!terminalSessionId) {
      return { ok: false, message: "缺少终端会话标识" };
    }
    const terminalWindow = terminalPipWindows.get(terminalSessionId);
    if (terminalWindow && !terminalWindow.isDestroyed()) {
      terminalWindow.close();
    }
    return { ok: true };
  }

  if (viewerPipWindow && !viewerPipWindow.isDestroyed()) {
    viewerPipWindow.close();
  }
  return { ok: true };
});

// --- PiP State Sync ---
let lastPipState = {};

ipcMain.handle("send-pip-state", (event, state = {}) => {
  const senderWindow = BrowserWindow.fromWebContents(event.sender);
  const isFromMain = senderWindow === mainWindow;
  const isFromViewerPip = senderWindow === viewerPipWindow;

  lastPipState = { ...lastPipState, ...state };

  if (isFromMain && viewerPipWindow && !viewerPipWindow.isDestroyed()) {
    viewerPipWindow.webContents.send("pip-state-update", state);
  } else if (isFromViewerPip && mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("pip-state-update", state);
  }
  return { ok: true };
});

// --- Renderer crash recovery ---
const RENDERER_RECOVERY_WINDOW_MS = 5 * 60 * 1000;
const RENDERER_RECOVERY_MAX_ATTEMPTS = 3;
const RENDERER_RELOAD_WATCHDOG_MS = 10_000;
let rendererRecoveryAttempts = [];
let rendererRecovering = false;
let rendererReloadWatchdog = null;

function clearRendererReloadWatchdog() {
  if (rendererReloadWatchdog !== null) {
    clearTimeout(rendererReloadWatchdog);
    rendererReloadWatchdog = null;
  }
}

function recreateMainWindow() {
  rendererRecovering = false;
  clearRendererReloadWatchdog();
  probe("renderer recovery recreate window");
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.destroy();
  }
  createWindow();
}

async function offerCrashedWindowReload() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const { response } = await dialog.showMessageBox(mainWindow, {
    type: "error",
    title: "页面已崩溃",
    message: "日志控制台页面崩溃了",
    detail: "自动恢复多次未成功。可以重建窗口（界面状态会按本地保存自动恢复），或退出应用。",
    buttons: ["重新加载", "退出"],
    defaultId: 0,
    cancelId: 1,
  });
  if (response === 0) {
    rendererRecoveryAttempts = [];
    recreateMainWindow();
  } else {
    app.quit();
  }
}

function handleMainRendererGone(details) {
  probe(`createWindow render-process-gone ${details.reason} ${details.exitCode}`);
  void captureMemoryProbe("renderer-gone");
  if (isQuitting || details.reason === "clean-exit") {
    return;
  }
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  const now = Date.now();
  rendererRecoveryAttempts = rendererRecoveryAttempts.filter((time) => now - time < RENDERER_RECOVERY_WINDOW_MS);
  rendererRecoveryAttempts.push(now);

  if (rendererRecoveryAttempts.length > RENDERER_RECOVERY_MAX_ATTEMPTS) {
    probe(`renderer recovery attempts exhausted (${rendererRecoveryAttempts.length} in window), offering manual reload`);
    void offerCrashedWindowReload();
    return;
  }

  if (rendererRecovering) {
    return;
  }

  rendererRecovering = true;
  probe(`renderer recovery reload attempt=${rendererRecoveryAttempts.length} reason=${details.reason}`);

  let reloadSettled = false;
  const settleReload = () => {
    if (reloadSettled) return;
    reloadSettled = true;
    clearRendererReloadWatchdog();
    rendererRecovering = false;
    rendererRecoveryAttempts = [];
    probe("renderer recovery reload finished");
  };

  mainWindow.webContents.once("did-finish-load", settleReload);

  try {
    mainWindow.webContents.reload();
  } catch (error) {
    probe(`renderer recovery reload threw ${error && error.stack ? error.stack : String(error)}`);
    recreateMainWindow();
    return;
  }

  clearRendererReloadWatchdog();
  rendererReloadWatchdog = setTimeout(() => {
    if (reloadSettled) return;
    reloadSettled = true;
    probe("renderer recovery reload watchdog timeout, recreating window");
    recreateMainWindow();
  }, RENDERER_RELOAD_WATCHDOG_MS);
}

// --- Memory probe (long-session diagnostics) ---
const MEM_PROBE_INTERVAL_MS = 5 * 60 * 1000;
const MEMORY_PROBE_LOG = "/tmp/slc-mem-probe.log";
let memoryProbeTimer = null;

function formatMb(bytes) {
  return `${Math.round((bytes / 1024 / 1024) * 10) / 10}MB`;
}

async function captureMemoryProbe(reason) {
  try {
    const parts = [];
    for (const metric of app.getAppMetrics()) {
      const mem = metric.memory || {};
      const working = (mem.workingSetSize || 0) * 1024;
      const peak = (mem.peakWorkingSetSize || 0) * 1024;
      parts.push(`${metric.type}:${formatMb(working)}/${formatMb(peak)}`);
    }
    let jsHeap = "";
    if (mainWindow && !mainWindow.isDestroyed()) {
      try {
        const heap = await mainWindow.webContents.executeJavaScript(
          "performance.memory ? { used: performance.memory.usedJSHeapSize, limit: performance.memory.jsHeapSizeLimit } : null",
          false
        );
        if (heap) {
          jsHeap = ` rendererJsHeap=${formatMb(heap.used)}/${formatMb(heap.limit)}`;
        }
      } catch {}
    }
    fs.appendFileSync(MEMORY_PROBE_LOG, `${new Date().toISOString()} reason=${reason} ${parts.join(" ")}${jsHeap}\n`);
  } catch {}
}

function startMemoryProbe() {
  if (memoryProbeTimer) {
    return;
  }
  void captureMemoryProbe("startup");
  memoryProbeTimer = setInterval(() => {
    void captureMemoryProbe("interval");
  }, MEM_PROBE_INTERVAL_MS);
}

// --- Window (VS Code approach: load local HTML instantly, no server dependency) ---
function createWindow() {
  const indexFile = path.join(getExtensionDistDir(), "index.html");
  probe(`createWindow start ${indexFile}`);

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 800,
    minHeight: 600,
    title: "",
    show: false,
    backgroundColor: "#fafafa",
    /* 标题栏（2026-10-24 方案 B：Windows 自绘）：
       - macOS：hiddenInset + 红绿灯位置，内容延伸到标题栏下方（不变）。
       - Windows：titleBarStyle:"hidden"（无边框但保留系统缩放边/阴影），
         最小化/最大化/关闭按钮由网页自绘（App.tsx 的 WindowControls，
         经 slc:win:* IPC 控制窗口），拖拽复用 electron-immersive 的
         -webkit-app-region 拖拽区体系。顶栏因此是普通 DOM，颜色/渐变/
         过渡全部随主题 CSS 自动生效 —— 0.3.296 的 titleBarOverlay 方案
         覆盖层由系统绘制、只能纯色瞬间切换且与网页让位带难对齐，本方案没有这些问题。
         系统标题文字随之消失，属预期（应用不需要窗口标题文字）。
       - Linux：保持默认边框（自绘标题栏暂不覆盖 Linux）。
       另：不再需要 titleBarOverlay / slc:set-titlebar-overlay / 让位带。 */
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : process.platform === "win32" ? "hidden" : "default",
    /* Windows 隐藏系统菜单栏（2026-10-23 用户反馈「wind 版顶部工具条隐藏」）：
       Windows 下 BrowserWindow 默认会渲染「文件/编辑/视图/窗口」菜单栏，
       而 macOS 的菜单在系统顶栏、不在窗口内 —— 所以只有 Windows 会多出一条。
       本应用所有操作都有界面内入口（设置中心 / 视图切换 / 托盘菜单），
       系统菜单栏纯属多餘，故 Windows/Linux 上 autoHideMenuBar 隐藏（按 Alt 仍可唤出）。
       macOS 保持现状（菜单在系统顶栏，无影响）。 */
    autoHideMenuBar: process.platform !== "darwin",
    ...(process.platform === "darwin" ? { trafficLightPosition: { x: 12, y: 12 } } : {}),
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false,
    },
  });
  probe("createWindow browserWindow created");

  // Load local file directly — renders instantly, no server needed
  mainWindow.loadFile(indexFile);
  probe("createWindow loadFile called");
  mainWindow.once("ready-to-show", () => {
    if (mainWindow?.isMinimized()) {
      mainWindow.restore();
    }
    mainWindow?.show();
    mainWindow?.focus();
    app.focus({ steal: true });
  });
  mainWindow.once("ready-to-show", () => probe("createWindow ready-to-show"));
  /* 最大化状态变化推送（2026-10-24 方案 B）：自绘标题栏的按钮要在
     最大化/还原图标间切换。macOS 用系统红绿灯、不受影响。 */
  const sendMaximizeState = () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("slc:win:maximize-changed", mainWindow.isMaximized());
    }
  };
  mainWindow.on("maximize", sendMaximizeState);
  mainWindow.on("unmaximize", sendMaximizeState);
  mainWindow.webContents.on("did-finish-load", () => probe("createWindow did-finish-load"));
  mainWindow.webContents.on("did-fail-load", (_event, code, description) => probe(`createWindow did-fail-load ${code} ${description}`));
  mainWindow.webContents.on("render-process-gone", (_event, details) => handleMainRendererGone(details));
  mainWindow.webContents.on("console-message", (_event, level, message, line, sourceId) => {
    probe(`renderer console level=${level} line=${line} source=${sourceId || ""} ${message}`);
  });
  mainWindow.webContents.on("preload-error", (_event, preloadPath, error) => {
    probe(`renderer preload-error ${preloadPath} ${error && error.stack ? error.stack : String(error)}`);
  });
  mainWindow.webContents.on("did-start-navigation", (_event, url, isInPlace, isMainFrame) => {
    if (isMainFrame && !isInPlace) {
      probe(`renderer did-start-navigation ${url}`);
    }
  });

  mainWindow.on("close", (event) => {
    if (isQuitting || process.platform !== "darwin") {
      return;
    }
    event.preventDefault();
    probe("createWindow close intercepted hide");
    hideMainWindowToTray();
  });

  mainWindow.on("closed", () => {
    probe("createWindow window closed");
    mainWindow = null;
  });

  // Dev shortcut: Cmd+Shift+I to toggle DevTools
  bindDevToolsShortcut(mainWindow);

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url === "about:blank" || url.startsWith("about:")) {
      return { action: "allow" };
    }
    shell.openExternal(url);
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (isAppEntryUrl(url)) return;
    event.preventDefault();
    probe(`main will-navigate blocked ${url}`);
    if (!url.startsWith("file:")) {
      shell.openExternal(url);
    }
  });
}

function createTray() {
  const resBase = app.isPackaged ? path.join(process.resourcesPath, "resources") : path.join(__dirname, "resources");
  const trayIconPath = process.platform === "darwin"
    ? path.join(resBase, "trayTemplate.png")
    : path.join(resBase, "icons", "icon-32.png");
  probe(`createTray icon ${trayIconPath}`);
  const icon = nativeImage.createFromPath(trayIconPath);
  if (process.platform === "darwin") icon.setTemplateImage(true);
  tray = new Tray(icon);
  probe("createTray created");
  tray.setToolTip("日志控制台");
  const contextMenu = Menu.buildFromTemplate([
    { label: "显示窗口", click: () => showMainWindow() },
    { label: "开发者工具", click: () => toggleDevTools() },
    { type: "separator" },
    { label: "退出", click: () => app.quit() },
  ]);
  tray.setContextMenu(contextMenu);
  tray.on("click", () => showMainWindow());
}

app.whenReady().then(() => {
  probe("whenReady");
  buildMenu();
  probe("buildMenu done");
  createTray();
  probe("createTray done");

  // 1. Show UI instantly from local file (no server dependency)
  createWindow();
  probe("createWindow done");

  // 2. Start gateway in background — frontend's health check auto-connects when ready
  startGateway();
  probe("startGateway called");

  startMemoryProbe();

  app.on("activate", () => {
    probe("app activate");
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
      return;
    }
    showMainWindow();
  });
});

app.on("window-all-closed", () => {
  probe("window-all-closed");
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  isQuitting = true;
  probe("before-quit");
  if (gatewayProcess) {
    gatewayProcess.kill();
    gatewayProcess = null;
  }
});
