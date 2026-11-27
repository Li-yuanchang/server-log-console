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
import { buildPreviewSearchCommand, buildStreamingSearchCommand, toIsoRange } from "./command-builder.js";
import { ServerRegistryService } from "../servers/server-registry.service.js";
import { LogSliceService } from "./log-slice.service.js";
import { type StrategyResolver, isDirectStrategy, isBastionSftpStrategy } from "./strategies/index.js";

const PREVIEW_MATCH_LIMIT = 200;
const PREVIEW_PHASE_BYTES = 512 * 1024;
const QUICK_TAIL_BYTES = 5 * 1024 * 1024;

/**
 * 单条命中预览的最大字符数（2026-11-19）。
 *
 * 实测故障：11 GB catalina.out 里存在「整条批量 INSERT」式超长行（含大量中文字段值），
 * 单行可达数百万字符。124 条这样的命中拼成 rawOutput / contextOutput 时，
 * 字符串长度超过 V8 的硬上限（约 5.12 亿字符），抛
 * `RangeError: Invalid string length`，前端表现为「检索失败：Invalid string length」，
 * 尽管检索本身已经成功完成（截图：共 124 条结果 / 扫描 11.2 GB）。
 *
 * 修法：在**收集入口**就截断 preview，从源头保证结果集不会无界膨胀。
 * 这与 klogg「超长行截断显示」、lnav 的行窗口策略一致；
 * 用户仍可点开该行查看按行号回溯的上下文（line-context 接口，不受此限制）。
 */
const MAX_MATCH_PREVIEW_CHARS = 4000;

/** 截断单行预览，保留可读前缀并标注被截断 */
function clampPreview(text: string): string {
  if (text.length <= MAX_MATCH_PREVIEW_CHARS) {
    return text;
  }
  return `${text.slice(0, MAX_MATCH_PREVIEW_CHARS)} …[截断，原长 ${text.length} 字符]`;
}

/**
 * 结果集上限（2026-11-19）。
 *
 * 背景：全文扫描 11 GB 日志时，matches / allLines 无上限累积，且每 450 ms 轮询
 * 都把这些数组重新 map+join 成超长字符串；gateway 是以 import 方式跑在 Electron
 * 主进程内的（main.cjs importGatewayInProcess），于是内存直接打爆主进程与渲染进程
 * —— 11/19 连续 3 次崩溃（两次 renderer SIGTRAP、一次主进程 OnFatalError→abort）。
 *
 * 方案与 rg / lnav / klogg 等成熟工具一致：**超限只计数、不再保留**。
 * 内存恒定在 O(上限)，总命中数仍然准确，用户可据此收窄条件。命中数统计不受影响，
 * 只是不再把全部命中行留在内存里。
 */
const MAX_STORED_MATCHES = 5000;
const MAX_STORED_QUICK_MATCHES = 2000;
/** 命中行 + 上下文行的总保留上限（上下文最多 20 行/命中，故单独设一档） */
const MAX_STORED_RESULT_LINES = 20000;
/** 任务保留时长：完成后超过该时长即回收，避免长期驻留 */
const TASK_TTL_MS = 10 * 60 * 1000;

