import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { X, Send, Settings, Loader, AlertTriangle, Sparkles, Plus } from "lucide-react";
import {
  readAIConfig,
  saveAIConfig,
  sendAIMessage,
  extractCommands,
  abortAIRequest,
  PROVIDER_PRESETS,
  assessCommand,
} from "./ai-service.js";
import type { AIConfig, AIMessage, ChatMessage } from "./ai-service.js";

interface TerminalAIProps {
  serverId: string;
  serverLabel: string;
  onExecute: (command: string) => void;
  onClose: () => void;
  /* 原型 S5 第 585-588 行：AI 抽屉自动引用终端选中内容 */
  selectionText?: string;
}

/* 原型 S5 第 583 行 chip 文案「GLM-4 · ⌘J」：把具体模型归一为模型族标签 */
function modelChipLabel(model: string): string {
  const normalized = (model || "").trim();
  if (!normalized) return "GLM-4";
  if (/glm/i.test(normalized)) return "GLM-4";
  if (/deepseek/i.test(normalized)) return "DeepSeek";
  if (/qwen/i.test(normalized)) return "Qwen";
  if (/gpt/i.test(normalized)) return "GPT";
  return normalized;
}

/* 原型 S5 第 598 行：输入框下方三个快捷追问 fchip */
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
      );
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

function CommandBlock(props: {
  command: string;
  executedBackupTokens: string[];
  onExecute: (cmd: string) => void;
}) {
  const assessment = assessCommand(props.command);
  const needsBackup = assessment.level === "backup_required"
    && !!assessment.backupToken
    && !props.executedBackupTokens.includes(assessment.backupToken);
  const isBlocked = assessment.level === "dangerous" || needsBackup;
  const showWarn = assessment.level !== "safe";
  const title = assessment.level === "dangerous"
    ? assessment.reason
    : (needsBackup ? "请先执行对应的备份命令，再执行修改命令" : assessment.reason);

  return (
    <div className={`tai-cmd-block ${assessment.level === "dangerous" ? "tai-cmd-danger" : ""} ${needsBackup ? "tai-cmd-needs-backup" : ""} ${isBlocked ? "tai-cmd-blocked" : ""}`}>
      {showWarn && <AlertTriangle size={11} className="tai-cmd-warn-icon" />}
      <code>{props.command}</code>
      {assessment.level === "dangerous" ? <span className="tai-cmd-badge tai-cmd-badge-danger">已拦截</span> : null}
      {needsBackup ? <span className="tai-cmd-badge tai-cmd-badge-backup">先备份</span> : null}
      {assessment.level === "safe" && assessment.backupToken ? <span className="tai-cmd-badge tai-cmd-badge-safe">备份</span> : null}
      <button
        type="button"
        className="tai-cmd-run"
        title={title}
        disabled={isBlocked}
        onClick={() => props.onExecute(props.command)}
      >
        {/* 原型 S5 命令块右侧「↵ 发送」提示（保留点击发送能力） */}
        <span className="tai-cmd-run-hint">↵ 发送</span>
      </button>
    </div>
  );
}

function MessageBubble(props: {
  msg: ChatMessage;
  executedBackupTokens: string[];
  onExecute: (cmd: string) => void;
  /* 原型 S5 第 585 行引用 chip「已引用选中 N 行」：选中引用生效中时随用户消息展示 */
  selectionLineCount?: number;
}) {
  const { msg } = props;
  if (msg.role === "user") {
    return (
      <div className="tai-msg tai-msg-user">
        {/* 原型引用块形态：1px --line 描边 + --panel 底的紧凑卡片，右对齐 */}
        <div className="tai-user-card">
          {props.selectionLineCount ? (
            <span className="chip tai-user-quote-chip">已引用选中 {props.selectionLineCount} 行</span>
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
              {lines.map((line, j) => (
                <CommandBlock
                  key={j}
                  command={line.trim()}
                  executedBackupTokens={props.executedBackupTokens}
                  onExecute={props.onExecute}
                />
              ))}
            </div>
          );
        }
        const text = part.trim();
        if (!text) return null;
        return <p key={i} className="tai-msg-text">{text}</p>;
      })}
    </div>
  );
}

