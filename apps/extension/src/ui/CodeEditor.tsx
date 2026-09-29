import { useRef, useEffect, useCallback } from "react";
import { EditorState, type Extension } from "@codemirror/state";
import { EditorView, keymap, lineNumbers, highlightActiveLineGutter, highlightActiveLine, drawSelection, rectangularSelection, highlightSpecialChars } from "@codemirror/view";
import { defaultKeymap, indentWithTab, history, historyKeymap } from "@codemirror/commands";
import { SearchQuery, openSearchPanel, search, searchKeymap, highlightSelectionMatches, setSearchQuery } from "@codemirror/search";
import { closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";
import { indentOnInput, bracketMatching, codeFolding, foldGutter, foldKeymap, foldService, HighlightStyle, StreamLanguage, syntaxHighlighting, defaultHighlightStyle, type StringStream } from "@codemirror/language";
import { oneDark } from "@codemirror/theme-one-dark";
import { tags } from "@lezer/highlight";

function getLanguageKey(fileName: string) {
  return fileName.includes(".") ? fileName.split(".").pop()!.toLowerCase() : "";
}

const languageExtensionCache = new Map<string, Promise<Extension>>();

const editorHighlightStyle = HighlightStyle.define([
  { tag: tags.keyword, color: "#7dd3fc", fontWeight: "650" },
  { tag: tags.propertyName, color: "#dbeafe" },
  { tag: tags.atom, color: "#c4b5fd" },
  { tag: tags.variableName, color: "#86efac" },
  { tag: tags.string, color: "#fbbf24" },
  { tag: tags.number, color: "#f0abfc" },
  { tag: tags.comment, color: "#64748b", fontStyle: "italic" },
  { tag: tags.brace, color: "#fb7185", fontWeight: "700" },
  { tag: tags.separator, color: "#94a3b8" }
]);

type NginxParserState = {
  expectDirective: boolean;
};

const nginxValueKeywords = new Set([
  "on", "off", "default", "main", "warn", "error", "info", "debug", "notice",
  "http", "https", "tcp", "udp", "json", "combined"
]);

const nginxConfLanguage = StreamLanguage.define<NginxParserState>({
  name: "nginx-conf",
  startState: () => ({ expectDirective: true }),
  blankLine: (state) => {
    state.expectDirective = true;
  },
  token: (stream: StringStream, state: NginxParserState) => {
    if (stream.eatSpace()) return null;
    if (stream.peek() === "#") {
      stream.skipToEnd();
      return "comment";
    }
    const next = stream.peek();
    if (next === "\"" || next === "'") {
      const quote = stream.next();
      let escaped = false;
      while (!stream.eol()) {
        const current = stream.next();
        if (current === quote && !escaped) break;
        escaped = current === "\\" && !escaped;
        if (current !== "\\") escaped = false;
      }
      state.expectDirective = false;
      return "string";
    }
    if (next === "$") {
      stream.next();
      stream.eatWhile(/[\w_]/);
      state.expectDirective = false;
      return "variableName";
    }
    if (next === "{" || next === "}") {
      stream.next();
      state.expectDirective = next === "}";
      return "brace";
    }
    if (next === ";") {
      stream.next();
      state.expectDirective = true;
      return "separator";
    }
    if (stream.match(/-?\d+(?:\.\d+)?(?:[kKmMgG][bB]?|ms|s|m|h|d)?/)) {
      state.expectDirective = false;
      return "number";
    }
    if (stream.match(/[A-Za-z_][\w.-]*/)) {
      const word = stream.current();
      if (state.expectDirective) {
        state.expectDirective = false;
        return "keyword";
      }
      return nginxValueKeywords.has(word.toLowerCase()) ? "atom" : "propertyName";
    }
    stream.next();
    return null;
  },
  languageData: {
    commentTokens: { line: "#" },
    closeBrackets: { brackets: ["(", "[", "{", "'", "\""] }
  }
});

function isNginxLikeConfig(fileName: string): boolean {
  const lowerName = fileName.toLowerCase();
  return lowerName === "nginx.conf"
    || lowerName.endsWith("/nginx.conf")
    || lowerName.endsWith(".nginx")
    || lowerName.endsWith(".conf");
}

const searchPhrases = {
  Find: "搜索源码",
  Replace: "替换为",
  next: "下一个",
  previous: "上一个",
  all: "全选匹配",
  "match case": "区分大小写",
  regexp: "正则",
  "by word": "整词",
  replace: "替换",
  "replace all": "全部替换",
  close: "关闭搜索"
};

async function loadLanguageExtension(ext: string): Promise<Extension> {
  try {
    switch (ext) {
      case "json":
        return (await import("@codemirror/lang-json")).json();
      case "xml":
        return (await import("@codemirror/lang-xml")).xml();
      case "js":
      case "mjs":
      case "cjs":
        return (await import("@codemirror/lang-javascript")).javascript();
      case "ts":
      case "mts":
      case "cts":
      case "tsx":
      case "jsx": {
        const { javascript } = await import("@codemirror/lang-javascript");
        return javascript({ typescript: ext.startsWith("t"), jsx: ext.endsWith("x") });
      }
      case "py":
        return (await import("@codemirror/lang-python")).python();
      case "java":
        return (await import("@codemirror/lang-java")).java();
      case "sql":
        return (await import("@codemirror/lang-sql")).sql();
      case "html":
      case "htm":
        return (await import("@codemirror/lang-html")).html();
      case "css":
      case "scss":
      case "less":
        return (await import("@codemirror/lang-css")).css();
      case "yaml":
      case "yml":
        return (await import("@codemirror/lang-yaml")).yaml();
      case "md":
      case "markdown":
        return (await import("@codemirror/lang-markdown")).markdown();
      default:
        return [];
    }
  } catch {
    return [];
  }
}

function getLanguageExtension(fileName: string): Promise<Extension> {
  if (isNginxLikeConfig(fileName)) {
    return Promise.resolve(nginxConfLanguage);
  }
  const ext = getLanguageKey(fileName);
  if (!ext) {
    return Promise.resolve([]);
  }
  const cached = languageExtensionCache.get(ext);
  if (cached) {
    return cached;
  }
  const pending = loadLanguageExtension(ext);
  languageExtensionCache.set(ext, pending);
  return pending;
}

function findOpeningBraceOutsideIgnoredText(text: string): number {
  let quote: string | null = null;
  let escaped = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quote) {
      if (char === quote && !escaped) quote = null;
      escaped = char === "\\" && !escaped;
      if (char !== "\\") escaped = false;
      continue;
    }
    if (char === "#") break;
    if (char === "\"" || char === "'") {
      quote = char;
      escaped = false;
      continue;
    }
    if (char === "{") return index;
  }
  return -1;
}

