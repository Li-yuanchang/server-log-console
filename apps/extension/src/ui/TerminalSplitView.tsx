import { useCallback, useEffect, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import type { Terminal } from "@xterm/xterm";
import type { ServerSummary } from "@server-log-console/shared";
import { TerminalPane, type TerminalPaneConfig } from "./TerminalPane.js";
import { createTerminalSessionId } from "./app-utils.js";

/**
 * TerminalPaneApiSnapshot —— 分屏窗格会话能力快照（用户反馈 Bug③：查找/复制/粘贴/清屏须路由到焦点窗格）。
 * useTerminalSession 返回对象结构匹配即可（TerminalPane 内经稳定委托壳上报，身份不随渲染变化）。
 */
export interface TerminalPaneApiSnapshot {
  getSelection(): string;
  clearSelection(): void;
  pasteToTerminal(text: string): void;
  focusTerminal(): void;
  focusTerminalSoon(): void;
  startTerminal(options?: { isReconnect?: boolean }): unknown | Promise<unknown>;
  stopTerminal(options?: { preserveSession?: boolean }): void;
}

/** 焦点窗格快照：容器用它把查找条（useTerminalSearch）与菜单动作接到焦点窗格（对应原型 T2/T3） */
export interface FocusedPaneSnapshot {
  terminal: Terminal | null;
  api: TerminalPaneApiSnapshot | null;
}

/** 窗格会话连接状态快照（用户反馈 Bug④：分屏窗格状态聚合后供容器状态栏派生） */
export interface PaneStateSnapshot {
  connected: boolean;
  retryCount: number;
}

type SplitDirection = "horizontal" | "vertical";

interface SplitNode {
  id: string;
  type: "pane" | "split";
  direction?: SplitDirection;
  children?: SplitNode[];
  pane?: TerminalPaneConfig;
  sizes?: number[];
}

interface Props {
  serverId: string;
  selectedServer: ServerSummary | null;
  preferredBastionId: string;
  isBusy: boolean;
  cwd?: string;
  onStatus: (msg: string) => void;
  onActivity: (msg: string) => void;
  /** 初始布局（终端工作台重设计）：容器按标签记内存态布局，挂载时按此建树。
      lr=左右 / td=上下 / third=三分格（先左后对右侧上下）。缺省 = 单窗格。 */
  initialLayout?: "lr" | "td" | "third";
  /** 焦点窗格快照上报（Bug③）：仅在值变化时回调；卸载报 null。容器据此挂查找条与路由菜单动作。 */
  onFocusedPaneChanged?: (snapshot: FocusedPaneSnapshot | null) => void;
  /** 窗格会话状态聚合上报（Bug④）：connected=任一窗格已连接；retryCount=各窗格最大值。仅在值变化时回调；卸载报 null。 */
  onAggregateStateChanged?: (state: PaneStateSnapshot | null) => void;
  /** 窗格终端体右键（Bug②）：透传容器统一 TerminalContextMenu（容器内 preventDefault 拦原生菜单） */
  onPaneContextMenu?: (event: ReactMouseEvent) => void;
  /** 最后一个窗格关闭时通知容器退回单屏（2026-10-25）。
      用户反馈「分屏关到只剩最后一个后，X 按钮点不动，只有右键菜单的
      『关闭当前窗格』能关」。根因：handleClose 原本在 countPanes<=1 时直接
      return（不敢删空树），而 X 按钮是唯一的关闭入口，于是最后一个窗格的 X
      成为死按钮。右键菜单走的是 applySplitLayout(tabId, undefined)（整标签退出
      分屏），所以那条路正常 —— 两条路径语义不一致。
      现统一：关闭最后一个窗格 = 退出分屏（回到该标签的单屏终端），
      与右键菜单「关闭当前窗格」落到同一状态。 */
  onExitSplit?: () => void;
}

let nodeCounter = 0;
function nextNodeId() {
  return `split-${++nodeCounter}`;
}

function nextPaneId() {
  return `pane-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function createInitialPane(serverId: string): SplitNode {
  return {
    id: nextNodeId(),
    type: "pane",
    pane: { paneId: nextPaneId(), sessionId: createTerminalSessionId(serverId) },
  };
}

function findPaneById(node: SplitNode, paneId: string): SplitNode | null {
  if (node.type === "pane" && node.pane?.paneId === paneId) return node;
  if (node.children) {
    for (const child of node.children) {
      const found = findPaneById(child, paneId);
      if (found) return found;
    }
  }
  return null;
}

function countPanes(node: SplitNode): number {
  if (node.type === "pane") return 1;
  return (node.children || []).reduce((sum, c) => sum + countPanes(c), 0);
}

function removePaneFromTree(root: SplitNode, paneId: string): SplitNode {
  if (root.type === "pane") {
    return root;
  }
  if (!root.children) {
    return root;
  }

  const nextChildren = root.children
    .map((child) => {
      if (child.type === "pane" && child.pane?.paneId === paneId) {
        return null;
      }
      return removePaneFromTree(child, paneId);
    })
    .filter((child): child is SplitNode => child !== null);

  if (nextChildren.length === 0) {
    return root;
  }
  if (nextChildren.length === 1) {
    return nextChildren[0];
  }

  return {
    ...root,
    children: nextChildren,
    sizes: nextChildren.map(() => 1),
  };
}

function updatePaneSessionId(node: SplitNode, paneId: string, sessionId: string): SplitNode {
  if (node.type === "pane" && node.pane) {
    if (node.pane.paneId !== paneId) {
      return node;
    }
    return {
      ...node,
      pane: {
        ...node.pane,
        sessionId,
      },
    };
  }
  if (!node.children) {
    return node;
  }
  return {
    ...node,
    children: node.children.map((child) => updatePaneSessionId(child, paneId, sessionId)),
  };
}

function splitPaneInTree(node: SplitNode, paneId: string, direction: SplitDirection, serverId: string): SplitNode {
  if (node.type === "pane" && node.pane?.paneId === paneId) {
    return {
      id: nextNodeId(),
      type: "split",
      direction,
      children: [
        node,
        {
          id: nextNodeId(),
          type: "pane",
          pane: {
            paneId: nextPaneId(),
            sessionId: createTerminalSessionId(serverId),
          },
        },
      ],
      sizes: [1, 1],
    };
  }
  if (!node.children) {
    return node;
  }
  return {
    ...node,
    children: node.children.map((child) => splitPaneInTree(child, paneId, direction, serverId)),
  };
}

/** 按 initialLayout 构造初始树：lr/td = 一次 split；third = 先左右再对右侧上下 */
function createInitialTree(serverId: string, layout?: "lr" | "td" | "third"): SplitNode {
  const single = createInitialPane(serverId);
  if (!layout) {
    return single;
  }
  const direction: SplitDirection = layout === "td" ? "vertical" : "horizontal";
  const twoPanes = splitPaneInTree(single, single.pane!.paneId, direction, serverId);
  if (layout !== "third") {
    return twoPanes;
  }
  const rightChild = twoPanes.children?.[1];
  const rightPaneId = rightChild?.type === "pane" ? rightChild.pane!.paneId : "";
  if (!rightChild || rightChild.type !== "pane" || !rightPaneId) {
    return twoPanes;
  }
  return splitPaneInTree(twoPanes, rightPaneId, "vertical", serverId);
}

/** 先序收集全部窗格 id（默认焦点 = 第一个窗格；焦点窗格被关掉后回落到第一个） */
function collectPaneIds(node: SplitNode, out: string[]): string[] {
  if (node.type === "pane" && node.pane) {
    out.push(node.pane.paneId);
  }
  if (node.children) {
    for (const child of node.children) {
      collectPaneIds(child, out);
    }
  }
  return out;
}

export function TerminalSplitView({
  serverId,
  selectedServer,
  preferredBastionId,
  isBusy,
  cwd,
  onStatus,
  onActivity,
  initialLayout,
  onFocusedPaneChanged,
  onAggregateStateChanged,
  onPaneContextMenu,
  onExitSplit,
}: Props) {
  const [tree, setTree] = useState<SplitNode>(() => createInitialTree(serverId, initialLayout));

  /* --- 焦点窗格追踪（对应原型 T2「点击窗格即切换焦点」，默认第一个窗格） --- */
  const [focusedPaneId, setFocusedPaneId] = useState<string | null>(null);
  const focusedPaneIdRef = useRef(focusedPaneId);
  focusedPaneIdRef.current = focusedPaneId;
  const treeRef = useRef(tree);
  treeRef.current = tree;

  /* 每窗格实例 / api / 会话状态注册表（ref：子窗格高频渲染不触发本组件重渲） */
  const paneTerminalsRef = useRef<Record<string, Terminal | null>>({});
  const paneApisRef = useRef<Record<string, TerminalPaneApiSnapshot | null>>({});
  const paneStatesRef = useRef<Record<string, PaneStateSnapshot>>({});

  /* 上报回调经 ref 同步，避免把父级回调变成 effect 依赖 */
  const onFocusedPaneChangedRef = useRef(onFocusedPaneChanged);
  onFocusedPaneChangedRef.current = onFocusedPaneChanged;
  const onAggregateStateChangedRef = useRef(onAggregateStateChanged);
  onAggregateStateChangedRef.current = onAggregateStateChanged;
  /* 退出分屏回调同样经 ref：handleClose 用空依赖数组保持引用稳定 */
  const onExitSplitRef = useRef(onExitSplit);
  onExitSplitRef.current = onExitSplit;
  const lastFocusedReportRef = useRef<FocusedPaneSnapshot | null>(null);
  const lastAggregateKeyRef = useRef<string>("none");

  /** 聚合并上报焦点窗格快照：仅在 terminal / api 身份变化时回调（否则容器 setState 成环） */
  const reportFocusedPane = useCallback(() => {
    const report = onFocusedPaneChangedRef.current;
    if (!report) {
      return;
    }
    const ids = collectPaneIds(treeRef.current, []);
    const effectiveId = focusedPaneIdRef.current && ids.includes(focusedPaneIdRef.current)
      ? focusedPaneIdRef.current
      : ids[0];
    const candidate: FocusedPaneSnapshot | null = effectiveId
      ? { terminal: paneTerminalsRef.current[effectiveId] ?? null, api: paneApisRef.current[effectiveId] ?? null }
      : null;
    const last = lastFocusedReportRef.current;
    if (
      last === candidate ||
      (last !== null &&
        candidate !== null &&
        last.terminal === candidate.terminal &&
        last.api === candidate.api)
    ) {
      return;
    }
    lastFocusedReportRef.current = candidate;
    report(candidate);
  }, []);

  /** 聚合并上报会话状态：connected=任一窗格；retryCount=最大值（Bug④） */
  const reportAggregateState = useCallback(() => {
    const report = onAggregateStateChangedRef.current;
    if (!report) {
      return;
    }
    const entries = Object.values(paneStatesRef.current);
    if (entries.length === 0) {
      if (lastAggregateKeyRef.current === "none") {
        return;
      }
      lastAggregateKeyRef.current = "none";
      report(null);
      return;
    }
    const connected = entries.some((entry) => entry.connected);
    const retryCount = entries.reduce((max, entry) => Math.max(max, entry.retryCount), 0);
    const key = `${connected}|${retryCount}`;
    if (lastAggregateKeyRef.current === key) {
      return;
    }
    lastAggregateKeyRef.current = key;
    report({ connected, retryCount });
  }, []);

  /* 每次渲染同步焦点窗格快照（窗格实例/焦点切换落在这里；值变化才上报） */
  useEffect(() => {
    reportFocusedPane();
  });

  /* 卸载：清空容器侧注册（容器回落到单屏激活终端/单屏状态） */
  useEffect(() => {
    return () => {
      onFocusedPaneChangedRef.current?.(null);
      onAggregateStateChangedRef.current?.(null);
    };
  }, []);

  const handleSessionIdChange = useCallback((paneId: string, sessionId: string) => {
    setTree((prev) => updatePaneSessionId(prev, paneId, sessionId));
  }, []);

  const handleClose = useCallback((paneId: string) => {
    /* 只剩最后一个窗格（2026-10-25 修复「最后一个窗格 X 点不动」）：
       不能把树删空（会渲染出空容器），正确语义是退出分屏回到单屏终端。
       原先这里在 setTree 里直接 return prev —— 等于把 X 变成死按钮，
       用户只能靠右键菜单「关闭当前窗格」脱身，两条入口语义不一致。
       现改为通知容器退出分屏，与右键菜单落到同一状态。
       判断放 updater 之外（用 treeRef 读当前树）：在 setState updater 里调用
       父级 setState 属于副作用，React 严格模式下 updater 可能被重复执行。 */
    if (countPanes(treeRef.current) <= 1) {
      onExitSplitRef.current?.();
      return;
    }
    setTree((prev) => removePaneFromTree(prev, paneId));
  }, []);

  const handleSplit = useCallback((paneId: string, direction: SplitDirection) => {
    setTree((prev) => splitPaneInTree(prev, paneId, direction, serverId));
  }, [serverId]);

  /* --- 窗格注册回调（稳定引用；值变化经 reportFocusedPane / reportAggregateState 上报） --- */
  const handlePaneTerminal = useCallback(
    (paneId: string, terminal: Terminal | null) => {
      paneTerminalsRef.current[paneId] = terminal;
      reportFocusedPane();
    },
    [reportFocusedPane],
  );

  const handlePaneApi = useCallback(
    (paneId: string, api: TerminalPaneApiSnapshot | null) => {
      paneApisRef.current[paneId] = api;
      reportFocusedPane();
    },
    [reportFocusedPane],
  );

  const handlePaneSessionState = useCallback(
    (paneId: string, state: PaneStateSnapshot | null) => {
      if (state === null) {
        delete paneStatesRef.current[paneId];
      } else {
        paneStatesRef.current[paneId] = state;
      }
      reportAggregateState();
    },
    [reportAggregateState],
  );

  const handlePaneFocus = useCallback((paneId: string) => {
    if (focusedPaneIdRef.current === paneId) {
      return;
    }
    setFocusedPaneId(paneId);
  }, []);

  const renderNode = (node: SplitNode): React.ReactNode => {
    if (node.type === "pane" && node.pane) {
      const pane = node.pane;
      return (
        <TerminalPane
          key={pane.paneId}
          config={pane}
          serverId={serverId}
          selectedServer={selectedServer}
          preferredBastionId={preferredBastionId}
          isBusy={isBusy}
          cwd={cwd}
          onStatus={onStatus}
          onActivity={onActivity}
          onSessionIdChange={handleSessionIdChange}
          onClose={handleClose}
          onSplit={handleSplit}
          onTerminalInstanceChange={(terminal) => handlePaneTerminal(pane.paneId, terminal)}
          onApiSnapshot={(api) => handlePaneApi(pane.paneId, api)}
          onSessionSnapshot={(state) => handlePaneSessionState(pane.paneId, state)}
          onPaneFocus={() => handlePaneFocus(pane.paneId)}
          onPaneContextMenu={onPaneContextMenu}
        />
      );
    }

    if (node.type === "split" && node.children) {
      const dir = node.direction === "horizontal" ? "row" : "column";
      return (
        <div key={node.id} className={`terminal-split-${dir}`} style={{ display: "flex", flex: 1, flexDirection: dir === "row" ? "row" : "column" }}>
          {node.children.map((child, i) => (
            <div
              key={child.id}
              className={`terminal-split-child terminal-split-child-${dir}`}
              style={{ flex: node.sizes?.[i] || 1, overflow: "hidden" }}
            >
              {renderNode(child)}
            </div>
          ))}
        </div>
      );
    }

    return null;
  };

  return <div className="terminal-split-root">{renderNode(tree)}</div>;
}
