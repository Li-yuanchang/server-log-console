import { useCallback, useEffect, useRef, useState } from "react";
import { PictureInPicture2, X, Clipboard, ClipboardPaste, Zap, RefreshCw, Plug, Sparkles, Columns } from "lucide-react";
import type { RefObject } from "react";
import type { ServerSummary } from "@server-log-console/shared";
import { looksLikeJumpServer } from "./terminal-utils.js";
import { TerminalShortcuts } from "./TerminalShortcuts.js";
import { TerminalAI } from "./TerminalAI.js";

interface TerminalPanelProps {
  server: ServerSummary | null;
  connected: boolean;
  isBusy: boolean;
  serverId: string;
  statusText?: string;
  subtitleText?: string;
  detached: boolean;
  terminalOverlay: "none" | "shortcuts" | "ai";
  containerRef: RefObject<HTMLDivElement | null>;
  onReconnect: () => void;
  onClose: () => void;
  onCloseTerminalOverlay: () => void;
  onFocus: () => void;
  onDetach: () => void;
  onAttach: () => void;
  onFit?: () => void;
  selMenu: { x: number; y: number; text: string } | null;
  clearSelection: () => void;
  pasteToTerminal: (text: string) => void;
  onToggleTerminalOverlay: (overlay: "shortcuts" | "ai") => void;
  onDismissMenu: () => void;
  onSplitMode?: () => void;
  popupMode?: "embedded" | "standalone";
}

const isElectronRuntime = typeof window !== "undefined" && "electronAPI" in window;
type DocumentPictureInPictureWindowApi = {
  requestWindow: (options: { width: number; height: number }) => Promise<Window>;
};

