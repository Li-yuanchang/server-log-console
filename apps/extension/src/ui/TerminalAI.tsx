import { useState, useRef, useEffect, useCallback, useMemo, Fragment } from "react";
import { Send, Loader, Sparkles, Plus, X, Terminal as TerminalIcon, Copy, CornerDownLeft, TextSelect, CircleCheck, ChevronsUpDown, Settings2 } from "lucide-react";
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
import type { AIConfig, AIMessage, ChatMessage, TerminalAIController } from "./ai-service.js";
import { TerminalAISettings } from "./TerminalAISettings.js";
import { formatKeyHint } from "./key-hints.js";

interface TerminalAIProps {
  serverId: string;
  serverLabel: string;
  /* 自动引用终端选中内容 */
  selectionText?: string;
  /* 终端上下文控制器：读终端画面 / 执行命令并捕获输出 */
  controller: TerminalAIController;
  onClose: () => void;
}

/* 把具体模型归一为模型族标签（头部 chip 用） */
function modelChipLabel(model: string): string {
  const normalized = (model || "").trim();
  if (!normalized) return "GLM-4";
  if (/glm/i.test(normalized)) return "GLM-4";
  if (/deepseek/i.test(normalized)) return "DeepSeek";
  if (/qwen/i.test(normalized)) return "Qwen";
  if (/gpt/i.test(normalized)) return "GPT";
  return normalized;
}

/* 输入框下方快捷追问 chips */
const QUICK_ASKS = ["解释错误", "给出修复命令", "找日志位置"] as const;

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

/* 命令卡运行态：idle → running（等待输出） → captured（已捕获输出，可分析） */
type CardPhase = { state: "running" } | { state: "captured"; output: string; timedOut: boolean };
type RunningCards = Record<string, CardPhase>;
const cardKey = (messageId: string, index: number) => `${messageId}:${index}`;

