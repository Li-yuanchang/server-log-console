import { X } from "lucide-react";
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
    <div className="settings-modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="settings-modal-shell"
        role="dialog"
        aria-modal="true"
        aria-label="连接设置"
        onClick={(event) => event.stopPropagation()}
      >
        <button
          className="ghost-button icon-button settings-modal-close"
          type="button"
          aria-label="关闭设置"
          onClick={onClose}
        >
          <X size={16} strokeWidth={1.75} />
        </button>
        {children}
      </div>
    </div>
  );
}
