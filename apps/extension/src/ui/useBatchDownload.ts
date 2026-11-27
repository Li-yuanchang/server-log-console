import { useCallback, useRef, useState, type Dispatch, type SetStateAction } from "react";
import type { FileTreeEntry, LogFileEntry } from "@server-log-console/shared";
import { apiDownloadFile, apiGetDirectoryTree } from "./api.js";
import type { DownloadProgressState } from "./FeedbackOverlays.js";
import type { TransferHistoryEntry } from "./storage.js";
import { TransferGate, TransferCancelledError } from "./transferControl.js";

/**
 * 批量 / 目录下载（2026-11-24，用户反馈「缺少批量下载 / 勾选目录无法下载」）。
 *
 * 与单文件下载（useFileTransfer.downloadFile）的分工：
 *   - 单文件：一次流 → 内容堆在内存 → 弹原生「保存到」对话框。文件小、交互明确。
 *   - 批量/目录：先递归列树 → 选一次目标文件夹 → 逐文件流式取回并**立即落盘**。
 *     不能沿用单文件做法：几十个文件逐个弹保存框是灾难；把整批内容堆在内存里
 *     又会在大目录上打爆渲染进程（本项目已有 11GB 日志检索爆内存的前车之鉴）。
 *
 * 落盘走 Electron 主进程 IPC（save-file-to-directory）：目标目录下的相对结构由
 * 主进程建目录、同名自动加后缀，前端不接触本地路径拼接。
 *
 * 暂停/继续/取消沿用 TransferGate 检查点模型：在文件边界生效（单个文件的流无法
 * 中途暂停——HTTP 流一旦开始读，停下只会让 TCP 背压，落盘也已经写了半截）。
 */

type BatchTarget = {
  /** 远端绝对路径 */
  remotePath: string;
  /** 相对目标文件夹的落盘路径 */
  relativePath: string;
  size?: number;
};

export type BatchDownloadAPI = {
  /** 勾选项 / 右键项 → 选一次落点 → 全部下载。空数组时不做任何事。 */
  downloadEntries: (entries: LogFileEntry[], options?: { serverId?: string }) => Promise<void>;
  cancelBatchDownload: () => void;
  batchDownloadPaused: boolean;
  pauseBatchDownload: () => void;
  resumeBatchDownload: () => void;
};

const TREE_MAX_ENTRIES = 20000;
const BATCH_SPEED_SAMPLE_MS = 400;

function getElectronAPI(): any {
  return (globalThis as any).electronAPI;
}

function joinRelative(...segments: Array<string | undefined>): string {
  return segments
    .map((segment) => String(segment ?? "").replace(/^\/+|\/+$/g, ""))
    .filter(Boolean)
    .join("/");
}

/** 把「勾选的条目集合」展开成扁平文件清单。目录递归取树，文件直接用自身。 */
async function collectBatchTargets(
  entries: LogFileEntry[],
  serverId: string,
  onProgress: (message: string) => void,
): Promise<{ targets: BatchTarget[]; truncated: boolean; totalBytes: number }> {
  const targets: BatchTarget[] = [];
  let truncated = false;

  for (const entry of entries) {
    if (entry.kind === "file") {
      targets.push({ remotePath: entry.path, relativePath: entry.name, size: entry.size });
      continue;
    }
    onProgress(`正在读取目录 ${entry.name}…`);
    const tree = await apiGetDirectoryTree({
      serverId,
      directoryPath: entry.path,
      maxEntries: TREE_MAX_ENTRIES,
    });
    if (tree.truncated) truncated = true;
    /* 目录自身作为顶层文件夹落到本地：Dao/ 下的 a.class → Dao/a.class */
    for (const child of tree.entries as FileTreeEntry[]) {
      if (child.kind !== "file") continue;
      targets.push({
        remotePath: child.path,
        relativePath: joinRelative(entry.name, child.relativePath),
        size: child.size,
      });
    }
  }

  const totalBytes = targets.reduce((sum, target) => sum + (target.size ?? 0), 0);
  return { targets, truncated, totalBytes };
}

