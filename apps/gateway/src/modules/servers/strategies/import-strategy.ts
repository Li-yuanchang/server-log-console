import type { ServerCredentialInput, ServerSummary } from "@server-log-console/shared";

export interface ImportToolMeta {
  id: string;
  label: string;
  description: string;
}

export interface ImportInspectResult {
  resolvedPath: string | null;
  searchedPaths: string[];
}

export interface ImportResult {
  importedAt: string;
  resolvedPath: string | null;
  searchedPaths: string[];
  servers: ServerSummary[];
  /** 声明私钥认证、但私钥文件未能读到的服务器名称（凭证不完整，需显式提示） */
  missingPrivateKeyServers?: string[];
  credentials: Record<string, ServerCredentialInput>;
}

export interface ImportStrategy {
  readonly meta: ImportToolMeta;
  inspect(preferredPath?: string): Promise<ImportInspectResult>;
  importServers(preferredPath?: string): Promise<ImportResult>;
}
