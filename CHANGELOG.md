# Changelog

## 文档分工

- **`CHANGELOG.md`** — 只记录版本级摘要、对外可读的修复项和验证结论。
- **`docs/版本修复归档-2026-04-14.md`** — 记录问题背景、根因、修改点、经验教训和防复发清单。
- **维护约定** — 详细代码链、安装版资源命中、排查过程与复盘结论统一写入归档，不在 `CHANGELOG.md` 重复展开。

## [0.3.241] — 2026-10-05

SSH 执行器健壮性与终端 PiP 重排修复版本。

### 新增

- **SSH 执行器改造**（gateway）— 命令执行等待首个提示符再下发，横幅/回显/擦除的完整字节作为 initialBuffer 返回由调用方回放；任一步超时自动回退旧方案（回显可见 cd + 单行擦除）并恢复回显，保证可用性。
- **加载演示预览页** — `public/__loading-preview.html` 供 vite dev 预览加载态（构建产物自动剔除，见下）。

### 修复

- **终端 PiP 弹出后列数不刷新** — DOM 搬入画中画窗口后 xterm fit 插件读主 window 计算样式失效导致 fit 静默返回；改为绕过插件，按 PiP 容器实际尺寸 + 渲染器缓存字符单元手动 resize。
- **扩展构建保留名清除泛化** — vite 构建收尾递归清除 dist 内所有 `_` 开头条目（Chrome 系统保留名会拒绝加载整个扩展），新增 `__loading-preview.html` 类开发页不再污染产物。

### 验证

- **类型检查** — `apps/extension` 的 `npm run typecheck` 通过（0.3.240 已验证，本版结构未变）。
- **产物一致性** — dist/manifest.json、latest-mac.yml、CHANGELOG 三方版本号一致为 0.3.241；扩展 dist 无 `_` 开头文件。

## [0.3.240] — 2026-10-04

主题体系与终端工作区大版本；修复 Chrome 扩展因保留文件名无法加载的问题。

### 新增

- **主题系统** — 8 套主题 × 浅深变体、背景层、终端配色；确认对话框重构。
- **终端重设计** — 多标签、查找、状态栏、右键菜单，五段式常规布局；终端升为工作区视图，空态/批量条/水印对齐原型。
- **侧栏响应式** — Chrome side panel 窄面板两档布局，窄而高信息架构。
- **传输闸门** — 上传支持暂停/继续/取消，拖拽移动，完成卡改细条。
- **检索提速与进度内联** — grep→awk 组装器提速全文扫描，phrase 整句成词，工具行三行合一；检索进度内联到按钮，命中导航 ◀ n/N ▶。

### 修复

- **Chrome 扩展无法加载** — 构建产物含开发用 `__preview.html`，Chrome 禁止扩展包含 `_` 开头文件名（系统保留）而拒绝加载整个扩展；现构建收尾自动从 dist 剔除（开发预览改走 vite dev）。扩展 manifest 版本号构建时从权威版本（apps/electron/package.json）注入，不再手工同步。

### 验证

- **类型检查** — `apps/extension` 的 `npm run typecheck` 通过。
- **扩展加载验证** — dist 重建后无 `_` 开头文件，chrome://extensions 加载成功。
- **Gateway 远程部署验证** — 离线包（unofficial Node 20.20.2 glibc-217 + 生产依赖）部署至 CentOS 7 内网机，systemd 常驻，`/health` 开放、令牌鉴权 401/放行符合预期。

## [0.3.230] — 2026-09-28

内存诊断探针与图标语义统一版本。

### 新增

- **内存指标探针** — 主进程每 5 分钟将各进程工作集内存（Browser/Tab/GPU）与渲染进程 JS 堆用量写入 `/tmp/slc-mem-probe.log`，崩溃瞬间（renderer-gone）额外采样一次，为长会话内存增长提供实测曲线。

### 修复

- **图标语义统一（modern 主题对齐 lucide）** — 返回上一级 FolderUp→ArrowUp；上传目录 FolderOpen→FolderUp；批量移动 FolderOpen→FolderInput（新增 folder-move）；传输记录 ArrowUpDown→ArrowLeftRight（与 classic 一致）；清空选择 Undo2→ListX；重命名自绘文本线→TextCursorInput；含上下文自绘横线→AlignJustify。

### 验证

- **类型检查** — `apps/extension` 的 `npm run typecheck` 通过；`apps/electron/main.cjs` 语法检查通过。
- **安装版验证** — 打包 0.3.230 安装到 `/Applications` 并启动，`did-finish-load` 正常；探针首条记录 `rendererJsHeap=24.8MB/3585.8MB`，确认 V8 堆上限约 3.5GB。
- **内存根源审计结论** — 全部显式缓冲均有上限；膨胀主因是单次搜索结果被复制 4~6 份（`results` 状态含 matches/rawOutput/contextOutput，结果页签再存 content+fullContent+matches，最多 8 页签驻留），叠加 ≤10MB 文件预览双份内容；具体待探针曲线实测坐实。

