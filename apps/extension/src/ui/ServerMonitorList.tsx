import { Cpu, HardDrive, MemoryStick, Wifi, Activity, RefreshCw } from "lucide-react";
import type { ServerMonitorEntry } from "./useServerMonitorPool.js";

/**
 * 监控 Tab 列表（方案 E 实装，2026-11-08）。
 * 行 = 单行四格：图标（按指标着色）+ 数值（tabular-nums 固定宽，数值变化零推挤）。
 * 状态机五态：正常 / 延迟（>3×周期无新采样，数据变暗） / 失败（原因 + 退避重试 + 手动重试）/ 采集中。
 * 排序：失败 > 延迟 > 正常（CPU 降序）—— 故障永不沉默消失。
 */

const STALE_MS = 30_000;

type Props = {
  entries: ServerMonitorEntry[];
  activeServerId: string;
  groupTitleOf: (serverId: string) => string | undefined;
  onSelect: (serverId: string) => void;
  onOpenDetail: (serverId: string) => void;
  onRetry: (serverId: string) => void;
};

function derive(entry: ServerMonitorEntry, now: number) {
  const stale = entry.status === "ok" && entry.lastSuccessAt != null && now - entry.lastSuccessAt > STALE_MS;
  const staleSec = stale && entry.lastSuccessAt != null ? Math.max(1, Math.round((now - entry.lastSuccessAt) / 1000)) : 0;
  /* 展示权重：失败 0 < 延迟 1 < 采集中 2 < 正常 3 */
  const weight = entry.status === "error" ? 0 : stale ? 1 : entry.status === "collecting" ? 2 : 3;
  return { stale, staleSec, weight };
}

function fmtNet(kbps: number | null): string {
  if (kbps == null || !Number.isFinite(kbps)) return "--";
  return kbps >= 1024 ? (kbps / 1024).toFixed(1) + "M" : Math.round(kbps) + "K";
}

function riskClass(v: number | null): string {
  if (v == null) return "";
  return v >= 85 ? "hot" : v >= 70 ? "warm" : "";
}

