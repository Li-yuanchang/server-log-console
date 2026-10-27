/**
 * 终端命令历史
 *
 * 背景：现在只有 shell 自己的方向键历史 —— 关标签就没了，跨服务器不可用，
 * 也不能搜索。排障时最常见的问题是「昨天那条 grep 怎么写的」。
 *
 * 实现要点：
 * 1. **不解析终端输出**，只按用户键入的字符累积，遇到 Enter 提交一条。
 *    解析输出需要完整 VT100 状态机，成本与收益不成比例。
 * 2. **只存本机**（localStorage），不上传、不进仓库 —— 历史里可能有路径、
 *    库名、内部域名等敏感信息。
 * 3. 单条上限 + 总量上限双限制，避免 localStorage 被日志类命令撑爆。
 */

const STORAGE_KEY = "server-log-console:terminal-history";
const FAVORITES_KEY = "server-log-console:terminal-history-favorites";

/** 单条命令最大保留长度（超出截断，正常命令不会到这个量级） */
const MAX_COMMAND_LENGTH = 2000;
/** 最多保留多少条历史 */
const MAX_ENTRIES = 500;

/** 危险命令关键字：列表里标红，降低误选概率 */
const DANGEROUS_PATTERNS: RegExp[] = [
  /\brm\s+(-[a-zA-Z]*[rf][a-zA-Z]*\s+)+/,
  /\bmkfs\b/,
  /\bdd\s+if=/,
  /\b(shutdown|reboot|halt|poweroff)\b/,
  /\bdrop\s+(database|table)\b/i,
  /\btruncate\s+table\b/i,
  /\bdelete\s+from\b/i,
  />\s*\/dev\/sd[a-z]/,
  /\bchmod\s+(-R\s+)?777\s+\//,
];

export interface TerminalHistoryEntry {
  id: string;
  command: string;
  /** 来源服务器显示名（root@host 或服务器名），便于区分同一命令在不同机器 */
  serverLabel: string;
  serverId: string;
  /** 最近一次执行时间戳 */
  executedAt: number;
  /** 执行次数：同一条命令重复执行时合并，次数递增 */
  count: number;
}

export function isDangerousCommand(command: string): boolean {
  return DANGEROUS_PATTERNS.some((pattern) => pattern.test(command));
}

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = globalThis.localStorage?.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    globalThis.localStorage?.setItem(key, JSON.stringify(value));
  } catch {
    /* 配额满或隐私模式：静默失败，不影响终端使用 */
  }
}

export function readTerminalHistory(): TerminalHistoryEntry[] {
  const entries = readJson<TerminalHistoryEntry[]>(STORAGE_KEY, []);
  if (!Array.isArray(entries)) return [];
  return entries
    .filter((item) => item && typeof item.command === "string" && item.command.trim())
    .sort((a, b) => b.executedAt - a.executedAt);
}

export function readHistoryFavorites(): string[] {
  const raw = readJson<string[]>(FAVORITES_KEY, []);
  return Array.isArray(raw) ? raw.filter((item) => typeof item === "string") : [];
}

export function toggleHistoryFavorite(command: string): string[] {
  const favorites = readHistoryFavorites();
  const next = favorites.includes(command)
    ? favorites.filter((item) => item !== command)
    : [command, ...favorites].slice(0, 50);
  writeJson(FAVORITES_KEY, next);
  return next;
}

export function clearTerminalHistory(): void {
  writeJson(STORAGE_KEY, []);
}

/**
 * 追加一条历史。
 * 同一 (command, serverId) 已存在时合并：次数 +1、时间刷新，不重复占位。
 */
export function appendTerminalHistory(
  command: string,
  context: { serverId: string; serverLabel: string }
): TerminalHistoryEntry[] {
  const trimmed = command.trim();
  if (!trimmed) return readTerminalHistory();
  /* 单字符命令（如 `c`、`q`）多为误触或交互式输入，不入库 */
  if (trimmed.length < 2) return readTerminalHistory();

  const stored = trimmed.length > MAX_COMMAND_LENGTH
    ? trimmed.slice(0, MAX_COMMAND_LENGTH)
    : trimmed;

  const existing = readTerminalHistory();
  const index = existing.findIndex(
    (item) => item.command === stored && item.serverId === context.serverId
  );

  let next: TerminalHistoryEntry[];
  if (index >= 0) {
    const merged: TerminalHistoryEntry = {
      ...existing[index],
      executedAt: Date.now(),
      count: existing[index].count + 1
    };
    next = [merged, ...existing.filter((_, i) => i !== index)];
  } else {
    next = [
      {
        id: `h-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        command: stored,
        serverId: context.serverId,
        serverLabel: context.serverLabel,
        executedAt: Date.now(),
        count: 1
      },
      ...existing
    ];
  }

  next = next.slice(0, MAX_ENTRIES);
  writeJson(STORAGE_KEY, next);
  return next;
}

/**
 * 按键累积器：把终端原始键入流还原为「命令行」。
 *
 * 只处理最常见的编辑键（退格、Ctrl+U 清行、Ctrl+C 取消），
 * 不处理方向键调历史、Tab 补全等 —— 那些会让本地缓冲与远端实际行不一致，
 * 宁可漏记也不要记错。错记的命令比没有记录更危险。
 */
export class CommandLineBuffer {
  private buffer = "";

  /** 返回需要提交的完整命令行（未按 Enter 时返回 null） */
  feed(data: string): string | null {
    for (const char of data) {
      if (char === "\r" || char === "\n") {
        const command = this.buffer.trim();
        this.buffer = "";
        if (command) return command;
        continue;
      }
      if (char === "\x7f" || char === "\b") {
        this.buffer = this.buffer.slice(0, -1);
        continue;
      }
      if (char === "\x15") {          // Ctrl+U 清空当前行
        this.buffer = "";
        continue;
      }
      if (char === "\x03") {          // Ctrl+C 取消当前行
        this.buffer = "";
        continue;
      }
      if (char === "\x04") {          // Ctrl+D
        this.buffer = "";
        continue;
      }
      /* 控制字符（含方向键 ESC 序列、Tab）会让缓冲与实际行脱节：
         遇到就整体失效，标记为「本次输入不可信」，不记录。 */
      if (char === "\x1b" || char === "\t" || char.charCodeAt(0) < 0x20) {
        this.buffer = "";
        return null;
      }
      this.buffer += char;
    }
    return null;
  }

  reset(): void {
    this.buffer = "";
  }
}

/** 按关键字 + 服务器筛选（面板搜索框） */
export function filterHistory(
  entries: TerminalHistoryEntry[],
  options: { keyword?: string; serverId?: string; onlyFavorites?: boolean; favorites?: string[] }
): TerminalHistoryEntry[] {
  const keyword = (options.keyword || "").trim().toLowerCase();
  const favorites = options.favorites || [];
  return entries.filter((entry) => {
    if (options.serverId && entry.serverId !== options.serverId) return false;
    if (options.onlyFavorites && !favorites.includes(entry.command)) return false;
    if (keyword && !entry.command.toLowerCase().includes(keyword)) return false;
    return true;
  });
}
