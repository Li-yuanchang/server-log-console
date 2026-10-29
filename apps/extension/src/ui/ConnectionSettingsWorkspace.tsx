import { useEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, ChevronLeft, Eye, EyeOff, MoreHorizontal, Terminal, Trash2 } from "lucide-react";
import type { JumpServerAssetOption, LogProfile, ServerConnectionKind, ServerCredentialStatus, ServerSummary } from "@server-log-console/shared";
import { looksLikeJumpServer } from "./terminal-utils.js";
import { readDirectoryHistory } from "./storage.js";
import { apiGetCredentialSecret, apiTestConnection, apiTestDraftConnection } from "./api.js";
import { ThemedSelect } from "./ThemedSelect.js";
import { TERMINAL_TEXTURES, TERMINAL_BACKDROPS, TERMINAL_LOOK_PRESETS, buildTextureBackground, buildBackdropBackground, buildBackdropPreview, type TerminalBackdrop, type TerminalTexture } from "./semantic-tokens.js";
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
    terminalBackdrop: TerminalBackdrop;
    terminalBackdropIntensity: number;
    onTerminalBackdropChange: (value: TerminalBackdrop) => void;
    onTerminalBackdropIntensityChange: (value: number) => void;
    /** 一键套用外观组合预设（同时改配色/背景图/纹理/强度） */
    onApplyLookPreset: (presetId: string) => void;
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

/* 偏好设置分区（2026-10-28 重组，对齐 docs/prototypes/settings-restructure-2026-10.html）
   原 5 区：外观(7) / 日志(4) / 终端(13) / 界面与浮层(1) / 高级(1)
   现 4 区：外观(6) / 阅读(4) / 终端(13) / 其它(2)
   理由：
   · 「界面与浮层」只有 1 项（服务器状态刷新），单独占一栏让用户以为坏了 → 并入「其它」
   · 「日志」与「界面字体字号」本质都是「看内容的排版」→ 合为「阅读」
   · 终端 13 项占全部选项的一半，改为「预设优先 + 分组」三层结构
   注：id 保持 pref-log / pref-layout 不变，避免老用户的锚点书签失效；
       只改 label 与渲染归属。 */
