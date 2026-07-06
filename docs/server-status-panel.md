# 服务器状态面板设计与实现记录

更新时间：`2026-07-03`

## 定位

服务器状态面板用于在当前工作台内按需查看目标主机的实时资源快照，补齐类似 FinalShell 的服务器信息统计能力。

当前版本采用“手动打开 + 面板可见时默认定时刷新”的轻量方案，不做全局常驻后台轮询；用户仍可点击刷新按钮立即拉取一次状态。

## 入口

- 前端入口：日志预览顶部工具栏的“状态”按钮
- 展示位置：右侧 `UtilityWorkspace` 工具面板
- 面板类型：`status`
- 前端组件：`apps/extension/src/ui/ServerStatusPanel.tsx`
- API 包装：`apps/extension/src/ui/api.ts` 的 `apiGetServerSystemProfile`
- 交互约束：打开状态面板不切换“日志预览 / 文件目录”主视图，避免状态查看打断当前目录定位

## 网关接口

- 路由：`POST /api/servers/:serverId/system-profile`
- 服务：`apps/gateway/src/modules/servers/server-system-profile.service.ts`
- SSH 执行：复用 `SshExecutorService.exec()`
- 超时：默认 `30000ms`，请求可传 `timeoutMs`，服务端限制在 `5000ms` 到 `60000ms`

## 采集范围

当前采集只读信息：

- 主机名、系统名称、内核版本、运行时间
- 1/5/15 分钟负载
- CPU 核数和型号
- 内存、Swap 使用量与百分比
- 磁盘挂载点、容量、可用空间、使用率
- 网络接口累计收发字节
- RSS 排名前几位的进程

远端脚本只使用 `hostname`、`uname`、`uptime`、`free`、`df`、`ps`、`/proc/*` 等只读命令；输出为 tab 分隔行，本地 TypeScript 解析，避免远端 JSON 转义问题。

## JumpServer 策略

状态采集不直接对 JumpServer 入口账号执行系统命令。JumpServer 入口只是资产菜单，不能代表目标主机 CPU、内存、磁盘状态。

当前实现复用文件浏览和实时日志的虚拟路径解析策略：

- 前端请求 `system-profile` 时只传入可解析出 JumpServer 资产的 `contextPath`，不会把 `/`、`/DEFAULT`、部门目录等菜单层级直接传给后端
- 文件目录视图优先使用当前 `directoryPath` 作为状态目标，因为用户此时关注的是当前目录所在资产
- 日志预览/搜索视图优先使用当前 `filePath` 作为状态目标，因为用户此时关注的是当前日志文件所在资产
- JumpServer 资产根目录也算有效状态目标，例如 `/DEFAULT/数字化部/127.121_差旅管理系统生产环境_公司`；进入 `opt`、`var` 等真实目录不是采集状态的前置条件
- 如果当前位置是 JumpServer 菜单层级，前端只沿用当前工作区最近一次进入过的资产上下文，并在面板中显示“沿用资产”；没有历史资产时后端返回明确错误
- 后端通过 `parseJumpServerSftpPath(contextPath)` 解析出资产 key 和真实远端路径
- 再通过 `connectToJumpServerAsset()` 进入目标资产后执行状态采集脚本
- 如果没有可解析的资产上下文，直接返回明确错误，不再展示 `Unknown / 0%` 的误导性空状态

直连与普通二跳仍复用当前项目已经修复过的 `SshExecutorService.exec()`：

- 直连服务器走 direct SSH
- 普通堡垒机目标走 bastion SSH 转发
- 配置了 JumpServer 路由的目标或 JumpServer 入口当前资产上下文走 JumpServer shell 资产链路

这样可以保证状态采集和文件浏览、日志预览、终端打开使用同一连接策略，减少“直连能用但 JumpServer 不一致”的分叉问题。

## UI 原则

- 不使用全局 loading 弹窗，只在面板内部显示轻量骨架和刷新图标
- 面板打开后默认每 `10s` 自动刷新，关闭面板或切换到其他工具面板后停止轮询
- 自动刷新状态必须明确展示，手动刷新按钮只作为立即刷新入口，不能让用户误以为状态只能手动更新
- 不使用 hover 位移、缩放、文字放大，避免抖动
- 指标以卡片分组展示，优先展示可读百分比和 GB/MB 格式
- 失败信息只放在面板内部，不用醒目的全局红色 toast 打断用户

## 后续可扩展

- 增加刷新间隔设置，例如 5s、15s、60s
- 增加 CPU、内存、网络速率的小型历史曲线
- 对 JumpServer 入口服务器和 JumpServer 目标资产显示更明确的路径说明
- 支持 Windows 目标主机时增加 PowerShell 采集脚本
