import type { ServerDiagnosticsResponse, ServerSystemDisk, ServerSystemNetworkInterface, ServerSystemProcess, ServerSystemProfileResponse } from "@server-log-console/shared";
import { shellEscape } from "../logs/remote-shell.js";
import type { ManagedSshConnection, SshExecutorService } from "../logs/ssh-executor.service.js";
import type { ServerRegistryService } from "./server-registry.service.js";

type LineMap = Map<string, string[][]>;

function toNumber(value: string | undefined, fallback = 0): number {
  if (!value) return fallback;
  const parsed = Number(String(value).replace(/%$/, ""));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toPercent(used: number, total: number): number {
  if (!Number.isFinite(total) || total <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((used / total) * 1000) / 10));
}

function parseLines(output: string): LineMap {
  const map: LineMap = new Map();
  for (const line of output.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const [kind, ...fields] = line.split("\t");
    if (!kind) continue;
    const bucket = map.get(kind) || [];
    bucket.push(fields);
    map.set(kind, bucket);
  }
  return map;
}

function first(map: LineMap, kind: string, index = 0): string[] {
  return map.get(kind)?.[index] || [];
}

function meta(map: LineMap, key: string): string {
  return (map.get("META") || []).find((fields) => fields[0] === key)?.[1] || "";
}

function parseMemory(map: LineMap): ServerSystemProfileResponse["memory"] {
  const [total, used, free, percent] = first(map, "MEM");
  const totalBytes = toNumber(total);
  const usedBytes = toNumber(used);
  const freeBytes = toNumber(free);
  return {
    total: totalBytes,
    used: usedBytes,
    free: freeBytes,
    percent: percent ? toNumber(percent) : toPercent(usedBytes, totalBytes)
  };
}

function parseSwap(map: LineMap): ServerSystemProfileResponse["swap"] {
  const [total, used, free, percent] = first(map, "SWAP");
  const totalBytes = toNumber(total);
  const usedBytes = toNumber(used);
  const freeBytes = toNumber(free);
  return {
    total: totalBytes,
    used: usedBytes,
    free: freeBytes,
    percent: percent ? toNumber(percent) : toPercent(usedBytes, totalBytes)
  };
}

function parseDisks(map: LineMap): ServerSystemDisk[] {
  return (map.get("DISK") || []).map(([filesystem, total, used, available, percent, mount]) => ({
    filesystem: filesystem || "",
    mount: mount || "",
    total: toNumber(total),
    used: toNumber(used),
    available: toNumber(available),
    percent: toNumber(percent)
  })).filter((disk) => disk.mount);
}

function parseProcesses(map: LineMap): ServerSystemProcess[] {
  /* 监听端口按 pid 聚合（PORT 行来自 ss/netstat -tlnp） */
  const portsByPid = new Map<number, number[]>();
  (map.get("PORT") || []).forEach(([pidRaw, portRaw]) => {
    const pid = toNumber(pidRaw);
    const port = toNumber(portRaw);
    if (pid <= 0 || port <= 0) return;
    const list = portsByPid.get(pid) || [];
    if (!list.includes(port)) list.push(port);
    portsByPid.set(pid, list);
  });
  return (map.get("PROC") || []).map(([pid, cpu, memory, rss, ...commandParts]) => ({
    pid: toNumber(pid),
    cpuPercent: toNumber(cpu),
    memoryPercent: toNumber(memory),
    rssKb: toNumber(rss),
    command: commandParts.join("\t").trim(),
    ports: portsByPid.get(toNumber(pid))
  })).filter((process) => process.pid > 0);
}

function parseNetwork(map: LineMap): ServerSystemNetworkInterface[] {
  return (map.get("NET") || []).map(([name, rxBytes, txBytes]) => ({
    name: name || "",
    rxBytes: toNumber(rxBytes),
    txBytes: toNumber(txBytes)
  })).filter((item) => item.name && item.name !== "lo");
}

