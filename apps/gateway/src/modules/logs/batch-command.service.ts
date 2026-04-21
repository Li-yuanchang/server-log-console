import type { BatchCommandRequest, BatchCommandResult, BatchCommandResponse } from "@server-log-console/shared";
import { SshExecutorService } from "./ssh-executor.service.js";
import { ServerRegistryService } from "../servers/server-registry.service.js";
import { z } from "zod";

const BatchCommandSchema = z.object({
  serverIds: z.array(z.string().min(1)).min(1).max(50),
  command: z.string().min(1).max(4096),
  timeout: z.number().int().min(1000).max(300000).optional(),
});

export class BatchCommandService {
  constructor(
    private readonly serverRegistry: ServerRegistryService,
    private readonly sshExecutor: SshExecutorService
  ) {}

  async execute(raw: unknown): Promise<BatchCommandResponse> {
    const parsed = BatchCommandSchema.safeParse(raw);
    if (!parsed.success) {
      return { ok: false, results: [], message: parsed.error.issues.map((i) => i.message).join("; ") };
    }
    const req: BatchCommandRequest = parsed.data;
    const timeoutMs = req.timeout ?? 30000;

    const results = await Promise.all(
      req.serverIds.map(async (serverId): Promise<BatchCommandResult> => {
        const start = performance.now();
        try {
          const server = this.serverRegistry.getServer(serverId);
          const name = server?.name || serverId;

          const output = await this.sshExecutor.exec(serverId, req.command, timeoutMs);

          const durationMs = Math.round(performance.now() - start);
          return {
            serverId,
            serverName: name,
            exitCode: 0,
            stdout: output ?? "",
            stderr: "",
            durationMs,
          };
        } catch (error) {
          const durationMs = Math.round(performance.now() - start);
          const message = error instanceof Error ? error.message : String(error);
          return {
            serverId,
            exitCode: null,
            stdout: "",
            stderr: message,
            durationMs,
            error: message,
          };
        }
      })
    );

    const hasErrors = results.some((r) => r.error);
    return {
      ok: !hasErrors,
      results,
      message: hasErrors ? "部分命令执行失败" : undefined,
    };
  }
}
