import type { FileTreeResponse, LogFileListResponse } from "@server-log-console/shared";
import { z } from "zod";
import type { StrategyResolver } from "./strategies/index.js";
import { ServerRegistryService } from "../servers/server-registry.service.js";

const listSchema = z.object({
  serverId: z.string().optional(),
  bastionId: z.string().optional(),
  targetHost: z.string().optional(),
  directoryPath: z.string().optional()
});

/* 递归列树：上限由前端显式给，服务端再夹一道（防越界把内存吃穿）。
   20000 项在 1 万文件量级的目录上够用，超出的用 truncated 标记让前端提示收窄。 */
const treeSchema = listSchema.extend({
  maxEntries: z.number().int().min(1).max(200000).optional()
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

  /** 递归列目录（2026-11-24 批量下载）：一次取回整棵树，前端据此还原本地结构。 */
  async tree(rawRequest: unknown): Promise<FileTreeResponse> {
    const request = treeSchema.parse(rawRequest);

    const serverId = request.bastionId || request.serverId;
    if (!serverId) throw new Error("serverId 或 bastionId 必须提供其一");

    const server = this.serverRegistry.getServer(serverId);
    const rootPath = (request.directoryPath || server.basePath || "/").replace(/\/+$/, "") || "/";
    const strategy = this.strategyResolver.resolve(serverId);
    const { entries, truncated } = await strategy.listDirectoryTree(rootPath, {
      maxEntries: request.maxEntries
    });

    const fileEntries = entries.filter((entry) => entry.kind === "file");
    const totalBytes = fileEntries.reduce((sum, entry) => sum + (entry.size ?? 0), 0);

    return {
      rootPath,
      entries,
      truncated,
      fileCount: fileEntries.length,
      totalBytes
    };
  }
}
