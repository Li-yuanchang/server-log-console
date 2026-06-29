# 版本修复归档（2026-04-19，v0.3.123 ~ v0.3.124）

## 0. 文档分工与使用约定

- **`CHANGELOG.md`**：记录版本级摘要、对外可读的修复项与验证结论。
- **本文档**：记录问题背景、根因、修改点、排查证据、经验教训与防复发清单。
- **去重约定**：`CHANGELOG.md` 写"这版修了什么"，本文档写"为什么会出问题、怎么修、以后怎么避免再犯"。

## 1. 归档范围

本次归档覆盖 2026-04-19 这轮围绕左侧操作记录面板可拖拽调高/调低并可滚动、顶部 workspace tab 视觉与右键菜单收敛、不同 workspace tab 之间终端与搜索记录小窗状态串扰、AI 终端助手输入框焦点被终端抢占的修复。

## 2. 版本范围

- 本归档覆盖 `v0.3.123` → `v0.3.124`。
- **逐版本摘要以 `CHANGELOG.md` 为准**；本文不再重复逐版本 release note，而是按"问题域 / 根因 / 修改点 / 防复发"归并整理。

## 3. 原有能力基线

修复前项目已经具备：

- 左侧操作记录面板（固定高度、固定显示最近 4 条、不可拖拽调整）
- 顶部 workspace tab 栏（黑底样式、独立"新服务器"按钮、无右键菜单）
- 终端面板与 AI 助手/快捷命令浮层（overlay 状态由 `TerminalPanel` 内部管理）
- workspace tab 切换时恢复部分 UI 状态（搜索、文件浏览、终端面板开关）

本轮不是重做这些功能，而是在保留原能力前提下补齐交互体验、状态隔离与焦点控制。

## 4. 本轮新增与修复

### 4.1 左侧操作记录面板可拖拽调高/调低并可滚动

**问题**：操作记录面板固定高度，只能显示最近 4 条，无法拖拽调整，体验差。

**根因**：
- `.activity-log-list` 有硬编码 `max-height: 80px`（经典主题）/ `max-height: 96px`（现代主题）
- 面板容器没有拖拽调整机制
- 面板高度没有持久化，刷新后回到默认值

**修改点**：
- `storage.ts`：新增 `ACTIVITY_PANEL_HEIGHT_KEY`、`clampActivityPanelHeight`、`readActivityPanelHeight`、`writeActivityPanelHeight`
- `App.tsx`：
  - 新增 `activityPanelHeight` state 与 `activityPanelResizeRef`
  - 新增 `handleActivityPanelResizeStart` 与对应 `pointermove`/`pointerup`/`pointercancel` effect
  - 面板 JSX 改为 `style={{ height: activityPanelHeight }}`，内部列表改用 `sidebarActivityLines`（最近 80 条）
  - 新增 `.activity-panel-resizer` 拖拽条
- `styles.css`：
  - `.activity-log-list` 移除 `max-height`，改为 `min-height: 0`
  - `.compact-activity-panel` 改为 `grid-template-rows: 10px auto minmax(0, 1fr)`
  - 新增 `.activity-panel-resizer`、`.compact-activity-log-list`、`body.is-resizing-activity-panel`
- `theme-modern.css`：
  - `.activity-log-list` 移除 `max-height: 96px`
  - 新增 `.compact-activity-log-list { max-height: none }`
  - 新增 `.activity-panel-resizer::before` 适配主题色

### 4.2 顶部 workspace tab 视觉与右键菜单收敛

**问题**：
- tab 使用黑底，视觉上与整体风格不协调
- "新服务器"按钮占据独立区域，右键菜单缺少复制等常用操作

**根因**：
- 现代主题 `.workspace-session-tab` 直接使用 `var(--panel-muted)` 作为背景，与 Vercel 风格白底不搭
- tab 没有右键菜单交互，所有操作只能通过按钮触发

**修改点**：
- `theme-modern.css`：
  - `.workspace-session-tab` 改为白底 + 淡边框 + 内阴影
  - 新增 `.workspace-session-tab:hover` 浅灰底
  - `.workspace-session-tab-active` 改为淡蓝底 + 半透明蓝边框
  - `.workspace-session-tab-index` 从蓝底白字改为淡蓝底蓝字
  - `.workspace-session-tab-close:hover` 从深红底改为淡红底
- `App.tsx`：
  - 新增 `workspaceTabMenu` state 与 `workspaceTabMenuRef`
  - tab `div` 新增 `onContextMenu` 处理，打开右键菜单
  - 右键菜单包含：复制服务器名称、复制主机地址、新增服务器、关闭工作区
  - "新服务器"按钮改为仅 `+` 图标，不再占文字空间
  - 新增 `workspaceTabMenu` 的 click-outside / Escape 关闭 effect

### 4.3 不同 workspace tab 之间终端与搜索记录小窗状态串扰

**问题**：切换 workspace tab 后，终端 overlay（AI 助手 / 快捷命令浮层）、搜索高级面板、路径历史、传输历史的开关状态会串到另一个 tab。

