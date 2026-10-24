import { useEffect, useState } from "react";
import { Copy, Minus, Square, X } from "lucide-react";

/**
 * Windows 自绘窗口控制按钮（2026-10-24 方案 B）。
 *
 * 背景：Windows 主窗口已改无边框（main.cjs titleBarStyle:"hidden"），
 * 系统的最小化/最大化/关闭按钮随之消失，这里用普通 DOM 画回来：
 *  - 颜色/悬停/过渡全部走主题 token（--ink/--red 等），切主题即时跟随，
 *    且能用 CSS transition 做渐进过渡（titleBarOverlay 方案做不到）；
 *  - 按钮经 slc:win:* IPC 控制真实窗口，双击拖拽区最大化由 drag 区系统处理；
 *  - 容器 no-drag（周围顶带是 electron-immersive 的 drag 区，负责拖拽窗口）。
 * 仅在 Windows Electron 主窗口渲染（由调用方决定）；macOS 用系统红绿灯，
 * PiP 小窗仍走系统原生标题栏。
 */
export function WindowControls() {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    const api = (window as any).electronAPI;
    if (!api) return;
    let disposed = false;
    void api.isWindowMaximized?.().then((value: boolean) => {
      if (!disposed) setMaximized(Boolean(value));
    });
    const off = api.onWindowMaximizeChanged?.((value: boolean) => setMaximized(Boolean(value)));
    return () => {
      disposed = true;
      off?.();
    };
  }, []);

  return (
    <div className="win-window-controls">
      <button
        type="button"
        className="win-ctl-btn"
        title="最小化"
        aria-label="最小化"
        onClick={() => (window as any).electronAPI?.minimizeWindow?.()}
      >
        <Minus size={15} strokeWidth={1.8} />
      </button>
      <button
        type="button"
        className="win-ctl-btn"
        title={maximized ? "向下还原" : "最大化"}
        aria-label={maximized ? "向下还原" : "最大化"}
        onClick={() => void (window as any).electronAPI?.toggleMaximizeWindow?.()}
      >
        {maximized ? <Copy size={13} strokeWidth={1.8} /> : <Square size={12} strokeWidth={1.8} />}
      </button>
      <button
        type="button"
        className="win-ctl-btn win-ctl-close"
        title="关闭"
        aria-label="关闭"
        onClick={() => (window as any).electronAPI?.closeWindow?.()}
      >
        <X size={16} strokeWidth={1.8} />
      </button>
    </div>
  );
}
