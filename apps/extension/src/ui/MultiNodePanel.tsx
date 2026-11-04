import { useState } from "react";
import { ChevronDown, ChevronRight, Download, Eye, Plus, RotateCcw, Square, X } from "lucide-react";
import type { MultiRecordTarget } from "./useMultiNodeRecording.js";

export type MultiNodeSessionRow = {
  sessionId: string;
  serverId: string;
  serverName: string;
  serverHost: string;
  username?: string;
  filePath: string;
  connected: boolean;
  connecting: boolean;
  checked: boolean;
};

type Props = {
  open: boolean;
  onClose: () => void;
  rows: MultiNodeSessionRow[];
  targets: MultiRecordTarget[];
  /** 停止后的「本次结果」视图：与「上次录制」历史分开，关闭面板/开新一批后归入历史 */
  resultView: boolean;
  onExitResult: () => void;
  onToggleCheck: (sessionId: string, checked: boolean) => void;
  onStart: () => void;
  onStopAll: () => void;
  onPreview: (target: MultiRecordTarget) => void;
  onDownload: (target: MultiRecordTarget) => void;
  onRetryTarget: (sessionId: string) => void;
  onDownloadAll: () => void;
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/** 批量录制面板（只管录制；多窗格实时走工具栏视墙按钮的独立面板）。
    阶段：选择 → 运行中 → 本次结果（停止后）→ 选择（+折叠的上次录制历史）。
    操作按钮统一 24px 图标化，语义靠 title。 */
export function MultiNodePanel(props: Props) {
  const [historyOpen, setHistoryOpen] = useState(false);
  if (!props.open) return null;

  const recActiveCount = props.targets.filter((t) => t.status === "recording" || t.status === "stopping").length;
  const recActive = recActiveCount > 0;
  const doneCount = props.targets.filter((t) => t.status === "done").length;
  const failedCount = props.targets.filter((t) => t.status === "failed").length;
  /* 录制不限台数：1 台 = 单台录制（沿用同一接口），0 台才禁用；实时面板保持 ≥2 */
  const pickReady = props.rows.filter((r) => r.checked && r.filePath).length;

  const showBusy = recActive;
  const showResult = !recActive && props.resultView && props.targets.length > 0;

  const subtitle = showBusy
    ? `录制中 ${recActiveCount} 台 · ${doneCount} 完成${failedCount ? ` · ${failedCount} 失败` : ""}`
    : showResult
      ? `本次录制 · ${doneCount} 完成${failedCount ? ` · ${failedCount} 失败` : ""}`
      : "批量对象 = 已打开的会话";

  const renderTargetRows = () => (
    <>
      {props.targets.map((target) => (
        <div key={target.sessionId} className="multi-mr-row">
          <span className={`multi-mr-dot multi-mr-dot-${target.status}`} />
          <span className="multi-mr-name">{target.serverName}</span>
          <span className="multi-mr-path" title={target.outPath || undefined}>
            {target.outPath || "…"}
          </span>
          <span className="multi-mr-size">
            {target.status === "done"
              ? formatBytes(target.sizeBytes)
              : target.status === "failed"
                ? "失败"
                : "录制中"}
          </span>
          <span className="multi-mr-ops">
            {target.status === "done" ? (
              <>
                <button className="multi-icon-btn" type="button" title="预览" aria-label={`预览 ${target.serverName} 的录制文件`} onClick={() => props.onPreview(target)}>
                  <Eye size={13} strokeWidth={1.8} />
                </button>
                <button className="multi-icon-btn" type="button" title="下载" aria-label={`下载 ${target.serverName} 的录制文件`} onClick={() => props.onDownload(target)}>
                  <Download size={13} strokeWidth={1.8} />
                </button>
              </>
            ) : null}
            {target.status === "failed" ? (
              <button className="multi-icon-btn" type="button" title="重试" aria-label={`重试 ${target.serverName} 的录制`} onClick={() => props.onRetryTarget(target.sessionId)}>
                <RotateCcw size={13} strokeWidth={1.8} />
              </button>
            ) : null}
          </span>
        </div>
      ))}
      {props.targets
        .filter((target) => target.status === "failed" && target.failMsg)
        .map((target) => (
          <div key={`${target.sessionId}-err`} className="multi-mr-err">{target.serverName}：{target.failMsg}</div>
        ))}
    </>
  );

  return (
    <div className="multi-node-panel" role="dialog" aria-label="批量录制">
      <div className="multi-node-panel-head">
        <span className="multi-node-panel-title">批量录制</span>
        <span className="multi-node-panel-sub">{subtitle}</span>
        <button className="ghost-button icon-button" type="button" aria-label="关闭" onClick={props.onClose}>
          <X size={14} strokeWidth={1.8} />
        </button>
      </div>

      {showBusy ? (
        <>
          <div className="multi-node-panel-body">{renderTargetRows()}</div>
          <div className="multi-node-panel-foot">
            <span>文件实时写入各节点本地 · 关闭面板后台继续</span>
            <span className="multi-node-foot-actions">
              <button className="multi-icon-btn multi-icon-btn-danger" type="button" title="停止全部" aria-label="停止全部录制" onClick={props.onStopAll}>
                <Square size={13} strokeWidth={1.8} />
              </button>
            </span>
          </div>
        </>
      ) : showResult ? (
        <>
          <div className="multi-node-panel-body">{renderTargetRows()}</div>
          <div className="multi-node-panel-foot">
            <span>已录制文件保留在各节点上</span>
            <span className="multi-node-foot-actions">
              {doneCount > 0 ? (
                <button className="multi-icon-btn" type="button" title="全部下载" aria-label="全部下载" onClick={props.onDownloadAll}>
                  <Download size={13} strokeWidth={1.8} />
                </button>
              ) : null}
              <button className="multi-icon-btn" type="button" title="开新一批" aria-label="开新一批录制" onClick={props.onExitResult}>
                <Plus size={13} strokeWidth={1.8} />
              </button>
            </span>
          </div>
        </>
      ) : (
        <>
          <div className="multi-node-panel-body">
            {props.rows.length ? props.rows.map((row) => {
              const disabled = !row.filePath;
              return (
                <label key={row.sessionId} className={`multi-ss-row${disabled ? " multi-ss-row-disabled" : ""}`}>
                  <input
                    type="checkbox"
                    checked={row.checked}
                    disabled={disabled}
                    onChange={(event) => props.onToggleCheck(row.sessionId, event.target.checked)}
                  />
                  <span className="multi-ss-name">{row.serverName}</span>
                  <span className="multi-ss-host">{row.username ? `${row.username}@` : ""}{row.serverHost}</span>
                  <span className={`multi-ss-path${row.filePath ? "" : " multi-ss-path-none"}`} title={row.filePath || undefined}>
                    {row.filePath || "未选择日志文件"}
                  </span>
                  <span className={`multi-ss-state${row.connecting ? " multi-ss-connecting" : row.connected ? " multi-ss-ok" : ""}`}>
                    {row.connecting ? "连接中…" : row.connected ? "已连接" : "未连接"}
                  </span>
                </label>
              );
            }) : (
              <div className="multi-node-panel-empty">还没有打开的工作区会话——先在左侧连接服务器，再回到这里批量操作。</div>
            )}
            {props.targets.length > 0 ? (
              <div className="multi-history">
                <div className="multi-history-head">
                  <button
                    type="button"
                    className="multi-history-toggle"
                    onClick={() => setHistoryOpen((current) => !current)}
                  >
                    {historyOpen ? <ChevronDown size={12} strokeWidth={1.8} /> : <ChevronRight size={12} strokeWidth={1.8} />}
                    上次录制 · {doneCount} 完成{failedCount ? ` · ${failedCount} 失败` : ""}
                  </button>
                  <span className="multi-history-spacer" />
                  {doneCount > 0 ? (
                    <button className="multi-icon-btn" type="button" title="全部下载" aria-label="下载上次的全部录制文件" onClick={props.onDownloadAll}>
                      <Download size={13} strokeWidth={1.8} />
                    </button>
                  ) : null}
                </div>
                {historyOpen ? <div className="multi-history-body">{renderTargetRows()}</div> : null}
              </div>
            ) : null}
          </div>
          <div className="multi-node-panel-foot">
            <span>
              {pickReady === 0
                ? "勾选要录制的会话 · 未连接会话自动连接"
                : pickReady === 1
                  ? "单台录制 · 未连接会话自动连接"
                  : "未连接的会话开始时自动连接 · 路径用各会话当前文件"}
            </span>
            <span className="multi-node-foot-actions">
              <button
                className="primary-button slim-button"
                type="button"
                disabled={pickReady === 0}
                onClick={props.onStart}
              >
                开始录制（{pickReady} 台）
              </button>
            </span>
          </div>
        </>
      )}
    </div>
  );
}
