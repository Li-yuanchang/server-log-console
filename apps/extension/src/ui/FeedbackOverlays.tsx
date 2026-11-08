import { AlertCircle, Check, Loader2, X } from "lucide-react";

export interface UploadProgressState {
  current: number;
  total: number;
  /** 展示名：批量上传时带 "(${i}/${total}) " 前缀，直接给人看 */
  fileName: string;
  /** 裸文件名（不含批次前缀）。文件表行内进度按它匹配行，
      此前用 fileName 匹配，带前缀永远不等于 entry.name → 上传行进度从不显示。 */
  currentFileName?: string;
  /** 上传目标目录（2026-11-07）：行内匹配 = 文件名 + 目标目录 === 当前目录，
      否则其他目录里的同名文件也会长出进度条（跨目录误命中）。 */
  currentTargetDir?: string;
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
  /** 完整远程路径（2026-11-07）：行内/表头按「父目录 === 当前目录」判定，防跨目录误命中 */
  filePath?: string;
  fileSize: number;
  bytesDownloaded: number;
  speed: number;
  percent: number;
  /** 暂停态（2026-11-07）：闸门挂起后置位，抽屉显示「已暂停」并隐藏过期速度 */
  paused?: boolean;
}

export interface ToastState {
  id: string;
  type: "loading" | "success" | "error";
  message: string;
  exiting?: boolean;
}

interface FeedbackOverlaysProps {
  downloadProgress: DownloadProgressState | null;
  toasts: ToastState[];
  onDismissToast: (id: string) => void;
  /** 取消当前下载（悬浮下载卡 ×）；未提供则不显示按钮 */
  onCancelDownload?: () => void;
}

export function FeedbackOverlays(props: FeedbackOverlaysProps) {
  const { toasts, onDismissToast } = props;

  /* 右下角「正在下载」悬浮卡已整体移除（2026-11-06）：
     ① 与文件表行内传输列、传输记录抽屉的「进行中」区完全重复，同一进度三处显示；
     ② 上传早在 2026-09-30 就因遮挡视线移除了悬浮气泡，下载却留着，行为不一致；
     ③ 卡片外壳 .upload-progress-bar 是 pointer-events:none，而卡内 × 未恢复 auto，
        导致「取消下载」实际点不动 —— 用户反馈「也不能关闭」的正是这个。
     下载进度改由抽屉「进行中」行承载（含取消），行内传输列同时可见。
     入参 downloadProgress / onCancelDownload 保留在 props 中：调用方仍在传，
     删字段会牵动 DialogOverlays 之外的多处接线，后续若要恢复入口也不必再改类型。 */
  void props.downloadProgress;
  void props.onCancelDownload;

  return (
    <>
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
