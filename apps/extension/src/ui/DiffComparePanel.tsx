import { useCallback, useEffect, useRef, useState } from "react";
import { DiffEditor, loader } from "@monaco-editor/react";
import * as monaco from "monaco-editor";
import { FolderOpen, File, RefreshCw, Home, ArrowLeft } from "lucide-react";

type LocalEntry = { name: string; isDirectory: boolean; size: number; modifiedTime: string };

const electronAPI = () => (window as any).electronAPI;

loader.config({ monaco });

interface DiffComparePanelProps {
  visible: boolean;
  remoteContent: string;
  remoteLabel: string;
  onClose: () => void;
}

export function DiffComparePanel({ visible, remoteContent, remoteLabel, onClose }: DiffComparePanelProps) {
  const [localContent, setLocalContent] = useState<string | null>(null);
  const [localLabel, setLocalLabel] = useState<string>("");
  const [path, setPath] = useState("");
  const [entries, setEntries] = useState<LocalEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<"browse" | "diff">("browse");
  const editorRef = useRef<any>(null);
  const normalizedRemoteContent = normalizeForCompare(remoteContent);
  const normalizedLocalContent = localContent === null ? null : normalizeForCompare(localContent);
  const isSameContent = normalizedLocalContent !== null && normalizedLocalContent === normalizedRemoteContent;

  const browse = useCallback(async (dir?: string) => {
    const api = electronAPI();
    if (!api?.localBrowse) return;
    setLoading(true);
    try {
      const res = await api.localBrowse(dir);
      if (res.ok) { setPath(res.path); setEntries(res.entries); }
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { if (visible) browse(); }, [visible, browse]);

  const handleEntryClick = async (entry: LocalEntry) => {
    if (entry.isDirectory) {
      browse(path + "/" + entry.name);
    } else {
      const api = electronAPI();
      if (!api?.localReadFile) return;
      const res = await api.localReadFile(path + "/" + entry.name);
      if (res.ok) {
        setLocalContent(res.content);
        setLocalLabel(entry.name);
        setMode("diff");
      }
    }
  };

  const handlePickDir = async () => {
    const api = electronAPI();
    if (!api?.localPickDirectory) return;
    const res = await api.localPickDirectory();
    if (res.ok) browse(res.path);
  };

  const handleEditorMount = (editor: any) => {
    editorRef.current = editor;
  };

  if (!visible) return null;

  const parentDir = path.includes("/") ? path.substring(0, path.lastIndexOf("/")) : "";

  if (mode === "diff" && localContent !== null) {
    return (
      <div className="diff-compare-panel">
        <div className="diff-compare-header">
          <button className="ghost-button icon-button" onClick={() => setMode("browse")} title="返回文件浏览">
            <ArrowLeft size={14} />
          </button>
          <span className="diff-compare-title">对比视图</span>
          <div className="diff-compare-actions">
            <button className="ghost-button slim-button" onClick={onClose}>关闭</button>
          </div>
        </div>
        <div className="diff-compare-labels">
          <span className="diff-label-remote">远程: {remoteLabel}</span>
          <span className="diff-label-local">本地: {localLabel}</span>
        </div>
        {isSameContent ? (
          <div className="diff-compare-same-state">
            <strong>两侧内容一致</strong>
            <span>已自动忽略换行符与 UTF-8 BOM 差异。</span>
          </div>
        ) : (
          <div className="diff-compare-editor">
            <DiffEditor
              original={normalizedRemoteContent}
              modified={normalizedLocalContent || ""}
              onMount={handleEditorMount}
              options={{
                readOnly: true,
                scrollBeyondLastLine: false,
                minimap: { enabled: false },
                lineNumbers: "on",
                folding: true,
                wordWrap: "on",
                automaticLayout: true,
                fontSize: 12,
                scrollbar: {
                  verticalScrollbarSize: 8,
                  horizontalScrollbarSize: 8,
                },
                renderSideBySide: true,
                renderOverviewRuler: true,
                hideUnchangedRegions: { enabled: false },
                ignoreTrimWhitespace: false,
              } as any}
              theme="vs"
            />
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="diff-compare-panel">
      <div className="diff-compare-header">
        <span className="diff-compare-title">选择本地文件进行对比</span>
        <div className="diff-compare-actions">
          <button className="ghost-button icon-button" onClick={() => browse()} title="刷新"><RefreshCw size={12} /></button>
          <button className="ghost-button icon-button" onClick={() => browse()} title="主目录"><Home size={12} /></button>
          <button className="ghost-button icon-button" onClick={handlePickDir} title="选择目录"><FolderOpen size={12} /></button>
          <button className="ghost-button slim-button" onClick={onClose}>关闭</button>
        </div>
      </div>
      <div className="diff-compare-path">{path}</div>
      <div className="diff-compare-list">
        {parentDir ? (<div className="local-file-entry local-file-dir" onClick={() => browse(parentDir)}>..</div>) : null}
        {loading ? <div className="local-file-loading">加载中...</div> : null}
        {!loading && entries.map((e) => (
          <div key={e.name} className={"local-file-entry" + (e.isDirectory ? " local-file-dir" : "")} onClick={() => handleEntryClick(e)}>
            {e.isDirectory ? <FolderOpen size={12} /> : <File size={12} />}
            <span className="local-file-name">{e.name}</span>
            {!e.isDirectory ? <span className="local-file-size">{formatSize(e.size)}</span> : null}
          </div>
        ))}
      </div>
    </div>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}

function normalizeForCompare(content: string): string {
  return content.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
}
