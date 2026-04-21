import type {
  LogLineContextResponse,
  LogSearchResponse,
  ServerConnectionTestResponse,
  ServerSummary
} from "@server-log-console/shared";

export const previewSliceLength = 12 * 1024;
export const previewBucketSize = 256 * 1024;

export function formatBytes(size?: number) {
  if (typeof size !== "number" || Number.isNaN(size)) {
    return "--";
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

export function formatNumber(value?: number) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "--";
  }

  return value.toLocaleString("zh-CN");
}

export function formatDateTime(value?: string) {
  if (!value) {
    return "--";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "--";
  }

  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  const hour = `${date.getHours()}`.padStart(2, "0");
  const minute = `${date.getMinutes()}`.padStart(2, "0");
  return `${year}-${month}-${day} ${hour}:${minute}`;
}

export function formatPercent(value?: number) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "--";
  }

  if (value > 99 && value < 100) {
    return `${value.toFixed(2)}%`;
  }

  if (value > 0 && value < 1) {
    return `${value.toFixed(2)}%`;
  }

  return `${value.toFixed(value >= 10 ? 0 : 1)}%`;
}

export function formatSliceProgressLabel(progress: { start: number; end: number } | null, options?: { dragging?: boolean; draft?: number }) {
  if (options?.dragging) {
    return `${formatPercent(options.draft)} 附近`;
  }

  if (!progress) {
    return "--";
  }

  const span = Math.abs(progress.end - progress.start);
  if (span < 0.2) {
    return `${formatPercent(progress.start)} 附近`;
  }

  return `${formatPercent(progress.start)} - ${formatPercent(progress.end)}`;
}

export function truncateText(value: string, length: number) {
  if (value.length <= length) {
    return value;
  }

  return `${value.slice(0, Math.max(0, length - 1))}…`;
}

