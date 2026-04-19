/**
 * AI Terminal Assistant – service layer
 * Supports OpenAI-compatible APIs (GLM, DeepSeek, OpenAI, Ollama, etc.)
 */

const STORAGE_KEY = "server-log-console:ai-config";

export interface AIConfig {
  apiEndpoint: string;
  apiKey: string;
  model: string;
  enabled: boolean;
}

export interface ProviderPreset {
  label: string;
  endpoint: string;
  model: string;
  apiKey?: string;
  note: string;
}

export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    label: "智谱 GLM (免费)",
    endpoint: "https://open.bigmodel.cn/api/paas/v4/chat/completions",
    model: "glm-4-flash",
    apiKey: "ac4e8910897a4c52bec6eed336595d79.OsdqA6PajZ92kmjs",
    note: "GLM-4-Flash 免费，开箱即用",
  },
  {
    label: "DeepSeek",
    endpoint: "https://api.deepseek.com/chat/completions",
    model: "deepseek-chat",
    note: "需注册获取 API Key",
  },
  {
    label: "OpenAI",
    endpoint: "https://api.openai.com/v1/chat/completions",
    model: "gpt-4o-mini",
    note: "需付费 API Key",
  },
  {
    label: "Ollama (本地)",
    endpoint: "http://localhost:11434/v1/chat/completions",
    model: "qwen2.5:7b",
    apiKey: "ollama",
    note: "需本地安装 Ollama",
  },
];

export interface AIMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: number;
  commands?: string[];
}

export interface CommandAssessment {
  level: "safe" | "backup_required" | "dangerous";
  reason: string;
  target?: string;
  backupToken?: string;
}

const DEFAULT_CONFIG: AIConfig = {
  apiEndpoint: "https://open.bigmodel.cn/api/paas/v4/chat/completions",
  apiKey: "ac4e8910897a4c52bec6eed336595d79.OsdqA6PajZ92kmjs",
  model: "glm-4-flash",
  enabled: true,
};

const SYSTEM_PROMPT = `你是一个 Linux 服务器终端智能助手，嵌入在服务器日志管理工具中。
你的职责：
1. 将用户的自然语言需求转化为精确的终端命令
2. 解释命令的作用和参数含义
3. 分析错误日志并给出排查建议
4. 提供系统运维最佳实践

规则：
- 回答简洁精炼，直接给出可执行命令
- 当建议执行命令时，用 \`\`\`bash 代码块包裹
- 严禁输出危险或破坏性命令，例如 rm -rf、mkfs、dd、shutdown、reboot、poweroff、wipefs、格式化磁盘、删除系统目录
- 如果用户请求危险操作，必须拒绝，并给出安全替代方案
- 涉及修改文件、覆盖配置、就地编辑时，必须先给出备份命令，再给出修改命令
- 备份命令优先使用 cp 原文件 原文件.bak.$(date +%Y%m%d%H%M%S) 这种形式
- 优先使用安全、非破坏性的命令
- 如果不确定用户的操作系统，默认假设 CentOS/RHEL 7+`;

export function readAIConfig(): AIConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_CONFIG };
    return { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export function saveAIConfig(config: Partial<AIConfig>): AIConfig {
  const current = readAIConfig();
  const merged = { ...current, ...config };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
  return merged;
}

export function isAIConfigured(): boolean {
  const config = readAIConfig();
  return config.enabled && !!config.apiKey && !!config.apiEndpoint;
}

/** Extract ```bash ... ``` blocks from AI response */
export function extractCommands(content: string): string[] {
  const regex = /```(?:bash|sh|shell)?\s*\n([\s\S]*?)```/g;
  const commands: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = regex.exec(content)) !== null) {
    const block = match[1].trim();
    for (const line of block.split("\n")) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith("#")) {
        commands.push(trimmed);
      }
    }
  }
  return commands;
}

function splitCommandTokens(command: string) {
  return command.match(/"[^"]*"|'[^']*'|\S+/g) ?? [];
}

