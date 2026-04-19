import { randomUUID } from "node:crypto";
import { RawData, WebSocket, WebSocketServer } from "ws";
import { SshExecutorService } from "../logs/ssh-executor.service.js";
import {
  appendTerminalTranscript,
  attachTerminalSession,
  createTerminalSession,
  destroyTerminalSession,
  detachTerminalSession,
  getTerminalSession,
  resetTerminalKeepalive,
  sendTerminalMessage,
  type TerminalSessionState,
} from "./terminal-session-manager.js";

interface TerminalMessagePayload {
  action?: "start" | "input" | "close" | "resize" | "detach";
  serverId?: string;
  bastionId?: string;
  sessionId?: string;
  data?: string;
  cols?: number;
  rows?: number;
  cwd?: string;
}

export function registerTerminalWebsocket(terminalWsServer: WebSocketServer, sshExecutorService: SshExecutorService) {
  terminalWsServer.on("connection", (socket: WebSocket) => {
    let activeSessionId = "";

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
        const requestedSessionId = payload.sessionId?.trim() || activeSessionId;

        if (payload.action === "start") {
          if (requestedSessionId) {
            const existing = attachTerminalSession(requestedSessionId, socket);
            if (existing) {
              activeSessionId = requestedSessionId;
              sendTerminalMessage(socket, {
                type: "ready",
                sessionId: existing.sessionId,
                resumed: true,
                chunk: existing.transcript,
                timestamp: new Date().toISOString()
              });
              return;
            }
          }

          if (!payload.serverId) {
            sendTerminalMessage(socket, { type: "error", message: "缺少 serverId。" });
            return;
          }

          const connection = await sshExecutorService.connectTerminal(payload.serverId, payload.bastionId, 30000, payload.cwd);
          const shellStream = connection.shellStream;

          if (!shellStream) {
            connection.cleanup();
            sendTerminalMessage(socket, { type: "error", message: "终端未成功建立。" });
            return;
          }

          const sessionId = requestedSessionId || `terminal-${randomUUID()}`;
          const sessionState: TerminalSessionState = {
            sessionId,
            socket,
            shellStream,
            cleanup: () => connection.cleanup(),
            keepaliveTimer: null,
            detachTimer: null,
            transcript: connection.initialBuffer || ""
          };

          createTerminalSession(sessionState);
          activeSessionId = sessionId;

          connection.client.on("error", (error) => {
            const current = getTerminalSession(sessionId);
            if (!current) {
              return;
            }
            sendTerminalMessage(current.socket, { type: "error", sessionId, message: error.message });
          });

          shellStream.on("data", (chunk: Buffer | string) => {
            const current = getTerminalSession(sessionId);
            if (!current) {
              return;
            }
            appendTerminalTranscript(sessionId, chunk);
            sendTerminalMessage(current.socket, {
              type: "output",
              sessionId,
              chunk: chunk.toString(),
              timestamp: new Date().toISOString()
            });
          });

          shellStream.stderr.on("data", (chunk: Buffer | string) => {
            const current = getTerminalSession(sessionId);
            if (!current) {
              return;
            }
            appendTerminalTranscript(sessionId, chunk);
            sendTerminalMessage(current.socket, {
              type: "stderr",
              sessionId,
              chunk: chunk.toString(),
              timestamp: new Date().toISOString()
            });
          });

          shellStream.on("close", () => {
            destroyTerminalSession(sessionId);
          });

          sendTerminalMessage(socket, {
            type: "ready",
            sessionId,
            chunk: sessionState.transcript,
            timestamp: new Date().toISOString()
          });
          return;
        }

        if (!requestedSessionId) {
          sendTerminalMessage(socket, { type: "error", message: "终端尚未连接。" });
          return;
        }

        const sessionState = getTerminalSession(requestedSessionId);
        if (!sessionState) {
          sendTerminalMessage(socket, { type: "error", message: "终端会话不存在或已过期。" });
          return;
        }

        activeSessionId = requestedSessionId;

        if (payload.action === "input") {
          const text = payload.data ?? "";
          if (!text) {
            return;
          }
          sessionState.shellStream.write(text);
          resetTerminalKeepalive(requestedSessionId);
          return;
        }

        if (payload.action === "resize") {
          if (payload.cols && payload.rows) {
            sessionState.shellStream.setWindow(payload.rows, payload.cols, payload.rows * 16, payload.cols * 8);
          }
          return;
        }

        if (payload.action === "detach") {
          detachTerminalSession(requestedSessionId, socket);
          sendTerminalMessage(socket, { type: "detached", sessionId: requestedSessionId });
          return;
        }

        if (payload.action === "close") {
          destroyTerminalSession(requestedSessionId, false);
          return;
        }

        sendTerminalMessage(socket, { type: "error", message: "Unsupported terminal action." });
      } catch (error) {
        sendTerminalMessage(socket, {
          type: "error",
          message: error instanceof Error ? error.message : "Invalid terminal payload."
        });
      }
    });

    socket.on("close", () => {
      clearInterval(heartbeat);
      if (!activeSessionId) {
        return;
      }
      const current = getTerminalSession(activeSessionId);
      if (current?.socket === socket) {
        detachTerminalSession(activeSessionId, socket);
      }
    });
  });
}
