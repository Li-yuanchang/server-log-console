import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";

export type UiDensity = "compact" | "comfortable";
export type UiMotionMode = "normal" | "reduced";
export type UiFontFamily = "geist" | "pingfang" | "microsoft-yahei" | "simsun" | "system";
/** S14：等宽字体族选项（日志 / 终端共用枚举，可各自独立选择） */
export type MonoFontFamily = "geist-mono" | "sf-mono" | "menlo" | "consolas" | "system-mono";
/** S14：水印作用范围（原型 1143-1168「日志/预览区 / 全局」） */
export type UiWatermarkScope = "content" | "global";

/* ============================================================
   主题系统（2026-10 定稿，对齐原型 T1-T5 / 设置中心重设计方案）
   - 8 套内置主题（4 色彩族 × 浅/深成对），强调色随主题走
   - toneMode（跟随系统/浅色/深色）：跟随系统时在同族内切换变体
   - 背景层 8 种（独立于主题的一层；非纯色下面板半透明 + 毛玻璃）
   - 终端配色 8 款（独立槽位，映射 xterm ITheme）
   - 强调色覆盖（高级；null = 跟随主题）
   ============================================================ */

export type UiThemePreset =
  | "geist" | "carbon" | "steel" | "slate" | "sand" | "espresso" | "cal" | "ink";
export type UiToneMode = "system" | "light" | "dark";
export type UiBackgroundLayer =
  | "solid" | "aurora" | "linear" | "grid" | "dots" | "diag" | "noise" | "image";
export type TerminalColorSchemeId =
  | "console" | "tokyo" | "mocha" | "dracula" | "nord" | "rose" | "solar" | "daylight";

export type ThemePresetFamily = "neutral" | "cool" | "warm" | "mono";

export type ThemePreset = {
  id: UiThemePreset;
  name: string;
  fam: ThemePresetFamily;
  tone: "light" | "dark";
  desc: string;
  /** token 组：与 theme-modern.css .ui-theme-<id> 块一一对应 */
  v: {
    bg: string; panel: string; muted: string;
    ink: string; soft: string; mut: string;
    line: string; lineS: string;
    accent: string;
    shell: string; shellInk: string;
  };
  /** 该主题语义色（日志等级 / 状态点），深色主题单独给值 */
  sem: { green: string; red: string; amber: string };
};

/** 8 套内置主题（用户在「主题选款-本系统风格」中确认的定稿）。 */
export const THEME_PRESETS: ThemePreset[] = [
  { id: "geist", name: "晨白", fam: "neutral", tone: "light", desc: "Vercel 本尊 · 近白画布 + Vercel 蓝",
    v: { bg: "#fafafa", panel: "#ffffff", muted: "#f5f5f5", ink: "#171717", soft: "#595959", mut: "#808080", line: "#e7e7e7", lineS: "#d0d0d0", accent: "#0070f3", shell: "#0a0a0a", shellInk: "#d7dde5" },
    sem: { green: "#0a7b3e", red: "#d41313", amber: "#b45309" } },
  { id: "carbon", name: "碳黑", fam: "neutral", tone: "dark", desc: "Vercel 深色 · 近黑画布 + 同蓝",
    v: { bg: "#0a0a0a", panel: "#121212", muted: "#171717", ink: "#ededed", soft: "#a6a6a6", mut: "#7a7a7a", line: "#262626", lineS: "#3a3a3a", accent: "#0070f3", shell: "#050505", shellInk: "#d7dde5" },
    sem: { green: "#4ade80", red: "#f87171", amber: "#fbbf24" } },
  { id: "steel", name: "钢青", fam: "cool", tone: "light", desc: "冷灰蓝 · 工程感",
    v: { bg: "#f6f8fa", panel: "#ffffff", muted: "#eef2f6", ink: "#0f172a", soft: "#525f70", mut: "#7d8b9c", line: "#e2e8f0", lineS: "#c9d4e0", accent: "#2563eb", shell: "#0a0a0a", shellInk: "#d7dde5" },
    sem: { green: "#0a7b3e", red: "#d41313", amber: "#b45309" } },
  { id: "slate", name: "深钢", fam: "cool", tone: "dark", desc: "深蓝灰 · 冷静技术流",
    v: { bg: "#0b1220", panel: "#111827", muted: "#0e1626", ink: "#e2e8f0", soft: "#94a3b8", mut: "#6b7c92", line: "#1e293b", lineS: "#334155", accent: "#60a5fa", shell: "#060a12", shellInk: "#cbd5e1" },
    sem: { green: "#4ade80", red: "#f87171", amber: "#fbbf24" } },
  { id: "sand", name: "暖砂", fam: "warm", tone: "light", desc: "暖灰米调 · 克制的琥珀",
    v: { bg: "#faf9f7", panel: "#ffffff", muted: "#f3f1ec", ink: "#1c1917", soft: "#6b6259", mut: "#94897e", line: "#eae5dd", lineS: "#d7d0c4", accent: "#9a6a1a", shell: "#0a0a0a", shellInk: "#d7dde5" },
    sem: { green: "#0a7b3e", red: "#d41313", amber: "#b45309" } },
  { id: "espresso", name: "暖深", fam: "warm", tone: "dark", desc: "暖褐深色 · 沉稳",
    v: { bg: "#1c1917", panel: "#26221f", muted: "#211d1a", ink: "#f5f5f4", soft: "#b8b0a8", mut: "#857a70", line: "#332e29", lineS: "#4a423a", accent: "#d97706", shell: "#120f0d", shellInk: "#e7e1da" },
    sem: { green: "#4ade80", red: "#f87171", amber: "#fbbf24" } },
  { id: "cal", name: "纯白", fam: "mono", tone: "light", desc: "Cal 式纯白极简 · 黑强调，零彩色",
    v: { bg: "#ffffff", panel: "#ffffff", muted: "#f5f5f5", ink: "#1a1a1a", soft: "#6b6b6b", mut: "#8c8c8c", line: "#e8e8e8", lineS: "#cfcfcf", accent: "#1a1a1a", shell: "#0a0a0a", shellInk: "#d7dde5" },
    sem: { green: "#0a7b3e", red: "#d41313", amber: "#b45309" } },
  { id: "ink", name: "墨", fam: "mono", tone: "dark", desc: "纯黑白 · 最高对比，零彩色",
    v: { bg: "#09090b", panel: "#18181b", muted: "#121214", ink: "#fafafa", soft: "#a1a1aa", mut: "#71717a", line: "#27272a", lineS: "#3f3f46", accent: "#fafafa", shell: "#050505", shellInk: "#d7dde5" },
    sem: { green: "#4ade80", red: "#f87171", amber: "#fbbf24" } },
];

