import { useEffect, useRef, useState, type CSSProperties } from "react";
import { MoreHorizontal, Terminal, Trash2 } from "lucide-react";
import type { JumpServerAssetOption, LogProfile, ServerConnectionKind, ServerCredentialStatus, ServerSummary } from "@server-log-console/shared";
import { looksLikeJumpServer } from "./terminal-utils.js";
import { readDirectoryHistory } from "./storage.js";
import { ThemedSelect } from "./ThemedSelect.js";
import type { MonoFontFamily, UiBackgroundMode, UiDensity, UiFontFamily, UiMotionMode, UiSurface } from "./useUiTheme.js";

export type SettingsWorkspaceView = "connections" | "preferences";
export type SettingsConnectionPane = "detail" | "form";
/** S14：水印作用范围（原型 1143-1168「日志/预览区 / 全局」） */
export type WatermarkScope = "content" | "global";

/** S14：水印默认内容模板（原型 1150 行） */
export const DEFAULT_WATERMARK_TEMPLATE = "{用户} · {主机} · {时间} 内部资料";

/** S14：背景方案 4 张缩略卡（原型 1109-1117：默认/雾面/纸感/自定义） */
const SURFACE_OPTIONS: Array<{ value: UiSurface; label: string; background: string }> = [
  { value: "plain", label: "默认", background: "linear-gradient(180deg,#ffffff,#fafafa)" },
  { value: "mist", label: "雾面", background: "linear-gradient(180deg,#f4f6f8,#eceff3)" },
  { value: "paper", label: "纸感", background: "linear-gradient(180deg,#faf7f0,#f3ede1)" },
  { value: "custom", label: "自定义", background: "linear-gradient(135deg,#eef5ff,#fff7ed)" }
];

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
    /* S14：日志 / 终端字体族独立配置 */
    logFontFamily: MonoFontFamily;
    onLogFontFamilyChange: (family: MonoFontFamily) => void;
    terminalFontFamily: MonoFontFamily;
    onTerminalFontFamilyChange: (family: MonoFontFamily) => void;
    motionMode: UiMotionMode;
    /* S14：图片背景遮罩亮度 / 模糊、水印、动态背景（最小补充字段） */
    customImageOverlay: number;
    customImageBlur: number;
    dynamicBackground: boolean;
    watermarkEnabled: boolean;
    watermarkTemplate: string;
    watermarkOpacity: number;
    watermarkScope: WatermarkScope;
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
    onCustomImageOverlayChange: (value: number) => void;
    onCustomImageBlurChange: (value: number) => void;
    onToggleDynamicBackground: () => void;
    onToggleWatermark: () => void;
    onWatermarkTemplateChange: (value: string) => void;
    onWatermarkOpacityChange: (value: number) => void;
    onWatermarkScopeChange: (scope: WatermarkScope) => void;
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
    /* S10：危险区「删除此服务器」降为页脚红字行（原型 978-984） */
    onDeleteServer: (server: ServerSummary) => void;
    /* S10：按目标服务器维护凭证——不要求先连接 */
    onFetchCredentialStatus: (serverId: string) => void;
    onSaveCredentialFor: (serverId: string) => void;
    onLoadCredentialSecretFor: (serverId: string) => void;
    onClearCredentialFor: (serverId: string) => void;
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
    /* S10：按清单选中服务器测凭证/开终端 */
    onTestConnectionFor: (serverId: string) => void;
    onOpenTerminal: (serverId: string) => void;
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

