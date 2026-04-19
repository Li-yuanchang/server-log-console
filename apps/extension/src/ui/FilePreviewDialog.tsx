import { CodeEditor } from "./CodeEditor";
import { formatBytes } from "./utils.js";

export interface PreviewDialogState {
  filePath: string;
  fileName: string;
  content: string;
  originalContent: string;
  size: number;
  saving?: boolean;
  loading?: boolean;
  maximized?: boolean;
  readOnly?: boolean;
}

interface FilePreviewDialogProps {
  dialog: PreviewDialogState | null;
  theme: "classic" | "modern";
  onChange: (value: string) => void;
  onDownload: () => void;
  onSave: () => void;
  onToggleMaximize: () => void;
  onClose: () => void;
}

export function FilePreviewDialog(props: FilePreviewDialogProps) {
  const {
    dialog,
    theme,
    onChange,
    onDownload,
    onSave,
    onToggleMaximize,
    onClose,
  } = props;

  if (!dialog) {
    return null;
  }

  return (
    <div className="confirm-backdrop preview-backdrop">
      <div
        className={`preview-dialog${dialog.maximized ? " preview-dialog-maximized" : ""}`}
        onMouseDown={(event) => {
          const target = event.target as HTMLElement;
          if (!target.classList.contains("preview-resize-handle")) return;
          event.preventDefault();
          const previewDialog = target.parentElement;
          if (!previewDialog) {
            return;
          }
          const startX = event.clientX;
          const startY = event.clientY;
          const startW = previewDialog.offsetWidth;
          const startH = previewDialog.offsetHeight;
          const onMove = (moveEvent: MouseEvent) => {
            previewDialog.style.width = `${Math.max(400, startW + moveEvent.clientX - startX)}px`;
            previewDialog.style.height = `${Math.max(300, startH + moveEvent.clientY - startY)}px`;
          };
          const onUp = () => {
            document.removeEventListener("mousemove", onMove);
            document.removeEventListener("mouseup", onUp);
          };
          document.addEventListener("mousemove", onMove);
          document.addEventListener("mouseup", onUp);
        }}
      >
        <div className="preview-header">
          <div className="preview-title">
            {dialog.fileName}
            {dialog.readOnly
              ? <span className="preview-readonly-badge">只读 · {dialog.fileName.endsWith(".record.log") ? "录制预览" : "尾部预览"} · {formatBytes(dialog.size)}</span>
              : dialog.content !== dialog.originalContent ? <span className="preview-dirty"> (已修改)</span> : null
            }
          </div>
          <div className="preview-meta">
            <span>{formatBytes(dialog.size)}</span>
            {dialog.loading ? <span className="preview-loading-badge">加载中…</span> : null}
          </div>
          <div className="preview-actions">
            <button type="button" className="preview-save-btn" onClick={onDownload}>
              下载
            </button>
            {!dialog.readOnly && (
              <button
                type="button"
                className={`preview-save-btn ${dialog.content === dialog.originalContent || dialog.saving ? "preview-save-btn-disabled" : ""}`}
                onClick={onSave}
                disabled={dialog.content === dialog.originalContent || dialog.saving}
              >
                {dialog.saving ? "保存中..." : "保存"}
              </button>
            )}
            <button
              type="button"
              className="preview-maximize-btn"
              title={dialog.maximized ? "还原窗口" : "最大化"}
              onClick={onToggleMaximize}
            >
              {dialog.maximized
                ? <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3"><rect x="3.5" y="5" width="7" height="6" rx="1"/><path d="M5 5V3.5a1 1 0 011-1h4.5a1 1 0 011 1V8a1 1 0 01-1 1H9"/></svg>
                : <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3"><rect x="2.5" y="2.5" width="9" height="9" rx="1.5"/></svg>
              }
            </button>
            <button type="button" className="preview-close" onClick={onClose}>
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M3.5 3.5l7 7M10.5 3.5l-7 7"/></svg>
            </button>
          </div>
        </div>
        {dialog.loading ? (
          <div className="preview-loading">
            <div className="preview-loading-spinner" />
            <span>正在加载文件内容…</span>
          </div>
        ) : (
          <CodeEditor
            value={dialog.originalContent}
            fileName={dialog.fileName}
            theme={theme}
            readOnly={dialog.readOnly}
            onChange={onChange}
            onSave={onSave}
          />
        )}
        <div className="preview-resize-handle" />
      </div>
    </div>
  );
}
