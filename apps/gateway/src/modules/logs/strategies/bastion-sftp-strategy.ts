import type { FileTreeEntry, LogFileEntry } from "@server-log-console/shared";
import type { BastionSftpConnectionStrategy, FileStat, UploadHandle } from "./connection-strategy.js";
import type { SftpSession, SftpWriteHandle, SshExecutorService } from "../ssh-executor.service.js";

/**
 * 堡垒机 SFTP 策略 —— 通过 JumpServer 的 SFTP 通道完成文件操作。
 * 适用于无法直接执行 shell 命令的堡垒机环境。
 */
export class BastionSftpStrategy implements BastionSftpConnectionStrategy {
  readonly kind = "bastion-sftp" as const;

  constructor(
    private readonly serverId: string,
    private readonly sshExecutor: SshExecutorService
  ) {}

  async fileStat(filePath: string): Promise<FileStat> {
    // JumpServer SFTP 不支持 sftp.stat()，改用 readdir 父目录获取文件属性
    return this.sshExecutor.sftpStatViaReaddir(this.serverId, filePath);
  }

  async fileRead(filePath: string, offset: number, length: number): Promise<Buffer> {
    return this.sshExecutor.sftpReadRange(this.serverId, filePath, offset, length);
  }

  async statAndRead(filePath: string, offset: number, length: number): Promise<{ stat: FileStat; data: Buffer }> {
    return this.sshExecutor.sftpStatAndRead(this.serverId, filePath, offset, length);
  }

  async listDirectory(directoryPath: string): Promise<LogFileEntry[]> {
    const sftpEntries = await this.sshExecutor.sftpListDirectory(this.serverId, directoryPath);
    return sftpEntries.map((entry) => ({
      path: entry.path,
      name: entry.name,
      kind: entry.kind,
      size: entry.size,
      modifiedTime: entry.modifiedTime
    }));
  }

  /* 递归列目录（2026-11-24 批量下载）：堡垒机只有 SFTP 通道、没有 shell，
     只能逐层 readdir。这里走广度优先 + 单次深度保护：
     - 用 sftpListDirectory（readdir 的 attrs 自带 size），避免每项再 stat 一次往返；
     - 采集上限用 maxEntries 卡住，命中即停并标 truncated；
     - 软链接环由 visited 集合兜住（JumpServer 的文件树里出现环会无限展开）。 */
  async listDirectoryTree(
    directoryPath: string,
    opts?: { maxEntries?: number }
  ): Promise<{ entries: FileTreeEntry[]; truncated: boolean }> {
    const maxEntries = Math.max(1, Math.floor(opts?.maxEntries ?? 20000));
    const root = directoryPath.replace(/\/+$/, "") || "/";
    const entries: FileTreeEntry[] = [];
    const visited = new Set<string>([root]);
    let truncated = false;

    /* 队列元素带相对路径前缀，逐层展开 */
    let queue: Array<{ dirPath: string; relativePrefix: string }> = [{ dirPath: root, relativePrefix: "" }];
    while (queue.length > 0 && !truncated) {
      const next: Array<{ dirPath: string; relativePrefix: string }> = [];
      for (const current of queue) {
        let children: Awaited<ReturnType<typeof this.listDirectory>>;
        try {
          children = await this.listDirectory(current.dirPath);
        } catch {
          /* 单个子目录读不到（权限）不应让整棵树失败：跳过它继续 */
          continue;
        }
        for (const child of children) {
          if (entries.length >= maxEntries) {
            truncated = true;
            break;
          }
          /* 环上已访问过的目录连条目一起跳过：只拦住「再入队」的话，环本身仍会
             作为一条记录出现在结果里（同一路径出现两次，前端会重复下载同一目录）。 */
          if (child.kind === "directory" && visited.has(child.path)) {
            continue;
          }
          const relativePath = current.relativePrefix
            ? `${current.relativePrefix}/${child.name}`
            : child.name;
          entries.push({
            path: child.path,
            relativePath,
            kind: child.kind,
            size: child.kind === "file" ? child.size : undefined
          });
          if (child.kind === "directory" && !visited.has(child.path)) {
            visited.add(child.path);
            next.push({ dirPath: child.path, relativePrefix: relativePath });
          }
        }
        if (truncated) break;
      }
      queue = next;
    }

    return { entries, truncated };
  }

