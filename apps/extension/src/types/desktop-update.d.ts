/**
 * 桌面端在线更新：主进程经 preload 暴露的 window.slcDesktopUpdate。
 * 契约见 docs/在线更新与打包方案.md §4.3（main.cjs 状态机 → IPC `slc:update:*` → preload）。
 */
export type SlcDesktopUpdateStatus =
  | "idle"
  | "checking"
  | "unavailable"
  | "up-to-date"
  | "available"
  | "downloading"
  | "ready"
  | "error";

export type SlcDesktopUpdateState = {
  status: SlcDesktopUpdateStatus;
  error: string | null;
  appInfo: { version: string; platform: "darwin" | "win32" | "linux"; arch: string; packaged: boolean } | null;
  updateInfo: { version: string; releaseDate?: string; releaseNotes?: string } | null;
  progress: { percent: number; transferred: number; total: number; bytesPerSecond: number } | null;
  updateUrl: string | null;
};

export interface SlcDesktopUpdateApi {
  getState(): Promise<SlcDesktopUpdateState>;
  check(): Promise<SlcDesktopUpdateState>;
  download(): Promise<SlcDesktopUpdateState>;
  install(): void;
  onUpdateState(cb: (s: SlcDesktopUpdateState) => void): () => void;
}

declare global {
  /** Vite 构建时经 define 注入的 UI 版本号（未注入时 UI 以 "0.0.0" 兜底） */
  const __APP_VERSION__: string | undefined;
  interface Window {
    slcDesktopUpdate?: SlcDesktopUpdateApi;
    __APP_VERSION__?: string;
  }
}
