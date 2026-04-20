# Server Log Console — 项目文档

面向研发、测试、实施人员的日志工作台。通过 SSH 连接 Linux 服务器，提供日志检索、实时追踪、大文件切片浏览、远程目录浏览、终端操作等能力，支持 Electron 桌面应用和 Chrome 插件两种形态。

---

## 1. 产品概述

### 1.1 定位

不是把 `grep` 包进浏览器，而是把服务器连接、日志检索、实时追踪、片段下载、大文件切片浏览、远程终端整合成一个可直接操作的中文界面。

核心目标：

- 快速定位指定关键字、单号、SQL、异常栈
- 在不下载整份大日志的前提下查看上下文
- 在测试与开发环境中安全地复用 FinalShell 连接信息

### 1.2 用户角色

- **开发**：调试时搜索测试和开发日志
- **QA**：通过日志查询验证发布行为
- **实施**：调查问题时间线并导出证据

### 1.3 范围

当前版本覆盖：FinalShell 导入、历史检索、实时追踪、目录浏览、大日志切片、结果下载、远程终端。

暂不覆盖：云端多用户部署、角色审批流、全文索引引擎、服务端持久化数据库。

---

## 2. 功能介绍

### 2.1 FinalShell 自动导入

自动读取本机 FinalShell 连接配置，支持两种导入方式：

- 自动检测常见目录（macOS / Windows / Linux）
- 用户手动指定 `conn` 目录

导入信息包括：服务器名称、主机地址、端口、用户名、分组路径、认证类型、是否存在本地密钥/密码。FinalShell 加密密码已支持解密导入。

配置目录和上次成功导入时间会持久化到本机。

### 2.2 连接凭证管理

凭证优先级：

1. 手动保存到本地的用户名、密码、私钥
2. FinalShell 导入的连接信息
3. 网关环境变量默认凭证

界面展示当前凭证来源和可用性，支持"测试连接"实际发起 SSH 验证。手动保存的凭证持久化到本机配置目录。

堡垒机支持：直连优先，失败后尝试堡垒机二跳。可为特定服务器指定优先堡垒机。

### 2.3 远程目录浏览

- 查看远程目录下的子目录和文件
- 识别文件/目录类型，展示文件大小
- 点击文件自动回填检索路径
- 目录内按文件名快速筛选

### 2.4 历史日志检索

查询条件：目标服务器、日志文件路径、指定日期、关键字/单号/SQL 片段。

网关基于结构化条件生成远程检索命令，通过 SSH 执行并返回结构化结果。支持：

- 命中条目数量与原始输出
- 结果标签页，支持二次筛选
- 搜索条件自动记忆与恢复
- 实时搜索进度上报

### 2.5 实时日志追踪

通过 WebSocket + SSH `tail -F` 实时推送新增日志。

- 关键字过滤透传
- 连接状态展示与自动重连
- 滚动暂停/恢复自动跟随
- 行数统计与实时片段下载
- 翻页浏览时自动暂停跟随，滚到底部恢复

### 2.6 大日志切片浏览

GB 级日志不整文件加载，按 `offset + length` 字节范围切片读取：

- 读取文件元信息（大小、修改时间、编码）
- 按完整行裁切返回
- 上一段 / 重新加载 / 下一段 / 跳到尾部
- 可调切片大小：32KB / 64KB / 128KB / 256KB
- 位置百分比显示
- Ctrl+Home / Ctrl+End 快捷键
- 搜索结果点击回跳日志上下文

### 2.7 日志下载

支持历史检索结果下载和实时日志片段下载，用于问题留痕和工单附证。

### 2.8 远程终端

内嵌 xterm.js 终端面板：

- 通过 WebSocket + SSH 建立远程 shell
- 支持堡垒机 / JumpServer 二跳
- 终端尺寸自适应（resize 事件透传到远端 PTY）
- Tab 补全、方向键历史

### 2.9 安全边界

