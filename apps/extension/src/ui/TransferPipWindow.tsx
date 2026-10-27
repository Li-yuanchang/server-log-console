import { useEffect, useState } from "react";

/**
 * 上传进度小窗（Electron PiP，mode="transfer"）
 *
 * 职责边界（刻意收窄）：
 * - ✅ 显示逐文件进度、总速度、剩余量
 * - ✅ 暂停 / 继续 / 取消
 * - ❌ **不接受拖放** —— 独立窗口没有目录浏览器，拖进来不知道传哪。
 *      投放一律在主窗口完成（能选目录、能确认同名覆盖）。
 * - ❌ 不切换目标目录
 *
 * 数据来源：主窗口通过 IPC `slc:transfer:progress` 推送（200ms 节流，
 * 终态不节流）。控制指令经 `slc:transfer:control` 转回主窗口执行 ——
 * 小窗不直接操作上传，避免两个窗口持有同一份上传状态机。
 */

interface TransferFileItem {
  name: string;
  size: number;
  transferred: number;
  status: "pending" | "uploading" | "done" | "error";
}

export interface TransferProgressPayload {
  /** 目标目录（只读展示） */
  directoryPath: string;
  /** 阶段：uploading / done / error / canceled */
  stage: "preparing" | "uploading" | "done" | "error" | "canceled";
  /** 当前整体进度 */
  bytesUploaded: number;
  totalBytes: number;
  speed: number;
  files: TransferFileItem[];
  /** 暂停态 */
  paused?: boolean;
  /** 错误信息 */
  message?: string;
}

const INITIAL: TransferProgressPayload = {
  directoryPath: "",
  stage: "preparing",
  bytesUploaded: 0,
  totalBytes: 0,
  speed: 0,
  files: []
};

function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let index = 0;
  let num = value;
  while (num >= 1024 && index < units.length - 1) {
    num /= 1024;
    index += 1;
  }
  return `${num >= 100 ? Math.round(num) : num.toFixed(1)} ${units[index]}`;
}

function formatSpeed(bytesPerSecond: number): string {
  if (!Number.isFinite(bytesPerSecond) || bytesPerSecond <= 0) return "--";
  return `${formatBytes(bytesPerSecond)}/s`;
}

export function TransferPipWindow() {
  const [data, setData] = useState<TransferProgressPayload>(INITIAL);

  useEffect(() => {
    const bridge = (window as any).electronAPI;
    if (!bridge?.onTransferProgress) return;
    const dispose = bridge.onTransferProgress((payload: TransferProgressPayload) => {
      if (payload) setData(payload);
    });
    return () => {
      try {
        dispose?.();
      } catch {
        /* 忽略 */
      }
    };
  }, []);

  const sendControl = (action: "pause" | "resume" | "cancel") => {
    const bridge = (window as any).electronAPI;
    bridge?.sendTransferControl?.(action);
  };

  const percent = data.totalBytes > 0
    ? Math.min(100, Math.round((data.bytesUploaded / data.totalBytes) * 1000) / 10)
    : 0;
  const doneCount = data.files.filter((f) => f.status === "done").length;
  /* 只有真的有任务时才显示暂停/取消。
     初始态 stage 是 "preparing" 但 files 为空 —— 那是"还没开始"，
     给按钮会让人以为可以取消一个不存在的任务。 */
  const isRunning = data.stage === "uploading" || (data.stage === "preparing" && data.files.length > 0);
  const isFinished = data.stage === "done";
  const isFailed = data.stage === "error" || data.stage === "canceled";

  return (
    <div className="tpw-root">
      <header className="tpw-head">
        <span className={`tpw-dot tpw-dot-${isFinished ? "ok" : isFailed ? "bad" : data.files.length === 0 ? "idle" : "active"}`} />
        <strong>
          {isFinished
            ? "传输完成"
            : isFailed
              ? (data.stage === "canceled" ? "已取消" : "传输失败")
              : data.files.length === 0
                ? "等待传输"
                : "正在上传"}
        </strong>
        <span className="tpw-count">{doneCount}/{data.files.length}</span>
      </header>

      <div className="tpw-meta">
        <span className="tpw-dir" title={data.directoryPath}>{data.directoryPath || "—"}</span>
        <span className="tpw-stat">
          {formatBytes(data.bytesUploaded)} / {formatBytes(data.totalBytes)}
        </span>
      </div>

      <div className="tpw-bar">
        <i style={{ width: `${percent}%` }} className={isFinished ? "done" : isFailed ? "bad" : ""} />
      </div>

      <div className="tpw-files">
        {data.files.length === 0 ? (
          <div className="tpw-empty">等待传输开始…</div>
        ) : (
          data.files.map((file) => {
            const filePct = file.size > 0 ? Math.min(100, (file.transferred / file.size) * 100) : 0;
            return (
              <div key={file.name} className={`tpw-file tpw-file-${file.status}`}>
                <span className="tpw-file-name" title={file.name}>{file.name}</span>
                <span className="tpw-file-bar"><i style={{ width: `${filePct}%` }} /></span>
                <span className="tpw-file-size">{formatBytes(file.size)}</span>
              </div>
            );
          })
        )}
      </div>

      {isFailed && data.message ? (
        <div className="tpw-msg">{data.message}</div>
      ) : null}

      <footer className="tpw-foot">
        <span className="tpw-speed">{isRunning && !data.paused ? formatSpeed(data.speed) : data.paused ? "已暂停" : ""}</span>
        <div style={{ flex: 1 }} />
        {isRunning ? (
          data.paused ? (
            <button type="button" className="tpw-btn" onClick={() => sendControl("resume")}>继续</button>
          ) : (
            <button type="button" className="tpw-btn" onClick={() => sendControl("pause")}>暂停</button>
          )
        ) : null}
        {isRunning ? (
          <button type="button" className="tpw-btn tpw-btn-ghost" onClick={() => sendControl("cancel")}>取消</button>
        ) : null}
      </footer>

      <div className="tpw-note">
        小窗只做监视与暂停/取消。上传请在主窗口拖放 —— 这里没有目录浏览器，容易传错地方。
      </div>
    </div>
  );
}
