import { randomUUID } from "node:crypto";
import type {
  LogSearchMatch,
  LogSearchRequest,
  LogSearchResponse,
  LogSearchTaskResponse,
  ServerSummary
} from "@server-log-console/shared";
import { Client } from "ssh2";
import { z } from "zod";
import { buildStreamingSearchCommand } from "./command-builder.js";
import { SshExecutorService } from "./ssh-executor.service.js";
import { ServerRegistryService } from "../servers/server-registry.service.js";
import { LogSliceService } from "./log-slice.service.js";

const searchSchema = z.object({
  serverId: z.string(),
  filePath: z.string(),
  keyword: z.string().optional(),
  keywordTerms: z.array(z.string()).optional(),
  keywordMode: z.enum(["phrase", "any", "all"]).optional(),
  date: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  startTime: z.string().optional(),
  endTime: z.string().optional(),
  contextLines: z.number().int().min(0).max(20).optional(),
  useRegex: z.boolean().optional(),
  liveMode: z.boolean().optional()
});

interface SearchTaskState {
  id: string;
  server: ServerSummary;
  request: LogSearchRequest;
  status: "queued" | "running" | "completed" | "failed";
  createdAt: number;
  startedAt: number;
  finishedAt?: number;
  totalBytes: number;
  scannedBytes: number;
  scannedLines: number;
  matchCount: number;
  chunkLabel: string;
  commandPreview: string;
  strategyLabel: string;
  scopeLabel: string;
  matches: LogSearchMatch[];
  client?: Client;
  errorMessage?: string;
}

export class LogSearchTaskService {
  private readonly tasks = new Map<string, SearchTaskState>();

  constructor(
    private readonly serverRegistry: ServerRegistryService,
    private readonly sshExecutor: SshExecutorService,
    private readonly logSliceService: LogSliceService
  ) {}

  async create(rawRequest: unknown): Promise<LogSearchTaskResponse> {
    const request = searchSchema.parse(rawRequest) as LogSearchRequest;
    const server = this.serverRegistry.getServer(request.serverId);
    const filePath = request.filePath || `${server.basePath}/catalina.out`;
    const meta = await this.logSliceService.getMeta({ serverId: request.serverId, filePath });
    const taskId = randomUUID();
    const commandPreview = buildStreamingSearchCommand(server, { ...request, filePath });
    const strategyLabel = describeSearchStrategy(request);
    const scopeLabel = describeSearchScope(request, server, filePath);
    const task: SearchTaskState = {
      id: taskId,
      server,
      request: { ...request, filePath },
      status: "queued",
      createdAt: Date.now(),
      startedAt: Date.now(),
      totalBytes: meta.size,
      scannedBytes: 0,
      scannedLines: 0,
      matchCount: 0,
      chunkLabel: meta.size ? `0 B ~ ${formatBytes(Math.min(meta.size, 4 * 1024 * 1024))}` : "--",
      commandPreview,
      strategyLabel,
      scopeLabel,
      matches: []
    };

    this.tasks.set(taskId, task);
    void this.runTask(task);
    return this.toResponse(task);
  }

  get(taskId: string): LogSearchTaskResponse {
    const task = this.tasks.get(taskId);
    if (!task) {
      throw new Error("搜索任务不存在或已过期");
    }

    return this.toResponse(task);
  }