const THEME_PRESET_IDS = THEME_PRESETS.map((t) => t.id);
const FAMILY_LIGHT: Record<ThemePresetFamily, UiThemePreset> = {
  neutral: "geist", cool: "steel", warm: "sand", mono: "cal",
};
const FAMILY_DARK: Record<ThemePresetFamily, UiThemePreset> = {
  neutral: "carbon", cool: "slate", warm: "espresso", mono: "ink",
};

/** 背景层（独立于主题的一层）。视觉实现全部在 theme-modern.css 的 .ui-bg-* 块。 */
export const BG_LAYERS: { id: UiBackgroundLayer; name: string; desc: string }[] = [
  { id: "solid", name: "纯色", desc: "使用主题自身底色，最干净" },
  { id: "aurora", name: "极光光晕", desc: "径向光晕 · 原 mist/paper 同款机制（默认）" },
  { id: "linear", name: "线性渐变", desc: "135° 双端渐变" },
  { id: "grid", name: "网格线", desc: "1px 方格 · 工程/蓝图感" },
  { id: "dots", name: "点阵", desc: "圆点网格 · 轻量纸感" },
  { id: "diag", name: "斜纹", desc: "45° 斜线 · 硬朗" },
  { id: "noise", name: "噪点", desc: "细噪点 · 磨砂质感" },
  { id: "image", name: "图片·磨砂", desc: "自定义图片 + 遮罩亮度 + 背景模糊" },
];

/** 终端配色（独立槽位）。colors = xterm ITheme 所需（含 ANSI 16 色，取自各官方配色）。 */
export type TerminalColorScheme = {
  id: TerminalColorSchemeId;
  name: string;
  desc: string;
  grad: [string, string, string, string];
  theme: {
    background: string; foreground: string; cursor: string; cursorAccent: string;
    selectionBackground: string;
    black: string; red: string; green: string; yellow: string;
    blue: string; magenta: string; cyan: string; white: string;
    brightBlack: string; brightRed: string; brightGreen: string; brightYellow: string;
    brightBlue: string; brightMagenta: string; brightCyan: string; brightWhite: string;
  };
};

