import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Command as CommandIcon, FileText, Folder, Plug, Terminal, Zap } from "lucide-react";

export type PaletteCommand = {
  id: string;
  group: string;
  icon: "folder" | "file" | "zap" | "gear" | "term" | "plug";
  title: string;
  sub?: string;
  hint?: string;
  run: () => void;
};

const ICONS = {
  folder: Folder,
  file: FileText,
  zap: Zap,
  gear: CommandIcon,
  term: Terminal,
  plug: Plug,
};

// ⌘K 命令面板：服务器 / 命令统一入口（非模态遮罩层，Esc/点击遮罩关闭）
export function CommandPalette(props: { open: boolean; onClose: () => void; commands: PaletteCommand[] }) {
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (props.open) {
      setQuery("");
      setIndex(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [props.open]);

  const filtered = useMemo(() => {
    const kw = query.trim().toLowerCase();
    if (!kw) return props.commands;
    return props.commands.filter((c) => `${c.title} ${c.sub || ""}`.toLowerCase().includes(kw));
  }, [props.commands, query]);

  useEffect(() => {
    setIndex((current) => Math.min(current, Math.max(0, filtered.length - 1)));
  }, [filtered.length]);

  if (!props.open) return null;

  let lastGroup = "";
  return createPortal(
    <div className="palette-overlay" role="presentation" onClick={props.onClose}>
      <div className="palette-box" role="dialog" aria-label="命令面板" onClick={(e) => e.stopPropagation()}>
        <div className="palette-input-row">
          <CommandIcon size={15} strokeWidth={1.8} />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                props.onClose();
              } else if (event.key === "ArrowDown") {
                event.preventDefault();
                setIndex((v) => Math.min(v + 1, filtered.length - 1));
              } else if (event.key === "ArrowUp") {
                event.preventDefault();
                setIndex((v) => Math.max(v - 1, 0));
              } else if (event.key === "Enter") {
                event.preventDefault();
                filtered[index]?.run();
              }
            }}
            placeholder="搜索服务器、文件、命令…"
          />
        </div>
        <div className="palette-list">
          {filtered.length === 0 ? <div className="palette-empty">没有匹配项</div> : null}
          {filtered.map((command, i) => {
            const showGroup = command.group !== lastGroup;
            lastGroup = command.group;
            const Icon = ICONS[command.icon];
            return (
              <div key={command.id}>
                {showGroup ? <div className="palette-cap">{command.group}</div> : null}
                <button
                  type="button"
                  className={`palette-item${i === index ? " palette-item-sel" : ""}`}
                  onMouseEnter={() => setIndex(i)}
                  onClick={() => command.run()}
                >
                  <Icon size={14} strokeWidth={1.7} />
                  <span className="palette-item-title">
                    {command.title}
                    {command.sub ? <span className="palette-item-sub"> {command.sub}</span> : null}
                  </span>
                  {command.hint ? <span className="palette-item-hint">{command.hint}</span> : null}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>,
    document.body
  );
}
