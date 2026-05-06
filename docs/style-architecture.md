# 扩展端样式结构梳理

本文档只梳理 `apps/extension/src` 下前端样式体系，重点记录：

- 样式入口与覆盖顺序
- 主要容器的 DOM 结构与 class 关系
- 主题覆写、继承链、优先级来源
- 当前迁移中容易误判的“样式丢失 / 样式改错 / 组件未接线”区域

后续排查样式问题时，优先按本文的“入口顺序 -> DOM 归属 -> 主题覆写 -> 特例补丁”去定位。

## 1. 样式入口与覆盖顺序

入口在：

- [apps/extension/src/main.tsx](/Users/lyc/Git/GitHub/server-log-console/apps/extension/src/main.tsx)
- [apps/extension/src/styles.css](/Users/lyc/Git/GitHub/server-log-console/apps/extension/src/styles.css)
- [apps/extension/src/theme-modern.css](/Users/lyc/Git/GitHub/server-log-console/apps/extension/src/theme-modern.css)

加载顺序是：

1. `fonts.css`
2. `styles.css`
3. `theme-modern.css`

其中 `styles.css` 内部又继续按顺序 `@import`：

1. `styles-base.css`
2. `styles-layout.css`
3. `styles-sidebar-toolbar.css`
4. `styles-viewer-search.css`
5. `styles-terminal-workspace.css`
6. `styles-dialogs-transfer.css`
7. `styles-pip-toast.css`
8. `styles-tsc.css`
9. `styles-file-reader.css`
10. `styles-responsive.css`

这意味着排查优先级通常是：

1. 先看基础文件里有没有定义
2. 再看后续文件有没有把它改掉
3. 最后看 `theme-modern.css` 是否又用 `.theme-modern ...` 覆写了一次

## 2. 顶层主题与继承规则

根节点在 [apps/extension/src/ui/App.tsx](/Users/lyc/Git/GitHub/server-log-console/apps/extension/src/ui/App.tsx) 里，`<main>` 会动态拼接：

- `app-shell`
- `theme-modern`
- `electron-immersive`
- `electron-macos-immersive`
- `pip-standalone`
- `pip-terminal-standalone`

这几个 class 是顶层样式分叉点。

### 2.1 变量来源

基础变量来自 [styles-base.css](/Users/lyc/Git/GitHub/server-log-console/apps/extension/src/styles-base.css) 的 `:root`：

- `--bg`
- `--panel`
- `--ink`
- `--line`
- `--accent`
- `--shell`

现代主题变量来自 [theme-modern.css](/Users/lyc/Git/GitHub/server-log-console/apps/extension/src/theme-modern.css) 的 `.theme-modern`。

结论：

- 不带 `.theme-modern` 时，走基础灰蓝色体系
- 带 `.theme-modern` 时，大部分颜色、边框、背景、按钮状态都会被重写
- 如果一个组件颜色“看起来不对”，先确认它是不是仍然依赖老的深色背景，但文本色已经被新的浅色主题规则改掉

### 2.2 常见继承链

最常见的继承 / 覆写链有这几种：

1. `:root` 变量 -> `.theme-modern` 重定义变量 -> 业务组件继续消费变量
2. 通用元素选择器 `button / input / select / textarea` -> `.theme-modern button / input ...` 二次覆写
3. 业务 class，如 `.ghost-button` -> `.theme-modern .ghost-button` -> 更具体场景如 `.viewer-floating-header-actions .ghost-button`
4. 布局容器 `.workspace-panel` / `.main-panel` -> `.theme-modern .workspace-panel` / `.theme-modern .main-panel`
5. Electron 特例：`.electron-immersive ...` 会继续改边框、圆角、拖拽区域
6. PIP 特例：`.pip-standalone` / `.pip-terminal-standalone` 会修改布局高度与嵌入方式

### 2.3 判断覆盖来源的经验法

一个样式异常时，优先按这个顺序查：

