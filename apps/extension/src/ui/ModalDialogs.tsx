import type { ReactNode } from "react";
import { useEscapeToClose } from "./useEscapeToClose.js";

export interface ConfirmDialogState {
  title: string;
  message: string;
  /** 受影响的目标（路径 / 名称 / 主机地址）：以等宽信息块独立呈现，可选中复制 */
  target?: string;
  danger?: boolean;
  /** 确认按钮文案：用动作名（删除/覆盖/清空…），缺省回退「确定」 */
  confirmText?: string;
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
  /** 受影响的目标（路径 / 名称）：等宽信息块，可选中复制 */
  target?: string;
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
  useEscapeToClose(Boolean(dialog), onClose);

  if (!dialog) {
    return null;
  }

  return (
    <div className="confirm-backdrop" onClick={onClose}>
      <div className="confirm-dialog" role="alertdialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
        <div className="confirm-title">{dialog.title}</div>
        <div className="confirm-message">{dialog.message}</div>
        {dialog.target ? <div className="confirm-target">{dialog.target}</div> : null}
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
            {dialog.confirmText || "确定"}
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
    target,
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
  useEscapeToClose(open, onClose);

  if (!open) {
    return null;
  }

  return (
    <div className="confirm-backdrop" onClick={onClose}>
      <div className="confirm-dialog" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
        <div className="confirm-title">{title}</div>
        {message ? <div className="confirm-message">{message}</div> : null}
        {target ? <div className="confirm-target">{target}</div> : null}
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