function findMatchingClosingBrace(state: EditorState, openBracePos: number): number | null {
  const text = state.doc.sliceString(openBracePos + 1);
  let depth = 1;
  let quote: string | null = null;
  let escaped = false;
  let inComment = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (inComment) {
      if (char === "\n") inComment = false;
      continue;
    }
    if (quote) {
      if (char === quote && !escaped) quote = null;
      escaped = char === "\\" && !escaped;
      if (char !== "\\") escaped = false;
      continue;
    }
    if (char === "#") {
      inComment = true;
      continue;
    }
    if (char === "\"" || char === "'") {
      quote = char;
      escaped = false;
      continue;
    }
    if (char === "{") {
      depth += 1;
      continue;
    }
    if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return openBracePos + 1 + index;
      }
    }
  }
  return null;
}

function braceFoldRange(state: EditorState, lineStart: number, lineEnd: number): { from: number; to: number } | null {
  const lineText = state.doc.sliceString(lineStart, lineEnd);
  const openBraceOffset = findOpeningBraceOutsideIgnoredText(lineText);
  if (openBraceOffset < 0) {
    return null;
  }
  const openBracePos = lineStart + openBraceOffset;
  const closingBracePos = findMatchingClosingBrace(state, openBracePos);
  if (!closingBracePos || closingBracePos <= lineEnd) {
    return null;
  }
  return { from: openBracePos + 1, to: closingBracePos };
}

const lightTheme = EditorView.theme({
  "&": { height: "100%", fontSize: "12.5px" },
  ".cm-scroller": { overflow: "auto", fontFamily: "'SFMono-Regular', 'Consolas', monospace" },
  ".cm-gutters": { background: "#f8f9fb", borderRight: "1px solid #e4e9ee", color: "#9ca8b6" },
  ".cm-activeLineGutter": { background: "#e8eff7" },
  ".cm-activeLine": { background: "rgba(49,95,141,0.04)" },
  ".cm-cursor": { borderLeftColor: "#315f8d" },
});

const darkOverride = EditorView.theme({
  "&": {
    height: "100%",
    fontSize: "12.5px",
    background: "#050607",
    color: "#d7dde5"
  },
  ".cm-scroller": {
    overflow: "auto",
    fontFamily: "'Geist Mono', 'SFMono-Regular', 'Menlo', monospace",
    background: "#050607",
    color: "#d7dde5"
  },
  ".cm-content": {
    padding: "8px 0",
    caretColor: "#cfe8ff"
  },
  ".cm-line": {
    padding: "0 10px"
  },
  ".cm-gutters": {
    background: "#050607",
    color: "#6f7d90",
    borderRight: "1px solid rgba(255,255,255,0.06)"
  },
  ".cm-activeLineGutter": {
    background: "rgba(148, 163, 184, 0.12)",
    color: "#cbd5e1"
  },
  ".cm-activeLine": {
    background: "rgba(148, 163, 184, 0.08)"
  },
  ".cm-selectionBackground, .cm-content ::selection": {
    background: "rgba(82, 136, 190, 0.36) !important"
  },
  ".cm-cursor": {
    borderLeftColor: "#cfe8ff"
  },
  ".cm-matchingBracket, .cm-nonmatchingBracket": {
    background: "rgba(96, 165, 250, 0.18)",
    outline: "1px solid rgba(147, 197, 253, 0.26)"
  }
});

