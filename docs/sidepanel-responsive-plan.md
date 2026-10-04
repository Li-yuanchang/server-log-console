# Chrome 侧栏（side panel）响应式布局方案

状态：**P0 + P1 已实施并实测通过（2026-10-02）**，P2 待按需排期 · 原型：[prototypes/sidepanel-responsive.html](prototypes/sidepanel-responsive.html)
日期：2026-10-02 · 关联：S15「窗口与断点」（ui-redesign-2026-09/prototype.html `s15()`）、`styles-sidepanel.css`（环境覆盖层）

## 0. 实施记录（2026-10-02，多 agent 并行 + 集成实测）

落地文件：

- `apps/extension/src/styles-sidepanel.css` — 全量重写为容器查询双档（容器名 `slc-sp`）：宽档 ≥560（侧栏 172px 常驻 + 树列 132px + 逐条反制 media ≤1024 的隐藏/40px 钉死规则）＋移动档 <560（单列 + app bar/chip/底部 tabbar/全屏选服层/目录底部 sheet）。全部 token 化，双主题生效。
- `apps/extension/src/ui/SidepanelMobile.tsx` — 新增共享组件：`ServerGroupsList`（自 SidebarPanel 抽出，侧栏与选服层共用）、`ServerPickerOverlay`、`SidepanelMobileTop`、`SidepanelMobileTabBar`、`DirectorySheet`（复用 `FileBrowserTreeColumn`）。无 JS 宽度分支，无内联配色。
- `apps/extension/src/ui/SidebarPanel.tsx` — 服务器列表改用共享组件，视觉零变化。
- `apps/extension/src/ui/App.tsx` — 接线：`serverPickerOpen`/`dirSheetOpen` state、`SidepanelMobileTop`（toolbar-panel 首位）、`SidepanelMobileTabBar`（main-panel 末位）、`sp-dir-trigger`、启动卡 CTA、选服层选完自动关层。
- `apps/extension/popup.html` — 骨架加移动档骨架 + 容器查询切换（挂载零跳变）。
- `apps/extension/src/theme-modern.css` — 仅删除已迁出的旧 sidepanel 块（原 3917-3948）。

集成阶段实测修掉的 4 处偏差（均有 DOM 探针/截图证据）：

1. 移动档隐藏冗余的顶部 `.toolbar-view-switch`（与底部 tabbar 重复）；
2. `.fb-filter-input` 固定 170px 在 320px 撑爆工具行 → 移动档 flex-wrap + 输入框弹性收缩；
3. 宽档树列常驻后内容列仅 ~300px，theme-modern 窄窗档固定列（大小 90/时间 130）把名称列压成 0px → 收紧为 64/80，且 560-639 隐藏时间列（`@container slc-sp (max-width:639.9px)`）；树列 148→132；
4. `.file-row-actions`（4 按钮 ≈84px）常驻占位把名称挤成「b…」→ 侧栏内改 hover/focus-within 显示（桌面不变）；
5. 底部 tab 按钮标签被裁半：全局 `:where(.theme-modern) button { height: var(--ctl-h) }`（等效 0,0,1）把纵向 icon+文字结构的 tab 按钮钉成 28px，内容垂直溢出裁到视口外 → `.sp-tabbar-btn` 显式 `height: auto`；
6. 终端视图顶部堆叠（文件工具行 + 检索行 + chip 与会话条三重服务器身份）：main-panel 挂 `sp-view-{log|files|term}` 状态类，移动档 `.sp-view-term` 下隐藏 `.toolbar-commandbar`（含文件工具/检索行）与 `.srv-chip-row`，终端收回 ~110px 内容高度；
12. **v3 设计 1:1 实装（2026-10-03）**——按原型 v3 收尾三处差距 + 细节对齐：
    ① chip 并入顶栏（SidepanelMobileTop 重构：app bar = [chip][弹性][⌘][⚙]，去独立 chip 行与视图标题，
       全档位渲染；桌面档与侧栏并存 = 快捷切换入口，prototype 桌面档同款）；
    ② 移动档状态条 SidepanelStatusbar（tabbar 上方 [● 摘要][详情]，详情可展开连接概览四行；
       桌面/宽档 CSS 隐藏——侧栏状态卡承担）；
    ③ 目录行尾 ›（FileBrowserTableRows 加 ChevronRight，守卫 `.app-shell .f-go` 0,2,0 +
       移动档 :is 0,4,1 显示——再次验证 svg 全局规则反杀必须用 ≥0,2,0 守卫）；
    ④ 文件表列宽对齐 v3（收缩档 22/58/96、移动档 22/64）；
    ⑤ popup.html 骨架同步（顶栏 chip 块 + 状态条行）。
    验证：popup 442（两行工具区 + 行尾 › + 状态条）/ 2000（侧栏 240 + 顶栏 chip + 五列表，零泄漏）截图 + tsc 零错误。
