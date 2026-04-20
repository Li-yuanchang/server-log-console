import { useState, useEffect, useRef } from "react";
import { LOCAL_SERVICE_RETRY_INTERVAL_MS } from "./types.js";
import { apiHealthCheck } from "./api.js";

export type LocalServiceAPI = {
  localServiceState: "checking" | "online" | "offline";
  localServiceStatusText: string;
  checkLocalServiceHealth: (options?: { silentFailure?: boolean; background?: boolean }) => Promise<boolean>;
};

export function useLocalService(params: {
  isElectron: boolean;
  setActionStatus: (v: string) => void;
  pushActivity: (message: string) => void;
  onServiceRestored?: () => Promise<void>;
}): LocalServiceAPI {
  const { isElectron, setActionStatus, pushActivity } = params;
  const [localServiceState, setLocalServiceState] = useState<"checking" | "online" | "offline">("checking");
  const [localServiceStatusText, setLocalServiceStatusText] = useState("正在检查本地连接服务...");
  const backgroundHealthCheckInFlightRef = useRef(false);

  async function checkLocalServiceHealth(options?: { silentFailure?: boolean; background?: boolean }) {
    if (!options?.background) {
      setLocalServiceState("checking");
      setLocalServiceStatusText("正在检查本地连接服务...");
    }

    try {
      await apiHealthCheck();
      setLocalServiceState("online");
      setLocalServiceStatusText("本地连接服务已启动");
      return true;
    } catch (error) {
      const detail = error instanceof Error ? error.message : "未知错误";
      setLocalServiceState("offline");
      setLocalServiceStatusText(isElectron ? "正在等待内置连接服务启动..." : "本地连接服务未启动");
      if (!options?.silentFailure) {
        setActionStatus(isElectron ? "正在等待内置连接服务启动..." : "本地连接服务未启动，请先启动本地服务。");
        pushActivity(`本地连接服务不可用：${detail}`);
      }
      return false;
    }
  }

  useEffect(() => {
    if (localServiceState !== "offline") {
      backgroundHealthCheckInFlightRef.current = false;
      return;
    }

    const timer = window.setInterval(() => {
      if (backgroundHealthCheckInFlightRef.current) {
        return;
      }

      backgroundHealthCheckInFlightRef.current = true;
      void (async () => {
        try {
          const ok = await checkLocalServiceHealth({ silentFailure: true, background: true });
          if (ok && params.onServiceRestored) {
            await params.onServiceRestored();
          }
        } finally {
          backgroundHealthCheckInFlightRef.current = false;
        }
      })();
    }, LOCAL_SERVICE_RETRY_INTERVAL_MS);

    return () => {
      backgroundHealthCheckInFlightRef.current = false;
      window.clearInterval(timer);
    };
  }, [localServiceState]);

  return { localServiceState, localServiceStatusText, checkLocalServiceHealth };
}