/**
 * 真实 CPU 利用率（0-100）。
 * 主路径：/proc/stat 两次采样差分 —— usage = 1 - Δidle/Δtotal
 *   （idle 只取 idle 列，不含 iowait，与 top 的 `id` 口径一致）
 * 兜底：macOS/BSD 的 top CPU usage 行。
 * 都拿不到时返回 undefined，由前端回退到「负载/核数」口径并显式标注，
 * 绝不静默用 loadAverage/cores 冒充利用率。
 */
function parseCpuUsage(map: LineMap): number | undefined {
  const pctRow = first(map, "CPU_USAGE_PCT");
  if (pctRow.length) {
    const pct = toNumber(pctRow[0], Number.NaN);
    if (Number.isFinite(pct)) return Math.max(0, Math.min(100, Math.round(pct * 10) / 10));
  }
  const [total1, idle1, total2, idle2] = first(map, "CPU_USAGE");
  const t1 = toNumber(total1);
  const i1 = toNumber(idle1);
  const t2 = toNumber(total2);
  const i2 = toNumber(idle2);
  const totalDelta = t2 - t1;
  const idleDelta = i2 - i1;
  // 两次采样必须单调递增且总增量足够，否则视为采样失败（避免除零/负数）
  if (!(totalDelta > 0) || idleDelta < 0 || idleDelta > totalDelta) return undefined;
  const usage = (1 - idleDelta / totalDelta) * 100;
  return Math.max(0, Math.min(100, Math.round(usage * 10) / 10));
}