15. **终端链路纵向塌缩（2026-10-03，「下方黑带」真因）**：`.terminal-main-shell` 与
    `.terminal-tab-panes` 缺 display:flex/纵向撑满——xterm 内容（按行渲染，高度=行数×行高）
    之后的面板剩余区域露出 `--shell` 底色（用户主题 #0a0a0a），形成下缘黑带。
    修复：两层补 `display:flex; flex-direction:column; flex:1 1 0%; min-height:0`
    （theme-modern-v2.css），xterm 容器随之填满面板。与第 13 条（页面滚动条带）、
    第 14 条（主题刷新）共同构成终端底色一致性的完整闭环。
14. **xterm 主题不随 ui 主题刷新（2026-10-03，「色差」真因）**：终端会话创建时
    `readTerminalTheme` 把当时的 `--terminal-background` 固化进 xterm ITheme；
    之后用户切换 ui 主题/明暗（Geist 等），CSS 链路实时变色而 xterm 不刷新 →
    视口 CSS 底色（新值）与行渲染底色（旧值）出现两段色差。
    修复：`useTerminalSession` 增 `themeKey` 选项（= resolvedTheme.id，经
    TerminalWorkspace/TerminalTabPane 透传），主题变更触发 ITheme 整体刷新
    （既有 useEffect，deps 增 themeKey）。遗留：TerminalPane（分屏）未接
    terminalScheme/themeKey 透传，split 会话暂不跟随终端配色槽位。
13. **4040 终端右缘「色差带」（2026-10-03）**——用户实测：终端视图右侧出现 16px #0a0a0a 竖条。
    像素采样定位：终端区域本体完全均匀（#30343F，xterm 与容器同色），竖条在 app-shell
    右缘之外——是【页面级滚动条】（布局被会话/面板状态撑高时出现，深色主题下 Chrome
    把滚动条画成 #0a0a0a，与终端区相邻形成色差观感）。修复：styles-base.css 给
    html/body/#root 加 `overflow: hidden`（固定视口工作台与 popup 侧栏同款；
    内部滚动容器各自负责）。实测 4040 终端流程：docScrollH == clientH、
    appShellW == innerW，滚动条带不可能再现。
11. **移动档覆盖全宿主（2026-10-03）**：4040 网关页（index.html 桌面宿主）在 <560 窗口没有移动档——
   移动档规则带 body.extension-sidepanel 前缀而桌面宿主 body 无该类。修复：容器块内前缀统一改写为
   `:is(body.extension-sidepanel, .app-shell)`（特异性不变 0,2,1/0,4,1，双宿主覆盖），121 条规则清扫；
   例外：`.sp-view-term .toolbar-commandbar` 隐藏保持 popup 宿主前缀（桌面 720-799 无底部导航，
   藏命令栏会无路可回）。实测：index@400 移动档生效（侧栏隐藏 + app bar/tabbar 显示）。
10. **漏迁规则清缴（2026-10-03）**：theme-modern.css 3851-3915 还残留一整块
   `body.extension-sidepanel .theme-modern …` 旧侧栏特例（commandbar 强制换行、
   search-actions flex 1 1 100%、keyword flex-basis 100%、advanced/workspace 堆叠、
   树列 148px 等）——它们在【任何宽度】都生效，是全宽 popup 工具行换行、
   检索组掉行的直接原因。已整体迁入移动档容器块（<560 生效）并从 theme-modern 删除。
   教训：迁移类重构必须 `grep -n "body.extension-sidepanel"` 全量清点，不能只迁首尾。
9. **架构重构：档位与宿主解耦（2026-10-03）**——此前侧栏环境的宽档（172px 侧栏、
   命令行堆叠）在 popup.html 的任何窗口宽度都生效，全屏浏览器标签里侧栏仍是 172px、
   工具行被 space-between 撕开；且桌面 media ≤1024 的 56px 图标栏断点与移动档并存两套窄窗行为。
   重构为：容器声明去宿主门槛（.app-shell/body 全宿主）、档位仅由容器宽度决定——
   <560 移动档（全宿主）、560-799 收缩档（侧栏 200 + 树列 132 + 文件表 64/80）、
   ≥800 桌面原生（侧栏 200/240 随视口、文件表 90/130 五列）；
   删除 theme-modern 的 56px 图标栏档与 ≤799.9 视口媒体档。
   教训三条已写入 styles-sidepanel.css 文件头（隐藏规则去宿主前缀 / 移动档规则必须保留
   宿主前缀与特异性 / 宽档禁止写死宽度）。
