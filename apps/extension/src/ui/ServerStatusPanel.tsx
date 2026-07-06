import { AlertTriangle, Cpu, Database, HardDrive, Network, RefreshCw, Server, Activity } from "lucide-react";
import type { ServerSummary, ServerSystemProfileResponse } from "@server-log-console/shared";
import { useEscapeToClose } from "./useEscapeToClose.js";

type Props = {
  visible: boolean;
  server: ServerSummary | null;
  profile: ServerSystemProfileResponse | null;
  loading: boolean;
  error: string;
  autoRefresh: boolean;
  refreshIntervalMs: number;
  contextLabel?: string;
  onToggleAutoRefresh: () => void;
  onRefresh: () => void;
  onClose: () => void;
};

function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "-";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let next = value;
  let index = 0;
  while (next >= 1024 && index < units.length - 1) {
    next /= 1024;
    index += 1;
  }
  return `${next >= 10 || index === 0 ? next.toFixed(0) : next.toFixed(1)} ${units[index]}`;
}

function formatDate(value: string): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, value));
}

function MetricBar({ label, value, detail, tone = "blue" }: { label: string; value: number; detail: string; tone?: "blue" | "amber" | "green" }) {
  const percent = clampPercent(value);
  return (
    <div className={`server-status-meter server-status-meter-${tone}`}>
      <div className="server-status-meter-head">
        <span>{label}</span>
        <strong>{percent.toFixed(1)}%</strong>
      </div>
      <div className="server-status-meter-track">
        <span style={{ width: `${percent}%` }} />
      </div>
      <small>{detail}</small>
    </div>
  );
}

function StatusSkeleton() {
  return (
    <div className="server-status-skeleton">
      <span />
      <span />
      <span />
      <span />
    </div>
  );
}

