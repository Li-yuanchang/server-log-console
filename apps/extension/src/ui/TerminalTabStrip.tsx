import { useEffect, useRef, useState } from "react";
import type { JSX, ReactNode } from "react";
import { Plus, X } from "lucide-react";

/**
 * 终端标签条（对应原型 T2 终端内多标签，含两层标签规则：标签组属于当前工作区）。
 * 形态对齐原型 .ttabs/.ttab：31px 高白底横条、底部 1px 描边、横向可滚动；
 * 标签左侧 6px 状态点，悬浮出 ×，active 浅蓝底 + accent 字加粗。
 * tooltip 走原生 title（由 ImmediateTooltip 接管渲染），tab 的 title = subtitle || title。
 */

/** 标签状态：绿=已连接 / 橙=连接中 / 红=已断开 / 灰=已关闭（对应原型 .dot on/wait/err/off） */
export type TerminalTabStatus = "connected" | "connecting" | "disconnected" | "closed";

export interface TerminalTabItem {
  tabId: string;
  title: string;
  subtitle?: string;
  status: TerminalTabStatus;
}

/** 右键菜单估宽，用于把菜单左缘夹在标签条右缘之内（与 CSS min-width 保持一致） */
const MENU_MIN_WIDTH = 172;

export function TerminalTabStrip({
  tabs,
  activeTabId,
  onSelect,
  onClose,
  onNew,
  canNew,
  onCloseOthers,
  onCloseAll,
  children,
}: {
  tabs: TerminalTabItem[];
  activeTabId: string | null;
  onSelect: (tabId: string) => void;
  onClose: (tabId: string) => void;
  onNew: () => void;
  canNew: boolean;
  onCloseOthers?: (tabId: string) => void;
  onCloseAll?: () => void;
  children?: ReactNode;
}): JSX.Element {
  const stripRef = useRef<HTMLDivElement | null>(null);
  // tab 右键菜单：记录目标 tab 与菜单相对标签条左缘的位置（菜单 absolute 挂在条内）
  const [menu, setMenu] = useState<{ tabId: string; left: number } | null>(null);

  // 菜单打开期间：点击条外 / 按 Esc 关闭
  useEffect(() => {
    if (!menu) return;
    const onPointerDown = (event: PointerEvent) => {
      if (
        stripRef.current &&
        event.target instanceof Node &&
        !stripRef.current.contains(event.target)
      ) {
        setMenu(null);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenu(null);
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [menu]);

  // 右键的 tab 已被关闭（如快捷键 ⌘W）时，菜单随之消失
  const menuVisible = menu != null && tabs.some((tab) => tab.tabId === menu.tabId);

  const openMenu = (tabId: string, tabEl: HTMLElement) => {
    const strip = stripRef.current;
    if (!strip) return;
    const stripRect = strip.getBoundingClientRect();
    const tabRect = tabEl.getBoundingClientRect();
    // 菜单左缘对齐被右键的 tab，超出右缘时往回夹
    const raw = tabRect.left - stripRect.left;
    const left = Math.max(4, Math.min(raw, stripRect.width - MENU_MIN_WIDTH - 4));
    setMenu({ tabId, left });
  };

  const runMenu = (action: () => void) => {
    setMenu(null);
    action();
  };

  return (
    <div className="terminal-tabs" ref={stripRef}>
      <div className="terminal-tabs-scroll">
        {tabs.map((tab) => {
          const active = tab.tabId === activeTabId;
          return (
            <div
              key={tab.tabId}
              role="button"
              tabIndex={0}
              className={active ? "terminal-tab terminal-tab-active" : "terminal-tab"}
              title={tab.subtitle || tab.title}
              onClick={() => onSelect(tab.tabId)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onSelect(tab.tabId);
                }
              }}
              onContextMenu={(event) => {
                event.preventDefault();
                openMenu(tab.tabId, event.currentTarget);
              }}
            >
              <span
                className={`terminal-tab-dot terminal-tab-dot-${tab.status}`}
                aria-hidden="true"
              />
              <span className="terminal-tab-title">{tab.title}</span>
              {/* × 关闭钮：悬浮（或 active）才显示；阻断冒泡避免触发 onSelect */}
              <span
                role="button"
                aria-label={`关闭 ${tab.title}`}
                className="terminal-tab-close"
                onClick={(event) => {
                  event.stopPropagation();
                  onClose(tab.tabId);
                }}
              >
                <X size={10} strokeWidth={2} />
              </span>
            </div>
          );
        })}
        {/* 末尾「新建终端」按钮（原型 .tnew，title=新建终端 ⌘T） */}
        <span
          role="button"
          aria-label="新建终端"
          aria-disabled={!canNew}
          className={canNew ? "terminal-tabs-new" : "terminal-tabs-new terminal-tabs-new-disabled"}
          title="新建终端 ⌘T"
          onClick={() => {
            if (canNew) onNew();
          }}
        >
          <Plus size={13} strokeWidth={2} />
        </span>
      </div>
      {/* 右侧空 spacer：父级不填 children 时自然收尾 */}
      <span className="terminal-tabs-spacer" aria-hidden="true" />
      {/* 父级传入的 kbd 提示（如「⌘T / ⌘W 新建 / 关闭标签」）渲染在 spacer 之后 */}
      {children}
      {menuVisible && menu ? (
        <div
          className="terminal-tabs-menu"
          style={{ left: menu.left }}
          onClick={(event) => event.stopPropagation()}
          onContextMenu={(event) => event.preventDefault()}
        >
          <div
            role="button"
            className="terminal-tabs-menu-item"
            onClick={() => runMenu(() => onClose(menu.tabId))}
          >
            关闭
            <span className="terminal-tabs-menu-key">⌘W</span>
          </div>
          {onCloseOthers ? (
            <div
              role="button"
              className="terminal-tabs-menu-item"
              onClick={() => runMenu(() => onCloseOthers(menu.tabId))}
            >
              关闭其他
            </div>
          ) : null}
          {onCloseAll ? (
            <div
              role="button"
              className="terminal-tabs-menu-item"
              onClick={() => runMenu(onCloseAll)}
            >
              全部关闭
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
