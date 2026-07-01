# Loading 与进度反馈统一规范

更新时间：`2026-07-01`

## 1. 背景

当前前端存在多套 loading / progress / toast 表现：

- 文件打开使用居中 `file-loading-card`
- 搜索任务使用 `SearchProgressPanel`
- 上传/下载使用右下角 `upload-progress-card`
- 普通异步操作通过 `useAsyncStatus` 弹 toast loading
- 目录读取使用 `directory-loading-state` + `connect-spinner`
- 弹窗预览使用 `preview-loading-spinner`
- Diff / SSH Tunnel 等工具面板使用纯文本 `加载中...`
- 连接测试按钮旁使用 `connect-spinner`

这些状态样式分散在 `styles-pip-toast.css`、`styles-file-reader.css`、`styles-dialogs-transfer.css`、`styles-viewer-search.css`、`theme-modern.css` 和多个组件里。视觉重量、动画速度、占位方式、提示位置不统一，容易出现“同一动作多处提示”“中间 loading 太重”“局部加载却遮挡主工作流”的问题。

本规范用于后续统一改造，避免继续新增第 N 套 loading。

## 2. 现有 Loading 清单

| 类型 | 入口 | 样式 | 当前问题 | 建议归属 |
|---|---|---|---|---|
| 全局 toast loading | `useAsyncStatus.ts`、`useToasts.ts`、`FeedbackOverlays.tsx` | `.toast-*` | 和局部 loading 经常重复；loading icon 旋转较明显 | 后台/短任务提示 |
| 文件打开 loading | `App.tsx` `fileLoadingName` | `.file-loading-overlay`、`.file-loading-card` | 居中卡片过重；与传输卡片风格相近但尺寸、信息层级不同 | 内容区原地状态 |
| 搜索进度 | `SearchProgressPanel.tsx` | `.search-progress-*` | 独立风格，和传输进度条视觉不一致 | 长任务进度 |
| 上传/下载进度 | `FeedbackOverlays.tsx` | `.upload-progress-*`、`.download-progress-*` | 目前最完整，但仅用于传输 | 长任务进度基准 |
| 目录读取 loading | `App.tsx` `isDirectoryContentLoading` | `.directory-loading-state` + `.connect-spinner` | 和文件打开、工具面板加载不是同一种占位 | 内容区原地状态 |
| 弹窗文件预览 loading | `FilePreviewDialog.tsx` | `.preview-loading`、`.preview-loading-spinner` | spinner 独立，和主系统进度语言不同 | Dialog 内原地状态 |
| 归档条目读取 | `FilePreviewDialog.tsx` | `.archive-entry-placeholder` + `.preview-loading-spinner` | 复用弹窗 spinner，但信息层级弱 | Dialog 内原地状态 |
| 本地对比加载 | `DiffComparePanel.tsx` | `.local-file-loading` | 纯文本，不可感知是否卡住 | 局部列表状态 |
| SSH 隧道加载 | `SshTunnelPanel.tsx` | `.ssh-tunnel-loading` | 纯文本，不统一 | 局部列表状态 |
| 连接测试 busy | `App.tsx`、`useServerConnection.ts` | `.connect-spinner` | 小 spinner 可保留，但不要作为大面积 loading 主视觉 | 按钮/行内状态 |
| 读者浮动预览更新 | `App.tsx` `readerPreviewLoading` | 文案“正在更新” | 合理，属于低干扰状态 | 保留为文案状态 |

## 3. 统一反馈分层

后续所有 loading 只允许落入以下 5 类。

### 3.1 行内忙碌态

用于按钮、开关、单行操作。

适用场景：

- 连接测试按钮
- 刷新目录按钮
- 保存按钮
- 小型工具面板刷新按钮

规则：

- 使用 12 到 14px 的轻量 spinner 或按钮 disabled 文案
- 不弹 toast，除非失败
- 不遮挡内容
- 动画速度不低于 1.1s 一圈，避免“焦躁”

### 3.2 局部列表/面板占位

用于目录、列表、弹窗局部内容读取。

适用场景：

- 目录内容加载
- Diff 本地文件列表加载
- SSH 隧道列表加载
- 归档内文件读取
- class 反编译等待

规则：

- 在原位置显示轻量占位，不居中全屏
- 使用统一小卡片：标题 + 次要说明 + 细进度条或 shimmer
- 不使用大阴影
- 不出现多个 spinner
- 内容已有旧数据时，优先保留旧数据并在头部显示“正在刷新”，不要清空成大空白

### 3.3 内容区打开/切换状态

用于文件打开、日志切片读取、打开二进制文件提示。

适用场景：

- 打开日志文件
- 打开非文本文件预览
- 切换日志预览/文件目录时需要等待数据

规则：

- 不再使用截图里的重型居中浮层作为默认方案
- 首选在 viewer 内容区左上或顶部条内显示“正在打开/读取”，保持页面结构稳定
- 如果内容为空，可以显示轻量 empty-card，但卡片宽度、阴影、进度条必须和传输卡片体系一致
- 如果已有内容，禁止把 viewer 隐藏到 `opacity: 0; height: 0`，避免页面跳动

### 3.4 长任务进度卡片

