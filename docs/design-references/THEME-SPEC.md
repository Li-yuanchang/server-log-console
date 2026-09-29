# Server Log Console — 主题设计规范

> 本文档是项目 UI 样式的唯一约束来源。新增或修改组件样式前**必须**参照本文档，禁止随意创建不符合规范的样式。

## 参考来源

| 来源 | 用途 | 本地文档 |
|------|------|----------|
| [VoltAgent/awesome-design-md](https://github.com/VoltAgent/awesome-design-md) | 主题模板仓库 | — |
| Vercel Design System | 现代风格主体参考：纯白底、黑白主调、Geist 字体、shadow-as-border | `docs/design-references/vercel-design.md` |
| Cal.com Design System | 辅助参考：灰阶克制、圆角 pill、shadow 深度体系 | `docs/design-references/cal-design.md` |

---

## 1. 双主题体系

项目提供 **经典 (classic)** 和 **现代 (modern)** 两套主题，通过 `.theme-modern` class 切换。

### 切换方式
```tsx
// App.tsx
const [uiTheme, setUiTheme] = useState<"classic" | "modern">("classic");
// body 或根元素添加 className={uiTheme === "modern" ? "theme-modern" : ""}
```

### 文件分工
| 文件 | 职责 |
|------|------|
| `styles.css` | 经典主题 + 全局基础样式（两套主题共享的布局、reset、组件结构） |
| `theme-modern.css` | 现代主题覆盖样式（仅覆盖外观，不重复结构） |

---

## 2. CSS 变量

### 经典主题 (`:root`)

| 变量 | 值 | 用途 |
|------|----|------|
| `--bg` | `#e3e7eb` | 页面背景 |
| `--panel` | `#f2f4f6` | 面板背景 |
| `--panel-strong` | `#ffffff` | 强调面板（卡片、弹框） |
| `--panel-muted` | `#ebeff3` | 弱化面板（hover、斑马纹） |
| `--ink` | `#1f2a37` | 主文字色 |
| `--ink-soft` | `#5f6b7a` | 次要文字 |
| `--ink-muted` | `#6f7c8a` | 辅助/禁用文字 |
| `--line` | `#d7dde5` | 边框/分割线 |
| `--line-strong` | `#bcc6d2` | 强调边框 |
| `--accent` | `#315f8d` | 主强调色（按钮、链接） |
| `--accent-strong` | `#254a6c` | 强调色深色变体 |
| `--accent-soft` | `rgba(49,95,141,0.1)` | 强调色浅底（选中态） |
| `--green` | `#2d6a4f` | 在线/成功状态 |
| `--shell` | `#1a2332` | 终端背景 |
| `--shell-soft` | `#1e2a3a` | 终端次级背景 |
| `--shell-ink` | `#dbe5ef` | 终端文字色 |

### 现代主题 (`.theme-modern`)

| 变量 | 值 | 用途 | 对应 Vercel 色值 |
|------|----|------|-----------------|
| `--bg` | `#fafafa` | 页面背景 | Vercel Gray 50 |
| `--panel` | `#ffffff` | 面板背景 | Pure White |
| `--panel-strong` | `#ffffff` | 强调面板 | Pure White |
| `--panel-muted` | `#f5f5f5` | 弱化面板 | — |
| `--ink` | `#171717` | 主文字色 | Vercel Black |
| `--ink-soft` | `#666666` | 次要文字 | Gray 500 |
| `--ink-muted` | `#888888` | 辅助文字 | — |
| `--line` | `#eaeaea` | 边框/分割线 | Vercel #eaeaea |
| `--line-strong` | `#d4d4d4` | 强调边框 | — |
| `--accent` | `#0070f3` | 主强调色 | Vercel Blue |
| `--accent-strong` | `#0060df` | 强调深色 | — |
| `--accent-soft` | `rgba(0,112,243,0.07)` | 强调浅底 | — |
| `--green` | `#0a7b3e` | 在线/成功 | — |
| `--shell` | `#0a0a0a` | 终端背景 | Near Black |
| `--shell-soft` | `#1a1a1a` | 终端次级 | — |
| `--shell-ink` | `#ededed` | 终端文字 | — |
| `--log-viewer-background` | `linear-gradient(180deg, var(--shell), var(--shell-soft))` | 日志预览与搜索结果背景 | 默认跟随终端深色底 |
| `--terminal-background` | `var(--shell)` | xterm 与终端面板背景 | 可与日志背景分开 |
| `--terminal-background-soft` | `var(--shell-soft)` | 终端标题栏渐变次级背景 | — |
| `--sidebar-bg` | `#ffffff` | 侧边栏背景 | — |
| `--sidebar-line` | `#eaeaea` | 侧边栏分割线 | — |

### 自定义主题 (`.theme-modern.ui-surface-custom`)

自定义主题仍基于现代主题变量体系，不新增独立主题文件。设置中心写入 `localStorage` 后，由 `App.tsx` 注入根节点 CSS 变量，`theme-modern.css` 负责把变量映射到框架、弹窗和卡片。

| 变量 | 来源设置 | 用途 |
|------|----------|------|
| `--app-font-family` | 字体类型 | 覆盖 `.theme-modern` 的 UI 字体族 |
| `--custom-background-color` | 纯色背景 | 纯色模式背景基色 |
| `--custom-gradient-start` | 渐变起点 | 渐变模式起点，也作为图片模式兜底 |
| `--custom-gradient-end` | 渐变终点 | 渐变模式终点，也作为图片模式兜底 |
| `--custom-background-image` | 图片地址/图片选择器 | 图片模式背景，支持本地选择、`file://`、`https://`、`data:image` |
| `--custom-text-color` | 字体颜色 | 映射到 `--ink`，并派生 `--ink-soft`、`--ink-muted` |
| `--custom-log-background-color` | 日志/搜索背景 | 映射到 `--log-viewer-background`，控制日志预览与搜索结果阅读区 |
| `--custom-terminal-background-color` | 终端背景 | 映射到 `--terminal-background`，同步给 xterm 主题 |

背景模式 class：

- `ui-custom-background-solid`：纯色背景，带轻量径向高光。
- `ui-custom-background-gradient`：双端渐变背景，面板保持半透明。
- `ui-custom-background-image`：图片背景，叠加浅色蒙层和磨砂面板，避免文字直接压在图片上。

---

## 3. 字体

### 经典主题
```css
font-family: "SF Pro SC", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
```

### 现代主题
```css
/* UI 文字 */
font-family: var(--app-font-family, "Geist", "Inter", -apple-system, "SF Pro Text", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif);
letter-spacing: -0.01em;

/* 代码/终端 */
font-family: "Geist Mono", "SFMono-Regular", "Consolas", monospace;
```

---

## 4. 组件样式规范

### 4.1 按钮

| 类型 | 经典 | 现代 |
|------|------|------|
| 主按钮 | `bg: linear-gradient(var(--accent), var(--accent-strong))`, 白字 | `bg: var(--accent)`, 白字, `border-radius: 6px` |
| Ghost 按钮 | `bg: transparent`, `border: 1px solid var(--line)` | 同左, hover → `bg: var(--panel-muted)` |
| Active Tab | `bg: var(--accent)`, 白字, `font-weight: 600` | `bg: #171717`, 白字, `border-radius: 999px` |
| 图标按钮（弹框内） | `bg: transparent`, `border: none`, `color: var(--ink-muted)` | 同左 |

**关键规则**：
- 弹框内的图标按钮（关闭、最大化等）必须用 `.preview-dialog .preview-close` 形式提升优先级，防止被 `button` 基础样式或 `.theme-modern button` 覆盖
- hover 状态的 ghost-button **必须**排除 `.tab-active`：`.ghost-button:hover:not(:disabled):not(.tab-active)`

### 4.2 弹框 / Dialog

| 属性 | 值 |
|------|----|
| 默认尺寸 | 720px × 520px |
| 最小尺寸 | 400px × 300px |
| 圆角 | 经典 8px / 现代 10px |
| 阴影 | `0 8px 32px rgba(0,0,0,0.2)` / 现代 `0 12px 40px rgba(0,0,0,0.22)` |
| 遮罩行为 | `pointer-events: none`（不可点击关闭） |
| 最大化 | 100vw × 100vh, border-radius: 0 |
| macOS 最大化避让 | Electron `.electron-macos-immersive` 下，最大化弹框统一使用 `.dialog-shell-maximized .dialog-titlebar`，标题栏左侧预留 `--dialog-traffic-light-safearea: 88px`，避免红绿灯遮挡标题 |
| 拖拽调整 | 右下角 resize handle, min 400×300 |

### 4.3 输入框

| 属性 | 经典 | 现代 |
|------|------|------|
| 高度 | auto | 32px |
| 圆角 | 5px | 6px |
| 边框 | `1px solid var(--line)` | 同左 |
| Focus | `border-color: var(--accent)` + `box-shadow: 0 0 0 2px var(--accent-soft)` | 同左 |

### 4.4 面板边框

| 组件 | 经典 | 现代 |
|------|------|------|
| 侧边栏 | `border-right: 1px solid var(--line)` | 同左 |
| 工具栏 | `border-bottom` | 同左 |
| 列头 | `bg: var(--panel-muted)` | 同左 |
| 文件行 | 斑马纹 odd `var(--panel-muted)` | 同左 |

### 4.5 加载/状态

| 组件 | 样式 |
|------|------|
| Spinner | 28×28px, `border: 3px solid var(--line)`, `border-top-color: var(--accent)`, 0.7s rotate |
| Loading badge | `color: #d97706` (warning 橙) |
| 在线圆点 | `bg: #22c55e`, `box-shadow` 绿色发光 |

---

## 5. 优先级与覆盖规则

### 选择器优先级策略

```
基础组件样式     → .class                    (0,1,0)
主题覆盖        → .theme-modern .class       (0,2,0)
弹框内按钮覆盖   → .preview-dialog .btn-class (0,2,0)  ← 必须，否则被 .theme-modern button (0,1,1) 覆盖
```

### 新增样式检查清单

1. **是否使用了已有的 CSS 变量？** — 禁止硬编码颜色值
2. **经典/现代两套是否都处理了？** — 在 `styles.css` 写基础，在 `theme-modern.css` 写覆盖
3. **选择器优先级是否够？** — 特别注意 `button` 基础样式和 `.theme-modern button` 的覆盖
4. **是否影响其他组件？** — 修改公共选择器（如 `.ghost-button:hover`）前必须 grep 所有使用处
5. **边框用 `var(--line)` 还是 `var(--line-strong)`？** — 主分割用 `--line`，强调用 `--line-strong`

---

## 6. 图标

- 弹框操作按钮（关闭、最大化）使用 **内联 SVG**，`stroke="currentColor"`
- 不使用 Unicode 字符（`✕`、`☐` 等），因字体渲染不一致
- SVG 尺寸统一 14×14，strokeWidth 1.3~1.5

---

## 7. 文件索引

```
apps/extension/src/
├── styles.css              ← 经典主题 + 全局基础
├── theme-modern.css        ← 现代主题覆盖
└── ui/
    ├── App.tsx             ← 主应用（含弹框 JSX）
    └── CodeEditor.tsx      ← CodeMirror 编辑器封装

docs/design-references/
├── THEME-SPEC.md           ← 本文档（项目主题规范）
├── vercel-design.md        ← Vercel DESIGN.md 参考
└── cal-design.md           ← Cal.com DESIGN.md 参考
```
