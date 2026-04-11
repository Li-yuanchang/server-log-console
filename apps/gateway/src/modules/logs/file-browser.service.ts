import type { LogFileListResponse } from "@server-log-console/shared";
import { z } from "zod";
import type { StrategyResolver } from "./strategies/index.js";
import { ServerRegistryService } from "../servers/server-registry.service.js";

const listSchema = z.object({
  serverId: z.string().optional(),
  bastionId: z.string().optional(),
  targetHost: z.string().optional(),
  directoryPath: z.string().optional()
});

export class FileBrowserService {
  constructor(
    private readonly strategyResolver: StrategyResolver,
    private readonly serverRegistry: ServerRegistryService
  ) {}

  async list(rawRequest: unknown): Promise<LogFileListResponse> {
    const request = listSchema.parse(rawRequest);

    const serverId = request.bastionId || request.serverId;
    if (!serverId) throw new Error("serverId 或 bastionId 必须提供其一");

    const server = this.serverRegistry.getServer(serverId);
    const directoryPath = request.directoryPath || server.basePath || "/";
    const strategy = this.strategyResolver.resolve(serverId);
    const entries = await strategy.listDirectory(directoryPath);

    return { directoryPath, entries };
  }
}
