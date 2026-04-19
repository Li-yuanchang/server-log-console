# 版本修复归档（2026-04-14，v0.3.73 ~ v0.3.80）

## 0. 文档分工与使用约定

- **`CHANGELOG.md`**：记录版本级摘要、对外可读的修复项与验证结论。
- **本文档**：记录问题背景、根因、修改点、排查证据、经验教训与防复发清单。
- **去重约定**：逐版本 release note、安装版资源命中、代码链路与复盘结论不再双写；`CHANGELOG.md` 写“这版修了什么”，本文档写“为什么会出问题、怎么修、以后怎么避免再犯”。

## 1. 归档范围

本次归档覆盖 2026-04-14 这轮围绕文件浏览、上传、下载、压缩包解压、弹窗体验、小窗状态恢复、DevTools 可调试性、Electron 右键菜单回归、目录删除闭环、右键菜单直接切换目标、搜索修复复核与安装验证的修复，目标是把“原功能、修改点、解决的问题、根因、经验教训”统一沉淀到仓库文档，避免历史问题反复出现。

## 2. 版本范围

- 本归档覆盖 `v0.3.73`、`v0.3.74`、`v0.3.75`、`v0.3.76` 与 `v0.3.80`。
- **逐版本摘要以 `CHANGELOG.md` 为准**；本文不再重复逐版本 release note，而是按“问题域 / 根因 / 修改点 / 防复发”归并整理。

## 3. 原有能力基线

修复前项目已经具备：

- 远程目录浏览、文件预览、日志切片浏览
- 文件上传、下载、删除、重命名、移动
- 实时日志追踪与历史日志搜索
- Electron 打包安装与本地 Gateway 启动

本轮不是重做这些功能，而是在保留原能力前提下补齐稳定性、可用性与操作闭环。

## 4. 本轮新增与修复

### 4.1 UI 与交互修复

- `toast dismiss` 小方块：改为默认隐藏，仅 hover 显示
- 文件行 `scale` 动画与悬浮按钮冲突：排除 `.file-row` 的按钮按压缩放，补齐 `stopPropagation`
- 搜索/弹窗白色方块闪烁：增加 `backdrop fade-in + dialog scale-in`
- 打开文件出现两个 loading：移除重复 toast loading，只保留文件区 loading 卡片
- 独立小窗状态与活动日志恢复：`viewer` 小窗补回浮层状态条和最近活动区，避免 `pip-standalone` 隐藏主面板后看不到运行状态
- 小窗白块骨架清理：`index.html` 在 `pip` 启动骨架里隐藏 toolbar 占位，避免独立窗口初始闪出白块
- DevTools 调试入口统一：Electron 菜单、托盘和 `CmdOrCtrl+Shift+I` 统一转发到窗口感知 helper，主窗与小窗都能切换开发者工具
- Electron 文件/目录右键菜单恢复：移除 `.app-shell` 全局 `-webkit-app-region: drag`，只保留 `electron-sidebar-drag` 与 `.electron-immersive .toolbar-panel` 的精确拖拽区，并给右键菜单 backdrop 明确标记 `no-drag`，恢复文件表与目录树右键菜单显示
- 右键菜单直接切换目标：右键菜单 backdrop 改为不拦截指针事件，菜单改成依赖全局外部点击 / `Escape` 关闭；已打开菜单时，右键其他文件或目录会先关闭旧菜单再直接打开新目标菜单

### 4.1.1 文件浏览目录删除闭环

- 前端：`App.tsx` 的删除确认链从“只删文件”扩展为“文件/目录通用删除”，确认标题与文案按目标类型区分
- 目录刷新：删除当前浏览目录或其子目录时，删除完成后自动回到父目录刷新，避免仍停留在已删除路径
- 直连 SSH：`direct-strategy.ts` 从“目录直接报错”改为文件走 `rm -f`、目录走 `rm -rf`，并显式拒绝删除根目录
- 堡垒机 SFTP：`ssh-executor.service.ts` 的 `SftpSession` 补 `listDirectory()` 与 `rmdir()`；`sftpStatViaReaddir()` 补 `kind`；`bastion-sftp-strategy.ts` 递归删除目录内容后再 `rmdir`
- 隐藏文件：目录递归删除不复用 UI 那套隐藏文件过滤，而是只跳过 `.` / `..`，避免目录里存在隐藏文件时删不干净

### 4.2 上传相关修复

- 多层级目录上传失败：
  - 后端补 `mkdir -p`
  - 前端保留 `webkitRelativePath`
  - 拖拽遍历目录时补齐 `readEntries` 循环读取
- 自动过滤垃圾文件：
  - macOS：`.DS_Store`、`._*`、`__MACOSX`、`.Spotlight-V100`、`.Trashes`
  - Windows：`Thumbs.db`、`desktop.ini`、`ehthumbs.db`、`$RECYCLE.BIN` 等
- 新增“上传目录”按钮，和“上传文件”分开

### 4.3 压缩包解压能力

新增右键解压能力：

- 解压到当前目录
- 解压到用户指定目录

前后端新增内容：

- Gateway：`/api/files/extract`
- Frontend API：`apiExtractZip`
- UI：文件右键菜单 + `extractDialog`

支持格式：

- `.zip`
- `.tar.gz`
- `.tgz`
- `.tar.bz2`
- `.tar.xz`
- `.gz`

### 4.4 下载稳定性修复

