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
import { buildStreamingSearchCommand, toIsoRange } from "./command-builder.js";
import { ServerRegistryService } from "../servers/server-registry.service.js";
import { LogSliceService } from "./log-slice.service.js";
import { type StrategyResolver, isDirectStrategy, isBastionSftpStrategy } from "./strategies/index.js";

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
  allLines: Array<{ lineNumber: number; preview: string; isMatch: boolean }>;
  client?: Client;
  errorMessage?: string;
}

export class LogSearchTaskService {
  private readonly tasks = new Map<string, SearchTaskState>();

  constructor(
    private readonly serverRegistry: ServerRegistryService,
    private readonly strategyResolver: StrategyResolver,
    private readonly logSliceService: LogSliceService
  ) {}

  async create(rawRequest: unknown): Promise<LogSearchTaskResponse> {
    const request = searchSchema.parse(rawRequest) as LogSearchRequest;
    const server = this.serverRegistry.getServer(request.serverId);
    const strategy = this.strategyResolver.resolve(request.serverId);

    const filePath = request.filePath || `${server.basePath}/catalina.out`;
    const meta = await this.logSliceService.getMeta({ serverId: request.serverId, filePath });
    const taskId = randomUUID();
    const commandPreview = strategy.kind === "bastion-sftp"
      ? `[SFTP 网关搜索] ${filePath}`
      : buildStreamingSearchCommand(server, { ...request, filePath }, meta.size);
    const strategyLabel = strategy.kind === "bastion-sftp" ? "SFTP 分块读取 · 网关搜索" : describeSearchStrategy(request);
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
      matches: [],
      allLines: []
    };

    this.tasks.set(taskId, task);

    if (isBastionSftpStrategy(strategy)) {
      void this.runTaskViaSftp(task, strategy);
    } else if (isDirectStrategy(strategy)) {
      void this.runTaskDirect(task, strategy);
    }

