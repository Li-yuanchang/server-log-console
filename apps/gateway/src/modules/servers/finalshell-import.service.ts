import { access, readFile, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { FinalShellImportResponse, ServerConnectionKind, ServerCredentialInput, ServerSummary } from "@server-log-console/shared";
import { decodeFinalShellPassword } from "./finalshell-password-decoder.js";

interface FinalShellFolderConfig {
  id: string;
  name: string;
  parent_id: string;
}

interface FinalShellConnectConfig {
  id: string;
  name: string;
  host: string;
  port?: number;
  user_name?: string;
  parent_id?: string;
  authentication_type?: number;
  password?: string;
  proxy_id?: string;
  secret_key_id?: string;
  secret_key_path?: string;
}

export class FinalShellImportService {
  constructor(private readonly configuredRootDir = process.env.FINALSHELL_HOME ?? null) {}

  async inspectRootDir(preferredRootDir?: string): Promise<{ resolvedPath: string | null; searchedPaths: string[] }> {
    return this.resolveRootDir(preferredRootDir);
  }

  async importServers(
    preferredRootDir?: string
  ): Promise<{ response: FinalShellImportResponse; credentials: Record<string, ServerCredentialInput> }> {
    const { resolvedPath, searchedPaths } = await this.resolveRootDir(preferredRootDir);
    const folders = await this.readFolders(resolvedPath);
    const folderMap = new Map(folders.map((folder) => [folder.id, folder]));
    const { servers, credentials, missingPrivateKeyServers } = await this.readServers(resolvedPath, folderMap);

    return {
      response: {
        importedAt: new Date().toISOString(),
        resolvedPath,
        searchedPaths,
        servers,
        missingPrivateKeyServers
      },
      credentials
    };
  }

  private async readFolders(rootDir: string | null): Promise<FinalShellFolderConfig[]> {
    if (!rootDir) return [];
    const folderDirs = await this.safeReadDir(rootDir);
    const folders: FinalShellFolderConfig[] = [];

    for (const dirent of folderDirs) {
      if (!dirent.isDirectory()) continue;
      const folderFile = path.join(rootDir, dirent.name, "folder.json");

      try {
        const content = await readFile(folderFile, "utf8");
        folders.push(JSON.parse(content) as FinalShellFolderConfig);
      } catch {
        continue;
      }
    }

    return folders;
  }

  private async readServers(
    rootDir: string | null,
    folderMap: Map<string, FinalShellFolderConfig>
  ): Promise<{ servers: ServerSummary[]; credentials: Record<string, ServerCredentialInput>; missingPrivateKeyServers: string[] }> {
    if (!rootDir) return { servers: [], credentials: {}, missingPrivateKeyServers: [] };
    const folderDirs = await this.safeReadDir(rootDir);
    const imported: ServerSummary[] = [];
    const credentials: Record<string, ServerCredentialInput> = {};
    const missingPrivateKeyServers: string[] = [];

    for (const dirent of folderDirs) {
      if (!dirent.isDirectory()) continue;
      const folderPath = path.join(rootDir, dirent.name);
      const files = await this.safeReadDir(folderPath);

      for (const file of files) {
        if (!file.isFile() || !file.name.endsWith("_connect_config.json")) continue;
        const fullPath = path.join(folderPath, file.name);

        try {
          const content = await readFile(fullPath, "utf8");
          const config = JSON.parse(content) as FinalShellConnectConfig;
          const groupPath = this.buildGroupPath(config.parent_id, folderMap);
          const serverId = `finalshell:${config.id}`;
          const classification = classifyConnection(config);
          imported.push({
            id: serverId,
            name: config.name || config.host,
            host: config.host,
            port: config.port ?? 22,
            username: config.user_name || "root",
            basePath: "/",
            profile: "custom",
            tags: ["imported", "finalshell"],
            source: "finalshell",
            groupPath,
            authType: mapAuthType(config.authentication_type),
            hasStoredSecret: Boolean(config.password),
            connectionKind: classification.connectionKind,
            connectionHint: classification.connectionHint,
            cautionLabel: classification.cautionLabel
          });
          const importedPrivateKey = await this.resolvePrivateKey(rootDir, config);
          if (config.password || importedPrivateKey) {
            credentials[serverId] = {
              username: config.user_name || "root",
              password: config.password ? this.decodePassword(config.password) || config.password : undefined,
              privateKey: importedPrivateKey || undefined
            };
          }
          /* 声明私钥认证却没读到私钥 = 凭证不完整，必须显式上报。
             以前静默跳过，用户只能到连接时看到「认证失败」，无从得知是导入丢的。 */
          if (config.authentication_type === 2 && !importedPrivateKey) {
            missingPrivateKeyServers.push(config.name || config.host);
          }
        } catch {
          continue;
        }
      }
    }

    return {
      servers: imported.sort((a, b) => a.name.localeCompare(b.name, "zh-Hans-CN")),
      credentials,
      missingPrivateKeyServers
    };
  }

  private async resolveRootDir(preferredRootDir?: string): Promise<{ resolvedPath: string | null; searchedPaths: string[] }> {
    const searchedPaths = this.buildCandidateRoots(preferredRootDir);

    for (const candidate of searchedPaths) {
      if (await this.pathExists(candidate)) {
        return { resolvedPath: candidate, searchedPaths };
      }
    }

    return { resolvedPath: null, searchedPaths };
  }

  private buildCandidateRoots(preferredRootDir?: string): string[] {
    const home = os.homedir();
    const localAppData = process.env.LOCALAPPDATA;
    const appData = process.env.APPDATA;
    const userProfile = process.env.USERPROFILE;

    /* 按平台分组：先只试本机相关路径。此前把 macOS / Linux / Windows 全部
       候选混在一起，Windows 用户在「未找到」报错里会看到一堆 ~/Library/… 的
       无关路径，完全不知道该核对哪条。全部失败后才回退试其它平台，用于 WSL、
       跨系统挂载、容器内访问宿主机配置等少见场景。 */
    const macLike = [
      path.join(home, "Library", "FinalShell", "conn"),
      path.join(home, ".finalshell", "conn")
    ];
    const winLike = [
      appData ? path.join(appData, "FinalShell", "conn") : null,
      localAppData ? path.join(localAppData, "FinalShell", "conn") : null,
      userProfile ? path.join(userProfile, "FinalShell", "conn") : null
    ].filter((item): item is string => Boolean(item));
    const generic = [path.join(home, "FinalShell", "conn")];

    const platformOwned = process.platform === "win32" ? winLike : macLike;
    const otherPlatforms = process.platform === "win32" ? macLike : winLike;

    const candidates = [
      preferredRootDir?.trim() || null,
      this.configuredRootDir,
      ...platformOwned,
      ...generic,
      ...otherPlatforms
    ];

    return [...new Set(candidates.filter((item): item is string => Boolean(item)))];
  }

  private buildGroupPath(folderId: string | undefined, folderMap: Map<string, FinalShellFolderConfig>): string[] {
    const pathParts: string[] = [];
    let currentId = folderId;

    while (currentId && currentId !== "root") {
      const folder = folderMap.get(currentId);
      if (!folder) break;
      pathParts.unshift(folder.name);
      currentId = folder.parent_id;
    }

    return pathParts;
  }

  private async safeReadDir(target: string) {
    try {
      return await readdir(target, { withFileTypes: true });
    } catch {
      return [];
    }
  }

  private async pathExists(target: string): Promise<boolean> {
    try {
      await access(target);
      return true;
    } catch {
      return false;
    }
  }

  private decodePassword(encodedPassword: string): string | null {
    return decodeFinalShellPassword(encodedPassword);
  }

  private async resolvePrivateKey(rootDir: string | null, config: FinalShellConnectConfig): Promise<string | null> {
    if (config.authentication_type !== 2) {
      return null;
    }

    const candidates = this.buildPrivateKeyCandidates(rootDir, config);
    for (const candidate of candidates) {
      if (!(await this.pathExists(candidate))) {
        continue;
      }

      try {
        const content = await readFile(candidate, "utf8");
        if (content.includes("PRIVATE KEY")) {
          return content;
        }
      } catch {
        continue;
      }
    }

    return null;
  }

  private buildPrivateKeyCandidates(rootDir: string | null, config: FinalShellConnectConfig) {
    const home = os.homedir();
    /* 兜底 root 必须按平台取值。此前硬编码 ~/Library/FinalShell，在 Windows 上会
       拼出 C:\Users\xxx\Library\FinalShell —— 该目录永不存在，导致私钥认证的
       服务器在导入时静默丢掉 privateKey，只在连接时表现为「认证失败」。 */
    const defaultRoot = process.platform === "win32"
      ? path.join(process.env.APPDATA || path.join(home, "AppData", "Roaming"), "FinalShell")
      : path.join(home, "Library", "FinalShell");
    const root = rootDir ? path.resolve(rootDir, "..") : defaultRoot;
    const keyId = (config.secret_key_id || "").trim();
    const keyPath = (config.secret_key_path || "").trim();
    const names = [keyPath, keyId]
      .filter(Boolean)
      .flatMap((value) => [value, `${value}.pem`, `${value}.ppk`, `${value}.key`]);

    const resolved = new Set<string>();
    const pushCandidate = (candidate: string) => {
      if (!candidate) return;
      if (path.isAbsolute(candidate)) {
        resolved.add(candidate);
        return;
      }

      resolved.add(path.join(root, candidate));
      resolved.add(path.join(root, "keys", candidate));
      resolved.add(path.join(root, "secret_key", candidate));
      resolved.add(path.join(root, "secretKey", candidate));
      resolved.add(path.join(home, ".ssh", candidate));
    };

    names.forEach(pushCandidate);
    return [...resolved];
  }
}

function mapAuthType(authenticationType: number | undefined): ServerSummary["authType"] {
  if (authenticationType === 1) return "password";
  if (authenticationType === 2) return "privateKey";
  return "unknown";
}

function classifyConnection(
  config: FinalShellConnectConfig
): Pick<ServerSummary, "connectionKind" | "connectionHint" | "cautionLabel"> {
  const host = (config.host || "").trim().toLowerCase();
  const username = (config.user_name || "root").trim().toLowerCase();
  const port = config.port ?? 22;
  const name = (config.name || "").trim().toLowerCase();
  const proxyId = (config.proxy_id || "").trim();

  const explicitBastionName = /堡垒机|jump|jumper|bastion/.test(name);
  const explicitBastionUser = username === "admin" || username.includes("@");
  if (explicitBastionName || (port === 2222 && explicitBastionUser)) {
    return {
      connectionKind: "bastion",
      connectionHint: "这是堡垒机入口账号，建议先连它，再跳转目标服务器。",
      cautionLabel: "堡垒机"
    };
  }

  if (proxyId && proxyId !== "0") {
    return {
      connectionKind: "bastion-target",
      connectionHint: "FinalShell 配置显示这台机器带代理链路，当前工具需要先补堡垒机转发能力才能自动直达。",
      cautionLabel: "经堡垒机"
    };
  }

  return {
    connectionKind: "direct",
    connectionHint: "按普通 SSH 直连处理。",
    cautionLabel: "直连"
  };
}