function buildProfileScript(): string {
  return String.raw`
printf 'META\thostname\t%s\n' "$(hostname 2>/dev/null || printf '')"
printf 'META\tkernel\t%s\n' "$(uname -sr 2>/dev/null || printf '')"
if [ -r /etc/os-release ]; then
  . /etc/os-release 2>/dev/null || true
  os_name="$PRETTY_NAME"
  if [ -z "$os_name" ]; then os_name="$NAME"; fi
  if [ -z "$os_name" ]; then os_name="Linux"; fi
  printf 'META\tos\t%s\n' "$os_name"
else
  printf 'META\tos\t%s\n' "$(uname -s 2>/dev/null || printf 'Unknown')"
fi
if command -v awk >/dev/null 2>&1 && [ -r /proc/loadavg ]; then
  awk '{printf "LOAD\t%s\t%s\t%s\n",$1,$2,$3}' /proc/loadavg
elif command -v uptime >/dev/null 2>&1; then
  uptime | sed -E 's/.*load averages?:? *//' | awk -F'[, ]+' '{printf "LOAD\t%s\t%s\t%s\n",$1,$2,$3}'
fi
if command -v awk >/dev/null 2>&1 && [ -r /proc/uptime ]; then
  awk '{printf "UPTIME_SECONDS\t%d\n",$1}' /proc/uptime
fi
if command -v uptime >/dev/null 2>&1; then
  printf 'UPTIME_TEXT\t%s\n' "$(uptime -p 2>/dev/null || uptime 2>/dev/null || printf '')"
fi
if command -v nproc >/dev/null 2>&1; then
  printf 'CPU\tcores\t%s\n' "$(nproc 2>/dev/null || printf 0)"
elif command -v sysctl >/dev/null 2>&1; then
  printf 'CPU\tcores\t%s\n' "$(sysctl -n hw.ncpu 2>/dev/null || printf 0)"
fi
if [ -r /proc/cpuinfo ]; then
  awk -F': ' '/model name|Hardware|Processor/ {print "CPU\tmodel\t"$2; exit}' /proc/cpuinfo
elif command -v sysctl >/dev/null 2>&1; then
  printf 'CPU\tmodel\t%s\n' "$(sysctl -n machdep.cpu.brand_string 2>/dev/null || printf '')"
fi
# 真实 CPU 利用率：/proc/stat 两次差分（空闲时间占比取反）。
# 字段序：cpu user nice system idle iowait irq softirq steal
#   total = $2..$9（含 steal，steal 属于"非本机可用"，算作 busy 更贴近 top）
#   idle  = $5（只取 idle，不含 iowait，与 top 的 id 列口径一致）
# 不能用 loadAverage/核数 冒充——load 可远超核数，不是占用率；前端图表依赖这个真实值。
if [ -r /proc/stat ]; then
  read_cpu() { awk '/^cpu /{printf "%s\t%s", $2+$3+$4+$5+$6+$7+$8+$9, $5}' /proc/stat; }
  cpu_s1=$(read_cpu)
  sleep 0.25 2>/dev/null || sleep 1
  cpu_s2=$(read_cpu)
  printf 'CPU_USAGE\t%s\t%s\n' "$cpu_s1" "$cpu_s2"
elif command -v top >/dev/null 2>&1; then
  # macOS / BSD 兜底：top 第二帧的 CPU usage 行
  top -l 2 -n 0 2>/dev/null | awk '/CPU usage/ {gsub(/%/,""); u=$3+0; s=$5+0; t=u+s; if (t>0) printf "CPU_USAGE_PCT\t%.1f\n", u/t*100}' | tail -n 1
fi
if command -v free >/dev/null 2>&1; then
  free -b | awk '/^Mem:/ {printf "MEM\t%s\t%s\t%s\t%.1f\n",$2,$3,$4,($2>0?$3/$2*100:0)} /^Swap:/ {printf "SWAP\t%s\t%s\t%s\t%.1f\n",$2,$3,$4,($2>0?$3/$2*100:0)}'
elif [ -r /proc/meminfo ]; then
  awk '/MemTotal:/ {mt=$2*1024} /MemAvailable:/ {ma=$2*1024} /SwapTotal:/ {st=$2*1024} /SwapFree:/ {sf=$2*1024} END {mu=mt-ma; su=st-sf; printf "MEM\t%d\t%d\t%d\t%.1f\n",mt,mu,ma,(mt>0?mu/mt*100:0); printf "SWAP\t%d\t%d\t%d\t%.1f\n",st,su,sf,(st>0?su/st*100:0)}' /proc/meminfo
fi
# 磁盘（2026-11-08 重写）：127.122 实测 df 整体卡死 —— 死挂载会让 df 在
# stat 阶段永久阻塞、连一行都出不来（timeout 杀掉后仍是空输出）。
# 改为从 /proc/mounts 只取真实块设备（/dev/*，天然排除 NFS/FUSE/overlay），
# 逐挂载 df + 2s 护栏：单个坏挂载只丢它自己（并记 WARN），健康挂载照常返回。
if [ -r /proc/mounts ] && command -v df >/dev/null 2>&1; then
  awk '$1 ~ /^\/dev\// {print $2}' /proc/mounts 2>/dev/null | sort -u | while IFS= read -r mnt; do
    [ -d "$mnt" ] || continue
    if command -v timeout >/dev/null 2>&1; then
      timeout 2 df -P -B1 "$mnt" 2>/dev/null || printf 'WARN\tdf 无响应，已跳过挂载 %s\n' "$mnt"
    else
      df -P -B1 "$mnt" 2>/dev/null
    fi
  done | awk '$1 ~ /^\/dev\// && NF>=6 {gsub(/%/,"",$5); printf "DISK\t%s\t%s\t%s\t%s\t%s\t%s\n",$1,$2,$3,$4,$5,$6}' | head -n 12
elif command -v df >/dev/null 2>&1; then
  df -P -B1 2>/dev/null | awk 'NR>1 {gsub(/%/,"",$5); printf "DISK\t%s\t%s\t%s\t%s\t%s\t%s\n",$1,$2,$3,$4,$5,$6}' | head -n 12
fi
if command -v ps >/dev/null 2>&1; then
  if command -v timeout >/dev/null 2>&1; then
    timeout 5 ps -eo pid=,pcpu=,pmem=,rss=,comm= --sort=-rss 2>/dev/null | head -n 8 | awk '{pid=$1; cpu=$2; mem=$3; rss=$4; $1=$2=$3=$4=""; sub(/^ +/,""); printf "PROC\t%s\t%s\t%s\t%s\t%s\n",pid,cpu,mem,rss,$0}'
  else
    ps -eo pid=,pcpu=,pmem=,rss=,comm= 2>/dev/null | head -n 8 | awk '{pid=$1; cpu=$2; mem=$3; rss=$4; $1=$2=$3=$4=""; sub(/^ +/,""); printf "PROC\t%s\t%s\t%s\t%s\t%s\n",pid,cpu,mem,rss,$0}'
  fi
fi
# 监听端口（2026-11-08）：ss/netstat -tlnp 按 pid 聚合 —— 进程行可标注端口。
# 需要 root（非 root 时 users/pid 列为空，自然退化为无端口）。有 timeout 护栏。
if command -v ss >/dev/null 2>&1; then
  if command -v timeout >/dev/null 2>&1; then
    timeout 3 ss -tlnp 2>/dev/null | awk '{
      n = split($4, a, ":"); port = a[n];
      s = $NF; seen = "";
      while (match(s, /pid=[0-9]+/)) {
        pid = substr(s, RSTART + 4, RLENGTH - 4);
        if (index(seen "," , pid ",") == 0 && index(seen, pid) == 0) { printf "PORT\t%s\t%s\n", pid, port; seen = seen "," pid }
        s = substr(s, RSTART + RLENGTH);
      }
    }'
  fi
elif command -v netstat >/dev/null 2>&1; then
  if command -v timeout >/dev/null 2>&1; then
    timeout 3 netstat -tlnp 2>/dev/null | awk 'NR>2 { n = split($4, a, ":"); port = a[n]; split($7, b, "/"); pid = b[1]; if (pid + 0 > 0) printf "PORT\t%s\t%s\n", pid, port }'
  fi
fi
if [ -r /proc/net/dev ]; then
  awk -F'[: ]+' 'NR>2 {printf "NET\t%s\t%s\t%s\n",$2,$3,$11}' /proc/net/dev
elif command -v netstat >/dev/null 2>&1; then
  netstat -ibn 2>/dev/null | awk 'NR>1 && $1!="Name" {rx[$1]+=$7; tx[$1]+=$10} END {for (name in rx) printf "NET\t%s\t%s\t%s\n",name,rx[name],tx[name]}'
fi
`.trim();
}

