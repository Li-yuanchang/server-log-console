import type { TransferHistoryEntry } from "./storage.js";
import { getParentDirectoryPath } from "./utils.js";

type Props = {
  entries: TransferHistoryEntry[];
  formatBytes: (value: number) => string;
  formatDateTime: (value?: string) => string;
  onBrowsePath: (path: string) => void;
  onClear: () => void;
};

export function TransferHistoryDropdown(props: Props) {
  if (!props.entries.length) {
    return (
      <div className="path-history-dropdown transfer-history-dropdown">
        <div className="transfer-history-head">
          <strong>传输记录</strong>
        </div>
        <span className="path-history-empty">当前服务器暂无传输记录</span>
      </div>
    );
  }

  function renderLocalPath(entry: TransferHistoryEntry) {
    if (!entry.localPath) {
      return null;
    }
    return (
      <div className="transfer-history-extra">
        {entry.direction === "upload" ? `来源：${entry.localPath}` : `保存到：${entry.localPath}`}
      </div>
    );
  }

  return (
    <div className="path-history-dropdown transfer-history-dropdown">
      <div className="transfer-history-head">
        <strong>传输记录</strong>
        <button type="button" className="transfer-history-clear" onClick={props.onClear}>
          清空
        </button>
      </div>
      {props.entries.map((entry) => (
        <div
          key={entry.id}
          role="button"
          className={`transfer-history-item transfer-history-item-${entry.status}`}
          onClick={() => props.onBrowsePath(getParentDirectoryPath(entry.filePath))}
        >
          <div className="transfer-history-row">
            <span className={`transfer-history-chip transfer-history-chip-${entry.direction}`}>
              {entry.direction === "upload" ? "上传" : "下载"}
            </span>
            <span className={`transfer-history-chip transfer-history-chip-${entry.status}`}>
              {entry.status === "success" ? "成功" : "失败"}
            </span>
            <span className="transfer-history-name">{entry.fileName}</span>
          </div>
          <div className="transfer-history-meta">
            <span>{props.formatDateTime(entry.createdAt)}</span>
            <span>{props.formatBytes(entry.size)}</span>
          </div>
          <div className="transfer-history-path">{entry.filePath}</div>
          {renderLocalPath(entry)}
          {entry.message ? <div className="transfer-history-extra">{entry.message}</div> : null}
        </div>
      ))}
    </div>
  );
}
