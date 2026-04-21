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
import type { PreviewDialogState } from "./FilePreviewDialog.js";
import type { ConfirmDialogState } from "./ModalDialogs.js";
import { ConnectionSettingsWorkspace, type ManualServerDraft, type SettingsWorkspaceView } from "./ConnectionSettingsWorkspace.js";
import { SearchQueryPanel } from "./SearchQueryPanel.js";
import { SearchProgressPanel } from "./SearchProgressPanel.js";
import { SearchToolbarActions } from "./SearchToolbarActions.js";
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
import { Radio, Wrench, Download, Copy, PictureInPicture2, Bug } from "lucide-react";
import { TerminalPanel } from "./TerminalWorkspace.js";
import { ToolIcon } from "./ToolIcon.js";

import { useTerminalSession } from "./useTerminalSession.js";
import { useToasts } from "./useToasts.js";
import { VirtualLogViewer, type VirtualLogViewerHandle, type VirtualLogViewerScrollState } from "./VirtualLogViewer.js";
import { useLiveFollow } from "./useLiveFollow.js";
import { usePictureInPicture } from "./usePictureInPicture.js";
import type { LogRecordingSessionResponse } from "./api.js";
import type { WorkspaceSession, WorkspaceSessionState, ViewerPipSnapshot } from "./types.js";
import {
  defaultDirectoryPath,
  MAX_PREVIEW_CACHE_ENTRIES,
} from "./types.js";
import {
  computeAutoSliceLength,
  setLimitedMapEntry,
  createManualServerDraft,
  readViewerPipSnapshot,
  writeViewerPipSnapshot,
  buildWorkspaceSession,
} from "./app-utils.js";
import { useAsyncStatus } from "./useAsyncStatus.js";
import { useLocalService } from "./useLocalService.js";
import { useSearchTimer } from "./useSearchTimer.js";
import { usePanelResize } from "./usePanelResize.js";
import { useElectronEnv } from "./useElectronEnv.js";
import { useUiTheme } from "./useUiTheme.js";
import { useWorkspaceTabDrag } from "./useWorkspaceTabDrag.js";
import { useTransferHistory } from "./useTransferHistory.js";
import { useFileBrowserComputed } from "./useFileBrowserComputed.js";
import { useServerConnection } from "./useServerConnection.js";
import { useSliceCache } from "./useSliceCache.js";
import { useImportSettings } from "./useImportSettings.js";
import { useFileTransfer } from "./useFileTransfer.js";
import { useFileOperations } from "./useFileOperations.js";
import { useServerManagement } from "./useServerManagement.js";
import { useLogRecording } from "./useLogRecording.js";
import { SidebarPanel } from "./SidebarPanel.js";
import { WorkspaceTabContextMenu, type WorkspaceTabMenuState } from "./WorkspaceTabContextMenu.js";
import { WorkspaceSessionTabs } from "./WorkspaceSessionTabs.js";
import { SettingsModalOverlay } from "./SettingsModalOverlay.js";
import { WorkspaceStartupCards } from "./WorkspaceStartupCards.js";
import { DialogOverlays } from "./DialogOverlays.js";
import { useTerminalWindowManager } from "./useTerminalWindowManager.js";
import { useKeyboardShortcuts } from "./useKeyboardShortcuts.js";
import { useWorkspaceSessionManager, type WorkspaceSessionSetters } from "./useWorkspaceSessionManager.js";
import { useLogViewer } from "./useLogViewer.js";
import {
  localServiceBase,
  apiGetLogMeta,
  apiGetLogSlice,
} from "./api.js";
import {
  buildConnectionSummary,
  clampPercent,
  clampSliceStart,
  copyText,
  describeSearchStrategyClient,
  formatBytes,
  formatDateTime,
  formatDurationLabel,
  formatNumber,
  formatPercent,
  formatPreviewSnippet,
  formatSliceProgressLabel,
  getParentDirectoryPath,
  getPreviewCacheKey,
  normalizeSearchInput,
  parseKeywordTerms,
  previewBucketSize,
  previewSliceLength,
} from "./utils.js";
import type { LineContextState, ViewerResultTab } from "./utils.js";
import {
  type TransferHistoryEntry,
  readActivityPanelHeight,
  readBrowserTreeWidth,
  readDirectoryHistory,
  readLastDirectoryMap,
  readTransferHistory,
  rememberDirectoryIfUseful,
  writeActivityPanelHeight,
  writeBrowserTreeWidth,
} from "./storage.js";


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
  const { searchNow } = useSearchTimer(searchStartedAt);
  const [selectedImportTool, setSelectedImportTool] = useState<"finalshell" | "xshell">("finalshell");
  const [importStatus, setImportStatus] = useState("尚未导入连接。");
  const [importPath, setImportPath] = useState("尚未解析配置目录。");
  const [finalShellPath, setFinalShellPath] = useState("");
  const [finalShellDetectedPaths, setFinalShellDetectedPaths] = useState<string[]>([]);
  const [finalShellLastImportedAt, setFinalShellLastImportedAt] = useState("");
  const [xshellDetectedPaths] = useState<string[]>([]);
  const [xshellLastImportedAt, setXshellLastImportedAt] = useState("");
  const [uploadProgress, setUploadProgress] = useState<UploadProgressState | null>(null);
  const [downloadProgress, setDownloadProgress] = useState<DownloadProgressState | null>(null);
  const [contextMenu, setContextMenu] = useState<FileContextMenuState | null>(null);
  const [workspaceTabMenu, setWorkspaceTabMenu] = useState<WorkspaceTabMenuState | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogState | null>(null);
  const [renameDialog, setRenameDialog] = useState<{ entry: LogFileEntry; newName: string } | null>(null);
  const [moveDialog, setMoveDialog] = useState<{ entry: LogFileEntry; targetDir: string } | null>(null);
  const [batchMoveDialog, setBatchMoveDialog] = useState<{ entries: LogFileEntry[]; targetDir: string } | null>(null);
  const [extractDialog, setExtractDialog] = useState<{ filePath: string; fileName: string; targetDir: string } | null>(null);
  const [mkdirDialog, setMkdirDialog] = useState<{ parentDir: string; dirName: string } | null>(null);
  const [compressDialog, setCompressDialog] = useState<{ sourcePath: string; sourceName: string; archiveType: "tar.gz" | "zip"; targetDir: string } | null>(null);
  const [recordingSession, setRecordingSession] = useState<LogRecordingSessionResponse | null>(null);
  const [previewDialog, setPreviewDialog] = useState<PreviewDialogState | null>(null);
  const { isElectron, isMacOS } = useElectronEnv();
  const { toasts, showToast, updateToast, dismissToast } = useToasts();
  const { isBusy, actionStatus, activityLines, setIsBusy, setActionStatus, pushActivity, withBusy } = useAsyncStatus({ showToast, updateToast, dismissToast });
  const { localServiceState, localServiceStatusText, checkLocalServiceHealth } = useLocalService({ isElectron, setActionStatus, pushActivity, onServiceRestored: async () => { await fetchServers(); await fetchFinalShellSettings(); } });
  const [preserveTerminalOnInactive, setPreserveTerminalOnInactive] = useState(false);
  const [pendingLiveFollowRestore, setPendingLiveFollowRestore] = useState<WorkspaceSessionState | null>(null);
  const isWorkspaceSwitchLocked = isBusy || searchTask?.status === "queued" || searchTask?.status === "running";
  const [fileLoadingName, setFileLoadingName] = useState("");
  const [isDragOver, setIsDragOver] = useState(false);
  const { uiTheme } = useUiTheme();
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
  const [highlightCount, setHighlightCount] = useState(0);
  const [viewerSelMenu, setViewerSelMenu] = useState<{ x: number; y: number; text: string } | null>(null);
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
  const { treeResizeRef, activityPanelResizeRef } = usePanelResize(setBrowserTreeWidth, setActivityPanelHeight);
  const readerPreviewRequestRef = useRef(0);
  const openFileRequestRef = useRef(0);
  const sliceRequestRef = useRef(0);
  const jumpAssetAutoSearchKeyRef = useRef("");
  const readerDraftFrameRef = useRef<number | null>(null);
  const readerPendingDraftRef = useRef<number | null>(null);
  const previewWarmRef = useRef(new Set<string>());
  const { sliceCacheRef, sliceWarmRef, previewCacheRef, cacheSlicePayload, getCachedSlice, warmSlice: warmSliceFromCache, warmNeighborSlices: warmNeighborSlicesFromCache } = useSliceCache();
  const prevServerIdForResetRef = useRef(serverId);
  const serverIdRef = useRef(serverId);
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
    handleViewerNearBottomChange, scrollViewerToBottom,
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

  const workspaceSessionSetters: WorkspaceSessionSetters = {
    setActiveWorkspaceSessionId,
    setServerId,
    setKeywordInput,
    setKeywordMode,
    setContextLines,
    setUseRegex,
    setSelectedPreset,
    setStartDate,
    setEndDate,
    setStartTime,
    setEndTime,
    setCredentialStatus,
    setCredentialUsername,
    setCredentialPassword,
    setCredentialPrivateKey,
    setServerRouteConfig,
    setConnectionTestStatus,
    setPreferredBastionId,
    setJumpMode,
    setJumpSearchKeyword,
    setJumpAssetId,
    setJumpAssetOptions,
    setResults,
    setResultTabs,
    setSearchTask,
    setSearchStartedAt,
    setActiveLogView,
    setActiveViewerTabId,
    setDirectoryPath,
    setDirectoryInput,
    setFilePath,
    setFileEntries,
    setFileMeta,
    setSliceOffset,
    setSliceLength,
    setSliceLengthMode,
    setSliceData,
    setLineContextState,
    setResultContextMode,
    setSelectedFilePaths,
    setResultTabCounter,
    setActiveHighlightIndex,
    setShowQueryAdvanced,
    setShowFileTools,
    setErrorHighlightEnabled,
    setPathbarMode,
    setBatchMoveDialog,
    setShowPathHistory,
    setShowTransferHistory,
    setFileLoadingName,
    setTerminalSessionId,
    setTerminalDetached,
    setTerminalPanelOpen,
    setTerminalOverlay,
    setPreserveTerminalOnInactive,
    setRecordingSession,
    setLiveFollowContent,
    setLiveFollowPaused,
    setPendingLiveFollowRestore,
    setReaderPositionDraft,
    setReaderPositionDragging,
    setReaderPreviewContent,
    setReaderPreviewOffset,
    setReaderPreviewLoading,
  };

  const {
    storeWorkspaceSessionState,
    readWorkspaceSessionState,
    applyWorkspaceSessionState,
    startWorkspaceActivation,
  } = useWorkspaceSessionManager({
    serverId,
    activeWorkspaceSessionId,
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
    jumpAssetOptions,
    results,
    resultTabs,
    searchStartedAt,
    activeLogView,
    activeViewerTabId,
    fileEntries,
    fileMeta,
    sliceOffset,
    sliceLength,
    sliceLengthMode,
    sliceData,
    lineContextState,
    resultContextMode,
    selectedFilePaths,
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
    liveFollowContent,
    setters: workspaceSessionSetters,
    workspaceSessionStatesRef,
    pendingWorkspaceActivationRef,
    restoringWorkspaceStateRef,
    restoringWorkspaceFromCacheRef,
    skipServerSelectionResetRef,
    skipServerAutoConnectRef,
    jumpAssetAutoSearchKeyRef,
    previewCacheRef,
    previewWarmRef,
    sliceCacheRef,
    sliceWarmRef,
    isStandaloneViewerWindow,
    isStandaloneTerminalWindow,
    defaultDirectoryPath,
    stopLiveFollow,
    resetFileReaderState,
  });

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


  async function initializeWorkbench() {
    const serviceReady = await checkLocalServiceHealth();
    if (!serviceReady) {
      return;
    }

    await fetchServers();
    await fetchFinalShellSettings();
  }

  useEffect(() => {
    return () => {
      stopLiveFollow();
      if (readerDraftFrameRef.current !== null) {
        window.cancelAnimationFrame(readerDraftFrameRef.current);
      }
    };
  }, []);

  const selectedServer = useMemo(
    () => servers.find((server) => server.id === serverId) ?? null,
    [servers, serverId]
  );

  const logViewerAPI = useLogViewer({
    state: {
      serverId,
      filePath,
      directoryPath,
      directoryInput,
      keywordInput,
      keywordMode,
      contextLines,
      useRegex,
      startDate,
      endDate,
      startTime,
      endTime,
      sliceOffset,
      sliceLength,
      sliceLengthMode,
      sliceData,
      fileMeta,
      fileEntries,
      results,
      resultTabs,
      resultTabCounter,
      activeLogView,
      activeViewerTabId,
      activeHighlightIndex,
      showPathHistory,
      showTransferHistory,
      isBusy,
      liveFollowEnabled,
      liveFollowPaused,
      liveFollowContent,
      lineContextState,
      resultContextMode,
      highlightCount,
      selectedFilePaths,
      viewerSelMenu,
      readerPositionDraft,
      readerPositionDragging,
      viewerOverviewDragging,
      viewerOverviewDraft,
      viewerOverviewTotalLines: viewerScrollState?.totalLines ?? 0,
    },
    setters: {
      ...workspaceSessionSetters,
      setIsBusy,
      setViewerSelMenu,
      setViewerOverviewDragging,
      setViewerOverviewDraft,
      setHighlightCount,
      setViewerMatchLineIndices,
      setViewerScrollState,
    },
    refs: {
      sliceRequestRef,
      openFileRequestRef,
      sliceScrollAnchorRef,
      wheelSliceLockRef,
      readerDraftFrameRef,
      readerRailRef,
      viewerOverviewRailRef,
      virtualViewerRef,
      viewerContentShellRef,
      directoryInputRef,
    },
    callbacks: {
      withBusy,
      pushActivity,
      setActionStatus,
      showToast,
      setIsBusy,
      stopLiveFollow,
      startLiveFollow,
      scrollViewerToBottom,
      resetFileReaderState,
      cacheSlicePayload,
      getCachedSlice,
      warmSliceFromCache,
      warmNeighborSlicesFromCache,
      setContextMenu,
    },
    selectedServer,
  });

  const {
    fetchDirectoryListing, fetchLogSlice, warmSlice, resolveViewerJumpTarget,
    closeResultTab, focusHighlight, jumpToSearchMatch,
    enterPathbarEditMode, exitPathbarEditMode,
    handleViewerSelectionMouseDown,
    handleViewerSelectionMouseUp, handleCopyViewerSelection,
    openContextMenu, runSearch, browseLogFiles,
    commitDirectoryPath, openDirectoryFromInput, browseParentDirectory,
    openEntry, loadFileMeta, loadSlice, navigateSlice,
    handleViewerWheel, loadTailSlice, handleBackToBottom,
    loadHeadSlice, jumpToSliceRatio, commitReaderPosition,
    startReaderRailDrag, startViewerOverviewDrag, exportCurrentResults,
    selectedFileName, activeFileMeta, activeSliceData,
    activeResultTab, currentLogContent,
    viewerLineClickEnabled, canDragReaderPosition,
  } = logViewerAPI;

  useKeyboardShortcuts({
    activeLogView,
    activeViewerTabId,
    filePath,
    keywordInput,
    keywordInputRef,
    setShowKeywordBar,
    setShowQueryAdvanced,
    setKeywordInput,
    setActiveLogView,
    setActiveViewerTabId,
    enterPathbarEditMode,
    loadHeadSlice,
    loadTailSlice,
    navigateSlice,
    focusHighlight,
    normalizeSearchInput,
  });

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

  const {
    fetchServers,
    selectServerById,
    activateWorkspaceSession,
    closeWorkspaceSession,
    startCreateManualServer,
    startEditManualServer,
    saveManualServer,
    requestDeleteServer,
  } = useServerManagement({
    serverId,
    servers,
    workspaceSessions,
    activeWorkspaceSessionId,
    isWorkspaceSwitchLocked,
    manualServerDraft,
    workspaceSessionStatesRef,
    setServers,
    setServerId,
    setActionStatus,
    pushActivity,
    showToast,
    setConfirmDialog,
    setWorkspaceSessions,
    setActiveWorkspaceSessionId,
    setManualServerDraft,
    setSettingsWorkspaceView,
    setPendingLiveFollowRestore,
    setPreserveTerminalOnInactive,
    withBusy,
    checkLocalServiceHealth,
    startWorkspaceActivation,
    openSettingsWorkspace,
  });

  const {
    workspaceTabDragState,
    workspaceTabDragJustMovedRef,
    handleWorkspaceTabDragStart,
    handleWorkspaceTabDragOver,
    handleWorkspaceTabDrop,
    handleWorkspaceTabDragEnd
  } = useWorkspaceTabDrag(isWorkspaceSwitchLocked, setWorkspaceSessions);


  const {
    fetchFinalShellSettings,
    saveFinalShellPath,
    importFromTool,
    importFromFinalShell,
  } = useImportSettings({
    selectedImportTool,
    finalShellPath,
    setFinalShellPath,
    setFinalShellDetectedPaths,
    setFinalShellLastImportedAt,
    setXshellLastImportedAt,
    setImportPath,
    setImportStatus,
    setServers,
    setFilePath,
    setActionStatus,
    pushActivity,
    selectServerById,
    withBusy,
    checkLocalServiceHealth,
  });


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

  const {
    appendTransferHistory,
    requestClearTransferHistory,
    handleBrowseTransferHistoryPath,
    handleCopyTransferHistoryValue,
    handleRevealTransferHistoryLocalPath,
  } = useTransferHistory({
    serverId,
    selectedServer,
    transferHistory,
    currentServerTransferHistory,
    setTransferHistory,
    setActionStatus,
    pushActivity,
    showToast,
    setConfirmDialog,
    setShowTransferHistory,
    browseLogFiles,
    isElectron,
  });

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
  const {
    fetchCredentialStatus,
    fetchServerRoute,
    saveCredentialForServer,
    saveServerRouteForServer,
    searchJumpServerAssets,
    testServerConnection,
  } = useServerConnection({
    serverId,
    serverIdRef,
    credentialUsername,
    credentialPassword,
    credentialPrivateKey,
    preferredBastionId,
    jumpMode,
    jumpSearchKeyword,
    jumpAssetId,
    directoryPath,
    selectedServer,
    availableBastions,
    isBusy,
    setIsBusy,
    setActionStatus,
    pushActivity,
    showToast,
    setCredentialStatus,
    setCredentialPassword,
    setCredentialPrivateKey,
    setCredentialUsername,
    setServerRouteConfig,
    setPreferredBastionId,
    setJumpMode,
    setJumpSearchKeyword,
    setJumpAssetId,
    setJumpAssetOptions,
    setConnectionTestStatus,
    setDirectoryPath,
    setDirectoryInput,
    setFileEntries,
    jumpAssetAutoSearchKeyRef,
    withBusy,
    fetchServers,
    fetchDirectoryListing,
    rememberDirectoryIfUseful,
    openSettingsWorkspace,
  });

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

  const {
    openTerminalView,
    closeTerminalOverlay,
    toggleTerminalOverlay,
    restoreEmbeddedTerminalWindow,
    toggleTerminalPanel,
    openDetachedTerminalWindow,
    closeDetachedTerminalWindow,
  } = useTerminalWindowManager({
    terminalSessionId,
    setTerminalSessionId,
    terminalDetached,
    setTerminalDetached,
    terminalPanelOpen,
    setTerminalPanelOpen,
    terminalOverlay,
    setTerminalOverlay,
    preserveTerminalOnInactive,
    setPreserveTerminalOnInactive,
    serverId,
    serverIdRef,
    isElectron,
    isStandaloneTerminalWindow,
    selectedServer,
    preferredBastionId,
    terminalWorkingDirectory,
    workspaceSessions,
    activeWorkspaceSessionId,
    workspaceSessionStatesRef,
    readWorkspaceSessionState,
    storeWorkspaceSessionState,
    terminalSession,
    pip,
  });

  useEffect(() => {
    jumpAssetAutoSearchKeyRef.current = "";
  }, [
    jumpSearchKeyword,
    preferredBastionId,
    serverId
  ]);

  const {
    selectedFilePathSet,
    selectedFileEntries,
    directoryEntries,
    tableEntries,
    allVisibleFilesSelected,
    filteredGroupedServers,
    treeEntries,
    sidebarActivityLines,
    recentActivityLines,
  } = useFileBrowserComputed({
    fileEntries,
    fileFilter,
    selectedFilePaths,
    fileSortKey,
    fileSortDirection,
    servers,
    serverFilter,
    directoryPath,
    activityLines,
  });
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

  const keywordTerms = useMemo(() => parseKeywordTerms(keywordInput), [keywordInput]);
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
  const viewerTabs = useMemo(() => {
    const items: Array<{ id: string; label: string; kind: "file" | "result" }> = filePath
      ? [{ id: "file", label: selectedFileName || "当前文件", kind: "file" as const }]
      : [];

    return items.concat(resultTabs.map((tab) => ({ id: tab.id, label: tab.label, kind: "result" as const })));
  }, [filePath, resultTabs, selectedFileName]);
  const activeViewerCommandPreview = activeResultTab?.commandPreview || (activeViewerTabId === "file" ? results?.commandPreview : "");
  const activeViewerStrategyLabel = activeResultTab?.strategyLabel || (activeViewerTabId === "file" ? results?.strategyLabel : "");
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
  const liveStrategyLabel =
    searchTask?.strategyLabel ||
    activeViewerStrategyLabel ||
    describeSearchStrategyClient(keywordMode, keywordTerms, useRegex, startDate, endDate, startTime, endTime);
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
  const terminalConnectionLabel = selectedServer
    ? `${selectedServer.host || selectedServer.name || "--"} · ${directoryPath || selectedServer.basePath || "/"}`
    : (directoryPath || "/");
  const compactViewerTitle = selectedFileName || activeResultTab?.label || "搜索结果";
  const compactReaderHint = activeViewerTabId === "file"
    ? (liveFollowEnabled
      ? `实时：${liveFollowConnected ? (liveFollowPaused ? "已暂停滚动" : "接收中") : (liveFollowRetryCount > 0 ? `重连中 ${liveFollowRetryCount}` : "连接中")}${liveFollowContent ? ` · ${formatNumber(liveFollowContent.split("\n").length)} 行` : ""}`
      : lineContextState
        ? `定位到 ${formatNumber(lineContextState.lineNumber)} 行`
        : (highlightCount ? `命中 ${highlightCount} 处` : "滚轮到边缘可翻页"))
    : `结果 ${formatNumber(activeViewerMatchCount)} 条`;
  const viewerWheelHandlerRef = useRef<(event: ReactWheelEvent<HTMLDivElement>) => void>(() => {});
  const viewerNearBottomHandlerRef = useRef<(nearBottom: boolean) => void>(() => {});
  const viewerLineClickHandlerRef = useRef<((lineIndex: number, event: ReactMouseEvent<HTMLDivElement>) => void) | undefined>(undefined);


  liveReconnectRef.current = (target) => {
    void loadTailSlice().finally(() => {
      startLiveFollow(target.filePath, target.fileName, { isReconnect: true });
    });
  };

  viewerWheelHandlerRef.current = handleViewerWheel;
  viewerNearBottomHandlerRef.current = handleViewerNearBottomChange;
  viewerLineClickHandlerRef.current = viewerLineClickEnabled
    ? (lineIndex: number, _event: ReactMouseEvent<HTMLDivElement>) => {
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


  const {
    startLogRecording,
    stopLogRecording,
  } = useLogRecording({
    serverId,
    filePath,
    directoryPath,
    recordingSession,
    setRecordingSession,
    setPreviewDialog,
    setActionStatus,
    pushActivity,
    showToast,
    updateToast,
  });


  const {
    downloadFile,
    uploadFiles,
    uploadDirectory,
    handleFileDrop,
  } = useFileTransfer({
    serverId,
    directoryPath,
    isBusy,
    setDownloadProgress,
    setUploadProgress,
    setActionStatus,
    pushActivity,
    showToast,
    updateToast,
    dismissToast,
    appendTransferHistory,
    browseLogFiles,
    setIsDragOver,
  });

  const {
    deleteRemoteFile,
    confirmDeleteSelectedFiles,
    toggleFileSelection,
    clearSelectedFiles,
    toggleAllVisibleFiles,
    openRenameDialog,
    renameRemoteFile,
    openMoveDialog,
    openBatchMoveDialog,
    moveRemoteFile,
    moveRemoteEntries,
    extractZipFile,
    mkdirRemoteDir,
    compressRemotePath,
    previewFile,
    saveFileContent,
  } = useFileOperations({
    serverId,
    directoryPath,
    isBusy,
    selectedFileEntries,
    tableEntries,
    selectedFilePaths,
    previewDialog,
    setConfirmDialog,
    setRenameDialog,
    setMoveDialog,
    setBatchMoveDialog,
    setPreviewDialog,
    setSelectedFilePaths,
    setActionStatus,
    pushActivity,
    showToast,
    updateToast,
    withBusy,
    browseLogFiles,
  });

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
        <SidebarPanel
          uiTheme={uiTheme}
          isElectron={isElectron}
          showConnectionSettings={showConnectionSettings}
          actionStatus={actionStatus}
          serverFilter={serverFilter}
          onServerFilterChange={setServerFilter}
          servers={servers}
          serverId={serverId}
          selectServerById={selectServerById}
          connectionTestStatus={connectionTestStatus}
          showServiceOfflineState={showServiceOfflineState}
          filteredGroupedServers={filteredGroupedServers}
          localServiceStatusText={localServiceStatusText}
          connectionStateText={connectionStateText}
          selectedServer={selectedServer}
          directoryPath={directoryPath}
          activityPanelHeight={activityPanelHeight}
          sidebarActivityLines={sidebarActivityLines}
          onOpenSettingsWorkspace={openSettingsWorkspace}
          onCloseSettingsWorkspace={closeSettingsWorkspace}
          onActivityPanelResizeStart={handleActivityPanelResizeStart}
        />

      <section className={`main-panel ${isFileMode ? "main-panel-files" : ""}${(terminalPanelOpen || terminalDetached) ? " main-panel-with-terminal" : ""}`}>
          {!isStandalonePipWindow && workspaceSessions.length > 0 ? (
            <WorkspaceSessionTabs
              workspaceSessions={workspaceSessions}
              activeWorkspaceSessionId={activeWorkspaceSessionId}
              isWorkspaceSwitchLocked={isWorkspaceSwitchLocked}
              workspaceTabDragState={workspaceTabDragState}
              workspaceTabDragJustMovedRef={workspaceTabDragJustMovedRef}
              onActivateSession={activateWorkspaceSession}
              onCloseSession={closeWorkspaceSession}
              onContextMenu={setWorkspaceTabMenu}
              dragAPI={{
                handleWorkspaceTabDragStart,
                handleWorkspaceTabDragOver,
                handleWorkspaceTabDrop,
                handleWorkspaceTabDragEnd,
              }}
            />
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
            <WorkspaceStartupCards
              showServiceOfflineState={showServiceOfflineState}
              showNoServerState={showNoServerState}
              isElectron={isElectron}
              onCheckService={checkLocalServiceHealth}
              onOpenSettings={openSettingsWorkspace}
              onImportFinalShell={importFromFinalShell}
              onRefreshServers={fetchServers}
            />
            {!showServiceOfflineState && !showNoServerState && (
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

        <SettingsModalOverlay open={showConnectionSettings && !isStandalonePipWindow} onClose={closeSettingsWorkspace}>
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
        </SettingsModalOverlay>
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

      <WorkspaceTabContextMenu
        menu={workspaceTabMenu}
        menuRef={workspaceTabMenuRef}
        onClose={() => setWorkspaceTabMenu(null)}
        onCopyServerName={(session) => {
          void navigator.clipboard.writeText(session.serverName);
          setActionStatus("已复制服务器名称");
          showToast("success", "已复制服务器名称");
        }}
        onCopyServerHost={(session) => {
          void navigator.clipboard.writeText(session.serverHost);
          setActionStatus("已复制主机地址");
          showToast("success", "已复制主机地址");
        }}
        onCreateServer={startCreateManualServer}
        onCloseSession={closeWorkspaceSession}
      />

      <FeedbackOverlays
        downloadProgress={downloadProgress}
        uploadProgress={uploadProgress}
        toasts={toasts}
        onDismissToast={dismissToast}
      />

      <DialogOverlays
        uiTheme={uiTheme}
        renameDialog={renameDialog}
        moveDialog={moveDialog}
        batchMoveDialog={batchMoveDialog}
        extractDialog={extractDialog}
        mkdirDialog={mkdirDialog}
        compressDialog={compressDialog}
        previewDialog={previewDialog}
        confirmDialog={confirmDialog}
        showTransferHistory={showTransferHistory}
        transferHistoryEntries={currentServerTransferHistory}
        isElectron={isElectron}
        formatBytes={formatBytes}
        formatDateTime={formatDateTime}
        onRenameDialogChange={(value) => setRenameDialog((prev) => prev ? { ...prev, newName: value } : null)}
        onRenameDialogConfirm={() => {
          if (renameDialog && renameDialog.newName.trim() && renameDialog.newName !== renameDialog.entry.name) {
            void renameRemoteFile(renameDialog.entry, renameDialog.newName);
          }
        }}
        onRenameDialogClose={() => setRenameDialog(null)}
        onMoveDialogChange={(value) => setMoveDialog((prev) => prev ? { ...prev, targetDir: value } : null)}
        onMoveDialogConfirm={() => {
          if (moveDialog?.targetDir.trim()) {
            void moveRemoteFile(moveDialog.entry, moveDialog.targetDir);
          }
        }}
        onMoveDialogClose={() => setMoveDialog(null)}
        onBatchMoveDialogChange={(value) => setBatchMoveDialog((prev) => prev ? { ...prev, targetDir: value } : null)}
        onBatchMoveDialogConfirm={() => {
          if (batchMoveDialog?.targetDir.trim()) {
            void moveRemoteEntries(batchMoveDialog.entries, batchMoveDialog.targetDir);
          }
        }}
        onBatchMoveDialogClose={() => setBatchMoveDialog(null)}
        onExtractDialogChange={(value) => setExtractDialog((prev) => prev ? { ...prev, targetDir: value } : null)}
        onExtractDialogConfirm={() => {
          if (extractDialog?.targetDir.trim()) {
            void extractZipFile(extractDialog.filePath, extractDialog.targetDir);
          }
        }}
        onExtractDialogClose={() => setExtractDialog(null)}
        onMkdirDialogChange={(value) => setMkdirDialog((prev) => prev ? { ...prev, dirName: value } : null)}
        onMkdirDialogConfirm={() => {
          if (mkdirDialog?.dirName.trim()) {
            void mkdirRemoteDir(mkdirDialog.parentDir, mkdirDialog.dirName);
          }
        }}
        onMkdirDialogClose={() => setMkdirDialog(null)}
        onCompressDialogChange={(value) => setCompressDialog((prev) => prev ? { ...prev, targetDir: value } : null)}
        onCompressDialogConfirm={() => {
          if (compressDialog) {
            void compressRemotePath(compressDialog.sourcePath, compressDialog.archiveType, compressDialog.targetDir.trim() || undefined);
          }
        }}
        onCompressDialogClose={() => setCompressDialog(null)}
        onPreviewDialogChange={(value) => setPreviewDialog((prev) => prev ? { ...prev, content: value } : null)}
        onPreviewDialogDownload={() => {
          if (previewDialog) {
            void downloadFile(previewDialog.filePath);
          }
        }}
        onPreviewDialogSave={() => void saveFileContent()}
        onPreviewDialogToggleMaximize={() => setPreviewDialog((prev) => prev ? { ...prev, maximized: !prev.maximized } : null)}
        onPreviewDialogClose={() => {
          if (previewDialog && !previewDialog.readOnly && previewDialog.content !== previewDialog.originalContent) {
            setConfirmDialog({ title: "未保存的更改", message: "文件已修改但未保存，确定关闭？", danger: true, onConfirm: () => setPreviewDialog(null) });
          } else {
            setPreviewDialog(null);
          }
        }}
        onConfirmDialogClose={() => setConfirmDialog(null)}
        onTransferHistoryBrowsePath={handleBrowseTransferHistoryPath}
        onTransferHistoryCopyRemotePath={(path) => { void handleCopyTransferHistoryValue(path, "远程路径"); }}
        onTransferHistoryCopyLocalPath={(path) => { void handleCopyTransferHistoryValue(path, "本地路径"); }}
        onTransferHistoryRevealLocalPath={(path) => { void handleRevealTransferHistoryLocalPath(path); }}
        onTransferHistoryClear={requestClearTransferHistory}
        onTransferHistoryClose={() => setShowTransferHistory(false)}
      />
    </main>
  );
}