- "生产"分组连接正常导入和展示，但系统不会主动自动连接
- 前端只提交结构化参数，不直接传 shell 命令
- SSH 能力集中在网关，浏览器不接触 SSH 协议
- 搜索值经过 shell 转义后再拼装命令

---

## 3. 架构设计

### 3.1 总体架构

```
┌─────────────────────────────────┐
│  Electron 桌面应用 / Chrome 插件  │  ← 前端 UI (React + xterm.js)
│  或直接访问 http://localhost:4040 │
└──────────────┬──────────────────┘
               │ HTTP / WebSocket
┌──────────────▼──────────────────┐
│        本地网关 (Node.js)        │  ← Express + ws
│  FinalShell 导入 / 凭证管理       │
│  SSH 执行 / 目录浏览 / 日志检索    │
│  实时日志流 / 终端 WebSocket      │
│  大文件切片                       │
└──────────────┬──────────────────┘
               │ SSH
┌──────────────▼──────────────────┐
│      远程 Linux 服务器            │
└─────────────────────────────────┘
```

### 3.2 分层职责

| 层 | 职责 |
|---|---|
| **前端** | 界面交互、参数录入、结果展示、文件下载、终端面板 |
| **网关** | FinalShell 读取、服务器注册、SSH 连接、命令构建、日志执行、WebSocket 会话管理 |
| **共享类型** | 统一前后端请求/响应结构，保证字段含义一致 |

### 3.3 使用形态

| 形态 | 说明 |
|---|---|
| **Electron 桌面应用** | 双击启动，gateway 自动运行，零配置。支持窗口置顶（Cmd+Shift+T） |
| **Chrome 插件** | 点击图标打开 `localhost:4040`，需先启动 gateway |
| **浏览器直接访问** | 打开 `http://localhost:4040`，gateway 同时服务 API 和前端 UI |

### 3.4 关键运行流程

**FinalShell 导入**：扩展调用 `GET /api/import/finalshell` → 网关读取本机 FinalShell 目录 → 转换为 `ServerSummary` → 注册到内存服务清单

**历史检索**：用户提交条件 → `POST /api/logs/search` → 网关生成安全命令 → SSH 执行 → 返回结构化结果

**实时日志**：`WS /ws/live` → `start` 指令 → SSH `tail -F` → 按块转发到浏览器

**大日志切片**：`POST /api/logs/meta` 获取文件信息 → `POST /api/logs/slice` 按字节区间读取

**远程终端**：`WS /ws/terminal` → `start` 指令 → SSH shell → 双向数据流 + resize 事件

### 3.5 多平台兼容

FinalShell 配置目录自动发现：

- macOS：`~/Library/FinalShell/conn`
- Linux：`~/.finalshell/conn`、`~/FinalShell/conn`
- Windows：`%LOCALAPPDATA%/FinalShell/conn`、`%APPDATA%/FinalShell/conn`

可通过 `FINALSHELL_HOME` 环境变量覆盖。

---

## 4. API 参考

基础地址：`http://localhost:4040`

### 4.1 健康检查

`GET /health` → `{ "ok": true, "service": "gateway", "now": "..." }`

### 4.2 服务器清单

`GET /api/servers` → 返回 `ServerSummary[]`

字段：`id` `name` `host` `port` `username` `basePath` `profile` `tags` `source` `groupPath` `authType` `hasStoredSecret`

### 4.3 FinalShell 导入

`GET /api/import/finalshell` → `{ importedAt, resolvedPath, searchedPaths, servers }`

### 4.4 历史日志检索

`POST /api/logs/search`

```json
{ "serverId": "...", "filePath": "...", "keyword": "...", "date": "2026-04-01", "contextLines": 3, "useRegex": false }
```

返回：`{ commandPreview, truncated, matches: [{ source, lineNumber, preview }], rawOutput }`

### 4.5 远程目录浏览

`POST /api/logs/files`