export const TERMINAL_SCHEMES: TerminalColorScheme[] = [
  { id: "console", name: "控制台", desc: "默认近黑 · one-dark 系", grad: ["#0a0a0a", "#7ec8e3", "#98c379", "#e06c75"],
    theme: { background: "#0a0a0a", foreground: "#d7dde5", cursor: "#ededed", cursorAccent: "#0a0a0a", selectionBackground: "#2a4a6a",
      black: "#282c34", red: "#e06c75", green: "#98c379", yellow: "#e5c07b", blue: "#61afef", magenta: "#c678dd", cyan: "#56b6c2", white: "#abb2bf",
      brightBlack: "#5c6b7a", brightRed: "#e06c75", brightGreen: "#98c379", brightYellow: "#e5c07b", brightBlue: "#61afef", brightMagenta: "#c678dd", brightCyan: "#56b6c2", brightWhite: "#ffffff" } },
  { id: "tokyo", name: "Tokyo Night", desc: "与「碳黑/夜幕」气质同源", grad: ["#1a1b26", "#7aa2f7", "#9ece6a", "#f7768e"],
    theme: { background: "#1a1b26", foreground: "#c0caf5", cursor: "#c0caf5", cursorAccent: "#1a1b26", selectionBackground: "#33467c",
      black: "#32344a", red: "#f7768e", green: "#9ece6a", yellow: "#e0af68", blue: "#7aa2f7", magenta: "#bb9af7", cyan: "#7dcfff", white: "#a9b1d6",
      brightBlack: "#444b6a", brightRed: "#ff7a93", brightGreen: "#b9f27c", brightYellow: "#ff9e64", brightBlue: "#7da6ff", brightMagenta: "#bb9af7", brightCyan: "#0db9d7", brightWhite: "#c0caf5" } },
  { id: "mocha", name: "Catppuccin", desc: "Mocha 柔和派", grad: ["#1e1e2e", "#89b4fa", "#a6e3a1", "#f38ba8"],
    theme: { background: "#1e1e2e", foreground: "#cdd6f4", cursor: "#f5e0dc", cursorAccent: "#1e1e2e", selectionBackground: "#585b70",
      black: "#45475a", red: "#f38ba8", green: "#a6e3a1", yellow: "#f9e2af", blue: "#89b4fa", magenta: "#f5c2e7", cyan: "#94e2d5", white: "#bac2de",
      brightBlack: "#585b70", brightRed: "#f38ba8", brightGreen: "#a6e3a1", brightYellow: "#f9e2af", brightBlue: "#89b4fa", brightMagenta: "#f5c2e7", brightCyan: "#94e2d5", brightWhite: "#a6adc8" } },
  { id: "dracula", name: "Dracula", desc: "经典高对比紫", grad: ["#282a36", "#bd93f9", "#50fa7b", "#ff5555"],
    theme: { background: "#282a36", foreground: "#f8f8f2", cursor: "#f8f8f0", cursorAccent: "#282a36", selectionBackground: "#44475a",
      black: "#21222c", red: "#ff5555", green: "#50fa7b", yellow: "#f1fa8c", blue: "#bd93f9", magenta: "#ff79c6", cyan: "#8be9fd", white: "#bbbbbb",
      brightBlack: "#555555", brightRed: "#ff8787", brightGreen: "#69ff94", brightYellow: "#ffffa5", brightBlue: "#d6acff", brightMagenta: "#ff92df", brightCyan: "#a4ffff", brightWhite: "#ffffff" } },
  { id: "nord", name: "Nord", desc: "冷调北欧蓝灰", grad: ["#2e3440", "#88c0d0", "#a3be8c", "#bf616a"],
    theme: { background: "#2e3440", foreground: "#d8dee9", cursor: "#d8dee9", cursorAccent: "#2e3440", selectionBackground: "#434c5e",
      black: "#3b4252", red: "#bf616a", green: "#a3be8c", yellow: "#ebcb8b", blue: "#81a1c1", magenta: "#b48ead", cyan: "#88c0d0", white: "#e5e9f0",
      brightBlack: "#4c566a", brightRed: "#bf616a", brightGreen: "#a3be8c", brightYellow: "#ebcb8b", brightBlue: "#81a1c1", brightMagenta: "#b48ead", brightCyan: "#8fbcbb", brightWhite: "#eceff4" } },
  { id: "rose", name: "Rosé Pine", desc: "低饱和玫瑰紫", grad: ["#191724", "#c4a7e7", "#9ccfd8", "#eb6f92"],
    theme: { background: "#191724", foreground: "#e0def4", cursor: "#e0def4", cursorAccent: "#191724", selectionBackground: "#403d52",
      black: "#26233a", red: "#eb6f92", green: "#31748f", yellow: "#f6c177", blue: "#9ccfd8", magenta: "#c4a7e7", cyan: "#ebbcba", white: "#e0def4",
      brightBlack: "#6e6a86", brightRed: "#eb6f92", brightGreen: "#31748f", brightYellow: "#f6c177", brightBlue: "#9ccfd8", brightMagenta: "#c4a7e7", brightCyan: "#ebbcba", brightWhite: "#e0def4" } },
  { id: "solar", name: "Solarized Dark", desc: "学术经典青金", grad: ["#002b36", "#268bd2", "#859900", "#dc322f"],
    theme: { background: "#002b36", foreground: "#93a1a1", cursor: "#93a1a1", cursorAccent: "#002b36", selectionBackground: "#073642",
      black: "#073642", red: "#dc322f", green: "#859900", yellow: "#b58900", blue: "#268bd2", magenta: "#d33682", cyan: "#2aa198", white: "#eee8d5",
      brightBlack: "#002b36", brightRed: "#cb4b16", brightGreen: "#586e75", brightYellow: "#657b83", brightBlue: "#839496", brightMagenta: "#6c71c4", brightCyan: "#93a1a1", brightWhite: "#fdf6e3" } },
  { id: "daylight", name: "日光", desc: "浅色终端 · 打印/截图友好", grad: ["#fbfbfa", "#0184bc", "#50a14f", "#e45649"],
    theme: { background: "#fbfbfa", foreground: "#383a42", cursor: "#526fff", cursorAccent: "#fbfbfa", selectionBackground: "#eceff4",
      black: "#383a42", red: "#e45649", green: "#50a14f", yellow: "#c18401", blue: "#0184bc", magenta: "#a626a4", cyan: "#0997b3", white: "#fafafa",
      brightBlack: "#4f525e", brightRed: "#e06c75", brightGreen: "#98c379", brightYellow: "#e5c07b", brightBlue: "#61afef", brightMagenta: "#c678dd", brightCyan: "#56b6c2", brightWhite: "#ffffff" } },
];

