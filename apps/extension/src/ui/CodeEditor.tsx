import { useRef, useEffect, useCallback } from "react";
import { EditorState, type Extension } from "@codemirror/state";
import { EditorView, keymap, lineNumbers, highlightActiveLineGutter, highlightActiveLine, drawSelection, rectangularSelection, highlightSpecialChars } from "@codemirror/view";
import { defaultKeymap, indentWithTab, history, historyKeymap } from "@codemirror/commands";
import { searchKeymap, highlightSelectionMatches } from "@codemirror/search";
import { closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";
import { indentOnInput, bracketMatching, foldGutter, foldKeymap, syntaxHighlighting, defaultHighlightStyle } from "@codemirror/language";
import { oneDark } from "@codemirror/theme-one-dark";

function getLanguageKey(fileName: string) {
  return fileName.includes(".") ? fileName.split(".").pop()!.toLowerCase() : "";
}

const languageExtensionCache = new Map<string, Promise<Extension>>();

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

const lightTheme = EditorView.theme({
  "&": { height: "100%", fontSize: "12.5px" },
  ".cm-scroller": { overflow: "auto", fontFamily: "'SFMono-Regular', 'Consolas', monospace" },
  ".cm-gutters": { background: "#f8f9fb", borderRight: "1px solid #e4e9ee", color: "#9ca8b6" },
  ".cm-activeLineGutter": { background: "#e8eff7" },
  ".cm-activeLine": { background: "rgba(49,95,141,0.04)" },
  ".cm-cursor": { borderLeftColor: "#315f8d" },
});

const darkOverride = EditorView.theme({
  "&": { height: "100%", fontSize: "12.5px" },
  ".cm-scroller": { overflow: "auto", fontFamily: "'Geist Mono', 'SFMono-Regular', monospace" },
});

interface CodeEditorProps {
  value: string;
  fileName: string;
  theme?: "classic" | "modern";
  readOnly?: boolean;
  onChange?: (v: string) => void;
  onSave?: () => void;
}

export function CodeEditor({ value, fileName, theme = "classic", readOnly, onChange, onSave }: CodeEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const initTokenRef = useRef(0);
  const cbRef = useRef({ onChange, onSave });
  cbRef.current = { onChange, onSave };

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
      history(), foldGutter(), drawSelection(), rectangularSelection(),
      indentOnInput(), bracketMatching(), closeBrackets(),
      highlightActiveLine(), highlightSelectionMatches(),
      keymap.of([...closeBracketsKeymap, ...defaultKeymap, ...searchKeymap, ...historyKeymap, ...foldKeymap, indentWithTab]),
      languageExtension,
      isDark ? [oneDark, darkOverride] : [syntaxHighlighting(defaultHighlightStyle, { fallback: true }), lightTheme],
      ...(readOnly ? [EditorState.readOnly.of(true), EditorView.editable.of(false)] : [
        keymap.of([{ key: "Mod-s", run: () => { cbRef.current.onSave?.(); return true; } }]),
        EditorView.updateListener.of((u) => { if (u.docChanged) cbRef.current.onChange?.(u.state.doc.toString()); }),
      ]),
      EditorView.lineWrapping,
    ];
    const state = EditorState.create({ doc: value, extensions });
    viewRef.current = new EditorView({ state, parent: container });
  }, [value, fileName, theme, readOnly]);

  useEffect(() => {
    void init();
    return () => {
      initTokenRef.current += 1;
      viewRef.current?.destroy();
      viewRef.current = null;
    };
  }, [init]);

  return <div ref={containerRef} className="code-editor-container" />;
}
