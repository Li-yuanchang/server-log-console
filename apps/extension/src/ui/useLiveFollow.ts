import { useEffect, useRef, useState } from "react";
import { getGatewayToken, localServiceBase } from "./api.js";
import { trimLiveContent } from "./utils.js";
import type { VirtualLogViewerHandle } from "./VirtualLogViewer.js";

/** 实时内容刷新的最小间隔（ms）：攒批上限节奏，约 10 帧/秒 */
const LIVE_FLUSH_INTERVAL = 100;

/** 手动点击「回到底部」后的点击优先窗口（ms）。
    窗口期内 nearBottom=false 一律忽略：实时追加每 100ms 一批，贴底是逐帧收敛的，
    中途几乎必然出现一次「还没贴底」的上报；若不压住，跟随会被立刻重新暂停，
    重钉随即被当成用户滚动让位 → 表现就是「点了没反应 / 点好几次」。
    窗口取 1200ms（略长于 settleScrollTo 的 60 帧 ≈ 1s 上限），保证收敛跑完。 */
const MANUAL_BOTTOM_PRIORITY_MS = 1200;

/** 「跳转中」状态的最短可见时长（ms）。真贴底常 80ms 内就完成，
    不留这个下限的话 spinner 只闪一帧，用户仍感知不到"点到了"。 */
const JUMPING_MIN_VISIBLE_MS = 360;

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
  /** 手动「回到底部」收敛窗口内为 true —— 按钮据此显示「正在跳转」反馈 */
  viewerJumping: boolean;
  setLiveFollowPaused: React.Dispatch<React.SetStateAction<boolean>>;
  setLiveFollowContent: React.Dispatch<React.SetStateAction<string>>;
  startLiveFollow: (targetFilePath: string, targetFileName: string, options?: { isReconnect?: boolean; keyword?: string }) => void;
  stopLiveFollow: (options?: { keepContent?: boolean; preserveIntent?: boolean }) => void;
  handleViewerNearBottomChange: (nearBottom: boolean) => void;
  scrollViewerToBottom: (options?: { optimisticHide?: boolean; manual?: boolean }) => void;
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
  const [viewerJumping, setViewerJumping] = useState(false);

  const sliceContentRef = useRef(sliceContent);
  sliceContentRef.current = sliceContent;

  const liveSocketRef = useRef<WebSocket | null>(null);
  const liveFollowReconnectTimerRef = useRef<number | null>(null);
  const liveFollowDesiredRef = useRef(false);
  const liveFollowTargetRef = useRef<{ filePath: string; fileName: string; keyword?: string } | null>(null);
  const liveFollowExpectedCloseRef = useRef(false);
  const liveFollowRetryCountRef = useRef(0);
  const forceBottomUntilRef = useRef(0);
  const jumpTimerRef = useRef<number | null>(null);
  const jumpStartedAtRef = useRef(0);
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

  function clearJumpTimer() {
    if (jumpTimerRef.current !== null) {
      window.clearTimeout(jumpTimerRef.current);
      jumpTimerRef.current = null;
    }
  }

  function handleViewerNearBottomChange(nearBottom: boolean) {
    /* 点击优先窗口（2026-10-30 用户反馈「点了跟没反馈一样，还有点击抖动」）：
       窗口期内把 nearBottom=false 当噪声直接吞掉，并立刻再补一次重钉。
       旧实现只「忽略」不「重钉」，这一批追加把视口顶开后就再没人管了，
       按钮原地不动、内容也没贴底 —— 用户视角就是点了没反应。 */
    if (!nearBottom && Date.now() < forceBottomUntilRef.current) {
      viewerRef.current?.scrollToBottom();
      return;
    }
    /* 「跳转中」最短保留：真贴底往往 80ms 内就完成，若立刻收起，spinner 只闪一帧，
       用户依然感受不到反馈（等于没做）。这里至少保到 360ms，让状态看得见。 */
    if (nearBottom && viewerJumping) {
      const remain = Math.max(0, JUMPING_MIN_VISIBLE_MS - (Date.now() - jumpStartedAtRef.current));
      clearJumpTimer();
      jumpTimerRef.current = window.setTimeout(() => {
        jumpTimerRef.current = null;
        setViewerJumping(false);
      }, remain);
    }
    setViewerNotAtBottom(!nearBottom);
    if (liveFollowEnabled) {
      setLiveFollowPaused(!nearBottom);
    }
  }

  function scrollViewerToBottom(options?: { optimisticHide?: boolean; manual?: boolean }) {
    /* 手动点击给更长的优先窗口（MANUAL_BOTTOM_PRIORITY_MS），自动跟随保持 900ms】*/
    const windowMs = options?.manual ? MANUAL_BOTTOM_PRIORITY_MS : 900;
    forceBottomUntilRef.current = Math.max(forceBottomUntilRef.current, Date.now() + windowMs);
    if (options?.manual) {
      /* 立刻进入「跳转中」：按钮当场变样（转圈 + 文案），让用户确认点击已生效。
         即便收敛要几百毫秒，反馈是 0 延迟的。 */
      setViewerJumping(true);
      jumpStartedAtRef.current = Date.now();
      clearJumpTimer();
      jumpTimerRef.current = window.setTimeout(() => {
        jumpTimerRef.current = null;
        setViewerJumping(false);
      }, windowMs);
    }
    /* 2026-10-30 用户反馈「到底按钮有时慢 / 要点好几次 / 有时不管用得手动滚」：
       原实现无条件 viewerNotAtBottom=false —— 按钮在滚动尚未收敛时就被隐藏。
       实时模式下内容每 100ms 追加一批 + 未测量行高，一次强滚常落在半途；
       按钮没了用户只能手动滚一下（触发 atBottomStateChange(false)）才能再点。
       现在手动点按路径传 optimisticHide:false：按钮保持可见，直到 Virtuoso
       真正上报 atBottom 才隐藏；没到底就还能继续点（每次点击都是新一轮收敛）。
       自动跟随路径（开文件/换切片）保持原行为。 */
    if (options?.optimisticHide !== false) {
      setViewerNotAtBottom(false);
    }
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
    clearJumpTimer();
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
    viewerJumping,
    setLiveFollowPaused,
    setLiveFollowContent,
    startLiveFollow,
    stopLiveFollow,
    handleViewerNearBottomChange,
    scrollViewerToBottom,
    clearLiveContent,
  };
}
