import { useMemo, useState, useEffect } from "react";
import { 
  AlertTriangle, 
  Ban, 
  CheckCircle2, 
  ChevronDown, 
  ChevronUp, 
  Copy, 
  Download, 
  Files, 
  FolderOpen, 
  HardDrive, 
  Search, 
  Trash2, 
  Upload, 
  X 
} from "lucide-react";
import type { TransferHistoryEntry, TransferHistoryStatus } from "./storage.js";
import { useEscapeToClose } from "./useEscapeToClose.js";
import { getParentDirectoryPath } from "./utils.js";

type Props = {
  open: boolean;
  entries: TransferHistoryEntry[];
  isElectron: boolean;
  formatBytes: (value: number) => string;
  formatDateTime: (value?: string) => string;
  onBrowsePath: (path: string) => void;
  onCopyRemotePath: (path: string) => void;
  onCopyLocalPath: (path: string) => void;
  onRevealLocalPath: (path: string) => void;
  onClear: () => void;
  onClose: () => void;
};

type DirectionFilter = "all" | "upload" | "download";
type StatusFilter = "all" | TransferHistoryStatus;

function isAbsoluteLocalPath(value: string) {
  return /^([A-Za-z]:[\\/]|\/)/.test(value);
}

function statusLabel(status: TransferHistoryStatus) {
  if (status === "success") return "成功";
  if (status === "error") return "失败";
  return "取消";
}

function directionLabel(direction: TransferHistoryEntry["direction"]) {
  return direction === "upload" ? "上传" : "下载";
}

function localPathLabel(direction: TransferHistoryEntry["direction"]) {
  return direction === "upload" ? "本地来源" : "本地保存";
}

