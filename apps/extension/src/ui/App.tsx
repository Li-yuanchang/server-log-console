import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FeedbackOverlays, type DownloadProgressState, type UploadProgressState } from "./FeedbackOverlays.js";
import { FileContextMenu, type FileContextMenuState } from "./FileContextMenu.js";
import { FileBrowserActions } from "./FileBrowserActions.js";
import { FileBrowserContentColumn } from "./FileBrowserContentColumn.js";
import { FileBrowserFilterBar } from "./FileBrowserFilterBar.js";
import { FileBrowserGrid } from "./FileBrowserGrid.js";
import { FileBrowserHistoryDropdown } from "./FileBrowserHistoryDropdown.js";
import { FileBrowserPathbar, buildBreadcrumbItems } from "./FileBrowserPathbar.js";
import { FileBrowserStrip } from "./FileBrowserStrip.js";
import { FileBrowserTableRows } from "./FileBrowserTableRows.js";
import { FileBrowserTreeColumn } from "./FileBrowserTreeColumn.js";
import { FilePreviewDialog, type PreviewDialogState } from "./FilePreviewDialog.js";
import { ConfirmDialog, TextInputDialog, type ConfirmDialogState } from "./ModalDialogs.js";
import { ConnectionSettingsWorkspace, type ManualServerDraft, type SettingsWorkspaceView } from "./ConnectionSettingsWorkspace.js";
import { SearchQueryPanel } from "./SearchQueryPanel.js";
import { SearchProgressPanel } from "./SearchProgressPanel.js";
import { SearchToolbarActions } from "./SearchToolbarActions.js";
import { TransferHistoryDialog } from "./TransferHistoryDialog.js";
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent, WheelEvent as ReactWheelEvent } from "react";
import type { ReactNode } from "react";
import type {
  JumpServerAssetOption,
  LogFileEntry,
  LogFileMetaResponse,
  LogSearchResponse,
  LogSearchTaskResponse,
  LogSliceResponse,
  ServerConnectionTestResponse,
  ServerRouteConfig,
  ServerCredentialStatus,
  ServerSummary
} from "@server-log-console/shared";
import { Radio, Wrench, Download, Copy, PictureInPicture2, Bug, X } from "lucide-react";
import { TerminalPanel } from "./TerminalWorkspace.js";
import { ToolIcon } from "./ToolIcon.js";
import { looksLikeJumpServer } from "./terminal-utils.js";
import { useTerminalSession } from "./useTerminalSession.js";
import { useToasts } from "./useToasts.js";
import { VirtualLogViewer, type VirtualLogViewerHandle, type VirtualLogViewerScrollState } from "./VirtualLogViewer.js";
import { useLiveFollow } from "./useLiveFollow.js";
import { usePictureInPicture } from "./usePictureInPicture.js";
import type { LogRecordingSessionResponse } from "./api.js";
import {
  localServiceBase,
  apiDeleteServer,
  apiGetServers,
  apiGetDirectoryListing,
  apiGetLogMeta,
  apiGetLogSlice,
  apiGetLineContext,
  apiCreateSearchTask,
  apiPollSearchTask,
  apiGetFinalShellSettings,
  apiSaveFinalShellPath,
  apiGetCredentialStatus,
  apiSaveCredential,
  apiGetServerRoute,
  apiSaveServerRoute,
  apiSearchJumpServerAssets,
  apiTestConnection,
  apiImportFromTool,
  apiUpsertManualServer,
  apiStartLogRecording,
  apiStopLogRecording,
  apiDownloadFile,
  apiDeleteFile,
  apiRenameFile,
  apiPreviewFile,
  apiSaveFile,
  apiUploadSmall,
  apiUploadStart,
  apiUploadChunk,
  apiUploadFinish,
  apiHealthCheck,
  apiExtractZip,
  apiMkdir,
  apiCompress,
} from "./api.js";
import {
  buildConnectionSummary,
  clampPercent,
  clampSliceStart,
  copyText,
  describeSearchScopeClient,
  describeSearchStrategyClient,
  downloadTextFile,
  formatBytes,
  formatDateTime,
  formatDurationLabel,
  formatNumber,
  formatPercent,
  formatPreviewSnippet,
  formatSearchViewerContent,
  formatSliceProgressLabel,
  getLocalDateString,
  getParentDirectoryPath,
  getPreviewCacheKey,
  getSliceCacheKey,
  lineMatchesSearch,
  looksLikeShellPrompt,
  normalizeSearchInput,
  parseKeywordTerms,
  previewBucketSize,
  previewSliceLength,
  searchWithinContent,
  searchWithinMatches,
  truncateText,
} from "./utils.js";
import type { LineContextState, ViewerResultTab } from "./utils.js";
import {
  clampBrowserTreeWidth,
  clampActivityPanelHeight,
  clearTransferHistory,
  type TransferHistoryEntry,
  pushDirectoryHistory,
  pushTransferHistory,
  readActivityPanelHeight,
  readBrowserTreeWidth,
  readDirectoryHistory,
  readLastDirectoryMap,
  readLastServerId,
  readTransferHistory,
  rememberDirectoryIfUseful,
  writeActivityPanelHeight,
  writeBrowserTreeWidth,
  writeLastDirectory,
  writeLastServerId,
} from "./storage.js";

const defaultDirectoryPath = "";
const SEARCH_TIMER_INTERVAL_MS = 1000;
const LOCAL_SERVICE_RETRY_INTERVAL_MS = 2500;
const MAX_PREVIEW_CACHE_ENTRIES = 60;
const MAX_SLICE_CACHE_ENTRIES = 24;
const MAX_RESULT_TABS = 8;
const VIEWER_PIP_SNAPSHOT_KEY = "slc:viewer-pip-snapshot";

type WorkspaceSession = {
  id: string;
  serverId: string;
  serverName: string;
  serverHost: string;
};

type WorkspaceSessionState = {
  serverId: string;
  filePath: string;
  directoryPath: string;
  keywordInput: string;
  keywordMode: "phrase" | "any" | "all";
  contextLines: number;
  useRegex: boolean;
  selectedPreset: string;
  startDate: string;
  endDate: string;
  startTime: string;
  endTime: string;
  credentialStatus: ServerCredentialStatus | null;
  credentialUsername: string;
  serverRouteConfig: ServerRouteConfig | null;
  connectionTestStatus: ServerConnectionTestResponse | null;
  preferredBastionId: string;
  jumpMode: "auto" | "jumpserver-search";
  jumpSearchKeyword: string;
  jumpAssetId: string;
  jumpAssetOptions: JumpServerAssetOption[];
  results: LogSearchResponse | null;
  resultTabs: ViewerResultTab[];
  searchStartedAt: number | null;
  activeLogView: "search" | "files";
  activeViewerTabId: string;
  fileEntries: LogFileEntry[];
  fileMeta: LogFileMetaResponse | null;
  sliceOffset: number;
  sliceLength: number;
  sliceLengthMode: "auto" | "manual";
  sliceData: LogSliceResponse | null;
  lineContextState: LineContextState | null;
  resultContextMode: boolean;
  selectedFilePaths: string[];
  resultTabCounter: number;
  activeHighlightIndex: number;
  showQueryAdvanced: boolean;
  showFileTools: boolean;
  errorHighlightEnabled: boolean;
  showPathHistory: boolean;
  showTransferHistory: boolean;
  terminalPanelOpen: boolean;
  terminalDetached: boolean;
  terminalOverlay: "none" | "shortcuts" | "ai";
  terminalSessionId: string;
  recordingSession: LogRecordingSessionResponse | null;
  liveFollowEnabled: boolean;
  liveFollowPaused: boolean;
  liveFollowContent: string;
};

type ViewerPipSnapshot = {
  serverId: string;
  filePath: string;
  directoryPath: string;
  keywordInput: string;
  keywordMode: "phrase" | "any" | "all";
  useRegex: boolean;
  preferredBastionId: string;
  activeLogView: "search" | "files";
  activeViewerTabId: string;
  results: LogSearchResponse | null;
  resultTabs: ViewerResultTab[];
  searchStartedAt: number | null;
  fileMeta: LogFileMetaResponse | null;
  sliceOffset: number;
  sliceLength: number;
  sliceLengthMode: "auto" | "manual";
  sliceData: LogSliceResponse | null;
  lineContextState: LineContextState | null;
  resultContextMode: boolean;
  activeHighlightIndex: number;
  showFileTools: boolean;
  errorHighlightEnabled: boolean;
  liveFollowEnabled: boolean;
  liveFollowPaused: boolean;
  liveFollowContent: string;
};

