import { useMemo, useState } from "react";
import {
  AlertTriangle,
  Ban,
  Copy,
  Download,
  FolderOpen,
  FolderOpenDot,
  Search,
  Trash2,
  Upload,
} from "lucide-react";
import type { TransferHistoryEntry, TransferHistoryStatus } from "./storage.js";
import type { DownloadProgressState, UploadProgressState } from "./FeedbackOverlays.js";
import { Drawer } from "./Drawer.js";
import { getParentDirectoryPath } from "./utils.js";

type Props = {
  open: boolean;
  entries: TransferHistoryEntry[];
  isElectron: boolean;
  uploadProgress: UploadProgressState | null;
  downloadProgress: DownloadProgressState | null;
  formatBytes: (value: number) => string;
  formatDateTime: (value?: string) => string;
  onBrowsePath: (path: string) => void;
  onCopyRemotePath: (path: string) => void;
  onRevealLocalPath: (path: string) => void;
  onClear: () => void;
  onClose: () => void;
};

type FilterKey = "all" | "upload" | "download" | "success" | "error" | "canceled";

function isAbsoluteLocalPath(value: string) {
  return /^([A-Za-z]:[\\/]|\/)/.test(value);
}

function statusLabel(status: TransferHistoryStatus) {
  if (status === "success") return "成功";
  if (status === "error") return "失败";
  return "取消";
}

function matchFilter(entry: TransferHistoryEntry, filter: FilterKey) {
  if (filter === "all") return true;
  if (filter === "upload" || filter === "download") return entry.direction === filter;
  return entry.status === filter;
}

