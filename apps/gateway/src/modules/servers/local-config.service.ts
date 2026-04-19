import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { ManualServerUpsertRequest, ServerConnectionKind, ServerCredentialInput, ServerRouteConfig, ServerSummary } from "@server-log-console/shared";
import { decodeFinalShellPassword } from "./finalshell-password-decoder.js";

interface PersistedServerRecord extends ServerSummary {
  source: "manual";
}

type CredentialRecord = Record<string, ServerCredentialInput>;
interface FinalShellSettingsRecord {
  configuredPath: string;
  lastImportedAt?: string;
}
type ServerRouteRecord = Record<
  string,
  {
    preferredBastionId?: string;
    jumpMode?: "auto" | "jumpserver-search";
    jumpSearchKeyword?: string;
    jumpAssetId?: string;
  }
>;

function describeManualConnection(kind: ServerConnectionKind | undefined): Pick<ServerSummary, "connectionKind" | "connectionHint" | "cautionLabel"> {
  if (kind === "bastion") {
    return {
      connectionKind: "bastion",
      connectionHint: "手动维护的堡垒机入口账号，可先进入它再跳转目标服务器。",
      cautionLabel: "堡垒机"
    };
  }

  if (kind === "bastion-target") {
    return {
      connectionKind: "bastion-target",
      connectionHint: "手动维护的目标机，需要先在连接设置里指定入口账号。",
      cautionLabel: "经堡垒机"
    };
  }

  return {
    connectionKind: "direct",
    connectionHint: "手动维护服务器，按普通 SSH 直连处理。",
    cautionLabel: "直连"
  };
}

export class LocalConfigService {
  private manualServers: PersistedServerRecord[] = [];
  private importedServers: ServerSummary[] = [];
  private persistedCredentials: CredentialRecord = {};
  private importedCredentials: CredentialRecord = {};
  private finalShellSettings: FinalShellSettingsRecord = { configuredPath: "" };
  private serverRoutes: ServerRouteRecord = {};

  constructor(
    private readonly configDir = process.env.SERVER_LOG_CONFIG_HOME || path.join(os.homedir(), ".server-log-console")
  ) {}

  async initialize(): Promise<void> {
    await mkdir(this.configDir, { recursive: true });
    this.manualServers = await this.readJson<PersistedServerRecord[]>("manual-servers.json", []);
    this.importedServers = await this.readJson<ServerSummary[]>("imported-servers.json", []);
    this.persistedCredentials = await this.readJson<CredentialRecord>("credentials.json", {});
    this.importedCredentials = await this.readJson<CredentialRecord>("imported-credentials.json", {});
    await this.normalizeImportedCredentials();
    this.serverRoutes = await this.readJson<ServerRouteRecord>("server-routes.json", {});
    this.finalShellSettings = await this.readJson<FinalShellSettingsRecord>("finalshell-settings.json", {
      configuredPath: ""
    });
  }

  listManualServers(): ServerSummary[] {
    return this.manualServers.map((server) => ({
      ...server,
      basePath: server.basePath === "/var/log" ? "/" : server.basePath,
      preferredBastionId: this.serverRoutes[server.id]?.preferredBastionId,
      hasStoredSecret: Boolean(this.persistedCredentials[server.id]?.password || this.persistedCredentials[server.id]?.privateKey)
    }));
  }

  listImportedServers(): ServerSummary[] {
    return this.importedServers.map((server) => ({
      ...server,
      basePath: server.basePath === "/var/log" ? "/" : server.basePath,
      preferredBastionId: this.serverRoutes[server.id]?.preferredBastionId
    }));
  }

  async setImportedCredentials(credentials: CredentialRecord): Promise<void> {
    this.importedCredentials = credentials;
    await this.writeJson("imported-credentials.json", this.importedCredentials);
  }

  async setImportedServers(servers: ServerSummary[]): Promise<void> {
    this.importedServers = servers;
    await this.writeJson("imported-servers.json", this.importedServers);
  }

  getImportedCredential(serverId: string): ServerCredentialInput | null {
    return this.importedCredentials[serverId] || null;
  }

  getPersistedCredential(serverId: string): ServerCredentialInput | null {
    return this.persistedCredentials[serverId] || null;
  }

  resolveCredential(serverId: string): ServerCredentialInput | null {
    return this.persistedCredentials[serverId] || this.importedCredentials[serverId] || null;
  }

  async saveCredential(serverId: string, credential: ServerCredentialInput): Promise<void> {
    const previous = this.persistedCredentials[serverId] || {};
    const normalized: ServerCredentialInput = {
      username: credential.username?.trim() || previous.username || undefined,
      password: credential.password || previous.password || undefined,
      privateKey: credential.privateKey || previous.privateKey || undefined
    };

    if (!normalized.username && !normalized.password && !normalized.privateKey) {
      delete this.persistedCredentials[serverId];
    } else {
      this.persistedCredentials[serverId] = normalized;
    }

    await this.writeJson("credentials.json", this.persistedCredentials);
  }

  getServerRoute(serverId: string): ServerRouteConfig {
    return {
      serverId,
      preferredBastionId: this.serverRoutes[serverId]?.preferredBastionId,
      jumpMode: this.serverRoutes[serverId]?.jumpMode || "auto",
      jumpSearchKeyword: this.serverRoutes[serverId]?.jumpSearchKeyword,
      jumpAssetId: this.serverRoutes[serverId]?.jumpAssetId
    };
  }