export function ServerMonitorList(props: Props) {
  const now = Date.now();
  const rows = props.entries
    .map((entry) => ({ entry, ...derive(entry, now) }))
    .sort((a, b) => {
      if (a.weight !== b.weight) return a.weight - b.weight;
      /* 同权重按名称稳定排序 —— 按 CPU 实时排序会让行频繁跳动 */
      return a.entry.serverId.localeCompare(b.entry.serverId);
    });

  /* 概览（填补充几台时的空白）：均值/峰值/风险台数 */
  const withCpu = rows.filter((r) => r.entry.cpu != null);
  const avgCpu = withCpu.length ? withCpu.reduce((sum, r) => sum + (r.entry.cpu || 0), 0) / withCpu.length : null;
  const avgMem = rows.filter((r) => r.entry.memPercent != null).reduce((sum, r) => sum + (r.entry.memPercent || 0), 0) / Math.max(1, rows.filter((r) => r.entry.memPercent != null).length);
  const worstDisk = rows.reduce((w, r) => ((r.entry.diskPercent ?? -1) > (w ?? -1) ? r.entry.diskPercent : w), null as number | null);
  const riskCount = rows.filter((r) => (r.entry.diskPercent ?? 0) >= 70 || (r.entry.cpu ?? 0) >= 70).length;

  return (
    <div className="smm-list">
      {rows.map(({ entry, stale, staleSec }) => {
        const isErr = entry.status === "error";
        const isCollecting = entry.status === "collecting";
        const badge = isErr
          ? { cls: "err", text: "失败" }
          : stale
            ? { cls: "stale", text: `延迟 ${staleSec}s` }
            : isCollecting
              ? { cls: "idle", text: "采集中" }
              : { cls: "ok", text: "正常" };
        return (
          <div
            key={entry.serverId}
            className={`smm-row${entry.serverId === props.activeServerId ? " on" : ""}${isErr ? " err" : ""}${stale ? " stale" : ""}`}
            onClick={() => props.onSelect(entry.serverId)}
            title="点击切换到该服务器"
          >
            <div className="l1">
              <b>{entry.profile?.serverName || entry.serverId}</b>
              {props.groupTitleOf(entry.serverId) ? <em>{props.groupTitleOf(entry.serverId)}</em> : null}
              <span className={`smm-badge ${badge.cls}`}><i />{badge.text}</span>
            </div>
            {isErr ? (
              <>
                <div className="why" title={entry.error || ""}>{entry.error || "采集失败"}</div>
                <div className="retryline">
                  <span className="meta">
                    {entry.lastSuccessAt ? `最后数据 ${new Date(entry.lastSuccessAt).toLocaleTimeString("zh-CN", { hour12: false })}` : "尚无成功采样"}
                    {entry.retryCount > 0 ? ` · 自动重试 ${entry.retryCount}/3` : ""}
                  </span>
                  <button
                    type="button"
                    className="smm-retry"
                    title="立即重试"
                    aria-label="立即重试"
                    onClick={(event) => { event.stopPropagation(); props.onRetry(entry.serverId); }}
                  >
                    <RefreshCw size={11} strokeWidth={1.9} /> 重试
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="l2" onClick={() => props.onOpenDetail(entry.serverId)} title="点击查看趋势 / 进程 / 磁盘详情">
                  <span className="cell" title={entry.cpuIsEstimate ? "CPU（负载/核数 估算值）" : "CPU 利用率"}>
                    <Cpu size={12} strokeWidth={1.8} className="ic cpu" />
                    <b className={entry.cpu != null && entry.cpu >= 70 ? "hot" : ""}>{entry.cpu != null ? Math.round(entry.cpu) + "%" : "--"}</b>
                  </span>
                  <span className="cell" title="内存使用率">
                    <MemoryStick size={12} strokeWidth={1.8} className="ic mem" />
                    <b>{entry.memPercent != null ? Math.round(entry.memPercent) + "%" : "--"}</b>
                  </span>
                  <span className="cell" data-k="net" title="网络下行">
                    <Wifi size={12} strokeWidth={1.8} className="ic net" />
                    <b>{fmtNet(entry.netRxKbps)}</b>
                  </span>
                  <span className="cell" title={entry.diskMount ? `磁盘 ${entry.diskMount}` : "磁盘使用率"}>
                    <HardDrive size={12} strokeWidth={1.8} className="ic disk" />
                    <b className={riskClass(entry.diskPercent)}>{entry.diskPercent != null ? Math.round(entry.diskPercent) + "%" : "--"}</b>
                  </span>
                </div>
                {stale ? (
                  <div className="stale-hint">上次成功采样 {entry.lastSuccessAt ? new Date(entry.lastSuccessAt).toLocaleTimeString("zh-CN", { hour12: false }) : "--"} · 继续等待自动恢复</div>
                ) : null}
              </>
            )}
            {!isErr ? (
              <button
                type="button"
                className="smm-detail"
                title="查看趋势 / 进程 / 磁盘详情"
                aria-label="查看监控详情"
                onClick={(event) => { event.stopPropagation(); props.onOpenDetail(entry.serverId); }}
              >
                <Activity size={11} strokeWidth={1.9} /> 详情
              </button>
            ) : null}
          </div>
        );
      })}
      {rows.length === 0 ? (
        <div className="smm-empty">没有已连接的会话 —— 在「服务器」Tab 连接后自动纳入监控</div>
      ) : (
        <div className="smm-summary">
          <div className="t">概览 · 采集中 {rows.length} 台{riskCount ? ` · 风险 ${riskCount}` : ""}</div>
          <div className="g">
            <div className="st"><span className="k">平均 CPU</span><span className={"v" + riskClass(avgCpu)}>{avgCpu != null ? Math.round(avgCpu) + "%" : "--"}</span></div>
            <div className="st"><span className="k">平均内存</span><span className="v">{rows.some(r => r.entry.memPercent != null) ? Math.round(avgMem) + "%" : "--"}</span></div>
            <div className="st"><span className="k">磁盘峰值</span><span className={"v " + riskClass(worstDisk)}>{worstDisk != null ? Math.round(worstDisk) + "%" : "--"}</span></div>
          </div>
        </div>
      )}
    </div>
  );
}
