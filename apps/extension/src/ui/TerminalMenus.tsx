/**
 * TerminalMenus — 终端菜单组件族（对应原型 T3 工具行「更多」菜单 / T10 终端与标签页右键菜单）。
 *
 * 全部为纯受控组件：显隐由父级管理（父级条件渲染），定位由父级给 absolute 坐标
 * （组件渲染在终端容器内，外层 .terminal-menu-anchor 接收 style，见 align-s5-terminal.css §6）。
 * 点击菜单项后的关闭由父级负责（各项 onSelect 内自行调用 onClose）；组件内部只处理：
 *  - 菜单内的点击 / 右键不冒泡（避免触发终端自身的选中清除等处理）
 *  - 点击菜单外（document mousedown）/ Esc 关闭（通过 props.onClose 回调）
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { JSX } from "react";
import {
  ClipboardCheck,
  ClipboardPaste,
  Columns2,
  Copy,
  Eraser,
  FolderOpen,
  RefreshCw,
  Rows2,
  ScrollText,
  Search,
  Settings,
  Trash2,
  Unplug,
  Upload,
  X,
  XSquare,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { formatKeyHint } from "./key-hints.js";

/** 单个菜单项定义 */
export interface MenuItemDef {
  key: string;
  icon: LucideIcon;
  label: string;
  /** 右侧快捷键标注（mono、灰色），按 macOS 习惯（⌘） */
  kbd?: string;
  /** 危险操作（红色） */
  danger?: boolean;
  /** 置灰不可点 */
  disabled?: boolean;
  /** 右侧灰色说明文字（与 kbd 互斥，kbd 优先） */
  hint?: string;
  /** 原生 title 提示（tooltip = 原生 title，同 ImmediateTooltip 约定） */
  title?: string;
  /** 点击回调；点击后菜单的关闭由父级在该回调里完成 */
  onSelect?: () => void;
}

/** 分隔线约定：items 中以 { key: "sep" } 表示 */
export type TerminalMenuItem = MenuItemDef | { key: "sep" };

interface TerminalMenuShellProps {
  x: number;
  y: number;
  items: TerminalMenuItem[];
  onClose: () => void;
}

/** 共用菜单壳：定位 + 分隔线 + 通用 item 布局 + 外点/Esc 关闭。
    导出给终端工作台容器自组菜单（如工具行「分屏 ▾」下拉）。
    定位策略：先按鼠标坐标渲染一次，再用真实尺寸量测并与可视边界比对，
    靠右/靠下放不下时自动翻转（右翻左、下翻上），最后做一次视口内收敛 —— 
    保证菜单贴着窗口底部或右侧右键时也完整可见。 */
