import cors from "cors";
import express from "express";
import { randomUUID } from "node:crypto";
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
  ServerCredentialInput,
  ServerSystemProfileRequest,
  ServerConnectionTestRequest,
  ServerConnectionTestResponse,
  ServerDraftConnectionTestRequest,
  ServerDraftConnectionTestResponse
} from "@server-log-console/shared";
import { LogsService } from "./modules/logs/logs.service.js";
import { LogSearchTaskService } from "./modules/logs/log-search-task.service.js";
import { ImportStrategyResolver, FinalShellImportStrategy, XshellImportStrategy } from "./modules/servers/strategies/index.js";
import { ServerRegistryService } from "./modules/servers/server-registry.service.js";
import { buildImportPreview } from "./modules/servers/import-diff.service.js";
import { CredentialResolverService } from "./modules/servers/credential-resolver.service.js";
import { LocalConfigService } from "./modules/servers/local-config.service.js";
import { SshExecutorService } from "./modules/logs/ssh-executor.service.js";
import { buildTailCommand } from "./modules/logs/command-builder.js";
import { FileBrowserService } from "./modules/logs/file-browser.service.js";
import { LogSliceService } from "./modules/logs/log-slice.service.js";
import { FileTransferService } from "./modules/logs/file-transfer.service.js";
import { MultiFileSearchService } from "./modules/logs/multi-file-search.service.js";
import { SshTunnelService } from "./modules/logs/ssh-tunnel.service.js";
import { BatchCommandService } from "./modules/logs/batch-command.service.js";
import { StrategyResolver } from "./modules/logs/strategies/index.js";
import { ServerSystemProfileService } from "./modules/servers/server-system-profile.service.js";
import multer from "multer";
import { shellEscape } from "./modules/logs/remote-shell.js";
import { buildJumpServerAssetKeyword, parseJumpServerAssetRootPath, parseJumpServerSftpPath } from "./modules/logs/jumpserver-path.js";
import { registerTerminalWebsocket } from "./modules/terminals/terminal-websocket.js";
import { AuthService } from "./modules/auth/auth.service.js";
import { createDesktopUpdateStatic, resolveDesktopUpdateDir } from "./desktopUpdateStatic.js";

const bootStart = performance.now();
function logPhase(label: string, start: number) {
  const ms = (performance.now() - start).toFixed(1);
  console.log(`  ✓ ${label} (${ms}ms)`);
}
console.log("┌─ Gateway starting…");

let t = performance.now();

type LogRecordingSession = {
  sessionId: string;
  serverId: string;
  sourcePath: string;
  outputPath: string;
  /** Shell-safe real paths (stripped JumpServer SFTP prefix when applicable) */
  realSourcePath: string;
  realOutputPath: string;
  realPidFilePath: string;
  startedAt: string;
};

const activeLogRecordings = new Map<string, LogRecordingSession>();
const recordingConnections = new Map<string, { cleanup: () => void }>();

function buildRecordingTimestamp(date = new Date()): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const mi = String(date.getMinutes()).padStart(2, "0");
  const ss = String(date.getSeconds()).padStart(2, "0");
  return `${yyyy}${mm}${dd}-${hh}${mi}${ss}`;
}

function buildRecordingOutputPath(filePath: string, preferredDir?: string): string {
  const sourceDir = preferredDir?.trim() || path.posix.dirname(filePath) || ".";
  const sourceBase = (path.posix.basename(filePath).replace(/\.[^.]+$/, "") || "log").replace(/[^a-zA-Z0-9._-]+/g, "-");
  return path.posix.join(sourceDir, `${sourceBase}-${buildRecordingTimestamp()}.record.log`);
}
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
const multiFileSearchService = new MultiFileSearchService(serverRegistryService, sshExecutorService);
const sshTunnelService = new SshTunnelService(serverRegistryService, sshExecutorService, credentialResolverService);
const batchCommandService = new BatchCommandService(serverRegistryService, sshExecutorService);
const serverSystemProfileService = new ServerSystemProfileService(serverRegistryService, sshExecutorService);
logPhase("Service layer", t);

t = performance.now();
const authService = new AuthService();
await authService.initialize();
if (authService.isEnabled()) {
  console.log("  ✓ Gateway auth enabled (GATEWAY_TOKEN or gateway-auth.json)");
}
logPhase("Auth service", t);

t = performance.now();
const importResolver = new ImportStrategyResolver();
importResolver.register(new FinalShellImportStrategy());
importResolver.register(new XshellImportStrategy());
const uploadMemoryLimit = 10 * 1024 * 1024;
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: uploadMemoryLimit } });
logPhase("Import strategies & middleware", t);

