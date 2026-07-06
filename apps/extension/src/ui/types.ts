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
};

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
  terminalSessionId: string;
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
