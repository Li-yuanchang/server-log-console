import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./ui/App";
import { bootstrapGatewayAuth } from "./ui/api";
import "./fonts.css";
import "./styles.css";
import "./theme-modern.css";
import "./theme-modern-v2.css";
// 原型 1:1 对齐批次（隔离文件，最后加载以覆盖旧规则）
import "./align-s5-terminal.css";
import "./align-s7-s8.css";
import "./align-s9-monitor.css";
import "./align-s4-s6.css";
import "./align-s10-s14.css";
// 服务器性能监控面板（B 骨架 + A 磁盘块，2026-10 重设计）：
// smp- 前缀 + container query 响应式，须在 align-s9-monitor 之后加载以接管旧 server-status-* 的视觉
import "./styles-server-monitor.css";
// 内嵌日志/切片查看区改浅色（对齐原型 S1/S3/S4；勿影响 S7 弹窗/终端/PiP 的深色）
import "./align-log-light.css";
// 选中态统一：tab/分段/胶囊 = 无实底 + accent 文字（用户决策 2026-09-30）
import "./align-selected.css";
// 控件统一：深色表面按钮护栏 + 「检索│LIVE」竖线（用户决策 2026-09-30）
import "./align-controls.css";
// 空状态工作台 + 侧栏底部五态状态条（方案 A 定稿 2026-10-04，
// 原型 empty-states-a-v2.html；须在 theme-modern-v2 之后、styles-sidepanel 之前）
import "./styles-empty-workbench.css";
// 环境覆盖层：Chrome 扩展侧栏（body.extension-sidepanel）窄容器适配，
// 双主题生效 + grid 语义；必须最后加载（2026-10-02 自 theme-modern.css 迁出）
import "./styles-sidepanel.css";

/** 最小 ErrorBoundary：渲染期未捕获错误（含 PiP 搬迁等 DOM 失配引发的 reconcile 崩溃）
    时显示可见降级页（错误摘要 + 刷新按钮），而不是整页白屏。 */
class RootErrorBoundary extends React.Component<{ children: React.ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error): { error: Error } {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error("[RootErrorBoundary] 未捕获的渲染错误:", error, info.componentStack);
  }

  render(): React.ReactNode {
    const { error } = this.state;
    if (error) {
      return (
        <div
          style={{
            minHeight: "100vh",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 12,
            padding: 24,
            background: "#101317",
            color: "#e6ebf2",
            fontFamily: "inherit",
          }}
        >
          <strong style={{ fontSize: 18 }}>页面出错了</strong>
          <span
            style={{
              color: "#9aa7b4",
              fontSize: 13,
              maxWidth: 560,
              textAlign: "center",
              wordBreak: "break-word",
            }}
          >
            {error.message || String(error)}
          </span>
          <button
            type="button"
            onClick={() => window.location.reload()}
            style={{
              padding: "8px 20px",
              borderRadius: 8,
              border: "1px solid #3a4654",
              background: "#1b2129",
              color: "#e6ebf2",
              cursor: "pointer",
            }}
          >
            刷新页面
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

/* 桌面端启动时先取网关访问令牌（主进程生成并注入给 gateway）。
   浏览器 / 扩展形态下该 IPC 不存在，静默跳过。

   2026-10-28 修复「必须先点授权、再维护服务器才行；直接维护就 401」：
   原实现是 `bootstrapGatewayAuth()` 即发即忘（内部 void 异步），React 立刻
   渲染，于是首个业务请求（如打开「维护服务器」）可能在 token 写入前发出 →
   401；而先访问授权页再回来时异步恰好已完成 → 正常。表现为「操作顺序敏感」。
   现改为 await 令牌就绪后再挂载，保证任何用户操作都发生在 token 注入之后。
   最坏情况只是首屏多等一次 IPC 往返（通常 <10ms），远优于随机的 401。 */
/* 先 await 令牌就绪再挂载，保证首个业务请求一定带 Authorization。
   失败（浏览器形态无 IPC）时 catch 掉，照常渲染。 */
void (async () => {
  try {
    await bootstrapGatewayAuth();
  } catch {
    /* IPC 不可用：保持无令牌，由 401 引导用户手动填写 */
  }
  createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <RootErrorBoundary>
        <App />
      </RootErrorBoundary>
    </React.StrictMode>
  );
})();
