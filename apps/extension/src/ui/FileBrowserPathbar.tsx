import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { RefObject } from "react";

type BreadcrumbItem = { label: string; path: string };

type Props = {
  mode: "browse" | "edit";
  directoryInput: string;
  currentDirectory: string;
  breadcrumbItems: BreadcrumbItem[];
  inputRef: RefObject<HTMLInputElement | null>;
  hasServer: boolean;
  onSetDirectoryInput: (value: string) => void;
  onEnterEditMode: () => void;
  onExitEditMode: () => void;
  onOpenFromInput: () => void;
  onCommitDirectoryPath: (path: string) => void;
};

/**
 * 面包屑折叠阈值：优先完整显示「当前目录 + 前 3 级」（尾部 4 段）。
 * 真放不下时，把更老的层级折成一枚「…」——「…」可点开列出被隐藏层级。
 * （2026-10-12 用户设想：「重点显示当前目录以及前 3 级别目录；真显示不全时在前 3+N 自动省略」。）
 */
const TAIL_KEEP = 4;

/**
 * 面包屑是「优先当前 + 前 3 级」的弹性折叠：
 *  - 放得下：全量显示（无「…」）；
 *  - 放不下：保留首段（根/首级）+「…」+ 末 TAIL_KEEP 段；仍放不下则逐段减到 1，
 *    永远保住当前目录本身（当前段过长时自身省略号收尾，见 CSS）。
 * 折叠在「导航到新路径」时重置，重新从全量开始试。
 * 「…」弹层经 portal 渲染到 .app-shell：面包屑容器是 overflow:hidden（折叠需要），
 * 内联弹层会被裁掉。
 */
