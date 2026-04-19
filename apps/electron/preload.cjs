const { contextBridge, ipcRenderer } = require("electron");

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
  saveFile: (buffer, defaultName) => ipcRenderer.invoke("save-file", buffer, defaultName),
  revealLocalPath: (targetPath) => ipcRenderer.invoke("reveal-local-path", targetPath),
});
