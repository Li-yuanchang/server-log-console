import { useMemo } from "react";
import type {
  LogFileEntry,
  LogFileMetaResponse,
  LogSearchResponse,
  LogSliceResponse,
  ServerSummary,
} from "@server-log-console/shared";
import type { ViewerResultTab, LineContextState } from "./utils.js";
import type { WorkspaceSessionSetters } from "./useWorkspaceSessionManager.js";
import {
  apiGetDirectoryListing,
  apiGetLogMeta,
  apiGetLogSlice,
  apiGetLineContext,
  apiCreateSearchTask,
  apiPollSearchTask,
  apiMultiFileSearch,
} from "./api.js";
import {
  clampSliceStart,
  clampPercent,
  copyText,
  downloadTextFile,
  formatBytes,
  formatNumber,
  formatPercent,
  formatSearchViewerContent,
  getParentDirectoryPath,
  normalizeSearchInput,
  parseKeywordTerms,
  searchWithinContent,
  searchWithinMatches,
} from "./utils.js";
import { computeAutoSliceLength } from "./app-utils.js";
import { MAX_RESULT_TABS } from "./types.js";
import { rememberDirectoryIfUseful, pushDirectoryHistory } from "./storage.js";
import { looksLikeJumpServer } from "./terminal-utils.js";

export type LogViewerState = {
  serverId: string;
  filePath: string;
  directoryPath: string;
  directoryInput: string;
  keywordInput: string;
  keywordMode: "phrase" | "any" | "all";
  excludeInput: string;
  contextLines: number;
  useRegex: boolean;
  startDate: string;
  endDate: string;
  startTime: string;
  endTime: string;
  sliceOffset: number;
  sliceLength: number;
  sliceLengthMode: "auto" | "manual";
  sliceData: LogSliceResponse | null;
  fileMeta: LogFileMetaResponse | null;
  fileEntries: LogFileEntry[];
  results: LogSearchResponse | null;
  resultTabs: ViewerResultTab[];
  resultTabCounter: number;
  activeLogView: "search" | "files";
  activeViewerTabId: string;
  activeHighlightIndex: number;
  showPathHistory: boolean;
  showTransferHistory: boolean;
  isBusy: boolean;
  liveFollowEnabled: boolean;
  liveFollowPaused: boolean;
  liveFollowContent: string;
  lineContextState: LineContextState | null;
  resultContextMode: boolean;
  highlightCount: number;
  selectedFilePaths: string[];
  viewerSelMenu: { x: number; y: number; text: string } | null;
  readerPositionDraft: number;
  readerPositionDragging: boolean;
  viewerOverviewDragging: boolean;
  viewerOverviewDraft: number;
  viewerOverviewTotalLines: number | null;
  multiFileMode: boolean;
  filePattern: string;
};

export type LogViewerRefs = {
  jumpToMatchRequestRef: React.MutableRefObject<number>;
  sliceRequestRef: React.MutableRefObject<number>;
  openFileRequestRef: React.MutableRefObject<number>;
  sliceScrollAnchorRef: React.MutableRefObject<"top" | "bottom" | null>;
  wheelSliceLockRef: React.MutableRefObject<boolean>;
  readerDraftFrameRef: React.MutableRefObject<number | null>;
  readerRailRef: React.MutableRefObject<HTMLElement | null>;
  viewerOverviewRailRef: React.MutableRefObject<HTMLElement | null>;
  virtualViewerRef: React.MutableRefObject<any>;
  viewerContentShellRef: React.MutableRefObject<HTMLElement | null>;
  directoryInputRef: React.MutableRefObject<HTMLInputElement | null>;
};

export type LogViewerCallbacks = {
  withBusy: <T>(label: string, fn: () => Promise<T>) => Promise<T | null>;
  pushActivity: (msg: string) => void;
  setActionStatus: (msg: string) => void;
  showToast: (type: "loading" | "success" | "error", msg: string) => string;
  setIsBusy: (b: boolean) => void;
  stopLiveFollow: (options?: { keepContent?: boolean }) => void;
  startLiveFollow: (filePath: string, fileName: string, options?: { isReconnect?: boolean }) => void;
  scrollViewerToBottom: () => void;
  resetFileReaderState: () => void;
  cacheSlicePayload: (payload: LogSliceResponse, offset: number, length: number) => void;
  getCachedSlice: (filePath: string, offset: number, length: number) => LogSliceResponse | null;
  warmSliceFromCache: (filePath: string, offset: number, length: number, fetcher: (p: string, o: number, l: number) => Promise<LogSliceResponse>) => Promise<LogSliceResponse | null>;
  warmNeighborSlicesFromCache: (filePath: string, payload: LogSliceResponse, length: number, fetcher: (p: string, o: number, l: number) => Promise<LogSliceResponse>) => void;
  setContextMenu: (v: { x: number; y: number; entry: LogFileEntry } | null) => void;
};

export type LogViewerParams = {
  state: LogViewerState;
  setters: WorkspaceSessionSetters & {
    setIsBusy: (b: boolean) => void;
    setViewerSelMenu: (v: { x: number; y: number; text: string } | null) => void;
    setViewerOverviewDragging: (b: boolean) => void;
    setViewerOverviewDraft: (v: number) => void;
    setHighlightCount: (n: number) => void;
    setViewerMatchLineIndices: (indices: number[]) => void;
    setViewerScrollState: (s: any) => void;
    setIsDirectoryLoading: (b: boolean) => void;
  };
  refs: LogViewerRefs;
  callbacks: LogViewerCallbacks;
  selectedServer: ServerSummary | null;
};

