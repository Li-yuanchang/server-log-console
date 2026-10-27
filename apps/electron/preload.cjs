const { contextBridge, ipcRenderer, webUtils } = require("electron");

/* 平台类（2026-10-24 随 Windows 自绘标题栏引入）：
   - is-electron：通用 Electron 条件样式（沉浸式拖拽区等）
   - is-win32 / is-macos / is-linux：按平台区分样式钩子
     （renderer 侧 navigator.platform 在 Electron 32 已弃用且不一定可靠，
      直接由主进程给权威值。） */
const addPlatformClasses = () => {
  const cls = document.body.classList;
  cls.add("is-electron");
  cls.add(process.platform === "win32" ? "is-win32" : process.platform === "darwin" ? "is-macos" : "is-linux");
};
if (document.body) addPlatformClasses();
else document.addEventListener("DOMContentLoaded", addPlatformClasses);

contextBridge.exposeInMainWorld("electronAPI", {
  /** 网关访问令牌（桌面端自动注入，用户无需配置） */
  getGatewayToken: () => ipcRenderer.invoke("slc:gateway-token"),

  /* ---------- 上传进度小窗 ---------- */
  /** 打开上传进度小窗（只在 Electron 可用；浏览器形态无此入口） */
  openTransferPip: (config) => ipcRenderer.invoke("open-pip-window", { ...config, mode: "transfer" }),
  /** 主窗口 → 小窗：推送进度 */
  sendTransferProgress: (payload) => ipcRenderer.send("slc:transfer:progress", payload),
  /** 小窗 → 主窗口：请求暂停/继续/取消 */
  sendTransferControl: (action) => ipcRenderer.send("slc:transfer:control", action),
  /** 主窗口订阅小窗控制指令（返回取消订阅函数） */
  onTransferControl: (handler) => {
    const listener = (_event, action) => handler(action);
    ipcRenderer.on("slc:transfer:control", listener);
    return () => ipcRenderer.removeListener("slc:transfer:control", listener);
  },
  /** 小窗订阅进度更新 */
  onTransferProgress: (handler) => {
    const listener = (_event, payload) => handler(payload);
    ipcRenderer.on("slc:transfer:progress", listener);
    return () => ipcRenderer.removeListener("slc:transfer:progress", listener);
  },

  /* 平台标识：前端据此决定是否渲染自绘窗口控制按钮 */
  platform: process.platform,
  /* Windows 自绘标题栏的窗口控制（2026-10-24 方案 B）。
     macOS/Linux 前端不渲染按钮，这里保持通用（按发送方窗口操作）。 */
  minimizeWindow: () => ipcRenderer.invoke("slc:win:minimize"),
  toggleMaximizeWindow: () => ipcRenderer.invoke("slc:win:toggle-maximize"),
  closeWindow: () => ipcRenderer.invoke("slc:win:close"),
  isWindowMaximized: () => ipcRenderer.invoke("slc:win:is-maximized"),
  onWindowMaximizeChanged: (callback) => {
    const handler = (_event, maximized) => callback(maximized);
    ipcRenderer.on("slc:win:maximize-changed", handler);
    return () => ipcRenderer.removeListener("slc:win:maximize-changed", handler);
  },
  togglePin: () => ipcRenderer.invoke("toggle-pin"),
  getPin: () => ipcRenderer.invoke("get-pin"),
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