用于有明确进度、耗时超过 1 秒、用户可能切换注意力的任务。

适用场景：

- 上传
- 下载
- 多文件搜索
- 大文件压缩/解压
- 大文件预览或反编译如果可报告阶段

规则：

- 统一复用右下角进度卡片规格
- 显示：任务名、阶段、百分比、速率/剩余时间/数量
- 有实际进度时用确定进度条；无实际进度时用“准备中”细条，不显示假 100%
- 成功保留 1.2s 后自动消失
- 失败变成错误卡片，保留更久或要求手动关闭

### 3.5 Toast 结果反馈

用于短消息，不承担主 loading。

适用场景：

- 成功复制
- 保存完成
- 录制开始/结束结果
- 后台任务失败

规则：

- `loading` toast 只用于没有局部承载位置的后台任务
- 如果某动作已经有内容区 loading 或进度卡片，不再弹 loading toast
- 成功 toast 1.8s 自动消失
- 错误 toast 4.8s 自动消失或可手动关闭

## 4. 视觉规范

### 4.1 视觉基调

- 工具型 UI，loading 应该“可见但不抢戏”
- 颜色使用灰阶 + 少量 accent，不再使用重蓝、重绿、大面积发光
- 阴影只用于浮层卡片；内容区占位不使用大阴影
- 动画只用轻扫线、细进度条、低速 spinner，禁止强闪烁

### 4.2 建议 token

后续可落为 CSS 变量：

```css
--feedback-card-bg: rgba(252, 253, 255, 0.94);
--feedback-card-border: rgba(23, 23, 23, 0.08);
--feedback-track: rgba(23, 23, 23, 0.055);
--feedback-fill: rgba(82, 96, 112, 0.42);
--feedback-shadow-floating: 0 16px 42px rgba(15, 23, 42, 0.10);
--feedback-shadow-inline: none;
```

现代主题下继续走 `--panel`、`--ink`、`--ink-muted`、`--line`，不要新增硬编码颜色。

### 4.3 动效

- spinner：`1.2s` 到 `1.4s` 一圈
- determinate progress：`transform: scaleX()`，`220ms` 到 `280ms`
- indeterminate sweep：`2.2s` 到 `2.8s`
- toast 入场：`160ms` 到 `220ms`
- 禁止 loading 组件改变文字、边框或容器几何尺寸导致抖动

## 5. 组件收敛方案

建议新增统一组件：

| 组件 | 用途 | 替换对象 |
|---|---|---|
| `InlineBusy` | 行内 spinner / 按钮状态 | `.connect-spinner` 的直接使用 |
| `PanelLoadingState` | 列表/面板局部占位 | `.directory-loading-state`、`.local-file-loading`、`.ssh-tunnel-loading` |
| `TaskProgressCard` | 右下角长任务卡片 | 上传/下载卡片、搜索进度后续可合并 |
| `ContentLoadingState` | viewer 文件打开状态 | `.file-loading-overlay`、`.file-loading-card` |
| `DialogLoadingState` | 弹窗内加载 | `.preview-loading`、归档 entry loading |

短期可以先不重构所有组件文件，但 CSS class 需要逐步改到统一命名和统一 token。

## 6. 迁移优先级

### P0：去重与减重

1. 文件打开时只保留内容区 loading，不再同时触发 toast loading
2. 截图中的 `file-loading-card` 改轻：降低阴影、缩小卡片、文案层级减弱
3. 内容已有旧数据时，不隐藏 viewer，不出现页面跳动

### P1：统一局部列表状态

1. `directory-loading-state`
2. `local-file-loading`
3. `ssh-tunnel-loading`
4. `archive-entry-placeholder` loading

统一成 `PanelLoadingState` 的样式。

### P2：统一长任务进度

1. 上传/下载卡片保留为基准
2. 搜索进度改成同一套进度条 token
3. 后续压缩/解压/反编译如有进度，直接复用 `TaskProgressCard`

### P3：统一 toast 策略

1. `withBusy` 增加参数：是否显示 loading toast
2. 有局部 loading 的任务调用 `withBusy(..., { toast: false })`
3. loading toast 仅用于无 UI 承载位置的后台任务

## 7. 禁止事项

- 禁止新增裸文本 `加载中...`
- 禁止一个动作同时出现 loading toast、内容区 loading、右下角进度卡片
- 禁止使用大面积强色 loading
- 禁止用 `opacity: 0; height: 0` 隐藏主内容造成布局跳动
- 禁止在 hover / loading 中使用会改变几何尺寸的 `scale`、`translateY`
- 禁止新增不走 `--panel`、`--ink`、`--line`、`--accent` 的硬编码主题色

## 8. 当前建议先改的点

结合截图，优先处理：

1. `file-loading-overlay` / `file-loading-card`
   - 从居中重卡片改为轻量内容区状态
   - 阴影降级，宽度缩小，文案弱化
   - 保留进度细条，但颜色更淡、动画更慢
2. `directory-loading-state`
   - 与文件打开统一为同一种局部占位
3. `local-file-loading` / `ssh-tunnel-loading`
   - 从裸文本改为同一类局部状态
4. `SearchProgressPanel`
   - 视觉 token 向上传/下载卡片靠拢，但不做右下角浮层
