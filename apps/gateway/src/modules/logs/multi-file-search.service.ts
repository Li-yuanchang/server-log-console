import { z } from "zod";
import type { MultiFileLogSearchRequest, MultiFileLogSearchResponse, LogSearchMatch, ServerSummary } from "@server-log-console/shared";
import { ServerRegistryService } from "../servers/server-registry.service.js";
import { SshExecutorService } from "./ssh-executor.service.js";
import { shellEscape } from "./remote-shell.js";

const multiFileSearchSchema = z.object({
  serverId: z.string(),
  directoryPath: z.string(),
  filePattern: z.string().optional(),
  keyword: z.string().optional(),
  keywordTerms: z.array(z.string()).optional(),
  keywordMode: z.enum(["phrase", "any", "all"]).optional(),
  excludeTerms: z.array(z.string()).optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  startTime: z.string().optional(),
  endTime: z.string().optional(),
  useRegex: z.boolean().optional(),
  maxFiles: z.number().int().min(1).max(200).optional()
});

export class MultiFileSearchService {
  constructor(
    private readonly serverRegistry: ServerRegistryService,
    private readonly sshExecutor: SshExecutorService
  ) {}

  async search(rawRequest: unknown): Promise<MultiFileLogSearchResponse> {
    const request = multiFileSearchSchema.parse(rawRequest) as MultiFileLogSearchRequest;
    const server = this.serverRegistry.getServer(request.serverId);
    const command = this.buildMultiFileSearchCommand(server, request);
    const remoteOutput = await this.sshExecutor.exec(server.id, command, 120_000);
    const matches = this.parseMultiFileMatches(remoteOutput);
    const matchedFiles = new Set(matches.map((m) => m.source)).size;
    const maxFiles = request.maxFiles || 50;

    return {
      matches,
      scannedFiles: matchedFiles,
      matchedFiles,
      commandPreview: command,
      scopeLabel: `${server.name} · ${request.directoryPath} · ${request.filePattern || "*.log"}`
    };
  }

  private buildMultiFileSearchCommand(server: ServerSummary, request: MultiFileLogSearchRequest): string {
    const dir = shellEscape(request.directoryPath);
    const pattern = request.filePattern?.trim() || "*.log";
    const maxFiles = request.maxFiles || 50;
    const keywordTerms = (request.keywordTerms?.filter((item) => item.trim()) ?? []).map((item) => item.trim());
    const excludeTerms = (request.excludeTerms?.filter((item) => item.trim()) ?? []).map((item) => item.trim());
    const useRegex = Boolean(request.useRegex);
    const keywordMode = request.keywordMode || "phrase";

    // Build grep pattern
    let grepPattern: string;
    if (keywordTerms.length === 0) {
      grepPattern = ".";
    } else if (keywordMode === "phrase" && keywordTerms.length === 1) {
      grepPattern = useRegex ? keywordTerms[0] : shellEscape(keywordTerms[0]);
    } else if (keywordMode === "any") {
      grepPattern = useRegex
        ? keywordTerms.join("|")
        : keywordTerms.map((t) => shellEscape(t)).join("\\|");
    } else {
      // "all" mode: we'll use awk for multi-term AND matching
      grepPattern = ".";
    }

    // For "all" mode, use find + awk (similar to single-file search but across files)
    if (keywordMode === "all" && keywordTerms.length > 1) {
      return this.buildAwkMultiFileCommand(dir, pattern, maxFiles, keywordTerms, excludeTerms, useRegex, request);
    }

    // For phrase/any mode, use find + grep
    const grepFlags = useRegex ? "-E" : "-F";
    const excludeGrepArgs = excludeTerms.length
      ? excludeTerms.map((t) => `| grep -v ${useRegex ? "-E" : "-F"} ${shellEscape(t)}`).join("")
      : "";

    // Date range filtering via awk
    const hasDateRange = Boolean(request.startDate || request.endDate);
    const dateFilterScript = hasDateRange
      ? this.buildDateFilterAwk(request.startDate, request.endDate, request.startTime, request.endTime)
      : "";

    if (dateFilterScript) {
      return `find ${dir} -maxdepth 3 -name ${shellEscape(pattern)} -type f 2>/dev/null | head -${maxFiles} | while IFS= read -r f; do grep -nH ${grepFlags} ${grepPattern} "$f" 2>/dev/null${excludeGrepArgs} | ${dateFilterScript}; done`;
    }

    return `find ${dir} -maxdepth 3 -name ${shellEscape(pattern)} -type f 2>/dev/null | head -${maxFiles} | while IFS= read -r f; do grep -nH ${grepFlags} ${grepPattern} "$f" 2>/dev/null${excludeGrepArgs}; done`;
  }