1. 组件自己的 class 有没有定义
2. 后加载的样式文件是否定义了同名 class
3. `.theme-modern .xxx` 是否重写
4. `.electron-immersive .xxx` 或 `.pip-* .xxx` 是否又特殊处理
5. 是否根本没挂载到预期 DOM 结构，导致“样式在、结构没了”

## 3. 各样式文件职责

### 3.1 `styles-base.css`

职责：

- 全局变量
- `html/body/#root` 尺寸
- 全局字体、基础文字色
- 通用 tooltip

特点：

- 几乎不关心业务结构
- 是所有变量与页面根高宽的起点

### 3.2 `styles-layout.css`

职责：

- 应用骨架布局
- `app-shell`、`shell-layout`
- `sidebar-panel` / `main-panel` / `workspace-panel` / `advanced-panel`

特点：

- 决定整页是 grid 还是 flex 的基线
- 现代主题会对它进行大幅重写

### 3.3 `styles-sidebar-toolbar.css`

职责：

- 侧边栏、搜索栏、工作区头部、工具条
- immersive 模式拖拽区域
- 大量左侧导航、顶部工具、文件浏览头部样式

特点：

- 既有结构样式，也有大量细粒度按钮、标题、工具条定义
- 容易被 `theme-modern.css` 覆写

### 3.4 `styles-viewer-search.css`

职责：

- 搜索结果视图
- 日志 viewer 文字高亮
- 书签面板
- 本地文件 / SSH 隧道 / 批量执行
- 新 utility compare 面板

特点：

- 当前迁移冲突最多的文件之一
- 旧深色侧面板和新浅色 utility 面板现在同时混在这里

### 3.5 `styles-terminal-workspace.css`

职责：

- 终端底部面板
- 终端会话标签
- 分屏终端
- 路径条、会话条

特点：

- 负责 terminal 主骨架
- 当前迁移里，`TerminalWorkspace.tsx` 已经引入新的终端侧栏结构，但本文件尚未补齐对应 class

### 3.6 `styles-dialogs-transfer.css`

职责：

- 弹窗
- 重命名 / 确认框
- 传输记录

特点：

- 相对独立
- 风险主要来自 `theme-modern.css` 对弹窗表面的二次美化

### 3.7 `styles-pip-toast.css`

职责：

- PIP 小窗
- viewer 浮动头部
- 终端 standalone 样式
- placeholder、loading、toast 一类附加态

特点：

- 文件名虽然叫 `pip-toast`，但实际上混了不少 viewer / terminal 的状态样式
- 例如 `.terminal-body-slot`、`.terminal-sel-menu` 就定义在这里，不在 `styles-terminal-workspace.css`

### 3.8 `styles-tsc.css`

职责：

- `TerminalShortcuts` 下拉卡片

特点：

- 单独深色视觉体系
- 与 terminal 主体视觉相对独立

### 3.9 `styles-file-reader.css`

职责：

- viewer 主体外壳
- 日志阅读区域
- `viewer-shell`
- `viewer-workbench`
- `viewer-content-shell`
- 阅读定位 rail

特点：

- 是日志阅读器与结果页的关键骨架文件
- 当前 utility compare 迁移也与它有关

### 3.10 `styles-responsive.css`

职责：

- 各种收口、微调、紧凑布局、按钮尺寸
- 一部分响应式/密度修正

特点：

- 虽然名字像响应式文件，但也会直接改常规状态样式
- 因为加载很靠后，所以很容易“悄悄覆盖前面的设置”

### 3.11 `theme-modern.css`

职责：

- 现代主题的统一外观重写
- 重新定义根变量
- 将基础 grid 风格重写为现代化 flex / 白底样式
- 对多数业务模块做细化覆写

特点：

- 是最强覆盖层之一
- 大多数“为什么这个类明明在基础文件里是 A，页面显示却是 B”最终都要追到这里

## 4. 主要 DOM 结构与 class 关系