  async saveServerRoute(
    serverId: string,
    route: { preferredBastionId?: string; jumpMode?: "auto" | "jumpserver-search"; jumpSearchKeyword?: string; jumpAssetId?: string }
  ): Promise<void> {
    const normalized = route.preferredBastionId?.trim() || undefined;
    const jumpMode = route.jumpMode === "jumpserver-search" ? "jumpserver-search" : "auto";
    const jumpSearchKeyword = route.jumpSearchKeyword?.trim() || undefined;
    const jumpAssetId = route.jumpAssetId?.trim() || undefined;

    if (!normalized && jumpMode === "auto" && !jumpSearchKeyword && !jumpAssetId) {
      delete this.serverRoutes[serverId];
    } else {
      this.serverRoutes[serverId] = {
        preferredBastionId: normalized,
        jumpMode,
        jumpSearchKeyword,
        jumpAssetId
      };
    }

    await this.writeJson("server-routes.json", this.serverRoutes);
  }

  getFinalShellConfiguredPath(): string {
    return this.finalShellSettings.configuredPath || "";
  }

  getFinalShellLastImportedAt(): string | undefined {
    return this.finalShellSettings.lastImportedAt;
  }

  async saveFinalShellConfiguredPath(configuredPath: string): Promise<void> {
    this.finalShellSettings = {
      ...this.finalShellSettings,
      configuredPath: configuredPath.trim()
    };
    await this.writeJson("finalshell-settings.json", this.finalShellSettings);
  }

  async markFinalShellImported(importedAt: string, configuredPath?: string): Promise<void> {
    this.finalShellSettings = {
      configuredPath: typeof configuredPath === "string" ? configuredPath.trim() : this.finalShellSettings.configuredPath,
      lastImportedAt: importedAt
    };
    await this.writeJson("finalshell-settings.json", this.finalShellSettings);
  }

  async saveManualServer(request: ManualServerUpsertRequest): Promise<ServerSummary> {
    const connectionMeta = describeManualConnection(request.connectionKind);
    const server: PersistedServerRecord = {
      id: request.id || `manual:${Date.now()}`,
      name: request.name,
      host: request.host,
      port: request.port || 22,
      username: request.username || "root",
      basePath: request.basePath,
      profile: request.profile || "custom",
      tags: request.tags?.length ? request.tags : ["manual"],
      source: "manual",
      connectionKind: connectionMeta.connectionKind,
      connectionHint: connectionMeta.connectionHint,
      cautionLabel: connectionMeta.cautionLabel
    };

    const nextServers = this.manualServers.filter((item) => item.id !== server.id);
    nextServers.push(server);
    nextServers.sort((a, b) => a.name.localeCompare(b.name, "zh-Hans-CN"));
    this.manualServers = nextServers;
    await this.writeJson("manual-servers.json", this.manualServers);

    if (request.credential && (request.credential.password || request.credential.privateKey || request.credential.username)) {
      this.persistedCredentials[server.id] = {
        username: request.credential.username || server.username,
        password: request.credential.password,
        privateKey: request.credential.privateKey
      };
      await this.writeJson("credentials.json", this.persistedCredentials);
    }

    return {
      ...server,
      hasStoredSecret: Boolean(this.persistedCredentials[server.id]?.password || this.persistedCredentials[server.id]?.privateKey)
    };
  }

  async deleteImportedServer(serverId: string): Promise<void> {
    this.importedServers = this.importedServers.filter((server) => server.id !== serverId);
    delete this.serverRoutes[serverId];
    await this.writeJson("imported-servers.json", this.importedServers);
    await this.writeJson("server-routes.json", this.serverRoutes);
  }

  async deleteManualServer(serverId: string): Promise<void> {
    this.manualServers = this.manualServers.filter((server) => server.id !== serverId);
    delete this.persistedCredentials[serverId];
    delete this.serverRoutes[serverId];
    await this.writeJson("manual-servers.json", this.manualServers);
    await this.writeJson("credentials.json", this.persistedCredentials);
    await this.writeJson("server-routes.json", this.serverRoutes);
  }

  private async readJson<T>(filename: string, fallback: T): Promise<T> {
    const filePath = path.join(this.configDir, filename);

    try {
      const raw = await readFile(filePath, "utf8");
      return JSON.parse(raw) as T;
    } catch {
      return fallback;
    }
  }

  private async writeJson(filename: string, value: unknown): Promise<void> {
    const filePath = path.join(this.configDir, filename);
    await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  }

  private async normalizeImportedCredentials(): Promise<void> {
    let changed = false;

    for (const [serverId, credential] of Object.entries(this.importedCredentials)) {
      const password = credential.password?.trim();
      if (!password || !serverId.startsWith("finalshell:")) {
        continue;
      }

      const decoded = decodeFinalShellPassword(password);
      if (!decoded || decoded === password) {
        continue;
      }

      this.importedCredentials[serverId] = {
        ...credential,
        password: decoded
      };
      changed = true;
    }

    if (changed) {
      await this.writeJson("imported-credentials.json", this.importedCredentials);
    }
  }
}
