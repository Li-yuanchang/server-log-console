import { useCallback, useEffect, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { X, Copy, ClipboardPaste, RefreshCw, Plug } from "lucide-react";
import type { Terminal } from "@xterm/xterm";
import type { ServerSummary } from "@server-log-console/shared";
import { useTerminalSession } from "./useTerminalSession.js";
import { localServiceBase } from "./api.js";
import { copyText } from "./utils.js";
import type { TerminalPaneApiSnapshot } from "./TerminalSplitView.js";

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
  /** 终端体右键（用户反馈 Bug②）：分屏窗格统一走容器 TerminalContextMenu，preventDefault/stopPropagation 在本组件内做 */
  onPaneContextMenu?: (event: ReactMouseEvent) => void;
  /** 点击窗格体：SplitView 记录焦点窗格（对应原型 T2「点击窗格即切换焦点」） */
  onPaneFocus?: (paneId: string) => void;
  /** xterm 实例上报（用户反馈 Bug③）：直接透传 useTerminalSession 已有的同名 option */
  onTerminalInstanceChange?: (terminal: Terminal | null) => void;
  /** 会话能力快照上报（用户反馈 Bug③）：session 对象结构匹配 TerminalPaneApiSnapshot 即可，经稳定委托壳上报 */
  onApiSnapshot?: (api: TerminalPaneApiSnapshot | null) => void;
  /** 会话连接状态快照（用户反馈 Bug④）：供 SplitView 聚合；unmount 报 null */
  onSessionSnapshot?: (state: { connected: boolean; retryCount: number } | null) => void;
}

export function TerminalPane(props: Props) {
  const {
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
    onPaneContextMenu,
    onPaneFocus,
  } = props;
  const [selMenu, setSelMenu] = useState<{ x: number; y: number; text: string } | null>(null);

  /* 回调经 ref 上报：hook 内的 useCallback 可能捕获旧 options，ref 转发保证永远调到最新 prop
     （模仿容器里 TerminalTabPane 的 callbacksRef 上报模式） */
  const propsRef = useRef(props);
  propsRef.current = props;

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
    onTerminalInstanceChange: (terminal) => propsRef.current.onTerminalInstanceChange?.(terminal),
  });

  /* 会话能力快照（Bug③）：session 每次渲染都是新引用，直接上报会让 SplitView「仅在值变化时」
     的聚合失效；这里建一个稳定委托壳（结构匹配 TerminalPaneApiSnapshot），经 ref 每次渲染
     同步到最新 session —— 身份稳定、调用永远走最新实现。 */
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const apiSnapshotRef = useRef<TerminalPaneApiSnapshot | null>(null);
  if (!apiSnapshotRef.current) {
    apiSnapshotRef.current = {
      getSelection: () => sessionRef.current.getSelection(),
      clearSelection: () => sessionRef.current.clearSelection(),
      pasteToTerminal: (text) => sessionRef.current.pasteToTerminal(text),
      focusTerminal: () => sessionRef.current.focusTerminal(),
      focusTerminalSoon: () => sessionRef.current.focusTerminalSoon(),
      startTerminal: (options) => sessionRef.current.startTerminal(options),
      stopTerminal: (options) => sessionRef.current.stopTerminal(options),
    };
  }

  /* 挂载上报一次 / 卸载清空（壳身份稳定，不会随渲染重复上报） */
  useEffect(() => {
    propsRef.current.onApiSnapshot?.(apiSnapshotRef.current);
    return () => {
      propsRef.current.onApiSnapshot?.(null);
    };
  }, []);

  /* 会话状态快照（Bug④）：仅在 connected/retryCount 变化时上报；卸载报 null */
  const lastSessionSnapshotKeyRef = useRef("");
  useEffect(() => {
    const key = `${session.connected}|${session.retryCount}`;
    if (lastSessionSnapshotKeyRef.current === key) {
      return;
    }
    lastSessionSnapshotKeyRef.current = key;
    propsRef.current.onSessionSnapshot?.({ connected: session.connected, retryCount: session.retryCount });
  });
  useEffect(() => {
    return () => {
      propsRef.current.onSessionSnapshot?.(null);
    };
  }, []);

  const handleCopy = useCallback(async () => {
    if (!selMenu) return;
    await copyText(session.getSelection() || selMenu.text);
    session.clearSelection();
    setSelMenu(null);
    session.focusTerminalSoon();
  }, [selMenu, session]);

  const handleCopyAndPaste = useCallback(async () => {
    if (!selMenu) return;
    const text = session.getSelection() || selMenu.text;
    await copyText(text);
    session.pasteToTerminal(text);
    session.clearSelection();
    setSelMenu(null);
    session.focusTerminalSoon();
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
      <div
        className="terminal-pane-body"
        onMouseDown={() => {
          onPaneFocus?.(config.paneId);
          session.focusTerminal();
        }}
        onClick={() => {
          onPaneFocus?.(config.paneId);
          session.focusTerminal();
        }}
        onContextMenu={(event) => {
          /* 用户反馈 Bug②：拦截浏览器原生菜单，统一弹容器的 TerminalContextMenu */
          event.preventDefault();
          event.stopPropagation();
          onPaneContextMenu?.(event);
        }}
      >
        <div ref={session.containerRef} className="xterm-container" />
        {selMenu && (
          <div className="terminal-sel-menu" style={{ left: selMenu.x, top: selMenu.y }}>
            <button type="button" title="复制" onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); }} onClick={() => void handleCopy()}>
              <Copy size={14} />
            </button>
            <button type="button" title="复制并粘贴" onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); }} onClick={() => void handleCopyAndPaste()}>
              <ClipboardPaste size={14} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
