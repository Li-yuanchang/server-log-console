import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { Plus, Pencil, Trash2, X, Check, Save, ChevronRight, TerminalSquare } from "lucide-react";
import type { ShortcutCommand } from "./storage.js";
import {
  getShortcutCommandsForServer,
  addShortcutCommand,
  updateShortcutCommand,
  deleteShortcutCommand,
} from "./storage.js";

interface TerminalShortcutsProps {
  serverId: string;
  serverLabel: string;
  onExecute: (command: string) => void;
  onClose: () => void;
}

interface PresetCommand {
  label: string;
  command: string;
}

const PRESET_COMMANDS: PresetCommand[] = [
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

export function TerminalShortcuts(props: TerminalShortcutsProps) {
  const [commands, setCommands] = useState<ShortcutCommand[]>(() =>
    getShortcutCommandsForServer(props.serverId)
  );
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [addLabel, setAddLabel] = useState("");
  const [addCommand, setAddCommand] = useState("");
  const [editLabel, setEditLabel] = useState("");
  const [editCommand, setEditCommand] = useState("");
  const panelRef = useRef<HTMLDivElement | null>(null);
  const addLabelRef = useRef<HTMLInputElement | null>(null);
  const editLabelRef = useRef<HTMLInputElement | null>(null);

  const refresh = useCallback(() => {
    setCommands(getShortcutCommandsForServer(props.serverId));
  }, [props.serverId]);

  useEffect(() => { refresh(); }, [props.serverId, refresh]);
  useEffect(() => { if (isAdding) addLabelRef.current?.focus(); }, [isAdding]);
  useEffect(() => { if (editingId) editLabelRef.current?.focus(); }, [editingId]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const panel = panelRef.current;
      const active = document.activeElement;
      if (!panel || !(active instanceof Node) || !panel.contains(active)) return;
      if (isAdding) { setIsAdding(false); setAddLabel(""); setAddCommand(""); }
      else if (editingId) { setEditingId(null); }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isAdding, editingId]);

  const savedCommandSet = useMemo(() => new Set(commands.map((c) => c.command)), [commands]);
  const visiblePresets = useMemo(() => PRESET_COMMANDS.filter((p) => !savedCommandSet.has(p.command)), [savedCommandSet]);

  function handleAdd() {
    if (!addLabel.trim() || !addCommand.trim()) return;
    addShortcutCommand(addLabel, addCommand, props.serverId);
    setAddLabel(""); setAddCommand(""); setIsAdding(false); refresh();
  }

  function handleExecute(command: string) {
    props.onExecute(command);
    props.onClose();
  }

  return (
    <div ref={panelRef} className="tsc-dropdown" onMouseDown={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()}>
      <div className="tsc-header">
        <div className="tsc-header-title">
          <TerminalSquare size={13} />
          <span>快捷命令</span>
          <span className="tsc-header-subtitle" title={props.serverLabel}>{props.serverLabel}</span>
        </div>
        <div className="tsc-header-actions">
          <button type="button" className="tsc-hdr-btn" title="关闭" onClick={props.onClose}>
            <X size={13} />
          </button>
        </div>
      </div>
      <div className="tsc-scroll">
        {commands.length > 0 && (
          <>
            <div className="tsc-section-label">我的命令</div>
            {commands.map((cmd) =>
              editingId === cmd.id ? (
                <div key={cmd.id} className="tsc-edit-row">
                  <input ref={editLabelRef} className="tsc-input" placeholder="名称" value={editLabel}
                    onChange={(e) => setEditLabel(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") { updateShortcutCommand(editingId, { label: editLabel, command: editCommand }); setEditingId(null); refresh(); } }} />
                  <input className="tsc-input tsc-input-mono" placeholder="命令" value={editCommand}
                    onChange={(e) => setEditCommand(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") { updateShortcutCommand(editingId, { label: editLabel, command: editCommand }); setEditingId(null); refresh(); } }} />
                  <button type="button" className="tsc-btn tsc-btn-ok" onClick={() => { updateShortcutCommand(editingId, { label: editLabel, command: editCommand }); setEditingId(null); refresh(); }}
                    disabled={!editLabel.trim() || !editCommand.trim()}><Check size={12} /></button>
                  <button type="button" className="tsc-btn" onClick={() => setEditingId(null)}><X size={12} /></button>
                </div>
              ) : (
                <div key={cmd.id} className="tsc-row" title={cmd.command} onClick={() => handleExecute(cmd.command)}>
                  <ChevronRight size={11} className="tsc-row-arrow" />
                  <span className="tsc-row-label">{cmd.label}</span>
                  <code className="tsc-row-cmd">{cmd.command}</code>
                  <span className="tsc-row-actions" onClick={(e) => e.stopPropagation()}>
                    <button type="button" className="tsc-btn" title="编辑" onClick={() => { setEditingId(cmd.id); setEditLabel(cmd.label); setEditCommand(cmd.command); setIsAdding(false); }}><Pencil size={11} /></button>
                    <button type="button" className="tsc-btn tsc-btn-del" title="删除" onClick={() => { deleteShortcutCommand(cmd.id); if (editingId === cmd.id) setEditingId(null); refresh(); }}><Trash2 size={11} /></button>
                  </span>
                </div>
              )
            )}
          </>
        )}

        {visiblePresets.length > 0 && (
          <>
            <div className="tsc-section-label">常用命令</div>
            {visiblePresets.map((p) => (
              <div key={p.command} className="tsc-row" title={p.command} onClick={() => handleExecute(p.command)}>
                <ChevronRight size={11} className="tsc-row-arrow" />
                <span className="tsc-row-label">{p.label}</span>
                <code className="tsc-row-cmd">{p.command}</code>
                <span className="tsc-row-actions" onClick={(e) => e.stopPropagation()}>
                  <button type="button" className="tsc-btn" title="保存到我的命令" onClick={() => { addShortcutCommand(p.label, p.command, props.serverId); refresh(); }}><Save size={11} /></button>
                </span>
              </div>
            ))}
          </>
        )}
      </div>

      {isAdding ? (
        <div className="tsc-add-form">
          <input ref={addLabelRef} className="tsc-input" placeholder="名称" value={addLabel}
            onChange={(e) => setAddLabel(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") handleAdd(); }} />
          <input className="tsc-input tsc-input-mono" placeholder="命令" value={addCommand}
            onChange={(e) => setAddCommand(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") handleAdd(); }} />
          <button type="button" className="tsc-btn tsc-btn-ok" disabled={!addLabel.trim() || !addCommand.trim()} onClick={handleAdd}><Check size={12} /></button>
          <button type="button" className="tsc-btn" onClick={() => { setIsAdding(false); setAddLabel(""); setAddCommand(""); }}><X size={12} /></button>
        </div>
      ) : (
        <button type="button" className="tsc-add-trigger" onClick={() => { setIsAdding(true); setEditingId(null); }}>
          <Plus size={12} /> 自定义命令
        </button>
      )}
    </div>
  );
}
