import { useEffect, useRef, useState, useCallback } from "react";
import { TERMINAL_SCHEMES, type TerminalColorSchemeId } from "./useUiTheme.js";
import type { ServerSummary } from "@server-log-console/shared";
import { looksLikeJumpServer } from "./terminal-utils.js";
import { createTerminalColorizer, type TerminalColorizer } from "./terminal-decorations.js";
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
  /** props 缺口（终端工作台重设计）：xterm 实例创建/销毁时上报，供容器把激活终端交给 useTerminalSearch 附着。
      只做实例上报，不触及 WS 协议逻辑。 */
  onTerminalInstanceChange?: (terminal: Terminal | null) => void;
  terminalFontSize?: number;
  /** S14：终端字体族（CSS 字体栈字符串）。变更后 xterm 需重排以免列宽错位。 */
  terminalFontFamily?: string;
  terminalBackgroundColor?: string;
  /** 终端配色（独立槽位）：映射 xterm ITheme（背景/前景/光标/选区 + ANSI 16 色） */
  terminalScheme?: TerminalColorSchemeId;
  /** 终端客户端着色开关（默认 true）：纯客户端读 buffer + xterm registerDecoration 上色，
      绝不向 PTY 写入任何字节（JumpServer 红线：不能发不可见字符），跳板机会话同样安全。 */
  enableClientColoring?: boolean;
}

function readTerminalTheme(container: HTMLElement | null, overrideBackground?: string) {
  const cs = getComputedStyle(container ?? document.documentElement);
  const shellBg = overrideBackground?.trim()
    || cs.getPropertyValue("--terminal-background").trim()
    || cs.getPropertyValue("--shell").trim()
    || "#0a0a0a";
  const shellInk = cs.getPropertyValue("--shell-ink").trim() || "#d7dde5";
  return { shellBg, shellInk };
}