export function TerminalPanel(props: TerminalPanelProps) {
  const isJumpServer = looksLikeJumpServer(props.server);
  const isStandalone = props.popupMode === "standalone";
  const panelBodyRef = useRef<HTMLDivElement | null>(null);
  const bodySlotRef = useRef<HTMLDivElement | null>(null);
  const [pipWindow, setPipWindow] = useState<Window | null>(null);
  const isBrowserPip = pipWindow !== null;
  const showDetachedPlaceholder = (isElectronRuntime ? props.detached : isBrowserPip) && !isStandalone;
  const showShortcuts = props.terminalOverlay === "shortcuts";
  const showAI = props.terminalOverlay === "ai";
  const terminalTitle = props.server?.name || "终端";
  const terminalSubtitle = props.subtitleText?.trim() || props.server?.host || "--";
  const terminalStatusText = props.statusText?.trim() || (props.connected ? "终端已连接" : (props.serverId ? "等待连接终端..." : "未选择服务器"));
  const standaloneMetaText = terminalSubtitle && terminalSubtitle !== terminalTitle ? terminalSubtitle : "";
  const showStandaloneConnectionStrip = false;

  const handleCopy = useCallback(async () => {
    if (!props.selMenu) return;
    await navigator.clipboard.writeText(props.selMenu.text);
    props.clearSelection();
    props.onDismissMenu();
  }, [props]);

  const handleCopyAndPaste = useCallback(async () => {
    if (!props.selMenu) return;
    await navigator.clipboard.writeText(props.selMenu.text);
    props.pasteToTerminal(props.selMenu.text);
    props.clearSelection();
    props.onDismissMenu();
  }, [props]);

  const togglePip = useCallback(async () => {
    if (isStandalone) {
      return;
    }

    if (isElectronRuntime) {
      if (props.detached) {
        props.onAttach();
      } else {
        props.onDetach();
      }
      return;
    }

    if (pipWindow) {
      pipWindow.close();
      return;
    }

    if (!("documentPictureInPicture" in window)) {
      alert("当前浏览器不支持 Document Picture-in-Picture API");
      return;
    }

    try {
      const pipApi = (window as Window & { documentPictureInPicture?: DocumentPictureInPictureWindowApi }).documentPictureInPicture;
      if (!pipApi) {
        alert("当前浏览器不支持 Document Picture-in-Picture API");
        return;
      }

      const pip = await pipApi.requestWindow({
        width: 720,
        height: 440,
      });

      for (const sheet of document.styleSheets) {
        try {
          if (sheet.href) {
            const link = pip.document.createElement("link");
            link.rel = "stylesheet";
            link.href = sheet.href;
            pip.document.head.appendChild(link);
          } else if (sheet.cssRules) {
            const style = pip.document.createElement("style");
            for (const rule of sheet.cssRules) {
              style.textContent += `${rule.cssText}\n`;
            }
            pip.document.head.appendChild(style);
          }
        } catch {}
      }

      pip.document.body.className = document.body.className;
      const pipTitle = props.server?.name || props.server?.host || "终端";
      const titleEl = pip.document.createElement("title");
      titleEl.textContent = pipTitle;
      pip.document.head.appendChild(titleEl);
      pip.document.title = pipTitle;

      const body = panelBodyRef.current;
      if (body) {
        const wrapper = pip.document.createElement("div");
        wrapper.className = "pip-terminal-root";
        wrapper.appendChild(body);
        pip.document.body.appendChild(wrapper);
      }

      pip.addEventListener("pagehide", () => {
        const el = panelBodyRef.current;
        const slot = bodySlotRef.current;
        if (el && slot) {
          slot.appendChild(el);
        }
        setPipWindow(null);
        setTimeout(() => props.onFit?.(), 60);
      });

      setPipWindow(pip);
      setTimeout(() => props.onFit?.(), 100);
    } catch (error) {
      console.error("Failed to open terminal PiP:", error);
    }
  }, [isStandalone, pipWindow, props]);

  useEffect(() => {
    return () => {
      pipWindow?.close();
    };
  }, [pipWindow]);

  useEffect(() => {
    if (!isStandalone) {
      return;
    }

    const timer = window.setTimeout(() => {
      props.onFit?.();
    }, 80);

    return () => {
      window.clearTimeout(timer);
    };
  }, [isStandalone, props.connected, props.onFit]);

  return (
    <section className={`terminal-bottom-panel${isStandalone ? " terminal-bottom-panel-standalone" : ""}`}>
      <div className={`terminal-panel-bar${isStandalone ? " terminal-panel-bar-standalone" : ""}`}>
        {isStandalone ? (
          <>
            <div className="terminal-panel-bar-safearea" />
            <div className="terminal-panel-bar-title">
              <strong>{terminalTitle}</strong>
            </div>
          </>
        ) : (
          <div className="terminal-panel-bar-info">
            <span className={`terminal-status-dot ${props.connected ? "terminal-status-dot-connected" : ""}`} />
            <strong>{terminalTitle}</strong>
            <span>{terminalSubtitle}</span>
            {isJumpServer ? <span>堡垒机</span> : null}
          </div>
        )}
        <div className="terminal-panel-bar-actions">
          <button
            type="button"
            className={showShortcuts ? "terminal-shortcuts-toggle-active" : undefined}
            onClick={() => props.onToggleTerminalOverlay("shortcuts")}
            disabled={!props.serverId}
            title="快捷命令"
          >
            <Zap size={13} />
          </button>
          <button
            type="button"
            className={showAI ? "tai-toggle-active" : undefined}
            onClick={() => props.onToggleTerminalOverlay("ai")}
            disabled={!props.serverId}
            title="AI 助手"
          >
            <Sparkles size={13} />
          </button>
          <button type="button" onClick={props.onReconnect} disabled={props.isBusy || !props.serverId} title={props.connected ? "重连" : "连接"}>
            {props.connected ? <RefreshCw size={13} /> : <Plug size={13} />}
          </button>
          {!isStandalone ? (
            <button
              type="button"
              onClick={() => void togglePip()}
              title={(isElectronRuntime ? props.detached : isBrowserPip) ? "收回终端" : "弹出独立小窗"}
            >
              <PictureInPicture2 size={13} />
            </button>
          ) : null}
          {!isStandalone ? (
            <button type="button" onClick={props.onSplitMode} title="分屏模式">
              <Columns size={13} />
            </button>
          ) : null}
          {!isStandalone ? (
            <button type="button" onClick={props.onClose} title="关闭终端">
              <X size={13} />
            </button>
          ) : null}
        </div>
      </div>
      {showStandaloneConnectionStrip ? (
        <div className="terminal-standalone-connection-strip">
          <span className="terminal-panel-bar-status">{terminalStatusText}</span>
          {standaloneMetaText ? <span>{standaloneMetaText}</span> : null}
          {isJumpServer ? <span>堡垒机</span> : null}
        </div>
      ) : null}
      <div ref={bodySlotRef} className="terminal-body-slot" style={{ position: "relative", display: showDetachedPlaceholder ? "none" : undefined }}>
        {showShortcuts && props.serverId && (
          <TerminalShortcuts
            serverId={props.serverId}
            serverLabel={props.server?.name || props.server?.host || props.serverId}
            onExecute={(command) => {
              props.pasteToTerminal(command + "\n");
              props.onFocus();
            }}
            onClose={props.onCloseTerminalOverlay}
          />
        )}
        {showAI && props.serverId && (
          <TerminalAI
            serverId={props.serverId}
            serverLabel={props.server?.name || props.server?.host || props.serverId}
            onExecute={(command) => {
              props.pasteToTerminal(command);
              props.onFocus();
            }}
            onClose={props.onCloseTerminalOverlay}
          />
        )}
        <div ref={panelBodyRef} className="terminal-panel-body" onMouseDown={props.onFocus} onClick={props.onFocus}>
          <div ref={props.containerRef} className="xterm-container" />
        </div>
        {props.selMenu && (
          <div className="terminal-sel-menu" style={{ left: props.selMenu.x, top: props.selMenu.y }}>
            <button type="button" title="复制" onMouseDown={(e) => e.stopPropagation()} onClick={() => void handleCopy()}>
              <Clipboard size={14} />
            </button>
            <button type="button" title="复制并粘贴" onMouseDown={(e) => e.stopPropagation()} onClick={() => void handleCopyAndPaste()}>
              <ClipboardPaste size={14} />
            </button>
          </div>
        )}
      </div>
      {showDetachedPlaceholder ? (
        <div className="viewer-pip-placeholder" style={{ padding: "20px", minHeight: "80px" }}>
          <PictureInPicture2 size={20} strokeWidth={1.5} />
          <strong>终端已弹出到独立小窗</strong>
          <button className="ghost-button" type="button" onClick={() => {
            if (isElectronRuntime) {
              props.onAttach();
            } else {
              pipWindow?.close();
            }
          }}>收回</button>
        </div>
      ) : null}
    </section>
  );
}
