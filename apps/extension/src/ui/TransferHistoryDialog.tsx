import { useMemo, useState } from "react";
import type { TransferHistoryEntry, TransferHistoryStatus } from "./storage.js";
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

export function TransferHistoryDialog(props: Props) {
  const [keyword, setKeyword] = useState("");
  const [directionFilter, setDirectionFilter] = useState<DirectionFilter>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

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

  return (
    <div className="confirm-backdrop transfer-history-backdrop" onClick={props.onClose}>
      <div className="confirm-dialog transfer-history-dialog" onClick={(event) => event.stopPropagation()}>
        <div className="transfer-history-dialog-head">
          <div>
            <div className="confirm-title">传输记录</div>
            <div className="transfer-history-dialog-subtitle">记录上传、下载、失败与取消，支持远程定位和本地追溯。</div>
          </div>
          <div className="transfer-history-dialog-head-actions">
            <button type="button" className="transfer-history-clear" onClick={props.onClear} disabled={!props.entries.length}>
              清空当前服务器记录
            </button>
            <button type="button" className="confirm-btn confirm-btn-cancel transfer-history-close" onClick={props.onClose}>
              关闭
            </button>
          </div>
        </div>

        <div className="transfer-history-summary-grid">
          <div className="transfer-history-summary-card"><strong>{props.entries.length}</strong><span>总记录</span></div>
          <div className="transfer-history-summary-card"><strong>{summary.uploads}</strong><span>上传</span></div>
          <div className="transfer-history-summary-card"><strong>{summary.downloads}</strong><span>下载</span></div>
          <div className="transfer-history-summary-card"><strong>{summary.success}</strong><span>成功</span></div>
          <div className="transfer-history-summary-card"><strong>{summary.error}</strong><span>失败</span></div>
          <div className="transfer-history-summary-card"><strong>{summary.canceled}</strong><span>取消</span></div>
        </div>

        <div className="transfer-history-filter-row">
          <input
            className="rename-input transfer-history-search"
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            placeholder="搜索文件名、远程路径、本地路径或错误信息"
          />
          <select className="transfer-history-select" value={directionFilter} onChange={(event) => setDirectionFilter(event.target.value as DirectionFilter)}>
            <option value="all">全部方向</option>
            <option value="upload">仅上传</option>
            <option value="download">仅下载</option>
          </select>
          <select className="transfer-history-select" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}>
            <option value="all">全部状态</option>
            <option value="success">成功</option>
            <option value="error">失败</option>
            <option value="canceled">取消</option>
          </select>
          <div className="transfer-history-filter-meta">显示 {filteredEntries.length} / {props.entries.length} 条</div>
        </div>

        <div className="transfer-history-dialog-body">
          {!filteredEntries.length ? (
            <div className="transfer-history-empty-panel">
              {props.entries.length ? "没有符合当前筛选条件的记录" : "当前服务器暂无传输记录"}
            </div>
          ) : filteredEntries.map((entry) => {
            const canRevealLocalPath = Boolean(entry.localPath && props.isElectron && isAbsoluteLocalPath(entry.localPath));
            return (
              <article key={entry.id} className="transfer-history-card">
                <div className="transfer-history-card-head">
                  <div className="transfer-history-row">
                    <span className={`transfer-history-chip transfer-history-chip-${entry.direction}`}>
                      {entry.direction === "upload" ? "上传" : "下载"}
                    </span>
                    <span className={`transfer-history-chip transfer-history-chip-${entry.status}`}>
                      {statusLabel(entry.status)}
                    </span>
                    <strong className="transfer-history-name">{entry.fileName}</strong>
                  </div>
                  <div className="transfer-history-meta">
                    <span>{props.formatDateTime(entry.createdAt)}</span>
                    <span>{props.formatBytes(entry.size)}</span>
                    <span>{entry.serverLabel}</span>
                  </div>
                </div>

                <div className="transfer-history-path-line">
                  <label>远程</label>
                  <code>{entry.filePath}</code>
                </div>
                {entry.localPath ? (
                  <div className="transfer-history-path-line">
                    <label>{entry.direction === "upload" ? "本地来源" : "本地保存"}</label>
                    <code>{entry.localPath}</code>
                  </div>
                ) : null}
                {entry.message ? <div className={`transfer-history-note transfer-history-note-${entry.status}`}>{entry.message}</div> : null}

                <div className="transfer-history-action-row">
                  <button type="button" className="ghost-button" onClick={() => props.onBrowsePath(getParentDirectoryPath(entry.filePath))}>
                    打开远程目录
                  </button>
                  <button type="button" className="ghost-button" onClick={() => props.onCopyRemotePath(entry.filePath)}>
                    复制远程路径
                  </button>
                  {entry.localPath ? (
                    <button type="button" className="ghost-button" onClick={() => props.onCopyLocalPath(entry.localPath!)}>
                      复制本地路径
                    </button>
                  ) : null}
                  {canRevealLocalPath ? (
                    <button type="button" className="ghost-button" onClick={() => props.onRevealLocalPath(entry.localPath!)}>
                      在 Finder 中显示
                    </button>
                  ) : null}
                </div>
              </article>
            );
          })}
        </div>
      </div>
    </div>
  );
}
