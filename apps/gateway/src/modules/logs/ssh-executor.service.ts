import { Client, type ClientChannel, type SFTPWrapper } from "ssh2";
import type { JumpServerAssetOption } from "@server-log-console/shared";
import { CredentialResolverService } from "../servers/credential-resolver.service.js";
import { LocalConfigService } from "../servers/local-config.service.js";
import { ServerRegistryService } from "../servers/server-registry.service.js";

export interface SftpWriteHandle {
  writeChunk(data: Buffer, offset: number): Promise<void>;
  close(): Promise<void>;
}

export interface SftpSession {
  stat(filePath: string): Promise<{ size: number; mtime: number; readable: boolean }>;
  read(filePath: string, offset: number, length: number): Promise<Buffer>;
  write(filePath: string, data: Buffer): Promise<void>;
  openForWrite(filePath: string): Promise<SftpWriteHandle>;
  unlink(filePath: string): Promise<void>;
  listDirectory(directoryPath: string): Promise<Array<{ name: string; path: string; kind: "file" | "directory" }>>;
  rmdir(directoryPath: string): Promise<void>;
  rename(oldPath: string, newPath: string): Promise<void>;
  ensureDir(dirPath: string): Promise<void>;
  close(): void;
}

interface ManagedSshConnection {
  client: Client;
  cleanup: () => void;
  mode: "direct" | "bastion" | "jumpserver-shell";
  shellStream?: ClientChannel;
  initialBuffer?: string;
}

interface JumpServerAssetCandidate {
  id: string;
  name: string;
  address: string;
  platform?: string;
  organization?: string;
  comment?: string;
}

function humanizeSshError(error: unknown, context: { username?: string; host?: string; port?: number }): string {
  const raw = error instanceof Error ? error.message : String(error);
  const target = `${context.username || "?"}@${context.host || "?"}:${context.port || 22}`;

  if (/All configured authentication methods failed/i.test(raw)) {
    return `认证失败 (${target})：用户名或密码/密钥不正确`;
  }
  if (/ECONNREFUSED/i.test(raw)) {
    return `连接被拒绝 (${target})：目标端口未开放或服务未启动`;
  }
  if (/ETIMEDOUT|timed? ?out/i.test(raw)) {
    return `连接超时 (${target})：目标不可达或网络不通`;
  }
  if (/ENOTFOUND|getaddrinfo/i.test(raw)) {
    return `域名解析失败 (${target})：请检查主机地址`;
  }
  if (/EHOSTUNREACH/i.test(raw)) {
    return `主机不可达 (${target})：网络不通`;
  }
  if (/ECONNRESET|socket hang up|connection lost/i.test(raw)) {
    return `连接被重置 (${target})：远程主机关闭了连接`;
  }
  if (/handshake failed|key exchange|before handshake/i.test(raw)) {
    return `SSH 握手失败 (${target})：目标端口可能不是 SSH 服务`;
  }
  if (/ENETUNREACH/i.test(raw)) {
    return `网络不可达 (${target})：无法访问目标网络`;
  }
  if (/No route to host/i.test(raw)) {
    return `无路由 (${target})：目标主机不可达`;
  }
  if (/permission denied/i.test(raw)) {
    return `权限被拒 (${target})：用户名或密码/密钥不正确`;
  }

  return `${raw} (${target})`;
}

export class SshExecutorService {
  private static readonly IDLE_TTL = 120_000;
  private static readonly MAX_LIFETIME = 600_000;

  private sftpCache = new Map<string, { client: Client; sftp: SFTPWrapper; idleTimer: ReturnType<typeof setTimeout>; maxTimer: ReturnType<typeof setTimeout> }>();
  private execCache = new Map<string, { connection: ManagedSshConnection; idleTimer: ReturnType<typeof setTimeout>; maxTimer: ReturnType<typeof setTimeout>; busy: number; evictPending?: boolean }>();

  constructor(
    private readonly serverRegistry: ServerRegistryService,
    private readonly credentialResolver: CredentialResolverService,
    private readonly localConfigService: LocalConfigService
  ) {}

