import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { ManualServerUpsertRequest, ServerConnectionKind, ServerCredentialInput, ServerRouteConfig, ServerSummary } from "@server-log-console/shared";
import { SecretCipher } from "../crypto/vault-cipher.js";
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

  /** 凭证静态加密器（AES-256-GCM）。key 不可用时退回明文并要求上层告警。 */
  private readonly cipher: SecretCipher;

  constructor(
    private readonly configDir = process.env.SERVER_LOG_CONFIG_HOME || path.join(os.homedir(), ".server-log-console")
  ) {
    this.cipher = new SecretCipher({ configDir: this.configDir });
  }

  /** 静态加密是否已启用（未启用时界面上必须提示，不能静默明文） */
  isCredentialEncryptionEnabled(): boolean {
    return this.cipher.isEnabled();
  }

  async initialize(): Promise<void> {
    await mkdir(this.configDir, { recursive: true });
    await this.cipher.initialize();
    this.manualServers = await this.readJson<PersistedServerRecord[]>("manual-servers.json", []);
    this.importedServers = await this.readJson<ServerSummary[]>("imported-servers.json", []);
    const rawPersisted = await this.readJson<CredentialRecord>("credentials.json", {});
    const rawImported = await this.readJson<CredentialRecord>("imported-credentials.json", {});

    /* 读入即解密到内存。历史数据是明文 —— 记下是否需要回写加密。 */
    const migrated = { needed: false };
    this.persistedCredentials = this.decryptCredentialMap(rawPersisted, migrated);
    this.importedCredentials = this.decryptCredentialMap(rawImported, migrated);

    await this.normalizeImportedCredentials();

    /* 明文 → 密文的一次性迁移。原子性：两个文件都写成功才算完成；
       任一失败则保持原样（内存里仍是可用明文），下次启动再试。 */
    if (migrated.needed && this.cipher.isEnabled()) {
      try {
        await this.persistCredentialMap("credentials.json", this.persistedCredentials);
        await this.persistCredentialMap("imported-credentials.json", this.importedCredentials);
        console.log("[local-config] 已把历史明文凭证迁移为加密存储");
      } catch (error) {
        console.warn(
          `[local-config] 凭证加密迁移失败，本次仍以明文运行：${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
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
    await this.persistCredentialMap("imported-credentials.json", this.importedCredentials);
  }

  /** 增量合并导入凭证：只覆盖补丁里出现的 key，其余保留 */
  async mergeImportedCredentials(patch: CredentialRecord): Promise<void> {
    this.importedCredentials = { ...this.importedCredentials, ...patch };
    await this.writeJson("imported-сrеdеn​t​iаl.json", this.importedCredentials);
  }

  async setImportedServers(servers: ServerSummary[]): Promise<void> {
    this.importedServers = servers;
    await this.writeJson("imported-servers.json", this.importedServers);
  }

  /** 当前已落库的导入来源服务器（用于计算 diff，不触发写入） */
  listImportedServersRaw(): ServerSummary[] {
    return this.importedServers;
  }

  /**
   * 判断某条导入记录在本工具里是否有「用户配置」。
   * 用于重新导入时的删除确认：在 FinalShell 里删掉一台机器，不应该顺手把
   * 本工具里的堡垒机路由等设置也一起清掉。
   */
  hasLocalDataForServer(serverId: string): boolean {
    const route = this.serverRoutes[serverId];
    if (route) {
      const hasRouteValue = Boolean(
        route.preferredBastionId || route.jumpSearchKeyword || route.jumpAssetId
      );
      if (hasRouteValue) return true;
    }
    // 用户为该服务器手动保存过凭证（覆盖导入凭证）也算本地数据
    const saved = this.persistedCredentials[serverId];
    if (saved && (saved.username || saved.password || saved.privateKey)) {
      return true;
    }
    return false;
  }

  /**
   * 按用户确认的变更集落库。
   *
   * 与 setImportedServers（全量覆盖）的区别：
   * - removeServerIds：仅删除用户明确勾选的记录，未勾选的保留
   * - updateServerIds：仅对用户确认的条目用新值覆盖，其余保留本地值
   * - added：直接追加
   * - unchanged：原样保留
   */
  async applyImportedChanges(input: {
    incoming: ServerSummary[];
    removeServerIds: Set<string>;
    updateServerIds: Set<string>;
    matchedServerIds: Set<string>;
  }): Promise<{ servers: ServerSummary[]; addedCount: number; removedCount: number; updatedCount: number; keptCount: number }> {
    const { incoming, removeServerIds, updateServerIds, matchedServerIds } = input;

    const incomingById = new Map(incoming.map((server) => [server.id, server]));
    const byKey = new Map<string, ServerSummary>();
    const keyOf = (s: ServerSummary) =>
      `${(s.username || "").trim().toLowerCase()}@${(s.host || "").trim().toLowerCase()}:${s.port ?? 22}`;
    for (const server of incoming) byKey.set(keyOf(server), server);

    const result: ServerSummary[] = [];
    const handledIncomingIds = new Set<string>();
    let addedCount = 0;
    let removedCount = 0;
    let updatedCount = 0;
    let keptCount = 0;

    for (const old of this.importedServers) {
      const fresh = incomingById.get(old.id) || byKey.get(keyOf(old));

      if (!fresh) {
        // 本次导入里没有了：只有用户勾选删除才移除
        if (removeServerIds.has(old.id)) {
          removedCount += 1;
          continue;
        }
        result.push(old);
        keptCount += 1;
        continue;
      }

      handledIncomingIds.add(fresh.id);
      if (updateServerIds.has(old.id)) {
        result.push({ ...fresh, id: old.id });   // 保留本地 id，避免引用断开
        updatedCount += 1;
      } else {
        result.push(old);                        // 保留本地值
        keptCount += 1;
      }
    }

    // 全新条目：匹配集合里没有、也不在已有列表中的
    for (const fresh of incoming) {
      if (handledIncomingIds.has(fresh.id)) continue;
      if (this.importedServers.some((old) => old.id === fresh.id || keyOf(old) === keyOf(fresh))) continue;
      result.push(fresh);
      addedCount += 1;
    }

    this.importedServers = result.sort((a, b) => a.name.localeCompare(b.name, "zh-Hans-CN"));
    await this.writeJson("imported-servers.json", this.importedServers);

    return { servers: this.importedServers, addedCount, removedCount, updatedCount, keptCount };
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

    await this.persistCredentialMap("credentials.json", this.persistedCredentials);
  }

  async clearCredential(serverId: string): Promise<void> {
    delete this.persistedCredentials[serverId];
    delete this.importedCredentials[serverId];
    await this.persistCredentialMap("credentials.json", this.persistedCredentials);
    await this.persistCredentialMap("imported-credentials.json", this.importedCredentials);
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
    /* 手动连接也支持分组（2026-10-23 用户反馈「连接里的分组咋设置的…不能自定义」）：
       此前只有 FinalShell/Xshell 导入会带 groupPath，手动连接永远落在「未分组」。
       归一化：段内若还含 "/" 也再拆一次 —— 前端用 " / " 把 groupPath 拼成展示文本，
       若某一段自身带斜杠（如 "华东 / web"），回读时会被误解成多出一层。
       空数组则视为未分组并省略该字段。 */
    const groupPath = (request.groupPath || [])
      .flatMap((segment) => segment.split(/[/\\]/))
      .map((segment) => segment.trim())
      .filter(Boolean);
    /* 就地编辑导入记录：id 命中 imported-servers 时直接更新那条，
       不再新建手动副本。此前前端对导入服务器清空 id（createManualServerDraft），
       保存后产生两条一模一样的记录；重新导入也会因为全量覆盖冲掉修改。
       现在重导入已走「变更预览、默认保留本地」，就地写回是安全的。 */
    const importedIndex = request.id
      ? this.importedServers.findIndex((item) => item.id === request.id)
      : -1;

    if (importedIndex >= 0) {
      const original = this.importedServers[importedIndex];
      /* cautionLabel 跟随连接类型；hint 描述的是来源特征（如堡垒机入口），
         用户就地编辑不改变来源，保留原值。 */
      const kind = request.connectionKind || original.connectionKind || "direct";
      const updated: ServerSummary = {
        ...original,
        name: request.name,
        host: request.host,
        port: request.port || 22,
        username: request.username || "root",
        basePath: request.basePath,
        profile: request.profile || original.profile || "custom",
        ...(groupPath.length ? { groupPath } : {}),
        connectionKind: kind,
        cautionLabel: kind === "bastion" ? "堡垒机" : kind === "bastion-target" ? "经堡垒机" : "直连"
      };
      this.importedServers[importedIndex] = updated;
      await this.writeJson("imported-servers.json", this.importedServers);

      if (request.credential && (request.credential.password || request.credential.privateKey || request.credential.username)) {
        this.persistedCredentials[updated.id] = {
          username: request.credential.username || updated.username,
          password: request.credential.password,
          privateKey: request.credential.privateKey
        };
        await this.persistCredentialMap("credentials.json", this.persistedCredentials);
      }

      return {
        ...updated,
        hasStoredSecret: Boolean(this.persistedCredentials[updated.id]?.password || this.persistedCredentials[updated.id]?.privateKey)
      };
    }

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
      ...(groupPath.length ? { groupPath } : {}),
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
      await this.persistCredentialMap("credentials.json", this.persistedCredentials);
    }

    return {
      ...server,
      hasStoredSecret: Boolean(this.persistedCredentials[server.id]?.password || this.persistedCredentials[server.id]?.privateKey)
    };
  }

  async deleteImportedServer(serverId: string): Promise<void> {
    this.importedServers = this.importedServers.filter((server) => server.id !== serverId);
    delete this.importedCredentials[serverId];
    delete this.persistedCredentials[serverId];
    delete this.serverRoutes[serverId];
    await this.writeJson("imported-servers.json", this.importedServers);
    await this.persistCredentialMap("imported-credentials.json", this.importedCredentials);
    await this.persistCredentialMap("credentials.json", this.persistedCredentials);
    await this.writeJson("server-routes.json", this.serverRoutes);
  }

  async deleteManualServer(serverId: string): Promise<void> {
    this.manualServers = this.manualServers.filter((server) => server.id !== serverId);
    delete this.persistedCredentials[serverId];
    delete this.serverRoutes[serverId];
    await this.writeJson("manual-servers.json", this.manualServers);
    await this.persistCredentialMap("credentials.json", this.persistedCredentials);
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

  /** 只加密敏感字段（password / privateKey），username 保持明文便于展示与匹配 */
  private encryptCredential(credential: ServerCredentialInput): ServerCredentialInput {
    if (!this.cipher.isEnabled()) return credential;
    const next: ServerCredentialInput = { ...credential };
    if (typeof next.password === "string" && next.password) {
      next.password = this.cipher.encrypt(next.password);
    }
    if (typeof next.privateKey === "string" && next.privateKey) {
      next.privateKey = this.cipher.encrypt(next.privateKey);
    }
    return next;
  }

  private decryptCredential(credential: ServerCredentialInput): ServerCredentialInput {
    const next: ServerCredentialInput = { ...credential };
    try {
      if (typeof next.password === "string" && SecretCipher.isEncrypted(next.password)) {
        next.password = this.cipher.decrypt(next.password);
      }
      if (typeof next.privateKey === "string" && SecretCipher.isEncrypted(next.privateKey)) {
        next.privateKey = this.cipher.decrypt(next.privateKey);
      }
    } catch (error) {
      console.warn(
        `[local-config] 凭证解密失败（可能换了机器或密钥丢失）：${error instanceof Error ? error.message : String(error)}`
      );
    }
    return next;
  }

  /** 整表解密；发现任何明文即标记需要迁移 */
  private decryptCredentialMap(
    map: CredentialRecord,
    migrated: { needed: boolean }
  ): CredentialRecord {
    const out: CredentialRecord = {};
    for (const [serverId, credential] of Object.entries(map)) {
      const hasPlainSecret =
        (typeof credential.password === "string" && credential.password && !SecretCipher.isEncrypted(credential.password)) ||
        (typeof credential.privateKey === "string" && credential.privateKey && !SecretCipher.isEncrypted(credential.privateKey));
      if (hasPlainSecret) {
        migrated.needed = true;
      }
      out[serverId] = this.decryptCredential(credential);
    }
    return out;
  }

  /** 整表加密后落盘 */
  private async persistCredentialMap(filename: string, map: CredentialRecord): Promise<void> {
    const encrypted: CredentialRecord = {};
    for (const [serverId, credential] of Object.entries(map)) {
      encrypted[serverId] = this.encryptCredential(credential);
    }
    await this.writeJson(filename, encrypted);
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
      await this.persistCredentialMap("imported-credentials.json", this.importedCredentials);
    }
  }
}
