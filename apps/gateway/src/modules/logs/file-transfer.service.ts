import { randomUUID } from "crypto";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "stream";
import { promisify } from "node:util";
import { inflateRawSync } from "node:zlib";
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

const localUploadSchema = uploadSchema.extend({
  localPath: z.string().min(1)
});

const archiveEntryPreviewSchema = downloadSchema.extend({
  entryName: z.string().min(1)
});

const execFileAsync = promisify(execFile);

interface UploadSession {
  handle: UploadHandle;
  filePath: string;
  bytesWritten: number;
  timeout: ReturnType<typeof setTimeout>;
}

type ArchivePreviewEntry = {
  name: string;
  compressedSize: number;
  uncompressedSize: number;
  directory: boolean;
  modifiedAt: string;
  compressionMethod: number;
  localHeaderOffset: number;
};

type ArchivePreviewInfo = {
  entryCount: number;
  displayedCount: number;
  truncated: boolean;
  centralDirectorySize: number;
  commentLength: number;
};

type ClassMemberPreview = {
  access: string;
  name: string;
  descriptor: string;
  display: string;
};

type ClassPreviewInfo = {
  magic: string;
  version: string;
  javaVersion: string;
  accessFlags: string;
  className: string;
  superClass: string;
  interfaces: string[];
  constantPoolCount: number;
  fields: ClassMemberPreview[];
  methods: ClassMemberPreview[];
  decompiledSource?: string;
  decompileStatus?: "success" | "fallback";
  decompileMessage?: string;
};

