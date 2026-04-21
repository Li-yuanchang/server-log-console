import type {
  FinalShellImportResponse,
  FinalShellSettingsResponse,
  JumpServerAssetSearchResponse,
  LogFileListResponse,
  LogFileMetaResponse,
  LogLineContextResponse,
  LogSearchTaskResponse,
  LogSliceResponse,
  ManualServerUpsertRequest,
  ManualServerUpsertResponse,
  MultiFileLogSearchResponse,
  SshTunnelRequest,
  SshTunnelResponse,
  SshTunnelListResponse,
  ServerConnectionTestResponse,
  ServerCredentialStatus,
  ServerRouteConfig,
  ServerSummary
} from "@server-log-console/shared";

const runtimeOrigin = globalThis.location?.origin ?? "";
export const localServiceBase = !runtimeOrigin || !/:4040$/.test(runtimeOrigin) ? "http://localhost:4040" : runtimeOrigin;

async function readPayload<T>(response: Response, fallbackMessage: string): Promise<T> {
  const payload = (await response.json()) as T & { message?: string };
  if (!response.ok) {
    throw new Error(payload.message || fallbackMessage);
  }
  return payload;
}

export async function apiHealthCheck(timeoutMs = 1500): Promise<boolean> {
  const controller = new AbortController();
  const timer = globalThis.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${localServiceBase}/health`, {
      signal: controller.signal,
      cache: "no-store"
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return true;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error("health check timeout");
    }
    throw error;
  } finally {
    globalThis.clearTimeout(timer);
  }
}

export async function apiGetServers(): Promise<ServerSummary[]> {
  const response = await fetch(`${localServiceBase}/api/servers`);
  return (await response.json()) as ServerSummary[];
}

export async function apiUpsertManualServer(payload: ManualServerUpsertRequest): Promise<ManualServerUpsertResponse> {
  const response = await fetch(`${localServiceBase}/api/servers/manual`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  return readPayload<ManualServerUpsertResponse>(response, "保存手动服务器失败");
}

export async function apiDeleteServer(serverId: string): Promise<{ ok: boolean; serverId: string }> {
  const response = await fetch(`${localServiceBase}/api/servers/${encodeURIComponent(serverId)}`, {
    method: "DELETE"
  });
  return readPayload<{ ok: boolean; serverId: string }>(response, "删除服务器失败");
}

export async function apiGetDirectoryListing(params: {
  serverId?: string;
  bastionId?: string;
  directoryPath: string;
}): Promise<LogFileListResponse> {
  const response = await fetch(`${localServiceBase}/api/logs/files`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params)
  });
  return readPayload<LogFileListResponse>(response, "读取远程目录失败");
}

export async function apiGetLogMeta(serverId: string, filePath: string): Promise<LogFileMetaResponse> {
  const response = await fetch(`${localServiceBase}/api/logs/meta`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ serverId, filePath })
  });
  return readPayload<LogFileMetaResponse>(response, "读取日志元信息失败");
}

export async function apiGetLogSlice(
  serverId: string,
  filePath: string,
  offset: number,
  length: number
): Promise<LogSliceResponse> {
  const response = await fetch(`${localServiceBase}/api/logs/slice`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ serverId, filePath, offset, length })
  });
  return readPayload<LogSliceResponse>(response, "读取日志切片失败");
}

export async function apiGetLineContext(
  serverId: string,
  filePath: string,
  lineNumber: number,
  contextLines = 12
): Promise<LogLineContextResponse> {
  const response = await fetch(`${localServiceBase}/api/logs/line-context`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ serverId, filePath, lineNumber, contextLines })
  });
  return readPayload<LogLineContextResponse>(response, "按行定位日志失败");
}

export async function apiCreateSearchTask(params: {
  serverId: string;
  filePath: string;
  keyword: string;
  keywordTerms: string[];
  keywordMode: string;
  excludeTerms?: string[];
  startDate: string;
  endDate: string;
  startTime: string;
  endTime: string;
  contextLines: number;
  useRegex: boolean;
}): Promise<LogSearchTaskResponse> {
  const response = await fetch(`${localServiceBase}/api/logs/search/tasks`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params)
  });
  return readPayload<LogSearchTaskResponse>(response, "日志搜索任务创建失败");
}

export async function apiPollSearchTask(taskId: string): Promise<LogSearchTaskResponse> {
  const response = await fetch(`${localServiceBase}/api/logs/search/tasks/${encodeURIComponent(taskId)}`, { cache: "no-store" });
  return readPayload<LogSearchTaskResponse>(response, "读取搜索进度失败");
}

export async function apiGetFinalShellSettings(): Promise<FinalShellSettingsResponse> {
  const response = await fetch(`${localServiceBase}/api/import/finalshell/settings`);
  return readPayload<FinalShellSettingsResponse>(response, "读取 FinalShell 配置失败");
}

export async function apiSaveFinalShellPath(configuredPath: string): Promise<FinalShellSettingsResponse> {
  const response = await fetch(`${localServiceBase}/api/import/finalshell/settings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ configuredPath })
  });
  return readPayload<FinalShellSettingsResponse>(response, "保存 FinalShell 目录失败");
}

