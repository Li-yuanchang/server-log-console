import { useEffect, useRef, useState, useCallback } from "react";
import type { ServerSummary } from "@server-log-console/shared";
import { looksLikeJumpServer } from "./terminal-utils.js";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import "@xterm/xterm/css/xterm.css";

interface UseTerminalSessionOptions {
  active: boolean;
  localServiceBase: string;
  serverId: string;
  preferredBastionId: string;
  sessionId: string;
  selectedServer: ServerSummary | null;
  isBusy: boolean;
  cwd?: string;
  onStatus: (message: string) => void;
  onActivity: (message: string) => void;
  onSessionIdChange?: (sessionId: string) => void;
  preserveSessionOnInactive?: boolean;
  preserveSessionOnDispose?: boolean;
  onSelectionMenu?: (menu: { x: number; y: number; text: string } | null) => void;
}

export function useTerminalSession(options: UseTerminalSessionOptions) {
  const [connected, setConnected] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const expectedCloseRef = useRef(false);
  const sessionKeyRef = useRef("");
  const onDataDisposableRef = useRef<{ dispose: () => void } | null>(null);
  const onResizeDisposableRef = useRef<{ dispose: () => void } | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const fitTimersRef = useRef<number[]>([]);
  const retryCountRef = useRef(0);
  const reconnectDesiredRef = useRef(false);

  const clearFitTimers = useCallback(() => {
    for (const timer of fitTimersRef.current) {
      window.clearTimeout(timer);
    }
    fitTimersRef.current = [];
  }, []);

  const runFit = useCallback(() => {
    const terminal = terminalRef.current;
    const container = containerRef.current;
    if (terminal?.element && container && !container.contains(terminal.element)) {
      container.appendChild(terminal.element);
    }
    fitAddonRef.current?.fit();
  }, []);

  const scheduleFit = useCallback((delays: number[] = [0, 16, 80, 180, 320]) => {
    clearFitTimers();
    for (const delay of delays) {
      const timer = window.setTimeout(() => {
        runFit();
      }, delay);
      fitTimersRef.current.push(timer);
    }
  }, [clearFitTimers, runFit]);

  const ensureTerminal = useCallback(() => {
    if (terminalRef.current) {
      return terminalRef.current;
    }

    const cs = getComputedStyle(document.documentElement);
    const shellBg = cs.getPropertyValue("--shell").trim() || "#0a0a0a";
    const shellInk = cs.getPropertyValue("--shell-ink").trim() || "#e8e8e8";

    const terminal = new Terminal({
      cursorBlink: true,
      fontSize: 12,
      fontFamily: "'SFMono-Regular', 'Consolas', monospace",
      theme: {
        background: shellBg,
        foreground: shellInk,
        cursor: "#7ec8e3",
        selectionBackground: "#2a4a6a",
        black: shellBg,
        red: "#e06c75",
        green: "#98c379",
        yellow: "#e5c07b",
        blue: "#61afef",
        magenta: "#c678dd",
        cyan: "#56b6c2",
        white: shellInk,
        brightBlack: "#5c6370",
        brightRed: "#e06c75",
        brightGreen: "#98c379",
        brightYellow: "#e5c07b",
        brightBlue: "#61afef",
        brightMagenta: "#c678dd",
        brightCyan: "#56b6c2",
        brightWhite: "#ffffff",
      },
      scrollback: 3000,
      convertEol: true,
    });

    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.loadAddon(new WebLinksAddon());

    fitAddonRef.current = fitAddon;
    terminalRef.current = terminal;
    return terminal;
  }, []);

  useEffect(() => {
    if (!options.active || !containerRef.current) {
      return;
    }

    const terminal = ensureTerminal();
    const container = containerRef.current;

    if (!terminal.element) {
      terminal.open(container);
      scheduleFit();
    } else if (!container.contains(terminal.element)) {
      container.appendChild(terminal.element);
      scheduleFit();
    }

    const onMouseUp = (e: MouseEvent) => {
      setTimeout(() => {
        const text = terminal.getSelection();
        if (text && options.onSelectionMenu) {
          const rect = container.getBoundingClientRect();
          options.onSelectionMenu({ x: e.clientX - rect.left, y: e.clientY - rect.top, text });
        } else if (!text && options.onSelectionMenu) {
          options.onSelectionMenu(null);
        }
      }, 10);
    };

    const onMouseDown = () => {
      options.onSelectionMenu?.(null);
    };

    container.addEventListener("mouseup", onMouseUp);
    container.addEventListener("mousedown", onMouseDown);

    return () => {
      container.removeEventListener("mouseup", onMouseUp);
      container.removeEventListener("mousedown", onMouseDown);
    };
  }, [options.active, ensureTerminal, options.onSelectionMenu, scheduleFit]);

  useEffect(() => {
    if (!options.active) {
      return;
    }

    const handleResize = () => {
      scheduleFit([0, 24, 96, 220]);
    };

    window.addEventListener("resize", handleResize);
    const timer = window.setTimeout(handleResize, 100);

    let resizeObserver: ResizeObserver | null = null;
    if (containerRef.current && typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver(() => {
        scheduleFit([0, 16, 72, 180]);
      });
      resizeObserver.observe(containerRef.current);
    }

    return () => {
      window.removeEventListener("resize", handleResize);
      resizeObserver?.disconnect();
      window.clearTimeout(timer);
      clearFitTimers();
    };
  }, [options.active, clearFitTimers, scheduleFit]);

  useEffect(() => {
    if (!options.active || !options.serverId) {
      return;
    }

    const socket = socketRef.current;
    if (connected || socket?.readyState === WebSocket.OPEN || socket?.readyState === WebSocket.CONNECTING) {
      return;
    }

    startTerminal({ auto: true });
  }, [connected, options.active, options.serverId]);

  useEffect(() => () => {
    clearFitTimers();
    stopTerminal({
      preserveSession: options.preserveSessionOnDispose,
      preserveSessionKey: options.preserveSessionOnDispose,
      preserveRetryCount: options.preserveSessionOnDispose,
      keepContent: options.preserveSessionOnDispose,
    });
    onDataDisposableRef.current?.dispose();
    onDataDisposableRef.current = null;
    onResizeDisposableRef.current?.dispose();
    onResizeDisposableRef.current = null;
    terminalRef.current?.dispose();
    terminalRef.current = null;
    fitAddonRef.current = null;
  }, [clearFitTimers, options.preserveSessionOnDispose]);

  function clearReconnectTimer() {
    if (reconnectTimerRef.current !== null) {
      window.clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  }

  function scheduleReconnect() {
    if (!reconnectDesiredRef.current) return;
    clearReconnectTimer();
    const next = retryCountRef.current + 1;
    retryCountRef.current = next;
    setRetryCount(next);
    const delay = Math.min(10000, 1500 * next);
    const terminal = terminalRef.current;
    terminal?.writeln(`\r\n\x1b[33m${Math.round(delay / 1000)} 秒后自动重连（第 ${next} 次）...\x1b[0m`);
    options.onStatus(`终端已断开，${Math.round(delay / 1000)} 秒后重连...`);
    options.onActivity(`终端已断开，准备第 ${next} 次重连。`);
    reconnectTimerRef.current = window.setTimeout(() => {
      if (!reconnectDesiredRef.current) return;
      startTerminal({ auto: true, isReconnect: true });
    }, delay);
  }

  function stopTerminal(optionsArg?: { keepContent?: boolean; preserveSessionKey?: boolean; preserveRetryCount?: boolean; preserveSession?: boolean }) {
    expectedCloseRef.current = true;
    clearReconnectTimer();
    reconnectDesiredRef.current = false;
    if (!optionsArg?.preserveRetryCount) {
      retryCountRef.current = 0;
      setRetryCount(0);
    }
    onDataDisposableRef.current?.dispose();
    onDataDisposableRef.current = null;
    onResizeDisposableRef.current?.dispose();
    onResizeDisposableRef.current = null;
    const socket = socketRef.current;
    const activeSessionId = options.sessionId.trim();
    if (socket?.readyState === WebSocket.OPEN && activeSessionId) {
      socket.send(JSON.stringify({ action: optionsArg?.preserveSession ? "detach" : "close", sessionId: activeSessionId }));
    }
    socket?.close();
    socketRef.current = null;
    setConnected(false);
    if (!optionsArg?.keepContent) {
      terminalRef.current?.clear();
    }
    if (!optionsArg?.preserveSessionKey) {
      sessionKeyRef.current = "";
    }
  }

  useEffect(() => {
    if (options.active) {
      return;
    }

    clearFitTimers();
    stopTerminal({
      preserveSession: options.preserveSessionOnInactive,
      preserveSessionKey: options.preserveSessionOnInactive,
      preserveRetryCount: options.preserveSessionOnInactive,
      keepContent: options.preserveSessionOnInactive,
    });
  }, [options.active, clearFitTimers, options.preserveSessionOnInactive]);

  function startTerminal(startOptions?: { auto?: boolean; isReconnect?: boolean; sessionId?: string }) {
    if (!options.serverId) {
      return;
    }

    const connectionKind = options.selectedServer?.connectionKind;
    const bastionId =
      connectionKind === "bastion"
        ? options.selectedServer!.id
        : connectionKind === "bastion-target"
          ? (options.preferredBastionId || undefined)
          : !connectionKind
            ? (options.preferredBastionId || undefined)
            : undefined;
    const activeSessionId = (startOptions?.sessionId || options.sessionId || "").trim();
    if (activeSessionId) {
      options.onSessionIdChange?.(activeSessionId);
    }
    const sessionKey = [options.serverId, bastionId || "", activeSessionId].join("|");
    if (connected && sessionKeyRef.current === sessionKey) {
      return;
    }

    stopTerminal({ keepContent: startOptions?.isReconnect, preserveSessionKey: true, preserveRetryCount: startOptions?.isReconnect });
    reconnectDesiredRef.current = true;
    sessionKeyRef.current = sessionKey;
    setConnected(false);

    const terminal = ensureTerminal();
    if (!startOptions?.isReconnect) {
      terminal.clear();
    }

    onDataDisposableRef.current?.dispose();
    onDataDisposableRef.current = terminal.onData((data: string) => {
      const socket = socketRef.current;
      if (socket?.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ action: "input", data }));
      }
    });

    onResizeDisposableRef.current?.dispose();
    onResizeDisposableRef.current = terminal.onResize(({ cols, rows }) => {
      const socket = socketRef.current;
      if (socket?.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ action: "resize", cols, rows }));
      }
    });

    const wsUrl = options.localServiceBase.replace(/^http/, "ws") + "/ws/terminal";
    const socket = new WebSocket(wsUrl);
    socketRef.current = socket;

    socket.addEventListener("open", () => {
      expectedCloseRef.current = false;
      socket.send(
        JSON.stringify({
          action: "start",
          serverId: options.serverId,
          bastionId,
          sessionId: activeSessionId || undefined,
          cwd: options.cwd || undefined
        })
      );
      options.onStatus(startOptions?.isReconnect ? "正在重连终端..." : (startOptions?.auto ? "正在打开终端..." : "正在连接终端..."));
      options.onActivity(startOptions?.isReconnect ? `正在重连终端：${options.selectedServer?.name || options.serverId}` : `正在打开终端：${options.selectedServer?.name || options.serverId}`);
    });

    socket.addEventListener("message", (event) => {
      try {
        const payload = JSON.parse(String(event.data)) as {
          type?: "ready" | "output" | "stderr" | "closed" | "error" | "detached";
          chunk?: string;
          message?: string;
          sessionId?: string;
          resumed?: boolean;
        };

        if (payload.type === "error") {
          setConnected(false);
          terminal.writeln(`\r\n\x1b[31m错误：${payload.message || "未知错误"}\x1b[0m`);
          options.onStatus(`终端失败：${payload.message || "未知错误"}`);
          options.onActivity(`终端失败：${payload.message || "未知错误"}`);
          return;
        }

        if (payload.type === "closed") {
          setConnected(false);
          terminal.writeln("\r\n\x1b[33m终端已关闭。\x1b[0m");
          options.onStatus("终端已关闭。");
          options.onActivity("终端已关闭。");
          return;
        }

        if (payload.type === "detached") {
          setConnected(false);
          return;
        }

        if (payload.type === "ready") {
          if (payload.sessionId) {
            options.onSessionIdChange?.(payload.sessionId);
          }
          setConnected(true);
          retryCountRef.current = 0;
          setRetryCount(0);
          if (payload.resumed) {
            terminal.clear();
          }
          if (payload.chunk) {
            terminal.write(payload.chunk);
          }
          options.onStatus(
            looksLikeJumpServer(options.selectedServer)
              ? "终端已连接，可直接输入 /关键字 或资产编号。"
              : "终端已连接，支持 Tab 补全、方向键历史。"
          );
          options.onActivity(`终端已连接：${options.selectedServer?.name || options.serverId}`);
          terminal.focus();
          scheduleFit([0, 16, 80, 180, 320]);
          const sock = socketRef.current;
          if (sock?.readyState === WebSocket.OPEN) {
            sock.send(JSON.stringify({ action: "resize", cols: terminal.cols, rows: terminal.rows }));
          }
          return;
        }

        if (payload.chunk) {
          terminal.write(payload.chunk);
          if (!connected) {
            setConnected(true);
          }
        }
      } catch (error) {
        options.onStatus(`终端解析失败：${error instanceof Error ? error.message : "未知错误"}`);
      }
    });

    socket.addEventListener("close", () => {
      if (socketRef.current === socket) {
        socketRef.current = null;
      }

      if (expectedCloseRef.current) {
        expectedCloseRef.current = false;
        return;
      }

      setConnected(false);
      scheduleReconnect();
    });
  }

  function focusTerminal() {
    terminalRef.current?.focus();
  }

  function fitTerminal() {
    scheduleFit([0, 16, 64, 140, 260]);
  }

  function getSelection(): string {
    return terminalRef.current?.getSelection() || "";
  }

  function clearSelection() {
    terminalRef.current?.clearSelection();
  }

  function pasteToTerminal(text: string) {
    const socket = socketRef.current;
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ action: "input", data: text }));
    }
  }

  return {
    connected,
    retryCount,
    containerRef,
    startTerminal,
    stopTerminal,
    focusTerminal,
    fitTerminal,
    getSelection,
    clearSelection,
    pasteToTerminal,
  };
}
