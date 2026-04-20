# Server Log Console

远程日志检索、实时追踪和大文件切片浏览的本地化工作台。

由**本地网关服务 + 浏览器前端**组成，通过 SSH 连接远程 Linux 服务器，提供中文操作界面。适合研发、测试、实施人员在开发和测试环境中快速定位日志问题。

---

## 核心功能

### 1. 服务器管理

- **FinalShell 自动导入**：一键读取本机 FinalShell 连接配置，自动识别 macOS / Windows / Linux 配置目录，支持解密 FinalShell 密码
- **手动维护**：支持手动添加、编辑、删除服务器
- **连接凭证**：支持密码和私钥认证，凭证持久化保存到本机，刷新页面不丢失
- **堡垒机 / JumpServer**：支持通过 JumpServer 堡垒机二跳连接内网目标机，自动搜索资产并跳转

### 2. 远程目录浏览

- 通过 SFTP 或 SSH 浏览远程目录结构
- 识别文件 / 目录类型，展示文件大小和修改时间
- 点击文件自动回填到日志路径
- 支持目录内文件名快速筛选
- 自动记忆每台服务器最后访问的目录

### 3. 历史日志检索

- 按**时间范围、多关键字、正则表达式、上下文行数**等条件查询
- 搜索结果高亮显示，支持上下翻阅命中
- 临时结果页支持**二次筛选**，并保留原日志回跳能力
- 自动记忆上次搜索条件，支持一键恢复
- 搜索结果可**下载**为文本文件

### 4. 大日志切片浏览

- 按 `offset + length` 读取指定字节范围，不需要下载整份日志
- 自动按完整行裁切
- 支持向前翻页、向后翻页、跳到尾部
- 搜索命中可直接跳转到对应切片偏移位置

### 5. 实时日志追踪

- 通过 WebSocket + SSH `tail -F` 实现实时日志流
- 支持关键字过滤
- 自动重连
- 实时片段可下载

### 6. 内嵌终端

- 通过 WebSocket 提供 SSH 终端
- 支持直连和堡垒机跳转
- 25 秒心跳保活，连接不易断开

### 7. 连接错误诊断

- 连接失败时直接在主界面显示中文错误信息
- 包含 `用户名@主机:端口` 上下文
- 覆盖认证失败、连接超时、连接被拒、握手失败等常见场景
- 提供「重新连接」和「连接设置」快捷操作

---

## 技术架构

```
浏览器 (React 19 + Vite)
  │
  ├── HTTP API ──→  本地网关 (Express + TypeScript)
  │                    │
  ├── WebSocket ──→    ├── SSH 连接管理 (ssh2)
  │   (实时日志/终端)    ├── SFTP 文件浏览
  │                    ├── FinalShell 导入 + 凭证解密
  │                    └── 本地配置持久化 (~/.server-log-console/)
  │
  └── Chrome 插件模式 (可选)
```

| 模块 | 技术栈 |
|------|--------|
| **前端** | React 19, Vite, 纯 CSS (无 UI 框架) |
| **后端** | Express, ssh2, ws, zod, crypto-js, TypeScript |
| **共享** | TypeScript 类型定义 (npm workspaces) |

---

## 项目结构

```
server-log-console/
├── apps/
│   ├── gateway/          # 本地网关服务
│   │   └── src/
│   │       ├── index.ts                    # 路由 + WebSocket
│   │       └── modules/
│   │           ├── logs/                   # SSH执行、日志检索、SFTP、切片
│   │           ├── servers/                # 服务器注册、FinalShell导入、凭证管理
│   │           └── terminals/              # WebSocket终端
│   └── extension/        # 浏览器前端
│       └── src/ui/
│           ├── App.tsx                     # 主应用组件
│           ├── styles.css                  # 全局样式
│           └── storage.ts                  # localStorage 持久化
├── packages/
│   └── shared/           # 前后端共享类型
└── docs/                 # 产品、架构、接口等文档
```

---

## 快速开始

### 环境要求

- Node.js 18+
- npm 9+

### 安装与启动

```bash
# 克隆仓库
git clone https://github.com/Li-yuanchang/server-log-console.git
cd server-log-console

# 安装依赖
npm install

# 开发模式（同时启动网关和前端）
npm run dev:gateway    # 终端 1：启动本地网关 → http://localhost:4040
npm run dev:extension  # 终端 2：启动前端    → http://localhost:5173
```

### 生产构建

```bash
npm run build
npm run start:gateway   # 网关同时托管前端静态文件 → http://localhost:4040
```

### Chrome 插件模式

```bash
npm run build:extension
# 在 Chrome → 扩展程序 → 开发者模式 → 加载已解压的扩展程序 → 选择 apps/extension/dist
```

---

## 凭证管理

服务器凭证**不存储在仓库中**，而是保存在本机 `~/.server-log-console/` 目录下。

### 凭证来源（按优先级）

1. **界面手动保存** — 在「连接凭证」面板输入密码或私钥
2. **FinalShell 导入** — 自动解密 FinalShell 配置中的密码
3. **环境变量** — 通过 `SERVER_LOG_CREDENTIALS_JSON` 批量配置

### 环境变量配置示例

```bash
export SERVER_LOG_CREDENTIALS_JSON='{
  "finalshell:abc123": { "username": "root", "password": "your-password" }
}'
```

---

## 文档

| 文档 | 说明 |
|------|------|
| [架构与修改地图](./docs/架构与修改地图.md) | 模块职责、关键数据流、常见改动入口与验证矩阵 |
| [拆分清单](./docs/拆分清单.md) | App.tsx / 样式 / gateway 拆分方案与推荐顺序 |
| [文档总览](./docs/文档总览.md) | 产品功能、架构设计、API 参考、安装运行 |
| [Electron macOS 开发指南](./docs/Electron-macOS-开发指南.md) | 桌面应用开发、打包与排障 |
| [Electron macOS 打包归档](./docs/Electron-macOS-打包归档-2026-04-12.md) | macOS 打包启动问题排障与结论 |
| [版本修复归档 2026-04-14](./docs/版本修复归档-2026-04-14.md) | UI、上传、下载、解压、并发隔离修复记录 |
| [版本修复归档 2026-04-19](./docs/版本修复归档-2026-04-19.md) | 传输记录弹框重构与样式修复记录 |

---

## License

MIT
