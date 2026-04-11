import cors from "cors";
import express from "express";
import { createServer } from "node:http";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { RawData, WebSocket, WebSocketServer } from "ws";
import type {
  FinalShellSettingsRequest,
  FinalShellSettingsResponse,
  JumpServerAssetSearchRequest,
  JumpServerAssetSearchResponse,
  ServerRouteConfig,
  ServerConnectionTestRequest,
  ServerConnectionTestResponse
} from "@server-log-console/shared";
import { LogsService } from "./modules/logs/logs.service.js";
import { LogSearchTaskService } from "./modules/logs/log-search-task.service.js";
import { ImportStrategyResolver, FinalShellImportStrategy, XshellImportStrategy } from "./modules/servers/strategies/index.js";
import { ServerRegistryService } from "./modules/servers/server-registry.service.js";
import { CredentialResolverService } from "./modules/servers/credential-resolver.service.js";
import { LocalConfigService } from "./modules/servers/local-config.service.js";
import { SshExecutorService } from "./modules/logs/ssh-executor.service.js";
import { buildTailCommand } from "./modules/logs/command-builder.js";
import { FileBrowserService } from "./modules/logs/file-browser.service.js";
import { LogSliceService } from "./modules/logs/log-slice.service.js";
import { FileTransferService } from "./modules/logs/file-transfer.service.js";
import { StrategyResolver } from "./modules/logs/strategies/index.js";
import multer from "multer";
import { shellEscape } from "./modules/logs/remote-shell.js";
import { registerTerminalWebsocket } from "./modules/terminals/terminal-websocket.js";

const bootStart = performance.now();
function logPhase(label: string, start: number) {
  const ms = (performance.now() - start).toFixed(1);
  console.log(`  ✓ ${label} (${ms}ms)`);
}
console.log("┌─ Gateway starting…");

let t = performance.now();
const app = express();
const httpServer = createServer(app);
const wsServer = new WebSocketServer({ noServer: true });
const terminalWsServer = new WebSocketServer({ noServer: true });
const currentDir = path.dirname(fileURLToPath(import.meta.url));
const extensionDistDir = process.env.EXTENSION_DIST_DIR || path.resolve(currentDir, "../../extension/dist");
const extensionIndexFile = path.join(extensionDistDir, "index.html");
logPhase("HTTP + WebSocket servers", t);

t = performance.now();
const serverRegistryService = new ServerRegistryService();
const localConfigService = new LocalConfigService();
await localConfigService.initialize();
serverRegistryService.setManualServers(localConfigService.listManualServers());
serverRegistryService.setImportedServers(localConfigService.listImportedServers());
logPhase("Local config & server registry", t);

t = performance.now();
const credentialResolverService = new CredentialResolverService(localConfigService);
const sshExecutorService = new SshExecutorService(serverRegistryService, credentialResolverService, localConfigService);
const strategyResolver = new StrategyResolver(serverRegistryService, sshExecutorService);
const logsService = new LogsService(serverRegistryService, sshExecutorService);
const fileBrowserService = new FileBrowserService(strategyResolver, serverRegistryService);
const logSliceService = new LogSliceService(strategyResolver);
const logSearchTaskService = new LogSearchTaskService(serverRegistryService, strategyResolver, logSliceService);
const fileTransferService = new FileTransferService(strategyResolver);
logPhase("Service layer", t);

t = performance.now();
const importResolver = new ImportStrategyResolver();
importResolver.register(new FinalShellImportStrategy());
importResolver.register(new XshellImportStrategy());
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 1024 * 1024 * 1024 } });
logPhase("Import strategies & middleware", t);

app.use(cors());
app.use(express.json({ limit: "50mb" }));

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "gateway", now: new Date().toISOString() });
});

app.get("/api/servers", (_req, res) => {
  res.json(serverRegistryService.listServers());
});