export function getLocalDateString() {
  const now = new Date();
  const year = now.getFullYear();
  const month = `${now.getMonth() + 1}`.padStart(2, "0");
  const day = `${now.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function formatDurationLabel(startedAt: number, now: number) {
  const seconds = Math.max(0, Math.floor((now - startedAt) / 1000));
  if (seconds < 60) {
    return `${seconds}s`;
  }

  const minutes = Math.floor(seconds / 60);
  const remainSeconds = seconds % 60;
  return `${minutes}m ${remainSeconds}s`;
}

export function describeSearchStrategyClient(keywordMode: "phrase" | "any" | "all", keywordTerms: string[], useRegex: boolean, startDate: string, endDate: string, startTime: string, endTime: string) {
  const singleDay = Boolean(startDate && endDate && startDate === endDate);
  const singleKeyword = keywordTerms.length <= 1 && keywordTerms.length > 0;
  const hasTimeRange = Boolean(startTime.trim() || endTime.trim());

  if (!useRegex && keywordMode === "phrase" && singleKeyword && singleDay && !hasTimeRange) {
    return "单日快筛";
  }

  if (!useRegex && keywordMode === "phrase" && singleKeyword) {
    return "关键字快筛";
  }

  if (useRegex) {
    return "正则扫描";
  }

  if (startDate || endDate) {
    return "日期范围扫描";
  }

  return "全文件扫描";
}

export function describeSearchScopeClient(filePath: string, startDate: string, endDate: string, startTime: string, endTime: string, keywordTerms: string[]) {
  const dateLabel = startDate || endDate
    ? `${startDate || endDate}${startTime ? ` ${startTime}` : ""} ~ ${endDate || startDate}${endTime ? ` ${endTime}` : ""}`
    : "未限制日期";

  return `${filePath || "--"} · ${dateLabel} · ${keywordTerms.length || 0} 个关键词`;
}

export function clampSliceStart(size: number, offset: number, sliceLength: number) {
  if (size <= 0) {
    return 0;
  }

  return Math.max(0, Math.min(offset, Math.max(0, size - sliceLength)));
}

export function clampPercent(value: number) {
  if (Number.isNaN(value)) {
    return 0;
  }

  return Math.max(0, Math.min(100, value));
}

export function getPreviewCacheKey(filePath: string, offset: number) {
  return `${filePath}:${Math.max(0, Math.floor(offset / previewBucketSize))}`;
}

export function getSliceCacheKey(filePath: string, offset: number, length: number) {
  const bucketSize = Math.max(1, length);
  return `${filePath}:${Math.max(0, Math.floor(offset / bucketSize))}`;
}

export function getParentDirectoryPath(value: string) {
  const normalized = (value || "/").trim();
  if (!normalized || normalized === "/") {
    return "/";
  }

  const trimmed = normalized.length > 1 ? normalized.replace(/\/+$/, "") : normalized;
  const index = trimmed.lastIndexOf("/");
  if (index <= 0) {
    return "/";
  }

  return trimmed.slice(0, index) || "/";
}

export async function downloadTextFile(content: string, filename: string) {
  const api = (globalThis as any).electronAPI;
  if (api?.saveFile) {
    const buf = new TextEncoder().encode(content).buffer;
    await api.saveFile(buf, filename.split("/").pop() ?? filename);
    return;
  }

  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const chromeDownloads = globalThis.chrome?.downloads;

  if (chromeDownloads?.download) {
    chromeDownloads.download({
      url,
      filename,
      saveAs: true
    });
    return;
  }

  const link = document.createElement("a");
  link.href = url;
  link.download = filename.split("/").pop() ?? filename;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const ANSI_RE = /\x1b\[[0-9;]*[A-Za-z]|\x1b\].*?(?:\x07|\x1b\\)|\x1b[()][A-Z0-9]|\x1b[>=<]?/g;

export function stripAnsi(value: string): string {
  return value.replace(ANSI_RE, "");
}

export function escapeHtml(value: string) {
  return stripAnsi(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function buildHighlightHtml(content: string, terms: string[], useRegex: boolean, activeIndex = -1) {
  if (!content) {
    return "";
  }

  const escapedContent = escapeHtml(content);
  const normalizedTerms = [...new Set(terms.map((term) => term.trim()).filter(Boolean))];
  if (!normalizedTerms.length) {
    return escapedContent;
  }

  const patterns = normalizedTerms
    .map((term) => {
      if (useRegex) {
        return term;
      }
      return escapeRegExp(escapeHtml(term));
    })
    .filter(Boolean);

  if (!patterns.length) {
    return escapedContent;
  }

  try {
    const regex = new RegExp(`(${patterns.join("|")})`, "gi");
    let matchIndex = 0;
    return escapedContent.replace(regex, (_value, capture) => {
      const className = matchIndex === activeIndex ? "log-highlight log-highlight-active" : "log-highlight";
      matchIndex += 1;
      return `<mark class="${className}">${capture}</mark>`;
    });
  } catch {
    return escapedContent;
  }
}

export function formatSearchViewerContent(results: LogSearchResponse | null, fallbackSlice: string | undefined) {
  if (results) {
    if (results.matches.length) {
      return results.matches.map((match) => `${match.lineNumber} | ${match.preview}`).join("\n");
    }

    return "本次检索没有命中结果。";
  }

  return fallbackSlice ?? "请选择日志文件后开始搜索，或直接读取尾部日志。";
}

export interface ViewerResultTab {
  id: string;
  label: string;
  sourceLabel: string;
  content: string;
  fullContent?: string;
  matches: LogSearchResponse["matches"];
  commandPreview?: string;
  strategyLabel?: string;
  scopeLabel?: string;
  matchCount: number;
}

export interface SearchSettingsState {
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
}

export interface LineContextState extends LogLineContextResponse {
  sourceLabel: string;
}

export async function copyText(text: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  document.body.removeChild(textarea);
}

export function parseKeywordTerms(input: string) {
  return input
    .split(/\r?\n|[,，]/)
    .map((item) => item.trim().replace(/^\/+/, ""))
    .filter(Boolean);
}

export function normalizeSearchInput(input: string) {
  return input.trim().replace(/^\/+/, "");
}

export function trimLiveContent(content: string, maxChars = 180_000) {
  if (content.length <= maxChars) {
    return content;
  }

  return content.slice(content.length - maxChars);
}

export function looksLikeShellPrompt(value: string) {
  return /(\[[^\]\n]*@[^\]\n]*[#$]\s*$)|((^|\n)(?:[A-Za-z0-9._-]+@)?[A-Za-z0-9._:/~-]+[#$]\s*$)/m.test(value);
}

export function buildConnectionSummary(server: ServerSummary | null, connection: ServerConnectionTestResponse | null) {
  if (!server) {
    return "请先选择服务器";
  }

  if (!connection) {
    return "等待连接";
  }

  if (!connection.connected) {
    return "连接未完成";
  }

  return connection.directoryReadable ? "已连接，目录可读" : "已连接，目录不可读";
}

export function formatPreviewSnippet(content: string, maxLines = 7) {
  return content
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.trim())
    .slice(0, maxLines)
    .join("\n");
}

export function lineMatchesSearch(line: string, keywordMode: "phrase" | "any" | "all", keywordTerms: string[], useRegex: boolean, excludeTerms?: string[]) {
  const normalizedTerms = keywordTerms.filter(Boolean);
  if (!normalizedTerms.length) {
    return false;
  }

  // Exclude check: if any exclude term is found, reject the line
  if (excludeTerms?.length) {
    const lowered = line.toLowerCase();
    if (excludeTerms.some((term) => lowered.includes(term.toLowerCase()))) {
      return false;
    }
  }

  if (useRegex) {
    try {
      return new RegExp(normalizedTerms[0], "i").test(line);
    } catch {
      return false;
    }
  }

  const lowered = line.toLowerCase();
  const loweredTerms = normalizedTerms.map((term) => term.toLowerCase());
  if (keywordMode === "all") {
    return loweredTerms.every((term) => lowered.includes(term));
  }

  if (keywordMode === "any") {
    return loweredTerms.some((term) => lowered.includes(term));
  }

  return lowered.includes(loweredTerms[0]);
}

export function searchWithinContent(content: string, keywordMode: "phrase" | "any" | "all", keywordTerms: string[], useRegex: boolean, contextLines: number, excludeTerms?: string[]) {
  const lines = content.split(/\r?\n/);
  const matchedIndices = lines.flatMap((line, index) => (lineMatchesSearch(line, keywordMode, keywordTerms, useRegex, excludeTerms) ? [index] : []));

  if (!matchedIndices.length) {
    return {
      commandPreview: `结果页筛选：${keywordTerms.join(", ") || "--"}`,
      truncated: false,
      matches: [],
      rawOutput: "本次筛选没有命中结果。",
      strategyLabel: "结果内筛选",
      scopeLabel: `临时页 · ${formatNumber(lines.length)} 行`
    } satisfies LogSearchResponse;
  }

  const included = new Set<number>();
  matchedIndices.forEach((index) => {
    const start = Math.max(0, index - contextLines);
    const end = Math.min(lines.length - 1, index + contextLines);
    for (let pointer = start; pointer <= end; pointer += 1) {
      included.add(pointer);
    }
  });

  const ordered = [...included].sort((a, b) => a - b);
  const contextOutput = ordered.map((index) => `${index + 1} | ${lines[index]}`).join("\n");
  return {
    commandPreview: `结果页筛选：${keywordTerms.join(", ") || "--"}`,
    truncated: false,
    matches: matchedIndices.map((index) => ({
      source: "临时结果",
      lineNumber: index + 1,
      preview: lines[index]
    })),
    rawOutput: contextOutput,
    contextOutput,
    strategyLabel: "结果内筛选",
    scopeLabel: `临时页 · ${formatNumber(lines.length)} 行`
  } satisfies LogSearchResponse;
}

export function searchWithinMatches(baseMatches: LogSearchResponse["matches"], keywordMode: "phrase" | "any" | "all", keywordTerms: string[], useRegex: boolean, contextLines: number, excludeTerms?: string[]) {
  const matchedIndexes = baseMatches.flatMap((match, index) => (lineMatchesSearch(match.preview, keywordMode, keywordTerms, useRegex, excludeTerms) ? [index] : []));

  if (!matchedIndexes.length) {
    return {
      commandPreview: `结果页筛选：${keywordTerms.join(", ") || "--"}`,
      truncated: false,
      matches: [],
      rawOutput: "本次筛选没有命中结果。",
      strategyLabel: "结果内筛选",
      scopeLabel: `继承上一次结果 · ${formatNumber(baseMatches.length)} 条`
    } satisfies LogSearchResponse;
  }

  const included = new Set<number>();
  matchedIndexes.forEach((index) => {
    const start = Math.max(0, index - contextLines);
    const end = Math.min(baseMatches.length - 1, index + contextLines);
    for (let pointer = start; pointer <= end; pointer += 1) {
      included.add(pointer);
    }
  });

  const ordered = [...included].sort((a, b) => a - b);
  const matchedOnly = matchedIndexes.map((index) => baseMatches[index]);
  const selectedMatches = ordered.map((index) => baseMatches[index]);
  const contextOutput = selectedMatches.map((match) => `${match.lineNumber} | ${match.preview}`).join("\n");
  return {
    commandPreview: `结果页筛选：${keywordTerms.join(", ") || "--"}`,
    truncated: false,
    matches: matchedOnly,
    rawOutput: contextOutput,
    contextOutput,
    strategyLabel: "结果内筛选",
    scopeLabel: `继承上一次结果 · ${formatNumber(baseMatches.length)} 条`
  } satisfies LogSearchResponse;
}