function createFoldMarker(open: boolean): HTMLElement {
  const marker = document.createElement("span");
  marker.className = `cm-fold-marker ${open ? "cm-fold-marker-open" : "cm-fold-marker-closed"}`;
  marker.textContent = open ? "⌄" : "›";
  marker.setAttribute("aria-hidden", "true");
  return marker;
}

interface CodeEditorProps {
  value: string;
  fileName: string;
  documentKey?: string;
  theme?: "classic" | "modern";
  readOnly?: boolean;
  focusLine?: number | null;
  focusLineToken?: number;
  openSearchToken?: number;
  onChange?: (v: string) => void;
  onSave?: () => void;
}

export function CodeEditor({ value, fileName, documentKey, theme = "modern", readOnly, focusLine, focusLineToken, openSearchToken, onChange, onSave }: CodeEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const initTokenRef = useRef(0);
  const valueRef = useRef(value);
  const applyingExternalValueRef = useRef(false);
  const cbRef = useRef({ onChange, onSave });
  const focusRef = useRef<{ line?: number | null; searchToken?: number }>({});
  valueRef.current = value;
  cbRef.current = { onChange, onSave };
  focusRef.current = { line: focusLine, searchToken: openSearchToken };

  const scrollToLine = useCallback((view: EditorView, lineNumber?: number | null) => {
    if (!lineNumber || lineNumber < 1) {
      return;
    }
    const safeLine = Math.min(lineNumber, view.state.doc.lines);
    const line = view.state.doc.line(safeLine);
    view.dispatch({
      selection: { anchor: line.from },
      effects: EditorView.scrollIntoView(line.from, { y: "center" })
    });
    view.focus();
  }, []);

  const init = useCallback(async () => {
    if (!containerRef.current) return;
    const container = containerRef.current;
    const initToken = ++initTokenRef.current;
    viewRef.current?.destroy();
    viewRef.current = null;
    container.textContent = "";
    const isDark = theme === "modern";
    const languageExtension = await getLanguageExtension(fileName);
    if (initTokenRef.current !== initToken || !containerRef.current || containerRef.current !== container) {
      return;
    }
    const extensions = [
      lineNumbers(), highlightActiveLineGutter(), highlightSpecialChars(),
      history(), codeFolding({ placeholderText: "折叠代码" }), foldService.of(braceFoldRange), foldGutter({ markerDOM: createFoldMarker }), drawSelection(), rectangularSelection(),
      indentOnInput(), bracketMatching({ brackets: "()[]{}", maxScanDistance: 250000 }), closeBrackets(),
      highlightActiveLine(), search({ top: true }), highlightSelectionMatches(),
      EditorState.phrases.of(searchPhrases),
      keymap.of([...closeBracketsKeymap, ...defaultKeymap, ...searchKeymap, ...historyKeymap, ...foldKeymap, indentWithTab]),
      languageExtension,
      isDark ? [oneDark, darkOverride] : [syntaxHighlighting(defaultHighlightStyle, { fallback: true }), lightTheme],
      syntaxHighlighting(editorHighlightStyle),
      ...(readOnly ? [EditorState.readOnly.of(true), EditorView.editable.of(false)] : [
        keymap.of([{ key: "Mod-s", run: () => { cbRef.current.onSave?.(); return true; } }]),
        EditorView.updateListener.of((u) => {
          if (u.docChanged && !applyingExternalValueRef.current) {
            cbRef.current.onChange?.(u.state.doc.toString());
          }
        }),
      ]),
      EditorView.lineWrapping,
    ];
    const state = EditorState.create({ doc: valueRef.current, extensions });
    viewRef.current = new EditorView({ state, parent: container });
    requestAnimationFrame(() => {
      if (viewRef.current) {
        scrollToLine(viewRef.current, focusRef.current.line);
      }
    });
  }, [documentKey, fileName, theme, readOnly, scrollToLine]);

  useEffect(() => {
    void init();
    return () => {
      initTokenRef.current += 1;
      viewRef.current?.destroy();
      viewRef.current = null;
    };
  }, [init]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) {
      return;
    }
    const currentValue = view.state.doc.toString();
    if (currentValue === value) {
      return;
    }
    const scrollElement = view.scrollDOM;
    const scrollLeft = scrollElement.scrollLeft;
    const scrollTop = scrollElement.scrollTop;
    const nextSelection = {
      anchor: Math.min(view.state.selection.main.anchor, value.length),
      head: Math.min(view.state.selection.main.head, value.length)
    };
    applyingExternalValueRef.current = true;
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: value },
      selection: nextSelection
    });
    applyingExternalValueRef.current = false;
    requestAnimationFrame(() => {
      scrollElement.scrollLeft = scrollLeft;
      scrollElement.scrollTop = scrollTop;
    });
  }, [value]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view || !focusLine || focusLine < 1) {
      return;
    }
    scrollToLine(view, focusLine);
  }, [focusLine, focusLineToken, scrollToLine]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view || !openSearchToken) {
      return;
    }
    view.dispatch({
      effects: setSearchQuery.of(new SearchQuery({ search: "" }))
    });
    openSearchPanel(view);
  }, [openSearchToken]);

  return <div ref={containerRef} className="code-editor-container" />;
}