async function copyToClipboard(text: string) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    /* 剪贴板不可用时静默失败 */
  }
}

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
  const assessment = assessCommand(command);
  const phase = props.runningCards[cardId];
  const needsBackup = assessment.level === "backup_required"
    && !!assessment.backupToken
    && !props.executedBackupTokens.includes(assessment.backupToken);
  const isBlocked = assessment.level === "dangerous" || needsBackup;
  const title = assessment.level === "dangerous"
    ? assessment.reason
    : (needsBackup ? "请先执行对应的备份命令，再执行修改命令" : assessment.reason);

  const badge = assessment.level === "dangerous"
    ? <span className="tai-badge tai-badge-danger">已拦截</span>
    : (needsBackup
      ? <span className="tai-badge tai-badge-warn">先备份</span>
      : (assessment.backupToken
        ? <span className="tai-badge tai-badge-info">备份</span>
        : <span className="tai-badge tai-badge-safe">安全</span>));

  return (
    <div className={`tai-cmd-card ${isBlocked ? "tai-cmd-card-blocked" : ""}`}>
      <div className="tai-cmd-row">
        <span className="tai-cmd-prompt">$</span>
        <code className="tai-cmd-code">{command}</code>
        {badge}
        <div className="tai-cmd-actions">
          <button
            type="button"
            className="tai-cmd-btn tai-cmd-btn-icon"
            title="复制"
            aria-label="复制命令"
            onClick={() => void copyToClipboard(command)}
          >
            <Copy size={12} />
          </button>
          {phase?.state === "running" ? (
            <span className="tai-cmd-wait"><Loader size={12} className="tai-spin" />等待输出…</span>
          ) : (
            <button
              type="button"
              className="tai-cmd-btn tai-cmd-btn-primary"
              title={title}
              disabled={isBlocked || phase?.state === "captured"}
              onClick={() => props.onExecute(command, cardId)}
            >
              <CornerDownLeft size={11} />发送到终端
            </button>
          )}
        </div>
      </div>
      {phase?.state === "captured" ? (
        <div className="tai-cmd-result">
          <div className="tai-cmd-foot">
            {props.analyzing ? (
              <span className="tai-cmd-wait"><Loader size={12} className="tai-spin" />分析中…</span>
            ) : (
              <span className="tai-cmd-captured">
                <CircleCheck size={12} />
                {phase.timedOut ? "输出等待超时，已捕获部分内容" : `已捕获 ${phase.output.split("\n").length} 行输出，已附加到上下文`}
              </span>
            )}
            {!props.analyzing ? (
              <button
                type="button"
                className="tai-cmd-btn tai-cmd-btn-primary"
                disabled={props.analyzing}
                onClick={() => props.onAnalyze(command, phase.output, cardId)}
              >
                让 AI 分析
              </button>
            ) : null}
          </div>
          {phase.output ? <pre className="tai-cmd-output">{phase.output}</pre> : null}
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
      <div className="tai-msg tai-msg-user">
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
    <div className="tai-msg tai-msg-ai">
      {parts.map((part, i) => {
        if (/^```(?:bash|sh|shell)?\s*\n/.test(part)) {
          const inner = part.replace(/^```(?:bash|sh|shell)?\s*\n/, "").replace(/```$/, "").trim();
          const lines = inner.split("\n").filter((l) => l.trim() && !l.trim().startsWith("#"));
          return (
            <div key={i} className="tai-cmd-group">
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
        return <p key={i} className="tai-ai-text">{text}</p>;
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
  /* 命令卡运行态：key = msgId:index */
  const [runningCards, setRunningCards] = useState<RunningCards>({});
  const [analyzingKey, setAnalyzingKey] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const popRef = useRef<HTMLDivElement | null>(null);

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
  const terminalAvailable = attachContext && props.controller.isAvailable();
  const inputPlaceholder = !configured
    ? "请先在 AI 设置中配置服务商"
    : (selectionText ? "针对选中内容提问…" : "描述你想做的事…");

  function commitConfig(next: AIConfig) {
    setConfig(saveAIConfig(next));
  }

  /* 上下文行数：面板挂载 / 切换开关 / 切换会话 / 收到新消息时刷新 */
  useEffect(() => {
    if (!terminalAvailable || !props.controller.isAvailable()) {
      setContextLineCount(0);
      return;
    }
    const text = props.controller.getContextText();
    setContextLineCount(text ? text.split("\n").filter((line) => line.trim()).length : 0);
  }, [terminalAvailable, props.serverId, messages, props.controller]);

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
    if (!modelPopOpen) return;
    const handleMouseDown = (e: MouseEvent) => {
      if (popRef.current && e.target instanceof Node && !popRef.current.contains(e.target)) {
        setModelPopOpen(false);
      }
    };
    window.addEventListener("mousedown", handleMouseDown);
    return () => window.removeEventListener("mousedown", handleMouseDown);
  }, [modelPopOpen]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const panel = panelRef.current;
      const active = document.activeElement;
      if (!panel || !(active instanceof Node) || !panel.contains(active)) return;
      if (showSettings) setShowSettings(false);
      else if (modelPopOpen) setModelPopOpen(false);
      else if (isLoading) { abortAIRequest(); setIsLoading(false); setStreamContent(""); }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [showSettings, modelPopOpen, isLoading]);

  /** 组装请求历史：会话轮数截断 + 终端画面 / 选中引用作为隐藏上下文 */
  const buildHistory = useCallback((nextMessages: ChatMessage[], question: string): AIMessage[] => {
    const turnWindow = Math.max(1, config.session.contextTurns) * 2;
    const history: AIMessage[] = nextMessages.slice(-turnWindow).map((m) => ({
      role: m.role,
      content: m.content,
    }));
    if (terminalAvailable) {
      const contextText = props.controller.getContextText();
      if (contextText) {
        history.unshift({
          role: "user",
          content: `【终端画面（自动附带，最近 ${contextLineCount || "若干"} 行）】\n${contextText}`,
        });
      }
    }
    if (selectionText) {
      history.push({
        role: "user",
        content: `【终端选中内容（已引用）】\n${selectionText}\n\n【问题】${question}`,
      });
    }
    return history;
  }, [config.session.contextTurns, props.controller, selectionText, terminalAvailable, contextLineCount]);

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
      const { output, timedOut } = await props.controller.executeAndCapture(command);
      setRunningCards((prev) => ({ ...prev, [cardId]: { state: "captured", output, timedOut } }));
    } catch {
      setRunningCards((prev) => {
        const next = { ...prev };
        delete next[cardId];
        return next;
      });
    }
  }, [executedBackupTokens, props.controller]);

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
      {/* Header */}
      <div className="tai-header">
        <div className="tai-header-title">
          <Sparkles size={13} className="tai-sparkle" />
          <span>终端 AI</span>
          {!configured && <span className="tai-badge-unconfigured">未配置</span>}
        </div>
        <div className="tai-header-actions">
          <span className="chip tai-model-chip" title={`${activeModel || "未选择模型"} · 快捷键 ${formatKeyHint("⌘J")}`}>
            {activeProvider ? modelChipLabel(activeModel) : "未配置"}
          </span>
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
          disabled={!props.controller.isAvailable()}
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
          <div className="tai-msg tai-msg-ai tai-msg-streaming">
            <p className="tai-ai-text">{streamContent}</p>
          </div>
        )}

        {isLoading && !streamContent && (
          <div className="tai-msg tai-msg-ai tai-thinking">
            <Loader size={12} className="tai-spin" />
            <span>思考中…</span>
          </div>
        )}
      </div>

      {/* 输入区：附加开关 + 快捷追问（横向滚动） + 模型选择 + 圆形发送键 */}
      <div className="tai-composer">
        <textarea
          ref={inputRef}
          className="tai-textarea"
          placeholder={inputPlaceholder}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          rows={1}
          disabled={!configured}
        />
        <div className="tai-comp-bar">
          <button
            type="button"
            className={`tai-attach ${terminalAvailable ? "tai-attach-on" : ""}`}
            title={terminalAvailable ? "自动附带终端画面：开" : "自动附带终端画面：关"}
            aria-pressed={terminalAvailable}
            disabled={!props.controller.isAvailable()}
            onClick={() => commitConfig({ ...config, session: { ...config.session, attachContext: !attachContext } })}
          >
            <TerminalIcon size={14} />
          </button>
          <div className="tai-quick">
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
          <button
            type="button"
            className={`tai-model-btn ${modelPopOpen ? "on" : ""}`}
            title="选择模型"
            disabled={!config.providers.length}
            onClick={() => setModelPopOpen((v) => !v)}
          >
            <span className="tai-model-btn-name">{activeModel || "选择模型"}</span>
            <ChevronsUpDown size={11} />
          </button>
          <button
            type="button"
            className="tai-send"
            disabled={!input.trim() || isLoading || !configured}
            onClick={() => void handleSend()}
            title="发送"
            aria-label="发送"
          >
            {isLoading ? <Loader size={14} className="tai-spin" /> : <Send size={14} />}
          </button>
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
