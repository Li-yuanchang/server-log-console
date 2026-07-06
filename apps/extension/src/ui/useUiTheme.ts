import { useState, useEffect } from "react";

export type UiDensity = "compact" | "comfortable";
export type UiSurface = "plain" | "mist" | "paper";
export type UiMotionMode = "normal" | "reduced";

export type UiThemeAPI = {
  uiTheme: "classic" | "modern";
  setUiTheme: (theme: "classic" | "modern") => void;
  uiDensity: UiDensity;
  setUiDensity: (density: UiDensity) => void;
  uiSurface: UiSurface;
  setUiSurface: (surface: UiSurface) => void;
  logFontSize: number;
  setLogFontSize: (size: number) => void;
  terminalFontSize: number;
  setTerminalFontSize: (size: number) => void;
  motionMode: UiMotionMode;
  setMotionMode: (mode: UiMotionMode) => void;
  resetUiPreferences: () => void;
};

const DEFAULT_UI_THEME = "modern" as const;
const DEFAULT_UI_DENSITY: UiDensity = "compact";
const DEFAULT_UI_SURFACE: UiSurface = "plain";
const DEFAULT_LOG_FONT_SIZE = 12;
const DEFAULT_TERMINAL_FONT_SIZE = 12;
const DEFAULT_MOTION_MODE: UiMotionMode = "normal";

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
    return value === "mist" || value === "paper" ? value : DEFAULT_UI_SURFACE;
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
    persistLocalStorageValue("log-font-size", String(logFontSize));
  }, [logFontSize]);

  useEffect(() => {
    persistLocalStorageValue("terminal-font-size", String(terminalFontSize));
  }, [terminalFontSize]);

  useEffect(() => {
    persistLocalStorageValue("ui-motion-mode", motionMode);
  }, [motionMode]);

  function resetUiPreferences() {
    setUiThemeState(DEFAULT_UI_THEME);
    setUiDensity(DEFAULT_UI_DENSITY);
    setUiSurface(DEFAULT_UI_SURFACE);
    setLogFontSize(DEFAULT_LOG_FONT_SIZE);
    setTerminalFontSize(DEFAULT_TERMINAL_FONT_SIZE);
    setMotionMode(DEFAULT_MOTION_MODE);
  }

  return {
    uiTheme,
    setUiTheme: setUiThemeState,
    uiDensity,
    setUiDensity,
    uiSurface,
    setUiSurface,
    logFontSize,
    setLogFontSize,
    terminalFontSize,
    setTerminalFontSize,
    motionMode,
    setMotionMode,
    resetUiPreferences,
  };
}
