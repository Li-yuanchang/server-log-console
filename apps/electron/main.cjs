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
    backgroundColor: "#0a0a0a",
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
  mainWindow.webContents.on("render-process-gone", (_event, details) => probe(`createWindow render-process-gone ${details.reason} ${details.exitCode}`));
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
    { label: "显示窗口", click: () => { if (mainWindow) { mainWindow.show(); mainWindow.focus(); } } },
    { label: "开发者工具", click: () => toggleDevTools() },
    { type: "separator" },
    { label: "退出", click: () => app.quit() },
  ]);
  tray.setContextMenu(contextMenu);
  tray.on("click", () => { if (mainWindow) { mainWindow.show(); mainWindow.focus(); } });
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

  app.on("activate", () => {
    probe("app activate");
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  probe("window-all-closed");
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  probe("before-quit");
  if (gatewayProcess) {
    gatewayProcess.kill();
    gatewayProcess = null;
  }
});
