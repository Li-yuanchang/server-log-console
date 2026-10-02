import type {
  JumpServerAssetOption,
  LogFileEntry,
  LogFileMetaResponse,
  LogSearchResponse,
  LogSliceResponse,
  ServerConnectionTestResponse,
  ServerRouteConfig,
  ServerCredentialStatus
} from "@server-log-console/shared";
import type { LogRecordingSessionResponse } from "./api.js";
import type { LineContextState, ViewerResultTab } from "./utils.js";

export const defaultDirectoryPath = "";
export const SEARCH_TIMER_INTERVAL_MS = 1000;
export const LOCAL_SERVICE_RETRY_INTERVAL_MS = 2500;
export const MAX_PREVIEW_CACHE_ENTRIES = 60;
export const MAX_SLICE_CACHE_ENTRIES = 24;
export const MAX_RESULT_TABS = 8;
export const VIEWER_PIP_SNAPSHOT_KEY = "slc:viewer-pip-snapshot";

export type WorkspaceSession = {
  id: string;
  serverId: string;
  serverName: string;
  serverHost: string;
  serverGroup?: string;
};

/** 终端内多标签（对应方案 §3 会话模型升级）：tabId 形如 tt-<随机>，sessionId 复用 createTerminalSessionId */
export interface TerminalTabState {
  tabId: string;
  sessionId: string;
  kind: "server" | "asset";
  assetKeyword?: string;
}

export type WorkspaceSessionState = {
  serverId: string;
  filePath: string;
  directoryPath: string;
  statusContextPath: string;
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
  /** 旧单会话字段：仅作迁移来源与弹窗协议（openPipWindow）兼容保留，新代码读写 terminalTabs */
  terminalSessionId: string;
  /** 终端内多标签组（每工作区独立，随上层工作区整套切换）；分屏布局不持久化（内存态） */
  terminalTabs: TerminalTabState[];
  activeTerminalTabId: string;
  recordingSession: LogRecordingSessionResponse | null;
  liveFollowEnabled: boolean;
  liveFollowPaused: boolean;
  liveFollowContent: string;
};

export type ViewerPipSnapshot = {
  serverId: string;
  filePath: string;
  directoryPath: string;
  keywordInput: string;
  keywordMode: "phrase" | "any" | "all";
  excludeInput?: string;
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
