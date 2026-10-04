# Gateway 可配置与远程部署方案

> 目标:gateway 地址从写死改为可配置(未配置默认 `http://localhost:4040`,行为不变),支持把 gateway 部署到远程服务器,插件与桌面 UI 作为瘦客户端直连;远程暴露时启用可选的 Bearer Token 鉴权。

## 1. 背景与现状

插件是纯客户端,所有 SSH 连接、终端、文件传输都由 gateway 进程持有。当前 gateway 地址写死:

| 位置 | 内容 |
| --- | --- |
| `apps/extension/src/ui/api.ts:27` | `localServiceBase` 单点常量,44 处 REST 调用全部引用它 |
| `apps/extension/src/ui/useTerminalSession.ts:592` | 终端 WS,由 base 做 `http→ws` 派生 |
| `apps/extension/src/ui/useLiveFollow.ts:122` | 实时日志 WS,同上派生 |
| `apps/extension/manifest.json` | `host_permissions` 写死 `localhost:4040` / `127.0.0.1:4040` |
| `apps/extension/src/ui/WorkspaceStartupCards.tsx:30` | 离线文案写死 `127.0.0.1:4040`(纯显示) |

gateway 侧现状:`cors()` 全开(`apps/gateway/src/index.ts:120`),**无任何鉴权**(`modules/auth/` 为空目录),WS upgrade 无校验(`index.ts:1141`),且存在凭证明文导出接口(`/credentials/secret`)。gateway 自身已静态托管扩展 UI(`index.ts:910`),配置目录 `~/.server-log-console/`(可由 `SERVER_LOG_CONFIG_HOME` 覆盖)。客户端持久化统一走 `localStorage`(扩展侧栏与 Electron `file://` 页均可用)。

## 2. 两种运行模式

- **本地模式(默认,零配置)**:Electron 拉起本地 gateway → 插件连 `localhost:4040`。与今天完全一致。
- **远程模式**:gateway 部署到服务器(TLS 反代 + Token)→ 插件或桌面 UI 填「地址 + 令牌」直连;本地无需启动任何进程。

**地址解析优先级**(api.ts 模块初始化时同步完成,零启动等待):

1. 显式配置(localStorage `server-log-console:gateway-config` 的 `baseUrl`);
2. 同源规则(保持现状:页面 origin 以 `:4040` 结尾 → 用自身 origin,覆盖 gateway 直接托管 UI 的场景);
3. 默认 `http://localhost:4040`。

> 注意:不把同源规则放宽到任意 http(s) origin——vite dev 预览页(`127.0.0.1:5173`)没有 /api 代理,放宽会破坏 `__preview.html` 的开发体验。反代 443 托管 UI 的场景由第 1 优先级覆盖(浏览器里设置一次,localStorage 持久)。

## 3. 客户端改造

### 3.1 配置模型与存储(storage.ts)

- 新增 key:`server-log-console:gateway-config`,JSON 结构 `{ baseUrl?: string; token?: string }`;
- 新增 `readGatewayConfig()` / `writeGatewayConfig()` / `clearGatewayConfig()`,模式与 `readSavedSearchSettings` 一致(try/catch + 字段校验),同步读写 localStorage。

### 3.2 api.ts 动态化

- `export const localServiceBase` 改为 `export let localServiceBase`,新增 `applyGatewayConfig({ baseUrl, token })`;ESM live binding 使 44 处调用点**零改动**(模板字符串每次求值都取当前值,Vite/Rollup 正确保留语义)。
- 地址规范化:trim → 无 scheme 补 `http://` → `new URL()` 校验 → 去尾部 `/`;非法则回退默认值并在活动日志提示。
- 令牌:模块内保存当前 token,导出 `getGatewayToken()`;新增 `gatewayFetch(input, init)` 统一注入 `Authorization: Bearer <token>`(api.ts 内 44 处 `fetch(` 机械替换为 `gatewayFetch(`,仅这一个文件)。
- WS 两处派生地址追加 `?token=`(浏览器 WS 无法带 header);`replace(/^http/, "ws")` 已正确处理 `https→wss`,无需改。

### 3.3 设置 UI

设置中心(ConnectionSettingsWorkspace 的 view 体系)新增「连接服务(Gateway)」视图:

- 字段:服务地址(占位 `http://localhost:4040`)、访问令牌(密码框,可选);
- 操作:「测试连接」(走 `/health`,区分 网络不通 / 401 未授权 / 在线)、「保存」、「恢复默认」;
- 状态行展示在线/离线/未授权;401 时给出「需要访问令牌」引导;
- **保存流程**:规范化 → 校验(远程地址必须 https/wss;`http` 仅允许 localhost / 127.0.0.1 / [::1],否则阻断并说明混合内容)→ 扩展环境下申请 host 权限(见 §4)→ `/health` 探测 → 持久化 → `location.reload()`。
- reload 的原因:`localServiceBase` 被收进 useMemo deps(`TerminalPane.tsx:65`、`TerminalWorkspace.tsx:139`)与既有 WS 长连接,整体重建最稳;设置变更低频,可接受。

