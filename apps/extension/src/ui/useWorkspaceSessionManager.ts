import { type Dispatch, type SetStateAction } from "react";
import type { LogFileEntry, LogSearchTaskResponse } from "@server-log-console/shared";
import type { WorkspaceSession, WorkspaceSessionState } from "./types.js";
import type { ViewerResultTab } from "./utils.js";
import { createDefaultWorkspaceSessionState } from "./app-utils.js";
import { readLastDirectoryMap, writeLastServerId } from "./storage.js";

/**
 * Grouped setter functions for workspace session state.
 * Instead of passing 50+ individual setters, we group them into categories.
 */
export type WorkspaceSessionSetters = {
  // Core identity
  setActiveWorkspaceSessionId: (id: string | null) => void;
  setServerId: (id: string) => void;
  // Search/query
  setKeywordInput: (v: string) => void;
  setKeywordMode: (v: "phrase" | "any" | "all") => void;
  setExcludeInput: (v: string) => void;
  setContextLines: (v: number) => void;
  setUseRegex: (v: boolean) => void;
  setSelectedPreset: (v: string) => void;
  setStartDate: (v: string) => void;
  setEndDate: (v: string) => void;
  setStartTime: (v: string) => void;
  setEndTime: (v: string) => void;
  // Credential/connection
  setCredentialStatus: (v: WorkspaceSessionState["credentialStatus"]) => void;
  setCredentialUsername: (v: string) => void;
  setCredentialPassword: (v: string) => void;
  setCredentialPrivateKey: (v: string) => void;
  setServerRouteConfig: (v: WorkspaceSessionState["serverRouteConfig"]) => void;
  setConnectionTestStatus: (v: WorkspaceSessionState["connectionTestStatus"]) => void;
  setPreferredBastionId: (v: string) => void;
  // Jump server
  setJumpMode: (v: "auto" | "jumpserver-search") => void;
  setJumpSearchKeyword: (v: string) => void;
  setJumpAssetId: (v: string) => void;
  setJumpAssetOptions: (v: WorkspaceSessionState["jumpAssetOptions"]) => void;
  // Results/viewer
  setResults: (v: WorkspaceSessionState["results"]) => void;
  setResultTabs: Dispatch<SetStateAction<ViewerResultTab[]>>;
  setSearchTask: (v: LogSearchTaskResponse | null) => void;
  setSearchStartedAt: (v: number | null) => void;
  setActiveLogView: (v: "search" | "files") => void;
  setActiveViewerTabId: (v: string) => void;
  // File browser
  setDirectoryPath: (v: string) => void;
  setDirectoryInput: (v: string) => void;
  setFilePath: (v: string) => void;
  setFileEntries: (v: LogFileEntry[]) => void;
  // File reader
  setFileMeta: (v: WorkspaceSessionState["fileMeta"]) => void;
  setSliceOffset: (v: number) => void;
  setSliceLength: (v: number) => void;
  setSliceLengthMode: (v: "auto" | "manual") => void;
  setSliceData: (v: WorkspaceSessionState["sliceData"]) => void;
  setLineContextState: (v: WorkspaceSessionState["lineContextState"]) => void;
  setResultContextMode: (v: boolean) => void;
  setSelectedFilePaths: (v: string[]) => void;
  setResultTabCounter: Dispatch<SetStateAction<number>>;
  setActiveHighlightIndex: (v: number) => void;
  // UI toggles
  setShowQueryAdvanced: (v: boolean) => void;
  setShowFileTools: (v: boolean) => void;
  setErrorHighlightEnabled: (v: boolean) => void;
  setPathbarMode: (v: "browse" | "edit") => void;
  setBatchMoveDialog: (v: { entries: LogFileEntry[]; targetDir: string } | null) => void;
  setShowPathHistory: (v: boolean) => void;
  setShowTransferHistory: (v: boolean) => void;
  setFileLoadingName: (v: string) => void;
  // Terminal
  setTerminalSessionId: (v: string) => void;
  setTerminalDetached: (v: boolean) => void;
  setTerminalPanelOpen: (v: boolean) => void;
  setTerminalOverlay: (v: "none" | "shortcuts" | "ai") => void;
  setPreserveTerminalOnInactive: (v: boolean) => void;
  // Recording/live follow
  setRecordingSession: (v: WorkspaceSessionState["recordingSession"]) => void;
  setLiveFollowContent: (v: string) => void;
  setLiveFollowPaused: (v: boolean) => void;
  setPendingLiveFollowRestore: (v: WorkspaceSessionState | null) => void;
  // Reader
  setReaderPositionDraft: (v: number) => void;
  setReaderPositionDragging: (v: boolean) => void;
  setReaderPreviewContent: (v: string) => void;
  setReaderPreviewOffset: (v: number | null) => void;
  setReaderPreviewLoading: (v: boolean) => void;
};