function MetricPill({ label, value, hint, tone = "blue" }: { label: string; value: string; hint: string; tone?: "blue" | "amber" | "green" }) {
  return (
    <div className={`server-status-pill server-status-pill-${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{hint}</small>
    </div>
  );
}

export function ServerStatusPanel({
  visible,
  server,
  profile,
  loading,
  error,
  autoRefresh,
  refreshIntervalMs,
  contextLabel = "",
  onToggleAutoRefresh,
  onRefresh,
  onClose
}: Props) {
  useEscapeToClose(visible, onClose);
  if (!visible) return null;

  const memory = profile?.memory;
  const swap = profile?.swap;
  const diskMax = Math.max(...(profile?.disks || []).map((disk) => disk.percent), 0);
  const loadPerCore = profile?.cpu.cores ? (profile.loadAverage[0] / profile.cpu.cores) * 100 : 0;
  const sourceLabel = profile?.source === "jumpserver" ? "JumpServer 资产" : profile?.source === "bastion" ? "堡垒机目标" : "直连主机";
  const statusTitle = profile?.hostname || server?.name || "未选择服务器";
  const statusSubTitle = profile?.os || server?.host || "点击刷新读取实时状态";
  const refreshLabel = loading
    ? "刷新中"
    : autoRefresh
      ? `自动刷新 ${Math.round(refreshIntervalMs / 1000)}s`
      : "手动刷新";

  return (
    <div className="server-status-panel">
      <div className="server-status-head">
        <div className="server-status-identity">
          <span className="server-status-icon"><Server size={15} /></span>
          <div>
            <strong>{statusTitle}</strong>
            <small>{statusSubTitle}</small>
          </div>
        </div>
        <div className="server-status-actions">
          <button
            className={autoRefresh ? "server-status-auto-toggle server-status-auto-toggle-on" : "server-status-auto-toggle"}
            type="button"
            onClick={onToggleAutoRefresh}
            disabled={!server}
            title={autoRefresh ? "关闭自动刷新" : "开启自动刷新"}
          >
            <span aria-hidden="true" />
            {refreshLabel}
          </button>
          <button className="ghost-button icon-button" type="button" onClick={onRefresh} disabled={!server || loading} title="刷新状态">
            <RefreshCw size={13} className={loading ? "server-status-spin" : ""} />
          </button>
        </div>
      </div>

      {error ? (
        <div className="server-status-error">
          <AlertTriangle size={14} />
          <span>{error}</span>
        </div>
      ) : null}

      {contextLabel ? (
        <div className="server-status-context">
          <span>{contextLabel}</span>
        </div>
      ) : null}

      {loading && !profile ? <StatusSkeleton /> : null}

      {profile ? (
        <div className="server-status-scroll">
          <section className="server-status-hero-card">
            <div className="server-status-hero-main">
              <span className="server-status-hero-orb">
                <Activity size={15} />
              </span>
              <div>
                <span>{sourceLabel}</span>
                <strong>{profile.host}</strong>
              </div>
            </div>
            <div className="server-status-hero-meta">
              <span>{profile.cpu.cores || "-"} Core</span>
              <span>{loading ? "正在刷新..." : `更新 ${formatDate(profile.collectedAt)}`}</span>
            </div>
          </section>

          <div className="server-status-pill-grid">
            <MetricPill label="负载/核" value={`${clampPercent(loadPerCore).toFixed(1)}%`} hint={profile.loadAverage[0].toFixed(2)} tone="green" />
            <MetricPill label="内存" value={`${(memory?.percent || 0).toFixed(1)}%`} hint={`${formatBytes(memory?.used || 0)} / ${formatBytes(memory?.total || 0)}`} />
            <MetricPill label="磁盘最高" value={`${diskMax.toFixed(0)}%`} hint={`${profile.disks.length} 个挂载点`} tone={diskMax >= 85 ? "amber" : "blue"} />
          </div>

          <section className="server-status-card server-status-overview">
            <div className="server-status-card-title">
              <Cpu size={14} />
              <span>核心负载</span>
            </div>
            <div className="server-status-load-grid">
              <div><strong>{profile.loadAverage[0].toFixed(2)}</strong><span>1 min</span></div>
              <div><strong>{profile.loadAverage[1].toFixed(2)}</strong><span>5 min</span></div>
              <div><strong>{profile.loadAverage[2].toFixed(2)}</strong><span>15 min</span></div>
            </div>
            <MetricBar label="负载 / 核心" value={loadPerCore} detail={`${profile.cpu.cores || "-"} 核 · ${profile.cpu.model || "CPU 信息不可用"}`} tone="green" />
            <div className="server-status-kv">
              <span>内核</span>
              <strong>{profile.kernel || "-"}</strong>
            </div>
            <div className="server-status-kv">
              <span>运行</span>
              <strong>{profile.uptimeText || (profile.uptimeSeconds ? `${Math.floor(profile.uptimeSeconds / 3600)} 小时` : "-")}</strong>
            </div>
          </section>

          <section className="server-status-card">
            <div className="server-status-card-title">
              <Database size={14} />
              <span>内存</span>
            </div>
            <MetricBar
              label="Memory"
              value={memory?.percent || 0}
              detail={`${formatBytes(memory?.used || 0)} / ${formatBytes(memory?.total || 0)} · 可用 ${formatBytes(memory?.free || 0)}`}
            />
            <MetricBar
              label="Swap"
              value={swap?.percent || 0}
              detail={`${formatBytes(swap?.used || 0)} / ${formatBytes(swap?.total || 0)}`}
              tone="amber"
            />
          </section>

          <section className="server-status-card">
            <div className="server-status-card-title">
              <HardDrive size={14} />
              <span>磁盘</span>
              <em>最高 {diskMax.toFixed(0)}%</em>
            </div>
            <div className="server-status-disk-list">
              {profile.disks.slice(0, 8).map((disk) => (
                <div className="server-status-disk" key={`${disk.filesystem}-${disk.mount}`}>
                  <div>
                    <strong>{disk.mount}</strong>
                    <span>{disk.filesystem}</span>
                  </div>
                  <div className="server-status-disk-usage">
                    <span>{disk.percent.toFixed(0)}%</span>
                    <small>{formatBytes(disk.used)} / {formatBytes(disk.total)}</small>
                  </div>
                  <div className="server-status-disk-track">
                    <span style={{ width: `${clampPercent(disk.percent)}%` }} />
                  </div>
                </div>
              ))}
              {profile.disks.length === 0 ? <p className="server-status-empty">未读取到磁盘信息</p> : null}
            </div>
          </section>

          <section className="server-status-card">
            <div className="server-status-card-title">
              <Network size={14} />
              <span>网络计数</span>
            </div>
            <div className="server-status-network-list">
              {profile.network.slice(0, 5).map((item) => (
                <div key={item.name}>
                  <strong>{item.name}</strong>
                  <span>↓ {formatBytes(item.rxBytes)} · ↑ {formatBytes(item.txBytes)}</span>
                </div>
              ))}
              {profile.network.length === 0 ? <p className="server-status-empty">未读取到网卡计数</p> : null}
            </div>
          </section>

          <section className="server-status-card">
            <div className="server-status-card-title">
              <span>资源占用进程</span>
            </div>
            <div className="server-status-process-list">
              {profile.processes.slice(0, 8).map((process) => (
                <div key={`${process.pid}-${process.command}`} className="server-status-process">
                  <span>{process.command || `PID ${process.pid}`}</span>
                  <strong>CPU {process.cpuPercent.toFixed(1)}% · MEM {process.memoryPercent.toFixed(1)}%</strong>
                </div>
              ))}
              {profile.processes.length === 0 ? <p className="server-status-empty">未读取到进程排行</p> : null}
            </div>
          </section>

          {profile.warnings.length > 0 ? (
            <section className="server-status-warning-list">
              {profile.warnings.map((warning) => <span key={warning}>{warning}</span>)}
            </section>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