export function FileBrowserPathbar(props: Props) {
  const { mode, breadcrumbItems } = props;

  const containerRef = useRef<HTMLDivElement | null>(null);
  // null = 全量显示；数字 = 只保留末尾 N 段（其余折进「…」）
  const [visibleTail, setVisibleTail] = useState<number | null>(null);
  const [moreAnchor, setMoreAnchor] = useState<{ left: number; top: number } | null>(null);
  const [, setMeasureTick] = useState(0);

  const signature = breadcrumbItems.map((item) => item.path).join("\u0000");
  const moreOpen = moreAnchor !== null;

  const closeMore = useCallback(() => setMoreAnchor(null), []);

  const commitPath = useCallback((path: string) => {
    setMoreAnchor(null);
    props.onCommitDirectoryPath(path);
  }, [props]);

  /* 导航到新路径：折叠状态归零，重新从「全量」开始试放 */
  useEffect(() => {
    setVisibleTail(null);
    setMoreAnchor(null);
  }, [signature]);

  /* 折叠收敛（无依赖数组：每次渲染后廉价量一次）。
     收缩：放不下 → 从 TAIL_KEEP 起步逐段减到 1（永远保住当前目录）。
     复原：容器**变宽**超过上次收敛时记录的宽度 → 重置为全量重试一次（再按需收缩）。
     用 settledWidthRef 只记「变宽」事件，避免「展开→放不下→收缩→放得下→再展开」
     的震荡死循环：每档宽度只重试一次。 */
  const settledWidthRef = useRef(-1);
  useLayoutEffect(() => {
    if (mode === "edit") {
      return;
    }
    const el = containerRef.current;
    if (!el) {
      return;
    }
    const clientWidth = el.clientWidth;
    if (clientWidth > settledWidthRef.current + 1 && visibleTail !== null) {
      settledWidthRef.current = clientWidth;
      setVisibleTail(null);
      return;
    }
    settledWidthRef.current = clientWidth;

    const fits = el.scrollWidth <= clientWidth + 1;
    if (visibleTail === null) {
      if (!fits && breadcrumbItems.length > TAIL_KEEP + 1) {
        setVisibleTail(TAIL_KEEP);
      }
      return;
    }
    if (!fits && visibleTail > 1) {
      setVisibleTail(visibleTail - 1);
    }
  });

  /* 容器尺寸变化（窗口 / 侧栏档位 / 列宽拖动）时重新测量：
     ⚠️ 依赖里不能含 tick —— 否则每次 tick 都 disconnect+observe，observe 首调又触发
     tick 形成抖动循环。observer 只在 mode 变化时重建。 */
  useEffect(() => {
    if (mode === "edit") {
      return;
    }
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === "undefined") {
      return;
    }
    const observer = new ResizeObserver(() => setMeasureTick((tick) => tick + 1));
    observer.observe(el);
    return () => observer.disconnect();
  }, [mode]);

  /* 「…」弹层：外点 / Esc / 滚动即关，避免定位失效残影 */
  useEffect(() => {
    if (!moreOpen) {
      return;
    }
    const close = () => setMoreAnchor(null);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    document.addEventListener("pointerdown", close, true);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", close, true);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [moreOpen]);

  if (mode === "edit") {
    return (
      <input
        ref={props.inputRef}
        className="directory-input"
        value={props.directoryInput}
        onChange={(event) => props.onSetDirectoryInput(event.target.value)}
        onBlur={props.onExitEditMode}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            props.onOpenFromInput();
            return;
          }
          if (event.key === "Escape") {
            event.preventDefault();
            props.onExitEditMode();
          }
        }}
        placeholder="/home/app/logs"
        disabled={!props.hasServer}
      />
    );
  }

  const items = breadcrumbItems;
  const lastIndex = items.length - 1;
  const collapsed = visibleTail !== null && items.length > visibleTail + 1;
  const tailStart = collapsed ? items.length - visibleTail! : 0;
  /* 被折进「…」的层级（不含首段，首段始终保留作定位锚点） */
  const hiddenItems = collapsed ? items.slice(1, tailStart) : [];

  const portalTarget = typeof document !== "undefined"
    ? (document.querySelector(".app-shell") as HTMLElement | null) ?? document.body
    : null;

  return (
    <>
      <div
        ref={containerRef}
        className={props.hasServer ? "pathbar-breadcrumbs" : "pathbar-breadcrumbs is-disabled"}
        onClick={() => props.onEnterEditMode()}
      >
        {items.map((item, index) => {
          /* 折叠态：首段之后、tailStart 之前的层级不渲染（改由「…」承载） */
          if (collapsed && index > 0 && index < tailStart) {
            if (index !== 1) {
              return null;
            }
            return (
              <div className="pathbar-breadcrumb-node" key="__more__">
                <span className="pathbar-breadcrumb-separator">›</span>
                <button
                  type="button"
                  className="pathbar-breadcrumb-item pathbar-breadcrumb-more"
                  title={hiddenItems.map((entry) => entry.path).join("\n")}
                  aria-label={`展开被隐藏的 ${hiddenItems.length} 级目录`}
                  aria-expanded={moreOpen}
                  disabled={!props.hasServer}
                  onClick={(event) => {
                    event.stopPropagation();
                    if (moreOpen) {
                      setMoreAnchor(null);
                      return;
                    }
                    const rect = event.currentTarget.getBoundingClientRect();
                    setMoreAnchor({ left: rect.left, top: rect.bottom + 4 });
                  }}
                >
                  …
                </button>
              </div>
            );
          }

          const isLast = index === lastIndex;
          return (
            <div className="pathbar-breadcrumb-node" key={item.path}>
              {/* S6 原型：面包屑段间用 › 分隔（首段之后每段都有） */}
              {index > 0 ? <span className="pathbar-breadcrumb-separator">›</span> : null}
              {/* D1: 面包屑跳转是只读导航，忙碌期间保持可用 */}
              <button
                type="button"
                className={isLast ? "pathbar-breadcrumb-item is-current" : "pathbar-breadcrumb-item"}
                title={item.path}
                onClick={(event) => {
                  event.stopPropagation();
                  if (isLast) {
                    props.onEnterEditMode();
                    return;
                  }
                  commitPath(item.path);
                }}
                disabled={!props.hasServer}
              >
                {item.label}
              </button>
            </div>
          );
        })}
      </div>
      {moreOpen && moreAnchor && hiddenItems.length > 0 && portalTarget
        ? createPortal(
            <div
              className="pathbar-breadcrumb-more-menu"
              style={{ position: "fixed", left: moreAnchor.left, top: moreAnchor.top }}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => event.stopPropagation()}
            >
              {hiddenItems.map((entry) => (
                <button
                  key={entry.path}
                  type="button"
                  className="pathbar-breadcrumb-more-item"
                  title={entry.path}
                  onClick={() => commitPath(entry.path)}
                >
                  {entry.label}
                </button>
              ))}
            </div>,
            portalTarget
          )
        : null}
    </>
  );
}

export function buildBreadcrumbItems(value: string): BreadcrumbItem[] {
  const normalized = (value || "/").trim();
  if (!normalized || normalized === "/") {
    return [{ label: "/", path: "/" }];
  }

  const trimmed = normalized.length > 1 ? normalized.replace(/\/+$/, "") : normalized;
  const absolutePath = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  const segments = absolutePath.split("/").filter(Boolean);

  // S6 原型（628-630）：面包屑为 `/data › logs › eos`，首段整体带前导斜杠，
  // 不额外拆出一个独立的根段「/」。
  let currentPath = "";
  return segments.map((segment, index) => {
    currentPath += `/${segment}`;
    return { label: index === 0 ? currentPath : segment, path: currentPath };
  });
}
