import type { LogFileEntry } from "@server-log-console/shared";
import { ToolIcon } from "./ToolIcon.js";

type Props = {
  entries: LogFileEntry[];
  activeFilePath: string;
  selectedFilePathSet: Set<string>;
  isBusy: boolean;
  uiTheme: "classic" | "modern";
  emptyLabel?: string;
  emptyClassName?: string;
  formatBytes: (size: number) => string;
  formatDateTime: (value: LogFileEntry["modifiedTime"]) => string;
  onOpenEntry: (entry: LogFileEntry) => void;
  onOpenContextMenu: (entry: LogFileEntry, clientX: number, clientY: number) => void;
  onToggleSelection: (path: string, checked: boolean) => void;
  onDownload: (path: string) => void;
  onRename: (entry: LogFileEntry) => void;
  onDelete: (path: string) => void;
};

export function FileBrowserTableRows(props: Props) {
  if (!props.entries.length) {
    return <div className={`empty-box table-empty${props.emptyClassName ? ` ${props.emptyClassName}` : ""}`}>{props.emptyLabel || "当前目录为空"}</div>;
  }

  return (
    <>
      {props.entries.map((entry) => (
        <div
          key={entry.path}
          role="button"
          tabIndex={0}
          className={`file-row ${entry.path === props.activeFilePath ? "file-row-active" : ""} ${entry.kind === "directory" ? "file-row-dir" : ""} ${props.selectedFilePathSet.has(entry.path) ? "file-row-selected" : ""}`}
          onClick={(event) => {
            const target = event.target as HTMLElement;
            const selectCell = event.currentTarget.querySelector(".file-select-cell");
            const selectCellRect = selectCell?.getBoundingClientRect();
            const clickedInsideSelectCell = Boolean(
              selectCellRect &&
              event.clientX >= selectCellRect.left &&
              event.clientX <= selectCellRect.right &&
              event.clientY >= selectCellRect.top &&
              event.clientY <= selectCellRect.bottom,
            );
            if (clickedInsideSelectCell || target.closest(".file-select-cell") || target.closest(".file-row-actions")) {
              return;
            }
            props.onOpenEntry(entry);
          }}
          onKeyDown={(event) => {
            if (event.target !== event.currentTarget) return;
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              props.onOpenEntry(entry);
            }
          }}
          onContextMenu={(event) => {
            event.preventDefault();
            event.stopPropagation();
            props.onOpenContextMenu(entry, event.clientX, event.clientY);
          }}
        >
          <span className="file-select-cell" onClick={(event) => event.stopPropagation()} onMouseDown={(event) => event.stopPropagation()}>
            <input
              type="checkbox"
              className="file-select-checkbox"
              checked={props.selectedFilePathSet.has(entry.path)}
              disabled={props.isBusy}
              onClick={(event) => event.stopPropagation()}
              onPointerDown={(event) => event.stopPropagation()}
              onChange={(event) => props.onToggleSelection(entry.path, event.target.checked)}
              aria-label={`选择 ${entry.name}`}
            />
          </span>
          <span className="file-name-cell">
            <span className={`entry-icon ${entry.kind === "directory" ? "entry-icon-dir" : "entry-icon-file"}`} aria-hidden="true" />
            <strong>{entry.name}</strong>
            <span className="file-row-actions" onClick={(event) => event.stopPropagation()} onMouseDown={(event) => event.stopPropagation()}>
              {entry.kind === "file" ? (
                <span role="button" tabIndex={0} className="file-action-icon" title="下载" onClick={(event) => { event.stopPropagation(); props.onDownload(entry.path); }}>
                  <ToolIcon theme={props.uiTheme} kind="download" />
                </span>
              ) : null}
              <span role="button" tabIndex={0} className="file-action-icon" title="重命名" onClick={(event) => { event.stopPropagation(); props.onRename(entry); }}>
                <ToolIcon theme={props.uiTheme} kind="rename" />
              </span>
              {entry.kind === "file" ? (
                <span role="button" tabIndex={0} className="file-action-icon file-action-danger" title="删除" onClick={(event) => { event.stopPropagation(); props.onDelete(entry.path); }}>
                  <ToolIcon theme={props.uiTheme} kind="delete" />
                </span>
              ) : null}
            </span>
          </span>
          <span>{entry.kind === "file" && typeof entry.size === "number" ? props.formatBytes(entry.size) : "--"}</span>
          <span>{props.formatDateTime(entry.modifiedTime)}</span>
          <span>{entry.kind === "directory" ? "目录" : "文件"}</span>
        </div>
      ))}
    </>
  );
}
