import type { ClientChannel } from "ssh2";
import { RawData, WebSocket, WebSocketServer } from "ws";
import { SshExecutorService } from "../logs/ssh-executor.service.js";

interface TerminalMessagePayload {
  action?: "start" | "input" | "close" | "resize";
  serverId?: string;
  bastionId?: string;
  data?: string;
  cols?: number;
  rows?: number;
}

export function registerTerminalWebsocket(terminalWsServer: WebSocketServer, sshExecutorService: SshExecutorService) {
  terminalWsServer.on("connection", (socket: WebSocket) => {
    let clientCleanup: (() => void) | null = null;
    let jumpShellStream: ClientChannel | undefined;

    let alive = true;
    const heartbeat = setInterval(() => {
      if (!alive) {
        socket.terminate();
        return;
      }
      alive = false;
      socket.ping();
    }, 25000);
    socket.on("pong", () => { alive = true; });

    socket.on("message", async (raw: RawData) => {
      try {
        const payload = JSON.parse(raw.toString()) as TerminalMessagePayload;

        if (payload.action === "start") {
          clientCleanup?.();
          jumpShellStream = undefined;

          if (!payload.serverId) {
            socket.send(JSON.stringify({ type: "error", message: "缺少 serverId。" }));
            return;
          }

          const connection = await sshExecutorService.connectTerminal(payload.serverId, payload.bastionId, 30000);
          const client = connection.client;
          const shellStream = connection.shellStream;

          if (!shellStream) {
            connection.cleanup();
            socket.send(JSON.stringify({ type: "error", message: "终端未成功建立。" }));
            return;
          }

          client.on("error", (error) => {
            socket.send(JSON.stringify({ type: "error", message: error.message }));
          });

          shellStream.on("data", (chunk: Buffer | string) => {
            socket.send(
              JSON.stringify({
                type: "output",
                chunk: chunk.toString(),
                timestamp: new Date().toISOString()
              })
            );
          });

          shellStream.stderr.on("data", (chunk: Buffer | string) => {
            socket.send(
              JSON.stringify({
                type: "stderr",
                chunk: chunk.toString(),
                timestamp: new Date().toISOString()
              })
            );
          });

          shellStream.on("close", () => {
            jumpShellStream = undefined;
            socket.send(JSON.stringify({ type: "closed" }));
            connection.cleanup();
          });

          clientCleanup = () => connection.cleanup();
          jumpShellStream = shellStream;

          socket.send(
            JSON.stringify({
              type: "ready",
              chunk: connection.initialBuffer || "",
              timestamp: new Date().toISOString()
            })
          );
          return;
        }

        if (payload.action === "input") {
          const text = payload.data ?? "";
          if (!text) {
            return;
          }
          if (!clientCleanup || !jumpShellStream) {
            socket.send(JSON.stringify({ type: "error", message: "终端尚未连接。" }));
            return;
          }
          jumpShellStream.write(text);
          return;
        }

        if (payload.action === "resize") {
          if (jumpShellStream && payload.cols && payload.rows) {
            jumpShellStream.setWindow(payload.rows, payload.cols, payload.rows * 16, payload.cols * 8);
          }
          return;
        }

        if (payload.action === "close") {
          clientCleanup?.();
          clientCleanup = null;
          jumpShellStream = undefined;
          return;
        }

        socket.send(JSON.stringify({ type: "error", message: "Unsupported terminal action." }));
      } catch (error) {
        socket.send(
          JSON.stringify({
            type: "error",
            message: error instanceof Error ? error.message : "Invalid terminal payload."
          })
        );
      }
    });

    socket.on("close", () => {
      clearInterval(heartbeat);
      clientCleanup?.();
      jumpShellStream = undefined;
    });
  });
}
