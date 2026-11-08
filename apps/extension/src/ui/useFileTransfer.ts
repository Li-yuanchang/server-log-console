import { useCallback, useRef, useState, type Dispatch, type SetStateAction } from "react";
import type { UploadProgressState, DownloadProgressState } from "./FeedbackOverlays.js";
import {
  apiDownloadFile,
  apiUploadLocalFile,
  apiUploadSmall,
  apiUploadStart,
  apiUploadChunk,
  apiUploadFinish,
  apiGetDirectoryListing,
} from "./api.js";
import type { TransferHistoryEntry } from "./storage.js";
import { TransferGate, TransferCancelledError } from "./transferControl.js";
import type { ConflictResolution, UploadConflictItem } from "./UploadConflictDialog.js";

const UPLOAD_JUNK_FILES = new Set([
  ".DS_Store", "._.DS_Store", "Thumbs.db", "thumbs.db", "desktop.ini", "Desktop.ini",
  ".Spotlight-V100", ".Trashes", "__MACOSX", ".fseventsd", ".TemporaryItems",
  "ehthumbs.db", "ehthumbs_vista.db", "$RECYCLE.BIN", "System Volume Information",
].map((name) => name.toLowerCase()));

const UPLOAD_SPEED_SAMPLE_MS = 300;
/* 完成卡驻留时长：完成态改为原型 S8 的可关闭细条卡（✓/查看进度/关闭），
   1.2s 用户来不及看清与点击，放宽到 8s；期间可手动关闭提前消失 */
const TRANSFER_SUCCESS_HOLD_MS = 8000;

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

/* 上传取消判定（2026-11-07）：闸门取消 + 在途请求 abort（AbortError）都算用户取消。
   XHR abort / fetch abort 抛的 DOMException name 都是 "AbortError"。 */
function isUploadCanceled(error: unknown): boolean {
  if (error instanceof TransferCancelledError) return true;
  return error instanceof Error && error.name === "AbortError";
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
  downloadFile: (targetFilePath: string, options?: { serverId?: string }) => Promise<void>;
  /** 取消当前下载（AbortController；网关检测到连接断开会自动销毁 SFTP 流） */
  cancelDownload: () => void;
  /** 下载暂停/继续（2026-11-07）：chunk 读取检查点上挂起，恢复从断点续读 */
  downloadPaused: boolean;
  pauseDownload: () => void;
  resumeDownload: () => void;
  uploadFiles: () => Promise<void>;
  /** 直传 File 列表（终端工具行「上传」用：容器选好文件后走同一上传通道，目标 = 应用层联动目录） */
  uploadFileList: (files: File[]) => Promise<void>;
  uploadDirectory: () => Promise<void>;
  handleFileDrop: (e: React.DragEvent) => void;
  /** 本轮上传的逐文件状态（供传输抽屉展示"哪个文件卡住了"） */
  uploadFileQueue: Array<{
    name: string;
    size: number;
    transferred: number;
    status: "pending" | "uploading" | "done" | "error";
  }>;
  /** 上传前冲突检测结果（非空时由 App 弹确认框，用户确认后再调用 confirmUpload） */
  uploadConflicts: UploadConflictItem[] | null;
  /** 用户确认冲突处理方式后继续上传 */
  confirmUpload: (options: { resolution: ConflictResolution; perFile?: Record<string, ConflictResolution> }) => Promise<void>;
  /** 放弃本次冲突待确认的上传 */
  cancelUploadConflicts: () => void;
  /** 上传是否处于暂停态（驱动抽屉按钮的「暂停/继续」切换） */
  uploadPaused: boolean;
  pauseUpload: () => void;
  resumeUpload: () => void;
  cancelUpload: () => void;
};

