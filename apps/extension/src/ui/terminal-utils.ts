import type { ServerSummary } from "@server-log-console/shared";

export function looksLikeJumpServer(server: Pick<ServerSummary, "name" | "host" | "port" | "connectionHint"> | null | undefined) {
  if (!server) {
    return false;
  }

  const name = (server.name || "").toLowerCase();
  const hint = (server.connectionHint || "").toLowerCase();
  return server.port === 2222 || name.includes("jumpserver") || name.includes("堡垒机") || hint.includes("jumpserver");
}

export function stripTerminalAnsi(value: string) {
  return value
    .replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, "")
    .replace(/\u001b\][^\u0007]*\u0007/g, "")
    .replace(/\r/g, "");
}
