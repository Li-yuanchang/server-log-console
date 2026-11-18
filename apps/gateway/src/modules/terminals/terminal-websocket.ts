import { randomUUID } from "node:crypto";
import { RawData, WebSocket, WebSocketServer } from "ws";
import { SshExecutorService } from "../logs/ssh-executor.service.js";
import { buildJumpServerAssetKeyword, parseJumpServerSftpPath } from "../logs/jumpserver-path.js";
import {
  appendTerminalTranscript,
  attachTerminalSession,
  createTerminalSession,
  destroyTerminalSession,
  detachTerminalSession,
  getTerminalSession,
  resetTerminalKeepalive,
  sendTerminalMessage,
  stripTerminalQueries,
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
                /* 出口再剔除一次：兼容本次修复前已入档的旧 transcript（含查询序列），
                   否则重连回放仍会让 xterm 自动应答 */
                chunk: stripTerminalQueries(existing.transcript),
                timestamp: new Date().toISOString()
              });
              return;
            }
          }

          if (!payload.serverId) {
            sendTerminalMessage(socket, { type: "error", message: "缺少 serverId。" });
            return;
          }

          const requestedCwd = payload.cwd?.trim();
          const jumpServerPath = requestedCwd && sshExecutorService.isJumpServerServer(payload.serverId)
            ? parseJumpServerSftpPath(requestedCwd)
            : null;
          const effectiveCwd = jumpServerPath?.realPath || requestedCwd;
          const connection = jumpServerPath
            ? await sshExecutorService.connectToJumpServerAsset(
                payload.serverId,
                buildJumpServerAssetKeyword(jumpServerPath.assetKey),
                45000,
                effectiveCwd
              )
            : await sshExecutorService.connectTerminal(payload.serverId, payload.bastionId, 30000, payload.cwd);
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
            /* initialBuffer 是登录横幅 + 注入 cd 的原始字节（见 ssh-executor 的
               injectTerminalCwd），它会在本帧与新 socket 重连时被回放，同样要剔除
               查询序列，否则 xterm 重放时会自动应答并把应答当命令发给远端 shell。 */
            transcript: stripTerminalQueries(connection.initialBuffer || "")
          };

          createTerminalSession(sessionState);
          activeSessionId = sessionId;

          const forwardTerminalChunk = (chunk: Buffer | string, type: "output" | "stderr") => {
            const text = chunk.toString();
            const current = getTerminalSession(sessionId);
            if (!current) {
              return;
            }

            appendTerminalTranscript(sessionId, text);
            sendTerminalMessage(current.socket, {
              type,
              sessionId,
              chunk: text,
              timestamp: new Date().toISOString()
            });
          };

          connection.client.on("error", (error) => {
            const current = getTerminalSession(sessionId);
            if (!current) {
              return;
            }
            sendTerminalMessage(current.socket, { type: "error", sessionId, message: error.message });
          });

          shellStream.on("data", (chunk: Buffer | string) => {
            forwardTerminalChunk(chunk, "output");
          });

          shellStream.stderr.on("data", (chunk: Buffer | string) => {
            forwardTerminalChunk(chunk, "stderr");
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
