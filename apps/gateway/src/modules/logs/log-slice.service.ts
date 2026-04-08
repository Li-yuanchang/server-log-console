import type {
  LogFileMetaRequest,
  LogFileMetaResponse,
  LogLineContextRequest,
  LogLineContextResponse,
  LogSliceRequest,
  LogSliceResponse
} from "@server-log-console/shared";
import { z } from "zod";
import { ServerRegistryService } from "../servers/server-registry.service.js";
import { SshExecutorService } from "./ssh-executor.service.js";
import { shellEscape } from "./remote-shell.js";

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
    private readonly serverRegistry: ServerRegistryService,
    private readonly sshExecutor: SshExecutorService
  ) {}

  async getMeta(rawRequest: unknown): Promise<LogFileMetaResponse> {
    const request = metaSchema.parse(rawRequest) as LogFileMetaRequest;
    const server = this.serverRegistry.getServer(request.serverId);
    const output = await this.sshExecutor.exec(server.id, buildMetaCommand(request.filePath), 45000);
    const [filePath = "", sizeToken = "", modifiedEpoch = "", readableToken = "0"] = output.trim().split("\t");

    if (!filePath || !/^\d+$/.test(sizeToken) || !/^\d+$/.test(modifiedEpoch)) {
      throw new Error(`无法读取日志元信息：${output.trim() || "empty output"}`);
    }

    return {
      filePath,
      size: Number(sizeToken),
      modifiedTime: new Date(Number(modifiedEpoch) * 1000).toISOString(),
      readable: readableToken === "1",
      encodingHint: "utf-8"
    };
  }

  async getSlice(rawRequest: unknown): Promise<LogSliceResponse> {
    const request = sliceSchema.parse(rawRequest) as LogSliceRequest;
    const server = this.serverRegistry.getServer(request.serverId);
    const output = await this.sshExecutor.exec(server.id, buildSliceCommand(request.filePath, request.offset, request.length), 60000);
    const [metaLine, ...contentLines] = output.split(/\r?\n/);

    if (!metaLine?.startsWith("META\t")) {
      throw new Error(`无法读取日志切片：${output.slice(0, 200)}`);
    }

    const [, filePath = "", requestedOffset = "0", requestedLength = "0", actualOffset = "0", fileSize = "0"] =
      metaLine.split("\t");

    const rawBase64 = contentLines.join("");
    const rawBuffer = Buffer.from(rawBase64, "base64");
    const normalized = normalizeChunk(rawBuffer, Number(actualOffset), Number(fileSize));
    const actualLength = normalized.actualLength;

    return {
      filePath,
      requestedOffset: Number(requestedOffset),
      requestedLength: Number(requestedLength),
      actualOffset: normalized.actualOffset,
      actualLength,
      content: normalized.content,
      isStart: normalized.actualOffset === 0,
      isEnd: normalized.actualOffset + actualLength >= Number(fileSize),
      nextOffset: normalized.actualOffset + actualLength
    };
  }

  async getLineContext(rawRequest: unknown): Promise<LogLineContextResponse> {
    const request = lineContextSchema.parse(rawRequest) as LogLineContextRequest;
    const server = this.serverRegistry.getServer(request.serverId);
    const command = buildLineContextCommand(request.filePath, request.lineNumber, request.contextLines ?? 12);
    const output = await this.sshExecutor.exec(server.id, command, 60000);
    const [metaLine, ...contentLines] = output.split(/\r?\n/);

    if (!metaLine?.startsWith("META\t")) {
      throw new Error(`无法按行定位日志：${output.slice(0, 200)}`);
    }

    const [, filePath = "", lineNumberToken = "0", startLineToken = "0", endLineToken = "0"] = metaLine.split("\t");
    const content = Buffer.from(contentLines.join(""), "base64").toString("utf8");

    return {
      filePath,
      lineNumber: Number(lineNumberToken),
      startLine: Number(startLineToken),
      endLine: Number(endLineToken),
      content
    };
  }
}

function buildMetaCommand(filePath: string) {
  const fileArg = shellEscape(filePath);
  const script = [
    "target=" + fileArg,
    'if [ ! -e "$target" ]; then',
    '  echo "file-not-found" >&2',
    "  exit 1",
    "fi",
    'size=$(wc -c < "$target" | tr -d " ")',
    'mtime=$(stat -c %Y "$target")',
    'readable=0',
    'if [ -r "$target" ]; then readable=1; fi',
    'printf "%s\\t%s\\t%s\\t%s\\n" "$target" "$size" "$mtime" "$readable"'
  ].join("\n");

  return `bash -lc ${shellEscape(script)}`;
}

function buildSliceCommand(filePath: string, offset: number, length: number) {
  const fileArg = shellEscape(filePath);
  const script = [
    "target=" + fileArg,
    `offset=${offset}`,
    `length=${length}`,
    "extra=512",
    'if [ ! -e "$target" ]; then',
    '  echo "file-not-found" >&2',
    "  exit 1",
    "fi",
    'size=$(wc -c < "$target" | tr -d " ")',
    "start=$offset",
    'if [ "$start" -lt 0 ]; then start=0; fi',
    'read_start=$(( start > extra ? start - extra : 0 ))',
    'remaining=$(( size - read_start ))',
    'if [ "$remaining" -lt 0 ]; then remaining=0; fi',
    'read_length=$(( length + extra * 2 ))',
    'if [ "$read_length" -gt "$remaining" ]; then read_length=$remaining; fi',
    'printf "META\\t%s\\t%s\\t%s\\t%s\\t%s\\n" "$target" "$offset" "$length" "$read_start" "$size"',
    'if [ "$read_length" -gt 0 ]; then',
    '  tail -c +$(( read_start + 1 )) "$target" | head -c "$read_length" | base64 | tr -d "\\n"',
    'fi',
    'printf "\\n"'
  ].join("\n");

  return `bash -lc ${shellEscape(script)}`;
}

function buildLineContextCommand(filePath: string, lineNumber: number, contextLines: number) {
  const fileArg = shellEscape(filePath);
  const script = [
    "target=" + fileArg,
    `line_no=${Math.max(1, lineNumber)}`,
    `context=${Math.max(0, contextLines)}`,
    'if [ ! -e "$target" ]; then',
    '  echo "file-not-found" >&2',
    "  exit 1",
    "fi",
    'start=$(( line_no > context ? line_no - context : 1 ))',
    'end=$(( line_no + context ))',
    'take=$(( end - start + 1 ))',
    'printf "META\\t%s\\t%s\\t%s\\t%s\\n" "$target" "$line_no" "$start" "$end"',
    'tail -n +"$start" "$target" | head -n "$take" | nl -ba -v "$start" | base64 | tr -d "\\n"',
    'printf "\\n"'
  ].join("\n");

  return `bash -lc ${shellEscape(script)}`;
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
