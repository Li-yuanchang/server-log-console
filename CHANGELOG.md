# Changelog

## 文档分工

- **`CHANGELOG.md`** — 只记录版本级摘要、对外可读的修复项和验证结论。
- **`docs/版本修复归档-2026-04-14.md`** — 记录问题背景、根因、修改点、经验教训和防复发清单。
- **维护约定** — 详细代码链、安装版资源命中、排查过程与复盘结论统一写入归档，不在 `CHANGELOG.md` 重复展开。

## [0.3.273] — 2026-10-09

日志行悬浮提示精简版本。

### 修复

- **日志行悬浮提示过于频繁** — 原先给每一行都挂原生 `title`，鼠标划过任意一行都弹出「Cmd/Ctrl 点击复制日志块…」，日志行密且长，提示频繁出现遮挡内容；移除逐行原生 title，行操作提示改由既有即时气泡按需呈现。

## [0.3.272] — 2026-10-08

日志查看器快速滚动白屏修复版本。

### 修复

- **日志查看器快速滚动露白屏** — 日志行 `white-space: pre-wrap` + `word-break` 会折行，行高不固定（单行 18px，长堆栈可折成上百 px）；原 `defaultItemHeight=17`（小于真实 18px）叠加仅按像素算的 overscan，快速滚动时按 17px 估算的偏移与真实布局错位，视口落进「已估算但未渲染」区域露出浅色底。现默认行高对齐真实值 18px，并用 `increaseViewportBy` 在视口上下各预渲染一段，滚动时新区域已就绪。

## [0.3.271] — 2026-10-08

重启安装逻辑回归 vrc 实现版本。

### 修复

- **重启安装不再自行强杀进程** — 移除安装时的 `app.quit()` / `app.exit()` 兜底，改为与 vrc 完全一致：置位 `isQuitting` 后 `setImmediate(() => quitAndInstall(false, true))`，由 `quitAndInstall` 自行完成「武装 Squirrel/ShipIt + 退出进程」。此前额外强杀（800ms quit + 2.5s exit 等）会在更新交由系统安装器之前终止进程，导致包已下载校验但 ShipIt 从未被唤起、版本不生效。

## [0.3.270] — 2026-10-08

重启安装交接修复版本。

### 修复

- **更新包已下载校验但版本不生效** — 点击「重启并安装」后 app 退出，但 Squirrel.Mac 的 ShipIt 从未被唤起，导致换包未发生、版本停留在旧版（现象：更新过程转圈后 app 自己起来仍是旧版本）。根因是安装退出时过早强杀进程（旧代码 quitAndInstall 后 800ms `quit` + 2.5s `exit`），掐断了 electron-updater 把更新经本地代理交给 Squirrel 的交接。现改为让 `quitAndInstall` 自行完成退出，仅在异常时以 10s / 20s 长延时兜底，不再抢在它前面。
- **更新器日志缺失** — 接入 electron-updater logger，下载与安装交接全过程写入 `/tmp/slc-main-probe.txt`，后续排查有据可依。

## [0.3.269] — 2026-10-08

软件更新面板进度体验优化版本。

### 修复

- **下载完成后页面高度抖动** — 校验通过提示原本是进度条下方独立一行，只在下载完成时渲染，凭空增高约 20px 顶动整页；改为并入进度条顶行（下载中该位置显示字节数，完成后原位换成绿色「✓ SHA-256 校验通过」），高度恒定不再抖动。
- **下载进度条生硬** — 进度事件按 200ms 节流 + 填充条 180ms 匀速 transition，表现为「一截一动」的机械跳变；改用 rAF 帧率无关指数缓动连续逼近目标值并直接写 DOM（绕开 React 重渲染），60fps 平滑推进、接近目标自然减速；中途重新挂载时从当前进度接着走而非从 0 重爬。

### 修复（开发）

- **预览页图标路径** — loading-preview / restart-preview 的 `/icon.svg` 改为相对路径 `./icon.svg`，修正开发预览页在子路径下的图标加载。

## [0.3.268] — 2026-10-06

