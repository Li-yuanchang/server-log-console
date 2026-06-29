# macOS Electron 桌面应用开发指南

> 基于「日志控制台」项目实战经验总结，适用于 Electron + React + Vite 技术栈。

---

## 1. 项目结构

```
server-log-console/
├── apps/
│   ├── extension/          # 前端 UI（React + Vite）
│   │   ├── src/
│   │   │   ├── ui/App.tsx  # 主组件，含 Electron 检测逻辑
│   │   │   ├── styles.css  # 样式聚合入口，实际样式拆在 styles-* 文件
│   │   │   └── theme-modern.css
│   │   ├── index.html      # 入口 HTML（含骨架屏）
│   │   └── dist/           # Vite 构建产物
│   ├── electron/           # Electron 壳
│   │   ├── main.cjs        # 主进程
│   │   ├── preload.cjs     # 预加载脚本
│   │   ├── package.json    # Electron 配置 + electron-builder 配置
│   │   ├── prepare-gateway.cjs  # 打包前资源准备脚本
│   │   └── dist/           # electron-builder 产物（DMG 等）
│   └── gateway/            # 后端服务（打包进 Electron）
├── packages/shared/        # 共享模块
└── package.json            # monorepo 根配置
```

---

## 2. 开发流程

### 2.1 本地开发（Web 模式）

```bash
# 启动前端 dev server
npm --prefix apps/extension run dev

# 启动后端 gateway
npm --prefix apps/gateway run dev
```

Web 模式下不涉及 Electron，直接在浏览器调试。

### 2.2 Electron 本地调试

```bash
# 从项目根目录
npm --prefix apps/electron run start
```

这会通过 `apps/electron/package.json` 中的预设脚本启动 Electron。当前脚本会先清理 `ELECTRON_RUN_AS_NODE`，再执行真正的 `electron` 命令，避免 IDE 宿主环境把打包 app 或本地调试进程错误地带成 Node 模式。

---

## 3. 打包与安装

### 3.1 一键打包

```bash
# 从项目根目录
npm --prefix apps/electron run dist:mac
```

执行流程：
1. `predist:mac` → `bump-version.cjs && prepare-gateway.cjs`
2. `prepare-gateway.cjs` → 编译 shared、gateway、extension 并收集资源到 `.electron-build/`
3. `run-clean-electron-env.cjs` → 清理 `ELECTRON_RUN_AS_NODE`
4. `electron-builder --mac` → 打包为 `.app` + `.dmg`

规则：打包和启动优先走 `package.json` 中已定义的脚本入口，不长期依赖临时手写 shell 命令。临时命令只用于排障，验证有效后必须回写到脚本中。

历史事故归档见：`archive/Electron-macOS-打包归档-2026-04-12.md`

### 3.2 安装到 /Applications

```bash
# 杀掉旧进程 → 删除旧 app → 复制新 app → 启动
pkill -f "日志控制台" 2>/dev/null
sleep 1
rm -rf /Applications/日志控制台.app
cp -RL apps/electron/dist/mac-arm64/日志控制台.app /Applications/
open /Applications/日志控制台.app
```

> **注意**：必须先杀掉运行中的旧进程，否则 `cp` 可能失败或替换不完全。

### 3.3 验证安装版本

```bash
defaults read /Applications/日志控制台.app/Contents/Info.plist CFBundleShortVersionString
```

---

## 4. 调试技巧

### 4.1 打开 DevTools

**方式一**：状态栏图标菜单 → "开发者工具"

在 `main.cjs` 的 tray 菜单中注册：
```javascript
{ label: "开发者工具", click: () => { mainWindow.webContents.toggleDevTools(); } }
```

**方式二**：快捷键（需在主进程注册）

```javascript
mainWindow.webContents.on("before-input-event", (_event, input) => {
  if (input.meta && input.shift && input.key === "i") {
    mainWindow.webContents.toggleDevTools();
  }
});
```

> ⚠️ 快捷键在 signed app 中可能不生效，建议同时保留菜单方式。

### 4.2 检查 CSS 是否生效

在 DevTools → Elements 面板中：

1. 检查 `<body>` 的 class 列表（如 `is-electron`）
2. 检查元素的 `element.style`（inline style）是否存在
3. 在 Styles 面板查看 CSS 规则来源文件（如 `style-xxx.css:32`）
4. 确认规则没有被划掉（strikethrough = 被覆盖）

### 4.3 检查构建产物

