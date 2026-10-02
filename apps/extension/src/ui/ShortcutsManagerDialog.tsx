import { useCallback, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { createPortal } from "react-dom";
import { Check, GripVertical, Pencil, Plus, RotateCcw, Trash2, X } from "lucide-react";
import { useEscapeToClose } from "./useEscapeToClose.js";

/* 对应原型 T1/T10：快捷命令管理对话框（常规 CRUD + HTML5 拖拽排序 + 预设徽标/恢复预设 + {CWD} 变量）。

   存储说明：沿用 storage.ts 的 localStorage 键「server-log-console:shortcut-commands」与
   ShortcutCommand 数据结构（键名不改，兼容既有用户数据）；读写在本文件独立实现，
   不复用 storage.ts 的函数。键不存在（首次使用）时回退展示 12 条内置预设，
   不落盘，直到用户首次修改。 */

export const SHORTCUT_COMMANDS_STORAGE_KEY = "server-log-console:shortcut-commands";
const SHORTCUT_COMMANDS_MAX = 200;

export interface ShortcutCommand {
  id: string;
  label: string;
  command: string;
  serverId: string;
  createdAt: string;
  updatedAt: string;
}

/* 12 条内置预设（原 TerminalShortcuts 侧板的预设清单，侧板废弃后预设唯一源头收敛到本文件） */
const PRESET_COMMANDS: Array<{ label: string; command: string }> = [
  { label: "实时日志", command: "tail -f /var/log/syslog" },
  { label: "最近100行日志", command: "tail -n 100 /var/log/syslog" },
  { label: "搜索错误日志", command: "grep -i 'error\\|exception\\|fail' /var/log/syslog | tail -50" },
  { label: "查看磁盘空间", command: "df -h" },
  { label: "查看内存", command: "free -m" },
  { label: "进程监控", command: "top -bn1 | head -20" },
  { label: "查看端口", command: "ss -tlnp" },
  { label: "网络连接统计", command: "ss -s" },
  { label: "Java 进程", command: "ps aux | grep java | grep -v grep" },
  { label: "系统信息", command: "uname -a && cat /etc/os-release 2>/dev/null | head -5" },
  { label: "目录占用排序", command: "du -sh * 2>/dev/null | sort -rh | head -15" },
  { label: "最近修改文件", command: "find . -type f -mmin -30 -ls 2>/dev/null | head -20" },
];

const presetCommandSet = new Set(PRESET_COMMANDS.map((preset) => preset.command));

/** 该命令是否属于内置预设（用于列表行的「预设」徽标） */
export function isPresetCommand(command: string): boolean {
  return presetCommandSet.has(command);
}

/** {CWD} → cwd || "/"（命令中可写 {CWD}，执行/填入前展开为当前工作目录） */
export function expandShortcutCwd(command: string, cwd?: string): string {
  return command.replace(/\{CWD\}/g, cwd || "/");
}

function generateId(): string {
  return globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function toPresetEntry(preset: { label: string; command: string }, index: number): ShortcutCommand {
  return {
    id: `preset-${index + 1}`,
    label: preset.label,
    command: preset.command,
    serverId: "",
    createdAt: "",
    updatedAt: "",
  };
}

function normalizeShortcutCommand(value: unknown): ShortcutCommand | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const entry = value as Partial<ShortcutCommand>;
  if (typeof entry.id !== "string" || typeof entry.label !== "string" || typeof entry.command !== "string") {
    return null;
  }
  return {
    id: entry.id,
    label: entry.label,
    command: entry.command,
    serverId: typeof entry.serverId === "string" ? entry.serverId : "",
    createdAt: typeof entry.createdAt === "string" ? entry.createdAt : "",
    updatedAt: typeof entry.updatedAt === "string" ? entry.updatedAt : "",
  };
}

/** 读取命令列表；键不存在时回退为 12 条预设（兼容 storage.ts「无数据给默认」的行为） */
export function readShortcutCommands(): ShortcutCommand[] {
  try {
    const raw = globalThis.localStorage?.getItem(SHORTCUT_COMMANDS_STORAGE_KEY);
    if (!raw) {
      return PRESET_COMMANDS.map(toPresetEntry);
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .map((entry) => normalizeShortcutCommand(entry))
      .filter((entry): entry is ShortcutCommand => Boolean(entry))
      .slice(0, SHORTCUT_COMMANDS_MAX);
  } catch {
    return [];
  }
}

/* 同一窗口内写 localStorage 不会触发 storage 事件（该事件只派发给其他文档），
   写完后手动补发一个同名事件，TerminalQuickBar / 本对话框 / 其他窗口靠它即时同步。 */
function notifyShortcutCommandsChanged() {
  try {
    window.dispatchEvent(new StorageEvent("storage", { key: SHORTCUT_COMMANDS_STORAGE_KEY }));
  } catch {
    return;
  }
}

/** 写入整表并广播变更（对话框与快捷条共用；数组按 SHORTCUT_COMMANDS_MAX 截断） */
export function persistShortcutCommands(commands: ShortcutCommand[]) {
  try {
    globalThis.localStorage?.setItem(
      SHORTCUT_COMMANDS_STORAGE_KEY,
      JSON.stringify(commands.slice(0, SHORTCUT_COMMANDS_MAX)),
    );
  } catch {
    return;
  }
  notifyShortcutCommandsChanged();
}

export function updateShortcutCommand(id: string, updates: { label?: string; command?: string }): ShortcutCommand | null {
  const current = readShortcutCommands();
  const index = current.findIndex((entry) => entry.id === id);
  if (index < 0) {
    return null;
  }
  const entry = { ...current[index] };
  if (updates.label !== undefined) {
    entry.label = updates.label.trim();
  }
  if (updates.command !== undefined) {
    entry.command = updates.command;
  }
  entry.updatedAt = new Date().toISOString();
  const next = current.slice();
  next[index] = entry;
  persistShortcutCommands(next);
  return entry;
}

export function deleteShortcutCommand(id: string) {
  persistShortcutCommands(readShortcutCommands().filter((entry) => entry.id !== id));
}

/** 恢复预设：返回 12 条预设条目（落盘交给 persistShortcutCommands，由调用方一并同步 state） */
export function buildPresetShortcutCommands(): ShortcutCommand[] {
  return PRESET_COMMANDS.map(toPresetEntry);
}

interface ShortcutsManagerDialogProps {
  open: boolean;
  cwd?: string;
  onClose: () => void;
}

/* 行内「新增」的哨兵 id（区别于真实条目 id） */
const EDIT_NEW = "new";

export function ShortcutsManagerDialog({ open, cwd, onClose }: ShortcutsManagerDialogProps) {
  const [commands, setCommands] = useState<ShortcutCommand[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftLabel, setDraftLabel] = useState("");
  const [draftCommand, setDraftCommand] = useState("");
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);
  const labelInputRef = useRef<HTMLInputElement | null>(null);

  const refresh = useCallback(() => {
    setCommands(readShortcutCommands());
  }, []);

  /* 打开时拉最新数据；关闭时清理临时态 */
  useEffect(() => {
    if (open) {
      refresh();
    } else {
      setEditingId(null);
      setDragIndex(null);
      setOverIndex(null);
    }
  }, [open, refresh]);

  /* 与快捷条 / 其他窗口同步：写方写入后会派发同名 storage 事件 */
  useEffect(() => {
    if (!open) return;
    const onStorage = (event: StorageEvent) => {
      if (!event.key || event.key === SHORTCUT_COMMANDS_STORAGE_KEY) {
        refresh();
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [open, refresh]);

  useEffect(() => {
    if (open && editingId) {
      labelInputRef.current?.focus();
    }
  }, [open, editingId]);

  /* Esc：先退出行内编辑，再关闭对话框（走全局 Esc 栈，避免与其他弹层抢键） */
  useEscapeToClose(open, () => {
    if (editingId) {
      setEditingId(null);
      return;
    }
    onClose();
  });

  function applyCommands(next: ShortcutCommand[]) {
    setCommands(next);
    persistShortcutCommands(next);
  }

  function beginEdit(cmd: ShortcutCommand) {
    setEditingId(cmd.id);
    setDraftLabel(cmd.label);
    setDraftCommand(cmd.command);
  }

  function beginAdd() {
    setEditingId(EDIT_NEW);
    setDraftLabel("");
    setDraftCommand("");
  }

  function cancelEdit() {
    setEditingId(null);
    setDraftLabel("");
    setDraftCommand("");
  }

  function commitEdit() {
    if (!draftLabel.trim() || !draftCommand.trim()) return;
    const now = new Date().toISOString();
    if (editingId === EDIT_NEW) {
      applyCommands([
        ...commands,
        { id: generateId(), label: draftLabel.trim(), command: draftCommand, serverId: "", createdAt: now, updatedAt: now },
      ]);
    } else if (editingId) {
      applyCommands(
        commands.map((cmd) =>
          cmd.id === editingId ? { ...cmd, label: draftLabel.trim(), command: draftCommand, updatedAt: now } : cmd,
        ),
      );
    }
    cancelEdit();
  }

  function handleDelete(cmd: ShortcutCommand) {
    if (editingId === cmd.id) {
      cancelEdit();
    }
    applyCommands(commands.filter((entry) => entry.id !== cmd.id));
  }

  function handleDrop(targetIndex: number) {
    const from = dragIndex;
    setDragIndex(null);
    setOverIndex(null);
    if (from === null || from === targetIndex) return;
    const next = commands.slice();
    const moved = next.splice(from, 1)[0];
    if (!moved) return;
    next.splice(targetIndex, 0, moved);
    applyCommands(next);
  }

  function handleOverlayMouseDown(event: ReactMouseEvent<HTMLDivElement>) {
    if (event.target === event.currentTarget) {
      onClose();
    }
  }

  if (!open) return null;

  /* portal 进 .app-shell：主题 token 挂在该容器上（同 ImmediateTooltip 的处理），body 直挂拿不到变量 */
  const portalTarget = (document.querySelector(".app-shell") as HTMLElement | null) ?? document.body;

  const renderEditor = (keyValue: string) => (
    <div key={keyValue} className="shortcuts-dialog-editor">
      <input
        ref={labelInputRef}
        className="shortcuts-dialog-input"
        placeholder="名称"
        value={draftLabel}
        onChange={(event) => setDraftLabel(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") commitEdit();
        }}
      />
      <input
        className="shortcuts-dialog-input shortcuts-dialog-input-mono"
        placeholder="命令，支持 {CWD}"
        title={draftCommand ? expandShortcutCwd(draftCommand, cwd) : undefined}
        value={draftCommand}
        onChange={(event) => setDraftCommand(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") commitEdit();
        }}
      />
      <button
        type="button"
        className="shortcuts-dialog-icon-btn"
        title="保存"
        disabled={!draftLabel.trim() || !draftCommand.trim()}
        onClick={commitEdit}
      >
        <Check size={13} />
      </button>
      <button type="button" className="shortcuts-dialog-icon-btn" title="取消" onClick={cancelEdit}>
        <X size={13} />
      </button>
    </div>
  );

  return createPortal(
    <div className="shortcuts-dialog-overlay" onMouseDown={handleOverlayMouseDown}>
      <div
        className="shortcuts-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="快捷命令管理"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="shortcuts-dialog-head">
          <span className="shortcuts-dialog-title">快捷命令管理</span>
          <button type="button" className="shortcuts-dialog-icon-btn" title="关闭" onClick={onClose}>
            <X size={14} />
          </button>
        </div>
        <div className="shortcuts-dialog-list">
          {editingId === EDIT_NEW ? renderEditor("new-row") : null}
          {commands.map((cmd, index) =>
            editingId === cmd.id ? (
              renderEditor(cmd.id)
            ) : (
              <div
                key={cmd.id}
                className={[
                  "shortcuts-dialog-row",
                  dragIndex === index ? "shortcuts-dialog-row-dragging" : "",
                  dragIndex !== null && overIndex === index && dragIndex !== index ? "shortcuts-dialog-row-drop" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                draggable
                onDragStart={(event) => {
                  setDragIndex(index);
                  event.dataTransfer.effectAllowed = "move";
                  event.dataTransfer.setData("text/plain", String(index));
                }}
                onDragOver={(event) => {
                  event.preventDefault();
                  event.dataTransfer.dropEffect = "move";
                  if (overIndex !== index) setOverIndex(index);
                }}
                onDragEnd={() => {
                  setDragIndex(null);
                  setOverIndex(null);
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  handleDrop(index);
                }}
              >
                <GripVertical size={13} className="shortcuts-dialog-grip" />
                <span className="shortcuts-dialog-name" title={cmd.label}>
                  {cmd.label}
                </span>
                {isPresetCommand(cmd.command) ? <span className="shortcuts-dialog-badge">预设</span> : null}
                <code className="shortcuts-dialog-cmd" title={expandShortcutCwd(cmd.command, cwd)}>
                  {cmd.command}
                </code>
                <span className="shortcuts-dialog-row-actions">
                  <button type="button" className="shortcuts-dialog-icon-btn" title="编辑" onClick={() => beginEdit(cmd)}>
                    <Pencil size={12} />
                  </button>
                  <button
                    type="button"
                    className="shortcuts-dialog-icon-btn shortcuts-dialog-icon-btn-danger"
                    title="删除"
                    onClick={() => handleDelete(cmd)}
                  >
                    <Trash2 size={12} />
                  </button>
                </span>
              </div>
            ),
          )}
          {commands.length === 0 && editingId !== EDIT_NEW ? (
            <div className="shortcuts-dialog-empty">暂无命令，点击下方「新增命令」添加</div>
          ) : null}
        </div>
        <div className="shortcuts-dialog-foot">
          <button type="button" className="shortcuts-dialog-btn" onClick={beginAdd}>
            <Plus size={12} />
            新增命令
          </button>
          <button
            type="button"
            className="shortcuts-dialog-btn"
            title="重置为 12 条内置预设"
            onClick={() => applyCommands(buildPresetShortcutCommands())}
          >
            <RotateCcw size={12} />
            恢复预设
          </button>
          <span className="shortcuts-dialog-foot-hint">拖拽排序 · 命令支持 {"{CWD}"} 变量</span>
          <button type="button" className="shortcuts-dialog-btn shortcuts-dialog-btn-primary" onClick={onClose}>
            完成
          </button>
        </div>
      </div>
    </div>,
    portalTarget,
  );
}
