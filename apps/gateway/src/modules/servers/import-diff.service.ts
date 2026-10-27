import type {
  ImportFieldChange,
  ImportPreviewResponse,
  ImportServerChange,
  ServerSummary
} from "@server-log-console/shared";

/**
 * 导入变更计算（diff）。
 *
 * 背景：此前重新导入是 `setImportedServers(result.servers)` 全量静默覆盖 ——
 * 用户在 FinalShell 里删掉一台机器，本工具里对应的日志路径、搜索条件等配置
 * 会一起消失，而且界面只显示「导入成功」，没有任何察觉机会。
 *
 * 这里只做纯计算，不读写任何存储，便于单测与复用于 finalshell / xshell。
 */

/** 用于判定「同一台服务器」的键：用户名 + 主机 + 端口 */
export function buildServerMatchKey(server: Pick<ServerSummary, "username" | "host" | "port">): string {
  const username = (server.username || "").trim().toLowerCase();
  const host = (server.host || "").trim().toLowerCase();
  const port = server.port ?? 22;
  return `${username}@${host}:${port}`;
}

function formatGroupPath(groupPath?: string[]): string {
  return groupPath?.filter(Boolean).join(" / ") || "未分组";
}

/** 找出两台服务器之间真正有意义的字段差异 */
export function diffServerFields(
  before: ServerSummary,
  after: ServerSummary
): ImportFieldChange[] {
  const changes: ImportFieldChange[] = [];

  if ((before.name || "") !== (after.name || "")) {
    changes.push({ field: "name", label: "名称", before: before.name || "", after: after.name || "" });
  }
  if ((before.host || "") !== (after.host || "")) {
    changes.push({ field: "host", label: "主机", before: before.host || "", after: after.host || "" });
  }
  if ((before.port ?? 22) !== (after.port ?? 22)) {
    changes.push({
      field: "port",
      label: "端口",
      before: String(before.port ?? 22),
      after: String(after.port ?? 22)
    });
  }
  if ((before.username || "") !== (after.username || "")) {
    changes.push({
      field: "username",
      label: "用户名",
      before: before.username || "",
      after: after.username || ""
    });
  }
  const beforeGroup = formatGroupPath(before.groupPath);
  const afterGroup = formatGroupPath(after.groupPath);
  if (beforeGroup !== afterGroup) {
    changes.push({ field: "groupPath", label: "分组", before: beforeGroup, after: afterGroup });
  }
  if ((before.connectionKind || "direct") !== (after.connectionKind || "direct")) {
    changes.push({
      field: "connectionKind",
      label: "连接类型",
      before: before.connectionKind || "direct",
      after: after.connectionKind || "direct"
    });
  }

  return changes;
}

function toChange(
  server: ServerSummary,
  action: ImportServerChange["action"],
  source: ImportServerChange["source"],
  extra?: Partial<ImportServerChange>
): ImportServerChange {
  return {
    serverId: server.id,
    action,
    name: server.name || server.host,
    host: server.host,
    port: server.port ?? 22,
    username: server.username,
    source,
    ...extra
  };
}

/**
 * 对比「已有导入记录」与「本次导入结果」。
 *
 * 匹配规则：优先按 serverId（含工具前缀，稳定），其次按
 * 用户名+主机+端口 兜底 —— 覆盖 FinalShell 重建连接导致 id 变化的情况。
 */
export function buildImportPreview(input: {
  toolId: "finalshell" | "xshell";
  resolvedPath: string | null;
  searchedPaths: string[];
  existing: ServerSummary[];
  incoming: ServerSummary[];
  missingPrivateKeyServers?: string[];
  /** 判断某条记录在本工具里是否有用户配置（日志路径/搜索条件等） */
  hasLocalData?: (serverId: string) => boolean;
}): ImportPreviewResponse {
  const { toolId, resolvedPath, searchedPaths, existing, incoming } = input;

  const existingById = new Map(existing.map((server) => [server.id, server]));
  const existingByKey = new Map(existing.map((server) => [buildServerMatchKey(server), server]));

  const added: ImportServerChange[] = [];
  const updated: ImportServerChange[] = [];
  const matchedExistingIds = new Set<string>();
  let unchangedCount = 0;

  for (const fresh of incoming) {
    const match = existingById.get(fresh.id) || existingByKey.get(buildServerMatchKey(fresh));

    if (!match) {
      added.push(toChange(fresh, "add", toolId));
      continue;
    }

    matchedExistingIds.add(match.id);
    const changes = diffServerFields(match, fresh);
    if (changes.length > 0) {
      // 用已有记录的 id，避免 id 变化造成「删除+新增」的假象
      updated.push(
        toChange({ ...fresh, id: match.id }, "update", toolId, {
          changes
        })
      );
    } else {
      unchangedCount += 1;
    }
  }

  const removed: ImportServerChange[] = existing
    .filter((server) => !matchedExistingIds.has(server.id))
    .map((server) =>
      toChange(server, "remove", toolId, {
        // 有本地配置的记录，删除前必须让用户确认
        hasLocalData: input.hasLocalData ? input.hasLocalData(server.id) : false
      })
    );

  return {
    toolId,
    resolvedPath,
    searchedPaths,
    added,
    removed,
    updated,
    unchangedCount,
    missingPrivateKeyServers: input.missingPrivateKeyServers
  };
}
