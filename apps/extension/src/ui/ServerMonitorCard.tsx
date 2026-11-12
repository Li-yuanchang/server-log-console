import { useState, useCallback, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, Check, ChevronRight, Copy, Cpu, HardDrive, LoaderCircle, RefreshCw, Stethoscope, TrendingUp, X } from "lucide-react";
import type { ServerDiagnosticsResponse, ServerSystemProfileResponse } from "@server-log-console/shared";
import type { ServerMonitorEntry } from "./useServerMonitorPool.js";
import { apiGetServerDiagnostics } from "./api.js";
import { useEscapeToClose } from "./useEscapeToClose.js";
import { copyText } from "./utils.js";

/**
 * 方案甲 · 单服务器监控卡（2026-11-08 实装）。
 *
 * 视觉语言（v2 原型定稿）：
 * - 同色纸底：页签、卡片、侧栏一个底色，层级只靠发丝线
 * - 排版驱动：CPU 是唯一的 44px 大数字（主读数），内存/网络/磁盘为等距次级行
 * - 每个次级行 = 48px 标签列（网格对齐）+ 发丝填充轨道（左满右空）+ 右对齐固定宽数值
 * - 风险只体现在颜色：数值/填充按阈值 warm(注意)/hot(危险) 变色，无横幅报警
 * - 状态机：正常 / 延迟（数据变暗 + Ns 徽章）/ 失败（原因 + 重试）/ 采集中
 */

const STALE_MS = 30_000;

/** 体检五项检查名（运行中占位与结果顺序一致） */
const DIAG_CHECK_NAMES = ["磁盘空间与 inode", "慢访问归因（IO / 内存 / 负载）", "MySQL 状态", "SSH 服务与安全", "内存压力与 OOM"];

type Props = {
  entry: ServerMonitorEntry | null;
  serverId: string;
  serverName?: string;
  groupTitle?: string;
  staleSec: number;
  /** 堡垒机/jumpserver 会话的状态上下文路径（诊断按虚拟路径解析目标资产） */
  contextPath?: string;
  onRetry: (serverId: string) => void;
};

function fmtUptime(seconds: number | null): string {
  if (!seconds || !Number.isFinite(seconds) || seconds <= 0) return "运行 --";
  var d = Math.floor(seconds / 86400);
  if (d >= 14) return "运行 " + Math.floor(d / 7) + " 周";
  if (d >= 1) return "运行 " + d + " 天";
  var h = Math.floor(seconds / 3600);
  if (h >= 1) return "运行 " + h + " 小时";
  return "运行 " + Math.floor(seconds / 60) + " 分钟";
}

function fmtRate(kbps: number | null): string {
  if (kbps == null || !Number.isFinite(kbps)) return "--";
  return kbps >= 1024 ? (kbps / 1024).toFixed(1) + "M" : Math.round(kbps) + "K";
}

function riskCls(v: number | null, warn: number, bad: number): "" | "warm" | "hot" {
  if (v == null) return "";
  return v >= bad ? "hot" : v >= warn ? "warm" : "";
}

/** riskCls → SegBar hue 映射（内存/swap/磁盘行共用，避免同款三元式重复） */
function segHue(v: number | null, warn: number, bad: number): "green" | "amber" | "red" {
  const c = riskCls(v, warn, bad);
  return c === "hot" ? "red" : c === "warm" ? "amber" : "green";
}

/** 容量口径（方案 E 2026-11-11）：≥10 取整、<10 保留一位，与状态面板 formatBytes 同源 */
function fmtBytes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0";
  var units = ["B", "KB", "MB", "GB", "TB"];
  var next = value;
  var index = 0;
  while (next >= 1024 && index < units.length - 1) { next /= 1024; index += 1; }
  return (next >= 10 || index === 0 ? next.toFixed(0) : next.toFixed(1)) + " " + units[index];
}

/** 填充式刻度轨道：已达段按主题色做 alpha ombré（0.45→1.0），未达段同色 16% 底纹。
 *  色源运行时读 .app-shell 的 --green/--amber/--red（随 sage/sand/dark 主题走），
 *  解析不到退回内置三色（与主题现代绿同源），不再硬编码配色。 */
var THEME_RGB_CACHE: Record<string, RGB> = {};
function themeHueRgb(hue: "green" | "amber" | "red"): RGB {
  var shell = typeof document !== "undefined" ? document.querySelector(".app-shell") : null;
  var themeKey = shell ? shell.className : "";
  var cacheKey = themeKey + "|" + hue;
  var hit = THEME_RGB_CACHE[cacheKey];
  if (hit) return hit;
  var varName = hue === "green" ? "--green" : hue === "amber" ? "--amber" : "--red";
  var raw = shell ? getComputedStyle(shell).getPropertyValue(varName).trim() : "";
  var parsed = raw ? parseColorRgb(raw) : null;
  var FALLBACK: Record<string, RGB> = {
    green: [34, 112, 63],
    amber: [150, 96, 28],
    red: [184, 67, 58]
  };
  var out = parsed || FALLBACK[hue];
  THEME_RGB_CACHE[cacheKey] = out;
  return out;
}

