import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Terminal } from "@xterm/xterm";
import { SearchAddon } from "@xterm/addon-search";
import type { ISearchOptions } from "@xterm/addon-search";

/**
 * useTerminalSearch —— 终端查找 hook（对应原型 T3 悬浮查找条）
 *
 * 封装 @xterm/addon-search 的 SearchAddon：
 * - addon 惰性创建并 attach（首次 open()/next()/prev() 时才 new）；
 *   terminal 实例变化（重连/新建会话）时旧实例 dispose、下次查找时重建；
 * - query / caseSensitive / regex / decorations 任一变化即 findNext；
 * - 回车 / Shift+回车 的键盘绑定不在此处，交给组件层（TerminalFindBar）。
 */

/** xterm 的命中高亮是 canvas 绘制，取不到 CSS 变量，这里用与主题 token 同源的字面色：
    --accent(#0070f3) 蓝系；活动命中在标尺上用琥珀色（--amber 的高亮变体）以便区分。 */
const SEARCH_DECORATIONS = {
  matchBackground: "#103a66",
  matchOverviewRuler: "#0070f3",
  activeMatchBackground: "#0d5bb8",
  activeMatchColorOverviewRuler: "#f59e0b",
};

export interface TerminalSearchState {
  isOpen: boolean;
  open: () => void;
  close: () => void;
  query: string;
  setQuery: (q: string) => void;
  /** 当前命中序号（0 基；-1 = 无命中或超出高亮上限），total 为命中总数（0 时组件显示 0/0） */
  index: number;
  total: number;
  next: () => void;
  prev: () => void;
  caseSensitive: boolean;
  toggleCase: () => void;
  regex: boolean;
  toggleRegex: () => void;
  /** 命中高亮（all 高亮 + 标尺标记），默认开 */
  decorations: boolean;
}

/** 查找核心调用（addon findNext/prev/decorations 等）不崩页面：PiP 搬迁 / 会话重建窗口期
    xterm 实例可能瞬时失效，addon 内部直接摸 DOM 会抛错。失败静默降级——最多丢一次高亮，不白屏。 */
function safeSearchCall(action: () => void): void {
  try {
    action();
  } catch (error) {
    /* 不崩页面，但留痕可查（此前完全静默导致 0/0 问题无从诊断） */
    console.debug("[terminal-search] 查找调用失败（已忽略）:", error instanceof Error ? error.message : error);
  }
}

export function useTerminalSearch(terminal: Terminal | null): TerminalSearchState {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [regex, setRegex] = useState(false);
  // 命中高亮固定开启；保留为值以便后续接入开关（hook 返回值需要该字段）
  const decorations = true;
  const [index, setIndex] = useState(-1);
  const [total, setTotal] = useState(0);
  // addon 放进 state，创建/重建后触发下方 findNext 副作用
  const [addon, setAddon] = useState<SearchAddon | null>(null);

  const addonRef = useRef<SearchAddon | null>(null);
  const attachedTerminalRef = useRef<Terminal | null>(null);
  const isOpenRef = useRef(isOpen);
  isOpenRef.current = isOpen;

  /** 新建 addon 并 attach 到 terminal（调用方负责先 dispose 旧实例） */
  const createAddon = useCallback((term: Terminal): SearchAddon => {
    const created = new SearchAddon();
    term.loadAddon(created);
    // addon-search 0.16.0 提供 onDidChangeResults（仅 decorations 开启时触发）；
    // resultIndex 为 0 基、超出 highlightLimit(1000) 时为 -1，正好映射到 0/0 或 0/N 显示。
    created.onDidChangeResults((e) => {
      setIndex(e.resultIndex);
      setTotal(e.resultCount);
    });
    addonRef.current = created;
    attachedTerminalRef.current = term;
    return created;
  }, []);

  // terminal 实例变化：旧实例 dispose，若查找条已打开则立即重建
  useEffect(() => {
    if (addonRef.current) {
      safeSearchCall(() => addonRef.current?.dispose());
      addonRef.current = null;
      attachedTerminalRef.current = null;
      setAddon(null);
      setIndex(-1);
      setTotal(0);
    }
    if (terminal && isOpenRef.current) {
      let created: SearchAddon | null = null;
      try {
        created = createAddon(terminal);
      } catch {
        /* 挂载失败静默：下次查找时重建 */
      }
      setAddon(created);
    }
  }, [terminal, createAddon]);

  const ensureAddon = useCallback((): SearchAddon | null => {
    if (!terminal) return null;
    if (addonRef.current && attachedTerminalRef.current === terminal) return addonRef.current;
    return createAddon(terminal);
  }, [terminal, createAddon]);

  const searchOptions = useMemo<ISearchOptions>(
    () => ({ regex, caseSensitive, decorations: decorations ? SEARCH_DECORATIONS : undefined }),
    [regex, caseSensitive, decorations],
  );

  const open = useCallback(() => {
    let ready: SearchAddon | null = null;
    try {
      ready = ensureAddon();
    } catch {
      /* attach 失败静默：查找条仍打开，命中逻辑由后续查找重建 */
    }
    setAddon(ready);
    setIsOpen(true);
  }, [ensureAddon]);

  const close = useCallback(() => {
    setIsOpen(false);
    const current = addonRef.current;
    if (current) {
      safeSearchCall(() => {
        current.clearDecorations();
        current.clearActiveDecoration();
      });
    }
    setIndex(-1);
    setTotal(0);
  }, []);

  // 参数变化即向当前位置向后查找（回车/Shift+回车的 next/prev 由组件层绑定）
  useEffect(() => {
    if (!isOpen || !addon) return;
    if (!query) {
      safeSearchCall(() => addon.clearDecorations());
      setIndex(-1);
      setTotal(0);
      return;
    }
    safeSearchCall(() => addon.findNext(query, searchOptions));
  }, [isOpen, addon, query, searchOptions]);

  const next = useCallback(() => {
    let ensured: SearchAddon | null = null;
    try {
      ensured = ensureAddon();
    } catch {
      ensured = null;
    }
    const current = ensured;
    if (!current || !query) return;
    safeSearchCall(() => current.findNext(query, searchOptions));
  }, [ensureAddon, query, searchOptions]);

  const prev = useCallback(() => {
    let ensured: SearchAddon | null = null;
    try {
      ensured = ensureAddon();
    } catch {
      ensured = null;
    }
    const current = ensured;
    if (!current || !query) return;
    safeSearchCall(() => current.findPrevious(query, searchOptions));
  }, [ensureAddon, query, searchOptions]);

  const toggleCase = useCallback(() => setCaseSensitive((v) => !v), []);
  const toggleRegex = useCallback(() => setRegex((v) => !v), []);

  return {
    isOpen,
    open,
    close,
    query,
    setQuery,
    index,
    total,
    next,
    prev,
    caseSensitive,
    toggleCase,
    regex,
    toggleRegex,
    decorations,
  };
}
