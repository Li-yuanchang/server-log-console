import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

export type DrawerProps = {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  headExtra?: ReactNode;
  footer?: ReactNode;
  width?: number;
  zOffset?: number;
  children: ReactNode;
};

// S15/§3d 断点：≥1440 抽屉为推挤式——统一收口到 420px，与主内容区
// （.shell-layout）的 padding-right: 420px 让位空间精确对位，内容收窄
// 不遮盖；<1440 维持覆盖式，沿用调用方传入的宽度（无遮罩、ESC 关闭）。
const WIDE_VIEWPORT_QUERY = "(min-width: 1440px)";
const PUSH_DRAWER_WIDTH = 420;

// matchMedia 断点监听：窗口跨 1440 时抽屉在推挤/覆盖两种模式间实时切换
function useWideViewport() {
  const [wide, setWide] = useState(() =>
    typeof window === "undefined" ? false : window.matchMedia(WIDE_VIEWPORT_QUERY).matches
  );
  useEffect(() => {
    if (typeof window === "undefined") return;
    const query = window.matchMedia(WIDE_VIEWPORT_QUERY);
    const onChange = (event: MediaQueryListEvent) => setWide(event.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);
  return wide;
}

// 右侧滑出抽屉：承载"查看/轻操作"类界面（传输记录、工具集），替代全屏弹窗
export function Drawer(props: DrawerProps) {
  const { open, onClose, title, headExtra, footer, width = 420, zOffset = 0, children } = props;
  const wideViewport = useWideViewport();

  // 皮肤类（ui-surface-paper / ui-surface-mist / ui-density-* 等）定义在主界面
  // .app-shell 上。portal 到 body 时若只带 .theme-modern，--panel 等令牌会回落
  // 成默认纯白，出现抽屉与主界面左右色差；这里复制 app-shell 的完整类名。
  const shellClassName = typeof document !== "undefined"
    ? document.querySelector(".app-shell")?.className ?? "theme-modern"
    : "theme-modern";

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  // 推挤式（≥1440）：宽度对齐 420 让位空间（不再出现 480 宽工具抽屉残余
  // 遮盖 60px 的问题）；覆盖式（<1440）保持调用方宽度。
  const pushMode = wideViewport;
  const effectiveWidth = pushMode ? Math.min(width, PUSH_DRAWER_WIDTH) : width;

  return createPortal(
    // R1：portal 到 document.body 会落在 .theme-modern 作用域之外，导致
    // `.theme-modern .xdrawer*` 令牌/规则全部失配（回落经典灰底/经典蓝）。
    // 这里包一层 display:contents 的壳（类名复制自主界面 .app-shell）：
    // 不生成盒模型、不影响布局，仅让令牌与后代选择器恢复命中
    // （fixed 定位仍相对视口，不受影响）。
    <div className={shellClassName} style={{ display: "contents" }}>
      <div
        className={pushMode ? "xdrawer xdrawer-push" : "xdrawer"}
        role="dialog"
        aria-modal="false"
        style={{ width: effectiveWidth, zIndex: 8600 + zOffset }}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="xdrawer-head">
          <span className="xdrawer-title">{title}</span>
          {headExtra}
          <button
            type="button"
            className="ghost-button icon-button xdrawer-close"
            title="关闭"
            aria-label="关闭"
            onClick={onClose}
          >
            <X size={15} strokeWidth={1.8} />
          </button>
        </div>
        <div className="xdrawer-body">{children}</div>
        {footer ? <div className="xdrawer-foot">{footer}</div> : null}
      </div>
    </div>,
    document.body
  );
}
