/**
 * AI Terminal Assistant – service layer
 * 多服务商配置（OpenAI 兼容 / Anthropic / Ollama）+ 协议适配 + 连接测试/模型拉取。
 * 存储格式 v2：{ v:2, enabled, providers[], activeProviderId, activeModel{}, session{} }，
 * 旧版扁平配置在读取时自动迁移为单服务商 profile。
 */

const STORAGE_KEY = "server-log-console:ai-config";
const LEGACY_ATTACH_KEY = "server-log-console:ai-attach-context";

export type AIProtocol = "openai" | "anthropic" | "ollama";

export interface AIProviderProfile {
  id: string;
  name: string;
  protocol: AIProtocol;
  /** 服务基地址，如 https://open.bigmodel.cn/api/paas/v4（对话/模型列表路径由协议适配器拼接） */
  endpoint: string;
  apiKey: string;
  /** 启用的模型列表（可在对话中切换） */
  models: string[];
}

export interface AISessionConfig {
  /** 每次提问携带的对话历史轮数（一轮 = 用户+助手两条） */
  contextTurns: number;
  maxTokens: number;
  temperature: number;
  streaming: boolean;
  /** 提问时自动附带终端画面 */
  attachContext: boolean;
}

export interface AIConfig {
  v: 2;
  enabled: boolean;
  providers: AIProviderProfile[];
  activeProviderId: string;
  /** providerId -> 当前选用的模型 */
  activeModel: Record<string, string>;
  session: AISessionConfig;
}

export interface ProviderPreset {
  label: string;
  protocol: AIProtocol;
  endpoint: string;
  model: string;
  apiKey?: string;
  note: string;
}

