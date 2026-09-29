import { ArrowLeft } from "lucide-react";
import { useEscapeToClose } from "./useEscapeToClose.js";

export type SettingsModalOverlayProps = {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
};

export function SettingsModalOverlay(props: SettingsModalOverlayProps) {
  const { open, onClose, children } = props;
  useEscapeToClose(open, onClose);

  if (!open) return null;

  return (
    <div className="settings-exclusive" role="dialog" aria-modal="true" aria-label="设置中心">
      <header className="settings-exclusive-head">
        <button
          className="settings-back-button"
          type="button"
          aria-label="返回主界面"
          title="返回主界面"
          onClick={onClose}
        >
          <ArrowLeft size={15} strokeWidth={1.8} />
        </button>
        <div className="settings-exclusive-title">
          <strong>设置中心</strong>
          <span>连接管理与偏好设置分离维护</span>
        </div>
      </header>
      <div className="settings-exclusive-body">{children}</div>
    </div>
  );
}
