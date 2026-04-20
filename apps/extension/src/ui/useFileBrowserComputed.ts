import { useMemo } from "react";
import type { LogFileEntry, ServerSummary } from "@server-log-console/shared";

export type FileBrowserComputedAPI = {
  filteredEntries: LogFileEntry[];
  selectableFileEntries: LogFileEntry[];
  fileEntriesByPath: Map<string, LogFileEntry>;
  selectedFilePathSet: Set<string>;
  selectedFileEntries: LogFileEntry[];
  directoryEntries: LogFileEntry[];
  fileOnlyEntries: LogFileEntry[];
  tableEntries: LogFileEntry[];
  visibleSelectedFileCount: number;
  allVisibleFilesSelected: boolean;
  groupedServers: readonly (readonly [string, ServerSummary[]])[];
  filteredGroupedServers: readonly (readonly [string, ServerSummary[]])[];
  pathSegments: { label: string; path: string }[];
  treeEntries: Array<{
    key: string;
    label: string;
    path: string;
    depth: number;
    kind: "path" | "directory";
    isCurrent: boolean;
  }>;
  sidebarActivityLines: string[];
  recentActivityLines: string[];
};

export function useFileBrowserComputed(deps: {
  fileEntries: LogFileEntry[];
  fileFilter: string;
  selectedFilePaths: string[];
  fileSortKey: "name" | "size" | "kind" | "modifiedTime";
  fileSortDirection: "asc" | "desc";
  servers: ServerSummary[];
  serverFilter: string;
  directoryPath: string;
  activityLines: string[];
}): FileBrowserComputedAPI {
  const {
    fileEntries,
    fileFilter,
    selectedFilePaths,
    fileSortKey,
    fileSortDirection,
    servers,
    serverFilter,
    directoryPath,
    activityLines,
  } = deps;

  const filteredEntries = useMemo(() => {
    if (!fileFilter.trim()) {
      return fileEntries;
    }
    const normalizedKeyword = fileFilter.trim().toLowerCase();
    return fileEntries.filter((entry) => entry.name.toLowerCase().includes(normalizedKeyword));
  }, [fileEntries, fileFilter]);

  const selectableFileEntries = useMemo(
    () => fileEntries.filter((entry) => entry.kind === "file"),
    [fileEntries]
  );

  const fileEntriesByPath = useMemo(
    () => new Map(fileEntries.map((entry) => [entry.path, entry] as const)),
    [fileEntries]
  );

  const selectedFilePathSet = useMemo(
    () => new Set(selectedFilePaths),
    [selectedFilePaths]
  );

  const selectedFileEntries = useMemo(
    () => selectedFilePaths.flatMap((path) => {
      const entry = fileEntriesByPath.get(path);
      return entry ? [entry] : [];
    }),
    [fileEntriesByPath, selectedFilePaths]
  );

  const directoryEntries = useMemo(
    () => filteredEntries.filter((entry) => entry.kind === "directory"),
    [filteredEntries]
  );

  const fileOnlyEntries = useMemo(
    () => filteredEntries.filter((entry) => entry.kind === "file"),
    [filteredEntries]
  );

  const tableEntries = useMemo(() => {
    const collator = new Intl.Collator("zh-CN", { numeric: true, sensitivity: "base" });
    const direction = fileSortDirection === "asc" ? 1 : -1;
    return [...filteredEntries].sort((left, right) => {
      if (left.kind !== right.kind) {
        return left.kind === "directory" ? -1 : 1;
      }

      let result = 0;
      switch (fileSortKey) {
        case "size":
          result = (left.size ?? -1) - (right.size ?? -1);
          break;
        case "kind":
          result = collator.compare(left.kind, right.kind);
          break;
        case "modifiedTime":
          result = new Date(left.modifiedTime || 0).getTime() - new Date(right.modifiedTime || 0).getTime();
          break;
        case "name":
        default:
          result = collator.compare(left.name, right.name);
          break;
      }

      if (result === 0) {
        result = collator.compare(left.name, right.name);
      }

      return result * direction;
    });
  }, [fileSortDirection, fileSortKey, filteredEntries]);

  const visibleSelectedFileCount = useMemo(
    () => tableEntries.reduce((count, entry) => count + (selectedFilePathSet.has(entry.path) ? 1 : 0), 0),
    [selectedFilePathSet, tableEntries]
  );

  const allVisibleFilesSelected = tableEntries.length > 0 && visibleSelectedFileCount === tableEntries.length;

  const groupedServers = useMemo(() => {
    const groups = new Map<string, ServerSummary[]>();
    for (const server of servers) {
      const key = server.groupPath?.join(" / ") || "未分组";
      const list = groups.get(key) ?? [];
      list.push(server);
      groups.set(key, list);
    }
    return [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0], "zh-CN"));
  }, [servers]);

  const filteredGroupedServers = useMemo(() => {
    const normalized = serverFilter.trim().toLowerCase();
    return groupedServers
      .map(([groupName, groupServers]) => [
        groupName,
        normalized
          ? groupServers.filter(
              (server) =>
                server.name.toLowerCase().includes(normalized) ||
                server.host.toLowerCase().includes(normalized) ||
                groupName.toLowerCase().includes(normalized)
            )
          : groupServers
      ] as const)
      .filter(([, groupServers]) => groupServers.length > 0);
  }, [groupedServers, serverFilter]);

  const pathSegments = useMemo(() => {
    const segments = directoryPath.split("/").filter(Boolean);
    const items = [{ label: "/", path: "/" }];
    let currentPath = "";
    for (const segment of segments) {
      currentPath += `/${segment}`;
      items.push({ label: segment, path: currentPath });
    }
    return items;
  }, [directoryPath]);

  const treeEntries = useMemo(() => {
    const items: Array<{
      key: string;
      label: string;
      path: string;
      depth: number;
      kind: "path" | "directory";
      isCurrent: boolean;
    }> = pathSegments.map((item, index) => ({
      key: `path:${item.path}`,
      label: item.label,
      path: item.path,
      depth: index,
      kind: "path" as const,
      isCurrent: item.path === (directoryPath || "/")
    }));

    directoryEntries.forEach((entry) => {
      items.push({
        key: `dir:${entry.path}`,
        label: entry.name,
        path: entry.path,
        depth: pathSegments.length,
        kind: "directory" as const,
        isCurrent: false
      });
    });

    return items;
  }, [directoryEntries, directoryPath, pathSegments]);

  const sidebarActivityLines = useMemo(() => activityLines.slice(-80), [activityLines]);
  const recentActivityLines = useMemo(() => activityLines.slice(-4), [activityLines]);

  return {
    filteredEntries,
    selectableFileEntries,
    fileEntriesByPath,
    selectedFilePathSet,
    selectedFileEntries,
    directoryEntries,
    fileOnlyEntries,
    tableEntries,
    visibleSelectedFileCount,
    allVisibleFilesSelected,
    groupedServers,
    filteredGroupedServers,
    pathSegments,
    treeEntries,
    sidebarActivityLines,
    recentActivityLines,
  };
}
