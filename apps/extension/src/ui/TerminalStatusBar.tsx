import { useEffect, useState } from "react";
import { formatKeyHint } from "./key-hints.js";

/* 终端底部状态栏（对应原型 T1 常规连接态 / T4 断线重连 / T8 未连接空态）。
   结构：左 = 状态点 + 连接文案 + 主机 + 时长（断线时：红点 + 原因 + 自动重试 n/N + 立即重连）；
        中 = CPU / 内存 / 磁盘迷你条（42×4px 圆角槽，<60 绿 / 60-85 橙 / >85 红，
             来自网关每 10s 采集，整组可点打开监控）；
        右 = UTF-8 · ⌘R 历史 · ⌘F 查找 提示。
   悬浮提示一律用原生 title 属性（ImmediateTooltip 会拦截 [title] 渲染即时提示），不另造 tooltip。
   样式类前缀 terminal-statusbar-*，定义在 align-s5-terminal.css 第 9 节。 */

/** 已连接时长自刷间隔（ms）：只在时长组件内部 setInterval，避免状态栏整树高频重渲 */
const CONNECTED_DURATION_REFRESH_MS = 30_000;

export interface TerminalStatusBarProps {
  state: "connected" | "disconnected" | "preserved" | "idle"; // idle = 无会话；preserved = 会话保活（切视图/切标签 detach，网关留 90s）
  hostLabel: string; // 如 root@192.168.127.38
  connectedAt: number | null; // 连接成功时间戳，用于显示「42 分钟」
  retry?: { attempt: number; max: number; reason?: string } | null; // 断线自动重试进度
  onReconnect?: () => void; // disconnected 时显示「立即重连」小按钮
}

/** 时长文案（对齐原型「42 分钟」）：不足 1 分钟显示「刚刚」，跨小时带分钟 */
function formatConnectedDuration(elapsedMs: number): string {
  const totalMinutes = Math.max(0, Math.floor(elapsedMs / 60000));
  if (totalMinutes < 1) {
    return "刚刚";
  }
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) {
    return `${minutes} 分钟`;
  }
  if (minutes === 0) {
    return `${hours} 小时`;
  }
  return `${hours} 小时 ${minutes} 分钟`;
}

/** 资源分档（对应原型 .rbar 的 ok/warn/bad）：<60 绿 / 60-85 橙 / >85 红 */
function resourceLevel(value: number): "ok" | "warn" | "bad" {
  if (value > 85) {
    return "bad";
  }
  if (value >= 60) {
    return "warn";
  }
  return "ok";
}

/** 已连接时长：组件内部每 30s 自刷一次；connectedAt 变化（重连成功）时立即刷新 */
function ConnectedDuration({ connectedAt }: { connectedAt: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), CONNECTED_DURATION_REFRESH_MS);
    return () => {
      window.clearInterval(timer);
    };
  }, [connectedAt]);
  return <span className="terminal-statusbar-duration">{formatConnectedDuration(now - connectedAt)}</span>;
}

/** 单条资源迷你条：标签 + 数值 + 42×4px 圆角槽（对应原型 .rbar）。
    value 为 null 时渲染「--」占位（2026-10-23）：监控是功能，取不到数据也不能整块消失。 */

/** 重连小图标（对齐原型「立即重连」按钮里的 refresh 图标） */
function ReconnectIcon() {
  return (
    <svg
      width="11"
      height="11"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polyline points="23 4 23 10 17 10" />
      <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
    </svg>
  );
}

export function TerminalStatusBar(props: TerminalStatusBarProps) {
  const { state, hostLabel, connectedAt, retry, onReconnect } = props;

  return (
    <div className="terminal-statusbar">
      {/* 左：状态点 + 连接状态（T1 连接 / T4 断线 / T8 空态） */}
      <span className="terminal-statusbar-state">
        <span className={`terminal-statusbar-dot terminal-statusbar-dot-${state}`} />
        {/* 已连接态不再展示主机/时长（2026-11-08）：监控卡与工作区页签已有同信息，
            底条左段仅在 断开/保留/空闲 等需要用户行动的状态下出现 */}
        {state === "disconnected" ? (
          <>
            <span className="terminal-statusbar-label terminal-statusbar-label-err">已断开</span>
            <span className="terminal-statusbar-sep" />
            <span className="terminal-statusbar-host">{hostLabel}</span>
            {retry ? (
              <>
                <span className="terminal-statusbar-sep" />
                <span className="terminal-statusbar-retry">
                  {retry.reason ? `${retry.reason} · ` : ""}自动重试 {retry.attempt}/{retry.max}
                </span>
              </>
            ) : null}
            {onReconnect ? (
              <button
                type="button"
                className="terminal-statusbar-reconnect"
                onClick={onReconnect}
                title="立即重连当前会话"
              >
                <ReconnectIcon />
                立即重连
              </button>
            ) : null}
          </>
        ) : null}
        {state === "preserved" ? (
          <>
            <span className="terminal-statusbar-label terminal-statusbar-label-ok">会话已保留</span>
            <span className="terminal-statusbar-sep" />
            <span className="terminal-statusbar-host">{hostLabel}</span>
            <span className="terminal-statusbar-retry">重连即恢复（网关保留 90 秒）</span>
            {onReconnect ? (
              <button
                type="button"
                className="terminal-statusbar-reconnect"
                onClick={onReconnect}
                title="恢复当前会话"
              >
                <ReconnectIcon />
                恢复连接
              </button>
            ) : null}
          </>
        ) : null}
        {state === "idle" ? (
          <span className="terminal-statusbar-idle">未连接 · 连接后显示主机与资源信息</span>
        ) : null}

        {/* 功能提示跟随状态内容（2026-11-08 安置：已连接 = 绿点存活指示 + 提示组） */}
        <span className="terminal-statusbar-sep" />
        <span className="terminal-statusbar-mono">UTF-8</span>
        <span className="terminal-statusbar-sep" />
        <span className="terminal-statusbar-hint">{formatKeyHint("⌘R")} 历史</span>
        <span className="terminal-statusbar-sep" />
        <span className="terminal-statusbar-hint">{formatKeyHint("⌘F")} 查找</span>
      </span>

      <span className="terminal-statusbar-grow" />
    </div>
  );
}
