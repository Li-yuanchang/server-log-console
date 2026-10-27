import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * 凭证静态加密（AES-256-GCM）。
 *
 * 背景：此前 `credentials.json` / `imported-credentials.json` 里的 SSH 密码与
 * 私钥都是明文写入磁盘。笔记本丢失、Time Machine / 网盘同步把配置目录带出去、
 * 同事临时用这台机器翻文件，都能直接读到密码。
 *
 * 密钥来源（按优先级）：
 * 1. `SLC_MASTER_KEY`（base64）—— Electron 主进程用 safeStorage 保护后于 spawn
 *    时注入。这是桌面端的主路径，用户全程零输入。
 * 2. `~/.server-log-console/master.key`（权限 0600）—— 浏览器模式 / 开发环境的
 *    兜底。安全性弱于系统钥匙串，但远好于明文，且仍是随机 32 字节。
 *
 * 注意：gateway 以 ELECTRON_RUN_AS_NODE=1 运行，该模式下 `require("electron")`
 * 拿不到 safeStorage（实测为 undefined），所以加密密钥必须由主进程派生后传入。
 */

const ALGORITHM = "aes-256-gcm";
/** 密文格式版本前缀，便于将来换算法时识别旧数据 */
const ENVELOPE_PREFIX = "slc:v1:";
const KEY_BYTES = 32;
const IV_BYTES = 12;

export interface SecretCipherOptions {
  /** 配置目录，用于兜底密钥文件 */
  configDir: string;
  /** 显式指定密钥（base64）。未传则读环境变量 / 密钥文件 */
  encodedKey?: string | null;
}

export class SecretCipher {
  private key: Buffer | null = null;
  private readonly configDir: string;
  private readonly encodedKey: string | null;

  constructor(options: SecretCipherOptions) {
    this.configDir = options.configDir;
    this.encodedKey = options.encodedKey ?? process.env.SLC_MASTER_KEY ?? null;
  }

  /** 解密是否可用。不可用时上层退回明文并显式警告，不静默降级。 */
  isEnabled(): boolean {
    return this.key !== null;
  }

  async initialize(): Promise<void> {
    const fromEnv = this.encodedKey?.trim();
    if (fromEnv) {
      const buffer = Buffer.from(fromEnv, "base64");
      if (buffer.length === KEY_BYTES) {
        this.key = buffer;
        return;
      }
      // 密钥长度不对：不猜、不截断，直接视为不可用
      console.warn("[secret-cipher] SLC_MASTER_KEY 长度不是 32 字节，静态加密未启用");
      return;
    }

    // 兜底：本地密钥文件（0600）。首启用随机字节生成。
    const keyFile = path.join(this.configDir, "master.key");
    try {
      const existing = (await readFile(keyFile, "utf8")).trim();
      const buffer = Buffer.from(existing, "base64");
      if (buffer.length === KEY_BYTES) {
        this.key = buffer;
        return;
      }
    } catch {
      /* 不存在，走生成流程 */
    }

    try {
      await mkdir(this.configDir, { recursive: true });
      const fresh = randomBytes(KEY_BYTES);
      await writeFile(keyFile, fresh.toString("base64"), { encoding: "utf8", mode: 0o600 });
      await chmod(keyFile, 0o600).catch(() => {});
      this.key = fresh;
    } catch (error) {
      console.warn(
        `[secret-cipher] 无法创建密钥文件，静态加密未启用：${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /** 判断某个字符串是否已是本模块产生的密文信封 */
  static isEncrypted(value: unknown): boolean {
    return typeof value === "string" && value.startsWith(ENVELOPE_PREFIX);
  }

  encrypt(plaintext: string): string {
    if (!this.key) {
      // 未启用加密时原样返回，调用方通过 isEnabled() 决定是否提示
      return plaintext;
    }
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGORITHM, this.key, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return ENVELOPE_PREFIX + Buffer.concat([iv, tag, encrypted]).toString("base64");
  }

  /** 解密；已是明文（历史数据）时原样返回，便于渐进式迁移 */
  decrypt(value: string): string {
    if (!SecretCipher.isEncrypted(value)) {
      return value;
    }
    if (!this.key) {
      throw new Error("凭证已加密但当前无可用密钥，无法读取");
    }
    const payload = Buffer.from(value.slice(ENVELOPE_PREFIX.length), "base64");
    const iv = payload.subarray(0, IV_BYTES);
    const tag = payload.subarray(IV_BYTES, IV_BYTES + 16);
    const body = payload.subarray(IV_BYTES + 16);
    const decipher = createDecipheriv(ALGORITHM, this.key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(body), decipher.final()]).toString("utf8");
  }

  /** 生成一个可用于共享部署的随机令牌（base64url，无特殊字符便于粘贴） */
  static generateToken(): string {
    return randomBytes(32).toString("base64url");
  }
}
