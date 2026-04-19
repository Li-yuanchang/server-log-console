type Entry = {
  key: string;
  label: string;
  path: string;
  depth: number;
  kind: "path" | "directory";
  isCurrent: boolean;
};

type Props = {
  title: string;
  summary: string;
  entries: Entry[];
  emptyLabel?: string;
  onBrowse: (path: string) => void;
  onOpenContextMenu: (entry: Entry, clientX: number, clientY: number) => void;
};

export function FileBrowserTreeColumn(props: Props) {
  return (
    <section className="browser-column browser-tree-column">
      <div className="browser-column-head">
        <strong>{props.title}</strong>
        <span>{props.summary}</span>
      </div>
      <div className="tree-list">
        {props.entries.length ? props.entries.map((entry) => (
          <button
            key={entry.key}
            className={`tree-item ${entry.isCurrent ? "tree-item-current" : ""} ${entry.kind === "path" ? "tree-item-path" : "tree-item-directory"}`}
            style={{ paddingLeft: `${10 + entry.depth * 14}px` }}
            onClick={() => props.onBrowse(entry.path)}
            onContextMenu={(event) => {
              event.preventDefault();
              event.stopPropagation();
              props.onOpenContextMenu(entry, event.clientX, event.clientY);
            }}
          >
            <span className="tree-name-cell">
              <span className={`tree-caret ${entry.kind === "path" ? "tree-caret-open" : "tree-caret-placeholder"}`} aria-hidden="true" />
              <span className="entry-icon entry-icon-dir" aria-hidden="true" />
              <strong>{entry.label}</strong>
            </span>
          </button>
        )) : (props.emptyLabel ? <div className="empty-box table-empty">{props.emptyLabel}</div> : null)}
      </div>
    </section>
  );
}
