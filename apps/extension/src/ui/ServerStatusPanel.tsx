import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Cpu, Database, HardDrive, Network, RefreshCw, Server, Activity } from "lucide-react";
import type { ServerSummary, ServerSystemDisk, ServerSystemProfileResponse } from "@server-log-console/shared";
import { useEscapeToClose } from "./useEscapeToClose.js";

// 监控趋势：前端环形缓冲，默认 10s/次采样，360 个点 ≈ 1 小时
const TREND_SAMPLE_CAPACITY = 360;

// 异常事件阈值：窗口内 CPU（单核折算）≥60% 记一个异常点，红点与日志 ERROR 时间对齐（原型 decision ②）
const ANOMALY_CPU_THRESHOLD = 60;

// SVG 属性上取 CSS 变量在部分渲染路径不稳，按约束用与主题同源的字面 hex（括号内为对应 token）：
//   #0070f3 = var(--accent) · #0a7b3e = var(--green) · #b45309 = var(--amber) · #d41313 = var(--red)
const CHART_COLOR_CPU = "#0070f3";
const CHART_COLOR_MEM = "#0a7b3e";
const CHART_COLOR_DISK = "#b45309";
const CHART_COLOR_ANOMALY = "#d41313";

// 监控记录时序图的时间范围（原型 s9 895 行：5 分钟 / 30 分钟 / 1 小时）
type TrendRangeKey = "5m" | "30m" | "1h";
const TREND_RANGES: TrendRangeKey[] = ["5m", "30m", "1h"];
const TREND_RANGE_MS: Record<TrendRangeKey, number> = { "5m": 5 * 60 * 1000, "30m": 30 * 60 * 1000, "1h": 60 * 60 * 1000 };
const TREND_RANGE_LABEL: Record<TrendRangeKey, string> = { "5m": "5 分钟", "30m": "30 分钟", "1h": "1 小时" };

type TrendSample = { t: number; serverId: string; cpu: number; mem: number; disk: number };

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