终端标签关闭与新建会话回显抑制修复版本。

### 修复

- **关闭终端最后一个标签要点两次** — 工作区一旦进入多标签模型即永久记住，关闭至空后不再用旧的 terminalSessionId 复活标签；此前关掉最后一个标签会立刻被迁移逻辑重建，表现为「点一次关不掉、要点第二次」。
- **关闭最后一个标签未退出终端视图** — 标签清空时同步关闭终端面板并回到内容区（日志预览 / 文件目录），不再停留在空态工作台，避免「点终端却打开日志预览」的错乱。
- **复用会话新建终端回显未抑制** — 池化连接 / JumpServer shell 这类已处于提示符的会话，原实现漏发 `stty -echo`，只能等超时兜底、内部命令可能泄漏到屏幕；现在立即进入隐藏阶段。
- **回显抑制探针误命中** — 探针标记改用八进制转义 `printf '\100\100SLC\100\100'`（命令文本本身不含 `@`），且只在「关回显命令发出后新到达」的数据窗口内判命中；此前探针字面含 `@` 又扫描全量缓冲，会被命令回显或登录提示符里的 `@` 提前命中，导致载荷被回显。

## [0.3.267] — 2026-10-06

侧栏状态卡居中修复与文案调整版本。

### 修复

- **底部状态卡内容未垂直居中（三层叠加修复）** — ① styles-empty-workbench.css（加载晚于 theme-modern-v2.css，同特异性后赢）的折叠态规则 `height:auto; align-items:stretch` 压掉了 v2 的 30px 定高，卡片高度随内容、文字贴上沿 → 改为 `height:30px + align-items/justify-content:center`；② `.st-l1` 残留旧两行布局的单边顶部 padding（`7px 12px 0`），在居中单行卡里把文字压低 ≈3.5px → 归零（水平内边距由卡片 0 14px 提供）；③ 曾加 margin-bottom:4px 微调 CJK 字形度量偏差，实测整行偏上（用户反馈），已撤回——flex 几何居中即为最终态。实测字形中心与卡片中心偏差 ≤1px。st-l2 详情行仍收进展开态。
- **状态词「待命」改为「未连接」** — idle 态（未选择服务器）原文案"待命"含义不清，改为"未连接"，与 连接中/已连接/连接失败 词族一致。

## [0.3.263] — 2026-10-06

连接中空态 loading 去重 + 侧栏底部状态条裁切修复版本。

### 修复

- **连接中空态 loading 重复** — 「正在连接 xxx」空态同时渲染 live 实时状态行（"● 正在自动连接服务器…"）与步骤① 的 spinner，两个加载指示叠放。去掉独立 live 行，实时 actionStatus 并入步骤① 描述（spinner = 唯一加载指示，实时文案不丢）。
- **侧栏底部状态条显示不全** — 折叠态被固定 30px（与终端状态栏同高对齐决策）+ overflow:hidden，但卡片内容天然两行（st-l1 状态 + st-l2 详情），第二行被裁一半悬在边缘。折叠态隐藏 st-l2（详情收进点击展开态），30px 对齐保留、不再出现裁切；连接中的实时文案已在主区步骤①中展示。

## [0.3.262] — 2026-10-06

文件目录三角号常显修复 + 服务器行操作重排版本。

### 修复

- **文件目录行中部的 `›` 三角常显、列错位** — 目录行尾的 `›`（v3 设计④：仅移动档显示）的"默认隐藏守卫"写在 `@container slc-sp (max-width:559.9px)` 块内——桌面 1280px 下容器查询不命中，守卫从未生效，裸 SVG 以默认 display 渲染常显，且作为多余 grid 子项把 大小/修改时间/类型 列挤错位。修复：守卫提升到顶层作用域（`.app-shell .f-go, body.extension-sidepanel .f-go { display:none }`，styles-sidepanel 加载最末、特异性压过 svg 全局规则）；窄档显示规则保留在容器查询内。实测桌面 18 个 `›` 全部 `display:none`，行/表头列对齐恢复。
- **服务器行 hover/选中时名称与 IP 被挤成半截** — 快捷组此前被 v2 §15 改为流内元素（hover/选中时 `display:inline-flex` 顶掉端口），但三个按钮（连接/编辑/更多）合计 ≈100px，把 `.server-item` 挤到 68px，名称/IP 只剩 "2.2..."、"192..."。重排：hover/选中只保留一个「更多 ⋯」按钮，「编辑」收进 ⋯ 菜单（新增「编辑（设置中心）」项），「连接」移除（与点击行本身重复）；配合快捷组右距 12→4px、按钮 28→24px、行右内边距 12→8px。实测行宽 68→140px，最长 host（192.168.127.122，99px）完整显示。

