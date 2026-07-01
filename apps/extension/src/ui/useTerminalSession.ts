import { useEffect, useRef, useState, useCallback } from "react";
import type { ServerSummary } from "@server-log-console/shared";
import { looksLikeJumpServer } from "./terminal-utils.js";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import "@xterm/xterm/css/xterm.css";

const MIN_TERMINAL_FIT_WIDTH = 180;
const MIN_TERMINAL_FIT_HEIGHT = 72;
const MIN_TERMINAL_COLS = 24;
const MIN_TERMINAL_ROWS = 6;
const TERMINAL_INPUT_CHUNK_SIZE = 4096;
const TERMINAL_INPUT_CHUNK_DELAY_MS = 8;

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

function rebuildSelectionFromBuffer(terminal: Terminal): string {
  const selection = terminal.getSelectionPosition();
  if (!selection) {
    return "";
  }

  const buffer = terminal.buffer.active;
  const startY = Math.max(0, Math.min(selection.start.y, selection.end.y) - 1);
  const endY = Math.min(buffer.length - 1, Math.max(selection.start.y, selection.end.y) - 1);
  if (endY < startY) {
    return "";
  }

  const isForward =
    selection.start.y < selection.end.y ||
    (selection.start.y === selection.end.y && selection.start.x <= selection.end.x);
  const rawStart = isForward ? selection.start : selection.end;
  const rawEnd = isForward ? selection.end : selection.start;
  const startX = Math.max(0, rawStart.x - 1);
  const endX = Math.max(0, rawEnd.x - 1);
  const selectedLines: string[] = [];

  for (let row = startY; row <= endY; row += 1) {
    const line = buffer.getLine(row);
    if (!line) {
      continue;
    }
    const from = row === startY ? startX : 0;
    const to = row === endY ? Math.min(endX, line.length) : line.length;
    selectedLines.push(line.translateToString(false, from, to));
  }

  return selectedLines
    .map((line, index) => {
      const absoluteRow = startY + index;
      const bufferLine = buffer.getLine(absoluteRow);
      return bufferLine?.isWrapped && index > 0 ? line : line.replace(/\s+$/u, "");
    })
    .reduce((text, line, index) => {
      if (index === 0) {
        return line;
      }
      const absoluteRow = startY + index;
      const bufferLine = buffer.getLine(absoluteRow);
      return bufferLine?.isWrapped ? text + line : `${text}\n${line}`;
    }, "");
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
  const outputSettleTimerRef = useRef<number | null>(null);
  const retryCountRef = useRef(0);
  const reconnectDesiredRef = useRef(false);
  const followOutputRef = useRef(true);
  const activeSessionIdRef = useRef("");
  const terminalReadyRef = useRef(false);
  const pendingInputTimerRef = useRef<number | null>(null);
  const pendingInputChunksRef = useRef<string[]>([]);

  const clampSelectionMenuPosition = useCallback((x: number, y: number) => {
    const container = containerRef.current;
    if (!container) {
      return { x, y };
    }
    const rect = container.getBoundingClientRect();
    const horizontalPadding = 8;
    const verticalPadding = 8;
    const estimatedMenuWidth = 68;
    const estimatedMenuHeight = 40;
    return {
      x: Math.max(horizontalPadding, Math.min(x, rect.width - estimatedMenuWidth - horizontalPadding)),
      y: Math.max(estimatedMenuHeight + verticalPadding, Math.min(y, rect.height - verticalPadding)),
    };
  }, []);

  const canApplyTerminalFit = useCallback(() => {
    const container = containerRef.current;
    if (!container) {
      return false;
    }
    const rect = container.getBoundingClientRect();
    return rect.width >= MIN_TERMINAL_FIT_WIDTH && rect.height >= MIN_TERMINAL_FIT_HEIGHT;
  }, []);

  const syncResizeToSocket = useCallback(() => {
    const terminal = terminalRef.current;
    const socket = socketRef.current;
    if (!terminal || socket?.readyState !== WebSocket.OPEN || !terminalReadyRef.current) {
      return false;
    }
    if (terminal.cols < MIN_TERMINAL_COLS || terminal.rows < MIN_TERMINAL_ROWS) {
      return false;
    }
    socket.send(JSON.stringify({ action: "resize", sessionId: activeSessionIdRef.current || undefined, cols: terminal.cols, rows: terminal.rows }));
    return true;
  }, []);

  const clearFitTimers = useCallback(() => {
    for (const timer of fitTimersRef.current) {
      window.clearTimeout(timer);
    }
    fitTimersRef.current = [];
  }, []);

  const clearOutputSettleTimer = useCallback(() => {
    if (outputSettleTimerRef.current !== null) {
      window.clearTimeout(outputSettleTimerRef.current);
      outputSettleTimerRef.current = null;
    }
  }, []);

  const clearPendingInput = useCallback(() => {
    if (pendingInputTimerRef.current !== null) {
      window.clearTimeout(pendingInputTimerRef.current);
      pendingInputTimerRef.current = null;
    }
    pendingInputChunksRef.current = [];
  }, []);

  const updateFollowOutputState = useCallback(() => {
    const viewport = containerRef.current?.querySelector(".xterm-viewport") as HTMLDivElement | null;
    if (!viewport) {
      followOutputRef.current = true;
      return;
    }
    const remaining = viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop;
    followOutputRef.current = remaining <= 6;
  }, []);

  const runFit = useCallback(() => {
    const terminal = terminalRef.current;
    const container = containerRef.current;
    if (terminal?.element && container && !container.contains(terminal.element)) {
      container.appendChild(terminal.element);
    }
    if (!terminal || !canApplyTerminalFit()) {
      return false;
    }
    fitAddonRef.current?.fit();
    syncResizeToSocket();
    return true;
  }, [canApplyTerminalFit, syncResizeToSocket]);

  const settleTerminalViewport = useCallback(() => {
    clearOutputSettleTimer();
    outputSettleTimerRef.current = window.setTimeout(() => {
      outputSettleTimerRef.current = null;
      runFit();
      if (followOutputRef.current) {
        terminalRef.current?.scrollToBottom();
      }
    }, 32);
  }, [clearOutputSettleTimer, runFit]);

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
      scrollback: 20000,
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
          const relativeX = e.clientX - rect.left;
          const relativeY = e.clientY - rect.top;
          const nextPosition = clampSelectionMenuPosition(relativeX, relativeY);
          options.onSelectionMenu({ x: nextPosition.x, y: nextPosition.y, text });
        } else if (!text && options.onSelectionMenu) {
          options.onSelectionMenu(null);
        }
      }, 10);
    };

    const onMouseDown = () => {
      options.onSelectionMenu?.(null);
    };

    const onViewportScroll = () => {
      updateFollowOutputState();
    };

    container.addEventListener("mouseup", onMouseUp);
    container.addEventListener("mousedown", onMouseDown);
    container.addEventListener("scroll", onViewportScroll, true);
    updateFollowOutputState();

    return () => {
      container.removeEventListener("mouseup", onMouseUp);
      container.removeEventListener("mousedown", onMouseDown);
      container.removeEventListener("scroll", onViewportScroll, true);
    };
  }, [clampSelectionMenuPosition, options.active, ensureTerminal, options.onSelectionMenu, scheduleFit, updateFollowOutputState]);

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
      clearOutputSettleTimer();
      clearPendingInput();
    };
  }, [options.active, clearFitTimers, clearOutputSettleTimer, clearPendingInput, scheduleFit]);

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
    clearOutputSettleTimer();
    clearPendingInput();
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
  }, [clearFitTimers, clearOutputSettleTimer, clearPendingInput, options.preserveSessionOnDispose]);

  function clearReconnectTimer() {
    if (reconnectTimerRef.current !== null) {
      window.clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  }

  function scheduleReconnect() {
    if (!reconnectDesiredRef.current) return;
    clearReconnectTimer();
    clearPendingInput();
    const next = retryCountRef.current + 1;
    retryCountRef.current = next;
    setRetryCount(next);
    const delay = Math.min(10000, 1500 * next);
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
    terminalReadyRef.current = false;
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
      followOutputRef.current = true;
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
      activeSessionIdRef.current = activeSessionId;
      options.onSessionIdChange?.(activeSessionId);
    }
    const sessionKey = [options.serverId, bastionId || "", activeSessionId].join("|");
    const currentSocket = socketRef.current;
    if (
      sessionKeyRef.current === sessionKey
      && (connected || currentSocket?.readyState === WebSocket.OPEN || currentSocket?.readyState === WebSocket.CONNECTING)
    ) {
      return;
    }

    stopTerminal({ keepContent: startOptions?.isReconnect, preserveSessionKey: true, preserveRetryCount: startOptions?.isReconnect });
    reconnectDesiredRef.current = true;
    terminalReadyRef.current = false;
    sessionKeyRef.current = sessionKey;
    setConnected(false);

    const terminal = ensureTerminal();
    if (!startOptions?.isReconnect) {
      terminal.clear();
    }

    onDataDisposableRef.current?.dispose();
    onDataDisposableRef.current = terminal.onData((data: string) => {
      const socket = socketRef.current;
      if (socket?.readyState === WebSocket.OPEN && terminalReadyRef.current) {
        socket.send(JSON.stringify({ action: "input", sessionId: activeSessionIdRef.current || undefined, data }));
      }
    });

    onResizeDisposableRef.current?.dispose();
    onResizeDisposableRef.current = terminal.onResize(({ cols, rows }) => {
      const socket = socketRef.current;
      if (
        socket?.readyState === WebSocket.OPEN
        && terminalReadyRef.current
        && cols >= MIN_TERMINAL_COLS
        && rows >= MIN_TERMINAL_ROWS
      ) {
        socket.send(JSON.stringify({ action: "resize", sessionId: activeSessionIdRef.current || undefined, cols, rows }));
      }
	    });

    const wsUrl = options.localServiceBase.replace(/^http/, "ws") + "/ws/terminal";
    const socket = new WebSocket(wsUrl);
    socketRef.current = socket;
    expectedCloseRef.current = false;

    socket.addEventListener("open", () => {
      if (socketRef.current !== socket) {
        return;
      }
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
      if (socketRef.current !== socket) {
        return;
      }

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
          if (payload.message === "终端尚未连接。") {
            options.onStatus("正在连接终端...");
            return;
          }
          options.onStatus(`终端失败：${payload.message || "未知错误"}`);
          options.onActivity(`终端失败：${payload.message || "未知错误"}`);
          return;
        }

        if (payload.type === "closed") {
          setConnected(false);
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
	            activeSessionIdRef.current = payload.sessionId;
	            options.onSessionIdChange?.(payload.sessionId);
	          }
	          terminalReadyRef.current = true;
          setConnected(true);
          retryCountRef.current = 0;
          setRetryCount(0);
          if (payload.resumed) {
            terminal.clear();
          }
          if (payload.chunk) {
            terminalReadyRef.current = true;
            terminal.write(payload.chunk);
            settleTerminalViewport();
          }
          options.onStatus(
            looksLikeJumpServer(options.selectedServer)
              ? "终端已连接，可直接输入 /关键字 或资产编号。"
              : "终端已连接，支持 Tab 补全、方向键历史。"
          );
          options.onActivity(`终端已连接：${options.selectedServer?.name || options.serverId}`);
          terminal.focus();
          scheduleFit([0, 16, 80, 180, 320]);
          syncResizeToSocket();
          terminal.scrollToBottom();
          return;
        }

        if (payload.chunk) {
          terminal.write(payload.chunk);
          settleTerminalViewport();
          if (!connected) {
            setConnected(true);
          }
        }
      } catch (error) {
        options.onStatus(`终端解析失败：${error instanceof Error ? error.message : "未知错误"}`);
      }
    });

    socket.addEventListener("close", () => {
      if (socketRef.current !== socket) {
        return;
      }

      if (socketRef.current === socket) {
        socketRef.current = null;
      }

      if (expectedCloseRef.current) {
        expectedCloseRef.current = false;
        return;
      }

	      setConnected(false);
	      terminalReadyRef.current = false;
	      scheduleReconnect();
    });
  }

  function focusTerminal() {
    terminalRef.current?.focus();
  }

  function focusTerminalSoon() {
    window.requestAnimationFrame(() => {
      terminalRef.current?.focus();
    });
  }

  function fitTerminal() {
    scheduleFit([0, 16, 64, 140, 260]);
    if (followOutputRef.current) {
      terminalRef.current?.scrollToBottom();
    }
  }

  function getSelection(): string {
    const terminal = terminalRef.current;
    if (!terminal) {
      return "";
    }
    const selectedText = terminal.getSelection();
    const rebuiltText = rebuildSelectionFromBuffer(terminal);
    return rebuiltText.length > selectedText.length ? rebuiltText : selectedText;
  }

  function clearSelection() {
    terminalRef.current?.clearSelection();
  }

  function pasteToTerminal(text: string) {
    clearPendingInput();
    const socket = socketRef.current;
    if (socket?.readyState !== WebSocket.OPEN || !text) {
      focusTerminalSoon();
      return;
    }

    const chunks: string[] = [];
    for (let index = 0; index < text.length; index += TERMINAL_INPUT_CHUNK_SIZE) {
      chunks.push(text.slice(index, index + TERMINAL_INPUT_CHUNK_SIZE));
    }
    pendingInputChunksRef.current = chunks;

    const sendNextChunk = () => {
      const activeSocket = socketRef.current;
      if (activeSocket?.readyState !== WebSocket.OPEN) {
        clearPendingInput();
        return;
      }
      const next = pendingInputChunksRef.current.shift();
      if (!next) {
        pendingInputTimerRef.current = null;
        return;
      }
      activeSocket.send(JSON.stringify({ action: "input", sessionId: activeSessionIdRef.current || undefined, data: next }));
      if (pendingInputChunksRef.current.length > 0) {
        pendingInputTimerRef.current = window.setTimeout(sendNextChunk, TERMINAL_INPUT_CHUNK_DELAY_MS);
      } else {
        pendingInputTimerRef.current = null;
      }
    };

    sendNextChunk();
    focusTerminalSoon();
  }

  return {
    connected,
    retryCount,
    containerRef,
    startTerminal,
    stopTerminal,
    focusTerminal,
    focusTerminalSoon,
    fitTerminal,
    getSelection,
    clearSelection,
    pasteToTerminal,
  };
}