function isCancelError(error: unknown): boolean {
  return error instanceof TransferCancelledError
    || (error instanceof Error && (error.name === "AbortError" || error.message.includes("取消")));
}

export function useBatchDownload(deps: {
  serverId: string;
  setDownloadProgress: Dispatch<SetStateAction<DownloadProgressState | null>>;
  setActionStatus: (s: string) => void;
  pushActivity: (a: string) => void;
  showToast: (type: "success" | "error" | "loading", message: string) => string | number;
  appendTransferHistory: (entry: Omit<TransferHistoryEntry, "id" | "serverId" | "serverLabel" | "createdAt">) => void;
}): BatchDownloadAPI {
  const {
    serverId,
    setDownloadProgress,
    setActionStatus,
    pushActivity,
    showToast,
    appendTransferHistory,
  } = deps;

  /* 批次闸门与取消载体：与 useFileTransfer 的单文件下载各持一套，互不干扰。
     （两者同时跑会争 setDownloadProgress，但 UI 上用户不会同时触发；
       这里的 progress 带 fileIndex/totalFiles，抽屉能分辨出是批次。） */
  const gateRef = useRef<TransferGate | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [batchDownloadPaused, setBatchDownloadPaused] = useState(false);

  const cancelBatchDownload = useCallback(() => {
    gateRef.current?.cancel();
    abortRef.current?.abort();
    setBatchDownloadPaused(false);
    setActionStatus("正在取消批量下载…");
  }, [setActionStatus]);

  const pauseBatchDownload = useCallback(() => {
    const gate = gateRef.current;
    if (!gate || gate.isCancelled || gate.isPaused) return;
    gate.pause();
    setBatchDownloadPaused(true);
    setDownloadProgress((prev) => (prev ? { ...prev, paused: true } : prev));
    setActionStatus("批量下载已暂停（当前文件传完后停住）");
  }, [setActionStatus, setDownloadProgress]);

  const resumeBatchDownload = useCallback(() => {
    const gate = gateRef.current;
    if (!gate || gate.isCancelled || !gate.isPaused) return;
    gate.resume();
    setBatchDownloadPaused(false);
    setDownloadProgress((prev) => (prev ? { ...prev, paused: false } : prev));
    setActionStatus("继续批量下载…");
  }, [setActionStatus, setDownloadProgress]);

  const downloadEntries = useCallback(async (entries: LogFileEntry[], options?: { serverId?: string }) => {
    const effectiveServerId = options?.serverId || serverId;
    if (!effectiveServerId || entries.length === 0) return;

    const api = getElectronAPI();
    if (!api?.pickDownloadDirectory || !api?.openDownloadFile || !api?.writeDownloadFile || !api?.closeDownloadFile) {
      /* 浏览器 / 扩展环境没有「写指定目录」的能力。此时退化为逐个单文件下载
         会退化成连续弹保存框，体验极差且容易下错位置 —— 明确告知不支持，
         不静默做一件用户没预期的事。 */
      const message = "批量下载需在桌面客户端中使用（浏览器扩展不支持选择保存文件夹）";
      setActionStatus(message);
      showToast("error", message);
      return;
    }

    const picked = await api.pickDownloadDirectory();
    if (!picked?.ok || !picked.path) {
      if (!picked?.canceled) {
        const message = picked?.message || "未选择保存位置";
        setActionStatus(message);
        showToast("error", message);
      }
      return;
    }
    const rootDir = String(picked.path);

    /* 展开目标清单。单目录勾选时也要递归（这正是本次反馈的核心诉求）。 */
    setActionStatus("正在统计待下载文件…");
    let batch: Awaited<ReturnType<typeof collectBatchTargets>>;
    try {
      batch = await collectBatchTargets(entries, effectiveServerId, setActionStatus);
    } catch (error) {
      const detail = error instanceof Error ? error.message : "未知错误";
      setActionStatus(`读取目录失败：${detail}`);
      showToast("error", `读取目录失败：${detail}`);
      return;
    }
    if (batch.targets.length === 0) {
      const message = "选中的目录里没有可下载的文件";
      setActionStatus(message);
      showToast("success", message);
      return;
    }

    const gate = new TransferGate();
    const controller = new AbortController();
    gateRef.current = gate;
    abortRef.current = controller;
    setBatchDownloadPaused(false);

    const { targets, totalBytes } = batch;
    const totalFiles = targets.length;
    let completedBytes = 0;
    let completedFiles = 0;
    const failedFiles: string[] = [];
    const startedAt = Date.now();

    setActionStatus(`正在下载 ${totalFiles} 个文件…`);

    try {
      for (let index = 0; index < targets.length; index += 1) {
        /* 文件边界检查点：这里是**唯一**能安全停住的位置 */
        await gate.checkpoint();
        const target = targets[index];
        const fileName = target.remotePath.split("/").pop() || target.relativePath;
        const fileBytes = target.size ?? 0;
        let receivedForFile = 0;
        let speedSampleTime = Date.now();
        let speedSampleBytes = completedBytes;
        let speed = 0;

        setDownloadProgress({
          fileName: `(${index + 1}/${totalFiles}) ${target.relativePath}`,
          currentFileName: fileName,
          filePath: target.remotePath,
          fileSize: totalBytes,
          bytesDownloaded: completedBytes,
          speed: 0,
          percent: totalBytes > 0 ? Math.round((completedBytes / totalBytes) * 100) : Math.round((completedFiles / totalFiles) * 100),
          paused: false,
          fileIndex: index + 1,
          totalFiles,
        });

        try {
          /* 先建本地文件，chunk 边到边写 —— 内容不整份驻留渲染进程 */
          const opened = await api.openDownloadFile({
            rootDir,
            relativePath: target.relativePath,
          });
          if (!opened?.ok || !opened.handleId) {
            throw new Error(opened?.message || "无法创建本地文件");
          }
          const handleId = String(opened.handleId);

          let writeChain = Promise.resolve();
          let savedPath = String(opened.filePath || target.relativePath);
          let writeError: Error | null = null;

          try {
            await apiDownloadFile(effectiveServerId, target.remotePath, {
              /* 写入串行化：onChunk 是同步回调，不能 await；用 promise 链保证
                 分片按到达顺序落盘（并发写会乱序损坏文件）。 */
              onChunk: (chunk) => {
                writeChain = writeChain.then(async () => {
                  const written = await api.writeDownloadFile(handleId, chunk);
                  if (!written?.ok) {
                    writeError = new Error(written?.message || "写入本地文件失败");
                  }
                });
              },
              onProgress: (downloaded, _total, liveSpeed) => {
                receivedForFile = downloaded;
                const now = Date.now();
                const elapsed = now - speedSampleTime;
                if (elapsed >= BATCH_SPEED_SAMPLE_MS) {
                  const delta = completedBytes + downloaded - speedSampleBytes;
                  if (delta > 0) {
                    speed = (delta / elapsed) * 1000;
                    speedSampleTime = now;
                    speedSampleBytes = completedBytes + downloaded;
                  }
                } else if (liveSpeed > 0) {
                  speed = liveSpeed;
                }
                /* 对外统一用「整批已传字节」：这张进度卡是批次级的，
                   bytesDownloaded 若只放当前文件字节，抽屉上就会出现
                   「3KB / 412MB」这种自相矛盾的读数。 */
                const overallBytes = completedBytes + downloaded;
                setDownloadProgress({
                  fileName: `(${index + 1}/${totalFiles}) ${target.relativePath}`,
                  currentFileName: fileName,
                  filePath: target.remotePath,
                  fileSize: totalBytes,
                  bytesDownloaded: overallBytes,
                  speed,
                  percent: totalBytes > 0
                    ? Math.round((overallBytes / totalBytes) * 100)
                    : Math.round(((completedFiles + (fileBytes > 0 ? downloaded / fileBytes : 0)) / totalFiles) * 100),
                  paused: gate.isPaused,
                  fileIndex: index + 1,
                  totalFiles,
                });
              },
              signal: controller.signal,
              gate,
            });

            await writeChain;
            if (writeError) throw writeError;
            const closed = await api.closeDownloadFile(handleId, true);
            if (!closed?.ok) throw new Error(closed?.message || "完成本地文件失败");
            savedPath = String(closed.filePath || savedPath);
          } catch (error) {
            /* 任何中断（取消 / 网络失败 / 写盘失败）：丢弃半截文件，别留坏文件 */
            await writeChain;
            await api.closeDownloadFile(handleId, false);
            throw error;
          }

          completedFiles += 1;
          completedBytes += receivedForFile;
          pushActivity(`已下载：${target.remotePath} → ${savedPath}`);
          appendTransferHistory({
            direction: "download",
            status: "success",
            fileName,
            filePath: target.remotePath,
            size: receivedForFile,
            localPath: savedPath,
            message: totalFiles > 1 ? `批量下载（${completedFiles}/${totalFiles}）` : undefined,
          });
        } catch (error) {
          if (isCancelError(error)) throw error;
          const detail = error instanceof Error ? error.message : "未知错误";
          failedFiles.push(`${target.relativePath}（${detail}）`);
          appendTransferHistory({
            direction: "download",
            status: "error",
            fileName,
            filePath: target.remotePath,
            size: receivedForFile,
            message: detail,
          });
          /* 单个文件失败不终止整批：一份 300 个文件的目录里有一个没权限，
             不该让用户重下另外 299 个。失败清单在收尾时汇总提示。 */
        }
      }

      setDownloadProgress(null);
      const elapsedSeconds = Math.max(1, Math.round((Date.now() - startedAt) / 1000));
      if (failedFiles.length === 0) {
        const message = `已下载 ${completedFiles} 个文件到 ${rootDir}（用时 ${elapsedSeconds}s）`;
        setActionStatus(message);
        pushActivity(`批量下载完成：${completedFiles} 个文件 → ${rootDir}`);
        showToast("success", batch.truncated
          ? `${message}；目录项过多，仅下载了前 ${TREE_MAX_ENTRIES} 项`
          : message);
      } else {
        const message = `已下载 ${completedFiles} 个文件，${failedFiles.length} 个失败`;
        setActionStatus(message);
        pushActivity(`批量下载部分失败：${failedFiles.slice(0, 5).join(" | ")}${failedFiles.length > 5 ? ` … 等 ${failedFiles.length} 项` : ""}`);
        showToast("error", `${message}：${failedFiles[0]}`);
      }
    } catch (error) {
      setDownloadProgress(null);
      if (isCancelError(error) || controller.signal.aborted) {
        setActionStatus(`已取消批量下载（已完成 ${completedFiles}/${totalFiles}）`);
        pushActivity(`已取消批量下载：已完成 ${completedFiles}/${totalFiles}，落点 ${rootDir}`);
        showToast("success", `已取消，已完成 ${completedFiles} 个文件`);
      } else {
        const detail = error instanceof Error ? error.message : "未知错误";
        setActionStatus(`批量下载失败：${detail}`);
        pushActivity(`批量下载失败：${detail}`);
        showToast("error", `批量下载失败：${detail}`);
      }
    } finally {
      if (gateRef.current === gate) gateRef.current = null;
      if (abortRef.current === controller) abortRef.current = null;
      setBatchDownloadPaused(false);
      setDownloadProgress((prev) => (prev && prev.totalFiles ? null : prev));
    }
  }, [serverId, setDownloadProgress, setActionStatus, pushActivity, showToast, appendTransferHistory]);

  return {
    downloadEntries,
    cancelBatchDownload,
    batchDownloadPaused,
    pauseBatchDownload,
    resumeBatchDownload,
  };
}