/* CORS 白名单：此前是 app.use(cors()) 全开，浏览器形态下任意网页都能带着
   自己的 Origin 调用本机接口。

   注意不能用 /:\d+/ 之类的端口通配 —— 那等价于放行「本机所有服务」，而本机
   上的其它项目（例如 5173 上的 virtual-resource-console）与本工具毫无关系，
   它的页面属于第三方代码，与 evil.example.com 风险相同。这里精确到端口。 */
const GATEWAY_SELF_ORIGINS = [
  `http://127.0.0.1:${Number(process.env.PORT) || 4040}`,
  `http://localhost:${Number(process.env.PORT) || 4040}`
];
/** SLC 自己的 vite 开发服务器（vite.config.ts 已固定 5273 + strictPort） */
const DEV_ORIGINS = ["http://127.0.0.1:5273", "http://localhost:5273"];

const corsAllowlist: (string | RegExp)[] = [
  /^chrome-extension:\/\/[a-z]{32}$/i,
  ...GATEWAY_SELF_ORIGINS,
  ...DEV_ORIGINS
];

/* 共享部署 / 内网网关场景：前端从别的地址访问时用逗号分隔追加。
   例：GATEWAY_CORS_ORIGINS=https://ops.example.com,http://10.20.0.9:8080 */
const extraOrigins = (process.env.GATEWAY_CORS_ORIGINS || "")
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean);

function isOriginAllowed(origin: string): boolean {
  if (extraOrigins.includes(origin)) return true;
  return corsAllowlist.some((rule) =>
    typeof rule === "string" ? rule === origin : rule.test(origin)
  );
}

app.use(
  cors({
    origin(origin, callback) {
      /* 无 Origin：原生应用 / curl / 同源导航，放行
         （跨源浏览器请求一定带 Origin，因此这里不会放宽攻击面） */
      if (!origin) {
        callback(null, true);
        return;
      }
      if (isOriginAllowed(origin)) {
        callback(null, true);
        return;
      }
      callback(null, false);
    },
    credentials: true
  })
);

/* Bearer Token 鉴权。
 *
 * 只保护 API 与 WebSocket —— 静态资源（JS/CSS/icon/index.html）必须免鉴权：
 * 浏览器加载 <script src>、<link rel=stylesheet> 时不会附带 Authorization 头，
 * 若一并拦截，前端 bundle 全部 401，页面永远停在启动页（实测踩到）。
 *
 * 开放清单：
 *   /health              离线状态展示依赖它
 *   /desktop-updates/*   electron-updater 检查更新不带令牌
 *   非 /api 且非 /ws     SPA 入口与静态产物
 * 浏览器 WebSocket 无法携带请求头，upgrade 阶段用 ?token= 校验，这里同样接受该参数。 */
app.use((req, res, next) => {
  if (!authService.isEnabled()) {
    next();
    return;
  }
  const isApiOrWs = req.path.startsWith("/api/") || req.path.startsWith("/ws/");
  if (!isApiOrWs || req.path === "/health" || req.path.startsWith("/desktop-updates/")) {
    next();
    return;
  }
  const ip = req.socket.remoteAddress || "unknown";
  if (authService.isRateLimited(ip)) {
    res.status(429).json({ message: "认证失败次数过多，请稍后再试" });
    return;
  }
  const candidate = authService.extractBearer(req.headers.authorization)
    ?? (typeof req.query.token === "string" ? req.query.token : null);
  if (authService.verify(candidate)) {
    authService.recordSuccess(ip);
    next();
    return;
  }
  authService.recordFailure(ip);
  res.status(401).json({ message: "需要访问令牌：请求头 Authorization: Bearer <token>" });
});

/* 共享部署加固：GATEWAY_HIDE_SECRETS=1 时关闭凭证明文导出接口 */
const secretsExportEnabled = process.env.GATEWAY_HIDE_SECRETS !== "1";

app.use(express.json({ limit: "50mb" }));

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "gateway", now: new Date().toISOString() });
});

app.get("/api/servers", (_req, res) => {
  res.json(serverRegistryService.listServers());
});

/* 安全状态：前端据此提示「凭证是否已加密」「鉴权是否已启用」。
   只暴露布尔值，绝不返回令牌或密钥本身。 */
app.get("/api/security/status", (_req, res) => {
  res.json({
    credentialEncryptionEnabled: localConfigService.isCredentialEncryptionEnabled(),
    authEnabled: authService.isEnabled(),
    secretsExportEnabled
  });
});

