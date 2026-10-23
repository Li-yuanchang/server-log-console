/**
 * ContextMenuShell — 右键菜单的统一外壳（背景层 + 真实尺寸定位 + 事件隔离）。
 *
 * 三处菜单（文件行 / 文件空白处 / 工作区页签）共用：
 * 背景层与 .context-menu 结构保持一致，差异只在 children。
 * 定位交给 useAnchoredMenuPosition：按真实尺寸翻转并收敛，贴底/贴右不再被裁。
 */
import type { ReactNode, RefObject } from "react";
import { useAnchoredMenuPosition } from "./useAnchoredMenuPosition.js";

interface Props {
  x: number;
  y: number;
  children: ReactNode;
  /** 父级用于「点击外部关闭」的 ref（会与量测 ref 合并到同一节点） */
  menuRef?: RefObject<HTMLDivElement | null>;
  /**
   * 内容指纹：菜单条目变化时重新量测。
   * 同一坐标下文件项/目录项/压缩包项的高度不同，必须重算，否则仍按旧高度判断翻转。
   */
  contentKey?: string;
}

export function ContextMenuShell({ x, y, children, menuRef, contentKey = "" }: Props) {
  const [setMenuNode, menuStyle] = useAnchoredMenuPosition(x, y, {
    enabled: true,
    contentKey,
    externalRef: menuRef,
  });

  return (
    <div className="context-menu-backdrop">
      <div
        ref={setMenuNode}
        className="context-menu"
        style={menuStyle}
        onClick={(event) => event.stopPropagation()}
        onContextMenu={(event) => {
          event.preventDefault();
          event.stopPropagation();
        }}
      >
        {children}
      </div>
    </div>
  );
}
