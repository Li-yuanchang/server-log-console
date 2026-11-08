import { useCallback, useEffect, useRef, useState } from "react";
import type { ServerSystemProfileResponse } from "@server-log-console/shared";
import { apiGetServerSystemProfile } from "./api.js";

/**
 * 服务器监控采集池（2026-11-08，方案 E 实装）。
 *
 * 机制与 FinalShell/WindTerm 同源：复用 SSH 连接周期 exec 读 /proc（网关
 * server-system-profile.service 的兼容脚本），无 agent。本池只做三件事：
 * ① 只采「已连接会话」（连接即纳入、断开/关会话即移出 —— 未连接的机器没有数据，也不显示假数据）
 * ② 10s 轮询 + 每台 800ms 错峰（n 台 = n 路 10s exec，复用连接池，成本可控）
 * ③ 五态状态机：collecting → ok ⇄ stale（>3×周期无新采样，UI 层按 lastSuccessAt 推导）→ error（退避重试 5/10/20s ×3 + 手动重试）
 *
 * 网络速率：两次采样间 rx/tx 字节差分 ÷ 实测间隔（按接口累加，lo 已被网关过滤）。
 * CPU 口径：usagePercent 优先；缺失时回退 load[0]/核数 并标注 cpuIsEstimate
 * （与 ServerStatusPanel / 终端迷你条同口径，绝不静默冒充）。
 */

export type ServerMonitorStatus = "collecting" | "ok" | "error";

export type ServerMonitorEntry = {
  serverId: string;
  status: ServerMonitorStatus;
  profile: ServerSystemProfileResponse | null;
  /** CPU 利用率（usagePercent 优先，缺失回退 load/核数） */
  cpu: number | null;
  cpuIsEstimate: boolean;
  memPercent: number | null;
  /** 使用率最高的挂载点 */
  diskPercent: number | null;
  diskMount: string | null;
  /** 下行速率 KB/s（两次采样差分） */
  netRxKbps: number | null;
  /** 上行速率 KB/s（两次采样差分，方案甲卡片用） */
  netTxKbps: number | null;
  error: string | null;
  /** 最后一次成功采样时间戳（stale 判定依据） */
  lastSuccessAt: number | null;
  retryCount: number;
};

export type ServerMonitorPool = {
  entries: ServerMonitorEntry[];
  retry: (serverId: string) => void;
};

const STALE_MS = 30_000;
const BACKOFF_MS = [5_000, 10_000, 20_000];
const MAX_AUTO_RETRY = 3;

