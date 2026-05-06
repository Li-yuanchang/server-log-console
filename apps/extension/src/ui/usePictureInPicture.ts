import { useCallback, useEffect, useRef, useState } from "react";

const isElectron = typeof window !== "undefined" && Boolean((window as any).electronAPI);

interface PipState {
  /** The PiP window object (null when not in PiP mode or in Electron IPC mode) */
  pipWindow: Window | null;
  /** Whether the viewer is currently in PiP mode */
  isPip: boolean;
  /** Toggle PiP on/off */
  togglePip: () => Promise<void>;
  /** Update PiP window title (browser Document PiP only) */
  setTitle: (title: string) => void;
}

export interface ElectronPipParams {
  serverId?: string;
  filePath?: string;
  directoryPath?: string;
  bastionId?: string;
  activeLogView?: string;
  errorHighlight?: boolean;
  liveFollow?: boolean;
}

/**
 * Hook to manage Picture-in-Picture.
 * - Browser: Document PiP API with createPortal
 * - Electron: IPC to create native BrowserWindow (alwaysOnTop)
 */
export function usePictureInPicture(options?: {
  width?: number;
  height?: number;
  onOpen?: () => void;
  onClose?: () => void;
  electronPipParams?: () => ElectronPipParams;
}): PipState {
  const { width = 980, height = 680, onOpen, onClose, electronPipParams } = options ?? {};
  const [pipWindow, setPipWindow] = useState<Window | null>(null);
  const [electronPipOpen, setElectronPipOpen] = useState(false);
  const pipWindowRef = useRef<Window | null>(null);
  const onCloseRef = useRef(onClose);
  const onOpenRef = useRef(onOpen);
  onCloseRef.current = onClose;
  onOpenRef.current = onOpen;

  const setTitle = useCallback((newTitle: string) => {
    const win = pipWindowRef.current;
    if (!win) return;
    const titleEl = win.document.querySelector("title") || win.document.createElement("title");
    titleEl.textContent = newTitle;
    if (!titleEl.parentNode) {
      win.document.head.appendChild(titleEl);
    }
    win.document.title = newTitle;
  }, []);

  // Listen for Electron PiP window closed event
  useEffect(() => {
    if (!isElectron) return;
    const api = (window as any).electronAPI;
    if (!api?.onPipClosed) return;
    api.onPipClosed((payload?: { mode?: "viewer" | "terminal" }) => {
      if (payload?.mode && payload.mode !== "viewer") {
        return;
      }
      setElectronPipOpen(false);
      onCloseRef.current?.();
    });
  }, []);

  const togglePip = useCallback(async () => {
    // --- Electron IPC mode ---
    if (isElectron) {
      const api = (window as any).electronAPI;
      if (electronPipOpen) {
        await api.closePipWindow();
        setElectronPipOpen(false);
        return;
      }
      const params = electronPipParams?.() ?? {};
      await api.openPipWindow({
        mode: "viewer",
        width,
        height,
        title: "日志控制台",
        ...params,
      });
      setElectronPipOpen(true);
      onOpenRef.current?.();
      return;
    }

    // --- Browser Document PiP mode ---
    if (pipWindowRef.current) {
      pipWindowRef.current.close();
      return;
    }

    if (!("documentPictureInPicture" in window)) {
      alert("当前浏览器不支持 Document Picture-in-Picture API");
      return;
    }

    try {
      const pip: Window = await (window as any).documentPictureInPicture.requestWindow({
        width,
        height,
      });

      // Copy all stylesheets into the PiP window
      for (const sheet of document.styleSheets) {
        try {
          if (sheet.href) {
            const link = pip.document.createElement("link");
            link.rel = "stylesheet";
            link.href = sheet.href;
            pip.document.head.appendChild(link);
          } else if (sheet.cssRules) {
            const style = pip.document.createElement("style");
            for (const rule of sheet.cssRules) {
              style.textContent += rule.cssText + "\n";
            }
            pip.document.head.appendChild(style);
          }
        } catch {
          // Skip cross-origin stylesheets
        }
      }

      // Copy body classes (for theme)
      pip.document.body.className = document.body.className;

      // Match color scheme
      pip.document.documentElement.style.colorScheme =
        document.documentElement.style.colorScheme || "";

      pip.addEventListener("pagehide", () => {
        pipWindowRef.current = null;
        setPipWindow(null);
        onCloseRef.current?.();
      });

      pipWindowRef.current = pip;
      setPipWindow(pip);
      onOpenRef.current?.();
    } catch (error) {
      console.error("Failed to open PiP window:", error);
    }
  }, [width, height, electronPipOpen, electronPipParams]);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      pipWindowRef.current?.close();
      pipWindowRef.current = null;
    };
  }, []);

  const isPip = isElectron ? electronPipOpen : pipWindow !== null;

  return {
    pipWindow,
    isPip,
    togglePip,
    setTitle,
  };
}
