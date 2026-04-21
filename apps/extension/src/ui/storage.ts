import type { SearchSettingsState } from "./utils.js";

const browserTreeWidthStorageKey = "server-log-console:browser-tree-width";
const browserTreeWidthDefault = 224;
const browserTreeWidthMin = 170;
const browserTreeWidthMax = 380;
const activityPanelHeightStorageKey = "server-log-console:activity-panel-height";
const activityPanelHeightDefault = 168;
const activityPanelHeightMin = 108;
const activityPanelHeightMax = 420;
const lastDirectoryStorageKey = "server-log-console:last-directories";
const lastServerStorageKey = "server-log-console:last-server";
const searchSettingsStorageKey = "server-log-console:search-settings";
const transferHistoryStorageKey = "server-log-console:transfer-history";
const transferHistoryMax = 80;

export type TransferHistoryDirection = "upload" | "download";
export type TransferHistoryStatus = "success" | "error" | "canceled";

export interface TransferHistoryEntry {
  id: string;
  direction: TransferHistoryDirection;
  status: TransferHistoryStatus;
  serverId: string;
  serverLabel: string;
  fileName: string;
  filePath: string;
  size: number;
  createdAt: string;
  localPath?: string;
  message?: string;
}

export function clampBrowserTreeWidth(width: number) {
  return Math.max(browserTreeWidthMin, Math.min(browserTreeWidthMax, width));
}