/** WCAG 相对亮度 → on-accent：黑/白中取对比度更高者（禁用亮度阈值法，历史 bug 见方案文档 3.3）。 */
function relativeLuminance(hex: string): number {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const n = parseInt(full, 16);
  const channel = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
}
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
export function onAccentColor(accent: string): string {
  return contrastRatio("#ffffff", accent) >= contrastRatio("#141414", accent) ? "#ffffff" : "#141414";
}
/** hover 色：浅色系压深、深色系提亮（与原型 accentHover 一致） */
export function accentHoverColor(accent: string, dark: boolean): string {
  return dark
    ? `color-mix(in srgb, ${accent} 82%, #ffffff)`
    : `color-mix(in srgb, ${accent} 86%, #000000)`;
}
export function accentSoftColor(accent: string): string {
  return `color-mix(in srgb, ${accent} 8%, transparent)`;
}

/** toneMode + 系统明暗 → 同族内的具体主题。 */
export function resolveThemePreset(preset: UiThemePreset, toneMode: UiToneMode, systemDark: boolean): ThemePreset {
  const base = THEME_PRESETS.find((t) => t.id === preset) ?? THEME_PRESETS[0];
  if (toneMode === "light") return THEME_PRESETS.find((t) => t.id === FAMILY_LIGHT[base.fam]) ?? base;
  if (toneMode === "dark") return THEME_PRESETS.find((t) => t.id === FAMILY_DARK[base.fam]) ?? base;
  return systemDark
    ? THEME_PRESETS.find((t) => t.id === FAMILY_DARK[base.fam]) ?? base
    : THEME_PRESETS.find((t) => t.id === FAMILY_LIGHT[base.fam]) ?? base;
}

export type UiThemeAPI = {
  uiTheme: "classic" | "modern";
  setUiTheme: (theme: "classic" | "modern") => void;
  uiDensity: UiDensity;
  setUiDensity: (density: UiDensity) => void;
  /** 主题（族基选）；点击具体主题卡时同时把 toneMode 固定到该主题明暗 */
  uiThemePreset: UiThemePreset;
  setUiThemePreset: (preset: UiThemePreset) => void;
  uiToneMode: UiToneMode;
  setUiToneMode: (mode: UiToneMode) => void;
  /** 系统当前明暗（matchMedia 实时） */
  systemDark: boolean;
  /** 按 toneMode 解析后的生效主题（类名/缩略图/设置 UI 都用它） */
  resolvedTheme: ThemePreset;
  /** 背景层（独立于主题） */
  uiBackground: UiBackgroundLayer;
  setUiBackground: (layer: UiBackgroundLayer) => void;
  /** 图片背景层的遮罩亮度(%) 与模糊(px) */
  uiImgOverlay: number;
  setUiImgOverlay: (value: number) => void;
  uiImgBlur: number;
  setUiImgBlur: (value: number) => void;
  /** 自定义背景图片（file:// / https / dataURI） */
  customBackgroundImage: string;
  setCustomBackgroundImage: (value: string) => void;
  /** 终端配色（独立槽位） */
  uiTerminalScheme: TerminalColorSchemeId;
  setUiTerminalScheme: (scheme: TerminalColorSchemeId) => void;
  /** 强调色覆盖（null = 跟随主题；入口在高级节） */
  uiAccentOverride: string | null;
  setUiAccentOverride: (accent: string | null) => void;
  uiFontFamily: UiFontFamily;
  setUiFontFamily: (fontFamily: UiFontFamily) => void;
  logFontSize: number;
  setLogFontSize: (size: number) => void;
  terminalFontSize: number;
  setTerminalFontSize: (size: number) => void;
  /** 界面字号（--fs-* 梯度基准，12~18）：设置中心可调，驱动全套界面字号 token */
  uiFontSize: number;
  setUiFontSize: (size: number) => void;
  logFontFamily: MonoFontFamily;
  setLogFontFamily: (family: MonoFontFamily) => void;
  terminalFontFamily: MonoFontFamily;
  setTerminalFontFamily: (family: MonoFontFamily) => void;
  motionMode: UiMotionMode;
  setMotionMode: (mode: UiMotionMode) => void;
  dynamicBackground: boolean;
  setDynamicBackground: (value: boolean) => void;
  watermarkEnabled: boolean;
  setWatermarkEnabled: (value: boolean) => void;
  watermarkTemplate: string;
  setWatermarkTemplate: (value: string) => void;
  watermarkOpacity: number;
  setWatermarkOpacity: (value: number) => void;
  watermarkScope: UiWatermarkScope;
  setWatermarkScope: (scope: UiWatermarkScope) => void;
  activityPanelVisible: boolean;
  setActivityPanelVisible: Dispatch<SetStateAction<boolean>>;
  resetUiPreferences: () => void;
};