## [0.3.260] — 2026-10-06

设置中心检查更新按钮 hover 可读性修复版本。

### 修复

- **「检查更新」按钮 hover 后文字不可见** — `.settings-exclusive button`（0,2,1）通配规则把设置区按钮统一为白底深字，压掉了 `settings-update-btn-primary`（0,1,0）的 accent 常态；但它的 `:hover` 规则（0,3,0）又能赢过通配，把背景翻成 `--accent-strong` 深蓝，文字仍是通配给的深色 `--ink` → 深底深字。hover 改为与设置区其它按钮一致的 `panel-muted` 浅底 + `--ink` 深字（常态外观不变）。

## [0.3.259] — 2026-10-06

终端按钮选中态去边框版本。

### 修复

- **终端按钮选中（激活）态仍带边框** — 快捷命令面板 / AI 抽屉展开按钮的激活态在 hover 统一后仍保留 accent 描边（`border-color: color-mix(accent 28%)`），与日志预览开关按钮的选中样式（无边框柔和底，见 align-selected.css `icon-toggle-active`）不一致。两处同名规则（align-s5-terminal.css、theme-modern-v2.css）的 `border-color` 统一改为 `transparent`：激活态 = accent-soft 底 + accent 字 + 无边框。

## [0.3.258] — 2026-10-06

终端按钮 hover 样式统一版本。

### 修复

- **终端工具钮 hover 灰盒 → 与日志预览按钮一致的柔和着色底** — 终端工具行按钮 hover 此前是中性灰盒（`--panel-muted`），日志预览按钮 hover 是 accent-soft 柔和着色底（无边框、圆角、图标加深）。将 `terminal-toolbar-button` 的 hover 底色统一为 `var(--accent-soft)`（与 `icon-button:hover` 同 token），涉及 align-s5-terminal.css 与 theme-modern-v2.css 两处同名规则（层级平级，必须同步改）。激活态（快捷命令/AI 抽屉）本就是 accent-soft，不变。

## [0.3.257] — 2026-10-06

预览按钮条满宽与终端黑窗呼吸间距版本。

### 修复

- **日志预览按钮条左右两端没到头 + 右侧按钮对齐** — `.viewer-shell` 的 `padding: 0 16px 8px` 把整个预览列（含「文件预览 · xxx」按钮条与「回到头部/切片」工具行）一起内缩 16px。改为 shell 左右内缩走 `--viewer-pad-x` 变量，两条工具条（`.viewer-toolbar-row`、`.log-view-bar`）负 margin 抵消让条背景满宽顶到工作区两缘；条内内容不沿用旧的内缩位置，而是对齐 12px 的 bar 列约定（初版补偿 28px 保留了旧的右缘位置 1252，与命令栏 ⌘K 的 1268 差 16px，用户指出后改为 12px）。实测：两条 bar 200→1280 满宽，条内按钮右缘 = ⌘K 右缘 = 暂停按钮右缘 = 1268 同一竖线，日志正文留白原样保留。仅 `.workspace-panel` 祖先作用域，PiP/独立小窗不受影响。
- **终端黑窗左右贴边无呼吸** — 终端链路（workspace-panel-terminal → terminal-tab-panes → xterm-viewport 黑底）实测左右 padding 全 0，黑窗怼死两缘；页签条/快捷命令行自带 ≈14px 内容边距，视觉上只有黑块贴边。给 `.terminal-tab-panes > .terminal-tab-pane` 加左右 12px margin + `width:auto`：黑窗内缩透出工作区底色形成呼吸，自带圆角随之可见。两个坑（防复发）：① pane 是 `absolute + inset:0`，绝对定位的 containing block 是祖先 padding box（含 padding 区），父级加 padding 无效，必须用 pane 自身 margin；② pane 带有 `.terminal-panel-body` 的 `width:100%`，left+width+right 超约束时 right 被忽略 → 只缩左边、右边溢出 12px，必须同时 `width:auto`。实测黑窗 212→1268，左右呼吸各 12px 完全对称。