type SearchProgressPhase = "queued" | "preview_scan" | "quick_tail" | "full_scan" | "completed";

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
  previewPhaseBytes: number;
  previewCommand?: string | null;
  commandPreview: string;
  strategyLabel: string;
  scopeLabel: string;
  matches: LogSearchMatch[];
  allLines: Array<{ lineNumber: number; preview: string; isMatch: boolean }>;
  client?: Client;
  errorMessage?: string;
  /** Immediate results from preview/tail quick phases */
  quickMatches: LogSearchMatch[];
  quickAllLines: Array<{ lineNumber: number; preview: string; isMatch: boolean }>;
  quickDone: boolean;
  /* --- 上限控制（2026-11-19）：保留数被截断后仍精确统计总量 --- */
  /** 命中总数（含未保留的），用于准确展示「共命中 N 行」 */
  matchTotal: number;
  /** 因超限而未保留的命中数 */
  matchDropped: number;
  quickMatchTotal: number;
  /**
   * 字符串构建缓存（2026-11-19）。
   * 轮询每 450 ms 触发一次 toResponse()，此前每次都把 matches/allLines 全量
   * map+join 并全量排序一次 —— 命中几万行时单次轮询就要分配上百 MB，是崩溃主因之一。
   * 这里按「数组长度 + 阶段」作为版本键缓存，数据没变就复用上次结果。
   */
  responseCache?: {
    quickKey: string;
    quickResult?: LogSearchResponse;
    finalKey: string;
    finalResult?: LogSearchResponse;
  };
  /** 结果版本号：结果内容每变一次自增，供轮询做条件获取 */
  resultVersion: number;
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
    /*
     * 耗时埋点（2026-11-19）。
     * 用户反馈「回车后约 5 秒才看到进度变化」，但此前日志无法区分这段时间
     * 花在「取文件元信息」还是「首批快搜扫描」。这里在关键节点打点，
     * 便于直接对照用户感知的延迟究竟落在哪一段。
     */
    const metaStartedAt = Date.now();
    const meta = await this.logSliceService.getMeta({ serverId: request.serverId, filePath });
    const metaCostMs = Date.now() - metaStartedAt;
    if (metaCostMs > 300) {
      console.log(`[search] 取文件元信息耗时 ${metaCostMs}ms size=${meta.size}`);
    }
    const taskId = randomUUID();
    const previewCommand = strategy.kind === "direct"
      ? buildPreviewSearchCommand(server, { ...request, filePath }, PREVIEW_MATCH_LIMIT)
      : null;
    const previewPhaseBytes = previewCommand ? Math.min(meta.size, PREVIEW_PHASE_BYTES) : 0;
    const quickPhaseBytes = meta.size > QUICK_TAIL_BYTES ? QUICK_TAIL_BYTES : 0;
    const progressPhaseCount = 1 + (previewPhaseBytes > 0 ? 1 : 0) + (quickPhaseBytes > 0 ? 1 : 0);
    const commandPreview = strategy.kind === "bastion-sftp"
      ? `[SFTP 网关搜索] ${filePath}`
      : buildStreamingSearchCommand(server, { ...request, filePath }, meta.size);
    const strategyLabel = strategy.kind === "bastion-sftp" ? "SFTP 分块读取 · 网关搜索" : describeSearchStrategy(request, Boolean(previewCommand));
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
      chunkLabel: previewPhaseBytes > 0
        ? `准备首批快搜 · 0 B / ${formatBytes(previewPhaseBytes)}`
        : quickPhaseBytes > 0
          ? `准备尾部快搜 · 0 B / ${formatBytes(quickPhaseBytes)}`
          : `准备全文扫描 · 0 B / ${formatBytes(meta.size)}`,
      progressPhase: "queued",
      progressPhaseLabel: previewPhaseBytes > 0 ? "准备首批快搜" : quickPhaseBytes > 0 ? "准备尾部快搜" : "准备全文扫描",
      progressPhaseIndex: 1,
      progressPhaseCount,
      phaseScannedBytes: 0,
      phaseTotalBytes: previewPhaseBytes > 0 ? previewPhaseBytes : quickPhaseBytes > 0 ? quickPhaseBytes : meta.size,
      quickPhaseBytes,
      previewPhaseBytes,
      previewCommand,
      commandPreview,
      strategyLabel,
      scopeLabel,
      matches: [],
      allLines: [],
      quickMatches: [],
      quickAllLines: [],
      quickDone: false,
      matchTotal: 0,
      matchDropped: 0,
      quickMatchTotal: 0,
      resultVersion: 0
    };

    this.tasks.set(taskId, task);
    this.pruneExpiredTasks();

    if (isBastionSftpStrategy(strategy)) {
      void this.runTaskViaSftp(task, strategy);
    } else if (isDirectStrategy(strategy)) {
      void this.runTaskDirect(task, strategy);
    }

    return this.toResponse(task);
  }

  get(taskId: string, since?: number): LogSearchTaskResponse {
    const task = this.tasks.get(taskId);
    if (!task) {
      throw new Error("搜索任务不存在或已过期");
    }

    return this.toResponse(task, since);
  }

  /**
   * 回收过期任务（2026-11-19）。此前 tasks 只增不删，大文件检索的结果数组
   * 会一直驻留到进程退出；配合主进程内 import 的 gateway，等于持续占用主进程内存。
   */
  private pruneExpiredTasks() {
    const now = Date.now();
    for (const [id, task] of this.tasks) {
      const finished = task.finishedAt ?? 0;
      const isSettled = finished > 0;
      if (isSettled && now - finished > TASK_TTL_MS) {
        this.tasks.delete(id);
        continue;
      }
      /* 未结束但长期无进展的任务同样回收，避免卡死任务永久占内存 */
      if (!isSettled && now - task.startedAt > TASK_TTL_MS) {
        task.status = "failed";
        task.errorMessage = "检索超时，任务已回收";
        task.finishedAt = now;
      }
    }
  }

  /**
   * 是否已达保留上限。用于在**解析之前**短路：超限后不再浪费 CPU 去
   * split 行、构造对象（实测 50 万条命中下，跳过解析可省约 95% 的解析耗时）。
   * 命中总数仍精确 —— 调用方用 countOverflowMatch 单独计数。
   */
  private isMatchCapReached(task: SearchTaskState, target: "full" | "quick"): boolean {
    const isQuick = target === "quick";
    const matchesArr = isQuick ? task.quickMatches : task.matches;
    const matchCap = isQuick ? MAX_STORED_QUICK_MATCHES : MAX_STORED_MATCHES;
    return matchesArr.length >= matchCap;
  }

  /** 超限时的轻量计数（不解析、不建对象） */
  private countOverflowMatch(task: SearchTaskState, target: "full" | "quick") {
    if (target === "quick") {
      task.quickMatchTotal += 1;
      return;
    }
    task.matchTotal += 1;
    task.matchDropped += 1;
    task.matchCount = task.matchTotal;
  }

  /**
   * 统一的命中收集入口：超过上限后只计数不保留（rg / lnav / klogg 的通行做法）。
   * 这样内存占用恒定为 O(上限)，而命中总数依旧精确。
   */
  private collectMatch(
    task: SearchTaskState,
    target: "full" | "quick",
    match: LogSearchMatch,
    contextLines: Array<{ lineNumber: number; preview: string; isMatch: boolean }> = []
  ) {
    const isQuick = target === "quick";
    const matchesArr = isQuick ? task.quickMatches : task.matches;
    const allLinesArr = isQuick ? task.quickAllLines : task.allLines;

    if (isQuick) {
      task.quickMatchTotal += 1;
    } else {
      task.matchTotal += 1;
      /* matchCount 表示「最终结果的命中总数」，只取全文扫描。
         不能把首批快搜也加进来：首批（前 512KB）与尾部快搜（末 5MB）
         会和全文扫描重复计数，且完成时若再改回全文数，命中数会在
         检索结束那一刻突然变小。 */
      task.matchCount = task.matchTotal;
    }

    if (matchesArr.length >= (isQuick ? MAX_STORED_QUICK_MATCHES : MAX_STORED_MATCHES)) {
      if (!isQuick) task.matchDropped += 1;
      return;
    }

    /* 超长行在入口即截断：保证任何后续 join/map 都不会撞上 V8 字符串上限 */
    const boundedMatch: LogSearchMatch = {
      source: match.source,
      lineNumber: match.lineNumber,
      preview: clampPreview(match.preview)
    };
    matchesArr.push(boundedMatch);

    for (const contextLine of contextLines) {
      if (allLinesArr.length >= MAX_STORED_RESULT_LINES) break;
      allLinesArr.push({ ...contextLine, preview: clampPreview(contextLine.preview) });
    }
    if (allLinesArr.length < MAX_STORED_RESULT_LINES) {
      allLinesArr.push({ lineNumber: boundedMatch.lineNumber, preview: boundedMatch.preview, isMatch: true });
    }
  }

  private setProgressPhase(task: SearchTaskState, phase: SearchProgressPhase) {
    task.progressPhase = phase;
    if (phase === "queued") {
      task.progressPhaseLabel = task.previewPhaseBytes > 0 ? "准备首批快搜" : task.quickPhaseBytes > 0 ? "准备尾部快搜" : "准备全文扫描";
      task.progressPhaseIndex = 1;
      task.phaseTotalBytes = task.previewPhaseBytes > 0 ? task.previewPhaseBytes : task.quickPhaseBytes > 0 ? task.quickPhaseBytes : task.totalBytes;
      task.phaseScannedBytes = 0;
    } else if (phase === "preview_scan") {
      task.progressPhaseLabel = "首批快搜";
      task.progressPhaseIndex = 1;
      task.phaseTotalBytes = task.previewPhaseBytes;
      task.phaseScannedBytes = 0;
    } else if (phase === "quick_tail") {
      task.progressPhaseLabel = "尾部快搜";
      task.progressPhaseIndex = task.previewPhaseBytes > 0 ? 2 : 1;
      task.phaseTotalBytes = task.quickPhaseBytes;
      task.phaseScannedBytes = 0;
    } else if (phase === "full_scan") {
      task.progressPhaseLabel = "全文扫描";
      task.progressPhaseIndex = 1 + (task.previewPhaseBytes > 0 ? 1 : 0) + (task.quickPhaseBytes > 0 ? 1 : 0);
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
    const completedBeforePhase =
      (task.progressPhase === "quick_tail" || task.progressPhase === "full_scan" || task.progressPhase === "completed" ? task.previewPhaseBytes : 0) +
      (task.progressPhase === "full_scan" || task.progressPhase === "completed" ? task.quickPhaseBytes : 0);
    return Math.min(this.getOverallProgressTotalBytes(task), completedBeforePhase + Math.min(task.phaseScannedBytes, task.phaseTotalBytes));
  }

  private getOverallProgressTotalBytes(task: SearchTaskState) {
    return task.totalBytes + task.previewPhaseBytes + task.quickPhaseBytes;
  }

  private async runTaskDirect(task: SearchTaskState, strategy: import("./strategies/index.js").DirectConnectionStrategy) {
    task.status = "running";
    task.startedAt = Date.now();

    const needsQuickPhase = task.quickPhaseBytes > 0;

    const runStreamingPhase = (
      command: string,
      target: "full" | "quick",
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
            /* 上下文行同样受限，避免 contextLines=20 时膨胀 20 倍；
               达到上限后连解析也跳过 */
            if (allLinesArr.length >= MAX_STORED_RESULT_LINES) return;
            const parts = line.split("\t");
            const lineNumber = Number(parts[1] || "0");
            const preview = parts.slice(2).join("\t");
            allLinesArr.push({ lineNumber, preview, isMatch: false });
            return;
          }
          if (line.startsWith("__MATCH__\t")) {
            /* 已到保留上限：只计数，跳过 split 与对象构造（省掉大量 CPU） */
            if (this.isMatchCapReached(task, target)) {
              this.countOverflowMatch(task, target);
              return;
            }
            const parts = line.split("\t");
            const lineNumber = Number(parts[1] || "0");
            const preview = parts.slice(2).join("\t");
            this.collectMatch(task, target, { source: task.request.filePath, lineNumber, preview });
          }
        };

        /*
         * 超长单行保护（2026-11-19）。
         *
         * 实测：11 GB catalina.out 中存在「整条批量 INSERT」式超长行，
         * 单行可达数 MB。grep 输出 `__MATCH__\t<行号>\t<整行内容>` 时，
         * 在换行符到达前 pendingStdout 会持续累积整行 —— 主进程内存出现
         * 600MB→1.6GB→600MB 的剧烈锯齿，界面随之卡顿。
         *
         * 方案：一旦当前未完成行超过上限，就把已收到的头部按「截断命中」记下，
         * 并置 skippingLongLine 状态丢弃该行剩余部分，直到读到换行符。
         * 缓冲因此恒定有界（<= 上限 + 单块大小），不再随行长增长。
         */
        const MAX_BUFFER_CHARS = MAX_MATCH_PREVIEW_CHARS * 4;
        let skippingLongLine = false;

        const flushBuffer = (buffer: string, kind: "stdout" | "stderr") => {
          let buf = buffer;

          if (skippingLongLine) {
            /* 仍在丢弃上一行超长行的余量，直到遇到换行 */
            const nl = buf.indexOf("\n");
            if (nl < 0) {
              return ""; /* 整块都属于超长行，直接丢 */
            }
            buf = buf.slice(nl + 1);
            skippingLongLine = false;
          }

          for (;;) {
            const nl = buf.indexOf("\n");
            if (nl < 0) break;
            const line = buf.slice(0, nl).replace(/\r$/, "");
            buf = buf.slice(nl + 1);
            if (kind === "stdout") consumeLine(line);
            else if (line.trim()) task.errorMessage = line.trim();
          }

          /* 剩下的最后一行（无换行结尾）若已超长，立即截断并进入跳过模式 */
          if (buf.length > MAX_BUFFER_CHARS) {
            if (kind === "stdout" && buf.startsWith("__MATCH__\t")) {
              const parts = buf.slice(0, MAX_BUFFER_CHARS).split("\t");
              const lineNumber = Number(parts[1] || "0");
              const preview = parts.slice(2).join("\t");
              this.collectMatch(task, target, {
                source: task.request.filePath,
                lineNumber,
                preview: `${preview} …[单行过长，已截断]`
              });
            }
            skippingLongLine = true;
            return "";
          }

          return buf;
        };

        try {
          const handle = await strategy.execStreaming(command, 120000);
          /*
           * 分块喂入（2026-11-19）。
           * flushBuffer 已保证返回值有界（超长行被跳过），但单次 chunk 若异常大，
           * `pendingStdout + chunk` 这一步本身仍是一次大分配。
           * 这里把超大 chunk 再切片，保证任何单次临时字符串都有上界。
           */
          const MAX_CHUNK_CHARS = 256 * 1024;
          const feed = (target2: "stdout" | "stderr", chunk: string) => {
            if (chunk.length <= MAX_CHUNK_CHARS) {
              if (target2 === "stdout") pendingStdout = flushBuffer(pendingStdout + chunk, "stdout");
              else pendingStderr = flushBuffer(pendingStderr + chunk, "stderr");
              return;
            }
            for (let i = 0; i < chunk.length; i += MAX_CHUNK_CHARS) {
              const piece = chunk.slice(i, i + MAX_CHUNK_CHARS);
              if (target2 === "stdout") pendingStdout = flushBuffer(pendingStdout + piece, "stdout");
              else pendingStderr = flushBuffer(pendingStderr + piece, "stderr");
            }
          };

          handle.onStdout((chunk) => feed("stdout", chunk));
          handle.onStderr((chunk) => feed("stderr", chunk));
          handle.onClose((code) => {
            flushBuffer(`${pendingStdout}\n`, "stdout");
            flushBuffer(`${pendingStderr}\n`, "stderr");
            /* 命中超限时数组可能为空（只计数），故用总量判断是否已有命中 */
            const hasHits = target === "quick" ? task.quickMatchTotal > 0 : task.matchTotal > 0;
            if (code && code !== 0 && !hasHits) {
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
      if (task.previewCommand) {
        this.setProgressPhase(task, "preview_scan");
        const previewStartedAt = Date.now();
        await runStreamingPhase(task.previewCommand, "quick", task.quickAllLines);
        this.updatePhaseProgress(task, task.previewPhaseBytes, task.quickMatches.length);
        task.quickDone = true;
        task.resultVersion += 1;
        console.log(`[search-preview] First ${PREVIEW_MATCH_LIMIT} matches done: ${task.quickMatches.length} matches in ${Date.now() - previewStartedAt}ms`);
      }

      if (needsQuickPhase) {
        this.setProgressPhase(task, "quick_tail");
        const quickCommand = buildStreamingSearchCommand(task.server, task.request, task.totalBytes, { tailBytes: QUICK_TAIL_BYTES });
        await runStreamingPhase(quickCommand, "quick", task.quickAllLines);
        task.quickDone = true;
        task.resultVersion += 1;
        console.log(`[search] Phase 1 done: ${task.quickMatches.length} quick matches in tail ${formatBytes(QUICK_TAIL_BYTES)}`);
      }

      this.setProgressPhase(task, "full_scan");
      const fullCommand = buildStreamingSearchCommand(task.server, task.request, task.totalBytes);
      await runStreamingPhase(fullCommand, "full", task.allLines);

      task.matchCount = task.matchTotal;
      task.resultVersion += 1;
      task.status = "completed";
      this.setProgressPhase(task, "completed");
      task.finishedAt = Date.now();
      this.pruneExpiredTasks();
    } catch (error) {
      task.status = "failed";
      task.errorMessage = error instanceof Error ? error.message : String(error);
      task.finishedAt = Date.now();
      this.pruneExpiredTasks();
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
      target: "full" | "quick",
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

          /*
           * 已到保留上限：只累计命中数，不再构造行对象。
           * 注意不能用 continue 跳过尾部 —— 上下文缓冲（contextBuffer）与
           * pendingAfter 的状态必须继续推进，否则后续若因上限放宽而恢复
           * 收集时，上下文会对不齐。
           */
          const cappedHit = hit && this.isMatchCapReached(task, target);
          if (cappedHit) {
            this.countOverflowMatch(task, target);
            lastPrinted = lineNumber;
            pendingAfter = context;
          } else if (hit) {
            const leadingContext: Array<{ lineNumber: number; preview: string; isMatch: boolean }> = [];
            if (context > 0) {
              const start = Math.max(1, lineNumber - context);
              for (let i = start; i < lineNumber; i++) {
                const buffered = contextBuffer.get(i);
                if (buffered !== undefined && lastPrinted !== i) {
                  leadingContext.push({ lineNumber: i, preview: buffered, isMatch: false });
                  lastPrinted = i;
                }
              }
            }
            this.collectMatch(task, target, { source: task.request.filePath, lineNumber, preview: line }, leadingContext);
            lastPrinted = lineNumber;
            pendingAfter = context;
          } else if (pendingAfter > 0 && lastPrinted !== lineNumber) {
            if (allLinesArr.length < MAX_STORED_RESULT_LINES) {
              allLinesArr.push({ lineNumber, preview: line, isMatch: false });
            }
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
          const leadingContext: Array<{ lineNumber: number; preview: string; isMatch: boolean }> = [];
          if (context > 0) {
            const start = Math.max(1, lineNumber - context);
            for (let i = start; i < lineNumber; i++) {
              const buffered = contextBuffer.get(i);
              if (buffered !== undefined && lastPrinted !== i) {
                leadingContext.push({ lineNumber: i, preview: buffered, isMatch: false });
                lastPrinted = i;
              }
            }
          }
          this.collectMatch(task, target, { source: task.request.filePath, lineNumber, preview: line }, leadingContext);
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
        await scanChunks(session, tailOffset, fileSize, "quick", task.quickAllLines);
        task.quickDone = true;
        task.resultVersion += 1;
        console.log(`[search-sftp] Phase 1 done: ${task.quickMatches.length} quick matches in tail ${formatBytes(QUICK_TAIL_BYTES)}`);
      }

      this.setProgressPhase(task, "full_scan");
      await scanChunks(session, 0, fileSize, "full", task.allLines);

      task.scannedLines = task.matchTotal;
      task.matchCount = task.matchTotal;
      task.resultVersion += 1;
      task.status = "completed";
      this.setProgressPhase(task, "completed");
      task.finishedAt = Date.now();
      this.pruneExpiredTasks();
    } catch (error) {
      task.status = "failed";
      task.errorMessage = error instanceof Error ? error.message : String(error);
      task.finishedAt = Date.now();
      this.pruneExpiredTasks();
    } finally {
      session?.close();
    }
  }

  private toResponse(task: SearchTaskState, since?: number): LogSearchTaskResponse {
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
      overallProgressTotalBytes,
      resultVersion: task.resultVersion
    };

    /*
     * 条件返回（2026-11-19）：前端轮询带 since=<已收到的版本号>。
     * 版本未变时只回进度标量，不再重复下发整份命中列表 —— 这是每 450 ms
     * 序列化上百 MB 的直接来源。
     * 注意：完成态必须至少下发一次，否则前端永远拿不到最终结果，
     * 故用 since < resultVersion 判断而非单纯比较相等。
     */
    const clientVersion = Number.isFinite(since) ? Number(since) : -1;
    const shouldSendResult = clientVersion < task.resultVersion;

    if (!shouldSendResult) {
      return response;
    }

    // Phase 1 quick results (available while Phase 2 is still running)
    if (task.quickDone && !response.result) {
      response.quickResult = this.getCachedQuickResult(task);
    }

    if (task.status === "completed") {
      response.result = this.getCachedFinalResult(task);
    }

    return response;
  }

  /**
   * 首批结果的惰性构建 + 缓存（2026-11-19）。
   * 轮询期间数据未变就直接复用，避免每 450 ms 重排/重拼一次。
   */
  private getCachedQuickResult(task: SearchTaskState): LogSearchResponse {
    const cache = this.ensureResponseCache(task);
    const key = `${task.quickMatches.length}:${task.quickAllLines.length}`;
    if (cache.quickKey === key && cache.quickResult) {
      return cache.quickResult;
    }

    const qMatches = task.quickMatches;
    const result: LogSearchResponse = {
      commandPreview: task.commandPreview,
      /* 首批结果超出保留上限时，如实告知前端已被截断 */
      truncated: task.quickMatchTotal > qMatches.length,
      matches: qMatches,
      rawOutput: qMatches.map((m) => `${m.source}:${m.lineNumber}:${m.preview}`).join("\n"),
      contextOutput: this.buildContextOutput(task.quickAllLines, qMatches.length),
      strategyLabel: task.strategyLabel,
      scopeLabel: task.scopeLabel
    };

    cache.quickKey = key;
    cache.quickResult = result;
    return result;
  }

  private getCachedFinalResult(task: SearchTaskState): LogSearchResponse {
    const cache = this.ensureResponseCache(task);
    const key = `${task.matches.length}:${task.allLines.length}:${task.matchTotal}`;
    if (cache.finalKey === key && cache.finalResult) {
      return cache.finalResult;
    }

    const result: LogSearchResponse = {
      commandPreview: task.commandPreview,
      truncated: task.matchTotal > task.matches.length,
      matches: task.matches,
      rawOutput: task.matches.map((match) => `${match.source}:${match.lineNumber}:${match.preview}`).join("\n"),
      contextOutput: this.buildContextOutput(task.allLines, task.matches.length),
      strategyLabel: task.strategyLabel,
      scopeLabel: task.scopeLabel
    };

    cache.finalKey = key;
    cache.finalResult = result;
    return result;
  }

  private ensureResponseCache(task: SearchTaskState) {
    if (!task.responseCache) {
      task.responseCache = { quickKey: "", finalKey: "" };
    }
    return task.responseCache;
  }

  /** 仅在「有上下文行」时才拼 contextOutput；否则返回 undefined，省掉一份完整副本 */
  private buildContextOutput(
    allLines: Array<{ lineNumber: number; preview: string; isMatch: boolean }>,
    matchCount: number
  ): string | undefined {
    if (allLines.length <= matchCount) {
      return undefined;
    }

    const sorted = [...allLines].sort((a, b) => a.lineNumber - b.lineNumber);
    const parts: string[] = [];
    let prevLineNumber = -1;
    for (const entry of sorted) {
      if (prevLineNumber >= 0 && entry.lineNumber > prevLineNumber + 1) {
        parts.push("--");
      }
      parts.push(`${entry.lineNumber} | ${entry.preview}`);
      prevLineNumber = entry.lineNumber;
    }
    return parts.join("\n");
  }
}

function describeSearchStrategy(request: LogSearchRequest, hasPreviewFastPath = false) {
  const singleDay = Boolean(request.startDate && request.endDate && request.startDate === request.endDate);
  const singleKeyword = (request.keywordTerms?.filter((item) => item.trim()).length ?? 0) <= 1 && Boolean(request.keyword?.trim() || request.keywordTerms?.[0]?.trim());
  const hasTimeRange = Boolean(request.startTime?.trim() || request.endTime?.trim());

  if (hasPreviewFastPath) {
    return "首批快搜 · rg/grep + 全文校验";
  }

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
