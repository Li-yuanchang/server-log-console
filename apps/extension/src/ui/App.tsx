import { useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent, WheelEvent as ReactWheelEvent } from "react";
import type { ReactNode } from "react";
import type {
  FinalShellImportResponse,
  FinalShellSettingsResponse,
  JumpServerAssetOption,
  JumpServerAssetSearchResponse,
  LogFileEntry,
  LogFileListResponse,
  LogFileMetaResponse,
  LogLineContextResponse,
  LogSearchResponse,
  LogSearchTaskResponse,
  LogSliceResponse,
  ServerConnectionTestResponse,
  ServerRouteConfig,
  ServerCredentialStatus,
  ServerSummary
} from "@server-log-console/shared";
import { TerminalPanel } from "./TerminalWorkspace.js";
import { ToolIcon } from "./ToolIcon.js";
import { looksLikeJumpServer } from "./terminal-utils.js";
import { useTerminalSession } from "./useTerminalSession.js";
import { VirtualLogViewer, type VirtualLogViewerHandle } from "./VirtualLogViewer.js";
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
  trimLiveContent,
  truncateText,
} from "./utils.js";
import type { LineContextState, SearchSettingsState, ViewerResultTab } from "./utils.js";
import {
  clampBrowserTreeWidth,
  readBrowserTreeWidth,
  readLastDirectoryMap,
  readLastServerId,
  readSavedSearchSettings,
  rememberDirectoryIfUseful,
  writeBrowserTreeWidth,
  writeLastDirectory,
  writeLastServerId,
  writeSavedSearchSettings,
} from "./storage.js";

const runtimeOrigin = globalThis.location?.origin ?? "";
const localServiceBase = !runtimeOrigin || !/:4040$/.test(runtimeOrigin) ? "http://localhost:4040" : runtimeOrigin;
const defaultDirectoryPath = "";