app.get("/api/servers/:serverId/credential", (req, res) => {
  try {
    const server = serverRegistryService.getServer(req.params.serverId);
    res.json(credentialResolverService.inspect(server));
  } catch (error) {
    res.status(404).json({ message: error instanceof Error ? error.message : "Unknown error" });
  }
});

app.get("/api/servers/:serverId/credential/secret", (req, res) => {
  if (!secretsExportEnabled) {
    res.status(403).json({ message: "凭证明文导出已被服务端禁用（GATEWAY_HIDE_SECRETS=1）" });
    return;
  }
  try {
    const server = serverRegistryService.getServer(req.params.serverId);
    res.json(credentialResolverService.reveal(server));
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
    /* 未找到配置目录时必须报错（2026-10-23 用户反馈「没装 FinalShell 也提示导入成功」）：
       原实现无论是否找到都会落库 + markImported，于是 resolvedPath 为 null 时返回
       200 + 空 servers —— 前端据此提示「导入成功」；更严重的是会把用户**已有**的
       服务器列表覆盖成空数组。现在提前返回 404，既不落库也不伪装成功。 */
    if (!result.resolvedPath) {
      res.status(404).json({
        message: `未找到 FinalShell 配置目录。已检查：${result.searchedPaths.join(" | ")}。若 FinalShell 装在自定义位置，请在设置中心填写配置目录后重试。`
      });
      return;
    }
    await localConfigService.setImportedCredentials(result.credentials);
    await localConfigService.setImportedServers(result.servers);
    serverRegistryService.setImportedServers(result.servers);
    await localConfigService.markFinalShellImported(result.importedAt, preferredPath);
    res.json({
      importedAt: result.importedAt,
      resolvedPath: result.resolvedPath,
      searchedPaths: result.searchedPaths,
      servers: result.servers,
      /* 私钥认证但没读到私钥的服务器：让前端显式提示，不静默降级 */
      missingPrivateKeyServers: result.missingPrivateKeyServers
    });
  } catch (error) {
    res.status(500).json({ message: error instanceof Error ? error.message : "Unknown error" });
  }
});

/* ============================================================
   重新导入 · 变更预览与应用
   ------------------------------------------------------------
   背景：此前重新导入直接 setImportedServers(全量覆盖)。用户在 FinalShell
   里删掉一台机器，本工具里的日志路径/搜索条件/堡垒机路由会一起消失，而界面
   只显示「导入成功」，用户没有任何察觉机会。
   现在改为：先预览 diff（不写库），用户确认后再按变更集落库。
   ============================================================ */

/** 预览：只计算，不写任何文件 */
app.post("/api/import/preview", async (req, res) => {
  try {
    const toolId = String(req.body?.toolId || "finalshell").trim();
    if (toolId !== "finalshell" && toolId !== "xshell") {
      res.status(400).json({ message: `不支持的导入工具：${toolId}` });
      return;
    }

    const strategy = importResolver.resolve(toolId);
    const preferredPath = toolId === "finalshell"
      ? localConfigService.getFinalShellConfiguredPath() || undefined
      : undefined;
    const result = await strategy.importServers(preferredPath);

    if (!result.resolvedPath) {
      res.status(404).json({
        message: `未找到配置目录。已检查：${result.searchedPaths.join(" | ")}。若工具装在自定义位置，请在设置中心填写配置目录后重试。`
      });
      return;
    }

    const preview = buildImportPreview({
      toolId,
      resolvedPath: result.resolvedPath,
      searchedPaths: result.searchedPaths,
      existing: localConfigService.listImportedServersRaw(),
      incoming: result.servers,
      missingPrivateKeyServers: result.missingPrivateKeyServers,
      hasLocalData: (serverId) => localConfigService.hasLocalDataForServer(serverId)
    });

    res.json(preview);
  } catch (error) {
    res.status(500).json({ message: error instanceof Error ? error.message : "Unknown error" });
  }
});