```json
{ "serverId": "...", "directoryPath": "/home/app/logs" }
```

返回：`{ directoryPath, entries: [{ path, name, kind, size }] }`

### 4.6 大日志元信息

`POST /api/logs/meta`

```json
{ "serverId": "...", "filePath": "..." }
```

返回：`{ filePath, size, modifiedTime, readable, encodingHint }`

### 4.7 大日志切片

`POST /api/logs/slice`

```json
{ "serverId": "...", "filePath": "...", "offset": 0, "length": 65536 }
```

返回：`{ actualOffset, actualLength, content, isStart, isEnd, nextOffset }`

### 4.8 结果导出

`POST /api/logs/export` — 请求同 search，响应为文本附件流。

### 4.9 实时日志 WebSocket

`WS /ws/live`

```json
← { "action": "start", "serverId": "...", "filePath": "...", "keyword": "ERROR" }
→ { "sessionId": "...", "chunk": "2026-04-06 15:00:00 ERROR ...", "timestamp": "..." }
→ { "type": "error", "message": "..." }
→ { "type": "closed", "sessionId": "..." }
```

### 4.10 终端 WebSocket

`WS /ws/terminal`

```json
← { "action": "start", "serverId": "...", "bastionId": "..." }
← { "action": "input", "data": "ls\r" }
← { "action": "resize", "cols": 120, "rows": 40 }
← { "action": "close" }
→ { "type": "ready" }
→ { "chunk": "..." }
→ { "type": "error", "message": "..." }
```

---

## 5. 数据模型

### ServerSummary

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | `string` | 唯一标识 |
| `name` | `string` | 显示名称 |
| `host` | `string` | SSH 主机 |
| `port` | `number` | SSH 端口 |
| `username` | `string` | SSH 用户名 |
| `basePath` | `string` | 默认日志根路径 |
| `profile` | `LogProfile` | 日志模板类型 |
| `tags` | `string[]` | 标签 |
| `source` | `manual \| finalshell` | 数据来源 |
| `groupPath` | `string[]` | FinalShell 分组路径 |
| `authType` | `password \| privateKey \| unknown` | 认证方式 |
| `hasStoredSecret` | `boolean` | 是否存在已保存密钥 |

### 凭证配置

环境变量方式一（统一账号）：

```bash
export SERVER_LOG_SSH_USERNAME=root
export SERVER_LOG_SSH_PASSWORD='your-password'
```

环境变量方式二（按服务器）：

```bash
export SERVER_LOG_CREDENTIALS_JSON='{ "server-id": {"username":"root","password":"..."} }'
```

也可在界面中手动补录并保存，持久化到本机。

---

## 6. 安装与运行

### 6.1 依赖安装

```bash
cd /path/to/server-log-console
npm install
```

### 6.2 Electron 桌面应用（推荐）

```bash
# 构建 gateway 和前端
npm run build

# 启动 Electron
npm --workspace @server-log-console/electron run start
```

双击即用，gateway 自动启动。支持窗口置顶（菜单 → 视图 → 窗口置顶，或 `Cmd+Shift+T`）。

打包分发：

```bash
npm --workspace @server-log-console/electron run dist:mac   # macOS .dmg
npm --workspace @server-log-console/electron run dist:win   # Windows .exe
npm --workspace @server-log-console/electron run dist:linux # Linux .AppImage
```

上述命令必须走 `apps/electron/package.json` 中预设脚本，不要长期依赖临时手写 shell 命令。当前脚本会先清理 `ELECTRON_RUN_AS_NODE` 再执行 `electron` / `electron-builder`，避免 IDE 宿主环境污染导致打包 app 以 Node 模式启动。

macOS 打包事故归档见：`docs/electron-macos-packaging-archive-2026-04-12.md`

### 6.3 浏览器直接访问

```bash
npm run dev:gateway    # 启动网关
npm run dev:extension  # 启动前端开发服务器
```

或一键构建启动：