app.get("/api/servers/:serverId/credential", (req, res) => {
  try {
    const server = serverRegistryService.getServer(req.params.serverId);
    res.json(credentialResolverService.inspect(server));
  } catch (error) {
    res.status(404).json({ message: error instanceof Error ? error.message : "Unknown error" });
  }
});

app.get("/api/servers/:serverId/route", (req, res) => {
  try {
    const server = serverRegistryService.getServer(req.params.serverId);
    const payload: ServerRouteConfig = localConfigService.getServerRoute(server.id);
    res.json(payload);
  } catch (error) {
    res.status(404).json({ message: error instanceof Error ? error.message : "Unknown error" });
  }
});

app.get("/api/import/tools", (_req, res) => {
  res.json(importResolver.listTools());
});

app.get("/api/import/finalshell", async (_req, res) => {
  try {
    const strategy = importResolver.resolve("finalshell");
    const preferredPath = localConfigService.getFinalShellConfiguredPath() || undefined;
    const result = await strategy.importServers(preferredPath);
    await localConfigService.setImportedCredentials(result.credentials);
    await localConfigService.setImportedServers(result.servers);
    serverRegistryService.setImportedServers(result.servers);
    await localConfigService.markFinalShellImported(result.importedAt, preferredPath);
    res.json({
      importedAt: result.importedAt,
      resolvedPath: result.resolvedPath,
      searchedPaths: result.searchedPaths,
      servers: result.servers
    });
  } catch (error) {
    res.status(500).json({ message: error instanceof Error ? error.message : "Unknown error" });
  }
});

app.get("/api/import/finalshell/settings", async (_req, res) => {
  try {
    const strategy = importResolver.resolve("finalshell");
    const configuredPath = localConfigService.getFinalShellConfiguredPath();
    const inspection = await strategy.inspect(configuredPath || undefined);
    const payload: FinalShellSettingsResponse = {
      configuredPath,
      resolvedPath: inspection.resolvedPath,
      searchedPaths: inspection.searchedPaths,
      lastImportedAt: localConfigService.getFinalShellLastImportedAt()
    };
    res.json(payload);
  } catch (error) {
    res.status(500).json({ message: error instanceof Error ? error.message : "Unknown error" });
  }
});

app.post("/api/import/finalshell/settings", async (req, res) => {
  try {
    const strategy = importResolver.resolve("finalshell");
    const body = (req.body || {}) as FinalShellSettingsRequest;
    await localConfigService.saveFinalShellConfiguredPath(body.configuredPath || "");
    const configuredPath = localConfigService.getFinalShellConfiguredPath();
    const inspection = await strategy.inspect(configuredPath || undefined);
    const payload: FinalShellSettingsResponse = {
      configuredPath,
      resolvedPath: inspection.resolvedPath,
      searchedPaths: inspection.searchedPaths,
      lastImportedAt: localConfigService.getFinalShellLastImportedAt()
    };
    res.json(payload);
  } catch (error) {
    res.status(400).json({ message: error instanceof Error ? error.message : "Unknown error" });
  }
});

app.get("/api/import/xshell", async (_req, res) => {
  try {
    const strategy = importResolver.resolve("xshell");
    const result = await strategy.importServers();
    await localConfigService.setImportedCredentials(result.credentials);
    await localConfigService.setImportedServers(result.servers);
    serverRegistryService.setImportedServers(result.servers);
    res.json({
      importedAt: result.importedAt,
      resolvedPath: result.resolvedPath,
      searchedPaths: result.searchedPaths,
      servers: result.servers
    });
  } catch (error) {
    res.status(500).json({ message: error instanceof Error ? error.message : "Unknown error" });
  }
});

app.post("/api/servers/manual", async (req, res) => {
  try {
    const server = await localConfigService.saveManualServer(req.body);
    serverRegistryService.setManualServers(localConfigService.listManualServers());
    res.json({ server });
  } catch (error) {
    res.status(400).json({ message: error instanceof Error ? error.message : "Unknown error" });
  }
});

