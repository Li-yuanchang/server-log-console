import { Client } from "ssh2";
import { createServer, connect, type Server } from "node:net";
import type { SshTunnelRequest, SshTunnelInfo, SshTunnelResponse, SshTunnelListResponse } from "@server-log-console/shared";
import { SshExecutorService } from "./ssh-executor.service.js";
import { ServerRegistryService } from "../servers/server-registry.service.js";
import { CredentialResolverService } from "../servers/credential-resolver.service.js";
import { z } from "zod";

const TunnelRequestSchema = z.object({
  serverId: z.string().min(1),
  tunnelType: z.enum(["local", "remote"]),
  localHost: z.string().default("127.0.0.1"),
  localPort: z.number().int().min(1).max(65535),
  remoteHost: z.string().default("127.0.0.1"),
  remotePort: z.number().int().min(1).max(65535),
});

interface ActiveTunnel {
  tunnelId: string;
  serverId: string;
  tunnelType: "local" | "remote";
  localHost: string;
  localPort: number;
  remoteHost: string;
  remotePort: number;
  status: "active" | "closed" | "error";
  createdAt: string;
  sshClient: Client;
  localServer?: Server;
  cleanup: () => void;
}

export class SshTunnelService {
  private tunnels = new Map<string, ActiveTunnel>();

  constructor(
    private readonly serverRegistry: ServerRegistryService,
    private readonly sshExecutor: SshExecutorService,
    private readonly credentialResolver: CredentialResolverService
  ) {}

