/**
 * TerminalMenus — 终端菜单组件族（对应原型 T3 工具行「更多」菜单 / T10 终端与标签页右键菜单）。
 *
 * 全部为纯受控组件：显隐由父级管理（父级条件渲染），定位由父级给 absolute 坐标
 * （组件渲染在终端容器内，外层 .terminal-menu-anchor 接收 style，见 align-s5-terminal.css §6）。
 * 点击菜单项后的关闭由父级负责（各项 onSelect 内自行调用 onClose）；组件内部只处理：
 *  - 菜单内的点击 / 右键不冒泡（避免触发终端自身的选中清除等处理）
 *  - 点击菜单外（document mousedown）/ Esc 关闭（通过 props.onClose 回调）
 */
import { useEffect, useRef } from "react";
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
    导出给终端工作台容器自组菜单（如工具行「分屏 ▾」下拉）。 */
export function TerminalMenuShell({ x, y, items, onClose }: TerminalMenuShellProps): JSX.Element {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

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
      style={{ left: x, top: y }}
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
                <span className="terminal-menu-item-kbd">{def.kbd}</span>
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
