import { useEffect, useState } from "react";

/**
 * 窗口最大化状态（2026-11-10）。
 *
 * 单一数据源：自绘窗口按钮（图标切换）与窗口圆角（最大化归零）都读这里，
 * 避免两处各自订阅 IPC 出现短暂不一致。
 *
 * 非 Electron / macOS 下恒为 false（macOS 用系统红绿灯，不需要自绘圆角）。
 */
export function useWindowMaximized(): boolean {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    const api = (window as any).electronAPI;
    if (!api?.isWindowMaximized) return;
    let disposed = false;
    void api.isWindowMaximized().then((value: boolean) => {
      if (!disposed) setMaximized(Boolean(value));
    });
    const off = api.onWindowMaximizeChanged?.((value: boolean) => setMaximized(Boolean(value)));
    return () => {
      disposed = true;
      off?.();
    };
  }, []);

  return maximized;
}
