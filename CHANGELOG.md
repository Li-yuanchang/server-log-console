# Changelog

## 文档分工

- **`CHANGELOG.md`** — 只记录版本级摘要、对外可读的修复项和验证结论。
- **`docs/version-repair-archive-2026-04-14.md`** — 记录问题背景、根因、修改点、经验教训和防复发清单。
- **维护约定** — 详细代码链、安装版资源命中、排查过程与复盘结论统一写入归档，不在 `CHANGELOG.md` 重复展开。

## [0.3.80] — 2026-04-14

文件浏览目录删除与右键切换修复版本。

### 修复

- **目录删除闭环** — 文件浏览右键菜单的“删除”支持目录；直连 SSH 与堡垒机 SFTP 两条删除链都已补齐，并显式保护根目录。
- **右键菜单直接切换目标** — 已打开菜单时，右键其他文件或目录可直接切到新目标，不再要求先手动关闭旧菜单。
- **搜索修复保持有效** — 打包后的安装版继续保留 streaming search 修复链，没有回退到旧的搜索失败路径。

### 验证

- **类型检查** — `apps/gateway` 与 `apps/extension` 的 `npm run typecheck` 均通过。
- **安装版验证** — 执行 `apps/electron` 的 `npm run release:mac` 后，版本已自动 bump 到 `0.3.80`，已安装到 `/Applications/ServerLogConsole.app` 并启动；probe 再次确认 `gateway health ok attempt=1` 与 `ready-to-show`。

### 归档

- **详细修复记录** — `docs/version-repair-archive-2026-04-14.md`

## [0.3.76] — 2026-04-14

Electron 文件浏览右键菜单回归修复版本。

### 修复

- **文件/目录右键菜单恢复** — 移除 `.app-shell` 全局 `-webkit-app-region: drag`，避免 Electron 沉浸式窗口把自定义右键菜单浮层吞掉；右键菜单 backdrop 明确标记 `no-drag`，恢复文件表与目录树右键菜单显示。
- **拖拽区域收敛** — 保留 `electron-sidebar-drag` 与 `.electron-immersive .toolbar-panel` 的精确拖拽区，避免全局拖拽区继续误伤弹层交互。

### 验证

- **安装版验证** — 清理 `apps/extension/dist`、`apps/extension/node_modules/.vite` 与 `apps/electron/.electron-build` 后执行 `npm run release:mac`，已打包 `0.3.76`、安装到 `/Applications/ServerLogConsole.app` 并自动启动；probe 再次确认 `gateway health ok attempt=1`。

### 归档

- **详细修复记录** — `docs/version-repair-archive-2026-04-14.md`

## [0.3.75] — 2026-04-14

小窗状态条、开发者工具与加载过渡修复版本。

### 修复

- **小窗运行状态恢复** — 独立 viewer 小窗恢复浮层状态与最近活动日志，避免 `pip-standalone` 模式把关键运行信息一并隐藏。
- **主窗/小窗 DevTools** — 统一菜单、托盘和 `CmdOrCtrl+Shift+I` 到窗口感知的 `toggleDevTools` helper，主窗与独立小窗都可打开开发者工具。
- **打开文件 loading 过渡** — 收敛文件 loading 卡片样式，并在 `pip` 启动骨架中隐藏 toolbar 占位，消除小窗初始白块。

### 验证

- **安装版验证** — `npm run release:mac` 已打包 `0.3.75`、安装到 `/Applications/ServerLogConsole.app` 并自动启动；probe 再次确认 `gateway health ok attempt=1`。

### 归档

- **详细修复记录** — `docs/version-repair-archive-2026-04-14.md`

## [0.3.74] — 2026-04-14

下载稳定性与并发隔离修复版本。

### 修复

