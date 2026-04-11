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
    return this.sshExecutor.sftpStat(this.serverId, filePath);
  }

  async fileRead(filePath: string, offset: number, length: number): Promise<Buffer> {
    return this.sshExecutor.sftpReadRange(this.serverId, filePath, offset, length);
  }

  async listDirectory(directoryPath: string): Promise<LogFileEntry[]> {
    const sftpEntries = await this.sshExecutor.sftpListDirectory(this.serverId, directoryPath, 30000);
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
    const stat = await this.sshExecutor.sftpStat(this.serverId, filePath);
    return this.sshExecutor.sftpReadRange(this.serverId, filePath, 0, stat.size);
  }

  async uploadFile(filePath: string, content: Buffer): Promise<void> {
    const session = await this.sshExecutor.sftpOpenSession(this.serverId);
    try {
      await session.write(filePath, content);
    } finally {
      session.close();
    }
  }

  async deleteFile(filePath: string): Promise<void> {
    const session = await this.sshExecutor.sftpOpenSession(this.serverId);
    try {
      await session.unlink(filePath);
    } finally {
      session.close();
    }
  }

  async startUpload(filePath: string): Promise<UploadHandle> {
    const session = await this.sshExecutor.sftpOpenSession(this.serverId);
    const writeHandle = await session.openForWrite(filePath);
    let offset = 0;
    let aborted = false;

    return {
      write: async (data: Buffer) => {
        if (aborted) throw new Error("上传已中止");
        await writeHandle.writeChunk(data, offset);
        offset += data.length;
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