export function TerminalMenuShell({ x, y, items, onClose }: TerminalMenuShellProps): JSX.Element {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  /* 首帧用原始坐标，量测后写入收敛坐标；null 表示尚未量测 */
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    const anchor = rootRef.current;
    const menu = anchor?.firstElementChild as HTMLElement | null;
    if (!anchor || !menu) {
      return;
    }
    /* 锚点以 absolute 坐标定位，其偏移父级即终端主壳 —— 用它当可视边界，
       而不是 window：终端区可能只占窗口一部分，菜单不能跑到抽屉/侧栏下面。 */
    const offsetParent = anchor.offsetParent as HTMLElement | null;
    const parentRect = offsetParent?.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const boundLeft = parentRect?.left ?? 0;
    const boundTop = parentRect?.top ?? 0;
    const boundRight = parentRect ? parentRect.right : viewportWidth;
    const boundBottom = parentRect ? parentRect.bottom : viewportHeight;
    /* 再与视口取交集：终端壳可能比视口更宽/更高（溢出滚动），两者都要满足 */
    const minLeft = Math.max(boundLeft, 0);
    const minTop = Math.max(boundTop, 0);
    const maxRight = Math.min(boundRight, viewportWidth);
    const maxBottom = Math.min(boundBottom, viewportHeight);

    const menuWidth = menu.offsetWidth;
    const menuHeight = menu.offsetHeight;
    const gap = 8;
    /* anchor 的 (x, y) 是相对 offsetParent 的坐标：先换算到视口坐标再判断翻转 */
    const viewportX = boundLeft + x;
    const viewportY = boundTop + y;

    /* 横向：默认右边展开；右侧放不下且左侧更宽裕时翻到鼠标左侧 */
    const spaceRight = maxRight - viewportX;
    const spaceLeft = viewportX - minLeft;
    const flipLeft = menuWidth > spaceRight && spaceLeft > spaceRight;
    /* 纵向：默认向下展开；下方放不下且上方更宽裕时翻到鼠标上方 */
    const spaceDown = maxBottom - viewportY;
    const spaceUp = viewportY - minTop;
    const flipUp = menuHeight > spaceDown && spaceUp > spaceDown;

    const targetViewportX = flipLeft ? viewportX - menuWidth : viewportX;
    const targetViewportY = flipUp ? viewportY - menuHeight : viewportY;
    /* 最终收敛：翻转后仍越界（极端窄/矮窗口）就贴边，并留 gap 呼吸间距 */
    const clampedViewportX = Math.min(Math.max(targetViewportX, minLeft + gap), Math.max(minLeft + gap, maxRight - menuWidth - gap));
    const clampedViewportY = Math.min(Math.max(targetViewportY, minTop + gap), Math.max(minTop + gap, maxBottom - menuHeight - gap));

    setPosition({ left: clampedViewportX - boundLeft, top: clampedViewportY - boundTop });
    /* items 每次渲染都是新数组，不能进依赖（会与 setPosition 形成无限循环）；
       同一菜单实例的条目集合在打开期间不变，坐标变化时重新量测即可。 */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [x, y]);

  const anchorStyle = position
    ? { left: position.left, top: position.top }
    /* 量测前先离屏渲染，避免用户看到菜单从错误位置跳一下 */
    : { left: x, top: y, visibility: "hidden" as const };

  useEffect(() => {
    // 点击菜单外关闭：目标不在壳内即关闭（菜单内部的 mousedown 已在锚点上 stopPropagation）
    const handleMouseDown = (event: MouseEvent) => {
      if (rootRef.current && event.target instanceof Node && !rootRef.current.contains(event.target)) {
        onCloseRef.current();
      }
    };
    // Esc 关闭：capture 阶段消费掉，避免终端侧再把 Esc 当作其他快捷键处理
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      onCloseRef.current();
    };
    // setTimeout(0)：等「打开菜单的那次事件」派发完再挂 mousedown 监听，
    // 避免父级用 onMouseDown 打开菜单时被同一次事件立即关闭。
    let mousedownHandler: ((event: MouseEvent) => void) | undefined;
    const timer = window.setTimeout(() => {
      mousedownHandler = handleMouseDown;
      document.addEventListener("mousedown", handleMouseDown);
    }, 0);
    document.addEventListener("keydown", handleKeyDown, true);
    return () => {
      window.clearTimeout(timer);
      if (mousedownHandler) document.removeEventListener("mousedown", mousedownHandler);
      document.removeEventListener("keydown", handleKeyDown, true);
    };
  }, []);

  return (
    <div
      ref={rootRef}
      className="terminal-menu-anchor"
      style={anchorStyle}
      // 菜单内的指针事件一律不冒泡到终端容器
      onMouseDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
    >
      <div className="terminal-menu" role="menu">
        {items.map((item, index) => {
          // 分隔线：{ key: "sep" }（无 label），React key 用 index 以允许出现多条分隔线
          if (!("label" in item)) {
            return <div key={index} className="terminal-menu-separator" role="separator" />;
          }
          const def = item;
          const Icon = def.icon;
          const disabled = def.disabled === true;
          const classNames = ["terminal-menu-item"];
          if (def.danger) classNames.push("terminal-menu-item-danger");
          if (disabled) classNames.push("terminal-menu-item-disabled");
          return (
            <div
              key={index}
              role="menuitem"
              aria-disabled={disabled || undefined}
              title={def.title}
              className={classNames.join(" ")}
              onClick={(event) => {
                event.stopPropagation();
                if (disabled) return;
                def.onSelect?.();
              }}
            >
              <Icon className="terminal-menu-item-icon" size={13} strokeWidth={1.7} />
              <span className="terminal-menu-item-label">{def.label}</span>
              {def.kbd ? (
                <span className="terminal-menu-item-kbd">{formatKeyHint(def.kbd)}</span>
              ) : def.hint ? (
                <span className="terminal-menu-item-hint">{def.hint}</span>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 1. 工具行「更多」菜单（原型 T3）                                       */
/* ------------------------------------------------------------------ */

export interface TerminalMoreMenuActions {
  onClear: () => void;
  canReconnect: boolean;
  onReconnect: () => void;
  onDisconnect: () => void;
  onRevealInFiles: () => void;
  onExportTranscript: () => void;
  onOpenSettings: () => void;
}

interface TerminalMoreMenuProps {
  x: number;
  y: number;
  onClose: () => void;
  actions: TerminalMoreMenuActions;
}

export function TerminalMoreMenu({ x, y, onClose, actions }: TerminalMoreMenuProps): JSX.Element {
  const items: TerminalMenuItem[] = [
    { key: "clear", icon: Eraser, label: "清屏", hint: "清回滚缓冲", onSelect: actions.onClear },
    { key: "reconnect", icon: RefreshCw, label: "重连", disabled: !actions.canReconnect, onSelect: actions.onReconnect },
    { key: "disconnect", icon: Unplug, label: "断开连接", danger: true, onSelect: actions.onDisconnect },
    { key: "sep" },
    { key: "reveal", icon: FolderOpen, label: "在文件目录中打开", onSelect: actions.onRevealInFiles },
    { key: "export", icon: ScrollText, label: "导出会话记录", onSelect: actions.onExportTranscript },
    { key: "sep" },
    { key: "settings", icon: Settings, label: "终端设置", hint: "→ 设置中心", onSelect: actions.onOpenSettings },
  ];
  return <TerminalMenuShell x={x} y={y} items={items} onClose={onClose} />;
}

/* ------------------------------------------------------------------ */
/* 2. 终端右键菜单（原型 T10）                                           */
/* ------------------------------------------------------------------ */

export interface TerminalContextMenuActions {
  /** 无选中内容时不传，复制项置灰 */
  onCopy?: () => void;
  onPaste: () => void;
  onCopyPaste: () => void;
  onFind: () => void;
  onClear: () => void;
  onSplitLR: () => void;
  onSplitTD: () => void;
  onClosePane: () => void;
  canClosePane: boolean;
  /** 非本地会话等场景不传，上传项置灰 */
  onUpload?: () => void;
  uploadDisabled?: boolean;
  onRevealInFiles: () => void;
  onDisconnect: () => void;
}

interface TerminalContextMenuProps {
  x: number;
  y: number;
  onClose: () => void;
  actions: TerminalContextMenuActions;
}

export function TerminalContextMenu({ x, y, onClose, actions }: TerminalContextMenuProps): JSX.Element {
  const items: TerminalMenuItem[] = [
    { key: "copy", icon: Copy, label: "复制", kbd: "⌘C", disabled: !actions.onCopy, onSelect: actions.onCopy },
    { key: "paste", icon: ClipboardPaste, label: "粘贴", kbd: "⌘V", onSelect: actions.onPaste },
    { key: "copy-paste", icon: ClipboardCheck, label: "复制并粘贴", kbd: "⌘⇧V", onSelect: actions.onCopyPaste },
    { key: "sep" },
    { key: "find", icon: Search, label: "查找", kbd: "⌘F", onSelect: actions.onFind },
    {
      key: "clear",
      icon: Eraser,
      label: "清屏",
      // 只清本地回滚缓冲，不向远端发送字符（JumpServer 下误发字符有风险）
      title: "只清本地回滚缓冲，不向远端发送字符（JumpServer 兼容）",
      onSelect: actions.onClear,
    },
    { key: "sep" },
    { key: "split-lr", icon: Columns2, label: "分屏(左右)", onSelect: actions.onSplitLR },
    { key: "split-td", icon: Rows2, label: "分屏(上下)", onSelect: actions.onSplitTD },
    { key: "close-pane", icon: X, label: "关闭当前窗格", disabled: !actions.canClosePane, onSelect: actions.onClosePane },
    { key: "sep" },
    {
      key: "upload",
      icon: Upload,
      label: "上传文件到当前目录…",
      disabled: actions.uploadDisabled,
      onSelect: actions.onUpload,
    },
    { key: "reveal", icon: FolderOpen, label: "在文件目录中打开", onSelect: actions.onRevealInFiles },
    { key: "sep" },
    { key: "disconnect", icon: Unplug, label: "断开连接", danger: true, onSelect: actions.onDisconnect },
  ];
  return <TerminalMenuShell x={x} y={y} items={items} onClose={onClose} />;
}

/* ------------------------------------------------------------------ */
/* 3. 终端标签页右键菜单（原型 T10）                                      */
/* ------------------------------------------------------------------ */

export interface TerminalTabContextMenuActions {
  onClose: () => void;
  onCloseOthers: () => void;
  onCloseAll: () => void;
}

interface TerminalTabContextMenuProps {
  x: number;
  y: number;
  onClose: () => void;
  actions: TerminalTabContextMenuActions;
}

export function TerminalTabContextMenu({ x, y, onClose, actions }: TerminalTabContextMenuProps): JSX.Element {
  const items: TerminalMenuItem[] = [
    { key: "close", icon: X, label: "关闭", kbd: "⌘W", onSelect: actions.onClose },
    { key: "close-others", icon: XSquare, label: "关闭其他", onSelect: actions.onCloseOthers },
    { key: "close-all", icon: Trash2, label: "全部关闭", onSelect: actions.onCloseAll },
  ];
  return <TerminalMenuShell x={x} y={y} items={items} onClose={onClose} />;
}
