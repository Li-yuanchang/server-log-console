import type { LogFileEntry, LogFileListRequest, LogFileListResponse } from "@server-log-console/shared";
import { z } from "zod";
import { ServerRegistryService } from "../servers/server-registry.service.js";
import { SshExecutorService } from "./ssh-executor.service.js";
import { shellEscape } from "./remote-shell.js";

const listSchema = z.object({
  serverId: z.string().optional(),
  bastionId: z.string().optional(),
  targetHost: z.string().optional(),
  directoryPath: z.string().optional()
});

const allowedExtensions = [".log", ".out", ".txt", ".gz"];

export class FileBrowserService {
  constructor(
    private readonly serverRegistry: ServerRegistryService,
    private readonly sshExecutor: SshExecutorService
  ) {}

  async list(rawRequest: unknown): Promise<LogFileListResponse> {
    const request = listSchema.parse(rawRequest);

    if (request.bastionId && !request.targetHost) {
      return this.listViaSftp(request.bastionId, request.directoryPath || "/");
    }

    const isBastionExecMode = Boolean(request.bastionId && request.targetHost);

    let directoryPath: string;
    let output: string;

    if (isBastionExecMode) {
      directoryPath = request.directoryPath || "/";
      const command = buildDirectoryListCommand(directoryPath);
      output = await this.sshExecutor.execViaBastionHost(request.bastionId!, request.targetHost!, command, 30000);
    } else {
      if (!request.serverId) throw new Error("serverId 或 bastionId 必须提供其一");
      const server = this.serverRegistry.getServer(request.serverId);
      directoryPath = request.directoryPath || server.basePath;
      const command = buildDirectoryListCommand(directoryPath);
      output = await this.sshExecutor.exec(server.id, command, 30000);
    }
    const lines = output.split(/\r?\n/).filter(Boolean);
    const entries: LogFileEntry[] = [];

    for (const line of lines) {
      const [kindToken, name = "", sizeToken = "", modifiedEpochToken = "", path = ""] = line.split("\t");
      if (!path || !name) {
        continue;
      }

      const kind = kindToken === "d" ? "directory" : kindToken === "f" ? "file" : null;
      if (!kind) {
        continue;
      }

      if (kind === "file" && !allowedExtensions.some((suffix) => name.endsWith(suffix))) {
        continue;
      }

      entries.push({
        path,
        name,
        kind,
        size: kind === "file" && /^\d+$/.test(sizeToken) ? Number(sizeToken) : undefined,
        modifiedTime: /^\d+$/.test(modifiedEpochToken) ? new Date(Number(modifiedEpochToken) * 1000).toISOString() : undefined
      });
    }

    return {
      directoryPath,
      entries
    };
  }
  private async listViaSftp(bastionId: string, directoryPath: string): Promise<LogFileListResponse> {
    const sftpEntries = await this.sshExecutor.sftpListDirectory(bastionId, directoryPath, 30000);
    const entries: LogFileEntry[] = sftpEntries.map((entry) => ({
      path: entry.path,
      name: entry.name,
      kind: entry.kind,
      size: entry.size,
      modifiedTime: entry.modifiedTime
    }));

    return { directoryPath, entries };
  }
}

function buildDirectoryListCommand(directoryPath: string) {
  const dirArg = shellEscape(directoryPath);
  const script = [
    "target=" + dirArg,
    'if [ ! -d "$target" ]; then',
    '  echo "directory-not-found" >&2',
    "  exit 1",
    "fi",
    'if [ ! -r "$target" ]; then',
    '  echo "directory-not-readable" >&2',
    "  exit 1",
    "fi",
    'find "$target" -mindepth 1 -maxdepth 1 \\( -type d -o -type f \\) -printf "%y\\t%f\\t%s\\t%T@\\t%p\\n" | awk -F "\\t" \'BEGIN{OFS="\\t"} {split($4, a, "."); print $1, $2, $3, a[1], $5}\' | LC_ALL=C sort'
  ].join("\n");

  return `bash -lc ${shellEscape(script)}`;
}
