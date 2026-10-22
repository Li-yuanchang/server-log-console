/**
 * ServerStatusPanel — 服务器性能监控（B 骨架 + A 磁盘块，2026-10 重设计）
 *
 * 结构：身份区 → 4 个指标 tile → 双轴趋势图 → 风险预警 → 磁盘（A 样式）→ 进程 TOP 5 → 网络 → 系统
 * 样式：styles-server-monitor.css（smp- 前缀 + container query 响应式），与旧 server-status-* 规则解耦。
 *
 * 本次针对用户反馈的四处修正：
 * ① 卡片贴边     → 统一 --pad-x/--pad-y 内距，所有卡片同源
 * ② 折线图无波动 → Y 轴按数据域自适应（不再死钉 0-100）+ 实际刻度 + 80% 阈值线
 *                  并且 CPU 改用真实利用率（profile.cpu.usagePercent），不再用 load/核数 冒充
 * ③ 磁盘首屏看不到 → 窄档压紧纵向节奏，磁盘卡留在首屏
 * ④ 无响应式     → container query 按面板自身宽度分档（<360 / <560 / >=560 / >=720）
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import {
  Activity,
  AlertTriangle,
  Cpu,
  Database,
  HardDrive,
  Network,
  RefreshCw,
  Server,
} from "lucide-react";
import type {
  ServerSummary,
  ServerSystemDisk,
  ServerSystemProfileResponse,
} from "@server-log-console/shared";
import { useEscapeToClose } from "./useEscapeToClose.js";

// 监控趋势：前端环形缓冲，默认 10s/次采样，360 个点 ≈ 1 小时
const TREND_SAMPLE_CAPACITY = 360;

// 异常事件阈值：窗口内 CPU ≥60% 记一个异常点（与日志 ERROR 时间对齐）
const ANOMALY_CPU_THRESHOLD = 60;

// 风险阈值：磁盘 ≥70% 提示、≥85% 危险；内存 ≥80% / ≥90%
const DISK_WARN_PERCENT = 70;
const DISK_CRIT_PERCENT = 85;
const MEM_WARN_PERCENT = 80;
const MEM_CRIT_PERCENT = 90;
// 阈值线（图表里的红色虚线）
const CHART_THRESHOLD_PERCENT = 80;

const TREND_RANGES = ["5m", "30m", "1h"] as const;
type TrendRangeKey = (typeof TREND_RANGES)[number];
const TREND_RANGE_MS: Record<TrendRangeKey, number> = {
  "5m": 5 * 60 * 1000,
  "30m": 30 * 60 * 1000,
  "1h": 60 * 60 * 1000,
};
const TREND_RANGE_LABEL: Record<TrendRangeKey, string> = {
  "5m": "5 分钟",
  "30m": "30 分钟",
  "1h": "1 小时",
};

type TrendSample = {
  t: number;
  serverId: string;
  /** 真实 CPU 利用率（拿不到时是 load/核数 折算值，见 cpuIsEstimate） */
  cpu: number;
  mem: number;
  disk: number;
  /** load 1 分钟均值（右轴，真实量纲 0~核数） */
  load: number;
};

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

/* ------------------------------------------------------------------ */
/* 工具函数                                                             */
/* ------------------------------------------------------------------ */

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

function formatClock(ms: number): string {
  if (!Number.isFinite(ms)) return "--:--";
  const date = new Date(ms);
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, value));
}

/** 进度条色阶：≥85 红、≥70 橙、其余蓝 */
function barTone(percent: number): string {
  if (percent >= DISK_CRIT_PERCENT) return "smp-bar-crit";
  if (percent >= DISK_WARN_PERCENT) return "smp-bar-warn";
  return "";
}

/** 进程名：command 首 token 去掉路径 */
function processName(command: string, pid: number): string {
  const first = (command || "").trim().split(/\s+/)[0] || "";
  if (!first) return `PID ${pid}`;
  return first.split("/").pop() || first;
}
function processArgs(command: string): string {
  return (command || "").trim().split(/\s+/).slice(1).join(" ");
}
/** 进程 CPU% 高亮分档：≥10% 红、≥5% 橙 */
function processCpuTone(value: number): "" | "hi" | "md" {
  if (value >= 10) return "hi";
  if (value >= 5) return "md";
  return "";
}

/* ------------------------------------------------------------------ */
/* 尺寸量测：图表用真实像素绘制，避免 viewBox 拉伸导致字号变形            */
/* ------------------------------------------------------------------ */

function useBoxSize<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const rect = el.getBoundingClientRect();
      setSize({ width: rect.width, height: rect.height });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, size] as const;
}

