import { useRef, useState, type CSSProperties } from "react";
import type { JumpServerAssetOption, LogProfile, ServerConnectionKind, ServerCredentialStatus, ServerSummary } from "@server-log-console/shared";
import { looksLikeJumpServer } from "./terminal-utils.js";
import type { UiBackgroundMode, UiDensity, UiFontFamily, UiMotionMode, UiSurface } from "./useUiTheme.js";

export type SettingsWorkspaceView = "connections" | "preferences";
export type SettingsConnectionPane = "detail" | "form";

export interface ManualServerDraft {
  id: string;
  name: string;
  host: string;
  port: string;
  username: string;
  basePath: string;
  profile: LogProfile;
  tagsText: string;
  connectionKind: ServerConnectionKind;
  password: string;
  privateKey: string;
}

interface Props {
  activeView: SettingsWorkspaceView;
  onViewChange: (view: SettingsWorkspaceView) => void;
  isBusy: boolean;
  localServiceState: "checking" | "online" | "offline";
  localServiceStatusText: string;
  preferenceSection: {
    uiTheme: "classic" | "modern";
    uiDensity: UiDensity;
    uiSurface: UiSurface;
    uiBackgroundMode: UiBackgroundMode;
    customBackgroundColor: string;
    customGradientStart: string;
    customGradientEnd: string;
    customBackgroundImage: string;
    customTextColor: string;
    customLogBackgroundColor: string;
    customTerminalBackgroundColor: string;
    uiFontFamily: UiFontFamily;
    logFontSize: number;
    terminalFontSize: number;
    motionMode: UiMotionMode;
    errorHighlightEnabled: boolean;
    showPathHistory: boolean;
    showTransferHistory: boolean;
    sliceLengthMode: "auto" | "manual";
    sliceLength: number;
    serverStatusAutoRefresh: boolean;
    serverStatusRefreshIntervalMs: number;
    activityPanelHeight: number;
    activityPanelVisible: boolean;
    onToggleActivityPanelVisible: () => void;
    onUiThemeChange: (theme: "classic" | "modern") => void;
    onUiDensityChange: (density: UiDensity) => void;
    onUiSurfaceChange: (surface: UiSurface) => void;
    onUiBackgroundModeChange: (mode: UiBackgroundMode) => void;
    onCustomBackgroundColorChange: (value: string) => void;
    onCustomGradientStartChange: (value: string) => void;
    onCustomGradientEndChange: (value: string) => void;
    onCustomBackgroundImageChange: (value: string) => void;
    onCustomTextColorChange: (value: string) => void;
    onCustomLogBackgroundColorChange: (value: string) => void;
    onCustomTerminalBackgroundColorChange: (value: string) => void;
    onUiFontFamilyChange: (fontFamily: UiFontFamily) => void;
    onLogFontSizeChange: (size: number) => void;
    onTerminalFontSizeChange: (size: number) => void;
    onMotionModeChange: (mode: UiMotionMode) => void;
    onResetUiPreferences: () => void;
    onToggleErrorHighlight: () => void;
    onTogglePathHistory: () => void;
    onToggleTransferHistory: () => void;
    onSliceLengthModeChange: (mode: "auto" | "manual") => void;
    onSliceLengthChange: (bytes: number) => void;
    onToggleServerStatusAutoRefresh: () => void;
  };
  importSection: {
    selectedTool: "finalshell" | "xshell";
    importStatus: string;
    importPath: string;
    finalShellPath: string;
    finalShellDetectedPaths: string[];
    finalShellLastImportedAt: string;
    xshellDetectedPaths: string[];
    xshellLastImportedAt: string;
    onSelectTool: (tool: "finalshell" | "xshell") => void;
    onChangeFinalShellPath: (value: string) => void;
    onCheckService: () => void;
    onSaveFinalShellPath: () => void;
    onImport: (tool?: "finalshell" | "xshell") => void;
  };
  connectionSection: {
    managedServers: ServerSummary[];
    manualServers: ServerSummary[];
    importedServers: ServerSummary[];
    draft: ManualServerDraft;
    canSaveDraft: boolean;
    onStartCreate: () => void;
    onChangeDraft: (patch: Partial<ManualServerDraft>) => void;
    onResetDraft: () => void;
    onSaveDraft: () => void;
    onSelectServer: (serverId: string) => void;
    onEditManualServer: (server: ServerSummary) => void;
  };
  currentServerSection: {
    selectedServer: ServerSummary | null;
    connectionDirectory: string;
    credentialStatus: ServerCredentialStatus | null;
    credentialUsername: string;
    credentialPassword: string;
    credentialPrivateKey: string;
    onCredentialUsernameChange: (value: string) => void;
    onCredentialPasswordChange: (value: string) => void;
    onCredentialPrivateKeyChange: (value: string) => void;
    onSaveCredential: () => void;
    onLoadCredentialSecret: () => void;
    onClearCredential: () => void;
    onTestConnection: () => void;
    onOpenTerminal: () => void;
    availableBastions: ServerSummary[];
    preferredBastionId: string;
    jumpMode: "auto" | "jumpserver-search";
    jumpSearchKeyword: string;
    jumpAssetId: string;
    jumpAssetOptions: JumpServerAssetOption[];
    onPreferredBastionChange: (value: string) => void;
    onJumpModeChange: (value: "auto" | "jumpserver-search") => void;
    onJumpSearchKeywordChange: (value: string) => void;
    onJumpAssetIdChange: (value: string) => void;
    onSearchJumpAssets: () => void;
    onSaveRoute: () => void;
  };
}

function sourceLabel(source?: ServerSummary["source"]) {
  if (source === "manual") return "手动连接";
  if (source === "finalshell") return "FinalShell";
  if (source === "xshell") return "Xshell";
  return "内置";
}

function connectionKindLabel(kind?: ServerConnectionKind) {
  if (kind === "bastion") return "堡垒机入口";
  if (kind === "bastion-target") return "经堡垒机目标机";
  return "普通直连";
}

function connectionKindHint(kind: ServerConnectionKind) {
  if (kind === "bastion") return "作为堡垒机入口账号使用。";
  if (kind === "bastion-target") return "保存后还需要在当前连接里指定入口账号。";
  return "普通 SSH 直连服务器。";
}

