import { useMemo, useState } from "react";
import {
  AlertTriangle,
  Ban,
  Check,
  Copy,
  Download,
  FolderOpen,
  FolderOpenDot,
  FolderUp,
  Pause,
  Play,
  Search,
  Upload,
  X,
} from "lucide-react";
import type { TransferHistoryEntry, TransferHistoryStatus } from "./storage.js";
import type { DownloadProgressState, UploadProgressState } from "./FeedbackOverlays.js";
import { Drawer } from "./Drawer.js";
import { fileKindIcon, getParentDirectoryPath } from "./utils.js";

type Props = {
  open: boolean;
  entries: TransferHistoryEntry[];
  isElectron: boolean;
  uploadProgress: UploadProgressState | null;
  downloadProgress: DownloadProgressState | null;
  formatBytes: (value: number) => string;
  formatDateTime: (value?: string) => string;
  onBrowsePath: (path: string) => void;
  onCopyRemotePath: (path: string) => void;
  onRevealLocalPath: (path: string) => void;
  onClear: () => void;
  onClose: () => void;
  /** 取消当前下载（进行中下载行的常显 ×）；未提供则不显示按钮 */
  onCancelDownload?: () => void;
  /* 上传流程控制（进行中上传行的 暂停 / 继续 / 取消） */
  uploadPaused: boolean;
  onPauseUpload: () => void;
  onResumeUpload: () => void;
  onCancelUpload: () => void;
  /* 下载暂停/继续（2026-11-07）：与上传同一套闸门模型 */
  downloadPaused?: boolean;
  onPauseDownload?: () => void;
  onResumeDownload?: () => void;
  /** 弹出独立进度小窗（仅 Electron）；未提供则不显示按钮 */
  onOpenTransferWindow?: () => void;
  /** 本轮上传的逐文件状态（批次组展示"哪个文件卡住了"） */
  uploadFileQueue?: Array<{ name: string; size: number; transferred: number; status: "pending" | "uploading" | "done" | "error" }>;
};

type TabKey = "active" | "done" | "failed";

function isAbsoluteLocalPath(value: string) {
  return /^([A-Za-z]:[\\/]|\/)/.test(value);
}

function statusLabel(status: TransferHistoryStatus) {
  if (status === "success") return "成功";
  if (status === "error") return "失败";
  return "取消";
}

