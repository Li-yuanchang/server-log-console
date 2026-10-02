import type { KeyboardEvent } from "react";
import { ChevronDown, ChevronUp, Search, X } from "lucide-react";
import type { TerminalSearchState } from "./useTerminalSearch.js";

/** 终端悬浮查找条 props：useTerminalSearch 的返回值 + 可选的 input 键盘事件透传 */
interface TerminalFindBarProps {
  search: TerminalSearchState;
  /** 透传 input 的 onKeyDown（Esc/Enter/Shift+Enter 已在组件内处理，仍会继续回调） */
  onInputKeyDown?: (e: KeyboardEvent<HTMLInputElement>) => void;
}

/** 终端悬浮查找条（对应原型 T3 悬浮查找条）：右上角白底浮层，样式见 align-s5-terminal.css 末节 */
export function TerminalFindBar({ search, onInputKeyDown }: TerminalFindBarProps) {
  // 无命中时显示 0/0；index 为 -1（超出高亮上限）时按 0 显示
  const countText = search.total > 0 ? `${search.index + 1}/${search.total}` : "0/0";

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      search.close();
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      if (e.shiftKey) search.prev();
      else search.next();
    }
    onInputKeyDown?.(e);
  };

  return (
    <div className="terminal-findbar" role="search">
      <Search size={13} className="terminal-findbar-icon" aria-hidden />
      <input
        className="terminal-findbar-input"
        type="text"
        placeholder="在终端中查找"
        value={search.query}
        onChange={(e) => search.setQuery(e.target.value)}
        onKeyDown={handleKeyDown}
        autoFocus
        spellCheck={false}
      />
      <span className="terminal-findbar-count">{countText}</span>
      <button
        type="button"
        className="terminal-findbar-btn"
        title="上一个（Shift+Enter）"
        onClick={search.prev}
      >
        <ChevronUp size={13} />
      </button>
      <button
        type="button"
        className="terminal-findbar-btn"
        title="下一个（Enter）"
        onClick={search.next}
      >
        <ChevronDown size={13} />
      </button>
      <button
        type="button"
        className={`terminal-findbar-toggle${search.caseSensitive ? " terminal-findbar-toggle-on" : ""}`}
        title="区分大小写"
        aria-pressed={search.caseSensitive}
        onClick={search.toggleCase}
      >
        Aa
      </button>
      <button
        type="button"
        className={`terminal-findbar-toggle${search.regex ? " terminal-findbar-toggle-on" : ""}`}
        title="正则表达式"
        aria-pressed={search.regex}
        onClick={search.toggleRegex}
      >
        .*
      </button>
      <button
        type="button"
        className="terminal-findbar-btn"
        title="关闭（Esc）"
        onClick={search.close}
      >
        <X size={13} />
      </button>
    </div>
  );
}
