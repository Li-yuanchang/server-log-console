import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { ChevronDown, ChevronRight, Folder } from "lucide-react";
import { apiListSubdirectories } from "./api.js";
import type { DirectoryListingTarget } from "./api.js";

export type TreeColumnContextEntry = {
  path: string;
  label: string;
};

// 树节点状态：children 为 undefined 表示从未加载（懒加载），
// "loading" / "error" 为加载中与失败，数组为已加载的子目录绝对路径。
type TreeNodeState = {
  expanded: boolean;
  children: string[] | "loading" | "error" | undefined;
};

type Props = {
  title: string;
  summary?: string;
  serverId: string;
  directoryPath: string;
  listingTarget: DirectoryListingTarget | null;
  onBrowse: (path: string) => void;
  onOpenContextMenu: (entry: TreeColumnContextEntry, clientX: number, clientY: number) => void;
};

const ROOT_PATH = "/";

function normalizeDirectoryPath(directoryPath: string): string {
  const trimmed = (directoryPath || ROOT_PATH).trim();
  if (!trimmed || trimmed === ROOT_PATH) {
    return ROOT_PATH;
  }
  return trimmed.endsWith("/") ? trimmed.replace(/\/+$/, "") || ROOT_PATH : trimmed;
}

// "/" -> ["/"]；"/data/logs" -> ["/", "/data", "/data/logs"]
function splitAncestorPaths(directoryPath: string): string[] {
  const segments = normalizeDirectoryPath(directoryPath).split("/").filter(Boolean);
  const chain = [ROOT_PATH];
  let current = "";
  for (const segment of segments) {
    current += `/${segment}`;
    chain.push(current);
  }
  return chain;
}

function nodeLabel(path: string): string {
  if (path === ROOT_PATH) {
    return ROOT_PATH;
  }
  return path.split("/").filter(Boolean).pop() ?? path;
}

export function FileBrowserTreeColumn(props: Props) {
  const { serverId, directoryPath } = props;

  // 树状态放在 ref 中（展开态 + 每层子目录缓存），渲染靠 renderTick 驱动；
  // 整个 Map 按服务器隔离：serverId 变化时整体重置。
  const nodesRef = useRef<Map<string, TreeNodeState>>(new Map());
  const loadingPathsRef = useRef<Set<string>>(new Set());
  const listingTargetRef = useRef<DirectoryListingTarget | null>(props.listingTarget);
  listingTargetRef.current = props.listingTarget;
  const loadedServerKeyRef = useRef<string | null>(null);
  const expandedPathKeyRef = useRef<string>("");
  const [, setRenderTick] = useState(0);
  const requestRender = useCallback(() => setRenderTick((tick) => tick + 1), []);

  const ensureNode = useCallback((path: string): TreeNodeState => {
    let node = nodesRef.current.get(path);
    if (!node) {
      node = { expanded: false, children: undefined };
      nodesRef.current.set(path, node);
    }
    return node;
  }, []);

  // 懒加载：只拉取单层子目录，不递归；结果常驻缓存，展开过的不重复请求。
  const loadChildren = useCallback(async (path: string) => {
    const node = nodesRef.current.get(path);
    if (!node || Array.isArray(node.children)) {
      return;
    }
    if (loadingPathsRef.current.has(path)) {
      return;
    }
    loadingPathsRef.current.add(path);
    node.children = "loading";
    requestRender();
    const target = listingTargetRef.current;
    try {
      const children = target ? await apiListSubdirectories({ ...target, directoryPath: path }) : [];
      // 服务器可能已切换：写入的是旧 Map 里的孤立节点，不影响新树
      node.children = children;
    } catch {
      node.children = "error";
    } finally {
      loadingPathsRef.current.delete(path);
    }
    requestRender();
  }, [requestRender]);

  // 服务器/工作区切换重置 + directoryPath 变化沿路径自动展开（含当前目录自身）
  useEffect(() => {
    if (loadedServerKeyRef.current !== serverId) {
      loadedServerKeyRef.current = serverId;
      nodesRef.current = new Map();
      loadingPathsRef.current.clear();
      expandedPathKeyRef.current = "";
    }

    const pathKey = `${serverId}\u0000${normalizeDirectoryPath(directoryPath)}`;
    if (expandedPathKeyRef.current !== pathKey) {
      expandedPathKeyRef.current = pathKey;
      if (serverId) {
        for (const ancestor of splitAncestorPaths(directoryPath)) {
          const node = ensureNode(ancestor);
          node.expanded = true;
          if (node.children === undefined) {
            void loadChildren(ancestor);
          }
        }
      }
    }
    requestRender();
  }, [serverId, directoryPath, ensureNode, loadChildren, requestRender]);

  // 点击箭头只切换折叠，不触发浏览；失败态重新展开时允许重试一次
  const toggleExpand = useCallback((path: string) => {
    const node = ensureNode(path);
    node.expanded = !node.expanded;
    if (node.expanded && (node.children === undefined || node.children === "error")) {
      void loadChildren(path);
    }
    requestRender();
  }, [ensureNode, loadChildren, requestRender]);

  const currentPath = normalizeDirectoryPath(directoryPath);

  const renderNodeRows = (): ReactNode[] => {
    const rows: ReactNode[] = [];
    const walk = (path: string, depth: number) => {
      const node = nodesRef.current.get(path);
      const expanded = node?.expanded === true;
      const children = node?.children;
      const label = nodeLabel(path);
      rows.push(
        <div
          key={path}
          className={path === currentPath ? "tree-row tree-row-current" : "tree-row"}
          style={{ paddingLeft: `${8 + depth * 16}px` }}
          onContextMenu={(event) => {
            event.preventDefault();
            event.stopPropagation();
            props.onOpenContextMenu({ path, label }, event.clientX, event.clientY);
          }}
        >
          <button
            type="button"
            className="tree-tw"
            title={expanded ? "折叠" : "展开"}
            aria-label={expanded ? `折叠 ${label}` : `展开 ${label}`}
            onClick={(event) => {
              event.stopPropagation();
              toggleExpand(path);
            }}
          >
            {expanded
              ? <ChevronDown size={13} aria-hidden="true" />
              : <ChevronRight size={13} aria-hidden="true" />}
          </button>
          <Folder size={13} className="tree-folder" aria-hidden="true" />
          <button
            type="button"
            className="tree-tn"
            title={path}
            onClick={() => props.onBrowse(path)}
          >
            {label}
          </button>
          {Array.isArray(children) ? <span className="tree-tc">{children.length}</span> : null}
        </div>
      );
      if (expanded && Array.isArray(children)) {
        for (const child of children) {
          walk(child, depth + 1);
        }
      }
    };
    walk(ROOT_PATH, 0);
    return rows;
  };

  return (
    <section className="browser-column browser-tree-column">
      <div className="browser-column-head">
        <strong>{props.title}</strong>
        {props.summary ? <span>{props.summary}</span> : null}
      </div>
      <div className="tree-list">
        {renderNodeRows()}
      </div>
    </section>
  );
}
