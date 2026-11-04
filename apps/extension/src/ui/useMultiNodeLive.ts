import { useCallback, useEffect, useRef, useState } from "react";
import { getGatewayToken, localServiceBase } from "./api.js";

export type MultiLivePaneStatus = "connecting" | "live" | "error";

export type MultiLivePane = {
  sessionId: string;
  serverId: string;
  serverName: string;
  filePath: string;
  status: MultiLivePaneStatus;
  content: string;
  error: string;
};

export type MultiLiveItem = {
  sessionId: string;
  serverId: string;
  serverName: string;
  filePath: string;
};

/** 单窗格内容上限：超出丢弃最早部分（与单会话实时 trimLiveContent 同思路） */
const MAX_PANE_CHARS = 48_000;
/** 攒批刷新节奏：多窗格共用一个定时器，约 7 帧/秒 */
const FLUSH_MS = 150;

type Deps = {
  pushActivity?: (message: string) => void;
};

export function useMultiNodeLive(deps: Deps = {}) {
  const [panes, setPanes] = useState<MultiLivePane[]>([]);
  const panesRef = useRef(panes);
  panesRef.current = panes;
  const socketsRef = useRef(new Map<string, WebSocket>());
  const buffersRef = useRef(new Map<string, string>());
  const flushTimerRef = useRef<number | null>(null);
  const desiredRef = useRef(false);
  const expectedCloseRef = useRef(new Set<string>());

  const patchPane = useCallback((sessionId: string, partial: Partial<MultiLivePane>) => {
    setPanes((prev) => prev.map((p) => (p.sessionId === sessionId ? { ...p, ...partial } : p)));
  }, []);

  const flush = useCallback(() => {
    flushTimerRef.current = null;
    if (!buffersRef.current.size) return;
    const updates = new Map(buffersRef.current);
    buffersRef.current.clear();
    setPanes((prev) =>
      prev.map((p) => {
        const add = updates.get(p.sessionId);
        if (!add) return p;
        const merged = p.content + add;
        return {
          ...p,
          content: merged.length > MAX_PANE_CHARS ? merged.slice(-MAX_PANE_CHARS) : merged,
          status: p.status === "connecting" ? "live" : p.status,
        };
      })
    );
  }, []);

  const scheduleFlush = useCallback(() => {
    if (flushTimerRef.current !== null) return;
    flushTimerRef.current = window.setTimeout(flush, FLUSH_MS);
  }, [flush]);

  const closeSocket = useCallback((sessionId: string) => {
    expectedCloseRef.current.add(sessionId);
    const socket = socketsRef.current.get(sessionId);
    socketsRef.current.delete(sessionId);
    try {
      socket?.close();
    } catch {
      /* ignore */
    }
  }, []);

  const openSocket = useCallback((pane: MultiLivePane) => {
    closeSocket(pane.sessionId);
    const wsToken = getGatewayToken();
    const wsUrl = localServiceBase.replace(/^http/, "ws") + "/ws/live" + (wsToken ? `?token=${encodeURIComponent(wsToken)}` : "");
    let socket: WebSocket;
    try {
      socket = new WebSocket(wsUrl);
    } catch (error) {
      patchPane(pane.sessionId, { status: "error", error: error instanceof Error ? error.message : "WebSocket 创建失败" });
      return;
    }
    socketsRef.current.set(pane.sessionId, socket);

    socket.addEventListener("open", () => {
      socket.send(JSON.stringify({ action: "start", serverId: pane.serverId, filePath: pane.filePath }));
    });

    socket.addEventListener("message", (event) => {
      if (socketsRef.current.get(pane.sessionId) !== socket) return;
      try {
        const payload = JSON.parse(String(event.data)) as { type?: string; chunk?: string; message?: string };
        if (payload.type === "error") {
          patchPane(pane.sessionId, { status: "error", error: payload.message || "实时跟随失败" });
          return;
        }
        if (payload.type === "closed") {
          closeSocket(pane.sessionId);
          patchPane(pane.sessionId, { status: "error", error: "远程 tail 已退出（文件可能被轮转），可重试" });
          return;
        }
        if (payload.chunk) {
          buffersRef.current.set(pane.sessionId, (buffersRef.current.get(pane.sessionId) || "") + payload.chunk);
          scheduleFlush();
        }
      } catch {
        /* 忽略解析失败 */
      }
    });

    socket.addEventListener("close", () => {
      if (socketsRef.current.get(pane.sessionId) !== socket) return;
      socketsRef.current.delete(pane.sessionId);
      if (expectedCloseRef.current.delete(pane.sessionId)) return;
      if (!desiredRef.current) return;
      patchPane(pane.sessionId, { status: "error", error: "连接中断，可重试" });
    });

    socket.addEventListener("error", () => {
      if (socketsRef.current.get(pane.sessionId) !== socket) return;
      /* close 事件随后到达，统一在那里标记错误态 */
    });
  }, [patchPane, scheduleFlush, closeSocket]);

  const start = useCallback(
    (items: MultiLiveItem[]) => {
      desiredRef.current = true;
      Array.from(socketsRef.current.keys()).forEach((key) => closeSocket(key));
      if (flushTimerRef.current !== null) {
        window.clearTimeout(flushTimerRef.current);
        flushTimerRef.current = null;
      }
      buffersRef.current.clear();
      const seeded = items.map((item) => ({ ...item, status: "connecting" as const, content: "", error: "" }));
      setPanes(seeded);
      seeded.forEach((pane) => openSocket(pane));
      deps.pushActivity?.(`开启多窗格实时：${items.map((i) => i.serverName).join("、")}（每会话一条 tail）`);
    },
    [openSocket, closeSocket, deps.pushActivity]
  );

  const stopAll = useCallback(() => {
    desiredRef.current = false;
    Array.from(socketsRef.current.keys()).forEach((key) => closeSocket(key));
    if (flushTimerRef.current !== null) {
      window.clearTimeout(flushTimerRef.current);
      flushTimerRef.current = null;
    }
    buffersRef.current.clear();
    setPanes([]);
  }, [closeSocket]);

  const remove = useCallback(
    (sessionId: string) => {
      closeSocket(sessionId);
      buffersRef.current.delete(sessionId);
      setPanes((prev) => prev.filter((p) => p.sessionId !== sessionId));
    },
    [closeSocket]
  );

  const retry = useCallback(
    (sessionId: string) => {
      const pane = panesRef.current.find((p) => p.sessionId === sessionId);
      if (!pane) return;
      patchPane(sessionId, { status: "connecting", error: "" });
      openSocket(pane);
    },
    [patchPane, openSocket]
  );

  useEffect(
    () => () => {
      desiredRef.current = false;
      socketsRef.current.forEach((socket) => {
        try {
          socket.close();
        } catch {
          /* ignore */
        }
      });
      if (flushTimerRef.current !== null) window.clearTimeout(flushTimerRef.current);
    },
    []
  );

  return { panes, start, stopAll, remove, retry, active: panes.length > 0 };
}