type ArchiveEntryPreview = {
  filePath: string;
  entryName: string;
  fileName: string;
  content: string;
  size: number;
  readOnly: true;
  previewKind: "text" | "class" | "binary";
  previewLabel: string;
  classInfo?: ClassPreviewInfo;
};

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
    previewKind?: "text" | "archive" | "class";
    previewLabel?: string;
    archiveEntries?: ArchivePreviewEntry[];
    archiveInfo?: ArchivePreviewInfo;
    classInfo?: ClassPreviewInfo;
  }> {
    const request = downloadSchema.parse(rawRequest);
    const strategy = this.strategyResolver.resolve(request.serverId);
    const stat = await strategy.fileStat(request.filePath);
    const lowerPath = request.filePath.toLowerCase();

    if (isZipLikePath(lowerPath)) {
      const archivePreview = await previewZipDirectory(request.filePath, stat.size, (offset, length) => strategy.fileRead(request.filePath, offset, length));
      return {
        filePath: request.filePath,
        content: archivePreview.content,
        size: stat.size,
        readOnly: true,
        previewKind: "archive",
        previewLabel: "ZIP 目录预览",
        archiveEntries: archivePreview.entries,
        archiveInfo: archivePreview.info
      };
    }

    if (lowerPath.endsWith(".class")) {
      const maxClassPreviewSize = 10 * 1024 * 1024;
      if (stat.size > maxClassPreviewSize) {
        throw new Error(`Class 文件过大（${formatBytes(stat.size)}），结构预览上限 ${formatBytes(maxClassPreviewSize)}`);
      }
      const buffer = await strategy.downloadFile(request.filePath);
      const classPreview = await previewJavaClass(request.filePath, buffer);
      return {
        filePath: request.filePath,
        content: classPreview.content,
        size: stat.size,
        readOnly: true,
        previewKind: "class",
        previewLabel: "Class 结构预览",
        classInfo: classPreview.info
      };
    }

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
      previewKind: "text",
      previewLabel: "尾部预览",
      truncatedFrom: offset
    };
  }

  async previewArchiveEntry(rawRequest: unknown): Promise<ArchiveEntryPreview> {
    const request = archiveEntryPreviewSchema.parse(rawRequest);
    const strategy = this.strategyResolver.resolve(request.serverId);
    const stat = await strategy.fileStat(request.filePath);
    if (!isZipLikePath(request.filePath.toLowerCase())) {
      throw new Error("当前文件不是可预览的 ZIP/JAR/WAR/EAR 归档");
    }

    const maxPreviewSize = 5 * 1024 * 1024;
    const archivePreview = await previewZipDirectory(request.filePath, stat.size, (offset, length) => strategy.fileRead(request.filePath, offset, length));
    const entry = archivePreview.entries.find((item) => item.name === request.entryName);
    if (!entry) {
      throw new Error(`归档内未找到条目：${request.entryName}`);
    }
    if (entry.directory) {
      throw new Error("目录条目不能直接预览，请选择目录内文件");
    }
    if (entry.uncompressedSize > maxPreviewSize) {
      throw new Error(`归档条目过大（${formatBytes(entry.uncompressedSize)}），预览上限 ${formatBytes(maxPreviewSize)}`);
    }

    const buffer = await readZipEntryBuffer(request.filePath, entry, (offset, length) => strategy.fileRead(request.filePath, offset, length));
    const entryFileName = entry.name.split("/").pop() || entry.name;
    if (entry.name.toLowerCase().endsWith(".class")) {
      const classPreview = await previewJavaClass(`${request.filePath}!/${entry.name}`, buffer);
      return {
        filePath: request.filePath,
        entryName: entry.name,
        fileName: entryFileName,
        content: classPreview.info.decompiledSource || classPreview.content,
        size: entry.uncompressedSize,
        readOnly: true,
        previewKind: "class",
        previewLabel: classPreview.info.decompileStatus === "success" ? "Class 反编译预览" : "Class 结构预览",
        classInfo: classPreview.info
      };
    }

    if (!isProbablyText(entry.name, buffer)) {
      return {
        filePath: request.filePath,
        entryName: entry.name,
        fileName: entryFileName,
        content: `当前条目像是二进制文件，暂不直接展示内容。\n\n路径: ${entry.name}\n大小: ${formatBytes(entry.uncompressedSize)}\n压缩方法: ${entry.compressionMethod}`,
        size: entry.uncompressedSize,
        readOnly: true,
        previewKind: "binary",
        previewLabel: "二进制条目"
      };
    }

    return {
      filePath: request.filePath,
      entryName: entry.name,
      fileName: entryFileName,
      content: buffer.toString("utf8"),
      size: entry.uncompressedSize,
      readOnly: true,
      previewKind: "text",
      previewLabel: "归档内文件预览"
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

  async uploadLocal(
    serverId: string,
    filePath: string,
    localPath: string,
    onProgress?: (transferred: number, chunkBytes: number, totalBytes: number) => void
  ): Promise<{ filePath: string; size: number }> {
    localUploadSchema.parse({ serverId, filePath, localPath });
    const strategy = this.strategyResolver.resolve(serverId);
    const fileStat = await stat(localPath);
    if (!fileStat.isFile()) {
      throw new Error("本地路径不是文件");
    }
    await strategy.uploadLocalFile(filePath, localPath, (transferred, chunkBytes, totalBytes) => {
      onProgress?.(transferred, chunkBytes, totalBytes || fileStat.size);
    });
    return { filePath, size: fileStat.size };
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

function isZipLikePath(lowerPath: string): boolean {
  return lowerPath.endsWith(".zip") || lowerPath.endsWith(".jar") || lowerPath.endsWith(".war") || lowerPath.endsWith(".ear");
}

async function previewZipDirectory(
  filePath: string,
  fileSize: number,
  readRange: (offset: number, length: number) => Promise<Buffer>
): Promise<{ content: string; entries: ArchivePreviewEntry[]; info: ArchivePreviewInfo }> {
  const maxTailSize = Math.min(fileSize, 66 * 1024);
  const tailOffset = Math.max(0, fileSize - maxTailSize);
  const tail = await readRange(tailOffset, maxTailSize);
  const eocdOffsetInTail = findLastSignature(tail, 0x06054b50);
  if (eocdOffsetInTail < 0) {
    throw new Error("未找到 ZIP 中央目录，可能不是有效 zip/jar/war 文件");
  }

  const entryCount = tail.readUInt16LE(eocdOffsetInTail + 10);
  const centralDirSize = tail.readUInt32LE(eocdOffsetInTail + 12);
  const centralDirOffset = tail.readUInt32LE(eocdOffsetInTail + 16);
  const commentLength = tail.readUInt16LE(eocdOffsetInTail + 20);
  const maxPreviewEntries = 50000;
  const maxCentralDirPreviewSize = 8 * 1024 * 1024;

  if (centralDirSize > maxCentralDirPreviewSize) {
    return {
      content: [
        `# ${filePath}`,
        "",
        "类型: ZIP/JAR 归档",
        `大小: ${formatBytes(fileSize)}`,
        `条目: ${entryCount}`,
        `中央目录: ${formatBytes(centralDirSize)}`,
        "",
        `中央目录过大，当前只读预览上限 ${formatBytes(maxCentralDirPreviewSize)}。`,
        "文件未解压，远程目录未被修改。"
      ].join("\n"),
      entries: [],
      info: {
        entryCount,
        displayedCount: 0,
        truncated: true,
        centralDirectorySize: centralDirSize,
        commentLength
      }
    };
  }

  const central = await readRange(centralDirOffset, centralDirSize);
  const entries: ArchivePreviewEntry[] = [];
  let offset = 0;
  while (offset + 46 <= central.length && entries.length < maxPreviewEntries) {
    if (central.readUInt32LE(offset) !== 0x02014b50) break;
    const modifiedTime = central.readUInt16LE(offset + 12);
    const modifiedDate = central.readUInt16LE(offset + 14);
    const compressedSize = central.readUInt32LE(offset + 20);
    const uncompressedSize = central.readUInt32LE(offset + 24);
    const nameLength = central.readUInt16LE(offset + 28);
    const extraLength = central.readUInt16LE(offset + 30);
    const fileCommentLength = central.readUInt16LE(offset + 32);
    const localHeaderOffset = central.readUInt32LE(offset + 42);
    const compressionMethod = central.readUInt16LE(offset + 10);
    const nameStart = offset + 46;
    const nameEnd = nameStart + nameLength;
    if (nameEnd > central.length) break;
    const name = central.subarray(nameStart, nameEnd).toString("utf8");
    entries.push({
      name,
      compressedSize,
      uncompressedSize,
      directory: name.endsWith("/"),
      modifiedAt: formatZipDateTime(modifiedDate, modifiedTime),
      compressionMethod,
      localHeaderOffset
    });
    offset = nameEnd + extraLength + fileCommentLength;
  }

  const lines = [
    `# ${filePath}`,
    "",
    "类型: ZIP/JAR 归档目录预览",
    `大小: ${formatBytes(fileSize)}`,
    `条目: ${entryCount}${entryCount > maxPreviewEntries ? `（仅索引前 ${maxPreviewEntries} 项）` : ""}`,
    `中央目录: ${formatBytes(centralDirSize)}`,
    commentLength ? `注释长度: ${commentLength} B` : "注释长度: 0 B",
    "",
    "说明: 当前只读取归档目录索引，不执行解压，不修改远程目录。",
    "前端以文件管理器形式按目录浏览，不再展开全部路径。"
  ];

  return {
    content: lines.join("\n"),
    entries,
    info: {
      entryCount,
      displayedCount: entries.length,
      truncated: entryCount > entries.length,
      centralDirectorySize: centralDirSize,
      commentLength
    }
  };
}

async function readZipEntryBuffer(
  archivePath: string,
  entry: ArchivePreviewEntry,
  readRange: (offset: number, length: number) => Promise<Buffer>
): Promise<Buffer> {
  const localHeader = await readRange(entry.localHeaderOffset, 30);
  if (localHeader.length < 30 || localHeader.readUInt32LE(0) !== 0x04034b50) {
    throw new Error(`归档条目本地头无效：${entry.name}`);
  }
  const nameLength = localHeader.readUInt16LE(26);
  const extraLength = localHeader.readUInt16LE(28);
  const dataOffset = entry.localHeaderOffset + 30 + nameLength + extraLength;
  const compressed = await readRange(dataOffset, entry.compressedSize);
  if (entry.compressionMethod === 0) {
    return compressed;
  }
  if (entry.compressionMethod === 8) {
    return inflateRawSync(compressed);
  }
  throw new Error(`暂不支持该压缩方法：${entry.compressionMethod}（${archivePath}!/${entry.name}）`);
}

function isProbablyText(fileName: string, buffer: Buffer): boolean {
  const lower = fileName.toLowerCase();
  const textExtensions = [
    ".txt", ".log", ".md", ".json", ".xml", ".html", ".htm", ".css", ".js", ".jsx", ".ts", ".tsx",
    ".java", ".properties", ".yml", ".yaml", ".csv", ".sql", ".sh", ".bat", ".conf", ".ini", ".mf"
  ];
  if (textExtensions.some((ext) => lower.endsWith(ext))) {
    return true;
  }
  const sample = buffer.subarray(0, Math.min(buffer.length, 4096));
  if (sample.includes(0)) {
    return false;
  }
  let controlCount = 0;
  for (const byte of sample) {
    if (byte < 9 || (byte > 13 && byte < 32)) {
      controlCount += 1;
    }
  }
  return sample.length === 0 || controlCount / sample.length < 0.08;
}

function findLastSignature(buffer: Buffer, signature: number): number {
  for (let i = buffer.length - 4; i >= 0; i--) {
    if (buffer.readUInt32LE(i) === signature) return i;
  }
  return -1;
}

function formatZipDateTime(date: number, time: number): string {
  if (!date) return "-";
  const year = ((date >> 9) & 0x7f) + 1980;
  const month = (date >> 5) & 0x0f;
  const day = date & 0x1f;
  const hour = (time >> 11) & 0x1f;
  const minute = (time >> 5) & 0x3f;
  const second = (time & 0x1f) * 2;
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${year}-${pad(month)}-${pad(day)} ${pad(hour)}:${pad(minute)}:${pad(second)}`;
}

async function previewJavaClass(filePath: string, buffer: Buffer): Promise<{ content: string; info: ClassPreviewInfo }> {
  const reader = new ClassReader(buffer);
  const magic = reader.u4();
  if (magic !== 0xcafebabe) {
    throw new Error("不是有效的 Java .class 文件（缺少 CAFEBABE 文件头）");
  }

  const minor = reader.u2();
  const major = reader.u2();
  const constantPool = parseConstantPool(reader);
  const accessFlags = reader.u2();
  const thisClass = resolveClassName(constantPool, reader.u2());
  const superClassIndex = reader.u2();
  const superClass = superClassIndex ? resolveClassName(constantPool, superClassIndex) : "";
  const interfaceCount = reader.u2();
  const interfaces: string[] = [];
  for (let i = 0; i < interfaceCount; i++) {
    interfaces.push(resolveClassName(constantPool, reader.u2()));
  }
  const fields = parseMemberTable(reader, constantPool, "field");
  const methods = parseMemberTable(reader, constantPool, "method");
  skipAttributes(reader);

  const info: ClassPreviewInfo = {
    magic: "CAFEBABE",
    version: `${major}.${minor}`,
    javaVersion: javaVersionLabel(major),
    accessFlags: formatAccessFlags(accessFlags, "class"),
    className: thisClass || "-",
    superClass: superClass || "-",
    interfaces,
    constantPoolCount: constantPool.length - 1,
    fields,
    methods
  };

  const decompiled = await decompileJavaClass(filePath, buffer).catch((error) => ({
    source: "",
    message: error instanceof Error ? error.message : "反编译失败"
  }));
  if (decompiled.source.trim()) {
    info.decompiledSource = decompiled.source;
    info.decompileStatus = "success";
    info.decompileMessage = "CFR 反编译成功";
  } else {
    info.decompileStatus = "fallback";
    info.decompileMessage = decompiled.message;
  }

  const lines = [
    `# ${filePath}`,
    "",
    info.decompiledSource ? "类型: Java Class 反编译预览" : "类型: Java Class 结构预览",
    `文件头: ${info.magic}`,
    `Class 版本: ${info.version} (${info.javaVersion})`,
    `访问标志: ${info.accessFlags}`,
    `类名: ${info.className}`,
    `父类: ${info.superClass}`,
    interfaces.length ? `接口: ${interfaces.join(", ")}` : "接口: -",
    `常量池: ${info.constantPoolCount} 项`,
    "",
    `字段 (${fields.length})`
  ];

  lines.push(...(fields.length ? fields.map((field) => `  ${field.display}`) : ["  -"]));
  lines.push("", `方法 (${methods.length})`);
  lines.push(...(methods.length ? methods.map((method) => `  ${method.display}`) : ["  -"]));
  lines.push("", `说明: ${info.decompileMessage || "当前为 class 元数据结构预览，不反编译方法源码。"}`);
  return { content: info.decompiledSource || lines.join("\n"), info };
}

async function decompileJavaClass(filePath: string, buffer: Buffer): Promise<{ source: string; message: string }> {
  const cfrResolve = resolveCfrJarPath();
  const cfrJar = cfrResolve.path;
  if (!cfrJar) {
    return { source: "", message: `未找到 CFR 反编译器，已回退 class 元数据预览。查找路径：${cfrResolve.candidates.join(" | ")}` };
  }

  const tempDir = path.join(tmpdir(), `slc-class-${randomUUID()}`);
  await mkdir(tempDir, { recursive: true });
  const simpleName = sanitizeFileName(filePath.split(/[\\/!]/).pop() || "Preview.class").replace(/\.class$/i, "") || "Preview";
  const classPath = path.join(tempDir, `${simpleName}.class`);
  try {
    await writeFile(classPath, buffer);
    const { stdout, stderr } = await execFileAsync("java", ["-jar", cfrJar, classPath, "--silent", "true"], {
      timeout: 20000,
      maxBuffer: 10 * 1024 * 1024
    });
    const source = String(stdout || "").trim();
    if (!source) {
      return { source: "", message: String(stderr || "CFR 未输出源码，已回退 class 元数据预览").trim() };
    }
    return { source, message: "CFR 反编译成功" };
  } catch (error) {
    const message = error instanceof Error ? error.message : "CFR 反编译失败";
    return { source: "", message: `${message}，已回退 class 元数据预览` };
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

function resolveCfrJarPath(): { path: string | null; candidates: string[] } {
  const moduleDir = __dirnameFromImportMeta();
  const candidates = [
    path.resolve(process.cwd(), "resources", "decompilers", "cfr.jar"),
    path.resolve(process.cwd(), "apps", "gateway", "resources", "decompilers", "cfr.jar"),
    path.resolve(moduleDir, "..", "..", "resources", "decompilers", "cfr.jar"),
    path.resolve(moduleDir, "..", "..", "..", "resources", "decompilers", "cfr.jar")
  ];
  return { path: candidates.find((candidate) => existsSync(candidate)) || null, candidates };
}

function __dirnameFromImportMeta(): string {
  return path.dirname(new URL(import.meta.url).pathname);
}

function sanitizeFileName(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, "_");
}

type Utf8ConstantPoolEntry = { tag: 1; value: string };
type ClassConstantPoolEntry = { tag: 7; nameIndex: number };
type OtherConstantPoolEntry = { tag: 3 | 4 | 5 | 6 | 8 | 9 | 10 | 11 | 12 | 15 | 16 | 17 | 18 | 19 | 20 };
type ConstantPoolEntry = undefined | Utf8ConstantPoolEntry | ClassConstantPoolEntry | OtherConstantPoolEntry;

class ClassReader {
  private offset = 0;

  constructor(private readonly buffer: Buffer) {}

  u1(): number {
    this.ensure(1);
    return this.buffer.readUInt8(this.offset++);
  }

  u2(): number {
    this.ensure(2);
    const value = this.buffer.readUInt16BE(this.offset);
    this.offset += 2;
    return value;
  }

  u4(): number {
    this.ensure(4);
    const value = this.buffer.readUInt32BE(this.offset);
    this.offset += 4;
    return value;
  }

  bytes(length: number): Buffer {
    this.ensure(length);
    const value = this.buffer.subarray(this.offset, this.offset + length);
    this.offset += length;
    return value;
  }

  skip(length: number): void {
    this.ensure(length);
    this.offset += length;
  }

  private ensure(length: number): void {
    if (this.offset + length > this.buffer.length) {
      throw new Error("Class 文件结构不完整，无法继续解析");
    }
  }
}

function parseConstantPool(reader: ClassReader): ConstantPoolEntry[] {
  const count = reader.u2();
  const pool: ConstantPoolEntry[] = new Array(count);
  for (let i = 1; i < count; i++) {
    const tag = reader.u1();
    switch (tag) {
      case 1: {
        const length = reader.u2();
        pool[i] = { tag, value: reader.bytes(length).toString("utf8") };
        break;
      }
      case 7:
        pool[i] = { tag, nameIndex: reader.u2() };
        break;
      case 3:
      case 4:
        reader.skip(4);
        pool[i] = { tag };
        break;
      case 5:
      case 6:
        reader.skip(8);
        pool[i] = { tag };
        i++;
        break;
      case 8:
      case 16:
      case 19:
      case 20:
        reader.skip(2);
        pool[i] = { tag };
        break;
      case 9:
      case 10:
      case 11:
      case 12:
      case 17:
      case 18:
        reader.skip(4);
        pool[i] = { tag };
        break;
      case 15:
        reader.skip(3);
        pool[i] = { tag };
        break;
      default:
        throw new Error(`暂不支持的 class 常量池类型：${tag}`);
    }
  }
  return pool;
}

function resolveUtf8(pool: ConstantPoolEntry[], index: number): string {
  const entry = pool[index];
  return entry && entry.tag === 1 ? entry.value : "";
}

function resolveClassName(pool: ConstantPoolEntry[], index: number): string {
  const entry = pool[index];
  if (!entry || entry.tag !== 7) return "";
  return resolveUtf8(pool, entry.nameIndex).replace(/\//g, ".");
}

function parseMemberTable(reader: ClassReader, pool: ConstantPoolEntry[], kind: "field" | "method"): ClassMemberPreview[] {
  const count = reader.u2();
  const members: ClassMemberPreview[] = [];
  for (let i = 0; i < count; i++) {
    const access = reader.u2();
    const name = resolveUtf8(pool, reader.u2());
    const descriptor = resolveUtf8(pool, reader.u2());
    const attributesCount = reader.u2();
    for (let a = 0; a < attributesCount; a++) {
      reader.u2();
      reader.skip(reader.u4());
    }
    const accessText = formatAccessFlags(access, kind);
    members.push({
      access: accessText,
      name,
      descriptor,
      display: `${accessText} ${name}${kind === "method" ? descriptor : `: ${descriptor}`}`.trim()
    });
  }
  return members;
}

function skipAttributes(reader: ClassReader): void {
  const count = reader.u2();
  for (let i = 0; i < count; i++) {
    reader.u2();
    reader.skip(reader.u4());
  }
}

function formatAccessFlags(flags: number, kind: "class" | "field" | "method"): string {
  const values: Array<[number, string]> = [
    [0x0001, "public"],
    [0x0002, "private"],
    [0x0004, "protected"],
    [0x0008, "static"],
    [0x0010, "final"],
    [0x0200, "interface"],
    [0x0400, "abstract"],
    [0x1000, "synthetic"],
    [0x2000, "annotation"],
    [0x4000, "enum"]
  ];
  if (kind === "method") values.push([0x0020, "synchronized"], [0x0100, "native"], [0x0800, "strict"]);
  if (kind === "field") values.push([0x0040, "volatile"], [0x0080, "transient"]);
  const labels = values.filter(([bit]) => (flags & bit) !== 0).map(([, label]) => label);
  return labels.length ? labels.join(" ") : "-";
}

function javaVersionLabel(major: number): string {
  if (major === 45) return "Java 1.1";
  if (major >= 46 && major <= 48) return `Java 1.${major - 44}`;
  if (major >= 49) return `Java ${major - 44}`;
  return "unknown";
}
