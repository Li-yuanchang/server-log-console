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
  progressPhase?: "queued" | "preview_scan" | "quick_tail" | "full_scan" | "completed";
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

export interface SshTunnelRequest {
  serverId: string;
  tunnelType: "local" | "remote";
  localHost: string;
  localPort: number;
  remoteHost: string;
  remotePort: number;
}

export interface SshTunnelInfo {
  tunnelId: string;
  serverId: string;
  tunnelType: "local" | "remote";
  localHost: string;
  localPort: number;
  remoteHost: string;
  remotePort: number;
  status: "active" | "closed" | "error";
  createdAt: string;
}

export interface SshTunnelResponse {
  ok: boolean;
  tunnelId?: string;
  message?: string;
}

export interface SshTunnelListResponse {
  tunnels: SshTunnelInfo[];
}

export interface BatchCommandRequest {
  serverIds: string[];
  command: string;
  timeout?: number;
}

export interface BatchCommandResult {
  serverId: string;
  serverName?: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  error?: string;
}

export interface BatchCommandResponse {
  ok: boolean;
  results: BatchCommandResult[];
  message?: string;
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
  /** 声明用私钥认证、但私钥文件未能读到的服务器名称。非空说明这些机器凭证
      不完整（只剩用户名），连接时会认证失败 —— 必须显式提示，不能静默降级。 */
  missingPrivateKeyServers?: string[];
}

/** 单个字段的变更描述（仅列真正变化的字段，便于前端直接展示） */
export interface ImportFieldChange {
  field: "name" | "host" | "port" | "username" | "groupPath" | "connectionKind" | "other";
  label: string;
  before: string;
  after: string;
}

/** 重新导入时的单台服务器变更 */
export interface ImportServerChange {
  serverId: string;
  action: "add" | "remove" | "update" | "unchanged";
  name: string;
  host: string;
  port: number;
  username: string;
  /** 该条记录来自哪个工具（finalshell / xshell） */
  source: "finalshell" | "xshell";
  /** action === "update" 时的字段级变更明细 */
  changes?: ImportFieldChange[];
  /** action === "remove" 时：本工具里是否存在依赖该连接的用户配置
      （日志路径、搜索条件、监控历史等），删除前需二次确认。 */
  hasLocalData?: boolean;
  /** 该条记录的凭证是否完整（私钥认证但读不到私钥时为 false） */
  credentialComplete?: boolean;
}

/** 重新导入变更预览：不做任何写入，只返回将要发生什么 */
export interface ImportPreviewResponse {
  toolId: "finalshell" | "xshell";
  resolvedPath: string | null;
  searchedPaths: string[];
  added: ImportServerChange[];
  removed: ImportServerChange[];
  updated: ImportServerChange[];
  unchangedCount: number;
  /** 声明私钥认证但没读到私钥的服务器名称 */
  missingPrivateKeyServers?: string[];
}

/** 应用变更时的用户选择 */
export interface ImportApplyRequest {
  toolId: "finalshell" | "xshell";
  /** 用户确认要删除的 serverId 列表（未列出的 removed 项将被保留） */
  removeServerIds?: string[];
  /** 用户确认要按导入结果覆盖的 serverId 列表（未列出的 updated 项保留本地值） */
  updateServerIds?: string[];
}

export interface ImportApplyResponse {
  ok: boolean;
  addedCount: number;
  removedCount: number;
  updatedCount: number;
  keptCount: number;
  servers: ServerSummary[];
  missingPrivateKeyServers?: string[];
  message?: string;
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

/** 安全状态（设置中心 → 安全）。只含布尔值，不包含令牌或密钥本身。 */
export interface SecurityStatusResponse {
  /** 凭证是否已加密落盘 */
  credentialEncryptionEnabled: boolean;
  /** 是否要求访问令牌 */
  authEnabled: boolean;
  /** 凭证明文导出接口是否开放 */
  secretsExportEnabled: boolean;
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

export interface ServerCredentialSecret {
  serverId: string;
  serverName: string;
  username: string;
  source: "manual" | "finalshell" | "xshell" | "environment" | "none";
  password?: string;
  privateKey?: string;
  hasPassword: boolean;
  hasPrivateKey: boolean;
}

export interface ServerConnectionTestRequest {
  directoryPath?: string;
}

/** 草稿连接测试（2026-10-23）：表单尚未保存时，直接用填写的参数真连一次。
    不查服务器注册表、不写任何配置，只做一次 SSH 探测 + 目录可读性检查。 */
export interface ServerDraftConnectionTestRequest {
  host: string;
  port?: number;
  username?: string;
  password?: string;
  privateKey?: string;
  directoryPath?: string;
}

export interface ServerDraftConnectionTestResponse {
  connected: boolean;
  host: string;
  username: string;
  directoryPath: string;
  directoryReadable: boolean;
  message: string;
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

export interface ServerSystemProfileRequest {
  timeoutMs?: number;
  contextPath?: string;
}

export interface ServerSystemMetric {
  total: number;
  used: number;
  free: number;
  percent: number;
}

export interface ServerSystemDisk {
  filesystem: string;
  mount: string;
  total: number;
  used: number;
  available: number;
  percent: number;
}

export interface ServerSystemProcess {
  pid: number;
  cpuPercent: number;
  memoryPercent: number;
  rssKb: number;
  command: string;
}

export interface ServerSystemNetworkInterface {
  name: string;
  rxBytes: number;
  txBytes: number;
}

export interface ServerSystemProfileResponse {
  serverId: string;
  serverName: string;
  host: string;
  connectionKind?: ServerConnectionKind;
  collectedAt: string;
  source: "direct" | "bastion" | "jumpserver";
  hostname: string;
  os: string;
  kernel: string;
  uptimeText: string;
  uptimeSeconds: number;
  loadAverage: [number, number, number];
  cpu: {
    cores: number;
    model: string;
    /**
     * 真实 CPU 使用率（0-100）。由网关在远端读 /proc/stat 两次采样差分得出
     * （间隔 200ms），失败时为 undefined —— 此时前端回退到「负载/核数」口径并标注。
     * 注意不要用 loadAverage/cores 冒充利用率：它可能远超 100%，且不是占用率。
     */
    usagePercent?: number;
  };
  memory: ServerSystemMetric;
  swap: ServerSystemMetric;
  disks: ServerSystemDisk[];
  processes: ServerSystemProcess[];
  network: ServerSystemNetworkInterface[];
  warnings: string[];
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
  /** 手动连接的分组路径（如 ["生产","华东"]）；空数组或未传 = 未分组 */
  groupPath?: string[];
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