export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    label: "智谱 GLM",
    protocol: "openai",
    endpoint: "https://open.bigmodel.cn/api/paas/v4",
    model: "glm-4-flash",
    note: "GLM-4-Flash 免费，注册后填入自己的 API Key",
  },
  {
    label: "DeepSeek",
    protocol: "openai",
    endpoint: "https://api.deepseek.com",
    model: "deepseek-chat",
    note: "需注册获取 API Key",
  },
  {
    label: "OpenAI",
    protocol: "openai",
    endpoint: "https://api.openai.com/v1",
    model: "gpt-4o-mini",
    note: "需付费 API Key",
  },
  {
    label: "Ollama (本地)",
    protocol: "ollama",
    endpoint: "http://localhost:11434",
    model: "qwen2.5:7b",
    note: "需本地安装 Ollama，无需 API Key",
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

/** 终端上下文控制器：由 TerminalWorkspace 提供，AI 面板借此读取终端画面 / 执行并捕获命令输出。
    全部为纯客户端读 buffer + PTY 写入，不引入新的远端协议。 */
export interface TerminalAIController {
  /** 终端画面快照（最近若干行，已去除尾部空行）。终端不可用或处于全屏应用时返回空串 */
  getContextText: () => string;
  /** 把命令写入 PTY 并等待输出落定（空闲判定 / 超时兜底），返回捕获到的输出文本 */
  executeAndCapture: (command: string) => Promise<{ output: string; timedOut: boolean }>;
  /** 当前是否具备可读取的终端实例 */
  isAvailable: () => boolean;
}

const SYSTEM_PROMPT = `你是一个 Linux 服务器终端智能助手，嵌入在服务器日志管理工具中，与用户的真实 SSH 终端同屏。
你不是普通的文本 AI：你具备读取终端的能力。用户消息里的【终端画面（真实终端内容）】和【终端命令执行输出】块就是终端里真实发生的内容，必须直接基于它们回答。
严禁说"我无法执行命令"、"无法查看执行结果"、"作为一个文本模式的AI"之类的话——终端画面和命令输出都已经摆在你的面前。

你的职责：
1. 将用户的自然语言需求转化为精确的终端命令
2. 解释命令的作用和参数含义
3. 分析错误日志并给出排查建议
4. 分析终端命令的真实执行输出并给出结论
5. 提供系统运维最佳实践

规则：
- 回答简洁精炼，直接给出可执行命令
- 收到【终端画面】或【终端命令执行输出】时，先给结论再给依据，直接读出其中的关键数值；不要说"请自行执行"
- 【终端画面】里若包含历史回复之外的最新内容，以【终端画面】为准
- 当建议执行命令时，用 \`\`\`bash 代码块包裹，每个代码块只放一条命令
- 严禁输出危险或破坏性命令，例如 rm -rf、mkfs、dd、shutdown、reboot、poweroff、wipefs、格式化磁盘、删除系统目录
- 如果用户请求危险操作，必须拒绝，并给出安全替代方案
- 涉及修改文件、覆盖配置、就地编辑时，必须先给出备份命令，再给出修改命令
- 备份命令优先使用 cp 原文件 原文件.bak.$(date +%Y%m%d%H%M%S) 这种形式
- 优先使用安全、非破坏性的命令
- 如果不确定用户的操作系统，默认假设 CentOS/RHEL 7+`;

/* 自动执行协议（2026-11-10 新增）
   ------------------------------------------------------------------
   背景：系统提示词原先要求 AI「严禁说无法执行命令」，但架构上 AI 并没有
   执行能力 —— 它只能输出 bash 代码块让用户手动点按钮。结果模型要么违背
   指令、要么违心胡说。用户明确要求「让 AI 自己执行」。
   实现：不依赖模型的 function calling（用户用的 deepseek-v4.1-flash
   未必支持 tools），改用**约定标记**：
     · AI 想执行命令时，在 bash 代码块后紧跟一行 [[RUN]]
     · 前端解析到 [[RUN]] 就自动执行该代码块，把输出作为
       【终端命令执行输出】回灌，再发下一轮
     · 轮次上限 MAX_AUTO_ROUNDS，防止死循环
   授权档位（readonly / ask / auto）决定是否真的执行：
     · readonly：不执行任何写操作，只回灌「已被只读模式拒绝」
     · ask：本次会话第一条弹确认，用户同意后本会话内不再问
     · auto：直接执行（危险命令仍由 assessCommand 拦截）
   ------------------------------------------------------------------ */
export const AUTO_RUN_MARKER = "[[RUN]]";
/** 单次提问最多自动执行几轮，防止模型陷入循环 */
export const MAX_AUTO_ROUNDS = 4;

/** 三个反引号，避免在模板字符串里直接写代码围栏 */
const FENCE = String.fromCharCode(96, 96, 96);

/** 追加自动执行协议到系统提示词（按授权档位拼不同段落） */
export function buildSystemPrompt(authMode: "readonly" | "ask" | "auto"): string {
  if (authMode === "readonly") {
    return [
      SYSTEM_PROMPT,
      "",
      "【只读模式】",
      "你没有执行权限。所有命令都必须由用户手动执行。",
      `给出命令时用 ${FENCE}bash 包裹即可，不要输出 ${AUTO_RUN_MARKER} 标记。`,
      "如果用户要求你执行，告诉他当前是只读模式，需要切换授权档位。",
    ].join("\n");
  }
  const confirmNote = authMode === "ask"
    ? "执行前系统会弹确认框（用户可能拒绝）。被拒绝时不要重试同一命令，改为解释原因或给替代方案。"
    : "执行不需要确认，直接下发。但危险命令会被系统拦截。";
  return [
    SYSTEM_PROMPT,
    "",
    "【你可以真实执行命令】",
    "你具备在用户 SSH 终端里执行命令的能力，不要再说\"我无法执行\"或\"请自行执行\"。",
    "",
    "执行方式：当你需要运行命令时，把命令放进 bash 代码块，"
    + `并在代码块之后紧跟单独一行 ${AUTO_RUN_MARKER} 标记。`
    + "系统会自动执行并把你得到的输出以【终端命令执行输出】回灌给你，你据此继续分析。",
    "",
    "示例：",
    FENCE + "bash",
    "df -h",
    FENCE,
    AUTO_RUN_MARKER,
    "",
    "规则：",
    "- 一次只标记一条命令（要跑多条就分多个代码块，各带自己的标记）",
    `- 只需要给用户看、不需要你拿到结果的命令，不要加 ${AUTO_RUN_MARKER}`,
    `- ${confirmNote}`,
    "- 拿到执行输出后先给结论，再决定是否继续下一步",
    `- 最多自动执行 ${MAX_AUTO_ROUNDS} 轮，请优先把最关键的几条命令合并执行`,
  ].join("\n");
}

const DEFAULT_SESSION: AISessionConfig = {
  contextTurns: 10,
  maxTokens: 2048,
  temperature: 0.3,
  streaming: true,
  attachContext: true,
};

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function makeDefaultConfig(): AIConfig {
  const preset = PROVIDER_PRESETS[0];
  const provider: AIProviderProfile = {
    id: genId(),
    name: preset.label.replace(/\s*\(.*\)$/, ""),
    protocol: preset.protocol,
    endpoint: preset.endpoint,
    apiKey: "",
    models: [preset.model],
  };
  return {
    v: 2,
    enabled: true,
    providers: [provider],
    activeProviderId: provider.id,
    activeModel: { [provider.id]: preset.model },
    session: { ...DEFAULT_SESSION },
  };
}

/** 读取配置；自动识别并迁移旧版扁平格式与旧版独立开关 key */
export function readAIConfig(): AIConfig {
  const fallback = makeDefaultConfig();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      const legacyAttach = localStorage.getItem(LEGACY_ATTACH_KEY);
      if (legacyAttach === "0") fallback.session.attachContext = false;
      return fallback;
    }
    const parsed = JSON.parse(raw) as Partial<AIConfig> & Partial<{ apiEndpoint: string; apiKey: string; model: string; enabled: boolean }>;
    /* 旧版扁平格式迁移 */
    if (!Array.isArray(parsed.providers) || parsed.providers.length === 0) {
      const preset = PROVIDER_PRESETS[0];
      const provider: AIProviderProfile = {
        id: genId(),
        name: "智谱 GLM",
        protocol: "openai",
        endpoint: typeof parsed.apiEndpoint === "string" && parsed.apiEndpoint
          ? parsed.apiEndpoint.replace(/\/chat\/completions\/?$/, "")
          : preset.endpoint,
        apiKey: typeof parsed.apiKey === "string" ? parsed.apiKey : "",
        models: [typeof parsed.model === "string" && parsed.model ? parsed.model : preset.model],
      };
      const legacyAttach = localStorage.getItem(LEGACY_ATTACH_KEY);
      return {
        v: 2,
        enabled: parsed.enabled !== false,
        providers: [provider],
        activeProviderId: provider.id,
        activeModel: { [provider.id]: provider.models[0] },
        session: { ...DEFAULT_SESSION, ...(legacyAttach === "0" ? { attachContext: false } : {}) },
      };
    }
    const providers: AIProviderProfile[] = parsed.providers.map((p) => ({
      id: p.id || genId(),
      name: p.name || "未命名服务商",
      protocol: p.protocol === "anthropic" || p.protocol === "ollama" ? p.protocol : "openai",
      endpoint: p.endpoint || "",
      apiKey: p.apiKey || "",
      models: Array.isArray(p.models) ? p.models.filter((m) => typeof m === "string" && m) : [],
    }));
    const activeProviderId = providers.some((p) => p.id === parsed.activeProviderId)
      ? (parsed.activeProviderId as string)
      : providers[0].id;
    const activeModel: Record<string, string> = {};
    for (const p of providers) {
      const chosen = parsed.activeModel?.[p.id];
      activeModel[p.id] = chosen && p.models.includes(chosen) ? chosen : (p.models[0] ?? "");
    }
    return {
      v: 2,
      enabled: parsed.enabled !== false,
      providers,
      activeProviderId,
      activeModel,
      session: { ...DEFAULT_SESSION, ...(parsed.session || {}) },
    };
  } catch {
    return fallback;
  }
}

