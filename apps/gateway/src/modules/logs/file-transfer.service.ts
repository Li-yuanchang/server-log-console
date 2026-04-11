import { z } from "zod";
import type { StrategyResolver } from "./strategies/index.js";

const downloadSchema = z.object({
  serverId: z.string(),
  filePath: z.string()
});

const uploadSchema = z.object({
  serverId: z.string(),
  filePath: z.string()
});

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

    const maxUploadSize = 100 * 1024 * 1024;
    if (content.length > maxUploadSize) {
      throw new Error(`文件过大（${formatBytes(content.length)}），上传上限 ${formatBytes(maxUploadSize)}`);
    }

    await strategy.uploadFile(filePath, content);
    return { filePath, size: content.length };
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