  /**
   * Get or create a cached SFTP connection for the given server.
   * SSH handshake is the bottleneck (~1.3s for JumpServer), so reusing connections
   * across operations (browse → open → slice) saves significant latency.
   */
  private async acquireSftp(serverId: string, timeoutMs = 30000): Promise<SFTPWrapper> {
    const cached = this.sftpCache.get(serverId);
    if (cached) {
      clearTimeout(cached.idleTimer);
      cached.idleTimer = setTimeout(() => this.evictSftp(serverId), SshExecutorService.IDLE_TTL);
      return cached.sftp;
    }

    const server = this.serverRegistry.getServer(serverId);
    const credentials = this.credentialResolver.resolve(server);

    const { client, sftp } = await new Promise<{ client: Client; sftp: SFTPWrapper }>((resolve, reject) => {
      const c = this.createSshClient(credentials.password);
      let settled = false;

      const timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        c.end();
        reject(new Error(`SFTP 连接超时 (${credentials.host}:${credentials.port})：超过 ${timeoutMs}ms`));
      }, timeoutMs);

      c
        .on("ready", () => {
          c.sftp((error, s) => {
            if (error) {
              if (!settled) { settled = true; clearTimeout(timeout); c.end(); reject(error); }
              return;
            }
            settled = true;
            clearTimeout(timeout);
            resolve({ client: c, sftp: s });
          });
        })
        .on("error", (error) => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          reject(error);
        })
        .connect({
          host: credentials.host,
          port: credentials.port,
          username: credentials.username,
          password: credentials.password,
          privateKey: credentials.privateKey,
          tryKeyboard: true,
          readyTimeout: Math.min(timeoutMs, 20000),
          keepaliveInterval: 10000,
          keepaliveCountMax: 60
        });
    }).catch((error) => {
      throw new Error(humanizeSshError(error, credentials));
    });

    // Auto-evict on disconnect / error
    client.on("close", () => this.evictSftp(serverId));
    client.on("error", () => this.evictSftp(serverId));

    const idleTimer = setTimeout(() => this.evictSftp(serverId), SshExecutorService.IDLE_TTL);
    const maxTimer = setTimeout(() => this.evictSftp(serverId), SshExecutorService.MAX_LIFETIME);
    this.sftpCache.set(serverId, { client, sftp, idleTimer, maxTimer });
    return sftp;
  }

  private evictSftp(serverId: string): void {
    const entry = this.sftpCache.get(serverId);
    if (entry) {
      clearTimeout(entry.idleTimer);
      clearTimeout(entry.maxTimer);
      try { entry.client.end(); } catch {}
      this.sftpCache.delete(serverId);
    }
  }

  /* ── SSH exec pool (direct / bastion-forwarded connections) ── */

  private async acquireExecConnection(serverId: string, timeoutMs = 30000): Promise<Client> {
    const cached = this.execCache.get(serverId);
    if (cached) {
      clearTimeout(cached.idleTimer);
      cached.idleTimer = setTimeout(() => this.evictExec(serverId), SshExecutorService.IDLE_TTL);
      cached.busy++;
      return cached.connection.client;
    }

    // Create new connection using the existing connect chain (direct → bastion fallback)
    const server = this.serverRegistry.getServer(serverId);
    const credentials = this.credentialResolver.resolve(server);
    let connection: ManagedSshConnection;

    const bastions = this.shouldTryBastion(server) ? this.findCandidateBastions(serverId) : [];
    const preferBastionFirst = server.connectionKind === "bastion-target" || (!server.connectionKind && Boolean(server.preferredBastionId));
    const hasBastionRoute = preferBastionFirst && Boolean(server.preferredBastionId) && bastions.length > 0;

    if (hasBastionRoute) {
      let lastError: unknown;
      let found = false;
      for (const bastion of bastions) {
        try {
          connection = await this.connectManagedViaBastion(serverId, bastion.id, timeoutMs);
          found = true;
          break;
        } catch (bastionError) { lastError = bastionError; }
      }
      if (!found) {
        // Bastion failed — try direct as last resort
        try {
          connection = await this.connectManaged(serverId, timeoutMs);
        } catch (directError) {
          throw new Error(humanizeSshError(lastError ?? directError, credentials));
        }
      }
    } else {
      try {
        connection = await this.connectManaged(serverId, timeoutMs);
      } catch (error) {
        if (bastions.length === 0) {
          throw new Error(humanizeSshError(error, credentials));
        }

        let lastError = error;
        let found = false;
        for (const bastion of bastions) {
          try {
            connection = await this.connectManagedViaBastion(serverId, bastion.id, timeoutMs);
            found = true;
            break;
          } catch (bastionError) { lastError = bastionError; }
        }
        if (!found) throw new Error(humanizeSshError(lastError, credentials));
      }
    }

    // Auto-evict on disconnect / error
    connection!.client.on("close", () => this.evictExec(serverId));
    connection!.client.on("error", () => this.evictExec(serverId));

    const idleTimer = setTimeout(() => this.evictExec(serverId), SshExecutorService.IDLE_TTL);
    const maxTimer = setTimeout(() => this.evictExec(serverId), SshExecutorService.MAX_LIFETIME);
    this.execCache.set(serverId, { connection: connection!, idleTimer, maxTimer, busy: 1 });
    return connection!.client;
  }

  private releaseExecConnection(serverId: string): void {
    const entry = this.execCache.get(serverId);
    if (!entry) return;
    entry.busy = Math.max(0, entry.busy - 1);
    if (entry.evictPending && entry.busy <= 0) {
      this.evictExec(serverId, true);
      return;
    }
    clearTimeout(entry.idleTimer);
    entry.idleTimer = setTimeout(() => this.evictExec(serverId), SshExecutorService.IDLE_TTL);
  }

  private evictExec(serverId: string, force = false): void {
    const entry = this.execCache.get(serverId);
    if (!entry) return;
    if (!force && entry.busy > 0) {
      // Other operations still in-flight — defer eviction until they release
      entry.evictPending = true;
      return;
    }
    clearTimeout(entry.idleTimer);
    clearTimeout(entry.maxTimer);
    try { entry.connection.cleanup(); } catch {}
    this.execCache.delete(serverId);
  }

  /** Dispose all cached connections — call on app shutdown. */
  disposeAllCaches(): void {
    for (const [id] of this.sftpCache) this.evictSftp(id);
    for (const [id] of this.execCache) this.evictExec(id, true);
  }

  async exec(serverId: string, command: string, timeoutMs = 45000): Promise<string> {
    await this.acquireExecConnection(serverId, timeoutMs);
    const cached = this.execCache.get(serverId);
    try {
      if (cached?.connection.mode === "jumpserver-shell" && cached.connection.shellStream) {
        return await this.execWithShellConnection(cached.connection, command, timeoutMs, { preserveConnection: true });
      }
      return await this.execOnClient(cached!.connection.client, command, timeoutMs);
    } catch (error) {
      this.evictExec(serverId);
      throw error;
    } finally {
      this.releaseExecConnection(serverId);
    }
  }

  async execWithStdin(serverId: string, command: string, stdinData: string | Buffer, timeoutMs = 120000): Promise<string> {
    const client = await this.acquireExecConnection(serverId, timeoutMs);
    try {
      return await this.execOnClientStdin(client, command, stdinData, timeoutMs);
    } catch (error) {
      this.evictExec(serverId);
      throw error;
    } finally {
      this.releaseExecConnection(serverId);
    }
  }

  async connectForStreaming(serverId: string, timeoutMs = 45000): Promise<ManagedSshConnection> {
    await this.acquireExecConnection(serverId, timeoutMs);
    const cached = this.execCache.get(serverId)!;
    // Return a lightweight handle — cleanup does NOT close the pooled client
    return {
      client: cached.connection.client,
      shellStream: cached.connection.shellStream,
      cleanup: () => this.releaseExecConnection(serverId),
      mode: cached.connection.mode ?? "direct"
    };
  }

  async execViaBastionHost(bastionId: string, targetHost: string, command: string, timeoutMs = 45000): Promise<string> {
    const bastion = this.serverRegistry.getServer(bastionId);
    if (!this.isJumpServerBastion(bastion)) {
      throw new Error("指定的服务器不是 JumpServer 堡垒机。");
    }
    const bastionCredentials = this.credentialResolver.resolve(bastion);

    return new Promise<string>((resolve, reject) => {
      const client = this.createSshClient(bastionCredentials.password);
      let settled = false;

      const timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        client.end();
        reject(new Error(`通过堡垒机连接 ${targetHost} 超时，超过 ${timeoutMs}ms`));
      }, timeoutMs);

      client
        .on("ready", () => {
          client.shell({ term: "xterm", cols: 160, rows: 48 }, async (error, stream) => {
            if (error) {
              if (!settled) { settled = true; clearTimeout(timeout); client.end(); reject(error); }
              return;
            }

            try {
              await waitForPatterns(stream, [{ key: "menu", pattern: /Opt>\s*$/m }], timeoutMs, "等待 JumpServer 菜单超时");

              const searchOutput = await sendAndWaitForPatterns(
                stream,
                `/${targetHost}\r`,
                [
                  { key: "host-select", pattern: /\[Host\]>\s*$/m },
                  { key: "target-shell", pattern: /(\[[^\]\n]+@[^\]\n]+[^\n]*[#$]\s*$)|([#$]\s*$)/m },
                  { key: "no-match", pattern: /(没有匹配|No matched asset|没有找到)/i }
                ],
                timeoutMs,
                "JumpServer 资产搜索超时"
              );

              if (searchOutput.key === "no-match") {
                throw new Error(`JumpServer 未找到目标资产：${targetHost}`);
              }

              if (searchOutput.key === "host-select") {
                const candidates = parseJumpServerAssetCandidates(searchOutput.buffer);
                const exact = candidates.filter((c) => c.address === targetHost);
                const pick = exact.length === 1 ? exact[0] : candidates.length === 1 ? candidates[0] : null;
                if (!pick) {
                  const preview = candidates.slice(0, 5).map((c) => `${c.id}:${c.name}@${c.address}`).join("，");
                  throw new Error(`JumpServer 搜索到多个资产，无法自动命中：${preview}`);
                }
                const connectOutput = await sendAndWaitForPatterns(
                  stream,
                  `${pick.id}\r`,
                  [
                    { key: "target-shell", pattern: /(\[[^\]\n]+@[^\]\n]+[^\n]*[#$]\s*$)|([#$]\s*$)/m },
                    { key: "auth-failed", pattern: /(permission denied|认证失败|连接失败)/i }
                  ],
                  timeoutMs,
                  "JumpServer 进入目标主机超时"
                );
                if (connectOutput.key === "auth-failed") {
                  throw new Error(`JumpServer 进入 ${targetHost} 认证失败`);
                }
              }

              if (settled) return;
              settled = true;
              clearTimeout(timeout);

              const conn: ManagedSshConnection = {
                client,
                shellStream: stream,
                cleanup: () => { stream.end("exit\r"); client.end(); },
                mode: "jumpserver-shell"
              };
              try {
                const output = await this.execWithShellConnection(conn, command, timeoutMs);
                resolve(output);
              } catch (execError) {
                reject(execError);
              }
            } catch (shellError) {
              if (settled) return;
              settled = true;
              clearTimeout(timeout);
              stream.end("q\r");
              client.end();
              reject(shellError);
            }
          });
        })
        .on("error", (error) => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          reject(error);
        })
        .connect({
          host: bastionCredentials.host,
          port: bastionCredentials.port,
          username: bastionCredentials.username,
          password: bastionCredentials.password,
          privateKey: bastionCredentials.privateKey,
          tryKeyboard: true,
          readyTimeout: Math.min(timeoutMs, 20000),
          keepaliveInterval: 10000,
          keepaliveCountMax: 30
        });
    });
  }

  async execJson<T>(serverId: string, command: string, timeoutMs = 45000): Promise<T> {
    const output = await this.exec(serverId, command, timeoutMs);

    try {
      return JSON.parse(output) as T;
    } catch {
      throw new Error(`Expected JSON output from remote command, received: ${output.slice(0, 500)}`);
    }
  }

  async sftpListDirectory(serverId: string, directoryPath: string): Promise<Array<{ name: string; path: string; kind: "file" | "directory"; size?: number; modifiedTime?: string }>> {
    const sftp = await this.acquireSftp(serverId);

    return new Promise((resolve, reject) => {
      sftp.readdir(directoryPath, (readError, list) => {
        if (readError) {
          this.evictSftp(serverId);
          reject(new Error(`SFTP 读取目录失败：${readError.message}`));
          return;
        }

        const entries = (list || [])
          .filter((item) => !item.filename.startsWith("."))
          .map((item) => {
            const isDir = (item.attrs.mode & 0o40000) !== 0;
            const fullPath = directoryPath === "/" ? `/${item.filename}` : `${directoryPath}/${item.filename}`;
            return {
              name: item.filename,
              path: fullPath,
              kind: (isDir ? "directory" : "file") as "file" | "directory",
              size: isDir ? undefined : item.attrs.size,
              modifiedTime: item.attrs.mtime ? new Date(item.attrs.mtime * 1000).toISOString() : undefined
            };
          })
          .sort((a, b) => {
            if (a.kind !== b.kind) return a.kind === "directory" ? -1 : 1;
            return a.name.localeCompare(b.name);
          });

        resolve(entries);
      });
    });
  }

  async sftpStat(serverId: string, filePath: string): Promise<{ size: number; mtime: number; readable: boolean }> {
    const sftp = await this.acquireSftp(serverId);
    return new Promise((resolve, reject) => {
      sftp.stat(filePath, (statError, stats) => {
        if (statError) {
          this.evictSftp(serverId);
          reject(new Error(`SFTP stat 失败 (${filePath})：${statError.message}`));
          return;
        }
        resolve({ size: stats.size, mtime: stats.mtime, readable: (stats.mode & 0o444) !== 0 });
      });
    });
  }

  /**
   * JumpServer SFTP 不支持 sftp.stat()，改用 readdir 父目录获取文件属性。
   * Uses cached SFTP connection to avoid repeated SSH handshakes.
   */
  async sftpStatViaReaddir(serverId: string, filePath: string): Promise<{ size: number; mtime: number; readable: boolean; kind: "file" | "directory" }> {
    const lastSlash = filePath.lastIndexOf("/");
    const parentDir = lastSlash > 0 ? filePath.substring(0, lastSlash) : "/";
    const fileName = filePath.substring(lastSlash + 1);

    const sftp = await this.acquireSftp(serverId);

    return new Promise((resolve, reject) => {
      sftp.readdir(parentDir, (readError, list) => {
        if (readError) {
          this.evictSftp(serverId);
          reject(new Error(`SFTP readdir 失败 (${parentDir})：${readError.message}`));
          return;
        }
        const entry = (list || []).find((item) => item.filename === fileName);
        if (!entry) {
          reject(new Error(`文件不存在：${filePath}`));
          return;
        }
        resolve({
          size: entry.attrs.size,
          mtime: entry.attrs.mtime,
          readable: (entry.attrs.mode & 0o444) !== 0,
          kind: (entry.attrs.mode & 0o40000) !== 0 ? "directory" : "file"
        });
      });
    });
  }

  async sftpReadRange(serverId: string, filePath: string, offset: number, length: number): Promise<Buffer> {
    const sftp = await this.acquireSftp(serverId);

    return new Promise<Buffer>((resolve, reject) => {
      sftp.open(filePath, "r", (openError, handle) => {
        if (openError) {
          this.evictSftp(serverId);
          reject(new Error(`SFTP open 失败 (${filePath})：${openError.message}`));
          return;
        }
        const buf = Buffer.alloc(length);
        sftp.read(handle, buf, 0, length, offset, (readError, bytesRead) => {
          sftp.close(handle, () => {});
          if (readError) {
            this.evictSftp(serverId);
            reject(new Error(`SFTP read 失败 (${filePath})：${readError.message}`));
            return;
          }
          resolve(buf.subarray(0, bytesRead));
        });
      });
    });
  }

  /**
   * readdir(stat) + open+read using cached SFTP connection.
   * Supports offset=-1 (tail mode) — computes offset from file size internally.
   */
  async sftpStatAndRead(
    serverId: string,
    filePath: string,
    offset: number,
    length: number
  ): Promise<{ stat: { size: number; mtime: number; readable: boolean }; data: Buffer }> {
    const lastSlash = filePath.lastIndexOf("/");
    const parentDir = lastSlash > 0 ? filePath.substring(0, lastSlash) : "/";
    const fileName = filePath.substring(lastSlash + 1);

    const sftp = await this.acquireSftp(serverId);

    // Step 1: readdir parent to get file stat
    const fileStat = await new Promise<{ size: number; mtime: number; readable: boolean }>((resolve, reject) => {
      sftp.readdir(parentDir, (readError, list) => {
        if (readError) {
          this.evictSftp(serverId);
          reject(new Error(`SFTP readdir 失败 (${parentDir})：${readError.message}`));
          return;
        }
        const entry = (list || []).find((item) => item.filename === fileName);
        if (!entry) { reject(new Error(`文件不存在：${filePath}`)); return; }
        resolve({ size: entry.attrs.size, mtime: entry.attrs.mtime, readable: (entry.attrs.mode & 0o444) !== 0 });
      });
    });

    // Compute effective read range
    const effectiveOffset = offset === -1 ? Math.max(0, fileStat.size - length) : offset;
    const remaining = Math.max(0, fileStat.size - effectiveOffset);
    const effectiveLength = Math.min(length, remaining);

    if (effectiveLength <= 0) {
      return { stat: fileStat, data: Buffer.alloc(0) };
    }

    // Step 2: open + read on the same cached connection
    const data = await new Promise<Buffer>((resolve, reject) => {
      sftp.open(filePath, "r", (openError, handle) => {
        if (openError) {
          this.evictSftp(serverId);
          reject(new Error(`SFTP open 失败 (${filePath})：${openError.message}`));
          return;
        }
        const buf = Buffer.alloc(effectiveLength);
        sftp.read(handle, buf, 0, effectiveLength, effectiveOffset, (readErr, bytesRead) => {
          sftp.close(handle, () => {});
          if (readErr) {
            this.evictSftp(serverId);
            reject(new Error(`SFTP read 失败 (${filePath})：${readErr.message}`));
            return;
          }
          resolve(buf.subarray(0, bytesRead));
        });
      });
    });

    return { stat: fileStat, data };
  }

  /**
   * Execute a command and return stdout as a raw Readable stream (for streaming download).
   * The returned object includes the stream and a cleanup function to call on completion/error.
   */
  async execRawStream(serverId: string, command: string, timeoutMs = 600000): Promise<{
    stream: import("stream").Readable;
    cleanup: () => void;
  }> {
    const connection = await this.connectForStreaming(serverId, timeoutMs);

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        connection.cleanup();
        reject(new Error(`SSH stream command timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      connection.client.exec(command, (error, channel) => {
        if (error) {
          clearTimeout(timeout);
          connection.cleanup();
          reject(error);
          return;
        }

        const cleanup = () => {
          clearTimeout(timeout);
          connection.cleanup();
        };

        channel.on("close", () => cleanup());
        channel.on("error", () => cleanup());

        // Resolve immediately with the stdout stream
        resolve({ stream: channel, cleanup });
      });
    });
  }

  /**
   * Create a readable stream for a remote file using the cached SFTP connection.
   */
  async sftpCreateReadStream(serverId: string, filePath: string): Promise<import("ssh2").ReadStream> {
    const sftp = await this.acquireSftp(serverId);
    return sftp.createReadStream(filePath);
  }

  async sftpOpenSession(serverId: string): Promise<SftpSession> {
    const sftp = await this.acquireSftp(serverId);
    const self = this;

    return {
      stat(filePath: string) {
        return new Promise((resolve, reject) => {
          sftp.stat(filePath, (err, stats) => {
            if (err) { self.evictSftp(serverId); return reject(new Error(`SFTP stat 失败 (${filePath})：${err.message}`)); }
            resolve({ size: stats.size, mtime: stats.mtime, readable: (stats.mode & 0o444) !== 0 });
          });
        });
      },
      read(filePath: string, offset: number, length: number) {
        return new Promise((resolve, reject) => {
          sftp.open(filePath, "r", (openErr, handle) => {
            if (openErr) { self.evictSftp(serverId); return reject(new Error(`SFTP open 失败 (${filePath})：${openErr.message}`)); }
            const buf = Buffer.alloc(length);
            sftp.read(handle, buf, 0, length, offset, (readErr, bytesRead) => {
              sftp.close(handle, () => {});
              if (readErr) { self.evictSftp(serverId); return reject(new Error(`SFTP read 失败 (${filePath})：${readErr.message}`)); }
              resolve(buf.subarray(0, bytesRead));
            });
          });
        });
      },
      write(filePath: string, data: Buffer) {
        return new Promise<void>((resolve, reject) => {
          sftp.open(filePath, "w", (openErr, handle) => {
            if (openErr) { self.evictSftp(serverId); return reject(new Error(`SFTP open(write) 失败 (${filePath})：${openErr.message}`)); }
            const CHUNK = 32 * 1024;
            let offset = 0;
            function writeNext() {
              if (offset >= data.length) { sftp.close(handle, () => {}); return resolve(); }
              const end = Math.min(offset + CHUNK, data.length);
              sftp.write(handle, data, offset, end - offset, offset, (writeErr) => {
                if (writeErr) { sftp.close(handle, () => {}); self.evictSftp(serverId); return reject(new Error(`SFTP write 失败 (${filePath} offset=${offset})：${writeErr.message}`)); }
                offset = end;
                writeNext();
              });
            }
            writeNext();
          });
        });
      },
      openForWrite(filePath: string): Promise<SftpWriteHandle> {
        return new Promise((resolve, reject) => {
          sftp.open(filePath, "w", (openErr, handle) => {
            if (openErr) { self.evictSftp(serverId); return reject(new Error(`SFTP open(write) 失败 (${filePath})：${openErr.message}`)); }
            resolve({
              writeChunk(data: Buffer, offset: number): Promise<void> {
                return new Promise<void>((res, rej) => {
                  const CHUNK = 32 * 1024;
                  let pos = 0;
                  function next() {
                    if (pos >= data.length) return res();
                    const end = Math.min(pos + CHUNK, data.length);
                    sftp.write(handle, data, pos, end - pos, offset + pos, (err) => {
                      if (err) { self.evictSftp(serverId); return rej(new Error(`SFTP write 失败 (offset=${offset + pos})：${err.message}`)); }
                      pos = end;
                      next();
                    });
                  }
                  next();
                });
              },
              close(): Promise<void> {
                return new Promise<void>((res) => sftp.close(handle, () => res()));
              }
            });
          });
        });
      },
      unlink(filePath: string) {
        return new Promise<void>((resolve, reject) => {
          sftp.unlink(filePath, (err) => {
            if (err) { self.evictSftp(serverId); return reject(new Error(`SFTP unlink 失败 (${filePath})：${err.message}`)); }
            resolve();
          });
        });
      },
      listDirectory(directoryPath: string) {
        return new Promise<Array<{ name: string; path: string; kind: "file" | "directory" }>>((resolve, reject) => {
          sftp.readdir(directoryPath, (err, list) => {
            if (err) { self.evictSftp(serverId); return reject(new Error(`SFTP 读取目录失败 (${directoryPath})：${err.message}`)); }
            const entries = (list || [])
              .filter((item) => item.filename !== "." && item.filename !== "..")
              .map((item) => {
                const isDir = (item.attrs.mode & 0o40000) !== 0;
                const fullPath = directoryPath === "/" ? `/${item.filename}` : `${directoryPath}/${item.filename}`;
                return {
                  name: item.filename,
                  path: fullPath,
                  kind: (isDir ? "directory" : "file") as "file" | "directory"
                };
              });
            resolve(entries);
          });
        });
      },
      rmdir(directoryPath: string) {
        return new Promise<void>((resolve, reject) => {
          sftp.rmdir(directoryPath, (err) => {
            if (err) { self.evictSftp(serverId); return reject(new Error(`SFTP rmdir 失败 (${directoryPath})：${err.message}`)); }
            resolve();
          });
        });
      },
      rename(oldPath: string, newPath: string) {
        return new Promise<void>((resolve, reject) => {
          sftp.rename(oldPath, newPath, (err) => {
            if (err) { self.evictSftp(serverId); return reject(new Error(`SFTP rename 失败 (${oldPath} → ${newPath})：${err.message}`)); }
            resolve();
          });
        });
      },
      async ensureDir(dirPath: string) {
        const parts = dirPath.split("/").filter(Boolean);
        let current = "";
        for (const part of parts) {
          current += "/" + part;
          await new Promise<void>((resolve) => {
            sftp.mkdir(current, (err) => {
              // Ignore errors (directory may already exist)
              resolve();
            });
          });
        }
      },
      close() {
        // No-op: pool manages connection lifecycle
      }
    };
  }

  async listBastionAssets(bastionId: string, keyword: string, timeoutMs = 30000): Promise<JumpServerAssetOption[]> {
    const bastion = this.serverRegistry.getServer(bastionId);
    if (!this.isJumpServerBastion(bastion)) {
      throw new Error("指定的服务器不是 JumpServer 堡垒机。");
    }
    const fakeTarget = { host: keyword || "", name: "" } as ReturnType<ServerRegistryService["getServer"]>;
    const assets = await this.queryJumpServerAssets(fakeTarget, bastion.id, keyword || "", timeoutMs);
    return assets.map((asset) => ({
      id: asset.id,
      name: asset.name,
      address: asset.address,
      platform: asset.platform,
      organization: asset.organization,
      comment: asset.comment
    }));
  }

  async searchJumpServerAssets(serverId: string, bastionId: string | undefined, keyword: string, timeoutMs = 30000): Promise<JumpServerAssetOption[]> {
    const targetServer = this.serverRegistry.getServer(serverId);
    const bastion = this.resolveJumpServerBastion(serverId, bastionId);
    if (!this.isJumpServerBastion(bastion)) {
      throw new Error("当前入口不是 JumpServer 账号，无法使用资产搜索。");
    }

    const assets = await this.queryJumpServerAssets(targetServer, bastion.id, keyword.trim() || targetServer.host, timeoutMs);
    return assets.map((asset) => ({
      id: asset.id,
      name: asset.name,
      address: asset.address,
      platform: asset.platform,
      organization: asset.organization,
      comment: asset.comment
    }));
  }

  async probe(serverId: string, timeoutMs = 15000): Promise<{ mode: ManagedSshConnection["mode"] }> {
    const server = this.serverRegistry.getServer(serverId);
    const credentials = this.credentialResolver.resolve(server);
    try {
      const connection = await this.connectManaged(serverId, timeoutMs);
      const mode = connection.mode;
      connection.cleanup();
      return { mode };
    } catch (error) {
      throw new Error(humanizeSshError(error, credentials));
    }
  }

  async connectJumpServerTerminal(serverId: string, bastionId: string | undefined, timeoutMs = 30000): Promise<ManagedSshConnection> {
    const currentServer = this.serverRegistry.getServer(serverId);
    if (this.isJumpServerBastion(currentServer)) {
      return this.openJumpServerShellManaged(currentServer.id, timeoutMs);
    }

    const bastion = this.resolveJumpServerBastion(serverId, bastionId);
    if (!this.isJumpServerBastion(bastion)) {
      throw new Error("当前没有可用的 JumpServer 入口账号。");
    }

    return this.openJumpServerShellManaged(bastion.id, timeoutMs);
  }

  async connectTerminal(serverId: string, bastionId: string | undefined, timeoutMs = 30000, cwd?: string): Promise<ManagedSshConnection> {
    const currentServer = this.serverRegistry.getServer(serverId);
    if (this.isJumpServerBastion(currentServer)) {
      return this.connectJumpServerTerminal(serverId, bastionId, timeoutMs);
    }

    let connection: ManagedSshConnection;
    const shouldUseBastion = currentServer.connectionKind === "bastion-target" || (!currentServer.connectionKind && Boolean(bastionId));

    if (shouldUseBastion && bastionId) {
      const bastion = this.serverRegistry.getServer(bastionId);
      connection = this.isJumpServerBastion(bastion)
        ? await this.connectManagedViaJumpServerShell(serverId, bastion.id, timeoutMs)
        : await this.connectManagedViaBastion(serverId, bastion.id, timeoutMs);
    } else {
      connection = await this.connectForStreaming(serverId, timeoutMs);
    }

    if (connection.shellStream) {
      return connection;
    }

    return new Promise<ManagedSshConnection>((resolve, reject) => {
      const shellOpts: Record<string, unknown> = { term: "xterm", cols: 160, rows: 48 };
      if (cwd) { shellOpts.cwd = cwd; }
      connection.client.shell(shellOpts, (error, stream) => {
        if (error) {
          connection.cleanup();
          reject(error);
          return;
        }

        resolve({
          client: connection.client,
          mode: connection.mode,
          shellStream: stream,
          cleanup: () => {
            stream.end("exit\r");
            connection.cleanup();
          }
        });
      });
    });
  }

  /** Run command on a pooled Client (no cleanup — pool manages lifecycle). */
  private execOnClient(client: Client, command: string, timeoutMs: number): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      let stdout = "";
      let stderr = "";
      let settled = false;

      const timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(new Error(`SSH command timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      client.exec(command, (error, stream) => {
        if (error) {
          clearTimeout(timeout);
          settled = true;
          reject(error);
          return;
        }

        stream.on("data", (chunk: Buffer | string) => { stdout += chunk.toString(); });
        stream.stderr.on("data", (chunk: Buffer | string) => { stderr += chunk.toString(); });

        stream.on("close", (code: number | undefined) => {
          if (settled) return;
          clearTimeout(timeout);
          settled = true;
          if (code && code !== 0 && stdout.length === 0) {
            reject(new Error(stderr || `SSH command failed with exit code ${code}`));
            return;
          }
          resolve(stdout || stderr);
        });
      });
    });
  }

  /** Run command with stdin on a pooled Client. */
  private execOnClientStdin(client: Client, command: string, stdinData: string | Buffer, timeoutMs: number): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      let stdout = "";
      let stderr = "";
      let settled = false;

      const timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(new Error(`SSH command timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      client.exec(command, (error, stream) => {
        if (error) {
          clearTimeout(timeout);
          settled = true;
          reject(error);
          return;
        }

        stream.on("data", (chunk: Buffer | string) => { stdout += chunk.toString(); });
        stream.stderr.on("data", (chunk: Buffer | string) => { stderr += chunk.toString(); });

        stream.on("close", (code: number | undefined) => {
          if (settled) return;
          clearTimeout(timeout);
          settled = true;
          if (code && code !== 0 && stdout.length === 0) {
            reject(new Error(stderr || `SSH command failed with exit code ${code}`));
            return;
          }
          resolve(stdout || stderr);
        });

        stream.write(stdinData);
        stream.end();
      });
    });
  }

  private execWithConnection(connection: ManagedSshConnection, command: string, timeoutMs: number): Promise<string> {
    if (connection.mode === "jumpserver-shell" && connection.shellStream) {
      return this.execWithShellConnection(connection, command, timeoutMs);
    }

    return new Promise<string>((resolve, reject) => {
      let stdout = "";
      let stderr = "";
      let settled = false;

      const timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        connection.cleanup();
        reject(new Error(`SSH command timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      connection.client.exec(command, (error, stream) => {
        if (error) {
          clearTimeout(timeout);
          settled = true;
          connection.cleanup();
          reject(error);
          return;
        }

        stream.on("data", (chunk: Buffer | string) => {
          stdout += chunk.toString();
        });

        stream.stderr.on("data", (chunk: Buffer | string) => {
          stderr += chunk.toString();
        });

        stream.on("close", (code: number | undefined) => {
          if (settled) return;
          clearTimeout(timeout);
          settled = true;
          connection.cleanup();

          if (code && code !== 0 && stdout.length === 0) {
            reject(new Error(stderr || `SSH command failed with exit code ${code}`));
            return;
          }

          resolve(stdout || stderr);
        });
      });
    });
  }

  private execWithConnectionStdin(
    connection: ManagedSshConnection,
    command: string,
    stdinData: string | Buffer,
    timeoutMs: number
  ): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      let stdout = "";
      let stderr = "";
      let settled = false;

      const timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        connection.cleanup();
        reject(new Error(`SSH command timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      connection.client.exec(command, (error, stream) => {
        if (error) {
          clearTimeout(timeout);
          settled = true;
          connection.cleanup();
          reject(error);
          return;
        }

        stream.on("data", (chunk: Buffer | string) => {
          stdout += chunk.toString();
        });

        stream.stderr.on("data", (chunk: Buffer | string) => {
          stderr += chunk.toString();
        });

        stream.on("close", (code: number | undefined) => {
          if (settled) return;
          clearTimeout(timeout);
          settled = true;
          connection.cleanup();

          if (code && code !== 0 && stdout.length === 0) {
            reject(new Error(stderr || `SSH command failed with exit code ${code}`));
            return;
          }

          resolve(stdout || stderr);
        });

        stream.write(stdinData);
        stream.end();
      });
    });
  }

  private execWithShellConnection(
    connection: ManagedSshConnection,
    command: string,
    timeoutMs: number,
    options?: { preserveConnection?: boolean }
  ): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const shellStream = connection.shellStream;
      if (!shellStream) {
        connection.cleanup();
        reject(new Error("JumpServer shell stream is missing."));
        return;
      }

      const token = `SLC_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
      const startMarker = `__${token}_BEGIN__`;
      const endMarker = `__${token}_END__`;
      const startLinePattern = new RegExp(`(?:\\r?\\n|^)${escapeRegExp(startMarker)}\\r?\\n`);
      const endLinePattern = new RegExp(`(?:\\r?\\n)${escapeRegExp(endMarker)}:(\\d+)\\r?\\n`);
      let buffer = "";
      let settled = false;

      const timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        cleanup();
        if (!options?.preserveConnection) {
          connection.cleanup();
        }
        reject(new Error(`JumpServer shell command timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      const onData = (chunk: Buffer | string) => {
        buffer += chunk.toString();
        const startMatch = startLinePattern.exec(buffer);
        if (!startMatch) {
          return;
        }

        const endMatch = endLinePattern.exec(buffer.slice(startMatch.index + startMatch[0].length));
        if (!endMatch) {
          return;
        }

        const contentStart = startMatch.index + startMatch[0].length;
        const endRelativeIndex = buffer.slice(contentStart).indexOf(endMatch[0]);
        const segment = endRelativeIndex >= 0 ? buffer.slice(contentStart, contentStart + endRelativeIndex) : "";
        const exitCode = Number(endMatch[1] || 0);

        settled = true;
        clearTimeout(timeout);
        cleanup();
        if (!options?.preserveConnection) {
          connection.cleanup();
        }

        const cleaned = segment.replace(/^\r?\n/, "").replace(/\r/g, "");
        if (exitCode !== 0 && cleaned.trim().length === 0) {
          reject(new Error(`JumpServer shell command failed with exit code ${exitCode}`));
          return;
        }

        resolve(cleaned);
      };

      const onError = (error: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        cleanup();
        if (!options?.preserveConnection) {
          connection.cleanup();
        }
        reject(error);
      };

      const cleanup = () => {
        shellStream.off("data", onData);
        shellStream.off("error", onError);
      };

      shellStream.on("data", onData);
      shellStream.on("error", onError);

      shellStream.write(`printf '${startMarker}\\n'; ${command}; __slc_status=$?; printf '\\n${endMarker}:%s\\n' "$__slc_status"\r`);
    });
  }

  private createSshClient(password?: string): Client {
    const client = new Client();
    client.on("keyboard-interactive", (_name, _instructions, _lang, _prompts, finish) => {
      finish([password || ""]);
    });
    return client;
  }

  private connectManaged(serverId: string, timeoutMs: number): Promise<ManagedSshConnection> {
    const server = this.serverRegistry.getServer(serverId);
    const credentials = this.credentialResolver.resolve(server);

    return new Promise<ManagedSshConnection>((resolve, reject) => {
      const client = this.createSshClient(credentials.password);
      let settled = false;

      const timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        client.end();
        reject(new Error(`SSH connect timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      client
        .on("ready", () => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          resolve({
            client,
            cleanup: () => client.end(),
            mode: "direct"
          });
        })
        .on("error", (error) => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          reject(error);
        })
        .connect({
          host: credentials.host,
          port: credentials.port,
          username: credentials.username,
          password: credentials.password,
          privateKey: credentials.privateKey,
          readyTimeout: Math.min(timeoutMs, 20000),
          tryKeyboard: true,
          keepaliveInterval: 10000,
          keepaliveCountMax: 30
        });
    });
  }

  private async connectManagedViaBastion(serverId: string, bastionId: string, timeoutMs: number): Promise<ManagedSshConnection> {
    const targetServer = this.serverRegistry.getServer(serverId);
    const bastionServer = this.serverRegistry.getServer(bastionId);

    if (this.isJumpServerBastion(bastionServer)) {
      return this.connectManagedViaJumpServerShell(serverId, bastionId, timeoutMs);
    }

    const targetCredentials = this.credentialResolver.resolve(targetServer);
    const bastionCredentials = this.credentialResolver.resolve(bastionServer);

    return new Promise<ManagedSshConnection>((resolve, reject) => {
      const outer = this.createSshClient(bastionCredentials.password);
      const inner = this.createSshClient(targetCredentials.password);
      let settled = false;

      const timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        inner.end();
        outer.end();
        reject(new Error(`Bastion SSH connect timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      outer
        .on("ready", () => {
          outer.forwardOut("127.0.0.1", 0, targetCredentials.host, targetCredentials.port, (error, stream) => {
            if (error) {
              if (!settled) {
                settled = true;
                clearTimeout(timeout);
                outer.end();
                reject(error);
              }
              return;
            }

            inner
              .on("ready", () => {
                if (settled) return;
                settled = true;
                clearTimeout(timeout);
                resolve({
                  client: inner,
                  cleanup: () => {
                    inner.end();
                    outer.end();
                  },
                  mode: "bastion"
                });
              })
              .on("error", (innerError) => {
                if (settled) return;
                settled = true;
                clearTimeout(timeout);
                outer.end();
                reject(innerError);
              })
              .connect({
                sock: stream,
                username: targetCredentials.username,
                password: targetCredentials.password,
                privateKey: targetCredentials.privateKey,
                readyTimeout: Math.min(timeoutMs, 20000),
                tryKeyboard: true,
                keepaliveInterval: 10000,
                keepaliveCountMax: 60
              });
          });
        })
        .on("error", (error) => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          reject(error);
        })
        .connect({
          host: bastionCredentials.host,
          port: bastionCredentials.port,
          username: bastionCredentials.username,
          password: bastionCredentials.password,
          privateKey: bastionCredentials.privateKey,
          tryKeyboard: true,
          readyTimeout: Math.min(timeoutMs, 20000),
          keepaliveInterval: 10000,
          keepaliveCountMax: 30
        });
    });
  }

  private async connectManagedViaJumpServerShell(serverId: string, bastionId: string, timeoutMs: number): Promise<ManagedSshConnection> {
    const targetServer = this.serverRegistry.getServer(serverId);
    const bastionServer = this.serverRegistry.getServer(bastionId);
    const bastionCredentials = this.credentialResolver.resolve(bastionServer);
    const route = this.localConfigService.getServerRoute(serverId);

    return new Promise<ManagedSshConnection>((resolve, reject) => {
      const client = this.createSshClient(bastionCredentials.password);
      let settled = false;

      const timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        client.end();
        reject(new Error(`JumpServer 连接超时，超过 ${timeoutMs}ms`));
      }, timeoutMs);

      client
        .on("ready", () => {
          client.shell({ term: "xterm", cols: 160, rows: 48 }, async (error, stream) => {
            if (error) {
              if (!settled) {
                settled = true;
                clearTimeout(timeout);
                client.end();
                reject(error);
              }
              return;
            }

            try {
              await this.enterJumpServerTarget(stream, targetServer, route, timeoutMs);
              if (settled) return;
              settled = true;
              clearTimeout(timeout);
              resolve({
                client,
                shellStream: stream,
                cleanup: () => {
                  stream.end("exit\r");
                  client.end();
                },
                mode: "jumpserver-shell"
              });
            } catch (shellError) {
              if (settled) return;
              settled = true;
              clearTimeout(timeout);
              stream.end("q\n");
              client.end();
              reject(shellError);
            }
          });
        })
        .on("error", (error) => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          reject(error);
        })
        .connect({
          host: bastionCredentials.host,
          port: bastionCredentials.port,
          username: bastionCredentials.username,
          password: bastionCredentials.password,
          privateKey: bastionCredentials.privateKey,
          tryKeyboard: true,
          readyTimeout: Math.min(timeoutMs, 20000),
          keepaliveInterval: 10000,
          keepaliveCountMax: 30
        });
    });
  }

  private openJumpServerShellManaged(serverId: string, timeoutMs: number): Promise<ManagedSshConnection> {
    const server = this.serverRegistry.getServer(serverId);
    const credentials = this.credentialResolver.resolve(server);

    return new Promise<ManagedSshConnection>((resolve, reject) => {
      const client = this.createSshClient(credentials.password);
      let settled = false;

      const timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        client.end();
        reject(new Error(`JumpServer 终端连接超时，超过 ${timeoutMs}ms`));
      }, timeoutMs);

      client
        .on("ready", () => {
          client.shell({ term: "xterm", cols: 160, rows: 48 }, async (error, stream) => {
            if (error) {
              if (!settled) {
                settled = true;
                clearTimeout(timeout);
                client.end();
                reject(error);
              }
              return;
            }

            try {
              const initial = await waitForPatterns(
                stream,
                [{ key: "menu", pattern: /Opt>\s*$/m }],
                timeoutMs,
                "等待 JumpServer 菜单超时"
              );

              if (settled) {
                return;
              }

              settled = true;
              clearTimeout(timeout);
              resolve({
                client,
                shellStream: stream,
                initialBuffer: initial.buffer,
                cleanup: () => {
                  stream.end("q\r");
                  client.end();
                },
                mode: "jumpserver-shell"
              });
            } catch (shellError) {
              if (settled) {
                return;
              }
              settled = true;
              clearTimeout(timeout);
              stream.end("q\r");
              client.end();
              reject(shellError);
            }
          });
        })
        .on("error", (error) => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          reject(error);
        })
        .connect({
          host: credentials.host,
          port: credentials.port,
          username: credentials.username,
          password: credentials.password,
          privateKey: credentials.privateKey,
          tryKeyboard: true,
          readyTimeout: Math.min(timeoutMs, 20000),
          keepaliveInterval: 10000,
          keepaliveCountMax: 30
        });
    });
  }

  private async queryJumpServerAssets(
    targetServer: ReturnType<ServerRegistryService["getServer"]>,
    bastionId: string,
    keyword: string,
    timeoutMs: number
  ) {
    const bastionServer = this.serverRegistry.getServer(bastionId);
    const bastionCredentials = this.credentialResolver.resolve(bastionServer);

    return new Promise<JumpServerAssetCandidate[]>((resolve, reject) => {
      const client = this.createSshClient(bastionCredentials.password);
      let settled = false;

      const timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        client.end();
        reject(new Error(`JumpServer 资产搜索超时，超过 ${timeoutMs}ms`));
      }, timeoutMs);

      client
        .on("ready", () => {
          client.shell({ term: "xterm", cols: 160, rows: 48 }, async (error, stream) => {
            if (error) {
              if (!settled) {
                settled = true;
                clearTimeout(timeout);
                client.end();
                reject(error);
              }
              return;
            }

            try {
              await waitForPatterns(stream, [{ key: "menu", pattern: /Opt>\s*$/m }], timeoutMs, "等待 JumpServer 菜单超时");
              const result = await sendAndWaitForPatterns(
                stream,
                `/${keyword}\r`,
                [
                  { key: "host-select", pattern: /\[Host\]>\s*$/m },
                  { key: "no-match", pattern: /(没有资产|没有匹配|No matched asset)/i }
                ],
                timeoutMs,
                "JumpServer 资产搜索超时"
              );

              settled = true;
              clearTimeout(timeout);
              stream.end("q\r");
              client.end();

              if (result.key === "no-match") {
                resolve([]);
                return;
              }

              resolve(parseJumpServerAssetCandidates(result.buffer));
            } catch (shellError) {
              if (settled) return;
              settled = true;
              clearTimeout(timeout);
              stream.end("q\r");
              client.end();
              reject(shellError);
            }
          });
        })
        .on("error", (error) => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          reject(error);
        })
        .connect({
          host: bastionCredentials.host,
          port: bastionCredentials.port,
          username: bastionCredentials.username,
          password: bastionCredentials.password,
          privateKey: bastionCredentials.privateKey,
          tryKeyboard: true,
          readyTimeout: Math.min(timeoutMs, 20000),
          keepaliveInterval: 10000,
          keepaliveCountMax: 30
        });
    });
  }

  private async enterJumpServerTarget(
    stream: ClientChannel,
    targetServer: ReturnType<ServerRegistryService["getServer"]>,
    route: ReturnType<LocalConfigService["getServerRoute"]>,
    timeoutMs: number
  ) {
    await waitForPatterns(
      stream,
      [{ key: "menu", pattern: /Opt>\s*$/m }],
      timeoutMs,
      "等待 JumpServer 菜单超时"
    );

    const searchKeyword = route.jumpSearchKeyword?.trim() || targetServer.host;
    const searchOutput = await sendAndWaitForPatterns(
      stream,
      `/${searchKeyword}\r`,
      [
        { key: "host-select", pattern: /\[Host\]>\s*$/m },
        { key: "target-shell", pattern: /(\[[^\]\n]+@[^\]\n]+[^\n]*[#$]\s*$)|([#$]\s*$)/m },
        { key: "no-match", pattern: /(没有匹配|No matched asset|没有找到)/i }
      ],
      timeoutMs,
      "JumpServer 资产搜索超时"
    );

    if (searchOutput.key === "no-match") {
      throw new Error(`JumpServer 未找到目标资产：${searchKeyword}`);
    }

    if (searchOutput.key === "target-shell") {
      return;
    }

    const assetId = this.pickJumpServerAssetId(searchOutput.buffer, targetServer, route);
    const connectOutput = await sendAndWaitForPatterns(
      stream,
      `${assetId}\r`,
      [
        { key: "target-shell", pattern: /(\[[^\]\n]+@[^\]\n]+[^\n]*[#$]\s*$)|([#$]\s*$)/m },
        { key: "auth-failed", pattern: /(permission denied|认证失败|连接失败|No system user|没有系统用户)/i },
        { key: "host-select", pattern: /\[Host\]>\s*$/m }
      ],
      timeoutMs,
      "JumpServer 进入目标主机超时"
    );

    if (connectOutput.key === "auth-failed") {
      throw new Error(`JumpServer 进入目标主机失败：${compactJumpServerOutput(connectOutput.buffer)}`);
    }

    if (connectOutput.key === "host-select") {
      throw new Error(`JumpServer 资产选择后仍停留在候选列表：${compactJumpServerOutput(connectOutput.buffer)}`);
    }
  }

  private pickJumpServerAssetId(
    output: string,
    targetServer: ReturnType<ServerRegistryService["getServer"]>,
    route: ReturnType<LocalConfigService["getServerRoute"]>
  ) {
    const normalizedOutput = stripAnsi(output);
    if (route.jumpAssetId?.trim()) {
      return route.jumpAssetId.trim();
    }

    const candidates = parseJumpServerAssetCandidates(output);
    if (candidates.length === 0 && /没有资产|没有匹配|No matched asset/i.test(normalizedOutput)) {
      throw new Error(`JumpServer 未找到目标资产：${route.jumpSearchKeyword?.trim() || targetServer.host}`);
    }

    const exactHostMatches = candidates.filter((item) => item.address === targetServer.host);
    if (exactHostMatches.length === 1) {
      return exactHostMatches[0].id;
    }

    const exactNameMatches = exactHostMatches.filter((item) => item.name === targetServer.name);
    if (exactNameMatches.length === 1) {
      return exactNameMatches[0].id;
    }

    if (candidates.length === 1) {
      return candidates[0].id;
    }

    const preview = candidates
      .slice(0, 5)
      .map((item) => `${item.id}:${item.name}@${item.address}`)
      .join("，");

    throw new Error(
      `JumpServer 搜索结果无法自动唯一命中，请在“跳转入口”里补资产编号。候选：${preview || compactJumpServerOutput(output)}`
    );
  }

  async connectToJumpServerAsset(bastionServerId: string, assetKeyword: string, timeoutMs = 45000): Promise<ManagedSshConnection> {
    const server = this.serverRegistry.getServer(bastionServerId);
    const credentials = this.credentialResolver.resolve(server);

    return new Promise<ManagedSshConnection>((resolve, reject) => {
      const client = this.createSshClient(credentials.password);
      let settled = false;

      const timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        client.end();
        reject(new Error(`JumpServer 连接超时，超过 ${timeoutMs}ms`));
      }, timeoutMs);

      client
        .on("ready", () => {
          client.shell({ term: "xterm", cols: 160, rows: 48 }, async (error, stream) => {
            if (error) {
              if (!settled) { settled = true; clearTimeout(timeout); client.end(); reject(error); }
              return;
            }

            try {
              await waitForPatterns(stream, [{ key: "menu", pattern: /Opt>\s*$/m }], timeoutMs, "等待 JumpServer 菜单超时");

              const searchOutput = await sendAndWaitForPatterns(
                stream,
                `/${assetKeyword}\r`,
                [
                  { key: "host-select", pattern: /\[Host\]>\s*$/m },
                  { key: "target-shell", pattern: /(\[[^\]\n]+@[^\]\n]+[^\n]*[#$]\s*$)|([#$]\s*$)/m },
                  { key: "no-match", pattern: /(没有匹配|No matched asset|没有找到)/i }
                ],
                timeoutMs,
                "JumpServer 资产搜索超时"
              );

              if (searchOutput.key === "no-match") {
                throw new Error(`JumpServer 未找到目标资产：${assetKeyword}`);
              }

              if (searchOutput.key === "host-select") {
                const selectOutput = await sendAndWaitForPatterns(
                  stream,
                  "1\r",
                  [
                    { key: "target-shell", pattern: /(\[[^\]\n]+@[^\]\n]+[^\n]*[#$]\s*$)|([#$]\s*$)/m },
                    { key: "auth-failed", pattern: /(permission denied|认证失败|连接失败)/i }
                  ],
                  timeoutMs,
                  "JumpServer 进入目标主机超时"
                );
                if (selectOutput.key === "auth-failed") {
                  throw new Error(`JumpServer 进入目标主机失败`);
                }
              }

              if (settled) return;
              settled = true;
              clearTimeout(timeout);
              resolve({
                client,
                shellStream: stream,
                cleanup: () => { stream.end("exit\r"); client.end(); },
                mode: "jumpserver-shell"
              });
            } catch (shellError) {
              if (settled) return;
              settled = true;
              clearTimeout(timeout);
              stream.end("q\n");
              client.end();
              reject(shellError);
            }
          });
        })
        .on("error", (error) => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          reject(error);
        })
        .connect({
          host: credentials.host,
          port: credentials.port,
          username: credentials.username,
          password: credentials.password,
          privateKey: credentials.privateKey,
          tryKeyboard: true,
          readyTimeout: Math.min(timeoutMs, 20000),
          keepaliveInterval: 10000,
          keepaliveCountMax: 30
        });
    });
  }

  isJumpServerBastion(server: ReturnType<ServerRegistryService["getServer"]>) {
    const name = (server.name || "").toLowerCase();
    const hint = (server.connectionHint || "").toLowerCase();
    return server.port === 2222 || name.includes("jumpserver") || name.includes("堡垒机") || hint.includes("jumpserver");
  }

  private shouldTryBastion(server: ReturnType<ServerRegistryService["getServer"]>) {
    if (server.connectionKind === "bastion") {
      return false;
    }

    return /^192\.168\./.test(server.host);
  }

  private findCandidateBastions(serverId: string) {
    const currentServer = this.serverRegistry.getServer(serverId);
    const bastions = this.serverRegistry
      .listServers()
      .filter((server) => server.id !== serverId && server.connectionKind === "bastion");

    if (bastions.length === 0) {
      return [];
    }

    const assigned = currentServer.preferredBastionId
      ? bastions.find((server) => server.id === currentServer.preferredBastionId)
      : null;
    const alternateSameHost = assigned
      ? bastions.filter(
          (server) => server.id !== assigned.id && server.host === assigned.host && server.port === assigned.port
        )
      : [];
    const remaining = bastions.filter(
      (server) => server.id !== assigned?.id && !alternateSameHost.some((item) => item.id === server.id)
    );

    return [
      ...(assigned ? [assigned] : []),
      ...alternateSameHost.sort((a, b) => a.name.localeCompare(b.name, "zh-CN")),
      ...remaining.sort((a, b) => a.name.localeCompare(b.name, "zh-CN"))
    ];
  }

  private resolveJumpServerBastion(serverId: string, bastionId?: string) {
    const currentServer = this.serverRegistry.getServer(serverId);
    if (this.isJumpServerBastion(currentServer)) {
      if (!bastionId || bastionId === currentServer.id) {
        return currentServer;
      }
    }

    const bastions = this.findCandidateBastions(serverId);
    if (bastionId) {
      const matched = bastions.find((server) => server.id === bastionId);
      if (matched) {
        return matched;
      }
    }

    const jumpServer = bastions.find((server) => this.isJumpServerBastion(server));
    if (jumpServer) {
      return jumpServer;
    }

    throw new Error("当前没有可用的 JumpServer 入口账号。");
  }
}

async function waitForPatterns(
  stream: ClientChannel,
  patterns: Array<{ key: string; pattern: RegExp }>,
  timeoutMs: number,
  timeoutMessage: string
) {
  return new Promise<{ key: string; buffer: string }>((resolve, reject) => {
    let buffer = "";
    let settled = false;

    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error(`${timeoutMessage}：${compactJumpServerOutput(buffer)}`));
    }, timeoutMs);

    const onData = (chunk: Buffer | string) => {
      buffer += chunk.toString();
      for (const item of patterns) {
        if (item.pattern.test(buffer)) {
          settled = true;
          clearTimeout(timeout);
          cleanup();
          resolve({ key: item.key, buffer });
          return;
        }
      }
    };

    const onError = (error: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      cleanup();
      reject(error);
    };

    const cleanup = () => {
      stream.off("data", onData);
      stream.off("error", onError);
    };

    stream.on("data", onData);
    stream.on("error", onError);
  });
}

async function sendAndWaitForPatterns(
  stream: ClientChannel,
  input: string,
  patterns: Array<{ key: string; pattern: RegExp }>,
  timeoutMs: number,
  timeoutMessage: string
) {
  const waiter = waitForPatterns(stream, patterns, timeoutMs, timeoutMessage);
  stream.write(input);
  return waiter;
}

function parseJumpServerAssetCandidates(output: string): JumpServerAssetCandidate[] {
  const lines = output.split(/\r?\n/);
  const candidates: JumpServerAssetCandidate[] = [];

  for (const line of lines) {
    if (!line.includes("|")) {
      continue;
    }

    const cells = line.split("|").map((item) => item.trim()).filter(Boolean);
    if (cells.length < 3 || !/^\d+$/.test(cells[0])) {
      continue;
    }

    candidates.push({
      id: cells[0],
      name: cells[1] || "",
      address: cells[2] || "",
      platform: cells[3] || "",
      organization: cells[4] || "",
      comment: cells[5] || ""
    });
  }

  return candidates;
}

function compactJumpServerOutput(output: string) {
  return stripAnsi(output)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(-6)
    .join(" | ");
}

function stripAnsi(value: string) {
  return value.replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, "").replace(/\u001b\][^\u0007]*\u0007/g, "");
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function formatErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error || "未知错误");
}