  private buildAwkMultiFileCommand(
    dir: string, pattern: string, maxFiles: number,
    keywordTerms: string[], excludeTerms: string[], useRegex: boolean,
    request: MultiFileLogSearchRequest
  ): string {
    const awkVariables: string[] = [];
    const termAssignments: string[] = [];
    keywordTerms.forEach((term, index) => {
      awkVariables.push(`-v term_${index + 1}=${shellEscape(term)}`);
      termAssignments.push(`  terms[${index + 1}] = term_${index + 1};`);
    });
    awkVariables.push(`-v term_count=${keywordTerms.length}`);

    const excludeAssignments: string[] = [];
    excludeTerms.forEach((term, index) => {
      awkVariables.push(`-v exc_${index + 1}=${shellEscape(term)}`);
      excludeAssignments.push(`  excludes[${index + 1}] = exc_${index + 1};`);
    });
    awkVariables.push(`-v exclude_count=${excludeTerms.length}`);

    const hasDateRange = Boolean(request.startDate || request.endDate);
    const dateRangeAssignments = hasDateRange
      ? this.buildDateRangeAwkVariables(request.startDate, request.endDate, request.startTime, request.endTime)
      : { variables: [] as string[], assignments: [] as string[], functions: "" };

    const allVariables = [...awkVariables, ...dateRangeAssignments.variables];
    const allAssignments = [...termAssignments, ...excludeAssignments, ...dateRangeAssignments.assignments];

    const script = [
      "BEGIN {",
      ...allAssignments,
      "  termsCount = term_count + 0;",
      "  excludesCount = exclude_count + 0;",
      "}",
      "function keywordHit(line,   i, hit) {",
      "  hit = 1;",
      "  for (i = 1; i <= termsCount; i++) {",
      useRegex
        ? "    if (line !~ terms[i]) { hit = 0; break; }"
        : "    if (index(tolower(line), tolower(terms[i])) == 0) { hit = 0; break; }",
      "  }",
      "  return hit;",
      "}",
      "function excludeHit(line,   i) {",
      "  if (excludesCount == 0) return 0;",
      "  for (i = 1; i <= excludesCount; i++) {",
      "    if (index(line, excludes[i]) > 0) return 1;",
      "  }",
      "  return 0;",
      "}",
      dateRangeAssignments.functions,
      hasDateRange ? "  hit = keywordHit($0) && !excludeHit($0) && inRange($0);" : "  hit = keywordHit($0) && !excludeHit($0);",
      "  if (hit) { print FILENAME \":\" NR \":\" $0; }",
    ].filter(Boolean);

    return `find ${dir} -maxdepth 3 -name ${shellEscape(pattern)} -type f 2>/dev/null | head -${maxFiles} | while IFS= read -r f; do awk ${allVariables.map((v) => `-v ${v}`).join(" ")} '${script.join("\\n")}' "$f" 2>/dev/null; done`;
  }

  private buildDateFilterAwk(startDate?: string, endDate?: string, startTime?: string, endTime?: string): string {
    const parts: string[] = [];
    parts.push("awk -v sdate=" + shellEscape(startDate || ""));
    parts.push("-v edate=" + shellEscape(endDate || ""));
    parts.push("-v stime=" + shellEscape(startTime || ""));
    parts.push("-v etime=" + shellEscape(endTime || ""));
    parts.push("'");
    parts.push("{ line = $0 }");
    parts.push("function inRange(line) {");
    parts.push("  d = \"\"; t = \"\";");
    parts.push("  if (match(line, /[0-9]{4}[-/][0-9]{2}[-/][0-9]{2}/)) { d = substr(line, RSTART, RLENGTH); gsub(/\\//, \"-\", d); }");
    parts.push("  if (match(line, /[0-9]{2}:[0-9]{2}:[0-9]{2}/)) { t = substr(line, RSTART, RLENGTH); }");
    parts.push("  if (sdate && d < sdate) return 0;");
    parts.push("  if (edate && d > edate) return 0;");
    parts.push("  if (sdate && stime && d == sdate && t && t < stime) return 0;");
    parts.push("  if (edate && etime && d == edate && t && t > etime) return 0;");
    parts.push("  return 1;");
    parts.push("}");
    parts.push("inRange(line) { print }");
    parts.push("'");
    return parts.join(" ");
  }

  private buildDateRangeAwkVariables(startDate?: string, endDate?: string, startTime?: string, endTime?: string): { variables: string[]; assignments: string[]; functions: string } {
    const variables: string[] = [];
    const assignments: string[] = [];
    if (startDate) { variables.push(`sdate=${shellEscape(startDate)}`); assignments.push("  sd = sdate;"); }
    if (endDate) { variables.push(`edate=${shellEscape(endDate)}`); assignments.push("  ed = edate;"); }
    if (startTime) { variables.push(`stime=${shellEscape(startTime)}`); assignments.push("  st = stime;"); }
    if (endTime) { variables.push(`etime=${shellEscape(endTime)}`); assignments.push("  et = etime;"); }

    const functions = [
      "function inRange(line,   d,t) {",
      "  d = \"\"; t = \"\";",
      "  if (match(line, /[0-9]{4}[-/][0-9]{2}[-/][0-9]{2}/)) { d = substr(line, RSTART, RLENGTH); gsub(/\\//, \"-\", d); }",
      "  if (match(line, /[0-9]{2}:[0-9]{2}:[0-9]{2}/)) { t = substr(line, RSTART, RLENGTH); }",
      "  if (sd && d < sd) return 0;",
      "  if (ed && d > ed) return 0;",
      "  if (sd && st && d == sd && t && t < st) return 0;",
      "  if (ed && et && d == ed && t && t > et) return 0;",
      "  return 1;",
      "}"
    ].join("\\n");

    return { variables, assignments, functions };
  }

  private parseMultiFileMatches(rawOutput: string): LogSearchMatch[] {
    return rawOutput
      .split("\n")
      .map((line) => {
        const match = line.match(/^(.*?):(\d+):(.*)$/);
        if (!match) return null;
        return {
          source: match[1],
          lineNumber: Number(match[2]),
          preview: match[3].trim()
        } satisfies LogSearchMatch;
      })
      .filter((item): item is LogSearchMatch => Boolean(item));
  }
}