## [0.3.253] — 2026-10-05

文件列表竖向滚动条跨过表头修复版本。

### 修复

- **竖向滚动条从表头那一行就开始画** — 文件列表是 CSS Grid 手写假表格（`.file-table` / `.file-table-head` / `.file-row` 均为 `div`，非 `<table>`），且表头此前是滚动容器 `.file-table`（`overflow:auto`）的子元素、靠 `position:sticky` 吸顶——滚动条属于该容器，轨道高度覆盖整表（含表头），所以从表头顶部起画。改为：`.file-table` 变成不滚动的 flex 列容器，数据行（含空态/加载态）包进新的 `.file-table-body` 独立滚动容器，表头留在滚动容器外、去掉 sticky。表头与 body 各自 `scrollbar-gutter: stable` 同宽预留，保证滚动条出现/消失时列宽不跳、表头与数据列仍对齐。滚动条现在只从表头下沿开始。
  - `FileBrowserTable.tsx`：`{head}{children}` → `{head}<div class="file-table-body">{children}</div>`
  - `styles-file-reader.css`：`.file-table` 改 flex 列 + `overflow:hidden`；新增 `.file-table-body`（`overflow:auto` + `scrollbar-gutter:stable`）；`.file-table-head` 去掉 `position:sticky`、改 `flex:0 0 auto` + `overflow:hidden` + `scrollbar-gutter:stable`。

## [0.3.252] — 2026-10-05

文件列表右侧留白异常修复版本。

### 修复

- **文件列表右侧多出一条死空白（右 31px vs 左 16px 不对称）** — 「S6 滚动条常驻占位」把 `scrollbar-gutter: stable` 加在了 `.browser-file-column-body` 上，但该元素是 `overflow: hidden`、永不滚动；文件列表真正的滚动容器是内层 `.file-table`（`overflow: auto`，表头 sticky 挂在它上面）。这条 stable 纯凭空占 15px，并把表内滚动条向内推、右侧露出一条死空白。移除 body 上的该项（目录树 `.tree-list` 是真实滚动容器，保留 stable 正常防列宽跳变）。实测右边界由 31px 收敛到 16px，与左侧对称。

## [0.3.251] — 2026-10-05

mac 沉浸式标题栏呼吸间距修复版本。

### 修复

- **侧栏头部按钮与红绿灯垂直居中** — 红绿灯保持系统默认位置不动（`trafficLightPosition` y=12，实测渲染圆心 ≈19.5px），侧栏头部按钮行 `padding-top` 由 5px 提到 7px，⌘/设置按钮字形中心（20px）落到红绿灯视线上（此前按钮整体偏高约 1.5px）。
- **工作区页签条贴顶裁切** — 页签条网页版用的 `margin: -6px` 出血在沉浸式下（main-panel 无 padding）会把整条推出窗口顶 6px 被裁掉，tab 文字距窗口顶仅约 7px、比红绿灯线高约 5px。mac 沉浸式下归零负边距，顶部留 3px、条高 37px，34px 页签中心（20px）与红绿灯同一条视线，下划线不再贴顶，整带保持紧凑。仅 `electron-macos-immersive` 作用域生效，网页/扩展侧栏布局不变。

## [0.3.248] — 2026-10-05

托盘图标二次重设计版本。

### 变更