/** 解析 #rgb / #rrggbb / rgb() / rgba() 为 RGB 元组，解析失败返回 null */
function parseColorRgb(raw: string): RGB | null {
  var m = /^#([0-9a-f]{6})$/i.exec(raw);
  if (m) return [parseInt(m[1].slice(0, 2), 16), parseInt(m[1].slice(2, 4), 16), parseInt(m[1].slice(4, 6), 16)];
  m = /^#([0-9a-f]{3})$/i.exec(raw);
  if (m) return [parseInt(m[1][0] + m[1][0], 16), parseInt(m[1][1] + m[1][1], 16), parseInt(m[1][2] + m[1][2], 16)];
  m = /^rgba?\(([^)]+)\)$/i.exec(raw);
  if (m) {
    var p = m[1].split(",").map(function (s) { return parseFloat(s.trim()); });
    if (p.length >= 3 && p.every(function (n) { return Number.isFinite(n); })) return [Math.round(p[0]), Math.round(p[1]), Math.round(p[2])];
  }
  return null;
}

function SegBar(props: { pct: number; warn: number; bad: number; hue: "green" | "amber" | "red" }) {
  var SEGS = 12;
  var c = themeHueRgb(props.hue);
  var lit = Math.round((Math.min(Math.max(props.pct, 0), 100) / 100) * SEGS);
  var segs = [];
  for (var i = 0; i < SEGS; i++) {
    var f = lit > 1 ? i / (lit - 1) : 1;
    var alpha = i < lit ? 0.45 + 0.55 * f : 0.16;
    var bg = "rgba(" + c[0] + "," + c[1] + "," + c[2] + "," + alpha.toFixed(3) + ")";
    segs.push(<span key={i} className="smm-seg" style={{ background: bg }} />);
  }
  return <span className="smm-segbar">{segs}</span>;
}

type RGB = [number, number, number];

/** 方案 E 行（2026-11-11 原型 server-monitor-card-2026-11 定稿）：
 *  行 1 = 标签 + 容量串（超阈值追加琥珀/红「剩 x」）+ %；行 2 = 满幅轨（12 段全宽）。
 *  轨道分辨率最大化；长容量串省略号 + title 兜底。pct 缺失退化为旧单行（空轨 + --）。 */
function CapacityRow(props: {
  lbl: string;
  lblTitle?: string;
  pct: number | null;
  used: number;
  total: number;
  warn: number;
  bad: number;
}) {
  if (props.pct == null) {
    return (
      <div className="smc-srow">
        <span className="lbl" title={props.lblTitle}>{props.lbl}</span>
        <span className="track" aria-hidden="true" />
        <b>--<small>%</small></b>
      </div>
    );
  }
  var cls = riskCls(props.pct, props.warn, props.bad);
  var rest = props.pct >= props.warn ? props.total - props.used : null;
  /* 风险行不放「已用 / 总量 · 剩 x」三段（200px 容量格 ~94px 装不下 146px，必截断）：
     显示决策最有用的两段「已用 · 剩 x」，总量退到 title（合计行 + title 兜底） */
  var base = rest != null
    ? fmtBytes(props.used) + " · 剩 " + fmtBytes(rest)
    : fmtBytes(props.used) + " / " + fmtBytes(props.total);
  var fullTitle = fmtBytes(props.used) + " / " + fmtBytes(props.total) + (rest != null ? " · 剩 " + fmtBytes(rest) : "");
  return (
    <>
      <div className="smc-srow smc-e-top">
        <span className="lbl" title={props.lblTitle}>{props.lbl}</span>
        <span className="smc-e-cap" title={fullTitle}>
          {rest != null
            ? <>{fmtBytes(props.used)} · <i className={cls === "hot" ? "hot" : "risk"}>剩 {fmtBytes(rest)}</i></>
            : base}
        </span>
        <b className={cls}>{Math.round(props.pct)}<small>%</small></b>
      </div>
      <div className="smc-e-track">
        <span className="track">
          <SegBar pct={props.pct} warn={props.warn} bad={props.bad} hue={segHue(props.pct, props.warn, props.bad)} />
        </span>
      </div>
    </>
  );
}

/* ── 诊断结果 → 五项检查判定（阈值与产品语义一致） ── */
type DiagCheck = {
  name: string;
  badge: "g" | "a" | "r";
  badgeText: string;
  dur: string;
  finds: Array<{ sev: "" | "g" | "a" | "r"; text: string; sug?: string }>;
  cmd: string;
  /** 行图标键（对齐原型 per-check 图标：disk / alert / memory / trend / check） */
  icon: "disk" | "alert" | "memory" | "trend" | "check";
};

/** DiagCheck.icon → lucide 组件（与侧栏/监控卡同一套线性图标，stroke 1.8） */
function diagIconEl(key: DiagCheck["icon"], size: number) {
  if (key === "disk") return <HardDrive size={size} strokeWidth={1.8} />;
  if (key === "alert") return <AlertTriangle size={size} strokeWidth={1.8} />;
  if (key === "memory") return <Cpu size={size} strokeWidth={1.8} />;
  if (key === "trend") return <TrendingUp size={size} strokeWidth={1.8} />;
  return <Check size={size} strokeWidth={2} />;
}

