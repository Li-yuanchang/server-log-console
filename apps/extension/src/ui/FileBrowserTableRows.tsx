import { ChevronRight, Download, Ellipsis, Pencil, Search, FolderOpen } from "lucide-react";
import type { LogFileEntry } from "@server-log-console/shared";
import type { DownloadProgressState, UploadProgressState } from "./FeedbackOverlays.js";
import { ToolIcon } from "./ToolIcon.js";

type RowTransferProgress = {
  percent: number;
  label: string;
};

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
  uploadProgress?: UploadProgressState | null;
  downloadProgress?: DownloadProgressState | null;
  onOpenEntry: (entry: LogFileEntry) => void;
  onOpenContextMenu: (entry: LogFileEntry, clientX: number, clientY: number) => void;
  onToggleSelection: (path: string, checked: boolean) => void;
  onDownload: (path: string) => void;
  onMove: (entry: LogFileEntry) => void;
  onRename: (entry: LogFileEntry) => void;
};

function formatTransferMeta(percent: number, speed: number, formatBytes: (size: number) => string): string {
  return speed > 0 ? `${percent}% · ${formatBytes(speed)}/s` : `${percent}%`;
}

function resolveRowTransferProgress(
  entry: LogFileEntry,
  uploadProgress: UploadProgressState | null | undefined,
  downloadProgress: DownloadProgressState | null | undefined,
  formatBytes: (size: number) => string,
): RowTransferProgress | null {
  if (entry.kind !== "file") {
    return null;
  }
  if (uploadProgress && uploadProgress.fileName === entry.name) {
    const percent = Math.min(100, Math.max(0, uploadProgress.current));
    return { percent, label: formatTransferMeta(percent, uploadProgress.speed, formatBytes) };
  }
  if (downloadProgress && downloadProgress.fileName === entry.name) {
    const percent = Math.min(100, Math.max(0, downloadProgress.percent));
    return { percent, label: formatTransferMeta(percent, downloadProgress.speed, formatBytes) };
  }
  return null;
}

export function FileBrowserTableRows(props: Props) {
  if (!props.entries.length) {
    // S12 原型空态模板：44×44 描边图标 + 一句话（原为纯文字）
    return (
      <div className={`empty-box table-empty${props.emptyClassName ? ` ${props.emptyClassName}` : ""}`}>
        <span className="empty-box-icon" aria-hidden="true">
          <FolderOpen size={18} strokeWidth={1.8} />
        </span>
        <span className="empty-box-hint">{props.emptyLabel || "当前目录为空"}</span>
      </div>
    );
  }
  const hasSelection = props.selectedFilePathSet.size > 0;

  return (
    <>
      {props.entries.map((entry) => {
        const selected = props.selectedFilePathSet.has(entry.path);
        const toggleSelection = (checked = !selected) => {
          if (!props.isBusy) {
            props.onToggleSelection(entry.path, checked);
          }
        };
        const rowTransfer = props.uiTheme === "modern"
          ? resolveRowTransferProgress(entry, props.uploadProgress, props.downloadProgress, props.formatBytes)
          : null;
        const openLabel = entry.kind === "directory" ? "打开" : "预览";
        return (
        <div
          key={entry.path}
          role="button"
          tabIndex={0}
          className={`file-row ${entry.path === props.activeFilePath ? "file-row-active" : ""} ${entry.kind === "directory" ? "file-row-dir" : ""} ${selected ? "file-row-selected" : ""} ${hasSelection ? "file-row-select-mode" : ""}`}
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
            if (hasSelection) {
              toggleSelection();
              return;
            }
            props.onOpenEntry(entry);
          }}
          onKeyDown={(event) => {
            if (event.target !== event.currentTarget) return;
            if (event.key === " ") {
              event.preventDefault();
              toggleSelection();
              return;
            }
            if (event.key === "Enter") {
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
          <span
            className="file-select-cell"
            role="checkbox"
            aria-checked={selected}
            tabIndex={-1}
            onClick={(event) => {
              event.stopPropagation();
              if ((event.target as HTMLElement).closest("input")) {
                return;
              }
              toggleSelection();
            }}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <input
              type="checkbox"
              className="file-select-checkbox"
              checked={selected}
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
              {/* S6：目录行去掉冗余「打开」按钮（单击行即进入，图标与「移动」重复）；文件保留预览(搜索) */}
              {entry.kind === "file" ? (
                <button
                  type="button"
                  className="file-action-icon"
                  title={openLabel}
                  aria-label={`${openLabel} ${entry.name}`}
                  onClick={(event) => { event.stopPropagation(); props.onOpenEntry(entry); }}
                >
                  <Search size={13} strokeWidth={1.8} />
                </button>
              ) : null}
              {entry.kind === "file" ? (
                <button
                  type="button"
                  className="file-action-icon"
                  title="下载"
                  aria-label={`下载 ${entry.name}`}
                  onClick={(event) => { event.stopPropagation(); props.onDownload(entry.path); }}
                >
                  <Download size={13} strokeWidth={1.8} />
                </button>
              ) : null}
              <button
                type="button"
                className="file-action-icon"
                title="重命名"
                aria-label={`重命名 ${entry.name}`}
                onClick={(event) => { event.stopPropagation(); props.onRename(entry); }}
              >
                <Pencil size={13} strokeWidth={1.8} />
              </button>
              <button
                type="button"
                className="file-action-icon"
                title="移动"
                aria-label={`移动 ${entry.name}`}
                onClick={(event) => { event.stopPropagation(); props.onMove(entry); }}
              >
                <ChevronRight size={13} strokeWidth={1.8} />
              </button>
              <button
                type="button"
                className="file-action-icon"
                title="更多操作"
                aria-label={`更多操作 ${entry.name}`}
                onClick={(event) => {
                  event.stopPropagation();
                  const rect = event.currentTarget.getBoundingClientRect();
                  props.onOpenContextMenu(entry, rect.right + 4, rect.bottom + 4);
                }}
              >
                <Ellipsis size={13} strokeWidth={1.8} />
              </button>
            </span>
          </span>
          {/* S6：传输列非常驻——仅该行有活动传输时渲染，占位与表头同步 */}
          {props.uiTheme === "modern" && rowTransfer ? (
            <span className="file-transfer-cell">
              <span
                className="file-transfer-track"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={rowTransfer.percent}
                aria-label={`${entry.name} 传输进度`}
              >
                <span className="file-transfer-fill" style={{ transform: `scaleX(${rowTransfer.percent / 100})` }} />
              </span>
              <span className="file-transfer-meta">{rowTransfer.label}</span>
            </span>
          ) : null}
          <span className="file-size-cell">{entry.kind === "file" && typeof entry.size === "number" ? props.formatBytes(entry.size) : "--"}</span>
          <span className="file-mtime-cell">{props.formatDateTime(entry.modifiedTime)}</span>
          <span className="file-kind-cell">{entry.kind === "directory" ? "目录" : "文件"}</span>
        </div>
        );
      })}
    </>
  );
}
