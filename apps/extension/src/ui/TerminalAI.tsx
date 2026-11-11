// @ts-ignore vite 的 ?inline 导入返回 CSS 文本，无类型声明
import aiPanelCss from "./ai-panel.css?inline";
import { useState, useRef, useEffect, useCallback, useMemo, Fragment } from "react";
import { Send, Loader, Sparkles, Plus, X, Terminal as TerminalIcon, Copy, CornerDownLeft, TextSelect, CircleCheck, ChevronDown, Check, Settings2, Zap, ShieldCheck, Shield, ShieldAlert } from "lucide-react";
import {
  readAIConfig,
  saveAIConfig,
  sendAIChat,
  extractCommands,
  abortAIRequest,
  assessCommand,
  getActiveProvider,
  getActiveModel,
  isAIConfigured,
  PROTOCOL_LABELS,
} from "./ai-service.js";
import type { AIConfig, AIMessage, ChatMessage } from "./ai-service.js";
import { TerminalAISettings } from "./TerminalAISettings.js";
import { formatKeyHint } from "./key-hints.js";
/* Markdown 渲染（2026-11-10）：与 Vercel ai-chatbot / Cline 同一方案 */
import { Streamdown } from "streamdown";
import { cjk } from "@streamdown/cjk";
import type { Components } from "streamdown";

/* 抽屉样式运行时注入：不进全局样式加载链，对抽屉外组件零影响 */
let panelStyleInjected = false;
function ensurePanelStyles() {
  if (panelStyleInjected || typeof document === "undefined") return;
  if (!document.getElementById("tai-panel-style")) {
    const el = document.createElement("style");
    el.id = "tai-panel-style";
    el.textContent = aiPanelCss;
    document.head.appendChild(el);
  }
  panelStyleInjected = true;
}
ensurePanelStyles();

/* ---------------------------------------------------------------------------
   终端上下文控制器（纯 DOM 实现，不改工作台）：
   xterm DOM renderer 把可视区行渲染在 .xterm-rows 下，读取可见行即可拿到终端画面；
   命令输出捕获 = 发送命令后轮询可见行，按「滚动重叠差分」累积新行，空闲 1s 视为落定。
   --------------------------------------------------------------------------- */

function queryTerminalEl(): HTMLElement | null {
  const terms = Array.from(document.querySelectorAll<HTMLElement>(".xterm"));
  const visible = terms.filter((el) => el.offsetParent !== null && el.getBoundingClientRect().height > 40);
  if (!visible.length) return null;
  const active = document.activeElement;
  if (active instanceof HTMLElement) {
    const focused = visible.find((el) => el.contains(active));
    if (focused) return focused;
  }
  return visible[0];
}

function readVisibleRows(termEl: HTMLElement): string[] {
  const container = termEl.querySelector(".xterm-rows");
  if (!container) return [];
  const out: string[] = [];
  for (let i = 0; i < container.children.length; i += 1) {
    out.push((container.children[i].textContent || "").replace(/\s+$/u, ""));
  }
  while (out.length > 0 && !out[out.length - 1].trim()) out.pop();
  return out;
}

/** 滚动差分：prev 尾部与 cur 头部的最大重合之后的行即新输出 */
function scrollNewLines(prev: string[], cur: string[]): string[] {
  const maxK = Math.min(prev.length, cur.length);
  for (let k = maxK; k >= 0; k -= 1) {
    let overlap = true;
    for (let i = 0; i < k; i += 1) {
      if (prev[prev.length - k + i] !== cur[i]) {
        overlap = false;
        break;
      }
    }
    if (overlap) return cur.slice(k);
  }
  return [];
}

interface TerminalDomController {
  getContextText: () => string;
  executeAndCapture: (command: string) => Promise<{ output: string; timedOut: boolean }>;
  isAvailable: () => boolean;
}

