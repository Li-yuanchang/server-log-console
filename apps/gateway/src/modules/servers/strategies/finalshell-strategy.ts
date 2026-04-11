import type { ImportStrategy, ImportToolMeta, ImportInspectResult, ImportResult } from "./import-strategy.js";
import { FinalShellImportService } from "../finalshell-import.service.js";

export class FinalShellImportStrategy implements ImportStrategy {
  readonly meta: ImportToolMeta = {
    id: "finalshell",
    label: "FinalShell",
    description: "从 FinalShell 导入服务器连接配置（自动查找 conn 目录）"
  };

  private readonly service: FinalShellImportService;

  constructor(configuredRootDir?: string) {
    this.service = new FinalShellImportService(configuredRootDir);
  }

  async inspect(preferredPath?: string): Promise<ImportInspectResult> {
    return this.service.inspectRootDir(preferredPath);
  }

  async importServers(preferredPath?: string): Promise<ImportResult> {
    const { response, credentials } = await this.service.importServers(preferredPath);
    return {
      importedAt: response.importedAt,
      resolvedPath: response.resolvedPath,
      searchedPaths: response.searchedPaths,
      servers: response.servers,
      credentials
    };
  }
}
