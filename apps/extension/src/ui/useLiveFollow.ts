import { useEffect, useRef, useState } from "react";
import { localServiceBase } from "./api.js";
import { trimLiveContent } from "./utils.js";
import type { VirtualLogViewerHandle } from "./VirtualLogViewer.js";

export interface UseLiveFollowOptions {
  serverId: string;
  sliceContent: string | undefined;
  onStatus: (msg: string) => void;
  onActivity: (msg: string) => void;
  onReconnectNeeded: React.RefObject<((target: { filePath: string; fileName: string }) => void) | null>;
  viewerRef: React.RefObject<VirtualLogViewerHandle | null>;
}

export interface UseLiveFollowReturn {
  liveFollowEnabled: boolean;
  liveFollowConnected: boolean;
  liveFollowContent: string;
  liveFollowRetryCount: number;
  liveFollowPaused: boolean;
  viewerNotAtBottom: boolean;
  setLiveFollowPaused: React.Dispatch<React.SetStateAction<boolean>>;
  setLiveFollowContent: React.Dispatch<React.SetStateAction<string>>;
  startLiveFollow: (targetFilePath: string, targetFileName: string, options?: { isReconnect?: boolean; keyword?: string }) => void;
  stopLiveFollow: (options?: { keepContent?: boolean; preserveIntent?: boolean }) => void;
  handleViewerNearBottomChange: (nearBottom: boolean) => void;
  scrollViewerToBottom: () => void;
  clearLiveContent: () => void;
}

