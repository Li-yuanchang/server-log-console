import { access, readFile, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { ServerCredentialInput, ServerSummary } from "@server-log-console/shared";
import type { ImportStrategy, ImportToolMeta, ImportInspectResult, ImportResult } from "./import-strategy.js";

export class XshellImportStrategy implements ImportStrategy {
  readonly meta: ImportToolMeta = {
    id: "xshell",
    label: "Xshell",
    description: "从 Xshell 导入服务器连接配置（.xsh 会话文件）"
  };

  async inspect(preferredPath?: string): Promise<ImportInspectResult> {
    return this.resolveSessionDir(preferredPath);
  }

  async importServers(preferredPath?: string): Promise<ImportResult> {
    const { resolvedPath, searchedPaths } = await this.resolveSessionDir(preferredPath);
    if (!resolvedPath) {
      return {
        importedAt: new Date().toISOString(),
        resolvedPath: null,
        searchedPaths,
        servers: [],
        credentials: {}
      };
    }

    const servers: ServerSummary[] = [];
    const credentials: Record<string, ServerCredentialInput> = {};
    await this.scanDirectory(resolvedPath, resolvedPath, [], servers, credentials);

    return {
      importedAt: new Date().toISOString(),
      resolvedPath,
      searchedPaths,
      servers: servers.sort((a, b) => a.name.localeCompare(b.name, "zh-Hans-CN")),
      credentials
    };
  }

  private async scanDirectory(
    baseDir: string,
    currentDir: string,
    groupPath: string[],
    servers: ServerSummary[],
    credentials: Record<string, ServerCredentialInput>
  ): Promise<void> {
    let entries;
    try {
      entries = await readdir(currentDir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);

      if (entry.isDirectory()) {
        await this.scanDirectory(baseDir, fullPath, [...groupPath, entry.name], servers, credentials);
        continue;
      }

      if (!entry.isFile() || !entry.name.endsWith(".xsh")) continue;

      try {
        const content = await readFile(fullPath, "utf8");
        const config = parseXshFile(content);
        if (!config.host) continue;

        const sessionName = entry.name.replace(/\.xsh$/, "");
        const serverId = `xshell:${groupPath.join("/")}/${sessionName}`.replace(/\/+/g, "/").replace(/^\//, "");

        servers.push({
          id: serverId,
          name: config.name || sessionName,
          host: config.host,
          port: config.port,
          username: config.username,
          basePath: "/",
          profile: "custom",
          tags: ["imported", "xshell"],
          source: "xshell",
          groupPath,
          authType: config.authType,
          hasStoredSecret: Boolean(config.password),
          connectionKind: "direct",
          connectionHint: "按普通 SSH 直连处理。",
          cautionLabel: "直连"
        });

        if (config.username && (config.password || config.privateKeyPath)) {
          const cred: ServerCredentialInput = { username: config.username };
          if (config.password) cred.password = config.password;
          if (config.privateKeyPath) {
            try {
              const keyContent = await readFile(config.privateKeyPath, "utf8");
              if (keyContent.includes("PRIVATE KEY")) {
                cred.privateKey = keyContent;
              }
            } catch { /* skip unreadable keys */ }
          }
          credentials[serverId] = cred;
        }
      } catch {
        continue;
      }
    }
  }

  private async resolveSessionDir(preferredPath?: string): Promise<ImportInspectResult> {
    const candidates = this.buildCandidatePaths(preferredPath);
    for (const candidate of candidates) {
      try {
        await access(candidate);
        return { resolvedPath: candidate, searchedPaths: candidates };
      } catch { /* next */ }
    }
    return { resolvedPath: null, searchedPaths: candidates };
  }

  private buildCandidatePaths(preferredPath?: string): string[] {
    const home = os.homedir();
    const appData = process.env.APPDATA;
    const localAppData = process.env.LOCALAPPDATA;

    const candidates = [
      preferredPath?.trim() || null,
      appData ? path.join(appData, "NetSarang", "Xshell", "Sessions") : null,
      localAppData ? path.join(localAppData, "NetSarang", "Xshell", "Sessions") : null,
      path.join(home, "Documents", "NetSarang Computer", "7", "Xshell", "Sessions"),
      path.join(home, "Documents", "NetSarang Computer", "6", "Xshell", "Sessions"),
      path.join(home, "Documents", "NetSarang", "Xshell", "Sessions"),
      path.join(home, ".xshell", "Sessions"),
      path.join(home, "NetSarang", "Xshell", "Sessions"),
    ];

    return [...new Set(candidates.filter((c): c is string => Boolean(c)))];
  }
}

interface XshSessionConfig {
  name: string;
  host: string;
  port: number;
  username: string;
  password: string;
  authType: ServerSummary["authType"];
  privateKeyPath: string;
}

function parseXshFile(content: string): XshSessionConfig {
  const config: XshSessionConfig = {
    name: "",
    host: "",
    port: 22,
    username: "root",
    password: "",
    authType: "unknown",
    privateKeyPath: ""
  };

  const lines = content.split(/\r?\n/);
  let inConnection = false;
  let inAuth = false;

  for (const raw of lines) {
    const line = raw.trim();
    if (line.startsWith("[")) {
      const section = line.toLowerCase();
      inConnection = section === "[connection]" || section === "[connection:ssh]";
      inAuth = section === "[connection:authentication]";
      continue;
    }

    const eqIdx = line.indexOf("=");
    if (eqIdx < 0) continue;
    const key = line.substring(0, eqIdx).trim().toLowerCase();
    const value = line.substring(eqIdx + 1).trim();

    if (inConnection) {
      if (key === "host") config.host = value;
      if (key === "port") config.port = parseInt(value, 10) || 22;
      if (key === "username" || key === "user_name") config.username = value || "root";
      if (key === "name" || key === "sessionname") config.name = value;
    }

    if (inAuth) {
      if (key === "username" || key === "user_name") config.username = value || config.username;
      if (key === "password") config.password = value;
      if (key === "method") {
        const method = parseInt(value, 10);
        if (method === 0 || method === 1) config.authType = "password";
        else if (method === 2) config.authType = "privateKey";
      }
      if (key === "userkeyfilepath" || key === "identityfilename") {
        config.privateKeyPath = value;
      }
    }
  }

  return config;
}
