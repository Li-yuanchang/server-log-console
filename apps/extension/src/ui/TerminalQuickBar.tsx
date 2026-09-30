import { useMemo } from "react";
import { Plus } from "lucide-react";
import { getShortcutCommandsForServer } from "./storage.js";

interface TerminalQuickBarProps {
  serverId: string;
  onExecute: (command: string) => void;
  onOpenManager: () => void;
}

/* S5 原型：快捷命令常驻终端底部一行（fchip 横排 + ＋ 管理），⌘/ 呼出完整管理面板 */
export function TerminalQuickBar(props: TerminalQuickBarProps) {
  const commands = useMemo(() => getShortcutCommandsForServer(props.serverId), [props.serverId]);
  const shown = commands.slice(0, 5);

  return (
    <div className="terminal-quick-bar" onMouseDown={(e) => e.stopPropagation()}>
      <span className="terminal-quick-bar-label">快捷命令</span>
      {shown.map((cmd) => (
        <button
          key={cmd.id}
          type="button"
          className="terminal-quick-chip"
          title={cmd.command}
          onClick={() => props.onExecute(cmd.command)}
        >
          {cmd.label}
        </button>
      ))}
      <button
        type="button"
        className="terminal-quick-chip terminal-quick-chip-add"
        title="管理快捷命令"
        onClick={props.onOpenManager}
      >
        <Plus size={11} />
      </button>
      <span className="terminal-quick-bar-spacer" />
      {/* 原型 S5 第 605 行：⌘/ 呼出 · 长按编辑 */}
      <span className="terminal-quick-bar-hint">⌘/ 呼出 · 长按编辑</span>
    </div>
  );
}
