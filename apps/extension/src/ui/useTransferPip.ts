import { useCallback, useEffect, useRef } from "react";
import type { UploadProgressState } from "./FeedbackOverlays.js";
import type { TransferProgressPayload } from "./TransferPipWindow.js";

/**
 * 上传进度小窗桥接（Electron only）
 *
 * 职责：
 * 1. 主窗口把 uploadProgress 变化推送给小窗（200ms 节流在 main.cjs 侧做）
 * 2. 订阅小窗发来的暂停/继续/取消指令，转交给已有的上传控制函数
 *
 * 为什么不做成"小窗直接操作上传"：上传状态机在 useFileTransfer 里，两个窗口
 * 各持一份会立刻分裂（暂停了但主窗口不知道）。所以小窗只发指令，状态只有一份。
 */

interface Options {
  enabled: boolean;
  uploadProgress: UploadProgressState | null;
  directoryPath: string;
  uploadPaused: boolean;
  onPause: () => void;
  onResume: () => void;
  onCancel: () => void;
  onStatus?: (message: string) => void;
}

export function useTransferPip(options: Options) {
  const { enabled, uploadProgress, directoryPath, uploadPaused, onPause, onResume, onCancel, onStatus } = options;
  /* 逐文件累积：uploadProgress 只带当前文件，这里按文件名累积成列表 */
  const filesRef = useRef<Map<string, { name: string; size: number; transferred: number; status: "pending" | "uploading" | "done" | "error" }>>(new Map());
  const lastStageRef = useRef<string>("");

  /** 打开小窗（用户点按钮时调用） */
  const openTransferWindow = useCallback(async () => {
    const bridge = (window as any).electronAPI;
    if (!bridge?.openTransferPip) {
      onStatus?.("当前形态不支持独立进度小窗（仅桌面版可用）");
      return;
    }
    const result = await bridge.openTransferPip({
      title: "传输进度",
      width: 360,
      height: 460,
      directoryPath
    });
    if (!result?.ok) {
      onStatus?.(result?.message || "打开进度小窗失败");
    }
  }, [directoryPath, onStatus]);

  /* 推送进度 */
  useEffect(() => {
    if (!enabled) return;
    const bridge = (window as any).electronAPI;
    if (!bridge?.sendTransferProgress) return;

    if (!uploadProgress) {
      /* 一轮结束：把累积表清空，避免下次上传看到旧文件 */
      if (filesRef.current.size > 0) {
        const stage = lastStageRef.current === "completed" ? "done" : "uploading";
        bridge.sendTransferProgress({
          directoryPath,
          stage,
          bytesUploaded: 0,
          totalBytes: 0,
          speed: 0,
          files: [...filesRef.current.values()]
        });
        filesRef.current.clear();
      }
      lastStageRef.current = "";
      return;
    }

    const name = uploadProgress.fileName || "未命名文件";
    const existing = filesRef.current.get(name);
    const transferred = uploadProgress.bytesUploaded ?? 0;
    filesRef.current.set(name, {
      name,
      size: uploadProgress.fileSize || existing?.size || 0,
      transferred,
      status: uploadProgress.stage === "completed" ? "done" : "uploading"
    });

    const totalFiles = uploadProgress.totalFiles ?? filesRef.current.size;
    const stage: TransferProgressPayload["stage"] =
      uploadProgress.stage === "completed" ? "done" : uploadProgress.stage === "preparing" ? "preparing" : "uploading";

    bridge.sendTransferProgress({
      directoryPath,
      stage,
      bytesUploaded: uploadProgress.current ?? transferred,
      totalBytes: uploadProgress.total || uploadProgress.fileSize || 0,
      speed: uploadProgress.speed || 0,
      paused: uploadPaused,
      files: [...filesRef.current.values()],
      /* totalFiles 只用于小窗显示 N/M，不参与计算 */
      ...(totalFiles ? {} : {})
    });
    lastStageRef.current = uploadProgress.stage || "";
  }, [enabled, uploadProgress, directoryPath, uploadPaused]);

  /* 订阅小窗控制指令 */
  useEffect(() => {
    if (!enabled) return;
    const bridge = (window as any).electronAPI;
    if (!bridge?.onTransferControl) return;
    const dispose = bridge.onTransferControl((action: string) => {
      if (action === "pause") {
        onPause();
        onStatus?.("已暂停上传（来自进度小窗）");
      } else if (action === "resume") {
        onResume();
        onStatus?.("已继续上传（来自进度小窗）");
      } else if (action === "cancel") {
        onCancel();
        onStatus?.("已取消上传（来自进度小窗）");
      }
    });
    return () => {
      try {
        dispose?.();
      } catch {
        /* 忽略 */
      }
    };
  }, [enabled, onPause, onResume, onCancel, onStatus]);

  return { openTransferWindow };
}