```bash
# 检查 CSS 中是否包含特定规则
grep "is-electron" apps/extension/dist/assets/style-*.css

# 检查打包后的 app 中的 CSS
grep "electron-immersive" /Applications/日志控制台.app/Contents/Resources/extension/dist/assets/style-*.css

# 检查 JS bundle 中的关键代码
grep "paddingTop:0" /Applications/日志控制台.app/Contents/Resources/extension/dist/assets/main-*.js
```

---

## 5. 常见问题与解决方案

### 5.1 Vite 构建缓存导致 CSS 不更新

**症状**：源码已修改，但打包后的 app 中仍是旧 CSS。

**解决**：
```bash
rm -rf apps/extension/dist apps/extension/node_modules/.vite
npm --prefix apps/extension run build
```

> 每次修改 CSS 后，建议清除 `dist/` 和 `.vite/` 缓存再构建。

### 5.2 `predist` hook 不触发

**原因**：npm 的 pre/post hook 只对精确匹配的脚本名生效。`predist` 对应 `dist`，但 `dist:mac` 需要 `predist:mac`。

**解决**：在 `package.json` 中添加：
```json
"predist:mac": "node prepare-gateway.cjs"
```

### 5.3 electron-builder require main.cjs 报错

**症状**：打包时报 `Cannot read properties of undefined (reading 'setName')`。

**原因**：electron-builder 在打包过程中会 `require` 主进程文件来解析配置。此时 Electron API（`app`）不可用。

**解决**：给顶层 API 调用加 guard：
```javascript
// ✗ 打包时会崩溃
app.setName("日志控制台");

// ✓ 安全写法
if (app && app.setName) app.setName("日志控制台");
```

### 5.4 macOS 菜单栏显示 npm 包名

**症状**：菜单栏显示 `@server-log-console/electron` 而非产品名。

**解决**：在 `main.cjs` 顶部设置：
```javascript
if (app && app.setName) app.setName("日志控制台");
```

### 5.5 `-webkit-app-region: drag` 覆盖导致按钮不可点击

**症状**：窗口拖拽区域遮住了按钮，点击无反应。

**原因**：使用 `position: fixed` + 高 `z-index` 的拖拽覆盖层，盖住了下方的交互元素。

**解决**：不用全局覆盖层，改用精确拖拽区域：
```css
/* 侧边栏顶部 38px 拖拽区（红绿灯所在行） */
.electron-sidebar-drag {
  position: absolute;
  top: 0; left: 0; right: 0;
  height: 38px;
  -webkit-app-region: drag;
  z-index: 1;  /* 低于按钮的 z-index: 2 */
}

/* 工具栏整体可拖拽，按钮自动 no-drag */
.electron-immersive .toolbar-panel {
  -webkit-app-region: drag;
}
```

关键原则：
- 交互元素（`button`, `input`, `select`, `a`）默认设为 `-webkit-app-region: no-drag`
- 拖拽区域的 `z-index` 必须**低于**其上方按钮的 `z-index`

### 5.6 Electron 沉浸式标题栏布局

**配置**（main.cjs）：
```javascript
mainWindow = new BrowserWindow({
  titleBarStyle: "hiddenInset",
  trafficLightPosition: { x: 12, y: 12 },
  // ...
});
```

**前端适配**：
```css
/* 整体去掉间距、圆角 */
.electron-immersive {
  padding: 0 !important;
}
.electron-immersive .shell-layout {
  height: 100vh;
  gap: 0;
}
.electron-immersive .sidebar-panel,
.electron-immersive .toolbar-panel {
  border-radius: 0;
  box-shadow: none;
}
```

```jsx
// React 中检测 Electron 环境
const [isElectron] = useState(() =>
  !!(window as any).electronAPI || /Electron/.test(navigator.userAgent)
);

// 条件添加 class
<main className={`app-shell${isElectron ? " electron-immersive" : ""}`}>

// sidebar 给红绿灯留出 38px
<aside style={isElectron ? { paddingTop: 38, position: 'relative' } : undefined}>
```

---

## 6. 调试清单（Checklist）

打包后发现问题时，按此顺序排查：

| # | 检查项 | 方法 |
|---|--------|------|
| 1 | 版本号是否更新 | `defaults read .../Info.plist CFBundleShortVersionString` |
| 2 | 旧进程是否已杀掉 | `pkill -f "日志控制台"` |
| 3 | Vite 缓存是否清除 | `rm -rf dist/ node_modules/.vite` |
| 4 | CSS 构建产物是否正确 | `grep "关键规则" dist/assets/style-*.css` |
| 5 | prepare-gateway 是否执行 | 看打包输出有无 "Gateway preparation complete." |
| 6 | extraResources 是否复制 | 看打包输出有无 "file source doesn't exist" |
| 7 | body class 是否生效 | DevTools → Elements → `<body>` class 列表 |
| 8 | inline style 是否存在 | DevTools → Elements → 选中元素看 `element.style` |
| 9 | CSS 规则优先级 | DevTools → Styles → 看是否被划掉 |

