# Electron macOS 打包启动问题归档（2026-04-12）

## 1. 现象

macOS 打包后的 `ServerLogConsole.app` 在启动时表现异常：

- 双击后无界面
- 进程被拉起后很快退出
- `main.cjs` 没有执行
- 一度看起来像 Electron 版本、asar、fuse、签名、架构兼容性问题

## 2. 最终根因

最终根因不是 Electron 版本本身，而是启动环境被 IDE 污染。

关键环境变量：

```bash
ELECTRON_RUN_AS_NODE=1
```

当这个变量被传给打包后的 Electron app 时，Electron 会以 Node 模式启动，而不是正常的 Electron 应用模式。结果就是：

- 主进程入口 `main.cjs` / `main.js` 不执行
- 不创建 `BrowserWindow`
- 没有正常 Electron bootstrap
- 进程很快 clean exit，表现为“打包后起不来”

## 3. 关键证据

通过 macOS `runningboardd` / LaunchServices 日志可见启动环境中存在：

```text
ELECTRON_RUN_AS_NODE = 1
```

同时排障过程中对最小 smoke app 的验证也说明：

- 不是业务代码导致
- 不是单一 Electron 主版本导致
- 不是 asar hash / fuse / 签名单点问题导致

## 4. 为什么一开始像版本问题

项目当时还存在一个真实的依赖配置问题：

```json
"build": {
  "electronVersion": "33.4.11"
},
"devDependencies": {
  "electron": "^32.2.7"
}
```

这不符合 `electron-builder` 官方推荐路径，会带来额外噪音：

- `electronVersion` 被手工覆盖
- `devDependencies.electron` 又是另一个版本范围
- `electron-builder` 在某些场景下无法稳定推断真实 Electron 版本

但这个问题是次因，不是最终导致 app 起不来的主因。

## 5. 已落地修复

### 5.1 依赖与打包配置

已调整 `apps/electron/package.json`：

- 移除手工 `build.electronVersion`
- 固定 `devDependencies.electron = "32.2.7"`
- 所有 Electron 启动/打包脚本统一走预设脚本入口

### 5.2 固定净化启动环境

新增：

- `apps/electron/run-clean-electron-env.cjs`

作用：

- 统一清理 `ELECTRON_RUN_AS_NODE`
- 再调用真正的 `electron` 或 `electron-builder`

当前约定：

```json
"scripts": {
  "start": "node run-clean-electron-env.cjs electron .",
  "dist": "node run-clean-electron-env.cjs electron-builder",
  "dist:mac": "node run-clean-electron-env.cjs electron-builder --mac",
  "dist:win": "node run-clean-electron-env.cjs electron-builder --win",
  "dist:linux": "node run-clean-electron-env.cjs electron-builder --linux"
}
```

后续应始终通过这些预设命令启动或打包，不再长期依赖临时手写 shell 命令。

### 5.3 macOS 包元数据修复

已保留：

- `apps/electron/afterPack.cjs`
  - 注入 `CFBundleName = ServerLogConsole`
  - 注入中文 `InfoPlist.strings`

这仍然是必要修复，但不是本次最终根因。

## 6. 固定操作方式

### 6.1 本地启动

```bash
npm --workspace @server-log-console/electron run start
```

### 6.2 macOS 打包

```bash
npm --workspace @server-log-console/electron run dist:mac
```

### 6.3 Windows 打包

```bash
npm --workspace @server-log-console/electron run dist:win
```

### 6.4 Linux 打包

```bash
npm --workspace @server-log-console/electron run dist:linux
```

## 7. 规则

后续处理 Electron 打包、启动、安装问题时遵循以下规则：

1. 优先使用 `package.json` 中已设定的命令
2. 临时手写命令只用于一次性排障
3. 一旦排障命令证明有效，必须回写到 `package.json` 脚本中
4. 文档、README、操作手册一律以预设脚本为准

## 8. 本次排障中的红鲱鱼

以下方向被验证不是最终主因：

- asar integrity hash
- Electron fuse 开关
- 仅靠 ad-hoc codesign
- 单纯 Electron 32 / 33 版本差异
- 单纯 x64 / arm64 架构差异

## 9. 结论

本次问题的核心不是“Electron 版本不对”，而是“Electron 启动环境不干净”。

真正稳定的修复，不是继续手动试命令，而是：

- 保证 `package.json` 是唯一可信入口
- 在该入口中统一清理 Electron 污染环境变量
- 将结论归档到仓库文档中，避免记忆丢失后重复踩坑