/** Catmull-Rom → 三次贝塞尔，折线不再生硬 */
function smoothPath(points: Array<[number, number]>): string {
  if (points.length < 2) return "";
  let d = `M${points[0][0].toFixed(1)},${points[0][1].toFixed(1)}`;
  for (let i = 0; i < points.length - 1; i += 1) {
    const p0 = points[i - 1] || points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] || p2;
    const c1x = p1[0] + (p2[0] - p0[0]) / 6;
    const c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6;
    const c2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += ` C${c1x.toFixed(1)},${c1y.toFixed(1)} ${c2x.toFixed(1)},${c2y.toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
  }
  return d;
}

/* ------------------------------------------------------------------ */
/* 迷你趋势线（指标 tile 内，1 小时全量缓冲）                             */
/* ------------------------------------------------------------------ */

function Sparkline({ data, toneClass }: { data: number[]; toneClass: string }) {
  if (data.length < 2) {
    return <div className="smp-spark-empty">采样积累中…</div>;
  }
  const width = 100;
  const height = 26;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const span = Math.max(0.8, max - min);
  let lo = min - span * 0.25;
  let hi = max + span * 0.25;
  // 最小可视跨度 8 个百分点：小抖动保持平坦，不假装剧烈波动
  if (hi - lo < 8) {
    const mid = (hi + lo) / 2;
    lo = mid - 4;
    hi = mid + 4;
  }
  const x = (index: number) => (index / (data.length - 1)) * width;
  const y = (value: number) => height - ((value - lo) / (hi - lo)) * (height - 3) - 1.5;
  const points = data.map((value, index) => `${x(index).toFixed(1)},${y(value).toFixed(1)}`).join(" ");
  const areaPoints = `0,${height} ${points} ${width},${height}`;
  return (
    <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className="smp-tile-spark" aria-hidden="true">
      <polygon points={areaPoints} className={toneClass.replace("smp-series", "smp-area")} />
      <polyline
        points={points}
        fill="none"
        strokeWidth={1.4}
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
        className={toneClass}
      />
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* 主趋势图：Y 轴自适应 + 双轴 + 阈值线 + 悬停读数                        */
/* ------------------------------------------------------------------ */

type ChartSeries = {
  key: string;
  label: string;
  lineClass: string;
  areaClass: string;
  dotClass: string;
  data: number[];
  visible: boolean;
  /** pct = 左轴百分比；load = 右轴负载 */
  axis: "pct" | "load";
};

type TrendChartProps = {
  series: ChartSeries[];
  /** 右轴最大值（load 量纲） */
  loadAxisMax: number;
  /** 时间轴起止（毫秒），用于刻度标签 */
  windowStart: number;
  windowEnd: number;
};

function TrendChart({ series, loadAxisMax, windowStart, windowEnd }: TrendChartProps) {
  const [boxRef, size] = useBoxSize<HTMLDivElement>();
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  const visibleSeries = series.filter((item) => item.visible && item.data.length >= 2);
  const pointCount = Math.max(...series.map((item) => item.data.length), 0);

  if (pointCount < 2 || visibleSeries.length === 0) {
    return (
      <div className="smp-plot" ref={boxRef}>
        <div className="smp-plot-empty">
          <span>{pointCount < 2 ? "采样积累中…" : "已隐藏全部曲线"}</span>
        </div>
      </div>
    );
  }

  const width = Math.max(180, size.width);
  const height = Math.max(90, size.height);
  const padL = 30;
  const padR = loadAxisMax > 0 ? 30 : 8;
  const padT = 10;
  const padB = 18;
  const innerW = width - padL - padR;
  const innerH = height - padT - padB;

  // Y 轴（左轴，百分比）：按数据域自适应取 5 的整数倍
  const pctSeries = visibleSeries.filter((item) => item.axis === "pct");
  let dataLo = Number.POSITIVE_INFINITY;
  let dataHi = Number.NEGATIVE_INFINITY;
  for (const item of pctSeries) {
    for (const value of item.data) {
      if (value < dataLo) dataLo = value;
      if (value > dataHi) dataHi = value;
    }
  }
  if (!Number.isFinite(dataLo)) {
    dataLo = 0;
    dataHi = 100;
  }
  const dataSpan = Math.max(1.5, dataHi - dataLo);
  let lo = dataLo - dataSpan * 0.35;
  let hi = dataHi + dataSpan * 0.35;
  // 最小可视跨度 12 个百分点，避免 ±0.6% 的抖动被拉满整幅
  if (hi - lo < 12) {
    const mid = (hi + lo) / 2;
    lo = mid - 6;
    hi = mid + 6;
  }
  lo = Math.max(0, Math.floor(lo / 5) * 5);
  hi = Math.min(100, Math.ceil(hi / 5) * 5);
  // 数据靠近 0 时回锚 0：百分比图从 0 起算更有意义
  if (dataLo < 20) lo = 0;
  if (hi - lo < 12) hi = Math.min(100, lo + 12);
  const span = hi - lo;

  const xFor = (index: number) => padL + (index / (pointCount - 1)) * innerW;
  const yPct = (value: number) => padT + innerH - ((value - lo) / span) * innerH;
  const yLoad = (value: number) =>
    padT + innerH - (Math.min(Math.max(value, 0), loadAxisMax) / loadAxisMax) * innerH;

  // 左轴刻度（4 段）
  const ticks: Array<{ value: number; y: number }> = [];
  for (let k = 0; k <= 4; k += 1) {
    const value = lo + (span * k) / 4;
    ticks.push({ value, y: yPct(value) });
  }

  // 阈值线：数据域覆盖到阈值时才画
  const showThreshold = hi >= CHART_THRESHOLD_PERCENT;
  const thresholdY = showThreshold ? yPct(CHART_THRESHOLD_PERCENT) : 0;
  const thresholdLabelAbove = thresholdY - 5 > padT + 8;

  // 悬停：鼠标位置换算到最近数据点
  const handleMove = (event: ReactMouseEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const relativeX = event.clientX - rect.left;
    const ratio = (relativeX - padL) / Math.max(1, innerW);
    const index = Math.round(ratio * (pointCount - 1));
    if (index < 0 || index > pointCount - 1) {
      setHoverIndex(null);
      return;
    }
    setHoverIndex(index);
  };

  const hoverCpu = hoverIndex != null ? visibleSeries.find((item) => item.key === "cpu") : undefined;
  const hoverMem = hoverIndex != null ? visibleSeries.find((item) => item.key === "mem") : undefined;
  const hoverX = hoverIndex != null ? xFor(hoverIndex) : 0;
  const hoverY =
    hoverCpu && hoverIndex != null ? yPct(hoverCpu.data[hoverIndex] ?? 0) : padT + innerH / 2;

  // 气泡：优先放上方，留 10px 净空不压住被标注的点
  const tipWidth = 96;
  const tipHeight = 46;
  const tipAbove = hoverY - tipHeight - 10 >= 0;
  const tipTop = tipAbove ? hoverY - tipHeight - 10 : Math.min(height - tipHeight - 2, hoverY + 12);
  const tipLeft = Math.min(width - tipWidth - 4, Math.max(4, hoverX - tipWidth / 2));

  return (
    <div
      className="smp-plot"
      ref={boxRef}
      onMouseMove={handleMove}
      onMouseLeave={() => setHoverIndex(null)}
    >
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
        {/* 网格 + 左轴刻度 */}
        {ticks.map((tick, index) => (
          <g key={`tick-${index}`}>
            <line
              x1={padL}
              y1={tick.y}
              x2={width - padR}
              y2={tick.y}
              strokeWidth={1}
              strokeDasharray={index === 0 ? undefined : "2 4"}
              className={index === 0 ? "smp-grid-base" : "smp-grid"}
            />
            <text x={padL - 6} y={tick.y + 3.5} textAnchor="end" className="smp-axis-text">
              {tick.value.toFixed(0)}%
            </text>
          </g>
        ))}

        {/* 阈值线 */}
        {showThreshold ? (
          <>
            <line
              x1={padL}
              y1={thresholdY}
              x2={width - padR}
              y2={thresholdY}
              strokeWidth={1}
              strokeDasharray="3 3"
              className="smp-threshold"
            />
            <text
              x={width - padR}
              y={thresholdLabelAbove ? thresholdY - 5 : thresholdY + 11}
              textAnchor="end"
              className="smp-threshold-text"
            >
              阈值 {CHART_THRESHOLD_PERCENT}%
            </text>
          </>
        ) : null}

        {/* 曲线 + 面积 */}
        {visibleSeries.map((item) => {
          const points = item.data.map((value, index) => [
            xFor(index),
            item.axis === "pct" ? yPct(value) : yLoad(value),
          ] as [number, number]);
          const path = smoothPath(points);
          if (!path) return null;
          const baseline = padT + innerH;
          return (
            <g key={item.key}>
              {item.axis === "pct" ? (
                <path
                  d={`${path} L${xFor(item.data.length - 1).toFixed(1)},${baseline} L${padL},${baseline} Z`}
                  className={item.areaClass}
                />
              ) : null}
              <path
                d={path}
                fill="none"
                strokeWidth={item.axis === "load" ? 1.2 : item.key === "cpu" ? 1.8 : 1.4}
                strokeLinejoin="round"
                strokeLinecap="round"
                className={item.lineClass}
              />
            </g>
          );
        })}

        {/* 右轴：load */}
        {loadAxisMax > 0
          ? [0, 1, 2, 3, 4].map((k) => {
              const value = (loadAxisMax * k) / 4;
              const y = padT + innerH - (k / 4) * innerH;
              return (
                <g key={`load-${k}`}>
                  <text x={width - padR + 6} y={y + 3.5} className="smp-axis-text">
                    {value.toFixed(1)}
                  </text>
                  {k === 4 ? (
                    <text x={width - padR + 6} y={y - 6} className="smp-axis-text" style={{ fontSize: 8.5 }}>
                      load
                    </text>
                  ) : null}
                </g>
              );
            })
          : null}

        {/* 悬停十字线 + 点 */}
        {hoverIndex != null ? (
          <g>
            <line
              x1={hoverX}
              y1={padT}
              x2={hoverX}
              y2={padT + innerH}
              strokeWidth={1}
              className="smp-crosshair"
            />
            {hoverCpu ? (
              <circle cx={hoverX} cy={hoverY} r={3} className={`smp-crosshair-dot ${hoverCpu.dotClass}`} />
            ) : null}
            {hoverMem && hoverIndex < hoverMem.data.length ? (
              <circle
                cx={hoverX}
                cy={yPct(hoverMem.data[hoverIndex])}
                r={2.5}
                className={`smp-crosshair-dot ${hoverMem.dotClass}`}
              />
            ) : null}
          </g>
        ) : null}

        {/* 时间轴 */}
        {[0, 0.5, 1].map((fraction, index) => {
          const x = padL + innerW * fraction;
          const span = Math.max(0, windowEnd - windowStart);
          const time = windowStart + span * fraction;
          const label = pointCount >= 2 ? formatClock(time) : "--:--";
          return (
            <text
              key={`x-${index}`}
              x={x}
              y={height - 5}
              textAnchor={fraction === 0 ? "start" : fraction === 1 ? "end" : "middle"}
              className="smp-axis-text"
            >
              {label}
            </text>
          );
        })}
      </svg>

      {/* 悬停读数气泡 */}
      {hoverIndex != null && (hoverCpu || hoverMem) ? (
        <div className="smp-tip" style={{ left: tipLeft, top: Math.max(2, tipTop) }}>
          <b>{formatClock(windowStart + ((windowEnd - windowStart) * hoverIndex) / Math.max(1, pointCount - 1))}</b>
          {hoverCpu && hoverIndex < hoverCpu.data.length ? (
            <div className="smp-tip-row">
              <i className="smp-tip-dot" style={{ background: "var(--accent)" }} />
              CPU {(hoverCpu.data[hoverIndex] ?? 0).toFixed(1)}%
            </div>
          ) : null}
          {hoverMem && hoverIndex < hoverMem.data.length ? (
            <div className="smp-tip-row">
              <i className="smp-tip-dot" style={{ background: "var(--green)" }} />
              内存 {(hoverMem.data[hoverIndex] ?? 0).toFixed(1)}%
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 指标 tile                                                           */
/* ------------------------------------------------------------------ */

type TileProps = {
  label: string;
  dotColor: string;
  value: string;
  unit: string;
  sub: string;
  /** 副行第二段（如磁盘容量）。与 sub 分行显示，避免 4 列 tile 变窄后把整串挤成省略号 */
  sub2?: string;
  spark: number[];
  lineClass: string;
  tone?: "warn" | "crit";
  /** 右上角时间窗角标（默认 1h：指标卡迷你线固定画全量缓冲） */
  windowLabel?: string;
};

function MetricTile({ label, dotColor, value, unit, sub, sub2, spark, lineClass, tone, windowLabel = "1h" }: TileProps) {
  const className = ["smp-tile"];
  if (tone === "warn") className.push("smp-tile-warn");
  if (tone === "crit") className.push("smp-tile-crit");
  return (
    <div className={className.join(" ")}>
      <div className="smp-tile-top">
        <span className="smp-dot" style={{ background: dotColor }} />
        <span>{label}</span>
        <span className="smp-tile-sp" />
        <span className="smp-tile-win">{windowLabel}</span>
      </div>
      <div className="smp-tile-v">
        {value}
        <i>{unit}</i>
      </div>
      <div className="smp-tile-sub" title={sub2 ? `${sub} · ${sub2}` : sub}>{sub}</div>
      {sub2 ? <div className="smp-tile-sub smp-tile-sub2" title={sub2}>{sub2}</div> : null}
      <Sparkline data={spark} toneClass={lineClass} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 主组件                                                              */
/* ------------------------------------------------------------------ */

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
  onClose,
}: Props) {
  useEscapeToClose(visible, onClose);

  // 监控记录时序图时间范围（默认 30 分钟）
  const [trendRange, setTrendRange] = useState<TrendRangeKey>("30m");
  // 图例开关：默认 CPU + 内存 + load 全开；磁盘恒定曲线默认关（几乎不动，开着只会压平主图）
  const [hiddenSeries, setHiddenSeries] = useState<Record<string, boolean>>({ disk: true });

  // 环形缓冲：每次成功采样 push 一个点。
  // trendSamplesRef 是 ref，push 后不会触发重算 —— 用 trendTick 作为 useMemo 的失效信号，
  // 否则图表会一直停留在首帧数据（采样在涨、曲线不动）。
  const trendSamplesRef = useRef<TrendSample[]>([]);
  const [trendTick, setTrendTick] = useState(0);

  useEffect(() => {
    if (!profile) return;
    const collectedAtMs = Date.parse(profile.collectedAt);
    const sampleTime = Number.isFinite(collectedAtMs) ? collectedAtMs : Date.now();
    const list = trendSamplesRef.current;
    const last = list[list.length - 1];
    // 切换服务器清空缓冲，避免两台主机采样混在一条趋势里
    if (last && last.serverId !== profile.serverId) {
      list.length = 0;
    } else if (last && last.t === sampleTime) {
      return;
    }
    const cores = profile.cpu.cores || 0;
    const sampleLoad = profile.loadAverage[0] || 0;
    // CPU：优先真实利用率；缺失时回退「负载/核数」折算（该口径会 >100%，故截断并标注）
    const sampleCpu =
      typeof profile.cpu.usagePercent === "number"
        ? clampPercent(profile.cpu.usagePercent)
        : cores > 0
          ? clampPercent((sampleLoad / cores) * 100)
          : 0;
    const sampleDiskMax = Math.max(...(profile.disks || []).map((disk) => disk.percent), 0);
    list.push({
      t: sampleTime,
      serverId: profile.serverId,
      cpu: sampleCpu,
      mem: clampPercent(profile.memory?.percent || 0),
      disk: clampPercent(sampleDiskMax),
      load: sampleLoad,
    });
    if (list.length > TREND_SAMPLE_CAPACITY) {
      list.splice(0, list.length - TREND_SAMPLE_CAPACITY);
    }
    setTrendTick((current) => current + 1);
  }, [profile]);

  const toggleSeries = useCallback((key: string) => {
    setHiddenSeries((current) => ({ ...current, [key]: !current[key] }));
  }, []);

  /* ---- 派生数据：全部在提前 return 之前算，避免 hooks 顺序问题 ---- */
  const derived = useMemo(() => {
    const allSamples = trendSamplesRef.current;
    const memory = profile?.memory;
    const swap = profile?.swap;
    const diskList = profile?.disks || [];
    const diskMax = Math.max(...diskList.map((disk) => disk.percent), 0);
    const topDisk: ServerSystemDisk | null = diskList.reduce<ServerSystemDisk | null>(
      (best, disk) => (best == null || disk.percent > best.percent ? disk : best),
      null
    );
    const cores = profile?.cpu.cores || 0;
    const load1 = profile?.loadAverage[0] || 0;
    const loadPerCore = cores > 0 ? clampPercent((load1 / cores) * 100) : 0;
    const hasRealCpuUsage = typeof profile?.cpu.usagePercent === "number";
    const cpuPercent = hasRealCpuUsage ? clampPercent(profile!.cpu.usagePercent!) : loadPerCore;

    const now = Date.now();
    const windowStart = now - TREND_RANGE_MS[trendRange];
    const windowSamples = allSamples.filter((sample) => sample.t >= windowStart);
    // 采不到点时退化为全量，避免一进面板就是空图
    const chartSamples = windowSamples.length >= 2 ? windowSamples : allSamples;

    const anomalyCount = chartSamples.reduce(
      (sum, sample) => (sample.cpu >= ANOMALY_CPU_THRESHOLD ? sum + 1 : sum),
      0
    );

    return {
      allSamples,
      memory,
      swap,
      diskList,
      diskMax,
      topDisk,
      cores,
      load1,
      loadPerCore,
      hasRealCpuUsage,
      cpuPercent,
      chartSamples,
      anomalyCount,
      windowStart: chartSamples.length >= 2 ? chartSamples[0].t : now,
      windowEnd: chartSamples.length >= 2 ? chartSamples[chartSamples.length - 1].t : now,
    };
  }, [profile, trendRange, trendTick]);

  if (!visible) return null;

  const {
    allSamples,
    memory,
    swap,
    diskList,
    diskMax,
    topDisk,
    cores,
    load1,
    loadPerCore,
    hasRealCpuUsage,
    cpuPercent,
    chartSamples,
    anomalyCount,
    windowStart,
    windowEnd,
  } = derived;

  const sourceLabel =
    profile?.source === "jumpserver"
      ? "JumpServer 资产"
      : profile?.source === "bastion"
        ? "堡垒机目标"
        : "直连主机";
  const statusTitle = profile?.hostname || server?.name || "未选择服务器";
  const statusSubTitle = profile?.os || server?.host || "点击刷新读取实时状态";

  // 右轴最大值：按窗口内最大 load 向上取整并留 10% 余量，避免曲线贴顶
  const windowMaxLoad = Math.max(...chartSamples.map((sample) => sample.load), 0);
  const loadAxisMax = Math.max(1, Math.ceil(windowMaxLoad * 1.1));

  // 磁盘风险预警：距离 85% 阈值还剩多少容量（真实可算，不做「N 天后」的臆测）
  const diskWarnText = (() => {
    if (!topDisk) return "";
    const thresholdBytes = (DISK_CRIT_PERCENT / 100) * topDisk.total;
    const remaining = thresholdBytes - topDisk.used;
    if (topDisk.percent >= DISK_CRIT_PERCENT) {
      return `${topDisk.mount} 已用 ${topDisk.percent.toFixed(0)}%，已超过 ${DISK_CRIT_PERCENT}% 阈值，建议尽快清理`;
    }
    if (remaining > 0) {
      return `${topDisk.mount} 已用 ${topDisk.percent.toFixed(0)}%，距离 ${DISK_CRIT_PERCENT}% 阈值还剩 ${formatBytes(remaining)}`;
    }
    return "";
  })();

  const diskTileTone: TileProps["tone"] =
    diskMax >= DISK_CRIT_PERCENT ? "crit" : diskMax >= DISK_WARN_PERCENT ? "warn" : undefined;
  const memPercent = memory?.percent || 0;
  const memTileTone: TileProps["tone"] =
    memPercent >= MEM_CRIT_PERCENT ? "crit" : memPercent >= MEM_WARN_PERCENT ? "warn" : undefined;

  const chartSeries: ChartSeries[] = [
    {
      key: "cpu",
      label: "CPU",
      lineClass: "smp-series-cpu",
      areaClass: "smp-area-cpu",
      dotClass: "smp-crosshair-dot-cpu",
      data: chartSamples.map((sample) => sample.cpu),
      visible: !hiddenSeries.cpu,
      axis: "pct",
    },
    {
      key: "mem",
      label: "内存",
      lineClass: "smp-series-mem",
      areaClass: "smp-area-mem",
      dotClass: "smp-crosshair-dot-mem",
      data: chartSamples.map((sample) => sample.mem),
      visible: !hiddenSeries.mem,
      axis: "pct",
    },
    {
      key: "disk",
      label: "磁盘",
      lineClass: "smp-series-disk",
      areaClass: "smp-area-disk",
      dotClass: "smp-crosshair-dot-cpu",
      data: chartSamples.map((sample) => sample.disk),
      visible: !hiddenSeries.disk,
      axis: "pct",
    },
    {
      key: "load",
      label: "load",
      lineClass: "smp-series-load",
      areaClass: "smp-area-disk",
      dotClass: "smp-crosshair-dot-cpu",
      data: chartSamples.map((sample) => sample.load),
      visible: !hiddenSeries.load,
      axis: "load",
    },
  ];

  return (
    <div className="smp-panel">
      {/* 错误提示 */}
      {error ? (
        <div className="smp-error">
          <AlertTriangle size={14} />
          <span>{error}</span>
        </div>
      ) : null}

      {contextLabel ? (
        <div className="smp-chip" style={{ alignSelf: "flex-start", margin: "0 var(--pad-x) 8px" }}>
          {contextLabel}
        </div>
      ) : null}

      {profile ? (
        <div className="smp-scroll">
          {/* 身份区 */}
          <div className="smp-head">
            <span className="smp-avatar">
              <Server size={15} strokeWidth={1.7} />
            </span>
            <div className="smp-id">
              <b title={statusTitle}>{statusTitle}</b>
              <small title={`${statusSubTitle} · ${profile.host} · ${cores || "-"} 核`}>
                {statusSubTitle} · {profile.host} · {cores || "-"} 核
              </small>
            </div>
            <span className={`smp-chip ${anomalyCount > 0 ? "smp-chip-crit" : "smp-chip-ok"}`}>
              <span className={`smp-dot ${anomalyCount > 0 ? "smp-dot-crit" : "smp-dot-ok"}`} />
              {anomalyCount > 0 ? `异常 ${anomalyCount}` : "正常"}
            </span>
          </div>

          {/* 指标 tile（B 骨架：420 两列 / 560+ 四列） */}
          <div className="smp-tiles">
            <MetricTile
              label="CPU"
              dotColor="var(--accent)"
              value={cpuPercent.toFixed(1)}
              unit="%"
              sub={
                hasRealCpuUsage
                  ? `load ${load1.toFixed(2)} / ${cores || "-"} 核`
                  : `负载折算 · load ${load1.toFixed(2)}`
              }
              spark={allSamples.map((sample) => sample.cpu)}
              lineClass="smp-series-cpu"
            />
            <MetricTile
              label="内存"
              dotColor="var(--green)"
              value={memPercent.toFixed(1)}
              unit="%"
              sub={`${formatBytes(memory?.used || 0)} / ${formatBytes(memory?.total || 0)}`}
              spark={allSamples.map((sample) => sample.mem)}
              lineClass="smp-series-mem"
              tone={memTileTone}
            />
            <MetricTile
              label="磁盘"
              dotColor="var(--amber)"
              value={diskMax.toFixed(0)}
              unit="%"
              sub={topDisk ? topDisk.mount : "-"}
              sub2={topDisk ? `${formatBytes(topDisk.used)} / ${formatBytes(topDisk.total)}` : undefined}
              spark={allSamples.map((sample) => sample.disk)}
              lineClass="smp-series-disk"
              tone={diskTileTone}
            />
            <MetricTile
              label="Swap"
              dotColor="var(--ink-muted)"
              value={clampPercent(swap?.percent || 0).toFixed(0)}
              unit="%"
              sub={`${formatBytes(swap?.used || 0)} / ${formatBytes(swap?.total || 0)}`}
              spark={allSamples.map((sample) => sample.mem)}
              lineClass="smp-series-mem"
            />
          </div>

          {/* 趋势图 */}
          <section className="smp-card">
            <div className="smp-card-head">
              <span className="smp-card-ttl">负载趋势</span>
              {anomalyCount > 0 ? (
                <span className="smp-chip smp-chip-crit">
                  <span className="smp-dot smp-dot-crit" />尖峰 {anomalyCount}
                </span>
              ) : null}
              <span className="smp-card-sp" />
              <div className="smp-range" role="group" aria-label="监控记录时间范围">
                {TREND_RANGES.map((key) => (
                  <button
                    key={key}
                    type="button"
                    className={key === trendRange ? "on" : undefined}
                    aria-pressed={key === trendRange}
                    title={`最近 ${TREND_RANGE_LABEL[key]}`}
                    onClick={() => setTrendRange(key)}
                  >
                    {key}
                  </button>
                ))}
              </div>
            </div>
            <div className="smp-card-body" style={{ padding: "10px 10px 2px" }}>
              <TrendChart
                series={chartSeries}
                loadAxisMax={loadAxisMax}
                windowStart={windowStart}
                windowEnd={windowEnd}
              />
            </div>
            <div className="smp-legend">
              {chartSeries.map((item) => {
                const className = ["smp-legend-item"];
                if (!hiddenSeries[item.key]) className.push("on");
                else className.push("off");
                return (
                  <button
                    key={item.key}
                    type="button"
                    className={className.join(" ")}
                    title={hiddenSeries[item.key] ? `显示 ${item.label}` : `隐藏 ${item.label}`}
                    onClick={() => toggleSeries(item.key)}
                  >
                    <i
                      className={item.key === "load" ? "smp-legend-sw-dashed" : "smp-legend-sw"}
                      style={item.key === "load" ? undefined : { background: `var(--${item.key === "cpu" ? "accent" : item.key === "mem" ? "green" : "amber"})` }}
                    />
                    {item.label}
                  </button>
                );
              })}
              <span className="smp-card-sp" />
              <span className="smp-mono" style={{ fontSize: "var(--fs-2xs)", color: "var(--ink-muted)" }}>
                左 % · 右 load
              </span>
            </div>
          </section>

          {/* 风险预警 */}
          {diskWarnText ? (
            <div className="smp-warnrow">
              <AlertTriangle size={12} />
              <span>{diskWarnText}</span>
            </div>
          ) : null}

          {/* 磁盘（A 样式：挂载点 / 设备名 / 容量 分行 + 独立进度条） */}
          <section className="smp-card">
            <div className="smp-card-head">
              <HardDrive size={14} strokeWidth={1.8} />
              <span className="smp-card-ttl">磁盘</span>
              <span className="smp-chip smp-chip-warn">最高 {diskMax.toFixed(0)}%</span>
              <span className="smp-card-sp" />
              <span className="smp-mono" style={{ fontSize: "var(--fs-2xs)", color: "var(--ink-muted)" }}>
                {diskList.length} 个挂载点
              </span>
            </div>
            <div className="smp-card-body smp-disks" style={{ paddingTop: 2, paddingBottom: 6 }}>
              {diskList.slice(0, 8).map((disk) => (
                <div className="smp-disk" key={`${disk.filesystem}-${disk.mount}`}>
                  <div className="smp-disk-mount" title={disk.mount}>{disk.mount}</div>
                  <div className="smp-disk-fs" title={disk.filesystem}>{disk.filesystem || "-"}</div>
                  <div className="smp-disk-usage">
                    <b>{disk.percent.toFixed(0)}%</b> · {formatBytes(disk.used)} / {formatBytes(disk.total)}
                  </div>
                  <div className={`smp-bar ${barTone(disk.percent)}`}>
                    <i style={{ width: `${clampPercent(disk.percent)}%` }} />
                  </div>
                </div>
              ))}
              {diskList.length === 0 ? <p className="smp-empty">未读取到磁盘信息</p> : null}
            </div>
          </section>

          {/* 进程 TOP 5 */}
          <section className="smp-card">
            <div className="smp-card-head">
              <Cpu size={14} strokeWidth={1.8} />
              <span className="smp-card-ttl">进程 TOP 5</span>
              <span className="smp-card-sp" />
              <span className="smp-mono" style={{ fontSize: "var(--fs-2xs)", color: "var(--ink-muted)" }}>按 CPU</span>
            </div>
            <div className="smp-card-body smp-proc" style={{ paddingTop: 4, paddingBottom: 6 }}>
              {[...profile.processes]
                .sort((left, right) => right.cpuPercent - left.cpuPercent)
                .slice(0, 5)
                .map((process) => {
                  const tone = processCpuTone(process.cpuPercent);
                  const cpuClass = ["smp-prow-cpu"];
                  if (tone === "hi") cpuClass.push("smp-prow-cpu-hi");
                  if (tone === "md") cpuClass.push("smp-prow-cpu-md");
                  return (
                    <div className="smp-prow" key={`${process.pid}-${process.command}`}>
                      <span className="smp-prow-name" title={process.command}>
                        {processName(process.command, process.pid)}
                      </span>
                      <span className={cpuClass.join(" ")}>{process.cpuPercent.toFixed(1)}%</span>
                      <span className="smp-prow-rss">{formatBytes(process.rssKb * 1024)}</span>
                      <span className="smp-prow-args" title={processArgs(process.command)}>
                        {processArgs(process.command)}
                      </span>
                    </div>
                  );
                })}
              {profile.processes.length === 0 ? <p className="smp-empty">未读取到进程排行</p> : null}
            </div>
          </section>

          {/* 网络 */}
          <section className="smp-card">
            <div className="smp-card-head">
              <Network size={14} strokeWidth={1.8} />
              <span className="smp-card-ttl">网络</span>
              <span className="smp-card-sp" />
              <span className="smp-mono" style={{ fontSize: "var(--fs-2xs)", color: "var(--ink-muted)" }}>累计流量</span>
            </div>
            <div className="smp-card-body smp-net" style={{ paddingTop: 10, paddingBottom: 10 }}>
              {profile.network.slice(0, 4).map((item) => (
                <div className="smp-net-item" key={item.name}>
                  <div className="smp-net-name" title={item.name}>{item.name}</div>
                  <div className="smp-net-rt">
                    <span className="smp-net-dn">↓ <b>{formatBytes(item.rxBytes)}</b></span>
                    <span className="smp-net-up">↑ <b>{formatBytes(item.txBytes)}</b></span>
                  </div>
                </div>
              ))}
              {profile.network.length === 0 ? <p className="smp-empty">未读取到网卡计数</p> : null}
            </div>
          </section>

          {/* 系统信息 */}
          <section className="smp-card">
            <div className="smp-card-head">
              <Database size={14} strokeWidth={1.8} />
              <span className="smp-card-ttl">系统</span>
            </div>
            <div className="smp-card-body" style={{ paddingTop: 10 }}>
              <div className="smp-kv-grid">
                {/* 内核 / CPU 型号是长串：独占整行（宽档显示两列，窄档按容器查询降为一列） */}
                <div className="smp-kv-cell smp-kv-cell-wide">
                  <small>内核</small>
                  <b className="smp-mono" title={profile.kernel}>{profile.kernel || "-"}</b>
                </div>
                <div className="smp-kv-cell">
                  <small>运行</small>
                  <b>{profile.uptimeText || (profile.uptimeSeconds ? `${Math.floor(profile.uptimeSeconds / 3600)} 小时` : "-")}</b>
                </div>
                <div className="smp-kv-cell smp-kv-cell-wide">
                  <small>CPU 型号</small>
                  <b title={profile.cpu.model}>{profile.cpu.model || "-"}</b>
                </div>
                <div className="smp-kv-cell">
                  <small>采集方式</small>
                  <b>{sourceLabel}</b>
                </div>
              </div>
              <div className="smp-load-grid">
                <div className="smp-load-cell">
                  <b className="smp-mono">{profile.loadAverage[0].toFixed(2)}</b>
                  <small>1 min</small>
                </div>
                <div className="smp-load-cell">
                  <b className="smp-mono">{profile.loadAverage[1].toFixed(2)}</b>
                  <small>5 min</small>
                </div>
                <div className="smp-load-cell">
                  <b className="smp-mono">{profile.loadAverage[2].toFixed(2)}</b>
                  <small>15 min</small>
                </div>
              </div>
              {!hasRealCpuUsage && cores > 0 ? (
                <p className="smp-empty" style={{ marginTop: 8 }}>
                  未取到真实 CPU 利用率，当前显示「负载 / 核数」折算值（{loadPerCore.toFixed(1)}%）
                </p>
              ) : null}
            </div>
          </section>

          {profile.warnings.length > 0 ? (
            <div className="smp-warnings">
              {profile.warnings.map((warning) => (
                <span key={warning}>{warning}</span>
              ))}
            </div>
          ) : null}

          <div
            className="smp-mono"
            style={{ fontSize: "var(--fs-2xs)", color: "var(--ink-muted)", textAlign: "right" }}
          >
            更新 {loading ? "中…" : formatDate(profile.collectedAt)}
          </div>
        </div>
      ) : null}

      {/* 底部操作行 */}
      <div className="smp-foot">
        <span className="smp-foot-note">
          每 {Math.round(refreshIntervalMs / 1000)} 秒采样 · 本地保留 1 小时环形缓冲
        </span>
        <button
          type="button"
          className={`smp-btn${autoRefresh ? " on" : ""}`}
          onClick={onToggleAutoRefresh}
          disabled={!server}
          title={autoRefresh ? "关闭自动刷新" : "开启自动刷新"}
        >
          自动
        </button>
        <button
          type="button"
          className="smp-btn"
          onClick={onRefresh}
          disabled={!server || loading}
          title="刷新状态"
        >
          <RefreshCw size={12} className={loading ? "smp-spin" : ""} />
          刷新
        </button>
      </div>

      {/* 无 profile 时的空态（保留底部操作行，避免面板空白无法刷新） */}
      {!profile ? (
        <div className="smp-scroll">
          <div className="smp-head">
            <span className="smp-avatar">
              <Activity size={15} strokeWidth={1.7} />
            </span>
            <div className="smp-id">
              <b>{statusTitle}</b>
              <small>{statusSubTitle}</small>
            </div>
          </div>
          <p className="smp-empty">尚未采集到状态数据，点击右下角「刷新」读取。</p>
        </div>
      ) : null}
    </div>
  );
}