app.delete("/api/servers/:serverId", async (req, res) => {
  try {
    const server = serverRegistryService.getServer(req.params.serverId);

    if (server.source === "manual") {
      await localConfigService.deleteManualServer(server.id);
      serverRegistryService.setManualServers(localConfigService.listManualServers());
    } else {
      await localConfigService.deleteImportedServer(server.id);
      serverRegistryService.setImportedServers(localConfigService.listImportedServers());
    }

    res.json({ ok: true, serverId: server.id });
  } catch (error) {
    res.status(400).json({ message: error instanceof Error ? error.message : "Unknown error" });
  }
});

app.post("/api/servers/:serverId/credential", async (req, res) => {
  try {
    const server = serverRegistryService.getServer(req.params.serverId);
    await localConfigService.saveCredential(server.id, req.body || {});
    serverRegistryService.setManualServers(localConfigService.listManualServers());
    res.json(credentialResolverService.inspect(server));
  } catch (error) {
    res.status(400).json({ message: error instanceof Error ? error.message : "Unknown error" });
  }
});

app.post("/api/servers/:serverId/route", async (req, res) => {
  try {
    const server = serverRegistryService.getServer(req.params.serverId);
    await localConfigService.saveServerRoute(server.id, req.body || {});
    serverRegistryService.setManualServers(localConfigService.listManualServers());
    serverRegistryService.setImportedServers(localConfigService.listImportedServers());
    res.json(localConfigService.getServerRoute(server.id));
  } catch (error) {
    res.status(400).json({ message: error instanceof Error ? error.message : "Unknown error" });
  }
});

app.post("/api/servers/:serverId/test-connection", async (req, res) => {
  try {
    const server = serverRegistryService.getServer(req.params.serverId);
    const body = (req.body || {}) as ServerConnectionTestRequest;
    const directoryPath = body.directoryPath?.trim() || server.basePath;

    if (server.connectionKind === "bastion") {
      await sshExecutorService.probe(server.id, 20000);
      const payload: ServerConnectionTestResponse = {
        serverId: server.id,
        serverName: server.name,
        host: server.host,
        username: server.username,
        connected: true,
        directoryPath,
        directoryReadable: false,
        sampleEntries: [],
        message: appendConnectionHint(server, "JumpServer 入口登录成功，可继续搜索或跳转目标资产。")
      };
      res.json(payload);
      return;
    }

    const script = [
      `target=${shellEscape(directoryPath)}`,
      'readable=0',
      'if [ -d "$target" ] && [ -r "$target" ]; then readable=1; fi',
      'printf "META\\t%s\\t%s\\n" "$target" "$readable"',
      'if [ "$readable" = "1" ]; then',
      '  find "$target" -mindepth 1 -maxdepth 1 -printf "%f\\n" | LC_ALL=C sort | head -n 8',
      "fi"
    ].join("\n");

    const output = await sshExecutorService.exec(server.id, `bash -lc ${shellEscape(script)}`, 30000);
    const [metaLine, ...sampleLines] = output.split(/\r?\n/).filter(Boolean);

    if (!metaLine?.startsWith("META\t")) {
      throw new Error(output.trim() || "连接测试返回空结果");
    }

    const [, remotePath = directoryPath, readableToken = "0"] = metaLine.split("\t");
    const directoryReadable = readableToken === "1";

    const payload: ServerConnectionTestResponse = {
      serverId: server.id,
      serverName: server.name,
      host: server.host,
      username: server.username,
      connected: true,
      directoryPath: remotePath,
      directoryReadable,
      sampleEntries: sampleLines,
      message: appendConnectionHint(
        server,
        directoryReadable
          ? `SSH 连通成功，目录可读：${remotePath}`
          : `SSH 连通成功，但目录不可读或不存在：${remotePath}`
      )
    };
    res.json(payload);
  } catch (error) {
    const server = (() => {
      try {
        return serverRegistryService.getServer(req.params.serverId);
      } catch {
        return null;
      }
    })();
    const payload: ServerConnectionTestResponse = {
      serverId: req.params.serverId,
      serverName: server?.name || req.params.serverId,
      host: server?.host || "",
      username: server?.username || "",
      connected: false,
      directoryPath: (req.body as ServerConnectionTestRequest | undefined)?.directoryPath || server?.basePath || "",
      directoryReadable: false,
      sampleEntries: [],
      message: appendConnectionHint(server, error instanceof Error ? error.message : "连接测试失败", { failure: true })
    };
    res.status(400).json(payload);
  }
});

