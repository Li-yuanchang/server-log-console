import type { LogFileEntry } from "@server-log-console/shared";
import { TextInputDialog, ConfirmDialog, type ConfirmDialogState } from "./ModalDialogs.js";
import { FilePreviewDialog, type PreviewDialogState } from "./FilePreviewDialog.js";
import { TransferHistoryDialog } from "./TransferHistoryDialog.js";
import type { TransferHistoryEntry } from "./storage.js";

export type DialogOverlaysProps = {
  uiTheme: "classic" | "modern";
  renameDialog: { entry: LogFileEntry; newName: string } | null;
  moveDialog: { entry: LogFileEntry; targetDir: string } | null;
  batchMoveDialog: { entries: LogFileEntry[]; targetDir: string } | null;
  extractDialog: { filePath: string; fileName: string; targetDir: string } | null;
  mkdirDialog: { parentDir: string; dirName: string } | null;
  compressDialog: { sourcePath: string; sourceName: string; archiveType: "tar.gz" | "zip"; targetDir: string } | null;
  previewDialog: PreviewDialogState | null;
  confirmDialog: ConfirmDialogState | null;
  showTransferHistory: boolean;
  transferHistoryEntries: TransferHistoryEntry[];
  isElectron: boolean;
  formatBytes: (bytes: number) => string;
  formatDateTime: (value?: string) => string;
  onRenameDialogChange: (value: string) => void;
  onRenameDialogConfirm: () => void;
  onRenameDialogClose: () => void;
  onMoveDialogChange: (value: string) => void;
  onMoveDialogConfirm: () => void;
  onMoveDialogClose: () => void;
  onBatchMoveDialogChange: (value: string) => void;
  onBatchMoveDialogConfirm: () => void;
  onBatchMoveDialogClose: () => void;
  onExtractDialogChange: (value: string) => void;
  onExtractDialogConfirm: () => void;
  onExtractDialogClose: () => void;
  onMkdirDialogChange: (value: string) => void;
  onMkdirDialogConfirm: () => void;
  onMkdirDialogClose: () => void;
  onCompressDialogChange: (value: string) => void;
  onCompressDialogConfirm: () => void;
  onCompressDialogClose: () => void;
  onPreviewDialogChange: (value: string) => void;
  onPreviewDialogDownload: () => void;
  onPreviewDialogSave: () => void;
  onPreviewArchiveEntry: (entryName: string) => void;
  onPreviewDialogToggleMaximize: () => void;
  onPreviewDialogClose: () => void;
  onConfirmDialogClose: () => void;
  onTransferHistoryBrowsePath: (path: string) => void;
  onTransferHistoryCopyRemotePath: (path: string) => void;
  onTransferHistoryCopyLocalPath: (path: string) => void;
  onTransferHistoryRevealLocalPath: (path: string) => void;
  onTransferHistoryClear: () => void;
  onTransferHistoryClose: () => void;
};

