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

function createInitialPane(serverId: string): SplitNode {
  return {
    id: nextNodeId(),
    type: "pane",
    pane: { paneId: `pane-0`, sessionId: createTerminalSessionId(serverId) },
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

function findParentOf(node: SplitNode, targetId: string): SplitNode | null {
  if (node.children) {
    for (const child of node.children) {
      if (child.id === targetId) return node;
      const found = findParentOf(child, targetId);
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
  if (root.type === "pane") return root;
  if (!root.children) return root;

  // If only 2 children and one is the target, replace root with the other
  if (root.children.length === 2) {
    const targetIdx = root.children.findIndex((c) => findPaneById(c, paneId));
    if (targetIdx >= 0) {
      const survivor = root.children[1 - targetIdx];
      return survivor;
    }
  }

  // Recurse
  return {
    ...root,
    children: root.children.map((c) => removePaneFromTree(c, paneId)),
  };
}

export function TerminalSplitView({ serverId, selectedServer, preferredBastionId, isBusy, cwd, onStatus, onActivity }: Props) {
  const [tree, setTree] = useState<SplitNode>(() => createInitialPane(serverId));

  const handleSessionIdChange = useCallback((paneId: string, sessionId: string) => {
    setTree((prev) => {
      const pane = findPaneById(prev, paneId);
      if (pane?.pane) {
        pane.pane.sessionId = sessionId;
      }
      return { ...prev };
    });
  }, []);

  const handleClose = useCallback((paneId: string) => {
    setTree((prev) => {
      if (countPanes(prev) <= 1) return prev;
      return removePaneFromTree(prev, paneId);
    });
  }, []);

  const handleSplit = useCallback((paneId: string, direction: SplitDirection) => {
    setTree((prev) => {
      const pane = findPaneById(prev, paneId);
      if (!pane) return prev;

      const newPaneId = `pane-${Date.now()}`;
      const newPane: TerminalPaneConfig = {
        paneId: newPaneId,
        sessionId: createTerminalSessionId(serverId),
      };

      const newPaneNode: SplitNode = {
        id: nextNodeId(),
        type: "pane",
        pane: newPane,
      };

      // Replace the found pane with a split node
      const replaceInTree = (node: SplitNode): SplitNode => {
        if (node.id === pane.id) {
          return {
            id: nextNodeId(),
            type: "split",
            direction,
            children: [node, newPaneNode],
            sizes: [50, 50],
          };
        }
        if (node.children) {
          return { ...node, children: node.children.map(replaceInTree) };
        }
        return node;
      };

      return replaceInTree(prev);
    });
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
            <div key={child.id} style={{ flex: node.sizes?.[i] || 1, overflow: "hidden" }}>
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