app.post("/api/servers/:serverId/jumpserver/assets", async (req, res) => {
  try {
    const server = serverRegistryService.getServer(req.params.serverId);
    const body = (req.body || {}) as JumpServerAssetSearchRequest;
    const keyword = body.keyword?.trim() || server.host;
    const assets = await sshExecutorService.searchJumpServerAssets(server.id, body.bastionId, keyword, 30000);
    const payload: JumpServerAssetSearchResponse = {
      serverId: server.id,
      bastionId: body.bastionId || server.preferredBastionId || "",
      keyword,
      assets
    };
    res.json(payload);
  } catch (error) {
    res.status(400).json({ message: error instanceof Error ? error.message : "Unknown error" });
  }
});

app.post("/api/servers/:bastionId/jumpserver/browse-assets", async (req, res) => {
  try {
    const body = (req.body || {}) as { keyword?: string };
    const keyword = body.keyword?.trim() || "";
    const assets = await sshExecutorService.listBastionAssets(req.params.bastionId, keyword, 30000);
    res.json({ bastionId: req.params.bastionId, keyword, assets });
  } catch (error) {
    res.status(400).json({ message: error instanceof Error ? error.message : "Unknown error" });
  }
});

app.post("/api/logs/search", async (req, res) => {
  try {
    const result = await logsService.search(req.body);
    res.json(result);
  } catch (error) {
    res.status(400).json({ message: error instanceof Error ? error.message : "Unknown error" });
  }
});

app.post("/api/logs/search/tasks", async (req, res) => {
  try {
    const result = await logSearchTaskService.create(req.body);
    res.json(result);
  } catch (error) {
    res.status(400).json({ message: error instanceof Error ? error.message : "Unknown error" });
  }
});

app.get("/api/logs/search/tasks/:taskId", (req, res) => {
  try {
    const result = logSearchTaskService.get(req.params.taskId);
    res.json(result);
  } catch (error) {
    res.status(404).json({ message: error instanceof Error ? error.message : "Unknown error" });
  }
});

app.post("/api/logs/live", async (req, res) => {
  try {
    const result = await logsService.startLiveTail(req.body);
    res.json(result);
  } catch (error) {
    res.status(400).json({ message: error instanceof Error ? error.message : "Unknown error" });
  }
});

app.post("/api/logs/export", async (req, res) => {
  try {
    const result = await logsService.search(req.body);
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="log-export-${Date.now()}.log"`);
    res.send(result.rawOutput);
  } catch (error) {
    res.status(400).json({ message: error instanceof Error ? error.message : "Unknown error" });
  }
});

app.post("/api/files/delete", async (req, res) => {
  try {
    const result = await fileTransferService.delete(req.body);
    res.json(result);
  } catch (error) {
    res.status(400).json({ message: error instanceof Error ? error.message : "Unknown error" });
  }
});

app.post("/api/files/rename", async (req, res) => {
  try {
    const result = await fileTransferService.rename(req.body);
    res.json(result);
  } catch (error) {
    res.status(400).json({ message: error instanceof Error ? error.message : "Unknown error" });
  }
});

app.post("/api/files/save", async (req, res) => {
  try {
    const result = await fileTransferService.save(req.body);
    res.json(result);
  } catch (error) {
    res.status(400).json({ message: error instanceof Error ? error.message : "Unknown error" });
  }
});

app.post("/api/files/preview", async (req, res) => {
  try {
    const result = await fileTransferService.preview(req.body);
    res.json(result);
  } catch (error) {
    res.status(400).json({ message: error instanceof Error ? error.message : "Unknown error" });
  }
});

app.post("/api/files/download", async (req, res) => {
  try {
    const { buffer, fileName } = await fileTransferService.download(req.body);
    res.setHeader("Content-Type", "application/octet-stream");
    res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(fileName)}"`);
    res.setHeader("Content-Length", buffer.length);
    res.send(buffer);
  } catch (error) {
    res.status(400).json({ message: error instanceof Error ? error.message : "Unknown error" });
  }
});