function formatClock(ms: number): string {
  if (!Number.isFinite(ms)) return "--:--";
  const date = new Date(ms);
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

// 进程名/参数：command 首 token 作名字（截掉路径），其余作参数（原型「java ... eos-server」形态）
function processName(command: string, pid: number): string {
  const first = (command || "").trim().split(/\s+/)[0] || "";
  if (!first) return `PID ${pid}`;
  return first.split("/").pop() || first;
}
function processArgs(command: string): string {
  return (command || "").trim().split(/\s+/).slice(1).join(" ");
}

// 进程 CPU% 高亮分档：≥10% 红、≥5% 橙、其余正常字色
function processCpuTone(value: number): "" | "hi" | "md" {
  if (value >= 10) return "hi";
  if (value >= 5) return "md";
  return "";
}

// 迷你趋势线（SVG sparkline，参照重设计原型 s9 的 spark()：淡面积 + 1.4px 折线 + 异常红点）
function TrendSparkline({ data, color, spikeIndex }: { data: number[]; color: string; spikeIndex?: number }) {
  const width = 100;
  const height = 26;
  if (data.length < 2) {
    // 样本不足：占位（见上方空态说明）
    return (
      <div className="server-status-trend-spark-empty" aria-hidden="true">
        <span>采样积累中…</span>
      </div>
    );
  }
  const peak = Math.max(...data) * 1.15;
  const top = peak > 0 ? peak : 1;
  const yFor = (value: number) => height - (value / top) * height;
  const points = data.map((value, index) => `${((index / (data.length - 1)) * width).toFixed(1)},${yFor(value).toFixed(1)}`).join(" ");
  const areaPoints = `0,${height} ${points} ${width},${height}`;
  const spike = spikeIndex != null && spikeIndex >= 0 && spikeIndex < data.length ? spikeIndex : -1;
  const spikeX = spike >= 0 ? (spike / (data.length - 1)) * width : 0;
  const spikeY = spike >= 0 ? yFor(data[spike]) : 0;
  return (
    <svg className="server-status-trend-spark" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden="true">
      <polygon points={areaPoints} style={{ fill: color, opacity: 0.09 }} />
      <polyline points={points} style={{ fill: "none", stroke: color, strokeWidth: 1.4, strokeLinejoin: "round" }} />
      {spike >= 0 ? (
        <>
          <circle cx={spikeX.toFixed(1)} cy={spikeY.toFixed(1)} r="2.6" style={{ fill: CHART_COLOR_ANOMALY }} />
          <circle cx={spikeX.toFixed(1)} cy={spikeY.toFixed(1)} r="5" style={{ fill: "rgba(212,19,19,.18)" }} />
        </>
      ) : null}
    </svg>
  );
}

// 监控记录大图：CPU/内存双线 + 面积 + 25/50/75 虚线网格 + 异常红点/红色虚线竖线（原型 s9 bigChart 842-864）
function MonitorChart({ cpu, mem }: { cpu: number[]; mem: number[] }) {
  const width = 720;
  const height = 150;
  const count = Math.max(cpu.length, mem.length);
  if (count < 2) {
    // 样本不足：与指标卡同款占位（淡虚线 + 灰字），高度与大图一致
    return (
      <div className="server-status-monitor-chart-empty" aria-hidden="true">
        <span>采样积累中…</span>
      </div>
    );
  }
  const xFor = (index: number) => (index / (count - 1)) * width;
  const yFor = (value: number) => height - (clampPercent(value) / 100) * (height - 10);
  const line = (data: number[]) => data.map((value, index) => `${xFor(index).toFixed(1)},${yFor(value).toFixed(1)}`).join(" ");
  const draw = (data: number[], color: string) =>
    data.length < 2 ? null : (
      <>
        <polygon points={`0,${height} ${line(data)} ${width},${height}`} style={{ fill: color, opacity: 0.08 }} />
        <polyline points={line(data)} style={{ fill: "none", stroke: color, strokeWidth: 1.5, strokeLinejoin: "round" }} />
      </>
    );
  // 异常点：窗口内 CPU 尖峰（原型以 09:02 尖峰对齐日志 ERROR）——低于阈值不标点，仅保留结构
  let anomalyIndex = -1;
  for (let i = 0; i < cpu.length; i += 1) {
    if (anomalyIndex < 0 || cpu[i] > cpu[anomalyIndex]) anomalyIndex = i;
  }
  const hasAnomaly = anomalyIndex >= 0 && cpu[anomalyIndex] >= ANOMALY_CPU_THRESHOLD;
  const ax = hasAnomaly ? xFor(anomalyIndex) : 0;
  const ay = hasAnomaly ? yFor(cpu[anomalyIndex]) : 0;
  return (
    <svg className="server-status-monitor-chart" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden="true">
      {[25, 50, 75].map((y) => (
        <line key={y} x1="0" y1={yFor(y).toFixed(1)} x2={width} y2={yFor(y).toFixed(1)} stroke="var(--line)" strokeWidth="0.6" strokeDasharray="2 4" />
      ))}
      {draw(cpu, CHART_COLOR_CPU)}
      {draw(mem, CHART_COLOR_MEM)}
      {hasAnomaly ? (
        <>
          <line x1={ax.toFixed(1)} y1="0" x2={ax.toFixed(1)} y2={height} stroke="var(--line-strong)" strokeWidth="0.6" />
          <line x1={ax.toFixed(1)} y1={ay.toFixed(1)} x2={ax.toFixed(1)} y2={height} stroke={CHART_COLOR_ANOMALY} strokeWidth="0.8" strokeDasharray="3 3" />
          <circle cx={ax.toFixed(1)} cy={ay.toFixed(1)} r="3" style={{ fill: CHART_COLOR_ANOMALY }} />
          <circle cx={ax.toFixed(1)} cy={ay.toFixed(1)} r="6" style={{ fill: "rgba(212,19,19,.16)" }} />
        </>
      ) : null}
    </svg>
  );
}

function TrendCard({ label, windowLabel, value, color, samples, spikeIndex }: { label: string; windowLabel: string; value: number; color: string; samples: number[]; spikeIndex?: number }) {
  return (
    <div className="server-status-trend-card">
      <div className="server-status-trend-card-head">
        <span className="server-status-trend-card-label">{label}</span>
        <span className="server-status-trend-card-win">{windowLabel}</span>
      </div>
      <div className="server-status-trend-card-value">{clampPercent(value).toFixed(0)}%</div>
      <TrendSparkline data={samples} color={color} spikeIndex={spikeIndex} />
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

  // 监控记录时序图时间范围（原型 s9 895 行，默认 30 分钟）
  const [trendRange, setTrendRange] = useState<TrendRangeKey>("30m");

  // 环形缓冲：每次状态采样（自动/手动刷新成功）push 一个点，最多保留 360 个（≈1 小时）
  const trendSamplesRef = useRef<TrendSample[]>([]);
  const [, setTrendTick] = useState(0);
  useEffect(() => {
    if (!profile) return;
    const collectedAtMs = Date.parse(profile.collectedAt);
    const sampleTime = Number.isFinite(collectedAtMs) ? collectedAtMs : Date.now();
    const list = trendSamplesRef.current;
    const last = list[list.length - 1];
    // 切换服务器后清空缓冲，避免两个主机的采样混在同一条趋势里
    if (last && last.serverId !== profile.serverId) {
      list.length = 0;
    } else if (last && last.t === sampleTime) {
      return;
    }
    const sampleMemory = profile.memory;
    const sampleDiskMax = Math.max(...(profile.disks || []).map((disk) => disk.percent), 0);
    const sampleLoadPerCore = profile.cpu.cores ? (profile.loadAverage[0] / profile.cpu.cores) * 100 : 0;
    list.push({
      t: sampleTime,
      serverId: profile.serverId,
      cpu: clampPercent(sampleLoadPerCore),
      mem: clampPercent(sampleMemory?.percent || 0),
      disk: clampPercent(sampleDiskMax),
    });
    if (list.length > TREND_SAMPLE_CAPACITY) {
      list.splice(0, list.length - TREND_SAMPLE_CAPACITY);
    }
    setTrendTick((current) => current + 1);
  }, [profile]);

  if (!visible) return null;

  // 监控记录时序图时间范围（原型 s9 895 行，默认 30 分钟）
  const now = Date.now();
  const allSamples = trendSamplesRef.current;
  // 指标卡固定画 1 小时全量缓冲（原型 decision ①「指标卡各带 1 小时迷你趋势线」，角标恒为 1h）
  const seriesCpu1h = allSamples.map((sample) => sample.cpu);
  const seriesMem1h = allSamples.map((sample) => sample.mem);
  const seriesDisk1h = allSamples.map((sample) => sample.disk);
  const cpuSpikeIndex1h = seriesCpu1h.reduce((best, value, index) => (value > seriesCpu1h[best] ? index : best), 0);
  const hasSpike1h = seriesCpu1h.length >= 2 && seriesCpu1h[cpuSpikeIndex1h] >= ANOMALY_CPU_THRESHOLD;
  // 大图按 segmented 时间范围过滤
  const trendWindowStart = now - TREND_RANGE_MS[trendRange];
  const trendSamples = allSamples.filter((sample) => sample.t >= trendWindowStart);
  const seriesCpu = trendSamples.map((sample) => sample.cpu);
  const seriesMem = trendSamples.map((sample) => sample.mem);
  // 异常事件：窗口内 CPU 尖峰（≥60%，红点与日志 ERROR 时间对齐，原型 decision ②）；N = 异常点数
  const anomalyCount = trendSamples.reduce((sum, sample) => (sample.cpu >= ANOMALY_CPU_THRESHOLD ? sum + 1 : sum), 0);
  // 异常 chip 口径：有异常 → 红色「与日志 ERROR 对齐 · 异常 N」；无异常 → 灰色「未检测到异常尖峰」
  const hasAnomaly = anomalyCount > 0;
  const anomalyText = hasAnomaly ? `与日志 ERROR 对齐 · 异常 ${anomalyCount}` : "未检测到异常尖峰";
  const windowStartLabel = trendSamples.length >= 2 ? formatClock(trendSamples[0].t) : "--:--";
  const windowEndLabel = trendSamples.length >= 2 ? formatClock(trendSamples[trendSamples.length - 1].t) : "--:--";

  const memory = profile?.memory;
  const swap = profile?.swap;
  const diskList = profile?.disks || [];
  const diskMax = Math.max(...diskList.map((disk) => disk.percent), 0);
  // 磁盘最高占用挂载点（原型 s9 886 行标签「磁盘 /data」）
  const topDiskMount = diskList.reduce<ServerSystemDisk | null>((best, disk) => (best == null || disk.percent > best.percent ? disk : best), null)?.mount ?? "";
  const loadPerCore = profile?.cpu.cores ? (profile.loadAverage[0] / profile.cpu.cores) * 100 : 0;
  const sourceLabel = profile?.source === "jumpserver" ? "JumpServer 资产" : profile?.source === "bastion" ? "堡垒机目标" : "直连主机";
  const statusTitle = profile?.hostname || server?.name || "未选择服务器";
  const statusSubTitle = profile?.os || server?.host || "点击刷新读取实时状态";

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
        {/* 自动刷新 / 刷新按钮只保留底部行一处（原型 951-954 行），头部重复控件已删 */}
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

      {/* 骨架屏已按反馈移除：与实际内容尺寸不一致导致消失后抖动。加载反馈由底部「刷新」按钮的
          server-status-spin 旋转图标承担，布局零位移 */}

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

          {/* 原型 s9 880-887：三张指标卡直接排在 dbody 内（无外层标题卡），卡片自带 1h 迷你趋势线
              线色与原型同源（注释见顶部 CHART_COLOR_* 常量：accent 蓝 / green 绿 / amber 橙） */}
          <div className="server-status-trend-cards" aria-label="监控趋势">
            <TrendCard label="CPU" windowLabel="1h" value={loadPerCore} color={CHART_COLOR_CPU} samples={seriesCpu1h} spikeIndex={hasSpike1h ? cpuSpikeIndex1h : undefined} />
            <TrendCard label="内存" windowLabel="1h" value={memory?.percent || 0} color={CHART_COLOR_MEM} samples={seriesMem1h} />
            <TrendCard label={topDiskMount ? `磁盘 ${topDiskMount}` : "磁盘"} windowLabel="1h" value={diskMax} color={CHART_COLOR_DISK} samples={seriesDisk1h} />
          </div>

          <section className="server-status-monitor" aria-label="监控记录">
            <div className="server-status-monitor-head">
              <b className="server-status-monitor-title">监控记录</b>
              <span className={`chip server-status-monitor-chip${hasAnomaly ? " red" : ""}`}>
                {hasAnomaly ? (
                  // 关键信息禁省略号（原型 decision ⑥）：异常文案走无缝滚动；灰色常态文案短，静态即可
                  <span className="marq">
                    <span>{`${anomalyText}\u00a0\u00a0·\u00a0\u00a0${anomalyText}`}</span>
                  </span>
                ) : (
                  <span>{anomalyText}</span>
                )}
              </span>
              <span className="server-status-monitor-spacer" />
              <div className="seg lite server-status-monitor-range" role="group" aria-label="监控记录时间范围">
                {TREND_RANGES.map((key) => (
                  <button
                    key={key}
                    type="button"
                    className={key === trendRange ? "on" : undefined}
                    aria-pressed={key === trendRange}
                    title={`最近 ${TREND_RANGE_LABEL[key]}`}
                    onClick={() => setTrendRange(key)}
                  >
                    {TREND_RANGE_LABEL[key]}
                  </button>
                ))}
              </div>
            </div>
            <div className="server-status-monitor-chart-wrap">
              <MonitorChart cpu={seriesCpu} mem={seriesMem} />
            </div>
            <div className="server-status-monitor-legend">
              <span><i className="swatch accent" />CPU</span>
              <span><i className="swatch green" />内存</span>
              <span><i className="dot red" />异常事件</span>
              <span className="server-status-monitor-spacer" />
              <span className="mono server-status-monitor-span">{windowStartLabel} ─ {windowEndLabel}</span>
            </div>
          </section>

          <section className="server-status-card server-status-process-card">
            <div className="server-status-card-title server-status-process-title">
              <b>进程 TOP 5</b>
              <span className="server-status-process-sort mono">按 CPU</span>
            </div>
            <div className="server-status-process-rows mono">
              {[...profile.processes]
                .sort((left, right) => right.cpuPercent - left.cpuPercent)
                .slice(0, 5)
                .map((process) => {
                  // 原型行式：进程名 + CPU% + 内存 + 说明，单行等宽；CPU% 按阈值着色
                  const cpuTone = processCpuTone(process.cpuPercent);
                  return (
                    <div key={`${process.pid}-${process.command}`} className="server-status-process-row">
                      <span className="server-status-process-name">{processName(process.command, process.pid)}</span>
                      <span className={cpuTone ? `server-status-process-cpu server-status-process-cpu-${cpuTone}` : "server-status-process-cpu"}>
                        {process.cpuPercent.toFixed(1)}%
                      </span>
                      <span className="server-status-process-mem">{formatBytes(process.rssKb * 1024)}</span>
                      <span className="server-status-process-args">{processArgs(process.command)}</span>
                    </div>
                  );
                })}
              {profile.processes.length === 0 ? <p className="server-status-empty">未读取到进程排行</p> : null}
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

          {/* 核心负载 / 系统信息卡（原型 dbody 无此块）：按反馈沉到面板底部 */}
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

          {profile.warnings.length > 0 ? (
            <section className="server-status-warning-list">
              {profile.warnings.map((warning) => <span key={warning}>{warning}</span>)}
            </section>
          ) : null}

          <div className="server-status-foot">
            <span className="server-status-foot-note">每 {Math.round(refreshIntervalMs / 1000)} 秒采样 · 本地保留 1 小时环形缓冲</span>
            <button
              type="button"
              className={`pill server-status-foot-auto${autoRefresh ? " on" : ""}`}
              onClick={onToggleAutoRefresh}
              disabled={!server}
              title={autoRefresh ? "关闭自动刷新" : "开启自动刷新"}
            >
              自动
            </button>
            <button className="ghost-button slim-button server-status-foot-refresh" type="button" onClick={onRefresh} disabled={!server || loading} title="刷新状态">
              <RefreshCw size={12} className={loading ? "server-status-spin" : ""} />
              刷新
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