const PREF_ANCHORS = [
  { id: "pref-appearance", label: "外观" },
  { id: "pref-log", label: "阅读" },
  { id: "pref-terminal", label: "终端" },
  { id: "pref-advanced", label: "其它" },
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
/** 终端配色缩略卡（2026-10-28 重做）。
 *
 * 为什么要改：旧版只画 6 行模拟文字（绿提示符 + 红 ERROR + 黄 WARN），
 * 一套配色的 16 色里只能看到 3–4 种。13 套配色并排时人眼分辨不出差别，
 * 用户反馈「看着都一样、显得乱」。
 *
 * 新做法对齐 iTerm2-Color-Schemes 的测试卡思路：
 * 把 ANSI 16 色整排铺开（上排 0–7 标准色、下排 8–15 高亮色），
 * 下面保留一行短模拟文字维持「这是一台终端」的语境。
 * 信息密度从 3 色提升到 16 色，不用点开就能对比。 */
function TerminalPreview({ scheme }: { scheme: TerminalColorScheme }) {
  const t = scheme.theme;
  /* ANSI 0–15：normal(0-7) + bright(8-15)，与 xterm ITheme 字段一一对应 */
  const ansi = [
    t.black, t.red, t.green, t.yellow, t.blue, t.magenta, t.cyan, t.white,
    t.brightBlack, t.brightRed, t.brightGreen, t.brightYellow,
    t.brightBlue, t.brightMagenta, t.brightCyan, t.brightWhite
  ];
  return (
    <span className="slc-term-preview" style={{ background: t.background, color: t.foreground }}>
      <span className="slc-term-swatches" aria-hidden="true">
        {ansi.map((c, i) => (
          <i key={i} style={{ background: c }} />
        ))}
      </span>
      <span className="slc-term-line">
        <span style={{ color: t.green }}>root@127.38</span> <span style={{ color: t.red }}>ERROR</span>
        <span style={{ color: t.yellow }}>WARN</span>
        <span className="cursor" style={{ background: t.cursor }} />
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
  /** 2026-10-27：预览必须能看到纹理与背景图，否则「改了背景但预览没反应」 */
  backgroundImage?: string;
  backgroundSize?: string;
}) {
  const { theme, fontFamily, fontSize, lineHeight, cursorStyle, cursorBlink, backgroundImage, backgroundSize } = props;
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
        style={{
          backgroundColor: theme.background,
          backgroundImage: backgroundImage && backgroundImage !== "none" ? backgroundImage : undefined,
          backgroundSize: backgroundSize || undefined,
          color: theme.foreground, fontFamily, fontSize, lineHeight
        }}
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
  /* 2026-10-28：点击锚点后短暂锁定 currentAnchor。
     否则 smooth 滚动过程中 onScroll 一路触发，把 currentAnchor 覆盖回
     滚动经过的中间分区（点「阅读」时会先经过「外观」，预览就闪回界面预览）。 */
  const anchorLockRef = useRef<string | null>(null);
  /* 滚动锁定的定时器句柄（重复点击时先清旧的，避免旧定时器提前解锁） */
  const scrollLockTimerRef = useRef<number | null>(null);
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
    if (anchorLockRef.current) {
      const locked = container.querySelector<HTMLElement>('#' + anchorLockRef.current);
      if (locked) {
        const lr = locked.getBoundingClientRect();
        const br = container.getBoundingClientRect();
        if (Math.abs(lr.top - br.top) > 24) return;
      }
      anchorLockRef.current = null;
      if (scrollLockTimerRef.current !== null) {
        window.clearTimeout(scrollLockTimerRef.current);
        scrollLockTimerRef.current = null;
      }
    }

    /* 2026-10-28 第三次修正（用户反馈「在终端区却显示日志预览，露一点就切」）。
       演进过程记录，避免以后又改回去：
       ① 旧版 "offsetTop - scrollTop <= 64" —— 只要下面分区标题露头就切，太敏感；
       ② 上一版「交叉面积最大」—— 解决了敏感性，但「阅读」区只有 217px 高，
          滚到它时可视区里大部分仍是终端区，按面积算会误判成终端。
       最终方案：**顶部归属法** —— 取「视口顶部往下 1/3 处」落在哪个分区。
       理由：用户判断「我在哪一区」看的是屏幕上方内容，不是面积占比。
       这样短分区（阅读 217px）滚到位后也能正确归属，长分区（终端 1400px）滚动中
       也不会被下一个分区抢走，除非它真的进入屏幕上半部分。 */
    const box = container.getBoundingClientRect();
    const probeY = box.top + Math.min(160, box.height * 0.33);   /* 探针：顶部往下 1/3 */
    const sections = Array.from(container.querySelectorAll<HTMLElement>("[data-anchor]"));
    if (sections.length === 0) return;

    let hit = sections[0].id;
    for (const section of sections) {
      const r = section.getBoundingClientRect();
      /* 探针落在该分区范围内 → 就是它 */
      if (r.top <= probeY && r.bottom > probeY) { hit = section.id; break; }
      /* 探针在分区上方（还没滚到）→ 取上一个 */
      if (r.top > probeY) break;
    }
    /* 底部兜底：已经滚到最底时，最后一个分区内容不足一屏也要能选中 */
    const atBottom = container.scrollTop + container.clientHeight >= container.scrollHeight - 4;
    if (atBottom) hit = sections[sections.length - 1].id;

    setCurrentAnchor(hit);
  };

  const scrollToAnchor = (anchorId: string) => {
    const container = prefScrollRef.current;
    const target = container?.querySelector<HTMLElement>(`#${anchorId}`);
    if (container && target) {
      /* 2026-10-28 修复「点 04 其它却停在终端区」：
         原来用 target.offsetTop —— 它相对的是「最近的定位祖先」，
         而设置页里有多层 position:relative 容器，offsetTop 会明显偏小/偏大，
         导致滚动落点错位（点「其它」实测滚到终端中间）。
         改用 getBoundingClientRect 差值算出相对滚动容器的真实偏移。 */
      const cRect = container.getBoundingClientRect();
      const tRect = target.getBoundingClientRect();
      const top = Math.max(0, tRect.top - cRect.top + container.scrollTop - 8);
      /* 2026-10-28 关键修复：behavior:"smooth" 在本项目的 Electron 环境里
         实测完全无效（scrollTo 后 scrollTop 恒为 0，3.2s 内一步没动）——
         用户系统开了「减少动效」时会走到这个分支。
         改为直接赋值 scrollTop（同步生效、不依赖动画），
         并用 prefers-reduced-motion 判断是否要平滑：
         想平滑时用 requestAnimationFrame 自己做，避免依赖浏览器实现。 */
      const prefersReduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
      if (prefersReduced) {
        container.scrollTop = top;
      } else {
        const from = container.scrollTop;
        const delta = top - from;
        if (Math.abs(delta) < 2) {
          container.scrollTop = top;
        } else {
          const DURATION = 260;
          const t0 = performance.now();
          const step = (now: number) => {
            const p = Math.min(1, (now - t0) / DURATION);
            /* easeOutCubic */
            const e = 1 - Math.pow(1 - p, 3);
            container.scrollTop = from + delta * e;
            if (p < 1) requestAnimationFrame(step);
            else container.scrollTop = top;   /* 收尾对齐，避免浮点误差 */
          };
          requestAnimationFrame(step);
        }
      }
    }
    setCurrentAnchor(anchorId);
    /* 锁定期：覆盖平滑滚动的整个过程。长页面滚到底需要 1s+，
       原来 700ms 不够，松手后 onScroll 会把状态改回中间分区。 */
    anchorLockRef.current = anchorId;
    window.clearTimeout((scrollLockTimerRef.current ?? 0));
    scrollLockTimerRef.current = window.setTimeout(() => {
      anchorLockRef.current = null;
      scrollLockTimerRef.current = null;
    }, 1200);
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
    <>
    <div className="settings-card-kicker">连接凭证</div>
    <section className="settings-card conn-credential-card">
      <div className="settings-card-head">
        <div>
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
    </>
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
        {/* 2026-10-28 二级菜单（用户要求「改为编号的二级菜单，不要单独显示了，占空间」）：
            原来偏好设置内部还有一列独立的锚点导航（.settings-pref-anchor，宽 116px），
            等于「一级导航 + 二级锚点」两层并列，右侧内容区被挤窄。
            现在改成：一级导航下直接展开 01–04 编号子项，锚点列删除，内容区占满宽度。 */}
        {props.activeView === "preferences" ? (
          <div className="settings-rail-sub" role="tablist" aria-label="偏好设置分类">
            {PREF_ANCHORS.map((anchor, i) => (
              <button
                key={anchor.id}
                type="button"
                role="tab"
                aria-selected={currentAnchor === anchor.id}
                className={currentAnchor === anchor.id ? "settings-rail-subitem settings-rail-subitem-active" : "settings-rail-subitem"}
                onClick={() => scrollToAnchor(anchor.id)}
              >
                <span className="settings-rail-subno">{String(i + 1).padStart(2, "0")}</span>
                {anchor.label}
              </button>
            ))}
          </div>
        ) : null}
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
                      <div className="settings-card-kicker">连接信息</div>
                      <section className="settings-card">
                        <div className="settings-card-head">
                          <strong>{activeListServer.name}</strong>
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
                      <div className="settings-card-kicker">连接入口</div>
                      <section className="settings-card conn-entry-card">
                        {canConfigureRoute ? (
                          <>
                            <div className="settings-card-head">
                              <strong>入口账号与 JumpServer 规则</strong>
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
                              {/* 2026-10-28：外层已有 .settings-card-kicker「连接入口」，
                                  这里不再重复，只保留状态描述与展开提示。 */}
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
                      <div className="settings-card-kicker">连接信息</div>
                      <section className="settings-card">
                        <div className="settings-card-head">
                          <strong>{activeListServer.name}</strong>
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
                        <div className="conn-kv-grid">
                          <div className="conn-kv"><span className="k">来源</span><span className="v">{sourceLabel(activeListServer.source)}</span></div>
                          <div className="conn-kv"><span className="k">类型</span><span className="v">{connectionKindLabel(activeListServer.connectionKind)}</span></div>
                          <div className="conn-kv"><span className="k">主机</span><span className="v">{activeListServer.host}</span></div>
                          <div className="conn-kv"><span className="k">端口</span><span className="v">{activeListServer.port}</span></div>
                          <div className="conn-kv"><span className="k">用户名</span><span className="v">{activeListServer.username}</span></div>
                          <div className="conn-kv"><span className="k">分组</span><span className="v">{activeListServer.groupPath?.join(" / ") || "未分组"}</span></div>
                          <div className="conn-kv"><span className="k">日志目录</span><span className="v">{activeListServer.basePath || "/"}</span></div>
                          <div className="conn-kv"><span className="k">认证</span><span className="v">{activeListServer.authType === "privateKey" ? "私钥" : activeListServer.authType === "password" ? "密码" : "未配置"}</span></div>
                          <div className="conn-kv conn-kv-wide"><span className="k">说明</span><span className="v">{activeListServer.connectionHint || "--"}</span></div>
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
                <div className="slc-theme-pills" role="radiogroup" aria-label="内置主题">
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
                          className={active ? "slc-theme-pill slc-theme-pill-active" : "slc-theme-pill"}
                          title={preset.desc}
                          onClick={() => props.preferenceSection.onUiThemePresetChange(preset.id)}
                        >
                          {/* 胶囊：左侧三色圆点（底/面板/强调），右侧名字。
                              2026-10-28 用户要求「改为原型里胶囊形状的选择样式」——
                              原大卡片占 284px，胶囊约 44px，且 10 套仍一眼看全。 */}
                          <span className="slc-theme-pill-dot" aria-hidden="true">
                            <i style={{ background: preset.v.bg }} />
                            <i style={{ background: preset.v.panel }} />
                            <i style={{ background: preset.v.accent }} />
                          </span>
                          <span className="slc-theme-pill-name">{preset.name}</span>
                          <span className={preset.tone === "dark" ? "slc-tone slc-tone-dark" : "slc-tone"}>
                            {preset.tone === "light" ? "浅" : "深"}
                          </span>
                        </button>
                      );
                    })}
                </div>
                <div className="settings-pref-row">
                  <span className="settings-pref-label"><strong>工作区背景</strong><span>独立于主题的一层；非纯色下面板转半透明 + 毛玻璃</span></span>
                  {/* 2026-10-28 重做（对齐 ZCode / WorkBuddy 的外观页）：
                      原来是 8 个 chip 平铺，实测占 364px（整个外观分区的 40%）。
                      它只是「选一种背景」，用一行下拉就够 —— 改成 ThemedSelect，
                      高度从 364px 降到 46px，且不改变任何能力。 */}
                  <span className="settings-pref-value">
                    <ThemedSelect
                      value={props.preferenceSection.uiBackground}
                      onChange={(value) => props.preferenceSection.onUiBackgroundChange(value)}
                      ariaLabel="工作区背景"
                      options={props.preferenceSection.backgroundOptions.map((layer) => ({
                        value: layer.id,
                        label: layer.name
                      }))}
                    />
                  </span>
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
                {/* 2026-10-28 改为左右布局（用户反馈「其他设置项都是左右布局，
                    就界面字体与字号不是」）：原来用 .font-matrix 表格把两个控件分成
                    固定宽度的两列（190px / 150px），中间空一大截，与全站
                    「左标签 + 右控件」的行式布局不一致。
                    现在直接放进 .settings-pref-value（inline-flex），与「界面密度」等行同构。 */}
                <div className="settings-pref-row">
                  <span className="settings-pref-label"><strong>界面字体与字号</strong><span>日志 / 终端的字体字号在各自分区维护</span></span>
                  <span className="settings-pref-value">
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
                      className="settings-inline-number"
                    />
                  </span>
                </div>
              </div>

                {/* 2026-10-28 重做：低频项折叠（对齐 ZCode / WorkBuddy 的外观页）。
                    「强调色覆盖」「水印」都是偶尔才调一次的设置，原先平铺在首屏，
                    合计占 240px+，把真正常用的主题/背景/密度挤下去。
                    现在收进原生 <details>，默认收起，需要时再展开 —— 不引入额外状态。 */}
                <details className="settings-pref-advanced">
                  <summary>
                    <span>高级外观</span>
                    <span className="settings-pref-advanced-hint">强调色覆盖 · 水印</span>
                  </summary>
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
                </details>
            </section>

            <section id="pref-log" data-anchor className="settings-pref-section">
              <div className="settings-card-kicker">阅读</div>
              <div className="settings-pref-card">
                {/* 2026-10-24 重设计：日志字体 / 字号从「外观 → 字体矩阵」移入本区（随上下文维护） */}
                <div className="settings-pref-row">
                  <span className="settings-pref-label"><strong>正文字体</strong><span>日志与文件内容共用等宽字体</span></span>
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
                  <span className="settings-pref-label"><strong>正文字号</strong><span>11–16px</span></span>
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
              <div className="settings-pref-card">
                {/* 2026-10-24 重设计：终端设置全部归位本区 —— 字体 / 字号从「外观 → 字体矩阵」
                    移入（与矩阵时代的去重决策相反：分散在各区更贴合上下文，原型已确认）。 */}
                {/* 快速搭配（2026-10-27）：用户反馈自由组合（如极光+方格）容易踩坑。
                    这里给经过搭配的 6 套组合，一键同时设定配色/背景图/纹理，
                    下面的单项控件仍可继续微调。 */}
                <div className="settings-pref-row settings-pref-row-wide">
                  <span className="settings-pref-label">
                    <strong>快速搭配</strong>
                    <span>经过搭配的组合，避免背景图与纹理互相干扰</span>
                  </span>
                  <div className="slc-look-grid" role="group" aria-label="外观组合预设">
                    {TERMINAL_LOOK_PRESETS.map((preset) => (
                      <button
                        key={preset.id}
                        type="button"
                        title={preset.desc}
                        className="slc-look-btn"
                        onClick={() => props.preferenceSection.onApplyLookPreset(preset.id)}
                      >
                        <span
                          className="slc-look-pv"
                          style={{
                            /* 2026-10-28 修正：底色必须取「该预设自己的配色」，
                               不能一律用 follow 预览色 —— 否则 6 张缩略图底色全是同一个色，
                               看不出每套组合的配色差异（用户反馈「预览都一个样」）。 */
                            backgroundColor:
                              props.preferenceSection.terminalSchemeOptions.find((x) => x.id === preset.scheme)
                                ?.theme.background ?? props.preferenceSection.terminalFollowPreview.background,
                            backgroundImage: (() => {
                              const bd = preset.backdrop === "none" ? "none" : buildBackdropPreview(preset.backdrop);
                              const tex = preset.texture === "none"
                                ? "none"
                                : buildTextureBackground(preset.texture, preset.textureIntensity).image
                                    .replace(/32px/g, "14px").replace(/160px/g, "42px");
                              if (bd !== "none" && tex !== "none") return `${tex}, ${bd}`;
                              return bd !== "none" ? bd : tex;
                            })(),
                            /* 图片类背景必须 cover 才有意义（auto 会按原图 1600px 平铺，
                               缩略图里只剩一小块暗角，看着像没设）。 */
                            backgroundSize:
                              preset.texture !== "none"
                                ? "cover, cover"
                                : preset.backdrop === "none"
                                  ? "auto"
                                  : "cover",
                          }}
                        />
                        <span className="slc-look-name">{preset.name}</span>
                      </button>
                    ))}
                  </div>
                </div>
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