function useTerminalDomController(onExecute: (command: string) => void): TerminalDomController {
  return useMemo(() => ({
    getContextText: () => {
      const termEl = queryTerminalEl();
      return termEl ? readVisibleRows(termEl).join("\n") : "";
    },
    executeAndCapture: (command: string) => new Promise((resolve) => {
      const termEl = queryTerminalEl();
      onExecute(`${command}\n`);
      if (!termEl) {
        resolve({ output: "", timedOut: false });
        return;
      }
      let prev = readVisibleRows(termEl);
      const acc: string[] = [];
      let ticks = 0;
      let idleTicks = 0;
      const startedAt = Date.now();
      const timer = window.setInterval(() => {
        ticks += 1;
        const cur = readVisibleRows(termEl);
        const fresh = scrollNewLines(prev, cur);
        prev = cur;
        if (fresh.length > 0) {
          idleTicks = 0;
          for (const line of fresh) acc.push(line);
        } else {
          idleTicks += 1;
        }
        const settled = (ticks >= 6 && idleTicks >= 4) || Date.now() - startedAt >= 15000;
        if (!settled) return;
        window.clearInterval(timer);
        const lines = [...acc];
        /* 命令回显行与末尾提示符不作为输出 */
        if (lines.length > 0 && lines[0].includes(command)) lines.shift();
        while (lines.length > 0 && !lines[lines.length - 1].trim()) lines.pop();
        /* 末尾提示符剔除（2026-11-10 修正）：
           原正则 /(\]#|\$|%)\s*$/ 只要行尾是 $ / % / ]# 就删，
           会把「usage: 100%」「total price 5$」这类正常输出的最后一行吃掉。
           现改为**只认提示符形态**：行首必须是 user@host（可带 :path）或
           常见 shell 提示符开头，且整行长度较短。这样普通输出不会被误删，
           而 root@host:~# / [root@iZ ~]# / user@host:/app$ 都能正确识别。 */
        if (lines.length > 0) {
          const lastLine = lines[lines.length - 1].trim();
          const promptLike =
            lastLine.length <= 100
            && (
              /^\[?[\w.-]+@[\w.-]+[^\s]*[#$%>]$/u.test(lastLine)          /* user@host:~# / [root@iZ ~]# */
              || /^\[?[^\]]*[\w.-]+@[\w.-]+[^\]]*\][#$]$/u.test(lastLine)  /* [root@host ~]# 变体 */
              || /^(?:bash|sh|zsh)-[\d.]+[#$]$/u.test(lastLine)            /* bash-4.4# */
              || /^[A-Za-z]:\\[^>]*>$/u.test(lastLine)                      /* Windows C:\path> */
            );
          if (promptLike) lines.pop();
        }
        resolve({ output: lines.join("\n"), timedOut: Date.now() - startedAt >= 15000 });
      }, 250);
    }),
    isAvailable: () => queryTerminalEl() != null,
  }), [onExecute]);
}

interface TerminalAIProps {
  serverId: string;
  serverLabel: string;
  /* 自动引用终端选中内容 */
  selectionText?: string;
  /* 把命令写入激活终端（工作台既有管道） */
  onExecute: (command: string) => void;
  onClose: () => void;
}

/* 输入框下方快捷追问 chips */
const QUICK_ASKS = ["解释错误", "给出修复命令", "找日志位置"] as const;

/* 授权模式（2026-11-10）
   readonly：只允许查询类命令，写入/重启直接拒绝
   ask     ：每次执行前弹确认，显示命令原文（默认，最安全也最常用）
   auto    ：直接执行不询问，仅危险命令仍拦截 */
type AuthMode = "readonly" | "ask" | "auto";
const AUTH_LABELS: Record<AuthMode, string> = {
  readonly: "只读",
  ask: "需要授权",
  auto: "完全访问",
};
const AUTH_DESCS: Record<AuthMode, string> = {
  readonly: "仅查询类命令，写入/重启直接拒绝",
  ask: "每次执行前确认，显示命令原文",
  auto: "直接执行不询问，仅危险命令拦截",
};
function AuthIcon({ mode }: { mode: AuthMode }) {
  if (mode === "readonly") return <Shield size={12} strokeWidth={1.9} />;
  if (mode === "auto") return <ShieldCheck size={12} strokeWidth={1.9} />;
  return <ShieldAlert size={12} strokeWidth={1.9} />;
}

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

const CHAT_HISTORY_PREFIX = "server-log-console:ai-chat";

function getChatHistoryKey(serverId: string) {
  return `${CHAT_HISTORY_PREFIX}:${serverId}`;
}

function readChatHistory(serverId: string): ChatMessage[] {
  try {
    const raw = localStorage.getItem(getChatHistoryKey(serverId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item: unknown) => {
      if (!item || typeof item !== "object") return false;
      const message = item as Partial<ChatMessage>;
      return (
        typeof message.id === "string"
        && (message.role === "user" || message.role === "assistant")
        && typeof message.content === "string"
        && typeof message.timestamp === "number"
      ) as boolean;
    }) as ChatMessage[];
  } catch {
    return [];
  }
}

function saveChatHistory(serverId: string, messages: ChatMessage[]) {
  const key = getChatHistoryKey(serverId);
  if (!messages.length) {
    localStorage.removeItem(key);
    return;
  }
  localStorage.setItem(key, JSON.stringify(messages.slice(-50)));
}

/* 快捷命令展开态（默认折叠，避免与模型选择器挤在一行） */
const QUICK_OPEN_KEY = "server-log-console:ai-quick-open";

function readQuickOpen(): boolean {
  try {
    return localStorage.getItem(QUICK_OPEN_KEY) === "1";
  } catch {
    return false;
  }
}

function saveQuickOpen(on: boolean) {
  try {
    localStorage.setItem(QUICK_OPEN_KEY, on ? "1" : "0");
  } catch {
    /* ignore */
  }
}

/* 命令卡运行态：idle → running（等待输出） → captured（已捕获输出，可分析） */
type CardPhase = { state: "running" } | { state: "captured"; output: string; timedOut: boolean };
type RunningCards = Record<string, CardPhase>;
const cardKey = (messageId: string, index: number) => `${messageId}:${index}`;

/* Markdown 渲染配置（2026-11-10）
   ------------------------------------------------------------------
   参考 Vercel ai-chatbot 的 ai-elements/reasoning.tsx:204 与
   Cline 的 ai-elements/streamdown.tsx 的做法：
   用 Streamdown + @streamdown/cjk，并通过 components 覆盖代码块，
   让 ```bash 块渲染成本项目的浅色代码卡（带语言标 + 复制）。
   ------------------------------------------------------------------ */
const markdownPlugins = { cjk };

/* 行内代码：`xxx` */
function MdInlineCode({ children }: { children?: React.ReactNode }) {
  return <code className="tai-md-code">{children}</code>;
}

/* 围栏代码块：```lang ... ``` */
function MdCodeBlock({ children, className }: { children?: React.ReactNode; className?: string }) {
  const lang = className?.match(/language-([\w-]+)/)?.[1] ?? "";
  const raw = typeof children === "string" ? children : String(children ?? "");
  const text = raw.replace(/\n$/, "");
  return (
    <div className="tai-md-block">
      <div className="tai-md-block-hd">
        <span className="tai-md-lang">{lang || "text"}</span>
        <span className="tai-md-block-sp" />
        <button
          type="button"
          className="tai-md-copy"
          title="复制代码"
          onClick={() => void copyToClipboard(text)}
        >
          <Copy size={11} />
        </button>
      </div>
      <pre className="tai-md-pre">{text}</pre>
    </div>
  );
}

const markdownComponents: Components = {
  /* 行内 code 与围栏 code 都由 code 渲染，靠有没有 language- 区分 */
  code: (props) => {
    const cls = typeof props.className === "string" ? props.className : "";
    const isBlock = /language-/.test(cls) || String(props.children ?? "").includes("\n");
    if (isBlock) {
      return <MdCodeBlock className={cls}>{props.children}</MdCodeBlock>;
    }
    return <MdInlineCode>{props.children}</MdInlineCode>;
  },
  /* 段落：去掉默认外边距，避免流式输出时不断跳动 */
  p: ({ children }) => <p className="tai-md-p">{children}</p>,
  /* 列表 */
  ul: ({ children }) => <ul className="tai-md-ul">{children}</ul>,
  ol: ({ children }) => <ol className="tai-md-ol">{children}</ol>,
  li: ({ children }) => <li className="tai-md-li">{children}</li>,
  /* 标题：终端场景下收敛成 3 档 */
  h1: ({ children }) => <div className="tai-md-h tai-md-h1">{children}</div>,
  h2: ({ children }) => <div className="tai-md-h tai-md-h2">{children}</div>,
  h3: ({ children }) => <div className="tai-md-h tai-md-h3">{children}</div>,
  h4: ({ children }) => <div className="tai-md-h tai-md-h3">{children}</div>,
  /* 引用 / 分隔线 / 表格 */
  blockquote: ({ children }) => <blockquote className="tai-md-quote">{children}</blockquote>,
  hr: () => <hr className="tai-md-hr" />,
  table: ({ children }) => (
    <div className="tai-md-table-wrap">
      <table className="tai-md-table">{children}</table>
    </div>
  ),
  a: ({ children, href }) => (
    <a className="tai-md-link" href={href} target="_blank" rel="noreferrer noopener">
      {children}
    </a>
  ),
};

async function copyToClipboard(text: string) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    /* 剪贴板不可用时静默失败 */
  }
}