export function useLiveFollow(opts: UseLiveFollowOptions): UseLiveFollowReturn {
  const {
    serverId,
    sliceContent,
    onStatus,
    onActivity,
    onReconnectNeeded,
    viewerRef,
  } = opts;

  const [liveFollowEnabled, setLiveFollowEnabled] = useState(false);
  const [liveFollowConnected, setLiveFollowConnected] = useState(false);
  const [liveFollowContent, setLiveFollowContent] = useState("");
  const [liveFollowRetryCount, setLiveFollowRetryCount] = useState(0);
  const [liveFollowPaused, setLiveFollowPaused] = useState(false);
  const [viewerNotAtBottom, setViewerNotAtBottom] = useState(false);

  const sliceContentRef = useRef(sliceContent);
  sliceContentRef.current = sliceContent;

  const liveSocketRef = useRef<WebSocket | null>(null);
  const liveFollowReconnectTimerRef = useRef<number | null>(null);
  const liveFollowDesiredRef = useRef(false);
  const liveFollowTargetRef = useRef<{ filePath: string; fileName: string; keyword?: string } | null>(null);
  const liveFollowExpectedCloseRef = useRef(false);
  const liveFollowRetryCountRef = useRef(0);

  function clearLiveFollowReconnectTimer() {
    if (liveFollowReconnectTimerRef.current !== null) {
      window.clearTimeout(liveFollowReconnectTimerRef.current);
      liveFollowReconnectTimerRef.current = null;
    }
  }

  function scheduleLiveFollowReconnect(reason: string) {
    if (!liveFollowDesiredRef.current || !liveFollowTargetRef.current) {
      return;
    }

    clearLiveFollowReconnectTimer();
    const nextRetry = liveFollowRetryCountRef.current + 1;
    liveFollowRetryCountRef.current = nextRetry;
    const delay = Math.min(8000, 1200 * nextRetry);
    setLiveFollowRetryCount(nextRetry);
    setLiveFollowConnected(false);
    onStatus(`实时已断开，${Math.round(delay / 1000)} 秒后重连。`);
    onActivity(`实时已断开，准备重连：${reason}`);
    liveFollowReconnectTimerRef.current = window.setTimeout(() => {
      const target = liveFollowTargetRef.current;
      if (!liveFollowDesiredRef.current || !target) {
        return;
      }
      onReconnectNeeded.current?.(target);
    }, delay);
  }

  function stopLiveFollow(options?: { keepContent?: boolean; preserveIntent?: boolean }) {
    clearLiveFollowReconnectTimer();
    liveFollowExpectedCloseRef.current = true;
    liveSocketRef.current?.close();
    liveSocketRef.current = null;
    setLiveFollowConnected(false);
    if (!options?.preserveIntent) {
      liveFollowDesiredRef.current = false;
      liveFollowTargetRef.current = null;
      setLiveFollowEnabled(false);
      setLiveFollowRetryCount(0);
      liveFollowRetryCountRef.current = 0;
    }
    if (!options?.keepContent) {
      setLiveFollowContent("");
    }
  }

  function startLiveFollow(targetFilePath: string, targetFileName: string, options?: { isReconnect?: boolean; keyword?: string }) {
    if (!serverId || !targetFilePath.trim()) {
      return;
    }

    liveFollowDesiredRef.current = true;
    liveFollowTargetRef.current = { filePath: targetFilePath, fileName: targetFileName, keyword: options?.keyword };
    setLiveFollowPaused(false);
    liveFollowExpectedCloseRef.current = true;
    liveSocketRef.current?.close();
    liveSocketRef.current = null;
    clearLiveFollowReconnectTimer();
    setLiveFollowConnected(false);
    setLiveFollowEnabled(true);
    setLiveFollowContent((current) => trimLiveContent(current || sliceContentRef.current || ""));

    const wsUrl = localServiceBase.replace(/^http/, "ws") + "/ws/live";
    const socket = new WebSocket(wsUrl);
    liveSocketRef.current = socket;

    socket.addEventListener("open", () => {
      liveFollowExpectedCloseRef.current = false;
      const livePayload: Record<string, string> = {
        action: "start",
        serverId,
        filePath: targetFilePath
      };
      if (options?.keyword) {
        livePayload.keyword = options.keyword;
      }
      socket.send(JSON.stringify(livePayload));
      setLiveFollowConnected(true);
      setLiveFollowRetryCount(0);
      liveFollowRetryCountRef.current = 0;
      onStatus(options?.isReconnect ? `实时已重连：${targetFileName}` : `已开启实时跟随：${targetFileName}`);
      onActivity(options?.isReconnect ? `实时已重连：${targetFilePath}。` : `已开启实时跟随：${targetFilePath}。`);
    });

    socket.addEventListener("message", (event) => {
      try {
        const payload = JSON.parse(String(event.data)) as {
          type?: string;
          chunk?: string;
          message?: string;
        };

        if (payload.type === "error") {
          onStatus(`实时跟随失败：${payload.message || "未知错误"}`);
          onActivity(`实时跟随失败：${payload.message || "未知错误"}`);
          return;
        }

        if (payload.type === "closed") {
          setLiveFollowConnected(false);
          return;
        }

        if (payload.chunk) {
          setLiveFollowContent((current) => trimLiveContent(`${current || sliceContentRef.current || ""}${payload.chunk}`));
        }
      } catch (error) {
        onStatus(`实时跟随解析失败：${error instanceof Error ? error.message : "未知错误"}`);
      }
    });

    socket.addEventListener("close", () => {
      const isCurrentSocket = liveSocketRef.current === socket;
      if (isCurrentSocket) {
        liveSocketRef.current = null;
      }
      if (!isCurrentSocket) return;
      setLiveFollowConnected(false);
      if (liveFollowExpectedCloseRef.current) {
        liveFollowExpectedCloseRef.current = false;
        return;
      }
      scheduleLiveFollowReconnect("连接关闭");
    });

    socket.addEventListener("error", () => {
      if (liveSocketRef.current !== socket) return;
      onStatus("实时跟随连接异常。");
      onActivity(`实时跟随连接异常：${targetFilePath}。`);
    });
  }

  function handleViewerNearBottomChange(nearBottom: boolean) {
    setViewerNotAtBottom(!nearBottom);
    if (liveFollowEnabled) {
      setLiveFollowPaused(!nearBottom);
    }
  }

  function scrollViewerToBottom() {
    setViewerNotAtBottom(false);
    if (liveFollowEnabled) {
      setLiveFollowPaused(false);
    }
    window.requestAnimationFrame(() => {
      viewerRef.current?.scrollToBottom();
    });
  }

  function clearLiveContent() {
    setLiveFollowContent("");
  }

  useEffect(() => () => {
    clearLiveFollowReconnectTimer();
    liveFollowExpectedCloseRef.current = true;
    liveSocketRef.current?.close();
    liveSocketRef.current = null;
  }, []);

  return {
    liveFollowEnabled,
    liveFollowConnected,
    liveFollowContent,
    liveFollowRetryCount,
    liveFollowPaused,
    viewerNotAtBottom,
    setLiveFollowPaused,
    setLiveFollowContent,
    startLiveFollow,
    stopLiveFollow,
    handleViewerNearBottomChange,
    scrollViewerToBottom,
    clearLiveContent,
  };
}
