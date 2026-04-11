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
});