function normalizeToken(token: string) {
  return token.replace(/^['"]|['"]$/g, "").replace(/[;|&]+$/g, "");
}

function isBackupDestination(token: string) {
  return /(\.bak(\.|$)|\.backup(\.|$)|\.orig(\.|$)|backup|bak\.|\.tmp\.)/i.test(token);
}

function getBackupToken(command: string) {
  const tokens = splitCommandTokens(command).map(normalizeToken);
  if (!tokens.length) return "";
  const lowerTokens = tokens.map((token) => token.toLowerCase());

  const cpIndex = lowerTokens.findIndex((token) => token === "cp" || token.endsWith("/cp"));
  if (cpIndex >= 0) {
    const args = tokens.slice(cpIndex + 1).filter((token) => token && !token.startsWith("-"));
    if (args.length >= 2) {
      const source = args[args.length - 2];
      const dest = args[args.length - 1];
      if (isBackupDestination(dest)) return source;
    }
  }

  const rsyncIndex = lowerTokens.findIndex((token) => token === "rsync" || token.endsWith("/rsync"));
  if (rsyncIndex >= 0) {
    const args = tokens.slice(rsyncIndex + 1).filter((token) => token && !token.startsWith("-"));
    if (args.length >= 2) {
      const source = args[args.length - 2];
      const dest = args[args.length - 1];
      if (isBackupDestination(dest)) return source;
    }
  }

  return "";
}

function getMutationTarget(command: string) {
  const tokens = splitCommandTokens(command).map(normalizeToken);
  if (!tokens.length) return "";
  const lower = command.toLowerCase();

  const redirectMatch = command.match(/>>?\s*([^\s]+)/);
  if (redirectMatch?.[1]) return normalizeToken(redirectMatch[1]);

  const teeMatch = command.match(/\btee\s+(?:-a\s+)?([^\s]+)/i);
  if (teeMatch?.[1]) return normalizeToken(teeMatch[1]);

  if (/\bsed\s+-i\b/i.test(lower) || /\bperl\s+-pi\b/i.test(lower)) {
    return tokens[tokens.length - 1] ?? "";
  }

  if (/\b(vim|vi|nano)\b/i.test(lower)) {
    return tokens[tokens.length - 1] ?? "";
  }

  if (/\btruncate\b/i.test(lower)) {
    return tokens[tokens.length - 1] ?? "";
  }

  return "";
}

export function assessCommand(command: string): CommandAssessment {
  const normalized = command.trim().toLowerCase();
  const dangerousPatterns = [
    /(^|\s)rm\s+-[rf]*f?[rf]*\s+/,
    /(^|\s)sudo\s+rm\s+/,
    /(^|\s)mkfs(\.|\s|$)/,
    /(^|\s)dd\s+if=/,
    /(^|\s)(shutdown|reboot|halt|poweroff|init\s+0|init\s+6)(\s|$)/,
    /(^|\s)wipefs(\s|$)/,
    /:\s*\(\)\s*\{\s*:\|:\s*&\s*\};:/,
    /curl\s+[^|]+\|\s*(sh|bash)/,
    /wget\s+[^|]+\|\s*(sh|bash)/,
  ];

  if (dangerousPatterns.some((pattern) => pattern.test(normalized))) {
    return {
      level: "dangerous",
      reason: "危险命令已被 AI 助手拦截，禁止执行",
    };
  }

  const backupToken = getBackupToken(command);
  if (backupToken) {
    return {
      level: "safe",
      reason: "备份命令，可先执行",
      backupToken,
    };
  }

  const target = getMutationTarget(command);
  if (target) {
    return {
      level: "backup_required",
      reason: "该命令会修改文件，请先执行对应备份命令",
      target,
      backupToken: target,
    };
  }

  return {
    level: "safe",
    reason: "安全命令，可直接执行",
  };
}

let abortController: AbortController | null = null;

export function abortAIRequest(): void {
  abortController?.abort();
  abortController = null;
}

export async function sendAIMessage(
  messages: AIMessage[],
  onChunk?: (chunk: string) => void,
): Promise<string> {
  const config = readAIConfig();
  if (!config.apiKey || !config.apiEndpoint) {
    throw new Error("AI 未配置，请先设置 API Key 和 Endpoint");
  }

  abortController?.abort();
  abortController = new AbortController();

  const body = {
    model: config.model,
    messages: [{ role: "system" as const, content: SYSTEM_PROMPT }, ...messages],
    stream: !!onChunk,
    temperature: 0.3,
    max_tokens: 2048,
  };

  const res = await fetch(config.apiEndpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify(body),
    signal: abortController.signal,
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`AI 请求失败 (${res.status}): ${errText.slice(0, 200)}`);
  }

  if (!onChunk) {
    const data = await res.json();
    return data.choices?.[0]?.message?.content ?? "";
  }

  // Streaming
  const reader = res.body?.getReader();
  if (!reader) throw new Error("无法读取响应流");

  const decoder = new TextDecoder();
  let full = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const text = decoder.decode(value, { stream: true });
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed === "data: [DONE]") continue;
      if (!trimmed.startsWith("data: ")) continue;
      try {
        const json = JSON.parse(trimmed.slice(6));
        const delta = json.choices?.[0]?.delta?.content ?? "";
        if (delta) {
          full += delta;
          onChunk(full);
        }
      } catch {
        // skip malformed chunk
      }
    }
  }

  abortController = null;
  return full;
}
