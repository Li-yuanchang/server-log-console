import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SlcDesktopUpdateState, SlcDesktopUpdateStatus } from "../types/desktop-update.js";
import type { ToastState } from "./FeedbackOverlays.js";

/* ============================================================
   软件更新面板（设置中心第三视图）
   视觉与文案依据：docs/prototypes/update-center-v1.html（演示场景切换器为原型专用，不实现）
   方案：docs/在线更新与打包方案.md §4.3
   ============================================================ */

const AUTO_CHECK_KEY = "slc.update.auto-check";
const AUTO_CHECK_SESSION_KEY = "slc.update.auto-checked-this-session";
const CHECK_LOG_KEY = "slc.update.check-log";
const CHECK_LOG_LIMIT = 5;
const RESTART_OVERLAY_DELAY_MS = 800;
const RESTART_STALL_HINT_MS = 30000;
const PROGRESS_THROTTLE_MS = 200;

const IDLE_UPDATE_STATE: SlcDesktopUpdateState = {
  status: "idle",
  error: null,
  appInfo: null,
  updateInfo: null,
  progress: null,
  updateUrl: null,
  bundledReleaseNotes: null,
};

export type DesktopUpdateHostKind = "desktop" | "extension" | "web";

export interface DesktopUpdateCheckLogEntry {
  time: string;
  ok: boolean;
  message: string;
}

/** UI 构建版本号：vite define 注入裸标识符 __APP_VERSION__，未注入时兜底 0.0.0 */
export function resolveAppVersion(): string {
  return typeof __APP_VERSION__ === "string" && __APP_VERSION__ ? __APP_VERSION__ : "0.0.0";
}

/** 宿主形态：Electron（有 slcDesktopUpdate）/ Chrome 扩展（chrome.runtime.id）/ Web（网关托管） */
export function resolveUpdateHostKind(): DesktopUpdateHostKind {
  if (window.slcDesktopUpdate) return "desktop";
  const chromeRuntime = (window as unknown as { chrome?: { runtime?: { id?: string } } }).chrome?.runtime;
  if (chromeRuntime?.id) return "extension";
  return "web";
}