app.post("/api/files/upload", (req, res, next) => {
  upload.single("file")(req, res, (err) => {
    if (err) {
      console.error("[upload] multer error:", err);
      res.status(400).json({ message: err instanceof Error ? err.message : "文件上传失败" });
      return;
    }
    next();
  });
}, async (req, res) => {
  try {
    const serverId = req.body?.serverId as string;
    const filePath = req.body?.filePath as string;
    if (!serverId || !filePath) throw new Error("serverId 和 filePath 必填");
    if (!req.file) throw new Error("未收到上传文件");
    console.log(`[upload] serverId=${serverId} filePath=${filePath} size=${req.file.size}`);
    const result = await fileTransferService.upload(serverId, filePath, req.file.buffer);
    res.json(result);
  } catch (error) {
    console.error("[upload] error:", error);
    res.status(400).json({ message: error instanceof Error ? error.message : "Unknown error" });
  }
});

app.post("/api/files/upload/start", async (req, res) => {
  try {
    const { serverId, filePath } = req.body || {};
    if (!serverId || !filePath) throw new Error("serverId 和 filePath 必填");
    const result = await fileTransferService.startChunkedUpload(serverId, filePath);
    res.json(result);
  } catch (error) {
    console.error("[upload/start] error:", error);
    res.status(400).json({ message: error instanceof Error ? error.message : "Unknown error" });
  }
});

const chunkUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

app.post("/api/files/upload/chunk", (req, res, next) => {
  chunkUpload.single("chunk")(req, res, (err) => {
    if (err) {
      console.error("[upload/chunk] multer error:", err);
      res.status(400).json({ message: err instanceof Error ? err.message : "分片上传失败" });
      return;
    }
    next();
  });
}, async (req, res) => {
  try {
    const uploadId = req.body?.uploadId as string;
    if (!uploadId) throw new Error("uploadId 必填");
    if (!req.file) throw new Error("未收到分片数据");
    const result = await fileTransferService.writeChunk(uploadId, req.file.buffer);
    res.json(result);
  } catch (error) {
    console.error("[upload/chunk] error:", error);
    res.status(400).json({ message: error instanceof Error ? error.message : "Unknown error" });
  }
});

app.post("/api/files/upload/finish", async (req, res) => {
  try {
    const { uploadId } = req.body || {};
    if (!uploadId) throw new Error("uploadId 必填");
    const result = await fileTransferService.finishUpload(uploadId);
    res.json(result);
  } catch (error) {
    console.error("[upload/finish] error:", error);
    res.status(400).json({ message: error instanceof Error ? error.message : "Unknown error" });
  }
});

app.post("/api/logs/files", async (req, res) => {
  try {
    const result = await fileBrowserService.list(req.body);
    res.json(result);
  } catch (error) {
    res.status(400).json({ message: error instanceof Error ? error.message : "Unknown error" });
  }
});

app.post("/api/logs/meta", async (req, res) => {
  try {
    const result = await logSliceService.getMeta(req.body);
    res.json(result);
  } catch (error) {
    res.status(400).json({ message: error instanceof Error ? error.message : "Unknown error" });
  }
});