/** 应用：按用户勾选执行合并落库 */
app.post("/api/import/apply", async (req, res) => {
  try {
    const toolId = String(req.body?.toolId || "finalshell").trim();
    if (toolId !== "finalshell" && toolId !== "xshell") {
      res.status(400).json({ message: `不支持的导入工具：${toolId}` });
      return;
    }

    const strategy = importResolver.resolve(toolId);
    const preferredPath = toolId === "finalshell"
      ? localConfigService.getFinalShellConfiguredPath() || undefined
      : undefined;
    const result = await strategy.importServers(preferredPath);

    if (!result.resolvedPath) {
      res.status(404).json({
        message: `未找到配置目录。已检查：${result.searchedPaths.join(" | ")}。`
      });
      return;
    }

    const removeServerIds = new Set<string>(
      Array.isArray(req.body?.removeServerIds) ? req.body.removeServerIds.map(String) : []
    );
    const updateServerIds = new Set<string>(
      Array.isArray(req.body?.updateServerIds) ? req.body.updateServerIds.map(String) : []
    );

    // 先重算一次匹配关系（与预览同一套规则），只用于判定哪些 incoming 已存在
    const preview = buildImportPreview({
      toolId,
      resolvedPath: result.resolvedPath,
      searchedPaths: result.searchedPaths,
      existing: localConfigService.listImportedServersRaw(),
      incoming: result.servers,
      hasLocalData: (serverId) => localConfigService.hasLocalDataForServer(serverId)
    });
    const matchedServerIds = new Set<string>(preview.updated.map((c) => c.serverId));

    const applied = await localConfigService.applyImportedChanges({
      incoming: result.servers,
      removeServerIds,
      updateServerIds,
      matchedServerIds
    });

    // 凭证只补新增/更新的条目，保留中的旧记录凭证不动
    const keepOldCredentialIds = new Set<string>(
      applied.servers
        .filter((s) => !result.servers.some((n) => n.id === s.id))
        .map((s) => s.id)
    );
    const credentialPatch: Record<string, ServerCredentialInput> = {};
    for (const [id, cred] of Object.entries(result.credentials)) {
      if (keepOldCredentialIds.has(id)) continue;
      credentialPatch[id] = cred;
    }
    if (Object.keys(credentialPatch).length > 0) {
      await localConfigService.mergeImportedCredentials(credentialPatch);
    }

    serverRegistryService.setImportedServers(localConfigService.listImportedServers());
    if (toolId === "finalshell") {
      await localConfigService.markFinalShellImported(result.importedAt, preferredPath);
    }

    res.json({
      ok: true,
      addedCount: applied.addedCount,
      removedCount: applied.removedCount,
      updatedCount: applied.updatedCount,
      keptCount: applied.keptCount,
      servers: applied.servers,
      missingPrivateKeyServers: result.missingPrivateKeyServers
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
    /* 与 finalshell 同规则（2026-10-23）：找不到配置目录时返回 404，
       不再落库、不返回 200 空列表（否则前端会提示「导入成功」并清空已有列表）。 */
    if (!result.resolvedPath) {
      res.status(404).json({
        message: `未找到 Xshell 配置目录。已检查：${result.searchedPaths.join(" | ")}。`
      });
      return;
    }
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

/* 草稿连接测试（2026-10-23 用户反馈「新建界面保存链接前面少一个测试的按钮」）：
   表单还没保存，没有 serverId，因此不能用 /api/servers/:serverId/test-connection。
   这里直接用请求体里的主机/端口/账号/密码或私钥连一次，只做连通性与目录可读性检查，
   不写任何配置文件、不注册服务器 —— 即「测了不满意可以直接不保存」。 */
app.post("/api/servers/test-draft", async (req, res) => {
  const body = (req.body || {}) as ServerDraftConnectionTestRequest;
  const host = body.host?.trim() || "";
  const port = Number(body.port || 22);
  const username = body.username?.trim() || "root";
  const directoryPath = body.directoryPath?.trim() || "/";

  try {
    if (!host) {
      throw new Error("请先填写主机地址。");
    }
    if (!Number.isInteger(port) || port <= 0 || port > 65535) {
      throw new Error("端口必须是 1-65535 之间的整数。");
    }
    if (!body.password && !body.privateKey) {
      throw new Error("请先填写密码或私钥，否则无法测试登录。");
    }

    const script = [
      `target=${shellEscape(directoryPath)}`,
      'readable=0',
      'if [ -d "$target" ] && [ -r "$target" ]; then readable=1; fi',
      'printf "META\\t%s\\t%s\\n" "$target" "$readable"'
    ].join("\n");

    const output = await sshExecutorService.probeWithCredentials(
      { host, port, username, password: body.password, privateKey: body.privateKey },
      `bash -lc ${shellEscape(script)}`,
      20000
    );

    const metaLine = output.split(/\r?\n/).find((line) => line.startsWith("META\t")) || "";
    const [, remotePath = directoryPath, readableToken = "0"] = metaLine.split("\t");
    const directoryReadable = readableToken === "1";

    const payload: ServerDraftConnectionTestResponse = {
      connected: true,
      host,
      username,
      directoryPath: remotePath,
      directoryReadable,
      message: directoryReadable
        ? `SSH 连通成功，目录可读：${remotePath}`
        : `SSH 连通成功，但目录不可读或不存在：${remotePath}`
    };
    res.json(payload);
  } catch (error) {
    const payload: ServerDraftConnectionTestResponse = {
      connected: false,
      host,
      username,
      directoryPath,
      directoryReadable: false,
      message: error instanceof Error ? error.message : "连接测试失败"
    };
    res.status(400).json(payload);
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

app.delete("/api/servers/:serverId/credential", async (req, res) => {
  try {
    const server = serverRegistryService.getServer(req.params.serverId);
    await localConfigService.clearCredential(server.id);
    serverRegistryService.setManualServers(localConfigService.listManualServers());
    serverRegistryService.setImportedServers(localConfigService.listImportedServers());
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

app.post("/api/servers/:serverId/system-profile", async (req, res) => {
  try {
    const server = serverRegistryService.getServer(req.params.serverId);
    const body = (req.body || {}) as ServerSystemProfileRequest;
    const contextPath = body.contextPath?.trim() || "";
    const isJumpServerEntry = sshExecutorService.isJumpServerBastion(server);
    const parsedJumpPath = contextPath && isJumpServerEntry
      ? (parseJumpServerSftpPath(contextPath) || parseJumpServerAssetRootPath(contextPath))
      : null;

    if (parsedJumpPath) {
      const assetKeyword = buildJumpServerAssetKeyword(parsedJumpPath.assetKey);
      const connection = await sshExecutorService.connectToJumpServerAsset(server.id, assetKeyword, body.timeoutMs || 45000);
      try {
        const profile = await serverSystemProfileService.collect(server.id, body.timeoutMs, {
          connection,
          hostOverride: assetKeyword
        });
        res.json(profile);
      } finally {
        connection.cleanup();
      }
      return;
    }

    if (isJumpServerEntry) {
      throw new Error("堡垒机状态需要先进入具体目标资产目录或打开目标资产日志，当前没有可解析的目标资产上下文。");
    }

    const profile = await serverSystemProfileService.collect(server.id, body.timeoutMs);
    res.json(profile);
  } catch (error) {
    res.status(400).json({ message: error instanceof Error ? error.message : "读取服务器状态失败" });
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

app.post("/api/logs/search/multi", async (req, res) => {
  try {
    const result = await multiFileSearchService.search(req.body);
    res.json(result);
  } catch (error) {
    res.status(400).json({ message: error instanceof Error ? error.message : "Unknown error" });
  }
});

// --- SSH Tunnel ---
app.post("/api/ssh/tunnel", async (req, res) => {
  try {
    const result = await sshTunnelService.createTunnel(req.body);
    res.json(result);
  } catch (error) {
    res.status(400).json({ message: error instanceof Error ? error.message : "Unknown error" });
  }
});

app.delete("/api/ssh/tunnel/:tunnelId", (req, res) => {
  const result = sshTunnelService.closeTunnel(req.params.tunnelId);
  res.json(result);
});

app.get("/api/ssh/tunnels", (_req, res) => {
  res.json(sshTunnelService.listTunnels());
});

// --- Batch Command ---
app.post("/api/batch/exec", async (req, res) => {
  try {
    const result = await batchCommandService.execute(req.body);
    res.json(result);
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
    res.set("Cache-Control", "no-store");
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

app.post("/api/files/mkdir", async (req, res) => {
  try {
    const result = await fileTransferService.mkdir(req.body);
    res.json(result);
  } catch (error) {
    res.status(400).json({ message: error instanceof Error ? error.message : "Unknown error" });
  }
});

app.post("/api/files/compress", async (req, res) => {
  try {
    const result = await fileTransferService.compress(req.body);
    res.json(result);
  } catch (error) {
    res.status(400).json({ message: error instanceof Error ? error.message : "Unknown error" });
  }
});

app.post("/api/files/extract", async (req, res) => {
  try {
    const result = await fileTransferService.extractZip(req.body);
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

app.post("/api/files/archive-entry-preview", async (req, res) => {
  try {
    const result = await fileTransferService.previewArchiveEntry(req.body);
    res.json(result);
  } catch (error) {
    res.status(400).json({ message: error instanceof Error ? error.message : "Unknown error" });
  }
});

app.post("/api/logs/recordings/start", async (req, res) => {
  try {
    const serverId = String(req.body?.serverId || "").trim();
    const filePath = String(req.body?.filePath || "").trim();
    const directoryPath = String(req.body?.directoryPath || "").trim();
    if (!serverId || !filePath) {
      throw new Error("serverId 和 filePath 必填");
    }

    // Translate JumpServer SFTP virtual paths to real filesystem paths
    const parsed = parseJumpServerSftpPath(filePath);
    const realFilePath = parsed ? parsed.realPath : filePath;
    const realDirPath = parsed && directoryPath ? (parseJumpServerSftpPath(directoryPath)?.realPath || directoryPath) : directoryPath;

    const outputPath = buildRecordingOutputPath(filePath, directoryPath);
    const realOutputPath = buildRecordingOutputPath(realFilePath, realDirPath);
    const realPidFilePath = `${realOutputPath}.pid`;
    const sessionId = randomUUID();
    const startedAt = new Date().toISOString();

    // Use REAL paths for all shell commands
    const edir = shellEscape(path.posix.dirname(realOutputPath) || ".");
    const eout = shellEscape(realOutputPath);
    const epid = shellEscape(realPidFilePath);
    const esrc = shellEscape(realFilePath);

    // Determine connection strategy (mirror live follow approach)
    const server = serverRegistryService.getServer(serverId);
    const isJumpServer = sshExecutorService.isJumpServerBastion(server);

    if (isJumpServer && parsed) {
      // JumpServer bastion: connect to target asset via JumpServer menu navigation
      const assetKeyword = buildJumpServerAssetKeyword(parsed.assetKey);
      console.log(`[recording] JumpServer asset="${assetKeyword}" realPath="${realFilePath}" realOut="${realOutputPath}"`);
      const connection = await sshExecutorService.connectToJumpServerAsset(serverId, assetKeyword, 30000);
      // Run setup + foreground tail through the persistent shell to the target
      connection.shellStream!.write(`mkdir -p ${edir}; rm -f ${eout} ${epid}; touch ${eout}; tail -n 0 -F ${esrc} >> ${eout} 2>/dev/null\r`);
      recordingConnections.set(sessionId, { cleanup: connection.cleanup });
    } else {
      // Direct: setup + background tail with nohup (single exec)
      const bgScript = `mkdir -p ${edir}; rm -f ${eout} ${epid}; touch ${eout}; nohup tail -n 0 -F ${esrc} >> ${eout} 2>/dev/null </dev/null & echo $! > ${epid}; sleep 0.3; if [ -s ${epid} ] && kill -0 $(cat ${epid}) 2>/dev/null; then echo RECORD_OK; else echo RECORD_FAIL; fi`;
      const bgOutput = (await sshExecutorService.exec(serverId, `sh -lc ${shellEscape(bgScript)}`, 15000)).trim();
      if (bgOutput.includes("RECORD_FAIL")) {
        throw new Error(`录制启动失败：远程 tail 进程未能存活`);
      }
    }

    const session: LogRecordingSession = {
      sessionId,
      serverId,
      sourcePath: filePath,
      outputPath,
      realSourcePath: realFilePath,
      realOutputPath,
      realPidFilePath,
      startedAt,
    };
    activeLogRecordings.set(sessionId, session);
    res.json(session);
  } catch (error) {
    res.status(400).json({ message: error instanceof Error ? error.message : "Unknown error" });
  }
});

app.post("/api/logs/recordings/stop", async (req, res) => {
  try {
    const sessionId = String(req.body?.sessionId || "").trim();
    const session = activeLogRecordings.get(sessionId);
    if (!session) {
      throw new Error("录制会话不存在或已失效");
    }

    // Close persistent connection first (JumpServer foreground tail)
    const persistentConn = recordingConnections.get(sessionId);
    if (persistentConn) {
      try { persistentConn.cleanup(); } catch { /* ignore */ }
      recordingConnections.delete(sessionId);
      await new Promise((r) => setTimeout(r, 500));
    }

    const eout = shellEscape(session.realOutputPath);
    const epid = shellEscape(session.realPidFilePath);
    const stopScript = [
      `if [ -f ${epid} ]; then kill $(cat ${epid}) 2>/dev/null; rm -f ${epid}; fi`,
      `sleep 0.3`,
      `if [ -f ${eout} ]; then wc -c < ${eout} | tr -d ' '; else printf '0'; fi`,
    ].join("; ");
    const command = `sh -lc ${shellEscape(stopScript)}`;

    const output = await sshExecutorService.exec(session.serverId, command, 15000);
    activeLogRecordings.delete(sessionId);
    res.json({
      sessionId,
      serverId: session.serverId,
      sourcePath: session.sourcePath,
      outputPath: session.outputPath,
      startedAt: session.startedAt,
      stoppedAt: new Date().toISOString(),
      sizeBytes: Number.parseInt(String(output).trim(), 10) || 0,
    });
  } catch (error) {
    res.status(400).json({ message: error instanceof Error ? error.message : "Unknown error" });
  }
});

app.post("/api/files/download", async (req, res) => {
  try {
    const { stream, fileName, size, cleanup } = await fileTransferService.prepareStreamDownload(req.body);
    res.setHeader("Content-Type", "application/octet-stream");
    res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(fileName)}"`);
    if (size > 0) {
      res.setHeader("Content-Length", size);
    }
    stream.on("error", (err) => {
      console.error("[download] stream error:", err.message);
      cleanup?.();
      if (!res.headersSent) {
        res.status(500).json({ message: err.message });
      } else {
        res.destroy();
      }
    });
    res.on("close", () => cleanup?.());
    stream.pipe(res);
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

app.post("/api/files/upload/local", async (req, res) => {
  try {
    const serverId = req.body?.serverId as string;
    const filePath = req.body?.filePath as string;
    const localPath = req.body?.localPath as string;
    if (!serverId || !filePath || !localPath) throw new Error("serverId、filePath 和 localPath 必填");
    console.log(`[upload/local] serverId=${serverId} filePath=${filePath} localPath=${localPath}`);
    const result = await fileTransferService.uploadLocal(serverId, filePath, localPath);
    res.json(result);
  } catch (error) {
    console.error("[upload/local] error:", error);
    res.status(400).json({ message: error instanceof Error ? error.message : "Unknown error" });
  }
});

app.post("/api/files/upload/local/stream", async (req, res) => {
  const writeEvent = (payload: Record<string, unknown>) => {
    res.write(`${JSON.stringify(payload)}\n`);
  };

  try {
    const serverId = req.body?.serverId as string;
    const filePath = req.body?.filePath as string;
    const localPath = req.body?.localPath as string;
    if (!serverId || !filePath || !localPath) throw new Error("serverId、filePath 和 localPath 必填");

    res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders?.();

    console.log(`[upload/local/stream] serverId=${serverId} filePath=${filePath} localPath=${localPath}`);
    let lastEmit = 0;
    const result = await fileTransferService.uploadLocal(serverId, filePath, localPath, (transferred, chunkBytes, totalBytes) => {
      const now = Date.now();
      if (now - lastEmit < 200 && transferred < totalBytes) {
        return;
      }
      lastEmit = now;
      writeEvent({ type: "progress", transferred, chunkBytes, totalBytes });
    });
    writeEvent({ type: "done", filePath: result.filePath, size: result.size });
    res.end();
  } catch (error) {
    console.error("[upload/local/stream] error:", error);
    if (!res.headersSent) {
      res.status(400);
      res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
    }
    writeEvent({ type: "error", message: error instanceof Error ? error.message : "Unknown error" });
    res.end();
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
const desktopUpdateStatic = createDesktopUpdateStatic();
if (desktopUpdateStatic) {
  app.use("/desktop-updates", desktopUpdateStatic);
  // 目录已挂载但文件不存在时返回 404，避免落到前端 SPA fallback
  app.get("/desktop-updates/*", (_req, res) => res.status(404).end());
  logPhase(`Desktop update source (${resolveDesktopUpdateDir()})`, t);
} else {
  app.get("/desktop-updates/*", (_req, res) => res.status(404).end());
}

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
  let activeSessionId = "";
  let liveExecStream: { destroy: (error?: Error) => void } | null = null;

  function send(payload: Record<string, unknown>) {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(payload));
    }
  }

  function cleanupLiveConnection() {
    const stream = liveExecStream;
    const cleanup = clientCleanup;
    liveExecStream = null;
    clientCleanup = null;
    activeSessionId = "";
    try {
      stream?.destroy();
    } catch {
      // noop
    }
    cleanup?.();
  }

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
        send({ type: "error", message: "Unsupported live action." });
        return;
      }

      cleanupLiveConnection();
      const sessionId = `live-${payload.serverId}-${Date.now()}`;
      activeSessionId = sessionId;

      const server = serverRegistryService.getServer(payload.serverId);
      const isJumpServer = sshExecutorService.isJumpServerBastion(server);
      let tailFilePath = payload.filePath;
      let connection: Awaited<ReturnType<typeof sshExecutorService.connectForStreaming>>;

      if (isJumpServer) {
        const parsed = parseJumpServerSftpPath(payload.filePath);
        if (!parsed) {
          send({ type: "error", message: "无法解析堡垒机文件路径，请确认路径格式。" });
          return;
        }
        tailFilePath = parsed.realPath;
        const assetKeyword = buildJumpServerAssetKeyword(parsed.assetKey);
        console.log(`[live] JumpServer asset="${assetKeyword}" realPath="${tailFilePath}"`);
        connection = await sshExecutorService.connectToJumpServerAsset(payload.serverId, assetKeyword, 45000);
      } else {
        connection = await sshExecutorService.connectForStreaming(payload.serverId, 45000);
      }

      if (activeSessionId !== sessionId) {
        connection.cleanup();
        return;
      }

      let connectionReleased = false;
      const releaseConnection = () => {
        if (connectionReleased) {
          return;
        }
        connectionReleased = true;
        connection.cleanup();
      };

      clientCleanup = releaseConnection;

      const command = buildTailCommand(tailFilePath, payload.keyword);
      const client = connection.client;
      const shellStream = connection.shellStream;

      client.on("error", (error) => {
        if (activeSessionId !== sessionId) {
          return;
        }
        send({ type: "error", message: error.message });
      });

      if (connection.mode === "jumpserver-shell" && shellStream) {
        // JumpServer shell echoes the command back; suppress the first line (echo)
        let echoSuppressed = false;
        let echoBuffer = "";

        shellStream.on("data", (chunk: Buffer | string) => {
          if (activeSessionId !== sessionId) {
            return;
          }
          let text = chunk.toString();

          if (!echoSuppressed) {
            echoBuffer += text;
            const nlIdx = echoBuffer.indexOf("\n");
            if (nlIdx === -1) return; // still accumulating echo line
            text = echoBuffer.substring(nlIdx + 1);
            echoSuppressed = true;
            if (!text) return; // nothing left after stripping echo
          }

          send({
            sessionId,
            chunk: text,
            timestamp: new Date().toISOString()
          });
        });

        shellStream.stderr.on("data", (chunk: Buffer | string) => {
          if (activeSessionId !== sessionId) {
            return;
          }
          send({
            type: "stderr",
            sessionId,
            chunk: chunk.toString(),
            timestamp: new Date().toISOString()
          });
        });

        shellStream.on("close", () => {
          if (activeSessionId !== sessionId) {
            return;
          }
          cleanupLiveConnection();
          send({ type: "closed", sessionId });
        });

        shellStream.write(`${command}\r`);
      } else {
        client.exec(command, (error, stream) => {
          if (error) {
            if (activeSessionId === sessionId) {
              send({ type: "error", message: error.message });
              cleanupLiveConnection();
            } else {
              releaseConnection();
            }
            return;
          }

          if (activeSessionId !== sessionId) {
            stream.destroy();
            releaseConnection();
            return;
          }

          liveExecStream = stream;

          stream.on("data", (chunk: Buffer | string) => {
            if (activeSessionId !== sessionId) {
              return;
            }
            send({
              sessionId,
              chunk: chunk.toString(),
              timestamp: new Date().toISOString()
            });
          });

          stream.stderr.on("data", (chunk: Buffer | string) => {
            if (activeSessionId !== sessionId) {
              return;
            }
            send({
              type: "stderr",
              sessionId,
              chunk: chunk.toString(),
              timestamp: new Date().toISOString()
            });
          });

          stream.on("close", () => {
            if (liveExecStream === stream) {
              liveExecStream = null;
            }
            if (activeSessionId !== sessionId) {
              return;
            }
            cleanupLiveConnection();
            send({ type: "closed", sessionId });
          });
        });
      }
    } catch (error) {
      send({
        type: "error",
        message: error instanceof Error ? error.message : "Invalid live payload."
      });
    }
  });

  socket.on("close", () => {
    clearInterval(heartbeat);
    cleanupLiveConnection();
  });
});

registerTerminalWebsocket(terminalWsServer, sshExecutorService);

httpServer.on("upgrade", (request, socket, head) => {
  const upgradeUrl = new URL(request.url || "/", "http://127.0.0.1");
  const pathname = upgradeUrl.pathname;

  /* 浏览器 WebSocket 带不了请求头：鉴权走 ?token= 查询参数 */
  if (authService.isEnabled() && !authService.verify(upgradeUrl.searchParams.get("token"))) {
    socket.destroy();
    return;
  }

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

// Cleanup cached SSH connections on shutdown
const gracefulShutdown = () => {
  sshExecutorService.disposeAllCaches();
  process.exit(0);
};
process.on("SIGTERM", gracefulShutdown);
process.on("SIGINT", gracefulShutdown);

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