<div className="settings-pref-row">
                  <span className="settings-pref-label"><strong>终端配色</strong><span>映射 xterm ITheme（前景/背景/光标/选区 + ANSI 16 色）</span></span>
                  <span className="settings-pref-value">
                    {/* 2026-10-28 用户反馈「14 张配色卡占满一屏太占地方」→ 改为下拉。
                        下拉项内嵌 16 色小色条，既省空间又保留「一眼看出配色差异」能力。 */}
                    <ThemedSelect
                      value={props.preferenceSection.uiTerminalScheme}
                      onChange={(value) => props.preferenceSection.onUiTerminalSchemeChange(value as TerminalColorSchemeId)}
                      ariaLabel="终端配色"
                      options={(() => {
                        const consoleScheme = props.preferenceSection.terminalSchemeOptions.find((x) => x.id === "console") ?? props.preferenceSection.terminalSchemeOptions[0];
                        const followTheme = {
                          ...consoleScheme.theme,
                          background: props.preferenceSection.terminalFollowPreview.background,
                          foreground: props.preferenceSection.terminalFollowPreview.foreground,
                          cursor: props.preferenceSection.terminalFollowPreview.cursor,
                          cursorAccent: props.preferenceSection.terminalFollowPreview.background,
                        };
                        const rows: Array<{ id: string; name: string; t: typeof consoleScheme.theme }> = [
                          { id: "follow", name: "跟随主题（推荐）", t: followTheme },
                          ...props.preferenceSection.terminalSchemeOptions.map((x) => ({ id: x.id, name: x.name, t: x.theme }))
                        ];
                        return rows.map((r) => ({
                          value: r.id,
                          label: (
                            <span className="slc-scheme-opt">
                              <span className="slc-scheme-bars" aria-hidden="true">
                                {[r.t.black, r.t.red, r.t.green, r.t.yellow, r.t.blue, r.t.magenta, r.t.cyan, r.t.white].map((c, i2) => (
                                  <i key={i2} style={{ background: c }} />
                                ))}
                              </span>
                              <span className="slc-scheme-name">{r.name}</span>
                            </span>
                          )
                        }));
                      })()}
                    />
                  </span>
                </div>

                {/* 2026-10-28 移除原「实时预览」设置行：
                    它和右侧常驻的分区预览（PrefSectionPreview）功能重复 ——
                    设置页里同时出现两套终端预览，界面又长又乱（用户反馈）。
                    实时预览本身没错，但它不该占一个「设置项」的位置；
                    现在由右侧面板承担，且切换任何分区都能看到。
                    原实现（TerminalLivePreview）保留给别的用途，只删这里的一行入口。 */}
                {/* 背景纹理（2026-10-27）：默认 none。
                    纹理是背景层最低优先级 —— 只提供空间感，不与内容争注意力。
                    强度默认 55%，对应纹理线透明度约 3%（几乎无感）。 */}

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
                              /* 2026-10-28 缩略图底色修正（用户反馈「红圈内三个看不出区别」）：
                                 原来直接用 terminalFollowPreview.background（可能是 #0a0a0a 近黑），
                                 深色低饱和的预设在上面几乎不可辨。
                                 现在用固定 #171a1e（比纯黑亮 8 级）：足够衬托暗色光效，
                                 又不至于亮到失真 —— 缩略图是「辨识用」，不是「还原终端」。 */
                              backgroundColor: "#2e343a",
                              backgroundImage: bd.id === "none" ? "none" : buildBackdropPreview(bd.id),
                              backgroundSize: "cover",
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
                              /* 2026-10-28 同背景图：固定 #171a1e 而非近黑主题色，
                                 否则纹理线在缩略图里完全看不见（用户反馈「远看没纹路」）。 */
                              backgroundColor: "#2e343a",
                              /* 缩略图示意：实际间距 32px 在 44px 高的预览里只能显示 1 格，
                                 这里按 1/2 缩放展示图案特征（方格/点阵的密度观感），
                                 真实终端里是 32px。 */
                              ...(tex.id === "none"
                                ? {}
                                : {
                                    /* 2026-10-29 缩略图专用增亮：buildTextureBackground 的 alpha 上限
                                       0.14 是给真实终端用的（须若隐若现）。缩略图仅 44px 高，
                                       14% 的线几乎不可见 —— 缩略图目的是「辨识」而非「还原」。
                                       这里改成自建高浓度版本，仅作用于缩略图。 */
                                    backgroundImage: buildTextureThumbImage(tex.id)
                                  }),
                              backgroundSize: tex.id === "none"
                                ? "auto"
                                : buildTextureBackground(tex.id, 100).size
                                    .replace(/32px/g, "14px")
                                    .replace(/160px/g, "42px"),
                            }}
                          />
                          <span className="slc-tex-name">{tex.name}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>

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



            <section id="pref-advanced" data-anchor className="settings-pref-section">
              <div className="settings-card-kicker">其它</div>
              <div className="settings-pref-card">
                {/* 2026-10-28 由原「界面与浮层」分区并入 —— 该分区只有这 1 项，
                    单独占一栏会让用户以为这一栏坏了。 */}
                <button type="button" className="settings-pref-row settings-pref-row-click" onClick={props.preferenceSection.onToggleServerStatusAutoRefresh}>
                  <span className="settings-pref-label"><strong>服务器状态自动刷新</strong><span>状态面板定时采集</span></span>
                  <span className="settings-pref-value">{props.preferenceSection.serverStatusRefreshIntervalMs > 0 ? `${Math.round(props.preferenceSection.serverStatusRefreshIntervalMs / 1000)}s` : "关闭"}</span>
                </button>
                <button type="button" className="settings-pref-row settings-pref-row-click settings-pref-reset" onClick={props.preferenceSection.onResetUiPreferences}>
                  <span className="settings-pref-label"><strong>恢复默认显示</strong><span>重置主题、背景、字号等显示偏好</span></span>
                  <span className="settings-pref-value">重置</span>
                </button>
              </div>
            </section>
          </div>
          <FloatingPrefPreview
            section={currentAnchor}
            themeName={props.preferenceSection.resolvedThemeName}
            logFontFamily={monoFontFamilyValue(props.preferenceSection.logFontFamily)}
            logFontSize={props.preferenceSection.logFontSize}
            logHighlight={props.preferenceSection.errorHighlightEnabled}
            /* 2026-10-28 修复「选了终端配色但预览没变化」：
               原来一律取 terminalFollowPreview（那是「跟随主题」的色），
               选 Dracula / Nord 等具体方案时预览纹丝不动。
               现在：follow 或找不到方案 → 用 followPreview；
               否则取该方案自己的 theme（与真实 xterm 完全同源）。 */
            terminalBg={(() => {
              const id = props.preferenceSection.uiTerminalScheme;
              if (id === "follow") return props.preferenceSection.terminalFollowPreview.background;
              const found = props.preferenceSection.terminalSchemeOptions.find((x) => x.id === id);
              return found ? found.theme.background : props.preferenceSection.terminalFollowPreview.background;
            })()}
            terminalFg={(() => {
              const id = props.preferenceSection.uiTerminalScheme;
              if (id === "follow") return props.preferenceSection.terminalFollowPreview.foreground;
              const found = props.preferenceSection.terminalSchemeOptions.find((x) => x.id === id);
              return found ? found.theme.foreground : props.preferenceSection.terminalFollowPreview.foreground;
            })()}
            terminalBackgroundImage={
              props.preferenceSection.terminalBackdrop === "none"
                ? "none"
                : buildBackdropBackground(
                    props.preferenceSection.terminalBackdrop,
                    props.preferenceSection.terminalBackdropIntensity
                  )
            }
            terminalBackgroundSize="cover"
            terminalFontFamily={monoFontFamilyValue(props.preferenceSection.terminalFontFamily)}
            terminalFontSize={props.preferenceSection.terminalFontSize}
            terminalLineHeight={props.preferenceSection.terminalLineHeight}
            terminalCursorStyle={props.preferenceSection.terminalCursorStyle}
            terminalCursorBlink={props.preferenceSection.terminalCursorBlink}
            refreshLabel={
              props.preferenceSection.serverStatusRefreshIntervalMs > 0
                ? Math.round(props.preferenceSection.serverStatusRefreshIntervalMs / 1000) + "s"
                : "关闭"
            }
          />
          </div>
        </div>
      )}
    </section>
  );
}