## 4.1 App 顶层

大致结构：

```text
main.app-shell[.theme-modern][.electron-immersive][.pip-*]
  section.shell-layout
    aside.sidebar-panel
    section.main-panel
      section.toolbar-panel
      section.advanced-panel
      section.workspace-panel
      terminal area
```

决定整体布局的文件：

- 基础：`styles-layout.css`
- 现代主题：`theme-modern.css`

## 4.2 Viewer 区域

当前主 viewer 结构在 [App.tsx](/Users/lyc/Git/GitHub/server-log-console/apps/extension/src/ui/App.tsx#L2323) 附近，大致是：

```text
section.workspace-panel
  div.viewer-workbench
    div[display contents or hidden wrapper]
      div.pip-viewer-wrap | div.pip-viewer-root
        div.viewer-shell
          div.result-tab-strip
          div.meta-list / file-tools-panel
          div.viewer-content-shell[.viewer-content-shell-with-rail]
            VirtualLogViewer
              div.virtuoso-scroller
                div.console-block.viewer-console.viewer-console-markup
            div.bookmark-panel
            button.live-back-to-bottom
            aside.reader-rail
```

相关样式来源：

- `viewer-shell` / `viewer-workbench` / `viewer-content-shell`：`styles-file-reader.css`
- 日志文本、高亮、书签：`styles-viewer-search.css`
- 浮动 header / PIP placeholder / loading：`styles-pip-toast.css`
- 白色主题覆写：`theme-modern.css`

### Viewer 区域的高风险点

1. `viewer-workbench` 是新引入的外层 flex 骨架
2. `viewer-workbench-with-utility` 有 CSS，但当前未看到 JSX 使用
3. `bookmark-panel` 仍保留旧的深色背景模型，但内部文字颜色已经往浅色主题迁移
4. `viewer-content-shell` 的真实显示还会继续受 `theme-modern .viewer-content-shell` 影响

## 4.3 Terminal 区域

当前终端结构在 [TerminalWorkspace.tsx](/Users/lyc/Git/GitHub/server-log-console/apps/extension/src/ui/TerminalWorkspace.tsx#L178) 附近，大致是：

```text
section.terminal-bottom-panel
  div.terminal-panel-bar
  div.terminal-standalone-connection-strip
  div.terminal-body-slot
    div.terminal-body-layout
      div.terminal-main-shell
        div.terminal-panel-body
          div.xterm-container
        div.terminal-sel-menu
      aside.terminal-side-panel
        TerminalShortcuts | TerminalAI
```

相关样式来源：

- `terminal-bottom-panel`、`terminal-panel-bar`、`terminal-panel-body`：`styles-terminal-workspace.css`
- `terminal-body-slot`、`terminal-sel-menu`、standalone 相关：`styles-pip-toast.css`
- `tsc-*`：`styles-tsc.css`
- 现代主题细化：`theme-modern.css`

### Terminal 区域的高风险点

1. `terminal-body-layout`
2. `terminal-main-shell`
3. `terminal-side-panel`

这三个新 class 已经进入 JSX，但当前没在 CSS 中找到定义。这不是“继承导致看起来不对”，而是“布局骨架本身还没写”。

## 4.4 Terminal Split 区域

`TerminalSplitView.tsx` 使用：

- `terminal-split-root`
- `terminal-split-row`
- `terminal-split-column`
- `terminal-split-child`
- `terminal-split-child-row`
- `terminal-split-child-column`
- `terminal-pane`

这些定义在 [styles-terminal-workspace.css](/Users/lyc/Git/GitHub/server-log-console/apps/extension/src/styles-terminal-workspace.css)。

这里的层叠关系相对清晰，主要风险反而不是颜色，而是：

- 子容器 `min-width/min-height`
- `overflow: hidden`
- flex 子项不收缩导致的撑开

## 4.5 Utility / Compare 区域

相关组件：

- [UtilityWorkspace.tsx](/Users/lyc/Git/GitHub/server-log-console/apps/extension/src/ui/UtilityWorkspace.tsx)
- [DiffComparePanel.tsx](/Users/lyc/Git/GitHub/server-log-console/apps/extension/src/ui/DiffComparePanel.tsx)

相关 class：

- `utility-workspace`
- `utility-workspace-standalone`
- `utility-workspace-topbar`
- `utility-workspace-body`
- `diff-compare-panel`
- `diff-compare-editor`

样式定义在：

- `styles-viewer-search.css`
- `theme-modern.css`

当前状态：

- 样式已存在
- 组件已存在
- `App.tsx` 里暂未发现挂载

这类问题要和“样式失效”区分开。它更像“迁移中的新结构未接线”，不是单纯 CSS 被覆盖。

## 4.6 旧工具侧面板区域

旧组件：

- `SshTunnelPanel.tsx`
- `BatchCommandPanel.tsx`

样式仍保留在 `styles-viewer-search.css`：

- `local-file-*`
- `ssh-tunnel-*`
- `batch-command-*`

当前状态：

- 样式还在
- 组件还在
- 主界面入口在 `App.tsx` 中已被隐藏/移除

因此如果看到这些类“没效果”，先别急着判断为 CSS 问题，很可能是组件根本没渲染。

## 5. 当前明确的继承 / 覆写链示例

## 5.1 按钮

按钮通常会经过多层：

1. 浏览器默认按钮
2. `styles-base.css` 的 `font: inherit`
3. 各业务文件对 `.ghost-button` / `.icon-button` / `.slim-button` 的定义
4. `theme-modern.css` 中：
   - `.theme-modern button`
   - `.theme-modern .ghost-button`
   - `.theme-modern .icon-button`
   - `.theme-modern .slim-button`
5. 局部区域进一步覆写：
   - `.viewer-floating-header-actions .ghost-button`
   - `.terminal-panel-bar-actions button`
   - `.tsc-dropdown button`

所以按钮颜色、边框、hover 不一致时，不能只看一个类。

### 5.1.1 已复现的通病：按钮框在，但图标/边框“消失”

这轮在终端右侧的 `快捷命令` / `AI 终端助手` 面板里，已经再次复现了这个问题。

表现：

- 按钮区域占位正常
- 点击热区还在
- 但图标、边框、前景色不明显，视觉上像“按钮没显示”

根因：

1. `theme-modern.css` 有全局 `.theme-modern button`
2. 同时局部面板又有 `.theme-modern .tsc-dropdown button` / `.theme-modern .tai-dropdown button`
3. 如果业务按钮只写 `.tsc-btn`、`.tsc-hdr-btn`、`.tai-hdr-btn` 这类低一层优先级的 class，就会被上面的通用 `button` 规则洗掉部分属性
4. 结果就是：
   - `border` 被重置成 `none`
   - `padding/background` 被重置
   - 深浅主题切换后，`color` / `stroke` 对比度不够
   - SVG 没有显式跟随 `currentColor` 时，看起来像空白按钮

规避规则：

1. 面板内按钮不要只写基础类，必须补更具体的主题选择器：
   - `.theme-modern .tsc-dropdown .tsc-btn`
   - `.theme-modern .tsc-dropdown .tsc-hdr-btn`
   - `.theme-modern .tai-dropdown .tai-hdr-btn`
2. 图标按钮要显式约束 SVG：
   - `width/height`
   - `display: block`
   - `stroke: currentColor`
3. 只要容器是 `button` 语义节点，就默认检查它是否会被：
   - `.theme-modern button`
   - `.theme-modern .xxx button`
   两层同时覆盖
4. 看到“按钮点得到但看不见”，先查优先级，不要先怀疑 React 渲染

经验结论：

- 这不是单个组件的偶发 bug，而是当前主题体系的高频风险点
- 以后新增弹层、终端侧栏、弹窗工具按钮时，默认按“局部 class + `.theme-modern` 同级覆写 + SVG 显式继承颜色”三件套处理

## 5.2 面板底色

典型链路：

1. `:root` 提供 `--panel`
2. `styles-layout.css` 把 `workspace-panel` 设为 `background: var(--panel)`
3. `theme-modern .workspace-panel` 进一步把 padding/gap/background 改成现代风格
4. 某些子面板再自定义背景，如：
   - `bookmark-panel`
   - `utility-workspace`
   - `terminal-bottom-panel`

如果某个子面板仍沿用旧深色背景，但文字色已经被浅色主题规则改掉，就会出现对比度错误。

## 5.3 Viewer 内容区

链路通常是：

1. `styles-file-reader.css` 定义 `viewer-content-shell`
2. `styles-viewer-search.css` 定义 `viewer-console`、`viewer-console-markup`、高亮与书签
3. `theme-modern.css` 再美化 `viewer-content-shell` / `viewer-console`
4. `styles-pip-toast.css` 可能在 PIP 模式下补额外布局

因此日志文本、滚动区、书签侧栏往往跨三个文件以上。

## 6. 当前已识别的高风险区域

## 6.1 明确缺失样式

以下 class 已在 JSX 使用，但未找到对应 CSS：

- `terminal-body-layout`
- `terminal-main-shell`
- `terminal-side-panel`

影响：

- 终端主体和快捷指令/AI 侧栏无法形成可靠的并排布局

## 6.2 明确存在配色错位

`bookmark-panel` 当前属于“旧深色容器 + 新浅色文字”的混搭状态。

表现：

- 容器背景仍是深色
- 标题、正文、空状态文本改成了浅色主题深字
- 对比度不协调，局部可读性下降

## 6.3 明确存在未接线结构

以下是“样式和组件都在，但入口没接回页面”的区域：

- `UtilityWorkspace`
- `DiffComparePanel`
- `SshTunnelPanel`
- `BatchCommandPanel`

需要区分：

- 如果是“没显示”，先查挂载
- 如果是“显示但错位”，再查 CSS

## 6.4 已有样式但当前无引用

当前已确认这类“名字像残留、实际已接线”的点需要单独甄别：

- `viewer-workbench-with-utility`

CSS 在 [styles-file-reader.css](/Users/lyc/Git/GitHub/server-log-console/apps/extension/src/styles-file-reader.css) 中存在，且当前已经在 [App.tsx](/Users/lyc/Git/GitHub/server-log-console/apps/extension/src/ui/App.tsx) 中用于 `viewer-workbench` 双栏布局。

这说明：

- 该结构已经恢复接线
- 后续遇到 viewer 与 utility 并排问题时，应优先从这个 class 追布局而不是把它误判成死代码

## 7. 排查样式问题的建议路径

后续排查时建议固定步骤：

1. 先定位 DOM 上实际 class
2. 在 `styles.css` 引入链里搜索该 class
3. 再搜索 `.theme-modern .该class`
4. 再搜索是否有更具体的父级选择器
5. 最后确认组件是否真的被挂载

特别是以下问题最容易误判：

- “样式被覆盖了”
  实际是：组件未挂载

- “主题改错了”
  实际是：旧深色容器仍在，但内部文本迁到了浅色主题配色

- “布局失效了”
  实际是：新 DOM 容器类名已经改了，但 CSS 没补齐

## 8. 后续建议

如果继续排迁移问题，建议下一步按这三个维度分别建清单：

1. 缺失定义的 class
2. 已定义但无引用的 class
3. 组件已存在但未挂载的面板

这样能把“样式问题”“结构问题”“迁移未完成问题”拆开，不会在一个 bug 里来回打转。

## 9. 迁移审计清单

这一节把当前已经确认的“迁移缺口”按类型列出来，便于逐项处理。

### 9.1 缺失定义的 class

以下 class 已在 JSX 中使用，但当前没有找到对应 CSS 定义：

1. `terminal-body-layout`
   证据：
   [TerminalWorkspace.tsx](/Users/lyc/Git/GitHub/server-log-console/apps/extension/src/ui/TerminalWorkspace.tsx#L246)

2. `terminal-main-shell`
   证据：
   [TerminalWorkspace.tsx](/Users/lyc/Git/GitHub/server-log-console/apps/extension/src/ui/TerminalWorkspace.tsx#L247)

3. `terminal-side-panel`
   证据：
   [TerminalWorkspace.tsx](/Users/lyc/Git/GitHub/server-log-console/apps/extension/src/ui/TerminalWorkspace.tsx#L263)

影响判断：

- 这三个类本来承担 terminal 主体与侧栏的布局骨架职责
- 由于不存在定义，布局只能退回普通文档流
- 这是明确的“迁移时 DOM 改了，但 CSS 没补齐”

建议状态：

- `todo` 先补基础 flex / 宽度 / overflow / 分隔边框

### 9.2 已定义且已重新接线的 utility class

以下样式在迁移早期容易被误判为“写了但没人用”，但当前已经重新挂回 JSX：

1. `viewer-workbench-with-utility`
   定义：
   [styles-file-reader.css](/Users/lyc/Git/GitHub/server-log-console/apps/extension/src/styles-file-reader.css#L26)
   使用：
   [App.tsx](/Users/lyc/Git/GitHub/server-log-console/apps/extension/src/ui/App.tsx#L2377)

2. `utility-workspace-tabs`
   定义：
   [styles-viewer-search.css](/Users/lyc/Git/GitHub/server-log-console/apps/extension/src/styles-viewer-search.css)
   [theme-modern.css](/Users/lyc/Git/GitHub/server-log-console/apps/extension/src/theme-modern.css#L2397)
   使用：
   [UtilityWorkspace.tsx](/Users/lyc/Git/GitHub/server-log-console/apps/extension/src/ui/UtilityWorkspace.tsx#L47)

3. `utility-workspace-tab`
   定义：
   [styles-viewer-search.css](/Users/lyc/Git/GitHub/server-log-console/apps/extension/src/styles-viewer-search.css)
   [theme-modern.css](/Users/lyc/Git/GitHub/server-log-console/apps/extension/src/theme-modern.css#L2402)
   使用：
   [UtilityWorkspace.tsx](/Users/lyc/Git/GitHub/server-log-console/apps/extension/src/ui/UtilityWorkspace.tsx#L54)

4. `utility-workspace-tab-active`
   定义：
   [styles-viewer-search.css](/Users/lyc/Git/GitHub/server-log-console/apps/extension/src/styles-viewer-search.css)
   使用：
   [UtilityWorkspace.tsx](/Users/lyc/Git/GitHub/server-log-console/apps/extension/src/ui/UtilityWorkspace.tsx#L54)

说明：

- `UtilityWorkspace.tsx` 现在已经具备 tabs 结构
- `App.tsx` 也会根据 `availableUtilityPanels` 动态决定可切换页签
- 当前更值得关注的是文案、层级和状态切换是否与各面板真实语义一致

建议状态：

- `done` tabs 结构已接回
- `todo` 继续做浏览器回归，确认多面板切换时的宽度、滚动和 hover 反馈

### 9.3 组件存在、样式存在，并已并入右侧 utility workspace

以下组件已经具备独立实现和对应样式，并且现在已经通过 `UtilityWorkspace` 接回主工作区：

1. `SshTunnelPanel`
   组件：
   [SshTunnelPanel.tsx](/Users/lyc/Git/GitHub/server-log-console/apps/extension/src/ui/SshTunnelPanel.tsx#L13)

2. `BatchCommandPanel`
   组件：
   [BatchCommandPanel.tsx](/Users/lyc/Git/GitHub/server-log-console/apps/extension/src/ui/BatchCommandPanel.tsx#L13)

3. `UtilityWorkspace`
   组件：
   [UtilityWorkspace.tsx](/Users/lyc/Git/GitHub/server-log-console/apps/extension/src/ui/UtilityWorkspace.tsx#L19)

4. `DiffComparePanel`
   组件：
   [DiffComparePanel.tsx](/Users/lyc/Git/GitHub/server-log-console/apps/extension/src/ui/DiffComparePanel.tsx#L19)

主界面证据：

- viewer 工具栏里已经恢复 compare / SSH 隧道 / 批量执行入口
  见 [App.tsx](/Users/lyc/Git/GitHub/server-log-console/apps/extension/src/ui/App.tsx#L2528)
- 右侧工作区已经按 `activeUtilityPanel` 条件渲染具体面板
  见 [App.tsx](/Users/lyc/Git/GitHub/server-log-console/apps/extension/src/ui/App.tsx#L2866)

这类问题现在不要再归类成“入口断了”。

真实状态是：

- 组件代码在
- 样式代码在
- 入口已接回
- 面板被统一收束到右侧 utility workspace，而不再是各自绝对定位浮层

建议状态：

- `done` 已接入新的 utility workspace
- `todo` 继续检查 utility workspace 顶栏文案、面板关闭行为和多工具切换是否一致

### 9.4 组件还能渲染，但当前无入口触发

这是比“未接回主界面”更隐蔽的一类问题：组件渲染逻辑仍在，但没有地方再把状态切到可见。

当前状态已变更，这一类问题目前不再成立：

1. `bookmark-panel`
   状态在 [App.tsx](/Users/lyc/Git/GitHub/server-log-console/apps/extension/src/ui/App.tsx#L244) 里仍然保留：
   `const [showBookmarkPanel, setShowBookmarkPanel] = useState(false);`

   渲染分支也仍然存在：
   [App.tsx](/Users/lyc/Git/GitHub/server-log-console/apps/extension/src/ui/App.tsx#L2656)

   同时 viewer 工具栏里已经恢复切换按钮，会直接调用 `setShowBookmarkPanel((current) => !current)`。

结论：

- `bookmark-panel` 已重新接回入口
- 当前主要风险不在“无入口”，而在后续视觉与交互一致性

同时它仍然有过迁移期的视觉风险点，需要继续关注：

- 深色底
- 浅色主题下的新深色文字

建议状态：

- `done` 入口已恢复
- `todo` 继续观察不同主题下的浮层对比度与层级

### 9.5 已确认的样式错配

当前已处理完成的一项是书签面板：

1. 面板背景仍然来自旧深色模型
   [styles-viewer-search.css](/Users/lyc/Git/GitHub/server-log-console/apps/extension/src/styles-viewer-search.css#L298)

2. 标题文字、正文、空状态文字已经切到浅色主题方案
   [styles-viewer-search.css](/Users/lyc/Git/GitHub/server-log-console/apps/extension/src/styles-viewer-search.css#L311)

3. 渲染结构仍然实际使用这些 class
   [App.tsx](/Users/lyc/Git/GitHub/server-log-console/apps/extension/src/ui/App.tsx#L2656)

建议状态：

- `done` 目前走的是“保留深色浮层，但把文字/分隔线/hover 调回深色面板配套色”
- `todo` 若后面统一右侧工具面板视觉，可再决定是否整体转为浅色 utility 风格

### 9.6 当前建议的修复优先级

建议按这个顺序推进：

1. `P1` 先补 `terminal-body-layout` / `terminal-main-shell` / `terminal-side-panel`
2. `P1` 清理 utility 迁移后的残留样式、旧注释和过时文档描述
3. `P2` 继续核对 utility workspace / bookmark / terminal side panel 的浏览器实态
4. `P2` 清理无引用样式，避免误导后续排查

这样处理的好处是：

- 先把真正的布局断层补上
- 再处理“功能还在但入口没了”
- 最后清理迁移残留，降低后续维护噪音
