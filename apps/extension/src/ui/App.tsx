import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FeedbackOverlays, type DownloadProgressState, type UploadProgressState } from "./FeedbackOverlays.js";
import { FileContextMenu, type FileContextMenuState } from "./FileContextMenu.js";
import { FileBrowserActions } from "./FileBrowserActions.js";
import { FileBrowserContentColumn } from "./FileBrowserContentColumn.js";
import { FileBrowserGrid } from "./FileBrowserGrid.js";
import { FileBrowserHistoryDropdown } from "./FileBrowserHistoryDropdown.js";
import { FileBrowserPathbar, buildBreadcrumbItems } from "./FileBrowserPathbar.js";
import { FileBrowserTableRows } from "./FileBrowserTableRows.js";
import { FileBrowserTreeColumn } from "./FileBrowserTreeColumn.js";
import { looksLikeJumpServer } from "./terminal-utils.js";
import type { PreviewDialogState } from "./FilePreviewDialog.js";
import type { ConfirmDialogState } from "./ModalDialogs.js";
import { ConnectionSettingsWorkspace, WatermarkOverlay, type GatewayTestState, type ManualServerDraft, type SettingsWorkspaceView } from "./ConnectionSettingsWorkspace.js";
import { useDesktopUpdate } from "./UpdateCenterPanel.js";
import { SearchQueryPanel } from "./SearchQueryPanel.js";
import { SearchToolbarActions } from "./SearchToolbarActions.js";
import { SshTunnelPanel } from "./SshTunnelPanel.js";
import { BatchCommandPanel } from "./BatchCommandPanel.js";
import { ToolDrawer } from "./ToolDrawer.js";
import { DiffComparePanel } from "./DiffComparePanel.js";
import { ServerStatusPanel } from "./ServerStatusPanel.js";
import type { UtilityPanelType } from "./ToolDrawer.js";
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent, WheelEvent as ReactWheelEvent } from "react";
import type { CSSProperties, ReactNode } from "react";
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
  ServerSystemProfileResponse,
  ServerSummary
} from "@server-log-console/shared";
import { ArrowDown, ArrowLeft, Settings, Download, Copy, Bug, Bookmark, X, AlertTriangle, Search, Folder, ServerOff, FolderSearch, Lightbulb, ShieldCheck } from "lucide-react";
import { TerminalPanel, type TerminalPaneSessionState } from "./TerminalWorkspace.js";
import { ToolIcon } from "./ToolIcon.js";
import { PipExpandIcon } from "./PipExpandIcon.js";
import { ThemedSelect } from "./ThemedSelect.js";

import type { useTerminalSession } from "./useTerminalSession.js";
import { useTerminalTabs, createTerminalTabState } from "./useTerminalTabs.js";
import { useToasts } from "./useToasts.js";
import { VirtualLogViewer, type VirtualLogViewerHandle, type VirtualLogViewerScrollState } from "./VirtualLogViewer.js";
import { useLiveFollow } from "./useLiveFollow.js";
import { usePictureInPicture } from "./usePictureInPicture.js";
import type { LogRecordingSessionResponse } from "./api.js";
import type { WorkspaceSession, WorkspaceSessionState, TerminalTabState, ViewerPipSnapshot } from "./types.js";
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
  createTerminalSessionId,
} from "./app-utils.js";
import { useAsyncStatus } from "./useAsyncStatus.js";
import { useLocalService } from "./useLocalService.js";
import { useSearchTimer } from "./useSearchTimer.js";
import { usePanelResize } from "./usePanelResize.js";
import { useElectronEnv } from "./useElectronEnv.js";
import { useUiTheme, monoFontFamilyValue, uiFontSizeVars, THEME_PRESETS, BG_LAYERS, TERMINAL_SCHEMES, onAccentColor, accentHoverColor, accentSoftColor } from "./useUiTheme.js";
import { useWorkspaceTabDrag } from "./useWorkspaceTabDrag.js";
import { useTransferHistory } from "./useTransferHistory.js";
import { useFileBrowserComputed } from "./useFileBrowserComputed.js";
import { useServerConnection } from "./useServerConnection.js";
import { useSliceCache } from "./useSliceCache.js";
import { useImportSettings } from "./useImportSettings.js";
import { useFileTransfer } from "./useFileTransfer.js";
import { isSpecialPreviewFile, useFileOperations } from "./useFileOperations.js";
import { useServerManagement } from "./useServerManagement.js";
import { useLogRecording } from "./useLogRecording.js";
import { SidebarPanel } from "./SidebarPanel.js";
import { ServerPickerOverlay, SidepanelMobileTop, SidepanelMobileTabBar, DirectorySheet } from "./SidepanelMobile.js";
import { WorkspaceTabContextMenu, type WorkspaceTabMenuState } from "./WorkspaceTabContextMenu.js";
import { WorkspaceSessionTabs } from "./WorkspaceSessionTabs.js";
import { SettingsModalOverlay } from "./SettingsModalOverlay.js";
import { WorkspaceStartupCards } from "./WorkspaceStartupCards.js";
import { EmptyWorkbench } from "./EmptyWorkbench.js";
import { CommandPalette } from "./CommandPalette.js";
import { ImmediateTooltip } from "./ImmediateTooltip.js";
import { DialogOverlays } from "./DialogOverlays.js";
import { useTerminalWindowManager } from "./useTerminalWindowManager.js";
import { useKeyboardShortcuts } from "./useKeyboardShortcuts.js";
import { useWorkspaceSessionManager, type WorkspaceSessionSetters } from "./useWorkspaceSessionManager.js";
import { useLogViewer } from "./useLogViewer.js";
import {
  DEFAULT_GATEWAY_BASE,
  localServiceBase,
  apiGetLogMeta,
  apiGetLogSlice,
  apiGetServerSystemProfile,
  apiProbeGateway,
  applyGatewayConfig,
  normalizeGatewayBase,
} from "./api.js";
import {
  buildConnectionSummary,
  clampPercent,
  clampSliceStart,
  copyText,
  formatNumber,
  formatBytes,
  formatDateTime,
  formatDurationLabel,
  formatPercent,
  formatPreviewSnippet,
  formatSliceProgressLabel,
  getParentDirectoryPath,
  getPreviewCacheKey,
  normalizeSearchInput,
  resolveSearchTerms,
  previewBucketSize,
  previewSliceLength,
} from "./utils.js";
import type { LineContextState, ViewerResultTab } from "./utils.js";
import {
  type TransferHistoryEntry,
  readActivityPanelHeight,
  readBrowserTreeWidth,
  readDirectoryHistory,
  readGatewayConfig,
  readLastDirectoryMap,
  readLastSettingsView,
  readTransferHistory,
  rememberDirectoryIfUseful,
  writeActivityPanelHeight,
  writeBrowserTreeWidth,
  writeGatewayConfig,
  clearGatewayConfig,
  writeLastSettingsView,
} from "./storage.js";


// Detect PiP mode from URL params (Electron BrowserWindow PiP)
const pipUrlParams = new URLSearchParams(globalThis.location?.search ?? "");
const pipMode = pipUrlParams.get("pip") ?? "";
const isStandaloneViewerWindow = pipMode === "viewer";
const isStandaloneTerminalWindow = pipMode === "terminal";
const isStandaloneUtilityWindow = pipMode === "utility";
const isStandalonePipWindow = isStandaloneViewerWindow || isStandaloneTerminalWindow || isStandaloneUtilityWindow;
const SERVER_STATUS_REFRESH_INTERVAL_MS = 10000;
const JUMP_STATUS_REMOTE_ROOTS = new Set([
  "home", "var", "opt", "tmp", "root", "etc", "usr", "srv", "data", "mnt", "media", "run", "log", "logs", "app", "apps", "www"
]);

type ServerStatusContextSource = "directory" | "file" | "saved" | "none";

function isJumpServerStatusContextCandidate(value: string): boolean {
  const parts = value.split("/").filter(Boolean);
  return parts.some((part, index) => index > 0 && JUMP_STATUS_REMOTE_ROOTS.has(part.toLowerCase()))
    || isJumpServerAssetRootPath(value);
}

function isJumpServerAssetRootPath(value: string): boolean {
  const parts = value.split("/").filter(Boolean);
  const assetKey = parts[parts.length - 1] || "";
  return parts.length >= 2 && looksLikeJumpServerAssetKey(assetKey);
}

function looksLikeJumpServerAssetKey(value: string): boolean {
  return /\d{1,3}(?:\.\d{1,3}){1,3}/.test(value) || /^[^/\s]+_[^/]+$/.test(value);
}

function getJumpServerStatusContextLabel(value: string): string {
  const parts = value.split("/").filter(Boolean);
  for (let index = 0; index < parts.length; index += 1) {
    if (index > 0 && JUMP_STATUS_REMOTE_ROOTS.has(parts[index].toLowerCase())) {
      return parts[index - 1];
    }
  }
  if (isJumpServerAssetRootPath(value)) {
    return parts[parts.length - 1] || value;
  }
  return value || "未确定目标";
}

function toCssImageUrl(value: string): string {
  const normalized = value.trim();
  if (!normalized) return "none";
  const source = /^(https?:|file:|data:|blob:)/i.test(normalized)
    ? normalized
    : normalized.startsWith("/")
      ? `file://${normalized}`
      : normalized;
  return `url(${JSON.stringify(source)})`;
}

function fontFamilyValue(value: string): string {
  if (value === "pingfang") return "\"PingFang SC\", \"Hiragino Sans GB\", \"Microsoft YaHei\", sans-serif";
  if (value === "microsoft-yahei") return "\"Microsoft YaHei\", \"PingFang SC\", sans-serif";
  if (value === "simsun") return "\"Songti SC\", \"SimSun\", serif";
  if (value === "system") return "-apple-system, BlinkMacSystemFont, \"SF Pro Text\", \"PingFang SC\", sans-serif";
  return "\"Geist\", \"Inter\", -apple-system, \"SF Pro Text\", \"PingFang SC\", \"Hiragino Sans GB\", \"Microsoft YaHei\", sans-serif";
}