export type LogViewerAPI = {
  fetchDirectoryListing: (path: string) => Promise<any>;
  fetchLogMeta: (path: string) => Promise<LogFileMetaResponse>;
  fetchLogSlice: (path: string, offset: number, length: number) => Promise<LogSliceResponse>;
  fetchLineContext: (path: string, line: number, ctx?: number) => Promise<LineContextState>;
  warmSlice: (path: string, offset: number, length: number) => Promise<LogSliceResponse | null>;
  warmNeighborSlices: (path: string, payload: LogSliceResponse, length: number) => void;
  resolveViewerJumpTarget: (lineIndex: number) => LogSearchResponse["matches"][number] | null;
  appendResultTab: (payload: LogSearchResponse, label: string, tabLabelOverride?: string) => void;
  replaceLastResultTab: (payload: LogSearchResponse) => void;
  closeResultTab: (tabId: string) => void;
  focusHighlight: (direction: "prev" | "next") => void;
  applySlicePayload: (payload: LogSliceResponse, options?: { status?: string; activity?: string }) => void;
  jumpToSearchMatch: (match: LogSearchResponse["matches"][number]) => Promise<void>;
  toggleLiveFollow: (enabled: boolean) => Promise<void>;
  enterPathbarEditMode: (options?: { selectAll?: boolean }) => void;
  exitPathbarEditMode: () => void;
  clearViewerSelection: () => void;
  handleViewerSelectionMouseDown: () => void;
  handleViewerSelectionMouseUp: (event: any) => void;
  handleCopyViewerSelection: () => Promise<void>;
  openContextMenu: (entry: LogFileEntry, x: number, y: number) => void;
  runSearch: () => Promise<void>;
  browseLogFiles: (path?: string, options?: { manual?: boolean }) => Promise<void>;
  commitDirectoryPath: (path?: string) => Promise<void>;
  openDirectoryFromInput: () => Promise<void>;
  browseParentDirectory: () => Promise<void>;
  openEntry: (entry: LogFileEntry) => Promise<void>;
  loadFileMeta: (path?: string) => Promise<void>;
  loadSlice: (offset?: number, length?: number) => Promise<void>;
  navigateSlice: (direction: "prev" | "next", source?: "button" | "wheel" | "keyboard") => Promise<void>;
  handleViewerWheel: (event: any) => void;
  loadTailSlice: () => Promise<void>;
  handleBackToBottom: () => Promise<void>;
  loadHeadSlice: () => Promise<void>;
  jumpToSliceRatio: (ratio: number) => Promise<void>;
  commitReaderPosition: (percent: number) => Promise<void>;
  startReaderRailDrag: (clientY: number) => void;
  startViewerOverviewDrag: (clientY: number) => void;
  exportCurrentResults: () => Promise<void>;
  // Derived values (computed internally)
  selectedFileName: string;
  activeFileMeta: LogFileMetaResponse | null;
  activeSliceData: LogSliceResponse | null;
  activeResultTab: ViewerResultTab | null;
  activeViewerMatches: LogSearchResponse["matches"];
  currentLogContent: string;
  viewerLineClickEnabled: boolean;
  canDragReaderPosition: boolean;
};

