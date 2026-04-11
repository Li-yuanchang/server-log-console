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

    connection.client.exec(command, (error, stream) => {
      if (error) {
        closeHandler?.(-1);
        connection.cleanup();
        return;
      }

      stream.on("data", (chunk: Buffer | string) => {
        stdoutHandler?.(chunk.toString());
      });

      stream.stderr.on("data", (chunk: Buffer | string) => {
        stderrHandler?.(chunk.toString());
      });

      stream.on("close", (code: number | undefined) => {
        closeHandler?.(code);
        connection.cleanup();
      });
    });

    return {
      onStdout(handler) { stdoutHandler = handler; },
      onStderr(handler) { stderrHandler = handler; },
      onClose(handler) { closeHandler = handler; },
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

  async uploadFile(filePath: string, content: Buffer): Promise<void> {
    const fileArg = shellEscape(filePath);
    const command = `base64 -d > ${fileArg}`;
    const b64 = content.toString("base64");
    await this.sshExecutor.execWithStdin(this.serverId, command, b64 + "\n", 120000);
  }

  async startUpload(filePath: string): Promise<UploadHandle> {
    const fileArg = shellEscape(filePath);
    let first = true;
    let aborted = false;

    return {
      write: async (data: Buffer) => {
        if (aborted) throw new Error("上传已中止");
        const op = first ? ">" : ">>";
        first = false;
        const command = `base64 -d ${op} ${fileArg}`;
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
      'if [ ! -e "$target" ]; then echo "file-not-found" >&2; exit 1; fi',
      'if [ -d "$target" ]; then echo "is-directory" >&2; exit 1; fi',
      'rm -f "$target"'
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
