import { useRef, useCallback, useEffect } from "react";
import { ExternalLink, PanelBottomClose, X } from "lucide-react";
import type { RefObject, PointerEvent as ReactPointerEvent } from "react";
import type { ServerSummary } from "@server-log-console/shared";
import { looksLikeJumpServer } from "./terminal-utils.js";

interface TerminalPanelProps {
  server: ServerSummary | null;
  connected: boolean;
  isBusy: boolean;
  serverId: string;
  detached: boolean;
  containerRef: RefObject<HTMLDivElement | null>;
  onReconnect: () => void;
  onClose: () => void;
  onFocus: () => void;
  onDetach: () => void;
  onAttach: () => void;
  onFit?: () => void;
}

export function TerminalPanel(props: TerminalPanelProps) {
  const isJumpServer = looksLikeJumpServer(props.server);
  const floatRef = useRef<HTMLDivElement | null>(null);
  const dragState = useRef<{ startX: number; startY: number; origLeft: number; origTop: number } | null>(null);

  const onBarPointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (!props.detached) return;
    const el = floatRef.current;
    if (!el) return;
    if ((event.target as HTMLElement).closest("button")) return;
    event.preventDefault();
    const rect = el.getBoundingClientRect();
    dragState.current = { startX: event.clientX, startY: event.clientY, origLeft: rect.left, origTop: rect.top };
    (event.target as HTMLElement).setPointerCapture(event.pointerId);
  }, [props.detached]);

  const onBarPointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const ds = dragState.current;
    if (!ds) return;
    const el = floatRef.current;
    if (!el) return;
    const dx = event.clientX - ds.startX;
    const dy = event.clientY - ds.startY;
    el.style.left = `${ds.origLeft + dx}px`;
    el.style.top = `${ds.origTop + dy}px`;
    el.style.right = "auto";
    el.style.bottom = "auto";
  }, []);

  const onBarPointerUp = useCallback(() => {
    dragState.current = null;
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => props.onFit?.(), 60);
    return () => window.clearTimeout(timer);
  }, [props.detached]);

  const barContent = (
    <>
      <div
        className="terminal-panel-bar"
        onPointerDown={onBarPointerDown}
        onPointerMove={onBarPointerMove}
        onPointerUp={onBarPointerUp}
        style={props.detached ? { cursor: "grab" } : undefined}
      >
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
          {props.detached ? (
            <button type="button" onClick={props.onAttach} title="收回底部"><PanelBottomClose size={13} /></button>
          ) : (
            <button type="button" onClick={props.onDetach} title="弹出窗口"><ExternalLink size={13} /></button>
          )}
          <button type="button" onClick={props.onClose} title="关闭终端">
            <X size={13} />
          </button>
        </div>
      </div>
      <div className="terminal-panel-body">
        <div ref={props.containerRef} className="xterm-container" />
      </div>
    </>
  );

  if (props.detached) {
    return (
      <div ref={floatRef} className="terminal-float-window" onClick={props.onFocus}>
        {barContent}
      </div>
    );
  }

  return (
    <section className="terminal-bottom-panel" onClick={props.onFocus}>
      {barContent}
    </section>
  );
}
