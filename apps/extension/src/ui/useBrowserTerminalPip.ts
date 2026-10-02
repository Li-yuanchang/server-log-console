import { useCallback, useEffect, useRef, useState } from "react";

/* 浏览器 Document Picture-in-Picture 终端小窗（对应原型 T7）。
   契约（重写版，修复「React 管理子树整体搬迁 → DOM 失配」一组 bug）：
   - 只搬调用方给的单个元素（容器传 .terminal-main-shell 单节点）；
   - open 时记录 parentNode / nextSibling 锚点；close() 或用户点 PiP 自带叉（pagehide）
     时用 parent.insertBefore(el, nextSibling) 精确放回原位
     （修复旧实现放回祖父级 slot → 主窗布局破碎 / reconcile 崩溃白屏）；
   - 搬入后按 [80,240,600,1200]ms 连发 onFit 并监听 PiP window 的 resize → onFit
     （修复 xterm 在新窗口不重新 fit，内容只占左侧一条）；
   - hook 卸载时若仍在 PiP：先同步放回再关窗（防 React 卸载该子树时 removeChild 扑空 → 白屏）。
   仅负责浏览器路径；Electron 走 electronAPI.openPipWindow（App 侧接线），与本 hook 无关。 */

type DocumentPictureInPictureWindowApi = {
  requestWindow: (options: { width: number; height: number }) => Promise<Window>;
};

const browserPipSupported = typeof window !== "undefined" && "documentPictureInPicture" in window;

/** 搬入 PiP 后的 xterm 重排时刻表（ms）：新窗口首轮布局 / 字体加载 / 尺寸稳定各补一次 fit */
const FIT_SCHEDULE_MS = [80, 240, 600, 1200] as const;

export interface BrowserTerminalPipOpenOptions {
  /** 被搬进 PiP 的单个元素（容器传 .terminal-main-shell） */
  el: HTMLElement;
  /** PiP 窗口标题（服务器名） */
  title: string;
  /** 搬入/放回后的 xterm 重排回调 */
  onFit?: () => void;
}