### 3.4 离线/恢复逻辑

`useLocalService` 的轮询与自动恢复机制不变,配置切换靠 reload 天然重置。仅改文案:`WorkspaceStartupCards.tsx:30` 去掉写死的 `127.0.0.1:4040`,改为展示当前生效地址;离线提示区分「未启动(本地模式)」与「远程服务不可达」。

## 4. 扩展权限动态申请

- `manifest.json` 增加 `optional_host_permissions: ["http://*/*", "https://*/*"]`(现有 localhost 的 `host_permissions` 保留,免申请);
- 保存**非本地**地址时,在保存按钮的用户手势内调用 `chrome.permissions.request({ origins: [`${origin}/*`] })`;用户拒绝则不保存并 toast 说明;
- WebSocket 无独立权限,由同 origin 的 host 权限覆盖;
- Electron(`file://`)无权限体系,跳过此步骤。

## 5. Gateway 鉴权

### 5.1 令牌配置

优先级:`GATEWAY_TOKEN` 环境变量 > `~/.server-log-console/gateway-auth.json`(`{ "token": "..." }`)> 未启用。

- **未启用 = 行为与今天完全一致**(本地模式零配置,向后兼容);
- 文档给出令牌生成方式:`openssl rand -hex 32`。

### 5.2 校验实现

- 新模块 `modules/auth/auth.service.ts`(空目录即现成占位):令牌加载、`timingSafeEqual` 常量时间比较、按 IP 的失败限速(内存 Map,如 5 分钟 20 次失败 → 429);
- HTTP 中间件:`/health` 保持开放(离线状态展示依赖它,只泄露存活信息);其余路由校验 `Authorization: Bearer`,失败返回 401 JSON `{ message: "需要访问令牌" }`;
- WS:`index.ts:1141` 的 upgrade 处理器对 `/ws/terminal`、`/ws/live` 校验 `?token=`,失败直接 `socket.destroy()`;
- CORS:保留 `cors()`(有令牌后风险可控),文档注明共享部署可选收紧 origin。

### 5.3 可选加固(共享部署建议,列为开关)

- `GATEWAY_HIDE_SECRETS=1`:关闭凭证明文导出类接口(`/credentials/secret`),多人共用时默认应开启;
- 操作审计日志(连接、读凭证等)列为后续项。

## 6. 远程部署

- 构建:`npm --prefix apps/gateway run build` → `node dist/index.js`(端口可 env 覆盖);
- systemd 单元 + nginx TLS(含 `Upgrade`/`Connection` 头以透传 WS)样例随文档交付;
- 安全清单:令牌必配、`~/.server-log-console` 目录 `700`、凭证文件 `600`、防火墙仅放行 443、建议开启 `GATEWAY_HIDE_SECRETS`。

## 7. 兼容性与风险

| 风险 | 说明 | 对策 |
| --- | --- | --- |
| ESM live binding | `export let` 的跨模块可见性依赖打包器语义 | Vite/Rollup 均正确保留;若仍顾虑,退化为 `getGatewayBase()`(需改 44+4 处调用) |
| 保存后 reload | memo 依赖与 WS 长连接需重建 | 统一 `location.reload()`,低频操作可接受 |
| 混合内容 | 扩展页面是安全上下文,远程 `ws://` 被浏览器拦截 | 远程必须 https/wss,保存时校验阻断;localhost 豁免 |
| Token 存 localStorage | XSS 可读 | manifest CSP 已 `script-src 'self'`;文档注明勿注入未知脚本 |
| AI 助手 | 独立子系统,endpoint 本就可配置 | 不在本方案范围 |
| 桌面自动更新 | `/desktop-updates` 走 Electron 本地 gateway | 与远程模式无关,不受影响 |

## 8. 实施拆分(每阶段可独立交付)

1. **P1 客户端可配置地址**:storage 读写 + api.ts 动态化(`let` + `configureGateway`)+ 设置中心新视图 + 文案修复 + 保存后 reload。未配置时行为与现状完全一致。
2. **P2 扩展权限动态申请**:`optional_host_permissions` + 保存时 `permissions.request` + 拒绝处理。
3. **P3 gateway 鉴权**:auth 模块 + HTTP/WS 校验 + 限速;客户端 `gatewayFetch` 注入与 WS `?token=`;401 引导设置。默认关闭,不影响现有用户。
4. **P4 部署文档**:systemd + nginx 样例、令牌发放流程、安全清单。

## 9. 验收清单

- [ ] 未配置时:扩展与 Electron 的连接、终端、传输、实时日志与现状一致(回归);
- [ ] 配置远程地址:保存 → 权限申请 → 在线;终端/文件浏览/实时日志全部走远程;断网后进入离线轮询,恢复后自动重载服务器列表;
- [ ] 令牌:未带令牌访问 API 返回 401 并引导填写;填写后恢复;`/health` 始终可达;限速生效;
- [ ] 远程 http 地址保存被阻断,https/wss 正常;
- [ ] Electron UI 填远程地址后可作为瘦客户端使用(本地 gateway 可不启动)。