function buildDiagChecks(resp: ServerDiagnosticsResponse): DiagCheck[] {
  var checks: DiagCheck[] = [];

  /* 1. 磁盘空间与 inode */
  var diskFinds: Array<{ sev: "" | "g" | "a" | "r"; text: string; sug?: string }> = [];
  var diskWorst = "g" as "g" | "a" | "r";
  (resp.diskSpace || []).forEach(function (d) {
    if (d.percent >= 85) { diskFinds.push({ sev: "r", text: d.mount + " 使用率 " + d.percent + "%（危险线 85%）" }); diskWorst = "r"; }
    else if (d.percent >= 70) { diskFinds.push({ sev: "a", text: d.mount + " 使用率 " + d.percent + "%（注意线 70%）" }); if (diskWorst !== "r") diskWorst = "a"; }
  });
  (resp.inodes || []).forEach(function (d) {
    if (d.percent >= 90) { diskFinds.push({ sev: "r", text: d.mount + " inode " + d.percent + "% — 文件数耗尽（新建文件会失败）" }); diskWorst = "r"; }
  });
  (resp.duTop || []).slice(0, 3).forEach(function (d) {
    diskFinds.push({ sev: "", text: "TOP 占用 " + d.path + " — " + (d.sizeBytes / 1073741824).toFixed(1) + " GB" });
  });
  if (resp.deletedOpenGb != null && resp.deletedOpenGb >= 1) {
    diskFinds.push({ sev: "a", text: "已删除未释放 " + resp.deletedOpenGb.toFixed(1) + " GB — 重启对应进程可释放" });
    if (diskWorst !== "r") diskWorst = "a";
  }
  diskFinds.push({ sev: "", text: "", sug: "清理 /home 旧文件或轮转日志后，空间立即恢复（无需重启）" });
  checks.push({
    name: "磁盘空间与 inode",
    badge: diskWorst,
    badgeText: diskWorst === "r" ? "危险" : diskWorst === "a" ? "注意" : "正常",
    dur: "",
    finds: diskFinds,
    icon: "disk",
    cmd: "df -P; df -P -i; timeout 8 du -x -d1 / 2>/dev/null | sort -rn | head -n 6; timeout 8 lsof -nP 2>/dev/null | awk '$NF~/deleted/{s+=$7} END{printf \"deleted: %.1f GB\\n\", s/1048576}'"
  });

  /* 2. 慢访问归因 */
  var vm = resp.vmstat;
  var slowFinds: DiagCheck["finds"] = [];
  var slowWorst = "g" as "g" | "a" | "r";
  if (vm && vm.waPercent >= 50) { slowFinds.push({ sev: "r", text: "IO 等待 " + vm.waPercent + "% — 磁盘是当前瓶颈" }); slowWorst = "r"; }
  else if (vm && vm.waPercent >= 30) { slowFinds.push({ sev: "a", text: "IO 等待 " + vm.waPercent + "% — 偏高，磁盘压力明显" }); if (slowWorst !== "r") slowWorst = "a"; }
  else if (vm) { slowFinds.push({ sev: "g", text: "IO 等待 " + vm.waPercent + "% — 正常" }); }
  if (resp.memAvailablePercent != null && resp.memAvailablePercent < 10) { slowFinds.push({ sev: "r", text: "MemAvailable 仅 " + resp.memAvailablePercent + "% — 内存压力危险" }); slowWorst = "r"; }
  else if (resp.memAvailablePercent != null && resp.memAvailablePercent < 20) { slowFinds.push({ sev: "a", text: "MemAvailable " + resp.memAvailablePercent + "% — 偏低" }); if (slowWorst !== "r") slowWorst = "a"; }
  if (resp.swapUsedBytes != null && resp.swapUsedBytes > 0) { slowFinds.push({ sev: "a", text: "swap 已使用 " + (resp.swapUsedBytes / 1073741824).toFixed(1) + " GB — 有换页发生" }); if (slowWorst === "g") slowWorst = "a"; }
  if (resp.load1 != null && resp.cores && resp.load1 > resp.cores * 2) { slowFinds.push({ sev: "a", text: "load " + resp.load1.toFixed(1) + " ≫ " + resp.cores + " 核 — 多为 IO 等待（与 iowait 互相印证）" }); }
  slowFinds.push({ sev: "", text: "", sug: "瓶颈定位后再对症：IO 等待高 → 查磁盘（上方磁盘检查）；内存低 → 查 TOP 进程" });
  checks.push({
    name: "慢访问归因（IO / 内存 / 负载）",
    badge: slowWorst,
    badgeText: slowWorst === "r" ? "危险" : slowWorst === "a" ? "注意" : "正常",
    dur: "",
    finds: slowFinds,
    icon: "trend",
    cmd: "vmstat 1 2; free -b; cat /proc/loadavg"
  });

  /* 3. MySQL 状态 */
  var m = resp.mysql;
  var myFinds: DiagCheck["finds"] = [];
  var myWorst = "g";
  if (!m) {
    myFinds.push({ sev: "", text: "未检测到 systemd MySQL/MariaDB — 可能容器部署或未安装（端口可在进程行确认）" });
    checks.push({ name: "MySQL 状态", badge: "g", badgeText: "未检测", dur: "", finds: myFinds, icon: "check", cmd: "systemctl is-active mysqld mysql mariadb 2>/dev/null; ss -tln | grep -E ':(3306|33060|3307)'; tail -n 50 /var/log/mysqld.log 2>/dev/null" });
  } else {
    var myWorst2 = "g" as "g" | "a" | "r";
    if (m.active === "active" && m.listening) { myFinds.push({ sev: "g", text: "mysqld 运行中 · 端口监听正常" }); }
    else if (m.active) { myFinds.push({ sev: "a", text: "服务状态 " + m.active + " — 未监听 3306" }); myWorst2 = "a"; }
    else if (m.listening) { myFinds.push({ sev: "", text: "端口 3306 在监听，但 systemd 未识别服务名 — 可能容器部署或非标准安装" }); }
    (m.logTail || []).forEach(function (line) {
      var isDead = /deadlock/i.test(line);
      myFinds.push({ sev: isDead ? "a" : "", text: "日志：" + line.slice(0, 120) });
      if (isDead && myWorst2 !== "r") myWorst2 = "a";
    });
    myFinds.push({ sev: "", text: "", sug: "死锁深查需 DB 凭证执行 SHOW ENGINE INNODB STATUS — OS 级仅到日志与端口" });
    checks.push({ name: "MySQL 状态", badge: myWorst2, badgeText: myWorst2 === "r" ? "异常" : myWorst2 === "a" ? "注意" : "正常", dur: "", finds: myFinds, icon: "check", cmd: "systemctl is-active mysqld mysql mariadb 2>/dev/null; ss -tln | grep -E ':(3306|33060|3307)'; tail -n 50 /var/log/mysqld.log 2>/dev/null" });
  }

  /* 4. SSH 服务与安全 */
  var ssh = resp.ssh;
  var sshFinds: DiagCheck["finds"] = [];
  var sshWorst = "g" as "g" | "a" | "r";
  if (ssh) {
    if (ssh.active === "active" && ssh.listening) { sshFinds.push({ sev: "g", text: "sshd 运行中 · :22 监听正常" }); }
    else { sshFinds.push({ sev: "r", text: "SSH 服务异常（" + (ssh.active || "状态未知") + "）— 对应「ping 通但连不上」" }); sshWorst = "r"; }
    if (ssh.oomCount != null && ssh.oomCount > 0) { sshFinds.push({ sev: "r", text: "内核 OOM 事件 " + ssh.oomCount + " 次" + (ssh.oomLastLine ? "：" + ssh.oomLastLine.slice(0, 90) : "") }); sshWorst = "r"; }
    if (ssh.failedCount != null && ssh.failedCount > 50) { sshFinds.push({ sev: "a", text: "登录失败 " + ssh.failedCount + " 次 — 疑似暴力扫描" }); }
    else if (ssh.failedCount != null) { sshFinds.push({ sev: "g", text: "登录失败 " + ssh.failedCount + " 次 — 正常范围" }); }
    (ssh.logTail || []).slice(0, 2).forEach(function (line) { sshFinds.push({ sev: "", text: line.slice(0, 110) }); });
  } else {
    sshFinds.push({ sev: "", text: "无法采集 SSH 服务状态" });
  }
  checks.push({
    name: "SSH 服务与安全",
    badge: sshWorst,
    badgeText: sshWorst === "r" ? "危险" : "正常",
    dur: "",
    finds: sshFinds,
    icon: "alert",
    cmd: "systemctl is-active sshd ssh 2>/dev/null; ss -tln | grep ':22'; grep -iE 'failed|invalid' /var/log/secure /var/log/auth.log 2>/dev/null | tail -n 5"
  });

  /* 5. 内存压力与 OOM */
  var memFinds: DiagCheck["finds"] = [];
  var memWorst = "g" as "g" | "a" | "r";
  if (resp.memAvailablePercent != null) {
    if (resp.memAvailablePercent < 10) { memFinds.push({ sev: "r", text: "MemAvailable " + resp.memAvailablePercent + "% — 危险" }); memWorst = "r"; }
    else if (resp.memAvailablePercent < 20) { memFinds.push({ sev: "a", text: "MemAvailable " + resp.memAvailablePercent + "% — 偏低" }); memWorst = "a"; }
    else { memFinds.push({ sev: "g", text: "MemAvailable " + resp.memAvailablePercent + "% — 充足" }); }
  }
  if (resp.swapUsedBytes != null && resp.swapUsedBytes > 0) { memFinds.push({ sev: "a", text: "swap 已使用 " + (resp.swapUsedBytes / 1073741824).toFixed(1) + " GB — 有换页发生" }); if (memWorst === "g") memWorst = "a"; }
  if (ssh && ssh.oomCount != null && ssh.oomCount > 0) { memFinds.push({ sev: "r", text: "dmesg OOM 事件 " + ssh.oomCount + " 次" }); memWorst = "r"; }
  checks.push({
    name: "内存压力与 OOM",
    badge: memWorst,
    badgeText: memWorst === "r" ? "危险" : memWorst === "a" ? "注意" : "正常",
    dur: "",
    finds: memFinds,
    icon: "memory",
    cmd: "free -b; grep -E 'MemAvailable|SwapTotal|SwapFree' /proc/meminfo; timeout 3 dmesg -T 2>/dev/null | grep -iE 'oom-kill|out of memory' | tail -n 5"
  });

  return checks;
}

