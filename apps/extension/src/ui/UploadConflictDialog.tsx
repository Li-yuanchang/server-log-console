import { useMemo, useState } from "react";
import { AlertTriangle, Copy, FileUp, Replace, SkipForward } from "lucide-react";
import { ThemedSelect } from "./ThemedSelect.js";
import { useEscapeToClose } from "./useEscapeToClose.js";

/**
 * 上传冲突确认
 *
 * 背景：此前上传同名文件是**静默覆盖** —— 上传逻辑里没有任何存在性检查。
 * 拖一个 app.log 上去，远端同名文件直接消失，没有任何提示。
 *
 * 设计要点（2026-10-27 重做）：
 * 1. 下拉用项目自带的 ThemedSelect，不用原生 <select> —— 原生菜单在深色主题下
 *    是系统蓝白，与整体皮肤割裂，且无法 portal 定位、会被容器裁切。
 * 2. 每个冲突文件用「分段按钮」而不是下拉：一次只有三个互斥选项，
 *    平铺比"点开再选"少一次交互，也避免误点系统菜单。
 * 3. 信息层级：结论（几个冲突） → 目标目录（等宽、可复制） → 逐文件 → 操作。
 * 4. 「全部覆盖」是破坏性操作，用 danger 样式并与「取消」拉开距离。
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

export type ConflictResolution = "overwrite" | "skip" | "rename";

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

const RESOLUTION_LABEL: Record<ConflictResolution, string> = {
  overwrite: "覆盖",
  skip: "跳过",
  rename: "重命名"
};

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

  /* 汇总当前选择，让用户在点「继续上传」前就知道会删/改几个 */
  const summary = conflicted.reduce(
    (acc, item) => {
      acc[resolutionOf(item.name)] += 1;
      return acc;
    },
    { overwrite: 0, skip: 0, rename: 0 } as Record<ConflictResolution, number>
  );

  return (
    <div className="ucd-scrim" role="dialog" aria-modal="true" aria-label="上传冲突确认">
      <div className="ucd-panel">
        {/* ① 结论区：说清发生了什么、后果是什么 */}
        <header className="ucd-head">
          <span className="ucd-head-icon">
            <AlertTriangle size={16} strokeWidth={1.9} />
          </span>
          <div className="ucd-head-text">
            <strong>{conflictCount} 个文件已存在于目标目录</strong>
            <p>覆盖会永久替换远端文件，无法撤销。</p>
          </div>
        </header>

        {/* ② 目标目录：等宽 + 可复制（长路径常需要核对） */}
        <div className="ucd-dir">
          <span className="ucd-dir-label">目标目录</span>
          <span className="ucd-dir-path" title={targetDirectory}>{targetDirectory}</span>
          <button
            type="button"
            className="ucd-dir-copy"
            title="复制路径"
            onClick={() => {
              void navigator.clipboard?.writeText(targetDirectory).catch(() => {});
            }}
          >
            <Copy size={11} strokeWidth={1.8} />
          </button>
        </div>

        {/* ③ 逐文件：文件名 + 大小变化 + 三态分段按钮 */}
        <div className="ucd-body">
          {conflicted.map((item) => {
            const current = resolutionOf(item.name);
            const sameSize = item.existingSize === item.incomingSize;
            return (
              <div key={item.name} className={`ucd-row${current === "skip" ? " ucd-row-skip" : ""}`}>
                <div className="ucd-row-main">
                  <span className="ucd-name" title={item.name}>{item.name}</span>
                  <span className="ucd-size">
                    <span className="ucd-size-old">{formatBytes(item.existingSize ?? 0)}</span>
                    <span className="ucd-size-arrow">→</span>
                    <span className="ucd-size-new">{formatBytes(item.incomingSize)}</span>
                    {sameSize ? <span className="ucd-size-same">大小相同</span> : null}
                  </span>
                </div>

                {/* 用项目自带的 ThemedSelect（自绘菜单 + portal 定位），
                    不用原生 <select>：原生菜单在深色主题下是系统蓝白，与皮肤割裂，
                    且无法 portal、会被窄容器裁切。 */}
                <ThemedSelect
                  value={current}
                  ariaLabel={`${item.name} 的处理方式`}
                  options={[
                    { value: "overwrite", label: RESOLUTION_LABEL.overwrite },
                    { value: "skip", label: RESOLUTION_LABEL.skip },
                    { value: "rename", label: RESOLUTION_LABEL.rename }
                  ]}
                  onChange={(value) => setResolution(item.name, value)}
                  menuWidth={96}
                />
              </div>
            );
          })}

          {fresh.length > 0 ? (
            <div className="ucd-fresh">
              <FileUp size={12} strokeWidth={1.8} />
              <span>{fresh.length} 个新文件将正常上传，不受影响</span>
            </div>
          ) : null}
        </div>

        {/* ④ 操作区：批量预设放左，取消/确认放右，破坏性操作独立成色 */}
        <footer className="ucd-foot">
          <div className="ucd-bulk">
            <span className="ucd-bulk-label">全部</span>
            <button type="button" className="ucd-bulk-btn" onClick={() => setAll("skip")}>
              <SkipForward size={11} strokeWidth={1.9} />
              跳过
            </button>
            <button type="button" className="ucd-bulk-btn" onClick={() => setAll("rename")}>
              <Copy size={11} strokeWidth={1.9} />
              重命名
            </button>
            <button type="button" className="ucd-bulk-btn ucd-bulk-danger" onClick={() => setAll("overwrite")}>
              <Replace size={11} strokeWidth={1.9} />
              覆盖
            </button>
          </div>

          <div className="ucd-actions">
            <span className="ucd-actions-hint">
              覆盖 {summary.overwrite} · 重命名 {summary.rename} · 跳过 {summary.skip}
            </span>
            <button type="button" className="ghost-button" onClick={onCancel}>取消</button>
            <button
              type="button"
              className={`primary-button${summary.overwrite > 0 ? " ucd-confirm-danger" : ""}`}
              onClick={() => onConfirm({ resolution: "overwrite", perFile })}
            >
              继续上传
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