export async function apiGetCredentialStatus(serverId: string): Promise<ServerCredentialStatus> {
  const response = await fetch(`${localServiceBase}/api/servers/${encodeURIComponent(serverId)}/credential`);
  return readPayload<ServerCredentialStatus>(response, "读取凭证状态失败");
}

export async function apiSaveCredential(
  serverId: string,
  creds: { username?: string; password?: string; privateKey?: string }
): Promise<ServerCredentialStatus> {
  const response = await fetch(`${localServiceBase}/api/servers/${encodeURIComponent(serverId)}/credential`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(creds)
  });
  return readPayload<ServerCredentialStatus>(response, "保存凭证失败");
}

export async function apiGetServerRoute(serverId: string): Promise<ServerRouteConfig> {
  const response = await fetch(`${localServiceBase}/api/servers/${encodeURIComponent(serverId)}/route`);
  return readPayload<ServerRouteConfig>(response, "读取二跳配置失败");
}

export async function apiSaveServerRoute(
  serverId: string,
  route: { preferredBastionId?: string; jumpMode?: string; jumpSearchKeyword?: string; jumpAssetId?: string }
): Promise<ServerRouteConfig> {
  const response = await fetch(`${localServiceBase}/api/servers/${encodeURIComponent(serverId)}/route`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(route)
  });
  return readPayload<ServerRouteConfig>(response, "保存二跳设置失败");
}

export async function apiSearchJumpServerAssets(
  serverId: string,
  bastionId: string | undefined,
  keyword: string
): Promise<JumpServerAssetSearchResponse> {
  const response = await fetch(`${localServiceBase}/api/servers/${encodeURIComponent(serverId)}/jumpserver/assets`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ bastionId, keyword })
  });
  return readPayload<JumpServerAssetSearchResponse>(response, "读取 JumpServer 资产列表失败");
}

export async function apiTestConnection(
  serverId: string,
  directoryPath: string
): Promise<ServerConnectionTestResponse> {
  const response = await fetch(`${localServiceBase}/api/servers/${encodeURIComponent(serverId)}/test-connection`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ directoryPath })
  });
  return readPayload<ServerConnectionTestResponse>(response, "连接测试失败");
}

export async function apiImportFromTool(toolId: string): Promise<FinalShellImportResponse> {
  const response = await fetch(`${localServiceBase}/api/import/${toolId}`);
  return readPayload<FinalShellImportResponse>(response, `导入 ${toolId} 失败`);
}

export interface LogRecordingSessionResponse {
  sessionId: string;
  serverId: string;
  sourcePath: string;
  outputPath: string;
  pidFilePath: string;
  startedAt: string;
}

export interface LogRecordingStopResponse {
  sessionId: string;
  serverId: string;
  sourcePath: string;
  outputPath: string;
  startedAt: string;
  stoppedAt: string;
  sizeBytes: number;
}