8. **宽档侧栏计数被裁（「27 台」→「27 1」）**：侧栏过滤输入框未设宽度，浏览器 input 默认固有宽度 ~170px 在 172px 侧栏里把 `.pane-section` 撑出 7px（实测 scrollWidth 179>172），标题行计数的「台」竖切一半。修复：`.pane-section > input { width:100%; min-width:0 }`，560-1000 全宽段实测 scrollWidth 171≤172。
7. **回归修复（PC 布局被污染）**：移动组件（app bar / 服务器 chip / 底部 tab / 目录按钮 / 启动卡 CTA）在 App.tsx 无条件渲染，其"宽档隐藏"规则误带 `body.extension-sidepanel` 前缀——桌面 Electron 加载 `index.html`（body 无该类）同样引用本文件，前缀使隐藏规则在桌面失效，移动组件漏进 PC 界面。修法：隐藏规则去前缀、**全局默认 display:none**，只在 `@container slc-sp` 移动档内重新显示。探针验证：桌面 1600/1000 全部 hidden，扩展 400 全部 SHOWN、620 全部 hidden。

已知取舍（P2 候选）：移动档侧栏底部状态卡随侧栏隐藏（底部 tabbar 已承担导航，连接概览走「详情」浮层）；树列宽在侧栏内定宽（拖拽手柄在侧栏形态失效）；文件传输列变体在 560-639 已收窄至 72px。

验收结果（真实网关 + 真实服务器，无头 Chrome + DOM 探针）：320/400/560/620 四档、选服层开合与选中自动回文件视图、目录 sheet（真实 SSH 目录 18 项懒加载）、日志视图切换与 tabbar 激活态——全部通过；`tsc --noEmit` 基线零新增错误。

## 1. 环境事实（方案的前提）

| 事实 | 对设计的影响 |
|---|---|
| MV3 `side_panel`，面板可调宽度约 **320–640px**（Chrome 限制最小 ~320，无 API 控制宽度），高度 = 整窗（~800px+） | **横向极稀缺、纵向充裕**：布局按「窄而高」设计，导航走纵向堆叠/覆盖层，不牺牲日志行数 |
| 输入方式 = 鼠标 + 键盘（桌面浏览器），无触屏 | **不做触屏化**（44px 热区、手势、拇指可达），只借鉴移动端的**信息架构** |
| 扩展与 Electron 桌面端**共享同一组件树**（App.tsx 一套 DOM，无 sidepanel 分支渲染） | 不允许 fork 移动端组件树（会重演 theme-modern / v2 双轨维护），新增 UI 做成共享组件的小档位差异 |
| 样式架构约束（docs/style-architecture.md）：侧栏表现**只动 `styles-sidepanel.css`** 环境覆盖层，最后加载、双主题生效 | 桌面断点照旧服务 Electron 窄窗；侧栏环境在其上层完整接管 |
| CSS 媒体查询在侧栏里按**面板宽度**求值，`max-width:1024px` 恒成立 | 桌面窄窗档位在侧栏永远触发，且无法"关掉"，只能逐条反制（见 §3 P0） |

## 2. 实测问题与根因（截图：chrome side panel ~640px）

| # | 现象 | 根因（file:line） |
|---|---|---|
| 1 | 服务器行钉死 40px，名称/主机截成「堡...」「127....」「192...」，服务器无法分辨 | `theme-modern.css:3885`（media ≤1024 `.server-item{width:40px}`）+ `theme-modern-v2.css:1197`（`.server-item-main{display:flex !important}` 反杀 `theme-modern.css:3869` 的 `display:none`）→ 文字回来了、宽度没回来 |
| 2 | 侧栏标题/过滤框/分组标题/计数全部消失，只剩两个竖排图标 | `theme-modern.css:3853-3857` 对 `sidebar-head-title / pane-title-row / pane-section>input / server-group-title` 一律 `display:none` |
| 3 | 文件树列整体消失，目录导航丢失 | `theme-modern.css:3892` 隐藏 `.browser-tree-column/.browser-resizer`；规范说「目录改下拉」但未实现 |
| 4 | 180px 固定侧栏挤爆主区（400px 面板主区仅 ~216px） | `styles-sidepanel.css` `.shell-layout{grid-template-columns:180px}` 固定列不随面板降级 |
| 5 | 首屏骨架与真实布局不一致（180px 完整行 → 挂载后 40px 碎片） | `popup.html` skeleton 几何与 theme-modern 档位各画各的 |

