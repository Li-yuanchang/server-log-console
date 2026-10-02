# Chrome 侧栏（side panel）响应式布局方案

状态：方案已定稿，待实施 · 原型：[prototypes/sidepanel-responsive.html](prototypes/sidepanel-responsive.html)
日期：2026-10-02 · 关联：S15「窗口与断点」（ui-redesign-2026-09/prototype.html `s15()`）、`styles-sidepanel.css`（环境覆盖层，2026-10-02 重写）

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