- **状态栏图标改为日志流线条** — 实心方块方案偏重、与菜单栏其它线型图标不协调，改为无外框的两行递减日志条 + `❯` 提示符线型 glyph，与 Dock 图标"日志行 + 提示符"同构，深浅色菜单栏均清晰。
- **加载界面 logo 核对** — 启动页（index.html `#app-loading`）、重启遮罩、`?splash` 设计预览均通过 `/icon.svg` 动态引用应用图标，0.3.247 的新 logo 已自动生效，无需逐屏替换。

## [0.3.247] — 2026-10-05

品牌形象与打包命名优化版本。

### 变更

- **应用图标重新设计** — 由"终端提示符"升级为"日志流"视觉：三行带级别圆点（绿/黄/红）的日志条 + 白色 `❯` 提示符与青色光标，底色渐变与光晕同步翻新。同步覆盖 macOS icns、Windows ico、Linux/托盘 PNG 与浏览器扩展图标全套尺寸。
- **状态栏图标重新设计** — 托盘改为实心圆角方块 + 镂空提示符（macOS 模板图，深浅色菜单栏均清晰）。
- **打包名缩短** — `ServerLogConsole` → `SLC`（Server Log Console 缩写）：产物为 `SLC.app`、`SLC-<ver>-arm64.dmg` 等，CFBundleName 同步为 `SLC`（菜单栏进程名），Finder 显示名仍为「日志控制台」，用户数据目录不受影响。

## [0.3.246] — 2026-10-05

重启安装可靠性修复版本。

### 修复

- **重启安装后进程不退出** — 点击「重启并安装」后窗口关闭但进程残留，Squirrel 换包工具等不到进程退出会无限挂起：升级看似无反应、旧遮罩不消失、手动重开的还是旧版本。现在退出安装后 800ms 温和退出、2.5s 强制退出兜底，换包立即完成并自动重启进入新版本。

## [0.3.245] — 2026-10-05

更新源可视化配置版本。

### 新增

- **更新源可编辑** — 「软件更新 → 更多信息」中的更新源支持直接修改并保存，立即热切换生效；地址保存在本机，清空并保存即恢复打包内置地址。下载进行中不允许切换。仅桌面版显示该设置，Web 与扩展端按各自机制更新。

## [0.3.244] — 2026-10-05

在线更新体验优化版本：版本说明随更新清单下发，更新面板对齐 VRC 更新中心的密度。

### 修复

- **版本说明为空** — 发布清单现在携带用户可读的版本说明（由 CHANGELOG 自动生成），检查更新即可看到本次更新内容；「已是最新」时也会展示当前版本的说明。
- **更新面板收敛** — 自动检查开关上移到状态卡头部；发布渠道、各形态说明、检查记录、更新源与关于信息折叠进「更多信息」，默认收起。

## [0.3.243] — 2026-10-05

OTA 端到端验证版本。代码与 0.3.242 相同，仅升版用于验证 0.3.242 已装客户端的在线检测、差量下载与重启安装全链路。

## [0.3.242] — 2026-10-05

在线更新链路首个可用版本（更新组件随包分发 + 更新源配置内嵌 + 网关更新目录免鉴权）。

### 修复

- **更新组件进安装包** — `electron-updater` 从 devDependencies 移入 dependencies，electron-builder 自动打进 app.asar；此前打包后 `require("electron-updater")` 失败，设置中心显示「更新组件不可用」。
- **更新源随包内嵌** — 打包前 `prepare-update-config.cjs` 读取 `update-config.local.json`（或 `SLC_UPDATE_URL`）写入 `resources/update-config/update-config.json`；此前包内 updateUrl 为空，更新源显示「--」。
- **网关更新目录免鉴权** — 鉴权中间件放行 `/desktop-updates/` 前缀；electron-updater 检查更新不携带 Bearer token，经网关托管更新源时不再被 401 拦截。

### 验证

- **asar 抽查** — `app.asar` 内含 `node_modules/electron-updater`；`Contents/Resources/app-update.yml` 与 `update-config/update-config.json` 均指向 `http://192.168.2.208/desktop-updates`。
- **更新源实测** — `http://192.168.2.208/desktop-updates/latest-mac.yml` 及 zip/dmg 匿名可访问。

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