  async createTunnel(raw: unknown): Promise<SshTunnelResponse> {
    const parsed = TunnelRequestSchema.safeParse(raw);
    if (!parsed.success) {
      return { ok: false, message: parsed.error.issues.map((i) => i.message).join("; ") };
    }
    const req: SshTunnelRequest = parsed.data;

    try {
      const server = this.serverRegistry.getServer(req.serverId);
      const credentials = this.credentialResolver.resolve(server);
      const tunnelId = `tunnel-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      const client = await this.createSshClient(credentials);

      if (req.tunnelType === "local") {
        return await this.createLocalForward(tunnelId, req, client);
      } else {
        return await this.createRemoteForward(tunnelId, req, client);
      }
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) };
    }
  }

  private createSshClient(credentials: { host: string; port: number; username: string; password?: string; privateKey?: string }): Promise<Client> {
    return new Promise<Client>((resolve, reject) => {
      const client = new Client();
      let settled = false;
      const timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        client.end();
        reject(new Error(`SSH 连接超时 (${credentials.host}:${credentials.port})`));
      }, 30000);

      client
        .on("ready", () => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          resolve(client);
        })
        .on("error", (error) => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          reject(error);
        })
        .connect({
          host: credentials.host,
          port: credentials.port,
          username: credentials.username,
          password: credentials.password,
          privateKey: credentials.privateKey,
          tryKeyboard: true,
          readyTimeout: 20000,
          keepaliveInterval: 10000,
          keepaliveCountMax: 60,
        });

      client.on("keyboard-interactive", (_name, _instructions, _lang, _prompts, finish) => {
        finish([credentials.password || ""]);
      });
    });
  }

  private async createLocalForward(tunnelId: string, req: SshTunnelRequest, client: Client): Promise<SshTunnelResponse> {
    const localServer = createServer((socket) => {
      client.forwardOut(socket.remoteAddress!, socket.remotePort!, req.remoteHost, req.remotePort, (error, stream) => {
        if (error) {
          socket.destroy();
          return;
        }
        socket.pipe(stream as unknown as NodeJS.WritableStream);
        (stream as unknown as NodeJS.ReadableStream).pipe(socket);
        socket.on("close", () => { try { (stream as any).end(); } catch {} });
        (stream as any).on("close", () => { try { socket.end(); } catch {} });
      });
    });

    return new Promise<SshTunnelResponse>((resolve) => {
      localServer.listen(req.localPort, req.localHost, () => {
        const cleanup = () => {
          try { localServer.close(); } catch {}
          try { client.end(); } catch {}
          const t = this.tunnels.get(tunnelId);
          if (t) t.status = "closed";
          this.tunnels.delete(tunnelId);
        };

        client.on("close", cleanup);
        client.on("error", () => {
          const t = this.tunnels.get(tunnelId);
          if (t) t.status = "error";
          cleanup();
        });

        this.tunnels.set(tunnelId, {
          tunnelId,
          serverId: req.serverId,
          tunnelType: "local",
          localHost: req.localHost,
          localPort: req.localPort,
          remoteHost: req.remoteHost,
          remotePort: req.remotePort,
          status: "active",
          createdAt: new Date().toISOString(),
          sshClient: client,
          localServer,
          cleanup,
        });

        resolve({ ok: true, tunnelId });
      });

      localServer.on("error", (error) => {
        try { client.end(); } catch {}
        resolve({ ok: false, message: `本地监听失败: ${error.message}` });
      });
    });
  }

  private async createRemoteForward(tunnelId: string, req: SshTunnelRequest, client: Client): Promise<SshTunnelResponse> {
    return new Promise<SshTunnelResponse>((resolve) => {
      client.forwardIn(req.remoteHost, req.remotePort, (error, port) => {
        if (error) {
          try { client.end(); } catch {}
          resolve({ ok: false, message: `远程转发失败: ${error.message}` });
          return;
        }

        const cleanup = () => {
          try { client.unforwardIn(req.remoteHost, req.remotePort); } catch {}
          try { client.end(); } catch {}
          const t = this.tunnels.get(tunnelId);
          if (t) t.status = "closed";
          this.tunnels.delete(tunnelId);
        };

        client.on("tcp connection", (_info, accept, reject) => {
          const stream = accept();
          // For remote forward, we connect to the local service
          const localSocket = connect(req.localPort, req.localHost);
          localSocket.pipe(stream);
          stream.pipe(localSocket);
          localSocket.on("close", () => { try { stream.end(); } catch {} });
          stream.on("close", () => { try { localSocket.end(); } catch {} });
          localSocket.on("error", () => { try { stream.end(); } catch {} });
        });

        client.on("close", cleanup);
        client.on("error", () => {
          const t = this.tunnels.get(tunnelId);
          if (t) t.status = "error";
          cleanup();
        });

        this.tunnels.set(tunnelId, {
          tunnelId,
          serverId: req.serverId,
          tunnelType: "remote",
          localHost: req.localHost,
          localPort: req.localPort,
          remoteHost: req.remoteHost,
          remotePort: req.remotePort,
          status: "active",
          createdAt: new Date().toISOString(),
          sshClient: client,
          cleanup,
        });

        resolve({ ok: true, tunnelId });
      });
    });
  }

  closeTunnel(tunnelId: string): SshTunnelResponse {
    const tunnel = this.tunnels.get(tunnelId);
    if (!tunnel) {
      return { ok: false, message: `隧道 ${tunnelId} 不存在` };
    }
    try {
      tunnel.cleanup();
      return { ok: true, tunnelId };
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) };
    }
  }

  listTunnels(): SshTunnelListResponse {
    const tunnels: SshTunnelInfo[] = Array.from(this.tunnels.values()).map((t) => ({
      tunnelId: t.tunnelId,
      serverId: t.serverId,
      tunnelType: t.tunnelType,
      localHost: t.localHost,
      localPort: t.localPort,
      remoteHost: t.remoteHost,
      remotePort: t.remotePort,
      status: t.status,
      createdAt: t.createdAt,
    }));
    return { tunnels };
  }

  closeAll(): void {
    for (const tunnel of this.tunnels.values()) {
      try { tunnel.cleanup(); } catch {}
    }
    this.tunnels.clear();
  }
}