/* ============================================================
   偏好设置 · 右侧分区预览（2026-10-28 新增，对齐原型）
   ------------------------------------------------------------
   为什么加：设置项分散在 4 个分区，用户改完「主题 / 字号 / 配色」后
   要到真实终端里才能看到效果，来回切换成本高。
   这里给每个分区配一个对应的预览：
     · 外观 → 界面预览（侧栏 + 卡片 + 按钮，跟随当前主题色）
     · 阅读 → 日志预览（跟随日志字体 / 字号 + ERROR/WARN 高亮）
     · 终端 → 终端预览（配色 + 背景图 + 字体 + 光标，真实联动）
     · 其它 → 连接状态（CPU / 内存 / 磁盘 + 刷新间隔）
   注意：静态示意，不是真实 xterm 实例 —— 只渲染光学效果，
   够轻、无会话依赖（与既有 TerminalLivePreview 同一思路）。
   ============================================================ */
function PrefSectionPreview(props: {
  section: string;
  themeName: string;
  logFontFamily: string;
  logFontSize: number;
  logHighlight: boolean;
  terminalBg: string;
  terminalFg: string;
  terminalBackgroundImage: string;
  terminalBackgroundSize: string;
  terminalFontFamily: string;
  terminalFontSize: number;
  terminalLineHeight: number;
  terminalCursorStyle: string;
  terminalCursorBlink: boolean;
  refreshLabel: string;
  /** 嵌入浮层时不再渲染外层 aside 外壳（只输出内容） */
  embedded?: boolean;
}) {
  const title =
    props.section === "pref-appearance" ? "界面预览"
      : props.section === "pref-log" ? "日志预览"
        : props.section === "pref-terminal" ? "终端预览"
          : "连接状态";

  const px = (n: number) => n + "px";

  const body = (
      <div className={props.embedded ? "settings-pref-preview-body settings-pref-preview-body-embedded" : "settings-pref-preview-body"}>
        {props.section === "pref-log" ? (
          <div
            className="slc-pref-logpv"
            style={{ fontSize: px(props.logFontSize), fontFamily: props.logFontFamily }}
          >
            <div className="slc-pref-logpv-hd">
              <span>error.log</span>
              <span>{props.logFontSize}px</span>
            </div>
            <div className="slc-pref-logpv-body">
              <div>
                <span className="d">09:41:22.310</span>{" "}
                <span className={props.logHighlight ? "e" : ""}>ERROR</span> timeout calling payment-gateway
              </div>
              <div>
                <span className="d">09:41:23.004</span>{" "}
                <span className={props.logHighlight ? "w" : ""}>WARN&nbsp;</span> retry 1/3 in 500ms
              </div>
              <div>
                <span className="d">09:41:26.881</span>{" "}
                <span className={props.logHighlight ? "e" : ""}>ERROR</span> timeout calling payment-gateway
              </div>
              <div>
                <span className="d">09:41:27.550</span> INFO&nbsp; connection pool exhausted
              </div>
            </div>
          </div>
        ) : props.section === "pref-terminal" ? (
          <div
            className="slc-pref-termpv"
            style={{
              background: props.terminalBg,
              color: props.terminalFg,
              backgroundImage: props.terminalBackgroundImage,
              backgroundSize: props.terminalBackgroundSize,
              backgroundRepeat: "no-repeat",
              fontFamily: props.terminalFontFamily,
              fontSize: px(props.terminalFontSize),
              lineHeight: props.terminalLineHeight
            }}
          >
            <div>Last login: Tue Oct 28 09:12:04 2026</div>
            <div>
              <span style={{ color: props.terminalFg }}>root@prod-web-01</span>:~# tail -f /var/log/app/error.log
            </div>
            <div>
              <span style={{ color: "#ff7b8a" }}>ERROR</span> timeout calling payment-gateway
            </div>
            <div>
              <span style={{ color: "#ffc86b" }}>WARN&nbsp;</span> retry 1/3 in 500ms
            </div>
            <div>
              <span>root@prod-web-01</span>:~#{" "}
              <span
                className={props.terminalCursorBlink ? "slc-pref-cursor blink" : "slc-pref-cursor"}
                style={{
                  display: "inline-block",
                  width: props.terminalCursorStyle === "bar" ? "1px" : "6px",
                  height: "11px",
                  background: props.terminalFg,
                  verticalAlign: "-1px"
                }}
              />
            </div>
          </div>
        ) : props.section === "pref-appearance" ? (
          <div className="slc-pref-uipv">
            <div className="slc-pref-uipv-top">
              <i /><i /><i />
              <span>{props.themeName}</span>
            </div>
            <div className="slc-pref-uipv-body">
              <div className="slc-pref-uipv-rail">
                <span className="on">终端</span>
                <span>文件</span>
                <span>监控</span>
                <span>日志</span>
              </div>
              <div className="slc-pref-uipv-main">
                <div className="slc-pref-uipv-card"><b>prod-web-01</b><em>已连接</em></div>
                <div className="slc-pref-uipv-card2"><i /><i /></div>
                <div className="slc-pref-uipv-acts"><em className="primary">连接</em><em>设置</em></div>
              </div>
            </div>
          </div>
        ) : (
          <div className="slc-pref-statpv">
            <div className="slc-pref-statpv-hd">
              <i className={props.refreshLabel === "关闭" ? "off" : ""} />
              <strong>服务器状态</strong>
            </div>
            <div className="slc-pref-statpv-row"><span>CPU</span><b>{props.refreshLabel === "关闭" ? "—" : "23%"}</b></div>
            <div className="slc-pref-statpv-row"><span>内存</span><b>{props.refreshLabel === "关闭" ? "—" : "61%"}</b></div>
            <div className="slc-pref-statpv-row"><span>磁盘</span><b>{props.refreshLabel === "关闭" ? "—" : "44%"}</b></div>
            <div className="slc-pref-statpv-foot">
              {props.refreshLabel === "关闭" ? "已关闭自动刷新" : "每 " + props.refreshLabel + " 自动刷新"}
            </div>
          </div>
        )}
      </div>
  );

  /* embedded（浮层内）：不渲染 aside 外壳与标题条，只给内容本身 */
  if (props.embedded) return body;

  /* 独立使用（保留能力，当前调用方已改为悬浮球） */
  return (
    <aside className="settings-pref-preview" aria-label={title}>
      <div className="settings-pref-preview-head">
        <span className="settings-pref-preview-dot" />
        <strong>{title}</strong>
        <span className="settings-pref-preview-sub">{props.themeName}</span>
      </div>
      {body}
    </aside>
  );
}

