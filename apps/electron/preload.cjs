const { contextBridge, ipcRenderer, webUtils } = require("electron");

// Mark body with is-electron class for conditional CSS (e.g. immersive titlebar padding)
const addElectronClass = () => document.body.classList.add("is-electron");
if (document.body) addElectronClass();
else document.addEventListener("DOMContentLoaded", addElectronClass);

contextBridge.exposeInMainWorld("electronAPI", {
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
