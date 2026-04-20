import { useState, useCallback } from "react";

export type AsyncStatusAPI = {
  isBusy: boolean;
  actionStatus: string;
  activityLines: string[];
  setIsBusy: (v: boolean) => void;
  setActionStatus: (v: string) => void;
  pushActivity: (message: string) => void;
  withBusy: <T>(message: string, task: () => Promise<T>, successMessage?: string) => Promise<T | null>;
};

export function useAsyncStatus(toasts: {
  showToast: (type: "loading" | "success" | "error", message: string) => string;
  updateToast: (id: string, type: "success" | "error", message: string) => void;
  dismissToast: (id: string) => void;
}): AsyncStatusAPI {
  const [isBusy, setIsBusy] = useState(false);
  const [actionStatus, setActionStatus] = useState("就绪，可开始检索日志。");
  const [activityLines, setActivityLines] = useState<string[]>(["系统已启动，等待选择服务器与日志文件。"]);

  const pushActivity = useCallback((message: string) => {
    const timestamp = new Date().toLocaleTimeString("zh-CN", { hour12: false });
    setActivityLines((current) => [...current.slice(-79), `[${timestamp}] ${message}`]);
  }, []);

  const withBusy = useCallback(<T>(message: string, task: () => Promise<T>, successMessage?: string): Promise<T | null> => {
    setIsBusy(true);
    setActionStatus(message);
    const tid = toasts.showToast("loading", message);

    return task()
      .then((result) => {
        if (successMessage) toasts.updateToast(tid, "success", successMessage);
        else toasts.dismissToast(tid);
        return result;
      })
      .catch((error: unknown) => {
        const detail = error instanceof Error ? error.message : "未知错误";
        setActionStatus(`操作失败：${detail}`);
        pushActivity(`操作失败：${detail}`);
        toasts.updateToast(tid, "error", `操作失败：${detail}`);
        return null;
      })
      .finally(() => {
        setIsBusy(false);
      });
  }, [toasts, pushActivity]);

  return { isBusy, actionStatus, activityLines, setIsBusy, setActionStatus, pushActivity, withBusy };
}
