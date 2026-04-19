import { AlertCircle, Check, Download, Loader2, X } from "lucide-react";

export interface UploadProgressState {
  current: number;
  total: number;
  fileName: string;
  fileSize: number;
  bytesUploaded: number;
  speed: number;
}

export interface DownloadProgressState {
  fileName: string;
  fileSize: number;
  bytesDownloaded: number;
  speed: number;
  percent: number;
}

export interface ToastState {
  id: string;
  type: "loading" | "success" | "error";
  message: string;
  exiting?: boolean;
}

interface FeedbackOverlaysProps {
  downloadProgress: DownloadProgressState | null;
  uploadProgress: UploadProgressState | null;
  toasts: ToastState[];
  onDismissToast: (id: string) => void;
}

function formatTransferSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export function FeedbackOverlays(props: FeedbackOverlaysProps) {
  const { downloadProgress, uploadProgress, toasts, onDismissToast } = props;

  return (
    <>
      {downloadProgress ? (
        <div className="upload-progress-bar download-progress-bar">
          <div className="upload-progress-info">
            <span className="upload-progress-text"><Download size={12} strokeWidth={2} style={{ marginRight: 4, verticalAlign: -1 }} />{downloadProgress.fileName}</span>
            <span className="upload-progress-stats">
              {formatTransferSize(downloadProgress.bytesDownloaded)}{downloadProgress.fileSize > 0 ? ` / ${formatTransferSize(downloadProgress.fileSize)}` : ""}
              {downloadProgress.speed > 0 ? ` · ${formatTransferSize(downloadProgress.speed)}/s` : ""}
              {downloadProgress.percent > 0 ? ` · ${downloadProgress.percent}%` : ""}
            </span>
          </div>
          <div className="upload-progress-track">
            <div className="upload-progress-fill download-progress-fill" style={{ width: downloadProgress.percent > 0 ? `${downloadProgress.percent}%` : undefined }} />
          </div>
        </div>
      ) : null}

      {uploadProgress ? (
        <div className="upload-progress-bar" style={downloadProgress ? { bottom: 36 } : undefined}>
          <div className="upload-progress-info">
            <span className="upload-progress-text">{uploadProgress.fileName}</span>
            <span className="upload-progress-stats">
              {formatTransferSize(uploadProgress.bytesUploaded)} / {formatTransferSize(uploadProgress.fileSize)}
              {uploadProgress.speed > 0 ? ` · ${formatTransferSize(uploadProgress.speed)}/s` : ""}
              {" · "}{uploadProgress.current}%
            </span>
          </div>
          <div className="upload-progress-track">
            <div className="upload-progress-fill" style={{ width: `${uploadProgress.current}%` }} />
          </div>
        </div>
      ) : null}

      {toasts.length > 0 ? (
        <div className="toast-container">
          {toasts.map((toast) => (
            <div key={toast.id} className={`toast-item${toast.exiting ? " toast-item-exit" : ""}`}>
              <span className={`toast-icon toast-icon-${toast.type}`}>
                {toast.type === "loading" ? <Loader2 size={16} strokeWidth={2.2} className="toast-icon-loading" /> : null}
                {toast.type === "success" ? <Check size={16} strokeWidth={2.5} /> : null}
                {toast.type === "error" ? <AlertCircle size={16} strokeWidth={2} /> : null}
              </span>
              <span className="toast-message">{toast.message}</span>
              <button className="toast-dismiss" onClick={() => onDismissToast(toast.id)} type="button">
                <X size={13} strokeWidth={2} />
              </button>
            </div>
          ))}
        </div>
      ) : null}
    </>
  );
}
