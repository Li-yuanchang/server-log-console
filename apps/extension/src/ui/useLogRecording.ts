import { useCallback } from "react";
import type { PreviewDialogState } from "./FilePreviewDialog.js";
import { apiStartLogRecording, apiStopLogRecording, apiPreviewFile, type LogRecordingSessionResponse } from "./api.js";

export type LogRecordingAPI = {
  startLogRecording: () => Promise<void>;
  stopLogRecording: () => Promise<void>;
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function useLogRecording(deps: {
  serverId: string;
  filePath: string;
  directoryPath: string;
  recordingSession: LogRecordingSessionResponse | null;
  setRecordingSession: (v: LogRecordingSessionResponse | null) => void;
  setPreviewDialog: (v: PreviewDialogState | null | ((prev: PreviewDialogState | null) => PreviewDialogState | null)) => void;
  setActionStatus: (s: string) => void;
  pushActivity: (a: string) => void;
  showToast: (type: "success" | "error" | "loading", message: string) => string | number;
  updateToast: (id: string, type: "success" | "error" | "loading", message: string) => void;
}): LogRecordingAPI {
  const {
    serverId,
    filePath,
    directoryPath,
    recordingSession,
    setRecordingSession,
    setPreviewDialog,
    setActionStatus,
    pushActivity,
    showToast,
    updateToast,
  } = deps;

  const startLogRecording = useCallback(async () => {
    if (!serverId || !filePath.trim()) {
      return;
    }

    setActionStatus("正在开始录制日志...");
    const tid = String(showToast("loading", "正在开始录制日志..."));
    try {
      const payload = await apiStartLogRecording(serverId, filePath, directoryPath || undefined);
      setRecordingSession(payload);
      setActionStatus(`已开始录制：${payload.outputPath.split("/").pop() || payload.outputPath}`);
      pushActivity(`开始录制日志：${payload.sourcePath} → ${payload.outputPath}`);
      updateToast(tid, "success", "录制已开始");
    } catch (error) {
      const detail = error instanceof Error ? error.message : "未知错误";
      setActionStatus(`录制启动失败：${detail}`);
      pushActivity(`录制启动失败：${detail}`);
      updateToast(tid, "error", `录制启动失败：${detail}`);
    }
  }, [serverId, filePath, directoryPath, setRecordingSession, setActionStatus, pushActivity, showToast, updateToast]);

  const stopLogRecording = useCallback(async () => {
    if (!recordingSession || !serverId) {
      return;
    }

    setActionStatus("正在结束录制日志...");
    const tid = String(showToast("loading", "正在结束录制日志..."));
    try {
      const payload = await apiStopLogRecording(recordingSession.sessionId);
      setRecordingSession(null);
      const recordFileName = payload.outputPath.split("/").pop() || "record.log";
      setPreviewDialog({
        filePath: payload.outputPath,
        fileName: recordFileName,
        content: "",
        originalContent: "",
        size: payload.sizeBytes,
        loading: true,
        readOnly: true,
      });
      try {
        const preview = await apiPreviewFile(serverId, payload.outputPath);
        setPreviewDialog({
          filePath: preview.filePath,
          fileName: recordFileName,
          content: preview.content,
          originalContent: preview.content,
          size: preview.size,
          readOnly: true,
        });
      } catch (previewError) {
        const detail = previewError instanceof Error ? previewError.message : "加载失败";
        setPreviewDialog((prev) => prev ? { ...prev, loading: false, content: `/* 加载预览失败：${detail} */\n/* 可尝试下载文件查看完整内容 */`, originalContent: "" } : null);
      }
      setActionStatus(`录制完成，已打开 ${recordFileName}`);
      pushActivity(`结束录制日志：${payload.outputPath}（${formatBytes(payload.sizeBytes)}）`);
      updateToast(tid, "success", `录制完成：${recordFileName}`);
    } catch (error) {
      const detail = error instanceof Error ? error.message : "未知错误";
      setRecordingSession(null);
      setActionStatus(`结束录制失败：${detail}`);
      pushActivity(`结束录制失败：${detail}`);
      updateToast(tid, "error", `结束录制失败：${detail}`);
    }
  }, [serverId, recordingSession, setRecordingSession, setPreviewDialog, setActionStatus, pushActivity, showToast, updateToast]);

  return {
    startLogRecording,
    stopLogRecording,
  };
}
