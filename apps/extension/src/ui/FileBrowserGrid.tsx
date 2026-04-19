import type { ReactNode, RefObject } from "react";

export function FileBrowserGrid(props: { browserGridRef: RefObject<HTMLDivElement | null>; browserTreeWidth: number; children: ReactNode }) {
  return <div ref={props.browserGridRef} className="browser-grid" style={{ gridTemplateColumns: `${props.browserTreeWidth}px 6px minmax(0, 1fr)` }}>{props.children}</div>;
}