- 下载不再依赖全局 `withBusy`，避免与其他操作共用同一套阻塞提示
- 修复 `ERR_CONTENT_LENGTH_MISMATCH`：
  - 根因：活跃日志文件下载时仍在增长，响应头里的 `Content-Length` 与实际发送字节数不一致
  - 修复：直连下载从 `cat file` 改为 `head -c <size> file`，严格按声明长度输出

### 4.5 上传失败打断下载

- 根因：上传报错时会驱逐共享 SSH exec 连接，导致同连接上的下载流也被一并断开
- 修复：`busy > 0` 时仅标记延迟驱逐，等最后一个在途操作释放后再清理连接

### 4.6 搜索失败修复安装版复核

- 安装版 `log-search-task.service.js` 仍保留 `strategy.execStreaming(...)` 路径，没有退回到旧的 ready-event 等待链
- 安装版 `ssh-executor.service.js` 的流式执行仍直接走 `connection.client.exec(command, ...)`
- 安装版 `command-builder.js` 仍保留 `totalBytes` 与 `reportStep` 逻辑，说明 mawk 兼容与首帧进度修复还在
- 安装版前后端资源额外复核命中：
  - 前端资源：`pointer-events:none`、`确定删除远程目录及其内容`
  - 网关资源：`SFTP rmdir 失败`、`禁止删除根目录`、`refuse-delete-root`

## 5. 关键根因总结

本轮问题不是单点故障，而是几类典型问题叠加：

1. **同一能力有两套状态源**
   - 例如打开文件同时使用页面 loading 与 toast loading，导致重复提示
2. **前后端对边界条件理解不一致**
   - 例如目录上传、多次 `readEntries`、活跃日志文件持续增长
3. **共享连接缺少失败隔离**
   - 一个上传失败不应直接杀掉正在下载的流
4. **交互细节未覆盖事件传播与主题覆盖**
   - 文件行 hover 区按钮、toast dismiss 样式等都属于这类问题
5. **窗口模式分支缺少能力对齐**
   - 独立 `pip` / popup 模式不能只复用主窗口的隐藏规则；状态展示、启动骨架和 DevTools 入口都要单独校准
6. **全屏交互层容易误伤后续目标事件**
   - 右键菜单用全屏 backdrop 时，如果 backdrop 本身吃掉指针事件，就会出现“旧菜单不关、新菜单打不开”的交互死锁
7. **文档职责边界不清会放大维护成本**
   - 如果 `CHANGELOG.md` 和归档同时写版本摘要、验证细节和排查证据，后续每次补版本都要双处同步，既容易遗漏，也会让真正的根因总结被版本描述淹没

## 6. 经验教训

后续类似需求必须优先检查：

- 一个动作是否出现了重复状态提示或重复 loading
- 下载流是否依赖实时变化的数据源，`Content-Length` 是否真实可靠
- 共享 SSH / SFTP 连接在异常场景下是否会误伤并发任务
- 拖拽目录遍历是否考虑浏览器分批返回目录项
- 右键菜单新增能力时，前端文案、API、后端实现、错误提示是否同时闭环
- 目录删除是否同时覆盖直连 SSH 与堡垒机 SFTP 两条链，并明确禁止删除根目录
- 弹层/backdrop 是否拦截了本该落到新目标上的后续右键事件
- 新增样式是否覆盖经典/现代两套主题
- 主窗与独立小窗是否共享关键调试能力，避免只有主窗能开 DevTools、只有主窗能看到状态
- 启动 skeleton 是否与最终布局一致，避免 popup 模式显示正式界面已隐藏的占位结构
- 写文档前是否先确定 `CHANGELOG.md` 写摘要、归档写复盘，避免同一信息双写

## 7. 防复发检查清单

每次合并文件传输、目录浏览、弹窗或新右键能力相关改动前，至少检查：

- 是否存在全局 busy 与局部 busy 重复展示
- 是否存在一个失败操作影响另一个并发操作
- 是否存在文件大小、偏移量、流输出长度不一致
- 是否存在拖拽目录只取到部分文件
- 是否已过滤系统垃圾文件
- 是否在直连与堡垒机两条删除链都验证了目录删除
- 是否验证了已打开右键菜单时，新的右键目标可以直接接管菜单
- 是否补了安装版验证与启动 probe 验证
- 是否把版本摘要留在 `CHANGELOG.md`，把根因、证据、经验教训留在归档

## 9. 文档维护约束

后续新增版本记录时，统一按下面规则执行：

- `CHANGELOG.md`：一句话版本定位 + 2~5 条修复摘要 + 1~2 条验证结论 + 归档链接。
- 归档：按问题域记录根因、修改点、证据、经验教训与检查清单，不重复抄写 changelog 版摘要。
- 如果某条内容回答的是“**为什么出错 / 怎么防复发**”，放归档；如果回答的是“**这个版本交付了什么**”，放 `CHANGELOG.md`。

## 10. 对审查的建议

后续审查建议按以下顺序对比：

1. `CHANGELOG.md` 看版本级摘要
2. 本文档看根因、修改点与经验教训
3. 需要追代码时，再对应查看：
   - `apps/extension/src/ui/App.tsx`
   - `apps/extension/src/ui/api.ts`
   - `apps/extension/src/ui/ToolIcon.tsx`
   - `apps/extension/src/styles.css`
   - `apps/extension/src/theme-modern.css`
   - `apps/gateway/src/index.ts`
   - `apps/gateway/src/modules/logs/file-transfer.service.ts`
   - `apps/gateway/src/modules/logs/strategies/direct-strategy.ts`
   - `apps/gateway/src/modules/logs/strategies/connection-strategy.ts`
   - `apps/gateway/src/modules/logs/ssh-executor.service.ts`
