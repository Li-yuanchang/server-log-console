import type { ServerSystemDisk, ServerSystemNetworkInterface, ServerSystemProcess, ServerSystemProfileResponse } from "@server-log-console/shared";
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
  return (map.get("PROC") || []).map(([pid, cpu, memory, rss, ...commandParts]) => ({
    pid: toNumber(pid),
    cpuPercent: toNumber(cpu),
    memoryPercent: toNumber(memory),
    rssKb: toNumber(rss),
    command: commandParts.join("\t").trim()
  })).filter((process) => process.pid > 0);
}

function parseNetwork(map: LineMap): ServerSystemNetworkInterface[] {
  return (map.get("NET") || []).map(([name, rxBytes, txBytes]) => ({
    name: name || "",
    rxBytes: toNumber(rxBytes),
    txBytes: toNumber(txBytes)
  })).filter((item) => item.name && item.name !== "lo");
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
if command -v free >/dev/null 2>&1; then
  free -b | awk '/^Mem:/ {printf "MEM\t%s\t%s\t%s\t%.1f\n",$2,$3,$4,($2>0?$3/$2*100:0)} /^Swap:/ {printf "SWAP\t%s\t%s\t%s\t%.1f\n",$2,$3,$4,($2>0?$3/$2*100:0)}'
elif [ -r /proc/meminfo ]; then
  awk '/MemTotal:/ {mt=$2*1024} /MemAvailable:/ {ma=$2*1024} /SwapTotal:/ {st=$2*1024} /SwapFree:/ {sf=$2*1024} END {mu=mt-ma; su=st-sf; printf "MEM\t%d\t%d\t%d\t%.1f\n",mt,mu,ma,(mt>0?mu/mt*100:0); printf "SWAP\t%d\t%d\t%d\t%.1f\n",st,su,sf,(st>0?su/st*100:0)}' /proc/meminfo
fi
if command -v df >/dev/null 2>&1; then
  df -P -B1 2>/dev/null | awk 'NR>1 {gsub(/%/,"",$5); printf "DISK\t%s\t%s\t%s\t%s\t%s\t%s\n",$1,$2,$3,$4,$5,$6}' | head -n 12
fi
if command -v ps >/dev/null 2>&1; then
  ps -eo pid=,pcpu=,pmem=,rss=,comm= --sort=-rss 2>/dev/null | head -n 8 | awk '{pid=$1; cpu=$2; mem=$3; rss=$4; $1=$2=$3=$4=""; sub(/^ +/,""); printf "PROC\t%s\t%s\t%s\t%s\t%s\n",pid,cpu,mem,rss,$0}'
fi
if [ -r /proc/net/dev ]; then
  awk -F'[: ]+' 'NR>2 {printf "NET\t%s\t%s\t%s\n",$2,$3,$11}' /proc/net/dev
elif command -v netstat >/dev/null 2>&1; then
  netstat -ibn 2>/dev/null | awk 'NR>1 && $1!="Name" {rx[$1]+=$7; tx[$1]+=$10} END {for (name in rx) printf "NET\t%s\t%s\t%s\n",name,rx[name],tx[name]}'
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
        model: cpuModel
      },
      memory: parseMemory(map),
      swap: parseSwap(map),
      disks: parseDisks(map),
      processes: parseProcesses(map),
      network: parseNetwork(map),
      warnings
    };
  }
}
