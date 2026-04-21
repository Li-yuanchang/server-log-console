export type LogProfile = "tomcat" | "spring-boot" | "nginx" | "custom";
export type ServerConnectionKind = "direct" | "bastion" | "bastion-target";

export interface ServerSummary {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  basePath: string;
  profile: LogProfile;
  tags: string[];
  source?: "manual" | "finalshell" | "xshell";
  groupPath?: string[];
  authType?: "password" | "privateKey" | "unknown";
  hasStoredSecret?: boolean;
  cautionLabel?: string;
  connectionKind?: ServerConnectionKind;
  connectionHint?: string;
  preferredBastionId?: string;
}

export interface LogSearchRequest {
  serverId: string;
  filePath: string;
  keyword?: string;
  keywordTerms?: string[];
  keywordMode?: "phrase" | "any" | "all";
  excludeTerms?: string[];
  date?: string;
  startDate?: string;
  endDate?: string;
  startTime?: string;
  endTime?: string;
  contextLines?: number;
  useRegex?: boolean;
  liveMode?: boolean;
}

export interface LogSearchMatch {
  source: string;
  lineNumber: number;
  preview: string;
}

export interface LogSearchResponse {
  commandPreview: string;
  truncated: boolean;
  matches: LogSearchMatch[];
  rawOutput: string;
  contextOutput?: string;
  strategyLabel?: string;
  scopeLabel?: string;
}

export interface LogSearchTaskResponse {
  taskId: string;
  status: "queued" | "running" | "completed" | "failed";
  progressPercent: number;
  scannedBytes: number;
  totalBytes: number;
  elapsedMs: number;
  matchCount: number;
  chunkLabel?: string;
  strategyLabel?: string;
  scopeLabel?: string;
  commandPreview?: string;
  errorMessage?: string;
  progressPhase?: "queued" | "quick_tail" | "full_scan" | "completed";
  progressPhaseLabel?: string;
  progressPhaseIndex?: number;
  progressPhaseCount?: number;
  phaseProgressPercent?: number;
  phaseScannedBytes?: number;
  phaseTotalBytes?: number;
  overallProgressBytes?: number;
  overallProgressTotalBytes?: number;
  /** Phase 1 quick results from tail search (available while status is still "running") */
  quickResult?: LogSearchResponse;
  result?: LogSearchResponse;
}

export interface MultiFileLogSearchRequest {
  serverId: string;
  directoryPath: string;
  filePattern?: string;
  keyword?: string;
  keywordTerms?: string[];
  keywordMode?: "phrase" | "any" | "all";
  excludeTerms?: string[];
  startDate?: string;
  endDate?: string;
  startTime?: string;
  endTime?: string;
  useRegex?: boolean;
  maxFiles?: number;
}

export interface MultiFileLogSearchResponse {
  matches: LogSearchMatch[];
  scannedFiles: number;
  matchedFiles: number;
  commandPreview?: string;
  scopeLabel?: string;
}

export interface LiveTailRequest {
  serverId: string;
  filePath: string;
  keyword?: string;
}

export interface LiveTailEvent {
  sessionId: string;
  chunk: string;
  timestamp: string;
}

export interface FinalShellImportResponse {
  importedAt: string;
  resolvedPath: string | null;
  searchedPaths: string[];
  servers: ServerSummary[];
}

export interface FinalShellSettingsResponse {
  configuredPath: string;
  resolvedPath: string | null;
  searchedPaths: string[];
  lastImportedAt?: string;
}

export interface FinalShellSettingsRequest {
  configuredPath: string;
}

export interface ServerCredentialInput {
  username?: string;
  password?: string;
  privateKey?: string;
}

export interface ServerCredentialStatus {
  serverId: string;
  serverName: string;
  username: string;
  source: "manual" | "finalshell" | "xshell" | "environment" | "none";
  hasPassword: boolean;
  hasPrivateKey: boolean;
  hasUsableCredential: boolean;
  passwordMayNeedManualOverride: boolean;
  message: string;
}

export interface ServerConnectionTestRequest {
  directoryPath?: string;
}

export interface ServerConnectionTestResponse {
  serverId: string;
  serverName: string;
  host: string;
  username: string;
  connected: boolean;
  directoryPath: string;
  directoryReadable: boolean;
  sampleEntries: string[];
  message: string;
}

export interface ServerRouteConfig {
  serverId: string;
  preferredBastionId?: string;
  jumpMode?: "auto" | "jumpserver-search";
  jumpSearchKeyword?: string;
  jumpAssetId?: string;
}

export interface JumpServerAssetOption {
  id: string;
  name: string;
  address: string;
  platform?: string;
  organization?: string;
  comment?: string;
}

export interface JumpServerAssetSearchRequest {
  bastionId?: string;
  keyword?: string;
}

export interface JumpServerAssetSearchResponse {
  serverId: string;
  bastionId: string;
  keyword: string;
  assets: JumpServerAssetOption[];
}

export interface ManualServerUpsertRequest {
  id?: string;
  name: string;
  host: string;
  port?: number;
  username?: string;
  basePath: string;
  profile?: LogProfile;
  connectionKind?: ServerConnectionKind;
  tags?: string[];
  credential?: ServerCredentialInput;
}

export interface ManualServerUpsertResponse {
  server: ServerSummary;
}

export interface LogFileEntry {
  path: string;
  name: string;
  kind: "file" | "directory";
  size?: number;
  modifiedTime?: string;
}

export interface LogFileListRequest {
  serverId: string;
  directoryPath?: string;
}

export interface LogFileListResponse {
  directoryPath: string;
  entries: LogFileEntry[];
}

export interface LogFileMetaRequest {
  serverId: string;
  filePath: string;
}

export interface LogFileMetaResponse {
  filePath: string;
  size: number;
  modifiedTime: string;
  readable: boolean;
  encodingHint: string;
}

export interface LogSliceRequest {
  serverId: string;
  filePath: string;
  offset: number;
  length: number;
}

export interface LogSliceResponse {
  filePath: string;
  requestedOffset: number;
  requestedLength: number;
  actualOffset: number;
  actualLength: number;
  content: string;
  isStart: boolean;
  isEnd: boolean;
  nextOffset: number;
  /** Total file size in bytes (always returned, saves a separate meta call) */
  fileSize?: number;
  /** File modification time ISO string */
  modifiedTime?: string;
}

export interface LogLineContextRequest {
  serverId: string;
  filePath: string;
  lineNumber: number;
  contextLines?: number;
}

export interface LogLineContextResponse {
  filePath: string;
  lineNumber: number;
  startLine: number;
  endLine: number;
  content: string;
}
