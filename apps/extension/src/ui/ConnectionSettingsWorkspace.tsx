import { useEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, ChevronLeft, Eye, EyeOff, MoreHorizontal, Terminal, Trash2 } from "lucide-react";
import type { JumpServerAssetOption, LogProfile, ServerConnectionKind, ServerCredentialStatus, ServerSummary } from "@server-log-console/shared";
import { looksLikeJumpServer } from "./terminal-utils.js";
import { readDirectoryHistory } from "./storage.js";
import { apiGetCredentialSecret, apiTestConnection, apiTestDraftConnection } from "./api.js";
import { ThemedSelect } from "./ThemedSelect.js";
import { TERMINAL_TEXTURES, TERMINAL_BACKDROPS, buildTextureBackground, buildBackdropBackground } from "./semantic-tokens.js";
import type { SlcDesktopUpdateState } from "../types/desktop-update.js";
import { UpdateCenterPanel, type DesktopUpdateCheckLogEntry } from "./UpdateCenterPanel.js";
import { SecuritySettingsView } from "./SecuritySettingsView.js";
import type { ToastState } from "./FeedbackOverlays.js";
import type { MonoFontFamily, UiBackgroundLayer, UiDensity, UiFontFamily, UiMotionMode, UiThemePreset, UiToneMode, ThemePreset, TerminalColorScheme, TerminalColorSchemeId } from "./useUiTheme.js";
import { monoFontFamilyValue } from "./useUiTheme.js";

export type SettingsWorkspaceView = "connections" | "gateway" | "security" | "preferences" | "update";
export type SettingsConnectionPane = "detail" | "form";

/** 连接服务「测试连接」结果（设置中心 → 连接服务） */
export interface GatewayTestState {
  tone: "success" | "danger" | "neutral";
  text: string;
}
/** S14：水印作用范围（原型 1143-1168「日志/预览区 / 全局」） */
export type WatermarkScope = "content" | "global";

/** S14：水印默认内容模板（原型 1150 行） */
export const DEFAULT_WATERMARK_TEMPLATE = "{用户} · {主机} · {时间} 内部资料";

export interface ManualServerDraft {
  id: string;
  name: string;
  host: string;
  port: string;
  username: string;
  basePath: string;
  profile: LogProfile;
  tagsText: string;
  /** 分组路径文本（"生产 / 华东"）；空 = 未分组。手动连接原先没有分组字段，
      所以手动新增的服务器永远落在「未分组」里（2026-10-23 用户反馈）。 */
  groupPathText: string;
  connectionKind: ServerConnectionKind;
  password: string;
  privateKey: string;
}