    return this.toResponse(task);
  }

  get(taskId: string): LogSearchTaskResponse {
    const task = this.tasks.get(taskId);
    if (!task) {
      throw new Error("搜索任务不存在或已过期");
    }

    return this.toResponse(task);
  }

  private async runTaskDirect(task: SearchTaskState, strategy: import("./strategies/index.js").DirectConnectionStrategy) {
    task.status = "running";
    task.startedAt = Date.now();

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

      if (line.startsWith("__CTX__\t")) {
        const parts = line.split("\t");
        const lineNumber = Number(parts[1] || "0");
        const preview = parts.slice(2).join("\t");
        task.allLines.push({ lineNumber, preview, isMatch: false });
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
        task.allLines.push({ lineNumber, preview, isMatch: true });
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

    try {
      const handle = await strategy.execStreaming(task.commandPreview, 45000);

      handle.onStdout((chunk) => {
        pendingStdout += chunk;
        pendingStdout = flushBuffer(pendingStdout, "stdout");
      });

      handle.onStderr((chunk) => {
        pendingStderr += chunk;
        pendingStderr = flushBuffer(pendingStderr, "stderr");
      });

      handle.onClose((code) => {
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
      });
    } catch (error) {
      task.status = "failed";
      task.errorMessage = error instanceof Error ? error.message : String(error);
      task.finishedAt = Date.now();
    }
  }

  private async runTaskViaSftp(task: SearchTaskState, strategy: import("./strategies/index.js").BastionSftpConnectionStrategy) {
    task.status = "running";
    task.startedAt = Date.now();

    const request = task.request;
    const { rangeStart, rangeEnd } = toIsoRange(request);
    const keywordTerms = (request.keywordTerms?.filter((t) => t.trim()) ?? []).map((t) => t.trim());
    const normalizedTerms = keywordTerms.length ? keywordTerms : request.keyword?.trim() ? [request.keyword.trim()] : [];
    const keywordMode = request.keywordMode || "phrase";
    const useRegex = Boolean(request.useRegex);
    const context = Number.isFinite(request.contextLines) ? Math.max(0, request.contextLines ?? 0) : 0;
    const hasDateRange = Boolean(rangeStart || rangeEnd);
    const currentYear = new Date().getFullYear().toString();

    const regexTerms = useRegex ? normalizedTerms.map((t) => new RegExp(t)) : [];

    const normalizeTime = (line: string): string => {
      const fullMatch = line.match(/^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})/);
      if (fullMatch) return `${fullMatch[1]}T${fullMatch[2]}`;
      const shortMatch = line.match(/^(\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})/);
      if (shortMatch) return `${currentYear}-${shortMatch[1]}T${shortMatch[2]}`;
      return "";
    };

    const inRange = (line: string): boolean => {
      if (!hasDateRange) return true;
      const ts = normalizeTime(line);
      if (!ts) return false;
      if (rangeStart && ts < rangeStart) return false;
      if (rangeEnd && ts > rangeEnd) return false;
      return true;
    };

    const keywordHit = (line: string): boolean => {
      if (normalizedTerms.length === 0) return true;
      if (keywordMode === "phrase") {
        return useRegex ? regexTerms[0].test(line) : line.includes(normalizedTerms[0]);
      }
      if (keywordMode === "all") {
        return normalizedTerms.every((term, i) => useRegex ? regexTerms[i].test(line) : line.includes(term));
      }
      return normalizedTerms.some((term, i) => useRegex ? regexTerms[i].test(line) : line.includes(term));
    };

    let session: import("./ssh-executor.service.js").SftpSession | null = null;

    try {
      session = await strategy.openSession();
      const fileSize = task.totalBytes;
      const chunkSize = 8 * 1024 * 1024;
      let offset = 0;
      let leftover = "";
      let lineNumber = 0;
      let pendingAfter = 0;
      let lastPrinted = 0;
      const contextBuffer: Map<number, string> = new Map();

      while (offset < fileSize) {
        const readLen = Math.min(chunkSize, fileSize - offset);
        const buf = await session.read(task.request.filePath, offset, readLen);
        offset += buf.length;

        const text = leftover + buf.toString("utf8");
        const lines = text.split("\n");
        leftover = lines.pop() ?? "";

        for (const rawLine of lines) {
          lineNumber++;
          const line = rawLine.replace(/\r$/, "");
          const hit = inRange(line) && keywordHit(line);

          if (hit) {
            if (context > 0) {
              const start = Math.max(1, lineNumber - context);
              for (let i = start; i < lineNumber; i++) {
                const buffered = contextBuffer.get(i);
                if (buffered !== undefined && lastPrinted !== i) {
                  task.allLines.push({ lineNumber: i, preview: buffered, isMatch: false });
                  lastPrinted = i;
                }
              }
            }
            task.matches.push({ source: task.request.filePath, lineNumber, preview: line });
            task.allLines.push({ lineNumber, preview: line, isMatch: true });
            task.matchCount = task.matches.length;
            lastPrinted = lineNumber;
            pendingAfter = context;
          } else if (pendingAfter > 0 && lastPrinted !== lineNumber) {
            task.allLines.push({ lineNumber, preview: line, isMatch: false });
            lastPrinted = lineNumber;
            pendingAfter--;
          }

          if (context > 0) {
            contextBuffer.set(lineNumber, line);
            contextBuffer.delete(lineNumber - context - 1);
          }
        }

        task.scannedBytes = offset;
        task.scannedLines = lineNumber;
        task.chunkLabel = `${formatBytes(offset)} / ${formatBytes(fileSize)}`;

        if (buf.length === 0) break;
      }

      if (leftover) {
        lineNumber++;
        const line = leftover.replace(/\r$/, "");
        const hit = inRange(line) && keywordHit(line);
        if (hit) {
          if (context > 0) {
            const start = Math.max(1, lineNumber - context);
            for (let i = start; i < lineNumber; i++) {
              const buffered = contextBuffer.get(i);
              if (buffered !== undefined && lastPrinted !== i) {
                task.allLines.push({ lineNumber: i, preview: buffered, isMatch: false });
                lastPrinted = i;
              }
            }
          }
          task.matches.push({ source: task.request.filePath, lineNumber, preview: line });
          task.allLines.push({ lineNumber, preview: line, isMatch: true });
          task.matchCount = task.matches.length;
        }
      }

      task.scannedBytes = fileSize;
      task.scannedLines = lineNumber;
      task.chunkLabel = `${formatBytes(fileSize)} / ${formatBytes(fileSize)}`;
      task.status = "completed";
      task.finishedAt = Date.now();
    } catch (error) {
      task.status = "failed";
      task.errorMessage = error instanceof Error ? error.message : String(error);
      task.finishedAt = Date.now();
    } finally {
      session?.close();
    }
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
      let contextOutput: string | undefined;
      if (task.allLines.length > task.matches.length) {
        const sorted = [...task.allLines].sort((a, b) => a.lineNumber - b.lineNumber);
        const parts: string[] = [];
        let prevLineNumber = -1;
        for (const entry of sorted) {
          if (prevLineNumber >= 0 && entry.lineNumber > prevLineNumber + 1) {
            parts.push("--");
          }
          parts.push(`${entry.lineNumber} | ${entry.preview}`);
          prevLineNumber = entry.lineNumber;
        }
        contextOutput = parts.join("\n");
      }

      const result: LogSearchResponse = {
        commandPreview: task.commandPreview,
        truncated: false,
        matches: task.matches,
        rawOutput: task.matches.map((match) => `${match.source}:${match.lineNumber}:${match.preview}`).join("\n"),
        contextOutput,
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
