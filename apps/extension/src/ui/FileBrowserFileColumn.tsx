import type { DragEventHandler, ReactNode } from "react";

type Props = {
  isDragOver: boolean;
  head: ReactNode;
  overlay?: ReactNode;
  children: ReactNode;
  onDragOver: DragEventHandler<HTMLElement>;
  onDragLeave: DragEventHandler<HTMLElement>;
  onDrop: DragEventHandler<HTMLElement>;
};

export function FileBrowserFileColumn(props: Props) {
  return (
    <section
      className={`browser-column browser-file-column${props.isDragOver ? " drop-zone-active" : ""}`}
      onDragOver={props.onDragOver}
      onDragLeave={props.onDragLeave}
      onDrop={props.onDrop}
    >
      {props.head}
      {props.overlay}
      <div className="browser-file-column-body">{props.children}</div>
    </section>
  );
}
