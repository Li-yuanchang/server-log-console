import { useState } from "react";
import { ArrowLeft, Plus, Pencil, Check, PlugZap, Download, Info, Trash2, CircleAlert, X } from "lucide-react";
import {
  saveAIConfig,
  testProviderConnection,
  PROVIDER_PRESETS,
  PROTOCOL_NOTES,
  PROTOCOL_LABELS,
} from "./ai-service.js";
import type { AIConfig, AIProviderProfile, AIProtocol, ConnectionTestResult } from "./ai-service.js";

/* 终端 AI 设置面板：服务商（多 profile + 协议 + 连接测试 + 模型拉取）与会话参数两分区 */

type TestState = { phase: "idle" } | { phase: "testing" } | { phase: "done"; result: ConnectionTestResult };

function Toggle(props: { on: boolean; onChange: (on: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={props.on}
      aria-label={props.label}
      className={`tai-set-switch ${props.on ? "on" : ""}`}
      onClick={() => props.onChange(!props.on)}
    />
  );
}

function ProviderEditor(props: {
  draft: AIProviderProfile;
  onChange: (p: AIProviderProfile) => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  const { draft } = props;
  const [test, setTest] = useState<TestState>({ phase: "idle" });
  const [fetching, setFetching] = useState(false);

  async function runTest() {
    setTest({ phase: "testing" });
    const result = await testProviderConnection(draft);
    setTest({ phase: "done", result });
  }

  async function runFetch() {
    setFetching(true);
    const result = await testProviderConnection(draft);
    setFetching(false);
    setTest({ phase: "done", result });
    if (result.ok && result.models.length) {
      /* 保留已勾选且仍存在的模型 + 追加新发现的模型 */
      const kept = draft.models.filter((m) => result.models.includes(m));
      const fresh = result.models.filter((m) => !draft.models.includes(m));
      props.onChange({ ...draft, models: [...kept, ...fresh] });
    }
  }

  function toggleModel(model: string) {
    const on = draft.models.includes(model);
    props.onChange({
      ...draft,
      models: on ? draft.models.filter((m) => m !== model) : [...draft.models, model],
    });
  }

  function addModelManually(raw: string) {
    const model = raw.trim();
    if (!model || draft.models.includes(model)) return;
    props.onChange({ ...draft, models: [...draft.models, model] });
  }

  return (
    <div className="tai-set-form" onClick={(e) => e.stopPropagation()}>
      <div className="tai-set-field">
        <span>名称</span>
        <input
          className="tai-set-input"
          type="text"
          value={draft.name}
          placeholder="服务商名称"
          onChange={(e) => props.onChange({ ...draft, name: e.target.value })}
        />
      </div>
      <div className="tai-set-field">
        <span>协议类型</span>
        <div className="tai-set-proto">
          {(Object.keys(PROTOCOL_LABELS) as AIProtocol[]).map((p) => (
            <button
              key={p}
              type="button"
              className={draft.protocol === p ? "on" : ""}
              onClick={() => props.onChange({ ...draft, protocol: p })}
            >
              {PROTOCOL_LABELS[p]}
            </button>
          ))}
        </div>
        <div className="tai-set-hint"><Info size={10} />{PROTOCOL_NOTES[draft.protocol]}</div>
      </div>
      <div className="tai-set-field">
        <span>API Endpoint</span>
        <input
          className="tai-set-input tai-set-mono"
          type="text"
          value={draft.endpoint}
          placeholder="https://api.example.com/v1"
          onChange={(e) => props.onChange({ ...draft, endpoint: e.target.value })}
        />
      </div>
      {draft.protocol !== "ollama" ? (
        <div className="tai-set-field">
          <span>API Key</span>
          <input
            className="tai-set-input tai-set-mono"
            type="password"
            value={draft.apiKey}
            placeholder="sk-..."
            onChange={(e) => props.onChange({ ...draft, apiKey: e.target.value })}
          />
        </div>
      ) : null}
      <div className="tai-set-field">
        <span>连接与模型</span>
        <div className="tai-set-actions">
          <button className="tai-set-btn" type="button" disabled={test.phase === "testing"} onClick={() => void runTest()}>
            <PlugZap size={12} />测试连接
          </button>
          <button className="tai-set-btn" type="button" disabled={fetching} onClick={() => void runFetch()}>
            {fetching ? <span className="tai-spin" /> : <Download size={12} />}拉取模型列表
          </button>
          {test.phase === "done" ? (
            test.result.ok ? (
              <span className="tai-set-test ok">
                <Check size={12} />连接成功 · <span className="lat">{test.result.latencyMs}ms</span> · {test.result.models.length} 个模型
              </span>
            ) : (
              <span className="tai-set-test err"><CircleAlert size={12} />{test.result.error}</span>
            )
          ) : null}
        </div>
      </div>
      <div className="tai-set-field">
        <span>启用的模型（勾选后可在对话中切换）</span>
        <div className="tai-set-models">
          {draft.models.map((m) => (
            <button key={m} type="button" className="tai-set-mchip on" onClick={() => toggleModel(m)}>
              <Check size={11} />{m}
            </button>
          ))}
          <input
            className="tai-set-input tai-set-mono tai-set-mchip-add"
            type="text"
            placeholder="+ 手动添加模型 ID"
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addModelManually(e.currentTarget.value);
                e.currentTarget.value = "";
              }
            }}
          />
        </div>
      </div>
      <div className="tai-set-actions" style={{ justifyContent: "flex-end" }}>
        <button className="tai-set-btn" type="button" onClick={props.onCancel}>取消</button>
        <button className="tai-set-btn primary" type="button" onClick={props.onSave}>
          <Check size={12} />保存
        </button>
      </div>
    </div>
  );
}