/* ============================================================
   偏好设置 · 悬浮球预览（2026-10-28，替换右侧常驻栏）
   ------------------------------------------------------------
   为什么要换：原右侧 300px 常驻栏有两个硬伤 ——
     ① 窄窗口（<1180px）直接 display:none，等于没有预览；
     ② 宽窗口下抢走设置区 300px，控件被挤窄。
   改成悬浮球后：默认只有 42px 圆球，设置区拿到全部宽度；
   点开浮层为 320×240，浮在内容之上、不参与布局。
   浮层内容仍是 PrefSectionPreview（按分区切换四种预览）。
   ============================================================ */
function FloatingPrefPreview(props: {
  section: string;
  themeName: string;
  logFontFamily: string;
  logFontSize: number;
  logHighlight: boolean;
  terminalBg: string;
  terminalFg: string;
  terminalBackgroundImage: string;
  terminalBackgroundSize: string;
  terminalFontFamily: string;
  terminalFontSize: number;
  terminalLineHeight: number;
  terminalCursorStyle: string;
  terminalCursorBlink: boolean;
  refreshLabel: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        className={open ? "settings-preview-fab settings-preview-fab-on" : "settings-preview-fab"}
        onClick={() => setOpen((v) => !v)}
        title={open ? "收起预览" : "打开预览"}
        aria-label={open ? "收起预览" : "打开预览"}
        aria-expanded={open}
      >
        {open ? "×" : "预览"}
      </button>
      {open ? (
        <div className="settings-preview-pop" role="dialog" aria-label="设置预览">
          <div className="settings-preview-pop-head">
            <span className="settings-preview-dot" />
            <strong>
              {props.section === "pref-appearance" ? "界面预览"
                : props.section === "pref-log" ? "日志预览"
                  : props.section === "pref-terminal" ? "终端预览"
                    : "连接状态"}
            </strong>
            <button type="button" className="settings-preview-pop-x" onClick={() => setOpen(false)} aria-label="关闭预览">×</button>
          </div>
          <div className="settings-preview-pop-body">
            <PrefSectionPreview {...props} embedded />
          </div>
        </div>
      ) : null}
    </>
  );
}