function SettingsPanel(props: { config: AIConfig; onChange: (c: AIConfig) => void; onClose: () => void }) {
  const [cfg, setCfg] = useState<AIConfig>({ ...props.config });

  function handleSave() {
    const saved = saveAIConfig(cfg);
    props.onChange(saved);
    props.onClose();
  }

  function applyPreset(index: number) {
    const p = PROVIDER_PRESETS[index];
    if (!p) return;
    setCfg({
      ...cfg,
      apiEndpoint: p.endpoint,
      model: p.model,
      apiKey: p.apiKey ?? cfg.apiKey,
      enabled: true,
    });
  }

  return (
    <div className="tai-settings">
      <div className="tai-settings-title">AI 配置</div>

      <div className="tai-settings-field">
        <span>服务商预设</span>
        <div className="tai-preset-list">
          {PROVIDER_PRESETS.map((p, i) => (
            <button
              key={p.label}
              type="button"
              className={`tai-preset-btn ${cfg.apiEndpoint === p.endpoint ? "tai-preset-active" : ""}`}
              onClick={() => applyPreset(i)}
            >
              <strong>{p.label}</strong>
              <span>{p.note}</span>
            </button>
          ))}
        </div>
      </div>

      <label className="tai-settings-field">
        <span>API Endpoint</span>
        <input
          className="tai-input"
          value={cfg.apiEndpoint}
          onChange={(e) => setCfg({ ...cfg, apiEndpoint: e.target.value })}
          placeholder="https://open.bigmodel.cn/api/paas/v4/chat/completions"
        />
      </label>
      <label className="tai-settings-field">
        <span>API Key</span>
        <input
          className="tai-input"
          type="password"
          value={cfg.apiKey}
          onChange={(e) => setCfg({ ...cfg, apiKey: e.target.value })}
          placeholder="sk-..."
        />
      </label>
      <label className="tai-settings-field">
        <span>模型</span>
        <input
          className="tai-input"
          value={cfg.model}
          onChange={(e) => setCfg({ ...cfg, model: e.target.value })}
          placeholder="glm-4-flash"
        />
      </label>
      <label className="tai-settings-check">
        <input
          type="checkbox"
          checked={cfg.enabled}
          onChange={(e) => setCfg({ ...cfg, enabled: e.target.checked })}
        />
        <span>启用 AI 助手</span>
      </label>
      <div className="tai-settings-actions">
        <button type="button" className="tai-btn-save" onClick={handleSave}>保存</button>
        <button type="button" className="tai-btn-cancel" onClick={props.onClose}>取消</button>
      </div>
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
  const panelRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  const configured = config.enabled && !!config.apiKey && !!config.apiEndpoint;
  const canStartNewChat = messages.length > 0 || !!input || !!streamContent || isLoading;
  /* 原型 S5 第 585-588 行：抽屉自动引用终端选中内容 */
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
  const inputPlaceholder = !configured
    ? "请先点击右上⚙配置 AI"
    : (selectionText ? "针对选中内容提问…" : "描述你想做的事…");

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
  }, [props.serverId]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, streamContent]);

  useEffect(() => {
    saveChatHistory(props.serverId, messages);
  }, [messages, props.serverId]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const panel = panelRef.current;
      const active = document.activeElement;
      if (!panel || !(active instanceof Node) || !panel.contains(active)) return;
      if (showSettings) setShowSettings(false);
      else if (isLoading) { abortAIRequest(); setIsLoading(false); setStreamContent(""); }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [showSettings, isLoading]);

  const handleSend = useCallback(async (messageText?: string) => {
    const text = (messageText ?? input).trim();
    if (!text || isLoading || !configured) return;

    const userMsg: ChatMessage = { id: genId(), role: "user", content: text, timestamp: Date.now() };
    const nextMessages = [...messages, userMsg];
    setMessages(nextMessages);
    setInput("");
    setIsLoading(true);
    setStreamContent("");

    /* 原型 S5 第 585-588 行：提问时把终端选中内容作为引用上下文带给模型 */
    const history: AIMessage[] = nextMessages.slice(-10).map((m) => ({
      role: m.role,
      content: m.content,
    }));
    if (selectionText) {
      history.unshift({
        role: "user",
        content: `【终端选中内容（已引用）】\n${selectionText}\n\n【问题】${text}`,
      });
    }

    try {
      const fullContent = await sendAIMessage(history, (chunk) => {
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
  }, [configured, input, isLoading, messages, selectionText]);

  function handleExecute(command: string) {
    const assessment = assessCommand(command);
    const needsBackup = assessment.level === "backup_required"
      && !!assessment.backupToken
      && !executedBackupTokens.includes(assessment.backupToken);

    if (assessment.level === "dangerous" || needsBackup) {
      return;
    }

    if (assessment.backupToken) {
      setExecutedBackupTokens((prev) => (
        prev.includes(assessment.backupToken as string)
          ? prev
          : [...prev, assessment.backupToken as string]
      ));
    }

    props.onExecute(command + "\n");
  }

  function handleNewChat() {
    abortAIRequest();
    setMessages([]);
    setInput("");
    setIsLoading(false);
    setStreamContent("");
    setExecutedBackupTokens([]);
    saveChatHistory(props.serverId, []);
    setShowSettings(false);
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  };

  return (
    <div
      ref={panelRef}
      className="tai-dropdown"
      onMouseDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
    >
      {/* Header —— 原型 S5 第 583 行：`终端 AI` + 模型 chip + 动作。320px 抽屉里一行最多容纳
          4 个图标级元素，"新对话"砍文字改纯图标（tooltip 承载语义），chip 去掉「· ⌘J」尾巴。 */}
      <div className="tai-header">
        <div className="tai-header-title">
          <Sparkles size={13} className="tai-sparkle" />
          <span>终端 AI</span>
          {!configured && <span className="tai-badge-unconfigured">未配置</span>}
        </div>
        <div className="tai-header-actions">
          <span className="chip tai-model-chip" title={`${config.model || "GLM-4"} · 快捷键 ⌘J`}>{modelChipLabel(config.model)}</span>
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
          <button type="button" className="tai-hdr-btn" title="设置" onClick={() => setShowSettings((v) => !v)}>
            <Settings size={13} />
          </button>
          <button type="button" className="tai-hdr-btn" title="关闭" onClick={props.onClose}>
            <X size={13} />
          </button>
        </div>
      </div>

      {showSettings ? (
        <SettingsPanel
          config={config}
          onChange={(c) => { setConfig(c); setShowSettings(false); }}
          onClose={() => setShowSettings(false)}
        />
      ) : (
        <>
          {/* Messages */}
          <div ref={scrollRef} className="tai-messages">
            {/* 原型 S5 第 585-588 行：引用卡「已引用选中 N 行」+ mono 预览 */}
            {selectionText ? (
              <div className="tai-quote-card">
                <span className="chip tai-quote-chip">已引用选中 {selectionLineCount} 行</span>
                <span className="tai-quote-preview">{selectionPreview}</span>
              </div>
            ) : null}
            {messages.length === 0 && !isLoading && (
              <div className="tai-welcome">
                <Sparkles size={20} className="tai-welcome-icon" />
                <p className="tai-welcome-title">智能终端助手</p>
                <p className="tai-welcome-desc">用自然语言描述你想做的事，我来帮你生成命令</p>
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
                onExecute={handleExecute}
                selectionLineCount={selectionLineCount}
              />
            ))}

            {isLoading && streamContent && (
              <div className="tai-msg tai-msg-ai tai-msg-streaming">
                <p className="tai-msg-text">{streamContent}</p>
              </div>
            )}

            {isLoading && !streamContent && (
              <div className="tai-msg tai-msg-ai tai-thinking">
                <Loader size={12} className="tai-spin" />
                <span>思考中…</span>
              </div>
            )}
          </div>

          {/* Input —— 原型 S5 第 597-598 行：输入框 + 3 个 fchip 快捷追问 */}
          <div className="tai-input-bar">
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
            <button
              type="button"
              className="tai-send-btn"
              disabled={!input.trim() || isLoading || !configured}
              onClick={() => void handleSend()}
              title="发送"
            >
              {isLoading ? <Loader size={14} className="tai-spin" /> : <Send size={14} />}
            </button>
            <div className="tai-quick-asks">
              {QUICK_ASKS.map((ask) => (
                <button
                  key={ask}
                  type="button"
                  className="fchip tai-quick-ask"
                  disabled={!configured || isLoading}
                  onClick={() => setInput(ask)}
                >
                  {ask}
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