export function TransferHistoryDialog(props: Props) {
  const [keyword, setKeyword] = useState("");
  const [directionFilter, setDirectionFilter] = useState<DirectionFilter>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [expandedEntryIds, setExpandedEntryIds] = useState<string[]>([]);
  useEscapeToClose(props.open, props.onClose);

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

  const expandedEntryIdSet = useMemo(() => new Set(expandedEntryIds), [expandedEntryIds]);

  useEffect(() => {
    if (!props.open) {
      setExpandedEntryIds([]);
      return;
    }
    const validIds = new Set(props.entries.map((entry) => entry.id));
    setExpandedEntryIds((current) => current.filter((entryId) => validIds.has(entryId)));
  }, [props.entries, props.open]);

  function toggleEntryExpanded(entryId: string) {
    setExpandedEntryIds((current) => (
      current.includes(entryId)
        ? current.filter((value) => value !== entryId)
        : [...current, entryId]
    ));
  }

  const filteredEntries = useMemo(() => {
    const normalizedKeyword = keyword.trim().toLowerCase();
    return props.entries.filter((entry) => {
      if (directionFilter !== "all" && entry.direction !== directionFilter) {
        return false;
      }
      if (statusFilter !== "all" && entry.status !== statusFilter) {
        return false;
      }
      if (!normalizedKeyword) {
        return true;
      }
      return [entry.fileName, entry.filePath, entry.localPath || "", entry.message || "", entry.serverLabel]
        .join("\n")
        .toLowerCase()
        .includes(normalizedKeyword);
    });
  }, [directionFilter, keyword, props.entries, statusFilter]);

  if (!props.open) {
    return null;
  }

  const summaryCards = [
    { key: "total", label: "总记录", value: props.entries.length, icon: <Files size={15} strokeWidth={1.85} /> },
    { key: "upload", label: "上传", value: summary.uploads, icon: <Upload size={15} strokeWidth={1.85} /> },
    { key: "download", label: "下载", value: summary.downloads, icon: <Download size={15} strokeWidth={1.85} /> },
    { key: "success", label: "成功", value: summary.success, icon: <CheckCircle2 size={15} strokeWidth={1.85} /> },
    { key: "error", label: "失败", value: summary.error, icon: <AlertTriangle size={15} strokeWidth={1.85} /> },
    { key: "canceled", label: "取消", value: summary.canceled, icon: <Ban size={15} strokeWidth={1.85} /> },
  ] as const;

  return (
    <div className="confirm-backdrop transfer-history-backdrop" onClick={props.onClose}>
      <div className="confirm-dialog transfer-history-dialog" onClick={(event) => event.stopPropagation()}>
        <div className="transfer-history-dialog-head">
          <div className="transfer-history-dialog-title-block">
            <div className="transfer-history-dialog-kicker">当前服务器 · 紧凑视图</div>
            <div className="confirm-title">传输记录</div>
            <div className="transfer-history-dialog-subtitle">聚合展示上传、下载与异常结果。路径和快捷操作默认折叠，需要时再展开。</div>
          </div>
          <div className="transfer-history-dialog-head-actions">
            <button
              type="button"
              className="ghost-button icon-button transfer-history-head-icon-button transfer-history-clear"
              title="清空当前服务器记录"
              aria-label="清空当前服务器记录"
              onClick={props.onClear}
              disabled={!props.entries.length}
            >
              <Trash2 size={16} strokeWidth={1.8} />
            </button>
            <button
              type="button"
              className="ghost-button icon-button transfer-history-head-icon-button transfer-history-close"
              title="关闭传输记录"
              aria-label="关闭传输记录"
              onClick={props.onClose}
            >
              <X size={16} strokeWidth={1.8} />
            </button>
          </div>
        </div>

        <div className="transfer-history-summary-grid">
          {summaryCards.map((card) => (
            <div key={card.key} className={`transfer-history-summary-card transfer-history-summary-card-${card.key}`}>
              <span className="transfer-history-summary-icon">{card.icon}</span>
              <span className="transfer-history-summary-label">{card.label}</span>
              <strong>{card.value}</strong>
            </div>
          ))}
        </div>

        <div className="transfer-history-filter-row">
          <label className="transfer-history-search-shell">
            <Search size={15} strokeWidth={1.9} />
            <input
              className="rename-input transfer-history-search"
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
              placeholder="搜索文件名、远程路径、本地路径或错误信息"
            />
          </label>
          <label className="transfer-history-filter-field">
            <span>方向</span>
            <select className="transfer-history-select" value={directionFilter} onChange={(event) => setDirectionFilter(event.target.value as DirectionFilter)}>
              <option value="all">全部方向</option>
              <option value="upload">仅上传</option>
              <option value="download">仅下载</option>
            </select>
          </label>
          <label className="transfer-history-filter-field">
            <span>状态</span>
            <select className="transfer-history-select" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}>
              <option value="all">全部状态</option>
              <option value="success">成功</option>
              <option value="error">失败</option>
              <option value="canceled">取消</option>
            </select>
          </label>
          <div className="transfer-history-filter-meta">显示 {filteredEntries.length} / {props.entries.length} 条</div>
        </div>

        <div className="transfer-history-dialog-body">
          {!filteredEntries.length ? (
            <div className="transfer-history-empty-panel">
              {props.entries.length ? "没有符合当前筛选条件的记录" : "当前服务器暂无传输记录"}
            </div>
          ) : filteredEntries.map((entry) => {
            const canRevealLocalPath = Boolean(entry.localPath && props.isElectron && isAbsoluteLocalPath(entry.localPath));
            const isExpanded = expandedEntryIdSet.has(entry.id);
            return (
              <article key={entry.id} className={`transfer-history-card${isExpanded ? " transfer-history-card-expanded" : ""}`}>
                <div className="transfer-history-card-topbar">
                  <div className="transfer-history-row">
                    <span className={`transfer-history-chip transfer-history-chip-${entry.direction}`}>
                      {directionLabel(entry.direction)}
                    </span>
                    <span className={`transfer-history-chip transfer-history-chip-${entry.status}`}>
                      {statusLabel(entry.status)}
                    </span>
                  </div>
                  <div className="transfer-history-card-toolbar">
                    <button
                      type="button"
                      className="ghost-button icon-button transfer-history-card-icon-button"
                      title="打开远程目录"
                      aria-label="打开远程目录"
                      onClick={() => props.onBrowsePath(getParentDirectoryPath(entry.filePath))}
                    >
                      <FolderOpen size={15} strokeWidth={1.85} />
                    </button>
                    <button
                      type="button"
                      className="ghost-button icon-button transfer-history-card-icon-button"
                      title="复制远程路径"
                      aria-label="复制远程路径"
                      onClick={() => props.onCopyRemotePath(entry.filePath)}
                    >
                      <Copy size={15} strokeWidth={1.85} />
                    </button>
                    {entry.localPath ? (
                      <button
                        type="button"
                        className="ghost-button icon-button transfer-history-card-icon-button"
                        title={`复制${localPathLabel(entry.direction)}`}
                        aria-label={`复制${localPathLabel(entry.direction)}`}
                        onClick={() => props.onCopyLocalPath(entry.localPath!)}
                      >
                        <HardDrive size={15} strokeWidth={1.85} />
                      </button>
                    ) : null}
                    {canRevealLocalPath ? (
                      <button
                        type="button"
                        className="ghost-button icon-button transfer-history-card-icon-button"
                        title="在 Finder 中显示"
                        aria-label="在 Finder 中显示"
                        onClick={() => props.onRevealLocalPath(entry.localPath!)}
                      >
                        <FolderOpen size={15} strokeWidth={1.85} />
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="ghost-button icon-button transfer-history-card-icon-button transfer-history-expand-button"
                      title={isExpanded ? "收起详情" : "展开详情"}
                      aria-label={isExpanded ? "收起详情" : "展开详情"}
                      onClick={() => toggleEntryExpanded(entry.id)}
                    >
                      {isExpanded ? <ChevronUp size={15} strokeWidth={1.85} /> : <ChevronDown size={15} strokeWidth={1.85} />}
                    </button>
                  </div>
                </div>

                <div className="transfer-history-card-head">
                  <strong className="transfer-history-name" title={entry.fileName}>{entry.fileName}</strong>
                  <div className="transfer-history-meta">
                    <span>{props.formatDateTime(entry.createdAt)}</span>
                    <span>{props.formatBytes(entry.size)}</span>
                    <span>{entry.serverLabel}</span>
                  </div>
                </div>

                {entry.message ? <div className={`transfer-history-note transfer-history-note-${entry.status}`}>{entry.message}</div> : null}

                {isExpanded ? (
                  <div className="transfer-history-card-details">
                    <div className="transfer-history-path-line">
                      <label>远程</label>
                      <code>{entry.filePath}</code>
                    </div>
                    {entry.localPath ? (
                      <div className="transfer-history-path-line">
                        <label>{localPathLabel(entry.direction)}</label>
                        <code>{entry.localPath}</code>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
      </div>
    </div>
  );
}