/** 终端配色 → xterm ITheme。背景仍可被 terminalBackgroundColor 覆盖（WinPiP 等）。 */
function buildTerminalTheme(schemeId: TerminalColorSchemeId | undefined, shellBg: string, shellInk: string) {
  const scheme = TERMINAL_SCHEMES.find((s) => s.id === schemeId) ?? TERMINAL_SCHEMES[0];
  const t = scheme.theme;
  return {
    background: shellBg || t.background,
    foreground: t.foreground === "#d7dde5" ? shellInk : t.foreground,
    cursor: t.cursor,
    cursorAccent: shellBg || t.background,
    selectionBackground: t.selectionBackground,
    black: t.black, red: t.red, green: t.green, yellow: t.yellow,
    blue: t.blue, magenta: t.magenta, cyan: t.cyan, white: t.white,
    brightBlack: t.brightBlack, brightRed: t.brightRed, brightGreen: t.brightGreen,
    brightYellow: t.brightYellow, brightBlue: t.brightBlue, brightMagenta: t.brightMagenta,
    brightCyan: t.brightCyan, brightWhite: t.brightWhite,
  };
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
  const colorizerRef = useRef<TerminalColorizer | null>(null);
  const decorationScanTimerRef = useRef<number | null>(null);
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

  const clearDecorationScanTimer = useCallback(() => {
    if (decorationScanTimerRef.current !== null) {
      window.clearTimeout(decorationScanTimerRef.current);
      decorationScanTimerRef.current = null;
    }
  }, []);

  /* 客户端着色扫描（80ms 合并防抖）；resize 后的重扫也复用该定时器。
     纯读 buffer + 装饰渲染，不向 PTY 写入任何字节。 */
  const scheduleDecorationScan = useCallback((delay = 80) => {
    if (!options.enableClientColoring || !colorizerRef.current) {
      return;
    }
    clearDecorationScanTimer();
    decorationScanTimerRef.current = window.setTimeout(() => {
      decorationScanTimerRef.current = null;
      try {
        colorizerRef.current?.scan();
      } catch {
        /* 着色异常绝不影响终端数据流 */
      }
    }, delay);
  }, [clearDecorationScanTimer, options.enableClientColoring]);

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
      /* 输出落定 → 扫描最近行上色（内部再 80ms 合并） */
      scheduleDecorationScan();
    }, 32);
  }, [clearOutputSettleTimer, runFit, scheduleDecorationScan]);

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

    const { shellBg } = readTerminalTheme(containerRef.current, options.terminalBackgroundColor);

    const terminal = new Terminal({
      cursorBlink: true,
      /* 用户反馈：默认块状光标太粗 → 竖线光标（2px，闪烁保留） */
      cursorStyle: "bar",
      cursorWidth: 2,
      /* 搜索高亮（addon-search decorations）与客户端着色（registerDecoration）依赖提案 API，
         未开启时 findNext 在高亮环节抛错（被 safeSearchCall 吞掉 → 恒 0/0）、着色静默失效。 */
      allowProposedApi: true,
      /* 原型 .term（prototype.html 190 行）原为 11px，用户确认过小 → 默认 14
         （= useUiTheme DEFAULT_TERMINAL_FONT_SIZE，设置中心可调）；字体兜底栈 = --mono token。 */
      fontSize: options.terminalFontSize || 14,
      lineHeight: 1.8,
      fontFamily: options.terminalFontFamily || "'Geist Mono', 'SFMono-Regular', 'Menlo', 'Consolas', monospace",
      theme: buildTerminalTheme(options.terminalScheme, shellBg, ""),
      scrollback: 20000,
      convertEol: true,
    });

    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.loadAddon(new WebLinksAddon());

    fitAddonRef.current = fitAddon;
    terminalRef.current = terminal;
    /* 终端客户端着色器（默认开启）：纯 buffer 读取 + registerDecoration 渲染层上色，
       不向 PTY 写入字节（JumpServer 安全）；API 缺失/异常时模块内部静默降级。 */
    colorizerRef.current = options.enableClientColoring !== false ? createTerminalColorizer(terminal) : null;
    options.onTerminalInstanceChange?.(terminal);
    return terminal;
    // terminalFontFamily / terminalScheme 变更需重建实例，故一并作为依赖
  }, [options.enableClientColoring, options.terminalFontSize, options.terminalFontFamily, options.terminalScheme]);

  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal) {
      return;
    }
    const { shellBg, shellInk } = readTerminalTheme(containerRef.current, options.terminalBackgroundColor);
    terminal.options.fontSize = options.terminalFontSize || 14;
    /* S14：字体族同步。改字体族会改变字符宽度，必须配合 scheduleFit 重排，
       否则 xterm 的列数/光标位置会错乱。 */
    if (options.terminalFontFamily) {
      terminal.options.fontFamily = options.terminalFontFamily;
    }
    /* 终端配色：整套 ITheme 替换（ANSI 16 色随方案切换） */
    terminal.options.theme = buildTerminalTheme(options.terminalScheme, shellBg, shellInk);
    scheduleFit([0, 24, 96]);
  }, [options.terminalBackgroundColor, options.terminalFontSize, options.terminalFontFamily, options.terminalScheme, scheduleFit]);

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
      clearDecorationScanTimer();
      clearPendingInput();
    };
  }, [options.active, clearFitTimers, clearOutputSettleTimer, clearDecorationScanTimer, clearPendingInput, scheduleFit]);

  useEffect(() => {
    if (!options.active || !options.serverId) {
      return;
    }

    const socket = socketRef.current;
    if (connected || socket?.readyState === WebSocket.OPEN || socket?.readyState === WebSocket.CONNECTING) {
      return;
    }

    startTerminal({ auto: true });
    /* isBusy 入依赖：忙碌期间启动被跳过/中断时，忙碌结束后自动补连（否则会停留在"已断开"且无重试） */
  }, [connected, options.active, options.serverId, options.isBusy]);

  useEffect(() => () => {
    clearFitTimers();
    clearOutputSettleTimer();
    clearDecorationScanTimer();
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
    colorizerRef.current?.disposeAll();
    colorizerRef.current = null;
    terminalRef.current?.dispose();
    terminalRef.current = null;
    fitAddonRef.current = null;
    options.onTerminalInstanceChange?.(null);
  }, [clearFitTimers, clearOutputSettleTimer, clearDecorationScanTimer, clearPendingInput, options.preserveSessionOnDispose]);

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
    /* 会话停止：清空客户端装饰并取消待扫描（terminal.clear 时 marker 已随 buffer 释放，
       这里同步登记表；keepContent 保留内容的场景按规格同样清空） */
    colorizerRef.current?.disposeAll();
    clearDecorationScanTimer();
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
      /* 清屏后装饰随 marker 释放，这里同步登记表（幂等） */
      colorizerRef.current?.disposeAll();
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
      /* 终端 reflow 会使装饰列错位：先清空，待布局稳定后重扫一次（复用 80ms 防抖定时器） */
      colorizerRef.current?.disposeAll();
      scheduleDecorationScan(260);
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
            colorizerRef.current?.disposeAll();
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