app.post("/api/logs/slice", async (req, res) => {
  try {
    const result = await logSliceService.getSlice(req.body);
    res.json(result);
  } catch (error) {
    res.status(400).json({ message: error instanceof Error ? error.message : "Unknown error" });
  }
});

app.post("/api/logs/line-context", async (req, res) => {
  try {
    const result = await logSliceService.getLineContext(req.body);
    res.json(result);
  } catch (error) {
    res.status(400).json({ message: error instanceof Error ? error.message : "Unknown error" });
  }
});

t = performance.now();
if (existsSync(extensionIndexFile)) {
  app.use(express.static(extensionDistDir));

  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api/") || req.path === "/health" || req.path.startsWith("/ws/")) {
      next();
      return;
    }

    res.sendFile(extensionIndexFile);
  });
  logPhase(`Static files (${extensionDistDir})`, t);
} else {
  console.log(`  ⚠ Frontend not found: ${extensionDistDir}`);
}

wsServer.on("connection", (socket: WebSocket) => {
  let clientCleanup: (() => void) | null = null;

  let missedPongs = 0;
  const heartbeat = setInterval(() => {
    missedPongs++;
    if (missedPongs >= 3) { socket.terminate(); return; }
    socket.ping();
  }, 25000);
  socket.on("pong", () => { missedPongs = 0; });

  socket.on("message", async (raw: RawData) => {
    try {
      const payload = JSON.parse(raw.toString()) as {
        action?: "start";
        serverId: string;
        filePath: string;
        keyword?: string;
      };

      if (payload.action !== "start") {
        socket.send(JSON.stringify({ type: "error", message: "Unsupported live action." }));
        return;
      }

      const sessionId = `live-${payload.serverId}-${Date.now()}`;

      const server = serverRegistryService.getServer(payload.serverId);
      const isJumpServer = sshExecutorService.isJumpServerBastion(server);
      let tailFilePath = payload.filePath;
      let connection: Awaited<ReturnType<typeof sshExecutorService.connectForStreaming>>;

      if (isJumpServer) {
        const parsed = parseJumpServerSftpPath(payload.filePath);
        if (!parsed) {
          socket.send(JSON.stringify({ type: "error", message: "无法解析堡垒机文件路径，请确认路径格式。" }));
          return;
        }
        tailFilePath = parsed.realPath;
        const assetKeyword = parsed.assetKey.replace(/[_\s].*/g, "");
        console.log(`[live] JumpServer asset="${assetKeyword}" realPath="${tailFilePath}"`);
        connection = await sshExecutorService.connectToJumpServerAsset(payload.serverId, assetKeyword, 45000);
      } else {
        connection = await sshExecutorService.connectForStreaming(payload.serverId, 45000);
      }

      const command = buildTailCommand(tailFilePath, payload.keyword);
      const client = connection.client;
      const shellStream = connection.shellStream;

      client
        .on("error", (error) => {
          socket.send(JSON.stringify({ type: "error", message: error.message }));
        });

      if (connection.mode === "jumpserver-shell" && shellStream) {
        shellStream.on("data", (chunk: Buffer | string) => {
          socket.send(
            JSON.stringify({
              sessionId,
              chunk: chunk.toString(),
              timestamp: new Date().toISOString()
            })
          );
        });

        shellStream.stderr.on("data", (chunk: Buffer | string) => {
          socket.send(
            JSON.stringify({
              type: "stderr",
              sessionId,
              chunk: chunk.toString(),
              timestamp: new Date().toISOString()
            })
          );
        });

        shellStream.on("close", () => {
          socket.send(JSON.stringify({ type: "closed", sessionId }));
          connection.cleanup();
        });

        shellStream.write(`${command}\r`);
      } else {
        client.exec(command, (error, stream) => {
          if (error) {
            socket.send(JSON.stringify({ type: "error", message: error.message }));
            connection.cleanup();
            return;
          }

          stream.on("data", (chunk: Buffer | string) => {
            socket.send(
              JSON.stringify({
                sessionId,
                chunk: chunk.toString(),
                timestamp: new Date().toISOString()
              })
            );
          });

          stream.stderr.on("data", (chunk: Buffer | string) => {
            socket.send(
              JSON.stringify({
                type: "stderr",
                sessionId,
                chunk: chunk.toString(),
                timestamp: new Date().toISOString()
              })
            );
          });

          stream.on("close", () => {
            socket.send(JSON.stringify({ type: "closed", sessionId }));
            connection.cleanup();
          });
        });
      }

      clientCleanup = () => connection.cleanup();
    } catch (error) {
      socket.send(
        JSON.stringify({
          type: "error",
          message: error instanceof Error ? error.message : "Invalid live payload."
        })
      );
    }
  });

  socket.on("close", () => {
    clearInterval(heartbeat);
    clientCleanup?.();
  });
});

