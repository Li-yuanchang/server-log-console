import { randomUUID } from "crypto";
import { Readable } from "stream";
import { z } from "zod";
import type { StrategyResolver } from "./strategies/index.js";
import type { UploadHandle } from "./strategies/connection-strategy.js";
import { isBastionSftpStrategy, isDirectStrategy } from "./strategies/connection-strategy.js";
import { shellEscape } from "./remote-shell.js";

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

    const maxBufferSize = 500 * 1024 * 1024;
    if (stat.size > maxBufferSize) {
      throw new Error(`文件过大（${formatBytes(stat.size)}），Buffer 下载上限 ${formatBytes(maxBufferSize)}`);
    }

    const buffer = await strategy.downloadFile(request.filePath);
    const fileName = request.filePath.split("/").pop() || "download";

    return { buffer, fileName, filePath: request.filePath };
  }

  /**
   * Streaming download — pipes the file directly to the response without loading into memory.
   * Bastion SFTP: SFTP createReadStream (no size limit).
   * Direct SSH: exec `cat file` and stream stdout (no size limit).
   */
  async prepareStreamDownload(rawRequest: unknown): Promise<{
    stream: Readable; fileName: string; filePath: string; size: number;
    cleanup?: () => void;
  }> {
    const request = downloadSchema.parse(rawRequest);
    const strategy = this.strategyResolver.resolve(request.serverId);
    const stat = await strategy.fileStat(request.filePath);
    const fileName = request.filePath.split("/").pop() || "download";

    if (isBastionSftpStrategy(strategy)) {
      const stream = await strategy.createReadStream(request.filePath);
      return { stream, fileName, filePath: request.filePath, size: stat.size };
    }

    if (isDirectStrategy(strategy)) {
      const { stream, cleanup } = await strategy.createReadStream(request.filePath, stat.size);
      return { stream, fileName, filePath: request.filePath, size: stat.size, cleanup };
    }

    // Fallback: buffer download
    const buffer = await strategy.downloadFile(request.filePath);
    return { stream: Readable.from(buffer), fileName, filePath: request.filePath, size: buffer.length };
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

  async mkdir(rawRequest: unknown): Promise<{ directoryPath: string }> {
    const schema = z.object({ serverId: z.string(), directoryPath: z.string() });
    const request = schema.parse(rawRequest);
    const strategy = this.strategyResolver.resolve(request.serverId);
    if (isDirectStrategy(strategy)) {
      const dirArg = shellEscape(request.directoryPath);
      await strategy.exec(`mkdir -p ${dirArg}`, 30000);
    } else if (isBastionSftpStrategy(strategy)) {
      const session = await strategy.openSession();
      try {
        await session.ensureDir(request.directoryPath);
      } finally {
        session.close();
      }
    } else {
      throw new Error("当前连接策略不支持创建目录");
    }
    return { directoryPath: request.directoryPath };
  }

  async compress(rawRequest: unknown): Promise<{ archivePath: string; output: string }> {
    const schema = z.object({
      serverId: z.string(),
      sourcePath: z.string(),
      archiveType: z.enum(["tar.gz", "zip"]).optional(),
      targetDir: z.string().optional()
    });
    const request = schema.parse(rawRequest);
    const strategy = this.strategyResolver.resolve(request.serverId);
    if (!isDirectStrategy(strategy)) {
      throw new Error("堡垒机连接暂不支持压缩操作，请使用直连服务器");
    }
    const archiveType = request.archiveType || "tar.gz";
    const sourceArg = shellEscape(request.sourcePath);
    const targetDir = request.targetDir || request.sourcePath.substring(0, request.sourcePath.lastIndexOf("/")) || "/";
    const dirArg = shellEscape(targetDir);
    const baseName = request.sourcePath.split("/").pop() || "archive";
    let archivePath: string;
    let compressCmd: string;
    if (archiveType === "zip") {
      archivePath = `${targetDir}/${baseName}.zip`;
      const archiveArg = shellEscape(archivePath);
      compressCmd = `cd ${dirArg} && zip -r ${archiveArg} ${sourceArg}`;
    } else {
      archivePath = `${targetDir}/${baseName}.tar.gz`;
      const archiveArg = shellEscape(archivePath);
      compressCmd = `tar -czf ${archiveArg} -C ${dirArg} ${sourceArg}`;
    }
    const output = await strategy.exec(
      `${compressCmd} 2>&1 || echo '[compress-exit-code]'$?`,
      300000
    );
    if (output.includes("[compress-exit-code]") && !output.includes("[compress-exit-code]0")) {
      throw new Error(`压缩失败：${output.split("\n").slice(-3).join("\n")}`);
    }
    return { archivePath, output };
  }

  async extractZip(rawRequest: unknown): Promise<{ filePath: string; targetDir: string; output: string }> {
    const schema = z.object({ serverId: z.string(), filePath: z.string(), targetDir: z.string().optional() });
    const request = schema.parse(rawRequest);
    const strategy = this.strategyResolver.resolve(request.serverId);
    if (!isDirectStrategy(strategy)) {
      throw new Error("堡垒机连接暂不支持解压操作，请使用直连服务器");
    }
    const targetDir = request.targetDir || request.filePath.substring(0, request.filePath.lastIndexOf("/")) || "/";
    const fileArg = shellEscape(request.filePath);
    const dirArg = shellEscape(targetDir);
    const lowerPath = request.filePath.toLowerCase();
    let extractCmd: string;
    if (lowerPath.endsWith(".tar.gz") || lowerPath.endsWith(".tgz")) {
      extractCmd = `tar -xzf ${fileArg} -C ${dirArg}`;
    } else if (lowerPath.endsWith(".tar.bz2")) {
      extractCmd = `tar -xjf ${fileArg} -C ${dirArg}`;
    } else if (lowerPath.endsWith(".tar.xz")) {
      extractCmd = `tar -xJf ${fileArg} -C ${dirArg}`;
    } else if (lowerPath.endsWith(".gz")) {
      const sourceName = request.filePath.split("/").pop() || "archive.gz";
      const outputName = sourceName.replace(/\.gz$/i, "") || `${sourceName}.out`;
      const outputPath = `${targetDir}/${outputName}`;
      const outputArg = shellEscape(outputPath);
      extractCmd = `gzip -dc ${fileArg} > ${outputArg}`;
    } else {
      extractCmd = `cd ${dirArg} && unzip -o ${fileArg}`;
    }
    const output = await strategy.exec(
      `${extractCmd} 2>&1 || echo '[extract-exit-code]'$?`,
      120000
    );
    if (output.includes("[extract-exit-code]") && !output.includes("[extract-exit-code]0")) {
      throw new Error(`解压失败：${output.split("\n").slice(-3).join("\n")}`);
    }
    return { filePath: request.filePath, targetDir, output };
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
