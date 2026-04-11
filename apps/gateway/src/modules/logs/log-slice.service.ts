import type {
  LogFileMetaRequest,
  LogFileMetaResponse,
  LogLineContextRequest,
  LogLineContextResponse,
  LogSliceRequest,
  LogSliceResponse
} from "@server-log-console/shared";
import { z } from "zod";
import type { StrategyResolver } from "./strategies/index.js";

const metaSchema = z.object({
  serverId: z.string(),
  filePath: z.string()
});

const sliceSchema = z.object({
  serverId: z.string(),
  filePath: z.string(),
  offset: z.number().int().min(0),
  length: z.number().int().min(1).max(1024 * 1024)
});

const lineContextSchema = z.object({
  serverId: z.string(),
  filePath: z.string(),
  lineNumber: z.number().int().min(1),
  contextLines: z.number().int().min(0).max(50).optional()
});

export class LogSliceService {
  constructor(
    private readonly strategyResolver: StrategyResolver
  ) {}

  async getMeta(rawRequest: unknown): Promise<LogFileMetaResponse> {
    const request = metaSchema.parse(rawRequest) as LogFileMetaRequest;
    const strategy = this.strategyResolver.resolve(request.serverId);
    const stat = await strategy.fileStat(request.filePath);
    return {
      filePath: request.filePath,
      size: stat.size,
      modifiedTime: new Date(stat.mtime * 1000).toISOString(),
      readable: stat.readable,
      encodingHint: "utf-8"
    };
  }

  async getSlice(rawRequest: unknown): Promise<LogSliceResponse> {
    const request = sliceSchema.parse(rawRequest) as LogSliceRequest;
    const strategy = this.strategyResolver.resolve(request.serverId);
    const stat = await strategy.fileStat(request.filePath);
    const fileSize = stat.size;
    const extra = 512;
    const readStart = Math.max(0, request.offset > extra ? request.offset - extra : 0);
    const remaining = Math.max(0, fileSize - readStart);
    const readLength = Math.min(request.length + extra * 2, remaining);

    if (readLength <= 0) {
      return {
        filePath: request.filePath,
        requestedOffset: request.offset,
        requestedLength: request.length,
        actualOffset: fileSize,
        actualLength: 0,
        content: "",
        isStart: request.offset === 0,
        isEnd: true,
        nextOffset: fileSize
      };
    }

    const rawBuffer = await strategy.fileRead(request.filePath, readStart, readLength);
    const normalized = normalizeChunk(rawBuffer, readStart, fileSize);
    const actualLength = normalized.actualLength;

    return {
      filePath: request.filePath,
      requestedOffset: request.offset,
      requestedLength: request.length,
      actualOffset: normalized.actualOffset,
      actualLength,
      content: normalized.content,
      isStart: normalized.actualOffset === 0,
      isEnd: normalized.actualOffset + actualLength >= fileSize,
      nextOffset: normalized.actualOffset + actualLength
    };
  }

  async getLineContext(rawRequest: unknown): Promise<LogLineContextResponse> {
    const request = lineContextSchema.parse(rawRequest) as LogLineContextRequest;
    const strategy = this.strategyResolver.resolve(request.serverId);
    const contextLines = request.contextLines ?? 12;
    const stat = await strategy.fileStat(request.filePath);
    const fileSize = stat.size;
    const estimatedBytesPerLine = 120;
    const totalLines = contextLines * 2 + 1;
    const estimatedBytes = totalLines * estimatedBytesPerLine * 2;
    const estimatedOffset = Math.max(0, (request.lineNumber - contextLines - 1) * estimatedBytesPerLine);
    const readStart = Math.max(0, estimatedOffset - estimatedBytesPerLine * 5);
    const readLength = Math.min(estimatedBytes + estimatedBytesPerLine * 10, fileSize - readStart);

    if (readLength <= 0) {
      return { filePath: request.filePath, lineNumber: request.lineNumber, startLine: request.lineNumber, endLine: request.lineNumber, content: "" };
    }

    const rawBuffer = await strategy.fileRead(request.filePath, readStart, readLength);
    const text = rawBuffer.toString("utf8");
    const allLines = text.split("\n");

    const linesBeforeOffset = readStart === 0 ? 0 : Math.round(readStart / estimatedBytesPerLine);
    const startLine = Math.max(1, request.lineNumber - contextLines);
    const endLine = request.lineNumber + contextLines;

    const localStart = Math.max(0, startLine - linesBeforeOffset - 1);
    const localEnd = Math.min(allLines.length, endLine - linesBeforeOffset);
    const selectedLines = allLines.slice(localStart, localEnd);

    const numberedContent = selectedLines
      .map((line, idx) => `     ${startLine + idx}\t${line}`)
      .join("\n");

    return {
      filePath: request.filePath,
      lineNumber: request.lineNumber,
      startLine,
      endLine: startLine + selectedLines.length - 1,
      content: numberedContent
    };
  }
}

function normalizeChunk(rawBuffer: Buffer, readStart: number, fileSize: number) {
  let startIndex = 0;
  let endIndex = rawBuffer.length;
  let actualOffset = readStart;

  if (readStart > 0) {
    const firstNewline = rawBuffer.indexOf(0x0a);
    if (firstNewline !== -1) {
      startIndex = firstNewline + 1;
      actualOffset += startIndex;
    }
  }

  if (readStart + rawBuffer.length < fileSize) {
    const lastNewline = rawBuffer.lastIndexOf(0x0a);
    if (lastNewline !== -1 && lastNewline >= startIndex) {
      endIndex = lastNewline + 1;
    }
  }

  const normalizedBuffer = rawBuffer.subarray(startIndex, endIndex);
  const content = normalizedBuffer.toString("utf8");
  return {
    actualOffset,
    actualLength: normalizedBuffer.length,
    content
  };
}