const DEFAULT_UI_THEME = "modern" as const;
const DEFAULT_UI_DENSITY: UiDensity = "compact";
const DEFAULT_UI_THEME_PRESET: UiThemePreset = "geist";
const DEFAULT_UI_TONE_MODE: UiToneMode = "system";
const DEFAULT_UI_BACKGROUND: UiBackgroundLayer = "aurora";
const DEFAULT_UI_TERMINAL_SCHEME: TerminalColorSchemeId = "console";
const DEFAULT_CUSTOM_BACKGROUND_IMAGE = "";
const DEFAULT_UI_IMG_OVERLAY = 30;
const DEFAULT_UI_IMG_BLUR = 6;
const DEFAULT_UI_FONT_FAMILY: UiFontFamily = "geist";
const DEFAULT_LOG_FONT_SIZE = 12;
/* 终端默认字号：原型 .term 为 11px，用户确认过小 → 14px（可在设置中心调整） */
const DEFAULT_TERMINAL_FONT_SIZE = 14;
/* 界面字号（= --fs-base 梯度基准）：设置中心可调，联动全部 --fs-* token */
const DEFAULT_UI_FONT_SIZE = 14;

/**
 * 界面字号 → 全套 --fs-* 梯度。
 * 现行 7 档（base=14）：2xs 11 / xs 12 / sm 13 / base 14 / md 15 / lg 16 / xl 18，
 * 即 base-3 / -2 / -1 / 0 / +1 / +2 / +4（title 兼容旧引用 = md）。
 * 用户改界面字号时整条梯度随动，保持层级关系不变。
 */
export function uiFontSizeVars(size: number): Record<string, string> {
  const px = (n: number) => `${n}px`;
  return {
    /* 下限必须等于文档法定默认值（style-architecture.md §10 / theme-modern.css :root）：
       --fs-2xs=11px、--fs-xs=12px。此前下限写成 10/11，界面字号=12 时
       12px 档被压成 11px、11px 档压成 10px，表头/树文字比主题小一档。 */
    "--fs-2xs": px(Math.max(11, size - 3)),
    "--fs-xs": px(Math.max(12, size - 2)),
    "--fs-sm": px(Math.max(12, size - 1)),
    "--fs-base": px(size),
    "--fs-md": px(size + 1),
    "--fs-lg": px(size + 2),
    "--fs-xl": px(size + 4),
    "--fs-title": px(size + 1),
  };
}
/** S14：等宽字体族默认值（与原 --mono 令牌一致） */
const DEFAULT_MONO_FONT_FAMILY: MonoFontFamily = "geist-mono";
const DEFAULT_WATERMARK_ENABLED = false;
const DEFAULT_WATERMARK_TEMPLATE = "{用户} · {主机} · {时间} 内部资料";
const DEFAULT_WATERMARK_OPACITY = 5;
const DEFAULT_WATERMARK_SCOPE: UiWatermarkScope = "content";
const DEFAULT_DYNAMIC_BACKGROUND = false;

/** S14：等宽字体族枚举 → 实际字体栈。日志区与终端共用映射，保证字形一致。 */
export function monoFontFamilyValue(value: MonoFontFamily): string {
  switch (value) {
    case "sf-mono":
      return '"SFMono-Regular", "SF Mono", Menlo, monospace';
    case "menlo":
      return 'Menlo, Monaco, "Courier New", monospace';
    case "consolas":
      return 'Consolas, "Liberation Mono", Menlo, monospace';
    case "system-mono":
      return 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
    case "geist-mono":
    default:
      return '"Geist Mono", "SFMono-Regular", "Menlo", "Consolas", monospace';
  }
}
const DEFAULT_MOTION_MODE: UiMotionMode = "normal";
const DEFAULT_ACTIVITY_PANEL_VISIBLE = false;

