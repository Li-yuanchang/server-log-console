import { useCallback } from "react";
import type { UploadProgressState, DownloadProgressState } from "./FeedbackOverlays.js";
import {
  apiDownloadFile,
  apiUploadLocalFile,
  apiUploadSmall,
  apiUploadStart,
  apiUploadChunk,
  apiUploadFinish,
} from "./api.js";
import type { TransferHistoryEntry } from "./storage.js";

const UPLOAD_JUNK_FILES = new Set([
  ".DS_Store", "._.DS_Store", "Thumbs.db", "thumbs.db", "desktop.ini", "Desktop.ini",
  ".Spotlight-V100", ".Trashes", "__MACOSX", ".fseventsd", ".TemporaryItems",
  "ehthumbs.db", "ehthumbs_vista.db", "$RECYCLE.BIN", "System Volume Information",
].map((name) => name.toLowerCase()));

const UPLOAD_SPEED_SAMPLE_MS = 300;
const TRANSFER_SUCCESS_HOLD_MS = 1200;

type LocalUploadFile = {
  path: string;
  name: string;
  size: number;
};

function getElectronFilePath(file: File): string {
  const directPath = String((file as { path?: string }).path || "").trim();
  if (directPath) {
    return directPath;
  }
  const api = (globalThis as any).electronAPI;
  if (api?.getPathForFile) {
    return String(api.getPathForFile(file) || "").trim();
  }
  return "";
}

function getUploadEtaSeconds(fileSize: number, bytesUploaded: number, speed: number): number | undefined {
  if (!speed || speed <= 0 || bytesUploaded <= 0 || fileSize <= bytesUploaded) return undefined;
  return Math.max(1, (fileSize - bytesUploaded) / speed);
}

function getUploadBatchSize(files: Array<{ size: number }>): number {
  return files.reduce((sum, file) => sum + Math.max(0, file.size || 0), 0);
}

function getUploadPercent(bytesUploaded: number, totalBytes: number): number {
  if (totalBytes <= 0) return 100;
  return Math.min(100, Math.max(0, Math.floor((bytesUploaded / totalBytes) * 100)));
}

function clearTransferProgressAfterHold(setUploadProgress: (v: UploadProgressState | null | ((prev: UploadProgressState | null) => UploadProgressState | null)) => void) {
  window.setTimeout(() => {
    setUploadProgress((prev) => prev?.stage === "completed" ? null : prev);
  }, TRANSFER_SUCCESS_HOLD_MS);
}

function isJunkFile(name: string): boolean {
  const normalized = (name || "").trim().toLowerCase();
  return UPLOAD_JUNK_FILES.has(normalized) || normalized.startsWith("._");
}

function getUploadRelativePath(file: File): string {
  return String((file as { webkitRelativePath?: string }).webkitRelativePath || file.name || "").replace(/^\/+/, "");
}

function getUploadLocalPath(file: File): string {
  const localPath = String((file as { path?: string }).path || "").trim();
  if (localPath) {
    return localPath;
  }
  return getUploadRelativePath(file);
}

function isJunkUploadPath(relativePath: string): boolean {
  const segments = relativePath
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean);
  return segments.some((segment) => isJunkFile(segment));
}

function splitUploadFiles(fileList: File[]) {
  const accepted: File[] = [];
  const skipped: File[] = [];

  for (const file of fileList) {
    const relativePath = getUploadRelativePath(file);
    if (!relativePath || isJunkUploadPath(relativePath)) {
      skipped.push(file);
      continue;
    }
    accepted.push(file);
  }

  return { accepted, skipped };
}