- **活跃日志下载稳定性** — 修复 `ERR_CONTENT_LENGTH_MISMATCH`。直连下载不再直接 `cat` 活跃日志，而是先获取固定大小，再按该大小精确输出，避免 `Content-Length` 与实际下载字节数不一致。
- **上传失败不再打断下载** — 修复共享 SSH exec 连接在上传异常时被立即驱逐的问题。存在下载流等在途任务时改为延迟驱逐，避免一个失败操作误伤另一个并发任务。
- **安装版验证** — macOS 安装版重新打包、安装并启动验证通过，probe 已确认 `gateway health ok attempt=1`。

### 归档

- **详细修复记录** — `docs/version-repair-archive-2026-04-14.md`

## [0.3.73] — 2026-04-14

文件浏览、上传、解压与弹窗体验修复版本。

### 新增

- **压缩包解压** — 文件右键菜单新增“解压到当前目录”和“解压到...”能力，前后端打通远程解压流程。
- **目录上传按钮** — 新增独立“上传目录”入口，与普通文件上传分离。
- **垃圾文件过滤** — 上传时自动跳过 `.DS_Store`、`Thumbs.db`、`desktop.ini`、`__MACOSX`、`._*` 等系统垃圾文件。

### 修复

- **Toast dismiss 小方块** — 关闭按钮默认隐藏，仅在 hover 时显示。
- **文件行交互冲突** — 修复 `.file-row` 点击缩放和悬浮按钮事件传播冲突。
- **多层级目录上传** — 修复目录拖拽上传仅上传部分文件、后端目录未完整创建的问题。
- **下载与上传并发** — 下载进度不再被全局 busy 状态误伤，上传与下载可并行进行。
- **打开文件双 loading** — 打开日志文件时移除重复 loading，统一为文件区加载卡片。
- **弹窗白色方块闪烁** — 增加入场动画，消除弹窗初始闪烁。

### 归档

- **详细修复记录** — `docs/version-repair-archive-2026-04-14.md`

## [0.1.0] — 2026-04-11

首个功能完整版本。

### 核心功能

- **服务器管理** — 手动添加/编辑/删除，FinalShell 一键导入（macOS/Windows/Linux），Xshell 导入，密码 & 私钥凭证持久化
- **堡垒机二跳** — JumpServer 堡垒机连接，自动搜索资产列表
- **远程目录浏览** — SFTP / SSH 浏览目录结构，文件名筛选，目录记忆，文件大小 & 修改时间展示
- **历史日志检索** — 时间范围、多关键字、正则表达式、上下文行数，结果高亮，二次筛选，下载结果
- **大日志切片浏览** — offset + length 按字节读取，自动行裁切，前翻/后翻/跳尾/跳头/按位置跳转
- **实时日志追踪** — WebSocket + `tail -F`，关键字过滤，自动重连，片段下载
- **内嵌终端** — WebSocket SSH 终端，直连 & 堡垒机跳转，25s 心跳保活
- **连接错误诊断** — 中文错误信息，覆盖认证失败/超时/被拒/握手失败

### 前端

- React 19 + Vite，纯 CSS 双主题（经典 / 现代）
- 经典主题：渐变背景、斑马纹、圆角边框
- 现代主题：Vercel/Cal.com 风格，扁平化、8px 网格、Geist 字体
- Chrome 插件模式 (Manifest V3)
- 文件编辑器（CodeMirror）

### 后端

- Express + TypeScript 本地网关
- SSH 连接管理 (ssh2)
- SFTP 文件操作（浏览、上传、下载、删除、重命名、移动）
- FinalShell 配置解密导入
- 本地配置持久化 (`~/.server-log-console/`)

### 桌面应用

- Electron 封装，macOS / Windows / Linux 打包
- 自动启动内嵌 Gateway 服务
- 系统托盘图标（macOS 模板图标 + Windows/Linux 彩色图标）
- 窗口置顶切换
- 应用图标全套（SVG / PNG 16~1024 / icns / ico）

### 文档

- 功能介绍、架构设计、API 设计、数据模型、安全设计、运行维护、本地应用安装指南
- 主题设计规范 (THEME-SPEC.md)
