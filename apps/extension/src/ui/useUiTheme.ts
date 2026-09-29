import { useState, useEffect, type Dispatch, type SetStateAction } from "react";

export type UiDensity = "compact" | "comfortable";
export type UiSurface = "plain" | "mist" | "paper" | "custom";
export type UiBackgroundMode = "solid" | "gradient" | "image";
export type UiMotionMode = "normal" | "reduced";
export type UiFontFamily = "geist" | "pingfang" | "microsoft-yahei" | "simsun" | "system";

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
  motionMode: UiMotionMode;
  setMotionMode: (mode: UiMotionMode) => void;
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
  const [motionMode, setMotionMode] = useState<UiMotionMode>(() => {
    return readLocalStorageValue("ui-motion-mode") === "reduced" ? "reduced" : DEFAULT_MOTION_MODE;
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

  useEffect(() => {
    persistLocalStorageValue("ui-motion-mode", motionMode);
  }, [motionMode]);

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
    setMotionMode(DEFAULT_MOTION_MODE);
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
    motionMode,
    setMotionMode,
    activityPanelVisible,
    setActivityPanelVisible,
    resetUiPreferences,
  };
}