export function clampActivityPanelHeight(height: number) {
  return Math.max(activityPanelHeightMin, Math.min(activityPanelHeightMax, height));
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

export function readActivityPanelHeight() {
  try {
    const raw = globalThis.localStorage?.getItem(activityPanelHeightStorageKey);
    const parsed = raw ? Number(raw) : NaN;
    return Number.isFinite(parsed) ? clampActivityPanelHeight(parsed) : activityPanelHeightDefault;
  } catch {
    return activityPanelHeightDefault;
  }
}

export function writeBrowserTreeWidth(width: number) {
  try {
    globalThis.localStorage?.setItem(browserTreeWidthStorageKey, String(clampBrowserTreeWidth(width)));
  } catch {
    return;
  }
}

export function writeActivityPanelHeight(height: number) {
  try {
    globalThis.localStorage?.setItem(activityPanelHeightStorageKey, String(clampActivityPanelHeight(height)));
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
      excludeInput: typeof parsed.excludeInput === "string" ? parsed.excludeInput : "",
      contextLines: typeof parsed.contextLines === "number" ? Math.max(0, Math.min(20, parsed.contextLines)) : 3,
      useRegex: Boolean(parsed.useRegex),
      selectedPreset: typeof parsed.selectedPreset === "string" ? parsed.selectedPreset : "未选择",
      startDate: typeof parsed.startDate === "string" ? parsed.startDate : "",
      endDate: typeof parsed.endDate === "string" ? parsed.endDate : "",
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

const directoryHistoryStorageKey = "server-log-console:directory-history";
const directoryHistoryMax = 20;

export function readDirectoryHistory(serverId: string): string[] {
  try {
    const raw = globalThis.localStorage?.getItem(directoryHistoryStorageKey);
    if (!raw) return [];
    const map = JSON.parse(raw) as Record<string, string[]>;
    return Array.isArray(map[serverId]) ? map[serverId] : [];
  } catch {
    return [];
  }
}

export function pushDirectoryHistory(serverId: string, directoryPath: string) {
  if (!serverId || !directoryPath.trim()) return;
  try {
    const raw = globalThis.localStorage?.getItem(directoryHistoryStorageKey);
    const map = raw ? (JSON.parse(raw) as Record<string, string[]>) : {};
    const list = Array.isArray(map[serverId]) ? map[serverId] : [];
    const filtered = list.filter((p) => p !== directoryPath);
    filtered.unshift(directoryPath);
    map[serverId] = filtered.slice(0, directoryHistoryMax);
    globalThis.localStorage?.setItem(directoryHistoryStorageKey, JSON.stringify(map));
  } catch {
    return;
  }
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

function normalizeTransferHistoryEntry(value: unknown): TransferHistoryEntry | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const entry = value as Partial<TransferHistoryEntry>;
  if (entry.direction !== "upload" && entry.direction !== "download") {
    return null;
  }
  if (entry.status !== "success" && entry.status !== "error" && entry.status !== "canceled") {
    return null;
  }
  if (typeof entry.id !== "string" || typeof entry.serverId !== "string" || typeof entry.serverLabel !== "string") {
    return null;
  }
  if (typeof entry.fileName !== "string" || typeof entry.filePath !== "string" || typeof entry.createdAt !== "string") {
    return null;
  }

  return {
    id: entry.id,
    direction: entry.direction,
    status: entry.status,
    serverId: entry.serverId,
    serverLabel: entry.serverLabel,
    fileName: entry.fileName,
    filePath: entry.filePath,
    size: typeof entry.size === "number" && Number.isFinite(entry.size) ? Math.max(0, entry.size) : 0,
    createdAt: entry.createdAt,
    localPath: typeof entry.localPath === "string" ? entry.localPath : undefined,
    message: typeof entry.message === "string" ? entry.message : undefined,
  };
}

export function readTransferHistory(): TransferHistoryEntry[] {
  try {
    const raw = globalThis.localStorage?.getItem(transferHistoryStorageKey);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw) as unknown[];
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .map((entry) => normalizeTransferHistoryEntry(entry))
      .filter((entry): entry is TransferHistoryEntry => Boolean(entry))
      .slice(0, transferHistoryMax);
  } catch {
    return [];
  }
}

export function pushTransferHistory(entry: TransferHistoryEntry) {
  try {
    const current = readTransferHistory().filter((item) => item.id !== entry.id);
    current.unshift(entry);
    globalThis.localStorage?.setItem(transferHistoryStorageKey, JSON.stringify(current.slice(0, transferHistoryMax)));
  } catch {
    return;
  }
}

export function clearTransferHistory(serverId?: string) {
  try {
    if (!serverId) {
      globalThis.localStorage?.removeItem(transferHistoryStorageKey);
      return;
    }
    const filtered = readTransferHistory().filter((entry) => entry.serverId !== serverId);
    globalThis.localStorage?.setItem(transferHistoryStorageKey, JSON.stringify(filtered));
  } catch {
    return;
  }
}

// ---------------------------------------------------------------------------
// Terminal shortcut commands
// ---------------------------------------------------------------------------

const shortcutCommandsStorageKey = "server-log-console:shortcut-commands";
const shortcutCommandsMax = 200;

export interface ShortcutCommand {
  id: string;
  label: string;
  command: string;
  serverId: string;
  createdAt: string;
  updatedAt: string;
}

function generateId(): string {
  return globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeShortcutCommand(value: unknown): ShortcutCommand | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const entry = value as Partial<ShortcutCommand>;
  if (typeof entry.id !== "string" || typeof entry.label !== "string" || typeof entry.command !== "string") {
    return null;
  }

  return {
    id: entry.id,
    label: entry.label,
    command: entry.command,
    serverId: typeof entry.serverId === "string" ? entry.serverId : "",
    createdAt: typeof entry.createdAt === "string" ? entry.createdAt : new Date().toISOString(),
    updatedAt: typeof entry.updatedAt === "string" ? entry.updatedAt : new Date().toISOString(),
  };
}

export function readShortcutCommands(): ShortcutCommand[] {
  try {
    const raw = globalThis.localStorage?.getItem(shortcutCommandsStorageKey);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw) as unknown[];
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .map((entry) => normalizeShortcutCommand(entry))
      .filter((entry): entry is ShortcutCommand => Boolean(entry))
      .slice(0, shortcutCommandsMax);
  } catch {
    return [];
  }
}

function writeShortcutCommands(commands: ShortcutCommand[]) {
  try {
    globalThis.localStorage?.setItem(
      shortcutCommandsStorageKey,
      JSON.stringify(commands.slice(0, shortcutCommandsMax))
    );
  } catch {
    return;
  }
}

export function addShortcutCommand(label: string, command: string, serverId: string): ShortcutCommand {
  const now = new Date().toISOString();
  const entry: ShortcutCommand = {
    id: generateId(),
    label: label.trim(),
    command,
    serverId,
    createdAt: now,
    updatedAt: now,
  };
  const current = readShortcutCommands();
  current.push(entry);
  writeShortcutCommands(current);
  return entry;
}

export function updateShortcutCommand(id: string, updates: { label?: string; command?: string }): ShortcutCommand | null {
  const current = readShortcutCommands();
  const index = current.findIndex((entry) => entry.id === id);
  if (index < 0) {
    return null;
  }
  const entry = current[index];
  if (updates.label !== undefined) {
    entry.label = updates.label.trim();
  }
  if (updates.command !== undefined) {
    entry.command = updates.command;
  }
  entry.updatedAt = new Date().toISOString();
  current[index] = entry;
  writeShortcutCommands(current);
  return entry;
}

export function deleteShortcutCommand(id: string) {
  const current = readShortcutCommands();
  const filtered = current.filter((entry) => entry.id !== id);
  writeShortcutCommands(filtered);
}

export function clearShortcutCommands(serverId?: string) {
  if (!serverId) {
    try {
      globalThis.localStorage?.removeItem(shortcutCommandsStorageKey);
    } catch {
      return;
    }
    return;
  }
  const filtered = readShortcutCommands().filter((entry) => entry.serverId !== serverId);
  writeShortcutCommands(filtered);
}

export function getShortcutCommandsForServer(serverId: string): ShortcutCommand[] {
  return readShortcutCommands().filter(
    (entry) => entry.serverId === serverId || entry.serverId === ""
  );
}