export type WorkspaceSessionManagerParams = {
  // Current state values (for capture)
  serverId: string;
  activeWorkspaceSessionId: string | null;
  filePath: string;
  directoryPath: string;
  keywordInput: string;
  keywordMode: "phrase" | "any" | "all";
  excludeInput: string;
  contextLines: number;
  useRegex: boolean;
  selectedPreset: string;
  startDate: string;
  endDate: string;
  startTime: string;
  endTime: string;
  credentialStatus: WorkspaceSessionState["credentialStatus"];
  credentialUsername: string;
  serverRouteConfig: WorkspaceSessionState["serverRouteConfig"];
  connectionTestStatus: WorkspaceSessionState["connectionTestStatus"];
  preferredBastionId: string;
  jumpMode: "auto" | "jumpserver-search";
  jumpSearchKeyword: string;
  jumpAssetId: string;
  jumpAssetOptions: WorkspaceSessionState["jumpAssetOptions"];
  results: WorkspaceSessionState["results"];
  resultTabs: WorkspaceSessionState["resultTabs"];
  searchStartedAt: number | null;
  activeLogView: "search" | "files";
  activeViewerTabId: string;
  fileEntries: LogFileEntry[];
  fileMeta: WorkspaceSessionState["fileMeta"];
  sliceOffset: number;
  sliceLength: number;
  sliceLengthMode: "auto" | "manual";
  sliceData: WorkspaceSessionState["sliceData"];
  lineContextState: WorkspaceSessionState["lineContextState"];
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
  recordingSession: WorkspaceSessionState["recordingSession"];
  liveFollowEnabled: boolean;
  liveFollowPaused: boolean;
  liveFollowContent: string;

  // Grouped setters
  setters: WorkspaceSessionSetters;

  // Refs
  workspaceSessionStatesRef: React.MutableRefObject<Record<string, WorkspaceSessionState>>;
  pendingWorkspaceActivationRef: React.MutableRefObject<{ session: WorkspaceSession; state: WorkspaceSessionState; fromCache: boolean } | null>;
  restoringWorkspaceStateRef: React.MutableRefObject<WorkspaceSessionState | null>;
  restoringWorkspaceFromCacheRef: React.MutableRefObject<boolean>;
  skipServerSelectionResetRef: React.MutableRefObject<boolean>;
  skipServerAutoConnectRef: React.MutableRefObject<boolean>;
  jumpAssetAutoSearchKeyRef: React.MutableRefObject<string>;
  previewCacheRef: React.MutableRefObject<Map<string, { offset: number; content: string }>>;
  previewWarmRef: React.MutableRefObject<Set<string>>;
  sliceCacheRef: React.MutableRefObject<Map<string, WorkspaceSessionState["sliceData"]>>;
  sliceWarmRef: React.MutableRefObject<Set<string>>;

  // Context
  isStandaloneViewerWindow: boolean;
  isStandaloneTerminalWindow: boolean;
  defaultDirectoryPath: string;

  // External callbacks
  stopLiveFollow: (options?: { keepContent?: boolean }) => void;
  resetFileReaderState: () => void;
};

export type WorkspaceSessionManagerAPI = {
  getDefaultWorkspaceSessionState: (nextServerId: string) => WorkspaceSessionState;
  captureCurrentWorkspaceSessionState: (nextServerId?: string) => WorkspaceSessionState;
  storeWorkspaceSessionState: (sessionId: string, nextState: WorkspaceSessionState) => void;
  readWorkspaceSessionState: (session: WorkspaceSession) => WorkspaceSessionState;
  saveCurrentWorkspaceSessionState: () => void;
  applyWorkspaceSessionState: (session: WorkspaceSession, nextState: WorkspaceSessionState, options?: { fromCache?: boolean }) => void;
  startWorkspaceActivation: (session: WorkspaceSession, options?: { skipSaveCurrent?: boolean }) => void;
};

