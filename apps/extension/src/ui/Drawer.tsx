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
    </div>,
    document.body
  );
}