function monoFontFamilyLabel(value: MonoFontFamily): string {
  if (value === "sf-mono") return "SF Mono";
  if (value === "menlo") return "Menlo";
  if (value === "consolas") return "Consolas";
  if (value === "system-mono") return "系统等宽";
  return "Geist Mono";
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

/** S14-4：水印内容模板占位符替换（{用户} / {主机} / {时间}）。 */
export function resolveWatermarkText(template: string, values: { user: string; host: string; time: string }): string {
  return template
    .replaceAll("{用户}", values.user || "用户")
    .replaceAll("{主机}", values.host || "主机")
    .replaceAll("{时间}", values.time || "");
}

interface WatermarkOverlayProps {
  enabled: boolean;
  template: string;
  opacity: number;
  scope: WatermarkScope;
  user: string;
  host: string;
  time: string;
}

/**
 * S14-4 水印覆盖层（原型 1155-1166）：
 * 斜向平铺文字，rotate(-22deg)、低透明度、pointer-events:none，叠加在内容区之上。
 * 默认关闭（watermarkEnabled=false 时不渲染）。作用范围 global 时由外层决定挂载位置。
 */
export function WatermarkOverlay(props: WatermarkOverlayProps) {
  if (!props.enabled || !props.template.trim()) return null;
  const text = resolveWatermarkText(props.template, { user: props.user, host: props.host, time: props.time });
  return (
    <div
      className={props.scope === "global" ? "slc-watermark slc-watermark-global" : "slc-watermark slc-watermark-content"}
      aria-hidden="true"
      style={{ "--wm-opacity": String(Math.max(0.01, Math.min(0.3, props.opacity / 100))) } as CSSProperties}
    >
      <div className="slc-watermark-grid">
        {Array.from({ length: 24 }, (_, index) => (
          <span key={index}>{text}</span>
        ))}
      </div>
    </div>
  );
}

export function ConnectionSettingsWorkspace(props: Props) {
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
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

  /* S10：清单选中任何服务器都读取其凭证状态——凭证编辑不再要求先连接 */
  const activeListServerId = activeListServer?.id || "";
  useEffect(() => {
    if (activeListServerId) {
      props.connectionSection.onFetchCredentialStatus(activeListServerId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeListServerId]);
  /* S10-2：危险区「最近目录」（原型 979 行）。优先取该服务器本地浏览历史，
     无历史时回落当前连接目录；最多展示 3 条，与原型一致。 */
  const recentDirectoryLabel = (() => {
    const serverId = activeListServer?.id || "";
    const history = serverId ? readDirectoryHistory(serverId).filter(Boolean) : [];
    const fallback = props.currentServerSection.connectionDirectory?.trim();
    const merged = [...new Set([...history, ...(fallback ? [fallback] : [])])].slice(0, 3);
    return merged.length ? merged.join(" · ") : "/";
  })();

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


  /* S10：凭证卡 = 只读生效状态 + 「编辑凭证」展开编辑（危险动作「清除」仅在编辑态出现，且带确认框）。
     当前连接与清单选中服务器共用；所有操作按目标 serverId 进行，不要求先连接。 */
  /* S10：凭证卡 = 只读生效状态；「编辑凭证」与「编辑连接」共用同一表单（连接信息 + 密码/私钥一起维护） */
  const openEditForm = () => {
    if (!activeListServer) return;
    props.connectionSection.onEditManualServer(activeListServer);
    setDetailPane("form");
  };

  const renderCredentialCard = () => (
    <section className="settings-card conn-credential-card">
      <div className="settings-card-head">
        <div>
          <span className="settings-card-kicker">连接凭证</span>
          {credentialStatus?.hasUsableCredential ? (
            <span className="chip grn">已有可用凭证 · {credentialStatus.source || "本地"}</span>
          ) : (
            <span className="chip">尚未配置可用凭证</span>
          )}
        </div>
        <button className="ghost-button" type="button" onClick={openEditForm}>编辑凭证</button>
      </div>
      <div className="credential-summary-line">
        <span><span className="settings-info-key">认证方式</span>{credentialStatus?.hasPassword ? "密码 · 已保存" : credentialStatus?.hasPrivateKey ? "私钥 · 已保存" : "未配置"}</span>
        <span><span className="settings-info-key">用户名</span><span className="mono">{credentialStatus?.username || activeListServer?.username || "--"}</span></span>
        <span><span className="settings-info-key">私钥</span>{credentialStatus?.hasPrivateKey ? "已保存" : "未配置"}</span>
      </div>
    </section>
  );

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
              {/* S10：手动维护主入口——清单顶部常驻「＋ 新增」（原型 941 行） */}
              <button
                type="button"
                className="ghost-button settings-primary-action conn-list-add"
                title="手动新建连接（表单同「编辑」）"
                onClick={() => {
                  props.connectionSection.onStartCreate();
                  setDetailPane("form");
                }}
              >
                ＋ 新增
              </button>
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
                          setMoreMenuOpen(false);
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
                {detailPane === "detail" && activeListServer ? (
                  <p className="conn-head-sub">
                    <span className="chip">{sourceLabel(activeListServer.source)}</span>
                    {viewingCurrentServer ? <span className="chip grn">当前连接</span> : null}
                    <span className="mono">{activeListServer.username}@{activeListServer.host}:{activeListServer.port} · {activeListServer.basePath || "/"}</span>
                  </p>
                ) : (
                  <p>
                    {detailPane === "form"
                      ? "连接信息与凭证在同一表单维护，保存后生效。"
                      : detailPane === "import"
                        ? "从 FinalShell / Xshell 自动读取本机连接配置并解密导入。"
                        : "查看连接信息；在此维护凭证与堡垒机路由，无需先连接。"}
                  </p>
                )}
              </div>
              <div className="conn-head-actions">
                {detailPane === "detail" && activeListServer ? (
                  <>
                    <button className="ghost-button" type="button" title="用已保存凭证测试这台服务器能否登录" onClick={() => props.currentServerSection.onTestConnectionFor(activeListServer.id)} disabled={props.isBusy}>重连测试</button>
                    <button className="ghost-button" type="button" onClick={() => props.currentServerSection.onOpenTerminal(activeListServer.id)} disabled={props.isBusy}><Terminal size={12} strokeWidth={1.8} /> 打开终端</button>
                    {/* S10：低频项收进 ⋯ 菜单（编辑连接/复制地址/导入来源），原型头部省略号按钮 */}
                    <div className={moreMenuOpen ? "conn-more-wrap conn-more-wrap-open" : "conn-more-wrap"}>
                      <button
                        type="button"
                        className="ghost-button conn-more-trigger"
                        title="更多：编辑连接 · 复制地址 · 导入来源"
                        onClick={() => setMoreMenuOpen((current) => !current)}
                      >
                        <MoreHorizontal size={14} strokeWidth={1.8} />
                      </button>
                      {moreMenuOpen ? (
                        <div className="conn-more-menu" role="menu">
                          <button type="button" role="menuitem" onClick={() => {
                            setMoreMenuOpen(false);
                            void navigator.clipboard?.writeText(`${activeListServer.username}@${activeListServer.host}:${activeListServer.port}`).catch(() => {});
                          }}>复制地址</button>
                          <button type="button" role="menuitem" className="conn-more-menu-danger" onClick={() => {
                            setMoreMenuOpen(false);
                            props.connectionSection.onClearCredentialFor(activeListServer.id);
                          }} disabled={props.isBusy || !credentialStatus?.hasUsableCredential}>清除凭证</button>
                          <button type="button" role="menuitem" onClick={() => {
                            setMoreMenuOpen(false);
                            setDetailPane((current) => current === "import" ? "detail" : "import");
                          }}>导入来源</button>
                        </div>
                      ) : null}
                    </div>
                  </>
                ) : null}
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
                      {/* S10：详情默认只读——「连接信息」键值网格 + [编辑]（原型 946-957） */}
                      <section className="settings-card">
                        <div className="settings-card-head">
                          <div>
                            <span className="settings-card-kicker">连接信息</span>
                            <strong>{activeListServer.name}</strong>
                          </div>
                          <div className="settings-inline-actions">
                            <button className="ghost-button" type="button" title={activeListServer.source === "manual" ? "编辑连接" : "导入服务器将以手动连接副本打开编辑"} onClick={() => {
                              props.connectionSection.onEditManualServer(activeListServer);
                              setDetailPane("form");
                            }}>编辑</button>
                          </div>
                        </div>
                        <div className="settings-info-grid">
                          <span><span className="settings-info-key">主机</span><span className="mono">{activeListServer.host}</span></span>
                          <span><span className="settings-info-key">端口</span><span className="mono">{activeListServer.port}</span></span>
                          <span><span className="settings-info-key">用户名</span><span className="mono">{activeListServer.username}</span></span>
                          <span><span className="settings-info-key">类型</span><span>{connectionKindLabel(activeListServer.connectionKind)}</span></span>
                          <span><span className="settings-info-key">目录</span><span className="mono">{props.currentServerSection.connectionDirectory || "/"}</span></span>
                          <span><span className="settings-info-key">来源</span><span>{sourceLabel(activeListServer.source)}</span></span>
                        </div>
                      </section>

                      {/* S10：凭证卡（当前连接 / 清单选中服务器共用；按目标 ID 维护，不要求先连接） */}
                      {renderCredentialCard()}

                      {/* S10：连接入口——直连时折叠为一行摘要，展开才见配置（原型 969-976） */}
                      <section className="settings-card conn-entry-card">
                        {canConfigureRoute ? (
                          <>
                            <div className="settings-card-head">
                              <div>
                                <span className="settings-card-kicker">连接入口</span>
                                <strong>入口账号与 JumpServer 规则</strong>
                              </div>
                              <button className="ghost-button" type="button" onClick={props.currentServerSection.onSaveRoute} disabled={props.isBusy}>保存入口设置</button>
                            </div>
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
                          <details className="conn-entry-details">
                            <summary>
                              <span className="settings-card-kicker">连接入口</span>
                              <span className="conn-entry-summary-text">当前服务器按直连处理</span>
                              <span className="conn-entry-summary-toggle">展开配置堡垒机 ▾</span>
                            </summary>
                            <div className="settings-note-box conn-entry-note">
                              <strong>如果你希望它走堡垒机</strong>
                              <span>请点 ⋯ 菜单「编辑连接」把连接方式改成「经堡垒机目标机」。</span>
                            </div>
                          </details>
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
                      {/* S10：凭证不再要求先连接——清单选中的服务器同样可直接维护 */}
                      {renderCredentialCard()}
                    </div>
                  )
                ) : (
                  <div className="settings-workspace-empty settings-empty-centered">
                    <div className="settings-empty-icon" aria-hidden="true">
                      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/></svg>
                    </div>
                    <strong>选择左侧服务器查看连接详情</strong>
                    <span>点击清单顶部「＋ 新增」手动添加，或经 ⋯ 菜单「导入来源」从 FinalShell / Xshell 导入。</span>
                  </div>
                )
                ) : null}
            </div>
            {/* S10-2 必达：危险区「最近目录」+「删除此服务器」红字行，及其下 panel-muted 底 D9 页脚（原型 978-984）。
                仅在有服务器的详情态出现；删除降为页脚红字，不做独立危险按钮。 */}
            {detailPane === "detail" && activeListServer ? (
              <>
                <div className="conn-danger-strip">
                  <span className="conn-danger-recent">
                    最近目录：{recentDirectoryLabel}
                  </span>
                  <button
                    type="button"
                    className="ghost-button danger-button conn-danger-delete"
                    onClick={() => props.connectionSection.onDeleteServer(activeListServer)}
                    disabled={props.isBusy}
                  >
                    <Trash2 size={12} strokeWidth={1.8} />
                    删除此服务器
                  </button>
                </div>
              </>
            ) : null}
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
                {/* S14-1 必达：背景方案 4 张可视缩略卡（原型 1109-1117），
                    原为 <select> 下拉。96×60 缩略卡，选中 accent 边框 + accent 文字。 */}
                <div className="settings-pref-row settings-pref-row-wide">
                  <span className="settings-pref-label"><strong>背景方案</strong><span>默认 / 雾面 / 纸感 / 自定义，点击缩略图直接切换</span></span>
                  <div className="surface-thumb-row" role="radiogroup" aria-label="背景方案">
                    {SURFACE_OPTIONS.map((option) => {
                      const active = props.preferenceSection.uiSurface === option.value;
                      return (
                        <button
                          key={option.value}
                          type="button"
                          role="radio"
                          aria-checked={active}
                          className={active ? "surface-thumb surface-thumb-active" : "surface-thumb"}
                          onClick={() => props.preferenceSection.onUiSurfaceChange(option.value)}
                        >
                          <span className="surface-thumb-card" style={{ background: option.background }} aria-hidden="true">
                            <i className="surface-thumb-line surface-thumb-line-1" />
                            <i className="surface-thumb-line surface-thumb-line-2" />
                            <i className="surface-thumb-line surface-thumb-line-3" />
                            <i className="surface-thumb-line surface-thumb-line-4" />
                          </span>
                          <span className="surface-thumb-label">{option.label}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
                {props.preferenceSection.uiSurface === "custom" ? (
                  <div className="settings-pref-row settings-pref-row-wide settings-theme-customizer">
                    <div className="settings-theme-customizer-head">
                      <div>
                        <span>自定义背景 · 图片模式</span>
                        <strong>
                          {backgroundModeLabel(props.preferenceSection.uiBackgroundMode)}
                          {" · "}
                          {fontFamilyLabel(props.preferenceSection.uiFontFamily)}
                        </strong>
                      </div>
                      {/* S14-2：背景模式改为 fchip（原型 1123 行「纯色 / 渐变 / 图片」） */}
                      <span className="bg-mode-chips">
                        {(["solid", "gradient", "image"] as UiBackgroundMode[]).map((mode) => (
                          <button
                            key={mode}
                            type="button"
                            className={props.preferenceSection.uiBackgroundMode === mode ? "fchip fchip-on" : "fchip"}
                            onClick={() => props.preferenceSection.onUiBackgroundModeChange(mode)}
                          >
                            {mode === "solid" ? "纯色" : mode === "gradient" ? "渐变" : "图片"}
                          </button>
                        ))}
                      </span>
                    </div>
                    {/* S14-2 必达：图片模式下的「遮罩亮度」「背景模糊」滑杆（原型 1125-1126 行） */}
                    {props.preferenceSection.uiBackgroundMode === "image" ? (
                      <div className="bg-image-sliders">
                        <label className="bg-slider-field">
                          <span>遮罩亮度</span>
                          <input
                            type="range"
                            min={0}
                            max={90}
                            value={props.preferenceSection.customImageOverlay}
                            onChange={(event) => props.preferenceSection.onCustomImageOverlayChange(Number(event.target.value))}
                          />
                          <code>{props.preferenceSection.customImageOverlay}%</code>
                        </label>
                        <label className="bg-slider-field">
                          <span>背景模糊</span>
                          <input
                            type="range"
                            min={0}
                            max={24}
                            value={props.preferenceSection.customImageBlur}
                            onChange={(event) => props.preferenceSection.onCustomImageBlurChange(Number(event.target.value))}
                          />
                          <code>{props.preferenceSection.customImageBlur}px</code>
                        </label>
                      </div>
                    ) : null}
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
                  <span className="settings-pref-label"><strong>动效</strong><span>低性能机器可选减少动效</span></span>
                  <span className="settings-pref-value">
                    {/* S14-5：动效 = .seg.lite（原型 1170「标准/减少」） */}
                    <span className="seg lite">                      <button type="button" className={props.preferenceSection.motionMode === "normal" ? "on" : ""} onClick={() => props.preferenceSection.onMotionModeChange("normal")}>标准</button>
                      <button type="button" className={props.preferenceSection.motionMode === "reduced" ? "on" : ""} onClick={() => props.preferenceSection.onMotionModeChange("reduced")}>减少</button>
                    </span>
                  </span>
                </div>
                <div className="settings-pref-row">
                  <span className="settings-pref-label"><strong>动态背景（图片缓慢缩放）</strong><span>动效=减少 时强制停用</span></span>
                  <span className="settings-pref-value">
                    <button
                      type="button"
                      className={props.preferenceSection.dynamicBackground && props.preferenceSection.motionMode !== "reduced" ? "pill on" : "pill"}
                      onClick={props.preferenceSection.onToggleDynamicBackground}
                    >
                      {props.preferenceSection.dynamicBackground ? "开启" : "关闭"}
                    </button>
                  </span>
                </div>
                {/* S14-3 必达：字体三处独立表（原型 1131-1142）——
                    表格 作用区/字体族/字号，三行 = 界面 / 日志预览 / 终端；下方虚线「实时预览」行。 */}
                <div className="settings-pref-row settings-pref-row-wide">
                  <span className="settings-pref-label"><strong>字体（三处独立）</strong><span>界面 / 日志预览 / 终端各自独立，日志字体族为新增能力</span></span>
                  <div className="font-matrix">
                    <table className="font-matrix-table">
                      <thead>
                        <tr>
                          <th>作用区</th>
                          <th>字体族</th>
                          <th>字号</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr>
                          <td>界面</td>
                          <td>
                            <ThemedSelect
                              value={props.preferenceSection.uiFontFamily}
                              onChange={(value) => props.preferenceSection.onUiFontFamilyChange(value as UiFontFamily)}
                              ariaLabel="界面字体"
                              options={[
                                { value: "geist", label: "Geist（默认）" },
                                { value: "pingfang", label: "苹方" },
                                { value: "microsoft-yahei", label: "微软雅黑" },
                                { value: "simsun", label: "宋体" },
                                { value: "system", label: "系统字体" }
                              ]}
                            />
                          </td>
                          <td><span className="pill">跟随界面密度</span></td>
                        </tr>
                        <tr>
                          <td>日志预览</td>
                          <td>
                            <ThemedSelect
                              value={props.preferenceSection.logFontFamily}
                              onChange={(value) => props.preferenceSection.onLogFontFamilyChange(value as MonoFontFamily)}
                              ariaLabel="日志预览字体"
                              options={[
                                { value: "geist-mono", label: "Geist Mono" },
                                { value: "sf-mono", label: "SF Mono" },
                                { value: "menlo", label: "Menlo" },
                                { value: "consolas", label: "Consolas" },
                                { value: "system-mono", label: "系统等宽" }
                              ]}
                            />
                          </td>
                          <td>
                            <input
                              type="number"
                              min={11}
                              max={16}
                              value={props.preferenceSection.logFontSize}
                              onChange={(event) => props.preferenceSection.onLogFontSizeChange(Number(event.target.value))}
                              aria-label="日志预览字号"
                            />
                          </td>
                        </tr>
                        <tr>
                          <td>终端</td>
                          <td>
                            <ThemedSelect
                              value={props.preferenceSection.terminalFontFamily}
                              onChange={(value) => props.preferenceSection.onTerminalFontFamilyChange(value as MonoFontFamily)}
                              ariaLabel="终端字体"
                              options={[
                                { value: "geist-mono", label: "Geist Mono" },
                                { value: "sf-mono", label: "SF Mono" },
                                { value: "menlo", label: "Menlo" },
                                { value: "consolas", label: "Consolas" },
                                { value: "system-mono", label: "系统等宽" }
                              ]}
                            />
                          </td>
                          <td>
                            <input
                              type="number"
                              min={11}
                              max={18}
                              value={props.preferenceSection.terminalFontSize}
                              onChange={(event) => props.preferenceSection.onTerminalFontSizeChange(Number(event.target.value))}
                              aria-label="终端字号"
                            />
                          </td>
                        </tr>
                      </tbody>
                    </table>
                    {/* 原型 1139-1141：虚线「实时预览」行 */}
                    <div className="font-live-preview">
                      实时预览 — 2026-09-29 09:02:11{" "}
                      <span className="font-live-error">ERROR</span>{" "}
                      c.e.task.SyncJob - sync failed: connection reset by peer
                    </div>
                  </div>
                </div>
                {/* S14-4 必达：水印块（原型 1143-1168）——
                    标题「水印」+ chip 新增 + pill 开启；内容模板 / 透明度 range / 作用范围 fchip；
                    右侧预览框显示斜向平铺水印。水印渲染层见 WatermarkOverlay（默认关闭）。 */}
                <div className="settings-pref-row settings-pref-row-wide">
                  <div className="watermark-block">
                    <div className="watermark-main">
                      <div className="watermark-head">
                        <span className="watermark-title">水印<span className="chip">新增</span></span>
                        <button
                          type="button"
                          className={props.preferenceSection.watermarkEnabled ? "pill on" : "pill"}
                          onClick={props.preferenceSection.onToggleWatermark}
                        >
                          {props.preferenceSection.watermarkEnabled ? "开启" : "关闭"}
                        </button>
                      </div>
                      <label className="watermark-field">
                        <span>内容模板</span>
                        <input
                          value={props.preferenceSection.watermarkTemplate}
                          onChange={(event) => props.preferenceSection.onWatermarkTemplateChange(event.target.value)}
                          placeholder={DEFAULT_WATERMARK_TEMPLATE}
                        />
                      </label>
                      <label className="watermark-field watermark-field-range">
                        <span>透明度</span>
                        <input
                          type="range"
                          min={1}
                          max={20}
                          value={props.preferenceSection.watermarkOpacity}
                          onChange={(event) => props.preferenceSection.onWatermarkOpacityChange(Number(event.target.value))}
                        />
                        <code>{props.preferenceSection.watermarkOpacity}%</code>
                      </label>
                      <div className="watermark-scope">
                        作用范围
                        <button
                          type="button"
                          className={props.preferenceSection.watermarkScope === "content" ? "fchip fchip-on" : "fchip"}
                          onClick={() => props.preferenceSection.onWatermarkScopeChange("content")}
                        >
                          日志/预览区
                        </button>
                        <button
                          type="button"
                          className={props.preferenceSection.watermarkScope === "global" ? "fchip fchip-on" : "fchip"}
                          onClick={() => props.preferenceSection.onWatermarkScopeChange("global")}
                        >
                          全局
                        </button>
                      </div>
                    </div>
                    <div className="watermark-preview" aria-hidden="true">
                      <div className="watermark-preview-lines">
                        <div className="ll"><span className="t">09:02:11.001</span><span><span className="lv lv-e">ERROR</span> SyncJob - sync failed…</span></div>
                        <div className="ll"><span className="t">09:02:12.110</span><span><span className="lv lv-i">INFO </span> SyncJob - retry scheduled</span></div>
                        <div className="ll"><span className="t">09:02:15.771</span><span><span className="lv lv-w">WARN </span> UploadController - got 413</span></div>
                      </div>
                      <div
                        className="watermark-preview-tiles"
                        style={{ "--wm-opacity": String(props.preferenceSection.watermarkOpacity / 100) } as CSSProperties}
                      >
                        {Array.from({ length: 4 }, (_, index) => (
                          <span key={index}>{props.preferenceSection.watermarkTemplate || DEFAULT_WATERMARK_TEMPLATE}</span>
                        ))}
                      </div>
                    </div>
                  </div>
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
                {/* S14-3：日志字号已并入「外观」的字体三处独立表 */}
              </div>
            </section>

            <section id="pref-terminal" data-anchor className="settings-pref-section">
              <div className="settings-card-kicker">终端</div>
              <div className="settings-pref-card">
                <div className="settings-pref-row">
                  <span className="settings-pref-label"><strong>终端重排</strong><span>字体族 / 字号更新后 xterm 自动重排，避免列宽错位</span></span>
                  <span className="settings-pref-value">{props.preferenceSection.terminalFontFamily === "geist-mono" ? "Geist Mono" : monoFontFamilyLabel(props.preferenceSection.terminalFontFamily)} · {props.preferenceSection.terminalFontSize}px</span>
                </div>
                <div className="settings-pref-row">
                  <span className="settings-pref-label"><strong>终端选中复制</strong><span>选中即复制，右键粘贴</span></span>
                  <span className="settings-pref-value">默认开启</span>
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