function readLocalStorageValue(key: string): string {
  try {
    return localStorage.getItem(key) || "";
  } catch {
    return "";
  }
}

function clampPreferenceNumber(value: string, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.round(parsed)));
}

/** S14 最小补充：空串必须回落到默认值（clampPreferenceNumber 会把 "" 当 0，导致默认被判到最小值）。 */
function readStoredNumber(key: string, fallback: number, min: number, max: number): number {
  const raw = readLocalStorageValue(key);
  if (raw === "") return fallback;
  return clampPreferenceNumber(raw, fallback, min, max);
}

function persistLocalStorageValue(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch { /* ignore */ }
}

/** 主题初始化：读新 key；没有则迁移旧 ui-surface（plain→晨白 / mist→钢青 / paper→暖砂 / custom→晨白）。 */
function initialThemePreset(): UiThemePreset {
  const value = readLocalStorageValue("ui-theme-preset");
  if (THEME_PRESET_IDS.includes(value as UiThemePreset)) return value as UiThemePreset;
  const legacySurface = readLocalStorageValue("ui-surface");
  if (legacySurface === "mist") return "steel";
  if (legacySurface === "paper") return "sand";
  return DEFAULT_UI_THEME_PRESET;
}

function systemPrefersDark(): boolean {
  try {
    return window.matchMedia?.("(prefers-color-scheme: dark)")?.matches ?? false;
  } catch {
    return false;
  }
}

