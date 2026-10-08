const { app, BrowserWindow, Menu, Tray, nativeImage, ipcMain, shell, dialog } = require("electron");
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const http = require("http");
const { pathToFileURL } = require("url");

if (app && app.setName) app.setName("日志控制台");

const PORT = 4040;
const HOST = "127.0.0.1";
const GATEWAY_URL = `http://${HOST}:${PORT}`;

let mainWindow = null;
let gatewayProcess = null;
let tray = null;
let isAlwaysOnTop = false;
let isQuitting = false;
let gatewayStartPromise = null;
let viewerPipWindow = null;
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

async function importGatewayInProcess(entry) {
  probe(`gateway import start ${entry}`);
  process.env.PORT = String(PORT);
  process.env.HOST = HOST;
  process.env.ELECTRON = "1";
  process.env.EXTENSION_DIST_DIR = getExtensionDistDir();
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
    // 先回包再退出安装，避免渲染层 invoke 悬空
    setTimeout(() => {
      // Squirrel 原生安装路径不触发 before-quit：先置位让主窗口 close 拦截放行
      isQuitting = true;
      try {
        // 走 Squirrel.Mac 原生安装路径。关键：**绝不能立即强杀进程** ——
        // quitAndInstall 需要保持进程存活，把更新经本地代理交给 Squirrel 并武装 ShipIt；
        // 过早退出（曾用 800ms quit + 2.5s exit）会掐断该交接，导致更新包已下载校验、
        // ShipIt 却从未被唤起、版本不生效。quitAndInstall 自身会退出进程，下面仅保留
        // 长延时兜底，防它在异常情况下不退出，绝不抢在它前面。
        probe("install quitAndInstall called");
        autoUpdater.quitAndInstall(false, true);
      } catch (error) {
        probe(`quitAndInstall failed ${error && error.stack ? error.stack : String(error)}`);
      }
      // 兜底 1：10s 仍未退出 → 重新 app.quit()
      setTimeout(() => {
        probe("install fallback app.quit");
        try { app.quit(); } catch (error) { probe(`install quit failed ${error}`); }
      }, 10000);
      // 兜底 2：20s 仍未退出 → 强制 exit，避免永久挂起
      setTimeout(() => {
        probe("install fallback app.exit");
        try { app.exit(0); } catch (error) { probe(`install exit failed ${error}`); }
      }, 20000);
    }, 0);
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
  const terminalSessionId = String(config.terminalSessionId || "").trim();
  if (isTerminalMode && !terminalSessionId) {
    return { ok: false, message: "缺少终端会话标识" };
  }

  const existingWindow = isTerminalMode
    ? terminalPipWindows.get(terminalSessionId)
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
    alwaysOnTop: isUtilityMode ? false : true,
    titleBarStyle: isUtilityMode ? "default" : "hiddenInset",
    trafficLightPosition: isUtilityMode ? undefined : { x: 12, y: 12 },
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
  } else {
    viewerPipWindow = nextPipWindow;
  }

  bindDevToolsShortcut(nextPipWindow);
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
    if (url.startsWith("file://") || url.startsWith("about:")) return;
    event.preventDefault();
    shell.openExternal(url);
  });
  nextPipWindow.loadFile(indexFile, { query: Object.fromEntries(query.entries()) });

  nextPipWindow.on("closed", () => {
    if (isTerminalMode) {
      if (terminalPipWindows.get(terminalSessionId) === nextPipWindow) {
        terminalPipWindows.delete(terminalSessionId);
      }
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
    titleBarStyle: "hiddenInset",
    // 红绿灯位置保持不动（实测渲染圆心 = y+7.5 ≈ 19.5px），mac 沉浸式的侧栏按钮行
    // 与工作区页签条在 CSS 里对齐这条中线（见 styles-sidebar-toolbar.css）
    trafficLightPosition: { x: 12, y: 12 },
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
    if (url.startsWith("file://") || url.startsWith("about:")) return;
    event.preventDefault();
    shell.openExternal(url);
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