function createManualServerDraft(server?: ServerSummary | null): ManualServerDraft {
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

function parseManualServerTags(tagsText: string): string[] {
  return tagsText
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function computeAutoSliceLength(fileSize: number): number {
  if (fileSize <= 0) return 65536;
  if (fileSize <= 65536) return 65536;         // ≤ 64 KB → whole file
  if (fileSize <= 131072) return 131072;       // ≤ 128 KB → whole file
  if (fileSize <= 262144) return 262144;       // ≤ 256 KB → whole file
  return 262144;                                // > 256 KB → fixed 256 KB slices
}

function setLimitedMapEntry<K, V>(map: Map<K, V>, key: K, value: V, maxEntries: number) {
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

function readViewerPipSnapshot(): ViewerPipSnapshot | null {
  try {
    const raw = window.localStorage.getItem(VIEWER_PIP_SNAPSHOT_KEY);
    return raw ? JSON.parse(raw) as ViewerPipSnapshot : null;
  } catch {
    return null;
  }
}

function writeViewerPipSnapshot(snapshot: ViewerPipSnapshot) {
  try {
    window.localStorage.setItem(VIEWER_PIP_SNAPSHOT_KEY, JSON.stringify(snapshot));
  } catch {
    return;
  }
}

// Detect PiP mode from URL params (Electron BrowserWindow PiP)
const pipUrlParams = new URLSearchParams(globalThis.location?.search ?? "");
const pipMode = pipUrlParams.get("pip") ?? "";
const isStandaloneViewerWindow = pipMode === "viewer";
const isStandaloneTerminalWindow = pipMode === "terminal";
const isStandalonePipWindow = isStandaloneViewerWindow || isStandaloneTerminalWindow;

export function App() {
  const [servers, setServers] = useState<ServerSummary[]>([]);
  const [serverId, setServerId] = useState(pipUrlParams.get("serverId") ?? "");
  const [filePath, setFilePath] = useState(pipUrlParams.get("filePath") ?? "");
  const [serverFilter, setServerFilter] = useState("");
  const [fileFilter, setFileFilter] = useState("");
  const [keywordInput, setKeywordInput] = useState("");
  const [keywordMode, setKeywordMode] = useState<"phrase" | "any" | "all">("phrase");
  const [contextLines, setContextLines] = useState(3);
  const [useRegex, setUseRegex] = useState(false);
  const [selectedPreset, setSelectedPreset] = useState("未选择");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [results, setResults] = useState<LogSearchResponse | null>(null);
  const [resultTabs, setResultTabs] = useState<ViewerResultTab[]>([]);
  const [searchTask, setSearchTask] = useState<LogSearchTaskResponse | null>(null);
  const [activeLogView, setActiveLogView] = useState<"search" | "files">(isStandaloneViewerWindow ? "search" : ((pipUrlParams.get("activeLogView") as "search" | "files") || "files"));
  const [terminalPanelOpen, setTerminalPanelOpen] = useState(false);
  const [terminalDetached, setTerminalDetached] = useState(false);
  const [terminalSessionId, setTerminalSessionId] = useState(pipUrlParams.get("terminalSessionId") || "");
  const [terminalOverlay, setTerminalOverlay] = useState<"none" | "shortcuts" | "ai">("none");
  const [activeViewerTabId, setActiveViewerTabId] = useState("file");
  const [workspaceSessions, setWorkspaceSessions] = useState<WorkspaceSession[]>([]);
  const [activeWorkspaceSessionId, setActiveWorkspaceSessionId] = useState<string | null>(null);
  const [fileEntries, setFileEntries] = useState<LogFileEntry[]>([]);
  const [directoryPath, setDirectoryPath] = useState(pipUrlParams.get("directoryPath") || defaultDirectoryPath);
  const [fileMeta, setFileMeta] = useState<LogFileMetaResponse | null>(null);
  const [sliceOffset, setSliceOffset] = useState(0);
  const [sliceLength, setSliceLength] = useState(64 * 1024);
  const [sliceLengthMode, setSliceLengthMode] = useState<"auto" | "manual">("auto");
  const [sliceData, setSliceData] = useState<LogSliceResponse | null>(null);
  const [searchStartedAt, setSearchStartedAt] = useState<number | null>(null);
  const [searchNow, setSearchNow] = useState(() => Date.now());
  const [activityLines, setActivityLines] = useState<string[]>(["系统已启动，等待选择服务器与日志文件。"]);
  const [selectedImportTool, setSelectedImportTool] = useState<"finalshell" | "xshell">("finalshell");
  const [importStatus, setImportStatus] = useState("尚未导入连接。");
  const [importPath, setImportPath] = useState("尚未解析配置目录。");
  const [finalShellPath, setFinalShellPath] = useState("");
  const [finalShellDetectedPaths, setFinalShellDetectedPaths] = useState<string[]>([]);
  const [finalShellLastImportedAt, setFinalShellLastImportedAt] = useState("");
  const [xshellPath, setXshellPath] = useState("");
  const [xshellDetectedPaths, setXshellDetectedPaths] = useState<string[]>([]);
  const [xshellLastImportedAt, setXshellLastImportedAt] = useState("");
  const [uploadProgress, setUploadProgress] = useState<UploadProgressState | null>(null);
  const [downloadProgress, setDownloadProgress] = useState<DownloadProgressState | null>(null);
  const [contextMenu, setContextMenu] = useState<FileContextMenuState | null>(null);
  const [workspaceTabMenu, setWorkspaceTabMenu] = useState<{ x: number; y: number; session: WorkspaceSession } | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogState | null>(null);
  const [renameDialog, setRenameDialog] = useState<{ entry: LogFileEntry; newName: string } | null>(null);
  const [moveDialog, setMoveDialog] = useState<{ entry: LogFileEntry; targetDir: string } | null>(null);
  const [batchMoveDialog, setBatchMoveDialog] = useState<{ entries: LogFileEntry[]; targetDir: string } | null>(null);
  const [extractDialog, setExtractDialog] = useState<{ filePath: string; fileName: string; targetDir: string } | null>(null);
  const [mkdirDialog, setMkdirDialog] = useState<{ parentDir: string; dirName: string } | null>(null);
  const [compressDialog, setCompressDialog] = useState<{ sourcePath: string; sourceName: string; archiveType: "tar.gz" | "zip"; targetDir: string } | null>(null);
  const [recordingSession, setRecordingSession] = useState<LogRecordingSessionResponse | null>(null);
  const [previewDialog, setPreviewDialog] = useState<PreviewDialogState | null>(null);
  const [actionStatus, setActionStatus] = useState("就绪，可开始检索日志。");
  const [localServiceState, setLocalServiceState] = useState<"checking" | "online" | "offline">("checking");
  const [localServiceStatusText, setLocalServiceStatusText] = useState("正在检查本地连接服务...");
  const [isBusy, setIsBusy] = useState(false);
  const [preserveTerminalOnInactive, setPreserveTerminalOnInactive] = useState(false);
  const [pendingLiveFollowRestore, setPendingLiveFollowRestore] = useState<WorkspaceSessionState | null>(null);
  const isWorkspaceSwitchLocked = isBusy || searchTask?.status === "queued" || searchTask?.status === "running";
  const { toasts, showToast, updateToast, dismissToast } = useToasts();
  const [fileLoadingName, setFileLoadingName] = useState("");
  const [isDragOver, setIsDragOver] = useState(false);
  const [uiTheme] = useState<"classic" | "modern">("modern");
  useEffect(() => {
    try { localStorage.setItem("ui-theme", "modern"); } catch { /* ignore */ }
  }, []);
  const [showConnectionSettings, setShowConnectionSettings] = useState(false);
  const [settingsWorkspaceView, setSettingsWorkspaceView] = useState<SettingsWorkspaceView>("overview");
  const [manualServerDraft, setManualServerDraft] = useState<ManualServerDraft>(() => createManualServerDraft());
  const [showQueryAdvanced, setShowQueryAdvanced] = useState(false);
  const [credentialStatus, setCredentialStatus] = useState<ServerCredentialStatus | null>(null);
  const [serverRouteConfig, setServerRouteConfig] = useState<ServerRouteConfig | null>(null);
  const [connectionTestStatus, setConnectionTestStatus] = useState<ServerConnectionTestResponse | null>(null);
  const [credentialUsername, setCredentialUsername] = useState("");
  const [credentialPassword, setCredentialPassword] = useState("");
  const [credentialPrivateKey, setCredentialPrivateKey] = useState("");
  const [preferredBastionId, setPreferredBastionId] = useState(pipUrlParams.get("bastionId") || "");
  const [jumpMode, setJumpMode] = useState<"auto" | "jumpserver-search">("auto");
  const [jumpSearchKeyword, setJumpSearchKeyword] = useState("");
  const [jumpAssetId, setJumpAssetId] = useState("");
  const [jumpAssetOptions, setJumpAssetOptions] = useState<JumpServerAssetOption[]>([]);
  const [isElectron] = useState(() => !!(window as any).electronAPI || /Electron/.test(navigator.userAgent));
  const [isMacOS] = useState(() => navigator.userAgent.includes("Mac") || navigator.platform.toUpperCase().includes("MAC"));
  const [isPinned, setIsPinned] = useState(false);
  const [showFileTools, setShowFileTools] = useState(false);
  const [showViewerDebugPanel, setShowViewerDebugPanel] = useState(false);
  const [errorHighlightEnabled, setErrorHighlightEnabled] = useState(() => pipUrlParams.get("errorHighlight") === "1");
  const [resultContextMode, setResultContextMode] = useState(false);
  const [showKeywordBar, setShowKeywordBar] = useState(true);
  const [showDirectoryFilter, setShowDirectoryFilter] = useState(false);
  const [showPathHistory, setShowPathHistory] = useState(false);
  const [showTransferHistory, setShowTransferHistory] = useState(false);
  const [transferHistory, setTransferHistory] = useState<TransferHistoryEntry[]>(() => readTransferHistory());
  const [directoryInput, setDirectoryInput] = useState("");
  const [pathbarMode, setPathbarMode] = useState<"browse" | "edit">("browse");
  const [selectedFilePaths, setSelectedFilePaths] = useState<string[]>([]);
  const [browserTreeWidth, setBrowserTreeWidth] = useState(() => readBrowserTreeWidth());
  const [activityPanelHeight, setActivityPanelHeight] = useState(() => readActivityPanelHeight());
  const [resultTabCounter, setResultTabCounter] = useState(1);
  const [activeHighlightIndex, setActiveHighlightIndex] = useState(0);
  const [viewerMatchLineIndices, setViewerMatchLineIndices] = useState<number[]>([]);
  const [viewerScrollState, setViewerScrollState] = useState<VirtualLogViewerScrollState | null>(null);
  const [viewerOverviewDragging, setViewerOverviewDragging] = useState(false);
  const [viewerOverviewDraft, setViewerOverviewDraft] = useState(0);
  const [fileSortKey, setFileSortKey] = useState<"name" | "size" | "kind" | "modifiedTime">("name");
  const [fileSortDirection, setFileSortDirection] = useState<"asc" | "desc">("asc");
  const [readerPositionDraft, setReaderPositionDraft] = useState(0);
  const [readerPositionDragging, setReaderPositionDragging] = useState(false);
  const [readerPreviewContent, setReaderPreviewContent] = useState("");
  const [readerPreviewOffset, setReaderPreviewOffset] = useState<number | null>(null);
  const [readerPreviewLoading, setReaderPreviewLoading] = useState(false);
  const [lineContextState, setLineContextState] = useState<LineContextState | null>(null);
  const keywordInputRef = useRef<HTMLInputElement | null>(null);
  const directoryInputRef = useRef<HTMLInputElement | null>(null);
  const virtualViewerRef = useRef<VirtualLogViewerHandle | null>(null);
  const viewerContentShellRef = useRef<HTMLDivElement | null>(null);
  const browserGridRef = useRef<HTMLDivElement | null>(null);
  const contextMenuRef = useRef<HTMLDivElement | null>(null);
  const workspaceTabMenuRef = useRef<HTMLDivElement | null>(null);
  const viewerDebugRef = useRef<HTMLDivElement | null>(null);
  const readerRailRef = useRef<HTMLDivElement | null>(null);
  const viewerOverviewRailRef = useRef<HTMLDivElement | null>(null);
  const initializedRef = useRef(false);
  const autoConnectServerRef = useRef("");
  const sliceScrollAnchorRef = useRef<"top" | "bottom" | null>(null);
  const wheelSliceLockRef = useRef(false);
  const treeResizeRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const activityPanelResizeRef = useRef<{ startY: number; startHeight: number } | null>(null);
  const readerPreviewRequestRef = useRef(0);
  const openFileRequestRef = useRef(0);
  const sliceRequestRef = useRef(0);
  const jumpAssetAutoSearchKeyRef = useRef("");
  const readerDraftFrameRef = useRef<number | null>(null);
  const readerPendingDraftRef = useRef<number | null>(null);
  const previewCacheRef = useRef(new Map<string, { offset: number; content: string }>());
  const previewWarmRef = useRef(new Set<string>());
  const sliceCacheRef = useRef(new Map<string, LogSliceResponse>());
  const sliceWarmRef = useRef(new Set<string>());
  const backgroundHealthCheckInFlightRef = useRef(false);
  const prevServerIdForResetRef = useRef(serverId);
  const serverIdRef = useRef(serverId);
  const terminalDetachedRef = useRef(terminalDetached);
  const terminalSessionIdRef = useRef(terminalSessionId);
  const workspaceSessionStatesRef = useRef<Record<string, WorkspaceSessionState>>({});
  const pendingWorkspaceActivationRef = useRef<{ session: WorkspaceSession; state: WorkspaceSessionState; fromCache: boolean } | null>(null);
  const restoringWorkspaceStateRef = useRef<WorkspaceSessionState | null>(null);
  const restoringWorkspaceFromCacheRef = useRef(false);
  const skipServerSelectionResetRef = useRef(false);
  const skipServerAutoConnectRef = useRef(false);
  const standaloneViewerSnapshotRef = useRef<ViewerPipSnapshot | null>(isStandaloneViewerWindow ? readViewerPipSnapshot() : null);
  const standaloneViewerSnapshotAppliedRef = useRef(false);

  const liveReconnectRef = useRef<((target: { filePath: string; fileName: string }) => void) | null>(null);
  const liveFollow = useLiveFollow({
    serverId,
    sliceContent: sliceData?.content,
    onStatus: setActionStatus,
    onActivity: pushActivity,
    onReconnectNeeded: liveReconnectRef,
    viewerRef: virtualViewerRef,
  });
  const {
    liveFollowEnabled, liveFollowConnected, liveFollowContent,
    liveFollowRetryCount, liveFollowPaused, viewerNotAtBottom,
    setLiveFollowPaused, setLiveFollowContent,
    startLiveFollow, stopLiveFollow,
    handleViewerNearBottomChange, scrollViewerToBottom, clearLiveContent,
  } = liveFollow;

  const captureViewerPipSnapshot = useCallback((): ViewerPipSnapshot => ({
    serverId,
    filePath,
    directoryPath,
    keywordInput,
    keywordMode,
    useRegex,
    preferredBastionId,
    activeLogView,
    activeViewerTabId,
    results,
    resultTabs: [...resultTabs],
    searchStartedAt,
    fileMeta,
    sliceOffset,
    sliceLength,
    sliceLengthMode,
    sliceData,
    lineContextState,
    resultContextMode,
    activeHighlightIndex,
    showFileTools,
    errorHighlightEnabled,
    liveFollowEnabled,
    liveFollowPaused,
    liveFollowContent,
  }), [serverId, filePath, directoryPath, keywordInput, keywordMode, useRegex, preferredBastionId, activeLogView, activeViewerTabId, results, resultTabs, searchStartedAt, fileMeta, sliceOffset, sliceLength, sliceLengthMode, sliceData, lineContextState, resultContextMode, activeHighlightIndex, showFileTools, errorHighlightEnabled, liveFollowEnabled, liveFollowPaused, liveFollowContent]);

  const pipViewerRef = useRef<HTMLDivElement>(null);
  const pipLiveFollowRef = useRef(false);
  const pip = usePictureInPicture({
    width: 980,
    height: 680,
    onOpen: () => {
      if (liveFollowEnabled) {
        pipLiveFollowRef.current = true;
        stopLiveFollow({ keepContent: true });
        setActionStatus("实时跟随已转移到小窗。");
      }
    },
    onClose: () => {
      setActionStatus("日志小窗已关闭");
      if (pipLiveFollowRef.current && filePath.trim()) {
        pipLiveFollowRef.current = false;
        startLiveFollow(filePath, selectedFileName || filePath);
        setActionStatus("已从小窗恢复实时跟随。");
      }
    },
    electronPipParams: () => {
      writeViewerPipSnapshot(captureViewerPipSnapshot());
      return {
        serverId,
        filePath,
        directoryPath,
        bastionId: preferredBastionId,
        activeLogView,
        errorHighlight: errorHighlightEnabled,
        liveFollow: liveFollowEnabled,
      };
    },
  });

  useEffect(() => {
    serverIdRef.current = serverId;
  }, [serverId]);

  useEffect(() => {
    terminalDetachedRef.current = terminalDetached;
  }, [terminalDetached]);

  useEffect(() => {
    terminalSessionIdRef.current = terminalSessionId;
  }, [terminalSessionId]);

  useEffect(() => {
    if (!isElectron) {
      return;
    }

    const api = (window as any).electronAPI;
    api.onPipClosed((payload?: { mode?: "viewer" | "terminal"; terminalSessionId?: string }) => {
      const closedTerminalSessionId = String(payload?.terminalSessionId || "").trim();
      if (payload?.mode !== "terminal" || !closedTerminalSessionId) {
        return;
      }

      Object.keys(workspaceSessionStatesRef.current).forEach((workspaceSessionId) => {
        const sessionState = workspaceSessionStatesRef.current[workspaceSessionId];
        if (!sessionState || sessionState.terminalSessionId.trim() !== closedTerminalSessionId) {
          return;
        }
        workspaceSessionStatesRef.current[workspaceSessionId] = {
          ...sessionState,
          terminalDetached: false,
          terminalPanelOpen: Boolean(sessionState.serverId),
        };
      });

      if (terminalSessionIdRef.current !== closedTerminalSessionId) {
        return;
      }

      setTerminalDetached(false);
      setTerminalPanelOpen(Boolean(serverIdRef.current));
    });
  }, [isElectron]);

  useEffect(() => {
    if (!isStandaloneViewerWindow || standaloneViewerSnapshotAppliedRef.current) {
      return;
    }
    const snapshot = standaloneViewerSnapshotRef.current;
    if (!snapshot || snapshot.serverId !== serverId) {
      return;
    }
    standaloneViewerSnapshotAppliedRef.current = true;
    setKeywordInput(snapshot.keywordInput);
    setKeywordMode(snapshot.keywordMode);
    setUseRegex(snapshot.useRegex);
    setPreferredBastionId(snapshot.preferredBastionId);
    setResults(snapshot.results);
    setResultTabs(snapshot.resultTabs);
    setSearchStartedAt(snapshot.searchStartedAt);
    setActiveLogView(snapshot.activeLogView);
    setActiveViewerTabId(snapshot.activeViewerTabId);
    setDirectoryPath(snapshot.directoryPath);
    setDirectoryInput(snapshot.directoryPath || "/");
    setFilePath(snapshot.filePath);
    setFileMeta(snapshot.fileMeta);
    setSliceOffset(snapshot.sliceOffset);
    setSliceLength(snapshot.sliceLength);
    setSliceLengthMode(snapshot.sliceLengthMode);
    setSliceData(snapshot.sliceData);
    setLineContextState(snapshot.lineContextState);
    setResultContextMode(snapshot.resultContextMode);
    setActiveHighlightIndex(snapshot.activeHighlightIndex);
    setShowFileTools(snapshot.showFileTools);
    setErrorHighlightEnabled(snapshot.errorHighlightEnabled);
    setLiveFollowContent(snapshot.liveFollowContent);
    setLiveFollowPaused(snapshot.liveFollowPaused);
  }, [serverId]);

  useEffect(() => {
    if (!isStandaloneTerminalWindow || !serverId) {
      return;
    }

    setTerminalPanelOpen(true);
  }, [serverId, isStandaloneTerminalWindow]);

  function resetFileReaderState() {
    sliceRequestRef.current += 1;
    readerPreviewRequestRef.current += 1;
    setFileMeta(null);
    setSliceData(null);
    setLineContextState(null);
    setSliceOffset(0);
    setReaderPositionDraft(0);
    setReaderPositionDragging(false);
    setReaderPreviewContent("");
    setReaderPreviewOffset(null);
    setReaderPreviewLoading(false);
    setLiveFollowContent("");
    previewCacheRef.current.clear();
    previewWarmRef.current.clear();
    sliceCacheRef.current.clear();
    sliceWarmRef.current.clear();
  }

  function buildWorkspaceSession(targetServer: ServerSummary): WorkspaceSession {
    return {
      id: `workspace:${targetServer.id}`,
      serverId: targetServer.id,
      serverName: targetServer.name || targetServer.host || targetServer.id,
      serverHost: targetServer.host
    };
  }

  function createDefaultWorkspaceSessionState(nextServerId: string): WorkspaceSessionState {
    const savedDirectory = readLastDirectoryMap()[nextServerId]?.trim() || defaultDirectoryPath;
    return {
      serverId: nextServerId,
      filePath: "",
      directoryPath: savedDirectory,
      keywordInput: "",
      keywordMode: "phrase",
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
      jumpMode: "auto",
      jumpSearchKeyword: "",
      jumpAssetId: "",
      jumpAssetOptions: [],
      results: null,
      resultTabs: [],
      searchStartedAt: null,
      activeLogView: isStandaloneViewerWindow ? "search" : "files",
      activeViewerTabId: "file",
      fileEntries: [],
      fileMeta: null,
      sliceOffset: 0,
      sliceLength: 64 * 1024,
      sliceLengthMode: "auto",
      sliceData: null,
      lineContextState: null,
      resultContextMode: false,
      selectedFilePaths: [],
      resultTabCounter: 1,
      activeHighlightIndex: 0,
      showQueryAdvanced: false,
      showFileTools: false,
      errorHighlightEnabled: false,
      showPathHistory: false,
      showTransferHistory: false,
      terminalPanelOpen: isStandaloneTerminalWindow,
      terminalDetached: false,
      terminalOverlay: "none",
      terminalSessionId: "",
      recordingSession: null,
      liveFollowEnabled: false,
      liveFollowPaused: false,
      liveFollowContent: ""
    };
  }

  function captureCurrentWorkspaceSessionState(nextServerId: string = serverId): WorkspaceSessionState {
    return {
      serverId: nextServerId,
      filePath,
      directoryPath,
      keywordInput,
      keywordMode,
      contextLines,
      useRegex,
      selectedPreset,
      startDate,
      endDate,
      startTime,
      endTime,
      credentialStatus,
      credentialUsername,
      serverRouteConfig,
      connectionTestStatus,
      preferredBastionId,
      jumpMode,
      jumpSearchKeyword,
      jumpAssetId,
      jumpAssetOptions: [...jumpAssetOptions],
      results,
      resultTabs: [...resultTabs],
      searchStartedAt,
      activeLogView,
      activeViewerTabId,
      fileEntries: [...fileEntries],
      fileMeta,
      sliceOffset,
      sliceLength,
      sliceLengthMode,
      sliceData,
      lineContextState,
      resultContextMode,
      selectedFilePaths: [...selectedFilePaths],
      resultTabCounter,
      activeHighlightIndex,
      showQueryAdvanced,
      showFileTools,
      errorHighlightEnabled,
      showPathHistory,
      showTransferHistory,
      terminalPanelOpen,
      terminalDetached,
      terminalOverlay,
      terminalSessionId,
      recordingSession,
      liveFollowEnabled,
      liveFollowPaused,
      liveFollowContent
    };
  }

  function storeWorkspaceSessionState(sessionId: string, nextState: WorkspaceSessionState) {
    workspaceSessionStatesRef.current[sessionId] = nextState;
  }

  function readWorkspaceSessionState(session: WorkspaceSession): WorkspaceSessionState {
    return {
      ...createDefaultWorkspaceSessionState(session.serverId),
      ...workspaceSessionStatesRef.current[session.id]
    };
  }

  function saveCurrentWorkspaceSessionState() {
    if (!activeWorkspaceSessionId || !serverId) {
      return;
    }
    storeWorkspaceSessionState(activeWorkspaceSessionId, captureCurrentWorkspaceSessionState(serverId));
  }

  function applyWorkspaceSessionState(session: WorkspaceSession, nextState: WorkspaceSessionState, options?: { fromCache?: boolean }) {
    restoringWorkspaceStateRef.current = nextState;
    restoringWorkspaceFromCacheRef.current = Boolean(options?.fromCache);
    skipServerSelectionResetRef.current = true;
    skipServerAutoConnectRef.current = Boolean(options?.fromCache);
    setPendingLiveFollowRestore(nextState.liveFollowEnabled ? nextState : null);
    setActiveWorkspaceSessionId(session.id);
    writeLastServerId(session.serverId);
    setServerId(session.serverId);
    setKeywordInput(nextState.keywordInput);
    setKeywordMode(nextState.keywordMode);
    setContextLines(nextState.contextLines);
    setUseRegex(nextState.useRegex);
    setSelectedPreset(nextState.selectedPreset);
    setStartDate(nextState.startDate);
    setEndDate(nextState.endDate);
    setStartTime(nextState.startTime);
    setEndTime(nextState.endTime);
    setCredentialStatus(nextState.credentialStatus);
    setCredentialUsername(nextState.credentialUsername);
    setCredentialPassword("");
    setCredentialPrivateKey("");
    setServerRouteConfig(nextState.serverRouteConfig);
    setConnectionTestStatus(nextState.connectionTestStatus);
    setPreferredBastionId(nextState.preferredBastionId);
    setJumpMode(nextState.jumpMode);
    setJumpSearchKeyword(nextState.jumpSearchKeyword);
    setJumpAssetId(nextState.jumpAssetId);
    setJumpAssetOptions([...nextState.jumpAssetOptions]);
    jumpAssetAutoSearchKeyRef.current = "";
    setResults(nextState.results);
    setResultTabs(nextState.resultTabs);
    setSearchTask(null);
    setSearchStartedAt(nextState.searchStartedAt);
    setActiveLogView(nextState.activeLogView);
    setActiveViewerTabId(nextState.activeViewerTabId);
    setDirectoryPath(nextState.directoryPath);
    setDirectoryInput(nextState.directoryPath || "/");
    setFilePath(nextState.filePath);
    setFileEntries(nextState.fileEntries);
    setFileMeta(nextState.fileMeta);
    setSliceOffset(nextState.sliceOffset);
    setSliceLength(nextState.sliceLength);
    setSliceLengthMode(nextState.sliceLengthMode);
    setSliceData(nextState.sliceData);
    setLineContextState(nextState.lineContextState);
    setResultContextMode(nextState.resultContextMode);
    setSelectedFilePaths(nextState.selectedFilePaths);
    setResultTabCounter(nextState.resultTabCounter);
    setActiveHighlightIndex(nextState.activeHighlightIndex);
    setShowQueryAdvanced(nextState.showQueryAdvanced);
    setShowFileTools(nextState.showFileTools);
    setErrorHighlightEnabled(nextState.errorHighlightEnabled);
    setPathbarMode("browse");
    setBatchMoveDialog(null);
    setShowPathHistory(nextState.showPathHistory);
    setShowTransferHistory(nextState.showTransferHistory);
    setFileLoadingName("");
    setTerminalSessionId(nextState.terminalSessionId);
    setTerminalDetached(nextState.terminalDetached);
    setTerminalPanelOpen(nextState.terminalPanelOpen);
    setTerminalOverlay(nextState.terminalOverlay);
    setRecordingSession(nextState.recordingSession);
    setLiveFollowContent(nextState.liveFollowContent);
    setLiveFollowPaused(nextState.liveFollowPaused);
    setReaderPositionDragging(false);
    setReaderPreviewLoading(false);
    previewCacheRef.current.clear();
    previewWarmRef.current.clear();
    sliceCacheRef.current.clear();
    sliceWarmRef.current.clear();
    window.setTimeout(() => setPreserveTerminalOnInactive(false), 0);
  }

  function startWorkspaceActivation(session: WorkspaceSession, options?: { skipSaveCurrent?: boolean }) {
    if (session.id === activeWorkspaceSessionId && session.serverId === serverId) {
      setActiveWorkspaceSessionId(session.id);
      return;
    }

    if (!options?.skipSaveCurrent) {
      saveCurrentWorkspaceSessionState();
    }

    const hasCachedState = Boolean(workspaceSessionStatesRef.current[session.id]);
    const nextState = readWorkspaceSessionState(session);
    stopLiveFollow({ keepContent: true });

    if (!isStandaloneTerminalWindow && (terminalPanelOpen || terminalDetached)) {
      pendingWorkspaceActivationRef.current = { session, state: nextState, fromCache: hasCachedState };
      setPreserveTerminalOnInactive(Boolean(terminalSessionId.trim()) || terminalDetached);
      setTerminalDetached(false);
      setTerminalPanelOpen(false);
      return;
    }

    applyWorkspaceSessionState(session, nextState, { fromCache: hasCachedState });
  }

  useEffect(() => {
    if (isElectron) {
      document.body.classList.add("is-electron");
    }
  }, [isElectron]);

  useEffect(() => {
    if (!pendingWorkspaceActivationRef.current || terminalPanelOpen || terminalDetached) {
      return;
    }

    const pendingActivation = pendingWorkspaceActivationRef.current;
    pendingWorkspaceActivationRef.current = null;
    applyWorkspaceSessionState(pendingActivation.session, pendingActivation.state, {
      fromCache: pendingActivation.fromCache
    });
  }, [terminalPanelOpen, terminalDetached]);

  useEffect(() => {
    if (!pendingLiveFollowRestore) {
      return;
    }

    if (pendingLiveFollowRestore.serverId !== serverId || pendingLiveFollowRestore.filePath !== filePath) {
      return;
    }

    if (!pendingLiveFollowRestore.liveFollowEnabled || !pendingLiveFollowRestore.filePath.trim()) {
      setPendingLiveFollowRestore(null);
      return;
    }

    const nextFileName = pendingLiveFollowRestore.filePath.split("/").filter(Boolean).pop() || pendingLiveFollowRestore.filePath;
    startLiveFollow(pendingLiveFollowRestore.filePath, nextFileName);
    if (pendingLiveFollowRestore.liveFollowPaused) {
      window.setTimeout(() => setLiveFollowPaused(true), 0);
    }
    setPendingLiveFollowRestore(null);
  }, [pendingLiveFollowRestore, serverId, filePath, startLiveFollow, setLiveFollowPaused]);

  useEffect(() => {
    if (initializedRef.current) {
      return;
    }

    initializedRef.current = true;
    void initializeWorkbench();

    // Fade out and remove the inline loading overlay from index.html
    const splash = document.getElementById("app-loading");
    if (splash) {
      splash.style.opacity = "0";
      setTimeout(() => splash.remove(), 350);
    }
  }, []);

  useEffect(() => {
    const serverIdChanged = serverId !== prevServerIdForResetRef.current;
    const restoringState = restoringWorkspaceStateRef.current;
    const isRestoringWorkspace = Boolean(restoringState && restoringState.serverId === serverId);
    const isRestoringFromCache = isRestoringWorkspace && restoringWorkspaceFromCacheRef.current;
    prevServerIdForResetRef.current = serverId;

    if (!serverId) {
      restoringWorkspaceStateRef.current = null;
      restoringWorkspaceFromCacheRef.current = false;
      if (serverIdChanged) {
        terminalSession.stopTerminal();
        setTerminalSessionId("");
      }
      stopLiveFollow();
      setCredentialStatus(null);
      setCredentialUsername("");
      setCredentialPassword("");
      setCredentialPrivateKey("");
      setServerRouteConfig(null);
      setConnectionTestStatus(null);
      setPreferredBastionId("");
      setJumpMode("auto");
      setJumpSearchKeyword("");
      setJumpAssetId("");
      setJumpAssetOptions([]);
      jumpAssetAutoSearchKeyRef.current = "";
      setDirectoryPath(defaultDirectoryPath);
      setFilePath("");
      setFileEntries([]);
      setResults(null);
      setResultTabs([]);
      setSearchTask(null);
      setSearchStartedAt(null);
      setActiveViewerTabId("file");
      resetFileReaderState();
      return;
    }

    if (!isRestoringFromCache) {
      setConnectionTestStatus(null);
    }

    if (!isRestoringWorkspace) {
      if (serverIdChanged && !isStandaloneTerminalWindow) {
        terminalSession.stopTerminal();
        setTerminalSessionId("");
      }
      stopLiveFollow();
      setCredentialStatus(null);
      setCredentialUsername("");
      setCredentialPassword("");
      setCredentialPrivateKey("");
      setServerRouteConfig(null);
      setPreferredBastionId("");
      setJumpMode("auto");
      setJumpSearchKeyword("");
      setJumpAssetId("");
      setJumpAssetOptions([]);
      jumpAssetAutoSearchKeyRef.current = "";
      if (!pipMode) {
        setDirectoryPath(defaultDirectoryPath);
        setFilePath("");
        setFileEntries([]);
        setResults(null);
        setResultTabs([]);
        setSearchTask(null);
        setSearchStartedAt(null);
        resetFileReaderState();
        setActiveLogView("files");
        setActiveViewerTabId("file");
      }
      setTerminalPanelOpen(isStandaloneTerminalWindow);
    } else {
      restoringWorkspaceStateRef.current = null;
      restoringWorkspaceFromCacheRef.current = false;
    }

    if (!isRestoringFromCache) {
      void fetchCredentialStatus(serverId);
      void fetchServerRoute(serverId);
    }
  }, [serverId, servers, isStandaloneTerminalWindow]);

  useEffect(() => {
    if (skipServerAutoConnectRef.current) {
      skipServerAutoConnectRef.current = false;
      autoConnectServerRef.current = serverId;
      return;
    }

    if (!serverId || autoConnectServerRef.current === serverId) {
      return;
    }

    const targetServer = servers.find((server) => server.id === serverId);
    const savedDirectory = readLastDirectoryMap()[serverId];
    const pipDir = pipMode ? (pipUrlParams.get("directoryPath") || "") : "";
    autoConnectServerRef.current = serverId;
    window.setTimeout(() => {
      void testServerConnection(pipDir || savedDirectory?.trim() || targetServer?.basePath?.trim() || "/", { auto: true });
    }, 120);
  }, [serverId, servers]);

  useEffect(() => {
    if (pathbarMode === "edit") {
      return;
    }
    setDirectoryInput(directoryPath || "/");
  }, [directoryPath, pathbarMode]);

  useEffect(() => {
    if (skipServerSelectionResetRef.current) {
      skipServerSelectionResetRef.current = false;
      return;
    }

    setPathbarMode("browse");
    setBatchMoveDialog(null);
    setSelectedFilePaths([]);
  }, [serverId]);

  useEffect(() => {
    const normalizedKeyword = fileFilter.trim().toLowerCase();
    const visibleEntryPaths = new Set(
      fileEntries
        .filter((entry) => entry.name.toLowerCase().includes(normalizedKeyword))
        .map((entry) => entry.path)
    );
    setSelectedFilePaths((current) => {
      const next = current.filter((path) => visibleEntryPaths.has(path));
      return next.length === current.length ? current : next;
    });
  }, [fileEntries, fileFilter]);

  const currentDirectoryForPathbar = directoryPath || directoryInput || "/";
  const directoryBreadcrumbItems = useMemo(
    () => buildBreadcrumbItems(currentDirectoryForPathbar),
    [currentDirectoryForPathbar]
  );

  // PiP mode: auto-load file after server connection succeeds
  const pipAutoLoadedRef = useRef(false);
  useEffect(() => {
    if (!isStandaloneViewerWindow || pipAutoLoadedRef.current) return;
    const snapshot = standaloneViewerSnapshotRef.current;
    const pipFilePath = snapshot?.filePath?.trim() || pipUrlParams.get("filePath") || "";
    if (snapshot && snapshot.serverId === serverId) {
      if (!snapshot.liveFollowEnabled) {
        pipAutoLoadedRef.current = true;
        return;
      }
      if (!pipFilePath || !connectionTestStatus?.connected) return;
      pipAutoLoadedRef.current = true;

      const pipFileName = pipFilePath.split("/").pop() || pipFilePath;
      startLiveFollow(pipFilePath, pipFileName);
      if (snapshot.liveFollowPaused) {
        window.setTimeout(() => setLiveFollowPaused(true), 0);
      }
      return;
    }
    if (!pipFilePath || !connectionTestStatus?.connected) return;
    pipAutoLoadedRef.current = true;

    const pipWantsLiveFollow = pipUrlParams.get("liveFollow") === "1";
    const pipFileName = pipFilePath.split("/").pop() || pipFilePath;

    void (async () => {
      try {
        const metaPayload = await apiGetLogMeta(serverId, pipFilePath);
        setFileMeta(metaPayload);
        const effectiveLength = computeAutoSliceLength(metaPayload.size);
        setSliceLength(effectiveLength);
        const nextOffset = Math.max(0, metaPayload.size - effectiveLength);
        const slicePayload = await apiGetLogSlice(serverId, pipFilePath, nextOffset, effectiveLength);
        setSliceOffset(slicePayload.actualOffset);
        setSliceData(slicePayload);
        setActiveLogView("search");
        setActiveViewerTabId("file");
        setActionStatus(`已打开 ${pipFileName}。`);

        if (pipWantsLiveFollow) {
          startLiveFollow(pipFilePath, pipFileName);
        }
      } catch (err) {
        setActionStatus(`PiP 自动打开文件失败：${err instanceof Error ? err.message : "未知错误"}`);
      }
    })();
  }, [connectionTestStatus?.connected, serverId, startLiveFollow, setLiveFollowPaused]);

  useEffect(() => () => {
    stopLiveFollow();
  }, []);

  useEffect(() => {
    writeBrowserTreeWidth(browserTreeWidth);
  }, [browserTreeWidth]);

  useEffect(() => {
    writeActivityPanelHeight(activityPanelHeight);
  }, [activityPanelHeight]);

  useEffect(() => {
    if (!contextMenu) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      const menuElement = contextMenuRef.current;
      if (!menuElement) {
        return;
      }
      const target = event.target;
      if (target instanceof Node && menuElement.contains(target)) {
        return;
      }
      setContextMenu(null);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setContextMenu(null);
      }
    };

    window.addEventListener("pointerdown", handlePointerDown, true);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown, true);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [contextMenu]);

  useEffect(() => {
    if (!workspaceTabMenu) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      const menuElement = workspaceTabMenuRef.current;
      if (!menuElement) {
        return;
      }
      const target = event.target;
      if (target instanceof Node && menuElement.contains(target)) {
        return;
      }
      setWorkspaceTabMenu(null);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setWorkspaceTabMenu(null);
      }
    };

    window.addEventListener("pointerdown", handlePointerDown, true);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown, true);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [workspaceTabMenu]);

  useEffect(() => {
    if (!showViewerDebugPanel) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      const panelElement = viewerDebugRef.current;
      if (!panelElement) {
        return;
      }
      const target = event.target;
      if (target instanceof Node && panelElement.contains(target)) {
        return;
      }
      setShowViewerDebugPanel(false);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setShowViewerDebugPanel(false);
      }
    };

    window.addEventListener("pointerdown", handlePointerDown, true);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown, true);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [showViewerDebugPanel]);


  useEffect(() => {
    if (!searchStartedAt) {
      return;
    }

    const timer = window.setInterval(() => {
      setSearchNow(Date.now());
    }, SEARCH_TIMER_INTERVAL_MS);

    return () => window.clearInterval(timer);
  }, [searchStartedAt]);

  useEffect(() => {
    if (localServiceState !== "offline") {
      backgroundHealthCheckInFlightRef.current = false;
      return;
    }

    const timer = window.setInterval(() => {
      if (backgroundHealthCheckInFlightRef.current) {
        return;
      }

      backgroundHealthCheckInFlightRef.current = true;
      void (async () => {
        try {
          const ok = await checkLocalServiceHealth({ silentFailure: true, background: true });
          if (ok) {
            await fetchServers();
            await fetchFinalShellSettings();
          }
        } finally {
          backgroundHealthCheckInFlightRef.current = false;
        }
      })();
    }, LOCAL_SERVICE_RETRY_INTERVAL_MS);

    return () => {
      backgroundHealthCheckInFlightRef.current = false;
      window.clearInterval(timer);
    };
  }, [localServiceState]);

  async function initializeWorkbench() {
    const serviceReady = await checkLocalServiceHealth();
    if (!serviceReady) {
      return;
    }

    await fetchServers();
    await fetchFinalShellSettings();
  }

  async function checkLocalServiceHealth(options?: { silentFailure?: boolean; background?: boolean }) {
    if (!options?.background) {
      setLocalServiceState("checking");
      setLocalServiceStatusText("正在检查本地连接服务...");
    }

    try {
      await apiHealthCheck();
      setLocalServiceState("online");
      setLocalServiceStatusText("本地连接服务已启动");
      return true;
    } catch (error) {
      const detail = error instanceof Error ? error.message : "未知错误";
      setLocalServiceState("offline");
      setLocalServiceStatusText(isElectron ? "正在等待内置连接服务启动..." : "本地连接服务未启动");
      if (!options?.silentFailure) {
        setActionStatus(isElectron ? "正在等待内置连接服务启动..." : "本地连接服务未启动，请先启动本地服务。");
        pushActivity(`本地连接服务不可用：${detail}`);
      }
      return false;
    }
  }

  useEffect(() => {
    return () => {
      stopLiveFollow();
      if (readerDraftFrameRef.current !== null) {
        window.cancelAnimationFrame(readerDraftFrameRef.current);
      }
    };
  }, []);

  useEffect(() => {
    function onPointerMove(event: PointerEvent) {
      const resizeState = treeResizeRef.current;
      if (!resizeState) {
        return;
      }

      const delta = event.clientX - resizeState.startX;
      setBrowserTreeWidth(clampBrowserTreeWidth(resizeState.startWidth + delta));
    }

    function stopResize() {
      treeResizeRef.current = null;
      document.body.classList.remove("is-resizing-tree");
    }

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", stopResize);
    window.addEventListener("pointercancel", stopResize);

    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", stopResize);
      window.removeEventListener("pointercancel", stopResize);
    };
  }, []);

  useEffect(() => {
    function onPointerMove(event: PointerEvent) {
      const resizeState = activityPanelResizeRef.current;
      if (!resizeState) {
        return;
      }

      const delta = resizeState.startY - event.clientY;
      setActivityPanelHeight(clampActivityPanelHeight(resizeState.startHeight + delta));
    }

    function stopResize() {
      activityPanelResizeRef.current = null;
      document.body.classList.remove("is-resizing-activity-panel");
    }

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", stopResize);
    window.addEventListener("pointercancel", stopResize);

    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", stopResize);
      window.removeEventListener("pointercancel", stopResize);
    };
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const lowered = event.key.toLowerCase();
      const target = event.target as HTMLElement | null;
      const isTypingTarget =
        target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target?.isContentEditable;

      if ((event.metaKey || event.ctrlKey) && lowered === "f") {
        event.preventDefault();
        setShowKeywordBar(true);
        window.setTimeout(() => keywordInputRef.current?.focus(), 0);
        return;
      }

      if ((event.metaKey || event.ctrlKey) && lowered === "l") {
        event.preventDefault();
        enterPathbarEditMode({ selectAll: true });
        return;
      }

      if (event.key === "Escape") {
        setShowQueryAdvanced(false);
        setShowKeywordBar(true);
        return;
      }

      if (!isTypingTarget && event.key === "/" && activeLogView === "search") {
        event.preventDefault();
        setShowKeywordBar(true);
        window.setTimeout(() => {
          if (keywordInput.trim()) {
            keywordInputRef.current?.focus();
            keywordInputRef.current?.select();
            return;
          }

          setKeywordInput("/");
          keywordInputRef.current?.focus();
          window.setTimeout(() => {
            keywordInputRef.current?.setSelectionRange(1, 1);
          }, 0);
        }, 0);
        return;
      }

      if (isTypingTarget || !filePath.trim()) {
        return;
      }

      if ((event.metaKey || event.ctrlKey) && event.key === "Home") {
        event.preventDefault();
        void loadHeadSlice();
        return;
      }

      if ((event.metaKey || event.ctrlKey) && event.key === "End") {
        event.preventDefault();
        void loadTailSlice();
        return;
      }

      if (event.key === "PageUp") {
        event.preventDefault();
        if (activeViewerTabId !== "file") {
          setActiveLogView("search");
          setActiveViewerTabId("file");
        }
        void navigateSlice("prev", "keyboard");
        return;
      }

      if (event.key === "PageDown") {
        event.preventDefault();
        if (activeViewerTabId !== "file") {
          setActiveLogView("search");
          setActiveViewerTabId("file");
        }
        void navigateSlice("next", "keyboard");
        return;
      }

      if (activeLogView === "search" && lowered === "n" && normalizeSearchInput(keywordInput)) {
        event.preventDefault();
        focusHighlight(event.shiftKey ? "prev" : "next");
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activeLogView, activeViewerTabId, directoryInput, directoryPath, filePath, keywordInput, sliceData?.nextOffset, sliceLength, sliceOffset, serverId]);

  useEffect(() => {
    if (!sliceData) return;
    const anchor = sliceScrollAnchorRef.current;
    sliceScrollAnchorRef.current = null;
    if (!anchor) {
      wheelSliceLockRef.current = false;
      return;
    }
    requestAnimationFrame(() => {
      if (anchor === "top") {
        virtualViewerRef.current?.scrollToTop();
      } else if (anchor === "bottom") {
        virtualViewerRef.current?.scrollToBottom();
      }
      wheelSliceLockRef.current = false;
    });
  }, [sliceData]);

  useEffect(() => {
    if (!liveFollowEnabled || liveFollowPaused) return;
    requestAnimationFrame(() => {
      virtualViewerRef.current?.scrollToBottom();
    });
  }, [liveFollowContent, liveFollowEnabled, liveFollowPaused]);


  useEffect(() => {
    setActiveHighlightIndex(0);
  }, [activeViewerTabId, resultTabs, sliceData?.content, results?.rawOutput, keywordInput, useRegex]);

  // VirtualLogViewer handles scrollToHighlight internally via activeHighlightIndex prop

  async function fetchServers(): Promise<ServerSummary[]> {
    try {
      const data = await apiGetServers();
      setLocalServiceState("online");
      setLocalServiceStatusText("本地连接服务已启动");
      setServers(data);
      setActionStatus(data.length ? `已载入 ${data.length} 台服务器，请在左侧选择一台。` : "当前还没有服务器，请导入 FinalShell 或手动新增。");
      pushActivity(data.length ? `已读取本地服务器清单，共 ${data.length} 台。` : "当前没有服务器，请先导入 FinalShell 或手动维护服务器。");
      return data;
    } catch (error) {
      const detail = error instanceof Error ? error.message : "未知错误";
      setLocalServiceState("offline");
      setLocalServiceStatusText("本地连接服务未启动");
      setActionStatus(`本地连接服务不可用：${detail}`);
      pushActivity(`读取本地服务器清单失败：${detail}`);
      return [];
    }
  }

  function selectServerById(nextServerId: string) {
    if (nextServerId && nextServerId !== serverId && isWorkspaceSwitchLocked) {
      setActionStatus("当前检索或连接操作尚未完成，请稍后再切换工作区。");
      return false;
    }

    if (!nextServerId) {
      setActiveWorkspaceSessionId(null);
      writeLastServerId("");
      setServerId("");
      return true;
    }

    const existingSession = workspaceSessions.find((session) => session.serverId === nextServerId);
    const targetServer = servers.find((server) => server.id === nextServerId);
    const nextSession = existingSession ?? (targetServer ? buildWorkspaceSession(targetServer) : null);

    if (!nextSession) {
      writeLastServerId(nextServerId);
      setServerId(nextServerId);
      return true;
    }

    if (!existingSession) {
      setWorkspaceSessions((current) => current.some((session) => session.id === nextSession.id) ? current : [...current, nextSession]);
    }

    startWorkspaceActivation(nextSession);
    return true;
  }

  function activateWorkspaceSession(session: WorkspaceSession) {
    startWorkspaceActivation(session);
  }

  function closeWorkspaceSession(sessionId: string) {
    if (isWorkspaceSwitchLocked) {
      setActionStatus("当前检索或连接操作尚未完成，请稍后再关闭工作区。");
      return;
    }

    const currentIndex = workspaceSessions.findIndex((session) => session.id === sessionId);
    if (currentIndex === -1) {
      return;
    }

    const nextSessions = workspaceSessions.filter((session) => session.id !== sessionId);
    setWorkspaceSessions(nextSessions);
    delete workspaceSessionStatesRef.current[sessionId];

    if (activeWorkspaceSessionId !== sessionId) {
      return;
    }

    const fallbackSession = nextSessions[Math.min(currentIndex, nextSessions.length - 1)] ?? null;
    if (!fallbackSession) {
      pendingWorkspaceActivationRef.current = null;
      restoringWorkspaceStateRef.current = null;
      restoringWorkspaceFromCacheRef.current = false;
      setPendingLiveFollowRestore(null);
      setPreserveTerminalOnInactive(false);
      setActiveWorkspaceSessionId(null);
      writeLastServerId("");
      setServerId("");
      return;
    }

    startWorkspaceActivation(fallbackSession, { skipSaveCurrent: true });
  }

  function startCreateManualServer() {
    setManualServerDraft(createManualServerDraft());
    openSettingsWorkspace("inventory");
  }

  function startEditManualServer(server: ServerSummary) {
    setManualServerDraft(createManualServerDraft(server));
    selectServerById(server.id);
    openSettingsWorkspace("inventory");
  }

  async function saveManualServer() {
    const name = manualServerDraft.name.trim();
    const host = manualServerDraft.host.trim();
    const portValue = manualServerDraft.port.trim();
    const port = Number(portValue || "22");

    if (!name || !host) {
      setActionStatus("请先填写服务器名称和主机地址。");
      openSettingsWorkspace("inventory");
      return;
    }

    if (!Number.isInteger(port) || port <= 0 || port > 65535) {
      setActionStatus("端口必须是 1-65535 之间的整数。");
      openSettingsWorkspace("inventory");
      return;
    }

    await withBusy("正在保存手动服务器...", async () => {
      const payload = await apiUpsertManualServer({
        id: manualServerDraft.id || undefined,
        name,
        host,
        port,
        username: manualServerDraft.username.trim() || undefined,
        basePath: manualServerDraft.basePath.trim() || "/",
        profile: manualServerDraft.profile,
        connectionKind: manualServerDraft.connectionKind,
        tags: parseManualServerTags(manualServerDraft.tagsText),
        credential: manualServerDraft.password || manualServerDraft.privateKey
          ? {
              username: manualServerDraft.username.trim() || undefined,
              password: manualServerDraft.password || undefined,
              privateKey: manualServerDraft.privateKey || undefined
            }
          : undefined
      });
      const refreshedServers = await fetchServers();
      const savedServer = refreshedServers.find((server) => server.id === payload.server.id) || payload.server;
      selectServerById(savedServer.id);
      setManualServerDraft(createManualServerDraft(savedServer));
      setSettingsWorkspaceView(savedServer.connectionKind === "bastion-target" ? "server" : "inventory");
      setActionStatus(`已保存服务器：${savedServer.name}`);
      pushActivity(`已保存手动服务器：${savedServer.name}（${savedServer.host}:${savedServer.port}）`);
      showToast("success", `已保存 ${savedServer.name}`);
    });
  }

  async function deleteServerRecord(targetServer: ServerSummary) {
    await withBusy(`正在删除服务器 ${targetServer.name}...`, async () => {
      await apiDeleteServer(targetServer.id);
      const refreshedServers = await fetchServers();
      if (serverId === targetServer.id) {
        const fallbackServerId = refreshedServers[0]?.id || "";
        selectServerById(fallbackServerId);
      }
      setManualServerDraft((current) => current.id === targetServer.id ? createManualServerDraft() : current);
      setSettingsWorkspaceView(refreshedServers.length ? "inventory" : "overview");
      setActionStatus(`已删除服务器：${targetServer.name}`);
      pushActivity(`已删除服务器：${targetServer.name}（${targetServer.host}:${targetServer.port}）`);
      showToast("success", `已删除 ${targetServer.name}`);
    });
  }

  function requestDeleteServer(targetServer: ServerSummary) {
    setConfirmDialog({
      title: "删除服务器",
      message: `确定删除服务器“${targetServer.name}”？\n${targetServer.username}@${targetServer.host}:${targetServer.port}`,
      danger: true,
      onConfirm: () => {
        void deleteServerRecord(targetServer);
      }
    });
  }

  async function fetchDirectoryListing(targetDirectoryPath: string) {
    const isBastionSftp = selectedServer?.connectionKind === "bastion" && looksLikeJumpServer(selectedServer);
    return apiGetDirectoryListing(
      isBastionSftp
        ? { bastionId: serverId, directoryPath: targetDirectoryPath }
        : { serverId, directoryPath: targetDirectoryPath }
    );
  }

  async function fetchLogMeta(targetFilePath: string) {
    return apiGetLogMeta(serverId, targetFilePath);
  }

  async function fetchLogSlice(targetFilePath: string, targetOffset: number, targetLength: number) {
    return apiGetLogSlice(serverId, targetFilePath, targetOffset, targetLength);
  }

  async function fetchLineContext(targetFilePath: string, lineNumber: number, context = 12) {
    return apiGetLineContext(serverId, targetFilePath, lineNumber, context);
  }

  function cacheSlicePayload(payload: LogSliceResponse, requestedOffset: number, targetLength: number) {
    const requestedKey = getSliceCacheKey(payload.filePath, requestedOffset, targetLength);
    const actualKey = getSliceCacheKey(payload.filePath, payload.actualOffset, targetLength);
    setLimitedMapEntry(sliceCacheRef.current, requestedKey, payload, MAX_SLICE_CACHE_ENTRIES);
    setLimitedMapEntry(sliceCacheRef.current, actualKey, payload, MAX_SLICE_CACHE_ENTRIES);

    const previewContent = formatPreviewSnippet(payload.content) || "这一段没有完整日志行。";
    const requestedPreviewKey = getPreviewCacheKey(payload.filePath, requestedOffset);
    const actualPreviewKey = getPreviewCacheKey(payload.filePath, payload.actualOffset);
    setLimitedMapEntry(previewCacheRef.current, requestedPreviewKey, {
      offset: payload.actualOffset,
      content: previewContent
    }, MAX_PREVIEW_CACHE_ENTRIES);
    setLimitedMapEntry(previewCacheRef.current, actualPreviewKey, {
      offset: payload.actualOffset,
      content: previewContent
    }, MAX_PREVIEW_CACHE_ENTRIES);
  }

  function getCachedSlice(targetFilePath: string, targetOffset: number, targetLength: number) {
    return sliceCacheRef.current.get(getSliceCacheKey(targetFilePath, targetOffset, targetLength)) ?? null;
  }

  async function warmSlice(targetFilePath: string, targetOffset: number, targetLength: number) {
    const cacheKey = getSliceCacheKey(targetFilePath, targetOffset, targetLength);
    if (sliceCacheRef.current.has(cacheKey) || sliceWarmRef.current.has(cacheKey)) {
      return sliceCacheRef.current.get(cacheKey) ?? null;
    }

    sliceWarmRef.current.add(cacheKey);
    try {
      const payload = await fetchLogSlice(targetFilePath, targetOffset, targetLength);
      cacheSlicePayload(payload, targetOffset, targetLength);
      return payload;
    } finally {
      sliceWarmRef.current.delete(cacheKey);
    }
  }

  function warmNeighborSlices(targetFilePath: string, payload: LogSliceResponse, targetLength: number) {
    const nextOffsets: number[] = [];

    if (!payload.isStart) {
      nextOffsets.push(Math.max(0, payload.actualOffset - targetLength));
    }
    if (!payload.isEnd) {
      nextOffsets.push(payload.nextOffset);
    }

    nextOffsets.forEach((offset) => {
      void warmSlice(targetFilePath, offset, targetLength);
    });
  }

  async function fetchFinalShellSettings() {
    try {
      const payload = await apiGetFinalShellSettings();
      setFinalShellPath(payload.configuredPath || "");
      setFinalShellDetectedPaths(payload.searchedPaths || []);
      setFinalShellLastImportedAt(payload.lastImportedAt || "");
      setImportPath(
        payload.resolvedPath
          ? `当前识别目录：${payload.resolvedPath}`
          : `尚未识别到 FinalShell 目录，已检测：${payload.searchedPaths.join(" | ")}`
      );
    } catch (error) {
      const detail = error instanceof Error ? error.message : "未知错误";
      setLocalServiceState("offline");
      setLocalServiceStatusText("本地连接服务未启动");
      pushActivity(`读取 FinalShell 配置失败：${detail}`);
    }
  }

  async function saveFinalShellPath() {
    await withBusy("正在保存 FinalShell 目录...", async () => {
      const payload = await apiSaveFinalShellPath(finalShellPath.trim());
      setFinalShellPath(payload.configuredPath || "");
      setFinalShellDetectedPaths(payload.searchedPaths || []);
      setFinalShellLastImportedAt(payload.lastImportedAt || "");
      setImportPath(
        payload.resolvedPath
          ? `当前识别目录：${payload.resolvedPath}`
          : `尚未识别到 FinalShell 目录，已检测：${payload.searchedPaths.join(" | ")}`
      );
      setActionStatus("FinalShell 目录已保存。");
      pushActivity(`FinalShell 目录已保存：${payload.configuredPath || "已清空，将回退自动检测"}`);
    });
  }

  async function fetchCredentialStatus(targetServerId: string) {
    try {
      const payload = await apiGetCredentialStatus(targetServerId);
      if (serverIdRef.current !== targetServerId) {
        return;
      }
      setCredentialStatus(payload);
      setCredentialUsername(payload.username || "");
      setCredentialPassword("");
      setCredentialPrivateKey("");
    } catch (error) {
      if (serverIdRef.current !== targetServerId) {
        return;
      }
      const detail = error instanceof Error ? error.message : "未知错误";
      setCredentialStatus(null);
      pushActivity(`读取连接凭证状态失败：${detail}`);
    }
  }

  async function fetchServerRoute(targetServerId: string) {
    try {
      const payload = await apiGetServerRoute(targetServerId);
      if (serverIdRef.current !== targetServerId) {
        return;
      }
      setServerRouteConfig(payload);
      setPreferredBastionId(payload.preferredBastionId || "");
      setJumpMode(payload.jumpMode || "auto");
      setJumpSearchKeyword(payload.jumpSearchKeyword || "");
      setJumpAssetId(payload.jumpAssetId || "");
      setJumpAssetOptions([]);
      jumpAssetAutoSearchKeyRef.current = "";
    } catch (error) {
      if (serverIdRef.current !== targetServerId) {
        return;
      }
      setServerRouteConfig(null);
      setPreferredBastionId("");
      setJumpMode("auto");
      setJumpSearchKeyword("");
      setJumpAssetId("");
      setJumpAssetOptions([]);
      jumpAssetAutoSearchKeyRef.current = "";
      pushActivity(`读取二跳配置失败：${error instanceof Error ? error.message : "未知错误"}`);
    }
  }

  async function saveCredentialForServer() {
    if (!serverId) {
      return;
    }

    await withBusy("正在保存连接凭证...", async () => {
      const payload = await apiSaveCredential(serverId, {
        username: credentialUsername.trim() || undefined,
        password: credentialPassword || undefined,
        privateKey: credentialPrivateKey || undefined
      });
      setCredentialStatus(payload);
      setCredentialPassword("");
      setCredentialPrivateKey("");
      setActionStatus(`连接凭证已保存：${payload.serverName}`);
      pushActivity(`已保存连接凭证：${payload.serverName}，后续刷新页面仍会保留。`);
      await fetchServers();
    });
  }

  async function saveServerRouteForServer() {
    if (!serverId) {
      return;
    }

    await withBusy("正在保存二跳设置...", async () => {
      const payload = await apiSaveServerRoute(serverId, {
        preferredBastionId: preferredBastionId || undefined,
        jumpMode,
        jumpSearchKeyword: jumpSearchKeyword.trim() || undefined,
        jumpAssetId: jumpAssetId.trim() || undefined
      });
      setServerRouteConfig(payload);
      setPreferredBastionId(payload.preferredBastionId || "");
      setJumpMode(payload.jumpMode || "auto");
      setJumpSearchKeyword(payload.jumpSearchKeyword || "");
      setJumpAssetId(payload.jumpAssetId || "");
      setJumpAssetOptions([]);
      jumpAssetAutoSearchKeyRef.current = "";
      await fetchServers();
      setActionStatus("二跳设置已保存。");
      pushActivity(`已保存二跳设置：${selectedServer?.name || serverId}`);
      await testServerConnection(directoryPath.trim() || selectedServer?.basePath?.trim() || "/");
    });
  }

  async function searchJumpServerAssets() {
    if (!serverId) {
      return;
    }

    const keyword =
      jumpSearchKeyword.trim() ||
      (selectedServer?.connectionKind === "bastion" ? "" : selectedServer?.host || "");

    if (!keyword) {
      setActionStatus("先输入 JumpServer 搜索关键字，再读取资产列表。");
      return;
    }

    await withBusy("正在读取 JumpServer 资产列表...", async () => {
      const payload = await apiSearchJumpServerAssets(
        serverId,
        preferredBastionId || (selectedServer?.connectionKind === "bastion" ? selectedServer.id : undefined),
        keyword
      );
      setJumpAssetOptions(payload.assets || []);
      if (payload.assets.length === 1) {
        setJumpAssetId(payload.assets[0].id);
        setActionStatus(`已唯一命中 JumpServer 资产：${payload.assets[0].name}`);
        pushActivity(`JumpServer 资产唯一命中：${payload.assets[0].id} / ${payload.assets[0].name}`);
        return;
      }
      setActionStatus(payload.assets.length ? `已读取 ${payload.assets.length} 条 JumpServer 资产。` : "没有检索到可用资产。");
      pushActivity(
        payload.assets.length
          ? `JumpServer 资产已读取：${payload.assets.length} 条，关键字 ${payload.keyword}`
          : `JumpServer 资产为空：${payload.keyword}`
      );
    });
  }

  async function testServerConnection(targetDirectoryPath?: string, options?: { auto?: boolean }) {
    if (!serverId) {
      return;
    }

    const requestServerId = serverId;
    const autoMode = Boolean(options?.auto);
    setIsBusy(true);
    setActionStatus(autoMode ? "正在自动连接服务器..." : "正在测试服务器连接...");

    try {
      const payload = await apiTestConnection(requestServerId, targetDirectoryPath || directoryPath.trim() || "/");
      if (serverIdRef.current !== requestServerId) {
        return;
      }
      setConnectionTestStatus(payload);
      const connectionMessage =
        !payload.connected && ((availableBastions.length && selectedServer?.connectionKind !== "bastion") || looksLikeJumpServer(selectedServer))
          ? `${payload.message} 可在连接设置里切换跳转入口后重试。`
          : payload.message;
      setActionStatus(connectionMessage);

      if (!autoMode || payload.connected) {
        pushActivity(
          payload.connected
            ? `${payload.message}${payload.sampleEntries.length ? `，示例：${payload.sampleEntries.join(", ")}` : ""}`
            : `连接测试失败：${connectionMessage}`
        );
      }

      if (!payload.connected && ((availableBastions.length && selectedServer?.connectionKind !== "bastion") || looksLikeJumpServer(selectedServer))) {
        openSettingsWorkspace("server");
      }

      if (payload.connected && selectedServer?.connectionKind === "bastion" && looksLikeJumpServer(selectedServer)) {
        try {
          pushActivity("已连接 JumpServer 入口，可在终端中继续检索资产并进入目标机。");
          const directoryPayload = await fetchDirectoryListing("/");
          if (serverIdRef.current !== requestServerId) {
            return;
          }
          setDirectoryPath(directoryPayload.directoryPath);
          setDirectoryInput(directoryPayload.directoryPath);
          setFileEntries(directoryPayload.entries);
          pushActivity(`已通过 SFTP 读取堡垒机目录，共 ${directoryPayload.entries.length} 项。`);
        } catch (sftpError) {
          const sftpDetail = sftpError instanceof Error ? sftpError.message : "未知错误";
          setActionStatus(`堡垒机 SFTP 目录读取失败：${sftpDetail}`);
          pushActivity(`堡垒机 SFTP 目录读取失败：${sftpDetail}`);
        }
      } else if (payload.connected && payload.directoryReadable) {
        const directoryPayload = await fetchDirectoryListing(payload.directoryPath);
        if (serverIdRef.current !== requestServerId) {
          return;
        }
        setDirectoryPath(directoryPayload.directoryPath);
        setFileEntries(directoryPayload.entries);
        rememberDirectoryIfUseful(requestServerId, directoryPayload.directoryPath, directoryPayload.entries.length);
        pushActivity(`连接测试后已读取目录：${directoryPayload.directoryPath}，共 ${directoryPayload.entries.length} 项。`);
      }
    } catch (error) {
      if (serverIdRef.current !== requestServerId) {
        return;
      }
      const detail = error instanceof Error ? error.message : "未知错误";

      setConnectionTestStatus({
        serverId: requestServerId,
        serverName: selectedServer?.name || requestServerId,
        host: selectedServer?.host || "",
        username: selectedServer?.username || "",
        connected: false,
        directoryPath: targetDirectoryPath || directoryPath.trim() || "/",
        directoryReadable: false,
        sampleEntries: [],
        message: detail
      });
      setActionStatus(autoMode ? `自动连接未完成：${detail}` : `连接失败：${detail}`);

      if (!autoMode) {
        pushActivity(`连接失败：${detail}`);
      }

      if ((availableBastions.length && selectedServer?.connectionKind !== "bastion") || looksLikeJumpServer(selectedServer)) {
        openSettingsWorkspace("server");
      }
    } finally {
      setIsBusy(false);
    }
  }

  function toggleFileSort(nextKey: "name" | "size" | "kind" | "modifiedTime") {
    if (fileSortKey === nextKey) {
      setFileSortDirection((current) => (current === "asc" ? "desc" : "asc"));
      return;
    }

    setFileSortKey(nextKey);
    setFileSortDirection(nextKey === "modifiedTime" ? "desc" : "asc");
  }

  function renderSortLabel(key: "name" | "size" | "kind" | "modifiedTime", label: string) {
    const active = fileSortKey === key;
    const arrow = active ? (fileSortDirection === "asc" ? "↑" : "↓") : "";
    return <>{label}<span style={{ display: "inline-block", width: "1em", textAlign: "center" }}>{arrow}</span></>;
  }

  function openSettingsWorkspace(view?: SettingsWorkspaceView) {
    setSettingsWorkspaceView(view || (selectedServer ? "server" : "overview"));
    setShowConnectionSettings(true);
  }

  function closeSettingsWorkspace() {
    setShowConnectionSettings(false);
  }

  useEffect(() => {
    if (!showConnectionSettings || isStandalonePipWindow) {
      return;
    }

    function handleSettingsWorkspaceKeydown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        closeSettingsWorkspace();
      }
    }

    window.addEventListener("keydown", handleSettingsWorkspaceKeydown);
    return () => window.removeEventListener("keydown", handleSettingsWorkspaceKeydown);
  }, [showConnectionSettings, isStandalonePipWindow]);

  function pushActivity(message: string) {
    const timestamp = new Date().toLocaleTimeString("zh-CN", { hour12: false });
    setActivityLines((current) => [...current.slice(-79), `[${timestamp}] ${message}`]);
  }

  const selectedServer = useMemo(
    () => servers.find((server) => server.id === serverId) ?? null,
    [servers, serverId]
  );
  const currentServerTransferHistory = useMemo(
    () => (serverId ? transferHistory.filter((entry) => entry.serverId === serverId) : []),
    [transferHistory, serverId]
  );

  useEffect(() => {
    const availableServerIds = new Set(servers.map((server) => server.id));
    Object.keys(workspaceSessionStatesRef.current).forEach((sessionId) => {
      const sessionState = workspaceSessionStatesRef.current[sessionId];
      if (sessionState && !availableServerIds.has(sessionState.serverId)) delete workspaceSessionStatesRef.current[sessionId];
    });
    setWorkspaceSessions((current) => current.filter((session) => availableServerIds.has(session.serverId)));
  }, [servers]);

  useEffect(() => {
    if (!selectedServer) {
      if (!serverId) {
        setActiveWorkspaceSessionId(null);
      }
      return;
    }

    const nextSession = buildWorkspaceSession(selectedServer);
    const nextSessionId = nextSession.id;
    setWorkspaceSessions((current) => {
      const existingIndex = current.findIndex((session) => session.id === nextSessionId);
      if (existingIndex === -1) {
        return [...current, nextSession];
      }

      const existing = current[existingIndex];
      if (existing.serverName === nextSession.serverName && existing.serverHost === nextSession.serverHost) {
        return current;
      }

      const next = [...current];
      next[existingIndex] = nextSession;
      return next;
    });
    setActiveWorkspaceSessionId(nextSessionId);
  }, [selectedServer?.host, selectedServer?.id, selectedServer?.name, serverId]);

  function appendTransferHistory(
    entry: Omit<TransferHistoryEntry, "id" | "serverId" | "serverLabel" | "createdAt">
  ) {
    if (!serverId) {
      return;
    }

    const nextEntry: TransferHistoryEntry = {
      ...entry,
      id: globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      serverId,
      serverLabel: selectedServer?.name || selectedServer?.host || serverId,
      createdAt: new Date().toISOString(),
    };
    pushTransferHistory(nextEntry);
    setTransferHistory(readTransferHistory());
  }

  function handleClearTransferHistory() {
    const count = serverId ? transferHistory.filter((entry) => entry.serverId === serverId).length : 0;
    clearTransferHistory(serverId || undefined);
    setTransferHistory(readTransferHistory());
    if (count > 0) {
      const serverLabel = selectedServer?.name || selectedServer?.host || serverId || "当前服务器";
      setActionStatus(`已清空 ${serverLabel} 的传输记录`);
      pushActivity(`已清空传输记录：${serverLabel}（${count} 条）`);
      showToast("success", `已清空 ${count} 条传输记录`);
    }
  }

  function requestClearTransferHistory() {
    if (!currentServerTransferHistory.length) {
      return;
    }
    setConfirmDialog({
      title: "清空传输记录",
      message: `确定清空当前服务器的 ${currentServerTransferHistory.length} 条传输记录？`,
      danger: true,
      onConfirm: () => handleClearTransferHistory(),
    });
  }

  function handleBrowseTransferHistoryPath(path: string) {
    setShowTransferHistory(false);
    void browseLogFiles(path, { manual: true });
  }

  async function handleCopyTransferHistoryValue(value: string, label: string) {
    try {
      await copyText(value);
      setActionStatus(`已复制${label}`);
      showToast("success", `已复制${label}`);
    } catch (error) {
      const detail = error instanceof Error ? error.message : "未知错误";
      setActionStatus(`复制${label}失败：${detail}`);
      showToast("error", `复制${label}失败：${detail}`);
    }
  }

  async function handleRevealTransferHistoryLocalPath(targetPath: string) {
    try {
      const api = (window as any).electronAPI;
      if (!api?.revealLocalPath) {
        throw new Error("当前环境不支持定位本地文件");
      }
      const result = await api.revealLocalPath(targetPath);
      if (!result?.ok) {
        throw new Error(result?.message || "无法定位本地文件");
      }
      const fileName = targetPath.split(/[/\\]/).pop() || targetPath;
      setActionStatus(`已在 Finder 中显示 ${fileName}`);
      pushActivity(`已定位本地文件：${targetPath}`);
      showToast("success", `已在 Finder 中显示 ${fileName}`);
    } catch (error) {
      const detail = error instanceof Error ? error.message : "未知错误";
      setActionStatus(`定位本地文件失败：${detail}`);
      showToast("error", `定位本地文件失败：${detail}`);
    }
  }

  function handlePreferredBastionChange(nextBastionId: string) {
    setPreferredBastionId(nextBastionId);
    setJumpAssetOptions([]);
    setJumpAssetId("");
    jumpAssetAutoSearchKeyRef.current = "";
  }

  const manualServers = useMemo(
    () => servers.filter((server) => server.source === "manual"),
    [servers]
  );
  const importedServers = useMemo(
    () => servers.filter((server) => server.source === "finalshell" || server.source === "xshell"),
    [servers]
  );
  const canSaveManualServer = useMemo(
    () => Boolean(manualServerDraft.name.trim() && manualServerDraft.host.trim()),
    [manualServerDraft.host, manualServerDraft.name]
  );
  const currentConnectionDirectory = useMemo(
    () => directoryPath.trim() || selectedServer?.basePath?.trim() || "/",
    [directoryPath, selectedServer]
  );

  const availableBastions = useMemo(
    () => servers.filter((server) => server.connectionKind === "bastion"),
    [servers]
  );
  const selectedBastion = useMemo(
    () => availableBastions.find((server) => server.id === preferredBastionId) ?? null,
    [availableBastions, preferredBastionId]
  );
  const jumpServerBastions = useMemo(
    () => availableBastions.filter((server) => looksLikeJumpServer(server)),
    [availableBastions]
  );
  const showJumpServerRouteFields = useMemo(
    () => looksLikeJumpServer(selectedServer) || looksLikeJumpServer(selectedBastion) || (!preferredBastionId && jumpServerBastions.length > 0),
    [jumpServerBastions.length, preferredBastionId, selectedBastion, selectedServer]
  );

  const resolvedFileDirectoryPath = useMemo(
    () => (filePath ? getParentDirectoryPath(filePath) : ""),
    [filePath]
  );
  const terminalWorkingDirectory = useMemo(() => {
    const nextPath = activeLogView === "search" && filePath
      ? resolvedFileDirectoryPath
      : directoryPath;
    const normalized = nextPath.trim();
    return normalized || undefined;
  }, [activeLogView, directoryPath, filePath, resolvedFileDirectoryPath]);

  const [termSelMenu, setTermSelMenu] = useState<{ x: number; y: number; text: string } | null>(null);
  const [viewerSelMenu, setViewerSelMenu] = useState<{ x: number; y: number; text: string } | null>(null);

  const terminalSession = useTerminalSession({
    active: isStandaloneTerminalWindow || (terminalPanelOpen && !terminalDetached),
    localServiceBase,
    serverId,
    preferredBastionId,
    sessionId: terminalSessionId,
    selectedServer,
    isBusy,
    cwd: terminalWorkingDirectory,
    onStatus: setActionStatus,
    onActivity: pushActivity,
    onSessionIdChange: setTerminalSessionId,
    preserveSessionOnInactive: terminalDetached || preserveTerminalOnInactive,
    preserveSessionOnDispose: isStandaloneTerminalWindow,
    onSelectionMenu: setTermSelMenu,
  });

  function createTerminalSessionId(targetServerId: string) {
    return `terminal-${targetServerId}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }

  function ensureTerminalSessionId() {
    const existing = terminalSessionId.trim();
    if (existing) {
      return existing;
    }

    const next = createTerminalSessionId(serverId || "server");
    setTerminalSessionId(next);
    return next;
  }

  function openTerminalView(options?: { auto?: boolean }) {
    const nextSessionId = ensureTerminalSessionId();
    setTerminalDetached(false);
    setTerminalPanelOpen(true);
    terminalSession.startTerminal({ ...options, sessionId: nextSessionId });
  }

  function closeTerminalOverlay() {
    setTerminalOverlay("none");
  }

  function toggleTerminalOverlay(nextOverlay: "shortcuts" | "ai") {
    setTerminalOverlay((current) => current === nextOverlay ? "none" : nextOverlay);
  }

  async function restoreEmbeddedTerminalWindow(targetSessionId: string = terminalSessionId) {
    await closeDetachedTerminalWindow(targetSessionId);
    setTerminalDetached(false);
    setTerminalPanelOpen(Boolean(serverId));
  }

  async function reconcileDetachedTerminalOwnership(nextSessionId: string) {
    const normalizedNextSessionId = nextSessionId.trim();
    if (!isElectron || !normalizedNextSessionId) {
      return;
    }

    const detachedSessionIdsToClose = new Set<string>();
    for (const session of workspaceSessions) {
      if (session.id === activeWorkspaceSessionId) {
        continue;
      }

      const sessionState = readWorkspaceSessionState(session);
      const detachedSessionId = sessionState.terminalSessionId.trim();
      if (!sessionState.terminalDetached || !detachedSessionId || detachedSessionId === normalizedNextSessionId) {
        continue;
      }

      storeWorkspaceSessionState(session.id, {
        ...sessionState,
        terminalDetached: false,
        terminalPanelOpen: Boolean(sessionState.serverId),
      });
      detachedSessionIdsToClose.add(detachedSessionId);
    }

    for (const detachedSessionId of detachedSessionIdsToClose) {
      await closeDetachedTerminalWindow(detachedSessionId);
    }
  }

  function toggleTerminalPanel() {
    if (terminalDetached) {
      void restoreEmbeddedTerminalWindow();
      return;
    }

    if (terminalPanelOpen) {
      closeTerminalOverlay();
      setTerminalPanelOpen(false);
      terminalSession.stopTerminal();
      return;
    }

    openTerminalView();
  }

  async function openDetachedTerminalWindow() {
    if (!isElectron || !serverId) {
      return;
    }

    const nextSessionId = ensureTerminalSessionId();
    await reconcileDetachedTerminalOwnership(nextSessionId);

    if (pip.isPip) {
      await pip.togglePip();
    }

    const terminalBastionId = selectedServer?.connectionKind === "bastion"
      ? selectedServer.id
      : selectedServer?.connectionKind === "bastion-target"
        ? (preferredBastionId || undefined)
        : !selectedServer?.connectionKind
          ? (preferredBastionId || undefined)
          : undefined;

    await (window as any).electronAPI.openPipWindow({
      mode: "terminal",
      width: 980,
      height: 680,
      title: selectedServer?.name || selectedServer?.host || "终端",
      serverId,
      terminalSessionId: nextSessionId,
      directoryPath: terminalWorkingDirectory || selectedServer?.basePath?.trim() || "/",
      bastionId: terminalBastionId,
    });

    closeTerminalOverlay();
    setTerminalPanelOpen(false);
    setTerminalDetached(true);
  }

  async function closeDetachedTerminalWindow(targetSessionId: string = terminalSessionId) {
    if (!isElectron) {
      return;
    }

    const nextSessionId = targetSessionId.trim();
    if (!nextSessionId) {
      return;
    }

    await (window as any).electronAPI.closePipWindow({
      mode: "terminal",
      terminalSessionId: nextSessionId,
    });
  }

  useEffect(() => {
    jumpAssetAutoSearchKeyRef.current = "";
  }, [
    jumpSearchKeyword,
    preferredBastionId,
    serverId
  ]);

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
  const connectionStateText = buildConnectionSummary(selectedServer, connectionTestStatus);
  const terminalPanelStatusText = !selectedServer
    ? (localServiceState === "online" ? "未选择服务器" : (isElectron ? "正在等待内置连接服务启动..." : "本地连接服务未启动"))
    : terminalSession.connected
      ? "终端已连接"
      : connectionTestStatus?.connected
        ? "目录已连接，终端待连接"
        : localServiceState !== "online"
          ? (isElectron ? "正在等待内置连接服务启动..." : "本地连接服务未启动")
          : connectionStateText;
  const nextStepText = !selectedServer
    ? "先选择服务器"
    : !connectionTestStatus?.connected
      ? "正在自动连接并读取目录"
        : !filePath
          ? "在目录列表里进入目标目录，再选择日志文件"
          : !keywordInput.trim()
            ? "文件已打开，可直接搜索或读取尾部日志"
            : "可直接搜索，也可以继续翻阅日志文件";

  const keywordTerms = useMemo(() => parseKeywordTerms(keywordInput), [keywordInput]);
  const selectedFileName = filePath ? filePath.split("/").pop() ?? filePath : "";
  const selectedFileDirectory = resolvedFileDirectoryPath;
  const breadcrumbDirectoryPath = activeLogView === "search" && filePath
    ? selectedFileDirectory
    : directoryPath;
  const breadcrumbDirectoryLabel = breadcrumbDirectoryPath.replace(/^\/+|\/+$/g, "");
  const breadcrumbFileName = activeLogView === "search" ? selectedFileName : "";
  const sliceProgress = useMemo(() => {
    if (!sliceData || !fileMeta?.size) {
      return null;
    }

    if (sliceData.filePath !== filePath || fileMeta.filePath !== filePath) {
      return null;
    }

    const size = fileMeta.size || 0;
    const start = size > 0 ? clampPercent((sliceData.actualOffset / size) * 100) : 0;
    const end = size > 0 ? clampPercent((Math.min(sliceData.nextOffset, size) / size) * 100) : 0;

    return {
      start,
      end
    };
  }, [fileMeta, filePath, sliceData]);

  const activeFileMeta = fileMeta?.filePath === filePath ? fileMeta : null;
  const activeSliceData = sliceData?.filePath === filePath ? sliceData : null;

  const canDragReaderPosition = useMemo(() => {
    if (!activeFileMeta?.size || !activeSliceData) {
      return false;
    }

    return activeFileMeta.size > sliceLength;
  }, [activeFileMeta, activeSliceData, sliceLength]);

  const readerPositionLabel = formatSliceProgressLabel(sliceProgress, {
    dragging: readerPositionDragging,
    draft: readerPositionDraft
  });
  const readerPreviewLabel = canDragReaderPosition
    ? `${formatPercent(readerPositionDragging ? readerPositionDraft : (sliceProgress?.start ?? 0))}`
    : readerPositionLabel;
  const readerRailIndicatorTop = Math.max(2, Math.min(98, readerPositionDragging ? readerPositionDraft : (sliceProgress?.start ?? 0)));
  const readerRailSliceTop = clampPercent(sliceProgress?.start ?? 0);
  const readerRailSliceHeight = Math.max(1.2, (sliceProgress?.end ?? 0) - (sliceProgress?.start ?? 0));
  const showReaderRail = activeLogView === "search" && activeViewerTabId === "file" && Boolean(filePath);

  useEffect(() => {
    if (readerPositionDragging || !canDragReaderPosition) {
      if (!canDragReaderPosition) {
        setReaderPositionDraft(0);
        setReaderPreviewContent("");
        setReaderPreviewOffset(null);
        setReaderPreviewLoading(false);
      }
      return;
    }

    setReaderPositionDraft(sliceProgress?.start ?? 0);
  }, [canDragReaderPosition, readerPositionDragging, sliceProgress?.start]);

  useEffect(() => {
    if (!readerPositionDragging || !canDragReaderPosition || !filePath.trim()) {
      return;
    }

    const meta = activeFileMeta;
    if (!meta?.size) {
      return;
    }

    const previewLength = Math.min(sliceLength, previewSliceLength);
    const targetOffset = clampSliceStart(meta.size, Math.floor(meta.size * (readerPositionDraft / 100)), previewLength);
    const cacheKey = getPreviewCacheKey(filePath, targetOffset);
    const cachedPreview = previewCacheRef.current.get(cacheKey);
    const currentRequestId = readerPreviewRequestRef.current + 1;
    readerPreviewRequestRef.current = currentRequestId;
    if (cachedPreview) {
      setReaderPreviewOffset(cachedPreview.offset);
      setReaderPreviewContent(cachedPreview.content);
      setReaderPreviewLoading(false);
    } else {
      setReaderPreviewLoading(true);
    }

    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const previewSlice = await fetchLogSlice(filePath, targetOffset, previewLength);
          if (readerPreviewRequestRef.current !== currentRequestId) {
            return;
          }

          const previewContent = formatPreviewSnippet(previewSlice.content) || "这一段没有完整日志行。";
          setLimitedMapEntry(previewCacheRef.current, cacheKey, {
            offset: previewSlice.actualOffset,
            content: previewContent
          }, MAX_PREVIEW_CACHE_ENTRIES);
          setReaderPreviewOffset(previewSlice.actualOffset);
          setReaderPreviewContent(previewContent);
        } catch {
          if (readerPreviewRequestRef.current !== currentRequestId) {
            return;
          }

          setReaderPreviewContent("预览读取失败。");
          setReaderPreviewOffset(targetOffset);
        } finally {
          if (readerPreviewRequestRef.current === currentRequestId) {
            setReaderPreviewLoading(false);
          }
        }
      })();
    }, cachedPreview ? 40 : 90);

    return () => {
      window.clearTimeout(timer);
    };
  }, [activeFileMeta, canDragReaderPosition, filePath, readerPositionDragging, readerPositionDraft, sliceLength]);

  useEffect(() => {
    if (!readerPositionDragging || !canDragReaderPosition || !filePath.trim()) {
      return;
    }

    const meta = activeFileMeta;
    if (!meta?.size) {
      return;
    }

    const timer = window.setTimeout(() => {
      const previewLength = Math.min(sliceLength, previewSliceLength);
      const baseOffset = clampSliceStart(meta.size, Math.floor(meta.size * (readerPositionDraft / 100)), previewLength);
      const neighborOffsets = [-1, 0, 1].map((index) => clampSliceStart(meta.size, baseOffset + index * previewBucketSize, previewLength));

      neighborOffsets.forEach((offset) => {
        const cacheKey = getPreviewCacheKey(filePath, offset);
        if (previewCacheRef.current.has(cacheKey) || previewWarmRef.current.has(cacheKey)) {
          return;
        }

        previewWarmRef.current.add(cacheKey);
        void (async () => {
          try {
            const previewSlice = await fetchLogSlice(filePath, offset, previewLength);
            setLimitedMapEntry(previewCacheRef.current, cacheKey, {
              offset: previewSlice.actualOffset,
              content: formatPreviewSnippet(previewSlice.content) || "这一段没有完整日志行。"
            }, MAX_PREVIEW_CACHE_ENTRIES);
          } catch {
            return;
          } finally {
            previewWarmRef.current.delete(cacheKey);
          }
        })();
      });
    }, 150);

    return () => { window.clearTimeout(timer); };
  }, [activeFileMeta, canDragReaderPosition, filePath, readerPositionDragging, readerPositionDraft, sliceLength]);

  useEffect(() => {
    if (!readerPositionDragging || !canDragReaderPosition || !filePath.trim()) {
      return;
    }

    const meta = activeFileMeta;
    if (!meta?.size) {
      return;
    }

    const timer = window.setTimeout(() => {
      const baseOffset = clampSliceStart(meta.size, Math.floor(meta.size * (readerPositionDraft / 100)), sliceLength);
      const neighborOffsets = [-1, 0, 1].map((index) => clampSliceStart(meta.size, baseOffset + index * sliceLength, sliceLength));

      neighborOffsets.forEach((offset) => {
        void warmSlice(filePath, offset, sliceLength);
      });
    }, 200);

    return () => { window.clearTimeout(timer); };
  }, [activeFileMeta, canDragReaderPosition, filePath, readerPositionDragging, readerPositionDraft, sliceLength]);

  useEffect(() => {
    if (!readerPositionDragging) {
      return;
    }

    function resolvePercent(clientY: number) {
      const rail = readerRailRef.current;
      if (!rail) {
        return null;
      }

      const rect = rail.getBoundingClientRect();
      if (!rect.height) {
        return null;
      }

      return ((clientY - rect.top) / rect.height) * 100;
    }

    function scheduleDraft(nextPercent: number) {
      readerPendingDraftRef.current = clampPercent(nextPercent);
      if (readerDraftFrameRef.current !== null) {
        return;
      }

      readerDraftFrameRef.current = window.requestAnimationFrame(() => {
        readerDraftFrameRef.current = null;
        setReaderPositionDraft(readerPendingDraftRef.current ?? 0);
      });
    }

    function handlePointerMove(event: PointerEvent) {
      const nextPercent = resolvePercent(event.clientY);
      if (nextPercent === null) {
        return;
      }
      scheduleDraft(nextPercent);
    }

    function handlePointerEnd(event: PointerEvent) {
      const nextPercent = resolvePercent(event.clientY);
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerEnd);
      window.removeEventListener("pointercancel", handlePointerEnd);
      void commitReaderPosition(nextPercent ?? readerPendingDraftRef.current ?? 0);
    }

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerEnd);
    window.addEventListener("pointercancel", handlePointerEnd);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerEnd);
      window.removeEventListener("pointercancel", handlePointerEnd);
    };
  }, [readerPositionDragging]);

  useEffect(() => {
    if (!viewerOverviewDragging) {
      return;
    }

    function resolvePercent(clientY: number) {
      const rail = viewerOverviewRailRef.current;
      if (!rail) {
        return null;
      }

      const rect = rail.getBoundingClientRect();
      if (!rect.height) {
        return null;
      }

      return clampPercent(((clientY - rect.top) / rect.height) * 100);
    }

    function jumpToPercent(nextPercent: number) {
      const safePercent = clampPercent(nextPercent);
      setViewerOverviewDraft(safePercent);
      const totalLines = viewerScrollState?.totalLines ?? 0;
      if (!totalLines) {
        return;
      }

      const targetLine = Math.round((safePercent / 100) * Math.max(0, totalLines - 1));
      virtualViewerRef.current?.scrollToLine(targetLine, "auto");
    }

    function handlePointerMove(event: PointerEvent) {
      const nextPercent = resolvePercent(event.clientY);
      if (nextPercent === null) {
        return;
      }
      jumpToPercent(nextPercent);
    }

    function handlePointerEnd(event: PointerEvent) {
      const nextPercent = resolvePercent(event.clientY);
      if (nextPercent !== null) {
        jumpToPercent(nextPercent);
      }
      setViewerOverviewDragging(false);
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerEnd);
      window.removeEventListener("pointercancel", handlePointerEnd);
    }

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerEnd);
    window.addEventListener("pointercancel", handlePointerEnd);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerEnd);
      window.removeEventListener("pointercancel", handlePointerEnd);
    };
  }, [viewerOverviewDragging, viewerScrollState?.totalLines]);

  const searchPresets = [
    {
      label: "常规",
      apply: () => {
        setKeywordMode("phrase");
        setContextLines(3);
        setUseRegex(false);
        setStartDate(""); setEndDate(""); setStartTime(""); setEndTime("");
        setSelectedPreset("常规");
      }
    },
    {
      label: "查 SQL",
      apply: () => {
        setKeywordMode("all");
        setContextLines(2);
        setUseRegex(false);
        setStartDate(""); setEndDate(""); setStartTime(""); setEndTime("");
        setSelectedPreset("查 SQL");
      }
    },
    {
      label: "查异常",
      apply: () => {
        setKeywordMode("any");
        setContextLines(8);
        setUseRegex(false);
        setStartDate(""); setEndDate(""); setStartTime(""); setEndTime("");
        setSelectedPreset("查异常");
      }
    },
    {
      label: "大日志快筛",
      apply: () => {
        setKeywordMode("phrase");
        setContextLines(1);
        setUseRegex(false);
        setStartDate(""); setEndDate(""); setStartTime(""); setEndTime("");
        setSelectedPreset("大日志快筛");
      }
    },
    {
      label: "正则",
      apply: () => {
        setKeywordMode("phrase");
        setContextLines(3);
        setUseRegex(true);
        setStartDate(""); setEndDate(""); setStartTime(""); setEndTime("");
        setSelectedPreset("正则");
      }
    }
  ];
  const readerJumpPresets = [
    { label: "头", action: () => loadHeadSlice() },
    { label: "25%", action: () => void jumpToSliceRatio(0.25) },
    { label: "50%", action: () => void jumpToSliceRatio(0.5) },
    { label: "75%", action: () => void jumpToSliceRatio(0.75) },
    { label: "尾", action: () => loadTailSlice() }
  ];

  const canOpenTerminal = Boolean(selectedServer);
  const isFileMode = activeLogView === "files";
  const activeResultTab = useMemo(
    () => resultTabs.find((tab) => tab.id === activeViewerTabId) ?? null,
    [activeViewerTabId, resultTabs]
  );
  const viewerTabs = useMemo(() => {
    const items: Array<{ id: string; label: string; kind: "file" | "result" }> = filePath
      ? [{ id: "file", label: selectedFileName || "当前文件", kind: "file" as const }]
      : [];

    return items.concat(resultTabs.map((tab) => ({ id: tab.id, label: tab.label, kind: "result" as const })));
  }, [filePath, resultTabs, selectedFileName]);
  const activeViewerCommandPreview = activeResultTab?.commandPreview || (activeViewerTabId === "file" ? results?.commandPreview : "");
  const activeViewerStrategyLabel = activeResultTab?.strategyLabel || (activeViewerTabId === "file" ? results?.strategyLabel : "");
  const activeViewerScopeLabel = activeResultTab?.scopeLabel || (activeViewerTabId === "file" ? results?.scopeLabel : "");
  const activeViewerMatchCount = activeResultTab?.matchCount ?? (activeViewerTabId === "file" ? results?.matches.length ?? 0 : 0);
  const hasSearchContent = Boolean(activeResultTab?.content || liveFollowContent || sliceData?.content || results?.rawOutput);

  function handleTreeResizeStart(event: ReactPointerEvent<HTMLDivElement>) {
    if (!browserGridRef.current) {
      return;
    }

    treeResizeRef.current = {
      startX: event.clientX,
      startWidth: browserGridRef.current.querySelector(".browser-tree-column")?.getBoundingClientRect().width || browserTreeWidth
    };
    document.body.classList.add("is-resizing-tree");
    event.preventDefault();
  }

  function handleActivityPanelResizeStart(event: ReactPointerEvent<HTMLDivElement>) {
    activityPanelResizeRef.current = {
      startY: event.clientY,
      startHeight: activityPanelHeight
    };
    document.body.classList.add("is-resizing-activity-panel");
    event.preventDefault();
  }

  const hasDirectoryConnectionError = isFileMode && connectionTestStatus !== null && !connectionTestStatus.connected;
  const isConnectingWorkspace =
    isFileMode && !hasDirectoryConnectionError && (!selectedServer || (!connectionTestStatus?.connected && !fileEntries.length));
  const hasFileWorkspaceEntries = fileEntries.length > 0;
  const showServiceOfflineState = localServiceState === "offline";
  const showNoServerState = localServiceState === "online" && !servers.length && !isBusy;
  const showViewerEmptyState = activeLogView === "search" && !hasSearchContent && !filePath.trim() && !resultTabs.length && !fileLoadingName;
  const showCompactViewerChrome = pip.isPip || isStandaloneViewerWindow;

  useEffect(() => {
    if (!showCompactViewerChrome && showViewerDebugPanel) {
      setShowViewerDebugPanel(false);
    }
  }, [showCompactViewerChrome, showViewerDebugPanel]);

  useEffect(() => {
    if (pip.isPip) {
      pip.setTitle(selectedFileName || activeResultTab?.label || "搜索结果");
    }
  }, [pip.isPip, selectedFileName, activeResultTab?.label]);

  useEffect(() => {
    if (terminalPanelOpen && !canOpenTerminal && !isStandaloneTerminalWindow) {
      closeTerminalOverlay();
      setTerminalPanelOpen(false);
    }
  }, [terminalPanelOpen, canOpenTerminal, isStandaloneTerminalWindow]);

  const currentFileContent = liveFollowEnabled
    ? liveFollowContent || activeSliceData?.content || ""
    : lineContextState?.content || liveFollowContent || activeSliceData?.content || "";
  const currentLogContent = activeResultTab
    ? (resultContextMode && activeResultTab.fullContent ? activeResultTab.fullContent : activeResultTab.content)
    : (resultContextMode && results?.contextOutput ? results.contextOutput : currentFileContent);
  const canToggleErrorHighlight = Boolean(currentLogContent);
  const canToggleResultContext = Boolean(activeResultTab?.fullContent || (activeViewerTabId === "file" && results?.contextOutput));
  const toggleErrorHighlight = useCallback(() => {
    if (!canToggleErrorHighlight) {
      return;
    }
    setErrorHighlightEnabled((current) => {
      const next = !current;
      setActionStatus(next ? "已开启异常/告警高亮。" : "已关闭异常/告警高亮。");
      return next;
    });
  }, [canToggleErrorHighlight]);
  const toggleResultContext = useCallback(() => {
    if (!canToggleResultContext) {
      return;
    }
    setResultContextMode((current) => {
      const next = !current;
      setActionStatus(next ? "已切换到含上下文视图。" : "已切换到仅命中视图。");
      return next;
    });
  }, [canToggleResultContext]);
  const showSearchResultsOverviewRail = activeLogView === "search" && activeViewerTabId !== "file" && !showCompactViewerChrome && Boolean(currentLogContent);
  const showViewerRail = !showCompactViewerChrome && (showReaderRail || showSearchResultsOverviewRail);
  const viewerOverviewTotalLines = viewerScrollState?.totalLines ?? 0;
  const viewerOverviewMarkerPositions = useMemo(() => {
    if (viewerOverviewTotalLines <= 1 || !viewerMatchLineIndices.length) {
      return [] as number[];
    }

    const bucketCount = Math.max(1, Math.min(220, viewerOverviewTotalLines - 1));
    const buckets = new Set<number>();
    for (const lineIndex of viewerMatchLineIndices) {
      buckets.add(Math.round((lineIndex / (viewerOverviewTotalLines - 1)) * bucketCount));
    }
    return Array.from(buckets, (bucket) => clampPercent((bucket / bucketCount) * 100));
  }, [viewerMatchLineIndices, viewerOverviewTotalLines]);
  const viewerOverviewViewportHeight = viewerScrollState
    ? Math.min(100, Math.max(6, (viewerScrollState.clientHeight / Math.max(1, viewerScrollState.scrollHeight)) * 100))
    : 8;
  const viewerOverviewScrollRange = viewerScrollState
    ? Math.max(1, viewerScrollState.scrollHeight - viewerScrollState.clientHeight)
    : 1;
  const viewerOverviewViewportTop = viewerOverviewDragging
    ? Math.max(0, Math.min(100 - viewerOverviewViewportHeight, viewerOverviewDraft - viewerOverviewViewportHeight / 2))
    : (viewerScrollState
      ? Math.max(0, Math.min(100 - viewerOverviewViewportHeight, (viewerScrollState.scrollTop / viewerOverviewScrollRange) * (100 - viewerOverviewViewportHeight)))
      : 0);
  const viewerOverviewBadgeTop = Math.max(2, Math.min(98, viewerOverviewViewportTop + viewerOverviewViewportHeight / 2));
  const viewerOverviewCurrentLine = viewerOverviewTotalLines
    ? Math.min(viewerOverviewTotalLines, Math.max(1, Math.round((viewerOverviewBadgeTop / 100) * Math.max(0, viewerOverviewTotalLines - 1)) + 1))
    : 0;
  const viewerOverviewLabel = viewerOverviewTotalLines
    ? `${formatNumber(viewerOverviewCurrentLine)}/${formatNumber(viewerOverviewTotalLines)}`
    : "--";
  const viewerEmptyTitle = "还没有日志内容";
  const viewerEmptyHint = !filePath
    ? "先在目录中选择日志文件，系统会自动打开尾部片段。"
    : "输入关键字后回车搜索，或在右下角使用回到底部。";
  const [highlightCount, setHighlightCount] = useState(0);
  const commandPreviewLabel = activeViewerCommandPreview ? truncateText(activeViewerCommandPreview.replace(/\s+/g, " "), 96) : "--";
  const liveStrategyLabel =
    searchTask?.strategyLabel ||
    activeViewerStrategyLabel ||
    describeSearchStrategyClient(keywordMode, keywordTerms, useRegex, startDate, endDate, startTime, endTime);
  const liveScopeLabel =
    searchTask?.scopeLabel ||
    activeViewerScopeLabel ||
    describeSearchScopeClient(filePath, startDate, endDate, startTime, endTime, keywordTerms);
  const searchElapsedLabel = searchStartedAt ? formatDurationLabel(searchStartedAt, searchNow) : "";
  const searchProgressPhaseLabel = searchTask
    ? `${searchTask.progressPhaseLabel || "正在查找"}${searchTask.progressPhaseCount && searchTask.progressPhaseIndex ? ` · 阶段 ${searchTask.progressPhaseIndex}/${searchTask.progressPhaseCount}` : ""}`
    : "正在查找";
  const searchOverallProgressLabel = searchTask
    ? `总进度 ${searchTask.progressPercent.toFixed(1)}% · ${formatBytes(searchTask.scannedBytes)} / ${formatBytes(searchTask.totalBytes)}`
    : "服务器正在查找";
  const searchPhaseProgressLabel = searchTask
    ? `${searchTask.progressPhaseLabel || "当前阶段"}${searchTask.progressPhaseCount && searchTask.progressPhaseIndex ? ` ${searchTask.progressPhaseIndex}/${searchTask.progressPhaseCount}` : ""} · ${(searchTask.phaseProgressPercent ?? searchTask.progressPercent).toFixed(1)}% · ${formatBytes(searchTask.phaseScannedBytes ?? searchTask.scannedBytes)} / ${formatBytes(searchTask.phaseTotalBytes ?? searchTask.totalBytes)}`
    : "--";
  const searchProgressMatchLabel = searchTask ? `命中 ${formatNumber(searchTask.matchCount)} 条` : "--";
  const isSearchView = activeLogView === "search";
  const activeSearchResultCount = activeViewerTabId === "file" ? (results?.matches.length ?? 0) : activeViewerMatchCount;
  const activeHighlightSummary = highlightCount ? `${Math.min(activeHighlightIndex + 1, highlightCount)}/${highlightCount}` : "";
  const toolbarSummaryLabel = activeViewerTabId === "file"
    ? (activeHighlightSummary ? `${activeHighlightSummary} 当前片段命中` : (selectedFileName || "--"))
    : (activeHighlightSummary ? `${activeHighlightSummary} 命中` : `结果 ${formatNumber(activeSearchResultCount)} 条`);
  const toolbarMetaLabel = searchStartedAt
    ? `检索中${searchElapsedLabel ? ` · ${searchElapsedLabel}` : ""}`
    : activeViewerTabId === "file"
      ? (activeSearchResultCount ? `搜索结果 ${formatNumber(activeSearchResultCount)} 条` : (liveFollowEnabled ? (liveFollowConnected ? "实时中" : "实时连接中") : ""))
      : `共 ${formatNumber(activeSearchResultCount)} 条结果`;
  const showSearchSummary = !showQueryAdvanced && isSearchView && Boolean(highlightCount || activeSearchResultCount || liveFollowEnabled || searchStartedAt);
  const canRecordLog = Boolean(serverId && filePath.trim() && isSearchView);
  const canToggleRecording = recordingSession ? Boolean(serverId) : canRecordLog;
  const compactConnectionLabel = selectedServer ? `${selectedServer.host} · ${directoryPath || "/"}` : (directoryPath || "/");
  const terminalConnectionLabel = selectedServer
    ? `${selectedServer.host || selectedServer.name || "--"} · ${directoryPath || selectedServer.basePath || "/"}`
    : (directoryPath || "/");
  const compactViewerTitle = selectedFileName || activeResultTab?.label || "搜索结果";
  const compactViewerSubtitle = activeResultTab?.sourceLabel || compactConnectionLabel;
  const compactReaderHint = activeViewerTabId === "file"
    ? (liveFollowEnabled
      ? `实时：${liveFollowConnected ? (liveFollowPaused ? "已暂停滚动" : "接收中") : (liveFollowRetryCount > 0 ? `重连中 ${liveFollowRetryCount}` : "连接中")}${liveFollowContent ? ` · ${formatNumber(liveFollowContent.split("\n").length)} 行` : ""}`
      : lineContextState
        ? `定位到 ${formatNumber(lineContextState.lineNumber)} 行`
        : (highlightCount ? `命中 ${highlightCount} 处` : "滚轮到边缘可翻页"))
    : `结果 ${formatNumber(activeViewerMatchCount)} 条`;
  const activeViewerMatches = activeResultTab?.matches ?? (activeViewerTabId === "file" ? results?.matches ?? [] : []);
  const viewerLineClickEnabled = activeViewerTabId !== "file" && activeViewerMatches.length > 0;
  const viewerWheelHandlerRef = useRef<(event: ReactWheelEvent<HTMLDivElement>) => void>(() => {});
  const viewerNearBottomHandlerRef = useRef<(nearBottom: boolean) => void>(() => {});
  const viewerLineClickHandlerRef = useRef<((lineIndex: number, event: ReactMouseEvent<HTMLDivElement>) => void) | undefined>(undefined);

  function resolveViewerJumpTarget(lineIndex: number): LogSearchResponse["matches"][number] | null {
    if (!activeViewerMatches.length) {
      return null;
    }
    const lines = currentLogContent.split("\n");
    const rawLine = lines[lineIndex] || "";
    const parsed = rawLine.match(/^\s*(\d+)\s*(?:\||\t)\s?(.*)$/);
    if (parsed) {
      const lineNumber = Number(parsed[1]);
      if (Number.isFinite(lineNumber) && lineNumber > 0) {
        return {
          source: activeViewerMatches[0]?.source || activeResultTab?.sourceLabel || filePath,
          lineNumber,
          preview: parsed[2] || rawLine.trim(),
        };
      }
      return null;
    }
    return resultContextMode ? null : (activeViewerMatches[lineIndex] || null);
  }

  function appendResultTab(payload: LogSearchResponse, sourceLabel: string) {
    const nextId = `result-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const nextLabel = `结果 ${resultTabCounter}`;
    const compactContent = formatSearchViewerContent(payload, undefined);
    const fullContent = formatSearchViewerContent(payload, "contextOutput");
    const nextTab: ViewerResultTab = {
      id: nextId,
      label: nextLabel,
      sourceLabel,
      content: compactContent,
      fullContent,
      matches: payload.matches,
      commandPreview: payload.commandPreview,
      strategyLabel: payload.strategyLabel,
      scopeLabel: payload.scopeLabel,
      matchCount: payload.matches.length
    };

    setResultTabs((current) => {
      const nextTabs = [...current, nextTab];
      return nextTabs.length > MAX_RESULT_TABS ? nextTabs.slice(nextTabs.length - MAX_RESULT_TABS) : nextTabs;
    });
    setActiveViewerTabId(nextId);
    setResultTabCounter((current) => current + 1);
  }

  function replaceLastResultTab(payload: LogSearchResponse) {
    setResultTabs((current) => {
      if (current.length === 0) return current;
      const last = current[current.length - 1];
      const compactContent = formatSearchViewerContent(payload, undefined);
      const fullContent = payload.contextOutput || (payload.rawOutput && payload.rawOutput !== compactContent ? payload.rawOutput : undefined);
      const updated: ViewerResultTab = {
        ...last,
        content: compactContent,
        fullContent,
        matches: payload.matches,
        commandPreview: payload.commandPreview,
        strategyLabel: payload.strategyLabel,
        scopeLabel: payload.scopeLabel,
        matchCount: payload.matches.length
      };
      return [...current.slice(0, -1), updated];
    });
  }

  function closeResultTab(tabId: string) {
    setResultTabs((current) => {
      const nextTabs = current.filter((tab) => tab.id !== tabId);
      if (activeViewerTabId === tabId) {
        const fallback = nextTabs[nextTabs.length - 1];
        setActiveViewerTabId(fallback?.id || (filePath ? "file" : ""));
      }
      return nextTabs;
    });
  }

  function focusHighlight(direction: "prev" | "next") {
    if (!highlightCount) {
      return;
    }

    const nextIndex =
      direction === "next"
        ? (activeHighlightIndex + 1) % highlightCount
        : (activeHighlightIndex - 1 + highlightCount) % highlightCount;

    setActiveHighlightIndex(nextIndex);
    setActionStatus(`已定位到第 ${nextIndex + 1} 个命中，共 ${highlightCount} 个。`);
  }

  function applySlicePayload(payload: LogSliceResponse, options?: { status?: string; activity?: string }) {
    setLineContextState(null);
    setSliceOffset(payload.actualOffset);
    setSliceData({ ...payload });
    setActiveLogView("search");
    setActiveViewerTabId("file");
    if (options?.status) {
      setActionStatus(options.status);
    }
    if (options?.activity) {
      pushActivity(options.activity);
    }
  }

  async function jumpToSearchMatch(match: LogSearchResponse["matches"][number]) {
    if (!match.source || match.source === "临时结果") {
      setActionStatus("当前结果页来自临时筛选，暂时不能直接跳回原日志文件。");
      return;
    }

    await withBusy("正在定位命中上下文...", async () => {
      const targetFilePath = match.source;
      setFilePath(targetFilePath);
      setActiveLogView("search");
      setActiveViewerTabId("file");
      stopLiveFollow();

      const [metaPayload, contextPayload] = await Promise.all([
        fetchLogMeta(targetFilePath),
        fetchLineContext(targetFilePath, match.lineNumber, Math.max(12, contextLines * 2))
      ]);

      setFileMeta(metaPayload);
      setLineContextState({
        ...contextPayload,
        sourceLabel: targetFilePath.split("/").pop() || targetFilePath
      });
      setActionStatus(`已定位到第 ${formatNumber(match.lineNumber)} 行附近。`);
      pushActivity(`已定位搜索命中：${targetFilePath} 第 ${formatNumber(match.lineNumber)} 行。`);
    });
  }

  liveReconnectRef.current = (target) => {
    void loadTailSlice().finally(() => {
      startLiveFollow(target.filePath, target.fileName, { isReconnect: true });
    });
  };

  async function toggleLiveFollow(nextEnabled: boolean) {
    if (!filePath.trim()) {
      return;
    }

    if (!nextEnabled) {
      stopLiveFollow({ keepContent: true });
      showToast("success", "已关闭实时跟随。");
      pushActivity(`已关闭实时跟随：${filePath}。`);
      return;
    }

    await loadTailSlice();
    startLiveFollow(filePath, selectedFileName || filePath);
  }


  function enterPathbarEditMode(options?: { selectAll?: boolean }) {
    if (!serverId) {
      return;
    }
    setShowPathHistory(false);
    setDirectoryInput(directoryPath || directoryInput || "/");
    setPathbarMode("edit");
    window.setTimeout(() => {
      const input = directoryInputRef.current;
      if (!input) {
        return;
      }
      input.focus();
      if (options?.selectAll) {
        input.select();
        return;
      }
      const length = input.value.length;
      input.setSelectionRange(length, length);
    }, 0);
  }

  function exitPathbarEditMode() {
    setPathbarMode("browse");
    setDirectoryInput(directoryPath || "/");
  }

  function clearViewerSelection() {
    globalThis.getSelection?.()?.removeAllRanges();
  }

  function handleViewerSelectionMouseDown() {
    setViewerSelMenu(null);
  }

  function handleViewerSelectionMouseUp(event: ReactMouseEvent<HTMLDivElement>) {
    window.setTimeout(() => {
      const container = viewerContentShellRef.current;
      const selection = globalThis.getSelection?.();
      const text = selection?.toString().trim() || "";
      if (
        !container ||
        !selection ||
        selection.isCollapsed ||
        !text ||
        !((selection.anchorNode && container.contains(selection.anchorNode)) ||
          (selection.focusNode && container.contains(selection.focusNode)))
      ) {
        setViewerSelMenu(null);
        return;
      }
      const rect = container.getBoundingClientRect();
      const nextX = Math.min(Math.max(8, event.clientX - rect.left), Math.max(8, rect.width - 44));
      const nextY = Math.min(Math.max(8, event.clientY - rect.top), Math.max(8, rect.height - 44));
      setViewerSelMenu({ x: nextX, y: nextY, text });
    }, 10);
  }

  viewerWheelHandlerRef.current = handleViewerWheel;
  viewerNearBottomHandlerRef.current = handleViewerNearBottomChange;
  viewerLineClickHandlerRef.current = viewerLineClickEnabled
    ? (lineIndex: number, event: ReactMouseEvent<HTMLDivElement>) => {
      const match = resolveViewerJumpTarget(lineIndex);
      if (match) void jumpToSearchMatch(match);
    }
    : undefined;

  const handleViewerWheelWithSelectionMenu = useCallback((event: ReactWheelEvent<HTMLDivElement>) => {
    setViewerSelMenu(null);
    viewerWheelHandlerRef.current(event);
  }, []);

  const handleViewerNearBottomChangeStable = useCallback((nearBottom: boolean) => {
    viewerNearBottomHandlerRef.current(nearBottom);
  }, []);

  const handleViewerLineClick = useCallback((lineIndex: number, event: ReactMouseEvent<HTMLDivElement>) => {
    viewerLineClickHandlerRef.current?.(lineIndex, event);
  }, []);

  async function handleCopyViewerSelection() {
    if (!viewerSelMenu?.text) {
      return;
    }
    try {
      await copyText(viewerSelMenu.text);
      setActionStatus("已复制选中文本。");
      showToast("success", "已复制选中文本");
    } catch (error) {
      const detail = error instanceof Error ? error.message : "未知错误";
      setActionStatus(`复制失败：${detail}`);
      showToast("error", `复制失败：${detail}`);
    } finally {
      clearViewerSelection();
      setViewerSelMenu(null);
    }
  }

  function openContextMenu(entry: LogFileEntry, x: number, y: number) {
    const menuWidth = 180;
    const menuHeight = entry.kind === "file" ? 260 : 190;
    const nextX = Math.min(Math.max(8, x), Math.max(8, window.innerWidth - menuWidth - 8));
    const nextY = Math.min(Math.max(8, y), Math.max(8, window.innerHeight - menuHeight - 8));
    setContextMenu({ x: nextX, y: nextY, entry });
  }

  async function withBusy<T>(message: string, task: () => Promise<T>, successMessage?: string) {
    setIsBusy(true);
    setActionStatus(message);
    const tid = showToast("loading", message);

    try {
      const result = await task();
      if (successMessage) updateToast(tid, "success", successMessage);
      else dismissToast(tid);
      return result;
    } catch (error) {
      const detail = error instanceof Error ? error.message : "未知错误";
      setActionStatus(`操作失败：${detail}`);
      pushActivity(`操作失败：${detail}`);
      updateToast(tid, "error", `操作失败：${detail}`);
      return null;
    } finally {
      setIsBusy(false);
    }
  }

  async function startLogRecording() {
    if (!serverId || !filePath.trim()) {
      return;
    }

    setActionStatus("正在开始录制日志...");
    const tid = showToast("loading", "正在开始录制日志...");
    try {
      const payload = await apiStartLogRecording(serverId, filePath, directoryPath || undefined);
      setRecordingSession(payload);
      setActionStatus(`已开始录制：${payload.outputPath.split("/").pop() || payload.outputPath}`);
      pushActivity(`开始录制日志：${payload.sourcePath} → ${payload.outputPath}`);
      updateToast(tid, "success", "录制已开始");
    } catch (error) {
      const detail = error instanceof Error ? error.message : "未知错误";
      setActionStatus(`录制启动失败：${detail}`);
      pushActivity(`录制启动失败：${detail}`);
      updateToast(tid, "error", `录制启动失败：${detail}`);
    }
  }

  async function stopLogRecording() {
    if (!recordingSession || !serverId) {
      return;
    }

    setActionStatus("正在结束录制日志...");
    const tid = showToast("loading", "正在结束录制日志...");
    try {
      const payload = await apiStopLogRecording(recordingSession.sessionId);
      setRecordingSession(null);
      const recordFileName = payload.outputPath.split("/").pop() || "record.log";
      setPreviewDialog({
        filePath: payload.outputPath,
        fileName: recordFileName,
        content: "",
        originalContent: "",
        size: payload.sizeBytes,
        loading: true,
        readOnly: true,
      });
      try {
        const preview = await apiPreviewFile(serverId, payload.outputPath);
        setPreviewDialog({
          filePath: preview.filePath,
          fileName: recordFileName,
          content: preview.content,
          originalContent: preview.content,
          size: preview.size,
          readOnly: true,
        });
      } catch (previewError) {
        const detail = previewError instanceof Error ? previewError.message : "加载失败";
        setPreviewDialog((prev) => prev ? { ...prev, loading: false, content: `/* 加载预览失败：${detail} */\n/* 可尝试下载文件查看完整内容 */`, originalContent: "" } : null);
      }
      setActionStatus(`录制完成，已打开 ${recordFileName}`);
      pushActivity(`结束录制日志：${payload.outputPath}（${formatBytes(payload.sizeBytes)}）`);
      updateToast(tid, "success", `录制完成：${recordFileName}`);
    } catch (error) {
      const detail = error instanceof Error ? error.message : "未知错误";
      setRecordingSession(null);
      setActionStatus(`结束录制失败：${detail}`);
      pushActivity(`结束录制失败：${detail}`);
      updateToast(tid, "error", `结束录制失败：${detail}`);
    }
  }

  async function runSearch() {
    const normalizedInput = normalizeSearchInput(keywordInput);
    const normalizedTerms = parseKeywordTerms(keywordInput);
    if (!normalizedInput || !normalizedTerms.length) {
      setActionStatus("先输入关键字再搜索。");
      return;
    }

    if (activeViewerTabId !== "file" && activeResultTab) {
      const localResult = activeResultTab.matches.length
        ? searchWithinMatches(activeResultTab.matches, keywordMode, normalizedTerms, useRegex, contextLines)
        : searchWithinContent(activeResultTab.content, keywordMode, normalizedTerms, useRegex, contextLines);
      setResults(localResult);
      appendResultTab(localResult, activeResultTab.sourceLabel);
      setActiveLogView("search");
      setActionStatus(`已在 ${activeResultTab.label} 内继续筛选，命中 ${localResult.matches.length} 行。`);
      pushActivity(`结果页继续筛选完成：${activeResultTab.label} / 命中 ${localResult.matches.length} 行。`);
      return;
    }

    const startedAt = Date.now();
    setSearchNow(startedAt);
    setSearchStartedAt(startedAt);
    setIsBusy(true);
    setActionStatus("正在检索远程日志...");
    setSearchTask(null);
    setResults(null);

    try {
      const primaryKeyword = keywordMode === "phrase" ? normalizedInput : normalizedTerms[0] || "";
      const taskPayload = await apiCreateSearchTask({
        serverId,
        filePath,
        keyword: primaryKeyword,
        keywordTerms: normalizedTerms,
        keywordMode,
        startDate,
        endDate,
        startTime,
        endTime,
        contextLines,
        useRegex
      });
      setSearchTask(taskPayload);
      setActiveLogView("search");
      pushActivity(`搜索任务已启动：${taskPayload.strategyLabel || "分片扫描"} / ${taskPayload.scopeLabel || filePath}`);

      let currentTask = taskPayload;
      let quickResultShown = false;
      while (currentTask.status === "queued" || currentTask.status === "running") {
        await new Promise((resolve) => window.setTimeout(resolve, 450));
        currentTask = await apiPollSearchTask(currentTask.taskId);
        setSearchTask(currentTask);

        // Phase 1 quick results: show immediately while full scan continues
        if (currentTask.quickResult && !quickResultShown) {
          quickResultShown = true;
          setResults(currentTask.quickResult);
          appendResultTab(currentTask.quickResult, selectedFileName || filePath || "当前文件");
          setActionStatus(`尾部快搜命中 ${currentTask.quickResult.matches.length} 行，全文扫描继续中...`);
          pushActivity(`尾部快搜完成：命中 ${currentTask.quickResult.matches.length} 行，全文扫描继续中...`);
        }
      }

      if (currentTask.status === "failed") {
        throw new Error(currentTask.errorMessage || "搜索任务失败");
      }

      const finalResult = currentTask.result || null;
      setResults(finalResult);
      if (finalResult) {
        if (quickResultShown) {
          replaceLastResultTab(finalResult);
        } else {
          appendResultTab(finalResult, selectedFileName || filePath || "当前文件");
        }
      }
      setActionStatus(`检索完成，命中 ${finalResult?.matches.length ?? 0} 行。`);
      pushActivity(`检索完成：${selectedServer?.name || serverId} / ${filePath} / 命中 ${finalResult?.matches.length ?? 0} 行。`);
    } catch (error) {
      const detail = error instanceof Error ? error.message : "未知错误";
      setActionStatus(`操作失败：${detail}`);
      pushActivity(`操作失败：${detail}`);
    } finally {
      setIsBusy(false);
      setSearchStartedAt(null);
    }
  }

  async function importFromTool(toolId: string = selectedImportTool) {
    const toolLabel = toolId === "finalshell" ? "FinalShell" : toolId === "xshell" ? "Xshell" : toolId;
    await withBusy(`正在导入 ${toolLabel} 连接...`, async () => {
      const payload = await apiImportFromTool(toolId);
      setServers(payload.servers);
      selectServerById(payload.servers[0]?.id ?? "");
      setFilePath("");
      setImportStatus(`已导入 ${payload.servers.length} 台服务器，时间 ${payload.importedAt}`);
      if (toolId === "finalshell") setFinalShellLastImportedAt(payload.importedAt);
      if (toolId === "xshell") setXshellLastImportedAt(payload.importedAt);
      setImportPath(
        payload.resolvedPath
          ? `配置目录：${payload.resolvedPath}`
          : `未发现 ${toolLabel} 配置目录，已检查：${payload.searchedPaths.join(" | ")}`
      );
      setActionStatus(`${toolLabel} 连接导入完成。`);
      pushActivity(`${toolLabel} 配置已导入，共 ${payload.servers.length} 台，选择服务器后会自动连接。`);
    }, `已导入 ${toolLabel} ${toolId === "finalshell" || toolId === "xshell" ? "连接" : ""}`);
  }

  async function importFromFinalShell() {
    return importFromTool("finalshell");
  }

  async function browseLogFiles(nextDirectoryPath?: string, options?: { manual?: boolean }) {
    if (!serverId) return;
    stopLiveFollow();
    setShowPathHistory(false);
    setShowTransferHistory(false);
    await withBusy("正在读取远程目录...", async () => {
      const payload = await fetchDirectoryListing(nextDirectoryPath || directoryPath || "/");
      setDirectoryPath(payload.directoryPath);
      setDirectoryInput(payload.directoryPath);
      setPathbarMode("browse");
      setSelectedFilePaths([]);
      setBatchMoveDialog(null);
      setFileEntries(payload.entries);
      setActiveLogView("files");
      rememberDirectoryIfUseful(serverId, payload.directoryPath, payload.entries.length);
      pushDirectoryHistory(serverId, payload.directoryPath);
      setActionStatus(`目录读取完成，共 ${payload.entries.length} 项。`);
      pushActivity(`已打开目录：${payload.directoryPath}，共 ${payload.entries.length} 项。`);
    });
  }

  async function commitDirectoryPath(nextDirectoryPath?: string) {
    if (!serverId) return;
    const targetDirectory = nextDirectoryPath?.trim() || directoryInput.trim() || directoryPath || "/";
    await browseLogFiles(targetDirectory, { manual: true });
  }

  async function openDirectoryFromInput() {
    if (!serverId) return;
    await commitDirectoryPath(directoryInput);
  }

  async function browseParentDirectory() {
    if (!serverId) return;
    await commitDirectoryPath(getParentDirectoryPath(directoryPath || directoryInput || "/"));
  }

  async function downloadFile(targetFilePath: string) {
    if (!serverId) return;
    const fileName = targetFilePath.split("/").pop() || "download";
    let downloadedBytes = 0;
    setDownloadProgress({ fileName, fileSize: 0, bytesDownloaded: 0, speed: 0, percent: 0 });
    const tid = showToast("loading", `正在下载 ${fileName}...`);
    try {
      const blob = await apiDownloadFile(serverId, targetFilePath, (downloaded, total, speed) => {
        downloadedBytes = downloaded;
        setDownloadProgress({ fileName, fileSize: total, bytesDownloaded: downloaded, speed, percent: total > 0 ? Math.round((downloaded / total) * 100) : 0 });
      });
      setDownloadProgress(null);
      const api = (window as any).electronAPI;
      if (api?.saveFile) {
        const buf = await blob.arrayBuffer();
        const result = await api.saveFile(buf, fileName);
        if (!result?.ok) {
          if (result?.canceled) {
            const message = "用户取消了下载保存";
            setActionStatus("下载已取消");
            pushActivity(`${message}：${targetFilePath}`);
            appendTransferHistory({
              direction: "download",
              status: "canceled",
              fileName,
              filePath: targetFilePath,
              size: blob.size || downloadedBytes,
              message,
            });
            dismissToast(tid);
            return;
          }
          throw new Error(result?.message || "保存下载文件失败");
        }
        setActionStatus(`已保存到 ${result.filePath}`);
        pushActivity(`已下载文件：${targetFilePath} → ${result.filePath}`);
        appendTransferHistory({
          direction: "download",
          status: "success",
          fileName,
          filePath: targetFilePath,
          size: blob.size || downloadedBytes,
          localPath: result.filePath,
        });
        updateToast(tid, "success", `已保存到 ${result.filePath}`);
      } else {
        const url = URL.createObjectURL(blob);
        try {
          const chromeDownloads = (globalThis as any).chrome?.downloads;
          const chromeRuntime = (globalThis as any).chrome?.runtime;
          if (chromeDownloads?.download) {
            await new Promise<void>((resolve, reject) => {
              chromeDownloads.download({ url, filename: fileName, saveAs: true }, () => {
                const lastError = chromeRuntime?.lastError;
                if (lastError) {
                  reject(new Error(lastError.message || "浏览器下载失败"));
                  return;
                }
                resolve();
              });
            });
            setActionStatus(`浏览器已弹出保存对话框：${fileName}`);
            pushActivity(`已触发浏览器保存：${targetFilePath}`);
            appendTransferHistory({
              direction: "download",
              status: "success",
              fileName,
              filePath: targetFilePath,
              size: blob.size || downloadedBytes,
              message: "浏览器已弹出保存对话框",
            });
            updateToast(tid, "success", `请选择保存位置：${fileName}`);
          } else {
            const a = document.createElement("a");
            a.href = url;
            a.download = fileName;
            document.body.appendChild(a);
            a.click();
            a.remove();
            setActionStatus(`浏览器已开始下载 ${fileName}`);
            pushActivity(`已触发浏览器下载：${targetFilePath}`);
            appendTransferHistory({
              direction: "download",
              status: "success",
              fileName,
              filePath: targetFilePath,
              size: blob.size || downloadedBytes,
              message: "浏览器已开始下载",
            });
            updateToast(tid, "success", `已开始下载 ${fileName}`);
          }
        } finally {
          window.setTimeout(() => URL.revokeObjectURL(url), 1000);
        }
        return;
      }
      return;
    } catch (error) {
      const detail = error instanceof Error ? error.message : "未知错误";
      setActionStatus(`下载失败：${detail}`);
      pushActivity(`下载失败：${detail}`);
      appendTransferHistory({
        direction: "download",
        status: "error",
        fileName,
        filePath: targetFilePath,
        size: downloadedBytes,
        message: detail,
      });
      updateToast(tid, "error", `下载失败：${detail}`);
    } finally {
      setDownloadProgress(null);
    }
  }

  async function uploadOneFile(file: File, targetPath: string): Promise<void> {
    const CHUNK_THRESHOLD = 10 * 1024 * 1024;

    if (file.size < CHUNK_THRESHOLD) {
      await apiUploadSmall(serverId!, targetPath, file);
      setUploadProgress((prev) => prev ? { ...prev, current: 100, bytesUploaded: file.size, speed: 0 } : null);
      return;
    }

    const chunkSize = Math.max(1 * 1024 * 1024, Math.min(8 * 1024 * 1024, Math.ceil(file.size / 50)));
    const totalChunks = Math.ceil(file.size / chunkSize);

    const uploadId = await apiUploadStart(serverId, targetPath);

    let offset = 0;
    let speedSampleTime = Date.now();
    let speedSampleOffset = 0;
    let speed = 0;

    for (let i = 0; i < totalChunks; i++) {
      const end = Math.min(offset + chunkSize, file.size);
      const blob = file.slice(offset, end);
      await apiUploadChunk(uploadId, blob);

      offset = end;
      const now = Date.now();
      const elapsed = (now - speedSampleTime) / 1000;
      if (elapsed >= 0.5) {
        speed = (offset - speedSampleOffset) / elapsed;
        speedSampleTime = now;
        speedSampleOffset = offset;
      }
      setUploadProgress((prev) => prev ? { ...prev, current: Math.round((offset / file.size) * 100), bytesUploaded: offset, speed } : null);
    }

    await apiUploadFinish(uploadId);
  }

  const UPLOAD_JUNK_FILES = new Set([
    ".DS_Store", "._.DS_Store", "Thumbs.db", "thumbs.db", "desktop.ini", "Desktop.ini",
    ".Spotlight-V100", ".Trashes", "__MACOSX", ".fseventsd", ".TemporaryItems",
    "ehthumbs.db", "ehthumbs_vista.db", "$RECYCLE.BIN", "System Volume Information",
  ].map((name) => name.toLowerCase()));
  function isJunkFile(name: string): boolean {
    const normalized = (name || "").trim().toLowerCase();
    return UPLOAD_JUNK_FILES.has(normalized) || normalized.startsWith("._");
  }

  function getUploadRelativePath(file: File): string {
    return String((file as { webkitRelativePath?: string }).webkitRelativePath || file.name || "").replace(/^\/+/, "");
  }

  function getUploadLocalPath(file: File): string {
    const localPath = String((file as { path?: string }).path || "").trim();
    if (localPath) {
      return localPath;
    }
    return getUploadRelativePath(file);
  }

  function isJunkUploadPath(relativePath: string): boolean {
    const segments = relativePath
      .split("/")
      .map((segment) => segment.trim())
      .filter(Boolean);
    return segments.some((segment) => isJunkFile(segment));
  }

  function splitUploadFiles(fileList: File[]) {
    const accepted: File[] = [];
    const skipped: File[] = [];

    for (const file of fileList) {
      const relativePath = getUploadRelativePath(file);
      if (!relativePath || isJunkUploadPath(relativePath)) {
        skipped.push(file);
        continue;
      }
      accepted.push(file);
    }

    return { accepted, skipped };
  }

  async function collectFilesFromEntries(entries: FileSystemEntry[]): Promise<File[]> {
    const files: File[] = [];
    async function readAllEntries(reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> {
      const all: FileSystemEntry[] = [];
      let batch: FileSystemEntry[];
      do {
        batch = await new Promise<FileSystemEntry[]>((resolve, reject) => reader.readEntries(resolve, reject));
        all.push(...batch);
      } while (batch.length > 0);
      return all;
    }
    async function traverse(entry: FileSystemEntry, pathPrefix: string) {
      if (entry.isFile) {
        const fileEntry = entry as FileSystemFileEntry;
        const file = await new Promise<File>((resolve, reject) => fileEntry.file(resolve, reject));
        const relativePath = pathPrefix ? `${pathPrefix}/${entry.name}` : entry.name;
        Object.defineProperty(file, "webkitRelativePath", { value: relativePath, writable: false });
        files.push(file);
      } else if (entry.isDirectory) {
        if (isJunkFile(entry.name)) return;
        const dirEntry = entry as FileSystemDirectoryEntry;
        const reader = dirEntry.createReader();
        const subEntries = await readAllEntries(reader);
        const nextPrefix = pathPrefix ? `${pathPrefix}/${entry.name}` : entry.name;
        for (const sub of subEntries) await traverse(sub, nextPrefix);
      }
    }
    for (const entry of entries) await traverse(entry, "");
    return files;
  }

  async function uploadFileList(fileList: File[]) {
    if (!serverId || !directoryPath || fileList.length === 0) return;
    const { accepted, skipped } = splitUploadFiles(fileList);
    if (accepted.length === 0) {
      const message = skipped.length > 0 ? `已过滤 ${skipped.length} 个垃圾文件，无需上传` : "没有可上传的文件";
      setActionStatus(message);
      pushActivity(message);
      showToast("success", message);
      return;
    }
    const skippedCount = skipped.length;
    const total = accepted.length;
    const uploadDir = directoryPath.endsWith("/") ? directoryPath.slice(0, -1) : directoryPath;
    let currentUpload: { fileName: string; relativePath: string; localPath: string; targetPath: string; size: number } | null = null;
    setActionStatus(`正在上传 ${total} 个文件${skippedCount ? `（已过滤 ${skippedCount} 个垃圾文件）` : ""}...`);
    const tid = showToast("loading", `正在上传 ${total} 个文件${skippedCount ? `（已过滤 ${skippedCount} 个垃圾文件）` : ""}...`);
    try {
      for (let i = 0; i < accepted.length; i++) {
        const file = accepted[i];
        const relativePath = getUploadRelativePath(file);
        const localPath = getUploadLocalPath(file);
        const targetPath = `${uploadDir}/${relativePath}`;
        currentUpload = { fileName: file.name, relativePath, localPath, targetPath, size: file.size };
        setUploadProgress({ current: 0, total, fileName: `(${i + 1}/${total}) ${relativePath}`, fileSize: file.size, bytesUploaded: 0, speed: 0 });
        updateToast(tid, "loading", `正在上传 (${i + 1}/${total}) ${relativePath}...`);
        await uploadOneFile(file, targetPath);
        pushActivity(`已上传文件：${targetPath}`);
        appendTransferHistory({
          direction: "upload",
          status: "success",
          fileName: file.name,
          filePath: targetPath,
          size: file.size,
          localPath,
        });
      }
      setActionStatus(`已上传 ${total} 个文件到 ${uploadDir}${skippedCount ? `（跳过 ${skippedCount} 个垃圾文件）` : ""}`);
      updateToast(tid, "success", skippedCount ? `已上传 ${total} 个文件，已过滤 ${skippedCount} 个垃圾文件` : `已上传 ${total} 个文件`);
      await browseLogFiles(uploadDir);
    } catch (error) {
      const detail = error instanceof Error ? error.message : "未知错误";
      setActionStatus(`上传失败：${detail}`);
      pushActivity(`上传失败：${detail}`);
      if (currentUpload) {
        appendTransferHistory({
          direction: "upload",
          status: "error",
          fileName: currentUpload.fileName,
          filePath: currentUpload.targetPath,
          size: currentUpload.size,
          localPath: currentUpload.localPath,
          message: detail,
        });
      }
      updateToast(tid, "error", `上传失败：${detail}`);
    } finally {
      setUploadProgress(null);
    }
  }

  async function uploadFiles() {
    if (!serverId || !directoryPath) return;
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    input.onchange = async () => {
      const files = input.files;
      if (!files || files.length === 0) return;
      await uploadFileList(Array.from(files));
    };
    input.click();
  }

  async function uploadDirectory() {
    if (!serverId || !directoryPath) return;
    const input = document.createElement("input");
    input.type = "file";
    (input as any).webkitdirectory = true;
    input.onchange = async () => {
      const files = input.files;
      if (!files || files.length === 0) return;
      await uploadFileList(Array.from(files));
    };
    input.click();
  }

  function handleFileDrop(e: React.DragEvent) {
    e.preventDefault();
    setIsDragOver(false);
    if (!serverId || !directoryPath || isBusy) return;

    const items = e.dataTransfer.items;
    if (items && items.length > 0) {
      const entries: FileSystemEntry[] = [];
      for (let i = 0; i < items.length; i++) {
        const entry = items[i].webkitGetAsEntry?.();
        if (entry) entries.push(entry);
      }
      if (entries.some((en) => en.isDirectory)) {
        void (async () => {
          const allFiles = await collectFilesFromEntries(entries);
          if (allFiles.length > 0) void uploadFileList(allFiles);
        })();
        return;
      }
    }

    const files = Array.from(e.dataTransfer.files);
    if (files.length === 0) return;
    void uploadFileList(files);
  }

  function deleteRemoteFile(targetFile: string | LogFileEntry) {
    if (!serverId) return;
    const entry = typeof targetFile === "string"
      ? { path: targetFile, name: targetFile.split("/").pop() || targetFile, kind: "file" as const }
      : targetFile;
    const fileName = entry.name || entry.path.split("/").pop() || entry.path;
    const targetLabel = entry.kind === "directory" ? "目录" : "文件";
    const refreshPath = directoryPath && (directoryPath === entry.path || directoryPath.startsWith(`${entry.path}/`))
      ? entry.path.substring(0, entry.path.lastIndexOf("/")) || "/"
      : directoryPath;
    setConfirmDialog({
      title: `删除${targetLabel}`,
      message: entry.kind === "directory" ? `确定删除远程目录及其内容？\n${entry.path}` : `确定删除远程文件？\n${entry.path}`,
      danger: true,
      onConfirm: () => {
        void withBusy(`正在删除${targetLabel} ${fileName}...`, async () => {
          await apiDeleteFile(serverId, entry.path);
          setActionStatus(`已删除 ${fileName}`);
          pushActivity(`已删除${targetLabel}：${entry.path}`);
          if (refreshPath) await browseLogFiles(refreshPath);
        }, `已删除 ${fileName}`);
      }
    });
  }

  function toggleFileSelection(entryPath: string, nextSelected?: boolean) {
    setSelectedFilePaths((current) => {
      const next = new Set(current);
      const shouldSelect = nextSelected ?? !next.has(entryPath);
      if (shouldSelect) {
        next.add(entryPath);
      } else {
        next.delete(entryPath);
      }
      return [...next];
    });
  }

  function clearSelectedFiles() {
    setSelectedFilePaths([]);
  }

  function toggleAllVisibleFiles(nextSelected: boolean) {
    setSelectedFilePaths((current) => {
      const next = new Set(current);
      for (const entry of tableEntries) {
        if (nextSelected) {
          next.add(entry.path);
        } else {
          next.delete(entry.path);
        }
      }
      return [...next];
    });
  }

  async function deleteRemoteEntries(entries: LogFileEntry[]) {
    if (!serverId || entries.length === 0) return;
    const targetCount = entries.length;
    await withBusy(`正在删除 ${targetCount} 项...`, async () => {
      for (let index = 0; index < entries.length; index += 1) {
        const entry = entries[index];
        try {
          await apiDeleteFile(serverId, entry.path);
        } catch (error) {
          const detail = error instanceof Error ? error.message : "未知错误";
          throw new Error(`${detail}（已完成 ${index}/${targetCount}）`);
        }
      }
      clearSelectedFiles();
      setActionStatus(`已删除 ${targetCount} 项`);
      pushActivity(`批量删除 ${targetCount} 项：${entries.map((entry) => entry.path).join(" | ")}`);
      if (directoryPath) await browseLogFiles(directoryPath);
    }, `已删除 ${targetCount} 项`);
  }

  function confirmDeleteSelectedFiles(entries: LogFileEntry[] = selectedFileEntries) {
    if (!serverId || entries.length === 0) return;
    const targetCount = entries.length;
    const directoryCount = entries.filter((entry) => entry.kind === "directory").length;
    const fileCount = targetCount - directoryCount;
    const summary = targetCount === 1
      ? entries[0].path
      : `${fileCount > 0 ? `${fileCount} 个文件` : ""}${fileCount > 0 && directoryCount > 0 ? "，" : ""}${directoryCount > 0 ? `${directoryCount} 个目录` : ""}`;
    setConfirmDialog({
      title: targetCount === 1 ? `删除${entries[0].kind === "directory" ? "目录" : "文件"}` : `批量删除 ${targetCount} 项`,
      message: targetCount === 1 ? `确定删除？\n${entries[0].path}` : `确定批量删除以下内容？\n${summary}`,
      danger: true,
      onConfirm: () => {
        void deleteRemoteEntries(entries);
      }
    });
  }

  function openRenameDialog(entry: LogFileEntry) {
    setRenameDialog({ entry, newName: entry.name });
  }

  async function renameRemoteFile(entry: LogFileEntry, newName: string) {
    if (!serverId || !newName.trim() || newName === entry.name) return;
    const parentDir = entry.path.substring(0, entry.path.lastIndexOf("/")) || "/";
    const newPath = parentDir + "/" + newName.trim();
    await withBusy(`正在重命名 ${entry.name}...`, async () => {
      await apiRenameFile(serverId, entry.path, newPath);
      setActionStatus(`已重命名 ${entry.name} → ${newName.trim()}`);
      pushActivity(`重命名：${entry.name} → ${newName.trim()}`);
      if (directoryPath) await browseLogFiles(directoryPath);
    }, `已重命名 ${entry.name} → ${newName.trim()}`);
  }

  function openMoveDialog(entry: LogFileEntry) {
    setMoveDialog({ entry, targetDir: directoryPath || "/" });
  }

  function openBatchMoveDialog(entries: LogFileEntry[] = selectedFileEntries) {
    if (!entries.length) return;
    setBatchMoveDialog({ entries, targetDir: directoryPath || "/" });
  }

  function buildMovedPath(targetDir: string, entryName: string) {
    const normalizedTargetDir = targetDir.trim().replace(/\/+$/, "") || "/";
    return normalizedTargetDir === "/" ? `/${entryName}` : `${normalizedTargetDir}/${entryName}`;
  }

  async function moveRemoteFile(entry: LogFileEntry, targetDir: string) {
    if (!serverId || !targetDir.trim()) return;
    const newPath = buildMovedPath(targetDir, entry.name);
    if (newPath === entry.path) return;
    await withBusy(`正在移动 ${entry.name}...`, async () => {
      await apiRenameFile(serverId, entry.path, newPath);
      setActionStatus(`已移动 ${entry.name} → ${targetDir}`);
      pushActivity(`移动：${entry.path} → ${newPath}`);
      if (directoryPath) await browseLogFiles(directoryPath);
    }, `已移动 ${entry.name}`);
  }

  async function moveRemoteEntries(entries: LogFileEntry[], targetDir: string) {
    if (!serverId || !targetDir.trim() || entries.length === 0) return;
    const moveTargets = entries
      .map((entry) => ({ entry, newPath: buildMovedPath(targetDir, entry.name) }))
      .filter(({ entry, newPath }) => newPath !== entry.path);
    if (moveTargets.length === 0) return;
    await withBusy(`正在移动 ${moveTargets.length} 项...`, async () => {
      for (let index = 0; index < moveTargets.length; index += 1) {
        const { entry, newPath } = moveTargets[index];
        try {
          await apiRenameFile(serverId, entry.path, newPath);
        } catch (error) {
          const detail = error instanceof Error ? error.message : "未知错误";
          throw new Error(`${detail}（已完成 ${index}/${moveTargets.length}）`);
        }
      }
      clearSelectedFiles();
      setActionStatus(`已移动 ${moveTargets.length} 项 → ${targetDir}`);
      pushActivity(`批量移动 ${moveTargets.length} 项到 ${targetDir}`);
      if (directoryPath) await browseLogFiles(directoryPath);
    }, `已移动 ${moveTargets.length} 项`);
  }

  async function extractZipFile(filePath: string, targetDir?: string) {
    if (!serverId) return;
    const fileName = filePath.split("/").pop() || filePath;
    await withBusy(`正在解压 ${fileName}...`, async () => {
      const result = await apiExtractZip(serverId, filePath, targetDir);
      setActionStatus(`已解压 ${fileName} 到 ${result.targetDir}`);
      pushActivity(`已解压：${filePath} → ${result.targetDir}`);
      if (directoryPath) await browseLogFiles(directoryPath);
    }, `已解压 ${fileName}`);
  }

  async function mkdirRemoteDir(parentDir: string, dirName: string) {
    if (!serverId || !dirName.trim()) return;
    const fullPath = parentDir === "/" ? `/${dirName.trim()}` : `${parentDir}/${dirName.trim()}`;
    await withBusy(`正在创建目录 ${dirName.trim()}...`, async () => {
      await apiMkdir(serverId, fullPath);
      setActionStatus(`已创建目录 ${dirName.trim()}`);
      pushActivity(`新建目录：${fullPath}`);
      if (directoryPath) await browseLogFiles(directoryPath);
    }, `已创建目录 ${dirName.trim()}`);
  }

  async function compressRemotePath(sourcePath: string, archiveType: "tar.gz" | "zip", targetDir?: string) {
    if (!serverId) return;
    const sourceName = sourcePath.split("/").pop() || sourcePath;
    await withBusy(`正在压缩 ${sourceName}...`, async () => {
      const result = await apiCompress(serverId, sourcePath, archiveType, targetDir);
      setActionStatus(`已压缩 ${sourceName} → ${result.archivePath}`);
      pushActivity(`压缩：${sourcePath} → ${result.archivePath}`);
      if (directoryPath) await browseLogFiles(directoryPath);
    }, `已压缩 ${sourceName}`);
  }

  async function previewFile(entry: LogFileEntry) {
    if (isBusy || !serverId || entry.kind !== "file") return;
    const sizeBytes = typeof entry.size === "number" ? entry.size : 0;
    const editLimit = 10 * 1024 * 1024;
    if (sizeBytes > editLimit) {
      setConfirmDialog({
        title: "大文件预览",
        message: `文件较大（${formatBytes(sizeBytes)}），将以只读模式显示尾部内容。`,
        onConfirm: () => void doLoadFile(entry),
      });
      return;
    }
    const warnLimit = 2 * 1024 * 1024;
    if (sizeBytes > warnLimit) {
      setConfirmDialog({
        title: "大文件编辑",
        message: `文件较大（${formatBytes(sizeBytes)}），加载可能需要较长时间，是否继续？`,
        onConfirm: () => void doLoadFile(entry),
      });
      return;
    }
    void doLoadFile(entry);
  }

  async function doLoadFile(entry: LogFileEntry) {
    setPreviewDialog({ filePath: entry.path, fileName: entry.name, content: "", originalContent: "", size: typeof entry.size === "number" ? entry.size : 0, loading: true });
    try {
      const data = await apiPreviewFile(serverId, entry.path);
      setPreviewDialog({ filePath: data.filePath, fileName: entry.name, content: data.content, originalContent: data.content, size: data.size, readOnly: data.readOnly });
      pushActivity(`${data.readOnly ? "预览" : "打开"}文件：${entry.name}（${formatBytes(data.size)}）`);
    } catch (error) {
      setPreviewDialog(null);
      setActionStatus(`加载失败：${error instanceof Error ? error.message : "未知错误"}`);
    }
  }

  async function saveFileContent() {
    if (!previewDialog || !serverId) return;
    if (previewDialog.content === previewDialog.originalContent) return;
    setPreviewDialog((prev) => prev ? { ...prev, saving: true } : null);
    const tid = showToast("loading", `正在保存 ${previewDialog.fileName}...`);
    try {
      await apiSaveFile(serverId, previewDialog.filePath, previewDialog.content);
      setPreviewDialog((prev) => prev ? { ...prev, originalContent: prev.content, saving: false } : null);
      setActionStatus(`已保存 ${previewDialog.fileName}`);
      pushActivity(`保存文件：${previewDialog.filePath}`);
      updateToast(tid, "success", `已保存 ${previewDialog.fileName}`);
    } catch (error) {
      setPreviewDialog((prev) => prev ? { ...prev, saving: false } : null);
      const detail = error instanceof Error ? error.message : "未知错误";
      setActionStatus(`保存失败：${detail}`);
      updateToast(tid, "error", `保存失败：${detail}`);
    }
  }

  async function openEntry(entry: LogFileEntry) {
    if (entry.kind === "directory") {
      await browseLogFiles(entry.path, { manual: true });
      return;
    }

    const requestId = openFileRequestRef.current + 1;
    openFileRequestRef.current = requestId;
    stopLiveFollow();
    setFilePath(entry.path);
    resetFileReaderState();
    setShowFileTools(false);
    setActiveViewerTabId("file");
    setActiveLogView("search");
    setFileLoadingName(entry.name);
    pushActivity(`已选择日志文件：${entry.path}`);
    setIsBusy(true);
    setActionStatus("正在打开日志文件...");
    try {
      // Single API call: offset=-1 means "read tail", backend computes offset and returns fileSize
      const effectiveLength = sliceLengthMode === "auto" ? computeAutoSliceLength(0) : sliceLength;
      const slicePayload = await fetchLogSlice(entry.path, -1, effectiveLength);
      if (openFileRequestRef.current !== requestId || slicePayload.filePath !== entry.path) {
        return;
      }

      // Derive meta from slice response (saves a separate SSH round-trip)
      const derivedSize = slicePayload.fileSize ?? (slicePayload.actualOffset + slicePayload.actualLength);
      setFileMeta({
        filePath: entry.path,
        size: derivedSize,
        modifiedTime: slicePayload.modifiedTime ?? new Date().toISOString(),
        readable: true,
        encodingHint: "utf-8"
      });

      // Re-compute slice length now that we know the real file size
      const realEffectiveLength = sliceLengthMode === "auto" ? computeAutoSliceLength(derivedSize) : sliceLength;
      if (sliceLengthMode === "auto" && realEffectiveLength !== sliceLength) {
        setSliceLength(realEffectiveLength);
      }

      cacheSlicePayload(slicePayload, slicePayload.actualOffset, realEffectiveLength);
      warmNeighborSlices(entry.path, slicePayload, realEffectiveLength);
      sliceRequestRef.current += 1;
      setSliceOffset(slicePayload.actualOffset);
      setSliceData(slicePayload);
      setFileLoadingName("");
      setActionStatus(`已打开 ${entry.name}，尾部切片已加载。`);
      pushActivity(`已打开日志文件：${entry.path}，尾部 ${formatBytes(slicePayload.actualLength)} 已显示。`);

      const lowerName = entry.name.toLowerCase();
      if (lowerName.endsWith(".log") || lowerName.endsWith(".out")) {
        startLiveFollow(entry.path, entry.name);
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : "未知错误";
      setActionStatus(`打开失败：${detail}`);
      pushActivity(`打开失败：${detail}`);
      showToast("error", `打开失败：${detail}`);
    } finally {
      setIsBusy(false);
      setFileLoadingName("");
    }
  }

  async function loadFileMeta(targetFilePath?: string) {
    const nextFilePath = targetFilePath || filePath;
    if (!nextFilePath.trim()) {
      return;
    }

    await withBusy("正在读取日志元信息...", async () => {
      const payload = await fetchLogMeta(nextFilePath);
      if (payload.filePath !== nextFilePath) {
        return;
      }
      setFileMeta(payload);
      setActionStatus(`已读取元信息，文件大小 ${formatBytes(payload.size)}。`);
      pushActivity(`已读取元信息：${payload.filePath}，大小 ${formatBytes(payload.size)}。`);
    });
  }

  async function loadSlice(targetOffset = sliceOffset, targetLength = sliceLength) {
    const targetFilePath = filePath;
    if (!targetFilePath.trim()) {
      return;
    }

    const cachedPayload = getCachedSlice(targetFilePath, targetOffset, targetLength);
    if (cachedPayload) {
      applySlicePayload(cachedPayload, {
        status: `已从缓存切换，偏移 ${formatNumber(cachedPayload.actualOffset)}。`,
        activity: `已命中缓存切片：偏移 ${formatNumber(cachedPayload.actualOffset)}。`
      });
      warmNeighborSlices(targetFilePath, cachedPayload, targetLength);
      return;
    }

    const requestId = sliceRequestRef.current + 1;
    sliceRequestRef.current = requestId;
    await withBusy("正在按切片读取日志...", async () => {
      const payload = await fetchLogSlice(targetFilePath, targetOffset, targetLength);
      if (sliceRequestRef.current !== requestId || payload.filePath !== targetFilePath) {
        return;
      }
      cacheSlicePayload(payload, targetOffset, targetLength);
      warmNeighborSlices(targetFilePath, payload, targetLength);
      applySlicePayload(payload, {
        status: `切片加载完成，偏移 ${formatNumber(payload.actualOffset)}，返回 ${formatBytes(payload.actualLength)}。`,
        activity: `切片读取完成：偏移 ${formatNumber(payload.actualOffset)}，长度 ${formatBytes(payload.actualLength)}。`
      });
    });
  }

  async function navigateSlice(direction: "prev" | "next", source: "button" | "wheel" | "keyboard" = "button") {
    if (!filePath.trim() || isBusy) {
      return;
    }

    if (liveFollowEnabled && !liveFollowPaused) {
      setLiveFollowPaused(true);
      pushActivity(`翻页浏览中，实时跟随已暂停。滚到底部可恢复。`);
    }

    if (direction === "prev") {
      if (sliceOffset <= 0 || sliceData?.isStart) {
        return;
      }
      sliceScrollAnchorRef.current = "bottom";
      if (source === "wheel") {
        wheelSliceLockRef.current = true;
      }
      await loadSlice(Math.max(0, sliceOffset - sliceLength), sliceLength);
      return;
    }

    if (sliceData?.isEnd) {
      return;
    }

    sliceScrollAnchorRef.current = "top";
    if (source === "wheel") {
      wheelSliceLockRef.current = true;
    }
    await loadSlice(sliceData?.nextOffset ?? sliceOffset + sliceLength, sliceLength);
  }

  function handleViewerWheel(event: ReactWheelEvent<HTMLDivElement>) {
    if (activeLogView !== "search" || activeViewerTabId !== "file" || !filePath.trim() || isBusy || wheelSliceLockRef.current) {
      return;
    }

    const scrollState = virtualViewerRef.current?.getScrollState();
    if (!scrollState) return;

    const { scrollTop, scrollHeight, clientHeight } = scrollState;
    const maxScrollTop = Math.max(0, scrollHeight - clientHeight);
    const nearTop = scrollTop <= 4;
    const nearBottom = scrollTop >= maxScrollTop - 4;

    if (event.deltaY < 0 && nearTop && sliceOffset > 0 && !sliceData?.isStart) {
      void navigateSlice("prev", "wheel");
      return;
    }

    if (event.deltaY > 0 && nearBottom && !sliceData?.isEnd) {
      void navigateSlice("next", "wheel");
    }
  }

  async function loadTailSlice() {
    const targetFilePath = filePath;
    if (!targetFilePath.trim()) {
      return;
    }
    sliceScrollAnchorRef.current = "bottom";

    const meta = activeFileMeta;
    const cachedTailOffset = meta ? Math.max(0, meta.size - sliceLength) : null;
    if (meta && cachedTailOffset !== null) {
      const cachedPayload = getCachedSlice(targetFilePath, cachedTailOffset, sliceLength);
      if (cachedPayload) {
        applySlicePayload(cachedPayload, {
          status: `已跳转到文件尾部，当前偏移 ${formatNumber(cachedPayload.actualOffset)}。`,
          activity: `已跳转文件尾部：${targetFilePath}。`
        });
        warmNeighborSlices(targetFilePath, cachedPayload, sliceLength);
        return;
      }
    }

    const requestId = sliceRequestRef.current + 1;
    sliceRequestRef.current = requestId;
    await withBusy("正在定位文件尾部切片...", async () => {
      const resolvedMeta =
        (activeFileMeta?.filePath === targetFilePath ? activeFileMeta : null) ??
        (await (async () => {
          const payload = await fetchLogMeta(targetFilePath);
          if (payload.filePath !== targetFilePath || sliceRequestRef.current !== requestId) {
            return null;
          }
          setFileMeta(payload);
          return payload;
        })());
      if (!resolvedMeta) {
        return;
      }

      const nextOffset = Math.max(0, resolvedMeta.size - sliceLength);
      const payload = await fetchLogSlice(targetFilePath, nextOffset, sliceLength);
      if (sliceRequestRef.current !== requestId || payload.filePath !== targetFilePath) {
        return;
      }
      cacheSlicePayload(payload, nextOffset, sliceLength);
      warmNeighborSlices(targetFilePath, payload, sliceLength);
      applySlicePayload(payload, {
        status: `已跳转到文件尾部，当前偏移 ${formatNumber(payload.actualOffset)}。`,
        activity: `已跳转文件尾部：${targetFilePath}。`
      });
    });
  }

  async function handleBackToBottom() {
    if (liveFollowEnabled) {
      if (liveFollowPaused) {
        setLiveFollowPaused(false);
      }
      sliceScrollAnchorRef.current = "bottom";
      scrollViewerToBottom();
      return;
    }

    if (!sliceData?.isEnd) {
      await loadTailSlice();
      return;
    }

    sliceScrollAnchorRef.current = "bottom";
    scrollViewerToBottom();
  }

  async function loadHeadSlice() {
    const targetFilePath = filePath;
    if (!targetFilePath.trim()) {
      return;
    }
    sliceScrollAnchorRef.current = "top";
    if (liveFollowEnabled) {
      setLiveFollowPaused(true);
    }
    const cachedPayload = getCachedSlice(targetFilePath, 0, sliceLength);
    if (cachedPayload) {
      applySlicePayload(cachedPayload, {
        status: "已跳转到文件头部。",
        activity: `已跳转文件头部：${targetFilePath}。`
      });
      warmNeighborSlices(targetFilePath, cachedPayload, sliceLength);
      return;
    }
    const requestId = sliceRequestRef.current + 1;
    sliceRequestRef.current = requestId;
    await withBusy("正在定位文件头部切片...", async () => {
      const payload = await fetchLogSlice(targetFilePath, 0, sliceLength);
      if (sliceRequestRef.current !== requestId || payload.filePath !== targetFilePath) {
        return;
      }
      cacheSlicePayload(payload, 0, sliceLength);
      warmNeighborSlices(targetFilePath, payload, sliceLength);
      applySlicePayload(payload, {
        status: "已跳转到文件头部。",
        activity: `已跳转文件头部：${targetFilePath}。`
      });
    });
  }

  async function jumpToSliceRatio(ratio: number) {
    const targetFilePath = filePath;
    if (!targetFilePath.trim()) {
      return;
    }
    sliceScrollAnchorRef.current = "top";
    if (liveFollowEnabled) {
      setLiveFollowPaused(true);
    }
    const directMeta = activeFileMeta?.filePath === targetFilePath ? activeFileMeta : null;
    if (directMeta) {
      const targetOffset = clampSliceStart(directMeta.size, Math.floor(directMeta.size * ratio), sliceLength);
      const cachedPayload = getCachedSlice(targetFilePath, targetOffset, sliceLength);
      if (cachedPayload) {
        applySlicePayload(cachedPayload, {
          status: `已跳转到 ${formatPercent(ratio * 100)} 附近，当前偏移 ${formatNumber(cachedPayload.actualOffset)}。`,
          activity: `已跳转日志位置：${formatPercent(ratio * 100)} / ${targetFilePath}。`
        });
        warmNeighborSlices(targetFilePath, cachedPayload, sliceLength);
        return;
      }
    }
    const requestId = sliceRequestRef.current + 1;
    sliceRequestRef.current = requestId;
    await withBusy("正在按位置跳转日志...", async () => {
      const meta =
        (activeFileMeta?.filePath === targetFilePath ? activeFileMeta : null) ??
        (await (async () => {
          const payload = await fetchLogMeta(targetFilePath);
          if (payload.filePath !== targetFilePath || sliceRequestRef.current !== requestId) {
            return null;
          }
          setFileMeta(payload);
          return payload;
        })());
      if (!meta) {
        return;
      }

      const targetOffset = clampSliceStart(meta.size, Math.floor(meta.size * ratio), sliceLength);
      const payload = await fetchLogSlice(targetFilePath, targetOffset, sliceLength);
      if (sliceRequestRef.current !== requestId || payload.filePath !== targetFilePath) {
        return;
      }
      cacheSlicePayload(payload, targetOffset, sliceLength);
      warmNeighborSlices(targetFilePath, payload, sliceLength);
      applySlicePayload(payload, {
        status: `已跳转到 ${formatPercent(ratio * 100)} 附近，当前偏移 ${formatNumber(payload.actualOffset)}。`,
        activity: `已跳转日志位置：${formatPercent(ratio * 100)} / ${targetFilePath}。`
      });
    });
  }

  async function commitReaderPosition(nextPercent: number) {
    setReaderPositionDragging(false);
    if (readerDraftFrameRef.current !== null) {
      window.cancelAnimationFrame(readerDraftFrameRef.current);
      readerDraftFrameRef.current = null;
    }
    if (!canDragReaderPosition) {
      setReaderPositionDraft(0);
      setReaderPreviewContent("");
      setReaderPreviewOffset(null);
      setReaderPreviewLoading(false);
      return;
    }

    const normalizedPercent = Math.max(0, Math.min(100, nextPercent));
    setReaderPositionDraft(normalizedPercent);
    setReaderPreviewContent("");
    setReaderPreviewOffset(null);
    setReaderPreviewLoading(false);
    sliceScrollAnchorRef.current = "top";
    await jumpToSliceRatio(normalizedPercent / 100);
  }

  function startReaderRailDrag(clientY: number) {
    if (!canDragReaderPosition || isBusy) {
      return;
    }

    const rail = readerRailRef.current;
    if (!rail) {
      return;
    }

    const rect = rail.getBoundingClientRect();
    if (!rect.height) {
      return;
    }

    const nextPercent = clampPercent(((clientY - rect.top) / rect.height) * 100);
    setReaderPositionDragging(true);
    setReaderPreviewLoading(false);
    setReaderPositionDraft(nextPercent);
  }

  function startViewerOverviewDrag(clientY: number) {
    const rail = viewerOverviewRailRef.current;
    if (!rail) {
      return;
    }

    const rect = rail.getBoundingClientRect();
    if (!rect.height) {
      return;
    }

    const nextPercent = clampPercent(((clientY - rect.top) / rect.height) * 100);
    setViewerOverviewDragging(true);
    setViewerOverviewDraft(nextPercent);
    if (viewerOverviewTotalLines) {
      const targetLine = Math.round((nextPercent / 100) * Math.max(0, viewerOverviewTotalLines - 1));
      virtualViewerRef.current?.scrollToLine(targetLine, "auto");
    }
  }

  async function exportCurrentResults() {
    const exportContent = activeResultTab?.content || (results ? results.rawOutput : "");
    if (!exportContent) {
      return;
    }

    await downloadTextFile(exportContent, `server-log-console/检索结果-${Date.now()}.log`);
    setActionStatus("当前结果页已触发下载。");
    pushActivity("已触发当前结果页下载。");
  }

  if (isStandaloneTerminalWindow) {
    return (
      <main className={`app-shell${uiTheme === "modern" ? " theme-modern" : ""}${isElectron ? " electron-immersive" : ""}${isElectron && isMacOS ? " electron-macos-immersive" : ""} pip-standalone pip-terminal-standalone`}>
        <section className="main-panel-terminal-standalone">
          <TerminalPanel
            popupMode="standalone"
            server={selectedServer}
            connected={terminalSession.connected}
            isBusy={isBusy}
            serverId={serverId}
            statusText={terminalPanelStatusText}
            subtitleText={terminalConnectionLabel}
            detached={false}
            terminalOverlay={terminalOverlay}
            containerRef={terminalSession.containerRef}
            onReconnect={() => openTerminalView()}
            onClose={() => window.close()}
            onCloseTerminalOverlay={closeTerminalOverlay}
            onFocus={() => terminalSession.focusTerminal()}
            onDetach={() => undefined}
            onAttach={() => undefined}
            onFit={() => terminalSession.fitTerminal()}
            selMenu={termSelMenu}
            clearSelection={() => terminalSession.clearSelection()}
            pasteToTerminal={(text) => terminalSession.pasteToTerminal(text)}
            onToggleTerminalOverlay={toggleTerminalOverlay}
            onDismissMenu={() => setTermSelMenu(null)}
          />
        </section>
      </main>
    );
  }

  return (
    <main className={`app-shell${uiTheme === "modern" ? " theme-modern" : ""}${isElectron ? " electron-immersive" : ""}${isElectron && isMacOS ? " electron-macos-immersive" : ""}${isStandalonePipWindow ? " pip-standalone" : ""}`}>
      <section className="shell-layout">
        <aside className="sidebar-panel">
          <div className="sidebar-head">
            <div className="sidebar-head-row">
              <div className="sidebar-head-title">
                <p className="eyebrow">日志控制台</p>
                <h1 className="topbar-title">日志控制台</h1>
              </div>
              <div className="sidebar-head-buttons">
                <button
                  className="ghost-button icon-button"
                  title={showConnectionSettings ? "关闭设置" : "打开设置"}
                  onClick={() => {
                    if (showConnectionSettings) {
                      closeSettingsWorkspace();
                      return;
                    }
                    openSettingsWorkspace();
                  }}
                >
                  <ToolIcon theme={uiTheme} kind="settings" />
                </button>
              </div>
            </div>
            <p className="status-inline">{actionStatus}</p>
          </div>

          <section className="pane-section">
            <div className="pane-title-row"><strong className="pane-title">服务器</strong>{servers.length > 0 && <span>{servers.length} 台</span>}</div>
            <input
              value={serverFilter}
              onChange={(event) => setServerFilter(event.target.value)}
              placeholder="输入名称、分组或地址"
            />
          </section>

          <div className="server-groups pane-section">
            {showServiceOfflineState ? (
              <div className="empty-box sidebar-empty-box">
                <strong>{isElectron ? "正在等待内置连接服务启动" : "本地服务未启动"}</strong>
                <span>{isElectron ? "应用会自动重试连接本地服务；如果长时间没有恢复，我会继续排查安装版启动链路。" : "请在终端执行 npm run dev:gateway 启动本地连接服务，然后点击下方\"检查服务\"。"}</span>
              </div>
            ) : filteredGroupedServers.length ? (
              filteredGroupedServers.map(([groupName, groupServers]) => (
                <section key={groupName} className="server-group">
                  <div className="server-group-title">{groupName}</div>
                  <div className="server-list">
                    {groupServers
                      .map((server) => (
                        <button
                          key={server.id}
                          type="button"
                          className={`server-item ${server.id === serverId ? "server-item-active" : ""}`}
                          onClick={() => {
                            selectServerById(server.id);
                          }}
                        >
                          <span className={`server-status-dot ${server.id === serverId ? (connectionTestStatus?.connected ? "dot-connected" : "dot-pending") : "dot-idle"}`} />
                          <span className="server-item-main">
                            <strong>{server.name}</strong>
                            <span>{server.host}</span>
                          </span>
                          <span className="server-item-meta">{server.port}</span>
                        </button>
                      ))}
                  </div>
                </section>
              ))
            ) : (
              <div className="empty-box sidebar-empty-box">
                <strong>还没有服务器</strong>
                <span>检查 FinalShell 目录后导入，或手动补录连接信息。</span>
              </div>
            )}
          </div>

          <div className="status-card status-grid pane-section compact-connection-card">
            <div className="pane-title">连接概览</div>
            <div className="status-row"><span>本地服务</span><strong>{localServiceStatusText}</strong></div>
            <div className="status-row"><span>服务器</span><strong>{connectionStateText}</strong></div>
            <div className="status-row"><span>主机</span><strong>{selectedServer ? `${selectedServer.username}@${selectedServer.host}` : "--"}</strong></div>
            <div className="status-row status-row-path"><span>路径</span><strong>{directoryPath || "/"}</strong></div>
          </div>

          <section className="activity-panel pane-section compact-activity-panel" style={{ height: activityPanelHeight }}>
            <div
              className="activity-panel-resizer"
              onPointerDown={handleActivityPanelResizeStart}
              role="separator"
              aria-orientation="horizontal"
              aria-label="调整操作记录高度"
            />
            <div className="browser-column-head pane-title-row">
              <strong className="pane-title">操作记录</strong>
              <span>{sidebarActivityLines.length} 条</span>
            </div>
            <div className="activity-log-list compact-activity-log-list">
              {sidebarActivityLines.map((line, index) => {
                const text = line.replace(/^\[[^\]]+\]\s*/, "");
                return (
                  <div key={index} className="activity-log-line">
                    <span className="activity-log-msg">{text}</span>
                  </div>
                );
              })}
            </div>
          </section>
        </aside>

      <section className={`main-panel ${isFileMode ? "main-panel-files" : ""}${(terminalPanelOpen || terminalDetached) ? " main-panel-with-terminal" : ""}`}>
          {!isStandalonePipWindow && workspaceSessions.length > 0 ? (
            <div className="workspace-session-strip">
              <div className="workspace-session-tabs-shell">
                <div className="workspace-session-strip-head">
                  <span className="workspace-session-strip-label">工作区</span>
                  <span className="workspace-session-strip-count">共 {workspaceSessions.length} 个</span>
                </div>
                <div className="workspace-session-tabs">
                  {workspaceSessions.map((session) => {
                    const isActiveSession = session.id === activeWorkspaceSessionId;
                    return (
                      <div
                        key={session.id}
                        className={`workspace-session-tab ${isActiveSession ? "workspace-session-tab-active" : ""}`}
                        onContextMenu={(event) => {
                          event.preventDefault();
                          const menuWidth = 160;
                          const menuHeight = 140;
                          const nextX = Math.min(Math.max(8, event.clientX), Math.max(8, window.innerWidth - menuWidth - 8));
                          const nextY = Math.min(Math.max(8, event.clientY), Math.max(8, window.innerHeight - menuHeight - 8));
                          setWorkspaceTabMenu({ x: nextX, y: nextY, session });
                        }}
                      >
                        <button
                          className="workspace-session-tab-trigger"
                          type="button"
                          title={session.serverHost ? `${session.serverName} · ${session.serverHost}` : session.serverName}
                          disabled={isWorkspaceSwitchLocked && !isActiveSession}
                          onClick={() => activateWorkspaceSession(session)}
                        >
                          <span className="workspace-session-tab-label">{session.serverName}</span>
                        </button>
                        <button
                          className="ghost-button icon-button workspace-session-tab-close"
                          type="button"
                          aria-label={`关闭 ${session.serverName}`}
                          disabled={isWorkspaceSwitchLocked}
                          onClick={() => closeWorkspaceSession(session.id)}
                        >
                          <X size={12} strokeWidth={1.5} />
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          ) : null}
          <section className="toolbar-panel">
            <div className="toolbar-commandbar">
              <nav
                className={`toolbar-breadcrumb${isFileMode ? " breadcrumb-active" : ""}`}
                onClick={() => { if (serverId) setActiveLogView(activeLogView === "files" ? "search" : "files"); }}
                title={serverId ? (activeLogView === "files" ? "点击返回搜索结果" : "点击打开文件列表") : "先选择服务器"}
                role="button"
                tabIndex={serverId ? 0 : -1}
                onKeyDown={(e) => { if (e.key === "Enter" && serverId) setActiveLogView(activeLogView === "files" ? "search" : "files"); }}
              >
                <span className="breadcrumb-segment breadcrumb-server">
                  {selectedServer?.name || selectedServer?.host || (serverId ? serverId : "未选择服务器")}
                </span>
                {breadcrumbDirectoryLabel ? (
                  <>
                    <span className="breadcrumb-sep" aria-hidden="true">/</span>
                    <span className="breadcrumb-segment breadcrumb-dir">{"\u202D"}{breadcrumbDirectoryLabel}{"\u202C"}</span>
                  </>
                ) : null}
                {breadcrumbFileName ? (
                  <>
                    <span className="breadcrumb-sep" aria-hidden="true">/</span>
                    <span className="breadcrumb-segment breadcrumb-file">{breadcrumbFileName}</span>
                  </>
                ) : null}
              </nav>
              <SearchToolbarActions
                uiTheme={uiTheme}
                isElectron={isElectron}
                isPinned={isPinned}
                onTogglePin={async () => {
                  const p = await (window as any).electronAPI.togglePin();
                  setIsPinned(p);
                }}
                canOpenTerminal={canOpenTerminal}
                terminalDetached={terminalDetached}
                terminalPanelOpen={terminalPanelOpen}
                onToggleTerminal={toggleTerminalPanel}
                hasServer={!!serverId}
                isRecording={!!recordingSession}
                canToggleRecording={canToggleRecording}
                onToggleRecording={() => {
                  void (recordingSession ? stopLogRecording() : startLogRecording());
                }}
                showQueryAdvanced={showQueryAdvanced}
                onToggleQueryAdvanced={() => {
                  setShowQueryAdvanced((current) => !current);
                }}
              />
            </div>

            <SearchQueryPanel
              showKeywordBar={showKeywordBar}
              showQueryAdvanced={showQueryAdvanced}
              hasServer={!!serverId}
              keywordInputRef={keywordInputRef}
              onKeywordInputChange={setKeywordInput}
              onRunSearch={() => { void runSearch(); }}
              onClearKeyword={() => setKeywordInput("")}
              showSummary={showSearchSummary}
              toolbarSummaryLabel={toolbarSummaryLabel}
              toolbarMetaLabel={toolbarMetaLabel}
              settings={{
                keywordInput,
                keywordMode,
                contextLines,
                useRegex,
                selectedPreset,
                startDate,
                endDate,
                startTime,
                endTime,
              }}
              onKeywordModeChange={setKeywordMode}
              onContextLinesChange={setContextLines}
              onToggleRegex={() => {
                setUseRegex(!useRegex);
                setSelectedPreset(!useRegex ? "正则" : "自定义");
              }}
              onStartDateChange={setStartDate}
              onEndDateChange={setEndDate}
              onStartTimeChange={setStartTime}
              onEndTimeChange={setEndTime}
              searchPresets={searchPresets}
              onResetAdvanced={() => {
                setKeywordInput("");
                setStartDate("");
                setEndDate("");
                setStartTime("");
                setEndTime("");
                setSelectedPreset("自定义");
              }}
            />

            {/* connection info in sidebar */}

            {searchStartedAt ? (
              <SearchProgressPanel
                phaseLabel={searchProgressPhaseLabel}
                elapsedLabel={searchElapsedLabel}
                strategyLabel={liveStrategyLabel}
                overallProgressLabel={searchOverallProgressLabel}
                phaseProgressLabel={searchPhaseProgressLabel}
                matchCountLabel={searchProgressMatchLabel}
                progressPercent={searchTask?.progressPercent ?? null}
              />
            ) : null}
          </section>

          <section className={`workspace-panel ${isFileMode ? "workspace-panel-files" : ""}`}>
            {showServiceOfflineState ? (
              <div className="workspace-startup-card">
                <div className="workspace-startup-head">
                  <strong>{isElectron ? "正在等待内置连接服务启动" : "本地连接服务未启动"}</strong>
                  <span>{isElectron ? "安装版会自动拉起内置连接服务；恢复后页面会自动刷新服务器与目录状态。" : "步骤：1. 在项目根目录执行 npm run dev:gateway 2. 点击右侧\"检查服务\" 3. 服务就绪后导入 FinalShell 或手动添加服务器"}</span>
                </div>
                <div className="toolbar-inline">
                  <button className="ghost-button" type="button" onClick={() => void checkLocalServiceHealth()}>
                    检查服务
                  </button>
                  <button className="ghost-button" type="button" onClick={() => openSettingsWorkspace("overview")}>
                    连接设置
                  </button>
                </div>
              </div>
            ) : showNoServerState ? (
              <div className="workspace-startup-card">
                <div className="workspace-startup-head">
                  <strong>本地服务已启动，但还没有服务器</strong>
                  <span>导入 FinalShell 连接后，左侧会自动出现服务器列表。</span>
                </div>
                <div className="toolbar-inline">
                  <button className="ghost-button" type="button" onClick={() => openSettingsWorkspace("overview")}>
                    连接设置
                  </button>
                  <button className="ghost-button" type="button" onClick={importFromFinalShell}>
                    立即导入
                  </button>
                  <button className="ghost-button" type="button" onClick={() => void fetchServers()}>
                    刷新列表
                  </button>
                </div>
              </div>
            ) : (
              <>
                {(!isFileMode || pip.isPip) ? (
                <div style={isFileMode ? { display: "none" } : { display: "contents" }}>
                {pip.isPip && !isFileMode && (
                  <div className="viewer-pip-placeholder">
                    <PictureInPicture2 size={24} strokeWidth={1.5} />
                    <strong>日志查看器已弹出到独立小窗</strong>
                    <button className="ghost-button" onClick={() => void pip.togglePip()}>收回</button>
                  </div>
                )}
                {((node: ReactNode) => pip.isPip && pip.pipWindow ? createPortal(node, pip.pipWindow.document.body) : pip.isPip && !pip.pipWindow ? null : node)(
                <div className={showCompactViewerChrome ? "pip-viewer-root" : "pip-viewer-wrap"}>
                {showCompactViewerChrome ? (
                  <>
                  <div className={`viewer-floating-header${isStandaloneViewerWindow ? " viewer-floating-header-standalone" : ""}`}>
                    <div className="viewer-floating-header-spacer" />
                    <div className="viewer-floating-header-title">
                      <strong>{compactViewerTitle}</strong>
                    </div>
                    <div className="viewer-floating-header-actions">
                      <div className="viewer-debug-anchor" ref={viewerDebugRef}>
                        <button
                          className={showViewerDebugPanel ? "ghost-button icon-button tab-active" : "ghost-button icon-button"}
                          onClick={() => setShowViewerDebugPanel((current) => !current)}
                          title={showViewerDebugPanel ? "隐藏调试内容" : "显示调试内容"}
                        >
                          <Bug size={14} strokeWidth={1.8} />
                        </button>
                        {showViewerDebugPanel ? (
                          <div className="viewer-floating-status">
                            <div className="viewer-floating-status-head">
                              <strong>调试内容</strong>
                              <span>{recentActivityLines.length} 条</span>
                            </div>
                            <div className="viewer-floating-status-row">
                              <span className={`viewer-floating-status-chip${liveFollowEnabled ? " viewer-floating-status-chip-live" : ""}`}>
                                {compactReaderHint}
                              </span>
                              <span className="viewer-floating-status-text">
                                {localServiceState === "online" ? actionStatus : localServiceStatusText}
                              </span>
                            </div>
                            <div className="viewer-floating-activity-list">
                              {recentActivityLines.slice(-3).map((line, index) => {
                                const match = line.match(/^(\[[\d:]+\])\s(.+)$/);
                                return (
                                  <div key={`${index}-${line}`} className="viewer-floating-activity-line">
                                    <span>{match ? match[1] : ""}</span>
                                    <strong>{match ? match[2] : line}</strong>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        ) : null}
                      </div>
                      {filePath && activeLogView === "search" && activeViewerTabId === "file" ? (
                        <button
                          className={liveFollowEnabled ? "ghost-button icon-button btn-live-active" : "ghost-button icon-button"}
                          onClick={() => liveFollowEnabled ? stopLiveFollow({ keepContent: true }) : startLiveFollow(filePath, selectedFileName)}
                          disabled={!filePath.trim()}
                          title={liveFollowEnabled ? "停止实时跟随" : "开启实时跟随"}
                        >
                          <Radio size={14} strokeWidth={1.8} />
                        </button>
                      ) : null}
                      <button
                        className={errorHighlightEnabled ? "ghost-button icon-button btn-highlight-active" : "ghost-button icon-button"}
                        onClick={toggleErrorHighlight}
                        disabled={!canToggleErrorHighlight}
                        title={errorHighlightEnabled ? "关闭异常/告警高亮" : "开启异常/告警高亮"}
                      >
                        <ToolIcon theme={uiTheme} kind="highlight" />
                      </button>
                      {canToggleResultContext ? (
                        <button
                          className={resultContextMode ? "ghost-button icon-button tab-active" : "ghost-button icon-button"}
                          onClick={toggleResultContext}
                          title={resultContextMode ? "切换到仅命中" : "切换到含上下文"}
                        >
                          <ToolIcon theme={uiTheme} kind="context" />
                        </button>
                      ) : null}
                      {activeLogView === "search" ? (
                        <button className="ghost-button icon-button" onClick={exportCurrentResults} disabled={!activeResultTab && !results} title="下载结果">
                          <Download size={14} strokeWidth={1.8} />
                        </button>
                      ) : null}
                      {!isStandaloneViewerWindow ? (
                        <button
                          className={pip.isPip ? "ghost-button icon-button tab-active" : "ghost-button icon-button"}
                          onClick={() => void pip.togglePip()}
                          title={pip.isPip ? "收回小窗" : "弹出独立小窗"}
                        >
                          <PictureInPicture2 size={14} strokeWidth={1.8} />
                        </button>
                      ) : null}
                    </div>
                  </div>
                  </>
                ) : (
                <div className="workspace-strip viewer-actions-strip">
                  <span className="viewer-strip-label">{activeResultTab ? `${activeResultTab.label} · ${activeResultTab.sourceLabel}` : "搜索结果"}</span>
                  <div className="toolbar-inline workspace-actions compact-actions">
                    {filePath && activeLogView === "search" && activeViewerTabId === "file" ? (
                      <button
                        className={liveFollowEnabled ? "ghost-button icon-button btn-live-active" : "ghost-button icon-button"}
                        onClick={() => liveFollowEnabled ? stopLiveFollow({ keepContent: true }) : startLiveFollow(filePath, selectedFileName)}
                        disabled={!filePath.trim()}
                        title={liveFollowEnabled ? "停止实时跟随" : "开启实时跟随"}
                      >
                        <Radio size={14} strokeWidth={1.8} />
                      </button>
                    ) : null}
                    {filePath && activeLogView === "search" && activeViewerTabId === "file" ? (
                      <button className={showFileTools ? "ghost-button icon-button tab-active" : "ghost-button icon-button"} onClick={() => setShowFileTools((current) => !current)} title="更多工具">
                        <Wrench size={14} strokeWidth={1.8} />
                      </button>
                    ) : null}
                    <button
                      className={errorHighlightEnabled ? "ghost-button icon-button btn-highlight-active" : "ghost-button icon-button"}
                      onClick={toggleErrorHighlight}
                      disabled={!canToggleErrorHighlight}
                      title={errorHighlightEnabled ? "关闭异常/告警高亮" : "开启异常/告警高亮"}
                    >
                      <ToolIcon theme={uiTheme} kind="highlight" />
                    </button>
                    {canToggleResultContext ? (
                      <button
                        className={resultContextMode ? "ghost-button icon-button tab-active" : "ghost-button icon-button"}
                        onClick={toggleResultContext}
                        title={resultContextMode ? "切换到仅命中" : "切换到含上下文"}
                      >
                        <ToolIcon theme={uiTheme} kind="context" />
                      </button>
                    ) : null}
                    {activeLogView === "search" ? (
                      <button className="ghost-button icon-button" onClick={exportCurrentResults} disabled={!activeResultTab && !results} title="下载结果">
                        <Download size={14} strokeWidth={1.8} />
                      </button>
                    ) : null}
                    {activeViewerCommandPreview ? (
                      <button
                        className="ghost-button icon-button"
                        onClick={() => {
                          void copyText(activeViewerCommandPreview).then(() => setActionStatus("搜索命令已复制到剪贴板。"));
                        }}
                        title="复制命令"
                      >
                        <Copy size={14} strokeWidth={1.8} />
                      </button>
                    ) : null}
                    <button
                      className={pip.isPip ? "ghost-button icon-button tab-active" : "ghost-button icon-button"}
                      onClick={() => void pip.togglePip()}
                      title={pip.isPip ? "收回小窗" : "弹出独立小窗"}
                    >
                      <PictureInPicture2 size={14} strokeWidth={1.8} />
                    </button>
                  </div>
                </div>
                )}

                <div className="viewer-shell">
                {!showCompactViewerChrome && viewerTabs.length > 1 ? (
                  <div className="result-tab-strip">
                    {viewerTabs.map((tab) => (
                      <div key={tab.id} className={`result-tab-chip ${tab.id === activeViewerTabId ? "result-tab-chip-active" : ""}`}>
                        <button className="result-tab-main" type="button" onClick={() => setActiveViewerTabId(tab.id)}>
                          {tab.label}
                        </button>
                        {tab.kind === "result" ? (
                          <button className="result-tab-close" type="button" aria-label={`关闭${tab.label}`} onClick={() => closeResultTab(tab.id)}>
                            ×
                          </button>
                        ) : null}
                      </div>
                    ))}
                  </div>
                ) : <div />}

                {!showCompactViewerChrome && showFileTools && filePath && activeLogView === "search" && activeViewerTabId === "file" ? (
                  <div className="meta-list file-tools-panel">
                    <div className="reader-position-card">
                      <div className="reader-position-head">
                        <strong>阅读位置</strong>
                        <span>{readerPositionLabel}</span>
                      </div>
                      {!canDragReaderPosition ? <span className="reader-position-note">当前文件已整片加载，拖拽定位已关闭。</span> : null}
                    </div>
                    <label>
                      切片大小
                      <select
                        value={sliceLengthMode === "auto" ? "auto" : sliceLength}
                        onChange={(event) => {
                          const val = event.target.value;
                          if (val === "auto") {
                            setSliceLengthMode("auto");
                            if (activeFileMeta) {
                              setSliceLength(computeAutoSliceLength(activeFileMeta.size));
                            }
                          } else {
                            const next = Number(val);
                            if (next > 0) {
                              setSliceLengthMode("manual");
                              setSliceLength(next);
                            }
                          }
                        }}
                      >
                        <option value="auto">自动{activeFileMeta ? ` (${formatBytes(computeAutoSliceLength(activeFileMeta.size))})` : ""}</option>
                        <option value={32768}>32 KB</option>
                        <option value={65536}>64 KB</option>
                        <option value={131072}>128 KB</option>
                        <option value={262144}>256 KB</option>
                      </select>
                    </label>
                    <span>文件大小：{formatBytes(activeFileMeta?.size)}</span>
                    <span>偏移：{activeSliceData ? `${formatNumber(activeSliceData.actualOffset)} → ${formatNumber(activeSliceData.nextOffset)}` : "--"}</span>
                    <span>边界状态：{activeSliceData ? `${activeSliceData.isStart ? "文件头" : "中段"} / ${activeSliceData.isEnd ? "文件尾" : "可下翻"}` : "--"}</span>
                    <div className="inline-actions file-tools-actions">
                      <div className="file-tools-strip">
                        {readerJumpPresets.map((preset) => (
                          <button key={preset.label} className="ghost-button" onClick={preset.action} disabled={isBusy || !filePath.trim()}>
                            {preset.label}
                          </button>
                        ))}
                      </div>
                      <div className="file-tools-strip">
                        <button className="ghost-button" onClick={() => void navigateSlice("prev")} disabled={sliceOffset === 0 || sliceData?.isStart || isBusy}>
                          上一页
                        </button>
                        <button className="ghost-button" onClick={() => loadSlice()} disabled={isBusy}>
                          当前页
                        </button>
                        <button className="ghost-button" onClick={() => void navigateSlice("next")} disabled={activeSliceData?.isEnd || isBusy}>
                          下一页
                        </button>
                      </div>
                      <button className="ghost-button" onClick={() => loadFileMeta()} disabled={isBusy}>
                        文件信息
                      </button>
                    </div>
                  </div>
                ) : null}

                {!showViewerEmptyState ? (
                  <>
                    {!(showFileTools && filePath && activeLogView === "search" && activeViewerTabId === "file") && !showCompactViewerChrome && !(fileLoadingName && !currentLogContent) ? (
                      <div className="meta-list compact-meta">
                        <span>{activeResultTab ? activeResultTab.sourceLabel : (selectedFileName || "--")}</span>
                        <span>{activeViewerTabId === "file" ? formatSliceProgressLabel(sliceProgress) : "结果页"}</span>
                        <span>{compactReaderHint}</span>
                      </div>
                    ) : null}
                    {fileLoadingName && !currentLogContent ? (
                      <div className="file-loading-overlay">
                        <div className="file-loading-card">
                          <div className="file-loading-head">
                            <strong>{fileLoadingName}</strong>
                            <span>{selectedServer?.name || selectedServer?.host || "当前连接"}</span>
                          </div>
                          <div className="file-loading-bar"><div className="file-loading-bar-fill" /></div>
                          <div className="file-loading-label">
                            <strong>{actionStatus}</strong>
                            <span>{activeViewerTabId === "file" ? formatSliceProgressLabel(sliceProgress) : compactReaderHint}</span>
                          </div>
                        </div>
                      </div>
                    ) : null}
                    <div
                      ref={viewerContentShellRef}
                      className={`viewer-content-shell ${showViewerRail ? "viewer-content-shell-with-rail" : ""}${fileLoadingName && !currentLogContent ? " viewer-content-loading" : ""}`}
                      onMouseDown={handleViewerSelectionMouseDown}
                      onMouseUp={handleViewerSelectionMouseUp}
                    >
                      <VirtualLogViewer
                        ref={virtualViewerRef}
                        content={currentLogContent}
                        keywordTerms={keywordTerms}
                        useRegex={useRegex}
                        activeHighlightIndex={activeHighlightIndex}
                        focusLineIndex={lineContextState && activeViewerTabId === "file" ? lineContextState.lineNumber - lineContextState.startLine : undefined}
                        onLineClick={viewerLineClickEnabled ? handleViewerLineClick : undefined}
                        onHighlightCountChange={setHighlightCount}
                        onMatchLineIndicesChange={setViewerMatchLineIndices}
                        onWheel={handleViewerWheelWithSelectionMenu}
                        onNearBottomChange={handleViewerNearBottomChangeStable}
                        onScrollStateChange={setViewerScrollState}
                        errorHighlightEnabled={errorHighlightEnabled}
                        followOutput={liveFollowEnabled && !liveFollowPaused}
                        className="console-block viewer-console viewer-console-markup"
                      />
                      {viewerSelMenu ? (
                        <div
                          className="selection-copy-menu viewer-selection-menu"
                          style={{ left: viewerSelMenu.x, top: viewerSelMenu.y }}
                          onMouseDown={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                          }}
                          onMouseUp={(event) => event.stopPropagation()}
                        >
                          <button
                            type="button"
                            title="复制"
                            onMouseDown={(event) => {
                              event.preventDefault();
                              event.stopPropagation();
                            }}
                            onClick={() => void handleCopyViewerSelection()}
                          >
                            <Copy size={14} />
                          </button>
                        </div>
                      ) : null}
                      {viewerNotAtBottom && activeViewerTabId === "file" ? (
                        <button className="live-back-to-bottom" onClick={() => void handleBackToBottom()}>
                          回到底部
                        </button>
                      ) : null}
                      {showReaderRail && !showCompactViewerChrome ? (
                        <aside className={`reader-rail ${canDragReaderPosition ? "" : "reader-rail-disabled"}`}>
                          <div className="reader-rail-head">
                            <span>定位</span>
                            <strong>{readerPreviewLabel}</strong>
                          </div>
                          <div
                            ref={readerRailRef}
                            className="reader-rail-track"
                            onPointerDown={(event) => {
                              event.preventDefault();
                              startReaderRailDrag(event.clientY);
                            }}
                            onWheel={(event) => {
                              const scroller = virtualViewerRef.current?.getScrollerElement();
                              if (scroller) {
                                scroller.scrollTop += event.deltaY;
                              }
                              handleViewerWheel(event);
                            }}
                          >
                            <span
                              className="reader-rail-slice"
                              style={{
                                top: `${readerRailSliceTop}%`,
                                height: `${readerRailSliceHeight}%`
                              }}
                            />
                            <span
                              className={`reader-rail-thumb ${readerPositionDragging ? "reader-rail-thumb-dragging" : ""}`}
                              style={{ top: `${readerRailIndicatorTop}%` }}
                            />
                            <span className="reader-rail-badge" style={{ top: `${readerRailIndicatorTop}%` }}>
                              {readerPreviewLabel}
                            </span>
                            {readerPositionDragging ? (
                              <div className="reader-preview-card reader-preview-floating" style={{ top: `${readerRailIndicatorTop}%` }}>
                                <div className="reader-preview-head">
                                  <strong>定位预览</strong>
                                  <span>{readerPreviewLoading ? "正在更新" : (readerPreviewOffset !== null ? `偏移 ${formatNumber(readerPreviewOffset)}` : "准备中")}</span>
                                </div>
                                <pre className="reader-preview-body">{readerPreviewContent || "正在读取这一段..."}</pre>
                              </div>
                            ) : null}
                          </div>
                        </aside>
                      ) : null}
                      {showSearchResultsOverviewRail ? (
                        <aside className="reader-rail reader-rail-overview">
                          <div
                            ref={viewerOverviewRailRef}
                            className="reader-rail-track reader-rail-overview-track"
                            onPointerDown={(event) => {
                              event.preventDefault();
                              startViewerOverviewDrag(event.clientY);
                            }}
                            onWheel={(event) => {
                              const scroller = virtualViewerRef.current?.getScrollerElement();
                              if (scroller) {
                                scroller.scrollTop += event.deltaY;
                              }
                            }}
                          >
                            {viewerOverviewMarkerPositions.map((top, index) => (
                              <span key={`${index}-${top}`} className="reader-rail-marker" style={{ top: `${top}%` }} />
                            ))}
                            <span
                              className={`reader-rail-slice reader-rail-overview-viewport${viewerOverviewDragging ? " reader-rail-overview-viewport-dragging" : ""}`}
                              style={{
                                top: `${viewerOverviewViewportTop}%`,
                                height: `${viewerOverviewViewportHeight}%`
                              }}
                            />
                            <span className="reader-rail-badge" style={{ top: `${viewerOverviewBadgeTop}%` }}>
                              {viewerOverviewLabel}
                            </span>
                          </div>
                        </aside>
                      ) : null}
                    </div>
                  </>
                ) : (
                  <div className="viewer-empty-state">
                    <strong>{viewerEmptyTitle}</strong>
                    <span>{viewerEmptyHint}</span>
                    <div className="toolbar-inline">
                      <button className="ghost-button" onClick={() => setActiveLogView("files")}>
                        去选文件
                      </button>
                      {filePath ? (
                        <button className="ghost-button" onClick={loadTailSlice} disabled={isBusy}>
                          读取尾部
                        </button>
                      ) : null}
                    </div>
                  </div>
                )}
                </div>
                </div>
                )}
                </div>
                ) : null}
                {isFileMode ? (
              <>
                {pip.isPip && (
                  <div className="viewer-pip-placeholder">
                    <PictureInPicture2 size={24} strokeWidth={1.5} />
                    <strong>日志查看器已弹出到独立小窗</strong>
                    <button className="ghost-button" onClick={() => void pip.togglePip()}>收回</button>
                  </div>
                )}
                <FileBrowserStrip
                  pathbar={<FileBrowserPathbar
                    mode={pathbarMode}
                    directoryInput={directoryInput}
                    currentDirectory={currentDirectoryForPathbar}
                    breadcrumbItems={directoryBreadcrumbItems}
                    inputRef={directoryInputRef}
                    hasServer={!!serverId}
                    isBusy={isBusy}
                    onSetDirectoryInput={setDirectoryInput}
                    onEnterEditMode={enterPathbarEditMode}
                    onExitEditMode={exitPathbarEditMode}
                    onOpenFromInput={() => { void openDirectoryFromInput(); }}
                    onCommitDirectoryPath={(path) => { void commitDirectoryPath(path); }}
                  />}
                  actions={<FileBrowserActions
                    uiTheme={uiTheme}
                    hasServer={!!serverId}
                    isBusy={isBusy}
                    showPathHistory={showPathHistory}
                    showTransferHistory={showTransferHistory}
                    showDirectoryFilter={showDirectoryFilter}
                    onBrowseParent={() => { void browseParentDirectory(); }}
                    onTogglePathHistory={() => {
                      setShowTransferHistory(false);
                      setShowPathHistory((c) => !c);
                    }}
                    onToggleTransferHistory={() => {
                      setShowPathHistory(false);
                      setShowTransferHistory((c) => !c);
                    }}
                    onToggleDirectoryFilter={() => setShowDirectoryFilter((current) => !current)}
                    onMkdir={() => setMkdirDialog({ parentDir: directoryPath || "/", dirName: "" })}
                    onUploadFiles={() => { void uploadFiles(); }}
                    onUploadDirectory={() => { void uploadDirectory(); }}
                    onRefresh={() => browseLogFiles(directoryPath || "/")}
                  />}
                  filterBar={showDirectoryFilter ? (
                    <FileBrowserFilterBar value={fileFilter} hasServer={!!serverId} onChange={setFileFilter} />
                  ) : null}
                  historyDropdown={showPathHistory ? (
                    <FileBrowserHistoryDropdown
                      historyPaths={serverId ? readDirectoryHistory(serverId).filter((p) => p !== directoryPath) : []}
                      onBrowsePath={(path: string) => { void browseLogFiles(path, { manual: true }); }}
                    />
                  ) : null}
                  transferDropdown={null}
                />

                {isConnectingWorkspace ? (
                  <div className="workspace-placeholder">
                    <strong>{selectedServer ? `正在连接 ${selectedServer.name}` : "等待选择服务器"}</strong>
                    <span className={isBusy ? "connect-status-busy" : "connect-status-idle"}>
                      {isBusy ? actionStatus : (selectedServer
                        ? "等待系统自动建立 SSH 连接..."
                        : "先在左侧选择服务器，系统会自动连接并打开目录。")}
                    </span>
                    {selectedServer ? (
                      <div className="toolbar-inline connect-progress-actions">
                        <span className="connect-progress-host">{selectedServer.username}@{selectedServer.host}:{selectedServer.port}</span>
                        {isBusy ? <span className="connect-spinner" /> : (
                          <button className="ghost-button" onClick={() => testServerConnection(selectedServer.basePath?.trim() || "/")} disabled={isBusy}>
                            重新连接
                          </button>
                        )}
                      </div>
                    ) : null}
                  </div>
                ) : hasDirectoryConnectionError ? (
                  <div className="workspace-placeholder workspace-placeholder-error">
                    <strong>连接失败</strong>
                    <span>{connectionTestStatus?.message || "无法连接到服务器，请检查网络、凭证或服务器状态。"}</span>
                    <div className="toolbar-inline">
                      <button className="ghost-button" onClick={() => testServerConnection(selectedServer?.basePath?.trim() || "/")} disabled={isBusy}>
                        重新连接
                      </button>
                      <button className="ghost-button" onClick={() => openSettingsWorkspace("server")}>
                        连接设置
                      </button>
                    </div>
                  </div>
                ) : hasFileWorkspaceEntries ? (
                  <FileBrowserGrid browserGridRef={browserGridRef} browserTreeWidth={browserTreeWidth}>
                    <FileBrowserTreeColumn
                      title="目录树"
                      summary={`${formatNumber(directoryEntries.length)} 个目录`}
                      entries={treeEntries}
                      emptyLabel="当前层级没有子目录"
                      onBrowse={browseLogFiles}
                      onOpenContextMenu={(entry, clientX, clientY) => {
                        openContextMenu({ path: entry.path, name: entry.label || entry.path.split("/").pop() || "/", kind: "directory" }, clientX, clientY);
                      }}
                    />

                    <div className="browser-resizer" onPointerDown={handleTreeResizeStart} title="拖拽调整目录宽度" />

                    <FileBrowserContentColumn
                      isDragOver={isDragOver}
                      onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
                      onDragLeave={(e) => { if (e.currentTarget.contains(e.relatedTarget as Node)) return; setIsDragOver(false); }}
                      onDrop={handleFileDrop}
                      summary={<span>{formatNumber(tableEntries.length)} 项</span>}
                      batchBar={selectedFileEntries.length ? (
                        <div className="toolbar-inline file-batch-actions file-batch-actions-compact">
                          <span className="file-batch-summary" title="批量操作仅作用于当前目录列表里已勾选的项目">已选 {selectedFileEntries.length} / {tableEntries.length} 项</span>
                          <button
                            type="button"
                            className="ghost-button icon-button file-batch-action-button"
                            onClick={() => openBatchMoveDialog()}
                            disabled={isBusy}
                            title="批量移动"
                          >
                            <ToolIcon theme={uiTheme} kind="folder" />
                          </button>
                          <button
                            type="button"
                            className="ghost-button icon-button file-batch-action-button"
                            onClick={() => confirmDeleteSelectedFiles()}
                            disabled={isBusy}
                            title="批量删除"
                          >
                            <ToolIcon theme={uiTheme} kind="delete" />
                          </button>
                          <button
                            type="button"
                            className="ghost-button icon-button file-batch-action-button"
                            onClick={() => clearSelectedFiles()}
                            disabled={isBusy}
                            title="清空选择"
                          >
                            <ToolIcon theme={uiTheme} kind="undo" />
                          </button>
                        </div>
                      ) : null}
                      tableHead={<>
                        <span className="file-select-cell file-select-cell-head">
                          <input
                            type="checkbox"
                            className="file-select-checkbox"
                            checked={allVisibleFilesSelected}
                            disabled={!tableEntries.length || isBusy}
                            onChange={(event) => toggleAllVisibleFiles(event.target.checked)}
                            aria-label="选择当前目录全部项目"
                          />
                        </span>
                        <button type="button" className="table-head-button" onClick={() => toggleFileSort("name")}>
                          {renderSortLabel("name", "名称")}
                        </button>
                        <button type="button" className="table-head-button" onClick={() => toggleFileSort("size")}>
                          {renderSortLabel("size", "大小")}
                        </button>
                        <button type="button" className="table-head-button" onClick={() => toggleFileSort("modifiedTime")}>
                          {renderSortLabel("modifiedTime", "修改时间")}
                        </button>
                        <button type="button" className="table-head-button" onClick={() => toggleFileSort("kind")}>
                          {renderSortLabel("kind", "类型")}
                        </button>
                      </>}
                    >
                      <FileBrowserTableRows
                        entries={tableEntries}
                        activeFilePath={filePath}
                        selectedFilePathSet={selectedFilePathSet}
                        isBusy={isBusy}
                        uiTheme={uiTheme}
                        formatBytes={formatBytes}
                        formatDateTime={formatDateTime}
                        onOpenEntry={(entry) => { void openEntry(entry); }}
                        onOpenContextMenu={(entry, clientX, clientY) => { openContextMenu(entry, clientX, clientY); }}
                        onToggleSelection={toggleFileSelection}
                        onDownload={(path) => { void downloadFile(path); }}
                        onRename={openRenameDialog}
                        onDelete={deleteRemoteFile}
                      />
                    </FileBrowserContentColumn>
                  </FileBrowserGrid>
                ) : (
                  <FileBrowserGrid browserGridRef={browserGridRef} browserTreeWidth={browserTreeWidth}>
                    <FileBrowserTreeColumn
                      title="目录"
                      summary={`${formatNumber(treeEntries.length)} 项`}
                      entries={treeEntries}
                      onBrowse={browseLogFiles}
                      onOpenContextMenu={(entry, clientX, clientY) => {
                        openContextMenu({ path: entry.path, name: entry.label || entry.path.split("/").pop() || "/", kind: "directory" }, clientX, clientY);
                      }}
                    />

                    <div className="browser-resizer" onPointerDown={handleTreeResizeStart} title="拖拽调整目录宽度" />

                    <FileBrowserContentColumn
                      isDragOver={isDragOver}
                      onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
                      onDragLeave={(e) => { if (e.currentTarget.contains(e.relatedTarget as Node)) return; setIsDragOver(false); }}
                      onDrop={handleFileDrop}
                      summary={<span>0 项</span>}
                      tableHead={<>
                        <span>名称</span>
                        <span>大小</span>
                        <span>类型</span>
                      </>}
                    >
                      <div className="empty-box table-empty table-empty-large">当前目录为空</div>
                    </FileBrowserContentColumn>
                  </FileBrowserGrid>
                )}
              </>
              ) : null}
              </>
            )}
          </section>

          {terminalDetached ? (
            <div className="viewer-pip-placeholder">
              <PictureInPicture2 size={24} strokeWidth={1.5} />
              <strong>终端已弹出到独立小窗</strong>
              <button className="ghost-button" type="button" onClick={() => void restoreEmbeddedTerminalWindow()}>收回</button>
            </div>
          ) : terminalPanelOpen ? (
            <TerminalPanel
              popupMode="embedded"
              server={selectedServer}
              connected={terminalSession.connected}
              isBusy={isBusy}
              serverId={serverId}
              statusText={terminalPanelStatusText}
              subtitleText={terminalConnectionLabel}
              detached={terminalDetached}
              terminalOverlay={terminalOverlay}
              containerRef={terminalSession.containerRef}
              onReconnect={() => openTerminalView()}
              onClose={() => {
                if (terminalDetached) {
                  void closeDetachedTerminalWindow();
                }
                closeTerminalOverlay();
                setTerminalPanelOpen(false);
                setTerminalDetached(false);
              }}
              onCloseTerminalOverlay={closeTerminalOverlay}
              onFocus={() => terminalSession.focusTerminal()}
              onDetach={() => { void openDetachedTerminalWindow(); }}
              onAttach={() => { void closeDetachedTerminalWindow(); }}
              onFit={() => terminalSession.fitTerminal()}
              selMenu={termSelMenu}
              clearSelection={() => terminalSession.clearSelection()}
              pasteToTerminal={(text) => terminalSession.pasteToTerminal(text)}
              onToggleTerminalOverlay={toggleTerminalOverlay}
              onDismissMenu={() => setTermSelMenu(null)}
            />
          ) : null}

        </section>

        {showConnectionSettings && !isStandalonePipWindow ? (
          <div className="settings-modal-backdrop" role="presentation" onClick={closeSettingsWorkspace}>
            <div
              className="settings-modal-shell"
              role="dialog"
              aria-modal="true"
              aria-label="连接设置"
              onClick={(event) => event.stopPropagation()}
            >
              <button
                className="ghost-button icon-button settings-modal-close"
                type="button"
                aria-label="关闭设置"
                onClick={closeSettingsWorkspace}
              >
                <X size={16} strokeWidth={1.75} />
              </button>
            <ConnectionSettingsWorkspace
              activeView={settingsWorkspaceView}
              onViewChange={setSettingsWorkspaceView}
              isBusy={isBusy}
              localServiceState={localServiceState}
              localServiceStatusText={localServiceStatusText}
              importSection={{
                selectedTool: selectedImportTool,
                importStatus,
                importPath,
                finalShellPath,
                finalShellDetectedPaths,
                finalShellLastImportedAt,
                xshellDetectedPaths,
                xshellLastImportedAt,
                onSelectTool: setSelectedImportTool,
                onChangeFinalShellPath: setFinalShellPath,
                onCheckService: () => { void checkLocalServiceHealth(); },
                onSaveFinalShellPath: () => { void saveFinalShellPath(); },
                onImport: (tool) => { void importFromTool(tool || selectedImportTool); },
              }}
              inventorySection={{
                managedServers: servers,
                manualServers,
                importedServers,
                selectedServerId: serverId,
                draft: manualServerDraft,
                canSaveDraft: canSaveManualServer,
                onSelectServer: selectServerById,
                onStartCreate: startCreateManualServer,
                onStartEdit: startEditManualServer,
                onChangeDraft: (patch) => setManualServerDraft((current) => ({ ...current, ...patch })),
                onResetDraft: () => setManualServerDraft(createManualServerDraft()),
                onSaveDraft: () => { void saveManualServer(); },
                onDeleteServer: requestDeleteServer,
              }}
              currentServerSection={{
                selectedServer,
                connectionDirectory: currentConnectionDirectory,
                credentialStatus,
                credentialUsername,
                credentialPassword,
                credentialPrivateKey,
                onCredentialUsernameChange: setCredentialUsername,
                onCredentialPasswordChange: setCredentialPassword,
                onCredentialPrivateKeyChange: setCredentialPrivateKey,
                onSaveCredential: () => { void saveCredentialForServer(); },
                onTestConnection: () => { void testServerConnection(currentConnectionDirectory); },
                onOpenTerminal: () => openTerminalView(),
                availableBastions,
                preferredBastionId,
                jumpMode,
                jumpSearchKeyword,
                jumpAssetId,
                jumpAssetOptions,
                onPreferredBastionChange: handlePreferredBastionChange,
                onJumpModeChange: setJumpMode,
                onJumpSearchKeywordChange: setJumpSearchKeyword,
                onJumpAssetIdChange: setJumpAssetId,
                onSearchJumpAssets: () => { void searchJumpServerAssets(); },
                onSaveRoute: () => { void saveServerRouteForServer(); },
              }}
            />
            </div>
          </div>
        ) : null}
      </section>
      <FileContextMenu
        menu={contextMenu}
        menuRef={contextMenuRef}
        onClose={() => setContextMenu(null)}
        onPreview={(entry) => { void previewFile(entry); }}
        onDownload={(path) => { void downloadFile(path); }}
        onRename={openRenameDialog}
        onMove={openMoveDialog}
        onExtractHere={(path) => { void extractZipFile(path); }}
        onExtractTo={(entry) => {
          const parentDir = entry.path.substring(0, entry.path.lastIndexOf("/")) || "/";
          setExtractDialog({ filePath: entry.path, fileName: entry.name, targetDir: parentDir });
        }}
        onCompress={(entry) => {
          const parentDir = entry.path.substring(0, entry.path.lastIndexOf("/")) || "/";
          setCompressDialog({ sourcePath: entry.path, sourceName: entry.name, archiveType: "tar.gz", targetDir: parentDir });
        }}
        onMkdir={(parentDir) => {
          setMkdirDialog({ parentDir, dirName: "" });
        }}
        onDelete={(entry) => { void deleteRemoteFile(entry); }}
        onCopyPath={(entry) => {
          void navigator.clipboard.writeText(entry.path);
          setActionStatus("已复制路径");
        }}
        onCopyName={(entry) => {
          void navigator.clipboard.writeText(entry.name);
          setActionStatus("已复制文件名");
        }}
      />

      {workspaceTabMenu ? (
        <div className="context-menu-backdrop">
          <div
            ref={workspaceTabMenuRef}
            className="context-menu"
            style={{ left: workspaceTabMenu.x, top: workspaceTabMenu.y }}
            onClick={(event) => event.stopPropagation()}
            onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); }}
          >
            <div role="button" className="context-menu-item" onClick={() => {
              setWorkspaceTabMenu(null);
              void navigator.clipboard.writeText(workspaceTabMenu.session.serverName);
              setActionStatus("已复制服务器名称");
              showToast("success", "已复制服务器名称");
            }}>
              复制服务器名称
            </div>
            {workspaceTabMenu.session.serverHost ? (
              <div role="button" className="context-menu-item" onClick={() => {
                setWorkspaceTabMenu(null);
                void navigator.clipboard.writeText(workspaceTabMenu.session.serverHost);
                setActionStatus("已复制主机地址");
                showToast("success", "已复制主机地址");
              }}>
                复制主机地址
              </div>
            ) : null}
            <div role="button" className="context-menu-item" onClick={() => {
              setWorkspaceTabMenu(null);
              startCreateManualServer();
            }}>
              新增服务器
            </div>
            <div role="button" className="context-menu-item context-menu-danger" onClick={() => {
              setWorkspaceTabMenu(null);
              closeWorkspaceSession(workspaceTabMenu.session.id);
            }}>
              关闭工作区
            </div>
          </div>
        </div>
      ) : null}

      <FeedbackOverlays
        downloadProgress={downloadProgress}
        uploadProgress={uploadProgress}
        toasts={toasts}
        onDismissToast={dismissToast}
      />

      <TextInputDialog
        open={Boolean(renameDialog)}
        title={`重命名${renameDialog?.entry.kind === "directory" ? "文件夹" : "文件"}`}
        message={renameDialog?.entry.path}
        value={renameDialog?.newName ?? ""}
        confirmText="确定"
        canConfirm={Boolean(renameDialog && renameDialog.newName.trim() && renameDialog.newName !== renameDialog.entry.name)}
        onChange={(value) => setRenameDialog((prev) => prev ? { ...prev, newName: value } : null)}
        onConfirm={() => {
          if (renameDialog && renameDialog.newName.trim() && renameDialog.newName !== renameDialog.entry.name) {
            void renameRemoteFile(renameDialog.entry, renameDialog.newName);
          }
        }}
        onClose={() => setRenameDialog(null)}
      />

      <TextInputDialog
        open={Boolean(moveDialog)}
        title={`移动${moveDialog?.entry.kind === "directory" ? "文件夹" : "文件"}`}
        message={moveDialog ? `当前：${moveDialog.entry.path}` : ""}
        label="目标目录"
        value={moveDialog?.targetDir ?? ""}
        confirmText="移动"
        placeholder="/home/app/target-dir"
        canConfirm={Boolean(moveDialog?.targetDir.trim())}
        onChange={(value) => setMoveDialog((prev) => prev ? { ...prev, targetDir: value } : null)}
        onConfirm={() => {
          if (moveDialog?.targetDir.trim()) {
            void moveRemoteFile(moveDialog.entry, moveDialog.targetDir);
          }
        }}
        onClose={() => setMoveDialog(null)}
      />

      <TextInputDialog
        open={Boolean(batchMoveDialog)}
        title={`批量移动 ${batchMoveDialog?.entries.length ?? 0} 项`}
        message="目标将保留原文件名或目录名。"
        label="目标目录"
        value={batchMoveDialog?.targetDir ?? ""}
        confirmText="移动"
        placeholder="/home/app/target-dir"
        canConfirm={Boolean(batchMoveDialog?.targetDir.trim())}
        onChange={(value) => setBatchMoveDialog((prev) => prev ? { ...prev, targetDir: value } : null)}
        onConfirm={() => {
          if (batchMoveDialog?.targetDir.trim()) {
            void moveRemoteEntries(batchMoveDialog.entries, batchMoveDialog.targetDir);
          }
        }}
        onClose={() => setBatchMoveDialog(null)}
      />

      <TextInputDialog
        open={Boolean(extractDialog)}
        title="解压文件"
        message={extractDialog?.fileName}
        label="目标目录"
        value={extractDialog?.targetDir ?? ""}
        confirmText="解压"
        placeholder="/home/app/target-dir"
        canConfirm={Boolean(extractDialog?.targetDir.trim())}
        onChange={(value) => setExtractDialog((prev) => prev ? { ...prev, targetDir: value } : null)}
        onConfirm={() => {
          if (extractDialog?.targetDir.trim()) {
            void extractZipFile(extractDialog.filePath, extractDialog.targetDir);
          }
        }}
        onClose={() => setExtractDialog(null)}
      />

      <TextInputDialog
        open={Boolean(mkdirDialog)}
        title="新建目录"
        message={mkdirDialog ? `在 ${mkdirDialog.parentDir} 下创建` : ""}
        label="目录名称"
        value={mkdirDialog?.dirName ?? ""}
        confirmText="创建"
        placeholder="new-directory"
        canConfirm={Boolean(mkdirDialog?.dirName.trim())}
        onChange={(value) => setMkdirDialog((prev) => prev ? { ...prev, dirName: value } : null)}
        onConfirm={() => {
          if (mkdirDialog?.dirName.trim()) {
            void mkdirRemoteDir(mkdirDialog.parentDir, mkdirDialog.dirName);
          }
        }}
        onClose={() => setMkdirDialog(null)}
      />

      <TextInputDialog
        open={Boolean(compressDialog)}
        title="压缩"
        message={compressDialog?.sourcePath}
        label="目标目录（留空则与源同目录）"
        value={compressDialog?.targetDir ?? ""}
        confirmText="压缩"
        placeholder="/home/app/target-dir"
        canConfirm={true}
        onChange={(value) => setCompressDialog((prev) => prev ? { ...prev, targetDir: value } : null)}
        onConfirm={() => {
          if (compressDialog) {
            void compressRemotePath(compressDialog.sourcePath, compressDialog.archiveType, compressDialog.targetDir.trim() || undefined);
          }
        }}
        onClose={() => setCompressDialog(null)}
      />

      <FilePreviewDialog
        dialog={previewDialog}
        theme={uiTheme}
        onChange={(value) => setPreviewDialog((prev) => prev ? { ...prev, content: value } : null)}
        onDownload={() => {
          if (previewDialog) {
            void downloadFile(previewDialog.filePath);
          }
        }}
        onSave={() => void saveFileContent()}
        onToggleMaximize={() => setPreviewDialog((prev) => prev ? { ...prev, maximized: !prev.maximized } : null)}
        onClose={() => {
          if (previewDialog && !previewDialog.readOnly && previewDialog.content !== previewDialog.originalContent) {
            setConfirmDialog({ title: "未保存的更改", message: "文件已修改但未保存，确定关闭？", danger: true, onConfirm: () => setPreviewDialog(null) });
          } else {
            setPreviewDialog(null);
          }
        }}
      />

      <TransferHistoryDialog
        open={showTransferHistory}
        entries={currentServerTransferHistory}
        isElectron={isElectron}
        formatBytes={formatBytes}
        formatDateTime={formatDateTime}
        onBrowsePath={handleBrowseTransferHistoryPath}
        onCopyRemotePath={(path) => { void handleCopyTransferHistoryValue(path, "远程路径"); }}
        onCopyLocalPath={(path) => { void handleCopyTransferHistoryValue(path, "本地路径"); }}
        onRevealLocalPath={(path) => { void handleRevealTransferHistoryLocalPath(path); }}
        onClear={requestClearTransferHistory}
        onClose={() => setShowTransferHistory(false)}
      />

      <ConfirmDialog dialog={confirmDialog} onClose={() => setConfirmDialog(null)} />
    </main>
  );
}