export function saveAIConfig(config: AIConfig): AIConfig {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  return config;
}

export function getActiveProvider(config: AIConfig): AIProviderProfile | null {
  return config.providers.find((p) => p.id === config.activeProviderId) ?? config.providers[0] ?? null;
}

export function getActiveModel(config: AIConfig): string {
  const provider = getActiveProvider(config);
  if (!provider) return "";
  return config.activeModel[provider.id] || provider.models[0] || "";
}

export function isAIConfigured(config?: AIConfig): boolean {
  const c = config ?? readAIConfig();
  const provider = getActiveProvider(c);
  return c.enabled && !!provider && !!provider.endpoint && (provider.protocol === "ollama" || !!provider.apiKey);
}

/* ---------------- 协议适配层 ---------------- */

function joinUrl(base: string, path: string): string {
  const trimmed = base.replace(/\/+$/, "");
  if (trimmed.endsWith(path)) return trimmed;
  return `${trimmed}/${path}`;
}

function protocolHeaders(protocol: AIProtocol, apiKey: string): Record<string, string> {
  if (protocol === "anthropic") {
    return { "x-api-key": apiKey, "anthropic-version": "2023-06-01" };
  }
  if (protocol === "ollama") {
    return {};
  }
  return { Authorization: `Bearer ${apiKey}` };
}