async function collectFilesFromEntries(entries: FileSystemEntry[]): Promise<File[]> {
  const files: File[] = [];
  async function readAllEntries(reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> {
    const all: FileSystemEntry[] = [];
    let batch: FileSystemEntry[];
    do {
      batch = await new Promise<FileSystemEntry[]>((resolve, reject) => reader.readEntries(resolve, reject));
      all.push(...batch);
    } while (batch.length > 0);
    return all;
  }
  async function traverse(entry: FileSystemEntry, pathPrefix: string) {
    if (entry.isFile) {
      const fileEntry = entry as FileSystemFileEntry;
      const file = await new Promise<File>((resolve, reject) => fileEntry.file(resolve, reject));
      const relativePath = pathPrefix ? `${pathPrefix}/${entry.name}` : entry.name;
      Object.defineProperty(file, "webkitRelativePath", { value: relativePath, writable: false });
      files.push(file);
    } else if (entry.isDirectory) {
      if (isJunkFile(entry.name)) return;
      const dirEntry = entry as FileSystemDirectoryEntry;
      const reader = dirEntry.createReader();
      const subEntries = await readAllEntries(reader);
      const nextPrefix = pathPrefix ? `${pathPrefix}/${entry.name}` : entry.name;
      for (const sub of subEntries) await traverse(sub, nextPrefix);
    }
  }
  for (const entry of entries) await traverse(entry, "");
  return files;
}

export type FileTransferAPI = {
  downloadFile: (targetFilePath: string) => Promise<void>;
  uploadFiles: () => Promise<void>;
  uploadDirectory: () => Promise<void>;
  handleFileDrop: (e: React.DragEvent) => void;
};

export function useFileTransfer(deps: {
  serverId: string;
  directoryPath: string;
  isBusy: boolean;
  setDownloadProgress: (v: DownloadProgressState | null) => void;
  setUploadProgress: (v: UploadProgressState | null | ((prev: UploadProgressState | null) => UploadProgressState | null)) => void;
  setActionStatus: (s: string) => void;
  pushActivity: (a: string) => void;
  showToast: (type: "success" | "error" | "loading", message: string) => string | number;
  updateToast: (id: string, type: "success" | "error" | "loading", message: string) => void;
  dismissToast: (id: string) => void;
  appendTransferHistory: (entry: Omit<TransferHistoryEntry, "id" | "serverId" | "serverLabel" | "createdAt">) => void;
  browseLogFiles: (path: string, options?: { manual?: boolean; silent?: boolean }) => Promise<void>;
  setIsDragOver: (v: boolean) => void;
}): FileTransferAPI {
  const {
    serverId,
    directoryPath,
    isBusy,
    setDownloadProgress,
    setUploadProgress,
    setActionStatus,
    pushActivity,
    showToast,
    appendTransferHistory,
    browseLogFiles,
    setIsDragOver,
  } = deps;

  const uploadOneFileWithBatchProgress = useCallback(async (
    file: File,
    targetPath: string,
    batch: {
      uploadedBefore: number;
      totalBytes: number;
      fileIndex: number;
      totalFiles: number;
      displayName: string;
      speedState: { sampleTime: number; sampleOffset: number; speed: number };
    },
  ): Promise<void> => {
    const CHUNK_THRESHOLD = 10 * 1024 * 1024;
    const updateBatchProgress = (
      fileBytesUploaded: number,
      stage: UploadProgressState["stage"] = "uploading",
      chunkIndex?: number,
      totalChunks?: number,
    ) => {
      const uploaded = Math.min(batch.totalBytes, batch.uploadedBefore + Math.min(fileBytesUploaded, file.size));
      const now = Date.now();
      const elapsedMs = now - batch.speedState.sampleTime;
      if (elapsedMs >= UPLOAD_SPEED_SAMPLE_MS || uploaded >= batch.totalBytes) {
        const delta = uploaded - batch.speedState.sampleOffset;
        if (delta > 0) {
          batch.speedState.speed = (delta / Math.max(elapsedMs, 1)) * 1000;
          batch.speedState.sampleTime = now;
          batch.speedState.sampleOffset = uploaded;
        }
      }
      const current = batch.totalBytes > 0
        ? getUploadPercent(uploaded, batch.totalBytes)
        : 100;
      setUploadProgress((prev) => prev ? {
        ...prev,
        current: Math.max(prev.current, current),
        fileName: `(${batch.fileIndex}/${batch.totalFiles}) ${batch.displayName}`,
        fileSize: batch.totalBytes,
        bytesUploaded: uploaded,
        speed: batch.speedState.speed,
        stage,
        transferMode: "browser",
        fileIndex: batch.fileIndex,
        totalFiles: batch.totalFiles,
        remainingFiles: Math.max(0, batch.totalFiles - batch.fileIndex),
        chunkIndex,
        totalChunks,
        etaSeconds: getUploadEtaSeconds(batch.totalBytes, uploaded, batch.speedState.speed),
      } : null);
    };

    if (file.size < CHUNK_THRESHOLD) {
      updateBatchProgress(0, "uploading");
      await apiUploadSmall(serverId!, targetPath, file, ({ loaded }) => {
        updateBatchProgress(Math.min(loaded, file.size), "uploading");
      });
      updateBatchProgress(file.size, "uploading");
      return;
    }

    const chunkSize = 1024 * 1024;
    const totalChunks = Math.ceil(file.size / chunkSize);
    const uploadId = await apiUploadStart(serverId, targetPath);
    let offset = 0;

    for (let i = 0; i < totalChunks; i++) {
      const end = Math.min(offset + chunkSize, file.size);
      const blob = file.slice(offset, end);
      const chunkStart = offset;
      updateBatchProgress(offset, "uploading", i + 1, totalChunks);
      await apiUploadChunk(uploadId, blob, ({ loaded }) => {
        updateBatchProgress(Math.min(chunkStart + loaded, file.size), "uploading", i + 1, totalChunks);
      });

      offset = end;
      updateBatchProgress(offset, "uploading", i + 1, totalChunks);
    }

    await apiUploadFinish(uploadId);
  }, [serverId, setUploadProgress]);

  const downloadFile = useCallback(async (targetFilePath: string) => {
    if (!serverId) return;
    const fileName = targetFilePath.split("/").pop() || "download";
    let downloadedBytes = 0;
    setDownloadProgress({ fileName, fileSize: 0, bytesDownloaded: 0, speed: 0, percent: 0 });
    try {
      const blob = await apiDownloadFile(serverId, targetFilePath, (downloaded, total, speed) => {
        downloadedBytes = downloaded;
        setDownloadProgress({ fileName, fileSize: total, bytesDownloaded: downloaded, speed, percent: total > 0 ? Math.round((downloaded / total) * 100) : 0 });
      });
      setDownloadProgress(null);
      const api = (window as any).electronAPI;
      if (api?.saveFile) {
        const buf = await blob.arrayBuffer();
        const result = await api.saveFile(buf, fileName);
        if (!result?.ok) {
          if (result?.canceled) {
            const message = "用户取消了下载保存";
            setActionStatus("下载已取消");
            pushActivity(`${message}：${targetFilePath}`);
            appendTransferHistory({
              direction: "download",
              status: "canceled",
              fileName,
              filePath: targetFilePath,
              size: blob.size || downloadedBytes,
              message,
            });
            return;
          }
          throw new Error(result?.message || "保存下载文件失败");
        }
        setActionStatus(`已保存到 ${result.filePath}`);
        pushActivity(`已下载文件：${targetFilePath} → ${result.filePath}`);
        appendTransferHistory({
          direction: "download",
          status: "success",
          fileName,
          filePath: targetFilePath,
          size: blob.size || downloadedBytes,
          localPath: result.filePath,
        });
        showToast("success", `已保存到 ${result.filePath}`);
      } else {
        const url = URL.createObjectURL(blob);
        try {
          const chromeDownloads = (globalThis as any).chrome?.downloads;
          const chromeRuntime = (globalThis as any).chrome?.runtime;
          if (chromeDownloads?.download) {
            await new Promise<void>((resolve, reject) => {
              chromeDownloads.download({ url, filename: fileName, saveAs: true }, () => {
                const lastError = chromeRuntime?.lastError;
                if (lastError) {
                  reject(new Error(lastError.message || "浏览器下载失败"));
                  return;
                }
                resolve();
              });
            });
            setActionStatus(`浏览器已弹出保存对话框：${fileName}`);
            pushActivity(`已触发浏览器保存：${targetFilePath}`);
            appendTransferHistory({
              direction: "download",
              status: "success",
              fileName,
              filePath: targetFilePath,
              size: blob.size || downloadedBytes,
              message: "浏览器已弹出保存对话框",
            });
            showToast("success", `请选择保存位置：${fileName}`);
          } else {
            const a = document.createElement("a");
            a.href = url;
            a.download = fileName;
            document.body.appendChild(a);
            a.click();
            a.remove();
            setActionStatus(`浏览器已开始下载 ${fileName}`);
            pushActivity(`已触发浏览器下载：${targetFilePath}`);
            appendTransferHistory({
              direction: "download",
              status: "success",
              fileName,
              filePath: targetFilePath,
              size: blob.size || downloadedBytes,
              message: "浏览器已开始下载",
            });
            showToast("success", `已开始下载 ${fileName}`);
          }
        } finally {
          window.setTimeout(() => URL.revokeObjectURL(url), 1000);
        }
        return;
      }
      return;
    } catch (error) {
      const detail = error instanceof Error ? error.message : "未知错误";
      setActionStatus(`下载失败：${detail}`);
      pushActivity(`下载失败：${detail}`);
      appendTransferHistory({
        direction: "download",
        status: "error",
        fileName,
        filePath: targetFilePath,
        size: downloadedBytes,
        message: detail,
      });
      showToast("error", `下载失败：${detail}`);
    } finally {
      setDownloadProgress(null);
    }
  }, [serverId, setDownloadProgress, setActionStatus, pushActivity, showToast, appendTransferHistory]);

  const uploadLocalFileList = useCallback(async (files: LocalUploadFile[]) => {
    if (!serverId || !directoryPath || files.length === 0) return;
    const total = files.length;
    const batchTotalBytes = getUploadBatchSize(files);
    const uploadDir = directoryPath.endsWith("/") ? directoryPath.slice(0, -1) : directoryPath;
    let currentUpload: { fileName: string; localPath: string; targetPath: string; size: number } | null = null;
    let uploadedBefore = 0;
    const speedState = { sampleTime: Date.now(), sampleOffset: 0, speed: 0 };
    setActionStatus(`正在本地直传 ${total} 个文件...`);
    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const targetPath = `${uploadDir}/${file.name}`;
        currentUpload = { fileName: file.name, localPath: file.path, targetPath, size: file.size };
        const updateLocalProgress = (bytesUploaded: number, chunkBytes = 0, _remoteTotalBytes = file.size) => {
          const now = Date.now();
          const overallUploaded = Math.min(batchTotalBytes, uploadedBefore + Math.min(bytesUploaded, file.size));
          const elapsedMs = now - speedState.sampleTime;
          if (elapsedMs >= UPLOAD_SPEED_SAMPLE_MS || overallUploaded >= batchTotalBytes) {
            const delta = overallUploaded - speedState.sampleOffset;
            if (delta > 0) {
              speedState.speed = (delta / Math.max(elapsedMs, 1)) * 1000;
              speedState.sampleTime = now;
              speedState.sampleOffset = overallUploaded;
            } else if (chunkBytes > 0) {
              speedState.speed = (chunkBytes / Math.max(elapsedMs, 1)) * 1000;
            }
          }
          const current = getUploadPercent(overallUploaded, batchTotalBytes);
          setUploadProgress((prev) => prev ? {
            ...prev,
            current: Math.max(prev.current, current),
            fileName: `(${i + 1}/${total}) ${file.name}`,
            fileSize: batchTotalBytes,
            bytesUploaded: overallUploaded,
            speed: speedState.speed,
            stage: overallUploaded >= batchTotalBytes && batchTotalBytes > 0 ? "finishing" : "uploading",
            transferMode: "local",
            fileIndex: i + 1,
            totalFiles: total,
            remainingFiles: Math.max(0, total - i - 1),
            etaSeconds: getUploadEtaSeconds(batchTotalBytes, overallUploaded, speedState.speed),
          } : null);
        };

        setUploadProgress({
          current: getUploadPercent(uploadedBefore, batchTotalBytes),
          total,
          fileName: `(${i + 1}/${total}) ${file.name}`,
          fileSize: batchTotalBytes,
          bytesUploaded: uploadedBefore,
          speed: speedState.speed,
          stage: "uploading",
          transferMode: "local",
          fileIndex: i + 1,
          totalFiles: total,
          remainingFiles: Math.max(0, total - i - 1),
        });
        await apiUploadLocalFile(serverId, targetPath, file.path, ({ transferred, chunkBytes, totalBytes }) => {
          updateLocalProgress(transferred, chunkBytes, totalBytes);
        });
        updateLocalProgress(file.size, 0, file.size);
        uploadedBefore += file.size;
        pushActivity(`已本地直传文件：${targetPath}`);
        appendTransferHistory({
          direction: "upload",
          status: "success",
          fileName: file.name,
          filePath: targetPath,
          size: file.size,
          localPath: file.path,
          message: "本地路径直传",
        });
      }
      setUploadProgress((prev) => prev ? {
        ...prev,
        current: 100,
        bytesUploaded: prev.fileSize,
        stage: "completed",
        etaSeconds: undefined,
      } : null);
      setActionStatus(`已本地直传 ${total} 个文件到 ${uploadDir}`);
      await browseLogFiles(uploadDir, { silent: true });
      clearTransferProgressAfterHold(setUploadProgress);
    } catch (error) {
      const detail = error instanceof Error ? error.message : "未知错误";
      setActionStatus(`上传失败：${detail}`);
      pushActivity(`上传失败：${detail}`);
      if (currentUpload) {
        appendTransferHistory({
          direction: "upload",
          status: "error",
          fileName: currentUpload.fileName,
          filePath: currentUpload.targetPath,
          size: currentUpload.size,
          localPath: currentUpload.localPath,
          message: detail,
        });
      }
      showToast("error", `上传失败：${detail}`);
    } finally {
      setUploadProgress((prev) => prev?.stage === "completed" ? prev : null);
    }
  }, [serverId, directoryPath, setUploadProgress, setActionStatus, pushActivity, showToast, appendTransferHistory, browseLogFiles]);

  const uploadFileList = useCallback(async (fileList: File[]) => {
    if (!serverId || !directoryPath || fileList.length === 0) return;
    const { accepted, skipped } = splitUploadFiles(fileList);
    if (accepted.length === 0) {
      const message = skipped.length > 0 ? `已过滤 ${skipped.length} 个垃圾文件，无需上传` : "没有可上传的文件";
      setActionStatus(message);
      pushActivity(message);
      showToast("success", message);
      return;
    }
    const electronLocalFiles = accepted
      .map((file): LocalUploadFile | null => {
        const localPath = getElectronFilePath(file);
        if (!localPath) {
          return null;
        }
        return { path: localPath, name: getUploadRelativePath(file) || file.name, size: file.size };
      });
    if (electronLocalFiles.every(Boolean)) {
      await uploadLocalFileList(electronLocalFiles as LocalUploadFile[]);
      return;
    }
    const skippedCount = skipped.length;
    const total = accepted.length;
    const totalBytes = getUploadBatchSize(accepted);
    const uploadDir = directoryPath.endsWith("/") ? directoryPath.slice(0, -1) : directoryPath;
    let currentUpload: { fileName: string; relativePath: string; localPath: string; targetPath: string; size: number } | null = null;
    let uploadedBefore = 0;
    const speedState = { sampleTime: Date.now(), sampleOffset: 0, speed: 0 };
    setActionStatus(`正在上传 ${total} 个文件${skippedCount ? `（已过滤 ${skippedCount} 个垃圾文件）` : ""}...`);
    try {
      for (let i = 0; i < accepted.length; i++) {
        const file = accepted[i];
        const relativePath = getUploadRelativePath(file);
        const localPath = getUploadLocalPath(file);
        const targetPath = `${uploadDir}/${relativePath}`;
        currentUpload = { fileName: file.name, relativePath, localPath, targetPath, size: file.size };
        setUploadProgress({
          current: getUploadPercent(uploadedBefore, totalBytes),
          total,
          fileName: `(${i + 1}/${total}) ${relativePath}`,
          fileSize: totalBytes,
          bytesUploaded: uploadedBefore,
          speed: speedState.speed,
          stage: "preparing",
          transferMode: "browser",
          fileIndex: i + 1,
          totalFiles: total,
          remainingFiles: Math.max(0, total - i - 1),
        });
        await uploadOneFileWithBatchProgress(file, targetPath, {
          uploadedBefore,
          totalBytes,
          fileIndex: i + 1,
          totalFiles: total,
          displayName: relativePath,
          speedState,
        });
        uploadedBefore += file.size;
        pushActivity(`已上传文件：${targetPath}`);
        appendTransferHistory({
          direction: "upload",
          status: "success",
          fileName: file.name,
          filePath: targetPath,
          size: file.size,
          localPath,
        });
      }
      setUploadProgress((prev) => prev ? {
        ...prev,
        current: 100,
        bytesUploaded: prev.fileSize,
        stage: "completed",
        etaSeconds: undefined,
      } : null);
      setActionStatus(`已上传 ${total} 个文件到 ${uploadDir}${skippedCount ? `（跳过 ${skippedCount} 个垃圾文件）` : ""}`);
      await browseLogFiles(uploadDir, { silent: true });
      clearTransferProgressAfterHold(setUploadProgress);
    } catch (error) {
      const detail = error instanceof Error ? error.message : "未知错误";
      setActionStatus(`上传失败：${detail}`);
      pushActivity(`上传失败：${detail}`);
      if (currentUpload) {
        appendTransferHistory({
          direction: "upload",
          status: "error",
          fileName: currentUpload.fileName,
          filePath: currentUpload.targetPath,
          size: currentUpload.size,
          localPath: currentUpload.localPath,
          message: detail,
        });
      }
      showToast("error", `上传失败：${detail}`);
    } finally {
      setUploadProgress((prev) => prev?.stage === "completed" ? prev : null);
    }
  }, [serverId, directoryPath, uploadOneFileWithBatchProgress, uploadLocalFileList, setUploadProgress, setActionStatus, pushActivity, showToast, appendTransferHistory, browseLogFiles]);

  const uploadFiles = useCallback(async () => {
    if (!serverId || !directoryPath) return;
    const electronAPI = (window as any).electronAPI;
    if (electronAPI?.localPickFiles) {
      const result = await electronAPI.localPickFiles();
      if (result?.ok && Array.isArray(result.files)) {
        await uploadLocalFileList(result.files);
      }
      return;
    }
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    input.onchange = async () => {
      const files = input.files;
      if (!files || files.length === 0) return;
      await uploadFileList(Array.from(files));
    };
    input.click();
  }, [serverId, directoryPath, uploadFileList, uploadLocalFileList]);

  const uploadDirectory = useCallback(async () => {
    if (!serverId || !directoryPath) return;
    const input = document.createElement("input");
    input.type = "file";
    (input as any).webkitdirectory = true;
    input.onchange = async () => {
      const files = input.files;
      if (!files || files.length === 0) return;
      await uploadFileList(Array.from(files));
    };
    input.click();
  }, [serverId, directoryPath, uploadFileList]);

  const handleFileDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    if (!serverId || !directoryPath || isBusy) return;

    const items = e.dataTransfer.items;
    if (items && items.length > 0) {
      const entries: FileSystemEntry[] = [];
      for (let i = 0; i < items.length; i++) {
        const entry = items[i].webkitGetAsEntry?.();
        if (entry) entries.push(entry);
      }
      if (entries.some((en) => en.isDirectory)) {
        void (async () => {
          const allFiles = await collectFilesFromEntries(entries);
          if (allFiles.length > 0) void uploadFileList(allFiles);
        })();
        return;
      }
    }

    const files = Array.from(e.dataTransfer.files);
    if (files.length === 0) return;
    void uploadFileList(files);
  }, [serverId, directoryPath, isBusy, setIsDragOver, uploadFileList]);

  return {
    downloadFile,
    uploadFiles,
    uploadDirectory,
    handleFileDrop,
  };
}
