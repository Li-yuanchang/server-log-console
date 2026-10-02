import type { DragEventHandler, MouseEventHandler, ReactNode } from "react";

type Props = {
  isDragOver: boolean;
  head: ReactNode;
  overlay?: ReactNode;
  children: ReactNode;
  onDragOver: DragEventHandler<HTMLElement>;
  onDragLeave: DragEventHandler<HTMLElement>;
  onDrop: DragEventHandler<HTMLElement>;
  /* 空白处右键菜单（行内右键自行 stopPropagation，不会触发到这里） */
  onContextMenu?: MouseEventHandler<HTMLElement>;
};

export function FileBrowserFileColumn(props: Props) {
  return (
    <section
      className={`browser-column browser-file-column${props.isDragOver ? " drop-zone-active" : ""}`}
      onDragOver={props.onDragOver}
      onDragLeave={props.onDragLeave}
      onDrop={props.onDrop}
      onContextMenu={props.onContextMenu}
    >
      {props.head}
      {props.overlay}
      <div className="browser-file-column-body">{props.children}</div>
    </section>
  );
}
