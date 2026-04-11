import { Client, type ClientChannel, type SFTPWrapper } from "ssh2";
import type { JumpServerAssetOption } from "@server-log-console/shared";
import { CredentialResolverService } from "../servers/credential-resolver.service.js";
import { LocalConfigService } from "../servers/local-config.service.js";
import { ServerRegistryService } from "../servers/server-registry.service.js";

export interface SftpSession {
  stat(filePath: string): Promise<{ size: number; mtime: number; readable: boolean }>;
  read(filePath: string, offset: number, length: number): Promise<Buffer>;
  write(filePath: string, data: Buffer): Promise<void>;
  unlink(filePath: string): Promise<void>;
  rename(oldPath: string, newPath: string): Promise<void>;
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
  constructor(
    private readonly serverRegistry: ServerRegistryService,
    private readonly credentialResolver: CredentialResolverService,
    private readonly localConfigService: LocalConfigService
  ) {}

  async exec(serverId: string, command: string, timeoutMs = 45000): Promise<string> {
    const server = this.serverRegistry.getServer(serverId);
    const credentials = this.credentialResolver.resolve(server);

    try {
      const connection = await this.connectManaged(server.id, timeoutMs);
      return await this.execWithConnection(connection, command, timeoutMs);
    } catch (error) {
      if (!this.shouldTryBastion(server)) {
        throw new Error(humanizeSshError(error, credentials));
      }

      const bastions = this.findCandidateBastions(server.id);
      if (bastions.length === 0) {
        throw new Error(humanizeSshError(error, credentials));
      }

      const bastionErrors: string[] = [];

      for (const bastion of bastions) {
        try {
          const connection = await this.connectManagedViaBastion(server.id, bastion.id, timeoutMs);
          return await this.execWithConnection(connection, command, timeoutMs);
        } catch (bastionError) {
          bastionErrors.push(`${bastion.name}：${formatErrorMessage(bastionError)}`);
        }
      }

      throw new Error(humanizeSshError(error, credentials));
    }
  }

  async execWithStdin(serverId: string, command: string, stdinData: string | Buffer, timeoutMs = 120000): Promise<string> {
    const server = this.serverRegistry.getServer(serverId);
    const credentials = this.credentialResolver.resolve(server);

    try {
      const connection = await this.connectManaged(server.id, timeoutMs);
      return await this.execWithConnectionStdin(connection, command, stdinData, timeoutMs);
    } catch (error) {
      if (!this.shouldTryBastion(server)) {
        throw new Error(humanizeSshError(error, credentials));
      }

      const bastions = this.findCandidateBastions(server.id);
      if (bastions.length === 0) {
        throw new Error(humanizeSshError(error, credentials));
      }

      for (const bastion of bastions) {
        try {
          const connection = await this.connectManagedViaBastion(server.id, bastion.id, timeoutMs);
          return await this.execWithConnectionStdin(connection, command, stdinData, timeoutMs);
        } catch (_) { /* try next bastion */ }
      }

      throw new Error(humanizeSshError(error, credentials));
    }
  }

