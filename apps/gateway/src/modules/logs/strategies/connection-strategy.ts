import type { LogFileEntry } from "@server-log-console/shared";
import type { SftpSession } from "../ssh-executor.service.js";

export interface FileStat {
  size: number;
  mtime: number;
  readable: boolean;
}

export interface StreamingExecHandle {
  onStdout(handler: (chunk: string) => void): void;
  onStderr(handler: (chunk: string) => void): void;
  onClose(handler: (code: number | undefined) => void): void;
  cleanup(): void;
}

export interface UploadHandle {
  /** 写入一块数据（按顺序调用，内部自动追踪 offset） */
  write(data: Buffer): Promise<void>;
  /** 完成上传，释放资源 */
  finish(): Promise<void>;
  /** 中止上传，释放资源 */
  abort(): void;
}

/**
 * 连接策略接口 —— 统一直连 / 堡垒机 SFTP 两种通道的文件操作。
 *
 * 每个策略必须实现基础的 fileStat / fileRead / listDirectory。
 * 搜索、流式命令等高级操作通过 kind 区分后由对应方法提供。
 */
export interface ConnectionStrategy {
  /** 策略类型标识 */
  readonly kind: "direct" | "bastion-sftp";

  /** 获取文件元信息 */
  fileStat(filePath: string): Promise<FileStat>;

  /** 读取文件指定范围的原始字节 */
  fileRead(filePath: string, offset: number, length: number): Promise<Buffer>;

  /** 列出目录内容 */
  listDirectory(directoryPath: string): Promise<LogFileEntry[]>;

  /** 下载完整文件到 Buffer */
  downloadFile(filePath: string): Promise<Buffer>;

  /** 上传 Buffer 到远程文件 */
  uploadFile(filePath: string, content: Buffer): Promise<void>;

  /** 开始分片上传，返回可复用的写入句柄 */
  startUpload(filePath: string): Promise<UploadHandle>;

  /** 删除远程文件 */
  deleteFile(filePath: string): Promise<void>;

  /** 重命名远程文件/目录 */
  renameFile(oldPath: string, newPath: string): Promise<void>;

  /** 释放底层连接资源 */
  dispose(): void;
}

/**
 * 直连策略扩展 —— 额外提供 exec 和流式命令执行能力。
 */
export interface DirectConnectionStrategy extends ConnectionStrategy {
  readonly kind: "direct";

  /** 执行远程 shell 命令，返回 stdout */
  exec(command: string, timeoutMs?: number): Promise<string>;

  /** 建立流式命令执行（用于 streaming search） */
  execStreaming(command: string, timeoutMs?: number): Promise<StreamingExecHandle>;

  /** 创建 SSH exec stdout 可读流，用于流式下载大文件 */
  createReadStream(filePath: string, limitBytes?: number): Promise<{ stream: import("stream").Readable; cleanup: () => void }>;
}

/**
 * 堡垒机 SFTP 策略扩展 —— 额外提供可复用 SFTP 会话。
 */
export interface BastionSftpConnectionStrategy extends ConnectionStrategy {
  readonly kind: "bastion-sftp";

  /** 打开可复用 SFTP 会话（用于批量读取如搜索） */
  openSession(): Promise<SftpSession>;

  /** 单次连接内完成 stat + read（避免堡垒机 2 次 SSH 延迟） */
  statAndRead(filePath: string, offset: number, length: number): Promise<{ stat: FileStat; data: Buffer }>;

  /** 创建 SFTP 可读流，用于流式下载大文件 */
  createReadStream(filePath: string): Promise<import("stream").Readable>;
}

/** 类型守卫 */
export function isDirectStrategy(s: ConnectionStrategy): s is DirectConnectionStrategy {
  return s.kind === "direct";
}

export function isBastionSftpStrategy(s: ConnectionStrategy): s is BastionSftpConnectionStrategy {
  return s.kind === "bastion-sftp";
}
