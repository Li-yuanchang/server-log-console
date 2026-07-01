# 日志预览体验优化计划

更新时间：`2026-07-01`

## 1. 背景

日志预览当前承载了文件尾部阅读、搜索结果页、命中跳转、实时 tail、切片翻阅、复制、PiP 小窗等多种职责。功能已经可用，但体验上仍存在“跳动、迷路、打断阅读、复制不稳”的问题。

本计划用于约束后续优化顺序，避免继续只修局部按钮或样式。

## 2. 体验目标

- 普通滚动必须像正常阅读器，不应在用户没明确确认时切换到另一段内容。
- 搜索命中跳转后必须让用户知道“从哪里来、跳到哪里、怎么回去”。
- 实时 tail 只在用户明确处于跟随状态时自动到底部，用户手动上翻后不得抢滚动位置。
- 复制长内容不能依赖虚拟列表可视 DOM，必须提供稳定的按行范围复制能力。
- 文件切片、搜索结果、实时跟随三类状态要在 UI 上明确区分，避免用户靠猜。

## 3. P0 优先项

### 3.1 滚轮切片策略

现状：

- `handleViewerWheel` 在滚动到当前切片边缘时直接触发 `navigateSlice("prev" | "next")`。
- 大日志阅读体感像“翻页跳走”，用户还没读完当前页就可能进入下一段。

调整方向：

- 普通滚轮只滚当前可见内容。
- 到达当前切片顶部/底部时显示轻量边缘提示，例如“已到当前片段底部，继续加载下一段”。
- 只有二次确认动作才切片：点击提示、按 PageDown/PageUp、或在边缘继续滚动超过阈值。
- 切片完成后保持稳定锚点：上一段落底部，下一段落顶部。

涉及入口：

- `apps/extension/src/ui/useLogViewer.ts`
- `apps/extension/src/ui/VirtualLogViewer.tsx`
- `apps/extension/src/ui/App.tsx`

### 3.2 回到底部语义

现状：

- 多处通过 `scrollToBottom()`、定时器重试和 UI 滚动位置判断实现。
- 特殊比例、实时刷新、搜索上下文切换时容易出现回不到底部或抖动。

调整方向：

- “回到底部”统一解释为：读取文件尾部切片，然后定位最后一行。
- 如果实时跟随已暂停，回到底部后恢复跟随。
- 如果当前不是文件预览，而是搜索结果页，则回到底部只作用于当前结果页滚动，不触发文件尾部读取。
- 删除依赖右侧百分比推算尾部的路径。

涉及入口：

- `apps/extension/src/ui/useLogViewer.ts`
- `apps/extension/src/ui/useLiveFollow.ts`
- `apps/extension/src/ui/VirtualLogViewer.tsx`

### 3.3 搜索命中跳转上下文

现状：

- 点击搜索命中会切到文件预览和行上下文，但用户容易不知道当前定位来自哪个结果。

调整方向：

- 跳转后展示固定定位条：来源结果、文件名、目标行号、返回结果按钮。
- 当前命中行使用稳定高亮，不使用缩放或几何变化。
- 保留跳转前结果页滚动位置，返回结果时恢复。

涉及入口：

- `apps/extension/src/ui/useLogViewer.ts`
- `apps/extension/src/ui/App.tsx`
- `apps/extension/src/styles-viewer-search.css`

### 3.4 长文本复制

现状：

- 复制依赖浏览器 Selection 和虚拟列表已渲染 DOM，长距离拖选仍可能不稳定。

调整方向：

- 增加按行范围复制：点击行号/书签区设置起点和终点，复制完整行文本。
- 普通拖选保留，用于短文本复制。
- 复制菜单位置绑定 viewer 容器，禁止飘到左上角或脱离终端/日志区域。

涉及入口：

- `apps/extension/src/ui/VirtualLogViewer.tsx`
- `apps/extension/src/ui/useLogViewer.ts`
- `apps/extension/src/styles-viewer-search.css`

## 4. P1 优化项

- 日志预览顶部固定信息区：当前文件、当前模式、当前定位、实时状态。
- 结果 tab 名称从“结果 N”升级为“关键词 · 文件名”。
- 右侧 rail 区分文件位置 rail 和搜索结果概览 rail，视觉和文案不能混用。
- 搜索结果页改成结果列表表达：行号、时间、级别、上下文、点击区域。
- 快捷键帮助入口：`Cmd/Ctrl+F`、`n/Shift+n`、`Cmd/Ctrl+End`、`PageUp/PageDown`。

## 5. P2 打磨项

- 错误/告警高亮增加图例。
- 文件 offset 等工程信息默认收起，只在更多工具中展示。
- PiP 小窗只保留阅读必要动作，减少按钮密度。
- loading 按 `docs/loading-feedback-spec.md` 收口，禁止新增独立风格。

## 6. 验证要求

- `npm --prefix apps/extension run build`
- 大日志打开后默认尾部稳定显示。
- 搜索结果点击跳转后能看清来源和目标行。
- 手动上翻实时日志后，新日志到达不抢滚动。
- 回到底部可稳定恢复到最后一行。
- 长距离复制不截断。
