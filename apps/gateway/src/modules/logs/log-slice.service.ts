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
import { isBastionSftpStrategy, isDirectStrategy } from "./strategies/connection-strategy.js";
import { shellEscape } from "./remote-shell.js";

const metaSchema = z.object({
  serverId: z.string(),
  filePath: z.string()
});

const sliceSchema = z.object({
  serverId: z.string(),
  filePath: z.string(),
  offset: z.number().int().min(-1),
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

    // Bastion: single SSH connection for stat+read (halves JumpServer latency)
    if (isBastionSftpStrategy(strategy)) {
      return this.getSliceViaBastionSftp(strategy, request);
    }

    const stat = await strategy.fileStat(request.filePath);
    const fileSize = stat.size;
    const modifiedTime = new Date(stat.mtime * 1000).toISOString();

    // offset=-1 means "read tail" — compute offset automatically
    const effectiveOffset = request.offset === -1
      ? Math.max(0, fileSize - request.length)
      : request.offset;

    const extra = 512;
    const readStart = Math.max(0, effectiveOffset > extra ? effectiveOffset - extra : 0);
    const remaining = Math.max(0, fileSize - readStart);
    const readLength = Math.min(request.length + extra * 2, remaining);

    if (readLength <= 0) {
      return {
        filePath: request.filePath,
        requestedOffset: effectiveOffset,
        requestedLength: request.length,
        actualOffset: fileSize,
        actualLength: 0,
        content: "",
        isStart: effectiveOffset === 0,
        isEnd: true,
        nextOffset: fileSize,
        fileSize,
        modifiedTime
      };
    }

    const rawBuffer = await strategy.fileRead(request.filePath, readStart, readLength);
    const normalized = normalizeChunk(rawBuffer, readStart, fileSize);
    const actualLength = normalized.actualLength;

    return {
      filePath: request.filePath,
      requestedOffset: effectiveOffset,
      requestedLength: request.length,
      actualOffset: normalized.actualOffset,
      actualLength,
      content: normalized.content,
      isStart: normalized.actualOffset === 0,
      isEnd: normalized.actualOffset + actualLength >= fileSize,
      nextOffset: normalized.actualOffset + actualLength,
      fileSize,
      modifiedTime
    };
  }

  /**
   * Bastion optimized: stat + read in a single SSH connection.
   * sftpStatAndRead handles offset=-1 (tail mode) internally.
   */
  private async getSliceViaBastionSftp(
    strategy: import("./strategies/connection-strategy.js").BastionSftpConnectionStrategy,
    request: LogSliceRequest
  ): Promise<LogSliceResponse> {
    const extra = 512;

    // For tail mode: pass offset=-1 directly, sftpStatAndRead computes tail offset internally
    // For normal mode: add extra bytes for boundary alignment
    const readOffset = request.offset === -1 ? -1 : Math.max(0, request.offset > extra ? request.offset - extra : 0);
    const readLength = request.length + extra * 2;

    const { stat, data: rawBuffer } = await strategy.statAndRead(request.filePath, readOffset, readLength);

    const fileSize = stat.size;
    const modifiedTime = new Date(stat.mtime * 1000).toISOString();
    const effectiveOffset = request.offset === -1
      ? Math.max(0, fileSize - request.length)
      : request.offset;

    if (rawBuffer.length === 0) {
      return {
        filePath: request.filePath,
        requestedOffset: effectiveOffset,
        requestedLength: request.length,
        actualOffset: fileSize,
        actualLength: 0,
        content: "",
        isStart: effectiveOffset === 0,
        isEnd: true,
        nextOffset: fileSize,
        fileSize,
        modifiedTime
      };
    }

    const readStart = request.offset === -1
      ? Math.max(0, effectiveOffset > extra ? effectiveOffset - extra : 0)
      : readOffset;
    const normalized = normalizeChunk(rawBuffer, readStart, fileSize);
    const actualLength = normalized.actualLength;

    return {
      filePath: request.filePath,
      requestedOffset: effectiveOffset,
      requestedLength: request.length,
      actualOffset: normalized.actualOffset,
      actualLength,
      content: normalized.content,
      isStart: normalized.actualOffset === 0,
      isEnd: normalized.actualOffset + actualLength >= fileSize,
      nextOffset: normalized.actualOffset + actualLength,
      fileSize,
      modifiedTime
    };
  }

  async getLineContext(rawRequest: unknown): Promise<LogLineContextResponse> {
    const request = lineContextSchema.parse(rawRequest) as LogLineContextRequest;
    const strategy = this.strategyResolver.resolve(request.serverId);
    const contextLines = request.contextLines ?? 12;

    if (isDirectStrategy(strategy)) {
      return this.getLineContextViaDirectExec(strategy, request.filePath, request.lineNumber, contextLines);
    }

    if (isBastionSftpStrategy(strategy)) {
      const stream = await strategy.createReadStream(request.filePath);
      return this.collectExactLineContext(stream, request.filePath, request.lineNumber, contextLines);
    }

    throw new Error("不支持的连接策略");
  }

  private async getLineContextViaDirectExec(
    strategy: import("./strategies/connection-strategy.js").DirectConnectionStrategy,
    filePath: string,
    lineNumber: number,
    contextLines: number
  ): Promise<LogLineContextResponse> {
    const startLine = Math.max(1, lineNumber - contextLines);
    const endLine = lineNumber + contextLines;
    const fileArg = shellEscape(filePath);
    const script = [
      "target=" + fileArg,
      `start=${startLine}`,
      `end=${endLine}`,
      'if [ ! -e "$target" ]; then echo "file-not-found" >&2; exit 1; fi',
      'awk -v start="$start" -v end="$end" \'NR >= start && NR <= end { printf "%d\\t%s\\n", NR, $0 } NR > end { exit }\' "$target"'
    ].join("\n");
    const command = `bash -lc ${shellEscape(script)}`;
    const output = await strategy.exec(command, 120000);
    return buildLineContextResponse(filePath, lineNumber, parseNumberedLines(output));
  }

  private async collectExactLineContext(
    stream: NodeJS.ReadableStream,
    filePath: string,
    targetLineNumber: number,
    contextLines: number
  ): Promise<LogLineContextResponse> {
    const startLine = Math.max(1, targetLineNumber - contextLines);
    const endLine = targetLineNumber + contextLines;
    const lines: Array<{ lineNumber: number; content: string }> = [];
    let buffer = "";
    let currentLineNumber = 0;
    const readable = stream as import("stream").Readable;

    for await (const chunk of readable) {
      buffer += chunk.toString("utf8");
      let newlineIndex = buffer.indexOf("\n");
      while (newlineIndex >= 0) {
        let line = buffer.slice(0, newlineIndex);
        buffer = buffer.slice(newlineIndex + 1);
        if (line.endsWith("\r")) {
          line = line.slice(0, -1);
        }
        currentLineNumber += 1;
        if (currentLineNumber >= startLine && currentLineNumber <= endLine) {
          lines.push({ lineNumber: currentLineNumber, content: line });
        }
        if (currentLineNumber >= endLine) {
          readable.destroy();
          return buildLineContextResponse(filePath, targetLineNumber, lines);
        }
        newlineIndex = buffer.indexOf("\n");
      }
    }

    if (buffer.length > 0) {
      let line = buffer;
      if (line.endsWith("\r")) {
        line = line.slice(0, -1);
      }
      currentLineNumber += 1;
      if (currentLineNumber >= startLine && currentLineNumber <= endLine) {
        lines.push({ lineNumber: currentLineNumber, content: line });
      }
    }

    return buildLineContextResponse(filePath, targetLineNumber, lines);
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

function parseNumberedLines(output: string) {
  const lines = output.replace(/\r/g, "").split("\n");
  if (lines.length > 0 && lines[lines.length - 1] === "") {
    lines.pop();
  }

  return lines.flatMap((line) => {
    const tabIndex = line.indexOf("\t");
    if (tabIndex < 0) {
      return [];
    }
    const lineNumberToken = line.slice(0, tabIndex).trim();
    if (!/^\d+$/.test(lineNumberToken)) {
      return [];
    }
    return [{
      lineNumber: Number(lineNumberToken),
      content: line.slice(tabIndex + 1)
    }];
  });
}

function buildLineContextResponse(
  filePath: string,
  requestedLineNumber: number,
  lines: Array<{ lineNumber: number; content: string }>
): LogLineContextResponse {
  if (!lines.length) {
    return {
      filePath,
      lineNumber: requestedLineNumber,
      startLine: requestedLineNumber,
      endLine: requestedLineNumber,
      content: ""
    };
  }

  return {
    filePath,
    lineNumber: requestedLineNumber,
    startLine: lines[0].lineNumber,
    endLine: lines[lines.length - 1].lineNumber,
    content: lines.map((line) => `     ${line.lineNumber}\t${line.content}`).join("\n")
  };
}
