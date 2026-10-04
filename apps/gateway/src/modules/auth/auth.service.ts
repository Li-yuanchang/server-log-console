import { timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const FAILURE_WINDOW_MS = 5 * 60_000;
const MAX_FAILURES_PER_WINDOW = 20;

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
    try {
      const raw = await readFile(path.join(this.configDir, "gateway-auth.json"), "utf8");
      const parsed = JSON.parse(raw) as { token?: string };
      const token = parsed.token?.trim();
      if (token) {
        this.token = token;
      }
    } catch {
      /* 未配置令牌 → 鉴权关闭 */
    }
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

  /** 失败次数超限的来源 IP 在窗口期内直接拒绝（429） */
  isRateLimited(ip: string): boolean {
    const now = Date.now();
    const recent = (this.failures.get(ip) || []).filter((time) => now - time < FAILURE_WINDOW_MS);
    this.failures.set(ip, recent);
    return recent.length >= MAX_FAILURES_PER_WINDOW;
  }

  recordFailure(ip: string): void {
    const recent = (this.failures.get(ip) || []).filter((time) => Date.now() - time < FAILURE_WINDOW_MS);
    recent.push(Date.now());
    this.failures.set(ip, recent);
  }
}
