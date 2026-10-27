import { randomBytes, timingSafeEqual } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const FAILURE_WINDOW_MS = 5 * 60_000;
const MAX_FAILURES_PER_WINDOW = 20;
const MAX_FAILURES_PER_WINDOW_LOOPBACK = 100;

/**
 * 连接服务鉴权（可选）：Bearer Token 模式。
 * 令牌来源优先级：环境变量 GATEWAY_TOKEN > ~/.server-log-console/gateway-auth.json 的 { token }。
 * 两者都未配置时鉴权关闭，行为与未引入本模块一致（本地模式零配置）。
 */
export class AuthService {
  private token: string | null = null;
  private readonly failures = new Map<string, number[]>();

  constructor(
    private readonly configDir = process.env.SERVER_LOG_CONFIG_HOME || path.join(os.homedir(), ".server-log-console")
  ) {}

  async initialize(): Promise<void> {
    const envToken = process.env.GATEWAY_TOKEN?.trim();
    if (envToken) {
      this.token = envToken;
      return;
    }

    const tokenFile = path.join(this.configDir, "gateway-auth.json");
    try {
      const raw = await readFile(tokenFile, "utf8");
      const parsed = JSON.parse(raw) as { token?: string };
      const token = parsed.token?.trim();
      if (token) {
        this.token = token;
        return;
      }
    } catch {
      /* 文件不存在，走下面的自动生成 */
    }

    /* 默认自动生成令牌。
       理由：浏览器 / Chrome 侧边栏形态下，本机 4040 端口对任意网页可达，
       无令牌时任何正在浏览的页面都能读走服务器凭证。要求用户手动去配一个
       token 既不现实也容易被跳过，因此默认开启。
       桌面端由主进程 spawn 时注入同一个令牌，用户完全无感。 */
    const generated = randomBytes(32).toString("base64url");
    try {
      await writeFile(tokenFile, `${JSON.stringify({ token: generated }, null, 2)}\n`, {
        encoding: "utf8",
        mode: 0o600
      });
      this.token = generated;
      console.log("[auth] 已自动生成访问令牌并写入 gateway-auth.json（权限 600）");
    } catch (error) {
      /* 无法持久化时不启用鉴权，避免每次启动都换令牌把前端锁死 */
      console.warn(
        `[auth] 无法写入令牌文件，鉴权未启用：${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /** 当前令牌（仅用于主进程注入与设置页展示；不写入日志） */
  getToken(): string | null {
    return this.token;
  }

  isEnabled(): boolean {
    return this.token !== null;
  }

  verify(candidate: string | null | undefined): boolean {
    if (this.token === null) {
      return true;
    }
    const given = candidate?.trim() || "";
    if (!given) {
      return false;
    }
    const givenBuffer = Buffer.from(given);
    const expectedBuffer = Buffer.from(this.token);
    return givenBuffer.length === expectedBuffer.length && timingSafeEqual(givenBuffer, expectedBuffer);
  }

  extractBearer(header: string | undefined): string | null {
    if (!header) {
      return null;
    }
    const match = /^Bearer\s+(.+)$/i.exec(header.trim());
    return match ? match[1] : null;
  }

  /** 回环地址放宽：前端令牌配错时，用户会被自己的网关锁在门外，
      5 分钟 20 次的阈值对 127.0.0.1 来说太容易触发（页面一次加载就是十几个请求）。 */
  private maxFailuresFor(ip: string): number {
    const normalized = ip.replace(/^::ffff:/, "");
    return normalized === "127.0.0.1" || normalized === "::1"
      ? MAX_FAILURES_PER_WINDOW_LOOPBACK
      : MAX_FAILURES_PER_WINDOW;
  }

  /** 失败次数超限的来源 IP 在窗口期内直接拒绝（429） */
  isRateLimited(ip: string): boolean {
    const now = Date.now();
    const recent = (this.failures.get(ip) || []).filter((time) => now - time < FAILURE_WINDOW_MS);
    this.failures.set(ip, recent);
    return recent.length >= this.maxFailuresFor(ip);
  }

  recordFailure(ip: string): void {
    const recent = (this.failures.get(ip) || []).filter((time) => Date.now() - time < FAILURE_WINDOW_MS);
    recent.push(Date.now());
    this.failures.set(ip, recent);
  }

  /** 认证成功即清零该来源的失败计数：一次输对就应该完全恢复，而不是带着历史负担 */
  recordSuccess(ip: string): void {
    this.failures.delete(ip);
  }
}
