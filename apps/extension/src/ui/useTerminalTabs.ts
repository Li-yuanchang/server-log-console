import { useCallback, useEffect, useRef } from "react";
import type { TerminalTabState } from "./types.js";
import { createTerminalSessionId } from "./app-utils.js";

/**
 * useTerminalTabs —— 终端内多标签组 state（对应方案 §3 会话模型升级 / 原型 T2）。
 *
 * 受控式设计：标签组真身存放在 App 的 WorkspaceSessionState（terminalTabs / activeTerminalTabId，
 * 随工作区持久化），本 hook 只提供动作与迁移：
 *  - 迁移：某工作区首次进入时若 terminalTabs 为空且旧 terminalSessionId 非空 → 用它构造单标签
 *    （sessionId 沿用旧值，网关侧会话 90s 内可恢复）；
 *  - 上限 8 个（xterm 实例内存护栏）：newTab 超限 no-op + onStatus 提示；
 *  - 关闭激活标签自动激活相邻；closeAll 清空（容器显示 T8 空态）。
 */

export const TERMINAL_TABS_MAX = 8;

export const TERMINAL_QUICKBAR_OPEN_STORAGE_KEY = "server-log-console:terminal-quickbar-open";

/** 标签 id：tt-<随机> */
export function createTerminalTabId(): string {
  return `tt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** 构造一个标签；sessionId 优先复用传入值（迁移/复用网关会话），否则新建 */
export function createTerminalTabState(
  serverId: string,
  sessionId?: string,
  kind: TerminalTabState["kind"] = "server",
  assetKeyword?: string,
): TerminalTabState {
  return {
    tabId: createTerminalTabId(),
    sessionId: sessionId?.trim() || createTerminalSessionId(serverId || "server"),
    kind,
    assetKeyword: assetKeyword?.trim() || undefined,
  };
}

export interface TerminalTabsChange {
  terminalTabs: TerminalTabState[];
  activeTerminalTabId: string;
}

export interface UseTerminalTabsParams {
  serverId: string;
  tabs: TerminalTabState[];
  activeTabId: string;
  /** 旧单会话字段（WorkspaceSessionState.terminalSessionId）：迁移来源 */
  legacySessionId: string;
  onChange: (next: TerminalTabsChange) => void;
  /** 超限等提示（走 App 的 setActionStatus） */
  onStatus?: (message: string) => void;
}

export interface UseTerminalTabsResult {
  tabs: TerminalTabState[];
  activeTabId: string;
  activeTab: TerminalTabState | null;
  setActiveTab: (tabId: string) => void;
  newTab: (opts?: { kind?: TerminalTabState["kind"]; assetKeyword?: string }) => void;
  closeTab: (tabId: string) => void;
  closeOthers: (tabId: string) => void;
  closeAll: () => void;
  canNew: boolean;
}

export function useTerminalTabs(params: UseTerminalTabsParams): UseTerminalTabsResult {
  const { serverId, tabs, activeTabId, legacySessionId, onChange, onStatus } = params;

  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onStatusRef = useRef(onStatus);
  onStatusRef.current = onStatus;

  /* 迁移：tabs 为空且旧 terminalSessionId 非空 → 用它构造单标签。
     无依赖数组：每次渲染后廉价检查一次；同一 serverId+legacyKey 只迁移一次（ref 护栏），
     避免父级忽略 onChange 时造成死循环。 */
  const migratedKeyRef = useRef("");
  useEffect(() => {
    const legacy = legacySessionId.trim();
    if (tabs.length > 0 || !legacy) {
      return;
    }
    const key = `${serverId}|${legacy}`;
    if (migratedKeyRef.current === key) {
      return;
    }
    migratedKeyRef.current = key;
    const tab = createTerminalTabState(serverId, legacy);
    onChangeRef.current({ terminalTabs: [tab], activeTerminalTabId: tab.tabId });
  });

  const setActiveTab = useCallback((tabId: string) => {
    if (!tabs.some((tab) => tab.tabId === tabId)) {
      return;
    }
    onChangeRef.current({ terminalTabs: tabs, activeTerminalTabId: tabId });
  }, [tabs]);

  const newTab = useCallback((opts?: { kind?: TerminalTabState["kind"]; assetKeyword?: string }) => {
    if (tabs.length >= TERMINAL_TABS_MAX) {
      onStatusRef.current?.(`最多 ${TERMINAL_TABS_MAX} 个终端标签`);
      return;
    }
    const tab = createTerminalTabState(serverId, undefined, opts?.kind, opts?.assetKeyword);
    onChangeRef.current({ terminalTabs: [...tabs, tab], activeTerminalTabId: tab.tabId });
  }, [serverId, tabs]);

  const closeTab = useCallback((tabId: string) => {
    const index = tabs.findIndex((tab) => tab.tabId === tabId);
    if (index < 0) {
      return;
    }
    const nextTabs = tabs.filter((tab) => tab.tabId !== tabId);
    let nextActive = activeTabId;
    if (activeTabId === tabId) {
      // 关闭激活标签自动激活相邻（优先左侧，其次右侧，空则清空）
      nextActive = nextTabs[Math.max(0, index - 1)]?.tabId ?? "";
    }
    onChangeRef.current({ terminalTabs: nextTabs, activeTerminalTabId: nextActive });
  }, [tabs, activeTabId]);

  const closeOthers = useCallback((tabId: string) => {
    const keep = tabs.find((tab) => tab.tabId === tabId);
    if (!keep) {
      return;
    }
    onChangeRef.current({ terminalTabs: [keep], activeTerminalTabId: keep.tabId });
  }, [tabs]);

  const closeAll = useCallback(() => {
    onChangeRef.current({ terminalTabs: [], activeTerminalTabId: "" });
  }, []);

  return {
    tabs,
    activeTabId,
    activeTab: tabs.find((tab) => tab.tabId === activeTabId) ?? null,
    setActiveTab,
    newTab,
    closeTab,
    closeOthers,
    closeAll,
    canNew: tabs.length < TERMINAL_TABS_MAX,
  };
}