interface Props {
  activeView: SettingsWorkspaceView;
  onViewChange: (view: SettingsWorkspaceView) => void;
  /** 是否 Electron 宿主（安全页文案据此区分钥匙串 / 浏览器形态） */
  isElectron: boolean;
  /** 操作反馈（安全页刷新等） */
  onActionStatus?: (message: string) => void;
  isBusy: boolean;
  localServiceState: "checking" | "online" | "offline";
  localServiceStatusText: string;
  /* 软件更新（update-center-v1）：状态由 App 级 useDesktopUpdate 订阅，面板仅消费 */
  updateSection: {
    state: SlcDesktopUpdateState;
    updateAvailable: boolean;
    checkLog: DesktopUpdateCheckLogEntry[];
    onCheck: () => void;
    onDownload: () => void;
    onInstall: () => void;
    showToast: (type: ToastState["type"], message: string) => void;
  };
  preferenceSection: {
    uiTheme: "classic" | "modern";
    uiDensity: UiDensity;
    uiThemePreset: UiThemePreset;
    uiToneMode: UiToneMode;
    resolvedThemeId: UiThemePreset;
    resolvedThemeName: string;
    systemDark: boolean;
    uiBackground: UiBackgroundLayer;
    uiImgOverlay: number;
    uiImgBlur: number;
    customBackgroundImage: string;
    uiTerminalScheme: TerminalColorSchemeId;
    uiAccentOverride: string | null;
    themePresetOptions: ThemePreset[];
    backgroundOptions: Array<{ id: UiBackgroundLayer; name: string; desc: string }>;
    terminalSchemeOptions: TerminalColorScheme[];
    uiFontFamily: UiFontFamily;
    /* 界面字号（--fs-* 梯度基准，12~18）：驱动全套界面字号 token */
    uiFontSize: number;
    logFontSize: number;
    terminalFontSize: number;
    /* 终端外观（参考 VRC「控制台外观」）：行高 / 光标样式 / 光标闪烁 */
    terminalLineHeight: number;
    onTerminalLineHeightChange: (value: number) => void;
    terminalCursorStyle: "block" | "bar" | "underline";
    onTerminalCursorStyleChange: (style: "block" | "bar" | "underline") => void;
    terminalCursorBlink: boolean;
    onTerminalCursorBlinkChange: (value: boolean) => void;
    /* 「跟随主题」卡预览色：主题 shell 底 / ink 文字 + 控制台方案 ANSI（App 按 resolvedTheme 计算） */
    terminalFollowPreview: TerminalFollowPreviewColors;
    /* S14：日志 / 终端字体族独立配置 */
    logFontFamily: MonoFontFamily;
    onLogFontFamilyChange: (family: MonoFontFamily) => void;
    terminalFontFamily: MonoFontFamily;
    onTerminalFontFamilyChange: (family: MonoFontFamily) => void;
    motionMode: UiMotionMode;
    dynamicBackground: boolean;
    watermarkEnabled: boolean;
    watermarkTemplate: string;
    watermarkOpacity: number;
    watermarkScope: WatermarkScope;
    errorHighlightEnabled: boolean;
    sliceLengthMode: "auto" | "manual";
    sliceLength: number;
    serverStatusAutoRefresh: boolean;
    serverStatusRefreshIntervalMs: number;
    activityPanelHeight: number;
    activityPanelVisible: boolean;
    onToggleActivityPanelVisible: () => void;
    onUiThemeChange: (theme: "classic" | "modern") => void;
    onUiDensityChange: (density: UiDensity) => void;
    onUiThemePresetChange: (preset: UiThemePreset) => void;
    onUiToneModeChange: (mode: UiToneMode) => void;
    onUiBackgroundChange: (layer: UiBackgroundLayer) => void;
    onUiImgOverlayChange: (value: number) => void;
    onUiImgBlurChange: (value: number) => void;
    onCustomBackgroundImageChange: (value: string) => void;
    onUiTerminalSchemeChange: (scheme: TerminalColorSchemeId) => void;
    /** 终端背景纹理与强度（2026-10-27） */
    terminalTexture: "none" | "grid" | "dots" | "double";
    terminalTextureIntensity: number;
    terminalBackdrop: "none" | "aurora" | "nebula" | "mesh" | "carbon" | "wave";
    terminalBackdropIntensity: number;
    onTerminalBackdropChange: (value: "none" | "aurora" | "nebula" | "mesh" | "carbon" | "wave") => void;
    onTerminalBackdropIntensityChange: (value: number) => void;
    onTerminalTextureChange: (value: "none" | "grid" | "dots" | "double") => void;
    onTerminalTextureIntensityChange: (value: number) => void;
    onUiAccentOverrideChange: (accent: string | null) => void;
    onUiFontFamilyChange: (fontFamily: UiFontFamily) => void;
    onUiFontSizeChange: (size: number) => void;
    onLogFontSizeChange: (size: number) => void;
    onTerminalFontSizeChange: (size: number) => void;
    onMotionModeChange: (mode: UiMotionMode) => void;
    onToggleDynamicBackground: () => void;
    onToggleWatermark: () => void;
    onWatermarkTemplateChange: (value: string) => void;
    onWatermarkOpacityChange: (value: number) => void;
    onWatermarkScopeChange: (scope: WatermarkScope) => void;
    onResetUiPreferences: () => void;
    onToggleErrorHighlight: () => void;
    onSliceLengthModeChange: (mode: "auto" | "manual") => void;
    onSliceLengthChange: (bytes: number) => void;
    onToggleServerStatusAutoRefresh: () => void;
  };
  gatewaySection: {
    draftBaseUrl: string;
    draftToken: string;
    effectiveBase: string;
    testState: GatewayTestState | null;
    onDraftBaseUrlChange: (value: string) => void;
    onDraftTokenChange: (value: string) => void;
    onTest: () => void;
    onSave: () => void;
    onReset: () => void;
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
  { id: "pref-log", label: "日志" },
  { id: "pref-terminal", label: "终端" },
  { id: "pref-layout", label: "界面与浮层" },
  { id: "pref-advanced", label: "高级" },
];

/** 高级 · 强调色覆盖预设（低饱和克制色；跟随主题之外的一组快捷覆盖） */
const ACCENT_OVERRIDES = [
  "#0070f3", "#2563eb", "#0d9488", "#5e6ad2", "#d97706", "#8a6a3f", "#d6396f", "#18181b"
];

/* 主题卡缩略：真实界面迷你渲染（顶栏/侧栏/工具行/日志行），用主题真实 token 上色 */
function MiniThemeWindow({ preset }: { preset: ThemePreset }) {
  const v = preset.v;
  const nav = [
    { c: v.accent, w: "70%", on: true },
    { c: v.ink, w: "52%" },
    { c: v.ink, w: "62%" },
    { c: v.ink, w: "44%" }
  ];
  const lines = [
    { lv: "ERROR", lc: preset.sem.red, m: "sync failed: reset" },
    { lv: "INFO", lc: v.soft, m: "retry 1/3 in 5s" },
    { lv: "ERROR", lc: preset.sem.red, m: "failed again, giving up" },
    { lv: "WARN", lc: preset.sem.amber, m: "mark #4821 FAILED" }
  ];
  return (
    <span
      className="slc-mini"
      style={{
        backgroundColor: v.bg,
        backgroundImage: `radial-gradient(120% 100% at 14% 0%, color-mix(in srgb, ${v.accent} 14%, transparent), transparent 52%), radial-gradient(100% 80% at 96% 8%, color-mix(in srgb, #8b5cf6 8%, transparent), transparent 50%)`
      }}
    >
      <span className="slc-mini-top" style={{ background: v.panel, borderColor: v.line }}>
        <i style={{ background: v.accent }} />
        <i style={{ background: v.lineS }} />
        <i style={{ background: v.lineS }} />
        <b style={{ color: v.soft }}>127.38</b>
        <em style={{ background: preset.sem.red }}>LIVE</em>
      </span>
      <span className="slc-mini-main">
        <span className="slc-mini-nav" style={{ background: v.muted, borderColor: v.line }}>
          {nav.map((n, i) => (
            <span key={i} className="slc-mini-navrow">
              <i style={{ background: n.on ? v.accent : v.ink, opacity: n.on ? 1 : 0.28 }} />
              <span style={{ width: n.w, background: n.c, opacity: n.on ? 0.8 : 0.3 }} />
            </span>
          ))}
        </span>
        <span className="slc-mini-body">
          <span className="slc-mini-tools">
            <i style={{ borderColor: v.line, background: v.panel }} />
            <b style={{ background: v.accent }} />
          </span>
          {lines.map((l, i) => (
            <span key={i} className="slc-mini-line">
              <u style={{ color: v.mut }}>{`09:0${2 + (i > 1 ? 1 : 0)}`}</u>
              <b style={{ color: l.lc }}>{l.lv}</b>
              <span style={{ color: v.soft }}>{l.m}</span>
            </span>
          ))}
        </span>
      </span>
    </span>
  );
}

/** 背景层预览样式（内联复刻 theme-modern.css 的 .ui-bg-*，设置弹窗内可独立预览） */
function previewBgStyle(preset: ThemePreset, layer: UiBackgroundLayer) {
  const v = preset.v;
  const ink = v.ink;
  const a = v.accent;
  const mix = (c: string, pct: number) => `color-mix(in srgb, ${c} ${pct}%, transparent)`;
  const grid = `linear-gradient(${mix(ink, 9)} 1px, transparent 1px), linear-gradient(90deg, ${mix(ink, 9)} 1px, transparent 1px)`;
  const noise = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Crect width='120' height='120' filter='url(%23n)' opacity='0.06'/%3E%3C/svg%3E")`;
  switch (layer) {
    case "aurora":
      return { image: `radial-gradient(120% 90% at 14% 0%, ${mix(a, 14)}, transparent 52%), radial-gradient(100% 80% at 96% 6%, color-mix(in srgb, #8b5cf6 10%, transparent), transparent 50%)`, size: undefined };
    case "linear":
      return { image: `linear-gradient(135deg, color-mix(in srgb, ${a} 12%, ${v.bg}), color-mix(in srgb, ${a} 4%, ${v.bg}) 55%, ${v.bg})`, size: undefined };
    case "grid":
      return { image: grid, size: "22px 22px" };
    case "dots":
      return { image: `radial-gradient(${mix(ink, 14)} 1.4px, transparent 1.4px)`, size: "15px 15px" };
    case "diag":
      return { image: `repeating-linear-gradient(45deg, ${mix(ink, 7)} 0 1px, transparent 1px 13px)`, size: undefined };
    case "noise":
      return { image: noise, size: undefined };
    default:
      return { image: "none", size: undefined };
  }
}

/** 外观节右侧实时预览：用所选主题 token + 背景层渲染的迷你工作区（弹窗不透明，故内置预览） */
function AppearanceLivePreview({ preset, bgLayer, imgOverlay, imgBlur, bgImage }: {
  preset: ThemePreset;
  bgLayer: UiBackgroundLayer;
  imgOverlay: number;
  imgBlur: number;
  bgImage: string;
}) {
  const v = preset.v;
  const fancy = bgLayer !== "solid";
  const solid = bgLayer === "image" || bgLayer === "solid";
  const bg = previewBgStyle(preset, bgLayer);
  const panePercent = fancy ? 62 : 100;
  const pane = (base: string) => `color-mix(in srgb, ${base} ${panePercent}%, transparent)`;
  const fallbackImg = `linear-gradient(135deg, color-mix(in srgb, ${v.accent} 34%, ${v.bg}), color-mix(in srgb, #8b5cf6 24%, ${v.bg}))`;
  const imgUrl = bgImage ? `url("${bgImage}")` : fallbackImg;
  const logs = [
    { t: "09:02:11", lv: "ERROR", lc: preset.sem.red, m: "sync failed: connection reset" },
    { t: "09:02:12", lv: "INFO", lc: v.soft, m: "retry 1/3 scheduled in 5s" },
    { t: "09:02:16", lv: "WARN", lc: preset.sem.amber, m: "mark job #4821 as FAILED" }
  ];
  const dim = (pct: number) => `color-mix(in srgb, ${v.shellInk} ${pct}%, transparent)`;
  return (
    <div
      className={`slc-pv-frame${fancy ? " ui-bg-fancy" : ""}`}
      style={solid ? { backgroundColor: v.bg } : { backgroundColor: v.bg, backgroundImage: bg.image, backgroundSize: bg.size }}
    >
      {bgLayer === "image" ? (
        <>
          <div className="slc-pv-bg" style={{ backgroundImage: imgUrl, filter: `blur(${imgBlur}px)` }} />
          <div className="slc-pv-veil" style={{ background: preset.tone === "dark" ? "#0a0a0c" : "#f8fafc", opacity: imgOverlay / 100 }} />
        </>
      ) : null}
      <div className="slc-pv-top slc-pv-pane" style={{ background: pane(v.panel), borderColor: v.line }}>
        <i style={{ background: v.accent }} />
        <i style={{ background: v.lineS }} />
        <i style={{ background: v.lineS }} />
        <b style={{ color: v.soft, marginLeft: 3 }}>日志控制台 · 127.38</b>
      </div>
      <div className="slc-pv-main">
        <div className="slc-pv-side slc-pv-pane" style={{ background: pane(v.muted), borderColor: v.line }}>
          <span style={{ width: "78%", background: v.accent, opacity: 0.9 }} />
          <span style={{ width: "60%", background: v.ink, opacity: 0.26 }} />
          <span style={{ width: "70%", background: v.ink, opacity: 0.26 }} />
          <span style={{ width: "50%", background: v.ink, opacity: 0.26 }} />
        </div>
        <div className="slc-pv-right">
          <div className="slc-pv-tools slc-pv-pane" style={{ background: pane(v.panel), borderBottom: `1px solid ${v.line}`, padding: "6px 8px" }}>
            <span className="s" style={{ borderColor: v.line, background: solid ? v.panel : "transparent" }} />
            <span className="b" style={{ background: v.accent }} />
          </div>
          <div className="slc-pv-log" style={{ background: v.shell }}>
            {logs.map((l, i) => (
              <span key={i} style={{ display: "flex", gap: 6 }}>
                <u style={{ textDecoration: "none", color: dim(42) }}>{l.t}</u>
                <b style={{ color: l.lc }}>{l.lv}</b>
                <span style={{ color: dim(80), overflow: "hidden", textOverflow: "ellipsis" }}>{l.m}</span>
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/** 「跟随主题」卡的预览色：主题 shell 底 / ink 文字 + 控制台方案 ANSI（App 按 resolvedTheme 计算） */
export interface TerminalFollowPreviewColors {
  background: string;
  foreground: string;
  cursor: string;
  green: string;
  red: string;
  yellow: string;
  cyan: string;
  brightBlack: string;
}

/** 终端配色真实预览：用 scheme.theme 上色的迷你终端（替代纯渐变条） */
function TerminalPreview({ scheme }: { scheme: TerminalColorScheme }) {
  const t = scheme.theme;
  return (
    <span className="slc-term-preview" style={{ background: t.background, color: t.foreground }}>
      <span style={{ color: t.brightBlack }}>Last login: Tue Sep 29 09:41</span>
      <span>
        <span style={{ color: t.green }}>root@127.38</span> systemctl status eos-server
      </span>
      <span>
        <span style={{ color: t.green }}>● </span>eos-server.service <span style={{ color: t.cyan }}>active (running)</span>
      </span>
      <span>
        <span style={{ color: t.red }}>09:02:11 ERROR</span> sync failed
      </span>
      <span>
        <span style={{ color: t.yellow }}>09:02:16 WARN </span> mark #4821 FAILED
      </span>
      <span>
        <span style={{ color: t.green }}>root@127.38</span>&nbsp;<span className="cursor" style={{ background: t.cursor }} />
      </span>
    </span>
  );
}

/** 终端实时预览面板：配色 / 字体 / 字号 / 行高 / 光标全部实时联动（对齐原型 .live-preview）。
    非真实 xterm —— 只渲染当前设置的光学效果，够轻、无会话依赖。 */
function TerminalLivePreview(props: {
  theme: { background: string; foreground: string; cursor: string; green: string; red: string; yellow: string; cyan: string; brightBlack: string };
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
  cursorStyle: "block" | "bar" | "underline";
  cursorBlink: boolean;
}) {
  const { theme, fontFamily, fontSize, lineHeight, cursorStyle, cursorBlink } = props;
  const cursorClass = ["lp-cursor", cursorStyle, cursorBlink ? "blink" : ""].filter(Boolean).join(" ");
  return (
    <div className="slc-term-live">
      <div className="slc-term-live-bar">
        <i /><i /><i />
        <span className="slc-term-live-name">access.log — 日志控制台</span>
        <span className="slc-term-live-tag"><i className="lv" />预览实时联动全部控件</span>
      </div>
      <div
        className="slc-term-live-body"
        style={{ background: theme.background, color: theme.foreground, fontFamily, fontSize, lineHeight }}
      >
        <span><span style={{ color: theme.brightBlack }}>Last login: Sat Oct 24 11:34:18 2026 from 192.168.19.14</span></span>
        <span><span style={{ color: theme.green }}>root@127.38</span> systemctl status eos-server</span>
        <span><span style={{ color: theme.green }}>● </span>eos-server.service <span style={{ color: theme.cyan }}>active (running)</span></span>
        <span><span style={{ color: theme.red }}>09:02:11 ERROR</span> sync failed</span>
        <span><span style={{ color: theme.yellow }}>09:02:16 WARN </span> mark #4821 FAILED</span>
        <span>
          <span style={{ color: theme.green }}>root@127.38</span> logs&nbsp;
          <span className={cursorClass} style={{ background: theme.cursor }} />
        </span>
      </div>
    </div>
  );
}

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
  /* 侧栏移动档下钻：清单 ⇄ 详情。宽档忽略（两栏始终并排，由 CSS 挡位决定显隐）。
     纯导航状态，非宽度分支——宽度判断只发生在 CSS 容器查询里。 */
  const [mobileShowDetail, setMobileShowDetail] = useState(false);
  const [currentAnchor, setCurrentAnchor] = useState(PREF_ANCHORS[0].id);
  /* 终端节子页（2026-10-27）：控件 20+ 单屏过载，按「配色 / 字体 / 光标」分页 */
  const [terminalTab, setTerminalTab] = useState<"scheme" | "font" | "cursor">("font");
  /* 密码 / 私钥「明文可见」开关（2026-10-23 用户需求：加可查看小眼睛）。
     默认均为 false（掩码），仅用户主动点击才明文 —— 私钥原先直接明文可读，
     现在默认掩码更安全；切换只在本地视图，不影响存盘内容。 */
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [privateKeyVisible, setPrivateKeyVisible] = useState(false);
  /* 分组输入的下拉开关 + 草稿测试连接状态（2026-10-23）。
     分组用「可输入的下拉」：既能选已有分组（含导入的），也能直接敲新路径。
     菜单走 portal + fixed（同 ThemedSelect）—— 表单容器 .conn-detail-body 有
     overflow-y:auto，行内绝对定位的菜单会被滚动容器裁切。 */
  const [groupMenuOpen, setGroupMenuOpen] = useState(false);
  const [groupMenuCoords, setGroupMenuCoords] = useState<{ x: number; y: number; w: number } | null>(null);
  const [draftTestState, setDraftTestState] = useState<{
    status: "idle" | "testing" | "ok" | "fail";
    message: string;
  }>({ status: "idle", message: "" });
  const backgroundImageInputRef = useRef<HTMLInputElement | null>(null);
  const prefScrollRef = useRef<HTMLDivElement | null>(null);
  const groupFieldRef = useRef<HTMLDivElement | null>(null);

  /* 分组菜单锚点：按输入行真实位置定位，放不下时向上翻。 */
  const updateGroupMenuCoords = () => {
    const rect = groupFieldRef.current?.querySelector<HTMLElement>(".conn-group-input")?.getBoundingClientRect();
    if (!rect) return;
    const menuMaxHeight = 216;
    const below = window.innerHeight - rect.bottom;
    const flipUp = below < menuMaxHeight + 8 && rect.top > menuMaxHeight + 8;
    setGroupMenuCoords({
      x: rect.left,
      y: flipUp ? rect.top - menuMaxHeight - 4 : rect.bottom + 4,
      w: rect.width
    });
  };

  const openGroupMenu = () => {
    updateGroupMenuCoords();
    setGroupMenuOpen(true);
  };

  /* 分组下拉的关闭：点外部 / Esc（与 ThemedSelect 行为一致）。
     不用 input 的 onBlur —— 点候选项时 blur 会先触发，导致点不到选项。 */
  useEffect(() => {
    if (!groupMenuOpen) return;
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (groupFieldRef.current?.contains(target)) return;
      if ((target as HTMLElement).closest?.(".conn-group-menu")) return;
      setGroupMenuOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setGroupMenuOpen(false);
    };
    /* 滚动/改窗口尺寸时直接收起：portal 是 fixed，跟着滚动会脱离输入框。 */
    const onScroll = () => setGroupMenuOpen(false);
    const onResize = () => setGroupMenuOpen(false);
    document.addEventListener("mousedown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
    return () => {
      document.removeEventListener("mousedown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
    };
  }, [groupMenuOpen]);

  /* 切换编辑对象（新增 ⇄ 编辑某台，或换另一台）时清掉上一次的测试结果，
     避免把 A 的「测试通过」误读成 B 的结论。 */
  const draftIdForTest = props.connectionSection.draft.id;
  useEffect(() => {
    setDraftTestState({ status: "idle", message: "" });
  }, [draftIdForTest]);

  /* 编辑已保存连接时自动回填密码 / 私钥（2026-10-23 用户反馈
     「既然服务器都存储密码了，为什么不自动填充密码，还要我手动改」）。
     为什么可以回填：密码本来就存在本地 credentials.json，同一台机器读回来
     不是新的信息暴露面；原表单「留空则不更新密码」是防误覆盖，不是安全策略，
     但对「只改个备注/分组」的场景就成了纯负担。
     实现要点：
     - 仅 draft.id 指向已保存的手动连接时回填；新建（无 id）不动。
     - prefilledDraftIdRef 记录已回填过的 id：用户手动清空密码后不会被再次写回；
       取消/重开时清空记录，下次仍会重新读取。
     - 读失败静默降级（例如网关设了 GATEWAY_HIDE_SECRETS=1 会 403），
       不打断表单，用户仍可手填。 */
  const prefilledDraftIdRef = useRef("");
  const [draftSecretHint, setDraftSecretHint] = useState("");
  useEffect(() => {
    const targetId = props.connectionSection.draft.id;
    setDraftSecretHint("");
    if (detailPane !== "form" || !targetId) return;
    if (prefilledDraftIdRef.current === targetId) return;
    prefilledDraftIdRef.current = targetId;
    void (async () => {
      try {
        const secret = await apiGetCredentialSecret(targetId);
        const patch: Partial<ManualServerDraft> = {};
        if (secret.password) patch.password = secret.password;
        if (secret.privateKey) patch.privateKey = secret.privateKey;
        if (!patch.password && !patch.privateKey) return;
        props.connectionSection.onChangeDraft(patch);
        setDraftSecretHint(
          `已回填保存的${patch.password && patch.privateKey ? "密码与私钥" : patch.password ? "密码" : "私钥"}，可直接保存或修改`
        );
      } catch {
        /* 无已存凭证 / 服务端禁用明文导出：保持空白，用户手填即可 */
      }
    })();
    /* 只按「打开了哪台」触发；props.connectionSection 每次渲染都是新对象，
       放进依赖会反复触发（配合 ref 守卫虽不会重复请求，但会误清提示）。 */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detailPane, props.connectionSection.draft.id]);

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
    /* 分组名也参与检索（2026-10-23）：分组可自定义后，用户会想直接按组名筛机器。
       与侧栏 useFileBrowserComputed 的 filteredGroupedServers 口径保持一致。 */
    return server.name.toLowerCase().includes(normalizedFilter)
      || `${server.username}@${server.host}`.toLowerCase().includes(normalizedFilter)
      || (server.groupPath?.join(" / ") || "").toLowerCase().includes(normalizedFilter)
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

  /* 分组候选（2026-10-23）：从现有服务器（含 FinalShell/Xshell 导入）里收集已用分组路径，
     供表单「分组」下拉选择。导入分组就这样被复用，用户也能手打新路径自建分组。 */
  const knownGroupOptions = (() => {
    const names = new Set<string>();
    for (const server of props.connectionSection.managedServers) {
      const path = server.groupPath?.join(" / ").trim();
      if (path) names.add(path);
    }
    return [...names].sort((a, b) => a.localeCompare(b, "zh-CN"));
  })();
  const draftGroupText = props.connectionSection.draft.groupPathText;
  const filteredGroupOptions = knownGroupOptions.filter(
    (name) => !draftGroupText.trim() || name.toLowerCase().includes(draftGroupText.trim().toLowerCase())
  );
  const draftGroupAlreadyKnown = knownGroupOptions.includes(draftGroupText.trim());

  /* 草稿测试连接（2026-10-23 用户反馈「保存链接前面少一个测试的按钮」）：
     默认用表单当前填的主机/端口/账号/密码或私钥真连一次，不需要先保存。
     编辑已保存的手动连接时，若密码/私钥留空，才回落用「已存凭证」测——但仅当
     主机/端口/用户名都没改：否则测的是旧地址，会给出误导性的「通过」。
     只写本地状态，不改任何草案内容。 */
  const handleTestDraft = async () => {
    const { draft } = props.connectionSection;
    const host = draft.host.trim();
    if (!host) {
      setDraftTestState({ status: "fail", message: "请先填写主机地址。" });
      return;
    }
    const port = Number(draft.port.trim() || "22");
    const username = draft.username.trim() || "root";
    const hasSecretInput = Boolean(draft.password || draft.privateKey);

    /* 编辑态：判断表单是否仍指向「已保存的那台」。改过地址就只能按新值测。 */
    const savedServer = draft.id
      ? props.connectionSection.managedServers.find((server) => server.id === draft.id) ?? null
      : null;
    const sameTarget = Boolean(
      savedServer && savedServer.host === host && savedServer.port === port && savedServer.username === username
    );

    if (!hasSecretInput) {
      if (!savedServer) {
        setDraftTestState({ status: "fail", message: "请先填写密码或私钥再测试。" });
        return;
      }
      if (!sameTarget) {
        setDraftTestState({
          status: "fail",
          message: "主机、端口或用户名已改动，已保存的凭证不再适用，请填入密码或私钥后再测试。"
        });
        return;
      }
    }

    setDraftTestState({ status: "testing", message: "正在连接…" });
    try {
      const result = hasSecretInput
        ? await apiTestDraftConnection({
            host,
            port,
            username,
            password: draft.password || undefined,
            privateKey: draft.privateKey || undefined,
            directoryPath: draft.basePath.trim() || "/"
          })
        : await apiTestConnection(draft.id, draft.basePath.trim() || "/");
      setDraftTestState({ status: "ok", message: result.message });
    } catch (error) {
      setDraftTestState({
        status: "fail",
        message: error instanceof Error ? error.message : "连接测试失败"
      });
    }
  };

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
          className={props.activeView === "gateway" ? "settings-rail-item settings-rail-item-active" : "settings-rail-item"}
          onClick={() => props.onViewChange("gateway")}
        >
          <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" aria-hidden="true"><rect x="1.8" y="4.2" width="12.4" height="3.4" rx="1.4" /><rect x="1.8" y="9.4" width="12.4" height="3.4" rx="1.4" /><circle cx="4.4" cy="5.9" r="0.5" fill="currentColor" /><circle cx="4.4" cy="11.1" r="0.5" fill="currentColor" /></svg>
          连接服务
          <span className={`settings-service-rail-dot settings-service-rail-dot-${props.localServiceState}`} title={props.localServiceStatusText} aria-hidden="true" />
        </button>
        <button
          type="button"
          className={props.activeView === "security" ? "settings-rail-item settings-rail-item-active" : "settings-rail-item"}
          onClick={() => props.onViewChange("security")}
        >
          <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M8 1.8l5.2 2.1v4.3c0 2.7-2.2 5-5.2 6.1-3-1.1-5.2-3.4-5.2-6.1V3.9z" /><path d="M5.9 8.1l1.6 1.6 3-3.2" /></svg>
          安全
        </button>
        <button
          type="button"
          className={props.activeView === "preferences" ? "settings-rail-item settings-rail-item-active" : "settings-rail-item"}
          onClick={() => props.onViewChange("preferences")}
        >
          <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" aria-hidden="true"><circle cx="8" cy="8" r="2" /><path d="M8 2.3v1.4M8 12.3v1.4M13.7 8h-1.4M3.7 8H2.3M11.9 4.1l-1 1M5.1 10.9l-1 1M11.9 11.9l-1-1M5.1 5.1l-1-1" /></svg>
          偏好设置
        </button>
        <button
          type="button"
          className={props.activeView === "update" ? "settings-rail-item settings-rail-item-active" : "settings-rail-item"}
          onClick={() => props.onViewChange("update")}
        >
          <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" aria-hidden="true"><path d="M8 13.5V5M4.8 8.2L8 5l3.2 3.2M3.2 13h9.6" /></svg>
          软件更新
          {props.updateSection.updateAvailable ? <span className="settings-update-rail-dot" aria-hidden="true" /> : null}
        </button>
      </nav>

      {props.activeView === "connections" ? (
        <div className={mobileShowDetail ? "conn-layout sp-drill-detail" : "conn-layout sp-drill-list"}>
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
                  setMobileShowDetail(true);
                }}
              >
                ＋ 新增
              </button>
              {/* 导入入口（2026-10-27 用户反馈「Finalshell 的导入入口在哪里？我看不到」）：
                  此前只藏在「选中服务器 → ⋯ → 导入来源」里，没有任何服务器时
                  根本点不到 —— 而这正是新用户第一次要用导入的场景。
                  现在提到清单顶部常驻，与「＋ 新增」并列。 */}
              <button
                type="button"
                className="ghost-button conn-list-import"
                title="从 FinalShell / Xshell 导入连接"
                onClick={() => {
                  setDetailPane("import");
                  setMobileShowDetail(true);
                }}
              >
                导入
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
                          setMobileShowDetail(true);
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
                <div className="conn-list-empty">没有匹配的服务器 · 试试更短的关键词，或清空筛选</div>
              ) : null}
            </div>
            <div className="conn-list-foot">
              <span>{props.connectionSection.managedServers.length} 台连接 · 手动 {props.connectionSection.manualServers.length} · 导入 {props.connectionSection.importedServers.length}</span>
            </div>
          </aside>

          <div className="conn-detail-pane">
            <div className="conn-detail-head">
              {/* 侧栏移动档下钻返回（宽档 CSS 隐藏）：回服务器清单 */}
              <button
                type="button"
                className="ghost-button icon-button sp-drill-back"
                title="返回服务器清单"
                aria-label="返回服务器清单"
                onClick={() => setMobileShowDetail(false)}
              >
                <ChevronLeft size={16} strokeWidth={1.8} />
              </button>
              <div className="conn-detail-title">
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
                        title="更多：编辑连接 · 复制地址 · 导入连接"
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
                          }}>导入连接</button>
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
                    <span className="settings-card-kicker">{props.connectionSection.draft.id ? (props.connectionSection.draft.id.startsWith("finalshell:") || props.connectionSection.draft.id.startsWith("xshell:") ? "编辑导入连接 · 就地保存" : "手动连接 · 编辑现有服务器") : "手动连接 · 新增服务器"}</span>
                    <div className="settings-inline-actions">
                      <button className="ghost-button" type="button" onClick={() => {
                        props.connectionSection.onResetDraft();
                        setDraftTestState({ status: "idle", message: "" });
                        /* 清掉「已回填」记录：下次重新打开同一台时要再读一次凭证
                           （否则用户取消了、再点编辑，密码会是空的）。 */
                        prefilledDraftIdRef.current = "";
                        setDraftSecretHint("");
                        setDetailPane("detail");
                      }}>取消</button>
                      {/* 测试连接（2026-10-23 用户反馈）：放在「保存连接」前面，
                          用表单当前值真连一次，不满意可以直接不保存。 */}
                      <button
                        className="ghost-button"
                        type="button"
                        onClick={() => { void handleTestDraft(); }}
                        disabled={draftTestState.status === "testing" || props.isBusy || !props.connectionSection.draft.host.trim()}
                        title="用当前填写的主机、端口、账号与密码/私钥立即测试一次，不需要先保存"
                      >
                        {draftTestState.status === "testing" ? "测试中…" : "测试连接"}
                      </button>
                      <button className="ghost-button settings-primary-action" type="button" onClick={() => {
                        props.connectionSection.onSaveDraft();
                        setDetailPane("detail");
                      }} disabled={!props.connectionSection.canSaveDraft || props.isBusy}>保存连接</button>
                    </div>
                  </div>
                  {draftTestState.status !== "idle" ? (
                    <div
                      className={`settings-draft-test settings-draft-test-${draftTestState.status}`}
                      role={draftTestState.status === "fail" ? "alert" : "status"}
                    >
                      <strong>
                        {draftTestState.status === "testing"
                          ? "正在测试连接"
                          : draftTestState.status === "ok" ? "连接测试通过" : "连接测试失败"}
                      </strong>
                      <span>{draftTestState.message}</span>
                    </div>
                  ) : null}
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
                      <ThemedSelect value={props.connectionSection.draft.profile} onChange={(value) => props.connectionSection.onChangeDraft({ profile: value as LogProfile })} ariaLabel="日志模式"
                        options={[
                          { value: "custom", label: "自定义" },
                          { value: "nginx", label: "Nginx" },
                          { value: "system", label: "系统日志" }
                        ]}
                      />
                    </label>
                    <label className="settings-field">
                      <span>连接方式</span>
                      <ThemedSelect value={props.connectionSection.draft.connectionKind} onChange={(value) => props.connectionSection.onChangeDraft({ connectionKind: value as ServerConnectionKind })} ariaLabel="连接方式"
                        options={[
                          { value: "direct", label: "普通直连" },
                          { value: "bastion", label: "堡垒机入口" },
                          { value: "bastion-target", label: "经堡垒机目标机" }
                        ]}
                      />
                    </label>
                    <label className="settings-field">
                      <span>标签</span>
                      <input value={props.connectionSection.draft.tagsText} onChange={(event) => props.connectionSection.onChangeDraft({ tagsText: event.target.value })} placeholder="prod, web, jump" />
                    </label>
                    {/* 分组（2026-10-23 用户反馈「分组咋设置的…咋不能自定义」）：
                        可输入的下拉 —— 既能挑已有分组（导入的也在列表里），也能直接敲新路径。
                        用 "/" 表示层级；留空即「未分组」。
                        菜单用 portal 渲染到 body（同 ThemedSelect）：表单容器 .conn-detail-body
                        是 overflow-y:auto，行内绝对定位会被裁切。 */}
                    <div className="settings-field settings-field-span-2 conn-group-field" ref={groupFieldRef}>
                      <span>分组</span>
                      <div className="conn-group-input">
                        <input
                          value={props.connectionSection.draft.groupPathText}
                          onChange={(event) => {
                            props.connectionSection.onChangeDraft({ groupPathText: event.target.value });
                            if (!groupMenuOpen) openGroupMenu();
                          }}
                          onFocus={() => { if (!groupMenuOpen) openGroupMenu(); }}
                          placeholder="留空即未分组，用 / 分层：生产 / 华东"
                          spellCheck={false}
                        />
                        <button
                          type="button"
                          className="settings-secret-toggle"
                          onClick={() => (groupMenuOpen ? setGroupMenuOpen(false) : openGroupMenu())}
                          title={groupMenuOpen ? "收起已有分组" : "选择已有分组"}
                          aria-label={groupMenuOpen ? "收起已有分组" : "选择已有分组"}
                          aria-expanded={groupMenuOpen}
                        >
                          <ChevronDown size={13} strokeWidth={1.8} />
                        </button>
                      </div>
                      <span className="conn-group-hint">
                        {!draftGroupText.trim()
                          ? "留空 → 归入「未分组」"
                          : draftGroupAlreadyKnown
                            ? "复用已有分组"
                            : `将新建分组「${draftGroupText.trim()}」`}
                      </span>
                      {groupMenuOpen && groupMenuCoords ? createPortal(
                        <div className="conn-group-menu" role="listbox" style={{
                          position: "fixed",
                          left: `${groupMenuCoords.x}px`,
                          top: `${groupMenuCoords.y}px`,
                          width: `${groupMenuCoords.w}px`,
                          zIndex: 9800
                        }}>
                          {filteredGroupOptions.length ? (
                            filteredGroupOptions.map((name) => (
                              <button
                                key={name}
                                type="button"
                                role="option"
                                aria-selected={draftGroupText.trim() === name}
                                className={draftGroupText.trim() === name ? "conn-group-option conn-group-option-active" : "conn-group-option"}
                                onClick={() => {
                                  props.connectionSection.onChangeDraft({ groupPathText: name });
                                  setGroupMenuOpen(false);
                                }}
                              >
                                {name}
                              </button>
                            ))
                          ) : (
                            <span className="conn-group-empty">还没有已有分组，直接输入即可新建</span>
                          )}
                        </div>,
                        document.body
                      ) : null}
                    </div>
                    <div className="settings-field settings-field-span-2">
                      <span>密码</span>
                      {/* 小眼睛（2026-10-23 用户需求）：默认掩码，点击切换明文。
                          注意用 div 而非 label 包裹 —— label 会把内部按钮的点击
                          转发给被标记控件（造成焦点跳动）。 */}
                      <div className="settings-secret-field">
                        <input
                          type={passwordVisible ? "text" : "password"}
                          value={props.connectionSection.draft.password}
                          onChange={(event) => props.connectionSection.onChangeDraft({ password: event.target.value })}
                          placeholder="留空则不更新密码"
                          autoComplete="new-password"
                          spellCheck={false}
                        />
                        <button
                          type="button"
                          className="settings-secret-toggle"
                          onClick={() => setPasswordVisible((visible) => !visible)}
                          title={passwordVisible ? "隐藏密码" : "显示密码"}
                          aria-label={passwordVisible ? "隐藏密码" : "显示密码"}
                          aria-pressed={passwordVisible}
                        >
                          {passwordVisible ? <EyeOff size={13} strokeWidth={1.8} /> : <Eye size={13} strokeWidth={1.8} />}
                        </button>
                      </div>
                      {draftSecretHint ? (
                        <span className="conn-group-hint">{draftSecretHint}</span>
                      ) : null}
                    </div>
                    <div className="settings-field settings-field-span-2">
                      <span>私钥</span>
                      {/* 私钥原先直接明文可读；现默认掩码（类型切换由 CSS 的
                          -webkit-text-security 实现 —— textarea 不支持 type=password），
                          同样提供小眼睛切换。 */}
                      <div className={`settings-secret-field settings-secret-field-textarea${privateKeyVisible ? " is-revealed" : ""}`}>
                        <textarea
                          value={props.connectionSection.draft.privateKey}
                          onChange={(event) => props.connectionSection.onChangeDraft({ privateKey: event.target.value })}
                          placeholder="可直接粘贴私钥内容"
                          spellCheck={false}
                        />
                        <button
                          type="button"
                          className="settings-secret-toggle"
                          onClick={() => setPrivateKeyVisible((visible) => !visible)}
                          title={privateKeyVisible ? "隐藏私钥" : "显示私钥"}
                          aria-label={privateKeyVisible ? "隐藏私钥" : "显示私钥"}
                          aria-pressed={privateKeyVisible}
                        >
                          {privateKeyVisible ? <EyeOff size={13} strokeWidth={1.8} /> : <Eye size={13} strokeWidth={1.8} />}
                        </button>
                      </div>
                    </div>
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
                            <button className="ghost-button" type="button" title={activeListServer.source === "manual" ? "编辑连接" : "编辑连接（就地修改导入记录；重新导入时默认保留你的修改）"} onClick={() => {
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
                          <span><span className="settings-info-key">分组</span><span>{activeListServer.groupPath?.join(" / ") || "未分组"}</span></span>
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
                                <ThemedSelect value={props.currentServerSection.preferredBastionId} onChange={(value) => props.currentServerSection.onPreferredBastionChange(value)} ariaLabel="首选堡垒机"
                                  options={[
                                    { value: "", label: "自动尝试" },
                                    ...props.currentServerSection.availableBastions.map((server) => ({ value: server.id, label: `${server.name} · ${server.username}@${server.host}:${server.port}` }))
                                  ]}
                                />
                              </label>
                            ) : null}

                            {showJumpFields ? (
                              <div className="settings-form-grid settings-form-grid-single">
                                <label className="settings-field">
                                  <span>JumpServer 模式</span>
                                  <ThemedSelect value={props.currentServerSection.jumpMode} onChange={(value) => props.currentServerSection.onJumpModeChange(value as "auto" | "jumpserver-search")} ariaLabel="跳转模式"
                                    options={[
                                      { value: "auto", label: "自动推断" },
                                      { value: "jumpserver-search", label: "按关键字搜索资产" }
                                    ]}
                                  />
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
                          <span>分组：{activeListServer.groupPath?.join(" / ") || "未分组"}</span>
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
                    <span>点击清单顶部「＋ 新增」手动添加，或点「导入」从 FinalShell / Xshell 导入。</span>
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
      ) : props.activeView === "gateway" ? (
        <div className="gateway-view">
          <div className="conn-detail-head">
            <div>
              <h2>连接服务（Gateway）
                <span className={`chip ${serviceTone(props.localServiceState) === "success" ? "grn" : serviceTone(props.localServiceState) === "danger" ? "red" : ""}`}>
                  {props.localServiceStatusText}
                </span>
              </h2>
              <p>目录浏览、终端、传输都由 Gateway 代理执行。留空地址 = 使用本地服务（随桌面应用自动启动）。</p>
            </div>
          </div>
          <div className="gateway-stack">
            <section className="settings-card">
              <div className="settings-card-head">
                <div>
                  <span className="settings-card-kicker">当前生效地址</span>
                  <strong className="mono">{props.gatewaySection.effectiveBase}</strong>
                </div>
                <div className="settings-inline-actions">
                  <button className="ghost-button" type="button" onClick={props.gatewaySection.onTest}>测试连接</button>
                  <button className="ghost-button settings-primary-action" type="button" onClick={props.gatewaySection.onSave}>保存并重载</button>
                  <button className="ghost-button" type="button" onClick={props.gatewaySection.onReset}>恢复默认</button>
                </div>
              </div>
              <div className="settings-form-grid settings-form-grid-two">
                <label className="settings-field">
                  <span>Gateway 地址</span>
                  <input
                    value={props.gatewaySection.draftBaseUrl}
                    onChange={(event) => props.gatewaySection.onDraftBaseUrlChange(event.target.value)}
                    placeholder="http://localhost:4040（留空 = 默认本地服务）"
                  />
                </label>
                <label className="settings-field">
                  <span>访问令牌（可选）</span>
                  <input
                    type="password"
                    value={props.gatewaySection.draftToken}
                    onChange={(event) => props.gatewaySection.onDraftTokenChange(event.target.value)}
                    placeholder="远程服务启用鉴权时填写（Bearer Token）"
                  />
                </label>
              </div>
              {props.gatewaySection.testState ? (
                <div className="settings-meta-grid">
                  <span>测试结果：
                    <span className={props.gatewaySection.testState.tone === "success" ? "chip grn" : props.gatewaySection.testState.tone === "danger" ? "chip red" : "chip"}>
                      {props.gatewaySection.testState.text}
                    </span>
                  </span>
                </div>
              ) : null}
              <div className="settings-note-box">
                <strong>远程部署</strong>
                <span>局域网 IP / localhost 可用 http；公网地址必须 https（浏览器会拦截不安全的远程 WebSocket）。保存后页面会重载以重建全部连接。</span>
              </div>
            </section>
          </div>
        </div>
      ) : props.activeView === "security" ? (
        <SecuritySettingsView
          isElectron={props.isElectron}
          onStatus={(message) => props.onActionStatus?.(message)}
        />
      ) : props.activeView === "update" ? (
        <UpdateCenterPanel
          state={props.updateSection.state}
          checkLog={props.updateSection.checkLog}
          onCheck={props.updateSection.onCheck}
          onDownload={props.updateSection.onDownload}
          onInstall={props.updateSection.onInstall}
          showToast={props.updateSection.showToast}
        />
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
                  <span className="settings-pref-label"><strong>主题</strong><span>{props.preferenceSection.resolvedThemeName} · 强调色随主题；「跟随系统」在同族内切明暗</span></span>
                  <span className="settings-pref-value">
                    <span className="settings-tool-switcher">
                      {(["system", "light", "dark"] as UiToneMode[]).map((mode) => (
                        <button
                          key={mode}
                          type="button"
                          className={props.preferenceSection.uiToneMode === mode ? "settings-tool-chip settings-tool-chip-active" : "settings-tool-chip"}
                          onClick={() => props.preferenceSection.onUiToneModeChange(mode)}
                        >
                          {mode === "system" ? "跟随系统" : mode === "light" ? "浅色" : "深色"}
                        </button>
                      ))}
                    </span>
                  </span>
                </div>
                <div className="settings-pref-row settings-pref-row-wide">
                  <span className="settings-pref-label"><strong>强调色覆盖</strong><span>默认跟随主题；on-accent 黑白按对比度自动派生</span></span>
                  <span className="slc-accent-row">
                    <button
                      type="button"
                      className={props.preferenceSection.uiAccentOverride === null ? "csw csw-on" : "csw"}
                      title="跟随主题"
                      onClick={() => props.preferenceSection.onUiAccentOverrideChange(null)}
                    >
                      <i style={{ background: "color-mix(in srgb, var(--accent) 40%, transparent)" }} />
                    </button>
                    {ACCENT_OVERRIDES.map((accent) => (
                      <button
                        key={accent}
                        type="button"
                        className={props.preferenceSection.uiAccentOverride?.toLowerCase() === accent ? "csw csw-on" : "csw"}
                        style={{ color: accent }}
                        title={accent}
                        onClick={() => props.preferenceSection.onUiAccentOverrideChange(accent)}
                      >
                        <i style={{ background: accent }} />
                      </button>
                    ))}
                    <label className="settings-color-field slc-accent-custom">
                      <input
                        type="color"
                        value={props.preferenceSection.uiAccentOverride ?? "#0070f3"}
                        onChange={(event) => props.preferenceSection.onUiAccentOverrideChange(event.target.value)}
                      />
                    </label>
                  </span>
                </div>
                <div className="slc-appearance-cols">
                <div className="slc-appearance-main">
                <div className="slc-theme-grid" role="radiogroup" aria-label="内置主题">
                  {props.preferenceSection.themePresetOptions
                    .filter((preset) => props.preferenceSection.uiToneMode === "system" || preset.tone === props.preferenceSection.uiToneMode)
                    .map((preset) => {
                      const active = props.preferenceSection.resolvedThemeId === preset.id;
                      return (
                        <button
                          key={preset.id}
                          type="button"
                          role="radio"
                          aria-checked={active}
                          className={active ? "slc-theme-card slc-theme-card-active" : "slc-theme-card"}
                          title={preset.desc}
                          onClick={() => props.preferenceSection.onUiThemePresetChange(preset.id)}
                        >
                          <MiniThemeWindow preset={preset} />
                          <span className="slc-theme-name">
                            <b>{preset.name}</b>
                            <span className={preset.tone === "dark" ? "slc-tone slc-tone-dark" : "slc-tone"}>{preset.tone === "light" ? "浅" : "深"}</span>
                          </span>
                        </button>
                      );
                    })}
                </div>
                <div className="settings-pref-row settings-pref-row-wide">
                  <span className="settings-pref-label"><strong>工作区背景</strong><span>独立于主题的一层；非纯色下面板转半透明 + 毛玻璃</span></span>
                  <div className="slc-bg-chips" role="radiogroup" aria-label="工作区背景">
                    {props.preferenceSection.backgroundOptions.map((layer) => (
                      <button
                        key={layer.id}
                        type="button"
                        role="radio"
                        aria-checked={props.preferenceSection.uiBackground === layer.id}
                        title={layer.desc}
                        className={props.preferenceSection.uiBackground === layer.id ? "fchip fchip-on" : "fchip"}
                        onClick={() => props.preferenceSection.onUiBackgroundChange(layer.id)}
                      >
                        {layer.name}
                      </button>
                    ))}
                  </div>
                </div>
                {props.preferenceSection.uiBackground === "image" ? (
                  <div className="settings-pref-row settings-pref-row-wide settings-theme-customizer">
                    <div className="settings-theme-customizer-head">
                      <div>
                        <span>图片背景 · 磨砂</span>
                        <strong>遮罩与模糊实时生效</strong>
                      </div>
                    </div>
                    <div className="bg-image-sliders">
                      <label className="bg-slider-field">
                        <span>遮罩亮度</span>
                        <input
                          type="range"
                          min={0}
                          max={90}
                          value={props.preferenceSection.uiImgOverlay}
                          onChange={(event) => props.preferenceSection.onUiImgOverlayChange(Number(event.target.value))}
                        />
                        <code>{props.preferenceSection.uiImgOverlay}%</code>
                      </label>
                      <label className="bg-slider-field">
                        <span>背景模糊</span>
                        <input
                          type="range"
                          min={0}
                          max={24}
                          value={props.preferenceSection.uiImgBlur}
                          onChange={(event) => props.preferenceSection.onUiImgBlurChange(Number(event.target.value))}
                        />
                        <code>{props.preferenceSection.uiImgBlur}px</code>
                      </label>
                    </div>
                    <div className="settings-image-field settings-field-span-2">
                      <span>图片背景</span>
                      <div className="settings-image-picker-row">
                        <input
                          value={props.preferenceSection.customBackgroundImage}
                          onChange={(event) => props.preferenceSection.onCustomBackgroundImageChange(event.target.value)}
                          placeholder="本地图片 / file:// / https:// / data:image"
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
                  </div>
                ) : null}
                </div>
                <aside className="slc-appearance-preview">
                  {(() => {
                    const resolvedPreset =
                      props.preferenceSection.themePresetOptions.find((p) => p.id === props.preferenceSection.resolvedThemeId) ??
                      props.preferenceSection.themePresetOptions[0];
                    return (
                      <>
                        <div className="slc-pv-cap"><i />实时预览 · 主题与背景即时生效</div>
                        <AppearanceLivePreview
                          preset={resolvedPreset}
                          bgLayer={props.preferenceSection.uiBackground}
                          imgOverlay={props.preferenceSection.uiImgOverlay}
                          imgBlur={props.preferenceSection.uiImgBlur}
                          bgImage={props.preferenceSection.customBackgroundImage}
                        />
                      </>
                    );
                  })()}
                </aside>
                </div>
                <div className="settings-pref-row">
                  <span className="settings-pref-label"><strong>界面密度</strong><span>紧凑适合小屏</span></span>
                  <span className="settings-pref-value">
                    <span className="settings-tool-switcher">
                      <button type="button" className={props.preferenceSection.uiDensity === "compact" ? "settings-tool-chip settings-tool-chip-active" : "settings-tool-chip"} onClick={() => props.preferenceSection.onUiDensityChange("compact")}>紧凑</button>
                      <button type="button" className={props.preferenceSection.uiDensity === "comfortable" ? "settings-tool-chip settings-tool-chip-active" : "settings-tool-chip"} onClick={() => props.preferenceSection.onUiDensityChange("comfortable")}>舒展</button>
                    </span>
                  </span>
                </div>
                {/* 2026-10-21 精简：原「动效」+「动态背景」两行合并为一行 ——
                    动态背景本就是动效的子项（动效=减少时它被强制停用），
                    拆两行让设置项显得零碎。 */}
                <div className="settings-pref-row">
                  <span className="settings-pref-label">
                    <strong>动效</strong>
                    <span>低性能机器可选减少；动态背景（图片缓慢缩放）在「减少」时自动停用</span>
                  </span>
                  <span className="settings-pref-value">
                    <span className="seg lite">
                      <button type="button" className={props.preferenceSection.motionMode === "normal" ? "on" : ""} onClick={() => props.preferenceSection.onMotionModeChange("normal")}>标准</button>
                      <button type="button" className={props.preferenceSection.motionMode === "reduced" ? "on" : ""} onClick={() => props.preferenceSection.onMotionModeChange("reduced")}>减少</button>
                    </span>
                    <label className="slc-switch" title="动态背景：图片缓慢缩放">
                      <input
                        type="checkbox"
                        checked={props.preferenceSection.dynamicBackground}
                        onChange={props.preferenceSection.onToggleDynamicBackground}
                        disabled={props.preferenceSection.motionMode === "reduced"}
                        aria-label="动态背景"
                      />
                      <span />
                    </label>
                  </span>
                </div>
                {/* 2026-10-24 重设计：原「三处独立」矩阵拆散 —— 界面留本区，日志移入「日志」，
                    终端移入「终端」，每项设置与上下文同区（用户反馈跨分区维护体验割裂）。 */}
                <div className="settings-pref-row settings-pref-row-wide">
                  <span className="settings-pref-label"><strong>界面字体与字号</strong><span>日志 / 终端的字体字号在各自分区维护</span></span>
                  <div className="font-matrix">
                    <table className="font-matrix-table">
                      <tbody>
                        <tr>
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
                          <td>
                            <input
                              type="number"
                              min={12}
                              max={18}
                              value={props.preferenceSection.uiFontSize}
                              onChange={(event) => {
                                /* 空值保护：清空时 Number("")=0 会被钳到最小值并持久化 */
                                const raw = event.target.value;
                                if (raw === "") return;
                                const next = Number(raw);
                                if (!Number.isFinite(next)) return;
                                props.preferenceSection.onUiFontSizeChange(next);
                              }}
                              aria-label="界面字号"
                            />
                          </td>
                        </tr>
                      </tbody>
                    </table>
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
                        <label className="slc-switch">
                          <input
                            type="checkbox"
                            checked={props.preferenceSection.watermarkEnabled}
                            onChange={props.preferenceSection.onToggleWatermark}
                            aria-label="安全水印"
                          />
                          <span />
                        </label>
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
              <div className="settings-card-kicker">日志</div>
              <div className="settings-pref-card">
                {/* 2026-10-24 重设计：日志字体 / 字号从「外观 → 字体矩阵」移入本区（随上下文维护） */}
                <div className="settings-pref-row">
                  <span className="settings-pref-label"><strong>日志字体</strong><span>日志预览独立等宽字体</span></span>
                  <span className="settings-pref-value">
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
                  </span>
                </div>
                <div className="settings-pref-row">
                  <span className="settings-pref-label"><strong>日志字号</strong><span>11–16px</span></span>
                  <span className="settings-pref-value">
                    <input
                      type="number"
                      min={11}
                      max={16}
                      value={props.preferenceSection.logFontSize}
                      onChange={(event) => {
                        /* 空值保护：清空时 Number("")=0 会被钳到最小值并持久化 */
                        const raw = event.target.value;
                        if (raw === "") return;
                        const next = Number(raw);
                        if (!Number.isFinite(next)) return;
                        props.preferenceSection.onLogFontSizeChange(next);
                      }}
                      aria-label="日志预览字号"
                    />
                  </span>
                </div>
                <button type="button" className="settings-pref-row settings-pref-row-click" onClick={props.preferenceSection.onToggleErrorHighlight}>
                  <span className="settings-pref-label"><strong>异常 / 告警高亮</strong><span>自动标记 ERROR、WARN 行</span></span>
                  <span className="settings-pref-value">{props.preferenceSection.errorHighlightEnabled ? "开启" : "关闭"}</span>
                </button>
                <div className="settings-pref-row">
                  <span className="settings-pref-label"><strong>日志切片</strong><span>单次加载的日志字节数</span></span>
                  <span className="settings-pref-value">
                    <ThemedSelect
                      value={props.preferenceSection.sliceLengthMode === "auto" ? "auto" : String(props.preferenceSection.sliceLength)}
                      onChange={(value) => {
                        if (value === "auto") {
                          props.preferenceSection.onSliceLengthModeChange("auto");
                          return;
                        }
                        props.preferenceSection.onSliceLengthModeChange("manual");
                        props.preferenceSection.onSliceLengthChange(Number(value));
                      }}
                      ariaLabel="日志切片大小"
                      options={[
                        { value: "auto", label: "自动" },
                        { value: "32768", label: "32 KB" },
                        { value: "65536", label: "64 KB" },
                        { value: "131072", label: "128 KB" },
                        { value: "262144", label: "256 KB" }
                      ]}
                    />
                  </span>
                </div>
                {/* 2026-10-21 去重：原此处有「日志字号」下拉，与「外观 → 字体（三处独立）」
                    表格中的日志预览字号重复。字体矩阵是三处字体的统一入口，此处删除，
                    避免同一配置两处可改、用户分不清哪个生效。 */}
              </div>
            </section>

            <section id="pref-terminal" data-anchor className="settings-pref-section">
              <div className="settings-card-kicker">终端</div>
              <div className="slc-subtabs" role="tablist" aria-label="终端设置分类">
                {([
                  { id: "font", label: "字体" },
                  { id: "scheme", label: "配色与背景" },
                  { id: "cursor", label: "光标与细节" },
                ] as const).map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    role="tab"
                    aria-selected={terminalTab === tab.id}
                    className={terminalTab === tab.id ? "slc-subtab slc-subtab-active" : "slc-subtab"}
                    onClick={() => setTerminalTab(tab.id)}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
              <div className="settings-pref-card">
                {/* 2026-10-24 重设计：终端设置全部归位本区 —— 字体 / 字号从「外观 → 字体矩阵」
                    移入（与矩阵时代的去重决策相反：分散在各区更贴合上下文，原型已确认）。 */}
                {terminalTab === "font" ? (
                  <>
<div className="settings-pref-row">
                  <span className="settings-pref-label"><strong>终端字体</strong><span>等宽字体族；改动后 xterm 自动重排</span></span>
                  <span className="settings-pref-value">
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
                  </span>
                </div>
                <div className="settings-pref-row">
                  <span className="settings-pref-label"><strong>终端字号</strong><span>11–18px</span></span>
                  <span className="settings-pref-value">
                    <input
                      type="number"
                      min={11}
                      max={18}
                      value={props.preferenceSection.terminalFontSize}
                      onChange={(event) => {
                        /* 空值保护（2026-10-21）：清空输入框时 Number("")=0，
                           会被 setter 钳到最小值 11 并持久化 —— 用户反馈
                           「字号怎么是 11px、改不回来」正是此因。空串直接忽略。 */
                        const raw = event.target.value;
                        if (raw === "") return;
                        const next = Number(raw);
                        if (!Number.isFinite(next)) return;
                        props.preferenceSection.onTerminalFontSizeChange(next);
                      }}
                      aria-label="终端字号"
                    />
                  </span>
                </div>
                <div className="settings-pref-row">
                  <span className="settings-pref-label"><strong>终端选中复制</strong><span>选中即复制，右键粘贴</span></span>
                  <span className="settings-pref-value">默认开启</span>
                </div>
                {/* 终端外观（参考 VRC「控制台外观」）：行高 / 光标样式 / 光标闪烁。
                    此前三项在 useTerminalSession 中写死（1.8 / bar / true），设置中心
                    无入口；现改为可配，默认值与旧写死值一致，观感不变。 */}
                <div className="settings-pref-row">
                  <span className="settings-pref-label"><strong>行高</strong><span>影响每屏可见行数；改动后 xterm 自动重排</span></span>
                  <span className="settings-pref-value">
                    <span className="slc-stepper">
                      <button
                        type="button"
                        aria-label="减小行高"
                        disabled={props.preferenceSection.terminalLineHeight <= 1}
                        onClick={() => props.preferenceSection.onTerminalLineHeightChange(
                          Math.max(1, Math.round((props.preferenceSection.terminalLineHeight - 0.05) * 100) / 100)
                        )}
                      >−</button>
                      <output>{props.preferenceSection.terminalLineHeight.toFixed(2)}</output>
                      <button
                        type="button"
                        aria-label="增大行高"
                        disabled={props.preferenceSection.terminalLineHeight >= 2.4}
                        onClick={() => props.preferenceSection.onTerminalLineHeightChange(
                          Math.min(2.4, Math.round((props.preferenceSection.terminalLineHeight + 0.05) * 100) / 100)
                        )}
                      >＋</button>
                    </span>
                  </span>
                </div>
                                  </>
                ) : null}

                {terminalTab === "cursor" ? (
                  <>
<div className="settings-pref-row">
                  <span className="settings-pref-label"><strong>光标样式</strong><span>按终端使用习惯选择</span></span>
                  <span className="settings-pref-value">
                    <span className="seg lite" role="radiogroup" aria-label="终端光标样式">
                      {([
                        { id: "block", label: "块" },
                        { id: "bar", label: "竖线" },
                        { id: "underline", label: "下划线" }
                      ] as const).map((option) => (
                        <button
                          key={option.id}
                          type="button"
                          role="radio"
                          aria-checked={props.preferenceSection.terminalCursorStyle === option.id}
                          className={props.preferenceSection.terminalCursorStyle === option.id ? "on" : ""}
                          onClick={() => props.preferenceSection.onTerminalCursorStyleChange(option.id)}
                        >
                          {option.label}
                        </button>
                      ))}
                    </span>
                  </span>
                </div>
                <div className="settings-pref-row">
                  <span className="settings-pref-label"><strong>光标闪烁</strong><span>失去焦点后停止</span></span>
                  <span className="settings-pref-value">
                    <label className="slc-switch">
                      <input
                        type="checkbox"
                        checked={props.preferenceSection.terminalCursorBlink}
                        onChange={(event) => props.preferenceSection.onTerminalCursorBlinkChange(event.target.checked)}
                        aria-label="终端光标闪烁"
                      />
                      <span />
                    </label>
                  </span>
                </div>
                {/* 终端配色（2026-10-24 重设计）：「跟随主题」卡 + 7 深色方案，单控件定底色。
                    原独立「背景跟随主题」开关取消（迁移见 useUiTheme）；「日光」浅色方案移除
                    （与跟随主题架构冲突，深浅主题下均不可读）。 */}
                                  </>
                ) : null}

                {terminalTab === "scheme" ? (
<div className="settings-pref-row settings-pref-row-wide">
                  <span className="settings-pref-label"><strong>终端配色</strong><span>映射 xterm ITheme（前景/背景/光标/选区 + ANSI 16 色）</span></span>
                  <div className="slc-term-grid" role="radiogroup" aria-label="终端配色">
                    {(() => {
                      const consoleScheme = props.preferenceSection.terminalSchemeOptions.find((s) => s.id === "console") ?? props.preferenceSection.terminalSchemeOptions[0];
                      const followScheme: TerminalColorScheme = {
                        ...consoleScheme,
                        id: "follow",
                        name: "跟随主题",
                        desc: "底色随 UI 主题 · 推荐",
                        theme: {
                          ...consoleScheme.theme,
                          background: props.preferenceSection.terminalFollowPreview.background,
                          foreground: props.preferenceSection.terminalFollowPreview.foreground,
                          cursor: props.preferenceSection.terminalFollowPreview.cursor,
                          cursorAccent: props.preferenceSection.terminalFollowPreview.background,
                        },
                      };
                      const cards = [followScheme, ...props.preferenceSection.terminalSchemeOptions];
                      return cards.map((scheme) => {
                        const active = props.preferenceSection.uiTerminalScheme === scheme.id;
                        return (
                          <button
                            key={scheme.id}
                            type="button"
                            role="radio"
                            aria-checked={active}
                            title={scheme.desc}
                            className={active ? "slc-term-card slc-term-card-active" : "slc-term-card"}
                            onClick={() => props.preferenceSection.onUiTerminalSchemeChange(scheme.id)}
                          >
                            <TerminalPreview scheme={scheme} />
                            <span className="slc-term-name">
                              {scheme.name}
                              {scheme.id === "follow" ? <span className="slc-term-badge">推荐</span> : null}
                            </span>
                          </button>
                        );
                      });
                    })()}
                  </div>
                </div>
                ) : null}

                {/* 实时预览：配色 / 字体 / 字号 / 行高 / 光标 全部即时联动（对齐 VRC 控制台外观） */}
                <div className="settings-pref-row settings-pref-row-wide">
                  <span className="settings-pref-label"><strong>实时预览</strong><span>改动即时可见，无需重连会话</span></span>
                  <TerminalLivePreview
                    theme={(() => {
                      const fp = props.preferenceSection.terminalFollowPreview;
                      const scheme = props.preferenceSection.terminalSchemeOptions.find((s) => s.id === props.preferenceSection.uiTerminalScheme);
                      if (props.preferenceSection.uiTerminalScheme === "follow" || !scheme) {
                        return {
                          background: fp.background, foreground: fp.foreground, cursor: fp.cursor,
                          green: fp.green, red: fp.red, yellow: fp.yellow, cyan: fp.cyan, brightBlack: fp.brightBlack,
                        };
                      }
                      const t = scheme.theme;
                      return {
                        background: t.background, foreground: t.foreground, cursor: t.cursor,
                        green: t.green, red: t.red, yellow: t.yellow, cyan: t.cyan, brightBlack: t.brightBlack,
                      };
                    })()}
                    fontFamily={monoFontFamilyValue(props.preferenceSection.terminalFontFamily)}
                    fontSize={props.preferenceSection.terminalFontSize}
                    lineHeight={props.preferenceSection.terminalLineHeight}
                    cursorStyle={props.preferenceSection.terminalCursorStyle}
                    cursorBlink={props.preferenceSection.terminalCursorBlink}
                  />
                </div>

                {/* 背景纹理（2026-10-27）：默认 none。
                    纹理是背景层最低优先级 —— 只提供空间感，不与内容争注意力。
                    强度默认 55%，对应纹理线透明度约 3%（几乎无感）。 */}
                {terminalTab === "scheme" ? (
                <>
                {/* 背景图（2026-10-27）：纯 CSS 氛围光效，解决「清一色黑太单调」。
                    与纹理可叠加：光效在下、纹理线在上。默认 none 保持克制。 */}
                <div className="settings-pref-row settings-pref-row-wide">
                  <span className="settings-pref-label">
                    <strong>背景图</strong>
                    <span>纯 CSS 生成的氛围光效，与纹理可叠加</span>
                  </span>
                  <div className="slc-tex-grid" role="radiogroup" aria-label="终端背景图">
                    {TERMINAL_BACKDROPS.map((bd) => {
                      const active = props.preferenceSection.terminalBackdrop === bd.id;
                      return (
                        <button
                          key={bd.id}
                          type="button"
                          role="radio"
                          aria-checked={active}
                          title={bd.desc}
                          className={active ? "slc-tex-btn slc-tex-btn-active" : "slc-tex-btn"}
                          onClick={() => props.preferenceSection.onTerminalBackdropChange(bd.id)}
                        >
                          <span
                            className="slc-tex-preview"
                            style={{
                              backgroundColor: props.preferenceSection.terminalFollowPreview.background,
                              backgroundImage: bd.id === "none" ? "none" : buildBackdropBackground(bd.id, 100),
                            }}
                          />
                          <span className="slc-tex-name">{bd.name}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {props.preferenceSection.terminalBackdrop !== "none" ? (
                  <div className="settings-pref-row settings-pref-row-wide">
                    <span className="settings-pref-label">
                      <strong>背景图强度</strong>
                      <span>越高氛围越明显</span>
                    </span>
                    <span className="settings-pref-value" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <input
                        type="range"
                        min={0}
                        max={100}
                        step={5}
                        value={props.preferenceSection.terminalBackdropIntensity}
                        onChange={(event) => props.preferenceSection.onTerminalBackdropIntensityChange(Number(event.target.value))}
                        style={{ width: 120, accentColor: "var(--accent)" }}
                        aria-label="背景图强度"
                      />
                      <span style={{ minWidth: 34, textAlign: "right" }}>{props.preferenceSection.terminalBackdropIntensity}%</span>
                    </span>
                  </div>
                ) : null}

<div className="settings-pref-row settings-pref-row-wide">
                  <span className="settings-pref-label">
                    <strong>背景纹理</strong>
                    <span>终端背景的技术感纹理，默认关闭</span>
                  </span>
                  <div className="slc-tex-grid" role="radiogroup" aria-label="终端背景纹理">
                    {TERMINAL_TEXTURES.map((tex) => {
                      const active = props.preferenceSection.terminalTexture === tex.id;
                      return (
                        <button
                          key={tex.id}
                          type="button"
                          role="radio"
                          aria-checked={active}
                          title={tex.desc}
                          className={active ? "slc-tex-btn slc-tex-btn-active" : "slc-tex-btn"}
                          onClick={() => props.preferenceSection.onTerminalTextureChange(tex.id)}
                        >
                          <span
                            className="slc-tex-preview"
                            style={{
                              backgroundColor: props.preferenceSection.terminalFollowPreview.background,
                              ...(tex.id === "none"
                                ? {}
                                : { backgroundImage: buildTextureBackground(tex.id, 100).image }),
                              backgroundSize: tex.id === "none" ? "auto" : buildTextureBackground(tex.id, 100).size,
                            }}
                          />
                          <span className="slc-tex-name">{tex.name}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
                </>
                ) : null}

                {props.preferenceSection.terminalTexture !== "none" ? (
                  <div className="settings-pref-row settings-pref-row-wide">
                    <span className="settings-pref-label">
                      <strong>纹理强度</strong>
                      <span>越高越明显，建议不超过 70%</span>
                    </span>
                    <span className="settings-pref-value" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <input
                        type="range"
                        min={0}
                        max={100}
                        step={5}
                        value={props.preferenceSection.terminalTextureIntensity}
                        onChange={(event) => props.preferenceSection.onTerminalTextureIntensityChange(Number(event.target.value))}
                        style={{ width: 120, accentColor: "var(--accent)" }}
                        aria-label="纹理强度"
                      />
                      <span style={{ minWidth: 34, textAlign: "right" }}>{props.preferenceSection.terminalTextureIntensity}%</span>
                    </span>
                  </div>
                ) : null}
              </div>
            </section>

            <section id="pref-layout" data-anchor className="settings-pref-section">
              <div className="settings-card-kicker">界面与浮层</div>
              <div className="settings-pref-card">
                <button type="button" className="settings-pref-row settings-pref-row-click" onClick={props.preferenceSection.onToggleServerStatusAutoRefresh}>
                  <span className="settings-pref-label"><strong>服务器状态自动刷新</strong><span>状态面板定时采集</span></span>
                  <span className="settings-pref-value">{props.preferenceSection.serverStatusAutoRefresh ? `${Math.round(props.preferenceSection.serverStatusRefreshIntervalMs / 1000)}s` : "关闭"}</span>
                </button>
                {/* 「操作记录面板 / 操作记录高度」两项已删除（2026-10-25 用户决策）：
                    该面板已从侧栏彻底移除 —— 占高约 40% 挤压 27 台服务器列表、
                    内容与日志预览的调试面板重复、且多为开发期诊断信息（"系统已启动"
                    "已读取本地连接列表"）。面板没了，这两个开关/数值就是误导性配置
                    （打开也看不到东西）。操作反馈统一由 toast 承担。 */}
                {/* 2026-10-27 删除「路径历史浮层」「传输记录浮层」两项：
                   它们控制的是浮层"此刻开没开"（App 内 showPathHistory / showTransferHistory
                   的瞬时 state），不是持久化偏好；且二者互斥（开一个会关另一个），
                   退出设置页即回到关闭态，表现为"点了没反应 / 状态不记录"。
                   真正的入口在文件浏览器工具栏「更多」菜单里（最近访问的目录 / 传输记录），
                   功能重复。偏好设置里保留的项才是真正落盘的配置。 */}
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