---

## 7. 关键经验总结

1. **不要信任构建缓存** — 修改 CSS/JS 后，永远先清 `dist/` 和 `.vite/` 再构建
2. **inline style > CSS class** — 在 Electron 环境检测相关的关键布局上，inline style 比 CSS class 更可靠（不受缓存影响）
3. **React class > body class** — `body.is-electron` 依赖 preload 时序；React 组件直接控制的 `electron-immersive` 更可靠
4. **拖拽区域要精确** — 不要用全屏覆盖层，用精确定位的拖拽区 + z-index 分层
5. **npm pre hook 是精确匹配** — `predist` 只对 `dist`生效，`dist:mac` 需要 `predist:mac`
6. **electron-builder 会 require 主进程** — 顶层 Electron API 调用必须加 guard
7. **版本号是最好的验证手段** — 每次改动都 bump version，通过 About 确认安装成功

---

## 8. UI 设计参考与模板

### 8.1 awesome-design-md — 一键复刻大厂设计规范

> **一句话总结**：这不是抄，是站在巨人的肩膀上做设计。

还在一点点抠 UI 规范？[awesome-design-md](https://github.com/VoltAgent/awesome-design-md) 直接帮你把大厂设计体系"搬"过来：

- **设计规范模块化整理** — 每个产品一份完整的 DESIGN.md，涵盖配色、字体、间距、阴影、圆角等
- **UI / 组件 / 交互全覆盖** — 从按钮到弹框到动效，一套完整的组件规范
- **开箱即用** — CLI 一键拉取，直接复刻大厂标准

| 资源 | 链接 |
|------|------|
| **GitHub 仓库** | https://github.com/VoltAgent/awesome-design-md |
| **在线预览** | https://awesome-design-md-preview.vercel.app |
| **CLI 工具** | `npx getdesign@latest add <产品名>` |

#### 本项目用到的设计系统

| 来源 | 获取命令 | 用途 |
|------|----------|------|
| Vercel Design System | `npx getdesign@latest add vercel` | 现代主题主参考：纯白底、黑白主调、Geist 字体、shadow-as-border |
| Cal.com Design System | `npx getdesign@latest add cal` | 辅助参考：灰阶克制、圆角 pill、shadow 深度体系 |

#### 实践工作流

```bash
# 1. 挑选参考产品，拉取 DESIGN.md
npx getdesign@latest add vercel
npx getdesign@latest add cal

# 2. 阅读 DESIGN.md，提取适合自己项目的配色/字体/组件规范
# 3. 整合为项目自己的 THEME-SPEC.md（见 8.3 节）
# 4. 所有新样式必须遵循 THEME-SPEC，禁止硬编码
```

> 下载的完整 DESIGN.md 存放在 `docs/design-references/` 目录。

### 8.2 双主题体系

项目实现了 **经典 (classic)** 和 **现代 (modern)** 两套可切换主题：

| 主题 | 风格 | 参考 | CSS 文件 |
|------|------|------|----------|
| 经典 | 深蓝灰色调，渐变面板，传统运维工具风格 | 自研 | `styles.css` |
| 现代 | 纯白底、黑白主调、Geist 字体、极简 | Vercel + Cal.com | `theme-modern.css` |

切换方式：React state 控制 `.theme-modern` class，两套 CSS 变量体系自动切换。

### 8.3 设计规范文档

项目维护了一份 `docs/design-references/THEME-SPEC.md`，包含：
- 完整 CSS 变量表（经典 + 现代）
- 组件样式规范（按钮、弹框、输入框、面板边框等）
- 选择器优先级策略
- 新增样式检查清单（5 条规则）

**核心规则**：新增样式必须使用已有 CSS 变量，禁止硬编码颜色值。

---

## 9. 前端技术栈与 Skill

### 9.1 技术栈总览

| 层级 | 技术 | 版本 | 用途 |
|------|------|------|------|
| **框架** | React | 19 | UI 组件 |
| **构建** | Vite | 6.2 | 开发服务器 + 打包 |
| **桌面壳** | Electron | 33.4 | macOS / Windows / Linux 桌面 |
| **打包** | electron-builder | 25.1 | DMG / EXE / AppImage 生成 |
| **终端** | xterm.js (v5 + v6) | 5.3 / 6.0 | 浏览器内 SSH 终端 |
| **虚拟滚动** | react-virtuoso | 4.18 | 大文件日志高性能渲染 |
| **代码编辑** | CodeMirror 6 | 6.x | 日志文件语法高亮 + 在线编辑 |
| **图标** | lucide-react | 1.7 | SVG 图标库 |
| **字体** | Geist Sans / Mono | 1.3 | 现代主题 UI + 代码字体（CDN） |
| **后端** | Express + ws | - | HTTP API + WebSocket 实时推送 |
| **SSH** | ssh2 | - | Node.js SSH 客户端（文件读取 + 终端） |
| **校验** | zod | - | 运行时类型校验 |

### 9.2 关键前端 Skill

#### CSS 架构
- **双主题 CSS 变量体系** — `:root` 定义经典变量，`.theme-modern` 覆盖为现代变量
- **选择器优先级管理** — `.theme-modern .class` 覆盖基础 `.class`；弹框内按钮需 `.dialog .btn` 提升优先级
- **Electron 沉浸式布局** — `electron-immersive` class 控制 `padding: 0` + `border-radius: 0` + `gap: 0`
- **`-webkit-app-region` 拖拽分层** — 精确拖拽区域 + z-index 分层避免遮挡按钮

#### React 模式
- **环境检测** — `useState(() => !!(window as any).electronAPI || /Electron/.test(navigator.userAgent))`
- **条件 className + inline style** — Electron 专用布局通过 class（批量规则）+ inline style（关键定位）双层控制
- **`useImperativeHandle`** — `VirtualLogViewer` 暴露 `scrollToTop()` / `scrollToBottom()` 给父组件
- **虚拟滚动** — `react-virtuoso` 处理百万行日志，`followOutput` 实现实时追踪
- **状态联动** — `viewerNotAtBottom` + `liveFollowPaused` + `activeViewerTabId` 三态控制「回到底部」按钮

#### Electron 集成
- **主进程 / 渲染进程 / preload 三层架构**
- **`contextBridge.exposeInMainWorld`** — 安全暴露 API（pin 控制、IPC 通信）
- **`titleBarStyle: "hiddenInset"`** — macOS 沉浸式标题栏
- **Tray 菜单** — 状态栏图标 + 右键菜单（显示窗口 / 开发者工具 / 退出）
- **`app.setName()` + guard** — 设置 macOS 菜单名，兼容 electron-builder require

#### xterm.js 终端
- **CSS 变量动态主题** — `getComputedStyle` 读取 `--shell` / `--shell-ink` 作为终端配色
- **addon-fit** — 终端自适应容器尺寸
- **addon-web-links** — 终端内 URL 可点击

#### 构建与部署
- **Monorepo** — npm workspaces 管理 extension / gateway / electron / shared
- **`prepare-gateway.cjs`** — 打包前收集 gateway + extension 资源到 `.electron-build/`
- **npm lifecycle hooks** — `predist` / `predist:mac` 精确触发资源准备
- **Vite 缓存陷阱** — 必须清 `dist/` + `node_modules/.vite` 确保 CSS 更新

---

## 10. 学习资源

### Electron
| 资源 | 链接 | 重点 |
|------|------|------|
| Electron 官方文档 | https://www.electronjs.org/docs | BrowserWindow / preload / IPC |
| electron-builder | https://www.electron.build | 打包配置 / extraResources / hooks |
| Electron Fiddle | https://www.electronjs.org/fiddle | 快速原型验证 |

### 前端设计
| 资源 | 链接 | 重点 |
|------|------|------|
| awesome-design-md | https://github.com/VoltAgent/awesome-design-md | 知名产品设计系统模板 |
| Vercel Design System | `npx getdesign@latest add vercel` | 极简黑白 + Geist 字体 |
| Cal.com Design System | `npx getdesign@latest add cal` | 灰阶 + shadow 深度体系 |
| Geist 字体 | https://vercel.com/font | Vercel 开源字体家族 |

### React & 组件
| 资源 | 链接 | 重点 |
|------|------|------|
| React 19 文档 | https://react.dev | Hooks / Server Components |
| react-virtuoso | https://virtuoso.dev | 虚拟滚动 API |
| CodeMirror 6 | https://codemirror.net | 编辑器扩展系统 |
| xterm.js | https://xtermjs.org | 终端模拟器 API |
| lucide-react | https://lucide.dev | SVG 图标查询 |

### CSS
| 资源 | 链接 | 重点 |
|------|------|------|
| CSS Variables | https://developer.mozilla.org/en-US/docs/Web/CSS/--* | 主题系统基础 |
| `-webkit-app-region` | Electron 文档 Frameless Window 章节 | 窗口拖拽区域 |