function serviceTone(state: Props["localServiceState"]) {
  if (state === "online") return "success";
  if (state === "offline") return "danger";
  return "neutral";
}

function surfaceLabel(value: UiSurface): string {
  if (value === "custom") return "自定义";
  if (value === "mist") return "雾面";
  if (value === "paper") return "纸感";
  return "默认";
}

function backgroundModeLabel(value: UiBackgroundMode): string {
  if (value === "solid") return "纯色";
  if (value === "image") return "图片";
  return "渐变";
}

function fontFamilyLabel(value: UiFontFamily): string {
  if (value === "pingfang") return "苹方";
  if (value === "microsoft-yahei") return "微软雅黑";
  if (value === "simsun") return "宋体";
  if (value === "system") return "系统字体";
  return "Geist";
}

function motionModeLabel(value: UiMotionMode): string {
  return value === "reduced" ? "减少动效" : "标准";
}

const PREF_ANCHORS = [
  { id: "pref-appearance", label: "外观" },
  { id: "pref-log", label: "日志预览" },
  { id: "pref-terminal", label: "终端" },
  { id: "pref-layout", label: "布局" },
  { id: "pref-overlay", label: "浮层" },
  { id: "pref-advanced", label: "高级" },
];

export function ConnectionSettingsWorkspace(props: Props) {
  const [showCredentialPassword, setShowCredentialPassword] = useState(false);
  const [showCredentialPrivateKey, setShowCredentialPrivateKey] = useState(false);
  const [listFilter, setListFilter] = useState("");
  const [pickedListId, setPickedListId] = useState("");
  const [detailPane, setDetailPane] = useState<SettingsConnectionPane | "import">("detail");
  const [currentAnchor, setCurrentAnchor] = useState(PREF_ANCHORS[0].id);
  const backgroundImageInputRef = useRef<HTMLInputElement | null>(null);
  const prefScrollRef = useRef<HTMLDivElement | null>(null);

  const selectedServer = props.currentServerSection.selectedServer;
  const credentialStatus = props.currentServerSection.credentialStatus;
  const hasCredentialDraft = Boolean(
    props.currentServerSection.credentialPassword
    || props.currentServerSection.credentialPrivateKey
    || props.currentServerSection.credentialUsername !== (credentialStatus?.username || selectedServer?.username || "")
  );
  const selectedBastion = props.currentServerSection.availableBastions.find(
    (server) => server.id === props.currentServerSection.preferredBastionId
  ) ?? null;
  const showJumpFields = Boolean(
    (selectedServer && looksLikeJumpServer(selectedServer))
    || (selectedBastion && looksLikeJumpServer(selectedBastion))
  );
  const canConfigureRoute = Boolean(
    selectedServer
    && (
      selectedServer.connectionKind === "bastion-target"
      || !selectedServer.connectionKind
      || looksLikeJumpServer(selectedServer)
    )
  );
  const canPickEntry = Boolean(
    selectedServer
    && selectedServer.connectionKind !== "bastion"
    && !looksLikeJumpServer(selectedServer)
    && (selectedServer.connectionKind === "bastion-target" || !selectedServer.connectionKind)
  );
  const selectedCredentialLabel = credentialStatus?.hasUsableCredential
    ? `${credentialStatus.source} · ${credentialStatus.hasPassword ? "密码" : ""}${credentialStatus.hasPassword && credentialStatus.hasPrivateKey ? " + " : ""}${credentialStatus.hasPrivateKey ? "私钥" : ""}`
    : "未配置";

  const handlePickBackgroundImage = async (file: File | null) => {
    if (!file) return;
    const electronPath = (window as any).electronAPI?.getPathForFile?.(file);
    if (electronPath) {
      props.preferenceSection.onCustomBackgroundImageChange(`file://${electronPath}`);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      props.preferenceSection.onCustomBackgroundImageChange(String(reader.result || ""));
    };
    reader.readAsDataURL(file);
  };

  const normalizedFilter = listFilter.trim().toLowerCase();
  const listServers = props.connectionSection.managedServers.filter((server) => {
    if (!normalizedFilter) return true;
    return server.name.toLowerCase().includes(normalizedFilter)
      || `${server.username}@${server.host}`.toLowerCase().includes(normalizedFilter)
      || server.tags.some((tag) => tag.toLowerCase().includes(normalizedFilter));
  });
  const listGroups: Array<[string, ServerSummary[]]> = (() => {
    const groups = new Map<string, ServerSummary[]>();
    for (const server of listServers) {
      const key = server.groupPath?.join(" / ") || "未分组";
      const groupList = groups.get(key) ?? [];
      groupList.push(server);
      groups.set(key, groupList);
    }
    return [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0], "zh-CN"));
  })();
  const activeListServer = props.connectionSection.managedServers.find(
    (server) => server.id === (pickedListId || selectedServer?.id || "")
  ) ?? null;
  const viewingCurrentServer = Boolean(activeListServer && selectedServer && activeListServer.id === selectedServer.id);

  const handlePrefScroll = () => {
    const container = prefScrollRef.current;
    if (!container) return;
    let current = PREF_ANCHORS[0].id;
    container.querySelectorAll<HTMLElement>("[data-anchor]").forEach((section) => {
      if (section.offsetTop - container.scrollTop <= 64) {
        current = section.id;
      }
    });
    setCurrentAnchor(current);
  };

  const scrollToAnchor = (anchorId: string) => {
    const container = prefScrollRef.current;
    const target = container?.querySelector<HTMLElement>(`#${anchorId}`);
    if (container && target) {
      container.scrollTo({ top: target.offsetTop - 20, behavior: "smooth" });
    }
  };

  return (
    <section className="settings-workspace settings-workspace-v2">
      <nav className="settings-rail">
        <button
          type="button"
          className={props.activeView === "connections" ? "settings-rail-item settings-rail-item-active" : "settings-rail-item"}
          onClick={() => props.onViewChange("connections")}
        >
          <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" aria-hidden="true"><rect x="2.2" y="2.2" width="11.6" height="11.6" rx="2.4" /><path d="M5.4 6.2L7.2 8L5.4 9.8M8.6 10.2h2.2" /></svg>
          连接管理
        </button>
        <button
          type="button"
          className={props.activeView === "preferences" ? "settings-rail-item settings-rail-item-active" : "settings-rail-item"}
          onClick={() => props.onViewChange("preferences")}
        >
          <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" aria-hidden="true"><circle cx="8" cy="8" r="2" /><path d="M8 2.3v1.4M8 12.3v1.4M13.7 8h-1.4M3.7 8H2.3M11.9 4.1l-1 1M5.1 10.9l-1 1M11.9 11.9l-1-1M5.1 5.1l-1-1" /></svg>
          偏好设置
        </button>
        <div className="settings-rail-note">
          连接管理负责服务器清单、凭证与堡垒机路由；偏好设置只影响本机软件体验。
        </div>
        <div className="settings-rail-foot">
          <span className={`settings-pill settings-pill-${serviceTone(props.localServiceState)}`}>{props.localServiceStatusText}</span>
        </div>
      </nav>

      {props.activeView === "connections" ? (
        <div className="conn-layout">
          <aside className="conn-list-pane">
            <div className="conn-list-search">
              <input
                value={listFilter}
                onChange={(event) => setListFilter(event.target.value)}
                placeholder="搜索名称、主机或标签…"
              />
            </div>
            <div className="conn-server-list">
              {listGroups.map(([groupName, groupServers]) => (
                <div key={groupName}>
                  <div className="conn-server-group-label">{groupName}<span className="conn-server-group-count">{groupServers.length}</span></div>
                  {groupServers.map((server) => {
                    const isActive = server.id === activeListServer?.id;
                    const isCurrent = server.id === selectedServer?.id;
                    return (
                      <div
                        key={server.id}
                        className={isActive ? "conn-server-item conn-server-item-active" : "conn-server-item"}
                        onClick={() => {
                          setPickedListId(server.id);
                          setDetailPane("detail");
                        }}
                      >
                        <span className="conn-server-meta">
                          <span className="conn-server-name">
                            {server.name}
                            {isCurrent ? <span className="conn-server-current-tag">当前连接</span> : null}
                          </span>
                          <span className="conn-server-host">{server.username}@{server.host}</span>
                        </span>
                        <span className="conn-server-port">{server.port}</span>
                      </div>
                    );
                  })}
                </div>
              ))}
              {listServers.length === 0 ? (
                <div className="conn-list-empty">没有匹配的服务器</div>
              ) : null}
            </div>
            <div className="conn-list-foot">
              <span>{props.connectionSection.managedServers.length} 台连接 · 手动 {props.connectionSection.manualServers.length} · 导入 {props.connectionSection.importedServers.length}</span>
            </div>
          </aside>

          <div className="conn-detail-pane">
            <div className="conn-detail-head">
              <div>
                <h2>{detailPane === "form" ? (props.connectionSection.draft.id ? "编辑连接" : "新增手动连接") : detailPane === "import" ? "导入来源" : activeListServer?.name || "连接管理"}</h2>
                <p>
                  {detailPane === "form"
                    ? "保存后出现在左侧清单；凭证也可以稍后在详情里维护。"
                    : detailPane === "import"
                      ? "从 FinalShell / Xshell 自动读取本机连接配置并解密导入。"
                      : "查看连接信息；当前连接的服务器可在此编辑凭证与堡垒机路由。"}
                </p>
              </div>
              <div className="conn-head-actions">
                <button
                  type="button"
                  className={detailPane === "import" ? "ghost-button tab-active" : "ghost-button"}
                  onClick={() => setDetailPane((current) => current === "import" ? "detail" : "import")}
                >
                  导入来源
                </button>
                <button
                  type="button"
                  className="ghost-button settings-primary-action"
                  onClick={() => {
                    props.connectionSection.onStartCreate();
                    setDetailPane("form");
                  }}
                >
                  新增连接
                </button>
              </div>
            </div>

            <div className="conn-detail-body">
              {detailPane === "import" ? (
                <div className="conn-detail-stack">
                  <section className="settings-card">
                    <div className="settings-card-head">
                      <div>
                        <span className="settings-card-kicker">自动导入</span>
                        <strong>FinalShell</strong>
                      </div>
                      <div className="settings-inline-actions">
                        <button className="ghost-button" type="button" onClick={props.importSection.onCheckService} disabled={props.isBusy}>检查服务</button>
                        <button className="ghost-button" type="button" onClick={props.importSection.onSaveFinalShellPath} disabled={props.isBusy}>保存目录</button>
                        <button className="ghost-button" type="button" onClick={() => props.importSection.onImport("finalshell")} disabled={props.isBusy || props.localServiceState !== "online"}>立即导入</button>
                      </div>
                    </div>
                    <label className="settings-field">
                      <span>配置目录</span>
                      <input value={props.importSection.finalShellPath} onChange={(event) => props.importSection.onChangeFinalShellPath(event.target.value)} placeholder="~/Library/FinalShell/conn" />
                    </label>
                    <div className="settings-meta-grid">
                      <span>导入状态：{props.importSection.importStatus}</span>
                      <span>识别结果：{props.importSection.importPath}</span>
                      <span>上次导入：{props.importSection.finalShellLastImportedAt || "--"}</span>
                      <span>检测路径：{props.importSection.finalShellDetectedPaths.length}</span>
                    </div>
                  </section>

                  <section className="settings-card">
                    <div className="settings-card-head">
                      <div>
                        <span className="settings-card-kicker">兼容导入</span>
                        <strong>Xshell</strong>
                      </div>
                      <button className="ghost-button" type="button" onClick={() => props.importSection.onImport("xshell")} disabled={props.isBusy || props.localServiceState !== "online"}>导入 Xshell</button>
                    </div>
                    <div className="settings-meta-grid">
                      <span>导入状态：{props.importSection.importStatus}</span>
                      <span>上次导入：{props.importSection.xshellLastImportedAt || "--"}</span>
                      <span>检测路径：{props.importSection.xshellDetectedPaths.length}</span>
                    </div>
                  </section>
                </div>
              ) : null}

              {detailPane === "form" ? (
                <section className="settings-card">
                  <div className="settings-card-head">
                    <span className="settings-card-kicker">手动连接 · {props.connectionSection.draft.id ? "编辑现有服务器" : "新增服务器"}</span>
                    <div className="settings-inline-actions">
                      <button className="ghost-button" type="button" onClick={() => {
                        props.connectionSection.onResetDraft();
                        setDetailPane("detail");
                      }}>取消</button>
                      <button className="ghost-button settings-primary-action" type="button" onClick={() => {
                        props.connectionSection.onSaveDraft();
                        setDetailPane("detail");
                      }} disabled={!props.connectionSection.canSaveDraft || props.isBusy}>保存连接</button>
                    </div>
                  </div>
                  <div className="settings-form-grid settings-form-grid-two">
                    <label className="settings-field">
                      <span>名称</span>
                      <input value={props.connectionSection.draft.name} onChange={(event) => props.connectionSection.onChangeDraft({ name: event.target.value })} />
                    </label>
                    <label className="settings-field">
                      <span>主机</span>
                      <input value={props.connectionSection.draft.host} onChange={(event) => props.connectionSection.onChangeDraft({ host: event.target.value })} />
                    </label>
                    <label className="settings-field">
                      <span>端口</span>
                      <input value={props.connectionSection.draft.port} onChange={(event) => props.connectionSection.onChangeDraft({ port: event.target.value })} placeholder="22" />
                    </label>
                    <label className="settings-field">
                      <span>用户名</span>
                      <input value={props.connectionSection.draft.username} onChange={(event) => props.connectionSection.onChangeDraft({ username: event.target.value })} />
                    </label>
                    <label className="settings-field">
                      <span>日志目录</span>
                      <input value={props.connectionSection.draft.basePath} onChange={(event) => props.connectionSection.onChangeDraft({ basePath: event.target.value })} placeholder="/var/log" />
                    </label>
                    <label className="settings-field">
                      <span>日志模式</span>
                      <select value={props.connectionSection.draft.profile} onChange={(event) => props.connectionSection.onChangeDraft({ profile: event.target.value as LogProfile })}>
                        <option value="custom">自定义</option>
                        <option value="nginx">Nginx</option>
                        <option value="system">系统日志</option>
                      </select>
                    </label>
                    <label className="settings-field">
                      <span>连接方式</span>
                      <select value={props.connectionSection.draft.connectionKind} onChange={(event) => props.connectionSection.onChangeDraft({ connectionKind: event.target.value as ServerConnectionKind })}>
                        <option value="direct">普通直连</option>
                        <option value="bastion">堡垒机入口</option>
                        <option value="bastion-target">经堡垒机目标机</option>
                      </select>
                    </label>
                    <label className="settings-field">
                      <span>标签</span>
                      <input value={props.connectionSection.draft.tagsText} onChange={(event) => props.connectionSection.onChangeDraft({ tagsText: event.target.value })} placeholder="prod, web, jump" />
                    </label>
                    <label className="settings-field settings-field-span-2">
                      <span>密码</span>
                      <input type="password" value={props.connectionSection.draft.password} onChange={(event) => props.connectionSection.onChangeDraft({ password: event.target.value })} placeholder="留空则不更新密码" />
                    </label>
                    <label className="settings-field settings-field-span-2">
                      <span>私钥</span>
                      <textarea value={props.connectionSection.draft.privateKey} onChange={(event) => props.connectionSection.onChangeDraft({ privateKey: event.target.value })} placeholder="可直接粘贴私钥内容" />
                    </label>
                  </div>
                  <div className="settings-note-box">
                    <strong>{connectionKindLabel(props.connectionSection.draft.connectionKind)}</strong>
                    <span>{connectionKindHint(props.connectionSection.draft.connectionKind)}</span>
                  </div>
                </section>
              ) : null}

              {detailPane === "detail" ? (
                activeListServer ? (
                  viewingCurrentServer ? (
                    <div className="conn-detail-stack">
                      <section className="settings-card settings-card-banner">
                        <div className="settings-card-head">
                          <div>
                            <span className="settings-card-kicker">当前连接</span>
                            <strong>{activeListServer.name}</strong>
                          </div>
                          <div className="settings-inline-actions">
                            <button className="ghost-button" type="button" onClick={props.currentServerSection.onTestConnection} disabled={props.isBusy}>重连测试</button>
                            <button className="ghost-button" type="button" onClick={props.currentServerSection.onOpenTerminal} disabled={props.isBusy}>打开终端</button>
                          </div>
                        </div>
                        <div className="settings-meta-grid">
                          <span>来源：{sourceLabel(activeListServer.source)}</span>
                          <span>类型：{connectionKindLabel(activeListServer.connectionKind)}</span>
                          <span>目录：{props.currentServerSection.connectionDirectory || "/"}</span>
                          <span>说明：{activeListServer.connectionHint || "--"}</span>
                        </div>
                      </section>

                      <section className="settings-card">
                        <div className="settings-card-head">
                          <div>
                            <span className="settings-card-kicker">连接凭证</span>
                            <strong>按服务器维度保存</strong>
                            <p className="settings-card-note">
                              可读取已保存的本地/导入凭证，也可以清除该服务器保存的密码和私钥；填写后保存会覆盖。
                            </p>
                          </div>
                          <div className="settings-inline-actions">
                            <button className="ghost-button" type="button" onClick={props.currentServerSection.onLoadCredentialSecret} disabled={props.isBusy || !credentialStatus?.hasUsableCredential}>读取已保存</button>
                            <button className="ghost-button danger-button" type="button" onClick={props.currentServerSection.onClearCredential} disabled={props.isBusy || !credentialStatus?.hasUsableCredential}>清除凭证</button>
                            <button className="ghost-button" type="button" onClick={props.currentServerSection.onTestConnection} disabled={props.isBusy}>重连</button>
                            <button className="ghost-button settings-primary-action" type="button" onClick={props.currentServerSection.onSaveCredential} disabled={props.isBusy}>
                              {props.isBusy ? "保存中..." : hasCredentialDraft ? "保存并覆盖" : "保存凭证"}
                            </button>
                          </div>
                        </div>
                        <div className="credential-status-panel">
                          <div className="credential-status-main">
                            <span className={`credential-status-dot ${credentialStatus?.hasUsableCredential ? "credential-status-dot-ok" : "credential-status-dot-warn"}`} />
                            <div>
                              <strong>{credentialStatus?.hasUsableCredential ? "已有可用凭证" : "尚未配置可用凭证"}</strong>
                              <span>{credentialStatus?.message || "读取凭证状态后会显示保存来源和可用性。"}</span>
                            </div>
                          </div>
                          <div className="credential-status-tags">
                            <span>来源：{credentialStatus?.source || "--"}</span>
                            <span>用户名：{credentialStatus?.username || activeListServer.username || "--"}</span>
                            <span>凭证：{selectedCredentialLabel}</span>
                            <span className={credentialStatus?.hasPassword ? "credential-tag-ok" : ""}>密码：{credentialStatus?.hasPassword ? "已保存" : "未配置"}</span>
                            <span className={credentialStatus?.hasPrivateKey ? "credential-tag-ok" : ""}>私钥：{credentialStatus?.hasPrivateKey ? "已保存" : "未配置"}</span>
                          </div>
                        </div>
                        <div className="settings-form-grid settings-form-grid-single">
                          <label className="settings-field">
                            <span>用户名</span>
                            <input value={props.currentServerSection.credentialUsername} onChange={(event) => props.currentServerSection.onCredentialUsernameChange(event.target.value)} />
                          </label>
                          <label className="settings-field">
                            <span>密码</span>
                            <div className="settings-secret-field">
                              <input
                                type={showCredentialPassword ? "text" : "password"}
                                value={props.currentServerSection.credentialPassword}
                                onChange={(event) => props.currentServerSection.onCredentialPasswordChange(event.target.value)}
                                placeholder={credentialStatus?.hasPassword ? "已保存，留空不覆盖" : "输入密码后保存"}
                              />
                              <button
                                type="button"
                                className="ghost-button slim-button"
                                onClick={() => {
                                  if (!props.currentServerSection.credentialPassword && credentialStatus?.hasPassword) {
                                    props.currentServerSection.onLoadCredentialSecret();
                                    setShowCredentialPassword(true);
                                    return;
                                  }
                                  setShowCredentialPassword((current) => !current);
                                }}
                              >
                                {showCredentialPassword ? "隐藏" : credentialStatus?.hasPassword && !props.currentServerSection.credentialPassword ? "查看" : "显示"}
                              </button>
                            </div>
                          </label>
                          <label className="settings-field">
                            <span>私钥</span>
                            <div className="settings-secret-field settings-secret-field-textarea">
                              <textarea
                                value={props.currentServerSection.credentialPrivateKey}
                                onChange={(event) => props.currentServerSection.onCredentialPrivateKeyChange(event.target.value)}
                                placeholder={credentialStatus?.hasPrivateKey ? "已保存，留空不覆盖；需要替换时粘贴新私钥" : "可直接粘贴私钥内容"}
                                spellCheck={false}
                                style={showCredentialPrivateKey ? undefined : { WebkitTextSecurity: "disc" } as CSSProperties}
                              />
                              <button
                                type="button"
                                className="ghost-button slim-button"
                                onClick={() => {
                                  if (!props.currentServerSection.credentialPrivateKey && credentialStatus?.hasPrivateKey) {
                                    props.currentServerSection.onLoadCredentialSecret();
                                    setShowCredentialPrivateKey(true);
                                    return;
                                  }
                                  setShowCredentialPrivateKey((current) => !current);
                                }}
                              >
                                {showCredentialPrivateKey ? "隐藏" : credentialStatus?.hasPrivateKey && !props.currentServerSection.credentialPrivateKey ? "查看" : "显示"}
                              </button>
                            </div>
                          </label>
                        </div>
                      </section>

                      <section className="settings-card">
                        <div className="settings-card-head">
                          <div>
                            <span className="settings-card-kicker">连接入口</span>
                            <strong>{canConfigureRoute ? "入口账号与 JumpServer 规则" : "当前无需额外入口设置"}</strong>
                          </div>
                          {canConfigureRoute ? <button className="ghost-button" type="button" onClick={props.currentServerSection.onSaveRoute} disabled={props.isBusy}>保存入口设置</button> : null}
                        </div>
                        {canConfigureRoute ? (
                          <>
                            {canPickEntry ? (
                              <label className="settings-field">
                                <span>入口账号</span>
                                <select value={props.currentServerSection.preferredBastionId} onChange={(event) => props.currentServerSection.onPreferredBastionChange(event.target.value)}>
                                  <option value="">自动尝试</option>
                                  {props.currentServerSection.availableBastions.map((server) => (
                                    <option key={server.id} value={server.id}>{server.name} · {server.username}@{server.host}:{server.port}</option>
                                  ))}
                                </select>
                              </label>
                            ) : null}

                            {showJumpFields ? (
                              <div className="settings-form-grid settings-form-grid-single">
                                <label className="settings-field">
                                  <span>JumpServer 模式</span>
                                  <select value={props.currentServerSection.jumpMode} onChange={(event) => props.currentServerSection.onJumpModeChange(event.target.value as "auto" | "jumpserver-search")}>
                                    <option value="auto">自动推断</option>
                                    <option value="jumpserver-search">按关键字搜索资产</option>
                                  </select>
                                </label>
                                <label className="settings-field">
                                  <span>搜索关键字</span>
                                  <div className="settings-inline-actions settings-inline-actions-stretch">
                                    <input value={props.currentServerSection.jumpSearchKeyword} onChange={(event) => props.currentServerSection.onJumpSearchKeywordChange(event.target.value)} placeholder="默认可填主机名、业务名或资产别名" />
                                    <button className="ghost-button" type="button" onClick={props.currentServerSection.onSearchJumpAssets} disabled={props.isBusy}>搜索资产</button>
                                  </div>
                                </label>
                                <label className="settings-field">
                                  <span>资产 ID</span>
                                  <input value={props.currentServerSection.jumpAssetId} onChange={(event) => props.currentServerSection.onJumpAssetIdChange(event.target.value)} placeholder="也可直接粘贴已有资产 ID" />
                                </label>
                                {props.currentServerSection.jumpAssetOptions.length ? (
                                  <div className="settings-asset-list">
                                    {props.currentServerSection.jumpAssetOptions.map((asset) => (
                                      <button key={asset.id} type="button" className={props.currentServerSection.jumpAssetId === asset.id ? "settings-asset-row settings-asset-row-active" : "settings-asset-row"} onClick={() => props.currentServerSection.onJumpAssetIdChange(asset.id)}>
                                        <strong>{asset.name}</strong>
                                        <span>{asset.address || asset.id}</span>
                                      </button>
                                    ))}
                                  </div>
                                ) : null}
                              </div>
                            ) : (
                              <div className="settings-note-box">
                                <strong>这台服务器不需要 JumpServer 搜索规则</strong>
                                <span>如果它本身就是堡垒机入口，通常直接打开终端后再进入目标机即可。</span>
                              </div>
                            )}
                          </>
                        ) : (
                          <div className="settings-note-box">
                            <strong>当前服务器按直连处理</strong>
                            <span>如果你希望它走堡垒机，请点上方「新增连接/编辑连接」把连接方式改成「经堡垒机目标机」。</span>
                          </div>
                        )}
                      </section>
                    </div>
                  ) : (
                    <div className="conn-detail-stack">
                      <section className="settings-card">
                        <div className="settings-card-head">
                          <div>
                            <span className="settings-card-kicker">连接信息</span>
                            <strong>{activeListServer.name}</strong>
                          </div>
                          <div className="settings-inline-actions">
                            {activeListServer.source === "manual" ? (
                              <button className="ghost-button" type="button" onClick={() => {
                                props.connectionSection.onEditManualServer(activeListServer);
                                setDetailPane("form");
                              }}>编辑连接</button>
                            ) : null}
                            <button className="ghost-button settings-primary-action" type="button" onClick={() => props.connectionSection.onSelectServer(activeListServer.id)} disabled={props.isBusy}>
                              连接此服务器
                            </button>
                          </div>
                        </div>
                        <div className="settings-meta-grid">
                          <span>来源：{sourceLabel(activeListServer.source)}</span>
                          <span>类型：{connectionKindLabel(activeListServer.connectionKind)}</span>
                          <span>主机：{activeListServer.host}</span>
                          <span>端口：{activeListServer.port}</span>
                          <span>用户名：{activeListServer.username}</span>
                          <span>日志目录：{activeListServer.basePath || "/"}</span>
                          <span>认证：{activeListServer.authType === "privateKey" ? "私钥" : activeListServer.authType === "password" ? "密码" : "未配置"}</span>
                          <span>说明：{activeListServer.connectionHint || "--"}</span>
                        </div>
                        {activeListServer.tags.length ? (
                          <div className="settings-meta-grid">
                            <span>标签：{activeListServer.tags.join(" / ")}</span>
                          </div>
                        ) : null}
                      </section>
                      <div className="settings-note-box">
                        <strong>凭证编辑需要先连接这台服务器</strong>
                        <span>点击「连接此服务器」切换过去后，这里会展示凭证与堡垒机路由的完整编辑面板。</span>
                      </div>
                    </div>
                  )
                ) : (
                  <div className="settings-workspace-empty">
                    <strong>左侧还没有可选的服务器</strong>
                    <span>点击右上角「新增连接」手动添加，或打开「导入来源」从 FinalShell / Xshell 导入。</span>
                  </div>
                )
              ) : null}
            </div>
          </div>
        </div>
      ) : (
        <div className="settings-pref-view">
          <div className="conn-detail-head">
            <div>
              <h2>偏好设置</h2>
              <p>只影响本机软件体验；连接数据请在「连接管理」中维护。</p>
            </div>
          </div>
          <div className="settings-pref-layout">
            <aside className="settings-pref-anchor">
            {PREF_ANCHORS.map((anchor) => (
              <a
                key={anchor.id}
                href={`#${anchor.id}`}
                className={currentAnchor === anchor.id ? "current" : ""}
                onClick={(event) => {
                  event.preventDefault();
                  scrollToAnchor(anchor.id);
                }}
              >
                {anchor.label}
              </a>
            ))}
          </aside>
          <div className="settings-pref-scroll" ref={prefScrollRef} onScroll={handlePrefScroll}>
            <section id="pref-appearance" data-anchor className="settings-pref-section">
              <div className="settings-card-kicker">外观</div>
              <div className="settings-pref-card">
                <div className="settings-pref-row">
                  <span className="settings-pref-label"><strong>主题</strong><span>现代浅色 / 经典紧凑</span></span>
                  <span className="settings-pref-value">
                    <span className="settings-tool-switcher">
                      <button type="button" className={props.preferenceSection.uiTheme === "modern" ? "settings-tool-chip settings-tool-chip-active" : "settings-tool-chip"} onClick={() => props.preferenceSection.onUiThemeChange("modern")}>现代</button>
                      <button type="button" className={props.preferenceSection.uiTheme === "classic" ? "settings-tool-chip settings-tool-chip-active" : "settings-tool-chip"} onClick={() => props.preferenceSection.onUiThemeChange("classic")}>经典</button>
                    </span>
                  </span>
                </div>
                <div className="settings-pref-row">
                  <span className="settings-pref-label"><strong>背景方案</strong><span>默认 / 雾面 / 纸感 / 自定义</span></span>
                  <span className="settings-pref-value">
                    <select
                      value={props.preferenceSection.uiSurface}
                      onChange={(event) => props.preferenceSection.onUiSurfaceChange(event.target.value as UiSurface)}
                    >
                      <option value="plain">默认</option>
                      <option value="mist">雾面</option>
                      <option value="paper">纸感</option>
                      <option value="custom">自定义</option>
                    </select>
                  </span>
                </div>
                {props.preferenceSection.uiSurface === "custom" ? (
                  <div className="settings-pref-row settings-pref-row-wide settings-theme-customizer">
                    <div className="settings-theme-customizer-head">
                      <div>
                        <span>自定义主题</span>
                        <strong>
                          {backgroundModeLabel(props.preferenceSection.uiBackgroundMode)}
                          {" · "}
                          {fontFamilyLabel(props.preferenceSection.uiFontFamily)}
                        </strong>
                      </div>
                      <select
                        value={props.preferenceSection.uiBackgroundMode}
                        onChange={(event) => props.preferenceSection.onUiBackgroundModeChange(event.target.value as UiBackgroundMode)}
                      >
                        <option value="solid">纯色背景</option>
                        <option value="gradient">渐变背景</option>
                        <option value="image">图片背景</option>
                      </select>
                    </div>
                    <div className="settings-custom-theme-grid">
                      {props.preferenceSection.uiBackgroundMode === "solid" ? (
                        <label className="settings-color-field">
                          <span>背景色</span>
                          <input
                            type="color"
                            value={props.preferenceSection.customBackgroundColor}
                            onChange={(event) => props.preferenceSection.onCustomBackgroundColorChange(event.target.value)}
                          />
                          <code>{props.preferenceSection.customBackgroundColor}</code>
                        </label>
                      ) : null}
                      {props.preferenceSection.uiBackgroundMode === "gradient" ? (
                        <>
                          <label className="settings-color-field">
                            <span>渐变起点</span>
                            <input
                              type="color"
                              value={props.preferenceSection.customGradientStart}
                              onChange={(event) => props.preferenceSection.onCustomGradientStartChange(event.target.value)}
                            />
                            <code>{props.preferenceSection.customGradientStart}</code>
                          </label>
                          <label className="settings-color-field">
                            <span>渐变终点</span>
                            <input
                              type="color"
                              value={props.preferenceSection.customGradientEnd}
                              onChange={(event) => props.preferenceSection.onCustomGradientEndChange(event.target.value)}
                            />
                            <code>{props.preferenceSection.customGradientEnd}</code>
                          </label>
                        </>
                      ) : null}
                      {props.preferenceSection.uiBackgroundMode === "image" ? (
                        <div className="settings-image-field settings-field-span-2">
                          <span>图片背景</span>
                          <div className="settings-image-picker-row">
                            <input
                              value={props.preferenceSection.customBackgroundImage}
                              onChange={(event) => props.preferenceSection.onCustomBackgroundImageChange(event.target.value)}
                              placeholder="可选择本地图片，也支持 file://、https://、data:image..."
                            />
                            <input
                              ref={backgroundImageInputRef}
                              className="settings-hidden-file-input"
                              type="file"
                              accept="image/*"
                              onChange={(event) => {
                                void handlePickBackgroundImage(event.target.files?.[0] ?? null);
                                event.target.value = "";
                              }}
                            />
                            <button
                              type="button"
                              className="settings-secondary-action"
                              onClick={() => backgroundImageInputRef.current?.click()}
                            >
                              选择图片
                            </button>
                            <button
                              type="button"
                              className="settings-secondary-action"
                              onClick={() => props.preferenceSection.onCustomBackgroundImageChange("")}
                              disabled={!props.preferenceSection.customBackgroundImage}
                            >
                              清除
                            </button>
                          </div>
                        </div>
                      ) : null}
                      <label className="settings-color-field">
                        <span>字体颜色</span>
                        <input
                          type="color"
                          value={props.preferenceSection.customTextColor}
                          onChange={(event) => props.preferenceSection.onCustomTextColorChange(event.target.value)}
                        />
                        <code>{props.preferenceSection.customTextColor}</code>
                      </label>
                      <label className="settings-color-field">
                        <span>日志/搜索背景</span>
                        <input
                          type="color"
                          value={props.preferenceSection.customLogBackgroundColor}
                          onChange={(event) => props.preferenceSection.onCustomLogBackgroundColorChange(event.target.value)}
                        />
                        <code>{props.preferenceSection.customLogBackgroundColor}</code>
                      </label>
                      <label className="settings-color-field">
                        <span>终端背景</span>
                        <input
                          type="color"
                          value={props.preferenceSection.customTerminalBackgroundColor}
                          onChange={(event) => props.preferenceSection.onCustomTerminalBackgroundColorChange(event.target.value)}
                        />
                        <code>{props.preferenceSection.customTerminalBackgroundColor}</code>
                      </label>
                      <label className="settings-image-field">
                        <span>字体类型</span>
                        <select
                          value={props.preferenceSection.uiFontFamily}
                          onChange={(event) => props.preferenceSection.onUiFontFamilyChange(event.target.value as UiFontFamily)}
                        >
                          <option value="geist">Geist</option>
                          <option value="pingfang">苹方</option>
                          <option value="microsoft-yahei">微软雅黑</option>
                          <option value="simsun">宋体</option>
                          <option value="system">系统字体</option>
                        </select>
                      </label>
                    </div>
                  </div>
                ) : null}
                <div className="settings-pref-row">
                  <span className="settings-pref-label"><strong>界面密度</strong><span>紧凑适合小屏</span></span>
                  <span className="settings-pref-value">
                    <span className="settings-tool-switcher">
                      <button type="button" className={props.preferenceSection.uiDensity === "compact" ? "settings-tool-chip settings-tool-chip-active" : "settings-tool-chip"} onClick={() => props.preferenceSection.onUiDensityChange("compact")}>紧凑</button>
                      <button type="button" className={props.preferenceSection.uiDensity === "comfortable" ? "settings-tool-chip settings-tool-chip-active" : "settings-tool-chip"} onClick={() => props.preferenceSection.onUiDensityChange("comfortable")}>舒展</button>
                    </span>
                  </span>
                </div>
                <div className="settings-pref-row">
                  <span className="settings-pref-label"><strong>动效策略</strong><span>低性能机器可选减少动效</span></span>
                  <span className="settings-pref-value">
                    <span className="settings-tool-switcher">
                      <button type="button" className={props.preferenceSection.motionMode === "normal" ? "settings-tool-chip settings-tool-chip-active" : "settings-tool-chip"} onClick={() => props.preferenceSection.onMotionModeChange("normal")}>标准</button>
                      <button type="button" className={props.preferenceSection.motionMode === "reduced" ? "settings-tool-chip settings-tool-chip-active" : "settings-tool-chip"} onClick={() => props.preferenceSection.onMotionModeChange("reduced")}>减少</button>
                    </span>
                  </span>
                </div>
              </div>
            </section>

            <section id="pref-log" data-anchor className="settings-pref-section">
              <div className="settings-card-kicker">日志预览</div>
              <div className="settings-pref-card">
                <button type="button" className="settings-pref-row settings-pref-row-click" onClick={props.preferenceSection.onToggleErrorHighlight}>
                  <span className="settings-pref-label"><strong>异常 / 告警高亮</strong><span>自动标记 ERROR、WARN 行</span></span>
                  <span className="settings-pref-value">{props.preferenceSection.errorHighlightEnabled ? "开启" : "关闭"}</span>
                </button>
                <div className="settings-pref-row">
                  <span className="settings-pref-label"><strong>日志切片</strong><span>单次加载的日志字节数</span></span>
                  <span className="settings-pref-value">
                    <select
                      value={props.preferenceSection.sliceLengthMode === "auto" ? "auto" : String(props.preferenceSection.sliceLength)}
                      onChange={(event) => {
                        if (event.target.value === "auto") {
                          props.preferenceSection.onSliceLengthModeChange("auto");
                          return;
                        }
                        props.preferenceSection.onSliceLengthModeChange("manual");
                        props.preferenceSection.onSliceLengthChange(Number(event.target.value));
                      }}
                    >
                      <option value="auto">自动</option>
                      <option value={32768}>32 KB</option>
                      <option value={65536}>64 KB</option>
                      <option value={131072}>128 KB</option>
                      <option value={262144}>256 KB</option>
                    </select>
                  </span>
                </div>
                <div className="settings-pref-row">
                  <span className="settings-pref-label"><strong>日志字号</strong><span>立即生效</span></span>
                  <span className="settings-pref-value">
                    <select
                      value={String(props.preferenceSection.logFontSize)}
                      onChange={(event) => props.preferenceSection.onLogFontSizeChange(Number(event.target.value))}
                    >
                      <option value="11">11px</option>
                      <option value="12">12px</option>
                      <option value="13">13px</option>
                      <option value="14">14px</option>
                      <option value="16">16px</option>
                    </select>
                  </span>
                </div>
              </div>
            </section>

            <section id="pref-terminal" data-anchor className="settings-pref-section">
              <div className="settings-card-kicker">终端</div>
              <div className="settings-pref-card">
                <div className="settings-pref-row">
                  <span className="settings-pref-label"><strong>终端字号</strong><span>更新后自动重新适配</span></span>
                  <span className="settings-pref-value">
                    <select
                      value={String(props.preferenceSection.terminalFontSize)}
                      onChange={(event) => props.preferenceSection.onTerminalFontSizeChange(Number(event.target.value))}
                    >
                      <option value="11">11px</option>
                      <option value="12">12px</option>
                      <option value="13">13px</option>
                      <option value="14">14px</option>
                      <option value="16">16px</option>
                      <option value="18">18px</option>
                    </select>
                  </span>
                </div>
              </div>
            </section>

            <section id="pref-layout" data-anchor className="settings-pref-section">
              <div className="settings-card-kicker">布局</div>
              <div className="settings-pref-card">
                <button type="button" className="settings-pref-row settings-pref-row-click" onClick={props.preferenceSection.onToggleServerStatusAutoRefresh}>
                  <span className="settings-pref-label"><strong>服务器状态自动刷新</strong><span>状态面板定时采集</span></span>
                  <span className="settings-pref-value">{props.preferenceSection.serverStatusAutoRefresh ? `${Math.round(props.preferenceSection.serverStatusRefreshIntervalMs / 1000)}s` : "关闭"}</span>
                </button>
                <button type="button" className="settings-pref-row settings-pref-row-click" onClick={props.preferenceSection.onToggleActivityPanelVisible}>
                  <span className="settings-pref-label"><strong>操作记录面板</strong><span>主界面底部的活动日志</span></span>
                  <span className="settings-pref-value">{props.preferenceSection.activityPanelVisible ? "显示中" : "隐藏"}</span>
                </button>
                <div className="settings-pref-row">
                  <span className="settings-pref-label"><strong>操作记录高度</strong><span>显示时可拖拽调整</span></span>
                  <span className="settings-pref-value">{props.preferenceSection.activityPanelHeight}px</span>
                </div>
              </div>
            </section>

            <section id="pref-overlay" data-anchor className="settings-pref-section">
              <div className="settings-card-kicker">浮层</div>
              <div className="settings-pref-card">
                <button type="button" className="settings-pref-row settings-pref-row-click" onClick={props.preferenceSection.onTogglePathHistory}>
                  <span className="settings-pref-label"><strong>路径历史浮层</strong><span>文件浏览地址栏下拉</span></span>
                  <span className="settings-pref-value">{props.preferenceSection.showPathHistory ? "显示中" : "关闭"}</span>
                </button>
                <button type="button" className="settings-pref-row settings-pref-row-click" onClick={props.preferenceSection.onToggleTransferHistory}>
                  <span className="settings-pref-label"><strong>传输记录浮层</strong><span>上传下载历史入口</span></span>
                  <span className="settings-pref-value">{props.preferenceSection.showTransferHistory ? "显示中" : "关闭"}</span>
                </button>
              </div>
            </section>

            <section id="pref-advanced" data-anchor className="settings-pref-section">
              <div className="settings-card-kicker">高级</div>
              <div className="settings-pref-card">
                <button type="button" className="settings-pref-row settings-pref-row-click settings-pref-reset" onClick={props.preferenceSection.onResetUiPreferences}>
                  <span className="settings-pref-label"><strong>恢复默认显示</strong><span>重置主题、背景、字号等显示偏好</span></span>
                  <span className="settings-pref-value">重置</span>
                </button>
              </div>
            </section>
          </div>
          </div>
        </div>
      )}
    </section>
  );
}
