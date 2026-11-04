import { Square } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { MultiLivePane } from "./useMultiNodeLive.js";

type Props = {
  panes: MultiLivePane[];
  onRemove: (sessionId: string) => void;
  onRetry: (sessionId: string) => void;
  onStopAll: () => void;
};

export function MultiNodeLiveWall(props: Props) {
  return (
    <div className="multi-live-block">
      <div className="multi-live-bar">
        <span>多窗格实时 · 每个会话独立视窗 · 共 {props.panes.length} 窗格</span>
        <button className="multi-icon-btn multi-icon-btn-danger" type="button" title="停止全部" aria-label="停止全部" onClick={props.onStopAll}>
          <Square size={13} strokeWidth={1.8} />
        </button>
      </div>
      <div className="multi-live-wall">
        {props.panes.map((pane, index) => (
          <MultiLivePaneView
            key={pane.sessionId}
            pane={pane}
            colorIndex={index % 3}
            onRemove={props.onRemove}
            onRetry={props.onRetry}
          />
        ))}
      </div>
    </div>
  );
}

function MultiLivePaneView(props: {
  pane: MultiLivePane;
  colorIndex: number;
  onRemove: (sessionId: string) => void;
  onRetry: (sessionId: string) => void;
}) {
  const { pane } = props;
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const atBottomRef = useRef(true);
  const [notAtBottom, setNotAtBottom] = useState(false);

  useEffect(() => {
    const el = bodyRef.current;
    if (el && atBottomRef.current) el.scrollTop = el.scrollHeight;
  }, [pane.content]);

  const statusNode =
    pane.status === "live" ? (
      <span className="multi-pane-status multi-pane-status-ok">实时</span>
    ) : pane.status === "error" ? (
      <span className="multi-pane-status multi-pane-status-err">已断开</span>
    ) : (
      <span className="multi-pane-status">连接中…</span>
    );

  return (
    <section className={`multi-pane multi-pane-c${props.colorIndex}`}>
      <div className="multi-pane-head">
        <span className={`multi-pane-dot multi-pane-dot-${props.colorIndex}`} />
        <span className="multi-pane-name">{pane.serverName}</span>
        <span className="multi-pane-path" title={pane.filePath}>{pane.filePath}</span>
        {statusNode}
        <button
          className="multi-pane-close"
          type="button"
          aria-label={`移除 ${pane.serverName} 窗格`}
          title="移除该窗格"
          onClick={() => props.onRemove(pane.sessionId)}
        >
          ×
        </button>
      </div>
      {pane.status === "error" ? (
        <div className="multi-pane-error">
          <div>{pane.error}</div>
          <button className="ghost-button slim-button" type="button" onClick={() => props.onRetry(pane.sessionId)}>
            重试
          </button>
        </div>
      ) : (
        <div
          ref={bodyRef}
          className="multi-pane-body"
          onScroll={(event) => {
            const el = event.currentTarget;
            const near = el.scrollHeight - el.scrollTop - el.clientHeight < 28;
            atBottomRef.current = near;
            setNotAtBottom(!near);
          }}
        >
          <pre className="multi-pane-pre">{pane.content}</pre>
        </div>
      )}
      {pane.status !== "error" && notAtBottom ? (
        <button
          className="multi-pane-jump"
          type="button"
          onClick={() => {
            const el = bodyRef.current;
            if (el) el.scrollTop = el.scrollHeight;
            atBottomRef.current = true;
            setNotAtBottom(false);
          }}
        >
          ↑ 回到底部
        </button>
      ) : null}
    </section>
  );
}
