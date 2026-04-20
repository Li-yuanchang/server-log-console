import { useState, useEffect } from "react";

export type ElectronEnvAPI = {
  isElectron: boolean;
  isMacOS: boolean;
};

export function useElectronEnv(): ElectronEnvAPI {
  const [isElectron] = useState(() => !!(window as any).electronAPI || /Electron/.test(navigator.userAgent));
  const [isMacOS] = useState(() => navigator.userAgent.includes("Mac") || navigator.platform.toUpperCase().includes("MAC"));

  useEffect(() => {
    if (isElectron) {
      document.body.classList.add("is-electron");
    }
  }, [isElectron]);

  return { isElectron, isMacOS };
}