## [0.3.229] — 2026-09-28

渲染进程崩溃自动恢复版本。

### 修复

- **崩溃自动恢复** — 主窗口渲染进程崩溃（`render-process-gone` 且非正常退出）时自动 reload 页面，5 分钟内最多 3 次；重载 10 秒未完成则销毁重建窗口；连续失败后弹窗提供「重新加载 / 退出」，替代原先的白屏假死。
- **PiP 窗口崩溃兜底** — 画中画窗口（日志/终端/工具）渲染进程崩溃后自动关闭该窗口，走既有 `pip-window-closed` 通知链，前端状态正常回收。

### 验证

- **类型检查** — `apps/extension` 与 `apps/gateway` 的 `npm run typecheck` 通过。
- **安装版验证** — 打包 0.3.229 并安装到 `/Applications/ServerLogConsole.app`，`gateway health ok attempt=1`。
- **崩溃恢复实测** — SIGKILL 渲染进程后，探针日志记录 `render-process-gone killed 9` → `renderer recovery reload attempt=1` → 234ms 后 `did-finish-load` → `renderer recovery reload finished`，新渲染进程正常拉起，窗口自动恢复。
- **根因备注** — 前一次会话（0.3.228，运行 31.5 小时）于 9-28 07:00 发生渲染进程 SIGTRAP 崩溃，栈落在 V8/GC 路径，判断为长会话 JS 堆耗尽；本版本先解决"崩溃后白屏无恢复"的体验问题，内存增长源待后续专项排查（`docs/未来开发计划.md` 可记录）。

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

- **详细修复记录** — `docs/版本修复归档-2026-04-14.md`

## [0.3.76] — 2026-04-14

Electron 文件浏览右键菜单回归修复版本。

### 修复

- **文件/目录右键菜单恢复** — 移除 `.app-shell` 全局 `-webkit-app-region: drag`，避免 Electron 沉浸式窗口把自定义右键菜单浮层吞掉；右键菜单 backdrop 明确标记 `no-drag`，恢复文件表与目录树右键菜单显示。
- **拖拽区域收敛** — 保留 `electron-sidebar-drag` 与 `.electron-immersive .toolbar-panel` 的精确拖拽区，避免全局拖拽区继续误伤弹层交互。

### 验证

- **安装版验证** — 清理 `apps/extension/dist`、`apps/extension/node_modules/.vite` 与 `apps/electron/.electron-build` 后执行 `npm run release:mac`，已打包 `0.3.76`、安装到 `/Applications/ServerLogConsole.app` 并自动启动；probe 再次确认 `gateway health ok attempt=1`。

### 归档

- **详细修复记录** — `docs/版本修复归档-2026-04-14.md`

## [0.3.75] — 2026-04-14

小窗状态条、开发者工具与加载过渡修复版本。

### 修复

- **小窗运行状态恢复** — 独立 viewer 小窗恢复浮层状态与最近活动日志，避免 `pip-standalone` 模式把关键运行信息一并隐藏。
- **主窗/小窗 DevTools** — 统一菜单、托盘和 `CmdOrCtrl+Shift+I` 到窗口感知的 `toggleDevTools` helper，主窗与独立小窗都可打开开发者工具。
- **打开文件 loading 过渡** — 收敛文件 loading 卡片样式，并在 `pip` 启动骨架中隐藏 toolbar 占位，消除小窗初始白块。

### 验证

- **安装版验证** — `npm run release:mac` 已打包 `0.3.75`、安装到 `/Applications/ServerLogConsole.app` 并自动启动；probe 再次确认 `gateway health ok attempt=1`。

### 归档

- **详细修复记录** — `docs/版本修复归档-2026-04-14.md`

## [0.3.74] — 2026-04-14

下载稳定性与并发隔离修复版本。

### 修复

- **活跃日志下载稳定性** — 修复 `ERR_CONTENT_LENGTH_MISMATCH`。直连下载不再直接 `cat` 活跃日志，而是先获取固定大小，再按该大小精确输出，避免 `Content-Length` 与实际下载字节数不一致。
- **上传失败不再打断下载** — 修复共享 SSH exec 连接在上传异常时被立即驱逐的问题。存在下载流等在途任务时改为延迟驱逐，避免一个失败操作误伤另一个并发任务。
- **安装版验证** — macOS 安装版重新打包、安装并启动验证通过，probe 已确认 `gateway health ok attempt=1`。

### 归档

- **详细修复记录** — `docs/版本修复归档-2026-04-14.md`

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

- **详细修复记录** — `docs/版本修复归档-2026-04-14.md`

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
