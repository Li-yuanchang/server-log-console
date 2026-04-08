import type { ServerSummary } from "@server-log-console/shared";
import { demoServers } from "../../data.js";

export class ServerRegistryService {
  private manualServers: ServerSummary[] = [];
  private importedServers: ServerSummary[] = [];

  listServers(): ServerSummary[] {
    return [...demoServers, ...this.manualServers, ...this.importedServers];
  }

  getServer(serverId: string): ServerSummary {
    const server = this.listServers().find((item) => item.id === serverId);
    if (!server) {
      throw new Error(`Unknown server: ${serverId}`);
    }
    return server;
  }

  setImportedServers(servers: ServerSummary[]): void {
    this.importedServers = servers;
  }

  setManualServers(servers: ServerSummary[]): void {
    this.manualServers = servers;
  }
}