export function App() {
  const [servers, setServers] = useState<ServerSummary[]>([]);
  const [serverId, setServerId] = useState(pipUrlParams.get("serverId") ?? "");
  const [filePath, setFilePath] = useState(pipUrlParams.get("filePath") ?? "");
  const [serverFilter, setServerFilter] = useState("");
  const [fileFilter, setFileFilter] = useState("");
  const [keywordInput, setKeywordInput] = useState("");
  const [keywordMode, setKeywordMode] = useState<"phrase" | "any" | "all">("phrase");
  const [excludeInput, setExcludeInput] = useState("");
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
  /* 旧单会话 id：迁移来源 + openPipWindow 弹窗协议参数（新模型见 terminalTabs） */
  const [terminalSessionId, setTerminalSessionId] = useState(pipUrlParams.get("terminalSessionId") || "");
  /* 终端内多标签组（每工作区独立持久化）；独立终端窗从 URL 构造单标签 */
  const [terminalTabs, setTerminalTabs] = useState<TerminalTabState[]>(() => {
    if (!isStandaloneTerminalWindow) {
      return [];
    }
    const sessionId = pipUrlParams.get("terminalSessionId")?.trim() || "";
    const seedServerId = pipUrlParams.get("serverId") || "server";
    return [{ tabId: "tt-standalone", sessionId: sessionId || createTerminalSessionId(seedServerId), kind: "server" as const }];
  });
  const [activeTerminalTabId, setActiveTerminalTabId] = useState<string>(() => (isStandaloneTerminalWindow ? "tt-standalone" : ""));
  /* pane 会话状态 map（激活标签的状态供工具栏/独立窗标题派生） */
  const [terminalPaneStates, setTerminalPaneStates] = useState<Record<string, TerminalPaneSessionState>>({});
  const [terminalOverlay, setTerminalOverlay] = useState<"none" | "shortcuts" | "ai">("none");
  const [activeViewerTabId, setActiveViewerTabId] = useState("file");
  const [workspaceSessions, setWorkspaceSessions] = useState<WorkspaceSession[]>([]);
  const [activeWorkspaceSessionId, setActiveWorkspaceSessionId] = useState<string | null>(null);
  const [fileEntries, setFileEntries] = useState<LogFileEntry[]>([]);
  const [isDirectoryLoading, setIsDirectoryLoading] = useState(false);
  const [directoryPath, setDirectoryPath] = useState(pipUrlParams.get("directoryPath") || defaultDirectoryPath);
  const [statusContextPath, setStatusContextPath] = useState("");
  const [directoryNavBackStack, setDirectoryNavBackStack] = useState<string[]>([]);
  const [directoryNavForwardStack, setDirectoryNavForwardStack] = useState<string[]>([]);
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
  /* 空白处右键菜单（用户反馈 2026-09-30）：文件列表/目录树空白右键 → 新建/上传/刷新等目录级操作 */
  const [blankContextMenu, setBlankContextMenu] = useState<{ x: number; y: number } | null>(null);
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
  /* 在线更新（update-center-v1）：App 级订阅桌面更新状态；含启动自动检查（每会话一次）与红点来源 */
  const desktopUpdate = useDesktopUpdate();
  /* 连接服务（Gateway）设置：草稿地址/令牌 + 测试结果；保存后持久化并重载页面 */
  const initialGatewayConfig = useMemo(() => readGatewayConfig(), []);
  const [gatewayDraftBaseUrl, setGatewayDraftBaseUrl] = useState(initialGatewayConfig.baseUrl);
  const [gatewayDraftToken, setGatewayDraftToken] = useState(initialGatewayConfig.token);
  const [gatewayTestState, setGatewayTestState] = useState<GatewayTestState | null>(null);

  const isLocalGatewayHost = useCallback((baseUrl: string) => {
    if (!baseUrl) return true;
    try {
      const host = new URL(baseUrl).hostname.toLowerCase();
      return host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]";
    } catch {
      return false;
    }
  }, []);

  /* 局域网/本机地址（私网 IP、localhost、无点主机名、.local）允许 http；
     公网地址才强制 https（混合内容拦截只对 https 页面 + 不可信目标生效） */
  const isPrivateGatewayHost = useCallback((baseUrl: string) => {
    if (!baseUrl) return true;
    try {
      const host = new URL(baseUrl).hostname.toLowerCase();
      if (host === "localhost" || host === "::1" || host === "[::1]") return true;
      if (/^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host)) return true;
      if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return true;
      if (host.endsWith(".local") || !host.includes(".")) return true;
      return false;
    } catch {
      return false;
    }
  }, []);

  /* 扩展访问远程网关需要动态 host 权限；localhost 已在静态 host_permissions 中，桌面端无权限体系 */
  const requestGatewayHostPermission = useCallback(async (normalizedBase: string): Promise<boolean> => {
    if (!normalizedBase || isElectron || isLocalGatewayHost(normalizedBase)) {
      return true;
    }
    const chromeApi = (globalThis as { chrome?: { permissions?: { request?: (permissions: { origins: string[] }) => Promise<boolean> } } }).chrome;
    if (!chromeApi?.permissions?.request) {
      return true;
    }
    try {
      return Boolean(await chromeApi.permissions.request({ origins: [`${normalizedBase}/*`] }));
    } catch {
      return false;
    }
  }, [isElectron, isLocalGatewayHost]);

  const testGatewayConfig = useCallback(async () => {
    setGatewayTestState({ tone: "neutral", text: "正在测试连接服务..." });
    const result = await apiProbeGateway(gatewayDraftBaseUrl.trim() || DEFAULT_GATEWAY_BASE, gatewayDraftToken);
    setGatewayTestState({ tone: result.ok ? "success" : "danger", text: result.message });
  }, [gatewayDraftBaseUrl, gatewayDraftToken]);

  const saveGatewayConfig = useCallback(async () => {
    const trimmedBase = gatewayDraftBaseUrl.trim();
    let normalized = "";
    if (trimmedBase) {
      normalized = normalizeGatewayBase(trimmedBase) || "";
      if (!normalized) {
        setGatewayTestState({ tone: "danger", text: "地址格式无效，示例：https://gw.example.com 或 http://localhost:4040" });
        return;
      }
      const protocol = new URL(normalized).protocol;
      if (!isPrivateGatewayHost(normalized) && protocol === "http:") {
        setGatewayTestState({ tone: "danger", text: "公网地址必须使用 https（浏览器会拦截不安全的远程 WebSocket）；局域网地址可用 http" });
        return;
      }
      if (!(await requestGatewayHostPermission(normalized))) {
        setGatewayTestState({ tone: "danger", text: "浏览器站点权限被拒绝，无法访问该地址" });
        return;
      }
      writeGatewayConfig({ baseUrl: normalized, token: gatewayDraftToken });
      applyGatewayConfig({ baseUrl: normalized, token: gatewayDraftToken });
    } else {
      /* 地址留空 = 默认本地服务；令牌仍要保留（本地服务也可能开启 GATEWAY_TOKEN） */
      writeGatewayConfig({ baseUrl: "", token: gatewayDraftToken });
      applyGatewayConfig({ baseUrl: "", token: gatewayDraftToken });
    }
    pushActivity(`连接服务已更新：${localServiceBase}，页面即将重载。`);
    window.location.reload();
  }, [gatewayDraftBaseUrl, gatewayDraftToken, isPrivateGatewayHost, pushActivity, requestGatewayHostPermission]);

  const resetGatewayConfig = useCallback(() => {
    clearGatewayConfig();
    applyGatewayConfig({ baseUrl: "", token: "" });
    setGatewayDraftBaseUrl("");
    setGatewayDraftToken("");
    pushActivity("连接服务已恢复默认（本地服务），页面即将重载。");
    window.location.reload();
  }, [pushActivity]);
  const [preserveTerminalOnInactive, setPreserveTerminalOnInactive] = useState(false);
  const [pendingLiveFollowRestore, setPendingLiveFollowRestore] = useState<WorkspaceSessionState | null>(null);
  const isWorkspaceSwitchLocked = isBusy || searchTask?.status === "queued" || searchTask?.status === "running";
  const [fileLoadingName, setFileLoadingName] = useState("");
  const [isDragOver, setIsDragOver] = useState(false);
  const {
    uiTheme,
    setUiTheme,
    uiDensity,
    setUiDensity,
    uiThemePreset,
    setUiThemePreset,
    uiToneMode,
    setUiToneMode,
    systemDark,
    resolvedTheme,
    uiBackground,
    setUiBackground,
    uiImgOverlay,
    setUiImgOverlay,
    uiImgBlur,
    setUiImgBlur,
    customBackgroundImage,
    setCustomBackgroundImage,
    uiTerminalScheme,
    setUiTerminalScheme,
    uiAccentOverride,
    setUiAccentOverride,
    uiFontFamily,
    setUiFontFamily,
    logFontSize,
    setLogFontSize,
    terminalFontSize,
    setTerminalFontSize,
    uiFontSize,
    setUiFontSize,
    logFontFamily,
    setLogFontFamily,
    terminalFontFamily,
    setTerminalFontFamily,
    motionMode,
    setMotionMode,
    dynamicBackground,
    setDynamicBackground,
    watermarkEnabled,
    setWatermarkEnabled,
    watermarkTemplate,
    setWatermarkTemplate,
    watermarkOpacity,
    setWatermarkOpacity,
    watermarkScope,
    setWatermarkScope,
    activityPanelVisible,
    setActivityPanelVisible,
    resetUiPreferences,
  } = useUiTheme();
  // 深链：?settings=connections|preferences 直接打开设置中心（web 端验证与分享用）
  const [showConnectionSettings, setShowConnectionSettings] = useState(() => new URLSearchParams(window.location.search).has("settings"));
  const [showTransferHistory, setShowTransferHistory] = useState(() => new URLSearchParams(window.location.search).has("transfer"));
  const [paletteOpen, setPaletteOpen] = useState(false);
  /* 侧栏移动档（SidepanelMobile）：整屏选服层 / 目录树底部 sheet 的开关。
     移动/宽档的显隐由 styles-sidepanel.css 容器查询决定，组件 DOM 常驻。 */
  const [serverPickerOpen, setServerPickerOpen] = useState(false);
  const [dirSheetOpen, setDirSheetOpen] = useState(false);
  /* Esc 关闭侧栏移动档浮层（选服层 / 目录 sheet），与桌面弹层习惯一致 */
  useEffect(() => {
    if (!serverPickerOpen && !dirSheetOpen) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }
      event.stopPropagation();
      setServerPickerOpen(false);
      setDirSheetOpen(false);
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [serverPickerOpen, dirSheetOpen]);
  const [settingsWorkspaceView, setSettingsWorkspaceView] = useState<SettingsWorkspaceView>(() => {
    const param = new URLSearchParams(window.location.search).get("settings");
    if (param === "connections" || param === "gateway" || param === "preferences" || param === "update") {
      return param;
    }
    return readLastSettingsView();
  });
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
  // S4 实时状态带：实时过滤关键字（原型 540-543 的过滤框，默认空=不过滤）
  const [liveFilterInput, setLiveFilterInput] = useState("");
  const [showPathHistory, setShowPathHistory] = useState(false);
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
  const [viewerLineCopyRange, setViewerLineCopyRange] = useState<{ start: number; end: number } | null>(null);
  const [showBookmarkPanel, setShowBookmarkPanel] = useState(false);
  const [showUtilityWorkspace, setShowUtilityWorkspace] = useState(false);
  const [activeUtilityPanel, setActiveUtilityPanel] = useState<UtilityPanelType>("compare");
  const [serverSystemProfile, setServerSystemProfile] = useState<ServerSystemProfileResponse | null>(null);
  const [serverSystemProfileLoading, setServerSystemProfileLoading] = useState(false);
  const [serverSystemProfileError, setServerSystemProfileError] = useState("");
  const [serverSystemProfileAutoRefresh, setServerSystemProfileAutoRefresh] = useState(true);
  const [multiFileMode, setMultiFileMode] = useState(false);
  const [filePattern, setFilePattern] = useState("*.log");
  /* 终端视图打开动作（openTerminalView/toggleTerminalPanel 语义）：确保至少一个标签 + setTerminalPanelOpen(true) */
  const ensureAtLeastOneTerminalTab = useCallback(() => {
    if (terminalTabs.length > 0) {
      return;
    }
    const legacy = terminalSessionId.trim();
    const tab = legacy
      ? createTerminalTabState(serverId, legacy)
      : createTerminalTabState(serverId);
    setTerminalTabs([tab]);
    setActiveTerminalTabId(tab.tabId);
  }, [terminalTabs, terminalSessionId, serverId]);
  /* 双轨拆除：单例 useTerminalSession 已移入 TerminalWorkspace 的每标签 pane；
     窗口管理器只保留「打开 = 确保标签 + 开面板」的语义，协议动作一律 no-op。 */
  const terminalSessionShim: ReturnType<typeof useTerminalSession> = {
    connected: false,
    retryCount: 0,
    containerRef: { current: null },
    startTerminal: () => {
      ensureAtLeastOneTerminalTab();
    },
    stopTerminal: () => {
      /* 关闭终端视图 = 保留会话（pane 卸载时自行 detach，网关保留 90s） */
    },
    focusTerminal: () => {},
    focusTerminalSoon: () => {},
    fitTerminal: () => {},
    resizeToContainer: () => false,
    getSelection: () => "",
    clearSelection: () => {},
    pasteToTerminal: () => {},
  };
  const keywordInputRef = useRef<HTMLInputElement | null>(null);
  const directoryInputRef = useRef<HTMLInputElement | null>(null);
  const virtualViewerRef = useRef<VirtualLogViewerHandle | null>(null);
  const viewerContentShellRef = useRef<HTMLDivElement | null>(null);
  const browserGridRef = useRef<HTMLDivElement | null>(null);
  const directoryMouseNavRef = useRef<{ button: number; at: number } | null>(null);
  const contextMenuRef = useRef<HTMLDivElement | null>(null);
  const blankContextMenuRef = useRef<HTMLDivElement | null>(null);
  const workspaceTabMenuRef = useRef<HTMLDivElement | null>(null);
  
  const viewerDebugRef = useRef<HTMLDivElement | null>(null);
  const readerRailRef = useRef<HTMLDivElement | null>(null);
  const sliceTrackRef = useRef<HTMLDivElement | null>(null);
  const viewerOverviewRailRef = useRef<HTMLDivElement | null>(null);
  const initializedRef = useRef(false);
  const autoConnectServerRef = useRef("");
  const sliceScrollAnchorRef = useRef<"top" | "bottom" | null>(null);
  const wheelSliceLockRef = useRef(false);
  const wheelSliceIntentRef = useRef<{ direction: "prev" | "next"; count: number; at: number } | null>(null);
  const lastResultTabIdRef = useRef("");
  const { treeResizeRef, activityPanelResizeRef } = usePanelResize(setBrowserTreeWidth, setActivityPanelHeight);
  const readerPreviewRequestRef = useRef(0);
  const jumpToMatchRequestRef = useRef(0);
  const openFileRequestRef = useRef(0);
  const serverSystemProfileRequestRef = useRef(0);
  const serverSystemProfileLoadingRef = useRef(false);
  const sliceRequestRef = useRef(0);
  const lastSearchResultsRef = useRef<LogSearchResponse | null>(null);
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
    excludeInput,
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
  }), [serverId, filePath, directoryPath, keywordInput, keywordMode, excludeInput, useRegex, preferredBastionId, activeLogView, activeViewerTabId, results, resultTabs, searchStartedAt, fileMeta, sliceOffset, sliceLength, sliceLengthMode, sliceData, lineContextState, resultContextMode, activeHighlightIndex, showFileTools, errorHighlightEnabled, liveFollowEnabled, liveFollowPaused, liveFollowContent]);

  const pipLiveFollowRef = useRef(false);
  const liveFollowEnabledRef = useRef(false);
  const errorHighlightEnabledRef = useRef(false);
  liveFollowEnabledRef.current = liveFollowEnabled;
  errorHighlightEnabledRef.current = errorHighlightEnabled;
  function resolveCurrentLiveFollowEnabled() {
    if (liveFollowEnabled || liveFollowConnected || liveFollowEnabledRef.current) {
      return true;
    }
    const liveButton = document.querySelector<HTMLButtonElement>('button[title*="实时跟随"]');
    return Boolean(liveButton?.classList.contains("btn-live-active") || liveButton?.title.includes("停止"));
  }
  const pip = usePictureInPicture({
    width: 980,
    height: 680,
    onOpen: () => {
      // 仅 Electron 独立小窗（独立进程 / 独立状态树）需要「主窗停止 → 小窗接管」；
      // 浏览器 Document PiP 与主窗共用同一 React 状态树（仅 portal 换 document 渲染），
      // 若在浏览器下停掉，会连带主界面一起变成「未开启」。
      if (isElectron && resolveCurrentLiveFollowEnabled()) {
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
        errorHighlight: errorHighlightEnabledRef.current,
        liveFollow: resolveCurrentLiveFollowEnabled(),
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
    setExcludeInput(snapshot.excludeInput || "");
    setUseRegex(snapshot.useRegex);
    setPreferredBastionId(snapshot.preferredBastionId);
    setResults(snapshot.results);
    setResultTabs(snapshot.resultTabs);
    setSearchStartedAt(snapshot.searchStartedAt);
    setActiveLogView(snapshot.activeLogView);
    setActiveViewerTabId(snapshot.activeViewerTabId);
    setDirectoryPath(snapshot.directoryPath);
    setDirectoryInput(snapshot.directoryPath || "/");
    setStatusContextPath(
      [snapshot.filePath?.trim() || "", snapshot.directoryPath?.trim() || ""].find(isJumpServerStatusContextCandidate) || ""
    );
    setDirectoryNavBackStack([]);
    setDirectoryNavForwardStack([]);
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
    setExcludeInput,
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
    setStatusContextPath,
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
    setTerminalTabs,
    setActiveTerminalTabId,
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
    statusContextPath,
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
    terminalTabs,
    activeTerminalTabId,
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
      if ((window as any).__SLC_HOLD_SPLASH__) {
        /* ?splash 预览模式：保持启动页可见（供设计走查），不影响正常入口 */
      } else {
        /* 最短展示 700ms（大屏/小屏同一策略）：本地服务就绪过快时启动页
           不至于只闪一下；超出部分立即淡出，不人为拖慢启动 */
        const MIN_SPLASH_MS = 700;
        const shownAt = Number((window as any).__SLC_SPLASH_SHOWN_AT__) || 0;
        const remaining = Math.max(0, MIN_SPLASH_MS - (Date.now() - shownAt));
        setTimeout(() => {
          splash.style.opacity = "0";
          setTimeout(() => splash.remove(), 350);
        }, remaining);
      }
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
        terminalSessionShim.stopTerminal();
        setTerminalSessionId("");
        setTerminalTabs([]);
        setActiveTerminalTabId("");
      }
      stopLiveFollow();
      setCredentialStatus(null);
      setCredentialUsername("");
      setCredentialPassword("");
      setCredentialPrivateKey("");
      setServerRouteConfig(null);
      setConnectionTestStatus(null);
      setIsDirectoryLoading(false);
      setPreferredBastionId("");
      setJumpMode("auto");
      setJumpSearchKeyword("");
      setJumpAssetId("");
      setJumpAssetOptions([]);
      jumpAssetAutoSearchKeyRef.current = "";
      setDirectoryPath(defaultDirectoryPath);
      setStatusContextPath("");
      setDirectoryNavBackStack([]);
      setDirectoryNavForwardStack([]);
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
      setIsDirectoryLoading(false);
    }

    if (!isRestoringWorkspace) {
      if (serverIdChanged && !isStandaloneTerminalWindow) {
        terminalSessionShim.stopTerminal();
        setTerminalSessionId("");
        setTerminalTabs([]);
        setActiveTerminalTabId("");
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
        setStatusContextPath("");
        setDirectoryNavBackStack([]);
        setDirectoryNavForwardStack([]);
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

  const currentStatusContext = useMemo((): { path: string; source: ServerStatusContextSource } => {
    const candidates: Array<{ path: string; source: ServerStatusContextSource }> = [
      { path: directoryPath.trim(), source: "directory" },
      { path: filePath.trim(), source: "file" }
    ];
    return candidates.find((candidate) => isJumpServerStatusContextCandidate(candidate.path)) || { path: "", source: "none" };
  }, [directoryPath, filePath]);

  const effectiveServerStatusContext = useMemo((): { path: string; source: ServerStatusContextSource } => {
    if (currentStatusContext.path) {
      return currentStatusContext;
    }
    const savedPath = statusContextPath.trim();
    if (isJumpServerStatusContextCandidate(savedPath)) {
      return { path: savedPath, source: "saved" };
    }
    return { path: "", source: "none" };
  }, [currentStatusContext, statusContextPath]);

  const serverStatusContextLabel = useMemo(() => {
    if (!effectiveServerStatusContext.path) {
      return "";
    }
    const prefix = effectiveServerStatusContext.source === "directory"
      ? "跟随目录"
      : effectiveServerStatusContext.source === "file"
        ? "跟随日志"
        : "沿用资产";
    return `${prefix}: ${getJumpServerStatusContextLabel(effectiveServerStatusContext.path)}`;
  }, [effectiveServerStatusContext]);

  useEffect(() => {
    if (currentStatusContext.path) {
      setStatusContextPath(currentStatusContext.path);
    }
  }, [currentStatusContext]);

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
      excludeInput,
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
      multiFileMode,
      filePattern,
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
      setIsDirectoryLoading,
    },
    refs: {
      jumpToMatchRequestRef,
      sliceRequestRef,
      openFileRequestRef,
      sliceScrollAnchorRef,
      wheelSliceLockRef,
      wheelSliceIntentRef,
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
        window.setTimeout(() => virtualViewerRef.current?.scrollToBottom(), 80);
        window.setTimeout(() => virtualViewerRef.current?.scrollToBottom(), 180);
      }
      wheelSliceLockRef.current = false;
    });
  }, [sliceData]);

  useEffect(() => {
    setActiveHighlightIndex(0);
    setViewerLineCopyRange(null);
  }, [activeViewerTabId, resultTabs, sliceData?.content, results?.rawOutput, keywordInput, useRegex]);

  useEffect(() => {
    lastSearchResultsRef.current = null;
  }, [serverId]);

  useEffect(() => {
    setServerSystemProfile(null);
    setServerSystemProfileError("");
    setServerSystemProfileLoading(false);
  }, [serverId]);

  useEffect(() => {
    serverSystemProfileLoadingRef.current = serverSystemProfileLoading;
  }, [serverSystemProfileLoading]);

  useEffect(() => {
    if (results && (results.matches.length > 0 || results.rawOutput || results.contextOutput)) {
      lastSearchResultsRef.current = results;
    }
  }, [results]);

  useEffect(() => {
    if (activeViewerTabId !== "file") {
      lastResultTabIdRef.current = activeViewerTabId;
    }
  }, [activeViewerTabId]);

  // Search match scrolling is explicit; content refresh should not steal the user's scroll position.

  const {
    fetchServers,
    selectServerById,
    activateWorkspaceSession,
    closeWorkspaceSession,
    startCreateManualServer,
    startEditManualServer,
    editManualServerDraft,
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
    /* 无参调用保持上次视图（未打开过 = localStorage 记录），不再强制回偏好设置 */
    const next = view || settingsWorkspaceView;
    writeLastSettingsView(next);
    setSettingsWorkspaceView(next);
    setShowConnectionSettings(true);
  }

  function changeSettingsWorkspaceView(view: SettingsWorkspaceView) {
    writeLastSettingsView(view);
    setSettingsWorkspaceView(view);
  }

  function closeSettingsWorkspace() {
    setShowConnectionSettings(false);
  }


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
    loadCredentialSecretForServer,
    clearCredentialForServer,
    fetchCredentialStatusById,
    saveCredentialToServer,
    loadCredentialSecretOfServer,
    clearCredentialOfServer,
    testServerCredentialById,
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
    setIsDirectoryLoading,
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

  /* 双轨拆除：单例 useTerminalSession / termSelMenu 已随重设计移入 TerminalWorkspace 的每标签 pane；
     这里只保留 App 级 pane 状态 map（激活标签状态供工具栏 / 独立窗派生）与旧字段镜像。 */
  const terminalPaneStatesRef = useRef<Record<string, TerminalPaneSessionState>>({});
  const handleTerminalPaneSessionState = useCallback((tabId: string, state: TerminalPaneSessionState | null) => {
    const next = { ...terminalPaneStatesRef.current };
    if (state) {
      next[tabId] = state;
    } else {
      delete next[tabId];
    }
    terminalPaneStatesRef.current = next;
    setTerminalPaneStates(next);
  }, []);

  /* 激活标签的 sessionId 镜像进旧 terminalSessionId：openPipWindow / reconcile 弹窗协议仍按单会话 id 传参 */
  useEffect(() => {
    if (isStandaloneTerminalWindow) {
      return;
    }
    const activeTab = terminalTabs.find((tab) => tab.tabId === activeTerminalTabId);
    const sessionId = activeTab?.sessionId.trim() || "";
    if (sessionId && sessionId !== terminalSessionId) {
      setTerminalSessionId(sessionId);
    }
  }, [terminalTabs, activeTerminalTabId, terminalSessionId, isStandaloneTerminalWindow]);

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
    terminalSession: terminalSessionShim,
    pip,
  });

  /* S10：设置中心「打开终端」——目标是清单里选中的服务器：先切换工作区，等 serverId 落地后再拉起终端 */
  const pendingTerminalForServerRef = useRef(false);
  const openTerminalForServer = useCallback((targetServerId: string) => {
    if (!targetServerId || targetServerId === serverId) {
      openTerminalView();
      closeSettingsWorkspace();
      return;
    }
    if (!selectServerById(targetServerId)) {
      return;
    }
    closeSettingsWorkspace();
    pendingTerminalForServerRef.current = true;
  }, [serverId, selectServerById, openTerminalView, closeSettingsWorkspace]);

  useEffect(() => {
    if (pendingTerminalForServerRef.current && serverId) {
      pendingTerminalForServerRef.current = false;
      openTerminalView();
    }
  }, [serverId, openTerminalView]);

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
  // S6 文件树懒加载目标：堡垒机 SFTP 走 bastionId，其余走 serverId（与目录列表主链路保持一致）
  const selectedFileBytes = useMemo(
    () => selectedFileEntries.reduce((sum, entry) => sum + (entry.kind === "file" && typeof entry.size === "number" ? entry.size : 0), 0),
    [selectedFileEntries],
  );
  // S6：传输列非常驻——目录内存在活动上传/下载时才显示该列
  const hasActiveFileTransfers = Boolean(uploadProgress || downloadProgress);
  const treeListingTarget = useMemo(() => {
    if (!serverId) {
      return null;
    }
    const isBastionSftp = selectedServer?.connectionKind === "bastion" && looksLikeJumpServer(selectedServer);
    return isBastionSftp ? { bastionId: serverId } : { serverId };
  }, [serverId, selectedServer]);
  const connectionStateText = buildConnectionSummary(selectedServer, connectionTestStatus);
  /* 终端动作（TerminalPanel 新 props）：弹出组合 / 在文件目录中打开 / 上传通道 */
  const toggleTerminalPopup = useCallback(() => {
    if (terminalDetached) {
      void restoreEmbeddedTerminalWindow();
      return;
    }
    void openDetachedTerminalWindow();
  }, [terminalDetached, restoreEmbeddedTerminalWindow, openDetachedTerminalWindow]);

  const revealTerminalCwdInFiles = useCallback((cwd?: string) => {
    const target = (cwd || terminalWorkingDirectory || "/").trim() || "/";
    closeTerminalOverlay();
    setTerminalPanelOpen(false);
    setActiveLogView("files");
    setDirectoryInput(target);
    setActionStatus(`正在打开目录 ${target}...`);
    void browseLogFiles(target);
  }, [closeTerminalOverlay, terminalWorkingDirectory, browseLogFiles, setActionStatus]);

  const keywordTerms = useMemo(() => resolveSearchTerms(keywordInput, keywordMode), [keywordInput, keywordMode]);
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
  // 阅读位置百分比 = 当前窗口末尾在整份文件中的位置；读到文件尾时恒为 100%
  //（旧行为用窗口起点，最后一页永远停在 90%+，与直觉不符）。
  const viewerPositionPercent = useMemo(() => {
    if (readerPositionDragging) {
      return readerPositionDraft;
    }
    if (!sliceData || !fileMeta?.size || sliceData.filePath !== filePath) {
      return sliceProgress?.start ?? 0;
    }
    if (sliceData.isEnd) {
      return 100;
    }
    return clampPercent((Math.min(sliceData.nextOffset, fileMeta.size) / fileMeta.size) * 100);
  }, [fileMeta, filePath, readerPositionDraft, readerPositionDragging, sliceData, sliceProgress?.start]);
  const atFileTail = Boolean(sliceData?.isEnd);
  const readerPreviewLabel = canDragReaderPosition
    ? `${formatPercent(readerPositionDragging ? readerPositionDraft : viewerPositionPercent)}`
    : readerPositionLabel;
  const readerRailIndicatorTop = Math.max(2, Math.min(100, readerPositionDragging ? readerPositionDraft : viewerPositionPercent));
  // S4: 文件预览的切片定位条渲染条件（原竖向定位条复用此条件，现用于一行式切片条）
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

    // S4: 切片条进度槽为水平方向，按 clientX / rect.width 换算百分比
    function resolvePercent(clientX: number) {
      const track = sliceTrackRef.current;
      if (!track) {
        return null;
      }

      const rect = track.getBoundingClientRect();
      if (!rect.width) {
        return null;
      }

      return ((clientX - rect.left) / rect.width) * 100;
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
      const nextPercent = resolvePercent(event.clientX);
      if (nextPercent === null) {
        return;
      }
      scheduleDraft(nextPercent);
    }

    function handlePointerEnd(event: PointerEvent) {
      const nextPercent = resolvePercent(event.clientX);
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

  // S4: 切片条进度槽按下开始拖拽，与原竖向定位条共用 readerPosition 草稿/提交状态机
  function startSlicebarDrag(event: React.PointerEvent<HTMLDivElement>) {
    if (!canDragReaderPosition || isBusy) {
      return;
    }
    const track = sliceTrackRef.current;
    if (!track) {
      return;
    }
    const rect = track.getBoundingClientRect();
    if (!rect.width) {
      return;
    }
    event.preventDefault();
    setReaderPositionDragging(true);
    setReaderPreviewLoading(false);
    setReaderPositionDraft(clampPercent(((event.clientX - rect.left) / rect.width) * 100));
  }

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
        setExcludeInput(""); setStartDate(""); setEndDate(""); setStartTime(""); setEndTime("");
        setSelectedPreset("常规");
      }
    },
    {
      label: "查 SQL",
      apply: () => {
        setKeywordMode("all");
        setContextLines(2);
        setUseRegex(false);
        setExcludeInput(""); setStartDate(""); setEndDate(""); setStartTime(""); setEndTime("");
        setSelectedPreset("查 SQL");
      }
    },
    {
      label: "查异常",
      apply: () => {
        setKeywordMode("any");
        setContextLines(8);
        setUseRegex(false);
        setExcludeInput(""); setStartDate(""); setEndDate(""); setStartTime(""); setEndTime("");
        setSelectedPreset("查异常");
      }
    },
    {
      label: "大日志快筛",
      apply: () => {
        setKeywordMode("phrase");
        setContextLines(1);
        setUseRegex(false);
        setExcludeInput(""); setStartDate(""); setEndDate(""); setStartTime(""); setEndTime("");
        setSelectedPreset("大日志快筛");
      }
    },
    {
      label: "正则",
      apply: () => {
        setKeywordMode("phrase");
        setContextLines(3);
        setUseRegex(true);
        setExcludeInput(""); setStartDate(""); setEndDate(""); setStartTime(""); setEndTime("");
        setSelectedPreset("正则");
      }
    }
  ];
  const readerJumpPresets = [
    { label: "头", action: () => loadHeadSlice() },
    { label: "25%", action: () => void jumpToSliceRatio(0.25) },
    { label: "50%", action: () => void jumpToSliceRatio(0.5) },
    { label: "75%", action: () => void jumpToSliceRatio(0.75) },
    { label: "尾", action: () => loadTailSlice({ forceRefresh: true }) }
  ];

  const canOpenTerminal = Boolean(selectedServer);
  const isFileMode = activeLogView === "files";
  const effectiveResults = results ?? lastSearchResultsRef.current;
  const hasSearchResults = Boolean(
    resultTabs.length > 0 ||
    effectiveResults?.matches?.length ||
    effectiveResults?.rawOutput ||
    effectiveResults?.contextOutput
  );
  const searchResultsTabId = useMemo(() => {
    if (lastResultTabIdRef.current && resultTabs.some((tab) => tab.id === lastResultTabIdRef.current)) {
      return lastResultTabIdRef.current;
    }
    return resultTabs[resultTabs.length - 1]?.id ?? "";
  }, [resultTabs]);
  const showingLogPreview = activeLogView === "search";
  const showingFileDirectory = activeLogView === "files";
  // S5: 终端 = 工作区内容区视图（嵌入态占满内容区；独立窗口不占用；分屏已收进标签内布局）
  const terminalAsWorkspaceView = terminalPanelOpen && !terminalDetached;
  const viewerTabs = useMemo(() => {
    const items: Array<{ id: string; label: string; kind: "file" | "result" }> = filePath
      ? [{ id: "file", label: selectedFileName || "当前文件", kind: "file" as const }]
      : [];

    return items.concat(resultTabs.map((tab) => ({ id: tab.id, label: tab.label, kind: "result" as const })));
  }, [filePath, resultTabs, selectedFileName]);
  const showingPrimaryResults = activeViewerTabId === "results-root";
  const activeViewerCommandPreview = activeResultTab?.commandPreview || ((activeViewerTabId === "file" || showingPrimaryResults) ? effectiveResults?.commandPreview : "");
  const activeViewerStrategyLabel = activeResultTab?.strategyLabel || ((activeViewerTabId === "file" || showingPrimaryResults) ? effectiveResults?.strategyLabel : "");
  const activeViewerMatchCount = activeResultTab?.matchCount ?? ((activeViewerTabId === "file" || showingPrimaryResults) ? effectiveResults?.matches.length ?? 0 : 0);
  const hasSearchContent = Boolean(activeResultTab?.content || liveFollowContent || sliceData?.content || effectiveResults?.rawOutput);
  const viewerStripLabel = activeViewerTabId === "file"
    ? `文件预览${selectedFileName ? ` · ${selectedFileName}` : ""}`
    : activeResultTab
      ? `${activeResultTab.label} · ${activeResultTab.sourceLabel}`
      : "日志预览";
  const canSwitchToDocumentContent = Boolean(serverId);

  function switchToLogPreviewView() {
    console.info("[toolbar-view-switch] click search", {
      serverId,
      hasSearchResults,
      activeLogView,
      activeViewerTabId,
      searchResultsTabId,
      resultTabs: resultTabs.length,
    });
    if (!serverId) return;
    if (activeLogView === "search" && !terminalAsWorkspaceView) {
      setActionStatus("已在日志预览。");
      return;
    }
    if (terminalPanelOpen && !terminalDetached) {
      // 终端正占用内容区：先收回终端（保持会话），再回日志视图
      closeTerminalOverlay();
      setTerminalPanelOpen(false);
    }
    setActionStatus("正在切换到日志预览...");
    setActiveLogView("search");
    if (filePath.trim()) {
      setActiveViewerTabId("file");
    } else if (!activeViewerTabId) {
      setActiveViewerTabId(searchResultsTabId || "results-root");
    }
  }

  function switchToFileDirectoryView() {
    console.info("[toolbar-view-switch] click files", {
      serverId,
      activeLogView,
      activeViewerTabId,
      directoryPath,
      fileEntries: fileEntries.length,
    });
    if (!serverId) return;
    if (activeLogView === "files" && !terminalAsWorkspaceView) {
      setActionStatus("已在文件目录。");
      return;
    }
    if (terminalPanelOpen && !terminalDetached) {
      closeTerminalOverlay();
      setTerminalPanelOpen(false);
    }
    setActionStatus("正在切换到文件目录...");
    setActiveLogView("files");
    if (!fileEntries.length && directoryPath.trim()) {
      void browseLogFiles(directoryPath);
    }
  }

  function normalizeDirectoryNavPath(path: string) {
    const trimmed = (path || "/").trim();
    if (!trimmed || trimmed === "/") return "/";
    const absolute = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
    return absolute.replace(/\/+$/, "") || "/";
  }

  /** S12 空态主按钮「查看检索示例」：回到检索视图并聚焦关键字框。 */
  function handleViewerEmptyPrimary() {
    setActiveLogView("search");
    setShowKeywordBar(true);
    window.setTimeout(() => keywordInputRef.current?.focus(), 0);
  }

  async function browseDirectoryWithNav(path: string, options?: { replace?: boolean; silent?: boolean }) {
    const fromPath = normalizeDirectoryNavPath(directoryPath || "/");
    const openedPath = await browseLogFiles(path, { manual: true, silent: options?.silent });
    if (!openedPath) return;
    const normalizedOpenedPath = normalizeDirectoryNavPath(openedPath);
    if (options?.replace || normalizedOpenedPath === fromPath) return;
    setDirectoryNavBackStack((stack) => {
      const last = stack[stack.length - 1];
      return last === fromPath ? stack : [...stack, fromPath].slice(-80);
    });
    setDirectoryNavForwardStack([]);
  }

  async function navigateDirectoryHistory(direction: "back" | "forward") {
    if (!serverId || isBusy || isDirectoryLoading) return;
    const currentPath = normalizeDirectoryNavPath(directoryPath || "/");
    const sourceStack = direction === "back" ? directoryNavBackStack : directoryNavForwardStack;
    const targetPath = sourceStack[sourceStack.length - 1];
    if (!targetPath) return;
    const openedPath = await browseLogFiles(targetPath, { manual: true, silent: true });
    if (!openedPath) return;
    const normalizedOpenedPath = normalizeDirectoryNavPath(openedPath);
    if (direction === "back") {
      setDirectoryNavBackStack((stack) => stack.slice(0, -1));
      setDirectoryNavForwardStack((stack) => {
        const last = stack[stack.length - 1];
        return last === currentPath ? stack : [...stack, currentPath].slice(-80);
      });
      setActionStatus(`已返回目录：${normalizedOpenedPath}`);
      return;
    }
    setDirectoryNavForwardStack((stack) => stack.slice(0, -1));
    setDirectoryNavBackStack((stack) => {
      const last = stack[stack.length - 1];
      return last === currentPath ? stack : [...stack, currentPath].slice(-80);
    });
    setActionStatus(`已前进目录：${normalizedOpenedPath}`);
  }

  /* 鼠标前进/后退（XButton1/2）按目录历史导航。核心提成回调供两处复用：
     ① 网格 onMouseDown/auxClick（原有入口）；② document 捕获级监听（下方 effect）——
     文件行加了 draggable 后，行内拖拽机制会吞掉非主键 mousedown 的默认处理链，
     捕获级监听在任何目标处理之前触发，保证前进/后退始终可用。 */
  const navigateByMouseButton = useCallback((button: number) => {
    const now = Date.now();
    const previous = directoryMouseNavRef.current;
    if (previous?.button === button && now - previous.at < 180) return;
    directoryMouseNavRef.current = { button, at: now };
    void navigateDirectoryHistory(button === 3 ? "back" : "forward");
  }, [directoryNavBackStack, directoryNavForwardStack, directoryPath, serverId, isBusy, isDirectoryLoading, browseLogFiles]);

  useEffect(() => {
    if (!isFileMode) return;
    const handleMouseDown = (event: MouseEvent) => {
      if (event.button !== 3 && event.button !== 4) return;
      const target = event.target as HTMLElement | null;
      /* 浮层上（右键菜单/下拉/对话框/设置）不劫持 */
      if (target?.closest(".context-menu, .fb-more-menu, .path-history-dropdown, .preview-dialog, .settings-workspace, .command-palette")) return;
      event.preventDefault();
      navigateByMouseButton(event.button);
    };
    /* 浏览器（和 Electron webContents）的 back/forward 默认动作在 mouseup 触发：
       仅拦 mousedown 不够，会把页面打回上一条历史导致整页刷新（用户反馈 2026-09-30），
       mouseup / auxclick 也必须一并取消默认行为 */
    const swallowNavButton = (event: MouseEvent) => {
      if (event.button !== 3 && event.button !== 4) return;
      event.preventDefault();
      event.stopPropagation();
    };
    window.addEventListener("mousedown", handleMouseDown, true);
    window.addEventListener("mouseup", swallowNavButton, true);
    window.addEventListener("auxclick", swallowNavButton, true);
    return () => {
      window.removeEventListener("mousedown", handleMouseDown, true);
      window.removeEventListener("mouseup", swallowNavButton, true);
      window.removeEventListener("auxclick", swallowNavButton, true);
    };
  }, [isFileMode, navigateByMouseButton]);

  function handleFileBrowserMouseNavigation(event: ReactMouseEvent<HTMLDivElement>) {
    if (event.button !== 3 && event.button !== 4) return;
    event.preventDefault();
    event.stopPropagation();
    navigateByMouseButton(event.button);
  }

  function selectViewerTab(tab: { id: string; label: string; kind: "file" | "result" }) {
    console.info("[viewer-tab] click", {
      id: tab.id,
      label: tab.label,
      kind: tab.kind,
      activeLogView,
      activeViewerTabId,
    });
    setActiveLogView("search");
    setActiveViewerTabId(tab.id);
    setActionStatus(tab.kind === "file" ? `已切换到日志预览：${tab.label}` : `已切换到日志结果：${tab.label}`);
  }

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
  /* S12-3：横幅粗体标题对齐原型 1032 行「连接失败 · 认证被拒绝」。
     service 返回的 message 若含认证失败特征则补「认证被拒绝」，否则用通用「连接失败」。 */
  const connectionErrorReason = (() => {
    const raw = connectionTestStatus?.message || "";
    if (/permission denied|publickey|password|auth|认证|拒绝|denied/i.test(raw)) return "认证被拒绝";
    return "";
  })();
  /* S14-4：水印 {时间} 占位符——分钟级，避免每帧变化 */
  const watermarkTimeLabel = (() => {
    const date = new Date();
    const pad = (value: number) => String(value).padStart(2, "0");
    return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
  })();
  const isConnectingWorkspace =
    isFileMode && !hasDirectoryConnectionError && (!selectedServer || (!connectionTestStatus?.connected && !fileEntries.length));
  const hasFileWorkspaceEntries = fileEntries.length > 0;
  const isDirectoryContentLoading =
    isFileMode
    && isDirectoryLoading;
  const showServiceOfflineState = localServiceState === "offline";
  const showNoServerState = localServiceState === "online" && !servers.length && !isBusy;
  // 空态兜底：文件已选中但内容尚未加载（sliceData 为空 / HMR 状态残留 / live ws 断开）时，
  // 不再渲染空 console 黑洞，显示空态提示。
  const showViewerEmptyState = activeLogView === "search" && !hasSearchContent && !resultTabs.length && !fileLoadingName
    && (!filePath.trim() || !currentLogContent);
  const showCompactViewerChrome = pip.isPip || isStandaloneViewerWindow;
  // 浏览器 Document PiP：窗口框/关闭/返回由 Chrome 提供，自带按钮会重复 → 需隐藏
  const isBrowserDocumentPip = pip.isPip && Boolean(pip.pipWindow);

  useEffect(() => {
    if (!showCompactViewerChrome && showViewerDebugPanel) {
      setShowViewerDebugPanel(false);
    }
  }, [showCompactViewerChrome, showViewerDebugPanel]);

  useEffect(() => {
    if (pip.isPip) {
      pip.setTitle(selectedFileName || activeResultTab?.label || "日志预览");
    }
  }, [pip.isPip, selectedFileName, activeResultTab?.label]);

  // PiP state sync: send errorHighlight/liveFollow changes to the other window
  useEffect(() => {
    const api = (window as any).electronAPI;
    if (!api?.sendPipState) return;
    const transferredLiveFollow = pip.isPip && pipLiveFollowRef.current;
    api.sendPipState({ errorHighlight: errorHighlightEnabled, liveFollow: transferredLiveFollow ? true : liveFollowEnabled });
  }, [errorHighlightEnabled, liveFollowEnabled, pip.isPip]);

  // PiP state sync: push initial state when PiP opens
  useEffect(() => {
    const api = (window as any).electronAPI;
    if (!api?.sendPipState || !pip.isPip) return;
    const transferredLiveFollow = pipLiveFollowRef.current;
    api.sendPipState({ errorHighlight: errorHighlightEnabled, liveFollow: transferredLiveFollow ? true : liveFollowEnabled });
  }, [pip.isPip, errorHighlightEnabled, liveFollowEnabled]);

  // PiP state sync: listen for state updates from the other window
  useEffect(() => {
    const api = (window as any).electronAPI;
    if (!api?.onPipStateUpdate) return;
    const unsubscribe = api.onPipStateUpdate((state: { errorHighlight?: boolean; liveFollow?: boolean }) => {
      if (state.errorHighlight !== undefined) setErrorHighlightEnabled(state.errorHighlight);
      if (state.liveFollow !== undefined && state.liveFollow !== liveFollowEnabled) {
        if (pip.isPip && pipLiveFollowRef.current) {
          if (!state.liveFollow) {
            pipLiveFollowRef.current = false;
          }
          return;
        }
        if (state.liveFollow && filePath) startLiveFollow(filePath, selectedFileName);
        else if (!state.liveFollow) stopLiveFollow({ keepContent: true });
      }
    });
    return () => { if (typeof unsubscribe === "function") unsubscribe(); };
  }, [filePath, selectedFileName, liveFollowEnabled, pip.isPip]);

  useEffect(() => {
    if (terminalPanelOpen && !canOpenTerminal && !isStandaloneTerminalWindow) {
      closeTerminalOverlay();
      setTerminalPanelOpen(false);
    }
  }, [terminalPanelOpen, canOpenTerminal, isStandaloneTerminalWindow]);

  const canToggleErrorHighlight = Boolean(currentLogContent);
  const canOpenComparePanel = Boolean(isElectron && activeLogView === "search" && currentLogContent.trim());
  const activeCompareLabel = activeResultTab?.label || selectedFileName || "当前内容";
  const availableUtilityPanels = useMemo(() => {
    const panels: UtilityPanelType[] = [];
    if (serverId) {
      panels.push("tunnels");
    }
    if (servers.length > 0) {
      panels.push("batch");
    }
    if (serverId) {
      panels.push("status");
    }
    if (canOpenComparePanel) {
      panels.push("compare");
    }
    return panels;
  }, [canOpenComparePanel, serverId, servers.length]);
  const canShowEmbeddedUtilityWorkspace = availableUtilityPanels.length > 0 && !showCompactViewerChrome;
  const canToggleResultContext = Boolean(activeViewerTabId !== "file" && activeResultTab?.fullContent && activeResultTab.strategyLabel !== "本地文件");

  useEffect(() => {
    if (availableUtilityPanels.length === 0) {
      setShowUtilityWorkspace(false);
      return;
    }
    if (availableUtilityPanels.includes(activeUtilityPanel)) {
      return;
    }
    setActiveUtilityPanel(availableUtilityPanels[0]);
  }, [activeUtilityPanel, availableUtilityPanels]);

  const refreshServerSystemProfile = useCallback(async () => {
    if (!serverId) {
      setServerSystemProfile(null);
      setServerSystemProfileError("请先选择服务器。");
      return;
    }
    const requestId = ++serverSystemProfileRequestRef.current;
    setServerSystemProfileLoading(true);
    setServerSystemProfileError("");
    try {
      const profile = await apiGetServerSystemProfile(serverId, 30000, effectiveServerStatusContext.path || undefined);
      if (serverSystemProfileRequestRef.current !== requestId) {
        return;
      }
      setServerSystemProfile(profile);
    } catch (error) {
      if (serverSystemProfileRequestRef.current !== requestId) {
        return;
      }
      setServerSystemProfileError(error instanceof Error ? error.message : "读取服务器状态失败");
    } finally {
      if (serverSystemProfileRequestRef.current === requestId) {
        setServerSystemProfileLoading(false);
      }
    }
  }, [effectiveServerStatusContext.path, serverId]);

  const openServerStatusPanel = useCallback(() => {
    if (!serverId) {
      setActionStatus("请先选择服务器。");
      return;
    }
    setActiveUtilityPanel("status");
    setShowUtilityWorkspace(true);
    setActionStatus("正在打开服务器状态...");
    if (!serverSystemProfile || serverSystemProfile.serverId !== serverId) {
      void refreshServerSystemProfile();
    }
  }, [refreshServerSystemProfile, serverId, serverSystemProfile, setActionStatus]);

  /* 终端状态栏资源迷你条（T1/批5）：终端视图激活期间按既有全局间隔轮询 system-profile。
     CPU = loadAverage[0]/核数（与 ServerStatusPanel 同口径）；磁盘取使用率最高的挂载点。 */
  const [terminalResources, setTerminalResources] = useState<{ cpu: number; mem: number; disk: number; diskPath?: string } | null>(null);
  useEffect(() => {
    const terminalViewActive = isStandaloneTerminalWindow || (terminalPanelOpen && !terminalDetached);
    if (!terminalViewActive || !serverId) {
      setTerminalResources(null);
      return;
    }
    let cancelled = false;
    const fetchProfile = async () => {
      try {
        const profile = await apiGetServerSystemProfile(serverId, 15000, effectiveServerStatusContext.path || undefined);
        if (cancelled) {
          return;
        }
        const memoryPercent = profile.memory?.percent ?? 0;
        const disks = profile.disks ?? [];
        const topDisk = disks.reduce<(typeof disks)[number] | null>((best, disk) => (!best || disk.percent > best.percent ? disk : best), null);
        const cpuPercent = profile.cpu?.cores ? (profile.loadAverage[0] / profile.cpu.cores) * 100 : 0;
        setTerminalResources({
          cpu: clampPercent(cpuPercent),
          mem: clampPercent(memoryPercent),
          disk: clampPercent(topDisk?.percent ?? 0),
          diskPath: topDisk?.mount,
        });
      } catch {
        /* 资源条获取失败静默：不打扰终端使用 */
      }
    };
    void fetchProfile();
    const timer = window.setInterval(() => {
      void fetchProfile();
    }, SERVER_STATUS_REFRESH_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [isStandaloneTerminalWindow, terminalPanelOpen, terminalDetached, serverId, effectiveServerStatusContext.path]);

  useEffect(() => {
    if (!showUtilityWorkspace || activeUtilityPanel !== "status" || !serverId) {
      return;
    }
    if (serverSystemProfileLoading || serverSystemProfileError) {
      return;
    }
    if (!serverSystemProfile || serverSystemProfile.serverId !== serverId) {
      void refreshServerSystemProfile();
    }
  }, [
    activeUtilityPanel,
    refreshServerSystemProfile,
    serverId,
    serverSystemProfile,
    serverSystemProfileError,
    serverSystemProfileLoading,
    showUtilityWorkspace
  ]);

  useEffect(() => {
    if (!showUtilityWorkspace || activeUtilityPanel !== "status" || !serverId || !serverSystemProfileAutoRefresh) {
      return;
    }
    const timer = window.setInterval(() => {
      if (serverSystemProfileLoadingRef.current) {
        return;
      }
      void refreshServerSystemProfile();
    }, SERVER_STATUS_REFRESH_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [activeUtilityPanel, refreshServerSystemProfile, serverId, serverSystemProfileAutoRefresh, showUtilityWorkspace]);

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
  // S4: 文件预览的竖向定位条已由一行式切片条取代，rail 占位只剩结果总览
  const showViewerRail = !showCompactViewerChrome && showSearchResultsOverviewRail;
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
  /* S12 空态文案对齐原型 1037 行：检索「还没有检索结果」+「输入关键字回车，或用 /关键字 语法」+「查看检索示例」。 */
  const viewerEmptyTitle = "还没有检索结果";
  const viewerEmptyHint = liveFollowEnabled && filePath.trim()
    ? "实时跟随已开启，等待新日志写入…"
    : !filePath
      ? "输入关键字回车，或用 /关键字 语法"
      : "输入关键字后回车搜索，或在右下角使用回到底部。";
  const searchElapsedLabel = searchStartedAt ? formatDurationLabel(searchStartedAt, searchNow) : "";
  const isSearchView = activeLogView === "search";
  const activeSearchResultCount = activeViewerTabId === "file" ? (results?.matches.length ?? 0) : activeViewerMatchCount;
  const activeHighlightSummary = highlightCount ? `${Math.min(activeHighlightIndex + 1, highlightCount)} / ${highlightCount}` : "";
  const toolbarSummaryLabel = activeViewerTabId === "file"
    ? (activeHighlightSummary ? `${activeHighlightSummary} 当前片段命中` : (selectedFileName || "--"))
    : (activeHighlightSummary ? `${activeHighlightSummary} 命中` : (activeSearchResultCount ? `${formatNumber(activeSearchResultCount)} 条命中` : ""));
  const searchDoneSummary = (() => {
    const task = searchTask;
    if (!task || searchStartedAt) return "";
    const parts: string[] = [];
    if (typeof task.elapsedMs === "number" && task.elapsedMs > 0) parts.push(`${(task.elapsedMs / 1000).toFixed(1)} 秒`);
    if (typeof task.phaseScannedBytes === "number" && task.phaseScannedBytes > 0) parts.push(`扫描 ${formatBytes(task.phaseScannedBytes)}`);
    if (task.strategyLabel) parts.push(task.strategyLabel);
    return parts.join(" · ");
  })();
  const toolbarMetaLabel = searchStartedAt
    ? `检索中${searchElapsedLabel ? ` · ${searchElapsedLabel}` : ""}`
    : activeViewerTabId === "file"
      ? (activeSearchResultCount ? `搜索结果 ${formatNumber(activeSearchResultCount)} 条` : (liveFollowEnabled ? (liveFollowConnected ? "实时中" : "实时连接中") : ""))
      : `共 ${formatNumber(activeSearchResultCount)} 条结果${searchDoneSummary ? ` · ${searchDoneSummary}` : ""}`;
  const showSearchSummary = !showQueryAdvanced && isSearchView && Boolean(highlightCount || activeSearchResultCount || liveFollowEnabled || searchStartedAt);
  const canRecordLog = Boolean(serverId && filePath.trim() && isSearchView);
  const canToggleRecording = recordingSession ? Boolean(serverId) : canRecordLog;
  const compactViewerTitle = selectedFileName || activeResultTab?.label || "日志预览";
  const canToolbarLive = Boolean(serverId && filePath.trim() && activeLogView === "search");
  const toggleToolbarLive = useCallback(() => {
    if (liveFollowEnabled) {
      stopLiveFollow();
      return;
    }
    if (filePath.trim()) {
      // 开启时带上 rtools 过滤框中的关键字（与原型「过滤框 + LIVE」同一语义）
      startLiveFollow(filePath, selectedFileName || filePath, { keyword: liveFilterInput.trim() || undefined });
    }
  }, [liveFollowEnabled, filePath, selectedFileName, liveFilterInput, startLiveFollow, stopLiveFollow]);
  // S4 实时状态带（原型 536-546）：过滤框变更时以关键字重启实时跟随（网关 buildTailCommand 支持 keyword）
  const applyLiveFilter = useCallback((nextKeyword: string) => {
    setLiveFilterInput(nextKeyword);
    if (liveFollowEnabled && filePath.trim()) {
      startLiveFollow(filePath, selectedFileName || filePath, { isReconnect: true, keyword: nextKeyword.trim() || undefined });
    }
  }, [liveFollowEnabled, filePath, selectedFileName, startLiveFollow]);
  const toggleLivePause = useCallback(() => setLiveFollowPaused((current) => !current), [setLiveFollowPaused]);
  const toggleTerminalPanelToolbar = useCallback(() => {
    if (terminalPanelOpen || terminalDetached) {
      setTerminalPanelOpen(false);
      setTerminalDetached(false);
      closeTerminalOverlay();
      return;
    }
    openTerminalView();
  }, [terminalPanelOpen, terminalDetached, openTerminalView]);
  const paletteCommands = useMemo(() => {
    const close = () => setPaletteOpen(false);
    return [
      ...servers.map((server) => ({
        id: `srv-${server.id}`,
        group: "服务器",
        icon: "folder" as const,
        title: server.name,
        sub: `${server.username}@${server.host}:${server.port}`,
        hint: "⏎ 连接",
        run: () => { selectServerById(server.id); close(); },
      })),
      { id: "cmd-settings", group: "命令", icon: "gear" as const, title: "打开设置中心", hint: "⌘,", run: () => { openSettingsWorkspace("connections"); close(); } },
      { id: "cmd-pref", group: "命令", icon: "gear" as const, title: "偏好设置", run: () => { openSettingsWorkspace("preferences"); close(); } },
      { id: "cmd-transfer", group: "命令", icon: "file" as const, title: "传输记录", run: () => { setShowTransferHistory(true); close(); } },
      { id: "cmd-tools", group: "命令", icon: "plug" as const, title: "工具抽屉（隧道 / 批量 / 监控 / 对比）", run: () => { openServerStatusPanel(); close(); } },
      { id: "cmd-terminal", group: "命令", icon: "term" as const, title: "打开终端", run: () => { openTerminalView(); close(); } },
      { id: "cmd-live", group: "命令", icon: "zap" as const, title: liveFollowEnabled ? "断开实时追踪" : "开启实时追踪", hint: filePath ? undefined : "先选择日志文件", run: () => { toggleToolbarLive(); close(); } },
    ];
  }, [servers, selectServerById, openSettingsWorkspace, openServerStatusPanel, openTerminalView, liveFollowEnabled, filePath, toggleToolbarLive]);

  useEffect(() => {
    const onPaletteKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onPaletteKey);
    return () => window.removeEventListener("keydown", onPaletteKey);
  }, []);
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
    void loadTailSlice({ forceRefresh: true }).finally(() => {
      startLiveFollow(target.filePath, target.fileName, { isReconnect: true });
    });
  };

  viewerWheelHandlerRef.current = handleViewerWheel;
  viewerNearBottomHandlerRef.current = handleViewerNearBottomChange;
  viewerLineClickHandlerRef.current = viewerLineClickEnabled
    ? (lineIndex: number, _event: ReactMouseEvent<HTMLDivElement>) => {
      const match = resolveViewerJumpTarget(lineIndex);
      const sourceTab = activeResultTab || (showingPrimaryResults ? {
        id: "results-root",
        label: "当前结果",
        sourceLabel: selectedFileName || filePath || "日志结果"
      } : null);
      if (match) {
        void jumpToSearchMatch(match, sourceTab ? {
          tabId: sourceTab.id,
          tabLabel: sourceTab.label,
          sourceLabel: sourceTab.sourceLabel,
          resultLineIndex: lineIndex,
          lineNumber: match.lineNumber,
          preview: match.preview || ""
        } : undefined);
      }
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
    if (!(event.metaKey || event.ctrlKey)) {
      return;
    }
    viewerLineClickHandlerRef.current?.(lineIndex, event);
  }, []);

  const handleViewerFileLineClick = useCallback((lineIndex: number, event: ReactMouseEvent<HTMLDivElement>) => {
    if (event.metaKey || event.ctrlKey) {
      event.preventDefault();
      setViewerSelMenu(null);
      setViewerLineCopyRange(null);
      const block = virtualViewerRef.current?.getLogBlockText(lineIndex);
      const text = block?.text || virtualViewerRef.current?.getLineRangeText(lineIndex, lineIndex) || "";
      if (!text.trim()) {
        return;
      }
      void copyText(text).then(() => {
        const lineCount = block ? block.end - block.start + 1 : 1;
        setActionStatus(`已复制当前日志块：${formatNumber(lineCount)} 行。`);
        showToast("success", `已复制 ${formatNumber(lineCount)} 行日志`);
      }).catch((error) => {
        const detail = error instanceof Error ? error.message : "未知错误";
        setActionStatus(`复制失败：${detail}`);
        showToast("error", `复制失败：${detail}`);
      });
      return;
    }
    if (!event.shiftKey) {
      return;
    }
    event.preventDefault();
    setViewerSelMenu(null);
    setViewerLineCopyRange((current) => {
      if (!current || current.start !== current.end) {
        setActionStatus(`已选择复制起点：第 ${formatNumber(lineIndex + 1)} 行。`);
        return { start: lineIndex, end: lineIndex };
      }
      const next = { start: Math.min(current.start, lineIndex), end: Math.max(current.start, lineIndex) };
      setActionStatus(`已选择复制范围：第 ${formatNumber(next.start + 1)} - ${formatNumber(next.end + 1)} 行。`);
      return next;
    });
  }, [setActionStatus, showToast]);

  const handleCopyViewerLineRange = useCallback(async () => {
    if (!viewerLineCopyRange) return;
    const text = virtualViewerRef.current?.getLineRangeText(viewerLineCopyRange.start, viewerLineCopyRange.end) || "";
    if (!text) return;
    try {
      await copyText(text);
      const count = Math.abs(viewerLineCopyRange.end - viewerLineCopyRange.start) + 1;
      setActionStatus(`已复制 ${formatNumber(count)} 行日志。`);
      showToast("success", `已复制 ${formatNumber(count)} 行日志`);
      setViewerLineCopyRange(null);
    } catch (error) {
      const detail = error instanceof Error ? error.message : "未知错误";
      setActionStatus(`复制失败：${detail}`);
      showToast("error", `复制失败：${detail}`);
    }
  }, [showToast, viewerLineCopyRange]);

  const handleViewerLineRangeChange = useCallback((range: { start: number; end: number }) => {
    setViewerSelMenu(null);
    const normalized = {
      start: Math.min(range.start, range.end),
      end: Math.max(range.start, range.end),
    };
    setViewerLineCopyRange(normalized);
    setActionStatus(`已选择复制范围：第 ${formatNumber(normalized.start + 1)} - ${formatNumber(normalized.end + 1)} 行。`);
  }, [setActionStatus]);

  const returnToJumpSource = useCallback(() => {
    const source = lineContextState?.jumpSource;
    if (!source) return;
    setActiveLogView("search");
    setActiveViewerTabId(source.tabId);
    setActionStatus(`已返回${source.tabLabel}，原命中第 ${formatNumber(source.lineNumber)} 行。`);
    const scrollBack = () => virtualViewerRef.current?.scrollToLine(source.resultLineIndex, "auto");
    requestAnimationFrame(() => {
      scrollBack();
      window.setTimeout(scrollBack, 60);
      window.setTimeout(scrollBack, 160);
    });
  }, [lineContextState?.jumpSource]);

  const handleBookmarkToggle = useCallback((lineIndex: number) => {
    setResultTabs((current) => {
      const targetId = activeViewerTabId;
      return current.map((tab) => {
        if (tab.id !== targetId) return tab;
        const next = { ...tab, bookmarks: { ...tab.bookmarks } };
        if (next.bookmarks && lineIndex in next.bookmarks) {
          delete next.bookmarks[lineIndex];
        } else {
          next.bookmarks = next.bookmarks || {};
          next.bookmarks[lineIndex] = "";
        }
        return next;
      });
    });
  }, [activeViewerTabId]);


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
    uploadFileList,
    uploadDirectory,
    handleFileDrop,
    uploadPaused,
    pauseUpload,
    resumeUpload,
    cancelUpload,
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
    /* 上传开始即打开传输记录抽屉（用户反馈 2026-09-30：进度看抽屉，不弹气泡） */
    onUploadStarted: () => {
      setShowPathHistory(false);
      setShowTransferHistory(true);
    },
  });

  /* 终端工具行「上传」：容器选好文件（可多选）后走统一上传通道，目标 = 应用层联动目录
     （不承诺 shell 实时 cwd，见方案 §5 差异取舍） */
  const handleTerminalUploadFiles = useCallback((files: FileList) => {
    if (!serverId) {
      return;
    }
    void uploadFileList(Array.from(files));
  }, [serverId, uploadFileList]);

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
    previewArchiveEntry,
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

  const openFileBrowserEntry = (entry: LogFileEntry) => {
    if (entry.kind === "directory") {
      void browseDirectoryWithNav(entry.path);
      return;
    }
    if (isSpecialPreviewFile(entry.name || entry.path)) {
      void previewFile(entry);
      return;
    }
    void openEntry(entry);
  };

  /* 批量条提示 ③：拖拽移动 —— 文件行拖到目录树节点上完成移动。
     moveRemoteEntries 只用 path/name（rename API），从路径重建 entry 即可；
     防呆：目标目录是自身或其子目录时跳过（否则服务端报嵌套错误）。 */
  const handleTreeDropMove = useCallback((paths: string[], targetDir: string) => {
    if (!serverId || !paths.length) return;
    const normalizedTarget = targetDir.replace(/\/+$/, "") || "/";
    /* 防呆修正（2026-09-30 用户实测：logs/0 下的文件拖到 logs 树节点无效果）：
       只拦「目标在被拖项内部」（targetDir === path 或在其下）——
       仅当被拖项是目录时才可能发生递归；文件从子目录向上级目录移动是合法场景，
       旧过滤器用 path.startsWith(targetDir) 把向上移动全部误拦且静默无提示。 */
    const movable = paths
      .filter((path) => normalizedTarget !== path && !normalizedTarget.startsWith(`${path}/`))
      .map((path) => ({ path, name: path.split("/").filter(Boolean).pop() || path, kind: "file" as const }));
    if (!movable.length) {
      setActionStatus("目标位置无效：不能把目录移入它自己或它的子目录。");
      return;
    }
    void moveRemoteEntries(movable, normalizedTarget);
  }, [serverId, moveRemoteEntries, setActionStatus]);

  /* 空白处右键菜单（用户反馈 2026-09-30）：文件列表/目录树空白右键弹出目录级操作
     （返回上级/刷新/新建目录/上传），行内右键已在行上 stopPropagation 不受影响 */
  const openBlankContextMenu = useCallback((event: ReactMouseEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const x = Math.max(4, Math.min(event.clientX, window.innerWidth - 210));
    const y = Math.max(4, Math.min(event.clientY, window.innerHeight - 260));
    setBlankContextMenu({ x, y });
  }, []);

  useEffect(() => {
    if (!blankContextMenu) return;
    const handlePointerDown = (event: PointerEvent) => {
      const menuElement = blankContextMenuRef.current;
      if (!menuElement) return;
      const target = event.target;
      if (target instanceof Node && menuElement.contains(target)) return;
      setBlankContextMenu(null);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setBlankContextMenu(null);
    };
    window.addEventListener("pointerdown", handlePointerDown, true);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown, true);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [blankContextMenu]);

  /* 最近访问目录下拉：点击外部 / Esc 关闭（用户反馈 2026-09-30：打开后无法关闭） */
  useEffect(() => {
    if (!showPathHistory) return;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest(".path-history-dropdown")) return;
      setShowPathHistory(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setShowPathHistory(false);
    };
    window.addEventListener("pointerdown", handlePointerDown, true);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown, true);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [showPathHistory]);

  /* 批量条提示 ①：Esc 清空 —— 有勾选时按 Esc 清空选择。
     文本输入控件内让位（正在输入）；checkbox 聚焦（刚点完勾选）时先还焦点再清空，
     否则用户得先点一下空白处 Esc 才生效；对话框、浮层打开时让位。 */
  useEffect(() => {
    if (!selectedFilePaths.length) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      const target = event.target as HTMLElement | null;
      if (target) {
        const isTextEntry =
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable ||
          (target.tagName === "INPUT" &&
            (target as HTMLInputElement).type !== "checkbox" &&
            (target as HTMLInputElement).type !== "radio");
        if (isTextEntry) return;
        if (target.tagName === "INPUT") target.blur();
      }
      if (confirmDialog || renameDialog || moveDialog || batchMoveDialog || mkdirDialog || previewDialog || contextMenu || workspaceTabMenu || blankContextMenu || showViewerDebugPanel || paletteOpen || showConnectionSettings) {
        return;
      }
      clearSelectedFiles();
      setActionStatus("已清空文件选择。");
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedFilePaths.length, clearSelectedFiles, confirmDialog, renameDialog, moveDialog, batchMoveDialog, mkdirDialog, previewDialog, contextMenu, workspaceTabMenu, blankContextMenu, showViewerDebugPanel, paletteOpen, showConnectionSettings, setActionStatus]);

  const appShellClassName = `app-shell${uiTheme === "modern" ? " theme-modern" : ""} ui-density-${uiDensity} ui-theme-${resolvedTheme.id} ui-bg-${uiBackground}${uiBackground !== "solid" ? " ui-bg-fancy" : ""} ui-motion-${motionMode}${dynamicBackground && motionMode !== "reduced" ? " ui-dynamic-background" : ""}${isElectron ? " electron-immersive" : ""}${isElectron && isMacOS ? " electron-macos-immersive" : ""}`;
  const appShellStyle = {
    /* 界面字号梯度：uiFontSize 驱动全套 --fs-* token（设置中心可调） */
    ...uiFontSizeVars(uiFontSize),
    "--log-font-size": `${logFontSize}px`,
    "--terminal-font-size": `${terminalFontSize}px`,
    "--app-font-family": fontFamilyValue(uiFontFamily),
    /* S14：日志 / 终端字体族独立（原型：字体三处独立，日志字体族是原缺失能力） */
    "--log-font-family": monoFontFamilyValue(logFontFamily),
    "--terminal-font-family": monoFontFamilyValue(terminalFontFamily),
    "--custom-background-image": toCssImageUrl(customBackgroundImage),
    /* 背景层图片模式：遮罩亮度 / 模糊由设置滑杆驱动（原型 T1）。 */
    "--custom-image-overlay": `${uiImgOverlay}%`,
    "--custom-image-overlay-alpha": String(Math.max(0, Math.min(0.9, uiImgOverlay / 100))),
    "--custom-image-blur": `${uiImgBlur}px`,
    /* 强调色覆盖（高级节；null = 跟随主题）：contrast() 比较法派生 on-accent */
    ...(uiAccentOverride
      ? {
          "--accent": uiAccentOverride,
          "--accent-strong": accentHoverColor(uiAccentOverride, resolvedTheme.tone === "dark"),
          "--accent-soft": accentSoftColor(uiAccentOverride),
          "--on-accent": onAccentColor(uiAccentOverride),
        }
      : {}),
  } as CSSProperties;

  /* 终端配色（独立槽位）：背景与 ITheme 都来自所选方案 */
  const terminalScheme = TERMINAL_SCHEMES.find((s) => s.id === uiTerminalScheme) ?? TERMINAL_SCHEMES[0];

  /* html 底色跟随主题：index.html 防闪烁脚本写入的是内联 style（优先级最高），
     切主题时不会自动更新，这里同步，避免深色主题下窗口边缘露出浅色底。 */
  useEffect(() => {
    document.documentElement.style.background = resolvedTheme.v.bg;
    document.documentElement.dataset.skTheme = resolvedTheme.id;
  }, [resolvedTheme]);

  if (isStandaloneTerminalWindow) {
    return (
      <main className={`${appShellClassName} pip-standalone pip-terminal-standalone`} style={appShellStyle}>
        <section className="main-panel-terminal-standalone">
          {/* T7 独立终端窗：由 URL 的 terminalSessionId 构造单标签；分屏/弹出按钮在 standalone 隐藏 */}
          <TerminalPanel
            popupMode="standalone"
            server={selectedServer}
            serverId={serverId}
            preferredBastionId={preferredBastionId}
            isBusy={isBusy}
            cwd={terminalWorkingDirectory}
            tabs={terminalTabs}
            activeTabId={activeTerminalTabId}
            legacySessionId={terminalSessionId}
            onChangeTabs={(next) => {
              setTerminalTabs(next.terminalTabs);
              setActiveTerminalTabId(next.activeTerminalTabId);
            }}
            onStatus={setActionStatus}
            onActivity={pushActivity}
            terminalFontSize={terminalFontSize}
            terminalFontFamily={monoFontFamilyValue(terminalFontFamily)}
            terminalBackgroundColor={terminalScheme.theme.background}
            terminalScheme={uiTerminalScheme}
            terminalThemeKey={resolvedTheme.id}
            terminalOverlay={terminalOverlay}
            onToggleTerminalOverlay={toggleTerminalOverlay}
            onTogglePopup={() => undefined}
            detached={false}
            onSessionState={handleTerminalPaneSessionState}
            resources={terminalResources}
          />
        </section>
      </main>
    );
  }

  // 工具抽屉：四个面板常挂载、以 visible 切换显示，保持各自内部状态与监控采样缓冲
  const toolDrawerNode = showUtilityWorkspace && canShowEmbeddedUtilityWorkspace ? (
    <ToolDrawer
      open
      activePanel={activeUtilityPanel}
      panels={availableUtilityPanels}
      onSelectPanel={setActiveUtilityPanel}
      onClose={() => setShowUtilityWorkspace(false)}
    >
      {serverId ? (
        <SshTunnelPanel
          visible={activeUtilityPanel === "tunnels"}
          serverId={serverId}
          onClose={() => setShowUtilityWorkspace(false)}
          onStatus={(msg) => setActionStatus(msg)}
        />
      ) : null}
      {servers.length > 0 ? (
        <BatchCommandPanel
          visible={activeUtilityPanel === "batch"}
          servers={servers}
          onClose={() => setShowUtilityWorkspace(false)}
          onStatus={(msg) => setActionStatus(msg)}
        />
      ) : null}
      {serverId ? (
        <ServerStatusPanel
          visible={activeUtilityPanel === "status"}
          server={selectedServer}
          profile={serverSystemProfile}
          loading={serverSystemProfileLoading}
          error={serverSystemProfileError}
          autoRefresh={serverSystemProfileAutoRefresh}
          refreshIntervalMs={SERVER_STATUS_REFRESH_INTERVAL_MS}
          contextLabel={serverStatusContextLabel}
          onToggleAutoRefresh={() => setServerSystemProfileAutoRefresh((current) => !current)}
          onRefresh={() => { void refreshServerSystemProfile(); }}
          onClose={() => setShowUtilityWorkspace(false)}
        />
      ) : null}
      <DiffComparePanel
        visible={activeUtilityPanel === "compare"}
        remoteContent={currentLogContent}
        remoteLabel={activeCompareLabel}
        onClose={() => setShowUtilityWorkspace(false)}
      />
    </ToolDrawer>
  ) : null;

  /* 侧栏移动档（SidepanelMobile）共享数据：空态文案与 SidebarPanel 同源；
     app bar 标题 / 底部 tab 高亮判定与桌面 toolbar-view-switch 的 is-active 同源（无宽度分支）。 */
  const sidepanelServerEmptyState = showServiceOfflineState ? (
    <div className="empty-box sidebar-empty-box">
      <span className="empty-box-icon" aria-hidden="true">
        <ServerOff size={18} strokeWidth={1.8} />
      </span>
      <strong>{isElectron ? "正在等待内置连接服务启动" : "本地服务未启动"}</strong>
      <span>{isElectron ? "应用会自动重试连接本地服务；如果长时间没有恢复，我会继续排查安装版启动链路。" : "请在终端执行 npm run dev:gateway 启动本地连接服务，然后点击下方\"检查服务\"。"}</span>
    </div>
  ) : (
    <div className="empty-box sidebar-empty-box">
      <span className="empty-box-icon" aria-hidden="true">
        <FolderSearch size={18} strokeWidth={1.8} />
      </span>
      <strong>还没有服务器</strong>
      <span>检查 FinalShell 目录后导入，或手动补录连接信息。</span>
    </div>
  );
  const sidepanelMobileActiveView: "log" | "files" | "term" =
    showingLogPreview && !terminalAsWorkspaceView
      ? "log"
      : showingFileDirectory && !terminalAsWorkspaceView
        ? "files"
        : terminalPanelOpen || terminalDetached
          ? "term"
          : isFileMode ? "files" : "log";

  return (
    <main className={`${appShellClassName}${isStandalonePipWindow ? " pip-standalone" : ""}${showTransferHistory || showQueryAdvanced || (showUtilityWorkspace && canShowEmbeddedUtilityWorkspace) ? " v2-drawer-push" : ""}`} style={appShellStyle}>
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
          activityPanelVisible={activityPanelVisible}
          sidebarActivityLines={sidebarActivityLines}
          onDeleteServer={requestDeleteServer}
          onOpenSettingsWorkspace={openSettingsWorkspace}
          onOpenPalette={() => setPaletteOpen(true)}
          onCloseSettingsWorkspace={closeSettingsWorkspace}
          onActivityPanelResizeStart={handleActivityPanelResizeStart}
          hasPendingUpdate={desktopUpdate.updateAvailable}
          isBusy={isBusy}
          onRetryConnect={() => { void testServerConnection(selectedServer?.basePath?.trim() || "/"); }}
          onCheckService={() => { void checkLocalServiceHealth(); }}
        />

      <section className={`main-panel ${isFileMode ? "main-panel-files" : ""} sp-view-${sidepanelMobileActiveView}`}>
          {!isStandalonePipWindow && workspaceSessions.length > 0 ? (
            <WorkspaceSessionTabs
              workspaceSessions={workspaceSessions}
              activeWorkspaceSessionId={activeWorkspaceSessionId}
              isWorkspaceSwitchLocked={isWorkspaceSwitchLocked}
              workspaceTabDragState={workspaceTabDragState}
              workspaceTabDragJustMovedRef={workspaceTabDragJustMovedRef}
              onActivateSession={activateWorkspaceSession}
              onCloseSession={closeWorkspaceSession}
              onOpenPalette={() => setPaletteOpen(true)}
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
            {/* 侧栏移动档顶栏（sp-appbar + 服务器 chip）：宽档由 CSS display:none 隐藏，DOM 常驻 */}
            <SidepanelMobileTop
              onOpenPalette={() => setPaletteOpen(true)}
              onOpenSettings={() => {
                if (showConnectionSettings) {
                  closeSettingsWorkspace();
                  return;
                }
                openSettingsWorkspace();
              }}
              showSettingsActive={showConnectionSettings}
              selectedServer={selectedServer}
              connectionTestStatus={connectionTestStatus}
              onOpenServerPicker={() => setServerPickerOpen(true)}
              uiTheme={uiTheme}
            />
            <div className="toolbar-commandbar">
              <div className="toolbar-view-switch" aria-label="内容视图切换">
                <button
                  type="button"
                  className={showingLogPreview && !terminalAsWorkspaceView ? "toolbar-view-switch-btn is-active" : "toolbar-view-switch-btn"}
                  aria-pressed={showingLogPreview && !terminalAsWorkspaceView}
                  onClick={switchToLogPreviewView}
                  disabled={!serverId}
                  title={filePath.trim() ? "查看日志预览" : (hasSearchResults ? "查看日志结果" : "暂无日志结果")}
                >
                  日志预览
                </button>
                <button
                  type="button"
                  className={showingFileDirectory && !terminalAsWorkspaceView ? "toolbar-view-switch-btn is-active" : "toolbar-view-switch-btn"}
                  aria-pressed={showingFileDirectory && !terminalAsWorkspaceView}
                  onClick={switchToFileDirectoryView}
                  disabled={!canSwitchToDocumentContent}
                  title={canSwitchToDocumentContent ? "查看文件目录" : "先选择服务器"}
                >
                  文件目录
                </button>
                {canOpenTerminal ? (
                  <button
                    type="button"
                    className={`toolbar-view-switch-btn${terminalPanelOpen || terminalDetached ? " is-active" : ""}`}
                    aria-pressed={terminalPanelOpen || terminalDetached}
                    onClick={toggleTerminalPanelToolbar}
                    disabled={!serverId}
                    title={terminalPanelOpen || terminalDetached ? "收起终端" : "查看终端"}
                  >
                    终端
                  </button>
                ) : null}
              </div>
              {isFileMode && !terminalAsWorkspaceView ? (
                /* 文件模式：原型 tbar 一行式 —— seg 之后紧跟目录层级（面包屑），
                   过滤框 + 图标组靠右；检索/LIVE 等日志工具不显示（用户反馈 2026-09-30）。
                   容器复用 .file-browser-workbench 作用域以继承面包屑紧凑等既有规则。
                   终端视图不渲染（一套策略：终端有自己的动作栏/会话条，
                   视图切换 seg 保留在命令栏——所有宿主/档位都有路可回，2026-10-04）。 */
                <div className={`file-tools-inline file-browser-workbench${isConnectingWorkspace ? " is-idle" : ""}`}>
                  <FileBrowserPathbar
                    mode={pathbarMode}
                    directoryInput={directoryInput}
                    currentDirectory={currentDirectoryForPathbar}
                    breadcrumbItems={directoryBreadcrumbItems}
                    inputRef={directoryInputRef}
                    hasServer={!!serverId}
                    onSetDirectoryInput={setDirectoryInput}
                    onEnterEditMode={enterPathbarEditMode}
                    onExitEditMode={exitPathbarEditMode}
                    onOpenFromInput={() => { void openDirectoryFromInput(); }}
                    onCommitDirectoryPath={(path) => { void browseDirectoryWithNav(path); }}
                  />
                  <div className="workspace-actions">
                    <FileBrowserActions
                      uiTheme={uiTheme}
                      hasServer={!!serverId}
                      isBusy={isBusy}
                      filterValue={fileFilter}
                      showPathHistory={showPathHistory}
                      showTransferHistory={showTransferHistory}
                      onFilterChange={setFileFilter}
                      onBrowseParent={() => { void browseDirectoryWithNav(getParentDirectoryPath(directoryPath || directoryInput || "/")); }}
                      onTogglePathHistory={() => {
                        setShowTransferHistory(false);
                        setShowPathHistory((c) => !c);
                      }}
                      onToggleTransferHistory={() => {
                        setShowPathHistory(false);
                        setShowTransferHistory((c) => !c);
                      }}
                      onMkdir={() => setMkdirDialog({ parentDir: directoryPath || "/", dirName: "" })}
                      onUploadFiles={() => { void uploadFiles(); }}
                      onUploadDirectory={() => { void uploadDirectory(); }}
                      onRefresh={() => browseLogFiles(directoryPath || "/")}
                    />
                    {/* 侧栏移动档：目录树收进底部 sheet，此处仅是打开入口（宽档 CSS 隐藏） */}
                    <button
                      type="button"
                      className="ghost-button sp-dir-trigger"
                      onClick={() => setDirSheetOpen(true)}
                      disabled={!serverId}
                      title="打开目录树"
                    >
                      目录
                    </button>
                  </div>
                  {showPathHistory ? (
                    <FileBrowserHistoryDropdown
                      historyPaths={serverId ? readDirectoryHistory(serverId).filter((p) => p !== directoryPath) : []}
                      onBrowsePath={(path: string) => { setShowPathHistory(false); void browseDirectoryWithNav(path); }}
                    />
                  ) : null}
                </div>
              ) : !terminalAsWorkspaceView ? (
              <SearchToolbarActions
                uiTheme={uiTheme}
                isElectron={isElectron}
                liveFollowEnabled={liveFollowEnabled}
                canToggleLive={canToolbarLive}
                onToggleLive={toggleToolbarLive}
                onOpenPalette={() => setPaletteOpen(true)}
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
              ) : null}
            {/* 检索面板仅日志预览显示（原型 s1）；终端/文件模式各自的工具区在其视图内 */}
            {!isFileMode && !terminalAsWorkspaceView ? (
            <SearchQueryPanel
              showKeywordBar={showKeywordBar}
              showQueryAdvanced={showQueryAdvanced}
              onToggleQueryAdvanced={() => {
                setShowQueryAdvanced((current) => !current);
              }}
              hasServer={!!serverId}
              keywordInputRef={keywordInputRef}
              onKeywordInputChange={setKeywordInput}
              onRunSearch={() => { void runSearch(); }}
              /* 1+2 合并：结果摘要行并入 viewer-actions-strip（避免与「文件预览 · xxx」标题行重复） */
              showSummary={false}
              toolbarSummaryLabel={toolbarSummaryLabel}
              toolbarMetaLabel={toolbarMetaLabel}
              settings={{
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
              }}
              onKeywordModeChange={setKeywordMode}
              onExcludeInputChange={setExcludeInput}
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
              multiFileMode={multiFileMode}
              onToggleMultiFileMode={() => setMultiFileMode(!multiFileMode)}
              filePattern={filePattern}
              onFilePatternChange={setFilePattern}
              searching={Boolean(searchStartedAt)}
              /* 原型 S13 第 02 段：检索进度内联在按钮上（如 340MB/1.2GB），不锁界面。
                 字节数据来自 LogSearchTaskResponse 的 scannedBytes / totalBytes。 */
              searchProgressLabel={searchTask && searchTask.totalBytes > 0
                ? `${formatBytes(searchTask.scannedBytes)}/${formatBytes(searchTask.totalBytes)}`
                : ""}
              highlightSummary={activeHighlightSummary}
              onHighlightPrev={() => focusHighlight("prev")}
              onHighlightNext={() => focusHighlight("next")}
              resultContextMode={resultContextMode}
              canToggleResultContext={canToggleResultContext}
              onToggleResultContext={() => setResultContextMode((current) => !current)}
              canDownloadResults={Boolean(activeResultTab || results)}
              onDownloadResults={exportCurrentResults}
            />
            ) : null}
            </div>

            {/* connection info in sidebar */}
          </section>

          <section className={`workspace-panel ${isFileMode ? "workspace-panel-files" : ""}${terminalAsWorkspaceView ? " workspace-panel-terminal" : ""}`}>
            <WorkspaceStartupCards
              showServiceOfflineState={showServiceOfflineState}
              showNoServerState={showNoServerState}
              isElectron={isElectron}
              onCheckService={checkLocalServiceHealth}
              onOpenSettings={openSettingsWorkspace}
              onImportFinalShell={importFromFinalShell}
              onRefreshServers={fetchServers}
            />
            {!showServiceOfflineState && !showNoServerState && terminalPanelOpen && !terminalDetached ? (
              /* 终端工作台（五段式容器）：标签组 / 分屏 / 查找 / 菜单 / 状态栏均在容器内；
                 分屏双轨（terminal-workarea-split 顶条 + TerminalSplitView 直挂）已拆除 */
              <TerminalPanel
                popupMode="embedded"
                server={selectedServer}
                serverId={serverId}
                preferredBastionId={preferredBastionId}
                isBusy={isBusy}
                cwd={terminalWorkingDirectory}
                tabs={terminalTabs}
                activeTabId={activeTerminalTabId}
                legacySessionId={terminalSessionId}
                onChangeTabs={(next) => {
                  setTerminalTabs(next.terminalTabs);
                  setActiveTerminalTabId(next.activeTerminalTabId);
                  /* 关闭最后一个标签 = 关闭终端视图，回到内容区（日志预览/文件目录）。
                     否则标签清空后只剩空态工作台停留在终端视图里，用户点「终端」按钮
                     才切回内容视图，表现为「点了却打开日志预览」的错乱。 */
                  if (next.terminalTabs.length === 0) {
                    setTerminalPanelOpen(false);
                    setActiveTerminalTabId("");
                  }
                }}
                onStatus={setActionStatus}
                onActivity={pushActivity}
                terminalFontSize={terminalFontSize}
                terminalFontFamily={monoFontFamilyValue(terminalFontFamily)}
                terminalBackgroundColor={terminalScheme.theme.background}
                terminalScheme={uiTerminalScheme}
                terminalOverlay={terminalOverlay}
                onToggleTerminalOverlay={toggleTerminalOverlay}
                onTogglePopup={toggleTerminalPopup}
                detached={terminalDetached}
                onSessionState={handleTerminalPaneSessionState}
                resources={terminalResources}
                onOpenMonitor={openServerStatusPanel}
                onRevealInFiles={revealTerminalCwdInFiles}
                onOpenSettings={() => openSettingsWorkspace("preferences")}
                onUploadFiles={handleTerminalUploadFiles}
              />
            ) : !showServiceOfflineState && !showNoServerState && (
              <>
                {(!isFileMode || pip.isPip) ? (
                <>
                <div
                  className="viewer-workbench"
                  style={isFileMode ? { display: "none" } : undefined}
                >
                <div style={isFileMode ? { display: "none" } : { display: "contents" }}>
                {pip.isPip && !isFileMode && (
                  <div className="viewer-pip-placeholder">
                    <PipExpandIcon size={24} strokeWidth={1.5} />
                    <strong>日志查看器已弹出到独立小窗</strong>
                    <button className="ghost-button" onClick={() => void pip.togglePip()}>收回</button>
                  </div>
                )}
                {((node: ReactNode) => pip.isPip && pip.pipWindow ? createPortal(<div className={appShellClassName} style={{ ...appShellStyle, display: "contents" }}>{node}</div>, pip.pipWindow.document.body) : pip.isPip && !pip.pipWindow ? null : node)(
                <div className={showCompactViewerChrome ? "pip-viewer-root" : "pip-viewer-wrap"}>
                {showCompactViewerChrome ? (
                  <>
                  {pip.isPip ? (
                  /* 原型 S11 .pip .ph：live 图标 + 文件名 + LIVE 徽标 + 回主窗 + 关闭，1:1 */
                  <div className="viewer-floating-header viewer-pip-header">
                    <svg className="pip-header-live-icon" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <circle cx="12" cy="12" r="2" />
                      <path d="M4.9 19.1C1 15.2 1 8.8 4.9 4.9" />
                      <path d="M7.8 16.2c-2.3-2.3-2.3-6.1 0-8.5" />
                      <circle cx="12" cy="12" r="10" />
                      <path d="M16.2 7.8c2.3 2.3 2.3 6.1 0 8.5" />
                      <path d="M19.1 4.9C23 8.8 23 15.2 19.1 19.1" />
                    </svg>
                    <strong className="pip-header-name">{compactViewerTitle}</strong>
                    {/* 实时开关：可点击，状态跟随（浏览器 Document PiP 与主窗共享同一 React 状态；
                        Electron 独立窗口经快照/URL 参数恢复状态）。 */}
                    <button
                      type="button"
                      className={`liveb${liveFollowEnabled ? (liveFollowConnected ? "" : " retry") : " idle"}`}
                      onClick={toggleToolbarLive}
                      disabled={!canToolbarLive}
                      title={liveFollowEnabled ? "断开实时追踪" : "开启实时追踪 (tail -F)"}
                      aria-label={liveFollowEnabled ? (liveFollowConnected ? "实时追踪已连接，点击断开" : "实时追踪重连中") : "实时追踪未开启，点击开启"}
                    >
                      <i aria-hidden="true" />
                      {liveFollowEnabled ? (liveFollowConnected ? "LIVE" : "重连中 ⟳") : "未开启"}
                    </button>
                    {/* 有右侧按钮时用占位把按钮推到右端；文件名+状态徽标留在左侧成组（原 flex:1 把状态顶到最右，中间空一大段） */}
                    {!isBrowserDocumentPip ? <span className="pip-header-spacer" /> : null}
                    {/* 浏览器 Document PiP 由 Chrome 提供窗口框（自带关闭/返回），
                        自带按钮会重复 → 隐藏；Electron 独立窗口无原生控件，保留。 */}
                    {!isBrowserDocumentPip ? (
                      <>
                        <button
                          type="button"
                          className="ghost-button icon-button"
                          onClick={() => void pip.togglePip()}
                          title="回到主窗口"
                          aria-label="回到主窗口"
                        >
                          <PipExpandIcon size={13} />
                        </button>
                        <button
                          type="button"
                          className="ghost-button icon-button"
                          onClick={() => void pip.togglePip()}
                          title="关闭小窗"
                          aria-label="关闭小窗"
                        >
                          <X size={13} strokeWidth={1.8} />
                        </button>
                      </>
                    ) : null}
                  </div>
                  ) : (
                  <div className={`viewer-floating-header${isStandaloneViewerWindow ? " viewer-floating-header-standalone" : ""}`}>
                    <div className="viewer-floating-header-spacer" />
                    <div className="viewer-floating-header-title">
                      <strong>{compactViewerTitle}</strong>
                    </div>
                    <div className="viewer-floating-header-actions">
                      <div className="viewer-debug-anchor" ref={viewerDebugRef}>
                        <button
                          className={showViewerDebugPanel ? "ghost-button icon-button icon-toggle-active" : "ghost-button icon-button"}
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
                      <button
                        className={errorHighlightEnabled ? "ghost-button icon-button btn-highlight-active" : "ghost-button icon-button"}
                        onClick={toggleErrorHighlight}
                        disabled={!canToggleErrorHighlight}
                        title={errorHighlightEnabled ? "关闭异常/告警高亮" : "开启异常/告警高亮"}
                      >
                        <AlertTriangle size={14} strokeWidth={1.8} />
                      </button>
                      {canToggleResultContext ? (
                        <button
                          className={resultContextMode ? "ghost-button icon-button icon-toggle-active" : "ghost-button icon-button"}
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
                      {activeLogView === "search" && activeResultTab ? (
                        <button
                          className={showBookmarkPanel ? "ghost-button icon-button icon-toggle-active" : "ghost-button icon-button"}
                          onClick={() => setShowBookmarkPanel((current) => !current)}
                          title={showBookmarkPanel ? "隐藏书签" : "显示书签"}
                        >
                          <Bookmark size={14} strokeWidth={1.8} />
                        </button>
                      ) : null}
                      {!isStandaloneViewerWindow ? (
                        <button
                          className={pip.isPip ? "ghost-button icon-button tab-active" : "ghost-button icon-button"}
                          onClick={() => void pip.togglePip()}
                          title={pip.isPip ? "收回小窗" : "弹出独立小窗"}
                        >
                          <PipExpandIcon size={14} />
                        </button>
                      ) : null}
                    </div>
                  </div>
                  )}
                  </>
                ) : null}

                <div className="viewer-shell">
                {/* 融合工具行：结果页签 + 标识 + 统计 + 命中导航 + 动作组
                    （原「标题行 / 结果页签行 / 动作行」三行各自占一行、均大片留白且文件名重复，此处合为一行；
                     切片条 / LIVE 若存在则落到下一行，故整体 1~2 行） */}
                {!showCompactViewerChrome ? (
                  <div className="viewer-toolbar-row viewer-actions-strip">
                    {viewerTabs.length > 1 ? (
                      <div className="result-tab-strip">
                        {viewerTabs.map((tab) => (
                          <div key={tab.id} className={`result-tab-chip ${tab.id === activeViewerTabId ? "result-tab-chip-active" : ""}`}>
                            <button className="result-tab-main" type="button" aria-pressed={tab.id === activeViewerTabId} onClick={() => selectViewerTab(tab)}>
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
                    ) : null}
                    <span className="viewer-strip-label">{viewerStripLabel}</span>
                    {showSearchSummary && toolbarMetaLabel ? (
                      <span className="viewer-strip-summary">{toolbarMetaLabel}</span>
                    ) : null}
                    <span className="viewer-strip-spacer" />
                    {activeHighlightSummary ? (
                      <span className="summary-nav">
                        <button type="button" className="ghost-button icon-button" title="上一处命中" aria-label="上一处命中" onClick={() => focusHighlight("prev")}>
                          <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m12 19-7-7 7-7" /><path d="M19 12H5" /></svg>
                        </button>
                        <span className="mono summary-nav-count">{activeHighlightSummary}</span>
                        <button type="button" className="ghost-button icon-button" title="下一处命中" aria-label="下一处命中" onClick={() => focusHighlight("next")}>
                          <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6" /></svg>
                        </button>
                      </span>
                    ) : null}
                    {/* 高频动作组：警告高亮 / 命中上下文 / 下载 / 书签 / 小窗 / 更多工具 */}
                    {activeLogView === "search" ? (
                      <div className="toolbar-inline viewer-action-group" aria-label="视图动作">
                        <button
                          className={errorHighlightEnabled ? "ghost-button icon-button btn-highlight-active" : "ghost-button icon-button"}
                          onClick={toggleErrorHighlight}
                          disabled={!canToggleErrorHighlight}
                          title={errorHighlightEnabled ? "关闭异常/告警高亮" : "开启异常/告警高亮"}
                        >
                          <AlertTriangle size={14} strokeWidth={1.8} />
                        </button>
                        {canToggleResultContext ? (
                          <button
                            className={resultContextMode ? "ghost-button icon-button icon-toggle-active" : "ghost-button icon-button"}
                            onClick={toggleResultContext}
                            title={resultContextMode ? "切换到仅命中" : "切换到含上下文"}
                          >
                            <ToolIcon theme={uiTheme} kind="context" />
                          </button>
                        ) : null}
                        <button className="ghost-button icon-button" onClick={exportCurrentResults} disabled={!activeResultTab && !results} title="下载结果">
                          <Download size={14} strokeWidth={1.8} />
                        </button>
                        {activeResultTab ? (
                          <button
                            className={showBookmarkPanel ? "ghost-button icon-button icon-toggle-active" : "ghost-button icon-button"}
                            onClick={() => setShowBookmarkPanel((current) => !current)}
                            title={showBookmarkPanel ? "隐藏书签" : "显示书签"}
                          >
                            <Bookmark size={14} strokeWidth={1.8} />
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
                        {!isStandaloneViewerWindow ? (
                          <button
                            className={pip.isPip ? "ghost-button icon-button tab-active" : "ghost-button icon-button"}
                            onClick={() => void pip.togglePip()}
                            title={pip.isPip ? "收回小窗" : "弹出独立小窗"}
                          >
                            <PipExpandIcon size={14} />
                          </button>
                        ) : null}
                        {filePath && activeViewerTabId === "file" ? (
                          <button className={showFileTools ? "ghost-button icon-button icon-toggle-active" : "ghost-button icon-button"} onClick={() => setShowFileTools((current) => !current)} title="更多工具">
                            <Settings size={14} strokeWidth={1.8} />
                          </button>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                ) : null}

                {/* 3+4 合并：切片条与实时状态带并成一行（原型此二处本就相邻） */}
                {!showCompactViewerChrome && (showReaderRail || (activeLogView === "search" && Boolean(filePath || liveFollowEnabled))) ? (
                  <div className="log-view-bar" aria-label="日志视图状态">
                  {showReaderRail ? (
                  <div className="slicebar" aria-label="大文件切片定位">
                    <button
                      type="button"
                      className="ghost-button icon-button slicebar-nav"
                      onClick={() => void navigateSlice("prev")}
                      disabled={sliceOffset === 0 || sliceData?.isStart || isBusy}
                      title="上一页"
                      aria-label="上一页"
                    >
                      <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6" /></svg>
                    </button>
                    <span className="slicebar-range">
                      <b>{formatBytes(activeSliceData?.actualOffset)}</b> / {formatBytes(activeFileMeta?.size)}
                    </span>
                    <div
                      ref={sliceTrackRef}
                      className={`slicebar-strack${canDragReaderPosition ? "" : " slicebar-strack-disabled"}`}
                      onPointerDown={startSlicebarDrag}
                      title="拖拽跳转到指定位置"
                    >
                      <span className="slicebar-fill" style={{ width: `${readerRailIndicatorTop}%` }} />
                      <span
                        className={`slicebar-thumb${readerPositionDragging ? " slicebar-thumb-dragging" : ""}`}
                        style={{ left: `${readerRailIndicatorTop}%` }}
                      />
                    </div>
                    <span className="slicebar-percent">{formatPercent(readerPositionDragging ? readerPositionDraft : viewerPositionPercent)}</span>
                    <button
                      type="button"
                      className="ghost-button icon-button slicebar-nav"
                      onClick={() => void navigateSlice("next")}
                      disabled={sliceData?.isEnd || isBusy}
                      title="下一页"
                      aria-label="下一页"
                    >
                      <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6" /></svg>
                    </button>
                    <button
                      type="button"
                      className="ghost-button slim-button slicebar-tail"
                      onClick={() => { if (atFileTail) void loadHeadSlice(); else void loadTailSlice(); }}
                      disabled={isBusy || !filePath.trim()}
                      title={atFileTail ? "回到文件开头" : "跳到文件末尾"}
                    >
                      {atFileTail ? "回到头部" : "跳到尾部"}
                    </button>
                  </div>
                  ) : null}
                  {/* S4 实时状态带（原型 536-546）：脉冲徽标 + 文件说明 + 过滤框 + 暂停/断开
                      仅在已打开具体日志文件（可 tail -F）时出现，避免空态下误导 */}
                  {activeLogView === "search" && Boolean(filePath || liveFollowEnabled) ? (
                  <div className="rtools" aria-label="实时状态">
                    {/* LIVE 徽标已移除：与顶部工具栏的 LIVE 按钮重复（用户反馈）。
                        实时状态由顶部 LIVE 按钮承载，此处只保留文件说明 + 过滤 + 暂停。 */}
                    <span className="rt-note">
                      {selectedFileName || "eos-server.log"} · tail -F · 自动重连
                    </span>
                    <span className="rt-spacer" />
                    <span className="rt-filter">
                      <ToolIcon theme={uiTheme} kind="filter" />
                      <input
                        className="rt-filter-input"
                        value={liveFilterInput}
                        onChange={(event) => applyLiveFilter(event.target.value)}
                        placeholder="ERROR"
                        disabled={!canToolbarLive}
                        aria-label="实时过滤关键字"
                      />
                    </span>
                    <button
                      type="button"
                      className={liveFollowPaused ? "pill on" : "pill"}
                      onClick={toggleLivePause}
                      disabled={!liveFollowEnabled}
                      title={liveFollowPaused ? "恢复自动滚动" : "暂停自动滚动"}
                    >
                      <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                        <rect x="14" y="4" width="4" height="16" rx="1" />
                        <rect x="6" y="4" width="4" height="16" rx="1" />
                      </svg>
                      {liveFollowPaused ? "继续" : "暂停"}
                    </button>
                  </div>
                  ) : null}
                  </div>
                ) : null}

                {!showCompactViewerChrome && showFileTools && filePath && activeLogView === "search" && activeViewerTabId === "file" ? (
                  <div className="meta-list file-tools-panel">
                    <label>
                      切片大小
                      <ThemedSelect
                        value={sliceLengthMode === "auto" ? "auto" : String(sliceLength)}
                        onChange={(value) => {
                          if (value === "auto") {
                            setSliceLengthMode("auto");
                            if (activeFileMeta) {
                              setSliceLength(computeAutoSliceLength(activeFileMeta.size));
                            }
                          } else {
                            const next = Number(value);
                            if (next > 0) {
                              setSliceLengthMode("manual");
                              setSliceLength(next);
                            }
                          }
                        }}
                        ariaLabel="切片大小"
                        options={[
                          { value: "auto", label: `自动${activeFileMeta ? ` (${formatBytes(computeAutoSliceLength(activeFileMeta.size))})` : ""}` },
                          { value: "32768", label: "32 KB" },
                          { value: "65536", label: "64 KB" },
                          { value: "131072", label: "128 KB" },
                          { value: "262144", label: "256 KB" }
                        ]}
                      />
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
                    {lineContextState?.jumpSource && activeLogView === "search" && activeViewerTabId === "file" && !showCompactViewerChrome ? (
                      <div className="viewer-jump-context-bar">
                        <div className="viewer-jump-context-main">
                          <span className="viewer-jump-context-kicker">搜索定位</span>
                          <strong>{lineContextState.jumpSource.tabLabel}</strong>
                          <span>{lineContextState.jumpSource.sourceLabel}</span>
                          <span>第 {formatNumber(lineContextState.jumpSource.lineNumber)} 行</span>
                        </div>
                        <button type="button" className="ghost-button slim-button viewer-jump-context-back" onClick={returnToJumpSource}>
                          <ArrowLeft size={13} strokeWidth={1.8} />
                          返回结果
                        </button>
                      </div>
                    ) : null}
                    {viewerLineCopyRange && activeLogView === "search" && activeViewerTabId === "file" && !showCompactViewerChrome ? (
                      <div className="viewer-line-copy-bar">
                        <div className="viewer-line-copy-main">
                          <span className="viewer-line-copy-kicker">按行复制</span>
                          <strong>第 {formatNumber(viewerLineCopyRange.start + 1)} - {formatNumber(viewerLineCopyRange.end + 1)} 行</strong>
                          <span>Shift 点击另一行可调整范围</span>
                        </div>
                        <div className="viewer-line-copy-actions">
                          <button type="button" className="ghost-button slim-button" onClick={() => setViewerLineCopyRange(null)}>取消</button>
                          <button type="button" className="ghost-button slim-button viewer-line-copy-primary" onClick={() => void handleCopyViewerLineRange()}>
                            <Copy size={13} strokeWidth={1.8} />
                            复制范围
                          </button>
                        </div>
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
                        /* 结果页签/主结果用行号列布局（结果行无时间戳，不保留时间列留白）；文件预览保留时间戳列 */
                        variant={activeViewerTabId === "file" ? "log" : "results"}
                        content={currentLogContent}
                        keywordTerms={keywordTerms}
                        useRegex={useRegex}
                        activeHighlightIndex={activeHighlightIndex}
                        focusLineIndex={lineContextState && activeViewerTabId === "file" ? lineContextState.lineNumber - lineContextState.startLine : undefined}
                        selectedLineRange={activeViewerTabId === "file" ? viewerLineCopyRange : null}
                        onLineClick={viewerLineClickEnabled ? handleViewerLineClick : (activeViewerTabId === "file" ? handleViewerFileLineClick : undefined)}
                        lineActionTitle={viewerLineClickEnabled ? "按住 Ctrl 或 Cmd 点击可跳转到原日志" : "Cmd/Ctrl 点击复制日志块，Shift 点击选择范围"}
                        onSelectedLineRangeChange={activeViewerTabId === "file" ? handleViewerLineRangeChange : undefined}
                        onCopyLineRange={activeViewerTabId === "file" ? handleCopyViewerLineRange : undefined}
                        bookmarks={activeResultTab ? (activeResultTab.bookmarks || {}) : undefined}
                        onBookmarkToggle={activeResultTab ? handleBookmarkToggle : undefined}
                        onHighlightCountChange={setHighlightCount}
                        onFocusLineHighlightIndex={setActiveHighlightIndex}
                        onMatchLineIndicesChange={setViewerMatchLineIndices}
                        onWheel={handleViewerWheelWithSelectionMenu}
                        onNearBottomChange={handleViewerNearBottomChangeStable}
                        onScrollStateChange={showSearchResultsOverviewRail || viewerOverviewDragging ? setViewerScrollState : undefined}
                        errorHighlightEnabled={errorHighlightEnabled}
                        followOutput={liveFollowEnabled && !liveFollowPaused}
                        className="console-block viewer-console viewer-console-markup"
                      />
                      {/* S14-4：水印覆盖层（默认关闭）。作用范围=日志/预览区时挂在内容区之上，
                          斜向平铺低透明度文字，pointer-events:none 不挡交互。 */}
                      <WatermarkOverlay
                        enabled={watermarkEnabled && watermarkScope === "content"}
                        template={watermarkTemplate}
                        opacity={watermarkOpacity}
                        scope="content"
                        user={credentialUsername || selectedServer?.username || "用户"}
                        host={selectedServer?.name || selectedServer?.host || "主机"}
                        time={watermarkTimeLabel}
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
                            title="复制选中文本"
                            onMouseDown={(event) => {
                              event.preventDefault();
                              event.stopPropagation();
                            }}
                            onClick={() => void handleCopyViewerSelection()}
                          >
                            <Copy size={12} />
                            <span>复制</span>
                          </button>
                        </div>
                      ) : null}
                      {showBookmarkPanel ? (
                        <div className="bookmark-panel">
                          <div className="bookmark-panel-header">
                            <span>书签{activeResultTab?.bookmarks && Object.keys(activeResultTab.bookmarks).length > 0 ? ` (${Object.keys(activeResultTab.bookmarks).length})` : ""}</span>
                            <button className="ghost-button slim-button" onClick={() => setShowBookmarkPanel(false)}>关闭</button>
                          </div>
                          {activeResultTab?.bookmarks && Object.keys(activeResultTab.bookmarks).length > 0 ? (
                            <div className="bookmark-panel-list">
                              {Object.entries(activeResultTab.bookmarks).sort(([a], [b]) => Number(a) - Number(b)).map(([lineIdx, note]) => (
                                <div key={lineIdx} className="bookmark-entry" onClick={() => virtualViewerRef.current?.scrollToLine(Number(lineIdx))}>
                                  <span className="bookmark-line-no">行 {Number(lineIdx) + 1}</span>
                                  <span className="bookmark-note">{note || currentLogContent.split("\n")[Number(lineIdx)]?.slice(0, 60) || ""}</span>
                                  <button className="ghost-button slim-button" onClick={(e) => { e.stopPropagation(); handleBookmarkToggle(Number(lineIdx)); }}>✕</button>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <div className="bookmark-panel-empty">双击日志行可添加书签</div>
                          )}
                        </div>
                      ) : null}
                      {viewerNotAtBottom && activeViewerTabId === "file" ? (
                        <button className="live-back-to-bottom" type="button" aria-label="回到底部" title="回到底部" onClick={() => void handleBackToBottom()}>
                          <ArrowDown size={18} strokeWidth={1.9} />
                        </button>
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
                  /* 方案 A 空态工作台（原型 empty-states-a-v2 03 屏）：
                     eyebrow + 标题 + 副文案 + 三步时间线 + 键位 + 提示卡。
                     「最近检索」无真实数据源，右栏只放实时跟随提示（偏差③）。 */
                  <EmptyWorkbench
                    className="viewer-empty-host"
                    icon={<Search size={13} strokeWidth={1.8} />}
                    tipIcon={<Lightbulb size={12} strokeWidth={1.8} />}
                    eyebrow="日志检索 · 空结果"
                    title={viewerEmptyTitle}
                    sub={viewerEmptyHint}
                    steps={[
                      {
                        title: "输入关键字",
                        desc: "回车执行；打开文件后可读取尾部",
                        state: "cur",
                        actions: [
                          { label: "打开文件目录", kind: "ghost", onClick: () => setActiveLogView("files") },
                          { label: "查看检索示例", kind: "pri", onClick: () => { handleViewerEmptyPrimary(); } },
                        ],
                      },
                      { title: "语法限定", desc: "/ERROR 精确匹配 · /time 10:00 时间段 · 多词逗号拆分" },
                      { title: "实时跟随", desc: "⌥L 开启后自动滚动到最新写入" },
                    ]}
                    keys={[
                      { kbd: "⌘F", label: "检索" },
                      { kbd: "⌥L", label: "实时跟随" },
                      { kbd: "⌘E", label: "检索示例" },
                    ]}
                    tip="实时跟随已开启时，新日志写入会自动出现在结果里，无需手动刷新。"
                  />
                )}
                </div>
                </div>
                )}
                </div>
                </div>
                </>
                ) : null}
                {isFileMode ? (
              <div className="viewer-workbench file-browser-workbench">
                <div className="file-browser-workbench-main">
                {/* 工具行已并入顶部命令行（.file-tools-inline，见 toolbar-commandbar），
                    此处不再渲染独立 FileBrowserStrip（原型 = tbar 一行式） */}

                {isConnectingWorkspace ? (
                  selectedServer ? (
                    /* 方案 A 连接中进度态（原型 02 屏）：spinner 节点 + mono 实时行；
                       进度文案取真实 actionStatus，不造假进度。 */
                    <EmptyWorkbench
                      icon={<Folder size={13} strokeWidth={1.8} />}
                      tipIcon={<ShieldCheck size={12} strokeWidth={1.8} />}
                      eyebrow="文件目录 · 连接中"
                      title={`正在连接 ${selectedServer.name}`}
                      sub="正在建立 SSH 连接，通常 2 秒内完成；成功后会自动打开目录并记住位置。"
                      /* loading 单一化（用户反馈 2026-10-06：live 行与步骤① spinner 重复）：
                         不再渲染独立 live 行，实时 actionStatus 并入步骤①描述，
                         步骤① spinner = 唯一加载指示 */
                      steps={[
                        { title: "建立连接", desc: isBusy ? (actionStatus || "SSH 握手中") : "等待系统自动建立 SSH 连接", state: "wait" },
                        { title: "读取根目录", desc: "连接成功后自动挂载目录树" },
                        { title: "记住位置", desc: "下次启动直达最近目录" },
                      ]}
                      keys={[{ kbd: "⌘,", label: "连接设置" }]}
                      tip="连接慢或失败？多为网络或凭证问题；导入的密码可在设置中心重新获取。"
                    />
                  ) : (
                    /* 方案 A 未选服务器（原型 01 屏）：右栏「快速连接」= 真实服务器列表前 4 台；
                       窄档降级 chips + 全宽「选择服务器」按钮（打开选服层）。 */
                    <EmptyWorkbench
                      icon={<Folder size={13} strokeWidth={1.8} />}
                      eyebrow="文件目录 · 开始"
                      title="选择一台服务器，开始浏览远程目录"
                      sub="连接成功后系统会自动展开目录树、记住最近位置，并接管过滤、上传与右键菜单。"
                      steps={[
                        { title: "选择服务器", desc: "点击左侧列表任意一台；窄档可用下方按钮或最近连接", state: "cur" },
                        { title: "浏览目录", desc: "目录树自动挂载根目录，双击进入子目录" },
                        { title: "查看日志", desc: "点击 .log / .txt 文件直接进入日志预览" },
                      ]}
                      keys={[
                        { kbd: "⌘K", label: "服务器检索" },
                        { kbd: "⌘T", label: "新建终端" },
                        { kbd: "⌘/", label: "全部快捷键" },
                      ]}
                      panel={{
                        title: "快速连接",
                        rows: servers.slice(0, 4).map((server) => ({
                          dot: "idle" as const,
                          title: server.name,
                          meta: `${server.username}@${server.host}:${server.port}`,
                          action: "连接",
                          onAction: () => selectServerById(server.id),
                          onClick: () => selectServerById(server.id),
                        })),
                      }}
                      footerNarrow={
                        <button type="button" className="ghost-button ewb-cta-full" onClick={() => setServerPickerOpen(true)}>
                          选择服务器
                        </button>
                      }
                    />
                  )
                ) : hasDirectoryConnectionError ? (
                  /* S12 原型：连接错误用内容区顶部横幅（不挡内容），
                     含图标 + 中文原因 + 主机上下文 + [重连][连接设置] */
                  <div className="connection-error-banner" role="alert">
                    <span className="connection-error-banner-icon" aria-hidden="true">
                      <AlertTriangle size={15} strokeWidth={1.9} />
                    </span>
                    <span className="connection-error-banner-msg">
                      <b>连接失败{connectionErrorReason ? ` · ${connectionErrorReason}` : ""}</b>
                      <span>
                        {" — "}
                        {connectionTestStatus?.message || "无法连接到服务器，请检查网络、凭证或服务器状态。"}
                        {selectedServer ? ` · ${selectedServer.username}@${selectedServer.host}:${selectedServer.port}` : ""}
                      </span>
                      <span className="connection-error-banner-hint">
                        凭证可能已过期；导入的密码可在设置中心重新获取。
                      </span>
                    </span>
                    <button className="ghost-button" onClick={() => testServerConnection(selectedServer?.basePath?.trim() || "/")} disabled={isBusy}>
                      重连
                    </button>
                    <button className="ghost-button confirm-btn-primary" onClick={() => openSettingsWorkspace("connections")}>
                      连接设置
                    </button>
                  </div>
                ) : hasFileWorkspaceEntries ? (
                  <FileBrowserGrid
                    browserGridRef={browserGridRef}
                    browserTreeWidth={browserTreeWidth}
                    onAuxClick={handleFileBrowserMouseNavigation}
                    onMouseDown={handleFileBrowserMouseNavigation}
                  >
                    {/* 批量条承接「目录树｜目录内容」标题行（用户决策 2026-09-30）：
                        绝对定位覆盖层，钉在网格顶部、高度=列头行 34px；勾选时盖住两个标题行，
                        不占文档流 → 勾选/取消零抖动。原型 .batchbar 即此位置（唯原型未画未选态） */}
                    {selectedFileEntries.length ? (
                      <div className="file-batch-span">
                        <div className="file-batch-actions file-batch-actions-compact">
                          <b className="file-batch-title">已选 {selectedFileEntries.length} 项</b>
                          <span className="file-batch-mut">· {formatBytes(selectedFileBytes)}</span>
                          <button
                            type="button"
                            className="ghost-button file-batch-text-button"
                            onClick={() => openBatchMoveDialog()}
                            disabled={isBusy}
                            title="批量移动"
                          >
                            <ToolIcon theme={uiTheme} kind="folder-move" />
                            移动到…
                          </button>
                          <button
                            type="button"
                            className="ghost-button file-batch-text-button file-batch-danger"
                            onClick={() => confirmDeleteSelectedFiles()}
                            disabled={isBusy}
                            title="批量删除"
                          >
                            <ToolIcon theme={uiTheme} kind="delete" />
                            删除
                          </button>
                          <button
                            type="button"
                            className="ghost-button file-batch-text-button"
                            onClick={() => clearSelectedFiles()}
                            disabled={isBusy}
                            title="清空选择"
                          >
                            清空选择
                          </button>
                          <span className="file-batch-spacer" />
                          <span className="file-batch-hint">Esc 清空 · 双击进入 · 拖拽移动</span>
                        </div>
                      </div>
                    ) : null}
                    <FileBrowserTreeColumn
                      title="目录树"
                      summary={`${formatNumber(directoryEntries.length)} 个目录`}
                      serverId={serverId}
                      directoryPath={directoryPath || "/"}
                      listingTarget={treeListingTarget}
                      onBrowse={(path) => { void browseDirectoryWithNav(path); }}
                      onOpenContextMenu={(entry, clientX, clientY) => {
                        openContextMenu({ path: entry.path, name: entry.label || entry.path.split("/").pop() || "/", kind: "directory" }, clientX, clientY);
                      }}
                      onDropMove={handleTreeDropMove}
                    />

                    <div className="browser-resizer" onPointerDown={handleTreeResizeStart} title="拖拽调整目录宽度" />

                    <FileBrowserContentColumn
                      isDragOver={isDragOver}
                      onDragOver={(e) => {
                        /* 内部移动拖拽（批量条提示 ③）不算上传，不弹「松开上传」遮罩 */
                        if (e.dataTransfer.types.includes("application/x-slcc-move")) return;
                        e.preventDefault();
                        setIsDragOver(true);
                      }}
                      onDragLeave={(e) => { if (e.currentTarget.contains(e.relatedTarget as Node)) return; setIsDragOver(false); }}
                      onDrop={(e) => {
                        /* 内部移动拖拽在列级不承接（不 preventDefault → 🚫 光标）：
                           有效落点 = 目录树节点 / 列表内文件夹行（各自 stopPropagation 处理） */
                        if (e.dataTransfer.types.includes("application/x-slcc-move")) { setIsDragOver(false); return; }
                        handleFileDrop(e);
                      }}
                      onBlankContextMenu={openBlankContextMenu}
                      summary={<span>{formatNumber(tableEntries.length)} 项</span>}
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
                        {/* S6：传输列非常驻——仅在目录内有活动传输时出现，避免空占一列 */}
                        {uiTheme === "modern" && hasActiveFileTransfers ? <span className="file-transfer-head-cell">传输进度</span> : null}
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
                      {isDirectoryContentLoading && !tableEntries.length ? (
                        <div className="directory-loading-state table-empty-large">
                          <span className="connect-spinner" aria-hidden="true" />
                          <strong>正在加载目录内容</strong>
                          <span>{actionStatus || "正在读取远程目录，请稍候..."}</span>
                        </div>
                      ) : (
                        <FileBrowserTableRows
                          entries={tableEntries}
                          activeFilePath={filePath}
                          selectedFilePathSet={selectedFilePathSet}
                          isBusy={isBusy}
                          uiTheme={uiTheme}
                          emptyLabel="目录为空"
                          formatBytes={formatBytes}
                          formatDateTime={formatDateTime}
                          uploadProgress={uploadProgress}
                          downloadProgress={downloadProgress}
                          onOpenEntry={openFileBrowserEntry}
                          onOpenContextMenu={(entry, clientX, clientY) => { openContextMenu(entry, clientX, clientY); }}
                          onToggleSelection={toggleFileSelection}
                          onDownload={(path) => { void downloadFile(path); }}
                          onMove={openMoveDialog}
                          onRename={openRenameDialog}
                          onDropMove={handleTreeDropMove}
                        />
                      )}
                    </FileBrowserContentColumn>
                  </FileBrowserGrid>
                ) : (
                  <FileBrowserGrid
                    browserGridRef={browserGridRef}
                    browserTreeWidth={browserTreeWidth}
                    onAuxClick={handleFileBrowserMouseNavigation}
                    onMouseDown={handleFileBrowserMouseNavigation}
                  >
                    <FileBrowserTreeColumn
                      title="目录"
                      serverId={serverId}
                      directoryPath={directoryPath || "/"}
                      listingTarget={treeListingTarget}
                      onBrowse={(path) => { void browseDirectoryWithNav(path); }}
                      onOpenContextMenu={(entry, clientX, clientY) => {
                        openContextMenu({ path: entry.path, name: entry.label || entry.path.split("/").pop() || "/", kind: "directory" }, clientX, clientY);
                      }}
                      onDropMove={handleTreeDropMove}
                    />

                    <div className="browser-resizer" onPointerDown={handleTreeResizeStart} title="拖拽调整目录宽度" />

                    <FileBrowserContentColumn
                      isDragOver={isDragOver}
                      onDragOver={(e) => {
                        /* 内部移动拖拽（批量条提示 ③）不算上传，不弹「松开上传」遮罩 */
                        if (e.dataTransfer.types.includes("application/x-slcc-move")) return;
                        e.preventDefault();
                        setIsDragOver(true);
                      }}
                      onDragLeave={(e) => { if (e.currentTarget.contains(e.relatedTarget as Node)) return; setIsDragOver(false); }}
                      onDrop={(e) => {
                        /* 内部移动拖拽在列级不承接（不 preventDefault → 🚫 光标）：
                           有效落点 = 目录树节点 / 列表内文件夹行（各自 stopPropagation 处理） */
                        if (e.dataTransfer.types.includes("application/x-slcc-move")) { setIsDragOver(false); return; }
                        handleFileDrop(e);
                      }}
                      onBlankContextMenu={openBlankContextMenu}
                      summary={<span>0 项</span>}
                      tableHead={<>
                        <span>名称</span>
                        <span>大小</span>
                        <span>类型</span>
                      </>}
                    >
                      {isDirectoryContentLoading ? (
                        <div className="directory-loading-state table-empty-large">
                          <span className="connect-spinner" aria-hidden="true" />
                          <strong>正在加载目录内容</strong>
                          <span>{actionStatus || "正在读取远程目录，请稍候..."}</span>
                        </div>
                      ) : (
                        /* S12 原型 1039 行目录空态：图标 + 「目录为空」+ 副文案 + 主按钮「返回上一级」 */
                        <div className="empty-box table-empty table-empty-large empty-state-template">
                          <span className="empty-box-icon" aria-hidden="true">
                            <Folder size={18} strokeWidth={1.8} />
                          </span>
                          <strong className="empty-box-title">目录为空</strong>
                          <span className="empty-box-hint">回到上一级，或切换其他服务器</span>
                          <button
                            type="button"
                            className="ghost-button"
                            onClick={() => { void browseParentDirectory(); }}
                            disabled={isBusy}
                          >
                            返回上一级
                          </button>
                        </div>
                      )}
                    </FileBrowserContentColumn>
                  </FileBrowserGrid>
                )}
                </div>
              </div>
              ) : null}
            </>
            )}
          </section>

          {terminalDetached ? (
            <div className="viewer-pip-placeholder">
              <PipExpandIcon size={24} strokeWidth={1.5} />
              <strong>终端已弹出到独立小窗</strong>
              <button className="ghost-button" type="button" onClick={() => void restoreEmbeddedTerminalWindow()}>收回</button>
            </div>
          ) : null}

          {/* 侧栏移动档连接概览：原底部 sp-statusbar（400px 下过挤）已移除，
              概览并入顶部 srv-chip 选服层（ServerPickerOverlay.overview）——2026-10-04 */}

          {/* 侧栏移动档底部 tab 导航（sp-tabbar）：main-panel 最后一个子元素，宽档由 CSS 隐藏 */}
          <SidepanelMobileTabBar
            activeView={sidepanelMobileActiveView}
            canOpenTerminal={canOpenTerminal}
            hasServer={Boolean(serverId)}
            onLog={switchToLogPreviewView}
            onFiles={switchToFileDirectoryView}
            onTerm={toggleTerminalPanelToolbar}
          />

        </section>

        <SettingsModalOverlay open={showConnectionSettings && !isStandalonePipWindow} onClose={closeSettingsWorkspace}>
            <ConnectionSettingsWorkspace
              activeView={settingsWorkspaceView}
              onViewChange={changeSettingsWorkspaceView}
              isBusy={isBusy}
              localServiceState={localServiceState}
              localServiceStatusText={localServiceStatusText}
              gatewaySection={{
                draftBaseUrl: gatewayDraftBaseUrl,
                draftToken: gatewayDraftToken,
                effectiveBase: localServiceBase,
                testState: gatewayTestState,
                onDraftBaseUrlChange: setGatewayDraftBaseUrl,
                onDraftTokenChange: setGatewayDraftToken,
                onTest: () => { void testGatewayConfig(); },
                onSave: () => { void saveGatewayConfig(); },
                onReset: resetGatewayConfig,
              }}
              updateSection={{
                state: desktopUpdate.state,
                updateAvailable: desktopUpdate.updateAvailable,
                checkLog: desktopUpdate.checkLog,
                onCheck: desktopUpdate.check,
                onDownload: desktopUpdate.download,
                onInstall: desktopUpdate.install,
                showToast,
              }}
              preferenceSection={{
                uiTheme,
                uiDensity,
                uiThemePreset,
                uiToneMode,
                resolvedThemeId: resolvedTheme.id,
                resolvedThemeName: resolvedTheme.name,
                systemDark,
                uiBackground,
                uiImgOverlay,
                uiImgBlur,
                customBackgroundImage,
                uiTerminalScheme,
                uiAccentOverride,
                themePresetOptions: THEME_PRESETS,
                backgroundOptions: BG_LAYERS,
                terminalSchemeOptions: TERMINAL_SCHEMES,
                uiFontFamily,
                uiFontSize,
                logFontSize,
                terminalFontSize,
                logFontFamily,
                onLogFontFamilyChange: setLogFontFamily,
                terminalFontFamily,
                onTerminalFontFamilyChange: setTerminalFontFamily,
                motionMode,
                dynamicBackground,
                watermarkEnabled,
                watermarkTemplate,
                watermarkOpacity,
                watermarkScope,
                errorHighlightEnabled,
                showPathHistory,
                showTransferHistory,
                sliceLengthMode,
                sliceLength,
                serverStatusAutoRefresh: serverSystemProfileAutoRefresh,
                serverStatusRefreshIntervalMs: SERVER_STATUS_REFRESH_INTERVAL_MS,
                activityPanelHeight,
                activityPanelVisible,
                onToggleActivityPanelVisible: () => setActivityPanelVisible((current) => !current),
                onUiThemeChange: setUiTheme,
                onUiDensityChange: setUiDensity,
                onUiThemePresetChange: setUiThemePreset,
                onUiToneModeChange: setUiToneMode,
                onUiBackgroundChange: setUiBackground,
                onUiImgOverlayChange: setUiImgOverlay,
                onUiImgBlurChange: setUiImgBlur,
                onCustomBackgroundImageChange: setCustomBackgroundImage,
                onUiTerminalSchemeChange: setUiTerminalScheme,
                onUiAccentOverrideChange: setUiAccentOverride,
                onUiFontFamilyChange: setUiFontFamily,
                onUiFontSizeChange: setUiFontSize,
                onLogFontSizeChange: setLogFontSize,
                onTerminalFontSizeChange: setTerminalFontSize,
                onMotionModeChange: setMotionMode,
                onToggleDynamicBackground: () => setDynamicBackground(!dynamicBackground),
                onToggleWatermark: () => setWatermarkEnabled(!watermarkEnabled),
                onWatermarkTemplateChange: setWatermarkTemplate,
                onWatermarkOpacityChange: setWatermarkOpacity,
                onWatermarkScopeChange: setWatermarkScope,
                onResetUiPreferences: resetUiPreferences,
                onToggleErrorHighlight: () => setErrorHighlightEnabled((current) => !current),
                onTogglePathHistory: () => {
                  setShowTransferHistory(false);
                  setShowPathHistory((current) => !current);
                },
                onToggleTransferHistory: () => {
                  setShowPathHistory(false);
                  setShowTransferHistory((current) => !current);
                },
                onSliceLengthModeChange: setSliceLengthMode,
                onSliceLengthChange: setSliceLength,
                onToggleServerStatusAutoRefresh: () => setServerSystemProfileAutoRefresh((current) => !current),
              }}
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
              connectionSection={{
                managedServers: servers,
                manualServers,
                importedServers,
                draft: manualServerDraft,
                canSaveDraft: canSaveManualServer,
                onStartCreate: startCreateManualServer,
                onChangeDraft: (patch) => setManualServerDraft((current) => ({ ...current, ...patch })),
                onResetDraft: () => setManualServerDraft(createManualServerDraft()),
                onSaveDraft: () => { void saveManualServer(); },
                onSelectServer: (nextServerId) => {
                  selectServerById(nextServerId);
                  closeSettingsWorkspace();
                },
                onEditManualServer: editManualServerDraft,
                onDeleteServer: requestDeleteServer,
                /* S10：按目标服务器维护凭证——不要求先连接（清除带确认框） */
                onFetchCredentialStatus: (targetServerId) => { void fetchCredentialStatusById(targetServerId); },
                onSaveCredentialFor: (targetServerId) => { void saveCredentialToServer(targetServerId); },
                onLoadCredentialSecretFor: (targetServerId) => { void loadCredentialSecretOfServer(targetServerId); },
                onClearCredentialFor: (targetServerId) => {
                  const targetServer = servers.find((server) => server.id === targetServerId);
                  if (!targetServer) return;
                  setConfirmDialog({
                    title: "清除连接凭证",
                    message: `确定清除「${targetServer.name}」保存的密码 / 私钥？清除后再次连接需重新录入或导入。`,
                    target: `${targetServer.username}@${targetServer.host}:${targetServer.port}`,
                    danger: true,
                    confirmText: "清除",
                    onConfirm: () => { void clearCredentialOfServer(targetServerId); }
                  });
                },
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
                onLoadCredentialSecret: () => { void loadCredentialSecretForServer(); },
                onClearCredential: () => {
                  if (!selectedServer) return;
                  setConfirmDialog({
                    title: "清除连接凭证",
                    message: `确定清除「${selectedServer.name}」保存的密码 / 私钥？清除后再次连接需重新录入或导入。`,
                    target: `${selectedServer.username}@${selectedServer.host}:${selectedServer.port}`,
                    danger: true,
                    confirmText: "清除",
                    onConfirm: () => { void clearCredentialForServer(); }
                  });
                },
                onTestConnection: () => { void testServerConnection(currentConnectionDirectory); },
                onTestConnectionFor: (targetServerId) => { void testServerCredentialById(targetServerId); },
                onOpenTerminal: (targetServerId) => openTerminalForServer(targetServerId),
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
        onOpen={openFileBrowserEntry}
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
          setCompressDialog({ sourcePath: entry.path, sourceName: entry.name, archiveType: "zip", targetDir: parentDir });
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

      {/* 空白处右键菜单：目录级操作（用户反馈 2026-09-30）。样式复用 .context-menu 体系 */}
      {blankContextMenu ? (
        <div className="context-menu-backdrop">
          <div
            ref={blankContextMenuRef}
            className="context-menu"
            style={{ left: blankContextMenu.x, top: blankContextMenu.y }}
            onClick={(event) => event.stopPropagation()}
            onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); }}
          >
            <div
              role="button"
              className="context-menu-item"
              onClick={() => { setBlankContextMenu(null); void browseDirectoryWithNav(getParentDirectoryPath(directoryPath || directoryInput || "/")); }}
            >
              返回上级
            </div>
            <div
              role="button"
              className="context-menu-item"
              onClick={() => { setBlankContextMenu(null); browseLogFiles(directoryPath || "/"); }}
            >
              刷新目录
            </div>
            <div className="context-menu-separator" role="separator" />
            <div
              role="button"
              className="context-menu-item"
              onClick={() => { setBlankContextMenu(null); setMkdirDialog({ parentDir: directoryPath || "/", dirName: "" }); }}
            >
              新建目录
            </div>
            <div
              role="button"
              className="context-menu-item"
              onClick={() => { setBlankContextMenu(null); void uploadFiles(); }}
            >
              上传文件
            </div>
            <div
              role="button"
              className="context-menu-item"
              onClick={() => { setBlankContextMenu(null); void uploadDirectory(); }}
            >
              上传目录
            </div>
          </div>
        </div>
      ) : null}

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
        toasts={toasts}
        onDismissToast={dismissToast}
      />

      {/* 侧栏移动档覆盖层：整屏选服层 / 目录树底部 sheet（宽档由 CSS display:none 隐藏，DOM 常驻） */}
      <ServerPickerOverlay
        open={serverPickerOpen}
        onClose={() => setServerPickerOpen(false)}
        serverFilter={serverFilter}
        onServerFilterChange={setServerFilter}
        filteredGroupedServers={filteredGroupedServers}
        serverId={serverId}
        connectionTestStatus={connectionTestStatus}
        onSelectServer={(id) => {
          selectServerById(id);
          setServerPickerOpen(false);
        }}
        onDeleteServer={requestDeleteServer}
        onOpenSettingsWorkspace={openSettingsWorkspace}
        emptyState={sidepanelServerEmptyState}
        overview={([
          ["本地服务", localServiceStatusText],
          ["服务器", selectedServer ? `${selectedServer.name} · ${connectionStateText || "--"}` : ""],
          ["主机", selectedServer ? `${selectedServer.username}@${selectedServer.host}` : ""],
          ["路径", directoryPath && directoryPath !== "/" ? directoryPath : ""],
        ] as Array<[string, string]>).filter(([, value]) => Boolean(value))}
      />
      <DirectorySheet
        open={dirSheetOpen}
        onClose={() => setDirSheetOpen(false)}
        directoryPath={directoryPath || "/"}
        tree={
          /* 与文件模式 viewer-workbench 内的目录树同 props（FileBrowserTreeColumn 原样复用） */
          <FileBrowserTreeColumn
            title="目录树"
            summary={`${formatNumber(directoryEntries.length)} 个目录`}
            serverId={serverId}
            directoryPath={directoryPath || "/"}
            listingTarget={treeListingTarget}
            onBrowse={(path) => { void browseDirectoryWithNav(path); }}
            onOpenContextMenu={(entry, clientX, clientY) => {
              openContextMenu({ path: entry.path, name: entry.label || entry.path.split("/").pop() || "/", kind: "directory" }, clientX, clientY);
            }}
            onDropMove={handleTreeDropMove}
          />
        }
      />

      <DialogOverlays
        uiTheme={uiTheme}
        uploadProgress={uploadProgress}
        downloadProgress={downloadProgress}
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
        onPreviewArchiveEntry={(entryName) => { void previewArchiveEntry(entryName); }}
        onPreviewDialogToggleMaximize={() => setPreviewDialog((prev) => prev ? { ...prev, maximized: !prev.maximized } : null)}
        onPreviewDialogClose={() => {
          if (previewDialog && !previewDialog.readOnly && previewDialog.content !== previewDialog.originalContent) {
            setConfirmDialog({
              title: "未保存的更改",
              message: "文件已修改但未保存，确定放弃更改并关闭？",
              target: previewDialog.filePath,
              danger: true,
              confirmText: "放弃更改",
              onConfirm: () => setPreviewDialog(null),
            });
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
        uploadPaused={uploadPaused}
        onPauseUpload={pauseUpload}
        onResumeUpload={resumeUpload}
        onCancelUpload={cancelUpload}
      />
      {toolDrawerNode}
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} commands={paletteCommands} />
      <ImmediateTooltip />
      {/* S14-4：水印作用范围=全局时，整屏平铺（默认关闭） */}
      <WatermarkOverlay
        enabled={watermarkEnabled && watermarkScope === "global"}
        template={watermarkTemplate}
        opacity={watermarkOpacity}
        scope="global"
        user={credentialUsername || selectedServer?.username || "用户"}
        host={selectedServer?.name || selectedServer?.host || "主机"}
        time={watermarkTimeLabel}
      />
    </main>
  );
}
