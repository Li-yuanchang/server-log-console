const { app, BrowserWindow, Menu, Tray, nativeImage, ipcMain, shell } = require("electron");
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const http = require("http");

if (app && app.setName) app.setName("日志控制台");

const PORT = 4040;
const HOST = "127.0.0.1";
const GATEWAY_URL = `http://${HOST}:${PORT}`;

let mainWindow = null;
let gatewayProcess = null;
let tray = null;
let isAlwaysOnTop = false;

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
        try { resolve(JSON.parse(body).ok === true); } catch { resolve(false); }
      });
    });
    req.on("error", () => resolve(false));
    req.on("timeout", () => { req.destroy(); resolve(false); });
  });
}

async function startGateway() {
  if (await checkHealth()) {
    console.log("Gateway already running");
    return;
  }

  const entry = getGatewayEntry();
  const cwd = getGatewayCwd();
  console.log(`Starting gateway: ${entry}`);

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
  gatewayProcess.stdout.on("data", (d) => console.log(`[gw] ${d.toString().trim()}`));
  gatewayProcess.stderr.on("data", (d) => console.error(`[gw] ${d.toString().trim()}`));
  gatewayProcess.on("exit", (code) => {
    console.log(`Gateway exited with code ${code}`);
    gatewayProcess = null;
  });
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
        { role: "toggleDevTools" },
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

// --- PiP Window ---
let pipWindow = null;

ipcMain.handle("open-pip-window", (_event, config) => {
  if (pipWindow) {
    pipWindow.focus();
    return { ok: true };
  }

  const query = new URLSearchParams();
  query.set("pip", config.mode || "viewer");
  if (config.serverId) query.set("serverId", config.serverId);
  if (config.filePath) query.set("filePath", config.filePath);
  if (config.directoryPath) query.set("directoryPath", config.directoryPath);
  if (config.bastionId) query.set("bastionId", config.bastionId);
  if (config.activeLogView) query.set("activeLogView", config.activeLogView);

  pipWindow = new BrowserWindow({
    width: config.width || 860,
    height: config.height || 520,
    title: config.title || "日志控制台",
    alwaysOnTop: true,
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 12, y: 12 },
    backgroundColor: "#1a1a2e",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  pipWindow.loadURL(`http://${HOST}:${PORT}/?${query.toString()}`);

  pipWindow.on("closed", () => {
    pipWindow = null;
    if (mainWindow) {
      mainWindow.webContents.send("pip-window-closed");
    }
  });

  return { ok: true };
});

ipcMain.handle("close-pip-window", () => {
  if (pipWindow) {
    pipWindow.close();
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
    backgroundColor: "#e3e7eb",
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 12, y: 12 },
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  probe("createWindow browserWindow created");

  // Load local file directly — renders instantly, no server needed
  mainWindow.loadFile(indexFile);
  probe("createWindow loadFile called");
  mainWindow.once("ready-to-show", () => mainWindow.show());
  mainWindow.once("ready-to-show", () => probe("createWindow ready-to-show"));
  mainWindow.webContents.on("did-finish-load", () => probe("createWindow did-finish-load"));
  mainWindow.webContents.on("did-fail-load", (_event, code, description) => probe(`createWindow did-fail-load ${code} ${description}`));
  mainWindow.webContents.on("render-process-gone", (_event, details) => probe(`createWindow render-process-gone ${details.reason} ${details.exitCode}`));

  mainWindow.on("closed", () => {
    probe("createWindow window closed");
    mainWindow = null;
  });

  // Dev shortcut: Cmd+Shift+I to toggle DevTools
  mainWindow.webContents.on("before-input-event", (_event, input) => {
    if (input.meta && input.shift && input.key === "i") {
      mainWindow.webContents.toggleDevTools();
    }
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url === "about:blank" || url.startsWith("about:")) {
      return { action: "allow" };
    }
    shell.openExternal(url);
    return { action: "deny" };
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
    { label: "开发者工具", click: () => { if (mainWindow) { mainWindow.webContents.toggleDevTools(); } } },
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