export async function apiStartLogRecording(
  serverId: string,
  filePath: string,
  directoryPath?: string,
): Promise<LogRecordingSessionResponse> {
  const response = await fetch(`${localServiceBase}/api/logs/recordings/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ serverId, filePath, directoryPath }),
  });
  return readPayload<LogRecordingSessionResponse>(response, "开始录制失败");
}

export async function apiStopLogRecording(sessionId: string): Promise<LogRecordingStopResponse> {
  const response = await fetch(`${localServiceBase}/api/logs/recordings/stop`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId }),
  });
  return readPayload<LogRecordingStopResponse>(response, "结束录制失败");
}

export async function apiDownloadFile(
  serverId: string,
  filePath: string,
  onProgress?: (downloaded: number, total: number, speed: number) => void
): Promise<Blob> {
  const response = await fetch(`${localServiceBase}/api/files/download`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ serverId, filePath })
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({ message: "下载失败" })) as { message?: string };
    throw new Error(err.message || "下载失败");
  }

  const contentLength = Number(response.headers.get("Content-Length") || "0");
  if (!onProgress || !contentLength || !response.body) {
    return response.blob();
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  let speedSampleTime = Date.now();
  let speedSampleOffset = 0;
  let speed = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    const now = Date.now();
    const elapsed = (now - speedSampleTime) / 1000;
    if (elapsed >= 0.4) {
      speed = (received - speedSampleOffset) / elapsed;
      speedSampleTime = now;
      speedSampleOffset = received;
    }
    onProgress(received, contentLength, speed);
  }

  return new Blob(chunks as unknown as BlobPart[], { type: response.headers.get("Content-Type") || "application/octet-stream" });
}

export async function apiDeleteFile(serverId: string, filePath: string): Promise<void> {
  const response = await fetch(`${localServiceBase}/api/files/delete`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ serverId, filePath })
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({ message: "删除失败" })) as { message?: string };
    throw new Error(err.message || "删除失败");
  }
}

export async function apiRenameFile(serverId: string, oldPath: string, newPath: string): Promise<void> {
  const response = await fetch(`${localServiceBase}/api/files/rename`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ serverId, oldPath, newPath })
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({ message: "操作失败" })) as { message?: string };
    throw new Error(err.message || "操作失败");
  }
}

export async function apiPreviewFile(
  serverId: string,
  filePath: string
): Promise<{ filePath: string; content: string; size: number; readOnly?: boolean }> {
  const response = await fetch(`${localServiceBase}/api/files/preview`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ serverId, filePath })
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({ message: "加载失败" })) as { message?: string };
    throw new Error(err.message || "加载失败");
  }
  return response.json() as Promise<{ filePath: string; content: string; size: number; readOnly?: boolean }>;
}

export async function apiSaveFile(serverId: string, filePath: string, content: string): Promise<void> {
  const response = await fetch(`${localServiceBase}/api/files/save`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ serverId, filePath, content })
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({ message: "保存失败" })) as { message?: string };
    throw new Error(err.message || "保存失败");
  }
}

export async function apiUploadSmall(serverId: string, filePath: string, file: File): Promise<void> {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("serverId", serverId);
  formData.append("filePath", filePath);
  const res = await fetch(`${localServiceBase}/api/files/upload`, { method: "POST", body: formData });
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { message?: string };
    throw new Error(body.message || `上传失败 (${res.status})`);
  }
}

export async function apiUploadStart(serverId: string, filePath: string): Promise<string> {
  const res = await fetch(`${localServiceBase}/api/files/upload/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ serverId, filePath })
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { message?: string };
    throw new Error(body.message || `上传初始化失败 (${res.status})`);
  }
  const { uploadId } = await res.json() as { uploadId: string };
  return uploadId;
}

export async function apiUploadChunk(uploadId: string, chunk: Blob): Promise<void> {
  const formData = new FormData();
  formData.append("chunk", chunk);
  formData.append("uploadId", uploadId);
  const res = await fetch(`${localServiceBase}/api/files/upload/chunk`, {
    method: "POST",
    body: formData
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { message?: string };
    throw new Error(body.message || `分片上传失败 (${res.status})`);
  }
}

export async function apiUploadFinish(uploadId: string): Promise<void> {
  const res = await fetch(`${localServiceBase}/api/files/upload/finish`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ uploadId })
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { message?: string };
    throw new Error(body.message || `上传完成失败 (${res.status})`);
  }
}

export async function apiMkdir(
  serverId: string,
  directoryPath: string
): Promise<{ directoryPath: string }> {
  const response = await fetch(`${localServiceBase}/api/files/mkdir`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ serverId, directoryPath })
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({ message: "创建目录失败" })) as { message?: string };
    throw new Error(err.message || "创建目录失败");
  }
  return response.json() as Promise<{ directoryPath: string }>;
}

export async function apiCompress(
  serverId: string,
  sourcePath: string,
  archiveType?: "tar.gz" | "zip",
  targetDir?: string
): Promise<{ archivePath: string; output: string }> {
  const response = await fetch(`${localServiceBase}/api/files/compress`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ serverId, sourcePath, archiveType, targetDir })
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({ message: "压缩失败" })) as { message?: string };
    throw new Error(err.message || "压缩失败");
  }
  return response.json() as Promise<{ archivePath: string; output: string }>;
}

export async function apiExtractZip(
  serverId: string,
  filePath: string,
  targetDir?: string
): Promise<{ filePath: string; targetDir: string; output: string }> {
  const response = await fetch(`${localServiceBase}/api/files/extract`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ serverId, filePath, targetDir })
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({ message: "解压失败" })) as { message?: string };
    throw new Error(err.message || "解压失败");
  }
  return response.json() as Promise<{ filePath: string; targetDir: string; output: string }>;
}

export async function apiCreateSshTunnel(req: SshTunnelRequest): Promise<SshTunnelResponse> {
  const res = await fetch(`${localServiceBase}/api/ssh/tunnel`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(req) });
  return res.json();
}

export async function apiCloseSshTunnel(tunnelId: string): Promise<SshTunnelResponse> {
  const res = await fetch(`${localServiceBase}/api/ssh/tunnel/${encodeURIComponent(tunnelId)}`, { method: "DELETE" });
  return res.json();
}

export async function apiListSshTunnels(): Promise<SshTunnelListResponse> {
  const res = await fetch(`${localServiceBase}/api/ssh/tunnels`);
  return res.json();
}

export async function apiMultiFileSearch(params: Record<string, unknown>): Promise<MultiFileLogSearchResponse> {
  const response = await fetch(`${localServiceBase}/api/logs/search/multi`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params)
  });
  return readPayload<MultiFileLogSearchResponse>(response, "多文件搜索失败");
}