## 3. 方案总纲

### 3.1 SP 两档（侧栏环境专属，容器宽度驱动，自动切换）

| 档位 | 面板宽度 | 骨架 | 关键行为 |
|---|---|---|---|
| **移动档** | < 560px | 单列 + 底部 tab 导航 | 顶栏变 app bar（当前屏名 + 全局动作），**日志 / 文件 / 终端三个 tab 沉底**；服务器 chip 常驻，点击**整屏 push 选服层**；面包屑跳级 + 「目录」底部 sheet；文件表 名称+大小、44px 行距、目录行尾 `›` |
| **宽档** | ≥ 560px | 侧栏 172px 常驻 + 主区 | 顶部视图 tabs；服务器行完整两行（名称 + `host:port` mono）+ 悬浮快捷操作；树列 132px 常驻、可开合（记忆状态）；文件表 名称+大小+修改时间 |

档位判定用 **container query**（`body.extension-sidepanel .app-shell { container: sp / inline-size }` + `@container sp (max-width: 559.9px)`；Chromium 114+ 支持，侧栏环境无兼容问题），**不依赖 viewport 媒体查询、不写 JS 宽度分支**——面板拖宽拖窄实时自动切换，这同时绕开了"桌面断点按窗口求值、在侧栏恒成立"的问题：桌面窄窗档位照旧服务 Electron，侧栏环境在覆盖层完整接管。

### 3.2 小屏 = 移动化设计（对"直接移动化"的回答）

**<560px 直接按移动端做**（320–400px 就是手机宽度，用最熟悉的移动范式最不会让用户迷路）：

- ✅ 底部 tab 导航（日志/文件/终端）：顶部 tabs 行移除、app bar 更矮，净高度成本 ≈ 0
- ✅ 栈式层级：选服务器 → 选目录 → 浏览文件，三级 drill-down，不再并排多列
- ✅ 覆盖式全屏层：选服务器 = 整屏 push（未选服务器时的空态 `workspace-startup-card`，App.tsx:4158，天然就是这一层，不新增导航概念）
- ✅ 底部 sheet：目录树放进可下滑收起的 sheet（树组件 `FileBrowserTreeColumn` 原样复用）
- ✅ 面包屑每级可点回跳（组件已有：`FileBrowserPathbar` browse/edit 双模式）+ 44px 大行距 + 目录行尾箭头
- ❌ 手势导航、独立移动端组件树（fork 会重演 theme-modern/v2 双轨维护）——移动化只发生在 CSS 档位 + 共享组件参数层，不做独立 DOM

### 3.3 原型

`docs/prototypes/sidepanel-responsive.html`：拖左缘手柄（或宽度预设）实时改面板宽度，档位由容器查询自动切换；可演示选服层、目录 sheet、三个视图。

## 4. 分期落地

### P0 止血（纯 CSS，只动 `styles-sidepanel.css`，约 0.5 天）

目标：现有构建下，任意面板宽度（320–640）信息可读、可用；桌面端零影响。

1. 逐条反制 media ≤1024 在侧栏的误触发（`body.extension-sidepanel` 前缀，特异性 ≥ (0,3,1)）：
   - 恢复 `sidebar-head-title / pane-title-row / pane-section>input / server-group-title / server-item-main / server-item-meta` 显示
   - 恢复 `.server-item` 宽度自适应（去 40px 钉死）
   - `browser-tree-column / browser-resizer` 的显隐改由容器档位决定
2. 侧栏列宽降级：`grid-template-columns: clamp(148px, 40%, 180px) minmax(0,1fr)`（320px 面板下侧栏 148px 仍可完整显示 host）
3. 骨架同步：`popup.html` skeleton 几何跟随同一档位（消除挂载跳变）

### P1 小屏移动化（JSX + CSS，约 1–2 天）

