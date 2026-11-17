import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

// R1：应用根元素 <main class="app-shell theme-modern ...">（见 App.tsx appShellClassName）
// 挂着全部主题类（theme-modern、ui-theme-*、ui-density-* 等）。createPortal 到
// document.body 的内容落在 .theme-modern 作用域之外，`.theme-modern .xxx` 令牌/
// 后代选择器全部失配 —— --panel 等令牌回落成经典主题的纯白/灰底。
// 这里收敛两类既有补丁（此前散落在 Drawer / CommandPalette / ThemedSelect /
// ServerMonitorCard / FileBrowserPathbar / ImmediateTooltip 各自手写）：
// 1. <ThemePortal>：portal 外包一层 display:contents 的壳、类名复制自 .app-shell
//    —— 不生成盒模型、不影响布局，仅让令牌与后代选择器恢复命中（fixed 定位
//    仍相对视口，不受影响）；
// 2. getPortalContainer()：直接以 .app-shell 元素为 portal 容器（类名原地更新，
//    天然跟随主题切换）。
// 类名默认"渲染时读一次"（非响应式，与被替换各处一致）；需要主题切换即时生效的
// 场景（如 ServerMonitorCard 体检弹窗）用 useShellThemeClass() 经 className 传入。

const FALLBACK_THEME_CLASS = "theme-modern";

/** 宿主 .app-shell 元素（主题类挂载点）。doc 缺省取当前 document；非 DOM 环境返回 null */
export function getAppShellElement(doc?: Document): HTMLElement | null {
  const d = doc ?? (typeof document === "undefined" ? null : document);
  return d ? (d.querySelector(".app-shell") as HTMLElement | null) : null;
}

/** 渲染时读一次 .app-shell 类名（非响应式）：切主题后若组件不重渲染会停在旧类 */
function readShellThemeClassName(): string {
  return getAppShellElement()?.className ?? FALLBACK_THEME_CLASS;
}

/** 响应式读取 .app-shell 类名：直接读只在渲染时取一次，用户切主题时弹窗不重渲染
 *  会停在旧主题 —— 用 MutationObserver 订阅 class 变化，主题切换即时生效。 */
export function useShellThemeClass(): string {
  const [cls, setCls] = useState(readShellThemeClassName);
  useEffect(function () {
    const shell = getAppShellElement();
    if (!shell) return;
    setCls(shell.className);
    const ob = new MutationObserver(function () { setCls(shell.className); });
    ob.observe(shell, { attributes: true, attributeFilter: ["class"] });
    return function () { ob.disconnect(); };
  }, []);
  return cls;
}

export type ThemePortalProps = {
  children: ReactNode;
  /** 覆盖默认的类名读取（传 useShellThemeClass() 的结果可响应主题切换） */
  className?: string;
};

// portal 主题壳（手法一）：portal 到 body + display:contents 壳，类名复制自 .app-shell。
export function ThemePortal(props: ThemePortalProps) {
  return createPortal(
    <div className={props.className ?? readShellThemeClassName()} style={{ display: "contents" }}>
      {props.children}
    </div>,
    document.body
  );
}

// portal 容器（手法二）：直接挂进 .app-shell，查不到时回落 body（与既有各处一致）。
export function getPortalContainer(doc?: Document): HTMLElement | null {
  const d = doc ?? (typeof document === "undefined" ? null : document);
  return d ? getAppShellElement(d) ?? d.body : null;
}
