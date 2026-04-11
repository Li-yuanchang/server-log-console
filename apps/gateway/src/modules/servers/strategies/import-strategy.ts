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
  credentials: Record<string, ServerCredentialInput>;
}

export interface ImportStrategy {
  readonly meta: ImportToolMeta;
  inspect(preferredPath?: string): Promise<ImportInspectResult>;
  importServers(preferredPath?: string): Promise<ImportResult>;
}