export function useLogViewer(params: LogViewerParams): LogViewerAPI {
  const { state, setters, refs, callbacks, selectedServer } = params;

  // Derived values — computed here to avoid declaration-order issues in App.tsx
  const selectedFileName = state.filePath ? state.filePath.split("/").pop() ?? state.filePath : "";
  const activeFileMeta = state.fileMeta?.filePath === state.filePath ? state.fileMeta : null;
  const activeSliceData = state.sliceData?.filePath === state.filePath ? state.sliceData : null;
  const activeResultTab = useMemo(
    () => state.resultTabs.find((tab) => tab.id === state.activeViewerTabId) ?? null,
    [state.activeViewerTabId, state.resultTabs]
  );
  const showingPrimaryResults = state.activeViewerTabId === "results-root";
  const activeViewerMatches = activeResultTab?.matches ?? (state.activeViewerTabId === "file" ? state.results?.matches ?? [] : (showingPrimaryResults ? state.results?.matches ?? [] : []));
  const currentFileContent = state.liveFollowEnabled
    ? state.liveFollowContent || state.sliceData?.content || ""
    : state.lineContextState?.content || state.liveFollowContent || state.sliceData?.content || "";
  const currentLogContent = activeResultTab
    ? (state.resultContextMode && activeResultTab.fullContent ? activeResultTab.fullContent : activeResultTab.content)
    : (showingPrimaryResults
      ? (state.resultContextMode && state.results?.contextOutput ? state.results.contextOutput : state.results?.rawOutput || "")
      : currentFileContent);
  const viewerLineClickEnabled = state.activeViewerTabId !== "file" && activeViewerMatches.length > 0;
  const canDragReaderPosition = useMemo(() => {
    if (!activeFileMeta?.size || !activeSliceData) {
      return false;
    }
    return activeFileMeta.size > state.sliceLength;
  }, [activeFileMeta, activeSliceData, state.sliceLength]);

  async function fetchDirectoryListing(targetDirectoryPath: string) {
    const isBastionSftp = selectedServer?.connectionKind === "bastion" && looksLikeJumpServer(selectedServer);
    return apiGetDirectoryListing(
      isBastionSftp
        ? { bastionId: state.serverId, directoryPath: targetDirectoryPath }
        : { serverId: state.serverId, directoryPath: targetDirectoryPath }
    );
  }

  async function fetchLogMeta(targetFilePath: string) {
    return apiGetLogMeta(state.serverId, targetFilePath);
  }

  async function fetchLogSlice(targetFilePath: string, targetOffset: number, targetLength: number) {
    return apiGetLogSlice(state.serverId, targetFilePath, targetOffset, targetLength);
  }

  async function fetchLineContext(targetFilePath: string, lineNumber: number, context = 12): Promise<LineContextState> {
    const raw = await apiGetLineContext(state.serverId, targetFilePath, lineNumber, context);
    return { ...raw, sourceLabel: targetFilePath.split("/").pop() || targetFilePath };
  }

  async function warmSlice(targetFilePath: string, targetOffset: number, targetLength: number) {
    return callbacks.warmSliceFromCache(targetFilePath, targetOffset, targetLength, fetchLogSlice);
  }

  function warmNeighborSlices(targetFilePath: string, payload: LogSliceResponse, targetLength: number) {
    callbacks.warmNeighborSlicesFromCache(targetFilePath, payload, targetLength, fetchLogSlice);
  }

  function resolveViewerJumpTarget(lineIndex: number): LogSearchResponse["matches"][number] | null {
    if (!activeViewerMatches.length) return null;
    const lines = currentLogContent.split("\n");
    const rawLine = lines[lineIndex] || "";
    const parsed = rawLine.match(/^\s*(\d+)\s*(?:\||\t)\s?(.*)$/);
    if (parsed) {
      const lineNumber = Number(parsed[1]);
      if (Number.isFinite(lineNumber) && lineNumber > 0) {
        return { source: activeViewerMatches[0]?.source || activeResultTab?.sourceLabel || state.filePath, lineNumber, preview: parsed[2] || rawLine.trim() };
      }
      return null;
    }
    return state.resultContextMode ? null : (activeViewerMatches[lineIndex] || null);
  }

  function appendResultTab(payload: LogSearchResponse, sourceLabel: string, tabLabelOverride?: string) {
    const nextId = `result-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const nextLabel = tabLabelOverride || `结果 ${state.resultTabCounter}`;
    const compactContent = formatSearchViewerContent(payload, undefined);
    const fullContent = formatSearchViewerContent(payload, "contextOutput");
    const nextTab: ViewerResultTab = { id: nextId, label: nextLabel, sourceLabel, content: compactContent, fullContent, matches: payload.matches, commandPreview: payload.commandPreview, strategyLabel: payload.strategyLabel, scopeLabel: payload.scopeLabel, matchCount: payload.matches.length };
    setters.setResultTabs((current: ViewerResultTab[]) => {
      const nextTabs = [...current, nextTab];
      return nextTabs.length > MAX_RESULT_TABS ? nextTabs.slice(nextTabs.length - MAX_RESULT_TABS) : nextTabs;
    });
    setters.setActiveViewerTabId(nextId);
    setters.setResultTabCounter((current: number) => current + 1);
  }

  function replaceLastResultTab(payload: LogSearchResponse) {
    setters.setResultTabs((current: ViewerResultTab[]) => {
      if (current.length === 0) return current;
      const last = current[current.length - 1];
      const compactContent = formatSearchViewerContent(payload, undefined);
      const fullContent = payload.contextOutput || (payload.rawOutput && payload.rawOutput !== compactContent ? payload.rawOutput : undefined);
      const updated: ViewerResultTab = { ...last, content: compactContent, fullContent, matches: payload.matches, commandPreview: payload.commandPreview, strategyLabel: payload.strategyLabel, scopeLabel: payload.scopeLabel, matchCount: payload.matches.length };
      return [...current.slice(0, -1), updated];
    });
  }

  function closeResultTab(tabId: string) {
    setters.setResultTabs((current: ViewerResultTab[]) => {
      const nextTabs = current.filter((tab) => tab.id !== tabId);
      if (state.activeViewerTabId === tabId) {
        const fallback = nextTabs[nextTabs.length - 1];
        setters.setActiveViewerTabId(fallback?.id || (state.filePath ? "file" : ""));
      }
      return nextTabs;
    });
  }

  function focusHighlight(direction: "prev" | "next") {
    const count = state.highlightCount;
    if (!count) return;
    const nextIndex = direction === "next" ? (state.activeHighlightIndex + 1) % count : (state.activeHighlightIndex - 1 + count) % count;
    setters.setActiveHighlightIndex(nextIndex);
    callbacks.setActionStatus(`已定位到第 ${nextIndex + 1} 个命中，共 ${count} 个。`);
  }

  function applySlicePayload(payload: LogSliceResponse, options?: { status?: string; activity?: string }) {
    setters.setLineContextState(null);
    setters.setSliceOffset(payload.actualOffset);
    setters.setSliceData({ ...payload });
    setters.setActiveLogView("search");
    setters.setActiveViewerTabId("file");
    if (options?.status) callbacks.setActionStatus(options.status);
    if (options?.activity) callbacks.pushActivity(options.activity);
  }

  async function jumpToSearchMatch(match: LogSearchResponse["matches"][number]) {
    if (!match.source || match.source === "临时结果") {
      callbacks.setActionStatus("当前结果页来自临时筛选，暂时不能直接跳回原日志文件。");
      return;
    }
    const targetFilePath = match.source;
    const requestId = refs.jumpToMatchRequestRef.current + 1;
    refs.jumpToMatchRequestRef.current = requestId;

    setters.setFilePath(targetFilePath);
    setters.setActiveLogView("search");
    setters.setActiveViewerTabId("file");
    setters.setFileMeta(null);
    setters.setLineContextState(null);
    setters.setActiveHighlightIndex(-1);
    callbacks.stopLiveFollow();
    callbacks.setActionStatus(`正在定位第 ${formatNumber(match.lineNumber)} 行附近...`);

    try {
      const contextPayload = await fetchLineContext(targetFilePath, match.lineNumber, Math.max(60, state.contextLines * 4));
      if (refs.jumpToMatchRequestRef.current !== requestId) {
        return;
      }

      setters.setLineContextState({ ...contextPayload, sourceLabel: targetFilePath.split("/").pop() || targetFilePath });
      callbacks.setActionStatus(`已定位到第 ${formatNumber(match.lineNumber)} 行附近。`);
      callbacks.pushActivity(`已定位搜索命中：${targetFilePath} 第 ${formatNumber(match.lineNumber)} 行。`);

      void fetchLogMeta(targetFilePath)
        .then((metaPayload) => {
          if (refs.jumpToMatchRequestRef.current !== requestId) {
            return;
          }
          setters.setFileMeta(metaPayload);
        })
        .catch(() => {
          // Metadata is supplemental for jump navigation; ignore late failures here.
        });
    } catch (error) {
      if (refs.jumpToMatchRequestRef.current !== requestId) {
        return;
      }
      const detail = error instanceof Error ? error.message : "未知错误";
      callbacks.setActionStatus(`按行定位失败：${detail}`);
      callbacks.pushActivity(`按行定位失败：${detail}`);
    }
  }

  async function toggleLiveFollow(nextEnabled: boolean) {
    if (!state.filePath.trim()) return;
    if (!nextEnabled) {
      callbacks.stopLiveFollow({ keepContent: true });
      callbacks.showToast("success", "已关闭实时跟随。");
      callbacks.pushActivity(`已关闭实时跟随：${state.filePath}。`);
      return;
    }
    await loadTailSlice();
    callbacks.startLiveFollow(state.filePath, selectedFileName || state.filePath);
  }

  function enterPathbarEditMode(options?: { selectAll?: boolean }) {
    if (!state.serverId) return;
    setters.setShowPathHistory(false);
    setters.setDirectoryInput(state.directoryPath || state.directoryInput || "/");
    setters.setPathbarMode("edit");
    window.setTimeout(() => {
      const input = refs.directoryInputRef.current;
      if (!input) return;
      input.focus();
      if (options?.selectAll) { input.select(); return; }
      const length = input.value.length;
      input.setSelectionRange(length, length);
    }, 0);
  }

  function exitPathbarEditMode() {
    setters.setPathbarMode("browse");
    setters.setDirectoryInput(state.directoryPath || "/");
  }

  function clearViewerSelection() { globalThis.getSelection?.()?.removeAllRanges(); }

  function handleViewerSelectionMouseDown() { setters.setViewerSelMenu(null); }

  function handleViewerSelectionMouseUp(event: any) {
    window.setTimeout(() => {
      const container = refs.viewerContentShellRef.current;
      const selection = globalThis.getSelection?.();
      const text = selection?.toString().trim() || "";
      if (!container || !selection || selection.isCollapsed || !text || !((selection.anchorNode && container.contains(selection.anchorNode)) || (selection.focusNode && container.contains(selection.focusNode)))) {
        setters.setViewerSelMenu(null);
        return;
      }
      const rect = container.getBoundingClientRect();
      const nextX = Math.min(Math.max(8, event.clientX - rect.left), Math.max(8, rect.width - 44));
      const nextY = Math.min(Math.max(8, event.clientY - rect.top), Math.max(8, rect.height - 44));
      setters.setViewerSelMenu({ x: nextX, y: nextY, text });
    }, 10);
  }

  async function handleCopyViewerSelection() {
    if (!state.viewerSelMenu?.text) return;
    try {
      await copyText(state.viewerSelMenu.text);
      callbacks.setActionStatus("已复制选中文本。");
      callbacks.showToast("success", "已复制选中文本");
    } catch (error) {
      const detail = error instanceof Error ? error.message : "未知错误";
      callbacks.setActionStatus(`复制失败：${detail}`);
      callbacks.showToast("error", `复制失败：${detail}`);
    } finally { clearViewerSelection(); setters.setViewerSelMenu(null); }
  }

  function openContextMenu(entry: LogFileEntry, x: number, y: number) {
    const menuWidth = 180;
    const menuHeight = entry.kind === "file" ? 260 : 190;
    const nextX = Math.min(Math.max(8, x), Math.max(8, window.innerWidth - menuWidth - 8));
    const nextY = Math.min(Math.max(8, y), Math.max(8, window.innerHeight - menuHeight - 8));
    callbacks.setContextMenu({ x: nextX, y: nextY, entry });
  }

  async function runSearch() {
    const normalizedInput = normalizeSearchInput(state.keywordInput);
    const normalizedTerms = parseKeywordTerms(state.keywordInput);
    if (!normalizedInput || !normalizedTerms.length) { callbacks.setActionStatus("先输入关键字再搜索。"); return; }
    const excludeTerms = parseKeywordTerms(state.excludeInput);
    if (state.activeViewerTabId !== "file" && activeResultTab) {
      const localResult = activeResultTab.matches.length
        ? searchWithinMatches(activeResultTab.matches, state.keywordMode, normalizedTerms, state.useRegex, state.contextLines, excludeTerms)
        : searchWithinContent(activeResultTab.content, state.keywordMode, normalizedTerms, state.useRegex, state.contextLines, excludeTerms);
      setters.setResults(localResult);
      appendResultTab(localResult, activeResultTab.sourceLabel);
      setters.setActiveLogView("search");
      callbacks.setActionStatus(`已在 ${activeResultTab.label} 内继续筛选，命中 ${localResult.matches.length} 行。`);
      callbacks.pushActivity(`结果页继续筛选完成：${activeResultTab.label} / 命中 ${localResult.matches.length} 行。`);
      return;
    }
    // Multi-file search mode
    if (state.multiFileMode) {
      const startedAt = Date.now();
      setters.setSearchStartedAt(startedAt);
      setters.setIsBusy(true);
      callbacks.setActionStatus("正在跨文件检索...");
      setters.setSearchTask(null);
      setters.setResults(null);
      try {
        const multiResult = await apiMultiFileSearch({
          serverId: state.serverId,
          directoryPath: state.directoryPath || state.filePath,
          filePattern: state.filePattern || "*.log",
          keyword: normalizedInput,
          keywordTerms: normalizedTerms,
          keywordMode: state.keywordMode,
          excludeTerms: excludeTerms.length ? excludeTerms : undefined,
          startDate: state.startDate,
          endDate: state.endDate,
          startTime: state.startTime,
          endTime: state.endTime,
          useRegex: state.useRegex
        });
        const searchResponse: LogSearchResponse = {
          matches: multiResult.matches,
          rawOutput: multiResult.matches.map((m) => `${m.source}:${m.lineNumber}:${m.preview}`).join("\n"),
          truncated: false,
          commandPreview: multiResult.commandPreview || "",
          strategyLabel: "多文件搜索",
          scopeLabel: multiResult.scopeLabel || ""
        };
        setters.setResults(searchResponse);
        appendResultTab(searchResponse, `${state.directoryPath} (${multiResult.scannedFiles} 文件)`);
        setters.setActiveLogView("search");
        callbacks.setActionStatus(`跨文件检索完成，${multiResult.matchedFiles} 个文件命中 ${multiResult.matches.length} 行。`);
        callbacks.pushActivity(`多文件搜索完成：${multiResult.matchedFiles} 文件 / ${multiResult.matches.length} 行`);
      } catch (error) {
        const detail = error instanceof Error ? error.message : "未知错误";
        callbacks.setActionStatus(`多文件搜索失败：${detail}`);
        callbacks.pushActivity(`多文件搜索失败：${detail}`);
      } finally { setters.setIsBusy(false); setters.setSearchStartedAt(null); }
      return;
    }
    const startedAt = Date.now();
    setters.setSearchStartedAt(startedAt);
    setters.setIsBusy(true);
    callbacks.setActionStatus("正在检索远程日志...");
    setters.setSearchTask(null);
    setters.setResults(null);
    try {
      const primaryKeyword = state.keywordMode === "phrase" ? normalizedInput : normalizedTerms[0] || "";
      const taskPayload = await apiCreateSearchTask({ serverId: state.serverId, filePath: state.filePath, keyword: primaryKeyword, keywordTerms: normalizedTerms, keywordMode: state.keywordMode, excludeTerms: excludeTerms.length ? excludeTerms : undefined, startDate: state.startDate, endDate: state.endDate, startTime: state.startTime, endTime: state.endTime, contextLines: state.contextLines, useRegex: state.useRegex });
      setters.setSearchTask(taskPayload);
      setters.setActiveLogView("search");
      callbacks.pushActivity(`搜索任务已启动：${taskPayload.strategyLabel || "分片扫描"} / ${taskPayload.scopeLabel || state.filePath}`);
      let currentTask = taskPayload;
      let quickResultShown = false;
      while (currentTask.status === "queued" || currentTask.status === "running") {
        await new Promise((resolve) => window.setTimeout(resolve, 450));
        currentTask = await apiPollSearchTask(currentTask.taskId);
        setters.setSearchTask(currentTask);
        if (currentTask.quickResult && !quickResultShown) {
          quickResultShown = true;
          setters.setResults(currentTask.quickResult);
          appendResultTab(currentTask.quickResult, selectedFileName || state.filePath || "当前文件");
          callbacks.setActionStatus(`尾部快搜命中 ${currentTask.quickResult.matches.length} 行，全文扫描继续中...`);
          callbacks.pushActivity(`尾部快搜完成：命中 ${currentTask.quickResult.matches.length} 行，全文扫描继续中...`);
        }
      }
      if (currentTask.status === "failed") throw new Error(currentTask.errorMessage || "搜索任务失败");
      const finalResult = currentTask.result || null;
      setters.setResults(finalResult);
      if (finalResult) { quickResultShown ? replaceLastResultTab(finalResult) : appendResultTab(finalResult, selectedFileName || state.filePath || "当前文件"); }
      callbacks.setActionStatus(`检索完成，命中 ${finalResult?.matches.length ?? 0} 行。`);
      callbacks.pushActivity(`检索完成：${selectedServer?.name || state.serverId} / ${state.filePath} / 命中 ${finalResult?.matches.length ?? 0} 行。`);
    } catch (error) {
      const detail = error instanceof Error ? error.message : "未知错误";
      callbacks.setActionStatus(`操作失败：${detail}`);
      callbacks.pushActivity(`操作失败：${detail}`);
    } finally { setters.setIsBusy(false); setters.setSearchStartedAt(null); }
  }

  async function browseLogFiles(nextDirectoryPath?: string, _options?: { manual?: boolean }) {
    if (!state.serverId) return;
    callbacks.stopLiveFollow();
    setters.setShowPathHistory(false);
    setters.setShowTransferHistory(false);
    setters.setIsDirectoryLoading(true);
    await callbacks.withBusy("正在读取远程目录...", async () => {
      const payload = await fetchDirectoryListing(nextDirectoryPath || state.directoryPath || "/");
      setters.setDirectoryPath(payload.directoryPath);
      setters.setDirectoryInput(payload.directoryPath);
      setters.setPathbarMode("browse");
      setters.setSelectedFilePaths([]);
      setters.setBatchMoveDialog(null);
      setters.setFileEntries(payload.entries);
      setters.setActiveLogView("files");
      rememberDirectoryIfUseful(state.serverId, payload.directoryPath, payload.entries.length);
      pushDirectoryHistory(state.serverId, payload.directoryPath);
      callbacks.setActionStatus(`目录读取完成，共 ${payload.entries.length} 项。`);
      callbacks.pushActivity(`已打开目录：${payload.directoryPath}，共 ${payload.entries.length} 项。`);
    }).finally(() => {
      setters.setIsDirectoryLoading(false);
    });
  }

  async function commitDirectoryPath(nextDirectoryPath?: string) {
    if (!state.serverId) return;
    const targetDirectory = nextDirectoryPath?.trim() || state.directoryInput.trim() || state.directoryPath || "/";
    await browseLogFiles(targetDirectory, { manual: true });
  }

  async function openDirectoryFromInput() {
    if (!state.serverId) return;
    await commitDirectoryPath(state.directoryInput);
  }

  async function browseParentDirectory() {
    if (!state.serverId) return;
    await commitDirectoryPath(getParentDirectoryPath(state.directoryPath || state.directoryInput || "/"));
  }

  async function openEntry(entry: LogFileEntry) {
    if (entry.kind === "directory") { await browseLogFiles(entry.path, { manual: true }); return; }
    const requestId = refs.openFileRequestRef.current + 1;
    refs.openFileRequestRef.current = requestId;
    callbacks.stopLiveFollow();
    setters.setFilePath(entry.path);
    callbacks.resetFileReaderState();
    setters.setShowFileTools(false);
    setters.setActiveViewerTabId("file");
    setters.setActiveLogView("search");
    setters.setFileLoadingName(entry.name);
    callbacks.pushActivity(`已选择日志文件：${entry.path}`);
    setters.setIsBusy(true);
    callbacks.setActionStatus("正在打开日志文件...");
    try {
      const effectiveLength = state.sliceLengthMode === "auto" ? computeAutoSliceLength(0) : state.sliceLength;
      const slicePayload = await fetchLogSlice(entry.path, -1, effectiveLength);
      if (refs.openFileRequestRef.current !== requestId || slicePayload.filePath !== entry.path) return;
      const derivedSize = slicePayload.fileSize ?? (slicePayload.actualOffset + slicePayload.actualLength);
      setters.setFileMeta({ filePath: entry.path, size: derivedSize, modifiedTime: slicePayload.modifiedTime ?? new Date().toISOString(), readable: true, encodingHint: "utf-8" });
      const realEffectiveLength = state.sliceLengthMode === "auto" ? computeAutoSliceLength(derivedSize) : state.sliceLength;
      if (state.sliceLengthMode === "auto" && realEffectiveLength !== state.sliceLength) setters.setSliceLength(realEffectiveLength);
      callbacks.cacheSlicePayload(slicePayload, slicePayload.actualOffset, realEffectiveLength);
      warmNeighborSlices(entry.path, slicePayload, realEffectiveLength);
      refs.sliceRequestRef.current += 1;
      setters.setSliceOffset(slicePayload.actualOffset);
      setters.setSliceData(slicePayload);
      setters.setFileLoadingName("");
      callbacks.setActionStatus(`已打开 ${entry.name}，尾部切片已加载。`);
      callbacks.pushActivity(`已打开日志文件：${entry.path}，尾部 ${formatBytes(slicePayload.actualLength)} 已显示。`);
      const lowerName = entry.name.toLowerCase();
      if (lowerName.endsWith(".log") || lowerName.endsWith(".out")) callbacks.startLiveFollow(entry.path, entry.name);
    } catch (error) {
      const detail = error instanceof Error ? error.message : "未知错误";
      callbacks.setActionStatus(`打开失败：${detail}`);
      callbacks.pushActivity(`打开失败：${detail}`);
      callbacks.showToast("error", `打开失败：${detail}`);
    } finally { setters.setIsBusy(false); setters.setFileLoadingName(""); }
  }

  async function loadFileMeta(targetFilePath?: string) {
    const nextFilePath = targetFilePath || state.filePath;
    if (!nextFilePath.trim()) return;
    await callbacks.withBusy("正在读取日志元信息...", async () => {
      const payload = await fetchLogMeta(nextFilePath);
      if (payload.filePath !== nextFilePath) return;
      setters.setFileMeta(payload);
      callbacks.setActionStatus(`已读取元信息，文件大小 ${formatBytes(payload.size)}。`);
      callbacks.pushActivity(`已读取元信息：${payload.filePath}，大小 ${formatBytes(payload.size)}。`);
    });
  }

  async function loadSlice(targetOffset = state.sliceOffset, targetLength = state.sliceLength) {
    const targetFilePath = state.filePath;
    if (!targetFilePath.trim()) return;
    const cachedPayload = callbacks.getCachedSlice(targetFilePath, targetOffset, targetLength);
    if (cachedPayload) {
      applySlicePayload(cachedPayload, { status: `已从缓存切换，偏移 ${formatNumber(cachedPayload.actualOffset)}。`, activity: `已命中缓存切片：偏移 ${formatNumber(cachedPayload.actualOffset)}。` });
      warmNeighborSlices(targetFilePath, cachedPayload, targetLength);
      return;
    }
    const requestId = refs.sliceRequestRef.current + 1;
    refs.sliceRequestRef.current = requestId;
    await callbacks.withBusy("正在按切片读取日志...", async () => {
      const payload = await fetchLogSlice(targetFilePath, targetOffset, targetLength);
      if (refs.sliceRequestRef.current !== requestId || payload.filePath !== targetFilePath) return;
      callbacks.cacheSlicePayload(payload, targetOffset, targetLength);
      warmNeighborSlices(targetFilePath, payload, targetLength);
      applySlicePayload(payload, { status: `切片加载完成，偏移 ${formatNumber(payload.actualOffset)}，返回 ${formatBytes(payload.actualLength)}。`, activity: `切片读取完成：偏移 ${formatNumber(payload.actualOffset)}，长度 ${formatBytes(payload.actualLength)}。` });
    });
  }

  async function navigateSlice(direction: "prev" | "next", source: "button" | "wheel" | "keyboard" = "button") {
    if (!state.filePath.trim() || state.isBusy) return;
    if (state.liveFollowEnabled && !state.liveFollowPaused) { setters.setLiveFollowPaused(true); callbacks.pushActivity(`翻页浏览中，实时跟随已暂停。滚到底部可恢复。`); }
    if (direction === "prev") {
      if (state.sliceOffset <= 0 || state.sliceData?.isStart) return;
      refs.sliceScrollAnchorRef.current = "bottom";
      if (source === "wheel") refs.wheelSliceLockRef.current = true;
      await loadSlice(Math.max(0, state.sliceOffset - state.sliceLength), state.sliceLength);
      return;
    }
    if (state.sliceData?.isEnd) return;
    refs.sliceScrollAnchorRef.current = "top";
    if (source === "wheel") refs.wheelSliceLockRef.current = true;
    await loadSlice(state.sliceData?.nextOffset ?? state.sliceOffset + state.sliceLength, state.sliceLength);
  }

  function handleViewerWheel(event: any) {
    if (state.activeLogView !== "search" || state.activeViewerTabId !== "file" || !state.filePath.trim() || state.isBusy || refs.wheelSliceLockRef.current) return;
    const scrollState = refs.virtualViewerRef.current?.getScrollState();
    if (!scrollState) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollState;
    const maxScrollTop = Math.max(0, scrollHeight - clientHeight);
    if (event.deltaY < 0 && scrollTop <= 4 && state.sliceOffset > 0 && !state.sliceData?.isStart) { void navigateSlice("prev", "wheel"); return; }
    if (event.deltaY > 0 && scrollTop >= maxScrollTop - 4 && !state.sliceData?.isEnd) { void navigateSlice("next", "wheel"); }
  }

  async function loadTailSlice() {
    const targetFilePath = state.filePath;
    if (!targetFilePath.trim()) return;
    refs.sliceScrollAnchorRef.current = "bottom";
    const meta = activeFileMeta;
    const cachedTailOffset = meta ? Math.max(0, meta.size - state.sliceLength) : null;
    if (meta && cachedTailOffset !== null) {
      const cachedPayload = callbacks.getCachedSlice(targetFilePath, cachedTailOffset, state.sliceLength);
      if (cachedPayload) { applySlicePayload(cachedPayload, { status: `已跳转到文件尾部，当前偏移 ${formatNumber(cachedPayload.actualOffset)}。`, activity: `已跳转文件尾部：${targetFilePath}。` }); warmNeighborSlices(targetFilePath, cachedPayload, state.sliceLength); return; }
    }
    const requestId = refs.sliceRequestRef.current + 1;
    refs.sliceRequestRef.current = requestId;
    await callbacks.withBusy("正在定位文件尾部切片...", async () => {
      const resolvedMeta = (activeFileMeta?.filePath === targetFilePath ? activeFileMeta : null) ?? (await (async () => { const payload = await fetchLogMeta(targetFilePath); if (payload.filePath !== targetFilePath || refs.sliceRequestRef.current !== requestId) return null; setters.setFileMeta(payload); return payload; })());
      if (!resolvedMeta) return;
      const nextOffset = Math.max(0, resolvedMeta.size - state.sliceLength);
      const payload = await fetchLogSlice(targetFilePath, nextOffset, state.sliceLength);
      if (refs.sliceRequestRef.current !== requestId || payload.filePath !== targetFilePath) return;
      callbacks.cacheSlicePayload(payload, nextOffset, state.sliceLength);
      warmNeighborSlices(targetFilePath, payload, state.sliceLength);
      applySlicePayload(payload, { status: `已跳转到文件尾部，当前偏移 ${formatNumber(payload.actualOffset)}。`, activity: `已跳转文件尾部：${targetFilePath}。` });
    });
  }

  async function handleBackToBottom() {
    const shouldResumeLiveFollow = state.liveFollowEnabled && state.liveFollowPaused;
    if (!state.sliceData?.isEnd) {
      await loadTailSlice();
      refs.sliceScrollAnchorRef.current = "bottom";
      if (shouldResumeLiveFollow) {
        setters.setLiveFollowPaused(false);
      }
      callbacks.scrollViewerToBottom();
      return;
    }
    if (state.liveFollowEnabled && state.liveFollowPaused) {
      setters.setLiveFollowPaused(false);
    }
    refs.sliceScrollAnchorRef.current = "bottom";
    callbacks.scrollViewerToBottom();
  }

  async function loadHeadSlice() {
    const targetFilePath = state.filePath;
    if (!targetFilePath.trim()) return;
    refs.sliceScrollAnchorRef.current = "top";
    if (state.liveFollowEnabled) setters.setLiveFollowPaused(true);
    const cachedPayload = callbacks.getCachedSlice(targetFilePath, 0, state.sliceLength);
    if (cachedPayload) { applySlicePayload(cachedPayload, { status: "已跳转到文件头部。", activity: `已跳转文件头部：${targetFilePath}。` }); warmNeighborSlices(targetFilePath, cachedPayload, state.sliceLength); return; }
    const requestId = refs.sliceRequestRef.current + 1;
    refs.sliceRequestRef.current = requestId;
    await callbacks.withBusy("正在定位文件头部切片...", async () => {
      const payload = await fetchLogSlice(targetFilePath, 0, state.sliceLength);
      if (refs.sliceRequestRef.current !== requestId || payload.filePath !== targetFilePath) return;
      callbacks.cacheSlicePayload(payload, 0, state.sliceLength);
      warmNeighborSlices(targetFilePath, payload, state.sliceLength);
      applySlicePayload(payload, { status: "已跳转到文件头部。", activity: `已跳转文件头部：${targetFilePath}。` });
    });
  }

  async function jumpToSliceRatio(ratio: number) {
    const targetFilePath = state.filePath;
    if (!targetFilePath.trim()) return;
    refs.sliceScrollAnchorRef.current = "top";
    if (state.liveFollowEnabled) setters.setLiveFollowPaused(true);
    const directMeta = activeFileMeta?.filePath === targetFilePath ? activeFileMeta : null;
    if (directMeta) {
      const targetOffset = clampSliceStart(directMeta.size, Math.floor(directMeta.size * ratio), state.sliceLength);
      const cachedPayload = callbacks.getCachedSlice(targetFilePath, targetOffset, state.sliceLength);
      if (cachedPayload) { applySlicePayload(cachedPayload, { status: `已跳转到 ${formatPercent(ratio * 100)} 附近，当前偏移 ${formatNumber(cachedPayload.actualOffset)}。`, activity: `已跳转日志位置：${formatPercent(ratio * 100)} / ${targetFilePath}。` }); warmNeighborSlices(targetFilePath, cachedPayload, state.sliceLength); return; }
    }
    const requestId = refs.sliceRequestRef.current + 1;
    refs.sliceRequestRef.current = requestId;
    await callbacks.withBusy("正在按位置跳转日志...", async () => {
      const meta = (activeFileMeta?.filePath === targetFilePath ? activeFileMeta : null) ?? (await (async () => { const payload = await fetchLogMeta(targetFilePath); if (payload.filePath !== targetFilePath || refs.sliceRequestRef.current !== requestId) return null; setters.setFileMeta(payload); return payload; })());
      if (!meta) return;
      const targetOffset = clampSliceStart(meta.size, Math.floor(meta.size * ratio), state.sliceLength);
      const payload = await fetchLogSlice(targetFilePath, targetOffset, state.sliceLength);
      if (refs.sliceRequestRef.current !== requestId || payload.filePath !== targetFilePath) return;
      callbacks.cacheSlicePayload(payload, targetOffset, state.sliceLength);
      warmNeighborSlices(targetFilePath, payload, state.sliceLength);
      applySlicePayload(payload, { status: `已跳转到 ${formatPercent(ratio * 100)} 附近，当前偏移 ${formatNumber(payload.actualOffset)}。`, activity: `已跳转日志位置：${formatPercent(ratio * 100)} / ${targetFilePath}。` });
    });
  }

  async function commitReaderPosition(nextPercent: number) {
    setters.setReaderPositionDragging(false);
    if (refs.readerDraftFrameRef.current !== null) { window.cancelAnimationFrame(refs.readerDraftFrameRef.current); refs.readerDraftFrameRef.current = null; }
    if (!canDragReaderPosition) { setters.setReaderPositionDraft(0); setters.setReaderPreviewContent(""); setters.setReaderPreviewOffset(null); setters.setReaderPreviewLoading(false); return; }
    const normalizedPercent = Math.max(0, Math.min(100, nextPercent));
    setters.setReaderPositionDraft(normalizedPercent);
    setters.setReaderPreviewContent("");
    setters.setReaderPreviewOffset(null);
    setters.setReaderPreviewLoading(false);
    refs.sliceScrollAnchorRef.current = "top";
    await jumpToSliceRatio(normalizedPercent / 100);
  }

  function startReaderRailDrag(clientY: number) {
    if (!canDragReaderPosition || state.isBusy) return;
    const rail = refs.readerRailRef.current;
    if (!rail) return;
    const rect = rail.getBoundingClientRect();
    if (!rect.height) return;
    const nextPercent = clampPercent(((clientY - rect.top) / rect.height) * 100);
    setters.setReaderPositionDragging(true);
    setters.setReaderPreviewLoading(false);
    setters.setReaderPositionDraft(nextPercent);
  }

  function startViewerOverviewDrag(clientY: number) {
    const rail = refs.viewerOverviewRailRef.current;
    if (!rail) return;
    const rect = rail.getBoundingClientRect();
    if (!rect.height) return;
    const nextPercent = clampPercent(((clientY - rect.top) / rect.height) * 100);
    setters.setViewerOverviewDragging(true);
    setters.setViewerOverviewDraft(nextPercent);
    if (state.viewerOverviewTotalLines) {
      const targetLine = Math.round((nextPercent / 100) * Math.max(0, state.viewerOverviewTotalLines - 1));
      refs.virtualViewerRef.current?.scrollToLine(targetLine, "auto");
    }
  }

  async function exportCurrentResults() {
    const exportContent = activeResultTab?.content || (state.results ? state.results.rawOutput : "");
    if (!exportContent) return;
    await downloadTextFile(exportContent, `server-log-console/检索结果-${Date.now()}.log`);
    callbacks.setActionStatus("当前结果页已触发下载。");
    callbacks.pushActivity("已触发当前结果页下载。");
  }

  return {
    fetchDirectoryListing, fetchLogMeta, fetchLogSlice, fetchLineContext, warmSlice, warmNeighborSlices,
    resolveViewerJumpTarget, appendResultTab, replaceLastResultTab, closeResultTab, focusHighlight, applySlicePayload,
    jumpToSearchMatch, toggleLiveFollow, enterPathbarEditMode, exitPathbarEditMode, clearViewerSelection,
    handleViewerSelectionMouseDown, handleViewerSelectionMouseUp, handleCopyViewerSelection, openContextMenu,
    runSearch, browseLogFiles, commitDirectoryPath, openDirectoryFromInput, browseParentDirectory,
    openEntry, loadFileMeta, loadSlice, navigateSlice, handleViewerWheel, loadTailSlice,
    handleBackToBottom, loadHeadSlice, jumpToSliceRatio, commitReaderPosition, startReaderRailDrag,
    startViewerOverviewDrag, exportCurrentResults,
    selectedFileName, activeFileMeta, activeSliceData, activeResultTab, activeViewerMatches, currentLogContent, viewerLineClickEnabled, canDragReaderPosition,
  };
}
