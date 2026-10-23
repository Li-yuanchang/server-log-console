const { contextBridge, ipcRenderer, webUtils } = require("electron");

/* 平台类（2026-10-23）：
   - is-electron：通用 Electron 条件样式（沉浸式标题栏 padding 等）
   - is-win32 / is-macos：按平台区分。Windows 用 titleBarOverlay 接管标题栏后，
     网页内容会延伸到标题栏下方、被系统窗口按钮覆盖，需要按平台给内容让位。 */
const addPlatformClasses = () => {
  const cls = document.body.classList;
  cls.add("is-electron");
  cls.add(process.platform === "win32" ? "is-win32" : process.platform === "darwin" ? "is-macos" : "is-linux");
};
if (document.body) addPlatformClasses();
else document.addEventListener("DOMContentLoaded", addPlatformClasses);

contextBridge.exposeInMainWorld("electronAPI", {
  /* 平台标识（2026-10-23）：供前端判断是否需要同步 Windows 标题栏配色。
     renderer 侧 navigator.platform 在 Electron 32 已弃用且不一定可靠，
     直接由主进程给权威值。 */
  platform: process.platform,
  togglePin: () => ipcRenderer.invoke("toggle-pin"),
  getPin: () => ipcRenderer.invoke("get-pin"),
  /* Windows 标题栏配色跟随 UI 主题（2026-10-23）；其它平台主进程直接返回 false */
  setTitleBarOverlay: (payload) => ipcRenderer.invoke("slc:set-titlebar-overlay", payload),
  onPinChanged: (callback) => {
    ipcRenderer.on("pin-changed", (_event, pinned) => callback(pinned));
  },
  openPipWindow: (config) => ipcRenderer.invoke("open-pip-window", config),
  closePipWindow: (config) => ipcRenderer.invoke("close-pip-window", config),
  onPipClosed: (callback) => {
    ipcRenderer.on("pip-window-closed", (_event, payload) => callback(payload));
  },
  sendPipState: (state) => ipcRenderer.invoke("send-pip-state", state),
  onPipStateUpdate: (callback) => {
    const handler = (_event, state) => callback(state);
    ipcRenderer.on("pip-state-update", handler);
    return () => ipcRenderer.removeListener("pip-state-update", handler);
  },
  saveFile: (buffer, defaultName) => ipcRenderer.invoke("save-file", buffer, defaultName),
  revealLocalPath: (targetPath) => ipcRenderer.invoke("reveal-local-path", targetPath),
  localBrowse: (dirPath) => ipcRenderer.invoke("local-browse", dirPath),
  localReadFile: (filePath) => ipcRenderer.invoke("local-read-file", filePath),
  localPickDirectory: () => ipcRenderer.invoke("local-pick-directory"),
  localPickFiles: () => ipcRenderer.invoke("local-pick-files"),
  getPathForFile: (file) => webUtils.getPathForFile(file),
});

// 桌面端自动更新：状态查询、检查、下载、安装与状态订阅
contextBridge.exposeInMainWorld("slcDesktopUpdate", {
  getState: () => ipcRenderer.invoke("slc:update:get-state"),
  check: () => ipcRenderer.invoke("slc:update:check"),
  download: () => ipcRenderer.invoke("slc:update:download"),
  install: () => ipcRenderer.invoke("slc:update:install"),
  setSource: (url) => ipcRenderer.invoke("slc:update:set-source", url),
  onUpdateState: (callback) => {
    const handler = (_event, state) => callback(state);
    ipcRenderer.on("slc:update:state", handler);
    return () => ipcRenderer.removeListener("slc:update:state", handler);
  },
});