registerTerminalWebsocket(terminalWsServer, sshExecutorService);

httpServer.on("upgrade", (request, socket, head) => {
  const pathname = new URL(request.url || "/", "http://127.0.0.1").pathname;

  if (pathname === "/ws/live") {
    wsServer.handleUpgrade(request, socket, head, (upgradedSocket) => {
      wsServer.emit("connection", upgradedSocket, request);
    });
    return;
  }

  if (pathname === "/ws/terminal" || pathname === "/ws/jumpserver") {
    terminalWsServer.handleUpgrade(request, socket, head, (upgradedSocket) => {
      terminalWsServer.emit("connection", upgradedSocket, request);
    });
    return;
  }

  socket.destroy();
});

const port = Number(process.env.PORT || 4040);
const host = process.env.HOST || "127.0.0.1";
httpServer.listen(port, host, () => {
  const url = `http://${host === "0.0.0.0" ? "127.0.0.1" : host}:${port}`;
  const totalMs = (performance.now() - bootStart).toFixed(0);
  const serverCount = serverRegistryService.listServers().length;
  console.log(`├─ Routes & WebSocket handlers registered`);
  console.log(`└─ Gateway ready in ${totalMs}ms — ${url}`);
  console.log(`   ${serverCount} server(s) loaded | PID ${process.pid} | ${process.env.ELECTRON ? "Electron" : "standalone"}`);
  if (process.argv.includes("--open") && !process.env.ELECTRON) {
    import("node:child_process").then(({ exec }) => {
      const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
      exec(`${cmd} ${url}`);
    });
  }
});

function parseJumpServerSftpPath(virtualPath: string): { assetKey: string; realPath: string } | null {
  const parts = virtualPath.split("/").filter(Boolean);
  const fsRoots = new Set(["home", "var", "opt", "tmp", "root", "etc", "usr", "srv", "data", "mnt", "media", "run", "log", "logs", "app", "apps", "www"]);
  for (let i = 0; i < parts.length; i++) {
    if (fsRoots.has(parts[i].toLowerCase())) {
      if (i === 0) return null;
      return {
        assetKey: parts[i - 1],
        realPath: "/" + parts.slice(i).join("/")
      };
    }
  }
  return null;
}

function appendConnectionHint(
  server: { connectionKind?: string; connectionHint?: string } | null,
  message: string,
  options?: { failure?: boolean }
) {
  if (!server?.connectionHint) {
    return message;
  }

  if (server.connectionKind === "bastion" && options?.failure) {
    return `${message} 当前账号是堡垒机入口，请确认密码、私钥或堡垒机本身可达。`;
  }

  if (server.connectionKind === "bastion-target" && options?.failure) {
    return `${message} 这台机器更像内网目标机，失败时通常是还缺“先连堡垒机再跳转”的链路。`;
  }

  return message;
}