/** 跟随宿主 .app-shell 的主题类（2026-11-12）：
 *  弹窗 portal 到 body，需要把 .app-shell 的类名复制到 portal 外层才能取到主题变量。
 *  但直接读 className 只在渲染时取一次 —— 用户切主题时弹窗不重渲染，会停在旧主题。
 *  这里用 MutationObserver 订阅 class 变化，主题切换即时生效。 */
function useShellThemeClass(): string {
  const read = function () {
    return typeof document !== "undefined"
      ? document.querySelector(".app-shell")?.className ?? "theme-modern"
      : "theme-modern";
  };
  const [cls, setCls] = useState(read);
  useEffect(function () {
    if (typeof document === "undefined") return;
    const shell = document.querySelector(".app-shell");
    if (!shell) return;
    setCls(shell.className);
    const ob = new MutationObserver(function () { setCls(shell.className); });
    ob.observe(shell, { attributes: true, attributeFilter: ["class"] });
    return function () { ob.disconnect(); };
  }, []);
  return cls;
}

export function ServerMonitorCard(props: Props) {
  const { entry, serverId, serverName, groupTitle, staleSec, onRetry, contextPath } = props;
  const shellThemeClass = useShellThemeClass();
  const [diagOpen, setDiagOpen] = useState(false);
  const [diagPhase, setDiagPhase] = useState<"idle" | "running" | "done" | "error">("idle");
  const [diagResult, setDiagResult] = useState<ServerDiagnosticsResponse | null>(null);
  const [diagError, setDiagError] = useState("");
  /* 命令行点击复制反馈：1.8s 后还原 */
  const [copiedCmd, setCopiedCmd] = useState<string | null>(null);
  const copiedTimerRef = useRef<number | null>(null);
  /* 「复制全部修复命令」按钮的短暂反馈 */
  const [allCopied, setAllCopied] = useState(false);
  const allCopiedTimerRef = useRef<number | null>(null);
  const copyDiagCmd = useCallback(function (name: string, cmd: string) {
    void copyText(cmd).then(function () {
      setCopiedCmd(name);
      if (copiedTimerRef.current != null) window.clearTimeout(copiedTimerRef.current);
      copiedTimerRef.current = window.setTimeout(function () { setCopiedCmd(null); }, 1800);
    });
  }, []);
  useEscapeToClose(diagOpen, function () { setDiagOpen(false); });
  /* 采样滞后只体现在头部徽章（2026-11-12 用户反馈：底部提示条时不时闪出像"幻觉"，去掉 UI，
     改为控制台 warn 留痕 —— 排查时看得到，界面上不打扰） */
  useEffect(function () {
    if (staleSec <= 0) return;
    console.warn("[监控] " + serverId + " 上次成功采样 " + staleSec + "s 前，数据可能滞后");
  }, [staleSec, serverId]);
  /* 切换服务器后旧体检结果立即失效：关弹窗并清态，避免展示别台的结论 */
  useEffect(function () {
    setDiagOpen(false);
    setDiagPhase("idle");
    setDiagResult(null);
    setDiagError("");
  }, [serverId]);
  const runDiagnostics = useCallback(async () => {
    setDiagOpen(true);
    setDiagPhase("running");
    setDiagError("");
    try {
      const resp = await apiGetServerDiagnostics(serverId, 45000, contextPath);
      setDiagResult(resp);
      setDiagPhase("done");
    } catch (error) {
      setDiagError(error instanceof Error ? error.message : "诊断执行失败");
      setDiagPhase("error");
    }
  }, [serverId, contextPath]);

  /* 未采集/采集失败：当前服务器未连接，或首次采集失败（显示原因 + 重试） */
  if (!entry || !entry.profile) {
    const collecting = entry != null && entry.status === "collecting";
    const pollError = entry != null && entry.status === "error" ? entry.error : null;
    return (
      <div className="smv-card">
        <div className="smc-id">
          <b>{serverName || serverId}</b>
          {groupTitle ? <em>{groupTitle}</em> : null}
          <span className={"smc-st" + (collecting ? " collecting" : " err")}>
            <i />{collecting ? "采集中" : "未采集"}
          </span>
        </div>
        <div className="smc-idle">
          {collecting
            ? "正在建立采集（首次采样约需数秒）"
            : pollError
              ? "采集失败：" + pollError
              : "当前服务器未连接 —— 连接后自动纳入监控"}
        </div>
        {pollError && onRetry ? (
          <button
            type="button"
            className="smc-retry"
            onClick={function () { onRetry(serverId); }}
          >
            <RefreshCw size={11} strokeWidth={1.9} /> 重试采集
          </button>
        ) : null}
      </div>
    );
  }

  const profile = entry.profile as ServerSystemProfileResponse;
  const cpu = entry.cpu;
  const cpuCls = riskCls(cpu, 60, 85);
  const mem = entry.memPercent;
  const stale = staleSec > 0;
  const load1 = profile.loadAverage[0];
  const cores = profile.cpu.cores || 0;
  /* 方案 E：磁盘小节头展示全部挂载点容量合计 */
  const diskTotalBytes = (profile.disks || []).reduce(function (sum, d) { return sum + d.total; }, 0);

  /* 体检结果 → 五项检查判定 + 严重度计数（done 后每次渲染重算，量级极小） */
  const diagChecks = diagPhase === "done" && diagResult ? buildDiagChecks(diagResult) : null;
  const diagSum = diagChecks
    ? {
        ok: diagChecks.filter(function (c) { return c.badge === "g"; }).length,
        warn: diagChecks.filter(function (c) { return c.badge === "a"; }).length,
        bad: diagChecks.filter(function (c) { return c.badge === "r"; }).length
      }
    : null;
  /* 健康分（2026-11-12 原型 diag-dialog-redesign 定稿）：100 − 危险 12 / 注意 4，封底 0。
     问题项按 危险→注意 排在前面，通过项收进折叠区 */
  const diagScore = diagSum ? Math.max(0, 100 - diagSum.bad * 12 - diagSum.warn * 4) : 0;
  const diagIssues = diagChecks
    ? diagChecks.filter(function (c) { return c.badge !== "g"; })
    : [];
  const diagPassed = diagChecks
    ? diagChecks.filter(function (c) { return c.badge === "g"; })
    : [];
  /* 全部问题命令拼成一段，供「复制全部修复命令」 */
  const diagAllCmd = diagIssues.map(function (c) {
    return "# " + c.name + "\n" + c.cmd;
  }).join("\n\n");
  const copyAllDiag = useCallback(function () {
    void copyText(diagAllCmd).then(function () {
      setAllCopied(true);
      if (allCopiedTimerRef.current != null) window.clearTimeout(allCopiedTimerRef.current);
      allCopiedTimerRef.current = window.setTimeout(function () { setAllCopied(false); }, 2000);
    });
  }, [diagAllCmd]);

  return (
    <>
    <div className={"smv-card" + (stale ? " stale" : "")}>
      {/* 身份行 */}
      {/* 身份行：体检入口在状态徽章右侧（2026-11-12 从 footer 上移 —— footer 一行装不下
          标注版 load + 网速 + 按钮，按钮悬在换行尾部很突兀） */}
      <div className="smc-id">
        <b>{profile.serverName || serverName || serverId}</b>
        {groupTitle ? <em>{groupTitle}</em> : null}
        <span className={"smc-st" + (stale ? " stale" : "")}>
          <i />{stale ? "延迟 " + staleSec + "s" : "正常"}
        </span>
        <button
          type="button"
          className={"smc-diag-btn" + (diagPhase === "running" ? " running" : "")}
          title={diagPhase === "running" ? "体检进行中 —— 点开查看进度" : "五项只读体检（磁盘 / 慢访问 / MySQL / SSH / 内存）"}
          onClick={function () {
            setDiagOpen(true);
            if (diagPhase === "idle") void runDiagnostics();
          }}
        >
          <Stethoscope size={12} strokeWidth={1.9} className={diagPhase === "running" ? "smp-spin" : ""} />
        </button>
      </div>
      <div className="smc-os">{profile.os}{cores ? " · " + cores + " 核" : ""} · {fmtUptime(profile.uptimeSeconds)}</div>

      {/* 主读数：CPU（数字 + 标签水平一行，说明移到全宽 meta 行） */}
      <div className="smc-hero">
        <div className={"smc-hero-num" + (cpuCls ? " " + cpuCls : "")}>
          {cpu != null ? Math.round(cpu) : "--"}<small>%</small>
        </div>
        <div className="smc-hero-label">CPU 利用率</div>
      </div>
      <div className="smc-hero-meta">
        <span className={entry.cpuIsEstimate ? "cap-est" : "cap-ok"}>
          {entry.cpuIsEstimate ? "估算口径 load/核数" : "真实口径 /proc/stat 差分"}
        </span>
        <span className="cap-load">
          load 1m <b>{load1.toFixed(1)}</b>
          {load1 > cores ? " · 高负载源于 IO 等待，非 CPU 计算瓶颈" : " · 负载正常"}
        </span>
      </div>

      {/* 次级行：内存 / Swap / 磁盘（方案 E：容量串上行 + 满幅轨）；网络无容量概念，保持旧单行 */}
      <CapacityRow
        lbl="内存"
        pct={mem}
        used={profile.memory?.used ?? 0}
        total={profile.memory?.total ?? 0}
        warn={80}
        bad={90}
      />
      {/* Swap：与内存同一族（total=0 视为未启用，仅文字态；旧画像无 swap 字段则整行隐藏） */}
      {profile.swap ? (
        profile.swap.total > 0 ? (
          <CapacityRow
            lbl="Swap"
            pct={profile.swap.percent}
            used={profile.swap.used}
            total={profile.swap.total}
            warn={50}
            bad={80}
          />
        ) : (
          <div className="smc-srow">
            <span className="lbl">Swap</span>
            <span className="track" aria-hidden="true" />
            <b className="dim">未启用</b>
          </div>
        )
      ) : null}
      <div className="smc-srow">
        <span className="lbl">网络下行</span>
        <span className="track" aria-hidden="true" />
        <b>{fmtRate(entry.netRxKbps)}<small>/s</small></b>
      </div>
      <div className="smc-srow">
        <span className="lbl">网络上行</span>
        <span className="track" aria-hidden="true" />
        <b>{fmtRate(entry.netTxKbps)}<small>/s</small></b>
      </div>

      <div className="smc-sec">
        <span>磁盘</span>
        {diskTotalBytes > 0 ? (
          <span className="smc-sec-total" title="全部挂载点容量合计">合计 {fmtBytes(diskTotalBytes)}</span>
        ) : null}
      </div>
      {(profile.disks || []).slice(0, 4).map((d) => (
        <CapacityRow
          key={d.mount}
          lbl={d.mount}
          lblTitle={d.filesystem}
          pct={d.percent}
          used={d.used}
          total={d.total}
          warn={70}
          bad={85}
        />
      ))}

      <div className="smc-sec">进程 TOP 3</div>
      {(profile.processes || []).slice(0, 3).map((p) => (
        <div key={p.pid} className="smc-prow">
          <span className="cmd" title={p.command}>{p.command}</span>
          {p.ports && p.ports.length ? (
            <span className="ports" title={"监听端口 " + p.ports.join(", ")}>:{p.ports.slice(0, 2).join(",")}{p.ports.length > 2 ? "+" : ""}</span>
          ) : (
            <span className="ports empty">—</span>
          )}
          <b className={p.cpuPercent >= 10 ? "hot" : ""}>{p.cpuPercent.toFixed(1)}%</b>
          <b>{(p.rssKb / 1024).toFixed(0)}M</b>
        </div>
      ))}

      <div className="smc-foot">
        {/* 1/5/15m 键位收进 title（200px 一行放不下全标注）；首个数由 hero 行的「load 1m」锚定 */}
        <span
          className="smc-load-tri"
          title={"平均负载：1 / 5 / 15 分钟内「正在运行 + 排队等磁盘 IO」的任务数均值（/proc/loadavg），不是百分比 —— 与核数比："
            + (cores || "-") + " 核机器低于 " + (cores || "-") + " 即宽松。含 IO 等待，所以 load 高而 CPU 低 = 磁盘忙。"}
        >
          load <b>{profile.loadAverage.map(function (v) { return v.toFixed(1); }).join("·")}</b>
        </span>
        <span className="smc-nets" title="每秒下行 / 上行流量（两次采样差分）">
          <span>↓ {fmtRate(entry.netRxKbps)}</span>
          <span>↑ {fmtRate(entry.netTxKbps)}</span>
        </span>
      </div>
    </div>

    {/* 体检弹窗：portal 到 body —— 外层复制 .app-shell 的主题类，否则 --red/--amber 等主题变量
        在 body 作用域下缺失，危险/注意徽章会掉色（与 CommandPalette 同一处理） */}
    {diagOpen ? createPortal(
      <div className={shellThemeClass} style={{ display: "contents" }}>
      <div className="confirm-backdrop" onClick={function () { setDiagOpen(false); }}>
        <div className="diag-dialog diag-flow" role="dialog" aria-modal="true" onClick={function (e) { e.stopPropagation(); }}>
          {/* 头部：小分数环 + 标题 + 汇总 chip（对齐 .diag-head / .diag-sum） */}
          <div className="diag-head">
            {diagPhase === "done" && diagSum ? (
              <span className={"diag-health-ring" + (diagScore < 60 ? " s-bad" : diagScore < 85 ? " s-warn" : " s-ok")}>
                <svg width="40" height="40" viewBox="0 0 40 40" aria-hidden="true">
                  <circle className="ring-bg" cx="20" cy="20" r="16.5" />
                  <circle
                    className="ring-val"
                    cx="20" cy="20" r="16.5"
                    strokeDasharray={String(2 * Math.PI * 16.5)}
                    strokeDashoffset={String(2 * Math.PI * 16.5 * (1 - diagScore / 100))}
                  />
                </svg>
                <i>{diagScore}</i>
              </span>
            ) : null}
            <div className="diag-title">
              <b>体检 · {profile.serverName || serverName || serverId}</b>
              {/* 结果态：结论副标题（原型 .dg-title .v —— 6px 红点 + 11.5px + 严重度色）
                  运行/错误态：普通说明文字（.diag-sub） */}
              {diagPhase === "done" && diagSum ? (
                <span
                  className={
                    "sub-verdict "
                    + (diagSum.bad ? "r" : diagSum.warn ? "a" : "g")
                  }
                >
                  <span className="dot" />
                  <em>
                    {[
                      diagSum.bad ? diagSum.bad + " 项危险" : "",
                      diagSum.warn ? diagSum.warn + " 项注意" : ""
                    ].filter(Boolean).join(" · ") || "全部通过"}
                  </em>
                </span>
              ) : (
                <span className="diag-sub">只读检查 · 不改动服务器 · 一条 SSH 脚本采集五类常见故障</span>
              )}
            </div>
            <div className="diag-head-right">
              {diagSum ? (
                <span className="diag-sum">
                  {diagSum.bad ? <i className="chip r" title="危险">{diagSum.bad}</i> : null}
                  {diagSum.warn ? <i className="chip a" title="注意">{diagSum.warn}</i> : null}
                  <i className="chip g" title="正常">{diagSum.ok}</i>
                  {diagResult ? <em>{(diagResult.durationMs / 1000).toFixed(1)}s</em> : null}
                </span>
              ) : null}
              <button
                type="button"
                className="diag-x"
                title="关闭（Esc）"
                onClick={function () { setDiagOpen(false); }}
              >
                <X size={14} strokeWidth={1.9} />
              </button>
            </div>
          </div>

          <div className="diag-body diag-flow-body">
            {diagPhase === "running" ? (
              /* 运行态（2026-11-12）：一条 SSH 脚本顺序采集，前端拿不到真实分项进度 ——
                 不做「五行都写检查中…」的假分项，改成单行轮播当前项 + 一条推进进度条。 */
              <div className="diag-run">
                {/* 旋转扫描光环（对齐原型 v4）：64px 环 + conic 扫描束，裁圆不露角 */}
                <div className="diag-scan" aria-hidden="true">
                  <div className="diag-scan-beam" />
                  <svg width="64" height="64" viewBox="0 0 64 64">
                    <circle className="scan-track" cx="32" cy="32" r="27" />
                  </svg>
                </div>
                <div className="diag-run-title">正在体检</div>
                {/* 不做假进度（2026-11-12 用户质疑）：一条 SSH 脚本在远端顺序跑五类，
                    前端只有「已发起 / 已返回」两态，拿不到第几项 —— 只放不确定进度条 */}
                <div className="diag-run-bar indeterminate" aria-hidden="true">
                  <i />
                </div>
                <p className="diag-run-note">正在服务器上顺序采集五类 · 通常 5–20 秒</p>
              </div>
            ) : null}
            {diagPhase === "error" ? (
              <div className="diag-err">
                <AlertTriangle size={13} strokeWidth={1.9} />
                <span>{diagError || "诊断执行失败"}</span>
              </div>
            ) : null}
            {diagChecks && diagResult ? (
              <>
                {/* 问题项：一行一条，点开才展开 为什么 / 建议 / 命令 */}
                {diagIssues.map(function (c) {
                  var finds = c.finds.filter(function (f) { return !f.sug; });
                  var sug = c.finds.filter(function (f) { return f.sug; })[0];
                  /* 行标题取「最严重」的发现，不是第一条（2026-11-12 实况 bug）：
                     采集顺序与严重度无关 —— SSH 那项第一条是"sshd 运行正常"，
                     真正让它判危险的是后面的 OOM；取第一条会出现「标题正常 + 徽章危险」的自相矛盾。
                     顺序：r > a > g > 其他 */
                  var SEV_RANK = { r: 0, a: 1, g: 2, "": 3 };
                  var lead = finds.slice().sort(function (x, y) {
                    return (SEV_RANK[x.sev] ?? 3) - (SEV_RANK[y.sev] ?? 3);
                  })[0];
                  return (
                    <details key={c.name} className={"diag-issue " + c.badge}>
                      <summary>
                        <span className={"mk " + c.badge}>{diagIconEl(c.icon, 15)}</span>
                        <span className="ttl" title={lead ? lead.text : c.name}>
                          {lead ? lead.text : c.name}
                        </span>
                        <span className={"badge " + c.badge}>{c.badgeText}</span>
                        <span className="chev"><ChevronRight size={13} strokeWidth={2} /></span>
                      </summary>
                      <div className="body">
                        {finds.filter(function (f) { return f !== lead; }).length ? (
                          <div className="more-finds">
                            {finds.filter(function (f) { return f !== lead; }).map(function (f, fi) {
                              return (
                                <div key={fi} className={"f " + (f.sev || "dim")}>
                                  <span className={"mk " + (f.sev || "dim")}>
                                    {f.sev === "r" || f.sev === "a" ? "●" : f.sev === "g" ? "✓" : "·"}
                                  </span>
                                  {f.text}
                                </div>
                              );
                            })}
                          </div>
                        ) : null}
                        {sug ? <div className="sug">{sug.sug}</div> : null}
                        <div
                          className={"cmd" + (copiedCmd === c.name ? " copied" : "")}
                          role="button"
                          tabIndex={0}
                          title="点击复制命令 —— 粘贴到终端可直接执行"
                          onClick={function () { copyDiagCmd(c.name, c.cmd); }}
                          onKeyDown={function (e) {
                            if (e.key === "Enter" || e.key === " ") { e.preventDefault(); copyDiagCmd(c.name, c.cmd); }
                          }}
                        >
                          <span className="c">$</span>
                          <span className="ln">{c.cmd}</span>
                          <span className={"tip" + (copiedCmd === c.name ? " ok" : "")}>
                            {copiedCmd === c.name ? <><Check size={11} strokeWidth={2} />已复制</> : <><Copy size={11} strokeWidth={1.9} />复制</>}
                          </span>
                        </div>
                      </div>
                    </details>
                  );
                })}

                {/* 通过项收纳（2026-11-12）：无任何异常时默认展开 —— 否则弹窗只剩一行
                    折叠标题、内容区空着，用户点开才知道全部通过 */}
                {diagPassed.length ? (
                  <details className="diag-passed" open={diagIssues.length === 0}>
                    <summary><ChevronRight size={12} strokeWidth={2} />{diagPassed.length} 项通过</summary>
                    <div className="p-list">
                      {diagPassed.map(function (c) {
                        return (
                          <div key={c.name} className="p-item">
                            <span className="ok"><Check size={12} strokeWidth={2.2} /></span>
                            <span className="nm">{c.name}</span>
                            <span
                              className="st"
                              title={c.finds.filter(function (f) { return !f.sug; }).map(function (f) { return f.text; }).join(" · ")}
                            >
                              {c.finds.filter(function (f) { return !f.sug; }).map(function (f) { return f.text; }).join(" · ")}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </details>
                ) : null}

                {/* 采集降级说明（2026-11-12 下沉到底部）：lsof 在多数服务器未安装，
                    这是环境常态而非本次体检的结论 —— 放在顶部橙色警示会盖过真正的检查结果。
                    改为脚注式灰字，位置在通过项之后。 */}
                {diagResult.warnings.length ? (
                  <p className="diag-degrade-note">{diagResult.warnings.join(" · ")}</p>
                ) : null}
              </>
            ) : null}
          </div>

          <div className="diag-actions">
            <button
              type="button"
              className="diag-rerun"
              disabled={diagPhase === "running"}
              onClick={function () { void runDiagnostics(); }}
            >
              {diagPhase === "running" ? "体检中…" : diagPhase === "done" ? "重新体检" : "开始体检"}
            </button>
            {diagPhase === "done" && diagIssues.length ? (
              <button
                type="button"
                className={"diag-copyall" + (allCopied ? " ok" : "")}
                title="复制全部问题的排查命令，粘贴到终端即可依次执行"
                onClick={copyAllDiag}
              >
                {allCopied
                  ? <><Check size={12} strokeWidth={2.2} />已复制</>
                  : <><Copy size={12} strokeWidth={1.9} />复制全部修复命令</>}
              </button>
            ) : null}
          </div>
        </div>
      </div>
      </div>,
      document.body
    ) : null}
    </>
  );
}
