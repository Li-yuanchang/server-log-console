import { useRef, useEffect, useCallback } from "react";
import { EditorState } from "@codemirror/state";
import { EditorView, keymap, lineNumbers, highlightActiveLineGutter, highlightActiveLine, drawSelection, rectangularSelection, highlightSpecialChars } from "@codemirror/view";
import { defaultKeymap, indentWithTab, history, historyKeymap } from "@codemirror/commands";
import { searchKeymap, highlightSelectionMatches } from "@codemirror/search";
import { closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";
import { indentOnInput, bracketMatching, foldGutter, foldKeymap, syntaxHighlighting, defaultHighlightStyle } from "@codemirror/language";
import { oneDark } from "@codemirror/theme-one-dark";
import { json } from "@codemirror/lang-json";
import { xml } from "@codemirror/lang-xml";
import { javascript } from "@codemirror/lang-javascript";
import { python } from "@codemirror/lang-python";
import { java } from "@codemirror/lang-java";
import { sql } from "@codemirror/lang-sql";
import { html } from "@codemirror/lang-html";
import { css } from "@codemirror/lang-css";
import { yaml } from "@codemirror/lang-yaml";
import { markdown } from "@codemirror/lang-markdown";

function getLanguageExtension(fileName: string) {
  const ext = fileName.includes(".") ? fileName.split(".").pop()!.toLowerCase() : "";
  switch (ext) {
    case "json": return json();
    case "xml": return xml();
    case "js": case "mjs": case "cjs": return javascript();
    case "ts": case "mts": case "cts": case "tsx": case "jsx":
      return javascript({ typescript: ext.startsWith("t"), jsx: ext.endsWith("x") });
    case "py": return python();
    case "java": return java();
    case "sql": return sql();
    case "html": case "htm": return html();
    case "css": case "scss": case "less": return css();
    case "yaml": case "yml": return yaml();
    case "md": case "markdown": return markdown();
    default: return [];
  }
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
  const cbRef = useRef({ onChange, onSave });
  cbRef.current = { onChange, onSave };

  const init = useCallback(() => {
    if (!containerRef.current) return;
    viewRef.current?.destroy();
    const isDark = theme === "modern";
    const extensions = [
      lineNumbers(), highlightActiveLineGutter(), highlightSpecialChars(),
      history(), foldGutter(), drawSelection(), rectangularSelection(),
      indentOnInput(), bracketMatching(), closeBrackets(),
      highlightActiveLine(), highlightSelectionMatches(),
      keymap.of([...closeBracketsKeymap, ...defaultKeymap, ...searchKeymap, ...historyKeymap, ...foldKeymap, indentWithTab]),
      getLanguageExtension(fileName),
      isDark ? [oneDark, darkOverride] : [syntaxHighlighting(defaultHighlightStyle, { fallback: true }), lightTheme],
      ...(readOnly ? [EditorState.readOnly.of(true), EditorView.editable.of(false)] : [
        keymap.of([{ key: "Mod-s", run: () => { cbRef.current.onSave?.(); return true; } }]),
        EditorView.updateListener.of((u) => { if (u.docChanged) cbRef.current.onChange?.(u.state.doc.toString()); }),
      ]),
      EditorView.lineWrapping,
    ];
    const state = EditorState.create({ doc: value, extensions });
    viewRef.current = new EditorView({ state, parent: containerRef.current });
  }, [value, fileName, theme, readOnly]);

  useEffect(() => { init(); return () => { viewRef.current?.destroy(); viewRef.current = null; }; }, [init]);

  return <div ref={containerRef} className="code-editor-container" />;
}
