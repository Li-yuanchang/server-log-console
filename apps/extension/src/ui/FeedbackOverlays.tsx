import { AlertCircle, Check, Download, Loader2, UploadCloud, X } from "lucide-react";

export interface UploadProgressState {
  current: number;
  total: number;
  fileName: string;
  fileSize: number;
  bytesUploaded: number;
  speed: number;
  stage?: "preparing" | "uploading" | "finishing" | "completed";
  transferMode?: "local" | "browser";
  fileIndex?: number;
  totalFiles?: number;
  remainingFiles?: number;
  chunkIndex?: number;
  totalChunks?: number;
  etaSeconds?: number;
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

function formatDuration(seconds?: number): string {
  if (!seconds || !Number.isFinite(seconds) || seconds <= 0) return "--";
  if (seconds < 60) return `${Math.ceil(seconds)} 秒`;
  const minutes = Math.floor(seconds / 60);
  const rest = Math.ceil(seconds % 60);
  if (minutes < 60) return `${minutes} 分 ${rest} 秒`;
  const hours = Math.floor(minutes / 60);
  const minuteRest = minutes % 60;
  return `${hours} 小时 ${minuteRest} 分`;
}

function stageLabel(stage?: UploadProgressState["stage"]): string {
  if (stage === "preparing") return "准备上传";
  if (stage === "finishing") return "正在收尾";
  if (stage === "completed") return "上传完成";
  return "正在上传";
}

function formatRemainingFiles(progress: UploadProgressState): string {
  if (!progress.totalFiles || progress.totalFiles <= 1) {
    return progress.transferMode === "local" ? "本地直传" : `${progress.total} 个任务`;
  }
  const remaining = Math.max(0, progress.remainingFiles ?? progress.totalFiles - (progress.fileIndex || 0));
  const chunkText = progress.totalChunks ? ` · 分片 ${progress.chunkIndex || 0}/${progress.totalChunks}` : "";
  return `剩余 ${remaining} 个文件${chunkText}`;
}

export function FeedbackOverlays(props: FeedbackOverlaysProps) {
  const { downloadProgress, uploadProgress, toasts, onDismissToast } = props;
  const downloadEtaSeconds = downloadProgress && downloadProgress.fileSize > 0 && downloadProgress.speed > 0
    ? Math.max(0, (downloadProgress.fileSize - downloadProgress.bytesDownloaded) / downloadProgress.speed)
    : undefined;
  const downloadPercent = downloadProgress
    ? Math.min(100, Math.max(0, downloadProgress.percent))
    : 0;
  const downloadHasKnownProgress = Boolean(downloadProgress && downloadProgress.fileSize > 0 && downloadProgress.bytesDownloaded > 0);

  return (
    <>
      {downloadProgress ? (
        <div className="upload-progress-bar upload-progress-card download-progress-card">
          <div className="upload-progress-card-head">
            <span className="upload-progress-icon download-progress-icon"><Download size={16} strokeWidth={2.2} /></span>
            <div className="upload-progress-title-block">
              <span className="upload-progress-kicker">正在下载</span>
              <span className="upload-progress-text" title={downloadProgress.fileName}>{downloadProgress.fileName}</span>
            </div>
            <strong className="upload-progress-percent download-progress-percent">
              {downloadHasKnownProgress ? `${downloadPercent}%` : "准备中"}
            </strong>
          </div>
          <div className="upload-progress-track">
            <div
              className={`upload-progress-fill download-progress-fill${downloadHasKnownProgress ? "" : " transfer-progress-fill-empty"}`}
              style={{ transform: `scaleX(${(downloadHasKnownProgress ? downloadPercent : 0) / 100})` }}
            />
          </div>
          <div className="upload-progress-detail-grid">
            <span>{formatTransferSize(downloadProgress.bytesDownloaded)}{downloadProgress.fileSize > 0 ? ` / ${formatTransferSize(downloadProgress.fileSize)}` : ""}</span>
            <span>{downloadProgress.speed > 0 ? `${formatTransferSize(downloadProgress.speed)}/s` : "计算速率中"}</span>
            <span>{downloadEtaSeconds ? `剩余 ${formatDuration(downloadEtaSeconds)}` : "剩余 --"}</span>
            <span>{downloadProgress.fileSize > 0 ? "远程文件接收中" : "等待文件大小"}</span>
          </div>
        </div>
      ) : null}

      {uploadProgress ? (
        <div
          className={`upload-progress-bar upload-progress-card${uploadProgress.stage === "completed" ? " upload-progress-card-complete" : ""}`}
          style={downloadProgress ? { bottom: 170 } : undefined}
        >
          <div className="upload-progress-card-head">
            <span className="upload-progress-icon"><UploadCloud size={16} strokeWidth={2.2} /></span>
            <div className="upload-progress-title-block">
              <span className="upload-progress-kicker">{stageLabel(uploadProgress.stage)}</span>
              <span className="upload-progress-text" title={uploadProgress.fileName}>{uploadProgress.fileName}</span>
            </div>
            <strong className="upload-progress-percent">{uploadProgress.current}%</strong>
          </div>
          <div className="upload-progress-track">
            <div className="upload-progress-fill" style={{ transform: `scaleX(${uploadProgress.current / 100})` }} />
          </div>
          <div className="upload-progress-detail-grid">
            <span>{formatTransferSize(uploadProgress.bytesUploaded)} / {formatTransferSize(uploadProgress.fileSize)}</span>
            <span>{uploadProgress.speed > 0 ? `${formatTransferSize(uploadProgress.speed)}/s` : "计算速率中"}</span>
            <span>{uploadProgress.etaSeconds ? `预计 ${formatDuration(uploadProgress.etaSeconds)}` : "预计时间计算中"}</span>
            <span>{formatRemainingFiles(uploadProgress)}</span>
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
