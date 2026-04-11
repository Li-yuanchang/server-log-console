import { randomUUID } from "crypto";
import { z } from "zod";
import type { StrategyResolver } from "./strategies/index.js";
import type { UploadHandle } from "./strategies/connection-strategy.js";

const downloadSchema = z.object({
  serverId: z.string(),
  filePath: z.string()
});

const uploadSchema = z.object({
  serverId: z.string(),
  filePath: z.string()
});

interface UploadSession {
  handle: UploadHandle;
  filePath: string;
  bytesWritten: number;
  timeout: ReturnType<typeof setTimeout>;
}

const renameSchema = z.object({
  serverId: z.string(),
  oldPath: z.string(),
  newPath: z.string()
});

const saveSchema = z.object({
  serverId: z.string(),
  filePath: z.string(),
  content: z.string()
});

export class FileTransferService {
  constructor(
    private readonly strategyResolver: StrategyResolver
  ) {}

  async download(rawRequest: unknown): Promise<{ buffer: Buffer; fileName: string; filePath: string }> {
    const request = downloadSchema.parse(rawRequest);
    const strategy = this.strategyResolver.resolve(request.serverId);
    const stat = await strategy.fileStat(request.filePath);

    const maxDownloadSize = 200 * 1024 * 1024;
    if (stat.size > maxDownloadSize) {
      throw new Error(`文件过大（${formatBytes(stat.size)}），下载上限 ${formatBytes(maxDownloadSize)}`);
    }

    const buffer = await strategy.downloadFile(request.filePath);
    const fileName = request.filePath.split("/").pop() || "download";

    return { buffer, fileName, filePath: request.filePath };
  }

  async delete(rawRequest: unknown): Promise<{ filePath: string }> {
    const request = downloadSchema.parse(rawRequest);
    const strategy = this.strategyResolver.resolve(request.serverId);
    await strategy.deleteFile(request.filePath);
    return { filePath: request.filePath };
  }

  async rename(rawRequest: unknown): Promise<{ oldPath: string; newPath: string }> {
    const request = renameSchema.parse(rawRequest);
    const strategy = this.strategyResolver.resolve(request.serverId);
    await strategy.renameFile(request.oldPath, request.newPath);
    return { oldPath: request.oldPath, newPath: request.newPath };
  }

  async preview(rawRequest: unknown): Promise<{
    filePath: string; content: string; size: number;
    readOnly?: boolean; truncatedFrom?: number;
  }> {
    const request = downloadSchema.parse(rawRequest);
    const strategy = this.strategyResolver.resolve(request.serverId);
    const stat = await strategy.fileStat(request.filePath);

    const maxEditSize = 10 * 1024 * 1024;

    if (stat.size <= maxEditSize) {
      const buffer = await strategy.downloadFile(request.filePath);
      const content = buffer.toString("utf-8");
      return { filePath: request.filePath, content, size: stat.size };
    }

    // 大文件：只读尾部预览，取最后 1MB
    const tailSize = 1 * 1024 * 1024;
    const offset = Math.max(0, stat.size - tailSize);
    const buffer = await strategy.fileRead(request.filePath, offset, tailSize);
    let raw = buffer.toString("utf-8");

    // 丢弃第一行（可能不完整）
    if (offset > 0) {
      const firstNewline = raw.indexOf("\n");
      if (firstNewline !== -1) {
        raw = raw.substring(firstNewline + 1);
      }
    }

    return {
      filePath: request.filePath,
      content: raw,
      size: stat.size,
      readOnly: true,
      truncatedFrom: offset
    };
  }

  async save(rawRequest: unknown): Promise<{ filePath: string; size: number }> {
    const request = saveSchema.parse(rawRequest);
    const strategy = this.strategyResolver.resolve(request.serverId);
    const buffer = Buffer.from(request.content, "utf-8");
    await strategy.uploadFile(request.filePath, buffer);
    return { filePath: request.filePath, size: buffer.length };
  }

  async upload(serverId: string, filePath: string, content: Buffer): Promise<{ filePath: string; size: number }> {
    uploadSchema.parse({ serverId, filePath });
    const strategy = this.strategyResolver.resolve(serverId);
    await strategy.uploadFile(filePath, content);
    return { filePath, size: content.length };
  }

  /* ── 分片上传 ── */

  private uploadSessions = new Map<string, UploadSession>();
  private static SESSION_TIMEOUT = 10 * 60 * 1000;

  async startChunkedUpload(serverId: string, filePath: string): Promise<{ uploadId: string }> {
    uploadSchema.parse({ serverId, filePath });
    const strategy = this.strategyResolver.resolve(serverId);
    const handle = await strategy.startUpload(filePath);
    const uploadId = randomUUID();

    const timeout = setTimeout(() => this.cleanupSession(uploadId), FileTransferService.SESSION_TIMEOUT);
    this.uploadSessions.set(uploadId, { handle, filePath, bytesWritten: 0, timeout });

    console.log(`[upload] session started: ${uploadId} → ${filePath}`);
    return { uploadId };
  }

  async writeChunk(uploadId: string, chunk: Buffer): Promise<{ bytesWritten: number }> {
    const session = this.uploadSessions.get(uploadId);
    if (!session) throw new Error("上传会话不存在或已过期");

    clearTimeout(session.timeout);
    session.timeout = setTimeout(() => this.cleanupSession(uploadId), FileTransferService.SESSION_TIMEOUT);

    await session.handle.write(chunk);
    session.bytesWritten += chunk.length;
    return { bytesWritten: session.bytesWritten };
  }

  async finishUpload(uploadId: string): Promise<{ filePath: string; size: number }> {
    const session = this.uploadSessions.get(uploadId);
    if (!session) throw new Error("上传会话不存在或已过期");

    clearTimeout(session.timeout);
    await session.handle.finish();
    this.uploadSessions.delete(uploadId);

    console.log(`[upload] session finished: ${uploadId} size=${formatBytes(session.bytesWritten)}`);
    return { filePath: session.filePath, size: session.bytesWritten };
  }

  abortUpload(uploadId: string): void {
    this.cleanupSession(uploadId);
  }

  private cleanupSession(uploadId: string) {
    const session = this.uploadSessions.get(uploadId);
    if (!session) return;
    clearTimeout(session.timeout);
    try { session.handle.abort(); } catch {}
    this.uploadSessions.delete(uploadId);
    console.log(`[upload] session cleaned up: ${uploadId}`);
  }
}

function formatBytes(size: number) {
  if (!Number.isFinite(size) || size <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let value = size;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) { value /= 1024; i++; }
  return `${value.toFixed(value >= 100 || i === 0 ? 0 : 1)} ${units[i]}`;
}
