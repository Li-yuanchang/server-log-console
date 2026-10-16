import type { CSSProperties, MouseEventHandler, ReactNode, RefObject } from "react";

export function FileBrowserGrid(props: {
  browserGridRef: RefObject<HTMLDivElement | null>;
  /** null = 用户从未拖拽过：不注入变量，由 CSS 按档位给默认宽（宽档 208 / 侧栏窄档 132） */
  browserTreeWidth: number | null;
  children: ReactNode;
  onAuxClick?: MouseEventHandler<HTMLDivElement>;
  onMouseDown?: MouseEventHandler<HTMLDivElement>;
}) {
  // .browser-grid 实际是 flex 容器（有批量条时还需要 wrap），
  // grid-template-columns 在 flex 下不生效，会导致勾选后树列被压缩、
  // 文件列左移抖动。用 CSS 变量把宽度交给 flex-basis。
  const style = props.browserTreeWidth == null
    ? undefined
    : ({ "--browser-tree-width": `${props.browserTreeWidth}px` } as CSSProperties);
  return (
    <div
      ref={props.browserGridRef}
      className="browser-grid"
      style={style}
      onAuxClick={props.onAuxClick}
      onMouseDown={props.onMouseDown}
    >
      {props.children}
    </div>
  );
}
