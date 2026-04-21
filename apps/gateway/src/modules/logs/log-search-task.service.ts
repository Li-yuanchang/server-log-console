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

const QUICK_TAIL_BYTES = 5 * 1024 * 1024;

type SearchProgressPhase = "queued" | "quick_tail" | "full_scan" | "completed";

const searchSchema = z.object({
  serverId: z.string(),
  filePath: z.string(),
  keyword: z.string().optional(),
  keywordTerms: z.array(z.string()).optional(),
  keywordMode: z.enum(["phrase", "any", "all"]).optional(),
  excludeTerms: z.array(z.string()).optional(),
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
  progressPhase: SearchProgressPhase;
  progressPhaseLabel: string;
  progressPhaseIndex: number;
  progressPhaseCount: number;
  phaseScannedBytes: number;
  phaseTotalBytes: number;
  quickPhaseBytes: number;
  commandPreview: string;
  strategyLabel: string;
  scopeLabel: string;
  matches: LogSearchMatch[];
  allLines: Array<{ lineNumber: number; preview: string; isMatch: boolean }>;
  client?: Client;
  errorMessage?: string;
  /** Phase 1 quick search (tail portion) */
  quickMatches: LogSearchMatch[];
  quickAllLines: Array<{ lineNumber: number; preview: string; isMatch: boolean }>;
  quickDone: boolean;
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
    const quickPhaseBytes = meta.size > QUICK_TAIL_BYTES ? QUICK_TAIL_BYTES : 0;
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
      chunkLabel: quickPhaseBytes > 0 ? `准备尾部快搜 · 0 B / ${formatBytes(quickPhaseBytes)}` : `准备全文扫描 · 0 B / ${formatBytes(meta.size)}`,
      progressPhase: "queued",
      progressPhaseLabel: quickPhaseBytes > 0 ? "准备尾部快搜" : "准备全文扫描",
      progressPhaseIndex: 1,
      progressPhaseCount: quickPhaseBytes > 0 ? 2 : 1,
      phaseScannedBytes: 0,
      phaseTotalBytes: quickPhaseBytes > 0 ? quickPhaseBytes : meta.size,
      quickPhaseBytes,
      commandPreview,
      strategyLabel,
      scopeLabel,
      matches: [],
      allLines: [],
      quickMatches: [],
      quickAllLines: [],
      quickDone: false
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

  private setProgressPhase(task: SearchTaskState, phase: SearchProgressPhase) {
    task.progressPhase = phase;
    if (phase === "queued") {
      task.progressPhaseLabel = task.quickPhaseBytes > 0 ? "准备尾部快搜" : "准备全文扫描";
      task.progressPhaseIndex = 1;
      task.phaseTotalBytes = task.quickPhaseBytes > 0 ? task.quickPhaseBytes : task.totalBytes;
      task.phaseScannedBytes = 0;
    } else if (phase === "quick_tail") {
      task.progressPhaseLabel = "尾部快搜";
      task.progressPhaseIndex = 1;
      task.phaseTotalBytes = task.quickPhaseBytes;
      task.phaseScannedBytes = 0;
    } else if (phase === "full_scan") {
      task.progressPhaseLabel = "全文扫描";
      task.progressPhaseIndex = task.quickPhaseBytes > 0 ? 2 : 1;
      task.phaseTotalBytes = task.totalBytes;
      task.phaseScannedBytes = 0;
    } else {
      task.progressPhaseLabel = "全文扫描已完成";
      task.progressPhaseIndex = task.progressPhaseCount;
      task.phaseTotalBytes = task.totalBytes;
      task.phaseScannedBytes = task.totalBytes;
    }
    this.syncProgressState(task);
  }

  private updatePhaseProgress(task: SearchTaskState, scannedBytes: number, scannedLines?: number) {
    task.phaseScannedBytes = Math.max(0, Math.min(task.phaseTotalBytes, scannedBytes));
    if (scannedLines !== undefined && Number.isFinite(scannedLines)) {
      task.scannedLines = scannedLines;
    }
    this.syncProgressState(task);
  }

  private syncProgressState(task: SearchTaskState) {
    const overallProgressTotalBytes = this.getOverallProgressTotalBytes(task);
    const overallProgressBytes = this.getOverallProgressBytes(task);
    task.scannedBytes = overallProgressTotalBytes > 0 && task.totalBytes > 0
      ? Math.min(task.totalBytes, Math.round((overallProgressBytes / overallProgressTotalBytes) * task.totalBytes))
      : (task.status === "completed" ? task.totalBytes : 0);
    task.chunkLabel = `${task.progressPhaseLabel} · ${formatBytes(task.phaseScannedBytes)} / ${formatBytes(task.phaseTotalBytes)}`;
  }

  private getOverallProgressBytes(task: SearchTaskState) {
    const completedBeforePhase = task.progressPhase === "full_scan" || task.progressPhase === "completed"
      ? task.quickPhaseBytes
      : 0;
    return Math.min(this.getOverallProgressTotalBytes(task), completedBeforePhase + Math.min(task.phaseScannedBytes, task.phaseTotalBytes));
  }

  private getOverallProgressTotalBytes(task: SearchTaskState) {
    return task.totalBytes + task.quickPhaseBytes;
  }

  private async runTaskDirect(task: SearchTaskState, strategy: import("./strategies/index.js").DirectConnectionStrategy) {
    task.status = "running";
    task.startedAt = Date.now();

    const needsQuickPhase = task.quickPhaseBytes > 0;

    const runStreamingPhase = (
      command: string,
      matchesArr: LogSearchMatch[],
      allLinesArr: Array<{ lineNumber: number; preview: string; isMatch: boolean }>
    ): Promise<void> => {
      return new Promise<void>(async (resolve, reject) => {
        let pendingStdout = "";
        let pendingStderr = "";

        const consumeLine = (line: string) => {
          if (!line) return;
          if (line.startsWith("__PROGRESS__\t")) {
            const [, scannedBytesToken = "0", scannedLinesToken = "0"] = line.split("\t");
            const scannedBytes = Number(scannedBytesToken);
            const scannedLines = Number(scannedLinesToken);
            this.updatePhaseProgress(task, Number.isFinite(scannedBytes) ? scannedBytes : 0, Number.isFinite(scannedLines) ? scannedLines : undefined);
            return;
          }
          if (line.startsWith("__CTX__\t")) {
            const parts = line.split("\t");
            const lineNumber = Number(parts[1] || "0");
            const preview = parts.slice(2).join("\t");
            allLinesArr.push({ lineNumber, preview, isMatch: false });
            return;
          }
          if (line.startsWith("__MATCH__\t")) {
            const parts = line.split("\t");
            const lineNumber = Number(parts[1] || "0");
            const preview = parts.slice(2).join("\t");
            matchesArr.push({ source: task.request.filePath, lineNumber, preview });
            allLinesArr.push({ lineNumber, preview, isMatch: true });
            task.matchCount = task.matches.length + task.quickMatches.length;
          }
        };

        const flushBuffer = (buffer: string, kind: "stdout" | "stderr") => {
          const lines = buffer.split(/\r?\n/);
          const remain = lines.pop() ?? "";
          for (const line of lines) {
            if (kind === "stdout") consumeLine(line);
            else if (line.trim()) task.errorMessage = line.trim();
          }
          return remain;
        };

        try {
          const handle = await strategy.execStreaming(command, 120000);
          handle.onStdout((chunk) => { pendingStdout += chunk; pendingStdout = flushBuffer(pendingStdout, "stdout"); });
          handle.onStderr((chunk) => { pendingStderr += chunk; pendingStderr = flushBuffer(pendingStderr, "stderr"); });
          handle.onClose((code) => {
            flushBuffer(`${pendingStdout}\n`, "stdout");
            flushBuffer(`${pendingStderr}\n`, "stderr");
            if (code && code !== 0 && !matchesArr.length) {
              reject(new Error(task.errorMessage || `SSH 搜索失败，退出码 ${code}`));
            } else {
              resolve();
            }
          });
        } catch (error) {
          reject(error);
        }
      });
    };

    try {
      if (needsQuickPhase) {
        this.setProgressPhase(task, "quick_tail");
        const quickCommand = buildStreamingSearchCommand(task.server, task.request, task.totalBytes, { tailBytes: QUICK_TAIL_BYTES });
        await runStreamingPhase(quickCommand, task.quickMatches, task.quickAllLines);
        task.quickDone = true;
        console.log(`[search] Phase 1 done: ${task.quickMatches.length} quick matches in tail ${formatBytes(QUICK_TAIL_BYTES)}`);
      }

      this.setProgressPhase(task, "full_scan");
      const fullCommand = buildStreamingSearchCommand(task.server, task.request, task.totalBytes);
      await runStreamingPhase(fullCommand, task.matches, task.allLines);

      task.matchCount = task.matches.length;
      task.status = "completed";
      this.setProgressPhase(task, "completed");
      task.finishedAt = Date.now();
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

    const scanChunks = async (
      session: import("./ssh-executor.service.js").SftpSession,
      startOffset: number,
      endOffset: number,
      matchesArr: LogSearchMatch[],
      allLinesArr: Array<{ lineNumber: number; preview: string; isMatch: boolean }>,
      initialLineNumber = 0
    ) => {
      const chunkSize = 8 * 1024 * 1024;
      let offset = startOffset;
      let leftover = "";
      let lineNumber = initialLineNumber;
      let pendingAfter = 0;
      let lastPrinted = 0;
      const contextBuffer: Map<number, string> = new Map();

      while (offset < endOffset) {
        const readLen = Math.min(chunkSize, endOffset - offset);
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
                  allLinesArr.push({ lineNumber: i, preview: buffered, isMatch: false });
                  lastPrinted = i;
                }
              }
            }
            matchesArr.push({ source: task.request.filePath, lineNumber, preview: line });
            allLinesArr.push({ lineNumber, preview: line, isMatch: true });
            task.matchCount = task.matches.length + task.quickMatches.length;
            lastPrinted = lineNumber;
            pendingAfter = context;
          } else if (pendingAfter > 0 && lastPrinted !== lineNumber) {
            allLinesArr.push({ lineNumber, preview: line, isMatch: false });
            lastPrinted = lineNumber;
            pendingAfter--;
          }

          if (context > 0) {
            contextBuffer.set(lineNumber, line);
            contextBuffer.delete(lineNumber - context - 1);
          }
        }

        this.updatePhaseProgress(task, offset - startOffset, lineNumber);

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
                allLinesArr.push({ lineNumber: i, preview: buffered, isMatch: false });
                lastPrinted = i;
              }
            }
          }
          matchesArr.push({ source: task.request.filePath, lineNumber, preview: line });
          allLinesArr.push({ lineNumber, preview: line, isMatch: true });
          task.matchCount = task.matches.length + task.quickMatches.length;
        }
      }

      return lineNumber;
    };

    let session: import("./ssh-executor.service.js").SftpSession | null = null;

    try {
      session = await strategy.openSession();
      const fileSize = task.totalBytes;
      const needsQuickPhase = task.quickPhaseBytes > 0;

      if (needsQuickPhase) {
        this.setProgressPhase(task, "quick_tail");
        const tailOffset = fileSize - task.quickPhaseBytes;
        await scanChunks(session, tailOffset, fileSize, task.quickMatches, task.quickAllLines);
        task.quickDone = true;
        console.log(`[search-sftp] Phase 1 done: ${task.quickMatches.length} quick matches in tail ${formatBytes(QUICK_TAIL_BYTES)}`);
      }

      this.setProgressPhase(task, "full_scan");
      await scanChunks(session, 0, fileSize, task.matches, task.allLines);

      task.scannedLines = task.matches.length;
      task.matchCount = task.matches.length;
      task.status = "completed";
      this.setProgressPhase(task, "completed");
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
    const overallProgressBytes = this.getOverallProgressBytes(task);
    const overallProgressTotalBytes = this.getOverallProgressTotalBytes(task);
    const progressPercent = overallProgressTotalBytes > 0
      ? Math.min(100, (overallProgressBytes / overallProgressTotalBytes) * 100)
      : (task.status === "completed" ? 100 : 0);
    const phaseProgressPercent = task.phaseTotalBytes > 0
      ? Math.min(100, (task.phaseScannedBytes / task.phaseTotalBytes) * 100)
      : (task.status === "completed" ? 100 : 0);
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
      errorMessage: task.errorMessage,
      progressPhase: task.progressPhase,
      progressPhaseLabel: task.progressPhaseLabel,
      progressPhaseIndex: task.progressPhaseIndex,
      progressPhaseCount: task.progressPhaseCount,
      phaseProgressPercent,
      phaseScannedBytes: task.phaseScannedBytes,
      phaseTotalBytes: task.phaseTotalBytes,
      overallProgressBytes,
      overallProgressTotalBytes
    };

    // Phase 1 quick results (available while Phase 2 is still running)
    if (task.quickDone && !response.result) {
      const qMatches = task.quickMatches;
      let qContextOutput: string | undefined;
      if (task.quickAllLines.length > qMatches.length) {
        const sorted = [...task.quickAllLines].sort((a, b) => a.lineNumber - b.lineNumber);
        const parts: string[] = [];
        let prevLineNumber = -1;
        for (const entry of sorted) {
          if (prevLineNumber >= 0 && entry.lineNumber > prevLineNumber + 1) {
            parts.push("--");
          }
          parts.push(`${entry.lineNumber} | ${entry.preview}`);
          prevLineNumber = entry.lineNumber;
        }
        qContextOutput = parts.join("\n");
      }
      response.quickResult = {
        commandPreview: task.commandPreview,
        truncated: false,
        matches: qMatches,
        rawOutput: qMatches.map((m) => `${m.source}:${m.lineNumber}:${m.preview}`).join("\n"),
        contextOutput: qContextOutput,
        strategyLabel: task.strategyLabel,
        scopeLabel: task.scopeLabel
      };
    }

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