/* 命令卡（2026-11-10 重构）
   ------------------------------------------------------------------
   改造前：每条命令一张大卡片 —— 命令行 + 徽标 + 按钮 + 输出块常驻展开，
           一条命令至少占 100px，AI 给 5 条命令就把对话顶走。
   改造后：默认折叠成**一行 22px**（图标 + 类型 + 状态 + 命令摘要），
           点开才展开完整命令 + 浅色代码块输出。
   依据参考：Cline 的 tool-output.tsx（折叠只显首行 + 展开看全部）、
            Vercel ai-elements/tool.tsx（状态徽标是一等公民）。
   现有能力全部保留：复制命令、发送到终端、等待输出、让 AI 分析。 */
function CommandCard(props: {
  command: string;
  cardId: string;
  executedBackupTokens: string[];
  runningCards: RunningCards;
  onExecute: (cmd: string, cardId: string) => void;
  onAnalyze: (cmd: string, output: string, cardId: string) => void;
  analyzing: boolean;
}) {
  const { command, cardId } = props;
  const [expanded, setExpanded] = useState(false);
  const assessment = assessCommand(command);
  const phase = props.runningCards[cardId];
  const needsBackup = assessment.level === "backup_required"
    && !!assessment.backupToken
    && !props.executedBackupTokens.includes(assessment.backupToken);
  /* 注意：下面几处比较必须与 ai-service.ts 里 CommandAssessment.level 的
     字面量完全一致（"dangerous"）。此处保留原写法，避免行为变化。 */
  const isBlocked = assessment.level === "dangerous" || needsBackup;
  const isDangerous = assessment.level === "dangerous";
  const captured = phase?.state === "captured";
  const running = phase?.state === "running";
  /* 悬停说明：把拦截/备份原因说清楚，而不是只说"危险" */
  const title = isDangerous
    ? assessment.reason
    : (needsBackup ? "请先执行对应的备份命令，再执行修改命令" : assessment.reason);
  const lineCount = captured
    ? phase.output.split("\n").filter((l) => l.trim()).length
    : 0;

  /* 状态：未执行 / 等待 / 完成 / 不完整 / 已拦截 / 待备份 */
  const status = isDangerous
    ? "已拦截"
    : needsBackup
      ? "待备份"
      : running
        ? "运行中"
        : captured
          ? (phase.timedOut ? "输出不完整" : "已完成")
          : "";
  const statusCls = isDangerous || needsBackup
    ? "err"
    : running
      ? "run"
      : captured
        ? (phase.timedOut ? "warn" : "ok")
        : "";

  return (
    <div className={`tai-step${statusCls ? " tai-step-" + statusCls : ""}${expanded ? " is-open" : ""}`}>
      {/* 折叠头：一行。点整行展开/收起 */}
      <button
        type="button"
        className="tai-step-head"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
      >
        <span className="tai-step-ic" aria-hidden="true">
          {isDangerous ? "✗" : running ? "○" : captured ? "✓" : "▸"}
        </span>
        <span className="tai-step-kind">终端命令</span>
        {status ? <span className="tai-step-state">{status}</span> : null}
        <span className="tai-step-txt">{command}</span>
        <span className="tai-step-chev" aria-hidden="true">
          <ChevronDown size={10} strokeWidth={2.4} />
        </span>
      </button>

      {/* 展开区 */}
      {expanded ? (
        <div className="tai-step-body">
          {/* 命令行 */}
          <div className="tai-step-cmd">
            <span className="p">$</span>
            <code className="t">{command}</code>
            <button
              type="button"
              className="cp"
              title="复制命令"
              aria-label="复制命令"
              onClick={() => void copyToClipboard(command)}
            >
              <Copy size={11} />
            </button>
          </div>

          {/* 输出（浅色代码块，不是纯黑终端） */}
          {captured && phase.output ? (
            <pre className="tai-step-out">{phase.output}</pre>
          ) : null}

          {/* 卡脚：状态说明 + 操作 */}
          <div className="tai-step-ft">
            {running ? (
              <span className="tai-step-hint"><Loader size={11} className="tai-spin" />等待输出…</span>
            ) : captured ? (
              <span className="tai-step-hint">
                {phase.timedOut
                  ? `输出不完整（15 秒未结束，已捕获 ${lineCount} 行）`
                  : `退出正常 · ${lineCount} 行输出`}
              </span>
            ) : (
              <span className="tai-step-hint">{title}</span>
            )}
            <span className="sp" />
            {!running && !captured ? (
              <button
                type="button"
                className="tai-step-btn tai-step-btn-pri"
                title={title}
                disabled={isBlocked}
                onClick={() => props.onExecute(command, cardId)}
              >
                <CornerDownLeft size={11} />发送到终端
              </button>
            ) : null}
            {captured ? (
              <button
                type="button"
                className="tai-step-btn tai-step-btn-pri"
                disabled={props.analyzing}
                onClick={() => props.onAnalyze(command, phase.output, cardId)}
              >
                {props.analyzing ? "分析中…" : "让 AI 分析"}
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function MessageBubble(props: {
  msg: ChatMessage;
  executedBackupTokens: string[];
  runningCards: RunningCards;
  onExecute: (cmd: string, cardId: string) => void;
  onAnalyze: (cmd: string, output: string, cardId: string) => void;
  analyzingKey: string | null;
  /* 引用 chip「已引用选中 N 行」：选中引用生效中时随用户消息展示 */
  selectionLineCount?: number;
}) {
  const { msg } = props;
  if (msg.role === "user") {
    return (
      <div className="tai-row-user">
        <div className="tai-user-bubble">
          {props.selectionLineCount ? (
            <span className="tai-quote-chip"><TextSelect size={11} />已引用选中 {props.selectionLineCount} 行</span>
          ) : null}
          <p className="tai-user-text">{msg.content}</p>
        </div>
      </div>
    );
  }

  const parts = msg.content.split(/(```(?:bash|sh|shell)?\s*\n[\s\S]*?```)/g);

  return (
    <div className="tai-row-ai">
      {parts.map((part, i) => {
        if (/^```(?:bash|sh|shell)?\s*\n/.test(part)) {
          const inner = part.replace(/^```(?:bash|sh|shell)?\s*\n/, "").replace(/```$/, "").trim();
          const lines = inner.split("\n").filter((l) => l.trim() && !l.trim().startsWith("#"));
          return (
            <div key={i} className="tai-cmdlist">
              {lines.map((line, j) => {
                const id = cardKey(msg.id, j);
                return (
                  <CommandCard
                    key={j}
                    command={line.trim()}
                    cardId={id}
                    executedBackupTokens={props.executedBackupTokens}
                    runningCards={props.runningCards}
                    onExecute={props.onExecute}
                    onAnalyze={props.onAnalyze}
                    analyzing={props.analyzingKey === id}
                  />
                );
              })}
            </div>
          );
        }
        const text = part.trim();
        if (!text) return null;
        /* 2026-11-10：Markdown 渲染交给 Streamdown（与 Vercel ai-chatbot 同一选择）。
           此前是纯文本 p 标签，粗体、行内代码、列表全部原样显示成符号。
           选 Streamdown 而不是 react-markdown 的原因：
             · 专为 AI 流式输出设计，未闭合语法（如流到一半的 **）不会闪烁
             · @streamdown/cjk 处理中日韩断行（中文长句不会撑破容器）
             · 支持 components 覆盖，代码块能替换成自己的样式 */
        return (
          <div key={i} className="tai-ai-text tai-md">
            <Streamdown
              components={markdownComponents}
              shikiTheme={["github-light", "github-dark"]}
            >
              {text}
            </Streamdown>
          </div>
        );
      })}
    </div>
  );
}

export function TerminalAI(props: TerminalAIProps) {
  const [messages, setMessages] = useState<ChatMessage[]>(() => readChatHistory(props.serverId));
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [config, setConfig] = useState<AIConfig>(() => readAIConfig());
  const [streamContent, setStreamContent] = useState("");
  const [executedBackupTokens, setExecutedBackupTokens] = useState<string[]>([]);
  const [contextLineCount, setContextLineCount] = useState(0);
  const [modelPopOpen, setModelPopOpen] = useState(false);
  /* 授权模式（2026-11-10）：控制 AI 执行命令的放行级别。
     readonly = 只查询；ask = 每次执行前确认（默认）；auto = 直接执行。
     存在 config.session 里随设置持久化，输入区可临时切换。 */
  const [authMode, setAuthMode] = useState<"readonly" | "ask" | "auto">("ask");
  const [authPopOpen, setAuthPopOpen] = useState(false);
  const authPopRef = useRef<HTMLDivElement | null>(null);
  const [quickOpen, setQuickOpen] = useState<boolean>(() => readQuickOpen());
  /* 命令卡运行态：key = msgId:index */
  const [runningCards, setRunningCards] = useState<RunningCards>({});
  const [analyzingKey, setAnalyzingKey] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const popRef = useRef<HTMLDivElement | null>(null);

  /* 稳定的 onExecute 引用 → DOM 控制器仅在 onExecute 变化时重建 */
  const onExecuteRef = useRef(props.onExecute);
  onExecuteRef.current = props.onExecute;
  const stableExecute = useCallback((cmd: string) => onExecuteRef.current(cmd), []);
  const controller = useTerminalDomController(stableExecute);

  const activeProvider = getActiveProvider(config);
  const activeModel = getActiveModel(config);
  const configured = isAIConfigured(config);
  const attachContext = config.session.attachContext;
  const canStartNewChat = messages.length > 0 || !!input || !!streamContent || isLoading;
  const selectionText = (props.selectionText || "").trim();
  const selectionLineCount = useMemo(
    () => (selectionText ? selectionText.split(/\r?\n/).filter((line) => line.length > 0).length : 0),
    [selectionText],
  );
  const selectionPreview = useMemo(() => {
    if (!selectionText) return "";
    const flat = selectionText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).join(" ");
    return flat.length > 90 ? `${flat.slice(0, 90)}…` : flat;
  }, [selectionText]);
  const terminalAvailable = attachContext && controller.isAvailable();
  const inputPlaceholder = !configured
    ? "请先在 AI 设置中配置服务商"
    : (selectionText ? "针对选中内容提问…" : "描述你想做的事…");

  function commitConfig(next: AIConfig) {
    setConfig(saveAIConfig(next));
  }

  /* 上下文行数：面板挂载 / 切换开关 / 切换会话 / 收到新消息时刷新 */
  useEffect(() => {
    if (!terminalAvailable) {
      setContextLineCount(0);
      return;
    }
    const text = controller.getContextText();
    setContextLineCount(text ? text.split("\n").filter((line) => line.trim()).length : 0);
  }, [terminalAvailable, props.serverId, messages, controller]);

  useEffect(() => {
    if (showSettings) {
      return;
    }
    const frameId = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(frameId);
  }, [props.serverId, showSettings]);

  useEffect(() => {
    abortAIRequest();
    setMessages(readChatHistory(props.serverId));
    setInput("");
    setIsLoading(false);
    setStreamContent("");
    setExecutedBackupTokens([]);
    setRunningCards({});
    setAnalyzingKey(null);
  }, [props.serverId]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, streamContent, runningCards]);

  useEffect(() => {
    saveChatHistory(props.serverId, messages);
  }, [messages, props.serverId]);

  /* 点击面板外部收起模型选择器 */
  useEffect(() => {
    if (!modelPopOpen && !authPopOpen) return;
    const handleMouseDown = (e: MouseEvent) => {
      if (modelPopOpen && popRef.current && e.target instanceof Node && !popRef.current.contains(e.target)) {
        setModelPopOpen(false);
      }
      if (authPopOpen && authPopRef.current && e.target instanceof Node && !authPopRef.current.contains(e.target)) {
        setAuthPopOpen(false);
      }
    };
    window.addEventListener("mousedown", handleMouseDown);
    return () => window.removeEventListener("mousedown", handleMouseDown);
  }, [modelPopOpen, authPopOpen]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const panel = panelRef.current;
      const active = document.activeElement;
      if (!panel || !(active instanceof Node) || !panel.contains(active)) return;
      if (showSettings) setShowSettings(false);
      else if (authPopOpen) setAuthPopOpen(false);
      else if (modelPopOpen) setModelPopOpen(false);
      else if (isLoading) { abortAIRequest(); setIsLoading(false); setStreamContent(""); }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [showSettings, modelPopOpen, authPopOpen, isLoading]);

  /** 组装请求历史：会话轮数截断；终端画面 / 选中引用并入最后一条用户消息（紧贴问题，弱模型也能注意到） */
  const buildHistory = useCallback((nextMessages: ChatMessage[], question: string): AIMessage[] => {
    const turnWindow = Math.max(1, config.session.contextTurns) * 2;
    const history: AIMessage[] = nextMessages.slice(-turnWindow).map((m) => ({
      role: m.role,
      content: m.content,
    }));
    const contextParts: string[] = [];
    if (terminalAvailable) {
      const contextText = controller.getContextText();
      if (contextText) {
        contextParts.push(`【终端画面（真实终端内容，自动附带）】\n${contextText}`);
      }
    }
    if (selectionText) {
      contextParts.push(`【终端选中内容（真实终端内容）】\n${selectionText}`);
    }
    contextParts.push(`【问题】${question}`);
    history.push({ role: "user", content: contextParts.join("\n\n") });
    return history;
  }, [config.session.contextTurns, controller, selectionText, terminalAvailable]);

  const runRequest = useCallback(async (nextMessages: ChatMessage[], history: AIMessage[]) => {
    setIsLoading(true);
    setStreamContent("");
    try {
      const fullContent = await sendAIChat(config, history, (chunk) => {
        setStreamContent(chunk);
      });
      const commands = extractCommands(fullContent);
      const aiMsg: ChatMessage = {
        id: genId(),
        role: "assistant",
        content: fullContent,
        timestamp: Date.now(),
        commands,
      };
      setMessages((prev) => [...prev, aiMsg]);
    } catch (err: any) {
      if (err?.name === "AbortError") return;
      const errMsg: ChatMessage = {
        id: genId(),
        role: "assistant",
        content: `⚠ ${err?.message || "请求失败"}`,
        timestamp: Date.now(),
      };
      setMessages((prev) => [...prev, errMsg]);
    } finally {
      setIsLoading(false);
      setStreamContent("");
    }
  }, [config]);

  const handleSend = useCallback(async (messageText?: string) => {
    const text = (messageText ?? input).trim();
    if (!text || isLoading || !configured) return;

    const userMsg: ChatMessage = { id: genId(), role: "user", content: text, timestamp: Date.now() };
    const nextMessages = [...messages, userMsg];
    setMessages(nextMessages);
    setInput("");
    await runRequest(nextMessages, buildHistory(nextMessages, text));
  }, [configured, input, isLoading, messages, buildHistory, runRequest]);

  /** 命令卡「发送到终端」：写入 PTY 并捕获输出，卡片进入 等待输出 → 已捕获 状态 */
  const handleExecute = useCallback(async (command: string, cardId: string) => {
    const assessment = assessCommand(command);
    const needsBackup = assessment.level === "backup_required"
      && !!assessment.backupToken
      && !executedBackupTokens.includes(assessment.backupToken);
    if (assessment.level === "dangerous" || needsBackup) return;

    if (assessment.backupToken) {
      setExecutedBackupTokens((prev) => (
        prev.includes(assessment.backupToken as string)
          ? prev
          : [...prev, assessment.backupToken as string]
      ));
    }

    setRunningCards((prev) => ({ ...prev, [cardId]: { state: "running" } }));
    try {
      const { output, timedOut } = await controller.executeAndCapture(command);
      setRunningCards((prev) => ({ ...prev, [cardId]: { state: "captured", output, timedOut } }));
    } catch {
      setRunningCards((prev) => {
        const next = { ...prev };
        delete next[cardId];
        return next;
      });
    }
  }, [executedBackupTokens, controller]);

  /** 命令卡「让 AI 分析」：把捕获到的输出作为隐藏上下文发给模型，回复追加到对话 */
  const handleAnalyze = useCallback(async (command: string, output: string, cardId: string) => {
    if (isLoading || !configured) return;
    const question = output
      ? "请分析上面这条命令的执行输出，先给结论再给依据；如需继续排查，用 ```bash 代码块给出下一步命令。"
      : "这条命令没有捕获到输出（可能还在运行或终端处于全屏应用），请说明可能的原因，并用 ```bash 代码块给出确认命令。";
    const history = buildHistory(messages, question);
    history.push({
      role: "user",
      content: `【终端命令执行输出】\n$ ${command}\n${output || "（未捕获到输出）"}\n\n${question}`,
    });
    setAnalyzingKey(cardId);
    try {
      await runRequest(messages, history);
    } finally {
      setAnalyzingKey(null);
    }
  }, [buildHistory, configured, isLoading, messages, runRequest]);

  function handleNewChat() {
    abortAIRequest();
    setMessages([]);
    setInput("");
    setIsLoading(false);
    setStreamContent("");
    setExecutedBackupTokens([]);
    setRunningCards({});
    setAnalyzingKey(null);
    saveChatHistory(props.serverId, []);
    setShowSettings(false);
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  function selectModel(providerId: string, model: string) {
    commitConfig({ ...config, activeProviderId: providerId, activeModel: { ...config.activeModel, [providerId]: model } });
    setModelPopOpen(false);
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    /* IME 组合输入保护（2026-11-10 修复）：
       中文输入法用 Enter 确认候选词时，keydown 同样是 Enter，
       原实现会直接发送，导致「打一半就被发出去」。
       判断依据与同项目 SearchQueryPanel.tsx:99 一致：
         · nativeEvent.isComposing：组合中（标准属性）
         · keyCode === 229：部分旧版 IME / Windows 输入法在组合期返回 229
       任一命中即视为输入法在用 Enter，交还给输入法处理。 */
    const composing =
      (e.nativeEvent as KeyboardEvent).isComposing
      || (e.nativeEvent as KeyboardEvent).keyCode === 229;
    if (composing) return;
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  };

  if (showSettings) {
    return (
      <div
        ref={panelRef}
        className="tai-dropdown"
        onMouseDown={(event) => event.stopPropagation()}
        onClick={(event) => event.stopPropagation()}
      >
        <TerminalAISettings
          config={config}
          onChange={commitConfig}
          onClose={() => setShowSettings(false)}
        />
      </div>
    );
  }

  return (
    <div
      ref={panelRef}
      className="tai-dropdown"
      onMouseDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
    >
      {/* Header（共享类，视觉沿用旧 token 化适配层） */}
      <div className="tai-header">
        <div className="tai-header-title">
          <Sparkles size={13} className="tai-sparkle" />
          <span>终端 AI</span>
          {!configured && <span className="tai-badge-unconfigured">未配置</span>}
        </div>
        <div className="tai-header-actions">
          {/* 顶部模型 tag 已移除（2026-11-10）：底部输入框内已有模型选择，
              顶部重复显示会让人以为是两个不同的东西。 */}
          <button
            type="button"
            className="tai-hdr-btn tai-hdr-btn-chat"
            title="新对话"
            aria-label="新对话"
            disabled={!canStartNewChat}
            onClick={handleNewChat}
          >
            <Plus size={13} />
          </button>
          <button type="button" className="tai-hdr-btn" title="AI 设置" onClick={() => setShowSettings(true)}>
            <Settings2 size={13} />
          </button>
          <button type="button" className="tai-hdr-btn" title="关闭" onClick={props.onClose}>
            <X size={13} />
          </button>
        </div>
      </div>

      {/* 上下文条：终端画面开关 + 选中引用 */}
      <div className="tai-ctx">
        <span className="tai-ctx-label">上下文</span>
        <button
          type="button"
          className={`tai-ctx-chip ${terminalAvailable ? "tai-ctx-chip-on" : ""}`}
          title={terminalAvailable ? "提问时自动附带终端最近输出，AI 能看到命令和结果" : "终端不可用时关闭"}
          aria-pressed={terminalAvailable}
          disabled={!controller.isAvailable()}
          onClick={() => commitConfig({ ...config, session: { ...config.session, attachContext: !attachContext } })}
        >
          <TerminalIcon size={12} />
          终端画面{contextLineCount ? ` · ${contextLineCount} 行` : ""}
        </button>
        {selectionText ? (
          <span className="tai-ctx-chip tai-ctx-chip-quote" title={selectionPreview}>
            <TextSelect size={12} />
            已引用选中 {selectionLineCount} 行
          </span>
        ) : null}
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="tai-messages">
        {terminalAvailable && messages.length > 0 ? (
          <div className="tai-divider">
            <TerminalIcon size={12} />
            提问时自动附带终端画面，AI 能看到命令和输出
          </div>
        ) : null}
        {messages.length === 0 && !isLoading && (
          <div className="tai-welcome">
            <Sparkles size={20} className="tai-welcome-icon" />
            <p className="tai-welcome-title">智能终端助手</p>
            <p className="tai-welcome-desc">
              {terminalAvailable
                ? "用自然语言描述你想做的事，我能看到终端画面和命令的真实输出"
                : "用自然语言描述你想做的事，我来帮你生成命令"}
            </p>
            <div className="tai-suggestions">
              {[
                "查看磁盘空间和大文件",
                "查找最近的错误日志",
                "Java 应用内存排查",
                "分析网络连接状态",
              ].map((s) => (
                <button
                  key={s}
                  type="button"
                  className="tai-suggestion"
                  disabled={!configured || isLoading}
                  onClick={() => void handleSend(s)}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg) => (
          <MessageBubble
            key={msg.id}
            msg={msg}
            executedBackupTokens={executedBackupTokens}
            runningCards={runningCards}
            onExecute={(cmd, cardId) => void handleExecute(cmd, cardId)}
            onAnalyze={(cmd, output, cardId) => void handleAnalyze(cmd, output, cardId)}
            analyzingKey={analyzingKey}
            selectionLineCount={selectionLineCount}
          />
        ))}

        {isLoading && streamContent && (
          <div className="tai-row-ai tai-ai-streaming">
            <p className="tai-ai-text">{streamContent}</p>
          </div>
        )}

        {isLoading && !streamContent && (
          <div className="tai-thinking">
            <Loader size={12} className="tai-spin" />
            <span>思考中…</span>
          </div>
        )}
      </div>

      {/* 输入区（2026-11-10 一体化）：textarea 与底部工具行装进同一个 .tai-composer-box，
          共享一条外边框。此前 textarea 和工具行各自带边框，视觉上像两个控件拼起来。 */}
      <div className="tai-composer">
        <div className="tai-composer-box">
        <textarea
          ref={inputRef}
          className="tai-inputarea"
          placeholder={inputPlaceholder}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          rows={1}
          disabled={!configured}
        />
        {quickOpen ? (
          <div className="tai-quickrow">
            {QUICK_ASKS.map((ask) => (
              <button
                key={ask}
                type="button"
                className="tai-qchip"
                disabled={!configured || isLoading}
                onClick={() => setInput(ask)}
              >
                {ask}
              </button>
            ))}
          </div>
        ) : null}
        <div className="tai-comp-bar">
          {/* 授权模式下拉（2026-11-10）：替换原来的「终端画面开关 + 快捷追问」两个裸图标。
              授权等级决定 AI 能把命令执行到什么程度：
                readonly 只查询 / ask 每次确认（默认） / auto 直接执行。
              终端画面开关挪到上下文条的 chip 上（那里本来就有同名开关，避免重复）。 */}
          <div className="tai-auth-wrap" ref={authPopRef}>
            <button
              type="button"
              className={`tai-auth-btn tai-auth-${authMode}`}
              onClick={() => setAuthPopOpen((v) => !v)}
              aria-expanded={authPopOpen}
              aria-haspopup="menu"
              title="授权模式：决定 AI 执行命令的放行级别"
            >
              <AuthIcon mode={authMode} />
              <span className="tai-auth-label">{AUTH_LABELS[authMode]}</span>
              <ChevronDown size={9} strokeWidth={2.4} className="tai-auth-cv" />
            </button>
            {authPopOpen ? (
              <div className="tai-auth-pop" role="menu">
                <div className="tai-auth-pop-hd">授权模式</div>
                {(["readonly", "ask", "auto"] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    role="menuitemradio"
                    aria-checked={authMode === m}
                    className={`tai-auth-item${authMode === m ? " on" : ""}`}
                    onClick={() => { setAuthMode(m); setAuthPopOpen(false); }}
                  >
                    <AuthIcon mode={m} />
                    <span className="dt">
                      <span className="dn">{AUTH_LABELS[m]}</span>
                      <span className="ds">{AUTH_DESCS[m]}</span>
                    </span>
                    {authMode === m ? <Check size={11} className="ck" /> : null}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          <div className="tai-comp-spacer" />
          <button
            type="button"
            className={`tai-model-btn ${modelPopOpen ? "on" : ""}`}
            title="选择模型"
            disabled={!config.providers.length}
            onClick={() => setModelPopOpen((v) => !v)}
          >
            <span className="tai-model-btn-name">{activeModel || "选择模型"}</span>
            <ChevronDown size={10} strokeWidth={2.4} className="tai-model-cv" />
          </button>
          {/* 发送 / 终止互斥（2026-11-10）：
              原来 isLoading 时只是把图标换成转圈、按钮仍禁用，
              用户既不能终止也看不出区别。
              现在按阶段分三态（参考 vercel/ai-chatbot prompt-input.tsx:1104）：
                · 空闲            → ↑ 发送
                · 已提交未出字     → 转圈（不可点，此时"停止"没有意义）
                · 正在流式输出     → ■ 终止（点了 abort，已输出内容保留）
              三者占据同一位置，永不同时出现。 */}
          {isLoading && !streamContent ? (
            <span className="tai-send tai-send-wait" title="等待模型响应" aria-label="等待中">
              <Loader size={14} className="tai-spin" />
            </span>
          ) : isLoading ? (
            <button
              type="button"
              className="tai-send tai-send-stop"
              onClick={() => {
                abortAIRequest();
                setIsLoading(false);
                setStreamContent("");
              }}
              title="终止生成"
              aria-label="终止"
            >
              <span className="tai-send-square" aria-hidden="true" />
            </button>
          ) : (
            <button
              type="button"
              className="tai-send"
              disabled={!input.trim() || !configured}
              onClick={() => void handleSend()}
              title="发送"
              aria-label="发送"
            >
              <Send size={14} />
            </button>
          )}
        </div>
        </div>

        {/* 模型选择 popover：按服务商分组，仅列已启用模型 */}
        {modelPopOpen ? (
          <div className="tai-model-pop" ref={popRef} role="menu" aria-label="选择模型">
            <div className="tai-model-pop-hd"><Sparkles size={11} />选择模型</div>
            <div className="tai-model-pop-list">
              {config.providers.map((p) => (
                <Fragment key={p.id}>
                  <div className="tai-model-pop-group">
                    {p.name}
                    <span className="proto">{PROTOCOL_LABELS[p.protocol]}</span>
                  </div>
                  {p.models.length === 0 ? (
                    <div className="tai-model-pop-empty">未启用模型，请在设置中添加</div>
                  ) : p.models.map((m) => {
                    const active = p.id === config.activeProviderId && activeModel === m;
                    return (
                      <button
                        key={m}
                        type="button"
                        className={`tai-model-row ${active ? "on" : ""}`}
                        role="menuitemradio"
                        aria-checked={active}
                        onClick={() => selectModel(p.id, m)}
                      >
                        <span className="mono">{m}</span>
                        {active ? <CircleCheck size={13} className="check" /> : null}
                      </button>
                    );
                  })}
                </Fragment>
              ))}
            </div>
            <div className="tai-model-pop-ft">
              <button type="button" onClick={() => { setModelPopOpen(false); setShowSettings(true); }}>
                <Settings2 size={11} />管理服务商与模型
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