  private async runTask(task: SearchTaskState) {
    task.status = "running";
    task.startedAt = Date.now();
    const connection = await this.sshExecutor.connectForStreaming(task.server.id, 45000);
    const client = connection.client;
    task.client = client;

    let pendingStdout = "";
    let pendingStderr = "";

    const consumeLine = (line: string) => {
      if (!line) return;
      if (line.startsWith("__PROGRESS__\t")) {
        const [, scannedBytesToken = "0", scannedLinesToken = "0", chunkStartToken = "0", chunkEndToken = "0"] = line.split("\t");
        task.scannedBytes = Number(scannedBytesToken) || task.scannedBytes;
        task.scannedLines = Number(scannedLinesToken) || task.scannedLines;
        task.chunkLabel = `${formatBytes(Number(chunkStartToken) || 0)} ~ ${formatBytes(Number(chunkEndToken) || 0)}`;
        return;
      }

      if (line.startsWith("__MATCH__\t")) {
        const parts = line.split("\t");
        const lineNumber = Number(parts[1] || "0");
        const preview = parts.slice(2).join("\t");
        task.matches.push({
          source: task.request.filePath,
          lineNumber,
          preview
        });
        task.matchCount = task.matches.length;
      }
    };

    const flushBuffer = (buffer: string, kind: "stdout" | "stderr") => {
      const lines = buffer.split(/\r?\n/);
      const remain = lines.pop() ?? "";
      for (const line of lines) {
        if (kind === "stdout") {
          consumeLine(line);
        } else if (line.trim()) {
          task.errorMessage = line.trim();
        }
      }
      return remain;
    };

    client
      .on("ready", () => {
        client.exec(task.commandPreview, (error, stream) => {
          if (error) {
            task.status = "failed";
            task.errorMessage = error.message;
            task.finishedAt = Date.now();
            connection.cleanup();
            return;
          }

          stream.on("data", (chunk: Buffer | string) => {
            pendingStdout += chunk.toString();
            pendingStdout = flushBuffer(pendingStdout, "stdout");
          });

          stream.stderr.on("data", (chunk: Buffer | string) => {
            pendingStderr += chunk.toString();
            pendingStderr = flushBuffer(pendingStderr, "stderr");
          });

          stream.on("close", (code: number | undefined) => {
            pendingStdout = flushBuffer(`${pendingStdout}\n`, "stdout");
            pendingStderr = flushBuffer(`${pendingStderr}\n`, "stderr");
            task.scannedBytes = task.totalBytes;
            task.chunkLabel = `${formatBytes(task.totalBytes)} / ${formatBytes(task.totalBytes)}`;
            task.finishedAt = Date.now();

            if (code && code !== 0 && !task.matches.length) {
              task.status = "failed";
              task.errorMessage = task.errorMessage || `SSH 搜索失败，退出码 ${code}`;
            } else {
              task.status = "completed";
            }

            connection.cleanup();
          });
        });
      })
      .on("error", (error) => {
        task.status = "failed";
        task.errorMessage = error.message;
        task.finishedAt = Date.now();
        connection.cleanup();
      });
  }

  private toResponse(task: SearchTaskState): LogSearchTaskResponse {
    const now = task.finishedAt || Date.now();
    const progressPercent = task.totalBytes > 0 ? Math.min(100, (task.scannedBytes / task.totalBytes) * 100) : 0;
    const response: LogSearchTaskResponse = {
      taskId: task.id,
      status: task.status,
      progressPercent,
      scannedBytes: task.scannedBytes,
      totalBytes: task.totalBytes,
      elapsedMs: Math.max(0, now - task.startedAt),
      matchCount: task.matchCount,
      chunkLabel: task.chunkLabel,
      strategyLabel: task.strategyLabel,
      scopeLabel: task.scopeLabel,
      commandPreview: task.commandPreview,
      errorMessage: task.errorMessage
    };

    if (task.status === "completed") {
      const result: LogSearchResponse = {
        commandPreview: task.commandPreview,
        truncated: false,
        matches: task.matches,
        rawOutput: task.matches.map((match) => `${match.source}:${match.lineNumber}:${match.preview}`).join("\n"),
        strategyLabel: task.strategyLabel,
        scopeLabel: task.scopeLabel
      };
      response.result = result;
    }

    return response;
  }
}

function describeSearchStrategy(request: LogSearchRequest) {
  const singleDay = Boolean(request.startDate && request.endDate && request.startDate === request.endDate);
  const singleKeyword = (request.keywordTerms?.filter((item) => item.trim()).length ?? 0) <= 1 && Boolean(request.keyword?.trim() || request.keywordTerms?.[0]?.trim());
  const hasTimeRange = Boolean(request.startTime?.trim() || request.endTime?.trim());

  if (!request.useRegex && (request.keywordMode || "phrase") === "phrase" && singleKeyword && singleDay && !hasTimeRange) {
    return "分片扫描 · 单日快筛";
  }

  if (!request.useRegex && (request.keywordMode || "phrase") === "phrase" && singleKeyword) {
    return "分片扫描 · 关键字";
  }

  if (request.useRegex) {
    return "分片扫描 · 正则";
  }

  if (request.startDate || request.endDate) {
    return "分片扫描 · 日期范围";
  }

  return "分片扫描 · 全文件";
}

function describeSearchScope(request: LogSearchRequest, server: ServerSummary, filePath: string) {
  const startDate = request.startDate || request.date || "";
  const endDate = request.endDate || request.date || "";
  const startTime = request.startTime?.trim() || "";
  const endTime = request.endTime?.trim() || "";
  const keywordTerms = request.keywordTerms?.filter((item) => item.trim()).length || (request.keyword?.trim() ? 1 : 0);

  const dateLabel = startDate || endDate
    ? `${startDate || endDate}${startTime ? ` ${startTime}` : ""} ~ ${endDate || startDate}${endTime ? ` ${endTime}` : ""}`
    : "未限制日期";

  return `${server.name} · ${filePath} · ${dateLabel} · ${keywordTerms} 个关键词`;
}

function formatBytes(size: number) {
  if (!Number.isFinite(size) || size <= 0) {
    return "0 B";
  }

  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = size;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return `${value.toFixed(value >= 100 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}