export function useFileTransfer(deps: {
  serverId: string;
  directoryPath: string;
  isBusy: boolean;
  setDownloadProgress: Dispatch<SetStateAction<DownloadProgressState | null>>;
  setUploadProgress: (v: UploadProgressState | null | ((prev: UploadProgressState | null) => UploadProgressState | null)) => void;
  setActionStatus: (s: string) => void;
  pushActivity: (a: string) => void;
  showToast: (type: "success" | "error" | "loading", message: string) => string | number;
  updateToast: (id: string, type: "success" | "error" | "loading", message: string) => void;
  dismissToast: (id: string) => void;
  appendTransferHistory: (entry: Omit<TransferHistoryEntry, "id" | "serverId" | "serverLabel" | "createdAt">) => void;
  browseLogFiles: (path: string, options?: { manual?: boolean; silent?: boolean }) => Promise<unknown>;
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

  /* 上传流程闸门：pause / resume / cancel 三态。
     同一时刻只有一条上传在跑，用 ref 持有当前闸门即可（新上传会替换旧闸门）。
     AbortController（2026-11-07）：闸门只能在检查点（文件/分片边界）停下，
     取消要立即生效还得 abort 在途请求 —— 网关在 /upload/local/stream 监听
     连接断开会销毁 SFTP 通道，fastPut 随即中止；分片通道 abort 当前片。 */
  const uploadGateRef = useRef<TransferGate | null>(null);
  const uploadAbortRef = useRef<AbortController | null>(null);
  const [uploadPaused, setUploadPaused] = useState(false);

  /* 下载取消载体：每次 downloadFile 新建 AbortController，取消按钮 abort 掉 fetch，
     网关 res.on("close") → cleanup 会顺带销毁 SFTP 流 */
  const downloadAbortRef = useRef<AbortController | null>(null);
  /* 下载暂停/继续闸门（2026-11-07）：与上传同一套检查点模型 ——
     每个 chunk 读取前 checkpoint，暂停即停止读取（TCP 背压让服务端停发），
     连接保持、恢复从断点续读；取消时 abort + gate.cancel 双保险。 */
  const downloadGateRef = useRef<TransferGate | null>(null);
  const [downloadPaused, setDownloadPaused] = useState(false);
  /* 恢复看门狗（2026-11-07）：暂停期间连接可能被系统休眠/网络层掐死，
     恢复放行后 read() 会挂在死 socket 上永远静默 —— 表现为「点继续没反应」。
     恢复/开始后 N 秒无新字节即判定连接死亡，静默断开重连。
     downloadPausedRef：暂停瞬间的最后一个在途进度包不得把 paused 标志覆盖回去。 */
  const downloadPausedRef = useRef(false);
  const downloadBytesRef = useRef(0);
  /* 断点续传（2026-11-07）：已收 chunk 累积在 ref 里 —— 恢复重建时保留，
     新流从已收字节 offset 续传追加；fresh 下载/取消/真实失败时清空 */
  const downloadChunksRef = useRef<Uint8Array[]>([]);
  const downloadCtxRef = useRef<{ gate: TransferGate; controller: AbortController; arm: (delayMs: number) => void } | null>(null);
  const recoveringRef = useRef(false);
  const recoverCountRef = useRef(0);
  const lastDownloadOptsRef = useRef<{ path: string; serverId?: string } | null>(null);
  /* 指向恢复入口的 ref：downloadFile 与 recover 相互引用，用 ref 打破循环依赖 */
  const recoverDownloadRef = useRef<(path: string, serverId?: string) => void>(() => {});

  const pauseDownload = useCallback(() => {
    const gate = downloadGateRef.current;
    if (!gate || gate.isCancelled || gate.isPaused) return;
    gate.pause();
    downloadPausedRef.current = true;
    setDownloadPaused(true);
    setDownloadProgress((prev) => prev ? { ...prev, paused: true } : prev);
    setActionStatus("下载已暂停");
  }, [setDownloadProgress, setActionStatus]);

  const resumeDownload = useCallback(() => {
    const gate = downloadGateRef.current;
    if (!gate || gate.isCancelled || !gate.isPaused) return;
    gate.resume();
    downloadPausedRef.current = false;
    setDownloadPaused(false);
    setDownloadProgress((prev) => prev ? { ...prev, paused: false } : prev);
    setActionStatus("继续下载...");
    /* 恢复看门狗：4 秒无新字节 → 连接已死 → 自动重建下载 */
    downloadCtxRef.current?.arm(4000);
  }, [setDownloadProgress, setActionStatus]);

  const cancelDownload = useCallback(() => {
    const controller = downloadAbortRef.current;
    if (!controller) return;
    downloadGateRef.current?.cancel();
    downloadPausedRef.current = false;
    controller.abort();
    setDownloadPaused(false);
    setActionStatus("正在取消下载...");
  }, [setActionStatus]);

  /** 开启一轮新的上传：新建闸门并接管 ref（旧闸门作废，其挂起的 checkpoint 随流程自然结束） */
  const beginUploadGate = useCallback((): TransferGate => {
    const gate = new TransferGate();
    uploadGateRef.current = gate;
    uploadAbortRef.current = new AbortController();
    setUploadPaused(false);
    return gate;
  }, []);

  const pauseUpload = useCallback(() => {
    const gate = uploadGateRef.current;
    if (!gate || gate.isCancelled || gate.isPaused) return;
    gate.pause();
    setUploadPaused(true);
    setActionStatus("上传已暂停");
  }, [setActionStatus]);

  const resumeUpload = useCallback(() => {
    const gate = uploadGateRef.current;
    if (!gate || gate.isCancelled || !gate.isPaused) return;
    gate.resume();
    setUploadPaused(false);
    setActionStatus("继续上传...");
  }, [setActionStatus]);

  const cancelUpload = useCallback(() => {
    const gate = uploadGateRef.current;
    if (!gate) return;
    gate.cancel();
    /* 立即断流（2026-11-07）：不等检查点。在途请求 abort 后，
       分片通道当前片以 AbortError 收场；直传通道由网关销毁 SFTP 通道。 */
    uploadAbortRef.current?.abort();
    setUploadPaused(false);
    setActionStatus("正在取消上传...");
  }, [setActionStatus]);

  const uploadOneFileWithBatchProgress = useCallback(async (
    file: File,
    targetPath: string,
    batch: {
      uploadedBefore: number;
      totalBytes: number;
      fileIndex: number;
      totalFiles: number;
      displayName: string;
      targetDir: string;
      speedState: { sampleTime: number; sampleOffset: number; speed: number };
    },
    gate?: TransferGate,
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
      /* 单文件进度同步进队列（抽屉批次子行 / 小窗逐文件条共用） */
      setUploadFileQueue((prev) => prev.map((item, index) =>
        index === batch.fileIndex - 1 ? { ...item, transferred: Math.min(fileBytesUploaded, file.size), status: "uploading" as const } : item
      ));
      setUploadProgress((prev) => prev ? {
        ...prev,
        current: Math.max(prev.current, current),
        fileName: `(${batch.fileIndex}/${batch.totalFiles}) ${batch.displayName}`,
        currentFileName: batch.displayName.split("/").pop() || batch.displayName,
        currentTargetDir: batch.targetDir,
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
      /* 小文件单个 POST 无法中途打断：先过闸门（暂停/取消在文件边界生效） */
      await gate?.checkpoint();
      updateBatchProgress(0, "uploading");
      await apiUploadSmall(serverId!, targetPath, file, ({ loaded }) => {
        updateBatchProgress(Math.min(loaded, file.size), "uploading");
      }, uploadAbortRef.current?.signal);
      updateBatchProgress(file.size, "uploading");
      return;
    }

    /* 大文件走分片：每片发送前过闸门 → 真正的暂停/继续（片间可停，已传分片保留） */
    await gate?.checkpoint();
    const chunkSize = 1024 * 1024;
    const totalChunks = Math.ceil(file.size / chunkSize);
    const uploadId = await apiUploadStart(serverId, targetPath);
    let offset = 0;

    for (let i = 0; i < totalChunks; i++) {
      await gate?.checkpoint();
      const end = Math.min(offset + chunkSize, file.size);
      const blob = file.slice(offset, end);
      const chunkStart = offset;
      updateBatchProgress(offset, "uploading", i + 1, totalChunks);
      await apiUploadChunk(uploadId, blob, ({ loaded }) => {
        updateBatchProgress(Math.min(chunkStart + loaded, file.size), "uploading", i + 1, totalChunks);
      }, uploadAbortRef.current?.signal);

      offset = end;
      updateBatchProgress(offset, "uploading", i + 1, totalChunks);
    }

    await apiUploadFinish(uploadId);
  }, [serverId, setUploadProgress, uploadAbortRef]);

  const downloadFile = useCallback(async (targetFilePath: string, options?: { serverId?: string; isRecovery?: boolean }) => {
    const effectiveServerId = options?.serverId || serverId;
    if (!effectiveServerId) return;
    const fileName = targetFilePath.split("/").pop() || "download";
    const isRecovery = Boolean(options?.isRecovery);
    /* 断点续传：恢复时保留已收 chunk，从已收字节 offset 续拉 */
    const startOffset = isRecovery ? downloadBytesRef.current : 0;
    let downloadedBytes = startOffset;
    let totalBytes = 0;
    const controller = new AbortController();
    const gate = new TransferGate();
    downloadAbortRef.current = controller;
    downloadGateRef.current = gate;
    if (!isRecovery) {
      recoverCountRef.current = 0;
      downloadChunksRef.current = [];
      downloadBytesRef.current = 0;
    }
    downloadPausedRef.current = false;
    lastDownloadOptsRef.current = { path: targetFilePath, serverId: effectiveServerId };
    /* 恢复/开始后的看门狗：delayMs 内字节无增长且不在暂停态 → 连接已死，自动重建。
       gate.cancel() 让挂在检查点上的循环退出；abort 让挂在 read() 上的循环退出；
       两者都被 catch 的 recovering 分支静默吞掉，不写取消历史。 */
    const armWatchdog = (delayMs: number) => {
      const bytesAtArm = downloadBytesRef.current;
      window.setTimeout(() => {
        if (downloadGateRef.current !== gate) return;
        if (controller.signal.aborted) return;
        if (gate.isPaused || downloadPausedRef.current) return;
        if (downloadBytesRef.current !== bytesAtArm) return;
        if (recoverCountRef.current >= 3) {
          setActionStatus("下载连接多次中断，请停止后重新下载");
          return;
        }
        recoverCountRef.current += 1;
        recoveringRef.current = true;
        setActionStatus("下载连接已中断，正在重新建立…");
        gate.cancel();
        controller.abort();
        window.setTimeout(() => {
          recoveringRef.current = false;
          void downloadFile(targetFilePath, { serverId: effectiveServerId, isRecovery: true });
        }, 80);
      }, delayMs);
    };
    downloadCtxRef.current = {
      gate,
      controller,
      arm: (delayMs: number) => armWatchdog(delayMs),
    };
    setDownloadProgress({ fileName, filePath: targetFilePath, fileSize: 0, bytesDownloaded: startOffset, speed: 0, percent: 0, paused: false });
    armWatchdog(8000);
    try {
      const { total } = await apiDownloadFile(effectiveServerId, targetFilePath, {
        offset: startOffset,
        onChunk: (chunk) => { downloadChunksRef.current.push(chunk); },
        onProgress: (downloaded, totalSize, speed) => {
          downloadedBytes = downloaded;
          totalBytes = totalSize;
          downloadBytesRef.current = downloaded;
          setDownloadProgress({ fileName, filePath: targetFilePath, fileSize: totalSize, bytesDownloaded: downloaded, speed, percent: totalSize > 0 ? Math.round((downloaded / totalSize) * 100) : 0, paused: downloadPausedRef.current });
        },
        signal: controller.signal,
        gate,
      });
      totalBytes = total || totalBytes;
      const blob = new Blob(downloadChunksRef.current as BlobPart[], { type: "application/octet-stream" });
      downloadChunksRef.current = [];
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
      /* 恢复重建触发的 abort/取消：静默收场，不写历史、不弹提示 */
      if (recoveringRef.current) {
        recoveringRef.current = false;
        return;
      }
      /* 断点失效（远端文件被截断/替换）：丢弃已收 chunk，从头重下一次 */
      if (isRecovery && error instanceof Error && error.message.includes("断点")) {
        recoverCountRef.current += 1;
        if (recoverCountRef.current <= 3) {
          setActionStatus("远端文件已变化，从头重新下载…");
          downloadChunksRef.current = [];
          downloadBytesRef.current = 0;
          void downloadFile(targetFilePath, { serverId: effectiveServerId, isRecovery: true });
          return;
        }
      }
      /* 用户取消：abort / 闸门取消（暂停中取消走这里）都以「取消」收场，不记失败 */
      if (controller.signal.aborted || error instanceof TransferCancelledError || (error instanceof Error && error.name === "AbortError")) {
        const message = "用户取消下载";
        setActionStatus("已取消下载");
        pushActivity(`已取消下载：${targetFilePath}`);
        appendTransferHistory({
          direction: "download",
          status: "canceled",
          fileName,
          filePath: targetFilePath,
          size: downloadedBytes,
          message
        });
        showToast("success", "已取消下载");
        return;
      }
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
      if (downloadAbortRef.current === controller) {
        downloadAbortRef.current = null;
      }
      if (downloadGateRef.current === gate) {
        downloadGateRef.current = null;
      }
      if (downloadCtxRef.current?.controller === controller) {
        downloadCtxRef.current = null;
      }
      downloadPausedRef.current = false;
      setDownloadPaused(false);
      /* 恢复重建中：保留已收 chunk 与进度行（新流会从断点续传）；
         其余收场（完成/取消/失败）全部清空 */
      if (!recoveringRef.current) {
        downloadChunksRef.current = [];
        downloadBytesRef.current = 0;
        setDownloadProgress(null);
      }
    }
  }, [serverId, setDownloadProgress, setActionStatus, pushActivity, showToast, appendTransferHistory]);

  /* 恢复入口（ref 打破 downloadFile ↔ recover 循环依赖）：重建同一目标的下载 */
  recoverDownloadRef.current = (path, serverId) => {
    void downloadFile(path, { serverId, isRecovery: true });
  };

  const uploadLocalFileList = useCallback(async (files: LocalUploadFile[], gate?: TransferGate) => {
    if (!serverId || !directoryPath || files.length === 0) return;
    const total = files.length;
    const batchTotalBytes = getUploadBatchSize(files);
    const uploadDir = directoryPath.endsWith("/") ? directoryPath.slice(0, -1) : directoryPath;
    let currentUpload: { fileName: string; localPath: string; targetPath: string; size: number } | null = null;
    let uploadedBefore = 0;
    const speedState = { sampleTime: Date.now(), sampleOffset: 0, speed: 0 };
    setActionStatus(`正在本地直传 ${total} 个文件...`);
    /* 逐文件队列（2026-11-07 修复）：直传通道此前不填 uploadFileQueue，
       抽屉批次组与小窗文件列表都拿不到数据 —— 文件夹上传只显示当前一行
       （还误标「仅可取消」）、小窗空空如也。现与浏览器通道同构填充。 */
    setUploadFileQueue(files.map((file) => ({
      name: file.name,
      size: file.size,
      transferred: 0,
      status: "pending" as const
    })));
    /* 上传开始即刷新目标目录（2026-11-07）：SFTP 对部分写入的文件可见，
       早刷新让文件行立刻出现在列表里、行内进度就地挂上 —— 此前要等传完才
       刷新，用户「看不到正在上传的文件」。2s 后补一次：首写落盘往往晚于首轮刷新。 */
    void browseLogFiles(uploadDir, { silent: true });
    window.setTimeout(() => { void browseLogFiles(uploadDir, { silent: true }); }, 2000);
    try {
      for (let i = 0; i < files.length; i++) {
        /* 直传是服务端一条流式拷贝，无法中途打断 → 暂停/取消在文件边界生效 */
        await gate?.checkpoint();
        const file = files[i];
        const targetPath = `${uploadDir}/${file.name}`;
        currentUpload = { fileName: file.name, localPath: file.path, targetPath, size: file.size };
        setUploadFileQueue((prev) => prev.map((item, index) =>
          index === i ? { ...item, status: "uploading" as const } : item
        ));
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
          /* 单文件进度同步进队列（抽屉批次子行 / 小窗逐文件条共用） */
          setUploadFileQueue((prev) => prev.map((item, index) =>
            index === i ? { ...item, transferred: Math.min(bytesUploaded, file.size), status: "uploading" as const } : item
          ));
          setUploadProgress((prev) => prev ? {
            ...prev,
            current: Math.max(prev.current, current),
            fileName: `(${i + 1}/${total}) ${file.name}`,
            currentFileName: file.name,
            currentTargetDir: uploadDir,
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
          currentFileName: file.name,
          currentTargetDir: uploadDir,
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
        }, uploadAbortRef.current?.signal);
        updateLocalProgress(file.size, 0, file.size);
        setUploadFileQueue((prev) => prev.map((item, index) =>
          index === i ? { ...item, transferred: file.size, status: "done" as const } : item
        ));
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
      if (isUploadCanceled(error)) {
        /* 用户取消：不记为失败，仅提示已取消 */
        setActionStatus("已取消上传");
        if (currentUpload) {
          appendTransferHistory({
            direction: "upload",
            status: "canceled",
            fileName: currentUpload.fileName,
            filePath: currentUpload.targetPath,
            size: currentUpload.size,
            localPath: currentUpload.localPath,
            message: "用户取消",
          });
        }
        return;
      }
      const detail = error instanceof Error ? error.message : "未知错误";
      setUploadFileQueue((prev) => prev.map((item) =>
        item.status === "uploading" ? { ...item, status: "error" as const } : item
      ));
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

  /* ---------- 上传冲突检测 ----------
     此前是静默覆盖：同名文件直接顶掉远端文件，没有任何提示。
     现在改成「先查目录、有冲突则挂起等用户确认」。
     无冲突时行为完全不变（不多一次对话框，也不阻塞）。 */
  const [uploadConflicts, setUploadConflicts] = useState<UploadConflictItem[] | null>(null);
  /* 逐文件队列：现有 uploadProgress 只有"当前文件"，50 个小文件卡在第 3 个时
     看不出是谁卡了。这里在每轮上传开始时初始化，逐文件推进。 */
  const [uploadFileQueue, setUploadFileQueue] = useState<Array<{
    name: string;
    size: number;
    transferred: number;
    status: "pending" | "uploading" | "done" | "error";
  }>>([]);
  const pendingUploadRef = useRef<{
    files: File[];
    localFiles: LocalUploadFile[] | null;
    perFile: Record<string, ConflictResolution>;
  } | null>(null);

  const cancelUploadConflicts = useCallback(() => {
    setUploadConflicts(null);
    pendingUploadRef.current = null;
  }, []);

  /** 检测同名文件。返回 null 表示无需确认（无冲突或检测失败 —— 失败时按原行为继续，
      不因为一次目录读失败就阻断上传）。 */
  const detectConflicts = useCallback(async (files: File[]): Promise<UploadConflictItem[] | null> => {
    if (!serverId || !directoryPath) return null;
    try {
      const listing = await apiGetDirectoryListing({ serverId, directoryPath });
      const existing = new Map(
        listing.entries
          .filter((entry) => entry.kind === "file")
          .map((entry) => [entry.name, entry.size ?? 0])
      );
      const items: UploadConflictItem[] = files.map((file) => {
        const name = getUploadRelativePath(file) || file.name;
        const existingSize = existing.get(name);
        return {
          name,
          incomingSize: file.size,
          existingSize,
          conflicted: existingSize !== undefined
        };
      });
      return items.some((item) => item.conflicted) ? items : null;
    } catch {
      /* 目录读不到（权限、路径不存在、网络抖动）→ 不做冲突拦截，
         沿原有流程上传，由上传本身报错。 */
      return null;
    }
  }, [serverId, directoryPath]);

  /** 实际执行上传（不含冲突检测）。fileList 已由调用方确认过冲突处理方式。 */
  const performUpload = useCallback(async (fileList: File[]) => {
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
    /* 开启本轮上传闸门（暂停/继续/取消的载体） */
    const gate = beginUploadGate();
    if (electronLocalFiles.every(Boolean)) {
      await uploadLocalFileList(electronLocalFiles as LocalUploadFile[], gate);
      return;
    }
    const skippedCount = skipped.length;
    const total = accepted.length;
    const totalBytes = getUploadBatchSize(accepted);
    /* 初始化逐文件队列：全部先标 pending，随循环推进 */
    setUploadFileQueue(
      accepted.map((file) => ({
        name: getUploadRelativePath(file) || file.name,
        size: file.size,
        transferred: 0,
        status: "pending" as const
      }))
    );
    const uploadDir = directoryPath.endsWith("/") ? directoryPath.slice(0, -1) : directoryPath;
    let currentUpload: { fileName: string; relativePath: string; localPath: string; targetPath: string; size: number } | null = null;
    let uploadedBefore = 0;
    const speedState = { sampleTime: Date.now(), sampleOffset: 0, speed: 0 };
    setActionStatus(`正在上传 ${total} 个文件${skippedCount ? `（已过滤 ${skippedCount} 个垃圾文件）` : ""}...`);
    /* 同 uploadLocalFileList：开始即刷新目标目录，正在上传的文件立刻可见 */
    void browseLogFiles(uploadDir, { silent: true });
    window.setTimeout(() => { void browseLogFiles(uploadDir, { silent: true }); }, 2000);
    try {
      for (let i = 0; i < accepted.length; i++) {
        /* 文件边界检查点：暂停时挂起，取消时抛 TransferCancelledError */
        await gate?.checkpoint();
        const file = accepted[i];
        const relativePath = getUploadRelativePath(file);
        const localPath = getUploadLocalPath(file);
        const targetPath = `${uploadDir}/${relativePath}`;
        currentUpload = { fileName: file.name, relativePath, localPath, targetPath, size: file.size };
        setUploadFileQueue((prev) => prev.map((item, index) =>
          index === i ? { ...item, status: "uploading" as const } : item
        ));
        setUploadProgress({
          current: getUploadPercent(uploadedBefore, totalBytes),
          total,
          fileName: `(${i + 1}/${total}) ${relativePath}`,
          currentFileName: relativePath.split("/").pop() || relativePath,
          currentTargetDir: uploadDir,
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
          targetDir: uploadDir,
          speedState,
        }, gate);
        uploadedBefore += file.size;
        setUploadFileQueue((prev) => prev.map((item, index) =>
          index === i ? { ...item, transferred: file.size, status: "done" as const } : item
        ));
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
      if (isUploadCanceled(error)) {
        /* 用户取消：不记为失败，仅提示已取消 */
        setActionStatus("已取消上传");
        if (currentUpload) {
          appendTransferHistory({
            direction: "upload",
            status: "canceled",
            fileName: currentUpload.fileName,
            filePath: currentUpload.targetPath,
            size: currentUpload.size,
            localPath: currentUpload.localPath,
            message: "用户取消",
          });
        }
        return;
      }
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

  /**
   * 上传入口：先检测同名冲突，有冲突则挂起等用户确认；无冲突直接开始。
   * pendingUploadRef 保存本次待上传内容，确认后走 confirmUpload。
   */
  /** 本地路径直传（Electron）的同名检测。返回 null 表示无需确认。 */
  const detectLocalFileConflicts = useCallback(async (
    localFiles: Array<{ name: string; size: number }>
  ): Promise<UploadConflictItem[] | null> => {
    if (!serverId || !directoryPath) return null;
    try {
      const listing = await apiGetDirectoryListing({ serverId, directoryPath });
      const existing = new Map(
        listing.entries
          .filter((entry) => entry.kind === "file")
          .map((entry) => [entry.name, entry.size ?? 0])
      );
      const items: UploadConflictItem[] = localFiles.map((file) => {
        const existingSize = existing.get(file.name);
        return {
          name: file.name,
          incomingSize: file.size,
          existingSize,
          conflicted: existingSize !== undefined
        };
      });
      return items.some((item) => item.conflicted) ? items : null;
    } catch {
      return null;
    }
  }, [serverId, directoryPath]);

  const uploadFileList = useCallback(async (fileList: File[]) => {
    if (!serverId || !directoryPath || fileList.length === 0) return;
    const { accepted } = splitUploadFiles(fileList);
    if (accepted.length === 0) {
      /* 全部被过滤：交给 performUpload 走原有的提示逻辑 */
      await performUpload(fileList);
      return;
    }
    const conflicts = await detectConflicts(accepted);
    if (conflicts) {
      pendingUploadRef.current = { files: accepted, localFiles: null, perFile: {} };
      setUploadConflicts(conflicts);
      return;
    }
    await performUpload(accepted);
  }, [serverId, directoryPath, performUpload, detectConflicts]);

  /**
   * 用户确认冲突处理：对 skip 的文件排除，对 rename 的加后缀，其余原样覆盖。
   */
  const confirmUpload = useCallback(async (options: {
    resolution: ConflictResolution;
    perFile?: Record<string, ConflictResolution>;
  }) => {
    const pending = pendingUploadRef.current;
    setUploadConflicts(null);
    pendingUploadRef.current = null;
    if (!pending) return;

    /* Electron 本地路径直传分支 */
    if (pending.localFiles && pending.localFiles.length > 0) {
      const resolutionOfLocal = (name: string): ConflictResolution =>
        (options.perFile || {})[name] ?? options.resolution;
      const kept = pending.localFiles.filter((file) => resolutionOfLocal(file.name) !== "skip");
      const skippedLocal = pending.localFiles.length - kept.length;
      if (skippedLocal > 0) {
        const message = `已跳过 ${skippedLocal} 个同名文件`;
        setActionStatus(message);
        pushActivity(message);
      }
      if (kept.length > 0) {
        await uploadLocalFileList(kept, beginUploadGate());
      }
      return;
    }

    const perFile = options.perFile || {};
    const resolutionOf = (file: File): ConflictResolution => {
      const name = getUploadRelativePath(file) || file.name;
      return perFile[name] ?? options.resolution;
    };

    const toUpload: File[] = [];
    let skippedCount = 0;
    for (const file of pending.files) {
      const resolution = resolutionOf(file);
      if (resolution === "skip") {
        skippedCount += 1;
        continue;
      }
      if (resolution === "rename") {
        /* 重命名走「加时间戳后缀」，不改文件内容；
           远端落点由 performUpload 用 file.name 推导，这里替换 name。 */
        const stamp = Date.now().toString().slice(-6);
        const dot = file.name.lastIndexOf(".");
        const renamed = dot > 0
          ? `${file.name.slice(0, dot)}.${stamp}${file.name.slice(dot)}`
          : `${file.name}.${stamp}`;
        toUpload.push(new File([file], renamed, { type: file.type, lastModified: file.lastModified }));
        continue;
      }
      toUpload.push(file);
    }

    if (skippedCount > 0) {
      const message = `已跳过 ${skippedCount} 个同名文件`;
      setActionStatus(message);
      pushActivity(message);
    }
    if (toUpload.length > 0) {
      await performUpload(toUpload);
    }
  }, [performUpload, setActionStatus, pushActivity]);

  const uploadFiles = useCallback(async () => {
    if (!serverId || !directoryPath) return;
    const electronAPI = (window as any).electronAPI;
    if (electronAPI?.localPickFiles) {
      const result = await electronAPI.localPickFiles();
      if (result?.ok && Array.isArray(result.files) && result.files.length > 0) {
        /* Electron 走本地路径直传，没有 File 对象；
           仍要做同名检测 —— 否则这条路径依旧是静默覆盖。 */
        const conflictItems = await detectLocalFileConflicts(result.files);
        if (conflictItems) {
          pendingUploadRef.current = {
            files: [],
            localFiles: result.files as LocalUploadFile[],
            perFile: {}
          };
          setUploadConflicts(conflictItems);
          return;
        }
        await uploadLocalFileList(result.files, beginUploadGate());
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
  }, [serverId, directoryPath, uploadFileList, uploadLocalFileList, beginUploadGate]);

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
    cancelDownload,
    /* 下载暂停/继续（2026-11-07）：与上传同一套闸门模型 */
    downloadPaused,
    pauseDownload,
    resumeDownload,
    uploadFiles,
    uploadFileList,
    uploadDirectory,
    handleFileDrop,
    /* 逐文件队列（供传输抽屉展示哪个文件卡住） */
    uploadFileQueue,
    /* 同名冲突检测（静默覆盖修复） */
    uploadConflicts,
    confirmUpload,
    cancelUploadConflicts,
    /* 上传流程控制（暂停 / 继续 / 取消） */
    uploadPaused,
    pauseUpload,
    resumeUpload,
    cancelUpload,
  };
}
