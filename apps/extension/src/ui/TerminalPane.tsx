import { useCallback, useEffect, useState } from "react";
import { X, Copy, ClipboardPaste, RefreshCw, Plug } from "lucide-react";
import type { ServerSummary } from "@server-log-console/shared";
import { useTerminalSession } from "./useTerminalSession.js";
import { localServiceBase } from "./api.js";

export interface TerminalPaneConfig {
  paneId: string;
  sessionId: string;
}

interface Props {
  config: TerminalPaneConfig;
  serverId: string;
  selectedServer: ServerSummary | null;
  preferredBastionId: string;
  isBusy: boolean;
  cwd?: string;
  onStatus: (msg: string) => void;
  onActivity: (msg: string) => void;
  onSessionIdChange: (paneId: string, sessionId: string) => void;
  onClose: (paneId: string) => void;
  onSplit: (paneId: string, direction: "horizontal" | "vertical") => void;
}

export function TerminalPane({
  config,
  serverId,
  selectedServer,
  preferredBastionId,
  isBusy,
  cwd,
  onStatus,
  onActivity,
  onSessionIdChange,
  onClose,
  onSplit,
}: Props) {
  const [selMenu, setSelMenu] = useState<{ x: number; y: number; text: string } | null>(null);

  const session = useTerminalSession({
    active: true,
    localServiceBase,
    serverId,
    preferredBastionId,
    sessionId: config.sessionId,
    selectedServer,
    isBusy,
    cwd,
    onStatus,
    onActivity,
    onSessionIdChange: (id) => onSessionIdChange(config.paneId, id),
    preserveSessionOnInactive: false,
    preserveSessionOnDispose: false,
    onSelectionMenu: setSelMenu,
  });

  const handleCopy = useCallback(async () => {
    if (!selMenu) return;
    await navigator.clipboard.writeText(selMenu.text);
    session.clearSelection();
    setSelMenu(null);
  }, [selMenu, session]);

  const handleCopyAndPaste = useCallback(async () => {
    if (!selMenu) return;
    await navigator.clipboard.writeText(selMenu.text);
    session.pasteToTerminal(selMenu.text);
    session.clearSelection();
    setSelMenu(null);
  }, [selMenu, session]);

  useEffect(() => {
    const timers = [0, 48, 160, 360, 720].map((delay) => window.setTimeout(() => {
      session.fitTerminal();
    }, delay));

    return () => {
      for (const timer of timers) {
        window.clearTimeout(timer);
      }
    };
  }, [config.paneId, serverId, session.connected]);

  return (
    <div className="terminal-pane">
      <div className="terminal-pane-bar">
        <span className={`terminal-status-dot ${session.connected ? "terminal-status-dot-connected" : ""}`} />
        <span className="terminal-pane-label">{selectedServer?.name || serverId}</span>
        <div className="terminal-pane-bar-actions">
          <button type="button" onClick={() => onSplit(config.paneId, "horizontal")} title="水平分屏">H</button>
          <button type="button" onClick={() => onSplit(config.paneId, "vertical")} title="垂直分屏">V</button>
          <button type="button" onClick={() => session.startTerminal?.()} disabled={session.connected || isBusy} title="连接">
            {session.connected ? <RefreshCw size={11} /> : <Plug size={11} />}
          </button>
          <button type="button" onClick={() => onClose(config.paneId)} title="关闭">
            <X size={11} />
          </button>
        </div>
      </div>
      <div className="terminal-pane-body" onMouseDown={() => session.focusTerminal()} onClick={() => session.focusTerminal()}>
        <div ref={session.containerRef} className="xterm-container" />
        {selMenu && (
          <div className="terminal-sel-menu" style={{ left: selMenu.x, top: selMenu.y }}>
            <button type="button" title="复制" onMouseDown={(e) => e.stopPropagation()} onClick={() => void handleCopy()}>
              <Copy size={14} />
            </button>
            <button type="button" title="复制并粘贴" onMouseDown={(e) => e.stopPropagation()} onClick={() => void handleCopyAndPaste()}>
              <ClipboardPaste size={14} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
