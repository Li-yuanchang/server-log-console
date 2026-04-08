import type { RefObject } from "react";
import type { ServerSummary } from "@server-log-console/shared";
import { looksLikeJumpServer } from "./terminal-utils.js";

interface TerminalPanelProps {
  server: ServerSummary | null;
  connected: boolean;
  isBusy: boolean;
  serverId: string;
  containerRef: RefObject<HTMLDivElement | null>;
  onReconnect: () => void;
  onClose: () => void;
  onFocus: () => void;
}

export function TerminalPanel(props: TerminalPanelProps) {
  const isJumpServer = looksLikeJumpServer(props.server);

  return (
    <section className="terminal-bottom-panel" onClick={props.onFocus}>
      <div className="terminal-panel-bar">
        <div className="terminal-panel-bar-info">
          <span className={`terminal-status-dot ${props.connected ? "terminal-status-dot-connected" : ""}`} />
          <strong>{props.server?.name || "终端"}</strong>
          <span>{props.server?.host || "--"}</span>
          {isJumpServer ? <span>堡垒机</span> : null}
        </div>
        <div className="terminal-panel-bar-actions">
          <button type="button" onClick={props.onReconnect} disabled={props.isBusy || !props.serverId}>
            {props.connected ? "重连" : "连接"}
          </button>
          <button type="button" onClick={props.onClose} title="收起终端">
            ✕
          </button>
        </div>
      </div>
      <div className="terminal-panel-body">
        <div ref={props.containerRef} className="xterm-container" />
      </div>
    </section>
  );
}
