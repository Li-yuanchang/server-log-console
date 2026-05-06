import { useState, useRef, useEffect, useCallback } from "react";
import { X, Send, Settings, Play, Loader, AlertTriangle, Sparkles, Plus } from "lucide-react";
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
        <Play size={10} fill="currentColor" />
      </button>
    </div>
  );
}

function MessageBubble(props: { msg: ChatMessage; executedBackupTokens: string[]; onExecute: (cmd: string) => void }) {
  const { msg } = props;
  if (msg.role === "user") {
    return <div className="tai-msg tai-msg-user"><p>{msg.content}</p></div>;
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

    const history: AIMessage[] = nextMessages.slice(-10).map((m) => ({
      role: m.role,
      content: m.content,
    }));

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
  }, [configured, input, isLoading, messages]);

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
      {/* Header */}
      <div className="tai-header">
        <div className="tai-header-title">
          <Sparkles size={13} className="tai-sparkle" />
          <span>AI 终端助手</span>
          {!configured && <span className="tai-badge-unconfigured">未配置</span>}
        </div>
        <div className="tai-header-actions">
          <button
            type="button"
            className="tai-hdr-btn tai-hdr-btn-chat"
            title="新对话"
            disabled={!canStartNewChat}
            onClick={handleNewChat}
          >
            <Plus size={12} />
            <span>新对话</span>
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

          {/* Input */}
          <div className="tai-input-bar">
            <textarea
              ref={inputRef}
              className="tai-textarea"
              placeholder={configured ? "描述你想做的事…" : "请先点击右上⚙配置 AI"}
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
          </div>
        </>
      )}
    </div>
  );
}
