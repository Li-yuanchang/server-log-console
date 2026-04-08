import type { SearchSettingsState } from "./utils.js";
import { getLocalDateString } from "./utils.js";

const browserTreeWidthStorageKey = "server-log-console:browser-tree-width";
const browserTreeWidthDefault = 224;
const browserTreeWidthMin = 170;
const browserTreeWidthMax = 380;
const lastDirectoryStorageKey = "server-log-console:last-directories";
const lastServerStorageKey = "server-log-console:last-server";
const searchSettingsStorageKey = "server-log-console:search-settings";

export function clampBrowserTreeWidth(width: number) {
  return Math.max(browserTreeWidthMin, Math.min(browserTreeWidthMax, width));
}

export function readBrowserTreeWidth() {
  try {
    const raw = globalThis.localStorage?.getItem(browserTreeWidthStorageKey);
    const parsed = raw ? Number(raw) : NaN;
    return Number.isFinite(parsed) ? clampBrowserTreeWidth(parsed) : browserTreeWidthDefault;
  } catch {
    return browserTreeWidthDefault;
  }
}

export function writeBrowserTreeWidth(width: number) {
  try {
    globalThis.localStorage?.setItem(browserTreeWidthStorageKey, String(clampBrowserTreeWidth(width)));
  } catch {
    return;
  }
}

export function readSavedSearchSettings(): SearchSettingsState | null {
  try {
    const raw = globalThis.localStorage?.getItem(searchSettingsStorageKey);
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as Partial<SearchSettingsState>;
    const keywordMode = parsed.keywordMode;
    if (keywordMode !== "phrase" && keywordMode !== "any" && keywordMode !== "all") {
      return null;
    }

    return {
      keywordInput: typeof parsed.keywordInput === "string" ? parsed.keywordInput : "",
      keywordMode,
      contextLines: typeof parsed.contextLines === "number" ? Math.max(0, Math.min(20, parsed.contextLines)) : 3,
      useRegex: Boolean(parsed.useRegex),
      selectedPreset: typeof parsed.selectedPreset === "string" ? parsed.selectedPreset : "未选择",
      startDate: typeof parsed.startDate === "string" ? parsed.startDate : getLocalDateString(),
      endDate: typeof parsed.endDate === "string" ? parsed.endDate : getLocalDateString(),
      startTime: typeof parsed.startTime === "string" ? parsed.startTime : "",
      endTime: typeof parsed.endTime === "string" ? parsed.endTime : ""
    };
  } catch {
    return null;
  }
}

export function writeSavedSearchSettings(state: SearchSettingsState) {
  try {
    globalThis.localStorage?.setItem(searchSettingsStorageKey, JSON.stringify(state));
  } catch {
    return;
  }
}

export function readLastDirectoryMap() {
  try {
    const raw = globalThis.localStorage?.getItem(lastDirectoryStorageKey);
    return raw ? (JSON.parse(raw) as Record<string, string>) : {};
  } catch {
    return {};
  }
}

export function writeLastDirectory(serverId: string, directoryPath: string) {
  try {
    const current = readLastDirectoryMap();
    current[serverId] = directoryPath;
    globalThis.localStorage?.setItem(lastDirectoryStorageKey, JSON.stringify(current));
  } catch {
    return;
  }
}

export function rememberDirectoryIfUseful(serverId: string, directoryPath: string, entryCount: number) {
  if (!serverId || !directoryPath.trim()) {
    return;
  }

  if (entryCount <= 0 && directoryPath !== "/") {
    return;
  }

  writeLastDirectory(serverId, directoryPath);
}

export function readLastServerId() {
  try {
    return globalThis.localStorage?.getItem(lastServerStorageKey) || "";
  } catch {
    return "";
  }
}

export function writeLastServerId(serverId: string) {
  try {
    globalThis.localStorage?.setItem(lastServerStorageKey, serverId);
  } catch {
    return;
  }
}
