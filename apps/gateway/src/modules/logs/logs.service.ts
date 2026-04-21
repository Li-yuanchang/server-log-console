import { z } from "zod";
import type { LiveTailRequest, LogSearchMatch, LogSearchRequest, LogSearchResponse, ServerSummary } from "@server-log-console/shared";
import { buildSearchCommand, buildTailCommand } from "./command-builder.js";
import { ServerRegistryService } from "../servers/server-registry.service.js";
import { SshExecutorService } from "./ssh-executor.service.js";

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

const liveTailSchema = z.object({
  serverId: z.string(),
  filePath: z.string(),
  keyword: z.string().optional()
});

export class LogsService {
  constructor(
    private readonly serverRegistry: ServerRegistryService,
    private readonly sshExecutor: SshExecutorService
  ) {}

  getServer(serverId: string): ServerSummary {
    return this.serverRegistry.getServer(serverId);
  }

  async search(rawRequest: unknown): Promise<LogSearchResponse> {
    const request = searchSchema.parse(rawRequest) as LogSearchRequest;
    const server = this.getServer(request.serverId);
    const command = buildSearchCommand(server, request);
    const remoteOutput = await this.sshExecutor.exec(server.id, command);
    const rawOutput = [`# Host: ${server.host}`, `# Command: ${command}`, remoteOutput].join("\n");
    const strategyLabel = describeSearchStrategy(request);
    const scopeLabel = describeSearchScope(request, server, request.filePath || `${server.basePath}/catalina.out`);

    return {
      commandPreview: command,
      truncated: remoteOutput.length > 100_000,
      matches: parseMatches(remoteOutput),
      rawOutput,
      strategyLabel,
      scopeLabel
    };
  }

  async startLiveTail(rawRequest: unknown): Promise<{ sessionId: string; commandPreview: string }> {
    const request = liveTailSchema.parse(rawRequest) as LiveTailRequest;
    const server = this.getServer(request.serverId);
    const command = buildTailCommand(request.filePath, request.keyword);

    return {
      sessionId: `${server.id}-${Date.now()}`,
      commandPreview: command
    };
  }
}

function describeSearchStrategy(request: LogSearchRequest) {
  const singleDay = Boolean(request.startDate && request.endDate && request.startDate === request.endDate);
  const singleKeyword = (request.keywordTerms?.filter((item) => item.trim()).length ?? 0) <= 1 && Boolean(request.keyword?.trim() || request.keywordTerms?.[0]?.trim());
  const hasTimeRange = Boolean(request.startTime?.trim() || request.endTime?.trim());

  if (!request.useRegex && (request.keywordMode || "phrase") === "phrase" && singleKeyword && singleDay && !hasTimeRange) {
    return "单日快筛";
  }

  if (!request.useRegex && (request.keywordMode || "phrase") === "phrase" && singleKeyword) {
    return "关键字快筛";
  }

  if (request.useRegex) {
    return "正则扫描";
  }

  if (request.startDate || request.endDate) {
    return "日期范围扫描";
  }

  return "全文件扫描";
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

function parseMatches(rawOutput: string): LogSearchMatch[] {
  return rawOutput
    .split("\n")
    .map((line) => {
      const match = line.match(/^(.*?):(\d+):(.*)$/);
      if (!match) {
        return null;
      }
      return {
        source: match[1],
        lineNumber: Number(match[2]),
        preview: match[3].trim()
      } satisfies LogSearchMatch;
    })
    .filter((item): item is LogSearchMatch => Boolean(item));
}