export function TransferHistoryDrawer(props: Props) {
  const [keyword, setKeyword] = useState("");
  const [filter, setFilter] = useState<FilterKey>("all");

  const summary = useMemo(() => {
    let uploads = 0;
    let downloads = 0;
    let success = 0;
    let error = 0;
    let canceled = 0;
    for (const entry of props.entries) {
      if (entry.direction === "upload") uploads += 1;
      else downloads += 1;
      if (entry.status === "success") success += 1;
      else if (entry.status === "error") error += 1;
      else canceled += 1;
    }
    return { uploads, downloads, success, error, canceled };
  }, [props.entries]);

  const filteredEntries = useMemo(() => {
    const normalizedKeyword = keyword.trim().toLowerCase();
    return props.entries.filter((entry) => {
      if (!matchFilter(entry, filter)) return false;
      if (!normalizedKeyword) return true;
      return [entry.fileName, entry.filePath, entry.localPath || "", entry.message || "", entry.serverLabel]
        .join("\n")
        .toLowerCase()
        .includes(normalizedKeyword);
    });
  }, [filter, keyword, props.entries]);

  const uploadActive = Boolean(
    props.uploadProgress && props.uploadProgress.stage !== "completed"
  );
  const downloadActive = Boolean(
    props.downloadProgress && props.downloadProgress.percent < 100
  );
  const hasActive = Boolean(uploadActive || downloadActive);

  // 原型 S8 第 790-793 行仅 4 枚筛选 chip：全部 / 上传 / 下载 / 失败（红）
  const chips: Array<{ key: FilterKey; label: string; count: number; red?: boolean }> = [
    { key: "all", label: "全部", count: props.entries.length },
    { key: "upload", label: "上传", count: summary.uploads },
    { key: "download", label: "下载", count: summary.downloads },
    { key: "error", label: "失败", count: summary.error, red: true },
  ];

  const headSample = props.entries[0];
  const headContextLabel = headSample
    ? `${headSample.serverLabel} · ${getParentDirectoryPath(headSample.filePath)}`
    : undefined;

  return (
    <Drawer
      open={props.open}
      onClose={props.onClose}
      title="传输记录"
      width={420}
      headExtra={
        <>
          {headContextLabel ? <span className="chip" title={headContextLabel}>{headContextLabel}</span> : null}
          <button
            type="button"
            className="ghost-button icon-button"
            title="清空当前服务器记录"
            aria-label="清空当前服务器记录"
            onClick={props.onClear}
            disabled={!props.entries.length}
          >
            <Trash2 size={13} strokeWidth={1.85} />
          </button>
        </>
      }
      footer={
        <>
          <span className="mut" style={{ fontSize: 10.5, flex: 1 }}>
            每服务器独立 · 保留最近 50 条
          </span>
          <button
            type="button"
            className="ghost-button slim-button"
            onClick={props.onClear}
            disabled={!props.entries.length}
          >
            清空本服务器
          </button>
        </>
      }
    >
      <div className="xdrawer-section xdrawer-chip-row">
        {chips
          .filter((chip) => chip.key === "all" || chip.count > 0)
          .map((chip) => (
            <button
              key={chip.key}
              type="button"
              className={`fchip${filter === chip.key ? " fchip-on" : ""}${chip.red ? " fchip-red" : ""}`}
              onClick={() => setFilter(chip.key)}
            >
              {chip.label} <b className="fchip-count">{chip.count}</b>
            </button>
          ))}
      </div>
      <div className="xdrawer-section xdrawer-search-row">
        <span className="xdrawer-search-shell">
          <Search size={13} strokeWidth={1.9} />
          <input
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            placeholder="搜索文件名或路径…"
          />
        </span>
      </div>

      <div className="xdrawer-list">
        {hasActive ? (
          <div className="xdrawer-live-block">
            <div className="xdrawer-live-label">进行中</div>
            {uploadActive && props.uploadProgress ? (
              <div className="xrow">
                <span className="xrow-ic xrow-ic-up"><Upload size={13} strokeWidth={1.9} /></span>
                <span className="xrow-meta">
                  <span className="xrow-fn" title={props.uploadProgress.fileName}>
                    {props.uploadProgress.fileName}
                  </span>
                  <div className="xprog"><i style={{ width: `${Math.max(2, props.uploadProgress.current)}%` }} /></div>
                  <span className="xrow-sub">
                    <span>
                      {props.formatBytes(props.uploadProgress.bytesUploaded)} / {props.formatBytes(props.uploadProgress.fileSize)}
                      {" · "}
                      {props.uploadProgress.current}%
                    </span>
                    {props.uploadProgress.speed ? <span>{props.formatBytes(props.uploadProgress.speed)}/s</span> : null}
                    {props.uploadProgress.totalFiles && props.uploadProgress.totalFiles > 1 ? (
                      <span>批量 {props.uploadProgress.fileIndex}/{props.uploadProgress.totalFiles}</span>
                    ) : null}
                  </span>
                </span>
              </div>
            ) : null}
            {downloadActive && props.downloadProgress ? (
              <div className="xrow">
                <span className="xrow-ic xrow-ic-dn"><Download size={13} strokeWidth={1.9} /></span>
                <span className="xrow-meta">
                  <span className="xrow-fn" title={props.downloadProgress.fileName}>
                    {props.downloadProgress.fileName}
                  </span>
                  <div className="xprog"><i style={{ width: `${Math.max(2, props.downloadProgress.percent)}%` }} /></div>
                  <span className="xrow-sub">
                    <span>
                      {props.formatBytes(props.downloadProgress.bytesDownloaded)} / {props.formatBytes(props.downloadProgress.fileSize)}
                      {" · "}
                      {props.downloadProgress.percent}%
                    </span>
                    {props.downloadProgress.speed ? <span>{props.formatBytes(props.downloadProgress.speed)}/s</span> : null}
                  </span>
                </span>
              </div>
            ) : null}
          </div>
        ) : null}

        {!filteredEntries.length ? (
          /* S12 原型空态模板：图标 + 一句话 + 副文案 + 主按钮「打开文件目录」（原型 1041 行） */
          <div className="empty-box empty-state-template xdrawer-empty">
            <span className="empty-box-icon" aria-hidden="true">
              <Download size={18} strokeWidth={1.8} />
            </span>
            <strong className="empty-box-title">
              {props.entries.length ? "没有符合当前筛选条件的记录" : "当前服务器暂无传输记录"}
            </strong>
            <span className="empty-box-hint">
              {props.entries.length ? "调整筛选条件后再试" : "上传或下载文件后会显示在这里"}
            </span>
            {props.entries.length ? null : (
              <button type="button" className="ghost-button" onClick={() => props.onBrowsePath("/")}>
                打开文件目录
              </button>
            )}
          </div>
        ) : (
          filteredEntries.map((entry) => {
            const canReveal = Boolean(entry.localPath && props.isElectron && isAbsoluteLocalPath(entry.localPath));
            const isError = entry.status === "error";
            return (
              <div
                key={entry.id}
                className="xrow"
                onClick={() => props.onBrowsePath(getParentDirectoryPath(entry.filePath))}
                title="打开远程目录"
              >
                <span className={`xrow-ic ${isError ? "xrow-ic-err" : entry.direction === "upload" ? "xrow-ic-up" : "xrow-ic-dn"}`}>
                  {isError
                    ? entry.status === "canceled" ? <Ban size={13} strokeWidth={1.9} /> : <AlertTriangle size={13} strokeWidth={1.9} />
                    : entry.direction === "upload" ? <Upload size={13} strokeWidth={1.9} /> : <Download size={13} strokeWidth={1.9} />}
                </span>
                <span className="xrow-meta">
                  <span className="xrow-fn" title={entry.filePath}>{entry.fileName}</span>
                  <span className="xrow-sub">
                    <span className={isError ? "xrow-err-text" : ""}>{statusLabel(entry.status)}</span>
                    <span>{props.formatBytes(entry.size)}</span>
                    <span>{props.formatDateTime(entry.createdAt)}</span>
                    {entry.message ? <span className="xrow-msg" title={entry.message}>{entry.message}</span> : null}
                  </span>
                </span>
                <span className="xrow-ops" onClick={(event) => event.stopPropagation()}>
                  <button
                    type="button"
                    className="ghost-button icon-button"
                    title="打开远程目录"
                    aria-label="打开远程目录"
                    onClick={() => props.onBrowsePath(getParentDirectoryPath(entry.filePath))}
                  >
                    <FolderOpen size={13} strokeWidth={1.85} />
                  </button>
                  <button
                    type="button"
                    className="ghost-button icon-button"
                    title="复制远程路径"
                    aria-label="复制远程路径"
                    onClick={() => props.onCopyRemotePath(entry.filePath)}
                  >
                    <Copy size={13} strokeWidth={1.85} />
                  </button>
                  {canReveal ? (
                    <button
                      type="button"
                      className="ghost-button icon-button"
                      title="在 Finder 中显示"
                      aria-label="在 Finder 中显示"
                      onClick={() => props.onRevealLocalPath(entry.localPath!)}
                    >
                      <FolderOpenDot size={13} strokeWidth={1.85} />
                    </button>
                  ) : null}
                </span>
              </div>
            );
          })
        )}
      </div>
    </Drawer>
  );
}
