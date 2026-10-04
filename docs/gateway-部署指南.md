# Gateway 远程部署指南

> 适用场景：把连接服务（Gateway）部署到一台常开的服务器上，浏览器扩展或桌面端作为瘦客户端直连，本地不再需要启动任何进程。方案设计见 [gateway-可配置与远程部署方案.md](./gateway-可配置与远程部署方案.md)。

## 1. 构建

```bash
git clone <本仓库> && cd server-log-console
npm install
npm --prefix apps/gateway run build   # 产物在 apps/gateway/dist
```

运行只需 `apps/gateway/dist` + `apps/gateway/node_modules`（或 `npm ci --omit=dev` 后 `npm --prefix apps/gateway run start`）。

## 2. 令牌与配置

| 配置项 | 来源 | 说明 |
| --- | --- | --- |
| 访问令牌 | 环境变量 `GATEWAY_TOKEN`（优先） | 未设置则读配置文件 |
| 访问令牌 | `~/.server-log-console/gateway-auth.json` 的 `{ "token": "..." }` | 二者均未配置 = 鉴权关闭（仅建议本机使用） |
| 凭证明文导出 | 环境变量 `GATEWAY_HIDE_SECRETS=1` | 关闭 `/credentials/secret` 明文导出接口，多人共用建议开启 |
| 监听地址/端口 | `HOST` / `PORT` | 默认 `127.0.0.1:4040`；反代场景保持默认即可 |
| 连接数据目录 | `SERVER_LOG_CONFIG_HOME` | 默认 `~/.server-log-console`（服务器清单、凭证、路由都在这里） |

生成令牌：

```bash
openssl rand -hex 32
```

安全清单：

- 公网部署**必须**配置令牌，且走 TLS（见下节）；明文凭证文件 `chmod 600 credentials.json imported-credentials.json`；
- 配置目录 `chmod 700 ~/.server-log-console`；
- 防火墙只放行 443，不要直接暴露 4040；
- 多人共用时开启 `GATEWAY_HIDE_SECRETS=1`（任何持有令牌的人默认可以读取所有服务器凭证明文）。

## 3. systemd 服务

`/etc/systemd/system/slc-gateway.service`：

```ini
[Unit]
Description=Server Log Console Gateway
After=network.target

[Service]
Type=simple
User=slc
WorkingDirectory=/opt/slc-gateway
ExecStart=/usr/bin/node dist/index.js
Environment=NODE_ENV=production
Environment=GATEWAY_TOKEN=<openssl rand -hex 32 生成的令牌>
Environment=GATEWAY_HIDE_SECRETS=1
# Environment=SERVER_LOG_CONFIG_HOME=/var/lib/slc-gateway
Restart=on-failure
RestartSec=3

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now slc-gateway
```

## 4. nginx 反向代理（TLS + WebSocket）

Gateway 的终端与实时日志走 WebSocket（`/ws/terminal`、`/ws/live`），反代必须透传 Upgrade 头：

```nginx
server {
    listen 443 ssl http2;
    server_name gw.example.com;

    ssl_certificate     /etc/letsencrypt/live/gw.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/gw.example.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:4040;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_read_timeout 3600s;   # 终端长连接
        proxy_send_timeout 3600s;
    }
}
```

> 也可以用 Caddy（自动证书）：`gw.example.com { reverse_proxy 127.0.0.1:4040 }`，WebSocket 自动透传。

## 5. 客户端接入

1. 打开插件（或桌面端）→ 设置中心 → **连接服务**；
2. Gateway 地址填 `https://gw.example.com`，访问令牌填服务端配置的令牌；
3. 「测试连接」显示在线后，点「保存并重载」；
   - 浏览器扩展会弹出站点权限申请（`optional_host_permissions` 动态申请），需允许；
   - 远程地址强制 https：扩展页面是安全上下文，`ws://` 远程连接会被浏览器拦截；
4. 重载后服务器清单、终端、传输全部经远程 Gateway 执行。

不填地址 = 默认 `http://localhost:4040`（本地模式，行为与以往一致）。

## 6. 升级

```bash
cd /opt/slc-gateway && git pull && npm install && npm --prefix apps/gateway run build
sudo systemctl restart slc-gateway
```

连接数据（服务器清单/凭证）在配置目录中，升级不影响。