export function useBrowserTerminalPip(): {
  /** 浏览器 PiP 打开中 */
  isPip: boolean;
  /** "documentPictureInPicture" in window */
  supported: boolean;
  /** 搬入 PiP 窗口（幂等：已打开/正在打开时忽略） */
  open: (opts: BrowserTerminalPipOpenOptions) => Promise<void>;
  /** 同步放回原位 + 关窗（幂等：未打开时是 no-op） */
  close: () => void;
} {
  const [isPip, setIsPip] = useState(false);
  /* 窗口 / 被搬节点 / 锚点 / 回调全走 ref：close 与 pagehide 内即时可读，不依赖 state 更新时机 */
  const pipWindowRef = useRef<Window | null>(null);
  const movedElRef = useRef<HTMLElement | null>(null);
  const anchorParentRef = useRef<Node | null>(null);
  const anchorNextRef = useRef<Node | null>(null);
  const onFitRef = useRef<(() => void) | null>(null);
  const openingRef = useRef(false);
  /* 卸载 cleanup 经 ref 调最新 close（避免 effect 闭包捕获旧函数） */
  const closeRef = useRef<() => void>(() => {});

  /** 按时刻表连发 onFit（fitTerminal 内部另有去抖连发，这里只负责补触发） */
  const runFitSequence = useCallback(() => {
    for (const delay of FIT_SCHEDULE_MS) {
      window.setTimeout(() => onFitRef.current?.(), delay);
    }
  }, []);

  /** 被搬节点精确放回原位（原父节点 + 原后继兄弟）。幂等：放回后清空锚点。 */
  const restoreEl = useCallback(() => {
    const el = movedElRef.current;
    const parent = anchorParentRef.current;
    const next = anchorNextRef.current;
    anchorParentRef.current = null;
    anchorNextRef.current = null;
    if (!el || !parent) {
      return;
    }
    try {
      if (next && next.parentNode === parent) {
        /* 锚点仍有效：精确放回原位 */
        parent.insertBefore(el, next);
      } else if (parent.firstChild && parent.firstChild !== el) {
        /* 原后继兄弟已被 React 卸载重挂（如 AI 抽屉在 PiP 期间开合）：
           shell 恒为 .terminal-body-layout 的首个 React 子节点，放回首子即可对齐 fiber 结构 */
        parent.insertBefore(el, parent.firstChild);
      } else {
        parent.appendChild(el);
      }
    } catch (error) {
      console.error("Failed to restore terminal shell from PiP:", error);
    }
  }, []);

  const close = useCallback(() => {
    const pip = pipWindowRef.current;
    if (!pip) {
      return;
    }
    pipWindowRef.current = null;
    /* 先同步放回，再关窗：React 后续 commit 时真实 DOM 已与 fiber 对齐 */
    restoreEl();
    setIsPip(false);
    runFitSequence();
    /* pagehide 仍会触发，但锚点已清空 → restoreEl 幂等，状态分支也不再进入 */
    pip.close();
  }, [restoreEl, runFitSequence]);
  closeRef.current = close;

  const open = useCallback(
    async (opts: BrowserTerminalPipOpenOptions) => {
      const { el, title, onFit } = opts;
      /* 幂等护栏：已打开或正在打开（requestWindow await 期间连点）时忽略 */
      if (pipWindowRef.current || openingRef.current) {
        return;
      }
      if (!browserPipSupported) {
        alert("当前浏览器不支持 Document Picture-in-Picture API");
        return;
      }
      const pipApi = (window as Window & { documentPictureInPicture?: DocumentPictureInPictureWindowApi })
        .documentPictureInPicture;
      if (!pipApi) {
        alert("当前浏览器不支持 Document Picture-in-Picture API");
        return;
      }
      if (!el.isConnected) {
        console.warn("useBrowserTerminalPip: element is not connected, skip opening PiP");
        return;
      }

      openingRef.current = true;
      try {
        const pip = await pipApi.requestWindow({ width: 720, height: 440 });

        /* 复制全部样式表到 PiP 窗口：外链用 <link>，内联用 <style>；跨域样式表静默跳过 */
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
                style.textContent += `${rule.cssText}\n`;
              }
              pip.document.head.appendChild(style);
            }
          } catch {}
        }

        /* 同步 body class（主题）与窗口标题（服务器名） */
        pip.document.body.className = document.body.className;
        const titleEl = pip.document.createElement("title");
        titleEl.textContent = title;
        pip.document.head.appendChild(titleEl);
        pip.document.title = title;

        /* 记录原位锚点（修复②的关键）后整体搬入 PiP 窗口：
           包一层 .pip-terminal-root（全尺寸样式见 styles-pip-toast.css） */
        anchorParentRef.current = el.parentNode;
        anchorNextRef.current = el.nextSibling;
        movedElRef.current = el;
        onFitRef.current = onFit ?? null;
        const wrapper = pip.document.createElement("div");
        wrapper.className = "pip-terminal-root";
        wrapper.appendChild(el);
        pip.document.body.appendChild(wrapper);

        /* PiP 窗口尺寸变化 → xterm 重新 fit（主文档 ResizeObserver 收不到新窗口的布局通知） */
        pip.addEventListener("resize", () => onFitRef.current?.());

        /* pagehide（用户点 PiP 自带叉，或 close() 关窗的收尾）：放回 + 状态复位 + 重排序列 */
        pip.addEventListener("pagehide", () => {
          restoreEl();
          if (pipWindowRef.current === pip) {
            pipWindowRef.current = null;
            setIsPip(false);
            runFitSequence();
          }
        });

        pipWindowRef.current = pip;
        setIsPip(true);

        /* 修复①：搬入新窗口后 xterm 不会自动重新 fit，按 [80,240,600,1200]ms 连发补齐 */
        for (const delay of FIT_SCHEDULE_MS) {
          window.setTimeout(() => {
            if (pipWindowRef.current === pip) {
              onFitRef.current?.();
            }
          }, delay);
        }
      } catch (error) {
        console.error("Failed to open terminal PiP:", error);
      } finally {
        openingRef.current = false;
      }
    },
    [restoreEl, runFitSequence],
  );

  /* 卸载护栏：PiP 还开着就先同步放回再关窗（防 React 卸载子树时 removeChild 扑空 → 白屏） */
  useEffect(() => {
    return () => {
      closeRef.current();
    };
  }, []);

  return {
    isPip,
    supported: browserPipSupported,
    open,
    close,
  };
}
