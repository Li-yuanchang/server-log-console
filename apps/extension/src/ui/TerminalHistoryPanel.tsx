import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Star, History, Trash2, Search } from "lucide-react";
import {
  clearTerminalHistory,
  filterHistory,
  isDangerousCommand,
  readHistoryFavorites,
  readTerminalHistory,
  toggleHistoryFavorite,
  type TerminalHistoryEntry
} from "./useTerminalHistory.js";

/**
 * 终端命令历史面板（⌘R）
 *
 * 设计原则：
 * - Enter 只**填入**命令，不执行 —— 误按就把 `systemctl restart` 跑了太危险，
 *   执行必须 ⌘Enter 显式确认。
 * - 长命令单行省略 + title 悬停看全，保持列表扫描效率（不换行）。
 * - 危险命令标红，降低误选概率。
 * - 只读本地存储，不联网。
 */

interface TerminalHistoryPanelProps {
  open: boolean;
  serverId: string;
  serverLabel: string;
  onClose: () => void;
  /** 填入命令到终端（不执行） */
  onFill: (command: string) => void;
  /** 填入并执行 */
  onRun: (command: string) => void;
}

export function TerminalHistoryPanel(props: TerminalHistoryPanelProps) {
  const { open, serverId, serverLabel, onClose, onFill, onRun } = props;
  const [entries, setEntries] = useState<TerminalHistoryEntry[]>([]);
  const [favorites, setFavorites] = useState<string[]>([]);
  const [keyword, setKeyword] = useState("");
  const [onlyCurrentServer, setOnlyCurrentServer] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const listRef = useRef<HTMLDivElement | null>(null);

  const refresh = useCallback(() => {
    setEntries(readTerminalHistory());
    setFavorites(readHistoryFavorites());
  }, []);

  useEffect(() => {
    if (open) {
      refresh();
      setKeyword("");
      setActiveIndex(0);
    }
  }, [open, refresh]);

  const visible = useMemo(() => {
    const filtered = filterHistory(entries, {
      keyword,
      serverId: onlyCurrentServer ? serverId : undefined,
      favorites
    });
    /* 收藏置顶，其余按时间倒序（filterHistory 已按时间排好） */
    const favSet = new Set(favorites);
    const favEntries = filtered.filter((item) => favSet.has(item.command));
    const rest = filtered.filter((item) => !favSet.has(item.command));
    return [...favEntries, ...rest];
  }, [entries, keyword, onlyCurrentServer, serverId, favorites]);

  /* 面板打开时把焦点放到搜索框；Esc 由 useEscapeToClose 统一处理 */
  useEffect(() => {
    if (open) {
      setActiveIndex(0);
    }
  }, [open, keyword, onlyCurrentServer]);

  const handleKeyDown = useCallback((event: React.KeyboardEvent) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((i) => Math.min(visible.length - 1, i + 1));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((i) => Math.max(0, i - 1));
      return;
    }
    const target = visible[activeIndex];
    if (!target) return;
    if (event.key === "Enter") {
      event.preventDefault();
      /* ⌘/Ctrl + Enter = 直接执行；单独 Enter = 只填入 */
      if (event.metaKey || event.ctrlKey) {
        onRun(target.command);
      } else {
        onFill(target.command);
      }
      onClose();
      return;
    }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
      event.preventDefault();
      setFavorites(toggleHistoryFavorite(target.command));
    }
  }, [visible, activeIndex, onFill, onRun, onClose]);

  if (!open) return null;

  return (
    <div className="thp-panel" role="dialog" aria-label="命令历史" onKeyDown={handleKeyDown}>
      <header className="thp-head">
        <History size={13} strokeWidth={1.8} />
        <strong>命令历史</strong>
        <span className="thp-count">{visible.length} / {entries.length}</span>
        <div style={{ flex: 1 }} />
        <button
          type="button"
          className="thp-icon-btn"
          title="清空历史"
          onClick={() => {
            clearTerminalHistory();
            refresh();
          }}
        >
          <Trash2 size={12} strokeWidth={1.8} />
        </button>
        <button type="button" className="thp-icon-btn" title="关闭" onClick={onClose}>×</button>
      </header>

      <div className="thp-filters">
        <label className="thp-search">
          <Search size={11} strokeWidth={1.8} />
          <input
            autoFocus
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            placeholder="搜索命令…"
            className="thp-search-input"
          />
        </label>
        <button
          type="button"
          className={`thp-chip${onlyCurrentServer ? " on" : ""}`}
          onClick={() => setOnlyCurrentServer((v) => !v)}
          title={`仅显示 ${serverLabel} 上的命令`}
        >
          仅本机
        </button>
      </div>

      <div className="thp-list" ref={listRef}>
        {visible.length === 0 ? (
          <div className="thp-empty">
            {entries.length === 0
              ? "还没有命令记录。在终端里执行命令后会自动出现在这里。"
              : "没有匹配的命令。"}
          </div>
        ) : (
          visible.map((entry, index) => {
            const starred = favorites.includes(entry.command);
            const danger = isDangerousCommand(entry.command);
            return (
              <button
                type="button"
                key={entry.id}
                className={`thp-item${index === activeIndex ? " active" : ""}${danger ? " danger" : ""}`}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={(event) => {
                  if (event.metaKey || event.ctrlKey) {
                    onRun(entry.command);
                  } else {
                    onFill(entry.command);
                  }
                  onClose();
                }}
                title={entry.command}
              >
                <span
                  className={`thp-star${starred ? " on" : ""}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    setFavorites(toggleHistoryFavorite(entry.command));
                  }}
                  title={starred ? "取消收藏" : "收藏（⌘S）"}
                >
                  <Star size={11} strokeWidth={1.8} fill={starred ? "currentColor" : "none"} />
                </span>
                <span className="thp-cmd">{entry.command}</span>
                <span className="thp-meta">
                  {entry.count > 1 ? `×${entry.count} ` : ""}
                  {onlyCurrentServer ? "" : `${entry.serverLabel} · `}
                  {formatRelativeTime(entry.executedAt)}
                </span>
              </button>
            );
          })
        )}
      </div>

      <footer className="thp-foot">
        ↑↓ 选择 · Enter 填入（不执行）· ⌘Enter 执行 · ⌘S 收藏
      </footer>
    </div>
  );
}

/** 相对时间：刚刚 / N 分钟前 / N 小时前 / N 天前 / 日期 */
function formatRelativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp;
  if (diff < 60_000) return "刚刚";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)} 天前`;
  const d = new Date(timestamp);
  return `${d.getMonth() + 1}-${d.getDate()}`;
}