export function App() {
  const savedSearchSettings = useMemo(() => readSavedSearchSettings(), []);
  const [servers, setServers] = useState<ServerSummary[]>([]);
  const [serverId, setServerId] = useState("");
  const [filePath, setFilePath] = useState("");
  const [serverFilter, setServerFilter] = useState("");
  const [fileFilter, setFileFilter] = useState("");
  const [keywordInput, setKeywordInput] = useState(() => savedSearchSettings?.keywordInput || "");
  const [keywordMode, setKeywordMode] = useState<"phrase" | "any" | "all">(() => savedSearchSettings?.keywordMode || "phrase");
  const [contextLines, setContextLines] = useState(() => savedSearchSettings?.contextLines ?? 3);
  const [useRegex, setUseRegex] = useState(() => savedSearchSettings?.useRegex ?? false);
  const [selectedPreset, setSelectedPreset] = useState(() => savedSearchSettings?.selectedPreset || "未选择");
  const [startDate, setStartDate] = useState(() => savedSearchSettings?.startDate || getLocalDateString());
  const [endDate, setEndDate] = useState(() => savedSearchSettings?.endDate || getLocalDateString());
  const [startTime, setStartTime] = useState(() => savedSearchSettings?.startTime || "");
  const [endTime, setEndTime] = useState(() => savedSearchSettings?.endTime || "");
  const [results, setResults] = useState<LogSearchResponse | null>(null);
  const [resultTabs, setResultTabs] = useState<ViewerResultTab[]>([]);
  const [searchTask, setSearchTask] = useState<LogSearchTaskResponse | null>(null);
  const [activeLogView, setActiveLogView] = useState<"search" | "files">("files");
  const [terminalPanelOpen, setTerminalPanelOpen] = useState(false);
  const [activeViewerTabId, setActiveViewerTabId] = useState("file");
  const [fileEntries, setFileEntries] = useState<LogFileEntry[]>([]);
  const [directoryPath, setDirectoryPath] = useState(defaultDirectoryPath);
  const [fileMeta, setFileMeta] = useState<LogFileMetaResponse | null>(null);
  const [sliceOffset, setSliceOffset] = useState(0);
  const [sliceLength, setSliceLength] = useState(64 * 1024);
  const [sliceData, setSliceData] = useState<LogSliceResponse | null>(null);
  const [searchStartedAt, setSearchStartedAt] = useState<number | null>(null);
  const [searchNow, setSearchNow] = useState(() => Date.now());
  const [activityLines, setActivityLines] = useState<string[]>(["系统已启动，等待选择服务器与日志文件。"]);
  const [importStatus, setImportStatus] = useState("尚未导入 FinalShell 连接。");
  const [importPath, setImportPath] = useState("尚未解析 FinalShell 配置目录。");
  const [finalShellPath, setFinalShellPath] = useState("");
  const [finalShellDetectedPaths, setFinalShellDetectedPaths] = useState<string[]>([]);
  const [finalShellLastImportedAt, setFinalShellLastImportedAt] = useState("");
  const [actionStatus, setActionStatus] = useState("就绪，可开始检索日志。");
  const [localServiceState, setLocalServiceState] = useState<"checking" | "online" | "offline">("checking");
  const [localServiceStatusText, setLocalServiceStatusText] = useState("正在检查本地连接服务...");
  const [isBusy, setIsBusy] = useState(false);
  const [uiTheme, setUiTheme] = useState<"classic" | "modern">(() => {
    try { return (localStorage.getItem("ui-theme") as "classic" | "modern") || "classic"; } catch { return "classic"; }
  });
  const toggleUiTheme = () => setUiTheme((prev) => {
    const next = prev === "classic" ? "modern" : "classic";
    try { localStorage.setItem("ui-theme", next); } catch { /* ignore */ }
    return next;
  });
  const [showConnectionSettings, setShowConnectionSettings] = useState(false);
  const [expandedSettingsSection, setExpandedSettingsSection] = useState<"import" | "credential" | "route">("import");
  const [showQueryAdvanced, setShowQueryAdvanced] = useState(false);
  const [credentialStatus, setCredentialStatus] = useState<ServerCredentialStatus | null>(null);
  const [serverRouteConfig, setServerRouteConfig] = useState<ServerRouteConfig | null>(null);
  const [connectionTestStatus, setConnectionTestStatus] = useState<ServerConnectionTestResponse | null>(null);
  const [credentialUsername, setCredentialUsername] = useState("");
  const [credentialPassword, setCredentialPassword] = useState("");
  const [credentialPrivateKey, setCredentialPrivateKey] = useState("");
  const [preferredBastionId, setPreferredBastionId] = useState("");
  const [jumpMode, setJumpMode] = useState<"auto" | "jumpserver-search">("auto");
  const [jumpSearchKeyword, setJumpSearchKeyword] = useState("");
  const [jumpAssetId, setJumpAssetId] = useState("");
  const [jumpAssetOptions, setJumpAssetOptions] = useState<JumpServerAssetOption[]>([]);
  const [showFileTools, setShowFileTools] = useState(false);
  const [showKeywordBar, setShowKeywordBar] = useState(true);
  const [showDirectoryFilter, setShowDirectoryFilter] = useState(false);
  const [directoryInput, setDirectoryInput] = useState("");
  const [browserTreeWidth, setBrowserTreeWidth] = useState(() => readBrowserTreeWidth());
  const [resultTabCounter, setResultTabCounter] = useState(1);
  const [activeHighlightIndex, setActiveHighlightIndex] = useState(0);
  const [fileSortKey, setFileSortKey] = useState<"name" | "size" | "kind" | "modifiedTime">("name");
  const [fileSortDirection, setFileSortDirection] = useState<"asc" | "desc">("asc");
  const [liveFollowEnabled, setLiveFollowEnabled] = useState(false);
  const [liveFollowConnected, setLiveFollowConnected] = useState(false);
  const [liveFollowContent, setLiveFollowContent] = useState("");
  const [liveFollowRetryCount, setLiveFollowRetryCount] = useState(0);
  const [liveFollowPaused, setLiveFollowPaused] = useState(false);
  const [readerPositionDraft, setReaderPositionDraft] = useState(0);
  const [readerPositionDragging, setReaderPositionDragging] = useState(false);
  const [readerPreviewContent, setReaderPreviewContent] = useState("");
  const [readerPreviewOffset, setReaderPreviewOffset] = useState<number | null>(null);
  const [readerPreviewLoading, setReaderPreviewLoading] = useState(false);
  const [lineContextState, setLineContextState] = useState<LineContextState | null>(null);
  const keywordInputRef = useRef<HTMLInputElement | null>(null);
  const directoryInputRef = useRef<HTMLInputElement | null>(null);
  const virtualViewerRef = useRef<VirtualLogViewerHandle | null>(null);
  const browserGridRef = useRef<HTMLDivElement | null>(null);
  const readerRailRef = useRef<HTMLDivElement | null>(null);
  const initializedRef = useRef(false);
  const autoConnectServerRef = useRef("");
  const sliceScrollAnchorRef = useRef<"top" | "bottom" | null>(null);
  const wheelSliceLockRef = useRef(false);
  const treeResizeRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const liveSocketRef = useRef<WebSocket | null>(null);
  const liveFollowReconnectTimerRef = useRef<number | null>(null);
  const liveFollowDesiredRef = useRef(false);
  const liveFollowTargetRef = useRef<{ filePath: string; fileName: string; keyword?: string } | null>(null);
  const liveFollowExpectedCloseRef = useRef(false);
  const liveFollowRetryCountRef = useRef(0);
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

  useEffect(() => {
    if (initializedRef.current) {
      return;
    }

    initializedRef.current = true;
    void initializeWorkbench();

  }, []);

  useEffect(() => {
    if (!serverId) {
      terminalSession.stopTerminal();
      stopLiveFollow();
      setCredentialStatus(null);
      setConnectionTestStatus(null);
      setDirectoryPath(defaultDirectoryPath);
      setFilePath("");
      setFileEntries([]);
      resetFileReaderState();
      return;
    }

    setConnectionTestStatus(null);
    terminalSession.stopTerminal();
    stopLiveFollow();
    setDirectoryPath(defaultDirectoryPath);
    setFilePath("");
    setFileEntries([]);
    resetFileReaderState();
    setActiveLogView("files");
    setTerminalPanelOpen(false);
    void fetchCredentialStatus(serverId);
    void fetchServerRoute(serverId);
  }, [serverId, servers]);

  useEffect(() => {
    if (!serverId || autoConnectServerRef.current === serverId) {
      return;
    }

    const targetServer = servers.find((server) => server.id === serverId);
    const savedDirectory = readLastDirectoryMap()[serverId];
    autoConnectServerRef.current = serverId;
    window.setTimeout(() => {
      void testServerConnection(savedDirectory?.trim() || targetServer?.basePath?.trim() || "/", { auto: true });
    }, 120);
  }, [serverId, servers]);

  useEffect(() => {
    setDirectoryInput(directoryPath || "/");
  }, [directoryPath]);

  useEffect(() => () => {
    terminalSession.stopTerminal();
    stopLiveFollow();
  }, []);

  useEffect(() => {
    writeBrowserTreeWidth(browserTreeWidth);
  }, [browserTreeWidth]);

  useEffect(() => {
    writeSavedSearchSettings({
      keywordInput,
      keywordMode,
      contextLines,
      useRegex,
      selectedPreset,
      startDate,
      endDate,
      startTime,
      endTime
    });
  }, [contextLines, endDate, endTime, keywordInput, keywordMode, selectedPreset, startDate, startTime, useRegex]);

  useEffect(() => {
    if (!searchStartedAt) {
      return;
    }

    const timer = window.setInterval(() => {
      setSearchNow(Date.now());
    }, 400);

    return () => window.clearInterval(timer);
  }, [searchStartedAt]);

  useEffect(() => {
    if (localServiceState !== "offline") {
      return;
    }

    const timer = window.setInterval(async () => {
      const ok = await checkLocalServiceHealth();
      if (ok) {
        await fetchServers();
        await fetchFinalShellSettings();
      }
    }, 4000);

    return () => window.clearInterval(timer);
  }, [localServiceState]);

  async function initializeWorkbench() {
    const serviceReady = await checkLocalServiceHealth();
    if (!serviceReady) {
      return;
    }

    await fetchServers();
    await fetchFinalShellSettings();
  }

  async function checkLocalServiceHealth() {
    setLocalServiceState("checking");
    setLocalServiceStatusText("正在检查本地连接服务...");

    try {
      const response = await fetch(`${localServiceBase}/health`);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      setLocalServiceState("online");
      setLocalServiceStatusText("本地连接服务已启动");
      return true;
    } catch (error) {
      const detail = error instanceof Error ? error.message : "未知错误";
      setLocalServiceState("offline");
      setLocalServiceStatusText("本地连接服务未启动");
      setActionStatus("本地连接服务未启动，请先启动本地服务。");
      pushActivity(`本地连接服务不可用：${detail}`);
      return false;
    }
  }

  useEffect(() => {
    return () => {
      liveSocketRef.current?.close();
      liveSocketRef.current = null;
      if (liveFollowReconnectTimerRef.current !== null) {
        window.clearTimeout(liveFollowReconnectTimerRef.current);
      }
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
        window.setTimeout(() => directoryInputRef.current?.focus(), 0);
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
  }, [activeLogView, activeViewerTabId, filePath, keywordInput, sliceData?.nextOffset, sliceLength, sliceOffset]);

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
    virtualViewerRef.current?.scrollToBottom();
  }, [liveFollowContent, liveFollowEnabled, liveFollowPaused]);

  useEffect(() => {
    setActiveHighlightIndex(0);
  }, [activeViewerTabId, resultTabs, sliceData?.content, results?.rawOutput, keywordInput, useRegex]);

  // VirtualLogViewer handles scrollToHighlight internally via activeHighlightIndex prop

  async function fetchServers() {
    try {
      const response = await fetch(`${localServiceBase}/api/servers`);
      const data = (await response.json()) as ServerSummary[];
      setLocalServiceState("online");
      setLocalServiceStatusText("本地连接服务已启动");
      setServers(data);
      setActionStatus(data.length ? `已载入 ${data.length} 台服务器，请在左侧选择一台。` : "当前还没有服务器，请导入 FinalShell 或手动新增。");
      pushActivity(data.length ? `已读取本地服务器清单，共 ${data.length} 台。` : "当前没有服务器，请先导入 FinalShell 或手动维护服务器。");
    } catch (error) {
      const detail = error instanceof Error ? error.message : "未知错误";
      setLocalServiceState("offline");
      setLocalServiceStatusText("本地连接服务未启动");
      setActionStatus(`本地连接服务不可用：${detail}`);
      pushActivity(`读取本地服务器清单失败：${detail}`);
    }
  }

  async function readPayload<T>(response: Response, fallbackMessage: string): Promise<T> {
    const payload = (await response.json()) as T & { message?: string };
    if (!response.ok) {
      throw new Error(payload.message || fallbackMessage);
    }

    return payload;
  }

  async function fetchDirectoryListing(targetDirectoryPath: string) {
    const isBastionSftp = selectedServer?.connectionKind === "bastion" && looksLikeJumpServer(selectedServer);
    const response = await fetch(`${localServiceBase}/api/logs/files`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        isBastionSftp
          ? { bastionId: serverId, directoryPath: targetDirectoryPath }
          : { serverId, directoryPath: targetDirectoryPath }
      )
    });

    return readPayload<LogFileListResponse>(response, "读取远程目录失败");
  }

  async function fetchLogMeta(targetFilePath: string) {
    const response = await fetch(`${localServiceBase}/api/logs/meta`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        serverId,
        filePath: targetFilePath
      })
    });

    return readPayload<LogFileMetaResponse>(response, "读取日志元信息失败");
  }

  async function fetchLogSlice(targetFilePath: string, targetOffset: number, targetLength: number) {
    const response = await fetch(`${localServiceBase}/api/logs/slice`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        serverId,
        filePath: targetFilePath,
        offset: targetOffset,
        length: targetLength
      })
    });

    return readPayload<LogSliceResponse>(response, "读取日志切片失败");
  }

  async function fetchLineContext(targetFilePath: string, lineNumber: number, context = 12) {
    const response = await fetch(`${localServiceBase}/api/logs/line-context`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        serverId,
        filePath: targetFilePath,
        lineNumber,
        contextLines: context
      })
    });

    return readPayload<LogLineContextResponse>(response, "按行定位日志失败");
  }

  function cacheSlicePayload(payload: LogSliceResponse, requestedOffset: number, targetLength: number) {
    const requestedKey = getSliceCacheKey(payload.filePath, requestedOffset, targetLength);
    const actualKey = getSliceCacheKey(payload.filePath, payload.actualOffset, targetLength);
    sliceCacheRef.current.set(requestedKey, payload);
    sliceCacheRef.current.set(actualKey, payload);

    const previewContent = formatPreviewSnippet(payload.content) || "这一段没有完整日志行。";
    const requestedPreviewKey = getPreviewCacheKey(payload.filePath, requestedOffset);
    const actualPreviewKey = getPreviewCacheKey(payload.filePath, payload.actualOffset);
    previewCacheRef.current.set(requestedPreviewKey, {
      offset: payload.actualOffset,
      content: previewContent
    });
    previewCacheRef.current.set(actualPreviewKey, {
      offset: payload.actualOffset,
      content: previewContent
    });
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
      const response = await fetch(`${localServiceBase}/api/import/finalshell/settings`);
      const payload = (await response.json()) as FinalShellSettingsResponse & { message?: string };
      if (!response.ok) {
        throw new Error(payload.message || "读取 FinalShell 配置失败");
      }

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
      const response = await fetch(`${localServiceBase}/api/import/finalshell/settings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          configuredPath: finalShellPath.trim()
        })
      });
      const payload = (await response.json()) as FinalShellSettingsResponse & { message?: string };
      if (!response.ok) {
        throw new Error(payload.message || "保存 FinalShell 目录失败");
      }

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
      const response = await fetch(`${localServiceBase}/api/servers/${encodeURIComponent(targetServerId)}/credential`);
      const payload = (await response.json()) as ServerCredentialStatus & { message?: string };
      if (!response.ok) {
        throw new Error(payload.message || "读取凭证状态失败");
      }

      setCredentialStatus(payload);
      setCredentialUsername(payload.username || "");
      setCredentialPassword("");
      setCredentialPrivateKey("");
    } catch (error) {
      const detail = error instanceof Error ? error.message : "未知错误";
      setCredentialStatus(null);
      pushActivity(`读取连接凭证状态失败：${detail}`);
    }
  }

  async function fetchServerRoute(targetServerId: string) {
    try {
      const response = await fetch(`${localServiceBase}/api/servers/${encodeURIComponent(targetServerId)}/route`);
      const payload = (await response.json()) as ServerRouteConfig & { message?: string };
      if (!response.ok) {
        throw new Error(payload.message || "读取二跳配置失败");
      }

      setServerRouteConfig(payload);
      setPreferredBastionId(payload.preferredBastionId || "");
      setJumpMode(payload.jumpMode || "auto");
      setJumpSearchKeyword(payload.jumpSearchKeyword || "");
      setJumpAssetId(payload.jumpAssetId || "");
      setJumpAssetOptions([]);
      jumpAssetAutoSearchKeyRef.current = "";
    } catch (error) {
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
      const response = await fetch(`${localServiceBase}/api/servers/${encodeURIComponent(serverId)}/credential`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: credentialUsername.trim() || undefined,
          password: credentialPassword || undefined,
          privateKey: credentialPrivateKey || undefined
        })
      });
      const payload = (await response.json()) as ServerCredentialStatus & { message?: string };
      if (!response.ok) {
        throw new Error(payload.message || "保存凭证失败");
      }

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
      const response = await fetch(`${localServiceBase}/api/servers/${encodeURIComponent(serverId)}/route`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          preferredBastionId: preferredBastionId || undefined,
          jumpMode,
          jumpSearchKeyword: jumpSearchKeyword.trim() || undefined,
          jumpAssetId: jumpAssetId.trim() || undefined
        })
      });
      const payload = (await response.json()) as ServerRouteConfig & { message?: string };
      if (!response.ok) {
        throw new Error(payload.message || "保存二跳设置失败");
      }

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
      const response = await fetch(`${localServiceBase}/api/servers/${encodeURIComponent(serverId)}/jumpserver/assets`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bastionId: preferredBastionId || (selectedServer?.connectionKind === "bastion" ? selectedServer.id : undefined),
          keyword
        })
      });
      const payload = await readPayload<JumpServerAssetSearchResponse>(response, "读取 JumpServer 资产列表失败");
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

    const autoMode = Boolean(options?.auto);
    setIsBusy(true);
    setActionStatus(autoMode ? "正在自动连接服务器..." : "正在测试服务器连接...");

    try {
      const response = await fetch(`${localServiceBase}/api/servers/${encodeURIComponent(serverId)}/test-connection`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          directoryPath: targetDirectoryPath || directoryPath.trim() || "/"
        })
      });
      const payload = await readPayload<ServerConnectionTestResponse>(response, "连接测试失败");
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
        setShowConnectionSettings(true);
      }

      if (payload.connected && selectedServer?.connectionKind === "bastion" && looksLikeJumpServer(selectedServer)) {
        openTerminalView({ auto: true });
        try {
          const directoryPayload = await fetchDirectoryListing("/");
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
        setDirectoryPath(directoryPayload.directoryPath);
        setFileEntries(directoryPayload.entries);
        rememberDirectoryIfUseful(serverId, directoryPayload.directoryPath, directoryPayload.entries.length);
        pushActivity(`连接测试后已读取目录：${directoryPayload.directoryPath}，共 ${directoryPayload.entries.length} 项。`);
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : "未知错误";

      setConnectionTestStatus({
        serverId,
        serverName: selectedServer?.name || serverId,
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
        setShowConnectionSettings(true);
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
    const arrow = !active ? "" : fileSortDirection === "asc" ? " ↑" : " ↓";
    return `${label}${arrow}`;
  }

  function renderSettingsSectionHeader(
    section: "import" | "credential" | "route",
    title: string,
    actions?: ReactNode
  ) {
    const expanded = expandedSettingsSection === section;
    return (
      <div className="settings-section-head">
        <button
          type="button"
          className={`settings-toggle-button ${expanded ? "settings-toggle-button-open" : ""}`}
          onClick={() => setExpandedSettingsSection(section)}
        >
          <span className={`settings-toggle-caret ${expanded ? "settings-toggle-caret-open" : ""}`} aria-hidden="true" />
          <span>{title}</span>
        </button>
        {expanded ? <div className="inline-actions settings-head-actions">{actions}</div> : null}
      </div>
    );
  }

  function pushActivity(message: string) {
    const timestamp = new Date().toLocaleTimeString("zh-CN", { hour12: false });
    setActivityLines((current) => [...current.slice(-79), `[${timestamp}] ${message}`]);
  }

  const selectedServer = useMemo(
    () => servers.find((server) => server.id === serverId) ?? null,
    [servers, serverId]
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

  const terminalSession = useTerminalSession({
    active: terminalPanelOpen,
    localServiceBase,
    serverId,
    preferredBastionId,
    selectedServer,
    isBusy,
    onStatus: setActionStatus,
    onActivity: pushActivity
  });

  function openTerminalView(options?: { auto?: boolean }) {
    setTerminalPanelOpen(true);
    terminalSession.startTerminal(options);
  }

  useEffect(() => {
    if (!showConnectionSettings) {
      return;
    }

    if (selectedServer && selectedServer.connectionKind === "bastion" && looksLikeJumpServer(selectedServer)) {
      setExpandedSettingsSection("route");
      return;
    }

    if (selectedServer && selectedServer.connectionKind !== "bastion" && availableBastions.length > 0) {
      setExpandedSettingsSection("route");
      return;
    }

    if (selectedServer) {
      setExpandedSettingsSection("credential");
      return;
    }

    setExpandedSettingsSection("import");
  }, [availableBastions.length, selectedServer, showConnectionSettings]);

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
  const recentActivityLines = useMemo(() => activityLines.slice(-4), [activityLines]);
  const connectionStateText = buildConnectionSummary(selectedServer, connectionTestStatus);
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
          previewCacheRef.current.set(cacheKey, {
            offset: previewSlice.actualOffset,
            content: previewContent
          });
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
          previewCacheRef.current.set(cacheKey, {
            offset: previewSlice.actualOffset,
            content: formatPreviewSnippet(previewSlice.content) || "这一段没有完整日志行。"
          });
        } catch {
          return;
        } finally {
          previewWarmRef.current.delete(cacheKey);
        }
      })();
    });
  }, [activeFileMeta, canDragReaderPosition, filePath, readerPositionDragging, readerPositionDraft, sliceLength]);

  useEffect(() => {
    if (!readerPositionDragging || !canDragReaderPosition || !filePath.trim()) {
      return;
    }

    const meta = activeFileMeta;
    if (!meta?.size) {
      return;
    }

    const baseOffset = clampSliceStart(meta.size, Math.floor(meta.size * (readerPositionDraft / 100)), sliceLength);
    const neighborOffsets = [-1, 0, 1].map((index) => clampSliceStart(meta.size, baseOffset + index * sliceLength, sliceLength));

    neighborOffsets.forEach((offset) => {
      void warmSlice(filePath, offset, sliceLength);
    });
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
      void commitReaderPosition(nextPercent ?? readerPositionDraft);
    }

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerEnd);
    window.addEventListener("pointercancel", handlePointerEnd);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerEnd);
      window.removeEventListener("pointercancel", handlePointerEnd);
    };
  }, [readerPositionDragging, readerPositionDraft]);

  const searchPresets = [
    {
      label: "恢复上次",
      apply: () => {
        const saved = readSavedSearchSettings();
        if (!saved) {
          setActionStatus("当前还没有可恢复的搜索设置。");
          return;
        }

        setKeywordInput(saved.keywordInput);
        setKeywordMode(saved.keywordMode);
        setContextLines(saved.contextLines);
        setUseRegex(saved.useRegex);
        setSelectedPreset(saved.selectedPreset || "恢复上次");
        setStartDate(saved.startDate);
        setEndDate(saved.endDate);
        setStartTime(saved.startTime);
        setEndTime(saved.endTime);
        setActionStatus("已恢复上次搜索设置。");
      }
    },
    {
      label: "常规",
      apply: () => {
        setKeywordMode("phrase");
        setContextLines(3);
        setUseRegex(false);
        setSelectedPreset("常规");
      }
    },
    {
      label: "查 SQL",
      apply: () => {
        setKeywordMode("all");
        setContextLines(2);
        setUseRegex(false);
        setSelectedPreset("查 SQL");
      }
    },
    {
      label: "查异常",
      apply: () => {
        setKeywordMode("any");
        setContextLines(8);
        setUseRegex(false);
        setSelectedPreset("查异常");
      }
    },
    {
      label: "大日志快筛",
      apply: () => {
        const today = getLocalDateString();
        setKeywordMode("phrase");
        setContextLines(1);
        setUseRegex(false);
        setStartDate(today);
        setEndDate(today);
        setStartTime("");
        setEndTime("");
        setSelectedPreset("大日志快筛");
      }
    },
    {
      label: "正则",
      apply: () => {
        setKeywordMode("phrase");
        setContextLines(3);
        setUseRegex(true);
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
  const logViews = [
    { key: "search" as const, label: "搜索结果" },
    { key: "files" as const, label: "选文件" },
  ];
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
  const hasDirectoryConnectionError = isFileMode && connectionTestStatus !== null && !connectionTestStatus.connected;
  const isConnectingWorkspace =
    isFileMode && !hasDirectoryConnectionError && (!selectedServer || (!connectionTestStatus?.connected && !fileEntries.length));
  const hasFileWorkspaceEntries = fileEntries.length > 0;
  const showServiceOfflineState = localServiceState === "offline";
  const showNoServerState = localServiceState === "online" && !servers.length && !isBusy;
  const showViewerEmptyState = activeLogView === "search" && !hasSearchContent && !filePath.trim() && !resultTabs.length;

  useEffect(() => {
    if (terminalPanelOpen && !canOpenTerminal) {
      setTerminalPanelOpen(false);
    }
  }, [terminalPanelOpen, canOpenTerminal]);

  const currentFileContent = liveFollowEnabled && activeViewerTabId === "file"
    ? liveFollowContent || lineContextState?.content || activeSliceData?.content || ""
    : lineContextState?.content || activeSliceData?.content || "请选择日志文件后开始搜索，或直接读取尾部日志。";
  const currentLogContent = activeResultTab?.content ?? currentFileContent;
  const viewerEmptyTitle = "还没有日志内容";
  const viewerEmptyHint = !filePath
    ? "先在目录中选择日志文件，系统会自动打开尾部片段。"
    : "输入关键字后点击“搜索”，或直接看尾部。";
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
  const toolbarSummaryLabel = highlightCount ? `${Math.min(activeHighlightIndex + 1, highlightCount)}/${highlightCount} 命中` : (selectedFileName || "--");
  const compactConnectionLabel = selectedServer ? `${selectedServer.host} · ${directoryPath || "/"}` : (directoryPath || "/");
  const compactReaderHint = activeViewerTabId === "file"
    ? (liveFollowEnabled
      ? `实时：${liveFollowConnected ? (liveFollowPaused ? "已暂停滚动" : "接收中") : (liveFollowRetryCount > 0 ? `重连中 ${liveFollowRetryCount}` : "连接中")}${liveFollowContent ? ` · ${formatNumber(liveFollowContent.split("\n").length)} 行` : ""}`
      : lineContextState
        ? `定位到 ${formatNumber(lineContextState.lineNumber)} 行`
        : (highlightCount ? `命中 ${highlightCount} 处` : "滚轮到边缘可翻页"))
    : `结果 ${formatNumber(activeViewerMatchCount)} 条`;
  const activeViewerMatches = activeResultTab?.matches ?? (activeViewerTabId === "file" ? results?.matches ?? [] : []);

  function appendResultTab(payload: LogSearchResponse, sourceLabel: string) {
    const nextId = `result-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const nextLabel = `结果 ${resultTabCounter}`;
    const nextTab: ViewerResultTab = {
      id: nextId,
      label: nextLabel,
      sourceLabel,
      content: formatSearchViewerContent(payload, undefined),
      matches: payload.matches,
      commandPreview: payload.commandPreview,
      strategyLabel: payload.strategyLabel,
      scopeLabel: payload.scopeLabel,
      matchCount: payload.matches.length
    };

    setResultTabs((current) => [...current, nextTab]);
    setActiveViewerTabId(nextId);
    setResultTabCounter((current) => current + 1);
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

  function clearLiveFollowReconnectTimer() {
    if (liveFollowReconnectTimerRef.current !== null) {
      window.clearTimeout(liveFollowReconnectTimerRef.current);
      liveFollowReconnectTimerRef.current = null;
    }
  }

  function scheduleLiveFollowReconnect(reason: string) {
    if (!liveFollowDesiredRef.current || !liveFollowTargetRef.current) {
      return;
    }

    clearLiveFollowReconnectTimer();
    const nextRetry = liveFollowRetryCountRef.current + 1;
    liveFollowRetryCountRef.current = nextRetry;
    const delay = Math.min(8000, 1200 * nextRetry);
    setLiveFollowRetryCount(nextRetry);
    setLiveFollowConnected(false);
    setActionStatus(`实时已断开，${Math.round(delay / 1000)} 秒后重连。`);
    pushActivity(`实时已断开，准备重连：${reason}`);
    liveFollowReconnectTimerRef.current = window.setTimeout(() => {
      const target = liveFollowTargetRef.current;
      if (!liveFollowDesiredRef.current || !target) {
        return;
      }
      void loadTailSlice().finally(() => {
        startLiveFollow(target.filePath, target.fileName, { isReconnect: true });
      });
    }, delay);
  }

  function stopLiveFollow(options?: { keepContent?: boolean; preserveIntent?: boolean }) {
    clearLiveFollowReconnectTimer();
    liveFollowExpectedCloseRef.current = true;
    liveSocketRef.current?.close();
    liveSocketRef.current = null;
    setLiveFollowConnected(false);
    if (!options?.preserveIntent) {
      liveFollowDesiredRef.current = false;
      liveFollowTargetRef.current = null;
      setLiveFollowEnabled(false);
      setLiveFollowRetryCount(0);
      liveFollowRetryCountRef.current = 0;
    }
    if (!options?.keepContent) {
      setLiveFollowContent("");
    }
  }

  function startLiveFollow(targetFilePath: string, targetFileName: string, options?: { isReconnect?: boolean; keyword?: string }) {
    if (!serverId || !targetFilePath.trim()) {
      return;
    }

    liveFollowDesiredRef.current = true;
    liveFollowTargetRef.current = { filePath: targetFilePath, fileName: targetFileName, keyword: options?.keyword };
    setLiveFollowPaused(false);
    liveFollowExpectedCloseRef.current = true;
    liveSocketRef.current?.close();
    liveSocketRef.current = null;
    clearLiveFollowReconnectTimer();
    setLiveFollowConnected(false);
    setLiveFollowEnabled(true);
    setLiveFollowContent((current) => trimLiveContent(current || sliceData?.content || ""));

    const wsUrl = localServiceBase.replace(/^http/, "ws") + "/ws/live";
    const socket = new WebSocket(wsUrl);
    liveSocketRef.current = socket;

    socket.addEventListener("open", () => {
      liveFollowExpectedCloseRef.current = false;
      const livePayload: Record<string, string> = {
        action: "start",
        serverId,
        filePath: targetFilePath
      };
      if (options?.keyword) {
        livePayload.keyword = options.keyword;
      }
      socket.send(JSON.stringify(livePayload));
      setLiveFollowConnected(true);
      setLiveFollowRetryCount(0);
      liveFollowRetryCountRef.current = 0;
      setActionStatus(options?.isReconnect ? `实时已重连：${targetFileName}` : `已开启实时跟随：${targetFileName}`);
      pushActivity(options?.isReconnect ? `实时已重连：${targetFilePath}。` : `已开启实时跟随：${targetFilePath}。`);
    });

    socket.addEventListener("message", (event) => {
      try {
        const payload = JSON.parse(String(event.data)) as {
          type?: string;
          chunk?: string;
          message?: string;
        };

        if (payload.type === "error") {
          setActionStatus(`实时跟随失败：${payload.message || "未知错误"}`);
          pushActivity(`实时跟随失败：${payload.message || "未知错误"}`);
          return;
        }

        if (payload.type === "closed") {
          setLiveFollowConnected(false);
          return;
        }

        if (payload.chunk) {
          setLiveFollowContent((current) => trimLiveContent(`${current || sliceData?.content || ""}${payload.chunk}`));
        }
      } catch (error) {
        setActionStatus(`实时跟随解析失败：${error instanceof Error ? error.message : "未知错误"}`);
      }
    });

    socket.addEventListener("close", () => {
      if (liveSocketRef.current === socket) {
        liveSocketRef.current = null;
      }
      setLiveFollowConnected(false);
      if (liveFollowExpectedCloseRef.current) {
        liveFollowExpectedCloseRef.current = false;
        return;
      }
      scheduleLiveFollowReconnect("连接关闭");
    });

    socket.addEventListener("error", () => {
      setActionStatus("实时跟随连接异常。");
      pushActivity(`实时跟随连接异常：${targetFilePath}。`);
    });
  }

  function handleLiveNearBottomChange(nearBottom: boolean) {
    if (!liveFollowEnabled) return;
    setLiveFollowPaused(!nearBottom);
  }

  function scrollLiveToBottom() {
    setLiveFollowPaused(false);
    virtualViewerRef.current?.scrollToBottom();
  }

  function clearLiveContent() {
    setLiveFollowContent("");
  }

  async function toggleLiveFollow(nextEnabled: boolean) {
    if (!filePath.trim()) {
      return;
    }

    if (!nextEnabled) {
      stopLiveFollow();
      setActionStatus("已关闭实时跟随。");
      pushActivity(`已关闭实时跟随：${filePath}。`);
      return;
    }

    await loadTailSlice();
    const liveKeyword = keywordInput.trim() || undefined;
    startLiveFollow(filePath, selectedFileName || filePath, { keyword: liveKeyword });
  }

  async function withBusy<T>(message: string, task: () => Promise<T>) {
    setIsBusy(true);
    setActionStatus(message);

    try {
      return await task();
    } catch (error) {
      const detail = error instanceof Error ? error.message : "未知错误";
      setActionStatus(`操作失败：${detail}`);
      pushActivity(`操作失败：${detail}`);
      return null;
    } finally {
      setIsBusy(false);
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
      const response = await fetch(`${localServiceBase}/api/logs/search/tasks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
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
        })
      });
      const taskPayload = await readPayload<LogSearchTaskResponse>(response, "日志搜索任务创建失败");
      setSearchTask(taskPayload);
      setActiveLogView("search");
      pushActivity(`搜索任务已启动：${taskPayload.strategyLabel || "分片扫描"} / ${taskPayload.scopeLabel || filePath}`);

      let currentTask = taskPayload;
      while (currentTask.status === "queued" || currentTask.status === "running") {
        await new Promise((resolve) => window.setTimeout(resolve, 450));
        const pollResponse = await fetch(`${localServiceBase}/api/logs/search/tasks/${encodeURIComponent(currentTask.taskId)}`);
        currentTask = await readPayload<LogSearchTaskResponse>(pollResponse, "读取搜索进度失败");
        setSearchTask(currentTask);
      }

      if (currentTask.status === "failed") {
        throw new Error(currentTask.errorMessage || "搜索任务失败");
      }

      const finalResult = currentTask.result || null;
      setResults(finalResult);
      if (finalResult) {
        appendResultTab(finalResult, selectedFileName || filePath || "当前文件");
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

  async function importFromFinalShell() {
    await withBusy("正在导入 FinalShell 连接...", async () => {
      const response = await fetch(`${localServiceBase}/api/import/finalshell`);
      const payload = await readPayload<FinalShellImportResponse>(response, "导入 FinalShell 失败");
      setServers(payload.servers);
      setServerId(payload.servers[0]?.id ?? "");
      if (payload.servers[0]?.id) {
        writeLastServerId(payload.servers[0].id);
      }
      setFilePath("");
      setImportStatus(`已导入 ${payload.servers.length} 台服务器，时间 ${payload.importedAt}`);
      setFinalShellLastImportedAt(payload.importedAt);
      setImportPath(
        payload.resolvedPath
          ? `配置目录：${payload.resolvedPath}`
          : `未发现 FinalShell 配置目录，已检查：${payload.searchedPaths.join(" | ")}`
      );
      setActionStatus("FinalShell 连接导入完成。");
      pushActivity(`FinalShell 配置已导入，共 ${payload.servers.length} 台，选择服务器后会自动连接。`);
    });
  }

  async function browseLogFiles(nextDirectoryPath?: string, options?: { manual?: boolean }) {
    stopLiveFollow();
    await withBusy("正在读取远程目录...", async () => {
      const payload = await fetchDirectoryListing(nextDirectoryPath || directoryPath || "/");
      setDirectoryPath(payload.directoryPath);
      setDirectoryInput(payload.directoryPath);
      setFileEntries(payload.entries);
      setActiveLogView("files");
      rememberDirectoryIfUseful(serverId, payload.directoryPath, payload.entries.length);
      setActionStatus(`目录读取完成，共 ${payload.entries.length} 项。`);
      pushActivity(`已打开目录：${payload.directoryPath}，共 ${payload.entries.length} 项。`);
    });
  }

  async function openDirectoryFromInput() {
    const nextDirectory = directoryInput.trim() || "/";
    await browseLogFiles(nextDirectory, { manual: true });
  }

  async function browseParentDirectory() {
    await browseLogFiles(getParentDirectoryPath(directoryPath || directoryInput || "/"), { manual: true });
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
    pushActivity(`已选择日志文件：${entry.path}`);
    await withBusy("正在打开日志文件...", async () => {
      const metaPayload = await fetchLogMeta(entry.path);
      if (openFileRequestRef.current !== requestId || metaPayload.filePath !== entry.path) {
        return;
      }
      setFileMeta(metaPayload);
      const nextOffset = Math.max(0, metaPayload.size - sliceLength);
      const slicePayload = await fetchLogSlice(entry.path, nextOffset, sliceLength);
      if (openFileRequestRef.current !== requestId || slicePayload.filePath !== entry.path) {
        return;
      }
      cacheSlicePayload(slicePayload, nextOffset, sliceLength);
      warmNeighborSlices(entry.path, slicePayload, sliceLength);
      sliceRequestRef.current += 1;
      setSliceOffset(slicePayload.actualOffset);
      setSliceData(slicePayload);
      setActiveLogView("search");
      setActionStatus(`已打开 ${entry.name}，尾部切片已加载。`);
      pushActivity(`已打开日志文件：${entry.path}，尾部 ${formatBytes(slicePayload.actualLength)} 已显示。`);
    });
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

    if (liveFollowEnabled) {
      stopLiveFollow();
      pushActivity(`检测到手动翻页，已退出实时跟随：${filePath}。`);
    }

    if (direction === "prev") {
      if (sliceOffset <= 0) {
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
    if (activeLogView !== "search" || !filePath.trim() || isBusy || wheelSliceLockRef.current) {
      return;
    }

    const scrollState = virtualViewerRef.current?.getScrollState();
    if (!scrollState) return;

    const { scrollTop, scrollHeight, clientHeight } = scrollState;
    const maxScrollTop = Math.max(0, scrollHeight - clientHeight);
    const nearTop = scrollTop <= 4;
    const nearBottom = scrollTop >= maxScrollTop - 4;

    if (event.deltaY < 0 && nearTop && sliceOffset > 0) {
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

  async function loadHeadSlice() {
    const targetFilePath = filePath;
    if (!targetFilePath.trim()) {
      return;
    }
    sliceScrollAnchorRef.current = "top";
    if (liveFollowEnabled) {
      stopLiveFollow();
      pushActivity(`检测到手动跳到文件头，已退出实时跟随：${targetFilePath}。`);
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
      stopLiveFollow();
      pushActivity(`检测到手动跳转位置，已退出实时跟随：${targetFilePath}。`);
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

  function exportCurrentResults() {
    const exportContent = activeResultTab?.content || (results ? results.rawOutput : "");
    if (!exportContent) {
      return;
    }

    downloadTextFile(exportContent, `server-log-console/检索结果-${Date.now()}.log`);
    setActionStatus("当前结果页已触发下载。");
    pushActivity("已触发当前结果页下载。");
  }

  return (
    <main className={`app-shell${uiTheme === "modern" ? " theme-modern" : ""}`}>
      <section className="shell-layout">
        <aside className="sidebar-panel">
          <div className="sidebar-head">
            <div className="sidebar-head-row">
              <div>
                <p className="eyebrow">日志控制台</p>
                <h1 className="topbar-title">日志控制台</h1>
              </div>
              <div style={{ display: "flex", gap: "2px" }}>
                <button
                  className="ghost-button icon-button"
                  title={uiTheme === "classic" ? "切换到现代风格" : "切换到经典风格"}
                  onClick={toggleUiTheme}
                >
                  <ToolIcon kind={uiTheme === "classic" ? "sparkle" : "undo"} />
                </button>
                <button
                  className="ghost-button icon-button"
                  title={showConnectionSettings ? "收起设置" : "打开设置"}
                  onClick={() => setShowConnectionSettings((current) => !current)}
                >
                  <ToolIcon kind="settings" />
                </button>
              </div>
            </div>
            <p className="status-inline">{actionStatus}</p>
          </div>

          <section className="pane-section">
            <div className="pane-title">服务器</div>
            <input
              value={serverFilter}
              onChange={(event) => setServerFilter(event.target.value)}
              placeholder="输入名称、分组或地址"
            />
          </section>

          <div className="server-groups pane-section">
            {showServiceOfflineState ? (
              <div className="empty-box sidebar-empty-box">
                <strong>本地服务未启动</strong>
                <span>请在终端执行 npm run dev:gateway 启动本地连接服务，然后点击下方"检查服务"。</span>
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
                            writeLastServerId(server.id);
                            setServerId(server.id);
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

          <section className="activity-panel pane-section compact-activity-panel">
            <div className="browser-column-head pane-title-row">
              <strong className="pane-title">操作记录</strong>
              <span>{recentActivityLines.length} 条</span>
            </div>
            <pre className="console-block activity-block">{recentActivityLines.join("\n")}</pre>
          </section>

          {showConnectionSettings ? (
            <section className="settings-drawer">
              <div className="drawer-section">
                {renderSettingsSectionHeader(
                  "import",
                  "连接导入",
                  <>
                    <button className="ghost-button slim-button" type="button" onClick={() => void checkLocalServiceHealth()} disabled={isBusy}>
                      检查服务
                    </button>
                    <button className="ghost-button slim-button" onClick={saveFinalShellPath} disabled={isBusy}>
                      保存
                    </button>
                    <button className="ghost-button slim-button" type="button" onClick={importFromFinalShell} disabled={isBusy || localServiceState !== "online"}>
                      导入
                    </button>
                  </>
                )}
                {expandedSettingsSection === "import" ? (
                  <>
                    <label>
                      FinalShell 目录
                      <input
                        value={finalShellPath}
                        onChange={(event) => setFinalShellPath(event.target.value)}
                        placeholder="~/Library/FinalShell/conn"
                      />
                    </label>
                    <div className="meta-list settings-meta-list">
                      <span>本地服务：{localServiceStatusText}</span>
                      <span>导入情况：{importStatus}</span>
                      <span>识别目录：{importPath}</span>
                      <span>上次导入：{finalShellLastImportedAt || "--"}</span>
                      <span>检测路径：{formatNumber(finalShellDetectedPaths.length)}</span>
                    </div>
                  </>
                ) : null}
              </div>

              <div className="drawer-section">
                {renderSettingsSectionHeader(
                  "credential",
                  "连接凭证",
                  <>
                    <button className="ghost-button" type="button" onClick={() => testServerConnection("/")} disabled={isBusy || !serverId}>
                      重连
                    </button>
                    <button className="ghost-button" type="button" onClick={saveCredentialForServer} disabled={isBusy || !serverId}>
                      保存凭证
                    </button>
                  </>
                )}
                {expandedSettingsSection === "credential" ? (
                  <>
                    <div className="meta-list settings-meta-list">
                      <span>来源：{credentialStatus?.source || "--"}</span>
                      <span>用户名：{credentialStatus?.username || selectedServer?.username || "--"}</span>
                      <span>密码：{credentialStatus?.hasPassword ? "已保存" : "未配置"}</span>
                      <span>私钥：{credentialStatus?.hasPrivateKey ? "已保存" : "未配置"}</span>
                    </div>
                    <div className="form-grid">
                      <label>
                        用户名
                        <input value={credentialUsername} onChange={(event) => setCredentialUsername(event.target.value)} />
                      </label>
                      <label>
                        密码
                        <input type="password" value={credentialPassword} onChange={(event) => setCredentialPassword(event.target.value)} />
                      </label>
                      <label className="span-2">
                        私钥
                        <input value={credentialPrivateKey} onChange={(event) => setCredentialPrivateKey(event.target.value)} />
                      </label>
                    </div>
                  </>
                ) : null}
              </div>

              {selectedServer && (selectedServer.connectionKind !== "bastion" || looksLikeJumpServer(selectedServer)) ? (
                <div className="drawer-section">
                  {renderSettingsSectionHeader(
                    "route",
                    "连接入口",
                    <div className="inline-actions settings-head-actions">
                      {showJumpServerRouteFields ? (
                        <button className="ghost-button" type="button" onClick={() => openTerminalView()} disabled={isBusy || !serverId}>
                          打开终端
                        </button>
                      ) : null}
                      <button className="ghost-button" type="button" onClick={saveServerRouteForServer} disabled={isBusy || !serverId}>
                        保存
                      </button>
                    </div>
                  )}
                  {expandedSettingsSection === "route" ? (
                    <>
                      <label>
                        入口账号
                        <select
                          value={preferredBastionId}
                          onChange={(event) => {
                            setPreferredBastionId(event.target.value);
                            setJumpAssetOptions([]);
                            setJumpAssetId("");
                            jumpAssetAutoSearchKeyRef.current = "";
                          }}
                        >
                          <option value="">自动尝试</option>
                          {availableBastions.map((server) => (
                            <option key={server.id} value={server.id}>
                              {server.name} · {server.username}@{server.host}:{server.port}
                            </option>
                          ))}
                        </select>
                      </label>
                      <div className="meta-list settings-meta-list">
                        <span>当前：{serverRouteConfig?.preferredBastionId ? "已指定" : "自动尝试"}</span>
                        <span>可选：{formatNumber(availableBastions.length)} 台</span>
                        <span>{looksLikeJumpServer(selectedServer) ? "打开终端后可在菜单中手动搜索资产并进入目标机。" : "如需二跳，先选入口账号，再打开终端。"}</span>
                      </div>
                    </>
                  ) : null}
                </div>
              ) : null}
            </section>
          ) : null}
        </aside>

      <section className={`main-panel ${isFileMode ? "main-panel-files" : ""}${terminalPanelOpen ? " main-panel-with-terminal" : ""}`}>
          <section className="toolbar-panel">
            <div className="toolbar-commandbar">
              <div className="toolbar-tabs">
                {logViews.map((view) => (
                  <button
                    key={view.key}
                    className={view.key === activeLogView ? "ghost-button tab-active" : "ghost-button"}
                    onClick={() => setActiveLogView(view.key)}
                    type="button"
                  >
                    {view.label}
                  </button>
                ))}
              </div>
              <div className="toolbar-filebar">
                <input
                  className="command-input command-input-file"
                  value={selectedFileName}
                  readOnly
                  placeholder="先选一个日志文件"
                />
              </div>
              <div className="toolbar-inline toolbar-search-actions">
                {activeLogView === "search" ? (
                  <>
                    <button className="ghost-button toolbar-action-button" onClick={() => void runSearch()} disabled={isBusy || !filePath.trim()}>
                      <ToolIcon kind="search" /><span>搜索</span>
                    </button>
                    <button className="ghost-button toolbar-action-button" onClick={loadTailSlice} disabled={isBusy || !filePath.trim()}>
                      <ToolIcon kind="tail" /><span>看尾部</span>
                    </button>
                    {canOpenTerminal ? (
                      <button className="ghost-button toolbar-action-button" onClick={() => terminalPanelOpen ? setTerminalPanelOpen(false) : openTerminalView()} disabled={!serverId}>
                        <ToolIcon kind="terminal" /><span>{terminalPanelOpen ? "收起终端" : "终端"}</span>
                      </button>
                    ) : null}
                    <button className="ghost-button toolbar-action-button" onClick={() => setActiveLogView("files")}>
                      <ToolIcon kind="files" /><span>选文件</span>
                    </button>
                    <button className="ghost-button toolbar-action-button slim-action" title="上一个命中" onClick={() => focusHighlight("prev")} disabled={!highlightCount}>
                      上一个
                    </button>
                    <button className="ghost-button toolbar-action-button slim-action" title="下一个命中" onClick={() => focusHighlight("next")} disabled={!highlightCount}>
                      下一个
                    </button>
                    <button className="ghost-button toolbar-action-button" onClick={() => setShowQueryAdvanced((current) => !current)}>
                      <ToolIcon kind="more" /><span>{showQueryAdvanced ? "收起条件" : "更多条件"}</span>
                    </button>
                  </>
                ) : (
                  <>
                    {canOpenTerminal ? (
                      <button className="ghost-button toolbar-action-button" onClick={() => terminalPanelOpen ? setTerminalPanelOpen(false) : openTerminalView()} disabled={!serverId}>
                        <ToolIcon kind="terminal" /><span>{terminalPanelOpen ? "收起终端" : "终端"}</span>
                      </button>
                    ) : null}
                    <button className="ghost-button toolbar-action-button" onClick={() => setShowQueryAdvanced((current) => !current)}>
                      <ToolIcon kind="more" /><span>{showQueryAdvanced ? "收起条件" : "更多条件"}</span>
                    </button>
                  </>
                )}
              </div>
            </div>

            {showKeywordBar ? (
              <div className="toolbar-search-row">
                <input
                  ref={keywordInputRef}
                  className="command-input command-input-keyword"
                  value={keywordInput}
                  onChange={(event) => setKeywordInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      void runSearch();
                    }
                  }}
                  placeholder="输入关键字，或直接用 /关键字 后回车"
                />
                <button className="ghost-button slim-button" onClick={() => setKeywordInput("")}>
                  清空
                </button>
              </div>
            ) : null}

            {!showQueryAdvanced && (highlightCount || results?.matches.length || liveFollowEnabled) ? (
              <div className="toolbar-inline toolbar-hint toolbar-summary">
                <span>{toolbarSummaryLabel}</span>
                <span>{liveFollowEnabled ? (liveFollowConnected ? "实时中" : "实时连接中") : (results?.matches.length ? `共 ${formatNumber(results.matches.length)} 条结果` : "")}</span>
              </div>
            ) : null}

            {showQueryAdvanced ? (
              <div className="advanced-strip">
                <div className="advanced-row advanced-row-main">
                  <label>
                    匹配
                    <select value={keywordMode} onChange={(event) => setKeywordMode(event.target.value as "phrase" | "any" | "all")}>
                      <option value="phrase">精确包含</option>
                      <option value="any">任意一个</option>
                      <option value="all">同时包含</option>
                    </select>
                  </label>
                  <label>
                    上下文
                    <input type="number" min={0} max={20} value={contextLines} onChange={(event) => setContextLines(Number(event.target.value))} />
                  </label>
                  <label className="checkbox-inline checkbox-inline-compact">
                    <input
                      type="checkbox"
                      checked={useRegex}
                      onChange={(event) => {
                        setUseRegex(event.target.checked);
                        setSelectedPreset(event.target.checked ? "正则" : "自定义");
                      }}
                    />
                    正则
                  </label>
                </div>
                <div className="advanced-row advanced-row-time">
                  <label>
                    起始
                    <div className="time-pair">
                      <input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} />
                      <input type="time" step="1" value={startTime} onChange={(event) => setStartTime(event.target.value)} />
                    </div>
                  </label>
                  <label>
                    截止
                    <div className="time-pair">
                      <input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} />
                      <input type="time" step="1" value={endTime} onChange={(event) => setEndTime(event.target.value)} />
                    </div>
                  </label>
                </div>
                <div className="preset-strip preset-strip-advanced">
                  {searchPresets.map((preset) => (
                    <button
                      key={preset.label}
                      className={preset.label === selectedPreset ? "ghost-button preset-active" : "ghost-button"}
                      onClick={preset.apply}
                      type="button"
                    >
                      {preset.label}
                    </button>
                  ))}
                  <button className="ghost-button" onClick={() => setKeywordInput("")}>清空</button>
                </div>
              </div>
            ) : null}

            {/* connection info in sidebar */}

            {searchStartedAt ? (
              <div className="search-progress-panel">
                <div className="search-progress-head">
                  <strong>正在查找</strong>
                  <span>已用 {searchElapsedLabel}</span>
                </div>
                <div className="search-progress-track">
                  <span
                    className="search-progress-indicator"
                    style={searchTask ? { left: "0%", width: `${Math.max(6, searchTask.progressPercent)}%`, animation: "none" } : undefined}
                  />
                </div>
                <div className="search-progress-meta">
                  <span>{liveStrategyLabel}</span>
                  <span>{searchTask ? `${searchTask.progressPercent.toFixed(1)}% · ${formatBytes(searchTask.scannedBytes)} / ${formatBytes(searchTask.totalBytes)}` : "服务器正在查找"}</span>
                  <span>{searchTask ? `命中 ${formatNumber(searchTask.matchCount)} 条` : "--"}</span>
                </div>
              </div>
            ) : null}
          </section>

          <section className={`workspace-panel ${isFileMode ? "workspace-panel-files" : ""}`}>
            {showServiceOfflineState ? (
              <div className="workspace-startup-card">
                <div className="workspace-startup-head">
                  <strong>本地连接服务未启动</strong>
                  <span>步骤：1. 在项目根目录执行 npm run dev:gateway 2. 点击右侧"检查服务" 3. 服务就绪后导入 FinalShell 或手动添加服务器</span>
                </div>
                <div className="toolbar-inline">
                  <button className="ghost-button" type="button" onClick={() => void checkLocalServiceHealth()}>
                    检查服务
                  </button>
                  <button className="ghost-button" type="button" onClick={() => setShowConnectionSettings(true)}>
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
                  <button className="ghost-button" type="button" onClick={() => setShowConnectionSettings(true)}>
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
            ) : !isFileMode ? (
              <>
                <div className="panel-head inline-panel-head workspace-head">
                  <div>
                    <p className="panel-kicker">结果</p>
                    <h2>{activeResultTab ? `${activeResultTab.label} · ${activeResultTab.sourceLabel}` : logViews.find((view) => view.key === activeLogView)?.label}</h2>
                  </div>
                  <div className="toolbar-inline">
                    {filePath && activeLogView === "search" && activeViewerTabId === "file" ? (
                      <button
                        className={liveFollowEnabled ? "ghost-button tab-active" : "ghost-button"}
                        onClick={() => liveFollowEnabled ? stopLiveFollow() : startLiveFollow(filePath, selectedFileName)}
                        disabled={isBusy || !filePath.trim()}
                      >
                        {liveFollowEnabled ? (liveFollowConnected ? "停止实时" : "实时连接中…") : "实时跟随"}
                      </button>
                    ) : null}
                    {filePath && activeLogView === "search" && activeViewerTabId === "file" ? (
                      <button className={showFileTools ? "ghost-button tab-active" : "ghost-button"} onClick={() => setShowFileTools((current) => !current)}>
                        {showFileTools ? "收起更多" : "更多工具"}
                      </button>
                    ) : null}
                    {activeLogView === "search" ? (
                      <button className="ghost-button" onClick={exportCurrentResults} disabled={!activeResultTab && !results}>下载结果</button>
                    ) : null}
                    {activeViewerCommandPreview ? (
                      <button
                        className="ghost-button"
                        onClick={() => {
                          void copyText(activeViewerCommandPreview).then(() => setActionStatus("搜索命令已复制到剪贴板。"));
                        }}
                      >
                        复制命令
                      </button>
                    ) : null}
                  </div>
                </div>

                <div className="viewer-shell">
                {viewerTabs.length > 1 ? (
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

                {showFileTools && filePath && activeLogView === "search" && activeViewerTabId === "file" ? (
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
                        value={sliceLength}
                        onChange={(event) => {
                          const next = Number(event.target.value);
                          if (next > 0) {
                            setSliceLength(next);
                          }
                        }}
                      >
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
                        <button className="ghost-button" onClick={() => void navigateSlice("prev")} disabled={sliceOffset === 0 || isBusy}>
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
                    {!(showFileTools && filePath && activeLogView === "search" && activeViewerTabId === "file") ? (
                      <div className="meta-list compact-meta">
                        <span>{activeResultTab ? activeResultTab.sourceLabel : (selectedFileName || "--")}</span>
                        <span>{activeViewerTabId === "file" ? formatSliceProgressLabel(sliceProgress) : "结果页"}</span>
                        <span>{compactReaderHint}</span>
                      </div>
                    ) : null}
                    {activeViewerTabId !== "file" && activeViewerMatches.length ? (
                      <div className="search-match-list">
                        {activeViewerMatches.map((match, index) => (
                          <button
                            key={`${match.source}:${match.lineNumber}:${index}`}
                            type="button"
                            className="search-match-item"
                            onClick={() => void jumpToSearchMatch(match)}
                            title={match.source === "临时结果" ? "临时结果页暂不支持回跳原文件" : `定位到 ${match.lineNumber} 行`}
                          >
                            <span className="search-match-line">{formatNumber(match.lineNumber)}</span>
                            <span className="search-match-preview">{match.preview}</span>
                          </button>
                        ))}
                      </div>
                    ) : null}
                    <div className={`viewer-content-shell ${showReaderRail ? "viewer-content-shell-with-rail" : ""}`}>
                      <VirtualLogViewer
                        ref={virtualViewerRef}
                        content={currentLogContent}
                        keywordTerms={keywordTerms}
                        useRegex={useRegex}
                        activeHighlightIndex={activeHighlightIndex}
                        onHighlightCountChange={setHighlightCount}
                        onWheel={handleViewerWheel}
                        onNearBottomChange={liveFollowEnabled ? handleLiveNearBottomChange : undefined}
                        followOutput={liveFollowEnabled && !liveFollowPaused}
                        className="console-block viewer-console viewer-console-markup"
                      />
                      {liveFollowEnabled && liveFollowPaused ? (
                        <button className="live-back-to-bottom ghost-button" onClick={scrollLiveToBottom}>
                          新内容到达，点击回到底部
                        </button>
                      ) : null}
                      {showReaderRail ? (
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
              </>
            ) : (
              <>
                <div className="workspace-strip">
                  <div className="workspace-pathbar">
                    <input
                      ref={directoryInputRef}
                      className="directory-input"
                      value={directoryInput}
                      onChange={(event) => setDirectoryInput(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          void openDirectoryFromInput();
                        }
                      }}
                      placeholder="/home/app/logs"
                    />
                  </div>
                  <div className="toolbar-inline workspace-actions compact-actions">
                    {showDirectoryFilter ? (
                      <input
                        className="directory-filter-input"
                        value={fileFilter}
                        onChange={(event) => setFileFilter(event.target.value)}
                        placeholder="过滤当前目录文件"
                      />
                    ) : null}
                    <button className="ghost-button icon-button" title="返回上一级" onClick={() => void browseParentDirectory()} disabled={isBusy || !serverId}>
                      <ToolIcon kind="open" />
                    </button>
                    <button className="ghost-button icon-button" title="过滤当前目录" onClick={() => setShowDirectoryFilter((current) => !current)} disabled={!serverId}>
                      <ToolIcon kind="filter" />
                    </button>
                    <button className="ghost-button icon-button" title="刷新目录" onClick={() => browseLogFiles(directoryPath || "/")} disabled={isBusy || !serverId}>
                      <ToolIcon kind="refresh" />
                    </button>
                  </div>
                </div>

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
                      <button className="ghost-button" onClick={() => setShowConnectionSettings(true)}>
                        连接设置
                      </button>
                    </div>
                  </div>
                ) : hasFileWorkspaceEntries ? (
                  <div
                    ref={browserGridRef}
                    className="browser-grid"
                    style={{ gridTemplateColumns: `${browserTreeWidth}px 6px minmax(0, 1fr)` }}
                  >
                    <section className="browser-column browser-tree-column">
                      <div className="browser-column-head">
                        <strong>目录树</strong>
                        <span>{formatNumber(directoryEntries.length)} 个目录</span>
                      </div>
                      <div className="tree-list">
                        {treeEntries.length ? (
                          treeEntries.map((entry) => (
                            <button
                              key={entry.key}
                              className={`tree-item ${entry.isCurrent ? "tree-item-current" : ""} ${entry.kind === "path" ? "tree-item-path" : "tree-item-directory"}`}
                              style={{ paddingLeft: `${10 + entry.depth * 14}px` }}
                              onClick={() => browseLogFiles(entry.path)}
                            >
                              <span className="tree-name-cell">
                                <span className={`tree-caret ${entry.kind === "path" ? "tree-caret-open" : "tree-caret-placeholder"}`} aria-hidden="true" />
                                <span className="entry-icon entry-icon-dir" aria-hidden="true" />
                                <strong>{entry.label}</strong>
                              </span>
                            </button>
                          ))
                        ) : (
                          <div className="empty-box table-empty">当前层级没有子目录</div>
                        )}
                      </div>
                    </section>

                    <div className="browser-resizer" onPointerDown={handleTreeResizeStart} title="拖拽调整目录宽度" />

                    <section className="browser-column browser-file-column">
                      <div className="browser-column-head">
                        <strong>目录内容</strong>
                        <span>{formatNumber(tableEntries.length)} 项</span>
                      </div>
                      <div className="file-table">
                        <div className="file-table-head">
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
                        </div>
                        {tableEntries.length ? (
                          tableEntries.map((entry) => (
                            <button
                              key={entry.path}
                              className={`file-row ${entry.path === filePath ? "file-row-active" : ""} ${entry.kind === "directory" ? "file-row-dir" : ""}`}
                              onClick={() => openEntry(entry)}
                            >
                              <span className="file-name-cell">
                                <span className={`entry-icon ${entry.kind === "directory" ? "entry-icon-dir" : "entry-icon-file"}`} aria-hidden="true" />
                                <strong>{entry.name}</strong>
                              </span>
                              <span>{entry.kind === "file" && typeof entry.size === "number" ? formatBytes(entry.size) : "--"}</span>
                              <span>{formatDateTime(entry.modifiedTime)}</span>
                              <span>{entry.kind === "directory" ? "目录" : "文件"}</span>
                            </button>
                          ))
                        ) : (
                          <div className="empty-box table-empty">当前目录为空</div>
                        )}
                      </div>
                    </section>
                  </div>
                ) : (
                  <div
                    ref={browserGridRef}
                    className="browser-grid"
                    style={{ gridTemplateColumns: `${browserTreeWidth}px 6px minmax(0, 1fr)` }}
                  >
                    <section className="browser-column browser-tree-column">
                      <div className="browser-column-head">
                        <strong>目录</strong>
                        <span>{formatNumber(treeEntries.length)} 项</span>
                      </div>
                      <div className="tree-list">
                        {treeEntries.map((entry) => (
                          <button
                            key={entry.key}
                            className={`tree-item ${entry.isCurrent ? "tree-item-current" : ""} ${entry.kind === "path" ? "tree-item-path" : "tree-item-directory"}`}
                            style={{ paddingLeft: `${10 + entry.depth * 14}px` }}
                            onClick={() => browseLogFiles(entry.path)}
                          >
                            <span className="tree-name-cell">
                              <span className={`tree-caret ${entry.kind === "path" ? "tree-caret-open" : "tree-caret-placeholder"}`} aria-hidden="true" />
                              <span className="entry-icon entry-icon-dir" aria-hidden="true" />
                              <strong>{entry.label}</strong>
                            </span>
                          </button>
                        ))}
                      </div>
                    </section>

                    <div className="browser-resizer" onPointerDown={handleTreeResizeStart} title="拖拽调整目录宽度" />

                    <section className="browser-column browser-file-column">
                      <div className="browser-column-head">
                        <strong>目录内容</strong>
                        <span>0 项</span>
                      </div>
                      <div className="file-table">
                        <div className="file-table-head">
                          <span>名称</span>
                          <span>大小</span>
                          <span>类型</span>
                        </div>
                        <div className="empty-box table-empty table-empty-large">当前目录为空</div>
                      </div>
                    </section>
                  </div>
                )}
              </>
            )}
          </section>

          {terminalPanelOpen ? (
            <TerminalPanel
              server={selectedServer}
              connected={terminalSession.connected}
              isBusy={isBusy}
              serverId={serverId}
              containerRef={terminalSession.containerRef}
              onReconnect={() => openTerminalView()}
              onClose={() => setTerminalPanelOpen(false)}
              onFocus={() => terminalSession.focusTerminal()}
            />
          ) : null}

        </section>
      </section>
    </main>
  );
}