function buildDiagnosticsScript(): string {
  return String.raw`
printf 'DXVER	1\n'
# ── 磁盘空间（与监控采集同款逐挂载护栏：127.122 死挂载会让整体 df 连一行都出不来） ──
if [ -r /proc/mounts ] && command -v df >/dev/null 2>&1; then
  awk '$1 ~ /^\/dev\// {print $2}' /proc/mounts 2>/dev/null | sort -u | while IFS= read -r mnt; do
    [ -d "$mnt" ] || continue
    if command -v timeout >/dev/null 2>&1; then
      timeout 2 df -P "$mnt" 2>/dev/null || printf 'WARN\tdf 无响应，已跳过挂载 %s\n' "$mnt"
    else
      df -P "$mnt" 2>/dev/null
    fi
  done | awk '$1 ~ /^\/dev\// && NF>=6 {gsub(/%/,"",$5); printf "DSPACE\t%s\t%s\t%s\n",$1,$6,$5}' | head -n 12
fi
# ── inode（同款逐挂载护栏） ──
if [ -r /proc/mounts ] && command -v df >/dev/null 2>&1; then
  awk '$1 ~ /^\/dev\// {print $2}' /proc/mounts 2>/dev/null | sort -u | while IFS= read -r mnt; do
    [ -d "$mnt" ] || continue
    if command -v timeout >/dev/null 2>&1; then
      timeout 2 df -P -i "$mnt" 2>/dev/null
    else
      df -P -i "$mnt" 2>/dev/null
    fi
  done | awk '$1 ~ /^\/dev\// && NF>=6 {gsub(/%/,"",$5); printf "DINODE\t%s\t%s\n",$6,$5}' | head -n 12
fi
# ── 根分区 TOP 占用（8s 护栏；超时输出为部分结果，仍有效） ──
if command -v timeout >/dev/null 2>&1; then
  timeout 8 du -x -d1 / 2>/dev/null | sort -rn | head -n 6 | awk '{printf "DTOP\t%d\t%s\n",$1,$2}'
else
  du -x -d1 / 2>/dev/null | sort -rn | head -n 6 | awk '{printf "DTOP\t%d\t%s\n",$1,$2}'
fi
# ── 已删除未释放（lsof 降级 + 8s 护栏：大进程表机器上 lsof 可跑数十秒） ──
if command -v lsof >/dev/null 2>&1; then
  if command -v timeout >/dev/null 2>&1; then
    timeout 8 lsof -nP 2>/dev/null | awk '$NF ~ /deleted/ {s+=$7} END {printf "DDEL\t%.0f\n", s/1048576}'
  else
    printf 'DDEL\tNA\n'
  fi
else
  printf 'DDEL\tNA\n'
fi
# ── IO 等待（vmstat 第二帧：us/wa） ──
if command -v vmstat >/dev/null 2>&1; then
  vmstat 1 2 2>/dev/null | tail -n 1 | awk '{printf "VMSTAT\t%s\t%s\n",$13,$16}'
fi
# ── 内存可用 ──
awk '/MemAvailable:/ {av=$2} /MemTotal:/ {t=$2} END {if (t>0) printf "MEMAVG\t%.0f\n", av/t*100}' /proc/meminfo 2>/dev/null
# ── swap 已用 ──
awk 'NR>1 {u+=$4} END {if (NR>1) printf "SWAPU\t%.0f\n", u*1024}' /proc/swaps 2>/dev/null
# ── load / 核数 ──
awk '{printf "LOAD1\t%s\n", $1}' /proc/loadavg 2>/dev/null
command -v nproc >/dev/null 2>&1 && printf 'CORES\t%s\n' "$(nproc 2>/dev/null || printf 0)"
# ── MySQL ──
for svc in mysqld mysql mariadb; do
  st=$(systemctl is-active $svc 2>/dev/null)
  [ "$st" = "active" ] && { printf 'MYSQLD\tactive\t%s\n' "$svc"; break; }
done
if command -v ss >/dev/null 2>&1; then
  ss -tln 2>/dev/null | awk '$4 ~ /:(3306|33060|3307)$/ {f=1} END {printf "MPORT\t%d\n", f}'
fi
for f in /var/log/mysqld.log /var/log/mysql/error.log /var/log/mysql.err /var/log/mariadb/mariadb.log; do
  [ -r "$f" ] || continue
  printf 'MLOGF\t%s\n' "$f"
  tail -n 200 "$f" 2>/dev/null | grep -iE 'deadlock|timeout|error' | tail -n 4 | sed 's/^/MLOG\t/'
  break
done
# ── SSH ──
for svc in sshd ssh; do
  st=$(systemctl is-active $svc 2>/dev/null)
  [ "$st" = "active" ] && { printf 'SSHD\tactive\t%s\n' "$svc"; break; }
done
if command -v ss >/dev/null 2>&1; then
  ss -tln 2>/dev/null | awk '$4 ~ /:22$/ {f=1} END {printf "SPORT\t%d\n", f}'
fi
for f in /var/log/secure /var/log/auth.log; do
  [ -r "$f" ] || continue
  printf 'SLOGF\t%s\n' "$f"
  tail -n 200 "$f" 2>/dev/null | awk 'tolower($0) ~ /failed|invalid/ {c++} END {printf "SFAIL\t%d\n", c+0}'
  tail -n 12 "$f" 2>/dev/null | grep -iE "failed|invalid|error" | tail -n 4 | sed 's/^/SLOG\t/'
  break
done
# ── OOM（3s 护栏：dmesg 大内核环形缓冲同样可能拖慢） ──
if command -v dmesg >/dev/null 2>&1; then
  if command -v timeout >/dev/null 2>&1; then
    timeout 3 dmesg -T 2>/dev/null | awk 'tolower($0) ~ /out of memory|oom-kill|killed process/ {c++; last=$0} END {printf "OOMC\t%d\n", c+0; if (last != "") printf "OOML\t%s\n", last}'
  else
    dmesg -T 2>/dev/null | awk 'tolower($0) ~ /out of memory|oom-kill|killed process/ {c++; last=$0} END {printf "OOMC\t%d\n", c+0; if (last != "") printf "OOML\t%s\n", last}'
  fi
fi
`.trim();
}