1. **服务器列表抽成共享组件**（SidebarPanel 内的列表逻辑 → `ServerGroups`），三处复用：宽档侧栏 / 移动档整屏选服层
2. **全屏选服层**：未选服务器时 startup-card 直接渲染；chip 点击 push；选中即回（替换现状「40px 碎片行里选服务器」）
3. **底部 tab 导航**：日志 / 文件 / 终端三个 tab（移动档），与顶部视图切换共用同一 state；app bar 显示当前屏名
4. **目录底部 sheet**：`FileBrowserTreeColumn` 放入 sheet；触发 = pathbar 尾部「目录」；移动档默认收起，宽档仍为常驻树列
5. **文件表列档位**：宽档 名称+大小+时间 / 移动档 名称+大小（类型永久并入图标与悬浮提示，对齐 S15 <800 规则）
6. 设置中心 v2 侧栏规则（rail 转顶栏）已存在，随档位微调数字即可

### P2 体验补全（约 0.5–1 天，可按需裁剪）

- 日志预览小屏：高级条件收进 sheet、命中导航 ◀n/N▶ 保留、LIVE 带单行化
- 树列开合状态、选服层滚动位置记忆（chrome.storage.session）
- 批量条底部化（贴底单行，避免挤压表格）
- 终端视图小屏：快捷命令/AI 侧栏改 sheet
- 清理：`theme-modern.css:3917-3948` 旧侧栏特例块迁入环境层后删除；`styles-sidepanel.css` 中被 flex 化 no-op 的 grid 模板清理

## 4b. 全局审计记录（2026-10-03，"这类问题不要人来发现"）

四类系统性清查（静态 grep 全量清点 + DOM 探针实测交叉验证）：

| 类别 | 清点方式 | 结果 |
|---|---|---|
| ① 宿主前缀规则漏迁 | `grep body.extension-sidepanel` 全 CSS 清点 | theme-modern.css 已清零（3851-3915 残块于第 10 条清缴）；其余文件无；宿主前缀规则现集中于 styles-sidepanel.css（皮肤层，合法） |
| ② 视口媒体查询与容器档位冲突 | 全量列出 ≤1100 的 @media（10 处）逐个审读 | 无"全宽受害者"：≤1180 检索组掉行两条为移动/窄窗该有行为的正规来源（保留）；其余为对话框/PiP/检索工具的合理窄视口适配 |
| ③ 固定宽度溢出 | 320px 最窄档全视图 DOM 扫描（枚举右缘超视口元素） | 发现并修复 workspace-session-strip 的 -6px 出血边（桌面卡片设计残留，strip 右缘 326>320）；终端 chips 超出为滚动区内部误报 |
| ④ 特异性反杀 | 对 8 个 sp-* 组件 × 2 宿主 × 3 档位量 computed styles | 本轮已修 2 处（settings-exclusive ghost-button 0,3,0 反杀、:where button 高度钉死）；grep 复查无其他 display 类反杀 |

覆盖范围：320/442/560/620/700/780/800/900/1024/1200/1500/2000 × 双宿主 × 三视图。
未覆盖：classic 主题逐像素走查（规则同源 token，结构一致）；终端 xterm 实会话逐档 fit。

## 5. 实施护栏

1. **不 fork 组件树**：新 UI 全部做成共享组件的档位差异；档位判定只在 CSS（@container），JS 不写宽度分支
2. **只动允许的层**：侧栏表现进 `styles-sidepanel.css`；共享组件改动以 props/classes 为主，不改桌面 DOM 结构
3. **token 约束**：字号 `--fs-*`、颜色/圆角/分隔线按 style-architecture.md §10/§11，单边框原则（左 pane 不设 border-right）
4. **验证清单**（每个 PR 跑一遍）：2 主题（classic/modern）× 4 档（320/400/500/620）× 3 视图（日志/文件/终端）+ Electron 桌面 1024/1440 回归 + `Network.setCacheDisabled` 后截图真看图

## 6. 验收标准

- [ ] 320px：服务器名称与 host 完整可辨（允许省略号，但 ≥8 字符有效信息）；文件表名称列 ≥160px；无横向滚动
- [ ] 400px：app bar + chip + 面包屑 + 表格 ≤4 行工具；底部 tab 导航可见且三视图可切；选服层/sheet 开合动画不跳变
- [ ] 620px：侧栏 + 树列 + 表格三者并存且树列可开合；底部 tab 自动消失
- [ ] 拖拽改宽：档位实时自动切换（容器查询），无 JS 宽度分支
- [ ] 全档位：骨架 → 挂载零跳变；classic/modern 双主题一致；桌面 Electron 布局无回归
