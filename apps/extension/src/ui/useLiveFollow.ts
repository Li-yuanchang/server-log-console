import { useEffect, useRef, useState } from "react";
import { getGatewayToken, localServiceBase } from "./api.js";
import { trimLiveContent } from "./utils.js";
import type { VirtualLogViewerHandle } from "./VirtualLogViewer.js";

/** 实时内容刷新的最小间隔（ms）：攒批上限节奏，约 10 帧/秒 */
const LIVE_FLUSH_INTERVAL = 100;

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
  const forceBottomUntilRef = useRef(0);
  // 高吞吐日志下 gateway 每个 SSH data 事件推一条 WS 消息；先攒批再按固定节奏
  // 刷进 state，把渲染频率从"每消息一次"压到 ~10 次/秒，避免全量重算打满主线程。
  const pendingLiveChunkRef = useRef("");
  const liveFlushTimerRef = useRef<number | null>(null);

  function flushPendingLiveChunks() {
    liveFlushTimerRef.current = null;
    const pending = pendingLiveChunkRef.current;
    if (!pending) return;
    pendingLiveChunkRef.current = "";
    setLiveFollowContent((current) => trimLiveContent(`${current || sliceContentRef.current || ""}${pending}`));
  }

  function scheduleLiveFlush() {
    if (liveFlushTimerRef.current !== null) return;
    liveFlushTimerRef.current = window.setTimeout(flushPendingLiveChunks, LIVE_FLUSH_INTERVAL);
  }

  function clearLiveFlushTimer() {
    if (liveFlushTimerRef.current !== null) {
      window.clearTimeout(liveFlushTimerRef.current);
      liveFlushTimerRef.current = null;
    }
  }

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
      clearLiveFlushTimer();
      pendingLiveChunkRef.current = "";
      setLiveFollowContent("");
    } else {
      // 保留内容时把已接收未刷入的尾巴落进 state，避免丢最后一段
      clearLiveFlushTimer();
      flushPendingLiveChunks();
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
    // 新会话从头基于切片内容累积，丢弃上一会话残留的未刷入数据
    clearLiveFlushTimer();
    pendingLiveChunkRef.current = "";
    setLiveFollowConnected(false);
    setLiveFollowEnabled(true);
    setLiveFollowContent((current) => trimLiveContent(current || sliceContentRef.current || ""));

    const wsToken = getGatewayToken();
    const wsUrl = localServiceBase.replace(/^http/, "ws") + "/ws/live" + (wsToken ? `?token=${encodeURIComponent(wsToken)}` : "");
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
          pendingLiveChunkRef.current += payload.chunk;
          scheduleLiveFlush();
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
    if (!nearBottom && Date.now() < forceBottomUntilRef.current) {
      return;
    }
    setViewerNotAtBottom(!nearBottom);
    if (liveFollowEnabled) {
      setLiveFollowPaused(!nearBottom);
    }
  }

  function scrollViewerToBottom() {
    forceBottomUntilRef.current = Date.now() + 900;
    setViewerNotAtBottom(false);
    if (liveFollowEnabled) {
      setLiveFollowPaused(false);
    }
    // 两次兜底足够：立即 + 一帧后（等 Virtuoso 完成本轮测量），
    // 更多频次的强制滚动会和 followOutput 互相打架造成抖动
    window.requestAnimationFrame(() => {
      viewerRef.current?.scrollToBottom();
      window.setTimeout(() => viewerRef.current?.scrollToBottom(), 150);
    });
  }

  function clearLiveContent() {
    setLiveFollowContent("");
  }

  useEffect(() => () => {
    clearLiveFollowReconnectTimer();
    clearLiveFlushTimer();
    liveFollowExpectedCloseRef.current = true;
    liveSocketRef.current?.close();
    liveSocketRef.current = null;
  }, []);

  // bfcache 恢复（浏览器前进/后退缓存）会把页面冻结，WebSocket 死掉且 close
  // 事件可能被吞掉；恢复时若实时跟随意图仍在但 socket 已死，强制补一次重连。
  useEffect(() => {
    const onPageShow = (event: PageTransitionEvent) => {
      if (!liveFollowDesiredRef.current || !liveFollowTargetRef.current) return;
      const socket = liveSocketRef.current;
      if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) return;
      scheduleLiveFollowReconnect(event.persisted ? "页面从缓存恢复" : "页面重新可见");
    };
    window.addEventListener("pageshow", onPageShow);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") onPageShow(new PageTransitionEvent("pageshow"));
    });
    return () => {
      window.removeEventListener("pageshow", onPageShow);
    };
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