export function DialogOverlays(props: DialogOverlaysProps) {
  const {
    uiTheme,
    renameDialog,
    moveDialog,
    batchMoveDialog,
    extractDialog,
    mkdirDialog,
    compressDialog,
    previewDialog,
    confirmDialog,
    showTransferHistory,
    transferHistoryEntries,
    isElectron,
    formatBytes,
    formatDateTime,
    onRenameDialogChange,
    onRenameDialogConfirm,
    onRenameDialogClose,
    onMoveDialogChange,
    onMoveDialogConfirm,
    onMoveDialogClose,
    onBatchMoveDialogChange,
    onBatchMoveDialogConfirm,
    onBatchMoveDialogClose,
    onExtractDialogChange,
    onExtractDialogConfirm,
    onExtractDialogClose,
    onMkdirDialogChange,
    onMkdirDialogConfirm,
    onMkdirDialogClose,
    onCompressDialogChange,
    onCompressDialogConfirm,
    onCompressDialogClose,
    onPreviewDialogChange,
    onPreviewDialogDownload,
    onPreviewDialogSave,
    onPreviewArchiveEntry,
    onPreviewDialogToggleMaximize,
    onPreviewDialogClose,
    onConfirmDialogClose,
    onTransferHistoryBrowsePath,
    onTransferHistoryCopyRemotePath,
    onTransferHistoryCopyLocalPath,
    onTransferHistoryRevealLocalPath,
    onTransferHistoryClear,
    onTransferHistoryClose,
  } = props;

  return (
    <>
      <TextInputDialog
        open={Boolean(renameDialog)}
        title={`重命名${renameDialog?.entry.kind === "directory" ? "文件夹" : "文件"}`}
        message={renameDialog?.entry.path}
        value={renameDialog?.newName ?? ""}
        confirmText="确定"
        canConfirm={Boolean(renameDialog && renameDialog.newName.trim() && renameDialog.newName !== renameDialog.entry.name)}
        onChange={onRenameDialogChange}
        onConfirm={onRenameDialogConfirm}
        onClose={onRenameDialogClose}
      />

      <TextInputDialog
        open={Boolean(moveDialog)}
        title={`移动${moveDialog?.entry.kind === "directory" ? "文件夹" : "文件"}`}
        message={moveDialog ? `当前：${moveDialog.entry.path}` : ""}
        label="目标目录"
        value={moveDialog?.targetDir ?? ""}
        confirmText="移动"
        placeholder="/home/app/target-dir"
        canConfirm={Boolean(moveDialog?.targetDir.trim())}
        onChange={onMoveDialogChange}
        onConfirm={onMoveDialogConfirm}
        onClose={onMoveDialogClose}
      />

      <TextInputDialog
        open={Boolean(batchMoveDialog)}
        title={`批量移动 ${batchMoveDialog?.entries.length ?? 0} 项`}
        message="目标将保留原文件名或目录名。"
        label="目标目录"
        value={batchMoveDialog?.targetDir ?? ""}
        confirmText="移动"
        placeholder="/home/app/target-dir"
        canConfirm={Boolean(batchMoveDialog?.targetDir.trim())}
        onChange={onBatchMoveDialogChange}
        onConfirm={onBatchMoveDialogConfirm}
        onClose={onBatchMoveDialogClose}
      />

      <TextInputDialog
        open={Boolean(extractDialog)}
        title="解压文件"
        message={extractDialog?.fileName}
        label="目标目录"
        value={extractDialog?.targetDir ?? ""}
        confirmText="解压"
        placeholder="/home/app/target-dir"
        canConfirm={Boolean(extractDialog?.targetDir.trim())}
        onChange={onExtractDialogChange}
        onConfirm={onExtractDialogConfirm}
        onClose={onExtractDialogClose}
      />

      <TextInputDialog
        open={Boolean(mkdirDialog)}
        title="新建目录"
        message={mkdirDialog ? `在 ${mkdirDialog.parentDir} 下创建` : ""}
        label="目录名称"
        value={mkdirDialog?.dirName ?? ""}
        confirmText="创建"
        placeholder="new-directory"
        canConfirm={Boolean(mkdirDialog?.dirName.trim())}
        onChange={onMkdirDialogChange}
        onConfirm={onMkdirDialogConfirm}
        onClose={onMkdirDialogClose}
      />

      <TextInputDialog
        open={Boolean(compressDialog)}
        title="压缩"
        message={compressDialog?.sourcePath}
        label="目标目录（留空则与源同目录）"
        value={compressDialog?.targetDir ?? ""}
        confirmText="压缩"
        placeholder="/home/app/target-dir"
        canConfirm={true}
        onChange={onCompressDialogChange}
        onConfirm={onCompressDialogConfirm}
        onClose={onCompressDialogClose}
      />

      <FilePreviewDialog
        dialog={previewDialog}
        theme={uiTheme}
        onChange={onPreviewDialogChange}
        onDownload={onPreviewDialogDownload}
        onSave={onPreviewDialogSave}
        onPreviewArchiveEntry={onPreviewArchiveEntry}
        onToggleMaximize={onPreviewDialogToggleMaximize}
        onClose={onPreviewDialogClose}
      />

      <TransferHistoryDialog
        open={showTransferHistory}
        entries={transferHistoryEntries}
        isElectron={isElectron}
        formatBytes={formatBytes}
        formatDateTime={formatDateTime}
        onBrowsePath={onTransferHistoryBrowsePath}
        onCopyRemotePath={onTransferHistoryCopyRemotePath}
        onCopyLocalPath={onTransferHistoryCopyLocalPath}
        onRevealLocalPath={onTransferHistoryRevealLocalPath}
        onClear={onTransferHistoryClear}
        onClose={onTransferHistoryClose}
      />

      <ConfirmDialog dialog={confirmDialog} onClose={onConfirmDialogClose} />
    </>
  );
}