```bash
npm run start          # 构建 + 启动 gateway，打开 http://localhost:4040
```

### 6.4 Chrome 插件

```bash
npm --workspace @server-log-console/extension run build
```

1. 打开 `chrome://extensions/` → 开发者模式
2. 加载已解压的扩展程序 → 选择 `apps/extension/dist`
3. 点击插件图标 → 打开 `http://localhost:4040`

插件需要 gateway 先运行。

### 6.5 FinalShell 导入

1. 打开设置
2. 查看系统自动识别到的 FinalShell 路径
3. 如果识别不对，手动填写 `conn` 目录
4. 保存后重新导入服务器清单

### 6.6 验收路径

1. 导入 FinalShell 连接
2. 选择测试或开发服务器
3. 自动连接并展开日志目录
4. 选择日志文件，确认尾部自动打开
5. 搜索已知关键字
6. 启动实时日志
7. 打开终端面板
8. 下载结果或片段

---

## 7. 常见问题

**提示没有可用凭证**：检查环境变量（`SERVER_LOG_CREDENTIALS_JSON` / `SERVER_LOG_SSH_PASSWORD`）或界面手动保存。

**实时日志连上但没有内容**：检查文件路径是否存在、SSH 用户是否有读权限、目标机是否支持 `tail -F`。

**导入后看不到服务器**：检查 FinalShell 目录是否正确、`conn` 下是否存在连接文件。

**大日志搜索慢**：先选时间范围再搜关键字；用多关键字缩小范围；先看尾部切片再决定全量搜索。

**终端 vim 显示异常**：确认 gateway 已更新到最新版本（支持 resize 事件透传）。

**macOS 打包后双击无界面或很快退出**：优先确认是否通过 `package.json` 预设命令打包/启动。不要从被 IDE 注入环境变量的临时命令直接启动 Electron。详见 `docs/electron-macos-packaging-archive-2026-04-12.md`。

---

## 8. 运维建议

- 网关仅部署在个人本机，不建议暴露到公网
- 对于 1GB 以上日志，优先使用时间范围 + 尾部切片 + 多关键字组合
- 若命令行更高效，可复制系统生成的搜索命令到服务器执行
- 敏感凭证不存储在浏览器扩展中

---

## 9. 项目结构

```
server-log-console/
├── apps/
│   ├── electron/      # Electron 桌面应用壳
│   │   ├── main.cjs       # 主进程：启动 gateway + 创建窗口
│   │   └── preload.cjs    # 预加载：暴露置顶 API
│   ├── extension/     # 前端 UI (React + Vite)
│   │   ├── src/ui/        # React 组件
│   │   ├── manifest.json  # Chrome 扩展清单
│   │   └── dist/          # 构建输出
│   └── gateway/       # 本地网关 (Express + ws + ssh2)
│       ├── src/
│       │   ├── index.ts                   # 入口与路由装配
│       │   └── modules/
│       │       ├── logs/                  # 搜索、切片、目录浏览
│       │       └── terminals/             # 终端 WebSocket
│       └── dist/          # 构建输出
├── packages/
│   └── shared/        # 共享类型定义
└── docs/
    ├── README.md      # 本文档
    ├── electron-macos-packaging-archive-2026-04-12.md
    └── version-repair-archive-2026-04-14.md
```

---

## 10. 归档与版本修复记录

建议后续统一审查时按以下顺序查看：

- `CHANGELOG.md`：快速看版本级变化摘要
- `docs/version-repair-archive-2026-04-14.md`：查看 2026-04-14 这轮 UI、上传、下载、解压、并发隔离的详细修复记录
- `docs/electron-macos-packaging-archive-2026-04-12.md`：查看 Electron macOS 打包启动问题的完整排障与结论归档

后续如果再出现“历史问题重复出现”的情况，优先先查这两类归档：

- 功能/交互/文件传输相关问题：先看版本修复归档
- 安装/打包/启动相关问题：先看 Electron 打包归档
