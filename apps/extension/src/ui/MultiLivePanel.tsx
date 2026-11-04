import { RotateCcw, Square, X } from "lucide-react";
import type { MultiNodeSessionRow } from "./MultiNodePanel.js";
import type { MultiLivePane } from "./useMultiNodeLive.js";

type Props = {
  open: boolean;
  onClose: () => void;
  rows: MultiNodeSessionRow[];
  panes: MultiLivePane[];
  onToggleCheck: (sessionId: string, checked: boolean) => void;
  onStart: () => void;
  onLiveStop: () => void;
  onLiveRemove: (sessionId: string) => void;
  onLiveRetry: (sessionId: string) => void;
};

/** 多窗格实时面板（纯实时；录制走批量录制面板，两者独立）。
    运行中打开 = 窗格状态视图（移除/重试/停止全部）；空闲打开 = 选择视图。
    未连接的会话直接开——连不上会在窗格内标错并提供重试。 */
export function MultiLivePanel(props: Props) {
  if (!props.open) return null;
  const running = props.panes.length > 0;
  /* 批量的意义 = 至少 2 台：只勾 1 台时按钮禁用（单节点实时用 LIVE） */
  const pickReady = props.rows.filter((r) => r.checked && r.filePath).length;

  const statusText = (status: MultiLivePane["status"]) =>
    status === "live" ? "实时" : status === "error" ? "已断开" : "连接中…";

  return (
    <div className="multi-node-panel" role="dialog" aria-label="多窗格实时">
      <div className="multi-node-panel-head">
        <span className="multi-node-panel-title">多窗格实时</span>
        <span className="multi-node-panel-sub">
          {running ? `运行中 · ${props.panes.length} 窗格 · 视墙在主区展示` : "每会话一个独立视窗 · 视墙在主区展示"}
        </span>
        <button className="ghost-button icon-button" type="button" aria-label="关闭" onClick={props.onClose}>
          <X size={14} strokeWidth={1.8} />
        </button>
      </div>

      {running ? (
        <>
          <div className="multi-node-panel-body">
            {props.panes.map((pane, index) => (
              <div key={pane.sessionId} className="multi-mr-row">
                <span className={`multi-pane-dot multi-pane-dot-${index % 3}`} />
                <span className="multi-mr-name">{pane.serverName}</span>
                <span className="multi-mr-path" title={pane.filePath}>{pane.filePath}</span>
                <span className="multi-mr-size">{statusText(pane.status)}</span>
                <span className="multi-mr-ops">
                  {pane.status === "error" ? (
                    <button className="multi-icon-btn" type="button" title="重试" aria-label={`重试 ${pane.serverName} 的实时连接`} onClick={() => props.onLiveRetry(pane.sessionId)}>
                      <RotateCcw size={13} strokeWidth={1.8} />
                    </button>
                  ) : (
                    <button className="multi-icon-btn" type="button" title="移除该窗格" aria-label={`移除 ${pane.serverName} 窗格`} onClick={() => props.onLiveRemove(pane.sessionId)}>
                      <X size={13} strokeWidth={1.8} />
                    </button>
                  )}
                </span>
              </div>
            ))}
          </div>
          <div className="multi-node-panel-foot">
            <span>每会话一条独立 tail · 关闭面板后台继续</span>
            <span className="multi-node-foot-actions">
              <button className="multi-icon-btn multi-icon-btn-danger" type="button" title="停止全部" aria-label="停止全部实时" onClick={props.onLiveStop}>
                <Square size={13} strokeWidth={1.8} />
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
              <div className="multi-node-panel-empty">还没有打开的工作区会话——先在左侧连接服务器。</div>
            )}
          </div>
          <div className="multi-node-panel-foot">
            <span>
              {pickReady > 0 && pickReady < 2
                ? `批量实时至少选 2 台（当前 ${pickReady} 台）· 单节点用工具栏 LIVE`
                : "未连接的会话直接开：连不上会在窗格内标错可重试"}
            </span>
            <span className="multi-node-foot-actions">
              <button
                className="primary-button slim-button"
                type="button"
                disabled={pickReady < 2}
                onClick={props.onStart}
              >
                开始实时（{pickReady} 窗格）
              </button>
            </span>
          </div>
        </>
      )}
    </div>
  );
}
