import type { LogFileEntry } from "@server-log-console/shared";
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

  async openSession(): Promise<SftpSession> {
    return this.sshExecutor.sftpOpenSession(this.serverId);
  }

  async downloadFile(filePath: string): Promise<Buffer> {
    const stat = await this.sshExecutor.sftpStatViaReaddir(this.serverId, filePath);
    return this.sshExecutor.sftpReadRange(this.serverId, filePath, 0, stat.size);
  }

  async createReadStream(filePath: string): Promise<import("stream").Readable> {
    return this.sshExecutor.sftpCreateReadStream(this.serverId, filePath);
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

  async uploadLocalFile(filePath: string, localPath: string, onProgress?: (transferred: number, chunkBytes: number, totalBytes: number) => void): Promise<void> {
    const session = await this.sshExecutor.sftpOpenSession(this.serverId);
    try {
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