**根因**：
- `WorkspaceSessionState` 没有记录 `showQueryAdvanced`、`showPathHistory`、`showTransferHistory`、`terminalOverlay` 这些 popup 可见性状态
- `captureCurrentWorkspaceSessionState` 不采集这些字段，`applyWorkspaceSessionState` 也不恢复
- `TerminalPanel` 内部自己管理 overlay 状态，不受父组件 workspace 切换控制

**修改点**：
- `App.tsx`：
  - `WorkspaceSessionState` 新增 `showQueryAdvanced`、`showPathHistory`、`showTransferHistory`、`terminalOverlay` 字段
  - `createDefaultWorkspaceSessionState` / `captureCurrentWorkspaceSessionState` / `applyWorkspaceSessionState` 补齐新字段的采集与恢复
  - `readWorkspaceSessionState` 改为 `{ ...createDefault(...), ...cached }` 合并，兼容旧快照缺新字段
  - 新增 `closeTerminalOverlay` / `toggleTerminalOverlay` 集中管理 overlay 状态
  - 终端关闭 / detach / 不可用时统一调用 `closeTerminalOverlay` 清理
- `TerminalWorkspace.tsx`：
  - `TerminalPanel` 改为受控组件，接受 `terminalOverlay` / `onCloseTerminalOverlay` / `onToggleTerminalOverlay` props
  - 移除内部 `terminalOverlay` state，由父组件驱动

### 4.4 AI 终端助手输入框焦点被终端抢占

**问题**：点击 AI 助手输入框后，光标会被终端 xterm.js 立即抢走，无法在 AI 输入框中打字。

**根因**：
- `TerminalPanel` 的 `onFocus` handler 绑在整个面板容器上，AI/快捷命令浮层也在面板内部
- 点击 AI 浮层时，事件冒泡到面板容器，触发 `terminalSession.focusTerminal()`，xterm.js 抢走焦点
- AI 浮层的 `mousedown` / `click` 没有 `stopPropagation`，无法阻止冒泡

**修改点**：
- `TerminalWorkspace.tsx`：
  - `onFocus` handler 从面板容器移到终端 body div，只有点击终端本体才抢焦点
- `TerminalAI.tsx`：
  - AI 下拉容器新增 `onMouseDown={e => e.stopPropagation()}` / `onClick={e => e.stopPropagation()}`
  - `useEffect` 补 AI 输入框 focus 逻辑，mount 或 server 切换后自动聚焦
- `TerminalShortcuts.tsx`：
  - 快捷命令下拉容器新增 `onMouseDown={e => e.stopPropagation()}` / `onClick={e => e.stopPropagation()}`

## 5. 关键根因总结

本轮问题不是单点故障，而是几类典型问题叠加：

1. **面板布局缺少弹性与持久化**
   - 固定高度 + 固定条数导致信息量不足，用户无法按需调整
2. **UI 状态未纳入 workspace session 快照**
   - popup 可见性、overlay 状态只存在于组件内部 state，切换 tab 后丢失或串扰
3. **事件冒泡缺少边界控制**
   - 面板级 focus handler 没有区分"终端本体"和"浮层子组件"，导致子组件交互被父级拦截
4. **tab 视觉与交互设计未对齐主题风格**
   - 现代主题下 tab 仍用经典主题的暗色逻辑，右键菜单缺失导致操作路径单一

## 6. 经验教训

后续类似需求必须优先检查：

- 新增面板/区域是否需要可调整大小，高度/宽度是否需要持久化
- workspace session state 是否覆盖了所有"切换 tab 后应该保留/恢复"的 UI 状态
- 子组件浮层（AI 助手、快捷命令、下拉选择）是否阻止了事件冒泡到父级 focus handler
- 终端面板的 focus 控制是否精确到终端本体，而非整个面板容器
- 新增右键菜单时是否复用了现有 context-menu 样式和 click-outside 逻辑
- 主题样式变更是否同时覆盖经典和现代两套主题

## 7. 防复发检查清单

每次合并面板布局、workspace 状态、终端交互或 tab 相关改动前，至少检查：

- 面板高度/宽度是否有硬编码上限，是否需要改为可拖拽 + 持久化
- WorkspaceSessionState 是否包含了所有 popup/overlay 的可见性状态
- applyWorkspaceSessionState 是否恢复了所有新增字段
- readWorkspaceSessionState 是否做了默认值合并，兼容旧快照
- 终端面板 focus handler 是否只绑定在终端本体而非整个容器
- 子浮层组件是否 stopPropagation 阻止冒泡到父级 focus
- 右键菜单是否复用 context-menu 样式，是否有 click-outside / Escape 关闭
- 新增/修改样式是否同时覆盖经典和现代两套主题

## 8. 对审查的建议

后续审查建议按以下顺序对比：

1. `CHANGELOG.md` 看版本级摘要
2. 本文档看根因、修改点与经验教训
3. 需要追代码时，再对应查看：
   - `apps/extension/src/ui/App.tsx`
   - `apps/extension/src/ui/TerminalWorkspace.tsx`
   - `apps/extension/src/ui/TerminalAI.tsx`
   - `apps/extension/src/ui/TerminalShortcuts.tsx`
   - `apps/extension/src/ui/storage.ts`
   - `apps/extension/src/styles.css`
   - `apps/extension/src/theme-modern.css`