/* ============================================================
   纹理缩略图专用生成（2026-10-29）
   ------------------------------------------------------------
   为什么需要单独一套：
   buildTextureBackground 的 alpha 上限是 0.14 —— 那是给**真实终端**用的，
   必须若隐若现、不能抢正文。但设置页的缩略图只有 44px 高，
   14% 的线在里面几乎不可见（用户反馈「看不清、跟没有一样」）。

   缩略图的目的是「让你一眼分辨四种纹理的差别」，不是「还原终端观感」，
   所以这里用更高的线浓度（0.30–0.42）+ 更亮的衬底（#2e343a），
   只作用于缩略图，真实终端不受影响。
   ============================================================ */
function buildTextureThumbImage(texture: TerminalTexture): string {
  if (texture === "none") return "none";
  const a = 0.34;   /* 缩略图固定的线浓度，比终端的 0.08–0.14 明显 */
  const c = "rgba(150,205,240,";   /* 略偏亮的蓝，在 #2e343a 上有足够对比 */
  switch (texture) {
    case "grid":
      return `linear-gradient(${c}${a}) 1px,transparent 1px),` +
             `linear-gradient(90deg,${c}${a}) 1px,transparent 1px)`;
    case "dots":
      return `radial-gradient(circle at 1px 1px, ${c}${a}) 1.2px, transparent 0)`;
    case "double":
      return `linear-gradient(${c}${(a * 0.6).toFixed(2)}) 1px,transparent 1px),` +
             `linear-gradient(90deg,${c}${(a * 0.6).toFixed(2)}) 1px,transparent 1px),` +
             `linear-gradient(${c}${a}) 1px,transparent 1px),` +
             `linear-gradient(90deg,${c}${a}) 1px,transparent 1px)`;
    default:
      return "none";
  }
}