  async connectForStreaming(serverId: string, timeoutMs = 45000): Promise<ManagedSshConnection> {
    const server = this.serverRegistry.getServer(serverId);
    const credentials = this.credentialResolver.resolve(server);

    try {
      return await this.connectManaged(serverId, timeoutMs);
    } catch (error) {
      if (!this.shouldTryBastion(server)) {
        throw new Error(humanizeSshError(error, credentials));
      }

      const bastions = this.findCandidateBastions(serverId);
      if (bastions.length === 0) {
        throw new Error(humanizeSshError(error, credentials));
      }

      const bastionErrors: string[] = [];

      for (const bastion of bastions) {
        try {
          return await this.connectManagedViaBastion(serverId, bastion.id, timeoutMs);
        } catch (bastionError) {
          bastionErrors.push(`${bastion.name}：${formatErrorMessage(bastionError)}`);
        }
      }

      throw new Error(humanizeSshError(error, credentials));
    }
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

  async sftpListDirectory(serverId: string, directoryPath: string, timeoutMs = 30000): Promise<Array<{ name: string; path: string; kind: "file" | "directory"; size?: number; modifiedTime?: string }>> {
    const server = this.serverRegistry.getServer(serverId);
    const credentials = this.credentialResolver.resolve(server);

    const sftp = new Promise<Array<{ name: string; path: string; kind: "file" | "directory"; size?: number; modifiedTime?: string }>>((resolve, reject) => {
      const client = this.createSshClient(credentials.password);
      let settled = false;

      const timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        client.end();
        reject(new Error(`SFTP 连接超时 (${credentials.username}@${credentials.host}:${credentials.port})：超过 ${timeoutMs}ms`));
      }, timeoutMs);

      client
        .on("ready", () => {
          client.sftp((error, sftp) => {
            if (error) {
              if (!settled) { settled = true; clearTimeout(timeout); client.end(); reject(error); }
              return;
            }

            sftp.readdir(directoryPath, (readError, list) => {
              settled = true;
              clearTimeout(timeout);
              client.end();

              if (readError) {
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

    return sftp.catch((error) => {
      throw new Error(humanizeSshError(error, credentials));
    });
  }

  async sftpStat(serverId: string, filePath: string, timeoutMs = 30000): Promise<{ size: number; mtime: number; readable: boolean }> {
    const server = this.serverRegistry.getServer(serverId);
    const credentials = this.credentialResolver.resolve(server);

    const result = new Promise<{ size: number; mtime: number; readable: boolean }>((resolve, reject) => {
      const client = this.createSshClient(credentials.password);
      let settled = false;

      const timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        client.end();
        reject(new Error(`SFTP stat 超时 (${credentials.host}:${credentials.port})：超过 ${timeoutMs}ms`));
      }, timeoutMs);

      client
        .on("ready", () => {
          client.sftp((error, sftp) => {
            if (error) {
              if (!settled) { settled = true; clearTimeout(timeout); client.end(); reject(error); }
              return;
            }

            sftp.stat(filePath, (statError, stats) => {
              settled = true;
              clearTimeout(timeout);
              client.end();

              if (statError) {
                reject(new Error(`SFTP stat 失败 (${filePath})：${statError.message}`));
                return;
              }

              resolve({
                size: stats.size,
                mtime: stats.mtime,
                readable: (stats.mode & 0o444) !== 0
              });
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

    return result.catch((error) => {
      throw new Error(humanizeSshError(error, credentials));
    });
  }

  async sftpReadRange(serverId: string, filePath: string, offset: number, length: number, timeoutMs = 60000): Promise<Buffer> {
    const server = this.serverRegistry.getServer(serverId);
    const credentials = this.credentialResolver.resolve(server);

    const result = new Promise<Buffer>((resolve, reject) => {
      const client = this.createSshClient(credentials.password);
      let settled = false;

      const timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        client.end();
        reject(new Error(`SFTP read 超时 (${credentials.host}:${credentials.port})：超过 ${timeoutMs}ms`));
      }, timeoutMs);

      client
        .on("ready", () => {
          client.sftp((error, sftp) => {
            if (error) {
              if (!settled) { settled = true; clearTimeout(timeout); client.end(); reject(error); }
              return;
            }

            sftp.open(filePath, "r", (openError, handle) => {
              if (openError) {
                if (!settled) { settled = true; clearTimeout(timeout); client.end(); reject(new Error(`SFTP open 失败 (${filePath})：${openError.message}`)); }
                return;
              }

              const buf = Buffer.alloc(length);
              sftp.read(handle, buf, 0, length, offset, (readError, bytesRead) => {
                sftp.close(handle, () => {});
                settled = true;
                clearTimeout(timeout);
                client.end();

                if (readError) {
                  reject(new Error(`SFTP read 失败 (${filePath})：${readError.message}`));
                  return;
                }

                resolve(buf.subarray(0, bytesRead));
              });
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

    return result.catch((error) => {
      throw new Error(humanizeSshError(error, credentials));
    });
  }

  async sftpOpenSession(serverId: string, timeoutMs = 300000): Promise<SftpSession> {
    const server = this.serverRegistry.getServer(serverId);
    const credentials = this.credentialResolver.resolve(server);

    const { client, sftp } = await new Promise<{ client: Client; sftp: SFTPWrapper }>((resolve, reject) => {
      const c = this.createSshClient(credentials.password);
      let settled = false;

      const timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        c.end();
        reject(new Error(`SFTP session 超时 (${credentials.host}:${credentials.port})`));
      }, 30000);

      c
        .on("ready", () => {
          c.sftp((error, s) => {
            clearTimeout(timeout);
            if (error) {
              if (!settled) { settled = true; c.end(); reject(error); }
              return;
            }
            settled = true;
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
          readyTimeout: 20000,
          keepaliveInterval: 10000,
          keepaliveCountMax: 60
        });
    });

    return {
      stat(filePath: string) {
        return new Promise((resolve, reject) => {
          sftp.stat(filePath, (err, stats) => {
            if (err) return reject(new Error(`SFTP stat 失败 (${filePath})：${err.message}`));
            resolve({ size: stats.size, mtime: stats.mtime, readable: (stats.mode & 0o444) !== 0 });
          });
        });
      },
      read(filePath: string, offset: number, length: number) {
        return new Promise((resolve, reject) => {
          sftp.open(filePath, "r", (openErr, handle) => {
            if (openErr) return reject(new Error(`SFTP open 失败 (${filePath})：${openErr.message}`));
            const buf = Buffer.alloc(length);
            sftp.read(handle, buf, 0, length, offset, (readErr, bytesRead) => {
              sftp.close(handle, () => {});
              if (readErr) return reject(new Error(`SFTP read 失败 (${filePath})：${readErr.message}`));
              resolve(buf.subarray(0, bytesRead));
            });
          });
        });
      },
      write(filePath: string, data: Buffer) {
        return new Promise<void>((resolve, reject) => {
          sftp.open(filePath, "w", (openErr, handle) => {
            if (openErr) return reject(new Error(`SFTP open(write) 失败 (${filePath})：${openErr.message}`));
            sftp.write(handle, data, 0, data.length, 0, (writeErr) => {
              sftp.close(handle, () => {});
              if (writeErr) return reject(new Error(`SFTP write 失败 (${filePath})：${writeErr.message}`));
              resolve();
            });
          });
        });
      },
      unlink(filePath: string) {
        return new Promise<void>((resolve, reject) => {
          sftp.unlink(filePath, (err) => {
            if (err) return reject(new Error(`SFTP unlink 失败 (${filePath})：${err.message}`));
            resolve();
          });
        });
      },
      rename(oldPath: string, newPath: string) {
        return new Promise<void>((resolve, reject) => {
          sftp.rename(oldPath, newPath, (err) => {
            if (err) return reject(new Error(`SFTP rename 失败 (${oldPath} → ${newPath})：${err.message}`));
            resolve();
          });
        });
      },
      close() {
        try { client.end(); } catch {}
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

  async connectTerminal(serverId: string, bastionId: string | undefined, timeoutMs = 30000): Promise<ManagedSshConnection> {
    const currentServer = this.serverRegistry.getServer(serverId);
    if (this.isJumpServerBastion(currentServer)) {
      return this.connectJumpServerTerminal(serverId, bastionId, timeoutMs);
    }

    let connection: ManagedSshConnection;

    if (bastionId) {
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
      connection.client.shell({ term: "xterm", cols: 160, rows: 48 }, (error, stream) => {
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