export function useWorkspaceSessionManager(params: WorkspaceSessionManagerParams): WorkspaceSessionManagerAPI {
  const {
    serverId,
    activeWorkspaceSessionId,
    filePath,
    directoryPath,
    keywordInput,
    keywordMode,
    excludeInput,
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
    setters,
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
  } = params;

  function getDefaultWorkspaceSessionState(nextServerId: string): WorkspaceSessionState {
    const savedDirectory = readLastDirectoryMap()[nextServerId]?.trim() || defaultDirectoryPath;
    return createDefaultWorkspaceSessionState(nextServerId, savedDirectory, isStandaloneViewerWindow, isStandaloneTerminalWindow);
  }

  function captureCurrentWorkspaceSessionState(nextServerId: string = serverId): WorkspaceSessionState {
    return {
      serverId: nextServerId,
      filePath,
      directoryPath,
      keywordInput,
      keywordMode,
      excludeInput,
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
      ...getDefaultWorkspaceSessionState(session.serverId),
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
    setters.setPendingLiveFollowRestore(nextState.liveFollowEnabled ? nextState : null);
    setters.setActiveWorkspaceSessionId(session.id);
    writeLastServerId(session.serverId);
    setters.setServerId(session.serverId);
    setters.setKeywordInput(nextState.keywordInput);
    setters.setKeywordMode(nextState.keywordMode);
    setters.setExcludeInput(nextState.excludeInput);
    setters.setContextLines(nextState.contextLines);
    setters.setUseRegex(nextState.useRegex);
    setters.setSelectedPreset(nextState.selectedPreset);
    setters.setStartDate(nextState.startDate);
    setters.setEndDate(nextState.endDate);
    setters.setStartTime(nextState.startTime);
    setters.setEndTime(nextState.endTime);
    setters.setCredentialStatus(nextState.credentialStatus);
    setters.setCredentialUsername(nextState.credentialUsername);
    setters.setCredentialPassword("");
    setters.setCredentialPrivateKey("");
    setters.setServerRouteConfig(nextState.serverRouteConfig);
    setters.setConnectionTestStatus(nextState.connectionTestStatus);
    setters.setPreferredBastionId(nextState.preferredBastionId);
    setters.setJumpMode(nextState.jumpMode);
    setters.setJumpSearchKeyword(nextState.jumpSearchKeyword);
    setters.setJumpAssetId(nextState.jumpAssetId);
    setters.setJumpAssetOptions([...nextState.jumpAssetOptions]);
    jumpAssetAutoSearchKeyRef.current = "";
    setters.setResults(nextState.results);
    setters.setResultTabs(nextState.resultTabs);
    setters.setSearchTask(null as any);
    setters.setSearchStartedAt(nextState.searchStartedAt);
    setters.setActiveLogView(nextState.activeLogView);
    setters.setActiveViewerTabId(nextState.activeViewerTabId);
    setters.setDirectoryPath(nextState.directoryPath);
    setters.setDirectoryInput(nextState.directoryPath || "/");
    setters.setFilePath(nextState.filePath);
    setters.setFileEntries(nextState.fileEntries);
    setters.setFileMeta(nextState.fileMeta);
    setters.setSliceOffset(nextState.sliceOffset);
    setters.setSliceLength(nextState.sliceLength);
    setters.setSliceLengthMode(nextState.sliceLengthMode);
    setters.setSliceData(nextState.sliceData);
    setters.setLineContextState(nextState.lineContextState);
    setters.setResultContextMode(nextState.resultContextMode);
    setters.setSelectedFilePaths(nextState.selectedFilePaths);
    setters.setResultTabCounter(nextState.resultTabCounter);
    setters.setActiveHighlightIndex(nextState.activeHighlightIndex);
    setters.setShowQueryAdvanced(nextState.showQueryAdvanced);
    setters.setShowFileTools(nextState.showFileTools);
    setters.setErrorHighlightEnabled(nextState.errorHighlightEnabled);
    setters.setPathbarMode("browse");
    setters.setBatchMoveDialog(null as any);
    setters.setShowPathHistory(nextState.showPathHistory);
    setters.setShowTransferHistory(nextState.showTransferHistory);
    setters.setFileLoadingName("");
    setters.setTerminalSessionId(nextState.terminalSessionId);
    setters.setTerminalDetached(nextState.terminalDetached);
    setters.setTerminalPanelOpen(nextState.terminalPanelOpen);
    setters.setTerminalOverlay(nextState.terminalOverlay);
    setters.setRecordingSession(nextState.recordingSession);
    setters.setLiveFollowContent(nextState.liveFollowContent);
    setters.setLiveFollowPaused(nextState.liveFollowPaused);
    setters.setReaderPositionDragging(false);
    setters.setReaderPreviewLoading(false);
    previewCacheRef.current.clear();
    previewWarmRef.current.clear();
    sliceCacheRef.current.clear();
    sliceWarmRef.current.clear();
    window.setTimeout(() => setters.setPreserveTerminalOnInactive(false), 0);
  }

  function startWorkspaceActivation(session: WorkspaceSession, options?: { skipSaveCurrent?: boolean }) {
    if (session.id === activeWorkspaceSessionId && session.serverId === serverId) {
      setters.setActiveWorkspaceSessionId(session.id);
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
      setters.setPreserveTerminalOnInactive(Boolean(terminalSessionId.trim()) || terminalDetached);
      setters.setTerminalDetached(false);
      setters.setTerminalPanelOpen(false);
      return;
    }

    applyWorkspaceSessionState(session, nextState, { fromCache: hasCachedState });
  }

  return {
    getDefaultWorkspaceSessionState,
    captureCurrentWorkspaceSessionState,
    storeWorkspaceSessionState,
    readWorkspaceSessionState,
    saveCurrentWorkspaceSessionState,
    applyWorkspaceSessionState,
    startWorkspaceActivation,
  };
}
