import { useCallback, useState } from "react";
import type { ServerSummary } from "@server-log-console/shared";
import { TerminalPane, type TerminalPaneConfig } from "./TerminalPane.js";
import { createTerminalSessionId } from "./app-utils.js";

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

export function TerminalSplitView({ serverId, selectedServer, preferredBastionId, isBusy, cwd, onStatus, onActivity }: Props) {
  const [tree, setTree] = useState<SplitNode>(() => createInitialPane(serverId));

  const handleSessionIdChange = useCallback((paneId: string, sessionId: string) => {
    setTree((prev) => updatePaneSessionId(prev, paneId, sessionId));
  }, []);

  const handleClose = useCallback((paneId: string) => {
    setTree((prev) => {
      if (countPanes(prev) <= 1) return prev;
      return removePaneFromTree(prev, paneId);
    });
  }, []);

  const handleSplit = useCallback((paneId: string, direction: SplitDirection) => {
    setTree((prev) => splitPaneInTree(prev, paneId, direction, serverId));
  }, [serverId]);

  const renderNode = (node: SplitNode): React.ReactNode => {
    if (node.type === "pane" && node.pane) {
      return (
        <TerminalPane
          key={node.pane.paneId}
          config={node.pane}
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