export function useServerMonitorPool(opts: {
  /** 返回当前「已连接会话」的 serverId 列表（连接即纳入，断开即移出） */
  getConnectedServerIds: () => string[];
  /** 已连接 serverId 数组（响应式）：成员变化时立即预热新会话，不等下一个轮询周期 */
  connectedServerIds: string[];
  /** 各 serverId 的状态上下文路径：堡垒机/jumpserver 会话必传（网关按虚拟路径解析目标资产） */
  getContextPath?: (serverId: string) => string | undefined;
  intervalMs?: number;
  timeoutMs?: number;
}): ServerMonitorPool {
  const { getConnectedServerIds, connectedServerIds, getContextPath, intervalMs = 10_000, timeoutMs = 15_000 } = opts;
  const joinedIds = connectedServerIds.join("\n");
  const getContextPathRef = useRef(getContextPath);
  getContextPathRef.current = getContextPath;
  const [entries, setEntries] = useState<ServerMonitorEntry[]>([]);
  const entriesRef = useRef<ServerMonitorEntry[]>([]);
  const inflightRef = useRef<Set<string>>(new Set());
  const retryTimersRef = useRef<Map<string, number>>(new Map());
  const netPrevRef = useRef<Map<string, { rx: number; tx: number; at: number }>>(new Map());
  const getIdsRef = useRef(getConnectedServerIds);
  getIdsRef.current = getConnectedServerIds;

  const patch = useCallback((serverId: string, partial: Partial<ServerMonitorEntry>) => {
    setEntries((prev) => {
      const next = prev.some((e) => e.serverId === serverId)
        ? prev.map((e) => (e.serverId === serverId ? { ...e, ...partial } : e))
        : [...prev, {
            serverId,
            status: "collecting" as const,
            profile: null,
            cpu: null,
            cpuIsEstimate: false,
            memPercent: null,
            diskPercent: null,
            diskMount: null,
            netRxKbps: null,
            netTxKbps: null,
            error: null,
            lastSuccessAt: null,
            retryCount: 0,
            ...partial
          }];
      entriesRef.current = next;
      return next;
    });
  }, []);

  const pollOne = useCallback((serverId: string) => {
    if (inflightRef.current.has(serverId)) return;
    inflightRef.current.add(serverId);
    patch(serverId, { status: entriesRef.current.find((e) => e.serverId === serverId && e.lastSuccessAt) ? "ok" : "collecting" });
    (async () => {
      try {
        const profile = await apiGetServerSystemProfile(serverId, timeoutMs, getContextPathRef.current?.(serverId) || undefined);
        /* 网速差分：rx/tx 累计字节数 ÷ 实测间隔（跨接口累加，lo 已被网关过滤） */
        const rxBytes = profile.network.reduce((sum, n) => sum + (n.rxBytes || 0), 0);
        const txBytes = profile.network.reduce((sum, n) => sum + (n.txBytes || 0), 0);
        const prev = netPrevRef.current.get(serverId);
        const nowAt = Date.now();
        let netRxKbps: number | null = null;
        let netTxKbps: number | null = null;
        if (prev && nowAt > prev.at) {
          const sec = (nowAt - prev.at) / 1000;
          netRxKbps = Math.max(0, (rxBytes - prev.rx) / sec) / 1024;
          netTxKbps = Math.max(0, (txBytes - prev.tx) / sec) / 1024;
        }
        netPrevRef.current.set(serverId, { rx: rxBytes, tx: txBytes, at: nowAt });
        const cores = profile.cpu.cores || 0;
        const cpuEstimate = profile.cpu.usagePercent == null && cores > 0;
        const cpu = profile.cpu.usagePercent != null
          ? profile.cpu.usagePercent
          : cpuEstimate
            ? Math.min(100, (profile.loadAverage[0] / cores) * 100)
            : null;
        const worstDisk = profile.disks.reduce(
          (worst, d) => (d.percent > (worst?.percent ?? -1) ? d : worst),
          null as ServerSystemProfileResponse["disks"][number] | null
        );
        patch(serverId, {
          status: "ok",
          profile,
          cpu,
          cpuIsEstimate: cpuEstimate,
          memPercent: profile.memory?.percent ?? null,
          diskPercent: worstDisk ? worstDisk.percent : null,
          diskMount: worstDisk ? worstDisk.mount : null,
          netRxKbps,
          netTxKbps,
          error: null,
          lastSuccessAt: nowAt,
          retryCount: 0
        });
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        const prevEntry = entriesRef.current.find((e) => e.serverId === serverId);
        const retryCount = (prevEntry?.retryCount ?? 0) + 1;
        patch(serverId, {
          status: "error",
          error: detail,
          retryCount,
          profile: prevEntry?.profile ?? null,
          lastSuccessAt: prevEntry?.lastSuccessAt ?? null
        });
        /* 退避重试：5s → 10s → 20s，最多 3 次（之后停在失败态等手动重试） */
        if (retryCount <= MAX_AUTO_RETRY) {
          const timer = window.setTimeout(() => {
            retryTimersRef.current.delete(serverId);
            if (getIdsRef.current().includes(serverId)) pollOne(serverId);
          }, BACKOFF_MS[Math.min(retryCount - 1, BACKOFF_MS.length - 1)]);
          retryTimersRef.current.set(serverId, timer);
        }
      } finally {
        inflightRef.current.delete(serverId);
      }
    })();
  }, [patch, timeoutMs]);

  const retry = useCallback((serverId: string) => {
    const timer = retryTimersRef.current.get(serverId);
    if (timer) { window.clearTimeout(timer); retryTimersRef.current.delete(serverId); }
    patch(serverId, { retryCount: 0 });
    pollOne(serverId);
  }, [pollOne, patch]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      const ids = getIdsRef.current();
      /* 会话关闭/断开 → 移出池（条目消失，未连接组接管展示） */
      setEntries((prev) => {
        const next = prev.filter((e) => ids.includes(e.serverId));
        entriesRef.current = next;
        return next.length === prev.length ? prev : next;
      });
      ids.forEach((id, index) => {
        /* 错峰：每台顺延 800ms，避免 n 路并发 exec 同帧打出 */
        window.setTimeout(() => {
          if (getIdsRef.current().includes(id)) pollOne(id);
        }, index * 800);
      });
    }, intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs, pollOne]);

  /* 预热（2026-11-08 修「切到监控要等 4-5s 才出数据」）：连接/断开发生时
     立即为新会话采样一次，不等下一个 10s 周期 —— 打开监控 Tab 时数据已经在屏上。 */
  useEffect(() => {
    const ids = getIdsRef.current();
    ids.forEach((id, index) => {
      const hasFresh = entriesRef.current.some((e) => e.serverId === id && e.lastSuccessAt);
      if (hasFresh || inflightRef.current.has(id)) return;
      window.setTimeout(() => {
        if (getIdsRef.current().includes(id)) pollOne(id);
      }, index * 400);
    });
    // eslint-disable 预热只依赖成员集合（joinedIds），getter/池函数经 ref 稳定引用
  }, [joinedIds, pollOne]);

  /* 卸载清理重试定时器 */
  useEffect(() => () => {
    retryTimersRef.current.forEach((t) => window.clearTimeout(t));
    retryTimersRef.current.clear();
  }, []);

  return { entries, retry };
}