/** 对话请求地址 */
export function chatUrl(provider: AIProviderProfile): string {
  if (provider.protocol === "anthropic") return joinUrl(provider.endpoint, "v1/messages");
  if (provider.protocol === "ollama") return joinUrl(provider.endpoint, "api/chat");
  return joinUrl(provider.endpoint, "chat/completions");
}

/** 模型列表请求地址 */
export function modelsUrl(provider: AIProviderProfile): string {
  if (provider.protocol === "anthropic") return joinUrl(provider.endpoint, "v1/models");
  if (provider.protocol === "ollama") return joinUrl(provider.endpoint, "api/tags");
  return joinUrl(provider.endpoint, "models");
}

export const PROTOCOL_LABELS: Record<AIProtocol, string> = {
  openai: "OpenAI 兼容",
  anthropic: "Anthropic",
  ollama: "Ollama 本地",
};

export const PROTOCOL_NOTES: Record<AIProtocol, string> = {
  openai: "OpenAI 兼容协议：对话 POST {endpoint}/chat/completions，模型列表 GET {endpoint}/models，鉴权 Bearer Key",
  anthropic: "Anthropic 协议：对话 POST {endpoint}/v1/messages，模型列表 GET {endpoint}/v1/models，鉴权 x-api-key",
  ollama: "Ollama 协议：对话 POST {endpoint}/api/chat，模型列表 GET {endpoint}/api/tags，无需鉴权",
};

function buildRequestBody(
  provider: AIProviderProfile,
  model: string,
  messages: AIMessage[],
  session: AISessionConfig,
  systemText?: string,
): Record<string, unknown> {
  if (provider.protocol === "anthropic") {
    return {
      model,
      system: systemText || undefined,
      messages,
      stream: session.streaming,
      temperature: session.temperature,
      max_tokens: session.maxTokens,
    };
  }
  if (provider.protocol === "ollama") {
    return {
      model,
      messages,
      stream: session.streaming,
      options: { temperature: session.temperature, num_predict: session.maxTokens },
    };
  }
  return {
    model,
    messages,
    stream: session.streaming,
    temperature: session.temperature,
    max_tokens: session.maxTokens,
  };
}

interface ParsedChunk { text: string }

function parseStreamEvent(provider: AIProtocol, json: any): ParsedChunk | null {
  if (provider === "openai") {
    const delta = json?.choices?.[0]?.delta?.content;
    return delta ? { text: delta } : null;
  }
  if (provider === "anthropic") {
    if (json?.type === "content_block_delta" && json?.delta?.text) return { text: json.delta.text };
    return null;
  }
  /* ollama NDJSON */
  const content = json?.message?.content;
  if (typeof content === "string" && content && !json?.done) return { text: content };
  return null;
}

function parseFullResponse(provider: AIProtocol, json: any): string {
  if (provider === "openai") return json?.choices?.[0]?.message?.content ?? "";
  if (provider === "anthropic") {
    return (Array.isArray(json?.content) ? json.content : [])
      .map((block: any) => (typeof block?.text === "string" ? block.text : ""))
      .join("");
  }
  return json?.message?.content ?? "";
}

