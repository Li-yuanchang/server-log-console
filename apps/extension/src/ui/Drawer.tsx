import { useEffect, type ReactNode } from "react";
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

// 右侧滑出抽屉：承载"查看/轻操作"类界面（传输记录、工具集），替代全屏弹窗
export function Drawer(props: DrawerProps) {
  const { open, onClose, title, headExtra, footer, width = 420, zOffset = 0, children } = props;

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

  return createPortal(
    // R1：portal 到 document.body 会落在 .theme-modern 作用域之外，导致
    // `.theme-modern .xdrawer*` 令牌/规则全部失配（回落经典灰底/经典蓝）。
    // 这里包一层 display:contents 的壳（类名复制自主界面 .app-shell）：
    // 不生成盒模型、不影响布局，仅让令牌与后代选择器恢复命中
    // （fixed 定位仍相对视口，不受影响）。
    <div className={shellClassName} style={{ display: "contents" }}>
      <div
        className="xdrawer"
        role="dialog"
        aria-modal="false"
        style={{ width, zIndex: 8600 + zOffset }}
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
