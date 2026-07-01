import type { MouseEventHandler, ReactNode, RefObject } from "react";

export function FileBrowserGrid(props: {
  browserGridRef: RefObject<HTMLDivElement | null>;
  browserTreeWidth: number;
  children: ReactNode;
  onAuxClick?: MouseEventHandler<HTMLDivElement>;
  onMouseDown?: MouseEventHandler<HTMLDivElement>;
}) {
  return (
    <div
      ref={props.browserGridRef}
      className="browser-grid"
      style={{ gridTemplateColumns: `${props.browserTreeWidth}px 6px minmax(0, 1fr)` }}
      onAuxClick={props.onAuxClick}
      onMouseDown={props.onMouseDown}
    >
      {props.children}
    </div>
  );
}
