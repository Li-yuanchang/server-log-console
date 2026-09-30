import { useState, useEffect, type Dispatch, type SetStateAction } from "react";

export type UiDensity = "compact" | "comfortable";
export type UiSurface = "plain" | "mist" | "paper" | "custom";
export type UiBackgroundMode = "solid" | "gradient" | "image";
export type UiMotionMode = "normal" | "reduced";
export type UiFontFamily = "geist" | "pingfang" | "microsoft-yahei" | "simsun" | "system";
/** S14：等宽字体族选项（日志 / 终端共用枚举，可各自独立选择） */
export type MonoFontFamily = "geist-mono" | "sf-mono" | "menlo" | "consolas" | "system-mono";
/** S14：水印作用范围（原型 1143-1168「日志/预览区 / 全局」） */
export type UiWatermarkScope = "content" | "global";

export type UiThemeAPI = {
  uiTheme: "classic" | "modern";
  setUiTheme: (theme: "classic" | "modern") => void;
  uiDensity: UiDensity;
  setUiDensity: (density: UiDensity) => void;
  uiSurface: UiSurface;
  setUiSurface: (surface: UiSurface) => void;
  uiBackgroundMode: UiBackgroundMode;
  setUiBackgroundMode: (mode: UiBackgroundMode) => void;
  customBackgroundColor: string;
  setCustomBackgroundColor: (value: string) => void;
  customGradientStart: string;
  setCustomGradientStart: (value: string) => void;
  customGradientEnd: string;
  setCustomGradientEnd: (value: string) => void;
  customBackgroundImage: string;
  setCustomBackgroundImage: (value: string) => void;
  customTextColor: string;
  setCustomTextColor: (value: string) => void;
  customLogBackgroundColor: string;
  setCustomLogBackgroundColor: (value: string) => void;
  customTerminalBackgroundColor: string;
  setCustomTerminalBackgroundColor: (value: string) => void;
  uiFontFamily: UiFontFamily;
  setUiFontFamily: (fontFamily: UiFontFamily) => void;
  logFontSize: number;
  setLogFontSize: (size: number) => void;
  terminalFontSize: number;
  setTerminalFontSize: (size: number) => void;
  /** S14：日志区等宽字体族（独立于界面字体；原型指出「日志字体族是现状没有的能力」） */
  logFontFamily: MonoFontFamily;
  setLogFontFamily: (family: MonoFontFamily) => void;
  /** S14：终端等宽字体族（独立配置；改后 xterm 需重排生效） */
  terminalFontFamily: MonoFontFamily;
  setTerminalFontFamily: (family: MonoFontFamily) => void;
  motionMode: UiMotionMode;
  setMotionMode: (mode: UiMotionMode) => void;
  /**
   * S14 最小补充字段（该文件非本任务独占，仅加本屏所需最小 state）：
   * 图片背景遮罩亮度(%)、背景模糊(px)、水印（开关/模板/透明度/作用范围）、动态背景开关。
   */
  customImageOverlay: number;
  setCustomImageOverlay: (value: number) => void;
  customImageBlur: number;
  setCustomImageBlur: (value: number) => void;
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
const DEFAULT_UI_SURFACE: UiSurface = "plain";
const DEFAULT_UI_BACKGROUND_MODE: UiBackgroundMode = "gradient";
const DEFAULT_CUSTOM_BACKGROUND_COLOR = "#f7f9fc";
const DEFAULT_CUSTOM_GRADIENT_START = "#eef5ff";
const DEFAULT_CUSTOM_GRADIENT_END = "#fff7ed";
const DEFAULT_CUSTOM_BACKGROUND_IMAGE = "";
const DEFAULT_CUSTOM_TEXT_COLOR = "#171717";
const DEFAULT_CUSTOM_LOG_BACKGROUND_COLOR = "#0a0a0a";
const DEFAULT_CUSTOM_TERMINAL_BACKGROUND_COLOR = "#0a0a0a";
const DEFAULT_UI_FONT_FAMILY: UiFontFamily = "geist";
const DEFAULT_LOG_FONT_SIZE = 12;
const DEFAULT_TERMINAL_FONT_SIZE = 12;
/** S14：等宽字体族默认值（与原 --mono 令牌一致） */
const DEFAULT_MONO_FONT_FAMILY: MonoFontFamily = "geist-mono";
/* S14 最小补充默认值：图片遮罩亮度 30%、模糊 0px；水印默认关（原型 1150 模板） */
const DEFAULT_CUSTOM_IMAGE_OVERLAY = 30;
const DEFAULT_CUSTOM_IMAGE_BLUR = 0;
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

export function useUiTheme(): UiThemeAPI {
  const [uiTheme, setUiThemeState] = useState<"classic" | "modern">(() => {
    return readLocalStorageValue("ui-theme") === "classic" ? "classic" : DEFAULT_UI_THEME;
  });
  const [uiDensity, setUiDensity] = useState<UiDensity>(() => {
    return readLocalStorageValue("ui-density") === "comfortable" ? "comfortable" : DEFAULT_UI_DENSITY;
  });
  const [uiSurface, setUiSurface] = useState<UiSurface>(() => {
    const value = readLocalStorageValue("ui-surface");
    return value === "mist" || value === "paper" || value === "custom" ? value : DEFAULT_UI_SURFACE;
  });
  const [uiBackgroundMode, setUiBackgroundMode] = useState<UiBackgroundMode>(() => {
    const value = readLocalStorageValue("ui-background-mode");
    return value === "solid" || value === "image" ? value : DEFAULT_UI_BACKGROUND_MODE;
  });
  const [customBackgroundColor, setCustomBackgroundColor] = useState(() => {
    return readLocalStorageValue("custom-background-color") || DEFAULT_CUSTOM_BACKGROUND_COLOR;
  });
  const [customGradientStart, setCustomGradientStart] = useState(() => {
    return readLocalStorageValue("custom-gradient-start") || DEFAULT_CUSTOM_GRADIENT_START;
  });
  const [customGradientEnd, setCustomGradientEnd] = useState(() => {
    return readLocalStorageValue("custom-gradient-end") || DEFAULT_CUSTOM_GRADIENT_END;
  });
  const [customBackgroundImage, setCustomBackgroundImage] = useState(() => {
    return readLocalStorageValue("custom-background-image") || DEFAULT_CUSTOM_BACKGROUND_IMAGE;
  });
  const [customTextColor, setCustomTextColor] = useState(() => {
    return readLocalStorageValue("custom-text-color") || DEFAULT_CUSTOM_TEXT_COLOR;
  });
  const [customLogBackgroundColor, setCustomLogBackgroundColor] = useState(() => {
    return readLocalStorageValue("custom-log-background-color") || DEFAULT_CUSTOM_LOG_BACKGROUND_COLOR;
  });
  const [customTerminalBackgroundColor, setCustomTerminalBackgroundColor] = useState(() => {
    return readLocalStorageValue("custom-terminal-background-color") || DEFAULT_CUSTOM_TERMINAL_BACKGROUND_COLOR;
  });
  const [uiFontFamily, setUiFontFamily] = useState<UiFontFamily>(() => {
    const value = readLocalStorageValue("ui-font-family");
    return value === "pingfang" || value === "microsoft-yahei" || value === "simsun" || value === "system"
      ? value
      : DEFAULT_UI_FONT_FAMILY;
  });
  const [logFontSize, setLogFontSize] = useState(() => {
    return clampPreferenceNumber(readLocalStorageValue("log-font-size"), DEFAULT_LOG_FONT_SIZE, 11, 16);
  });
  const [terminalFontSize, setTerminalFontSize] = useState(() => {
    return clampPreferenceNumber(readLocalStorageValue("terminal-font-size"), DEFAULT_TERMINAL_FONT_SIZE, 11, 18);
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
  // S14 最小补充：图片遮罩亮度 / 模糊 / 水印 / 动态背景
  const [customImageOverlay, setCustomImageOverlay] = useState(() => {
    return readStoredNumber("custom-image-overlay", DEFAULT_CUSTOM_IMAGE_OVERLAY, 0, 90);
  });
  const [customImageBlur, setCustomImageBlur] = useState(() => {
    return readStoredNumber("custom-image-blur", DEFAULT_CUSTOM_IMAGE_BLUR, 0, 24);
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

  useEffect(() => {
    persistLocalStorageValue("ui-theme", uiTheme);
  }, [uiTheme]);

  useEffect(() => {
    persistLocalStorageValue("ui-density", uiDensity);
  }, [uiDensity]);

  useEffect(() => {
    persistLocalStorageValue("ui-surface", uiSurface);
  }, [uiSurface]);

  useEffect(() => {
    persistLocalStorageValue("ui-background-mode", uiBackgroundMode);
  }, [uiBackgroundMode]);

  useEffect(() => {
    persistLocalStorageValue("custom-background-color", customBackgroundColor);
  }, [customBackgroundColor]);

  useEffect(() => {
    persistLocalStorageValue("custom-gradient-start", customGradientStart);
  }, [customGradientStart]);

  useEffect(() => {
    persistLocalStorageValue("custom-gradient-end", customGradientEnd);
  }, [customGradientEnd]);

  useEffect(() => {
    persistLocalStorageValue("custom-background-image", customBackgroundImage);
  }, [customBackgroundImage]);

  useEffect(() => {
    persistLocalStorageValue("custom-text-color", customTextColor);
  }, [customTextColor]);

  useEffect(() => {
    persistLocalStorageValue("custom-log-background-color", customLogBackgroundColor);
  }, [customLogBackgroundColor]);

  useEffect(() => {
    persistLocalStorageValue("custom-terminal-background-color", customTerminalBackgroundColor);
  }, [customTerminalBackgroundColor]);

  useEffect(() => {
    persistLocalStorageValue("ui-font-family", uiFontFamily);
  }, [uiFontFamily]);

  useEffect(() => {
    persistLocalStorageValue("log-font-size", String(logFontSize));
  }, [logFontSize]);

  useEffect(() => {
    persistLocalStorageValue("terminal-font-size", String(terminalFontSize));
  }, [terminalFontSize]);

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

  // S14 最小补充持久化
  useEffect(() => {
    persistLocalStorageValue("custom-image-overlay", String(customImageOverlay));
  }, [customImageOverlay]);

  useEffect(() => {
    persistLocalStorageValue("custom-image-blur", String(customImageBlur));
  }, [customImageBlur]);

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
    setUiSurface(DEFAULT_UI_SURFACE);
    setUiBackgroundMode(DEFAULT_UI_BACKGROUND_MODE);
    setCustomBackgroundColor(DEFAULT_CUSTOM_BACKGROUND_COLOR);
    setCustomGradientStart(DEFAULT_CUSTOM_GRADIENT_START);
    setCustomGradientEnd(DEFAULT_CUSTOM_GRADIENT_END);
    setCustomBackgroundImage(DEFAULT_CUSTOM_BACKGROUND_IMAGE);
    setCustomTextColor(DEFAULT_CUSTOM_TEXT_COLOR);
    setCustomLogBackgroundColor(DEFAULT_CUSTOM_LOG_BACKGROUND_COLOR);
    setCustomTerminalBackgroundColor(DEFAULT_CUSTOM_TERMINAL_BACKGROUND_COLOR);
    setUiFontFamily(DEFAULT_UI_FONT_FAMILY);
    setLogFontSize(DEFAULT_LOG_FONT_SIZE);
    setTerminalFontSize(DEFAULT_TERMINAL_FONT_SIZE);
    setLogFontFamily(DEFAULT_MONO_FONT_FAMILY);
    setTerminalFontFamily(DEFAULT_MONO_FONT_FAMILY);
    setMotionMode(DEFAULT_MOTION_MODE);
    // S14 最小补充复位
    setCustomImageOverlay(DEFAULT_CUSTOM_IMAGE_OVERLAY);
    setCustomImageBlur(DEFAULT_CUSTOM_IMAGE_BLUR);
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
    uiSurface,
    setUiSurface,
    uiBackgroundMode,
    setUiBackgroundMode,
    customBackgroundColor,
    setCustomBackgroundColor,
    customGradientStart,
    setCustomGradientStart,
    customGradientEnd,
    setCustomGradientEnd,
    customBackgroundImage,
    setCustomBackgroundImage,
    customTextColor,
    setCustomTextColor,
    customLogBackgroundColor,
    setCustomLogBackgroundColor,
    customTerminalBackgroundColor,
    setCustomTerminalBackgroundColor,
    uiFontFamily,
    setUiFontFamily,
    logFontSize,
    setLogFontSize,
    terminalFontSize,
    setTerminalFontSize,
    logFontFamily,
    setLogFontFamily,
    terminalFontFamily,
    setTerminalFontFamily,
    motionMode,
    setMotionMode,
    customImageOverlay,
    setCustomImageOverlay,
    customImageBlur,
    setCustomImageBlur,
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