  async openSession(): Promise<SftpSession> {
    return this.sshExecutor.sftpOpenSession(this.serverId);
  }

  async downloadFile(filePath: string): Promise<Buffer> {
    const stat = await this.sshExecutor.sftpStatViaReaddir(this.serverId, filePath);
    return this.sshExecutor.sftpReadRange(this.serverId, filePath, 0, stat.size);
  }

  async createReadStream(filePath: string, opts?: { offset?: number; limitBytes?: number }): Promise<import("stream").Readable> {
    const offset = Math.max(0, Math.floor(opts?.offset ?? 0));
    return this.sshExecutor.sftpCreateReadStream(this.serverId, filePath, offset > 0 ? { start: offset } : undefined);
  }

  async uploadFile(filePath: string, content: Buffer): Promise<void> {
    const session = await this.sshExecutor.sftpOpenSession(this.serverId);
    try {
      const parentDir = filePath.substring(0, filePath.lastIndexOf("/")) || "/";
      await session.ensureDir(parentDir);
      await session.write(filePath, content);
    } finally {
      session.close();
    }
  }

  async uploadLocalFile(
    filePath: string,
    localPath: string,
    onProgress?: (transferred: number, chunkBytes: number, totalBytes: number) => void,
    hooks?: { onCancel?: (fn: () => void) => void }
  ): Promise<void> {
    const session = await this.sshExecutor.sftpOpenSession(this.serverId);
    try {
      hooks?.onCancel?.(() => session.destroy());
      const parentDir = filePath.substring(0, filePath.lastIndexOf("/")) || "/";
      await session.ensureDir(parentDir);
      await session.fastPut(localPath, filePath, onProgress);
    } finally {
      session.close();
    }
  }

  private async deleteDirectoryRecursive(session: SftpSession, directoryPath: string): Promise<void> {
    const entries = await session.listDirectory(directoryPath);
    for (const entry of entries) {
      if (entry.kind === "directory") {
        await this.deleteDirectoryRecursive(session, entry.path);
      } else {
        await session.unlink(entry.path);
      }
    }
    await session.rmdir(directoryPath);
  }

  async deleteFile(filePath: string): Promise<void> {
    if (filePath === "/") {
      throw new Error("禁止删除根目录。");
    }
    const stat = await this.sshExecutor.sftpStatViaReaddir(this.serverId, filePath);
    const session = await this.sshExecutor.sftpOpenSession(this.serverId);
    try {
      if (stat.kind === "directory") {
        await this.deleteDirectoryRecursive(session, filePath);
      } else {
        await session.unlink(filePath);
      }
    } finally {
      session.close();
    }
  }

  async startUpload(filePath: string): Promise<UploadHandle> {
    const MAX_WRITE_RETRIES = 2;
    let session = await this.sshExecutor.sftpOpenSession(this.serverId);
    const parentDir = filePath.substring(0, filePath.lastIndexOf("/")) || "/";
    await session.ensureDir(parentDir);
    let writeHandle = await session.openForWrite(filePath);
    let offset = 0;
    let aborted = false;

    return {
      write: async (data: Buffer) => {
        if (aborted) throw new Error("上传已中止");
        for (let attempt = 0; attempt <= MAX_WRITE_RETRIES; attempt++) {
          try {
            await writeHandle.writeChunk(data, offset);
            offset += data.length;
            return;
          } catch (error) {
            if (attempt >= MAX_WRITE_RETRIES) {
              throw error;
            }
            // JumpServer SFTP 长时间写入时偶发断开，重开会话并从当前 offset 重试本块。
            await writeHandle.close().catch(() => {});
            session.close();
            session = await this.sshExecutor.sftpOpenSession(this.serverId);
            writeHandle = await session.openForAppend(filePath);
          }
        }
      },
      finish: async () => {
        await writeHandle.close();
        session.close();
      },
      abort: () => {
        aborted = true;
        writeHandle.close().catch(() => {});
        session.close();
      }
    };
  }

  async renameFile(oldPath: string, newPath: string): Promise<void> {
    const session = await this.sshExecutor.sftpOpenSession(this.serverId);
    try {
      await session.rename(oldPath, newPath);
    } finally {
      session.close();
    }
  }

  dispose(): void {
    // 堡垒机策略不持有长连接，无需清理
  }
}
