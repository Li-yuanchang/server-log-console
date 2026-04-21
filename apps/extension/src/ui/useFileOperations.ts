import { useCallback } from "react";
import type { LogFileEntry } from "@server-log-console/shared";
import type { PreviewDialogState } from "./FilePreviewDialog.js";
import type { ConfirmDialogState } from "./ModalDialogs.js";
import {
  apiDeleteFile,
  apiRenameFile,
  apiPreviewFile,
  apiSaveFile,
  apiExtractZip,
  apiMkdir,
  apiCompress,
} from "./api.js";

export type FileOperationsAPI = {
  deleteRemoteFile: (targetFile: string | LogFileEntry) => void;
  deleteRemoteEntries: (entries: LogFileEntry[]) => Promise<void>;
  confirmDeleteSelectedFiles: (entries?: LogFileEntry[]) => void;
  toggleFileSelection: (entryPath: string, nextSelected?: boolean) => void;
  clearSelectedFiles: () => void;
  toggleAllVisibleFiles: (nextSelected: boolean) => void;
  openRenameDialog: (entry: LogFileEntry) => void;
  renameRemoteFile: (entry: LogFileEntry, newName: string) => Promise<void>;
  openMoveDialog: (entry: LogFileEntry) => void;
  openBatchMoveDialog: (entries?: LogFileEntry[]) => void;
  buildMovedPath: (targetDir: string, entryName: string) => string;
  moveRemoteFile: (entry: LogFileEntry, targetDir: string) => Promise<void>;
  moveRemoteEntries: (entries: LogFileEntry[], targetDir: string) => Promise<void>;
  extractZipFile: (filePath: string, targetDir?: string) => Promise<void>;
  mkdirRemoteDir: (parentDir: string, dirName: string) => Promise<void>;
  compressRemotePath: (sourcePath: string, archiveType: "tar.gz" | "zip", targetDir?: string) => Promise<void>;
  previewFile: (entry: LogFileEntry) => void;
  doLoadFile: (entry: LogFileEntry) => Promise<void>;
  saveFileContent: () => Promise<void>;
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function useFileOperations(deps: {
  serverId: string;
  directoryPath: string;
  isBusy: boolean;
  selectedFileEntries: LogFileEntry[];
  tableEntries: readonly LogFileEntry[];
  selectedFilePaths: readonly string[];
  previewDialog: PreviewDialogState | null;
  setConfirmDialog: (v: ConfirmDialogState | null) => void;
  setRenameDialog: (v: { entry: LogFileEntry; newName: string } | null) => void;
  setMoveDialog: (v: { entry: LogFileEntry; targetDir: string } | null) => void;
  setBatchMoveDialog: (v: { entries: LogFileEntry[]; targetDir: string } | null) => void;
  setPreviewDialog: (v: PreviewDialogState | null | ((prev: PreviewDialogState | null) => PreviewDialogState | null)) => void;
  setSelectedFilePaths: (v: string[] | ((prev: string[]) => string[])) => void;
  setActionStatus: (s: string) => void;
  pushActivity: (a: string) => void;
  showToast: (type: "success" | "error" | "loading", message: string) => string | number;
  updateToast: (id: string, type: "success" | "error" | "loading", message: string) => void;
  withBusy: <T>(message: string, task: () => Promise<T>, successMessage?: string) => Promise<T | null>;
  browseLogFiles: (path: string, options?: { manual?: boolean }) => Promise<void>;
}): FileOperationsAPI {
  const {
    serverId,
    directoryPath,
    isBusy,
    selectedFileEntries,
    tableEntries,
    previewDialog,
    setConfirmDialog,
    setRenameDialog,
    setMoveDialog,
    setBatchMoveDialog,
    setPreviewDialog,
    setSelectedFilePaths,
    setActionStatus,
    pushActivity,
    showToast,
    updateToast,
    withBusy,
    browseLogFiles,
  } = deps;

  const deleteRemoteFile = useCallback((targetFile: string | LogFileEntry) => {
    if (!serverId) return;
    const entry = typeof targetFile === "string"
      ? { path: targetFile, name: targetFile.split("/").pop() || targetFile, kind: "file" as const }
      : targetFile;
    const fileName = entry.name || entry.path.split("/").pop() || entry.path;
    const targetLabel = entry.kind === "directory" ? "目录" : "文件";
    const refreshPath = directoryPath && (directoryPath === entry.path || directoryPath.startsWith(`${entry.path}/`))
      ? entry.path.substring(0, entry.path.lastIndexOf("/")) || "/"
      : directoryPath;
    setConfirmDialog({
      title: `删除${targetLabel}`,
      message: entry.kind === "directory" ? `确定删除远程目录及其内容？\n${entry.path}` : `确定删除远程文件？\n${entry.path}`,
      danger: true,
      onConfirm: () => {
        void withBusy(`正在删除${targetLabel} ${fileName}...`, async () => {
          await apiDeleteFile(serverId, entry.path);
          setActionStatus(`已删除 ${fileName}`);
          pushActivity(`已删除${targetLabel}：${entry.path}`);
          if (refreshPath) await browseLogFiles(refreshPath);
        }, `已删除 ${fileName}`);
      }
    });
  }, [serverId, directoryPath, setConfirmDialog, withBusy, setActionStatus, pushActivity, browseLogFiles]);

  const clearSelectedFiles = useCallback(() => {
    setSelectedFilePaths([]);
  }, [setSelectedFilePaths]);

  const toggleFileSelection = useCallback((entryPath: string, nextSelected?: boolean) => {
    setSelectedFilePaths((current) => {
      const next = new Set(current);
      const shouldSelect = nextSelected ?? !next.has(entryPath);
      if (shouldSelect) {
        next.add(entryPath);
      } else {
        next.delete(entryPath);
      }
      return [...next];
    });
  }, [setSelectedFilePaths]);

  const toggleAllVisibleFiles = useCallback((nextSelected: boolean) => {
    setSelectedFilePaths((current) => {
      const next = new Set(current);
      for (const entry of tableEntries) {
        if (nextSelected) {
          next.add(entry.path);
        } else {
          next.delete(entry.path);
        }
      }
      return [...next];
    });
  }, [tableEntries, setSelectedFilePaths]);

  const deleteRemoteEntries = useCallback(async (entries: LogFileEntry[]) => {
    if (!serverId || entries.length === 0) return;
    const targetCount = entries.length;
    await withBusy(`正在删除 ${targetCount} 项...`, async () => {
      for (let index = 0; index < entries.length; index += 1) {
        const entry = entries[index];
        try {
          await apiDeleteFile(serverId, entry.path);
        } catch (error) {
          const detail = error instanceof Error ? error.message : "未知错误";
          throw new Error(`${detail}（已完成 ${index}/${targetCount}）`);
        }
      }
      clearSelectedFiles();
      setActionStatus(`已删除 ${targetCount} 项`);
      pushActivity(`批量删除 ${targetCount} 项：${entries.map((entry) => entry.path).join(" | ")}`);
      if (directoryPath) await browseLogFiles(directoryPath);
    }, `已删除 ${targetCount} 项`);
  }, [serverId, directoryPath, withBusy, clearSelectedFiles, setActionStatus, pushActivity, browseLogFiles]);

  const confirmDeleteSelectedFiles = useCallback((entries: LogFileEntry[] = selectedFileEntries) => {
    if (!serverId || entries.length === 0) return;
    const targetCount = entries.length;
    const directoryCount = entries.filter((entry) => entry.kind === "directory").length;
    const fileCount = targetCount - directoryCount;
    const summary = targetCount === 1
      ? entries[0].path
      : `${fileCount > 0 ? `${fileCount} 个文件` : ""}${fileCount > 0 && directoryCount > 0 ? "，" : ""}${directoryCount > 0 ? `${directoryCount} 个目录` : ""}`;
    setConfirmDialog({
      title: targetCount === 1 ? `删除${entries[0].kind === "directory" ? "目录" : "文件"}` : `批量删除 ${targetCount} 项`,
      message: targetCount === 1 ? `确定删除？\n${entries[0].path}` : `确定批量删除以下内容？\n${summary}`,
      danger: true,
      onConfirm: () => {
        void deleteRemoteEntries(entries);
      }
    });
  }, [serverId, selectedFileEntries, setConfirmDialog, deleteRemoteEntries]);

  const openRenameDialog = useCallback((entry: LogFileEntry) => {
    setRenameDialog({ entry, newName: entry.name });
  }, [setRenameDialog]);

  const renameRemoteFile = useCallback(async (entry: LogFileEntry, newName: string) => {
    if (!serverId || !newName.trim() || newName === entry.name) return;
    const parentDir = entry.path.substring(0, entry.path.lastIndexOf("/")) || "/";
    const newPath = parentDir + "/" + newName.trim();
    await withBusy(`正在重命名 ${entry.name}...`, async () => {
      await apiRenameFile(serverId, entry.path, newPath);
      setActionStatus(`已重命名 ${entry.name} → ${newName.trim()}`);
      pushActivity(`重命名：${entry.name} → ${newName.trim()}`);
      if (directoryPath) await browseLogFiles(directoryPath);
    }, `已重命名 ${entry.name} → ${newName.trim()}`);
  }, [serverId, directoryPath, withBusy, setActionStatus, pushActivity, browseLogFiles]);

  const openMoveDialog = useCallback((entry: LogFileEntry) => {
    setMoveDialog({ entry, targetDir: directoryPath || "/" });
  }, [directoryPath, setMoveDialog]);

  const openBatchMoveDialog = useCallback((entries: LogFileEntry[] = selectedFileEntries) => {
    if (!entries.length) return;
    setBatchMoveDialog({ entries, targetDir: directoryPath || "/" });
  }, [selectedFileEntries, directoryPath, setBatchMoveDialog]);

  const buildMovedPath = useCallback((targetDir: string, entryName: string) => {
    const normalizedTargetDir = targetDir.trim().replace(/\/+$/, "") || "/";
    return normalizedTargetDir === "/" ? `/${entryName}` : `${normalizedTargetDir}/${entryName}`;
  }, []);

  const moveRemoteFile = useCallback(async (entry: LogFileEntry, targetDir: string) => {
    if (!serverId || !targetDir.trim()) return;
    const newPath = buildMovedPath(targetDir, entry.name);
    if (newPath === entry.path) return;
    await withBusy(`正在移动 ${entry.name}...`, async () => {
      await apiRenameFile(serverId, entry.path, newPath);
      setActionStatus(`已移动 ${entry.name} → ${targetDir}`);
      pushActivity(`移动：${entry.path} → ${newPath}`);
      if (directoryPath) await browseLogFiles(directoryPath);
    }, `已移动 ${entry.name}`);
  }, [serverId, directoryPath, withBusy, buildMovedPath, setActionStatus, pushActivity, browseLogFiles]);

  const moveRemoteEntries = useCallback(async (entries: LogFileEntry[], targetDir: string) => {
    if (!serverId || !targetDir.trim() || entries.length === 0) return;
    const moveTargets = entries
      .map((entry) => ({ entry, newPath: buildMovedPath(targetDir, entry.name) }))
      .filter(({ entry, newPath }) => newPath !== entry.path);
    if (moveTargets.length === 0) return;
    await withBusy(`正在移动 ${moveTargets.length} 项...`, async () => {
      for (let index = 0; index < moveTargets.length; index += 1) {
        const { entry, newPath } = moveTargets[index];
        try {
          await apiRenameFile(serverId, entry.path, newPath);
        } catch (error) {
          const detail = error instanceof Error ? error.message : "未知错误";
          throw new Error(`${detail}（已完成 ${index}/${moveTargets.length}）`);
        }
      }
      clearSelectedFiles();
      setActionStatus(`已移动 ${moveTargets.length} 项 → ${targetDir}`);
      pushActivity(`批量移动 ${moveTargets.length} 项到 ${targetDir}`);
      if (directoryPath) await browseLogFiles(directoryPath);
    }, `已移动 ${moveTargets.length} 项`);
  }, [serverId, directoryPath, withBusy, buildMovedPath, clearSelectedFiles, setActionStatus, pushActivity, browseLogFiles]);

  const extractZipFile = useCallback(async (filePath: string, targetDir?: string) => {
    if (!serverId) return;
    const fileName = filePath.split("/").pop() || filePath;
    await withBusy(`正在解压 ${fileName}...`, async () => {
      const result = await apiExtractZip(serverId, filePath, targetDir);
      setActionStatus(`已解压 ${fileName} 到 ${result.targetDir}`);
      pushActivity(`已解压：${filePath} → ${result.targetDir}`);
      if (directoryPath) await browseLogFiles(directoryPath);
    }, `已解压 ${fileName}`);
  }, [serverId, directoryPath, withBusy, setActionStatus, pushActivity, browseLogFiles]);

  const mkdirRemoteDir = useCallback(async (parentDir: string, dirName: string) => {
    if (!serverId || !dirName.trim()) return;
    const fullPath = parentDir === "/" ? `/${dirName.trim()}` : `${parentDir}/${dirName.trim()}`;
    await withBusy(`正在创建目录 ${dirName.trim()}...`, async () => {
      await apiMkdir(serverId, fullPath);
      setActionStatus(`已创建目录 ${dirName.trim()}`);
      pushActivity(`新建目录：${fullPath}`);
      if (directoryPath) await browseLogFiles(directoryPath);
    }, `已创建目录 ${dirName.trim()}`);
  }, [serverId, directoryPath, withBusy, setActionStatus, pushActivity, browseLogFiles]);

  const compressRemotePath = useCallback(async (sourcePath: string, archiveType: "tar.gz" | "zip", targetDir?: string) => {
    if (!serverId) return;
    const sourceName = sourcePath.split("/").pop() || sourcePath;
    await withBusy(`正在压缩 ${sourceName}...`, async () => {
      const result = await apiCompress(serverId, sourcePath, archiveType, targetDir);
      setActionStatus(`已压缩 ${sourceName} → ${result.archivePath}`);
      pushActivity(`压缩：${sourcePath} → ${result.archivePath}`);
      if (directoryPath) await browseLogFiles(directoryPath);
    }, `已压缩 ${sourceName}`);
  }, [serverId, directoryPath, withBusy, setActionStatus, pushActivity, browseLogFiles]);

  const doLoadFile = useCallback(async (entry: LogFileEntry) => {
    setPreviewDialog({ filePath: entry.path, fileName: entry.name, content: "", originalContent: "", size: typeof entry.size === "number" ? entry.size : 0, loading: true });
    try {
      const data = await apiPreviewFile(serverId, entry.path);
      setPreviewDialog({ filePath: data.filePath, fileName: entry.name, content: data.content, originalContent: data.content, size: data.size, readOnly: data.readOnly });
      pushActivity(`${data.readOnly ? "预览" : "打开"}文件：${entry.name}（${formatBytes(data.size)}）`);
    } catch (error) {
      setPreviewDialog(null);
      setActionStatus(`加载失败：${error instanceof Error ? error.message : "未知错误"}`);
    }
  }, [serverId, setPreviewDialog, pushActivity, setActionStatus]);

  const previewFile = useCallback((entry: LogFileEntry) => {
    if (isBusy || !serverId || entry.kind !== "file") return;
    const sizeBytes = typeof entry.size === "number" ? entry.size : 0;
    const editLimit = 10 * 1024 * 1024;
    if (sizeBytes > editLimit) {
      setConfirmDialog({
        title: "大文件预览",
        message: `文件较大（${formatBytes(sizeBytes)}），将以只读模式显示尾部内容。`,
        onConfirm: () => void doLoadFile(entry),
      });
      return;
    }
    const warnLimit = 2 * 1024 * 1024;
    if (sizeBytes > warnLimit) {
      setConfirmDialog({
        title: "大文件编辑",
        message: `文件较大（${formatBytes(sizeBytes)}），加载可能需要较长时间，是否继续？`,
        onConfirm: () => void doLoadFile(entry),
      });
      return;
    }
    void doLoadFile(entry);
  }, [isBusy, serverId, setConfirmDialog, doLoadFile]);

  const saveFileContent = useCallback(async () => {
    if (!previewDialog || !serverId) return;
    if (previewDialog.content === previewDialog.originalContent) return;
    setPreviewDialog((prev) => prev ? { ...prev, saving: true } : null);
    const tid = String(showToast("loading", `正在保存 ${previewDialog.fileName}...`));
    try {
      await apiSaveFile(serverId, previewDialog.filePath, previewDialog.content);
      setPreviewDialog((prev) => prev ? { ...prev, originalContent: prev.content, saving: false } : null);
      setActionStatus(`已保存 ${previewDialog.fileName}`);
      pushActivity(`保存文件：${previewDialog.filePath}`);
      updateToast(tid, "success", `已保存 ${previewDialog.fileName}`);
    } catch (error) {
      setPreviewDialog((prev) => prev ? { ...prev, saving: false } : null);
      const detail = error instanceof Error ? error.message : "未知错误";
      setActionStatus(`保存失败：${detail}`);
      updateToast(tid, "error", `保存失败：${detail}`);
    }
  }, [serverId, previewDialog, setPreviewDialog, showToast, updateToast, setActionStatus, pushActivity]);

  return {
    deleteRemoteFile,
    deleteRemoteEntries,
    confirmDeleteSelectedFiles,
    toggleFileSelection,
    clearSelectedFiles,
    toggleAllVisibleFiles,
    openRenameDialog,
    renameRemoteFile,
    openMoveDialog,
    openBatchMoveDialog,
    buildMovedPath,
    moveRemoteFile,
    moveRemoteEntries,
    extractZipFile,
    mkdirRemoteDir,
    compressRemotePath,
    previewFile,
    doLoadFile,
    saveFileContent,
  };
}