export function TransferHistoryDrawer(props: Props) {
  const [keyword, setKeyword] = useState("");
  /* 三 Tab（2026-11-07，对齐百度网盘传输列表：传输中 / 已完成 / 失败）。
     此前历史平铺一列、活动与记录混排；Tab 把「正在跑」和「查记录」分开。 */
  const [tab, setTab] = useState<TabKey>("active");

  const summary = useMemo(() => {
    let success = 0;
    let error = 0;
    let canceled = 0;
    for (const entry of props.entries) {
      if (entry.status === "success") success += 1;
      else if (entry.status === "error") error += 1;
      else canceled += 1;
    }
    return { success, error, canceled };
  }, [props.entries]);

  const keywordEntries = useMemo(() => {
    const normalizedKeyword = keyword.trim().toLowerCase();
    if (!normalizedKeyword) return props.entries;
    return props.entries.filter((entry) =>
      [entry.fileName, entry.filePath, entry.localPath || "", entry.message || "", entry.serverLabel]
        .join("\n")
        .toLowerCase()
        .includes(normalizedKeyword)
    );
  }, [keyword, props.entries]);

  const doneEntries = useMemo(
    () => keywordEntries.filter((entry) => entry.status === "success"),
    [keywordEntries]
  );
  const failedEntries = useMemo(
    () => keywordEntries.filter((entry) => entry.status === "error" || entry.status === "canceled"),
    [keywordEntries]
  );

  const uploadActive = Boolean(
    props.uploadProgress && props.uploadProgress.stage !== "completed"
  );
  const downloadActive = Boolean(
    props.downloadProgress && props.downloadProgress.percent < 100
  );
  const dnPaused = Boolean(downloadActive && (props.downloadProgress?.paused || props.downloadPaused));
  const activeCount = (uploadActive ? 1 : 0) + (downloadActive ? 1 : 0);

  const headSample = props.entries[0];
  const headContextLabel = headSample
    ? getParentDirectoryPath(headSample.filePath)
    : undefined;

  /* 直传通道诚实 UI（2026-11-07）：暂停只在文件/分片边界生效 ——
     直传单文件（remainingFiles=0）时暂停键没有意义，不渲染；批次里还有
     排队文件时暂停仍有意义（活动文件到边界后停派发）。 */
  const uploadProgress = props.uploadProgress;
  const remainingFiles = uploadProgress?.remainingFiles ?? 0;
  const isDirectSingle = uploadProgress?.transferMode === "local" && remainingFiles <= 0;
  const pauseMeaningful = uploadActive && !isDirectSingle;

  const queue = props.uploadFileQueue || [];
  const batchMode = uploadActive && queue.length > 1;
  const batchDoneCount = queue.filter((item) => item.status === "done").length;
  const batchErrorCount = queue.filter((item) => item.status === "error").length;
  const batchPendingCount = queue.filter((item) => item.status === "pending").length;

  const renderHistoryRow = (entry: TransferHistoryEntry) => {
    const canReveal = Boolean(entry.localPath && props.isElectron && isAbsoluteLocalPath(entry.localPath));
    const isError = entry.status === "error";
    const isCanceled = entry.status === "canceled";
    const KindIcon = fileKindIcon(entry.fileName);
    return (
      <div
        key={entry.id}
        className="xrow"
        onClick={() => props.onBrowsePath(getParentDirectoryPath(entry.filePath))}
        title="打开远程目录"
      >
        <span className={`xrow-ic ${isError ? "xrow-ic-err" : entry.direction === "upload" ? "xrow-ic-up" : "xrow-ic-dn"}`}>
          {isError
            ? isCanceled ? <Ban size={13} strokeWidth={1.9} /> : <AlertTriangle size={13} strokeWidth={1.9} />
            : entry.direction === "upload" ? <Upload size={13} strokeWidth={1.9} /> : <Download size={13} strokeWidth={1.9} />}
        </span>
        <span className="xrow-meta">
          <span className="xrow-fn">
            <KindIcon size={13} strokeWidth={1.9} className="xrow-fn-ic" />
            <span className="xrow-fn-text" title={entry.fileName}>{entry.fileName}</span>
          </span>
          <span className="xrow-sub">
            <span className={isError ? "xrow-err-text" : ""}>{statusLabel(entry.status)}</span>
            <span>{props.formatBytes(entry.size)}</span>
            <span>{props.formatDateTime(entry.createdAt)}</span>
          </span>
          {isError && entry.message ? (
            /* 失败原因独立第三行（抽屉 v2）：错误一族只此一处，hover 看全文 */
            <span className="xrow-msgline" title={entry.message}>{entry.message}</span>
          ) : null}
        </span>
        <span className="xrow-ops" onClick={(event) => event.stopPropagation()}>
          <button
            type="button"
            className="ghost-button icon-button"
            title="打开远程目录"
            aria-label="打开远程目录"
            onClick={() => props.onBrowsePath(getParentDirectoryPath(entry.filePath))}
          >
            <FolderOpen size={13} strokeWidth={1.85} />
          </button>
          <button
            type="button"
            className="ghost-button icon-button"
            title="复制远程路径"
            aria-label="复制远程路径"
            onClick={() => props.onCopyRemotePath(entry.filePath)}
          >
            <Copy size={13} strokeWidth={1.85} />
          </button>
          {canReveal ? (
            <button
              type="button"
              className="ghost-button icon-button"
              title="在 Finder 中显示"
              aria-label="在 Finder 中显示"
              onClick={() => props.onRevealLocalPath(entry.localPath!)}
            >
              <FolderOpenDot size={13} strokeWidth={1.85} />
            </button>
          ) : null}
        </span>
      </div>
    );
  };

  const tabs: Array<{ key: TabKey; label: string; count: number }> = [
    { key: "active", label: "传输中", count: activeCount },
    { key: "done", label: "已完成", count: summary.success },
    { key: "failed", label: "失败", count: summary.error + summary.canceled },
  ];

  /* 抽屉 v3.1：三 Tab 制。传输中 = 批量控制条 + 批次组（多文件队列）+ 单任务行；
     已完成 / 失败 = 历史记录按状态分列；搜索框全局生效。 */
  return (
    <Drawer
      open={props.open}
      onClose={props.onClose}
      title="传输"
      width={420}
      footer={
        <>
          <span className="mut" style={{ fontSize: 10.5, flex: 1 }}>
            每服务器独立 · 保留最近 50 条
          </span>
          <button
            type="button"
            className="ghost-button slim-button"
            onClick={props.onClear}
            disabled={!props.entries.length}
          >
            清空本服务器
          </button>
        </>
      }
    >
      {headSample && headContextLabel ? (
        <div className="xdrawer-ctx" title={`${headSample.serverLabel} · ${headContextLabel}`}>
          <span className="xdrawer-ctx-sv">{headSample.serverLabel}</span>
          <span className="xdrawer-ctx-sep">·</span>
          <span className="xdrawer-ctx-pa">{headContextLabel}</span>
        </div>
      ) : null}

      <div className="xdtabs" role="tablist" aria-label="传输分组">
        {tabs.map((item) => (
          <button
            key={item.key}
            type="button"
            role="tab"
            aria-selected={tab === item.key}
            className={`xdtab${tab === item.key ? " on" : ""}`}
            onClick={() => setTab(item.key)}
          >
            {item.label} <b className="cnt">{item.count}</b>
          </button>
        ))}
        <span className="xdtab-search">
          <Search size={12} strokeWidth={1.9} />
          <input
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            placeholder="搜索文件名或路径…"
          />
        </span>
      </div>

      <div className="xdrawer-list">
        {tab === "active" ? (
          <>
            {uploadActive && uploadProgress ? (
              <div className="xbatchbar">
                {props.uploadPaused ? (
                  <button
                    type="button"
                    className="xbbtn"
                    title="继续全部上传"
                    onClick={props.onResumeUpload}
                  >
                    <Play size={11} strokeWidth={2} /> 全部继续
                  </button>
                ) : (
                  <button
                    type="button"
                    className="xbbtn"
                    title={pauseMeaningful
                      ? "暂停上传（活动文件在分片/文件边界停下，排队不再派发）"
                      : "直传通道不支持中途暂停（仅在文件边界生效）"}
                    disabled={!pauseMeaningful}
                    onClick={props.onPauseUpload}
                  >
                    <Pause size={11} strokeWidth={2} /> 全部暂停
                  </button>
                )}
                <button
                  type="button"
                  className="xbbtn xdanger"
                  title="取消全部上传（立即断流）"
                  onClick={props.onCancelUpload}
                >
                  <X size={11} strokeWidth={2} /> 全部取消
                </button>
                {props.onOpenTransferWindow ? (
                  <button
                    type="button"
                    className="xbbtn"
                    title="弹出独立进度小窗（可拖到别的屏幕持续观察）"
                    onClick={props.onOpenTransferWindow}
                  >
                    弹出小窗
                  </button>
                ) : null}
              </div>
            ) : null}

            {batchMode && uploadProgress ? (
              /* 批次组（两级模型）：一次拖拽/多选 = 一个批次，
                 头部聚合整批进度，子行逐文件显示 进度/排队/完成/失败 */
              <div className="xbatch">
                <div className="xbatch-head">
                  <span className="xrow-ic xrow-ic-up"><FolderUp size={13} strokeWidth={1.9} /></span>
                  <span className="xrow-meta">
                    <span className="xrow-fn">
                      <span className="xrow-fn-text">批次 · {queue.length} 个文件</span>
                      {uploadProgress.transferMode === "local"
                        ? <em className="xtag xtag-direct">直传</em>
                        : <em className="xtag xtag-chunk">分片</em>}
                    </span>
                    <span className="xbatch-sub">
                      已完成 {batchDoneCount}
                      {batchErrorCount ? ` · 失败 ${batchErrorCount}` : ""}
                      {" · "}
                      {batchPendingCount} 个排队
                    </span>
                    <div className={`xprog${props.uploadPaused ? " xprog-paused" : ""}`}><i style={{ transform: `scaleX(${Math.max(2, uploadProgress.current) / 100})` }} /></div>
                    <span className="xrow-sub">
                      <span>批次 {uploadProgress.current}%</span>
                      {uploadProgress.speed ? <span>{props.formatBytes(uploadProgress.speed)}/s</span> : null}
                      <span>{uploadProgress.fileIndex}/{uploadProgress.totalFiles}</span>
                      {props.uploadPaused ? <span className="xrow-paused">已暂停</span> : null}
                    </span>
                  </span>
                </div>
                <div className="xbatch-kids">
                  {queue.map((item) => {
                    const pct = item.size > 0 ? Math.min(100, (item.transferred / item.size) * 100) : 0;
                    return (
                      <div key={item.name} className={`xkid xkid-${item.status}`}>
                        <span className="xkid-name" title={item.name}>{item.name}</span>
                        {item.status === "pending" ? (
                          <em className="xqueued-tag">排队中</em>
                        ) : item.status === "done" ? (
                          <span className="xkid-done"><Check size={11} strokeWidth={2.4} /> 已完成</span>
                        ) : item.status === "error" ? (
                          <span className="xkid-error">失败</span>
                        ) : (
                          <>
                            <span className="xkid-bar"><i style={{ transform: `scaleX(${pct / 100})` }} /></span>
                            <span className="xkid-meta">{Math.round(pct)}%</span>
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : uploadActive && uploadProgress ? (
              /* 单文件上传行（批次只有一个文件时不套批次壳） */
              <div className="xrow xrow-live">
                <span className="xrow-ic xrow-ic-up"><Upload size={13} strokeWidth={1.9} /></span>
                <span className="xrow-meta">
                  {(() => {
                    const UpIcon = fileKindIcon(uploadProgress.currentFileName || uploadProgress.fileName || "");
                    return (
                      <span className="xrow-fn">
                        <UpIcon size={13} strokeWidth={1.9} className="xrow-fn-ic" />
                        <span className="xrow-fn-text" title={uploadProgress.fileName}>{uploadProgress.currentFileName || uploadProgress.fileName}</span>
                        {uploadProgress.transferMode === "local"
                          ? <em className="xtag xtag-direct">直传</em>
                          : <em className="xtag xtag-chunk">分片</em>}
                      </span>
                    );
                  })()}
                  {uploadProgress.currentTargetDir ? (
                    <span className="xrow-dir" title={`目标目录 ${uploadProgress.currentTargetDir}`}>→ {uploadProgress.currentTargetDir}</span>
                  ) : null}
                  <div className={`xprog${props.uploadPaused ? " xprog-paused" : ""}`}><i style={{ transform: `scaleX(${Math.max(2, uploadProgress.current) / 100})` }} /></div>
                  <span className="xrow-sub">
                    <span>
                      {props.formatBytes(uploadProgress.bytesUploaded)} / {props.formatBytes(uploadProgress.fileSize)}
                      {" · "}
                      {uploadProgress.current}%
                    </span>
                    {uploadProgress.speed ? <span>{props.formatBytes(uploadProgress.speed)}/s</span> : null}
                    {props.uploadPaused ? <span className="xrow-paused">已暂停</span> : null}
                    {isDirectSingle ? <span className="xrow-note">仅可取消</span> : null}
                  </span>
                </span>
                <span className="xrow-ops" onClick={(event) => event.stopPropagation()}>
                  {/* 直传多文件（还有排队文件）时暂停在文件边界有意义，照常提供；
                      仅直传单文件才退化为「仅可取消」（2026-11-07 修复前后矛盾） */}
                  {!isDirectSingle ? (
                    props.uploadPaused ? (
                      <button
                        type="button"
                        className="ghost-button icon-button"
                        title="继续上传"
                        aria-label="继续上传"
                        onClick={props.onResumeUpload}
                      >
                        <Play size={13} strokeWidth={1.85} />
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="ghost-button icon-button"
                        title={uploadProgress.transferMode === "local" ? "暂停上传（在文件边界生效）" : "暂停上传"}
                        aria-label="暂停上传"
                        onClick={props.onPauseUpload}
                      >
                        <Pause size={13} strokeWidth={1.85} />
                      </button>
                    )
                  ) : null}
                  <button
                    type="button"
                    className="ghost-button icon-button xrow-cancel"
                    title={uploadProgress.transferMode === "local" ? "取消上传（立即断流）" : "取消上传"}
                    aria-label="取消上传"
                    onClick={props.onCancelUpload}
                  >
                    <X size={13} strokeWidth={1.85} />
                  </button>
                </span>
              </div>
            ) : null}

            {downloadActive && props.downloadProgress ? (
              <div className="xrow xrow-live">
                <span className="xrow-ic xrow-ic-dn"><Download size={13} strokeWidth={1.9} /></span>
                <span className="xrow-meta">
                  {(() => {
                    const DnIcon = fileKindIcon(props.downloadProgress?.fileName || "");
                    return (
                      <span className="xrow-fn">
                        <DnIcon size={13} strokeWidth={1.9} className="xrow-fn-ic" />
                        <span className="xrow-fn-text" title={props.downloadProgress?.fileName}>{props.downloadProgress?.fileName}</span>
                      </span>
                    );
                  })()}
                  {props.downloadProgress?.filePath ? (
                    <span className="xrow-dir" title={`来源 ${props.downloadProgress.filePath}`}>← {getParentDirectoryPath(props.downloadProgress.filePath)}</span>
                  ) : null}
                  <div className={`xprog${dnPaused ? " xprog-paused" : ""}`}><i style={{ transform: `scaleX(${Math.max(2, props.downloadProgress.percent) / 100})` }} /></div>
                  <span className="xrow-sub">
                    <span>
                      {props.formatBytes(props.downloadProgress.bytesDownloaded)} / {props.formatBytes(props.downloadProgress.fileSize)}
                      {" · "}
                      {props.downloadProgress.percent}%
                    </span>
                    {dnPaused
                      ? <span className="xrow-paused">已暂停</span>
                      : props.downloadProgress.speed ? <span>{props.formatBytes(props.downloadProgress.speed)}/s</span> : null}
                  </span>
                </span>
                <span className="xrow-ops" onClick={(event) => event.stopPropagation()}>
                  {dnPaused ? (
                    <button
                      type="button"
                      className="ghost-button icon-button"
                      title="继续下载（从断点续读）"
                      aria-label="继续下载"
                      onClick={props.onResumeDownload}
                    >
                      <Play size={13} strokeWidth={1.85} />
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="ghost-button icon-button"
                      title="暂停下载（停止读取，连接保持）"
                      aria-label="暂停下载"
                      onClick={props.onPauseDownload}
                    >
                      <Pause size={13} strokeWidth={1.85} />
                    </button>
                  )}
                  {props.onCancelDownload ? (
                    <button
                      type="button"
                      className="ghost-button icon-button xrow-cancel"
                      title="取消下载（断开即销毁 SFTP 流）"
                      aria-label="取消下载"
                      onClick={props.onCancelDownload}
                    >
                      <X size={13} strokeWidth={1.85} />
                    </button>
                  ) : null}
                </span>
              </div>
            ) : null}

            {!uploadActive && !downloadActive ? (
              <div className="xdtab-empty">没有进行中的传输</div>
            ) : null}
          </>
        ) : null}

        {tab === "done" ? (
          doneEntries.length ? doneEntries.map(renderHistoryRow) : (
            <div className="xdtab-empty">
              {props.entries.length ? "没有已完成的传输记录" : "当前服务器暂无传输记录"}
            </div>
          )
        ) : null}

        {tab === "failed" ? (
          failedEntries.length ? failedEntries.map(renderHistoryRow) : (
            <div className="xdtab-empty">没有失败的传输记录</div>
          )
        ) : null}
      </div>
    </Drawer>
  );
}
