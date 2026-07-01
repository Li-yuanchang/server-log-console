import { useCallback } from "react";
import {
  clearTransferHistory,
  type TransferHistoryEntry,
  pushTransferHistory,
  readTransferHistory,
} from "./storage.js";
import { copyText } from "./utils.js";

export type TransferHistoryAPI = {
  appendTransferHistory: (entry: Omit<TransferHistoryEntry, "id" | "serverId" | "serverLabel" | "createdAt">) => void;
  handleClearTransferHistory: () => void;
  requestClearTransferHistory: () => void;
  handleBrowseTransferHistoryPath: (path: string) => void;
  handleCopyTransferHistoryValue: (value: string, label: string) => Promise<void>;
  handleRevealTransferHistoryLocalPath: (targetPath: string) => Promise<void>;
};

export function useTransferHistory(deps: {
  serverId: string;
  selectedServer: { name?: string; host?: string } | null;
  transferHistory: TransferHistoryEntry[];
  currentServerTransferHistory: TransferHistoryEntry[];
  setTransferHistory: (entries: TransferHistoryEntry[]) => void;
  setActionStatus: (status: string) => void;
  pushActivity: (activity: string) => void;
  showToast: (type: "success" | "error" | "loading", message: string) => string | number;
  setConfirmDialog: (dialog: { title: string; message: string; danger: boolean; onConfirm: () => void } | null) => void;
  setShowTransferHistory: (show: boolean) => void;
  browseLogFiles: (path: string, options?: { manual?: boolean; silent?: boolean }) => Promise<void>;
  isElectron: boolean;
}): TransferHistoryAPI {
  const {
    serverId,
    selectedServer,
    transferHistory,
    currentServerTransferHistory,
    setTransferHistory,
    setActionStatus,
    pushActivity,
    showToast,
    setConfirmDialog,
    setShowTransferHistory,
    browseLogFiles,
  } = deps;

  const serverLabel = selectedServer?.name || selectedServer?.host || serverId || "当前服务器";

  const appendTransferHistory = useCallback(
    (entry: Omit<TransferHistoryEntry, "id" | "serverId" | "serverLabel" | "createdAt">) => {
      if (!serverId) {
        return;
      }

      const nextEntry: TransferHistoryEntry = {
        ...entry,
        id: globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        serverId,
        serverLabel: selectedServer?.name || selectedServer?.host || serverId,
        createdAt: new Date().toISOString(),
      };
      pushTransferHistory(nextEntry);
      setTransferHistory(readTransferHistory());
    },
    [serverId, selectedServer?.name, selectedServer?.host, setTransferHistory]
  );

  const handleClearTransferHistory = useCallback(() => {
    const count = serverId ? transferHistory.filter((entry) => entry.serverId === serverId).length : 0;
    clearTransferHistory(serverId || undefined);
    setTransferHistory(readTransferHistory());
    if (count > 0) {
      setActionStatus(`已清空 ${serverLabel} 的传输记录`);
      pushActivity(`已清空传输记录：${serverLabel}（${count} 条）`);
      showToast("success", `已清空 ${count} 条传输记录`);
    }
  }, [serverId, transferHistory, serverLabel, setTransferHistory, setActionStatus, pushActivity, showToast]);

  const requestClearTransferHistory = useCallback(() => {
    if (!currentServerTransferHistory.length) {
      return;
    }
    setConfirmDialog({
      title: "清空传输记录",
      message: `确定清空当前服务器的 ${currentServerTransferHistory.length} 条传输记录？`,
      danger: true,
      onConfirm: () => handleClearTransferHistory(),
    });
  }, [currentServerTransferHistory.length, handleClearTransferHistory, setConfirmDialog]);

  const handleBrowseTransferHistoryPath = useCallback(
    (path: string) => {
      setShowTransferHistory(false);
      void browseLogFiles(path, { manual: true });
    },
    [browseLogFiles, setShowTransferHistory]
  );

  const handleCopyTransferHistoryValue = useCallback(
    async (value: string, label: string) => {
      try {
        await copyText(value);
        setActionStatus(`已复制${label}`);
        showToast("success", `已复制${label}`);
      } catch (error) {
        const detail = error instanceof Error ? error.message : "未知错误";
        setActionStatus(`复制${label}失败：${detail}`);
        showToast("error", `复制${label}失败：${detail}`);
      }
    },
    [setActionStatus, showToast]
  );

  const handleRevealTransferHistoryLocalPath = useCallback(
    async (targetPath: string) => {
      try {
        const api = (window as any).electronAPI;
        if (!api?.revealLocalPath) {
          throw new Error("当前环境不支持定位本地文件");
        }
        const result = await api.revealLocalPath(targetPath);
        if (!result?.ok) {
          throw new Error(result?.message || "无法定位本地文件");
        }
        const fileName = targetPath.split(/[/\\]/).pop() || targetPath;
        setActionStatus(`已在 Finder 中显示 ${fileName}`);
        pushActivity(`已定位本地文件：${targetPath}`);
        showToast("success", `已在 Finder 中显示 ${fileName}`);
      } catch (error) {
        const detail = error instanceof Error ? error.message : "未知错误";
        setActionStatus(`定位本地文件失败：${detail}`);
        showToast("error", `定位本地文件失败：${detail}`);
      }
    },
    [setActionStatus, pushActivity, showToast]
  );

  return {
    appendTransferHistory,
    handleClearTransferHistory,
    requestClearTransferHistory,
    handleBrowseTransferHistoryPath,
    handleCopyTransferHistoryValue,
    handleRevealTransferHistoryLocalPath,
  };
}
