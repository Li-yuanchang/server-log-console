# Changelog

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