export class ServerSystemProfileService {
  constructor(
    private readonly serverRegistry: ServerRegistryService,
    private readonly sshExecutor: SshExecutorService
  ) {}

  async collect(
    serverId: string,
    timeoutMs = 30000,
    options?: {
      connection?: ManagedSshConnection;
      hostOverride?: string;
    }
  ): Promise<ServerSystemProfileResponse> {
    const server = this.serverRegistry.getServer(serverId);
    const command = `sh -c ${shellEscape(buildProfileScript())}`;
    const effectiveTimeoutMs = Math.max(5000, Math.min(timeoutMs, 60000));
    const output = options?.connection
      ? await this.sshExecutor.execWithManagedConnection(options.connection, command, effectiveTimeoutMs)
      : await this.sshExecutor.exec(server.id, command, effectiveTimeoutMs);
    const map = parseLines(output);
    const warnings = (map.get("WARN") || []).map((line) => line.join(" ").trim()).filter(Boolean);
    const loadFields = first(map, "LOAD");
    const cpuRows = map.get("CPU") || [];
    const cpuCores = toNumber(cpuRows.find(([key]) => key === "cores")?.[1]);
    const cpuModel = cpuRows.find(([key]) => key === "model")?.[1] || "";
    const source: ServerSystemProfileResponse["source"] = (() => {
      if (server.connectionKind === "bastion") {
        return this.sshExecutor.isJumpServerServer(server.id) ? "jumpserver" : "bastion";
      }
      if (server.connectionKind === "bastion-target") {
        if (!server.preferredBastionId) return "bastion";
        try {
          return this.sshExecutor.isJumpServerServer(server.preferredBastionId) ? "jumpserver" : "bastion";
        } catch {
          return "bastion";
        }
      }
      return "direct";
    })();

    if (!first(map, "MEM").length) warnings.push("未读取到内存信息，目标系统可能缺少 free 或 /proc/meminfo。");
    if (!parseDisks(map).length) warnings.push("未读取到磁盘信息，目标系统可能不支持 df -P -B1。");
    if (!meta(map, "hostname") && !first(map, "LOAD").length && !first(map, "MEM").length) {
      const preview = output.replace(/\s+/g, " ").trim().slice(0, 220);
      warnings.push(preview ? `状态采集输出不可解析：${preview}` : "状态采集没有返回可解析输出。");
    }

    return {
      serverId: server.id,
      serverName: server.name,
      host: options?.hostOverride || server.host,
      connectionKind: server.connectionKind,
      collectedAt: new Date().toISOString(),
      source,
      hostname: meta(map, "hostname") || server.host,
      os: meta(map, "os") || "Unknown",
      kernel: meta(map, "kernel"),
      uptimeText: first(map, "UPTIME_TEXT").join("\t") || "",
      uptimeSeconds: toNumber(first(map, "UPTIME_SECONDS")[0]),
      loadAverage: [toNumber(loadFields[0]), toNumber(loadFields[1]), toNumber(loadFields[2])],
      cpu: {
        cores: cpuCores,
        model: cpuModel,
        usagePercent: parseCpuUsage(map)
      },
      memory: parseMemory(map),
      swap: parseSwap(map),
      disks: parseDisks(map),
      processes: parseProcesses(map),
      network: parseNetwork(map),
      warnings
    };
  }

