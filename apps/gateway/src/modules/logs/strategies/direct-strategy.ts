import type { LogFileEntry } from "@server-log-console/shared";
import type { DirectConnectionStrategy, FileStat, StreamingExecHandle, UploadHandle } from "./connection-strategy.js";
import type { SshExecutorService } from "../ssh-executor.service.js";
import { shellEscape } from "../remote-shell.js";

/**
 * 直连策略 —— 通过 SSH exec 执行 shell 命令完成文件操作。
 * 适用于可直接 SSH 到目标服务器的场景（含自动 bastion 跳板）。
 */
export class DirectStrategy implements DirectConnectionStrategy {
  readonly kind = "direct" as const;

  constructor(
    private readonly serverId: string,
    private readonly sshExecutor: SshExecutorService
  ) {}

  async fileStat(filePath: string): Promise<FileStat> {
    const fileArg = shellEscape(filePath);
    const script = [
      "target=" + fileArg,
      'if [ ! -e "$target" ]; then echo "file-not-found" >&2; exit 1; fi',
      'size=$(wc -c < "$target" | tr -d " ")',
      'mtime=$(stat -c %Y "$target")',
      'readable=0; if [ -r "$target" ]; then readable=1; fi',
      'printf "%s\\t%s\\t%s\\n" "$size" "$mtime" "$readable"'
    ].join("\n");
    const command = `bash -lc ${shellEscape(script)}`;
    const output = await this.sshExecutor.exec(this.serverId, command, 45000);
    const [sizeToken = "", mtimeToken = "", readableToken = "0"] = output.trim().split("\t");

    if (!/^\d+$/.test(sizeToken) || !/^\d+$/.test(mtimeToken)) {
      throw new Error(`无法读取文件元信息：${output.trim() || "empty output"}`);
    }

    return {
      size: Number(sizeToken),
      mtime: Number(mtimeToken),
      readable: readableToken === "1"
    };
  }

  async fileRead(filePath: string, offset: number, length: number): Promise<Buffer> {
    const fileArg = shellEscape(filePath);
    const script = [
      "target=" + fileArg,
      `offset=${offset}`,
      `length=${length}`,
      'if [ ! -e "$target" ]; then echo "file-not-found" >&2; exit 1; fi',
      'tail -c +$(( offset + 1 )) "$target" | head -c "$length" | base64 | tr -d "\\n"',
      'printf "\\n"'
    ].join("\n");
    const command = `bash -lc ${shellEscape(script)}`;
    const output = await this.sshExecutor.exec(this.serverId, command, 60000);
    return Buffer.from(output.trim(), "base64");
  }

  async listDirectory(directoryPath: string): Promise<LogFileEntry[]> {
    const dirArg = shellEscape(directoryPath);
    const script = [
      "target=" + dirArg,
      'if [ ! -d "$target" ]; then echo "directory-not-found" >&2; exit 1; fi',
      'if [ ! -r "$target" ]; then echo "directory-not-readable" >&2; exit 1; fi',
      'find "$target" -mindepth 1 -maxdepth 1 \\( -type d -o -type f \\) -printf "%y\\t%f\\t%s\\t%T@\\t%p\\n" | awk -F "\\t" \'BEGIN{OFS="\\t"} {split($4, a, "."); print $1, $2, $3, a[1], $5}\' | LC_ALL=C sort'
    ].join("\n");
    const command = `bash -lc ${shellEscape(script)}`;
    const output = await this.sshExecutor.exec(this.serverId, command, 30000);
    const lines = output.split(/\r?\n/).filter(Boolean);
    const entries: LogFileEntry[] = [];

    for (const line of lines) {
      const [kindToken, name = "", sizeToken = "", modifiedEpochToken = "", path = ""] = line.split("\t");
      if (!path || !name) continue;
      const kind = kindToken === "d" ? "directory" : kindToken === "f" ? "file" : null;
      if (!kind) continue;
      entries.push({
        path,
        name,
        kind,
        size: kind === "file" && /^\d+$/.test(sizeToken) ? Number(sizeToken) : undefined,
        modifiedTime: /^\d+$/.test(modifiedEpochToken) ? new Date(Number(modifiedEpochToken) * 1000).toISOString() : undefined
      });
    }

    return entries;
  }

