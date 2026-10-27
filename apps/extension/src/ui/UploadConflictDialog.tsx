import { useMemo, useState } from "react";
import { AlertTriangle, FileUp, FileWarning } from "lucide-react";
import { useEscapeToClose } from "./useEscapeToClose.js";

/**
 * 上传冲突确认
 *
 * 背景：此前上传同名文件是**静默覆盖** —— 上传逻辑里没有任何存在性检查。
 * 拖一个 app.log 上去，远端同名文件直接消失，没有任何提示。被覆盖的可能
 * 是线上正在写的日志，也可能是没备份的配置。
 *
 * 交互约定：
 * - 只在真的重名时出现；无冲突的上传不经过这个对话框
 * - 给出三个真实选择：跳过 / 重命名 / 覆盖，而不是「确定/取消」
 * - 显示新旧大小，便于发现「传错了文件」
 * - 「全部覆盖」用危险样式 —— 它是破坏性操作
 */

export interface UploadConflictItem {
  /** 待上传文件名（可能含相对路径，如 dir/a.log） */
  name: string;
  /** 本地文件大小（字节） */
  incomingSize: number;
  /** 远端已存在文件大小（字节）；undefined 表示远端无同名文件 */
  existingSize?: number;
  /** 是否为冲突（远端已存在） */
  conflicted: boolean;
}

export type ConflictResolution = "skip" | "rename" | "overwrite";

interface UploadConflictDialogProps {
  visible: boolean;
  items: UploadConflictItem[];
  targetDirectory: string;
  formatBytes: (value: number) => string;
  onCancel: () => void;
  /** resolution 只作用于 conflicted 的项；无冲突项一律正常上传 */
  onConfirm: (options: {
    resolution: ConflictResolution;
    /** 逐文件覆盖：key = name，值 = 该文件单独选择的处理方式 */
    perFile?: Record<string, ConflictResolution>;
  }) => void;
}

export function UploadConflictDialog(props: UploadConflictDialogProps) {
  const { visible, items, targetDirectory, formatBytes, onCancel, onConfirm } = props;
  const [perFile, setPerFile] = useState<Record<string, ConflictResolution>>({});

  useEscapeToClose(visible, onCancel);

  const conflicted = useMemo(() => items.filter((item) => item.conflicted), [items]);
  const fresh = useMemo(() => items.filter((item) => !item.conflicted), [items]);
  const conflictCount = conflicted.length;

  if (!visible || conflictCount === 0) return null;

  const resolutionOf = (name: string): ConflictResolution => perFile[name] ?? "overwrite";
  const setResolution = (name: string, value: ConflictResolution) => {
    setPerFile((prev) => ({ ...prev, [name]: value }));
  };

  const setAll = (value: ConflictResolution) => {
    const next: Record<string, ConflictResolution> = {};
    for (const item of conflicted) next[item.name] = value;
    setPerFile(next);
  };

  return (
    <div className="ucd-scrim" role="dialog" aria-modal="true" aria-label="上传冲突确认">
      <div className="ucd-panel">
        <header className="ucd-head">
          <AlertTriangle size={15} strokeWidth={1.8} />
          <div>
            <strong>{conflictCount} 个文件已存在于目标目录</strong>
            <span>上传会覆盖目标文件。此操作不可撤销。</span>
          </div>
        </header>

        <div className="ucd-dir">
          <span className="ucd-dir-label">目标目录</span>
          <span className="ucd-dir-path">{targetDirectory}</span>
        </div>

        <div className="ucd-body">
          {conflicted.map((item) => (
            <div key={item.name} className="ucd-row">
              <FileWarning size={13} strokeWidth={1.8} className="ucd-ic ucd-ic-warn" />
              <div className="ucd-main">
                <span className="ucd-name" title={item.name}>{item.name}</span>
                <span className="ucd-size">
                  {formatBytes(item.existingSize ?? 0)} → {formatBytes(item.incomingSize)}
                </span>
              </div>
              <select
                className="ucd-select"
                value={resolutionOf(item.name)}
                onChange={(event) => setResolution(item.name, event.target.value as ConflictResolution)}
              >
                <option value="overwrite">覆盖</option>
                <option value="skip">跳过</option>
                <option value="rename">重命名</option>
              </select>
            </div>
          ))}

          {fresh.length > 0 ? (
            <div className="ucd-fresh">
              <FileUp size={12} strokeWidth={1.8} />
              <span>{fresh.length} 个新文件将正常上传</span>
            </div>
          ) : null}
        </div>

        <footer className="ucd-foot">
          <button type="button" className="ucd-link" onClick={() => setAll("skip")}>全部跳过</button>
          <button type="button" className="ucd-link" onClick={() => setAll("rename")}>全部重命名</button>
          <div style={{ flex: 1 }} />
          <button type="button" className="ghost-button" onClick={onCancel}>取消</button>
          <button
            type="button"
            className="primary-button"
            onClick={() => onConfirm({ resolution: "overwrite", perFile })}
          >
            继续上传
          </button>
        </footer>
      </div>
    </div>
  );
}
