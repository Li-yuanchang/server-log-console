import { useCallback, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { Plus } from "lucide-react";
import {
  SHORTCUT_COMMANDS_STORAGE_KEY,
  deleteShortcutCommand,
  expandShortcutCwd,
  readShortcutCommands,
  updateShortcutCommand,
  type ShortcutCommand,
} from "./ShortcutsManagerDialog.js";

/* 对应原型 T9/T10（旧版假提示已随重设计废除，原型 605 行）：
   底部快捷命令行随 open 开关（false 时整行不渲染）。
   chip 交互：单击 = 发送执行（补 "\n"）；⌘+单击 = 仅填入不执行（不补 "\n"）；
   右键 = 就地小菜单（发送并执行 / 仅填入不执行 / —sep— / 编辑… / 删除）。
   「管理」chip 触发 onManage 打开 ShortcutsManagerDialog。
   命令列表读写 localStorage（键与结构见 ShortcutsManagerDialog.tsx），
   组件内 useState 持列表并监听 storage 事件与管理对话框同步。 */

interface TerminalQuickBarProps {
  open: boolean; // false 时返回 null
  cwd?: string; // {CWD} 展开来源
  onExecute: (command: string) => void; // 已展开 {CWD} 的最终命令（是否补 "\n" 由本组件决定：执行补、仅填入不补）
  onManage: () => void; // 打开管理对话框
}

interface QuickMenuState {
  chipId: string;
  left: number;
}

export function TerminalQuickBar(props: TerminalQuickBarProps) {
  const { open, cwd, onExecute, onManage } = props;
  const [commands, setCommands] = useState<ShortcutCommand[]>(() => readShortcutCommands());
  const [menu, setMenu] = useState<QuickMenuState | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const barRef = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const editInputRef = useRef<HTMLInputElement | null>(null);

  const refresh = useCallback(() => {
    setCommands(readShortcutCommands());
  }, []);

  /* 与管理对话框 / 其他窗口同步：同一窗口内写 localStorage 不会自然触发 storage 事件，
     写方（本组件与对话框）写入后会手动补发同名事件；跨窗口由真实 storage 事件驱动。 */
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (!event.key || event.key === SHORTCUT_COMMANDS_STORAGE_KEY) {
        refresh();
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [refresh]);

  /* 右键菜单：点外面 / Esc 关闭（菜单内部点击不关，交给菜单项自身处理） */
  useEffect(() => {
    if (!menu) return;
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && menuRef.current?.contains(event.target)) return;
      setMenu(null);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenu(null);
    };
    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [menu]);

  /* 就地编辑输入框：出现即聚焦并全选 */
  useEffect(() => {
    if (!editingId) return;
    editInputRef.current?.focus();
    editInputRef.current?.select();
  }, [editingId]);

  if (!open) return null;

  const run = (command: string, withNewline: boolean) => {
    const finalCommand = expandShortcutCwd(command, cwd);
    onExecute(withNewline ? `${finalCommand}\n` : finalCommand);
  };

  const openMenuFor = (event: ReactMouseEvent<HTMLButtonElement>, chipId: string) => {
    event.preventDefault();
    const bar = barRef.current;
    const chip = event.currentTarget;
    // 菜单贴着 chip 弹出；太靠右时往里收，避免出屏（菜单最小宽约 148px）
    const left = bar ? Math.min(chip.offsetLeft, Math.max(bar.clientWidth - 148, 0)) : chip.offsetLeft;
    setMenu({ chipId, left });
  };

  /* 就地编辑取舍：chip 空间有限，只编辑命令本体、名称沿用原值（改名走「管理」对话框的双输入框） */
  const commitChipEdit = () => {
    const id = editingId;
    const draft = editDraft.trim();
    setEditingId(null);
    setEditDraft("");
    if (!id || !draft) return;
    updateShortcutCommand(id, { command: draft });
    refresh();
  };

  const menuCommand = menu ? commands.find((cmd) => cmd.id === menu.chipId) : undefined;

  return (
    <div ref={barRef} className="terminal-qbar" onMouseDown={(event) => event.stopPropagation()}>
      <span className="terminal-qbar-label">快捷命令</span>
      <div className="terminal-qbar-chips">
        {commands.map((cmd) =>
          editingId === cmd.id ? (
            <input
              key={cmd.id}
              ref={editInputRef}
              className="terminal-qbar-edit-input"
              value={editDraft}
              placeholder="编辑命令"
              title="Enter 确认 · Esc 取消"
              onChange={(event) => setEditDraft(event.target.value)}
              onBlur={commitChipEdit}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  commitChipEdit();
                } else if (event.key === "Escape") {
                  setEditingId(null);
                  setEditDraft("");
                }
              }}
            />
          ) : (
            <button
              key={cmd.id}
              type="button"
              className="terminal-qbar-chip"
              title={expandShortcutCwd(cmd.command, cwd)}
              onClick={(event) => run(cmd.command, !event.metaKey)}
              onContextMenu={(event) => openMenuFor(event, cmd.id)}
            >
              {cmd.label}
            </button>
          ),
        )}
        <button type="button" className="terminal-qbar-chip terminal-qbar-chip-add" title="管理快捷命令" onClick={onManage}>
          <Plus size={11} />
          管理
        </button>
      </div>
      <span className="terminal-qbar-hint">单击发送 · ⌘点仅填入 · 右键编辑</span>
      {menu && menuCommand ? (
        <div
          ref={menuRef}
          className="terminal-qbar-menu"
          style={{ left: menu.left }}
          onContextMenu={(event) => event.preventDefault()}
        >
          <button
            type="button"
            className="terminal-qbar-menu-item"
            onClick={() => {
              run(menuCommand.command, true);
              setMenu(null);
            }}
          >
            发送并执行
          </button>
          <button
            type="button"
            className="terminal-qbar-menu-item"
            onClick={() => {
              run(menuCommand.command, false);
              setMenu(null);
            }}
          >
            仅填入不执行
          </button>
          <div className="terminal-qbar-menu-sep" />
          <button
            type="button"
            className="terminal-qbar-menu-item"
            onClick={() => {
              setEditingId(menuCommand.id);
              setEditDraft(menuCommand.command);
              setMenu(null);
            }}
          >
            编辑…
          </button>
          <button
            type="button"
            className="terminal-qbar-menu-item terminal-qbar-menu-item-danger"
            onClick={() => {
              deleteShortcutCommand(menuCommand.id);
              refresh();
              setMenu(null);
            }}
          >
            删除
          </button>
        </div>
      ) : null}
    </div>
  );
}
