import { useCallback, useEffect, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { Columns2, Command, Ellipsis, LayoutGrid, Rows2, Search, Terminal as TerminalIcon, Upload, X, Zap } from "lucide-react";
import type { Terminal } from "@xterm/xterm";
import type { ServerSummary } from "@server-log-console/shared";
import { localServiceBase } from "./api.js";
import type { TerminalColorSchemeId } from "./useUiTheme.js";
import { copyText } from "./utils.js";
import { TerminalTabStrip, type TerminalTabItem, type TerminalTabStatus } from "./TerminalTabStrip.js";
import { TerminalStatusBar } from "./TerminalStatusBar.js";
import { TerminalFindBar } from "./TerminalFindBar.js";
import { useTerminalSearch } from "./useTerminalSearch.js";
import { TerminalContextMenu, TerminalMenuShell, TerminalMoreMenu, type TerminalContextMenuActions, type TerminalMenuItem } from "./TerminalMenus.js";
import { TerminalQuickBar } from "./TerminalQuickBar.js";
import { ShortcutsManagerDialog } from "./ShortcutsManagerDialog.js";
import { useTerminalFit } from "./useTerminalFit.js";
import { useTerminalSession } from "./useTerminalSession.js";
import { useTerminalTabs, TERMINAL_QUICKBAR_OPEN_STORAGE_KEY } from "./useTerminalTabs.js";
import { TerminalSplitView, type FocusedPaneSnapshot, type PaneStateSnapshot } from "./TerminalSplitView.js";
import { useBrowserTerminalPip } from "./useBrowserTerminalPip.js";
import { TerminalAI } from "./TerminalAI.js";
import { PipExpandIcon } from "./PipExpandIcon.js";
import type { TerminalTabState } from "./types.js";

/**
 * TerminalWorkspace —— 终端工作台五段式容器（对应原型 T1/T2/T3/T8/T10）：
 * 工具行（纯动作，全图标）→ TerminalTabStrip → 终端区（panes + 悬浮 FindBar + 右键菜单 + 分屏）
 * → TerminalQuickBar（可开关）→ TerminalStatusBar。
 *
 * - 每标签一个 TerminalTabPane（内部挂 useTerminalSession）：非激活 display:none 保 live 输出；
 *   关闭终端视图/切工作区时会话 detach（网关保留 90s），重开恢复。
 * - 标签组真身在 App 的 WorkspaceSessionState（terminalTabs / activeTerminalTabId），本组件经
 *   useTerminalTabs 受控操作；旧 terminalSessionId 经 legacySessionId 迁移为单标签。
 * - 分屏 = 标签内布局（内存态）：对激活标签以 TerminalSplitView 替换单窗格，新窗格 = 新会话（现状行为）。
 */

/** 每标签会话状态（pane → 容器 → App 上报；App 侧供独立窗标题/工具栏派生） */
export interface TerminalPaneSessionState {
  connected: boolean;
  retryCount: number;
  connectedAt: number | null;
  /** 会话相位：connected=已连接 / reconnecting=断线自动重试中 / preserved=非激活保活（detach，网关留 90s）/ stopped=激活但套接字已关且无重试（等待手动或自愈重连） */
  phase: "connected" | "reconnecting" | "preserved" | "stopped";
}

type TerminalSessionApi = ReturnType<typeof useTerminalSession>;

/** 断线自动重试上限（StatusBar 显示 n/N；达到上限后的“停止重试”属批6 范围，本期仅封顶展示） */
const TERMINAL_RETRY_MAX = 5;

const isElectronRuntime = typeof window !== "undefined" && Boolean((window as any).electronAPI);

type SplitLayout = "lr" | "td" | "third";

interface TerminalPanelProps {
  server: ServerSummary | null;
  serverId: string;
  preferredBastionId: string;
  isBusy: boolean;
  /** 终端 cwd（初始/联动目录；不承诺 shell 实时 cwd） */
  cwd?: string;
  /** 标签组（受控，App 级持久化） */
  tabs: TerminalTabState[];
  activeTabId: string;
  /** 旧单会话 id：迁移来源（空数组工作区首次进入时构造单标签） */
  legacySessionId: string;
  onChangeTabs: (next: { terminalTabs: TerminalTabState[]; activeTerminalTabId: string }) => void;
  onStatus: (message: string) => void;
  onActivity: (message: string) => void;
  terminalFontSize?: number;
  terminalFontFamily?: string;
  terminalBackgroundColor?: string;
  terminalScheme?: TerminalColorSchemeId;
  terminalOverlay: "none" | "shortcuts" | "ai";
  onToggleTerminalOverlay: (overlay: "ai") => void;
  /** 弹出/收回独立小窗（App 组合 openDetachedTerminalWindow / restoreEmbeddedTerminalWindow） */
  onTogglePopup: () => void;
  detached: boolean;
  popupMode?: "embedded" | "standalone";
  onRevealInFiles?: (cwd?: string) => void;
  onOpenSettings?: () => void;
  /** 终端工具行「上传」：容器选好文件后回调（目标 = 应用层联动目录） */
  onUploadFiles?: (files: FileList) => void;
  /** pane 会话状态上报（App 级 map） */
  onSessionState?: (tabId: string, state: TerminalPaneSessionState | null) => void;
  /** 状态栏资源迷你条数据（App 轮询 system-profile） */
  resources?: { cpu: number; mem: number; disk: number; diskPath?: string } | null;
  onOpenMonitor?: () => void;
}

/* ------------------------------------------------------------------ */
/* TerminalTabPane：每标签一个窗格组件（会话 hook + 能力上报）             */
/* ------------------------------------------------------------------ */

interface TerminalTabPaneProps {
  tab: TerminalTabState;
  active: boolean;
  visible: boolean;
  serverId: string;
  selectedServer: ServerSummary | null;
  preferredBastionId: string;
  isBusy: boolean;
  cwd?: string;
  onStatus: (message: string) => void;
  onActivity: (message: string) => void;
  terminalFontSize?: number;
  terminalFontFamily?: string;
  terminalBackgroundColor?: string;
  terminalScheme?: TerminalColorSchemeId;
  onSessionIdChange: (tabId: string, sessionId: string) => void;
  onTerminalInstance: (tabId: string, terminal: Terminal | null) => void;
  onSessionApi: (tabId: string, api: TerminalSessionApi | null) => void;
  onSessionState: (tabId: string, state: TerminalPaneSessionState | null) => void;
  onSelectionMenu: (tabId: string, menu: { x: number; y: number; text: string } | null) => void;
}

function TerminalTabPane(props: TerminalTabPaneProps) {
  const { tab, active, visible } = props;
  /* 回调经 ref 上报：无依赖数组 effect 每次渲染同步（廉价），避免闭包过期 */
  const callbacksRef = useRef(props);
  callbacksRef.current = props;

  const [terminalInstance, setTerminalInstance] = useState<Terminal | null>(null);
  const [connectedAt, setConnectedAt] = useState<number | null>(null);

  const handleSessionIdChange = useCallback((sessionId: string) => {
    callbacksRef.current.onSessionIdChange(tab.tabId, sessionId);
  }, [tab.tabId]);
  const handleSelectionMenu = useCallback((menu: { x: number; y: number; text: string } | null) => {
    callbacksRef.current.onSelectionMenu(tab.tabId, menu);
  }, [tab.tabId]);

  const session = useTerminalSession({
    active: active && visible,
    localServiceBase,
    serverId: props.serverId,
    preferredBastionId: props.preferredBastionId,
    sessionId: tab.sessionId,
    selectedServer: props.selectedServer,
    isBusy: props.isBusy,
    cwd: props.cwd,
    onStatus: props.onStatus,
    onActivity: props.onActivity,
    onSessionIdChange: handleSessionIdChange,
    preserveSessionOnInactive: true,
    preserveSessionOnDispose: true,
    onSelectionMenu: handleSelectionMenu,
    onTerminalInstanceChange: setTerminalInstance,
    terminalFontSize: props.terminalFontSize,
    terminalFontFamily: props.terminalFontFamily,
    terminalBackgroundColor: props.terminalBackgroundColor,
    terminalScheme: props.terminalScheme,
  });

  useTerminalFit(session.containerRef, session.fitTerminal);

  /* 连接成功时间戳（状态栏「已连接 42 分钟」），断开清零 */
  useEffect(() => {
    if (session.connected) {
      setConnectedAt((prev) => (prev == null ? Date.now() : prev));
    } else {
      setConnectedAt(null);
    }
  }, [session.connected]);

  /* 会话状态上报：仅在值变化时回调（避免父级 setState 死循环）。
     phase 区分「真断开（红，重试中）」与「保活/待自愈（灰）」——用户反馈：切视图回来被误标为已断开。 */
  const lastStateKeyRef = useRef("");
  useEffect(() => {
    const phase = session.connected
      ? "connected"
      : session.retryCount > 0
        ? "reconnecting"
        : !(active && visible)
          ? "preserved"
          : "stopped";
    const key = `${session.connected}|${session.retryCount}|${connectedAt ?? ""}|${phase}`;
    if (lastStateKeyRef.current === key) {
      return;
    }
    lastStateKeyRef.current = key;
    callbacksRef.current.onSessionState(tab.tabId, {
      connected: session.connected,
      retryCount: session.retryCount,
      connectedAt,
      phase,
    });
  });

  /* xterm 实例上报：实例身份变化才回调（容器把激活终端交给 useTerminalSearch） */
  const lastInstanceRef = useRef<Terminal | null>(null);
  useEffect(() => {
    if (lastInstanceRef.current === terminalInstance) {
      return;
    }
    lastInstanceRef.current = terminalInstance;
    callbacksRef.current.onTerminalInstance(tab.tabId, terminalInstance);
  });

  /* 会话 api 上报：每次渲染同步 ref（写入 ref 不触发渲染，廉价） */
  useEffect(() => {
    callbacksRef.current.onSessionApi(tab.tabId, session);
  });

  /* 卸载：清空容器侧注册表 */
  useEffect(() => {
    const tabId = tab.tabId;
    return () => {
      callbacksRef.current.onSessionState(tabId, null);
      callbacksRef.current.onTerminalInstance(tabId, null);
      callbacksRef.current.onSessionApi(tabId, null);
    };
  }, [tab.tabId]);

  /* 非激活标签 display:none 保持挂载（live 输出与回滚不丢） */
  return (
    <div
      className="terminal-tab-pane terminal-panel-body"
      style={{ display: active ? undefined : "none" }}
      onMouseDown={() => {
        if (active) {
          session.focusTerminal();
        }
      }}
    >
      <div ref={session.containerRef} className="xterm-container" />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* TerminalPanel：五段式容器（导出名保持 TerminalPanel，App 无需改 import） */
/* ------------------------------------------------------------------ */

export function TerminalPanel(props: TerminalPanelProps) {
  const isStandalone = props.popupMode === "standalone";
  const {
    tabs,
    activeTabId,
    activeTab,
    setActiveTab,
    newTab,
    closeTab,
    closeOthers,
    closeAll,
    canNew,
  } = useTerminalTabs({
    serverId: props.serverId,
    tabs: props.tabs,
    activeTabId: props.activeTabId,
    legacySessionId: props.legacySessionId,
    onChange: props.onChangeTabs,
    onStatus: props.onStatus,
  });
  const hasTabs = tabs.length > 0;

  /* --- pane 注册表（实例 / api）与激活终端 --- */
  const terminalInstancesRef = useRef<Record<string, Terminal | null>>({});
  const sessionApisRef = useRef<Record<string, TerminalSessionApi | null>>({});
  const activeTabIdRef = useRef(activeTabId);
  activeTabIdRef.current = activeTabId;
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;
  const propsRef = useRef(props);
  propsRef.current = props;
  const [activeTerminal, setActiveTerminal] = useState<Terminal | null>(null);
  const activeApiRef = useRef<TerminalSessionApi | null>(null);

  const handleTerminalInstance = useCallback((tabId: string, terminal: Terminal | null) => {
    terminalInstancesRef.current[tabId] = terminal;
    if (tabId === activeTabIdRef.current) {
      setActiveTerminal(terminal);
    }
  }, []);

  const handleSessionApi = useCallback((tabId: string, api: TerminalSessionApi | null) => {
    sessionApisRef.current[tabId] = api;
    if (tabId === activeTabIdRef.current) {
      activeApiRef.current = api;
    }
  }, []);

  /* 激活标签切换：同步激活终端实例与 api */
  useEffect(() => {
    setActiveTerminal(terminalInstancesRef.current[activeTabId] ?? null);
    activeApiRef.current = sessionApisRef.current[activeTabId] ?? null;
  }, [activeTabId, tabs]);

  /* pane 会话状态 map（TabStrip 状态点 / 状态栏 / AI 引用），并上报 App */
  const [paneStates, setPaneStates] = useState<Record<string, TerminalPaneSessionState>>({});
  const onSessionStatePropRef = useRef(props.onSessionState);
  onSessionStatePropRef.current = props.onSessionState;
  const handleSessionState = useCallback((tabId: string, state: TerminalPaneSessionState | null) => {
    setPaneStates((prev) => {
      if (state === null) {
        if (!(tabId in prev)) {
          return prev;
        }
        const next = { ...prev };
        delete next[tabId];
        return next;
      }
      const existing = prev[tabId];
      if (
        existing &&
        existing.connected === state.connected &&
        existing.retryCount === state.retryCount &&
        existing.connectedAt === state.connectedAt
      ) {
        return prev;
      }
      return { ...prev, [tabId]: state };
    });
    onSessionStatePropRef.current?.(tabId, state);
  }, []);

  /* 网关 ready 可能下发正式 sessionId：写回标签（重连/弹出复用同一会话） */
  const handleSessionIdChange = useCallback((tabId: string, sessionId: string) => {
    const current = tabsRef.current;
    const tab = current.find((entry) => entry.tabId === tabId);
    if (!tab || tab.sessionId === sessionId) {
      return;
    }
    propsRef.current.onChangeTabs({
      terminalTabs: current.map((entry) => (entry.tabId === tabId ? { ...entry, sessionId } : entry)),
      activeTerminalTabId: activeTabIdRef.current,
    });
  }, []);

  /* --- 分屏布局（内存态，不持久化） --- */
  const [splitLayouts, setSplitLayouts] = useState<Record<string, SplitLayout>>({});
  const activeSplitLayout = hasTabs ? splitLayouts[activeTabId] : undefined;
  const activeSplitLayoutRef = useRef(activeSplitLayout);
  activeSplitLayoutRef.current = activeSplitLayout;
  const applySplitLayout = useCallback((tabId: string, layout: SplitLayout | undefined) => {
    setSplitLayouts((prev) => {
      const next = { ...prev };
      if (layout) {
        next[tabId] = layout;
      } else {
        delete next[tabId];
      }
      return next;
    });
  }, []);

  /* 分屏焦点窗格快照（用户反馈 Bug③）：查找条与菜单动作在分屏态路由到焦点窗格。
     ref 供菜单回调即时读取，state 驱动 useTerminalSearch 附着的终端实例。 */
  const [splitFocused, setSplitFocused] = useState<FocusedPaneSnapshot | null>(null);
  const splitFocusedRef = useRef<FocusedPaneSnapshot | null>(null);
  const handleFocusedPaneChanged = useCallback((snapshot: FocusedPaneSnapshot | null) => {
    splitFocusedRef.current = snapshot;
    setSplitFocused(snapshot);
  }, []);

  /* 分屏窗格会话状态聚合（用户反馈 Bug④）：分屏激活时单屏窗格被卸载（状态上报 null），
     状态栏改用聚合值派生，避免误报「已断开」 */
  const [splitAggregateState, setSplitAggregateState] = useState<PaneStateSnapshot | null>(null);
  const handleSplitAggregateState = useCallback((state: PaneStateSnapshot | null) => {
    setSplitAggregateState(state);
  }, []);

  /* 标签关闭后清理孤立的分屏布局 */
  useEffect(() => {
    setSplitLayouts((prev) => {
      const ids = new Set(tabs.map((tab) => tab.tabId));
      const stale = Object.keys(prev).filter((tabId) => !ids.has(tabId));
      if (stale.length === 0) {
        return prev;
      }
      const next = { ...prev };
      for (const tabId of stale) {
        delete next[tabId];
      }
      return next;
    });
  }, [tabs]);

  /* --- 查找 / 菜单 / 快捷命令行 / 管理对话框 --- */
  /* 用户反馈 Bug③：分屏激活时单屏窗格被 filter 卸载（实例上报 null），查找条改挂焦点窗格的终端实例 */
  const searchTerminal = activeSplitLayout ? (splitFocused?.terminal ?? null) : activeTerminal;
  const search = useTerminalSearch(searchTerminal);
  const searchRef = useRef(search);
  searchRef.current = search;

  const shellRef = useRef<HTMLDivElement | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [moreMenu, setMoreMenu] = useState<{ x: number; y: number } | null>(null);
  const [splitMenu, setSplitMenu] = useState<{ x: number; y: number } | null>(null);
  const [selectionText, setSelectionText] = useState("");
  const [shortcutsDialogOpen, setShortcutsDialogOpen] = useState(false);

  const handleSelectionMenu = useCallback((tabId: string, menu: { x: number; y: number; text: string } | null) => {
    /* 只在选区出现时开菜单；null（终端内 mouseup 无选区 / mousedown）不用于关闭——
       右键菜单自身的 document mousedown 外点关闭已覆盖，否则 macOS 右键的 mouseup
       会在开菜单 10ms 后立刻把它关掉。 */
    if (!menu) {
      return;
    }
    setSelectionText(menu.text);
    setContextMenu({ x: menu.x, y: menu.y });
  }, []);

  /* 终端体右键：统一打开全量右键菜单（对应原型 T3/T10；用户反馈 Bug②：分屏时此前弹的是
     浏览器原生菜单——分屏窗格经 onPaneContextMenu 透传到同一 handler，preventDefault 统一拦原生菜单） */
  const handlePaneContextMenu = useCallback((event: ReactMouseEvent) => {
    const shell = shellRef.current;
    if (!shell || !hasTabs) {
      return;
    }
    event.preventDefault();
    const shellRect = shell.getBoundingClientRect();
    /* 选区按当前形态取：分屏 = 焦点窗格快照（Bug③）；单屏 = 激活终端实例 */
    const selection = activeSplitLayoutRef.current
      ? (splitFocusedRef.current?.api?.getSelection() || "")
      : (activeTerminal?.getSelection() || "");
    setSelectionText(selection);
    setContextMenu({
      x: event.clientX - shellRect.left,
      y: event.clientY - shellRect.top,
    });
  }, [activeTerminal, hasTabs]);

  /* --- 动作（全部作用于激活标签；分屏态路由到焦点窗格，用户反馈 Bug③） --- */
  /** 会话动作所需的最小能力集（单屏注册表 api 与分屏快照均满足） */
  type TerminalActionApi = Pick<
    TerminalSessionApi,
    "getSelection" | "clearSelection" | "pasteToTerminal" | "startTerminal" | "stopTerminal"
  >;

  /** 当前应接受「会话动作」的终端实例：分屏 = 焦点窗格；单屏 = 激活标签注册表 */
  const getActionTerminal = useCallback((): Terminal | null => {
    if (activeSplitLayoutRef.current) {
      return splitFocusedRef.current?.terminal ?? null;
    }
    return terminalInstancesRef.current[activeTabIdRef.current] ?? null;
  }, []);

  /** 当前应接受「会话动作」的 api：分屏 = 焦点窗格快照；单屏 = 激活标签注册表 */
  const getActionApi = useCallback((): TerminalActionApi | null => {
    if (activeSplitLayoutRef.current) {
      return (splitFocusedRef.current?.api as TerminalActionApi | null | undefined) ?? null;
    }
    return sessionApisRef.current[activeTabIdRef.current] ?? null;
  }, []);

  /** 当前激活目标的选区文本（复制/复制并粘贴用） */
  const getActiveSelectionText = useCallback((): string => {
    return getActionApi()?.getSelection() || "";
  }, [getActionApi]);

  /** 粘贴到当前激活目标（右键粘贴 / AI / 快捷命令行共用） */
  const pasteToActiveTerminal = useCallback((text: string) => {
    getActionApi()?.pasteToTerminal(text);
  }, [getActionApi]);

  const clearActiveTerminal = useCallback(() => {
    /* 只清本地回滚缓冲，不向远端发送任何字符（JumpServer 兼容红线）；
       分屏态清屏用焦点窗格的 terminal 实例（Bug③） */
    getActionTerminal()?.clear();
    getActionApi()?.clearSelection();
  }, [getActionTerminal, getActionApi]);

  const reconnectActive = useCallback(() => {
    getActionApi()?.startTerminal({ isReconnect: true });
  }, [getActionApi]);

  const disconnectActive = useCallback(() => {
    getActionApi()?.stopTerminal({ preserveSession: true });
  }, [getActionApi]);

  const exportTranscript = useCallback(() => {
    /* 分屏态导出焦点窗格的缓冲（Bug③） */
    const terminal = getActionTerminal();
    if (!terminal) {
      return;
    }
    const buffer = terminal.buffer.active;
    const lines: string[] = [];
    for (let index = 0; index < buffer.length; index += 1) {
      const line = buffer.getLine(index);
      if (line) {
        lines.push(line.translateToString(true));
      }
    }
    const host = (props.server?.host || props.server?.name || props.serverId || "server").replace(/[^\w.-]+/g, "_");
    const now = new Date();
    const pad = (value: number) => String(value).padStart(2, "0");
    const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
    const blob = new Blob([`${lines.join("\n")}\n`], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `terminal-${host}-${stamp}.log`;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 4000);
    props.onStatus("已导出终端会话记录");
  }, [props.server, props.serverId, props.onStatus, getActionTerminal]);

  const revealInFiles = useCallback(() => {
    props.onRevealInFiles?.(props.cwd);
  }, [props]);

  const openSettings = useCallback(() => {
    props.onOpenSettings?.();
  }, [props]);

  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const triggerUpload = useCallback(() => {
    uploadInputRef.current?.click();
  }, []);

  const toggleFindBar = useCallback(() => {
    if (searchRef.current.isOpen) {
      searchRef.current.close();
    } else {
      searchRef.current.open();
    }
  }, []);

  /* --- 快捷命令行开关（localStorage 持久化，默认开） --- */
  const [quickBarOpen, setQuickBarOpen] = useState(() => {
    try {
      return globalThis.localStorage?.getItem(TERMINAL_QUICKBAR_OPEN_STORAGE_KEY) !== "false";
    } catch {
      return true;
    }
  });
  const toggleQuickBar = useCallback(() => {
    setQuickBarOpen((prev) => {
      const next = !prev;
      try {
        globalThis.localStorage?.setItem(TERMINAL_QUICKBAR_OPEN_STORAGE_KEY, next ? "true" : "false");
      } catch {
        /* 忽略存储失败（隐私模式等），仅本次会话内生效 */
      }
      return next;
    });
  }, []);

  /* --- ⋯ 菜单 / 分屏菜单 / 右键菜单 --- */
  /* 用户反馈 Bug④：分屏激活时单屏窗格被卸载（onSessionState(tabId, null) 清空状态），
     状态栏改用 SplitView 聚合值合成（connectedAt 置 null；retry>0 = 重连中） */
  const singlePaneState = hasTabs ? paneStates[activeTabId] ?? null : null;
  const activePaneState: TerminalPaneSessionState | null = !hasTabs
    ? null
    : activeSplitLayout
      ? splitAggregateState
        ? {
            connected: splitAggregateState.connected,
            retryCount: splitAggregateState.retryCount,
            connectedAt: null,
            phase: splitAggregateState.connected
              ? "connected"
              : splitAggregateState.retryCount > 0
                ? "reconnecting"
                : "stopped",
          }
        : null
      : singlePaneState;
  const canReconnectActive = Boolean(activePaneState && !activePaneState.connected);

  const openMoreMenu = useCallback((event: ReactMouseEvent<HTMLButtonElement>) => {
    const shell = shellRef.current;
    if (!shell) {
      return;
    }
    const shellRect = shell.getBoundingClientRect();
    const btnRect = event.currentTarget.getBoundingClientRect();
    setMoreMenu({
      x: Math.max(8, btnRect.right - shellRect.left - 190),
      y: btnRect.bottom - shellRect.top + 6,
    });
  }, []);

  /* T10：单窗格时主点击 = 直接左右分屏；已分屏时主点击 = 展开菜单 */
  const handleSplitButtonClick = useCallback((event: ReactMouseEvent<HTMLButtonElement>) => {
    if (!hasTabs) {
      return;
    }
    if (!splitLayouts[activeTabIdRef.current]) {
      applySplitLayout(activeTabIdRef.current, "lr");
      return;
    }
    const shell = shellRef.current;
    if (!shell) {
      return;
    }
    const shellRect = shell.getBoundingClientRect();
    const btnRect = event.currentTarget.getBoundingClientRect();
    setSplitMenu({
      x: Math.max(8, btnRect.right - shellRect.left - 190),
      y: btnRect.bottom - shellRect.top + 6,
    });
  }, [applySplitLayout, hasTabs, splitLayouts]);

  const splitMenuItems: TerminalMenuItem[] = [
    { key: "split-lr", icon: Columns2, label: "左右分屏", kbd: "⌘D", onSelect: () => { applySplitLayout(activeTabIdRef.current, "lr"); setSplitMenu(null); } },
    { key: "split-td", icon: Rows2, label: "上下分屏", onSelect: () => { applySplitLayout(activeTabIdRef.current, "td"); setSplitMenu(null); } },
    { key: "split-third", icon: LayoutGrid, label: "三分格", onSelect: () => { applySplitLayout(activeTabIdRef.current, "third"); setSplitMenu(null); } },
    { key: "sep" },
    { key: "close-pane", icon: X, label: "关闭当前窗格", danger: true, disabled: !activeSplitLayout, onSelect: () => { applySplitLayout(activeTabIdRef.current, undefined); setSplitMenu(null); } },
  ];

  const contextActions: TerminalContextMenuActions = {
    onCopy: selectionText
      ? () => {
          /* 分屏态选区取焦点窗格（Bug③）；fallback 打开菜单时的选区文本 */
          void copyText(getActiveSelectionText() || selectionText);
          setContextMenu(null);
        }
      : undefined,
    onPaste: () => {
      void navigator.clipboard
        .readText()
        .then((text) => {
          if (text) {
            pasteToActiveTerminal(text);
          }
        })
        .catch(() => props.onStatus("读取剪贴板失败"));
      setContextMenu(null);
    },
    onCopyPaste: () => {
      const text = getActiveSelectionText() || selectionText;
      if (text) {
        void copyText(text).then(() => {
          pasteToActiveTerminal(text);
        });
      }
      setContextMenu(null);
    },
    onFind: () => {
      setContextMenu(null);
      searchRef.current.open();
    },
    onClear: () => {
      clearActiveTerminal();
      setContextMenu(null);
    },
    onSplitLR: () => {
      applySplitLayout(activeTabIdRef.current, "lr");
      setContextMenu(null);
    },
    onSplitTD: () => {
      applySplitLayout(activeTabIdRef.current, "td");
      setContextMenu(null);
    },
    onClosePane: () => {
      applySplitLayout(activeTabIdRef.current, undefined);
      setContextMenu(null);
    },
    canClosePane: Boolean(activeSplitLayout),
    onUpload: props.onUploadFiles ? () => {
      setContextMenu(null);
      triggerUpload();
    } : undefined,
    uploadDisabled: !props.onUploadFiles,
    onRevealInFiles: () => {
      setContextMenu(null);
      revealInFiles();
    },
    onDisconnect: () => {
      disconnectActive();
      setContextMenu(null);
    },
  };

  /* --- 标签条数据：状态点 + 重名自动加序号（T2） --- */
  const hostLabel = props.server?.username && props.server?.host
    ? `${props.server.username}@${props.server.host}`
    : (props.server?.host || props.server?.name || props.serverId || "--");
  const tabBaseName = (tab: TerminalTabState) =>
    tab.kind === "asset" ? (tab.assetKeyword || "资产会话") : (props.server?.name || props.server?.host || "终端");
  const tabItems: TerminalTabItem[] = tabs.map((tab, index) => {
    /* 分屏激活时单屏窗格被卸载、其状态上报为 null：激活标签回落到分屏聚合状态（用户反馈 Bug④） */
    const state = paneStates[tab.tabId]
      ?? (activeSplitLayout && tab.tabId === activeTabId ? splitAggregateState ?? undefined : undefined);
    const status: TerminalTabStatus = state?.connected
      ? "connected"
      : state && state.retryCount > 0
        ? "connecting"
        : state
          ? "disconnected"
          : "connecting";
    const baseName = tabBaseName(tab);
    const occurrence = tabs.slice(0, index).filter((entry) => tabBaseName(entry) === baseName).length;
    const title = occurrence > 0 ? `${baseName} · ${occurrence + 1}` : baseName;
    const statusLabel = state?.connected ? "已连接" : state && state.retryCount > 0 ? `重连中 ${state.retryCount}` : state ? "已断开" : "连接中";
    return {
      tabId: tab.tabId,
      title,
      subtitle: `${hostLabel} · ${statusLabel}`,
      status,
    };
  });

  /* --- 快捷键（终端视图激活时接管；T10 快捷键总表：桌面端全量，浏览器端仅 ⌘F/⌘J，
          其余留按钮入口不与浏览器行为抢键。⌘F 浏览器端 preventDefault 压掉页面原生查找） --- */
  const shortcutsRef = useRef({ newTab, closeTab, activeTabId, applySplitLayout, onToggleTerminalOverlay: props.onToggleTerminalOverlay });
  shortcutsRef.current = { newTab, closeTab, activeTabId, applySplitLayout, onToggleTerminalOverlay: props.onToggleTerminalOverlay };
  useEffect(() => {
    if (!hasTabs) {
      return;
    }
    const handler = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) {
        return;
      }
      const key = event.key.toLowerCase();
      let handled = false;
      if (key === "f") {
        searchRef.current.open();
        handled = true;
      } else if (key === "j") {
        shortcutsRef.current.onToggleTerminalOverlay("ai");
        handled = true;
      } else if (isElectronRuntime) {
        if (key === "t") {
          shortcutsRef.current.newTab();
          handled = true;
        } else if (key === "w") {
          shortcutsRef.current.closeTab(shortcutsRef.current.activeTabId);
          handled = true;
        } else if (key === "d") {
          shortcutsRef.current.applySplitLayout(shortcutsRef.current.activeTabId, "lr");
          handled = true;
        }
      }
      if (handled) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [hasTabs]);

  /* --- 派生态 --- */
  /* 浏览器 Document PiP（对应原型 T7）：Electron 走 props.onTogglePopup（openPipWindow 协议），
     浏览器走 DOM 搬迁通道：open 时只搬 .terminal-main-shell 单节点并记录原位锚点，
     关闭（close / PiP 自带叉）精确放回原位；打开后按时刻表连发 fit 并随 PiP resize 重排。 */
  const browserPip = useBrowserTerminalPip();
  /* 卸载护栏：PiP 打开中先同步放回 .terminal-main-shell 再关窗，
     防 React 卸载该子树时 removeChild 扑空 → reconcile 崩溃白屏 */
  useEffect(() => {
    return () => {
      browserPip.close();
    };
  }, [browserPip.close]);
  const showBrowserPipPlaceholder = browserPip.isPip && !isStandalone;
  const showAI = props.terminalOverlay === "ai";
  const terminalTitle = props.server?.name || props.server?.host || "终端";
  const statusState: "connected" | "disconnected" | "preserved" | "idle" = !hasTabs
    ? "idle"
    : activePaneState?.connected
      ? "connected"
      : activePaneState?.phase === "preserved"
        ? "preserved"
        : "disconnected";
  const retry = activePaneState && !activePaneState.connected && activePaneState.retryCount > 0
    ? {
        attempt: Math.min(activePaneState.retryCount, TERMINAL_RETRY_MAX),
        max: TERMINAL_RETRY_MAX,
      }
    : null;
  const toolbarDisabled = !hasTabs;

  return (
    <section className={`terminal-bottom-panel${isStandalone ? " terminal-bottom-panel-standalone" : ""}`}>
      {/* ① 工具行：左侧标签信息并入 TabStrip，这里只放动作（全图标 + 原生 title） */}
      <div className={`terminal-panel-bar${isStandalone ? " terminal-panel-bar-standalone" : ""}`}>
        {isStandalone ? (
          <div className="terminal-panel-bar-title">
            <strong>{terminalTitle}</strong>
          </div>
        ) : null}
        <span className="terminal-panel-bar-spacer" />
        <div className="terminal-panel-bar-actions">
          <button
            type="button"
            className="terminal-toolbar-button terminal-toolbar-button-icon"
            onClick={toggleFindBar}
            disabled={toolbarDisabled}
            title="在终端中查找 ⌘F"
          >
            <Search size={13} />
          </button>
          {!isStandalone ? (
            <button
              type="button"
              className="terminal-toolbar-button terminal-toolbar-button-icon"
              onClick={handleSplitButtonClick}
              /* 浏览器 PiP 打开中禁止进入分屏：主体已搬入 PiP 窗口，再叠加分屏布局会加剧 DOM 失配 */
              disabled={toolbarDisabled || (!isElectronRuntime && browserPip.isPip)}
              title="分屏：左右 ⌘D / 上下 / 三分格 / 关闭当前窗格"
            >
              <Columns2 size={13} />
            </button>
          ) : null}
          <button
            type="button"
            className="terminal-toolbar-button terminal-toolbar-button-icon"
            onClick={triggerUpload}
            disabled={toolbarDisabled || !props.onUploadFiles}
            title={props.onUploadFiles ? "上传文件到当前目录" : "上传通道未就绪"}
          >
            <Upload size={13} />
          </button>
          <button
            type="button"
            className={`terminal-toolbar-button terminal-toolbar-button-icon${quickBarOpen ? " terminal-shortcuts-toggle-active" : ""}`}
            onClick={toggleQuickBar}
            disabled={toolbarDisabled}
            title="快捷命令行开关"
          >
            <Command size={13} />
          </button>
          <button
            type="button"
            className={`terminal-toolbar-button terminal-toolbar-button-icon${showAI ? " tai-toggle-active" : ""}`}
            onClick={() => props.onToggleTerminalOverlay("ai")}
            disabled={toolbarDisabled}
            title="AI 助手（引用选中内容）⌘J"
          >
            <Zap size={13} />
          </button>
          {!isStandalone ? (
            <button
              type="button"
              className="terminal-toolbar-button terminal-toolbar-button-icon"
              onClick={() => {
                if (isElectronRuntime) {
                  props.onTogglePopup();
                } else if (browserPip.isPip) {
                  browserPip.close();
                } else if (shellRef.current) {
                  void browserPip.open({
                    el: shellRef.current,
                    title: terminalTitle,
                    onFit: () => {
                      sessionApisRef.current[activeTabIdRef.current]?.fitTerminal();
                    },
                  });
                }
              }}
              disabled={
                toolbarDisabled ||
                /* 浏览器 PiP：分屏激活时禁用（多窗格搬迁不在支持范围），PiP 打开中保持可点用于收回 */
                (!isElectronRuntime && !browserPip.isPip && (Boolean(activeSplitLayout) || !browserPip.supported))
              }
              title={
                props.detached || browserPip.isPip
                  ? "收回终端"
                  : !isElectronRuntime && activeSplitLayout
                    ? "分屏状态下不支持画中画，先取消分屏"
                    : !isElectronRuntime && !browserPip.supported
                      ? "当前浏览器不支持画中画"
                      : "弹出独立小窗"
              }
            >
              <PipExpandIcon size={12} />
            </button>
          ) : null}
          <button
            type="button"
            className="terminal-toolbar-button terminal-toolbar-button-icon"
            onClick={openMoreMenu}
            disabled={toolbarDisabled}
            title="更多：清屏 · 重连 · 断开 · 在文件目录打开 · 导出会话记录 · 终端设置"
          >
            <Ellipsis size={13} />
          </button>
        </div>
      </div>

      {/* ② 终端标签条（空态时隐藏，T8） */}
      {hasTabs ? (
        <TerminalTabStrip
          tabs={tabItems}
          activeTabId={activeTabId}
          onSelect={setActiveTab}
          onClose={closeTab}
          onNew={() => newTab()}
          canNew={canNew}
          onCloseOthers={closeOthers}
          onCloseAll={closeAll}
        >
          {isElectronRuntime ? (
            <span className="terminal-tabs-hint">⌘T 新建 · ⌘W 关闭标签</span>
          ) : null}
        </TerminalTabStrip>
      ) : null}

      {/* ③ 终端区：panes / 分屏 / 悬浮 FindBar / 菜单 / 拖拽遮罩留待批7 */}
      <div className="terminal-body-slot" style={{ display: showBrowserPipPlaceholder ? "none" : undefined }}>
        <div className="terminal-body-layout">
          <div ref={shellRef} className="terminal-main-shell">
            {!hasTabs ? (
              /* T8 空态：单一主按钮，动作禁用态 */
              <div className="terminal-empty">
                <span className="terminal-empty-icon" aria-hidden="true">
                  <TerminalIcon size={20} />
                </span>
                <span className="terminal-empty-title">未建立终端会话</span>
                <span className="terminal-empty-sub">连接当前服务器，或从左侧列表选择</span>
                <button type="button" className="terminal-empty-connect" onClick={() => newTab()} disabled={!props.serverId}>
                  连接 {terminalTitle}
                </button>
              </div>
            ) : (
              <>
                <div
                  className="terminal-tab-panes"
                  style={activeSplitLayout ? { display: "none" } : undefined}
                  onContextMenu={handlePaneContextMenu}
                >
                  {tabs
                    .filter((tab) => !(activeSplitLayout && tab.tabId === activeTabId))
                    .map((tab) => (
                      <TerminalTabPane
                        key={tab.tabId}
                        tab={tab}
                        active={tab.tabId === activeTabId}
                        visible
                        serverId={props.serverId}
                        selectedServer={props.server}
                        preferredBastionId={props.preferredBastionId}
                        isBusy={props.isBusy}
                        cwd={props.cwd}
                        onStatus={props.onStatus}
                        onActivity={props.onActivity}
                        terminalFontSize={props.terminalFontSize}
                        terminalFontFamily={props.terminalFontFamily}
                        terminalBackgroundColor={props.terminalBackgroundColor}
                        onSessionIdChange={handleSessionIdChange}
                        onTerminalInstance={handleTerminalInstance}
                        onSessionApi={handleSessionApi}
                        onSessionState={handleSessionState}
                        onSelectionMenu={handleSelectionMenu}
                      />
                    ))}
                </div>
                {activeSplitLayout && activeTab ? (
                  <TerminalSplitView
                    key={`${activeTab.tabId}:${activeSplitLayout}`}
                    initialLayout={activeSplitLayout}
                    serverId={props.serverId}
                    selectedServer={props.server}
                    preferredBastionId={props.preferredBastionId}
                    isBusy={props.isBusy}
                    cwd={props.cwd}
                    onStatus={props.onStatus}
                    onActivity={props.onActivity}
                    onFocusedPaneChanged={handleFocusedPaneChanged}
                    onAggregateStateChanged={handleSplitAggregateState}
                    onPaneContextMenu={handlePaneContextMenu}
                  />
                ) : null}
                {search.isOpen ? <TerminalFindBar search={search} /> : null}
                {contextMenu ? (
                  <TerminalContextMenu
                    x={contextMenu.x}
                    y={contextMenu.y}
                    onClose={() => setContextMenu(null)}
                    actions={contextActions}
                  />
                ) : null}
                {moreMenu ? (
                  <TerminalMoreMenu
                    x={moreMenu.x}
                    y={moreMenu.y}
                    onClose={() => setMoreMenu(null)}
                    actions={{
                      onClear: () => {
                        clearActiveTerminal();
                        setMoreMenu(null);
                      },
                      canReconnect: canReconnectActive,
                      onReconnect: () => {
                        reconnectActive();
                        setMoreMenu(null);
                      },
                      onDisconnect: () => {
                        disconnectActive();
                        setMoreMenu(null);
                      },
                      onRevealInFiles: () => {
                        setMoreMenu(null);
                        revealInFiles();
                      },
                      onExportTranscript: () => {
                        setMoreMenu(null);
                        exportTranscript();
                      },
                      onOpenSettings: () => {
                        setMoreMenu(null);
                        openSettings();
                      },
                    }}
                  />
                ) : null}
                {splitMenu ? (
                  <TerminalMenuShell
                    x={splitMenu.x}
                    y={splitMenu.y}
                    items={splitMenuItems}
                    onClose={() => setSplitMenu(null)}
                  />
                ) : null}
              </>
            )}
          </div>
          {/* AI 抽屉（T6）：非模态侧挂，纯图标开关 */}
          {showAI && props.serverId ? (
            <aside className="terminal-side-panel">
              <TerminalAI
                serverId={props.serverId}
                serverLabel={props.server?.name || props.server?.host || props.serverId}
                selectionText={selectionText}
                onExecute={(command) => pasteToActiveTerminal(command)}
                onClose={() => props.onToggleTerminalOverlay("ai")}
              />
            </aside>
          ) : null}
        </div>
      </div>

      {/* 浏览器 PiP 占位（对应原型 T7）：主体 DOM 搬入画中画窗口后，原位显示收回卡 */}
      {showBrowserPipPlaceholder ? (
        <div className="viewer-pip-placeholder" style={{ padding: "20px", minHeight: "80px" }}>
          <PipExpandIcon size={20} strokeWidth={1.5} />
          <strong>终端已弹出到独立小窗</strong>
          <button className="ghost-button" type="button" onClick={() => browserPip.close()}>
            收回
          </button>
        </div>
      ) : null}

      {/* ④ 快捷命令行（可开关） */}
      {hasTabs ? (
        <TerminalQuickBar
          open={quickBarOpen}
          cwd={props.cwd}
          onExecute={(command) => pasteToActiveTerminal(command)}
          onManage={() => setShortcutsDialogOpen(true)}
        />
      ) : null}

      {/* ⑤ 状态栏（T1/T4/T8）；分屏态重连按钮不显示——分屏窗格头部自带连接按钮（用户反馈 Bug④） */}
      <TerminalStatusBar
        state={statusState}
        hostLabel={hostLabel}
        connectedAt={activePaneState?.connectedAt ?? null}
        retry={retry}
        resources={props.resources ?? null}
        onReconnect={!activeSplitLayout && (statusState === "disconnected" || statusState === "preserved") ? reconnectActive : undefined}
        onOpenMonitor={props.onOpenMonitor}
      />

      {/* 上传：系统文件选择器（可多选），走 App 的统一上传通道 */}
      <input
        ref={uploadInputRef}
        type="file"
        multiple
        style={{ display: "none" }}
        onChange={(event) => {
          const files = event.target.files;
          if (files && files.length > 0) {
            props.onUploadFiles?.(files);
          }
          event.target.value = "";
        }}
      />

      <ShortcutsManagerDialog
        open={shortcutsDialogOpen}
        cwd={props.cwd}
        onClose={() => setShortcutsDialogOpen(false)}
      />
    </section>
  );
}