function formatNowLabel(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function formatMb(bytes: number): string {
  return (bytes / 1024 / 1024).toFixed(1);
}

function formatReleaseDate(value?: string): string {
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${parsed.getFullYear()}-${p(parsed.getMonth() + 1)}-${p(parsed.getDate())}`;
}

function readCheckLog(): DesktopUpdateCheckLogEntry[] {
  try {
    const raw = localStorage.getItem(CHECK_LOG_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((entry): entry is DesktopUpdateCheckLogEntry =>
        Boolean(entry) && typeof (entry as DesktopUpdateCheckLogEntry).time === "string"
        && typeof (entry as DesktopUpdateCheckLogEntry).message === "string"
        && typeof (entry as DesktopUpdateCheckLogEntry).ok === "boolean")
      .slice(0, CHECK_LOG_LIMIT);
  } catch {
    return [];
  }
}

/* ============================================================
   useDesktopUpdate：App 级订阅更新状态（挂载即生效，面板只在 update 视图挂载）
   ============================================================ */

export interface DesktopUpdateController {
  state: SlcDesktopUpdateState;
  /** available / downloading / ready —— 驱动 rail 与设置入口红点 */
  updateAvailable: boolean;
  checkLog: DesktopUpdateCheckLogEntry[];
  check: () => void;
  download: () => void;
  install: () => void;
}

export function useDesktopUpdate(): DesktopUpdateController {
  const [state, setState] = useState<SlcDesktopUpdateState>(IDLE_UPDATE_STATE);
  const stateRef = useRef<SlcDesktopUpdateState>(IDLE_UPDATE_STATE);
  const lastProgressAtRef = useRef(0);
  const [checkLog, setCheckLog] = useState<DesktopUpdateCheckLogEntry[]>(() => readCheckLog());

  const appendCheckLog = useCallback((ok: boolean, message: string) => {
    const entry: DesktopUpdateCheckLogEntry = { time: formatNowLabel(), ok, message };
    setCheckLog((prev) => {
      const next = [entry, ...prev].slice(0, CHECK_LOG_LIMIT);
      try {
        localStorage.setItem(CHECK_LOG_KEY, JSON.stringify(next));
      } catch {
        /* 持久化失败不影响 UI */
      }
      return next;
    });
  }, []);

  /** 订阅推送 / 主动调用结果统一入口；进度事件按 200ms 节流防渲染抖动 */
  const applyState = useCallback((next: SlcDesktopUpdateState, options?: { logTransitions?: boolean }) => {
    if (next.status === "downloading" && next.progress) {
      const now = Date.now();
      if (now - lastProgressAtRef.current < PROGRESS_THROTTLE_MS) return;
      lastProgressAtRef.current = now;
    } else {
      lastProgressAtRef.current = 0;
    }
    const prev = stateRef.current;
    stateRef.current = next;
    setState(next);
    if (options?.logTransitions && next.status !== prev.status) {
      const version = next.updateInfo?.version ?? next.appInfo?.version ?? resolveAppVersion();
      switch (next.status) {
        case "up-to-date":
          appendCheckLog(true, `${version} 为正式版渠道最新版本`);
          break;
        case "available":
          appendCheckLog(true, `发现新版本 ${next.updateInfo?.version ?? version}`);
          break;
        case "ready":
          appendCheckLog(true, `${next.updateInfo?.version ?? version} 下载完成，校验通过`);
          break;
        case "error":
          appendCheckLog(false, next.error || "更新失败");
          break;
        default:
          break;
      }
    }
  }, [appendCheckLog]);

  useEffect(() => {
    const api = window.slcDesktopUpdate;
    if (!api) return undefined;
    let disposed = false;
    // 初次同步主进程状态（不写检查记录，避免把历史状态当新检查）
    api.getState()
      .then((initial) => {
        if (!disposed) applyState(initial);
      })
      .catch(() => { /* 主进程暂不可达时保持 idle */ });
    const unsubscribe = api.onUpdateState((next) => applyState(next, { logTransitions: true }));
    // 启动自动检查：开关开启且本会话未检查过时执行一次（结果只做红点提醒，不自动下载）
    const autoCheckEnabled = localStorage.getItem(AUTO_CHECK_KEY) !== "false";
    const alreadyChecked = sessionStorage.getItem(AUTO_CHECK_SESSION_KEY) === "1";
    if (autoCheckEnabled && !alreadyChecked) {
      sessionStorage.setItem(AUTO_CHECK_SESSION_KEY, "1");
      api.check().catch(() => { /* 自动检查失败静默，红点逻辑不受影响 */ });
    }
    return () => {
      disposed = true;
      unsubscribe();
    };
  }, [applyState]);

  const check = useCallback(() => {
    window.slcDesktopUpdate?.check()
      .then((next) => applyState(next, { logTransitions: true }))
      .catch(() => { /* 失败状态经订阅通道推送 */ });
  }, [applyState]);

  const download = useCallback(() => {
    window.slcDesktopUpdate?.download()
      .then((next) => applyState(next, { logTransitions: true }))
      .catch(() => { /* 失败状态经订阅通道推送 */ });
  }, [applyState]);

  const install = useCallback(() => {
    window.slcDesktopUpdate?.install();
  }, []);

  const updateAvailable = state.status === "available" || state.status === "downloading" || state.status === "ready";

  return { state, updateAvailable, checkLog, check, download, install };
}

/* ============================================================
   面板
   ============================================================ */

const STATUS_TEXT: Record<SlcDesktopUpdateStatus, string> = {
  idle: "就绪",
  checking: "正在检查更新…",
  unavailable: "暂不可用",
  "up-to-date": "已是最新版本",
  available: "发现新版本",
  downloading: "正在下载…",
  ready: "待重启安装",
  error: "更新失败",
};

const STATUS_TONE: Record<SlcDesktopUpdateStatus, "" | "info" | "ok" | "warn" | "err" | "dim"> = {
  idle: "",
  checking: "info",
  unavailable: "dim",
  "up-to-date": "ok",
  available: "warn",
  downloading: "info",
  ready: "ok",
  error: "err",
};

const UNAVAILABLE_FALLBACK = "开发模式不支持自动更新";

function platformLabel(state: SlcDesktopUpdateState): string {
  const info = state.appInfo;
  if (!info) return "";
  if (info.platform === "darwin") return info.arch === "arm64" ? "macOS (Apple Silicon)" : "macOS (Intel)";
  if (info.platform === "win32") return info.arch === "arm64" ? "Windows (ARM64)" : "Windows (x64)";
  return `Linux (${info.arch})`;
}

function hostBadgeLabel(kind: DesktopUpdateHostKind, state: SlcDesktopUpdateState): string {
  if (kind === "desktop") {
    const platform = platformLabel(state);
    return platform ? `桌面版 · ${platform}` : "桌面版";
  }
  if (kind === "extension") return "Chrome 扩展";
  return "Web 版";
}

/** 非 Web/扩展宿主：不渲染主按钮，展示各自更新方式说明（对齐方案 §4.3 文案策略） */
function hostActionNote(kind: DesktopUpdateHostKind): string {
  if (kind === "extension") return "扩展更新由浏览器负责（P1 接入自托管清单）";
  return "UI 资源随网关更新，发布完成后刷新浏览器生效";
}

interface NoteGroup {
  label: string | null;
  kind: "feat" | "fix" | "plain";
  items: string[];
}

/** releaseNotes 简单分组：独立的「新增:/修复:」行作为小标题，其余为列表项（要求带冒号，避免误吞以"新增/修复"开头的条目） */
function parseReleaseNotes(notes: string): NoteGroup[] {
  const groups: NoteGroup[] = [];
  let current: NoteGroup | null = null;
  const pushItem = (item: string) => {
    if (!current) {
      current = { label: null, kind: "plain", items: [] };
      groups.push(current);
    }
    current.items.push(item);
  };
  for (const rawLine of notes.split(/\r?\n/)) {
    const line = rawLine.trim().replace(/^[-*]\s*/, "");
    if (!line) continue;
    const heading = line.match(/^(新增|修复)[:：]\s*(.*)$/);
    if (heading) {
      current = { label: heading[1], kind: heading[1] === "新增" ? "feat" : "fix", items: [] };
      groups.push(current);
      if (heading[2]) current.items.push(heading[2]);
    } else {
      pushItem(line);
    }
  }
  return groups;
}

export interface UpdateCenterPanelProps {
  state: SlcDesktopUpdateState;
  checkLog: DesktopUpdateCheckLogEntry[];
  onCheck: () => void;
  onDownload: () => void;
  onInstall: () => void;
  showToast: (type: ToastState["type"], message: string) => void;
}

export function UpdateCenterPanel(props: UpdateCenterPanelProps) {
  const { state, checkLog, onCheck, onDownload, onInstall, showToast } = props;
  const hostKind = useMemo(resolveUpdateHostKind, []);
  const isDesktop = hostKind === "desktop";

  const [autoCheckEnabled, setAutoCheckEnabled] = useState(() => localStorage.getItem(AUTO_CHECK_KEY) !== "false");
  const [sourceTesting, setSourceTesting] = useState(false);
  const [sourceDraft, setSourceDraft] = useState<string | null>(null);
  const [restartPending, setRestartPending] = useState(false);
  const [restartStalled, setRestartStalled] = useState(false);

  // 兜底提示：遮罩超过阈值仍未重启，说明客户端退出被阻塞，引导用户手动退出完成安装
  useEffect(() => {
    if (!restartPending) {
      setRestartStalled(false);
      return;
    }
    const timer = window.setTimeout(() => setRestartStalled(true), RESTART_STALL_HINT_MS);
    return () => window.clearTimeout(timer);
  }, [restartPending]);

  const status: SlcDesktopUpdateStatus = state.status;
  const nextVersion = state.updateInfo?.version ?? "";
  const showNextVersion = isDesktop && (status === "available" || status === "downloading" || status === "ready");
  const currentVersion = state.appInfo?.version ?? resolveAppVersion();

  const statusText = status === "available" && nextVersion
    ? `发现新版本 ${nextVersion}`
    : status === "unavailable"
      ? (state.error || UNAVAILABLE_FALLBACK)
      : STATUS_TEXT[status];

  const badgeTone = STATUS_TONE[status];

  const mainActionDisabled = status === "checking" || status === "downloading" || status === "unavailable";
  const mainActionLabel = (() => {
    switch (status) {
      case "checking":
        return "检查中…";
      case "downloading":
        return "下载中…";
      case "ready":
        return "重启并安装";
      case "error":
        return "重试检查";
      case "available":
        return "下载更新";
      default:
        return "检查更新";
    }
  })();

  const lastCheckLabel = checkLog[0]?.time ?? "从未检查";

  const handleMainAction = () => {
    if (status === "available") {
      onDownload();
      return;
    }
    if (status === "ready") {
      // 对齐原型 restart-overlay：先遮罩，稍候再调 install()
      setRestartPending(true);
      window.setTimeout(() => onInstall(), RESTART_OVERLAY_DELAY_MS);
      return;
    }
    onCheck();
  };

  const toggleAutoCheck = () => {
    setAutoCheckEnabled((current) => {
      const next = !current;
      try {
        if (next) {
          localStorage.removeItem(AUTO_CHECK_KEY);
        } else {
          localStorage.setItem(AUTO_CHECK_KEY, "false");
        }
      } catch {
        /* 忽略持久化失败 */
      }
      showToast(next ? "success" : "error", `启动时自动检查：${next ? "开" : "关"}`);
      return next;
    });
  };

  // 更新源编辑缓冲：null = 未改动，跟随生效值；测试/保存针对草稿值
  const effectiveSource = state.updateUrl ?? "";
  const sourceValue = sourceDraft ?? effectiveSource;
  const sourceDirty = sourceDraft !== null && sourceDraft.trim() !== effectiveSource;
  const sourceValid = /^https?:\/\//i.test(sourceValue.trim());
  const sourceSaveDisabled = !sourceDirty || !sourceValid || status === "downloading" || status === "ready";

  const handleSaveSource = async () => {
    const url = sourceValue.trim();
    if (!/^https?:\/\//i.test(url)) {
      showToast("error", "更新源需以 http:// 或 https:// 开头");
      return;
    }
    try {
      await window.slcDesktopUpdate?.setSource(url);
      setSourceDraft(null);
      showToast("success", url ? `更新源已保存：${url}` : "已恢复内置更新源");
    } catch {
      showToast("error", "更新源保存失败");
    }
  };

  const handleTestSource = async () => {
    const baseUrl = sourceValue.trim();
    if (!baseUrl) {
      showToast("error", "未配置更新源，无法测试");
      return;
    }
    setSourceTesting(true);
    try {
      const response = await fetch(`${baseUrl.replace(/\/+$/, "")}/manifest.json`, { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const manifest: unknown = await response.json();
      const version = (manifest as { version?: unknown } | null)?.version;
      showToast("success", `更新源可达${typeof version === "string" ? ` · manifest.json 版本 ${version}` : ""}`);
    } catch (detail) {
      showToast("error", `更新源不可达：${detail instanceof Error ? detail.message : "网络错误"}`);
    } finally {
      setSourceTesting(false);
    }
  };

  const showProgress = isDesktop && (status === "downloading" || status === "ready");
  const progressPercent = status === "ready"
    ? 100
    : Math.max(0, Math.min(100, state.progress?.percent ?? 0));
  const progressTitle = status === "ready"
    ? `${nextVersion} 下载完成`
    : `正在下载 ${nextVersion}`;
  const progressBytes = (() => {
    const progress = state.progress;
    if (status === "ready") {
      return progress ? `${formatMb(progress.total)} MB / ${formatMb(progress.total)} MB · 完成` : "完成";
    }
    if (!progress) return "0 MB / -- MB · -- MB/s";
    return `${formatMb(progress.transferred)} MB / ${formatMb(progress.total)} MB · ${formatMb(progress.bytesPerSecond)} MB/s`;
  })();

  // 版本说明双来源：发现新版本时展示新版本说明（随更新清单下发），否则展示包内当前版本说明
  const showNewNotes = showNextVersion && Boolean(state.updateInfo?.releaseNotes);
  const showCurrentNotes = !showNextVersion && Boolean(state.bundledReleaseNotes);
  const notesVisible = showNewNotes || showCurrentNotes;
  const notesVersion = showNewNotes ? (state.updateInfo?.version ?? "") : currentVersion;
  const noteGroups = notesVisible
    ? parseReleaseNotes(showNewNotes ? (state.updateInfo?.releaseNotes ?? "") : (state.bundledReleaseNotes ?? ""))
    : [];
  const releaseDateLabel = showNewNotes ? formatReleaseDate(state.updateInfo?.releaseDate) : "";
  const notesHint = showNewNotes ? (releaseDateLabel ? `发布于 ${releaseDateLabel}` : "新版本") : "当前版本";

  const statusReason = (() => {
    if (status === "unavailable") return state.error || UNAVAILABLE_FALLBACK;
    if (status === "error") return state.error || "更新失败";
    return null;
  })();

  const aboutItems: Array<[string, string]> = (() => {
    const items: Array<[string, string]> = [["UI 构建", resolveAppVersion()]];
    if (isDesktop && state.appInfo) {
      items.push(["当前版本", state.appInfo.version]);
    }
    items.push(["宿主", hostBadgeLabel(hostKind, state)]);
    items.push(["平台架构", isDesktop && state.appInfo ? `${state.appInfo.platform} · ${state.appInfo.arch}` : (navigator.platform || "--")]);
    if (isDesktop && state.appInfo) {
      items.push(["打包模式", state.appInfo.packaged ? "已打包" : "开发模式"]);
    }
    items.push(["更新源", state.updateUrl ?? "--"]);
    items.push(["校验方式", "SHA-256（SHA256SUMS）"]);
    return items;
  })();

  return (
    <div className="settings-update-view">
      <div className="conn-detail-head">
        <div>
          <h2>软件更新</h2>
          <p>检查新版本、下载更新包并应用；更新包一律经 SHA-256 校验后安装。</p>
        </div>
        <div className="conn-head-actions">
          <span className={badgeTone ? `settings-update-badge settings-update-badge-${badgeTone}` : "settings-update-badge"}>
            <span className="settings-update-badge-dot" aria-hidden="true" />
            {statusText}
          </span>
        </div>
      </div>

      <div className="settings-update-scroll">
        <div className="settings-update-inner">

          {/* 1. 状态主卡（自动检查开关对齐 VRC 放在卡片头部） */}
          <section className="settings-update-card">
            <div className="settings-update-card-head">
              <span className="settings-update-kicker">版本状态</span>
              {isDesktop ? (
                <span className="settings-update-head-switch">
                  <span className="settings-update-head-switch-label">自动检查</span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={autoCheckEnabled}
                    aria-label="启动时自动检查"
                    className={autoCheckEnabled ? "settings-update-switch on" : "settings-update-switch"}
                    onClick={toggleAutoCheck}
                  />
                </span>
              ) : null}
            </div>
            <div className="settings-update-card-body">
              <div className="settings-update-hero">
                <div className="settings-update-app-icon" aria-hidden="true">SL</div>
                <div className="settings-update-hero-main">
                  <div className="settings-update-hero-ver">
                    <span className="settings-update-ver-cur">{currentVersion}</span>
                    {showNextVersion ? (
                      <>
                        <span className="settings-update-ver-arrow" aria-hidden="true">→</span>
                        <span className="settings-update-ver-next">{nextVersion || "新版本"}</span>
                      </>
                    ) : null}
                  </div>
                  <div className="settings-update-hero-meta">
                    <span className={isDesktop ? "settings-update-badge settings-update-badge-ok" : "settings-update-badge"}>
                      <span className="settings-update-badge-dot" aria-hidden="true" />
                      {hostBadgeLabel(hostKind, state)}
                    </span>
                  </div>
                </div>
                <div className="settings-update-hero-side">
                  {isDesktop ? (
                    <button
                      type="button"
                      className="settings-update-btn settings-update-btn-primary"
                      onClick={handleMainAction}
                      disabled={mainActionDisabled}
                    >
                      {mainActionLabel}
                    </button>
                  ) : (
                    <span className="settings-update-host-note">{hostActionNote(hostKind)}</span>
                  )}
                  <span className="settings-update-last-check">最近检查：{lastCheckLabel}</span>
                </div>
              </div>

              {statusReason ? (
                <div className={status === "error" ? "settings-update-status-reason settings-update-status-reason-err" : "settings-update-status-reason"}>
                  {statusReason}
                </div>
              ) : null}

              {showProgress ? (
                <div className="settings-update-progress-wrap">
                  <div className="settings-update-progress-top">
                    <span className="settings-update-progress-title">{progressTitle}</span>
                    <span className="settings-update-progress-bytes">{progressBytes}</span>
                  </div>
                  <div className="settings-update-progress-track">
                    <div className="settings-update-progress-fill" style={{ width: `${progressPercent}%` }} />
                  </div>
                  {status === "ready" ? (
                    <div className="settings-update-sha-line">
                      <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="M3 8.5l3.2 3.2L13 5" /></svg>
                      SHA-256 校验通过 · SHA256SUMS
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          </section>

          {/* 2. 版本说明卡（新版本说明 / 当前版本说明） */}
          {notesVisible ? (
            <section className="settings-update-card">
              <div className="settings-update-card-head">
                <span className="settings-update-kicker">版本说明</span>
                <span className="settings-update-hint">{notesHint}</span>
              </div>
              <div className="settings-update-card-body">
                <div className="settings-update-notes-ver">
                  <span className="settings-update-notes-v">{notesVersion}</span>
                  {releaseDateLabel ? <span className="settings-update-notes-d">{releaseDateLabel}</span> : null}
                </div>
                {noteGroups.length ? (
                  noteGroups.map((group, groupIndex) => (
                    <div
                      key={`${group.label ?? "plain"}-${groupIndex}`}
                      className={group.kind === "plain" ? "settings-update-note-group" : `settings-update-note-group settings-update-note-group-${group.kind}`}
                    >
                      {group.label ? <div className="settings-update-note-group-label">{group.label}</div> : null}
                      <ul>
                        {group.items.map((item, itemIndex) => (
                          <li key={itemIndex}>{item}</li>
                        ))}
                      </ul>
                    </div>
                  ))
                ) : (
                  <div className="settings-update-log-empty">暂无版本说明</div>
                )}
              </div>
            </section>
          ) : null}

          {/* 3. 低频信息折叠：更新源（仅桌面版可编辑）/ 检查记录 / 关于 */}
          <details className="settings-update-more">
            <summary>
              更多信息
              <span className="settings-update-more-hint">{isDesktop ? "检查记录 · 更新源 · 关于" : "检查记录 · 关于"}</span>
            </summary>
            <div className="settings-update-more-body">
              {isDesktop ? (
                <section className="settings-update-card">
                  <div className="settings-update-card-head">
                    <span className="settings-update-kicker">更新源</span>
                    <span className="settings-update-hint">保存后立即生效；清空并保存可恢复内置地址</span>
                  </div>
                  <div className="settings-update-card-body">
                    <div className="settings-update-src-line">
                      <input
                        type="text"
                        className={sourceDirty && !sourceValid ? "settings-update-src-input settings-update-src-input-invalid" : "settings-update-src-input"}
                        value={sourceValue}
                        placeholder="http://192.168.2.208/desktop-updates"
                        spellCheck={false}
                        onChange={(event) => setSourceDraft(event.target.value)}
                      />
                      <button
                        type="button"
                        className="settings-update-btn settings-update-btn-primary"
                        onClick={() => { void handleSaveSource(); }}
                        disabled={sourceSaveDisabled}
                        title={sourceSaveDisabled ? (sourceDirty && !sourceValid ? "需以 http:// 或 https:// 开头" : "尚未修改") : `保存 ${sourceValue.trim()}`}
                      >
                        保存
                      </button>
                      <button
                        type="button"
                        className="settings-update-btn settings-update-btn-ghost"
                        onClick={() => { void handleTestSource(); }}
                        disabled={sourceTesting || !sourceValid}
                        title={`测试 ${sourceValue.trim() || "更新源"}/manifest.json 可达性`}
                      >
                        {sourceTesting ? "测试中…" : "测试"}
                      </button>
                    </div>
                  </div>
                </section>
              ) : null}

              <section className="settings-update-card">
                <div className="settings-update-card-head">
                  <span className="settings-update-kicker">检查记录</span>
                  <span className="settings-update-hint">仅保留最近 5 条</span>
                </div>
                <div className="settings-update-card-body">
                  {checkLog.length ? (
                    checkLog.map((entry, index) => (
                      <div key={`${entry.time}-${index}`} className="settings-update-log-row">
                        <span className="settings-update-log-time">{entry.time}</span>
                        <span className={entry.ok ? "settings-update-badge settings-update-badge-ok" : "settings-update-badge settings-update-badge-err"}>
                          <span className="settings-update-badge-dot" aria-hidden="true" />
                          {entry.ok ? "成功" : "失败"}
                        </span>
                        <span className="settings-update-log-msg">{entry.message}</span>
                      </div>
                    ))
                  ) : (
                    <div className="settings-update-log-empty">尚未检查更新 — 点击「检查更新」开始，记录保留最近 5 条。</div>
                  )}
                </div>
              </section>

              <section className="settings-update-card settings-update-card-last">
                <div className="settings-update-card-head">
                  <span className="settings-update-kicker">关于本软件</span>
                </div>
                <div className="settings-update-card-body">
                  <div className="settings-update-about-grid">
                    {aboutItems.map(([key, value]) => (
                      <div key={key} className="settings-update-about-item">
                        <span className="settings-update-about-key">{key}</span>
                        <span className="settings-update-about-value">{value}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </section>
            </div>
          </details>

        </div>
      </div>

      {/* 重启遮罩：点击「重启并安装」后先展示，稍候触发 install()。
          2026-10-05 重设计（原型 restart-preview.html 方案 A）：品牌实底，
          不再透出背后内容，与启动页（index.html #app-loading）同一套品牌语言。 */}
      {restartPending ? (
        <div className="settings-update-restart-overlay" role="alertdialog" aria-label="正在应用更新">
          <div className="restart-splash">
            <div className="restart-splash-logo"><img src="/icon.svg" alt="" /></div>
            <div className="restart-splash-word">日志控制台</div>
            <div className="restart-splash-ver">正在应用更新 {nextVersion || ""}</div>
            <div className="restart-splash-row">
              <span className="restart-splash-spin" aria-hidden="true" />
              <span className="restart-splash-status">{restartStalled ? "重启被阻塞，可手动完成" : "即将自动重启"}</span>
            </div>
            <div className="restart-splash-flowbar" aria-hidden="true" />
            <div className="restart-splash-restore">
              {restartStalled
                ? "请从托盘菜单退出客户端，重新打开即可完成安装"
                : "未保存的搜索条件与布局会自动恢复"}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