  async exec(command: string, timeoutMs = 45000): Promise<string> {
    return this.sshExecutor.exec(this.serverId, command, timeoutMs);
  }

  async execStreaming(command: string, timeoutMs = 45000): Promise<StreamingExecHandle> {
    const connection = await this.sshExecutor.connectForStreaming(this.serverId, timeoutMs);
    let stdoutHandler: ((chunk: string) => void) | null = null;
    let stderrHandler: ((chunk: string) => void) | null = null;
    let closeHandler: ((code: number | undefined) => void) | null = null;

    let pendingStdoutChunks: string[] = [];
    let pendingStderrChunks: string[] = [];
    let pendingCloseCode: number | undefined;
    let closePending = false;

    const emitStdout = (chunk: string) => {
      if (!chunk) return;
      if (stdoutHandler) {
        stdoutHandler(chunk);
        return;
      }
      pendingStdoutChunks.push(chunk);
    };

    const emitStderr = (chunk: string) => {
      if (!chunk) return;
      if (stderrHandler) {
        stderrHandler(chunk);
        return;
      }
      pendingStderrChunks.push(chunk);
    };

    const emitClose = (code: number | undefined) => {
      if (closeHandler) {
        closeHandler(code);
        return;
      }
      pendingCloseCode = code;
      closePending = true;
    };

    if (connection.mode === "jumpserver-shell" && connection.shellStream) {
      // JumpServer shell: wrap command with markers to extract output from shared stream
      const token = `SLC_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
      const startMarker = `__${token}_BEGIN__`;
      const endMarker = `__${token}_END__`;
      const shellStream = connection.shellStream;
      let buffer = "";
      let started = false;
      let settled = false;

      const timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        shellStream.off("data", onData);
        closeHandler?.(undefined);
        connection.cleanup();
      }, timeoutMs);

      const onData = (chunk: Buffer | string) => {
        if (settled) return;
        buffer += chunk.toString();

        if (!started) {
          const startIdx = buffer.indexOf(startMarker + "\n");
          if (startIdx < 0) {
            const altIdx = buffer.indexOf(startMarker + "\r\n");
            if (altIdx < 0) return;
            buffer = buffer.slice(altIdx + startMarker.length + 2);
            started = true;
          } else {
            buffer = buffer.slice(startIdx + startMarker.length + 1);
            started = true;
          }
        }

        // Check for end marker in accumulated buffer
        const endPattern = new RegExp(`\\r?\\n${endMarker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}:(\\d+)\\r?\\n`);
        const endMatch = endPattern.exec(buffer);
        if (endMatch) {
          const content = buffer.slice(0, endMatch.index);
          if (content) emitStdout(content.replace(/\r/g, ""));
          const exitCode = Number(endMatch[1] || 0);
          settled = true;
          clearTimeout(timeout);
          shellStream.off("data", onData);
          emitClose(exitCode);
          connection.cleanup();
          return;
        }

        // Stream accumulated content, keep last 200 chars as overlap for marker detection
        if (buffer.length > 400) {
          const safe = buffer.slice(0, buffer.length - 200);
          emitStdout(safe.replace(/\r/g, ""));
          buffer = buffer.slice(buffer.length - 200);
        }
      };

      shellStream.on("data", onData);
      shellStream.write(`printf '${startMarker}\\n'; ${command}; __slc_status=$?; printf '\\n${endMarker}:%s\\n' "$__slc_status"\r`);
    } else {
      connection.client.exec(command, (error, stream) => {
        if (error) {
          emitClose(-1);
          connection.cleanup();
          return;
        }

        stream.on("data", (chunk: Buffer | string) => {
          emitStdout(chunk.toString());
        });

        stream.stderr.on("data", (chunk: Buffer | string) => {
          emitStderr(chunk.toString());
        });

        stream.on("close", (code: number | undefined) => {
          emitClose(code);
          connection.cleanup();
        });
      });
    }

    return {
      onStdout(handler) {
        stdoutHandler = handler;
        if (pendingStdoutChunks.length) {
          for (const chunk of pendingStdoutChunks) handler(chunk);
          pendingStdoutChunks = [];
        }
      },
      onStderr(handler) {
        stderrHandler = handler;
        if (pendingStderrChunks.length) {
          for (const chunk of pendingStderrChunks) handler(chunk);
          pendingStderrChunks = [];
        }
      },
      onClose(handler) {
        closeHandler = handler;
        if (closePending) {
          closePending = false;
          handler(pendingCloseCode);
        }
      },
      cleanup() { connection.cleanup(); }
    };
  }

  async downloadFile(filePath: string): Promise<Buffer> {
    const fileArg = shellEscape(filePath);
    const script = `cat ${fileArg} | base64`;
    const command = `bash -lc ${shellEscape(script)}`;
    const output = await this.sshExecutor.exec(this.serverId, command, 120000);
    return Buffer.from(output.trim(), "base64");
  }

  async createReadStream(filePath: string, limitBytes?: number): Promise<{ stream: import("stream").Readable; cleanup: () => void }> {
    const fileArg = shellEscape(filePath);
    const command = limitBytes && limitBytes > 0
      ? `head -c ${limitBytes} ${fileArg}`
      : `cat ${fileArg}`;
    return this.sshExecutor.execRawStream(this.serverId, command, 600000);
  }

  async uploadFile(filePath: string, content: Buffer): Promise<void> {
    const fileArg = shellEscape(filePath);
    const dirArg = shellEscape(filePath.substring(0, filePath.lastIndexOf("/")) || "/");
    const command = `mkdir -p ${dirArg} && base64 -d > ${fileArg}`;
    const b64 = content.toString("base64");
    await this.sshExecutor.execWithStdin(this.serverId, command, b64 + "\n", 120000);
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

  async startUpload(filePath: string): Promise<UploadHandle> {
    const fileArg = shellEscape(filePath);
    const dirArg = shellEscape(filePath.substring(0, filePath.lastIndexOf("/")) || "/");
    let first = true;
    let aborted = false;

    return {
      write: async (data: Buffer) => {
        if (aborted) throw new Error("上传已中止");
        const op = first ? ">" : ">>";
        const mkdirPrefix = first ? `mkdir -p ${dirArg} && ` : "";
        first = false;
        const command = `${mkdirPrefix}base64 -d ${op} ${fileArg}`;
        const b64 = data.toString("base64");
        await this.sshExecutor.execWithStdin(this.serverId, command, b64 + "\n", 120000);
      },
      finish: async () => {},
      abort: () => { aborted = true; }
    };
  }

  async deleteFile(filePath: string): Promise<void> {
    const fileArg = shellEscape(filePath);
    const script = [
      "target=" + fileArg,
      'if [ -z "$target" ] || [ "$target" = "/" ]; then echo "refuse-delete-root" >&2; exit 1; fi',
      'if [ ! -e "$target" ]; then echo "file-not-found" >&2; exit 1; fi',
      'if [ -d "$target" ]; then',
      '  rm -rf "$target"',
      'else',
      '  rm -f "$target"',
      'fi'
    ].join("\n");
    const command = `bash -lc ${shellEscape(script)}`;
    await this.sshExecutor.exec(this.serverId, command, 30000);
  }

  async renameFile(oldPath: string, newPath: string): Promise<void> {
    const oldArg = shellEscape(oldPath);
    const newArg = shellEscape(newPath);
    const script = [
      "old=" + oldArg,
      "new=" + newArg,
      'if [ ! -e "$old" ]; then echo "source-not-found" >&2; exit 1; fi',
      'if [ -e "$new" ]; then echo "target-exists" >&2; exit 1; fi',
      'mv "$old" "$new"'
    ].join("\n");
    const command = `bash -lc ${shellEscape(script)}`;
    await this.sshExecutor.exec(this.serverId, command, 30000);
  }

  dispose(): void {
    // 直连策略不持有长连接，无需清理
  }
}
