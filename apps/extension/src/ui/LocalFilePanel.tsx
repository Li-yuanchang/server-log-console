import { useCallback, useEffect, useState } from "react";
import { FolderOpen, File, RefreshCw, Home } from "lucide-react";

type LocalEntry = { name: string; isDirectory: boolean; size: number; modifiedTime: string };
type Props = { visible: boolean; onOpenFile: (path: string, content: string) => void; onClose: () => void };

const electronAPI = () => (window as any).electronAPI;

export function LocalFilePanel({ visible, onOpenFile, onClose }: Props) {
  const [path, setPath] = useState("");
  const [entries, setEntries] = useState<LocalEntry[]>([]);
  const [loading, setLoading] = useState(false);

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

  if (!visible) return null;

  const handleEntryClick = async (entry: LocalEntry) => {
    if (entry.isDirectory) {
      browse(path + "/" + entry.name);
    } else {
      const api = electronAPI();
      if (!api?.localReadFile) return;
      const res = await api.localReadFile(path + "/" + entry.name);
      if (res.ok) onOpenFile(path + "/" + entry.name, res.content);
    }
  };

  const handlePickDir = async () => {
    const api = electronAPI();
    if (!api?.localPickDirectory) return;
    const res = await api.localPickDirectory();
    if (res.ok) browse(res.path);
  };

  const parentDir = path.includes("/") ? path.substring(0, path.lastIndexOf("/")) : "";

  return (
    <div className="local-file-panel">
      <div className="local-file-header">
        <span>本地文件</span>
        <div className="local-file-actions">
          <button className="ghost-button icon-button" onClick={() => browse()} title="刷新"><RefreshCw size={12} /></button>
          <button className="ghost-button icon-button" onClick={() => browse()} title="主目录"><Home size={12} /></button>
          <button className="ghost-button icon-button" onClick={handlePickDir} title="选择目录"><FolderOpen size={12} /></button>
          <button className="ghost-button slim-button" onClick={onClose}>关闭</button>
        </div>
      </div>
      <div className="local-file-path">{path}</div>
      <div className="local-file-list">
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