  /**
   * 服务器诊断（2026-11-08）：一条只读脚本一次 exec，解析全部检查分区。
   * 与 collect 同机制（无 agent、逐段 timeout 护栏）；堡垒机场景由端点
   * 传入 connection（目标资产连接），脚本在资产上执行。
   */
  async diagnose(
    serverId: string,
    timeoutMs = 45000,
    options?: {
      connection?: ManagedSshConnection;
      hostOverride?: string;
    }
  ): Promise<ServerDiagnosticsResponse> {
    const server = this.serverRegistry.getServer(serverId);
    const command = `sh -c ${shellEscape(buildDiagnosticsScript())}`;
    const effectiveTimeoutMs = Math.max(10000, Math.min(timeoutMs, 60000));
    const startedAt = Date.now();
    const output = options?.connection
      ? await this.sshExecutor.execWithManagedConnection(options.connection, command, effectiveTimeoutMs)
      : await this.sshExecutor.exec(server.id, command, effectiveTimeoutMs);
    const map = parseLines(output);
    const warnings: string[] = [];

    const diskSpace = (map.get("DSPACE") || []).map(([filesystem, mount, percent]) => ({
      filesystem: filesystem || "",
      mount: mount || "",
      percent: toNumber(percent)
    }));
    const inodes = (map.get("DINODE") || []).map(([mount, percent]) => ({
      mount: mount || "",
      percent: toNumber(percent)
    }));
    const duTop = (map.get("DTOP") || []).map(([kb, path]) => ({
      path: path || "",
      sizeBytes: toNumber(kb) * 1024
    }));
    const ddelRow = first(map, "DDEL");
    const deletedOpenGb = ddelRow.length && ddelRow[0] !== "NA" ? toNumber(ddelRow[0]) : null;
    if (ddelRow.length && ddelRow[0] === "NA") warnings.push("lsof 不可用，已删除未释放空间未检查。");
    const vmRow = first(map, "VMSTAT");
    const vmstat = vmRow.length >= 2 ? { usPercent: toNumber(vmRow[0]), waPercent: toNumber(vmRow[1]) } : null;
    const memRow = first(map, "MEMAVG");
    const memAvailablePercent = memRow.length ? toNumber(memRow[0]) : null;
    const swapRow = first(map, "SWAPU");
    const swapUsedBytes = swapRow.length ? toNumber(swapRow[0]) : null;
    const loadRow = first(map, "LOAD1");
    const load1 = loadRow.length ? toNumber(loadRow[0]) : null;
    const coresRow = first(map, "CORES");
    const cores = coresRow.length ? toNumber(coresRow[0]) : null;

    const myRow = first(map, "MYSQLD");
    const mportRow = first(map, "MPORT");
    const mlogfRow = first(map, "MLOGF");
    const mysql = myRow.length || mportRow.length
      ? {
          active: myRow.length ? myRow[0] : null,
          serviceName: myRow.length ? myRow[1] : null,
          listening: mportRow.length ? toNumber(mportRow[0]) === 1 : null,
          logFile: mlogfRow.length ? mlogfRow[0] : null,
          logTail: (map.get("MLOG") || []).map((row) => row.join(" "))
        }
      : null;

    const sshRow = first(map, "SSHD");
    const spRow = first(map, "SPORT");
    const sfailRow = first(map, "SFAIL");
    const slogfRow = first(map, "SLOGF");
    const oomRow = first(map, "OOMC");
    const oomLastRow = first(map, "OOML");
    if (!oomRow.length) warnings.push("dmesg 不可读（权限受限），OOM 事件未检查。");
    const ssh = sshRow.length || spRow.length
      ? {
          active: sshRow.length ? sshRow[0] : null,
          serviceName: sshRow.length ? sshRow[1] : null,
          listening: spRow.length ? toNumber(spRow[0]) === 1 : null,
          failedCount: sfailRow.length ? toNumber(sfailRow[0]) : null,
          logFile: slogfRow.length ? slogfRow[0] : null,
          logTail: (map.get("SLOG") || []).map((row) => row.join(" ")),
          oomCount: oomRow.length ? toNumber(oomRow[0]) : null,
          oomLastLine: oomLastRow.length ? oomLastRow[0] : null
        }
      : null;

    return {
      serverId,
      assetKey: options?.hostOverride,
      collectedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAt,
      warnings,
      diskSpace,
      inodes,
      duTop,
      deletedOpenGb,
      vmstat,
      memAvailablePercent,
      swapUsedBytes,
      load1,
      cores,
      mysql,
      ssh
    };
  }
}