let abortController: AbortController | null = null;

export function abortAIRequest(): void {
  abortController?.abort();
  abortController = null;
}

/** 发送对话请求（读取当前激活服务商/模型与会话参数） */
export async function sendAIChat(
  config: AIConfig,
  messages: AIMessage[],
  onChunk?: (chunk: string) => void,
  /* 授权档位决定系统提示词里要不要教 AI 输出 [[RUN]] 标记。
     默认 readonly —— 调用方不传时保持原行为（只给建议不执行）。 */
  authMode: "readonly" | "ask" | "auto" = "readonly",
): Promise<string> {
  const provider = getActiveProvider(config);
  const model = getActiveModel(config);
  if (!provider || !provider.endpoint) {
    throw new Error("AI 未配置，请先在设置中添加服务商");
  }
  if (provider.protocol !== "ollama" && !provider.apiKey) {
    throw new Error(`「${provider.name}」缺少 API Key，请在设置中补全`);
  }

  abortController?.abort();
  abortController = new AbortController();
  const signal = abortController.signal;

  const systemPrompt = buildSystemPrompt(authMode);
  const withSystem: AIMessage[] = [{ role: "system" as const, content: systemPrompt }, ...messages];
  const bodyMessages: AIMessage[] = provider.protocol === "anthropic"
    ? withSystem.filter((m) => m.role !== "system")
    : withSystem;

  const res = await fetch(chatUrl(provider), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...protocolHeaders(provider.protocol, provider.apiKey),
    },
    body: JSON.stringify(buildRequestBody(provider, model, bodyMessages, config.session, systemPrompt)),
    signal,
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`AI 请求失败 (${res.status}): ${errText.slice(0, 200)}`);
  }

  if (!onChunk || !config.session.streaming) {
    const data = await res.json();
    abortController = null;
    return parseFullResponse(provider.protocol, data);
  }

  const reader = res.body?.getReader();
  if (!reader) throw new Error("无法读取响应流");

  const decoder = new TextDecoder();
  let full = "";
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line || line === "data: [DONE]") continue;
      const jsonText = line.startsWith("data: ") ? line.slice(6) : line;
      try {
        const json = JSON.parse(jsonText);
        const chunk = parseStreamEvent(provider.protocol, json);
        if (chunk) {
          full += chunk.text;
          onChunk(full);
        }
      } catch {
        /* 跳过无法解析的分片 */
      }
    }
  }

  abortController = null;
  return full;
}

export interface ConnectionTestResult {
  ok: boolean;
  latencyMs: number;
  models: string[];
  error?: string;
}

/** 测试连接 + 拉取模型列表（一次请求两者兼得：模型列表端点是最轻的探测点） */
export async function testProviderConnection(provider: AIProviderProfile): Promise<ConnectionTestResult> {
  const startedAt = Date.now();
  try {
    const models = await fetchProviderModels(provider);
    return { ok: true, latencyMs: Date.now() - startedAt, models };
  } catch (err: any) {
    return {
      ok: false,
      latencyMs: Date.now() - startedAt,
      models: [],
      error: err?.message || "连接失败",
    };
  }
}

/** 拉取服务商可用模型列表 */
export async function fetchProviderModels(provider: AIProviderProfile): Promise<string[]> {
  if (!provider.endpoint) throw new Error("请先填写 API Endpoint");
  const res = await fetch(modelsUrl(provider), {
    headers: protocolHeaders(provider.protocol, provider.apiKey),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status}: ${errText.slice(0, 160)}`);
  }
  const data = await res.json();
  if (provider.protocol === "ollama") {
    return (Array.isArray(data?.models) ? data.models : [])
      .map((m: any) => (typeof m?.name === "string" ? m.name : ""))
      .filter(Boolean);
  }
  return (Array.isArray(data?.data) ? data.data : [])
    .map((m: any) => (typeof m?.id === "string" ? m.id : ""))
    .filter(Boolean);
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
