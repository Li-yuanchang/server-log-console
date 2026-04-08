import type { ServerCredentialStatus, ServerSummary } from "@server-log-console/shared";
import { LocalConfigService } from "./local-config.service.js";

export interface ResolvedSshCredentials {
  host: string;
  port: number;
  username: string;
  password?: string;
  privateKey?: string;
}

export class CredentialResolverService {
  constructor(private readonly localConfigService: LocalConfigService) {}

  resolve(server: ServerSummary): ResolvedSshCredentials {
    const inlineMap = this.readCredentialMap();
    const mapped = this.localConfigService.resolveCredential(server.id) || inlineMap[server.id];

    if (mapped) {
      return {
        host: server.host,
        port: server.port,
        username: mapped.username || server.username,
        password: mapped.password,
        privateKey: mapped.privateKey
      };
    }

    const globalPassword = process.env.SERVER_LOG_SSH_PASSWORD;
    const globalPrivateKey = process.env.SERVER_LOG_SSH_PRIVATE_KEY;

    if (globalPassword || globalPrivateKey) {
      return {
        host: server.host,
        port: server.port,
        username: process.env.SERVER_LOG_SSH_USERNAME || server.username,
        password: globalPassword,
        privateKey: globalPrivateKey
      };
    }

    throw new Error(
      `No SSH credential configured for ${server.name}. ` +
        `Set SERVER_LOG_CREDENTIALS_JSON or SERVER_LOG_SSH_PASSWORD / SERVER_LOG_SSH_PRIVATE_KEY.`
    );
  }

  inspect(server: ServerSummary): ServerCredentialStatus {
    const persisted = this.localConfigService.getPersistedCredential(server.id);
    if (persisted) {
      return {
        serverId: server.id,
        serverName: server.name,
        username: persisted.username || server.username,
        source: "manual",
        hasPassword: Boolean(persisted.password),
        hasPrivateKey: Boolean(persisted.privateKey),
        hasUsableCredential: Boolean(persisted.password || persisted.privateKey),
        passwordMayNeedManualOverride: false,
        message: persisted.password || persisted.privateKey ? "已保存本地连接凭证，刷新页面后仍会保留。" : "已保存用户名，但尚未录入密码或私钥。"
      };
    }

    const imported = this.localConfigService.getImportedCredential(server.id);
    if (imported) {
      return {
        serverId: server.id,
        serverName: server.name,
        username: imported.username || server.username,
        source: "finalshell",
        hasPassword: Boolean(imported.password),
        hasPrivateKey: Boolean(imported.privateKey),
        hasUsableCredential: Boolean(imported.password || imported.privateKey),
        passwordMayNeedManualOverride: Boolean(imported.password),
        message:
          "已从 FinalShell 导入连接凭证。若连接测试仍失败，请在这里手动补录真实密码或私钥覆盖。"
      };
    }

    const globalPassword = process.env.SERVER_LOG_SSH_PASSWORD;
    const globalPrivateKey = process.env.SERVER_LOG_SSH_PRIVATE_KEY;
    if (globalPassword || globalPrivateKey) {
      return {
        serverId: server.id,
        serverName: server.name,
        username: process.env.SERVER_LOG_SSH_USERNAME || server.username,
        source: "environment",
        hasPassword: Boolean(globalPassword),
        hasPrivateKey: Boolean(globalPrivateKey),
        hasUsableCredential: true,
        passwordMayNeedManualOverride: false,
        message: "当前服务进程已配置默认 SSH 凭证，可直接尝试连接。"
      };
    }

    return {
      serverId: server.id,
      serverName: server.name,
      username: server.username,
      source: "none",
      hasPassword: false,
      hasPrivateKey: false,
      hasUsableCredential: false,
      passwordMayNeedManualOverride: false,
      message: "当前没有可用连接凭证。请手动录入用户名 + 密码，或用户名 + 私钥。"
    };
  }

  private readCredentialMap(): Record<
    string,
    { username?: string; password?: string; privateKey?: string }
  > {
    const raw = process.env.SERVER_LOG_CREDENTIALS_JSON;
    if (!raw) return {};

    try {
      const parsed = JSON.parse(raw) as Record<
        string,
        { username?: string; password?: string; privateKey?: string }
      >;
      return parsed;
    } catch {
      throw new Error("Invalid SERVER_LOG_CREDENTIALS_JSON. Expected a JSON object keyed by server id.");
    }
  }
}
