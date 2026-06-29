import type { ReactNode } from "react";

export interface ConfirmDialogState {
  title: string;
  message: string;
  danger?: boolean;
  onConfirm: () => void;
}

interface ConfirmDialogProps {
  dialog: ConfirmDialogState | null;
  onClose: () => void;
}

interface TextInputDialogProps {
  open: boolean;
  title: string;
  message?: ReactNode;
  label?: string;
  value: string;
  confirmText: string;
  confirmDanger?: boolean;
  placeholder?: string;
  canConfirm?: boolean;
  onChange: (value: string) => void;
  onConfirm: () => void;
  onClose: () => void;
}

export function ConfirmDialog(props: ConfirmDialogProps) {
  const { dialog, onClose } = props;
  if (!dialog) {
    return null;
  }

  return (
    <div className="confirm-backdrop" onClick={onClose}>
      <div className="confirm-dialog" onClick={(event) => event.stopPropagation()}>
        <div className="confirm-title">{dialog.title}</div>
        <div className="confirm-message">{dialog.message}</div>
        <div className="confirm-actions">
          <button type="button" className="confirm-btn confirm-btn-cancel" onClick={onClose}>取消</button>
          <button
            type="button"
            className={`confirm-btn ${dialog.danger ? "confirm-btn-danger" : "confirm-btn-primary"}`}
            onClick={() => {
              dialog.onConfirm();
              onClose();
            }}
          >
            确定
          </button>
        </div>
      </div>
    </div>
  );
}

export function TextInputDialog(props: TextInputDialogProps) {
  const {
    open,
    title,
    message,
    label,
    value,
    confirmText,
    confirmDanger,
    placeholder,
    canConfirm = true,
    onChange,
    onConfirm,
    onClose,
  } = props;

  if (!open) {
    return null;
  }

  return (
    <div className="confirm-backdrop" onClick={onClose}>
      <div className="confirm-dialog" onClick={(event) => event.stopPropagation()}>
        <div className="confirm-title">{title}</div>
        {message ? <div className="confirm-message">{message}</div> : null}
        {label ? <label className="rename-label">{label}</label> : null}
        <input
          className="rename-input"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && canConfirm) {
              onConfirm();
              onClose();
            }
            if (event.key === "Escape") {
              onClose();
            }
          }}
          placeholder={placeholder}
          autoFocus
        />
        <div className="confirm-actions">
          <button type="button" className="confirm-btn confirm-btn-cancel" onClick={onClose}>取消</button>
          <button
            type="button"
            className={`confirm-btn ${confirmDanger ? "confirm-btn-danger" : "confirm-btn-primary"} ${!canConfirm ? "confirm-btn-disabled" : ""}`}
            onClick={() => {
              if (!canConfirm) {
                return;
              }
              onConfirm();
              onClose();
            }}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}
