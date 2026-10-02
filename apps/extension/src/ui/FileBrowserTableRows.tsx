import { useState } from "react";
import { ChevronRight, Download, Ellipsis, FileText, Folder, Pencil, Search, FolderOpen } from "lucide-react";
import type { DragEvent as ReactDragEvent } from "react";
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
  /* 批量条提示 ③：拖拽移动 —— 文件行拖到「目录树节点 / 列表内文件夹行」上完成移动。
     用户实测习惯把文件拖到列表内（而非树），文件夹行必须同为有效落点（Finder 惯例） */
  onDropMove?: (paths: string[], targetDir: string) => void;
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
  /* 文件夹行的拖拽落点高亮（拖到目录行 = 移入该目录，Finder 惯例） */
  const [dropRowPath, setDropRowPath] = useState<string | null>(null);
  const rowDragOver = (event: ReactDragEvent<HTMLDivElement>, entry: LogFileEntry) => {
    if (!props.onDropMove) return;
    if (!event.dataTransfer.types.includes("application/x-slcc-move")) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    event.stopPropagation();
    if (dropRowPath !== entry.path) setDropRowPath(entry.path);
  };
  const rowDragLeave = (event: ReactDragEvent<HTMLDivElement>, entry: LogFileEntry) => {
    event.stopPropagation();
    setDropRowPath((current) => (current === entry.path ? null : current));
  };
  const rowDrop = (event: ReactDragEvent<HTMLDivElement>, entry: LogFileEntry) => {
    event.preventDefault();
    event.stopPropagation();
    setDropRowPath(null);
    if (!props.onDropMove) return;
    const raw = event.dataTransfer.getData("application/x-slcc-move");
    if (!raw) return;
    try {
      const paths = JSON.parse(raw) as string[];
      if (Array.isArray(paths) && paths.length) props.onDropMove(paths, entry.path);
    } catch {
      /* 非本应用发起的拖拽数据，忽略 */
    }
  };
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
          className={`file-row ${entry.path === props.activeFilePath ? "file-row-active" : ""} ${entry.kind === "directory" ? "file-row-dir" : ""} ${selected ? "file-row-selected" : ""} ${hasSelection ? "file-row-select-mode" : ""} ${dropRowPath === entry.path ? "file-row-drop-target" : ""}`}
          draggable={!props.isBusy}
          onDragStart={(event) => {
            /* 批量条提示 ③：拖拽移动 —— 拖到目录树目标目录完成移动。
               拖动已勾选的行 = 移动全部勾选项；拖动未勾选的行 = 只移动该行。
               ⚠️ 不要用 setDragImage 自定义拖影：屏幕外元素在部分 Chromium 版本
               会导致拖拽整个不启动（2026-09-30 两次实测回归）。工具栏的隐藏
               走下方容器类——原生拖影快照在 dragstart 处理完之后拍摄，
               类已生效，原生拖影天然不含工具栏。 */
            const paths = props.selectedFilePathSet.has(entry.path)
              ? Array.from(props.selectedFilePathSet)
              : [entry.path];
            event.dataTransfer.effectAllowed = "move";
            event.dataTransfer.setData("application/x-slcc-move", JSON.stringify(paths));
            event.dataTransfer.setData("text/plain", paths.join("\n"));
            const table = event.currentTarget.closest(".file-table");
            table?.classList.add("file-table-dragging");
            const cleanup = () => {
              table?.classList.remove("file-table-dragging");
              window.removeEventListener("dragend", cleanup);
              window.removeEventListener("mouseup", cleanup);
            };
            window.addEventListener("dragend", cleanup);
            window.addEventListener("mouseup", cleanup);
          }}
          onDragOver={entry.kind === "directory" ? (event) => rowDragOver(event, entry) : undefined}
          onDragLeave={entry.kind === "directory" ? (event) => rowDragLeave(event, entry) : undefined}
          onDrop={entry.kind === "directory" ? (event) => rowDrop(event, entry) : undefined}
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
          onDoubleClick={(event) => {
            /* 批量条提示 ②：双击进入（目录进入 / 文件打开）；勾选态下单击是切换勾选，
               双击仍进入 */
            if ((event.target as HTMLElement).closest(".file-select-cell, .file-row-actions")) return;
            props.onOpenEntry(entry);
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
            {/* 对齐原型 ic("folder"/"file")（prototype.html 307-308）：lucide Folder / FileText，
                文件=带折角+文字行的文档页，与文件夹一眼可分（替换手绘 CSS 小方块） */}
            {entry.kind === "directory"
              ? <Folder size={14} strokeWidth={1.6} className="entry-icon-svg entry-icon-svg-dir" aria-hidden="true" />
              : <FileText size={14} strokeWidth={1.6} className="entry-icon-svg" aria-hidden="true" />}
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