export function TerminalAISettings(props: { config: AIConfig; onChange: (c: AIConfig) => void; onClose: () => void }) {
  const [tab, setTab] = useState<"providers" | "session">("providers");
  /* 编辑态：null = 无编辑；draft 为空 id = 新增 */
  const [draft, setDraft] = useState<AIProviderProfile | null>(null);
  const [isNew, setIsNew] = useState(false);
  const config = props.config;

  function commit(next: AIConfig) {
    props.onChange(saveAIConfig(next));
  }

  function setDefault(id: string) {
    commit({ ...config, activeProviderId: id });
  }

  function deleteProvider(id: string) {
    const providers = config.providers.filter((p) => p.id !== id);
    if (!providers.length) return;
    const activeProviderId = config.activeProviderId === id ? providers[0].id : config.activeProviderId;
    commit({ ...config, providers, activeProviderId });
  }

  function startEdit(provider: AIProviderProfile) {
    setIsNew(false);
    setDraft({ ...provider, models: [...provider.models] });
  }

  function startAdd() {
    const preset = PROVIDER_PRESETS[0];
    setIsNew(true);
    setDraft({
      id: "",
      name: "",
      protocol: preset.protocol,
      endpoint: "",
      apiKey: "",
      models: [],
    });
  }

  function saveDraft() {
    if (!draft) return;
    const saved: AIProviderProfile = {
      ...draft,
      id: draft.id || `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    };
    const exists = config.providers.some((p) => p.id === saved.id);
    const providers = exists
      ? config.providers.map((p) => (p.id === saved.id ? saved : p))
      : [...config.providers, saved];
    const activeModel = { ...config.activeModel };
    if (!activeModel[saved.id] && saved.models.length) activeModel[saved.id] = saved.models[0];
    commit({
      ...config,
      providers,
      activeProviderId: exists ? config.activeProviderId : config.activeProviderId || saved.id,
      activeModel,
    });
    setDraft(null);
  }

  function updateSession(patch: Partial<AIConfig["session"]>) {
    commit({ ...config, session: { ...config.session, ...patch } });
  }

  return (
    <>
      {/* Header：返回对话 */}
      <div className="tai-header">
        <div className="tai-header-title">
          <button type="button" className="tai-hdr-btn" title="返回对话" onClick={() => { setDraft(null); props.onClose(); }}>
            <ArrowLeft size={14} />
          </button>
          <span>AI 设置</span>
          <span className="chip tai-model-chip">{config.providers.length} 个服务商</span>
        </div>
        <div className="tai-header-actions">
          <button type="button" className="tai-hdr-btn" title="关闭" onClick={() => { setDraft(null); props.onClose(); }}>
            <X size={13} />
          </button>
        </div>
      </div>

      <div className="tai-set-tabs">
        <button type="button" className={tab === "providers" ? "on" : ""} onClick={() => setTab("providers")}>服务商</button>
        <button type="button" className={tab === "session" ? "on" : ""} onClick={() => setTab("session")}>会话</button>
      </div>

      {tab === "providers" ? (
        <div className="tai-set-body">
          <div className="tai-set-sec">默认服务商用于新对话<span className="n">点击卡片切换</span></div>
          {config.providers.map((p) => {
            const isDefault = p.id === config.activeProviderId;
            return (
              <div key={p.id}>
                <div
                  className={`tai-set-p ${isDefault ? "is-default" : ""}`}
                  onClick={() => setDefault(p.id)}
                  role="button"
                  aria-label={`设 ${p.name} 为默认服务商`}
                >
                  <div className="tai-set-p-row">
                    <span className="tai-set-radio" />
                    <span className="tai-set-p-name">{p.name}</span>
                    <span className="chip tai-model-chip">{PROTOCOL_LABELS[p.protocol]}</span>
                    <div className="sp">
                      {isDefault ? <span className="tai-set-defbadge">默认</span> : null}
                      <button
                        type="button"
                        className="tai-hdr-btn"
                        title="编辑"
                        onClick={(e) => { e.stopPropagation(); startEdit(p); }}
                      >
                        <Pencil size={12} />
                      </button>
                      {config.providers.length > 1 ? (
                        <button
                          type="button"
                          className="tai-hdr-btn"
                          title="删除"
                          onClick={(e) => { e.stopPropagation(); deleteProvider(p.id); }}
                        >
                          <Trash2 size={12} />
                        </button>
                      ) : null}
                    </div>
                  </div>
                  <div className="tai-set-p-meta">
                    <span className={`tai-set-dot ${p.endpoint ? "ok" : "na"}`} />
                    <span className="host">{p.endpoint || "未配置 Endpoint"}</span>
                    <span>· {p.models.length} 个模型</span>
                  </div>
                </div>
                {draft && !isNew && config.providers.some((x) => x.id === p.id) && draft.id === p.id ? (
                  <ProviderEditor
                    draft={draft}
                    onChange={setDraft}
                    onCancel={() => setDraft(null)}
                    onSave={saveDraft}
                  />
                ) : null}
              </div>
            );
          })}
          {draft && isNew ? (
            <ProviderEditor draft={draft} onChange={setDraft} onCancel={() => setDraft(null)} onSave={saveDraft} />
          ) : (
            <button className="tai-set-add" type="button" onClick={startAdd}>
              <Plus size={13} />添加服务商
            </button>
          )}
        </div>
      ) : (
        <div className="tai-set-body">
          <div className="tai-set-srow">
            <div className="lbl">启用 AI 助手<Toggle on={config.enabled} label="启用 AI 助手" onChange={(on) => commit({ ...config, enabled: on })} /></div>
            <div className="desc">关闭后隐藏对话入口的可用状态；配置仍会保留。</div>
          </div>
          <div className="tai-set-srow">
            <div className="lbl">上下文轮数<span className="val">{config.session.contextTurns} 轮</span></div>
            <input
              type="range" className="tai-set-range" min={2} max={30} step={2}
              value={config.session.contextTurns}
              onChange={(e) => updateSession({ contextTurns: Number(e.target.value) })}
            />
            <div className="desc">每次提问携带的对话历史轮数。越大越有连贯性，也越消耗 token；建议 8–12。</div>
          </div>
          <div className="tai-set-srow">
            <div className="lbl">最大输出长度<span className="val">{config.session.maxTokens} tokens</span></div>
            <input
              type="range" className="tai-set-range" min={512} max={8192} step={512}
              value={config.session.maxTokens}
              onChange={(e) => updateSession({ maxTokens: Number(e.target.value) })}
            />
            <div className="desc">限制单次回答的最大生成量，命令场景 1024–2048 通常足够。</div>
          </div>
          <div className="tai-set-srow">
            <div className="lbl">回答随机性 temperature<span className="val">{config.session.temperature.toFixed(1)}</span></div>
            <input
              type="range" className="tai-set-range" min={0} max={1} step={0.1}
              value={config.session.temperature}
              onChange={(e) => updateSession({ temperature: Number(e.target.value) })}
            />
            <div className="desc">生成命令建议建议保持低随机性（≤0.5），讲解类问题可以调高。</div>
          </div>
          <div className="tai-set-srow">
            <div className="lbl">流式输出<Toggle on={config.session.streaming} label="流式输出" onChange={(on) => updateSession({ streaming: on })} /></div>
            <div className="desc">关闭后一次性返回完整回答。</div>
          </div>
          <div className="tai-set-srow">
            <div className="lbl">自动附带终端画面<Toggle on={config.session.attachContext} label="自动附带终端画面" onChange={(on) => updateSession({ attachContext: on })} /></div>
            <div className="desc">提问时把终端最近输出随消息带给模型；对话输入区也能随时开关。</div>
          </div>
        </div>
      )}
    </>
  );
}
