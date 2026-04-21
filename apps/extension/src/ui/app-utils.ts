import type { ServerSummary } from "@server-log-console/shared";
import type { ManualServerDraft } from "./ConnectionSettingsWorkspace.js";
import type { ViewerPipSnapshot } from "./types.js";
import { VIEWER_PIP_SNAPSHOT_KEY } from "./types.js";

export function createManualServerDraft(server?: ServerSummary | null): ManualServerDraft {
  return {
    id: server?.source === "manual" ? server.id : "",
    name: server?.name || "",
    host: server?.host || "",
    port: String(server?.port || 22),
    username: server?.username || "root",
    basePath: server?.basePath || "/var/log",
    profile: server?.profile || "custom",
    tagsText: server?.tags?.join(", ") || "",
    connectionKind: server?.connectionKind === "bastion" || server?.connectionKind === "bastion-target" ? server.connectionKind : "direct",
    password: "",
    privateKey: ""
  };
}

export function parseManualServerTags(tagsText: string): string[] {
  return tagsText
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function computeAutoSliceLength(fileSize: number): number {
  if (fileSize <= 0) return 65536;
  if (fileSize <= 65536) return 65536;         // ≤ 64 KB → whole file
  if (fileSize <= 131072) return 131072;       // ≤ 128 KB → whole file
  if (fileSize <= 262144) return 262144;       // ≤ 256 KB → whole file
  return 262144;                                // > 256 KB → fixed 256 KB slices
}

export function setLimitedMapEntry<K, V>(map: Map<K, V>, key: K, value: V, maxEntries: number) {
  if (map.has(key)) {
    map.delete(key);
  }
  map.set(key, value);
  while (map.size > maxEntries) {
    const oldestKey = map.keys().next().value as K | undefined;
    if (oldestKey === undefined) {
      break;
    }
    map.delete(oldestKey);
  }
}

export function readViewerPipSnapshot(): ViewerPipSnapshot | null {
  try {
    const raw = window.localStorage.getItem(VIEWER_PIP_SNAPSHOT_KEY);
    return raw ? JSON.parse(raw) as ViewerPipSnapshot : null;
  } catch {
    return null;
  }
}

export function writeViewerPipSnapshot(snapshot: ViewerPipSnapshot) {
  try {
    window.localStorage.setItem(VIEWER_PIP_SNAPSHOT_KEY, JSON.stringify(snapshot));
  } catch {
    return;
  }
}

export function buildWorkspaceSession(targetServer: ServerSummary) {
  return {
    id: `workspace:${targetServer.id}` as const,
    serverId: targetServer.id,
    serverName: targetServer.name || targetServer.host || targetServer.id,
    serverHost: targetServer.host
  };
}

export function createTerminalSessionId(targetServerId: string) {
  return `terminal-${targetServerId}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function createDefaultWorkspaceSessionState(nextServerId: string, savedDirectory: string, isStandaloneViewerWindow: boolean, isStandaloneTerminalWindow: boolean) {
  return {
    serverId: nextServerId,
    filePath: "",
    directoryPath: savedDirectory,
    keywordInput: "",
    keywordMode: "phrase" as const,
    excludeInput: "",
    contextLines: 3,
    useRegex: false,
    selectedPreset: "未选择",
    startDate: "",
    endDate: "",
    startTime: "",
    endTime: "",
    credentialStatus: null,
    credentialUsername: "",
    serverRouteConfig: null,
    connectionTestStatus: null,
    preferredBastionId: "",
    jumpMode: "auto" as const,
    jumpSearchKeyword: "",
    jumpAssetId: "",
    jumpAssetOptions: [] as never[],
    results: null,
    resultTabs: [] as never[],
    searchStartedAt: null as number | null,
    activeLogView: isStandaloneViewerWindow ? "search" as const : "files" as const,
    activeViewerTabId: "file",
    fileEntries: [] as never[],
    fileMeta: null,
    sliceOffset: 0,
    sliceLength: 64 * 1024,
    sliceLengthMode: "auto" as const,
    sliceData: null,
    lineContextState: null,
    resultContextMode: false,
    selectedFilePaths: [] as string[],
    resultTabCounter: 1,
    activeHighlightIndex: 0,
    showQueryAdvanced: false,
    showFileTools: false,
    errorHighlightEnabled: false,
    showPathHistory: false,
    showTransferHistory: false,
    terminalPanelOpen: isStandaloneTerminalWindow,
    terminalDetached: false,
    terminalOverlay: "none" as const,
    terminalSessionId: "",
    recordingSession: null,
    liveFollowEnabled: false,
    liveFollowPaused: false,
    liveFollowContent: ""
  };
}