export function useUiTheme(): UiThemeAPI {
  const [uiTheme, setUiThemeState] = useState<"classic" | "modern">(() => {
    return readLocalStorageValue("ui-theme") === "classic" ? "classic" : DEFAULT_UI_THEME;
  });
  const [uiDensity, setUiDensity] = useState<UiDensity>(() => {
    return readLocalStorageValue("ui-density") === "comfortable" ? "comfortable" : DEFAULT_UI_DENSITY;
  });
  const [uiThemePreset, setUiThemePresetState] = useState<UiThemePreset>(initialThemePreset);
  const [uiToneMode, setUiToneModeState] = useState<UiToneMode>(() => {
    const value = readLocalStorageValue("ui-tone-mode");
    return value === "light" || value === "dark" ? value : DEFAULT_UI_TONE_MODE;
  });
  const [systemDark, setSystemDark] = useState(systemPrefersDark);
  const [uiBackground, setUiBackground] = useState<UiBackgroundLayer>(() => {
    const value = readLocalStorageValue("ui-bg-layer");
    return BG_LAYERS.some((b) => b.id === value) ? (value as UiBackgroundLayer) : DEFAULT_UI_BACKGROUND;
  });
  const [uiImgOverlay, setUiImgOverlay] = useState(() => {
    return readStoredNumber("custom-image-overlay", DEFAULT_UI_IMG_OVERLAY, 0, 90);
  });
  const [uiImgBlur, setUiImgBlur] = useState(() => {
    return readStoredNumber("custom-image-blur", DEFAULT_UI_IMG_BLUR, 0, 24);
  });
  const [customBackgroundImage, setCustomBackgroundImage] = useState(() => {
    return readLocalStorageValue("custom-background-image") || DEFAULT_CUSTOM_BACKGROUND_IMAGE;
  });
  const [uiTerminalScheme, setUiTerminalScheme] = useState<TerminalColorSchemeId>(() => {
    const value = readLocalStorageValue("ui-terminal-scheme");
    return TERMINAL_SCHEMES.some((s) => s.id === value) ? (value as TerminalColorSchemeId) : DEFAULT_UI_TERMINAL_SCHEME;
  });
  const [uiAccentOverride, setUiAccentOverrideState] = useState<string | null>(() => {
    const value = readLocalStorageValue("ui-accent-override");
    return /^#[0-9a-fA-F]{6}$/.test(value) ? value : null;
  });
  const [uiFontFamily, setUiFontFamily] = useState<UiFontFamily>(() => {
    const value = readLocalStorageValue("ui-font-family");
    return value === "pingfang" || value === "microsoft-yahei" || value === "simsun" || value === "system"
      ? value
      : DEFAULT_UI_FONT_FAMILY;
  });
  const [logFontSize, setLogFontSize] = useState(() => {
    /* 用 readStoredNumber：clampPreferenceNumber 会把空串当 0 压到最小值，默认值失效 */
    return readStoredNumber("log-font-size", DEFAULT_LOG_FONT_SIZE, 11, 16);
  });
  const [terminalFontSize, setTerminalFontSize] = useState(() => {
    return readStoredNumber("terminal-font-size", DEFAULT_TERMINAL_FONT_SIZE, 11, 18);
  });
  /* 界面字号：--fs-* 梯度基准（12~18），驱动全套界面字号 token */
  const [uiFontSize, setUiFontSize] = useState(() => {
    return readStoredNumber("ui-font-size", DEFAULT_UI_FONT_SIZE, 12, 18);
  });
  // S14：日志 / 终端字体族（各自独立，均为等宽枚举）
  const [logFontFamily, setLogFontFamily] = useState<MonoFontFamily>(() => {
    const value = readLocalStorageValue("log-font-family") as MonoFontFamily;
    return ["geist-mono", "sf-mono", "menlo", "consolas", "system-mono"].includes(value)
      ? value
      : DEFAULT_MONO_FONT_FAMILY;
  });
  const [terminalFontFamily, setTerminalFontFamily] = useState<MonoFontFamily>(() => {
    const value = readLocalStorageValue("terminal-font-family") as MonoFontFamily;
    return ["geist-mono", "sf-mono", "menlo", "consolas", "system-mono"].includes(value)
      ? value
      : DEFAULT_MONO_FONT_FAMILY;
  });
  const [motionMode, setMotionMode] = useState<UiMotionMode>(() => {
    return readLocalStorageValue("ui-motion-mode") === "reduced" ? "reduced" : DEFAULT_MOTION_MODE;
  });
  const [dynamicBackground, setDynamicBackground] = useState(() => {
    return readLocalStorageValue("ui-dynamic-background") === "on";
  });
  const [watermarkEnabled, setWatermarkEnabled] = useState(() => {
    return readLocalStorageValue("ui-watermark-enabled") === "on";
  });
  const [watermarkTemplate, setWatermarkTemplate] = useState(() => {
    return readLocalStorageValue("ui-watermark-template") || DEFAULT_WATERMARK_TEMPLATE;
  });
  const [watermarkOpacity, setWatermarkOpacity] = useState(() => {
    return readStoredNumber("ui-watermark-opacity", DEFAULT_WATERMARK_OPACITY, 1, 20);
  });
  const [watermarkScope, setWatermarkScope] = useState<UiWatermarkScope>(() => {
    return readLocalStorageValue("ui-watermark-scope") === "global" ? "global" : DEFAULT_WATERMARK_SCOPE;
  });
  const [activityPanelVisible, setActivityPanelVisible] = useState(() => {
    return readLocalStorageValue("activity-panel-visible") === "show";
  });

  /* 系统明暗监听：toneMode=system 时驱动同族变体切换 */
  useEffect(() => {
    const mq = window.matchMedia?.("(prefers-color-scheme: dark)");
    if (!mq) return;
    const onChange = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  /* 点击具体主题卡：固定该主题 + 把明暗固定到卡的 tone（跟随系统可再手动切回） */
  function setUiThemePreset(preset: UiThemePreset) {
    setUiThemePresetState(preset);
    const t = THEME_PRESETS.find((x) => x.id === preset);
    if (t) setUiToneModeState(t.tone);
  }
  function setUiToneMode(mode: UiToneMode) {
    setUiToneModeState(mode);
  }

  const resolvedTheme = useMemo(
    () => resolveThemePreset(uiThemePreset, uiToneMode, systemDark),
    [uiThemePreset, uiToneMode, systemDark],
  );

  useEffect(() => {
    persistLocalStorageValue("ui-theme", uiTheme);
  }, [uiTheme]);

  useEffect(() => {
    persistLocalStorageValue("ui-density", uiDensity);
  }, [uiDensity]);

  useEffect(() => {
    persistLocalStorageValue("ui-theme-preset", uiThemePreset);
  }, [uiThemePreset]);

  useEffect(() => {
    persistLocalStorageValue("ui-tone-mode", uiToneMode);
  }, [uiToneMode]);

  useEffect(() => {
    persistLocalStorageValue("ui-bg-layer", uiBackground);
  }, [uiBackground]);

  useEffect(() => {
    persistLocalStorageValue("custom-image-overlay", String(uiImgOverlay));
  }, [uiImgOverlay]);

  useEffect(() => {
    persistLocalStorageValue("custom-image-blur", String(uiImgBlur));
  }, [uiImgBlur]);

  useEffect(() => {
    persistLocalStorageValue("custom-background-image", customBackgroundImage);
  }, [customBackgroundImage]);

  useEffect(() => {
    persistLocalStorageValue("ui-terminal-scheme", uiTerminalScheme);
  }, [uiTerminalScheme]);

  useEffect(() => {
    persistLocalStorageValue("ui-accent-override", uiAccentOverride ?? "");
  }, [uiAccentOverride]);

  useEffect(() => {
    persistLocalStorageValue("ui-font-family", uiFontFamily);
  }, [uiFontFamily]);

  useEffect(() => {
    persistLocalStorageValue("log-font-size", String(logFontSize));
  }, [logFontSize]);

  useEffect(() => {
    persistLocalStorageValue("terminal-font-size", String(terminalFontSize));
  }, [terminalFontSize]);

  useEffect(() => {
    persistLocalStorageValue("ui-font-size", String(uiFontSize));
  }, [uiFontSize]);

  // S14：字体族持久化
  useEffect(() => {
    persistLocalStorageValue("log-font-family", logFontFamily);
  }, [logFontFamily]);

  useEffect(() => {
    persistLocalStorageValue("terminal-font-family", terminalFontFamily);
  }, [terminalFontFamily]);

  useEffect(() => {
    persistLocalStorageValue("ui-motion-mode", motionMode);
  }, [motionMode]);

  useEffect(() => {
    persistLocalStorageValue("ui-dynamic-background", dynamicBackground ? "on" : "off");
  }, [dynamicBackground]);

  useEffect(() => {
    persistLocalStorageValue("ui-watermark-enabled", watermarkEnabled ? "on" : "off");
  }, [watermarkEnabled]);

  useEffect(() => {
    persistLocalStorageValue("ui-watermark-template", watermarkTemplate);
  }, [watermarkTemplate]);

  useEffect(() => {
    persistLocalStorageValue("ui-watermark-opacity", String(watermarkOpacity));
  }, [watermarkOpacity]);

  useEffect(() => {
    persistLocalStorageValue("ui-watermark-scope", watermarkScope);
  }, [watermarkScope]);

  useEffect(() => {
    persistLocalStorageValue("activity-panel-visible", activityPanelVisible ? "show" : "hide");
  }, [activityPanelVisible]);

  function resetUiPreferences() {
    setUiThemeState(DEFAULT_UI_THEME);
    setUiDensity(DEFAULT_UI_DENSITY);
    setUiThemePresetState(DEFAULT_UI_THEME_PRESET);
    setUiToneModeState(DEFAULT_UI_TONE_MODE);
    setUiBackground(DEFAULT_UI_BACKGROUND);
    setUiImgOverlay(DEFAULT_UI_IMG_OVERLAY);
    setUiImgBlur(DEFAULT_UI_IMG_BLUR);
    setCustomBackgroundImage(DEFAULT_CUSTOM_BACKGROUND_IMAGE);
    setUiTerminalScheme(DEFAULT_UI_TERMINAL_SCHEME);
    setUiAccentOverrideState(null);
    setUiFontFamily(DEFAULT_UI_FONT_FAMILY);
    setLogFontSize(DEFAULT_LOG_FONT_SIZE);
    setTerminalFontSize(DEFAULT_TERMINAL_FONT_SIZE);
    setUiFontSize(DEFAULT_UI_FONT_SIZE);
    setLogFontFamily(DEFAULT_MONO_FONT_FAMILY);
    setTerminalFontFamily(DEFAULT_MONO_FONT_FAMILY);
    setMotionMode(DEFAULT_MOTION_MODE);
    setDynamicBackground(DEFAULT_DYNAMIC_BACKGROUND);
    setWatermarkEnabled(DEFAULT_WATERMARK_ENABLED);
    setWatermarkTemplate(DEFAULT_WATERMARK_TEMPLATE);
    setWatermarkOpacity(DEFAULT_WATERMARK_OPACITY);
    setWatermarkScope(DEFAULT_WATERMARK_SCOPE);
    setActivityPanelVisible(DEFAULT_ACTIVITY_PANEL_VISIBLE);
  }

  return {
    uiTheme,
    setUiTheme: setUiThemeState,
    uiDensity,
    setUiDensity,
    uiThemePreset,
    setUiThemePreset,
    uiToneMode,
    setUiToneMode,
    systemDark,
    resolvedTheme,
    uiBackground,
    setUiBackground,
    uiImgOverlay,
    setUiImgOverlay,
    uiImgBlur,
    setUiImgBlur,
    customBackgroundImage,
    setCustomBackgroundImage,
    uiTerminalScheme,
    setUiTerminalScheme,
    uiAccentOverride,
    setUiAccentOverride: setUiAccentOverrideState,
    uiFontFamily,
    setUiFontFamily,
    logFontSize,
    setLogFontSize,
    terminalFontSize,
    setTerminalFontSize,
    uiFontSize,
    setUiFontSize,
    logFontFamily,
    setLogFontFamily,
    terminalFontFamily,
    setTerminalFontFamily,
    motionMode,
    setMotionMode,
    dynamicBackground,
    setDynamicBackground,
    watermarkEnabled,
    setWatermarkEnabled,
    watermarkTemplate,
    setWatermarkTemplate,
    watermarkOpacity,
    setWatermarkOpacity,
    watermarkScope,
    setWatermarkScope,
    activityPanelVisible,
    setActivityPanelVisible,
    resetUiPreferences,
  };
}
