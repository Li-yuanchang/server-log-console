import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { EditorView } from "@codemirror/view";
import { SearchQuery, findNext, findPrevious, getSearchQuery, openSearchPanel, searchPanelOpen, setSearchQuery } from "@codemirror/search";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  Maximize2,
  Minimize2,
  MoreHorizontal,
  Search,
  X,
} from "lucide-react";
import { CodeEditor } from "./CodeEditor";
import type { FilePreviewResponse } from "./api.js";
import { useEscapeToClose } from "./useEscapeToClose.js";
import { formatBytes } from "./utils.js";

type ArchiveEntry = NonNullable<FilePreviewResponse["archiveEntries"]>[number];

type ArchiveDirectoryNode = {
  name: string;
  path: string;
  children: ArchiveDirectoryNode[];
};

type ArchiveBrowserItem = {
  name: string;
  path: string;
  kind: "directory" | "file";
  entry?: ArchiveEntry;
  size: number;
  compressedSize: number;
  modifiedAt: string;
};

export interface PreviewDialogState extends Omit<FilePreviewResponse, "filePath"> {
  filePath: string;
  fileName: string;
  originalContent: string;
  selectedArchiveEntryName?: string;
  archiveEntryLoading?: boolean;
  archiveEntryError?: string;
  archiveEntryPreview?: FilePreviewResponse;
  saving?: boolean;
  loading?: boolean;
  maximized?: boolean;
}

interface FilePreviewDialogProps {
  dialog: PreviewDialogState | null;
  theme: "classic" | "modern";
  onChange: (value: string) => void;
  onDownload: () => void;
  onSave: () => void;
  onPreviewArchiveEntry: (entryName: string) => void;
  onToggleMaximize: () => void;
  onClose: () => void;
}

type EditorSearchStats = { total: number; current: number };
type EditorVisibleRange = { from: number; to: number; total: number };

// 文件内搜索行（原型 S7 第 708-718 行）：把查询写进 CodeMirror（命中高亮）、
// 维护「当前 / 总数」与可视行号区间。CodeEditor 自身不暴露 view，故经 DOM 反查。
function useEditorSearch(
  rootRef: RefObject<HTMLDivElement | null>,
  enabled: boolean,
  documentKey: string | undefined
) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [query, setQuery] = useState("");
  const [stats, setStats] = useState<EditorSearchStats>({ total: 0, current: 0 });
  const [range, setRange] = useState<EditorVisibleRange>({ from: 1, to: 1, total: 1 });

  const getView = useCallback((): EditorView | null => {
    const root = rootRef.current;
    if (!root) return null;
    const editor = root.querySelector<HTMLElement>(".cm-editor");
    return editor ? EditorView.findFromDOM(editor) : null;
  }, [rootRef]);

  const refreshStats = useCallback(() => {
    const view = getView();
    if (!view) {
      setStats({ total: 0, current: 0 });
      return;
    }
    const activeQuery = getSearchQuery(view.state);
    if (!activeQuery.search) {
      setStats({ total: 0, current: 0 });
      return;
    }
    let total = 0;
    let current = 0;
    const head = view.state.selection.main.head;
    const cursor = activeQuery.getCursor(view.state);
    for (let step = cursor.next(); !step.done; step = cursor.next()) {
      total += 1;
      if (step.value.from <= head && head <= step.value.to) {
        current = total;
      }
    }
    setStats({ total, current });
  }, [getView]);

  const refreshRange = useCallback(() => {
    const view = getView();
    if (!view) return;
    const doc = view.state.doc;
    const ranges = view.visibleRanges;
    const firstPos = ranges.length ? ranges[0].from : 0;
    const lastPos = ranges.length ? ranges[ranges.length - 1].to : 1;
    const from = doc.lineAt(Math.min(firstPos, doc.length)).number;
    const to = doc.lineAt(Math.min(Math.max(lastPos, 1), doc.length)).number;
    setRange({ from, to, total: doc.lines });
  }, [getView]);

  const focusInput = useCallback(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const step = useCallback((direction: 1 | -1) => {
    const view = getView();
    if (!view) return;
    if (direction === 1) {
      findNext(view);
    } else {
      findPrevious(view);
    }
    refreshStats();
    refreshRange();
  }, [getView, refreshStats, refreshRange]);

  // 查询写入编辑器并跳到首个命中（原型搜索框即改即搜）。
  // CodeMirror 的高亮仅在自带搜索面板「打开」时生效（highlight({panel})），
  // 而原型用内联搜索行取代了该面板 —— 故此处程序化打开面板以获得命中高亮，
  // 再由 CSS 隐藏面板本体（原型 S7 708-718 行）。
  useEffect(() => {
    if (!enabled) return;
    const handle = window.setTimeout(() => {
      const view = getView();
      if (!view) return;
      if (getSearchQuery(view.state).search !== query) {
        view.dispatch({ effects: setSearchQuery.of(new SearchQuery({ search: query })) });
        if (query) findNext(view);
      }
      if (query && !searchPanelOpen(view.state)) {
        openSearchPanel(view);
      }
      refreshStats();
      refreshRange();
    }, 160);
    return () => window.clearTimeout(handle);
  }, [query, enabled, documentKey, getView, refreshStats, refreshRange]);

  // 切换文件清空查询
  useEffect(() => {
    setQuery("");
    setStats({ total: 0, current: 0 });
  }, [documentKey]);

  // 跟随滚动更新行号区间
  useEffect(() => {
    if (!enabled) return;
    let scroller: HTMLElement | null = null;
    const onScroll = () => refreshRange();
    const attach = () => {
      const view = getView();
      if (!view) return false;
      if (scroller === view.scrollDOM) return true;
      if (scroller) scroller.removeEventListener("scroll", onScroll);
      scroller = view.scrollDOM;
      scroller.addEventListener("scroll", onScroll, { passive: true });
      refreshRange();
      return true;
    };
    let interval: number | undefined;
    if (!attach()) {
      interval = window.setInterval(() => {
        if (attach() && interval) {
          window.clearInterval(interval);
          interval = undefined;
        }
      }, 250);
    }
    return () => {
      if (interval) window.clearInterval(interval);
      if (scroller) scroller.removeEventListener("scroll", onScroll);
    };
  }, [enabled, documentKey, getView, refreshRange]);

  return { query, setQuery, stats, range, focusInput, step, inputRef };
}

export function FilePreviewDialog(props: FilePreviewDialogProps) {
  const {
    dialog,
    theme,
    onChange,
    onDownload,
    onSave,
    onPreviewArchiveEntry,
    onToggleMaximize,
    onClose,
  } = props;
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const isStructuredPreview = dialog?.previewKind === "archive" || dialog?.previewKind === "class";
  const isTextPreview = Boolean(dialog && dialog.previewKind !== "archive" && dialog.previewKind !== "class");
  const search = useEditorSearch(dialogRef, isTextPreview && !dialog?.loading, dialog?.filePath);
  useEscapeToClose(Boolean(dialog), onClose);

  // ⌘F 聚焦内联搜索框（原型 S7 第 708-718 行取代 CodeMirror 自带面板）
  useEffect(() => {
    if (!isTextPreview) {
      return;
    }
    const focusSearch = search.focusInput;
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "f") {
        event.preventDefault();
        event.stopPropagation();
        focusSearch();
      }
    };
    window.addEventListener("keydown", handleKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", handleKeyDown, { capture: true });
  }, [isTextPreview, search.focusInput]);

  useEffect(() => {
    if (!moreOpen) {
      return;
    }
    const onDocumentMouseDown = (event: MouseEvent) => {
      if (dialogRef.current && !dialogRef.current.contains(event.target as Node)) {
        setMoreOpen(false);
      }
    };
    document.addEventListener("mousedown", onDocumentMouseDown);
    return () => document.removeEventListener("mousedown", onDocumentMouseDown);
  }, [moreOpen]);

  if (!dialog) {
    return null;
  }
  const readonlyLabel = dialog.previewLabel || (dialog.fileName.endsWith(".record.log") ? "录制预览" : "尾部预览");
  const previewClassName = `dialog-shell preview-dialog${dialog.maximized ? " dialog-shell-maximized preview-dialog-maximized" : ""}${dialog.previewKind && dialog.previewKind !== "text" ? ` preview-dialog-${dialog.previewKind}` : ""}`;
  const eol = dialog.content.includes("\r\n") ? "CRLF" : "LF";

  return (
    <div className="confirm-backdrop preview-backdrop">
      <div
        ref={dialogRef}
        className={previewClassName}
        onMouseDown={(event) => {
          const target = event.target as HTMLElement;
          if (!target.classList.contains("preview-resize-handle")) return;
          event.preventDefault();
          const previewDialog = target.parentElement;
          if (!previewDialog) {
            return;
          }
          const startX = event.clientX;
          const startY = event.clientY;
          const startW = previewDialog.offsetWidth;
          const startH = previewDialog.offsetHeight;
          const onMove = (moveEvent: MouseEvent) => {
            previewDialog.style.width = `${Math.max(400, startW + moveEvent.clientX - startX)}px`;
            previewDialog.style.height = `${Math.max(300, startH + moveEvent.clientY - startY)}px`;
          };
          const onUp = () => {
            document.removeEventListener("mousemove", onMove);
            document.removeEventListener("mouseup", onUp);
          };
          document.addEventListener("mousemove", onMove);
          document.addEventListener("mouseup", onUp);
        }}
      >
        <div className="dialog-titlebar preview-header">
          <b className="preview-title" title={dialog.filePath}>{dialog.fileName}</b>
          {dialog.readOnly ? (
            <span className="chip preview-chip-gold">{readonlyLabel} · {formatBytes(dialog.size)}</span>
          ) : null}
          {dialog.readOnly ? <span className="chip preview-chip-muted">只读</span> : null}
          {!dialog.readOnly && dialog.content !== dialog.originalContent ? (
            <span className="preview-dirty">已修改</span>
          ) : null}
          {dialog.loading ? <span className="preview-loading-badge">加载中…</span> : null}
          <span className="preview-header-spacer" />
          <div className="preview-actions">
            <button type="button" className="preview-icon-btn" title="下载" aria-label="下载" onClick={onDownload}>
              <Download size={14} strokeWidth={1.9} />
            </button>
            <button
              type="button"
              className="preview-icon-btn"
              title={dialog.maximized ? "还原窗口" : "最大化"}
              aria-label="最大化"
              onClick={onToggleMaximize}
            >
              {dialog.maximized
                ? <Minimize2 size={14} strokeWidth={1.8} />
                : <Maximize2 size={14} strokeWidth={1.8} />}
            </button>
            <button type="button" className="preview-icon-btn preview-close-icon" title="关闭" aria-label="关闭" onClick={onClose}>
              <X size={14} strokeWidth={2} />
            </button>
            {!dialog.readOnly ? (
              <span className="preview-more">
                <button
                  type="button"
                  className="preview-icon-btn"
                  title="更多"
                  aria-label="更多"
                  aria-expanded={moreOpen}
                  onClick={() => setMoreOpen((open) => !open)}
                >
                  <MoreHorizontal size={14} strokeWidth={1.9} />
                </button>
                {moreOpen ? (
                  <div className="preview-more-menu" role="menu">
                    <button
                      type="button"
                      role="menuitem"
                      className="preview-more-item"
                      disabled={dialog.content === dialog.originalContent || dialog.saving}
                      onClick={() => {
                        setMoreOpen(false);
                        onSave();
                      }}
                    >
                      {dialog.saving ? "保存中…" : "保存 ⌘S"}
                    </button>
                  </div>
                ) : null}
              </span>
            ) : null}
          </div>
        </div>
        {dialog.loading ? (
          <div className="preview-loading">
            <div className="preview-loading-spinner" />
            <span>正在加载文件内容…</span>
          </div>
        ) : isStructuredPreview ? (
          <StructuredPreview dialog={dialog} theme={theme} onPreviewArchiveEntry={onPreviewArchiveEntry} />
        ) : (
          <>
            <div className="preview-searchbar">
              <span className="preview-search-shell">
                <Search size={11} strokeWidth={2} />
                <input
                  ref={search.inputRef}
                  value={search.query}
                  onChange={(event) => search.setQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      search.step(event.shiftKey ? -1 : 1);
                    }
                  }}
                  placeholder="在文件中搜索…"
                  aria-label="在文件中搜索"
                />
              </span>
              <span className="preview-search-count">
                {search.query ? `${search.stats.current} / ${search.stats.total}` : ""}
              </span>
              <button
                type="button"
                className="preview-search-nav"
                title="上一个"
                aria-label="上一个匹配"
                disabled={!search.stats.total}
                onClick={() => search.step(-1)}
              >
                <ChevronLeft size={12} strokeWidth={2} />
              </button>
              <button
                type="button"
                className="preview-search-nav"
                title="下一个"
                aria-label="下一个匹配"
                disabled={!search.stats.total}
                onClick={() => search.step(1)}
              >
                <ChevronRight size={12} strokeWidth={2} />
              </button>
              <span className="preview-search-spacer" />
              <span className="preview-search-range">
                {`${search.range.from.toLocaleString("en-US")} – ${search.range.to.toLocaleString("en-US")} 行 · 共 ${search.range.total.toLocaleString("en-US")} 行`}
              </span>
            </div>
            <CodeEditor
              value={dialog.content}
              fileName={dialog.fileName}
              documentKey={dialog.filePath}
              theme={theme}
              readOnly={dialog.readOnly}
              onChange={onChange}
              onSave={onSave}
            />
          </>
        )}
        {!dialog.loading && !isStructuredPreview ? (
          <div className="preview-footer">
            <span className="preview-footer-note">
              {dialog.readOnly ? "只读 · 大文件仅加载最后 1MB" : "可编辑文件：⌘S 保存回写远程"}
            </span>
            <span className="preview-footer-spacer" />
            <span className="preview-footer-meta">UTF-8 · {eol} · Geist Mono 12px</span>
          </div>
        ) : null}
        <div className="preview-resize-handle" />
      </div>
    </div>
  );
}

function StructuredPreview({
  dialog,
  theme,
  onPreviewArchiveEntry,
}: {
  dialog: PreviewDialogState;
  theme: "classic" | "modern";
  onPreviewArchiveEntry: (entryName: string) => void;
}) {
  if (dialog.previewKind === "archive") {
    return <ArchivePreview dialog={dialog} theme={theme} onPreviewArchiveEntry={onPreviewArchiveEntry} />;
  }
  if (dialog.previewKind === "class") {
    return <ClassPreview dialog={dialog} theme={theme} />;
  }
  return null;
}

function ArchivePreview({
  dialog,
  theme,
  onPreviewArchiveEntry,
}: {
  dialog: PreviewDialogState;
  theme: "classic" | "modern";
  onPreviewArchiveEntry: (entryName: string) => void;
}) {
  const entries = dialog.archiveEntries ?? [];
  const selectedPreview = dialog.archiveEntryPreview;
  const [currentDir, setCurrentDir] = useState("");
  const [selectedPath, setSelectedPath] = useState<string | undefined>(dialog.selectedArchiveEntryName);
  const archiveModel = useMemo(() => buildArchiveBrowserModel(entries), [entries]);
  const currentItems = useMemo(() => getArchiveDirectoryItems(entries, currentDir), [entries, currentDir]);
  const currentPathLabel = currentDir || dialog.fileName;
  const selectedItem = useMemo(() => {
    const selectedEntryName = dialog.selectedArchiveEntryName ? normalizeArchivePath(dialog.selectedArchiveEntryName) : undefined;
    if (selectedEntryName) {
      const matchedEntry = entries.find((entry) => normalizeArchivePath(entry.name).replace(/\/$/, "") === selectedEntryName.replace(/\/$/, ""));
      if (matchedEntry) {
        return archiveEntryToBrowserItem(matchedEntry);
      }
    }
    return currentItems.find((item) => item.path === selectedPath);
  }, [currentItems, dialog.selectedArchiveEntryName, entries, selectedPath]);

  useEffect(() => {
    setCurrentDir("");
    setSelectedPath(undefined);
  }, [dialog.filePath]);

  useEffect(() => {
    if (!dialog.selectedArchiveEntryName) return;
    setSelectedPath(normalizeArchivePath(dialog.selectedArchiveEntryName));
  }, [dialog.selectedArchiveEntryName]);

  const openDirectory = (directoryPath: string) => {
    setCurrentDir(normalizeArchivePath(directoryPath).replace(/\/$/, ""));
    setSelectedPath(normalizeArchivePath(directoryPath).replace(/\/$/, ""));
  };

  const openParentDirectory = () => {
    setCurrentDir(getArchiveParentPath(currentDir));
    setSelectedPath(undefined);
  };

  const openFile = (entry: ArchiveEntry) => {
    const normalizedName = normalizeArchivePath(entry.name);
    setSelectedPath(normalizedName);
    onPreviewArchiveEntry(normalizedName);
  };

  return (
    <div className="structured-preview archive-manager-preview">
      {dialog.archiveInfo?.truncated ? (
        <div className="archive-browser-warning">
          当前只读取到 {dialog.archiveInfo.displayedCount} / {dialog.archiveInfo.entryCount} 项，超出部分需要后续按目录懒加载。
        </div>
      ) : null}

      <div className="archive-browser-toolbar" aria-label="归档导航">
        <button type="button" className="archive-nav-button" onClick={openParentDirectory} disabled={!currentDir}>
          ← 上层
        </button>
        <div className="archive-address-bar" title={currentPathLabel}>
          <span>{dialog.fileName}</span>
          {currentDir ? <strong>{currentDir}</strong> : <strong>根目录</strong>}
        </div>
        <span className="archive-entry-count">{currentItems.length} 项</span>
      </div>

      <div className="archive-browser-layout">
        <aside className="archive-folder-tree" aria-label="归档文件夹">
          <button
            type="button"
            className={`archive-tree-node${currentDir ? "" : " archive-tree-node-active"}`}
            onClick={() => openDirectory("")}
          >
            <span className="archive-tree-caret">▾</span>
            <span className="archive-item-icon archive-item-icon-folder" />
            <span className="archive-tree-label" title={dialog.fileName}>{dialog.fileName}</span>
          </button>
          <div className="archive-tree-children">
            {archiveModel.children.length ? archiveModel.children.map((node) => (
              <ArchiveTreeNodeView
                key={node.path}
                node={node}
                currentDir={currentDir}
                onOpen={openDirectory}
              />
            )) : (
              <div className="archive-tree-empty">无子文件夹</div>
            )}
          </div>
        </aside>

        <section className="archive-file-panel" aria-label="当前目录内容">
          <div className="archive-preview-table">
            <div className="archive-preview-row archive-preview-head">
              <span>名称</span>
              <span>大小</span>
              <span>压缩后大小</span>
              <span>类型</span>
              <span>修改时间</span>
            </div>
            {currentDir ? (
              <button type="button" className="archive-preview-row archive-preview-entry archive-preview-entry-dir" onClick={openParentDirectory}>
                <span className="archive-preview-name">
                  <span className="archive-item-icon archive-item-icon-parent" />
                  <span>..（上层目录）</span>
                </span>
                <span>--</span>
                <span>--</span>
                <span>文件夹</span>
                <span>--</span>
              </button>
            ) : null}
            {currentItems.length ? currentItems.map((item) => (
              <button
                type="button"
                className={`archive-preview-row archive-preview-entry${item.kind === "directory" ? " archive-preview-entry-dir" : ""}${selectedPath === item.path || normalizeArchivePath(dialog.selectedArchiveEntryName || "") === item.path ? " archive-preview-entry-active" : ""}`}
                key={`${item.kind}-${item.path}-${item.modifiedAt}`}
                disabled={item.kind === "file" && dialog.archiveEntryLoading && selectedPath === item.path}
                onClick={() => {
                  if (item.kind === "directory") {
                    openDirectory(item.path);
                  } else if (item.entry) {
                    openFile(item.entry);
                  }
                }}
              >
                <span className="archive-preview-name" title={item.path}>
                  <span className={`archive-item-icon ${item.kind === "directory" ? "archive-item-icon-folder" : "archive-item-icon-file"}`} />
                  <span>{item.name}</span>
                </span>
                <span>{item.kind === "directory" ? "--" : formatBytes(item.size)}</span>
                <span>{item.kind === "directory" ? "--" : formatBytes(item.compressedSize)}</span>
                <span>{item.kind === "directory" ? "文件夹" : getArchiveFileType(item.name)}</span>
                <span>{item.modifiedAt || "--"}</span>
              </button>
            )) : (
              <div className="structured-preview-empty">当前目录为空。</div>
            )}
          </div>

          <div className="archive-detail-strip">
            {selectedItem ? (
              <>
                <strong title={selectedItem.path}>{selectedItem.name}</strong>
                <span>{selectedItem.kind === "directory" ? "文件夹" : getArchiveFileType(selectedItem.name)}</span>
                <span>{selectedItem.kind === "directory" ? "双击/点击进入目录" : `${formatBytes(selectedItem.size)} · 点击预览真实内容`}</span>
              </>
            ) : (
              <span>选择文件可预览真实内容，选择文件夹进入下一层。</span>
            )}
          </div>
        </section>
      </div>

      {(dialog.archiveEntryLoading || dialog.archiveEntryError || selectedPreview) ? (
        <div className="archive-entry-preview-pane">
          <ArchiveEntryPreviewContent
            dialog={dialog}
            preview={selectedPreview}
            theme={theme === "modern" ? "classic" : theme}
          />
        </div>
      ) : null}
    </div>
  );
}

function ArchiveTreeNodeView({
  node,
  currentDir,
  onOpen,
}: {
  node: ArchiveDirectoryNode;
  currentDir: string;
  onOpen: (path: string) => void;
}) {
  const active = currentDir === node.path;
  const expanded = active || currentDir.startsWith(`${node.path}/`);
  return (
    <div className="archive-tree-group">
      <button
        type="button"
        className={`archive-tree-node${active ? " archive-tree-node-active" : ""}`}
        onClick={() => onOpen(node.path)}
      >
        <span className="archive-tree-caret">{node.children.length ? (expanded ? "▾" : "▸") : ""}</span>
        <span className="archive-item-icon archive-item-icon-folder" />
        <span className="archive-tree-label" title={node.path}>{node.name}</span>
      </button>
      {expanded && node.children.length ? (
        <div className="archive-tree-children">
          {node.children.map((child) => (
            <ArchiveTreeNodeView key={child.path} node={child} currentDir={currentDir} onOpen={onOpen} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function normalizeArchivePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\/+/, "").replace(/\/{2,}/g, "/");
}

function getArchiveParentPath(path: string): string {
  const normalized = normalizeArchivePath(path).replace(/\/$/, "");
  const index = normalized.lastIndexOf("/");
  return index > 0 ? normalized.slice(0, index) : "";
}

function buildArchiveBrowserModel(entries: ArchiveEntry[]): ArchiveDirectoryNode {
  const root: ArchiveDirectoryNode = { name: "根目录", path: "", children: [] };
  const nodeMap = new Map<string, ArchiveDirectoryNode>([["", root]]);

  for (const entry of entries) {
    const normalized = normalizeArchivePath(entry.name).replace(/\/$/, "");
    if (!normalized) continue;
    const segments = normalized.split("/").filter(Boolean);
    const directorySegments = entry.directory ? segments : segments.slice(0, -1);
    let parent = root;
    let currentPath = "";
    for (const segment of directorySegments) {
      currentPath = currentPath ? `${currentPath}/${segment}` : segment;
      let node = nodeMap.get(currentPath);
      if (!node) {
        node = { name: segment, path: currentPath, children: [] };
        nodeMap.set(currentPath, node);
        parent.children.push(node);
        parent.children.sort(compareArchiveNodes);
      }
      parent = node;
    }
  }
  return root;
}

function getArchiveDirectoryItems(entries: ArchiveEntry[], currentDir: string): ArchiveBrowserItem[] {
  const normalizedDir = normalizeArchivePath(currentDir).replace(/\/$/, "");
  const directories = new Map<string, ArchiveBrowserItem>();
  const files: ArchiveBrowserItem[] = [];

  for (const entry of entries) {
    const normalizedEntryName = normalizeArchivePath(entry.name).replace(/\/$/, "");
    if (!normalizedEntryName) continue;
    const relativePath = getRelativeArchivePath(normalizedEntryName, normalizedDir);
    if (!relativePath) continue;
    const [firstSegment, ...restSegments] = relativePath.split("/");
    if (!firstSegment) continue;

    if (restSegments.length || entry.directory) {
      const path = normalizedDir ? `${normalizedDir}/${firstSegment}` : firstSegment;
      if (!directories.has(path)) {
        directories.set(path, {
          name: firstSegment,
          path,
          kind: "directory",
          size: 0,
          compressedSize: 0,
          modifiedAt: entry.modifiedAt,
        });
      }
      continue;
    }

    files.push(archiveEntryToBrowserItem(entry));
  }

  return [...directories.values()].sort(compareArchiveItems).concat(files.sort(compareArchiveItems));
}

function getRelativeArchivePath(entryName: string, currentDir: string): string | null {
  if (!currentDir) return entryName;
  if (entryName === currentDir) return null;
  const prefix = `${currentDir}/`;
  return entryName.startsWith(prefix) ? entryName.slice(prefix.length) : null;
}

function archiveEntryToBrowserItem(entry: ArchiveEntry): ArchiveBrowserItem {
  const normalizedPath = normalizeArchivePath(entry.name).replace(/\/$/, "");
  return {
    name: normalizedPath.split("/").pop() || normalizedPath,
    path: normalizedPath,
    kind: entry.directory ? "directory" : "file",
    entry,
    size: entry.uncompressedSize,
    compressedSize: entry.compressedSize,
    modifiedAt: entry.modifiedAt,
  };
}

function compareArchiveItems(a: ArchiveBrowserItem, b: ArchiveBrowserItem): number {
  return a.name.localeCompare(b.name, "zh-Hans-CN", { numeric: true, sensitivity: "base" });
}

function compareArchiveNodes(a: ArchiveDirectoryNode, b: ArchiveDirectoryNode): number {
  return a.name.localeCompare(b.name, "zh-Hans-CN", { numeric: true, sensitivity: "base" });
}

function getArchiveFileType(name: string): string {
  const ext = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1).toLowerCase() : "";
  if (!ext) return "文件";
  if (ext === "class") return "Java Class";
  if (["zip", "jar", "war", "ear"].includes(ext)) return `${ext.toUpperCase()} 归档`;
  if (["txt", "log", "json", "xml", "yml", "yaml", "properties", "sql", "java", "js", "ts", "tsx", "css", "html"].includes(ext)) {
    return `${ext.toUpperCase()} 文本`;
  }
  return `${ext.toUpperCase()} 文件`;
}

function ArchiveEntryPreviewContent({
  dialog,
  preview,
  theme,
}: {
  dialog: PreviewDialogState;
  preview?: FilePreviewResponse;
  theme: "classic" | "modern";
}) {
  if (dialog.archiveEntryLoading) {
    return (
      <div className="archive-entry-placeholder">
        <div className="preview-loading-spinner" />
        <span>正在读取归档内文件…</span>
      </div>
    );
  }
  if (dialog.archiveEntryError) {
    return <div className="archive-entry-placeholder archive-entry-error">{dialog.archiveEntryError}</div>;
  }
  if (!preview) {
    return <div className="archive-entry-placeholder">点击左侧文件查看真实内容；`.class` 会尝试反编译源码。</div>;
  }
  if (preview.previewKind === "class") {
    return <ClassPreview dialog={{ ...preview, filePath: preview.filePath, fileName: preview.fileName || preview.entryName || "class", originalContent: preview.content }} theme={theme} compact />;
  }
  return (
    <div className="archive-entry-code-card">
      <div className="archive-entry-code-head">
        <strong title={preview.entryName || preview.fileName}>{preview.entryName || preview.fileName}</strong>
        <span>{preview.previewLabel || "归档内文件预览"} · {formatBytes(preview.size)}</span>
      </div>
      <CodeEditor
        value={preview.content}
        fileName={preview.fileName || preview.entryName || "archive-entry.txt"}
        documentKey={`${dialog.filePath}!/${preview.entryName || preview.fileName || "archive-entry"}`}
        theme={theme === "modern" ? "classic" : theme}
        readOnly
        onChange={() => undefined}
        onSave={() => undefined}
      />
    </div>
  );
}

function ClassPreview({ dialog, theme, compact = false }: { dialog: PreviewDialogState; theme: "classic" | "modern"; compact?: boolean }) {
  const info = dialog.classInfo;
  const hasSource = Boolean(info?.decompiledSource?.trim());
  const [activePanel, setActivePanel] = useState<"source" | "structure">(hasSource ? "source" : "structure");
  const readableSource = useMemo(() => decodeJavaUnicodeEscapes(info?.decompiledSource || ""), [info?.decompiledSource]);
  const sourceLines = useMemo(() => readableSource.split(/\r?\n/), [readableSource]);
  const sourceIndex = useMemo(() => buildClassSourceIndex(sourceLines, info?.className), [sourceLines, info?.className]);
  const [sourceFocusLine, setSourceFocusLine] = useState<number | null>(null);
  const [sourceFocusToken, setSourceFocusToken] = useState(0);
  const [sourceSearchToken, setSourceSearchToken] = useState(0);
  const [activeOutlineKey, setActiveOutlineKey] = useState("class");
  const simpleName = getClassSimpleName(info?.className || "");
  const packageName = getClassPackageName(info?.className || "");
  const openSourceSearch = useCallback(() => {
    if (!hasSource) {
      return;
    }
    setActivePanel("source");
    setSourceSearchToken((token) => token + 1);
  }, [hasSource]);

  useEffect(() => {
    setActivePanel(hasSource ? "source" : "structure");
    setSourceFocusLine(sourceIndex.classLine || 1);
    setSourceFocusToken((token) => token + 1);
    setActiveOutlineKey("class");
  }, [dialog.filePath, info?.className, hasSource, sourceIndex.classLine]);

  useEffect(() => {
    if (!hasSource) {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "f") {
        event.preventDefault();
        event.stopPropagation();
        openSourceSearch();
      }
    };
    window.addEventListener("keydown", handleKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", handleKeyDown, { capture: true });
  }, [hasSource, openSourceSearch]);

  if (!info) {
    return <div className="structured-preview structured-preview-empty">未读取到 class 结构信息。</div>;
  }

  const jumpToSource = (line: number | undefined, outlineKey: string) => {
    setActivePanel(hasSource ? "source" : "structure");
    setActiveOutlineKey(outlineKey);
    if (hasSource) {
      setSourceFocusLine(line || sourceIndex.classLine || 1);
      setSourceFocusToken((token) => token + 1);
    }
  };

  return (
    <div className={`structured-preview class-ide-preview${compact ? " class-preview-compact" : ""}`}>
      <div className="class-ide-toolbar">
        <div className="class-ide-title">
          <span className="class-ide-icon">C</span>
          <div>
            <strong title={info.className}>{simpleName}</strong>
            <span title={packageName || info.className}>{packageName || "默认包"}</span>
          </div>
        </div>
        <div className="class-ide-badges">
          <span>{info.javaVersion}</span>
          <span>Class {info.version}</span>
          <span>{info.fields.length} 字段</span>
          <span>{info.methods.length} 方法</span>
          <span className={hasSource ? "class-ide-badge-ok" : "class-ide-badge-warn"}>
            {hasSource ? "已反编译" : "结构预览"}
          </span>
        </div>
        <div className="class-ide-tabs" role="tablist" aria-label="Class 预览视图">
          {hasSource ? (
            <button
              type="button"
              className="class-ide-search-tab"
              title="搜索源码（Ctrl/⌘F）"
              onClick={openSourceSearch}
            >
              搜索源码
            </button>
          ) : null}
          {hasSource ? (
            <button
              type="button"
              className={activePanel === "source" ? "class-ide-tab-active" : ""}
              onClick={() => setActivePanel("source")}
            >
              源码
            </button>
          ) : null}
          <button
            type="button"
            className={activePanel === "structure" ? "class-ide-tab-active" : ""}
            onClick={() => setActivePanel("structure")}
          >
            结构
          </button>
        </div>
      </div>

      <div className="class-ide-body">
        <aside className="class-ide-outline">
          <div className="class-outline-block">
            <span className="class-outline-label">类</span>
            <button
              type="button"
              className={`class-outline-row${activeOutlineKey === "class" ? " class-outline-row-active" : ""}`}
              onClick={() => jumpToSource(sourceIndex.classLine, "class")}
            >
              <span className="class-outline-symbol class-outline-symbol-class">C</span>
              <strong title={info.className}>{simpleName}</strong>
            </button>
          </div>
          <ClassOutlineSection
            title={`字段 ${info.fields.length}`}
            members={info.fields}
            symbol="F"
            activeKey={activeOutlineKey}
            getLine={(member) => sourceIndex.fields.get(member.name)}
            onSelect={(member, key) => jumpToSource(sourceIndex.fields.get(member.name), key)}
          />
          <ClassOutlineSection
            title={`方法 ${info.methods.length}`}
            members={info.methods}
            symbol="M"
            activeKey={activeOutlineKey}
            getLine={(member) => sourceIndex.methods.get(member.name) || sourceIndex.methods.get(normalizeClassMethodName(member.name, simpleName))}
            onSelect={(member, key) => jumpToSource(sourceIndex.methods.get(member.name) || sourceIndex.methods.get(normalizeClassMethodName(member.name, simpleName)), key)}
          />
        </aside>

        <main className="class-ide-main">
          {activePanel === "source" && hasSource ? (
            <div className="class-source-preview class-ide-source">
              <CodeEditor
                value={readableSource}
                fileName={`${simpleName || "Decompiled"}.java`}
                documentKey={`${dialog.filePath}#decompiled`}
                theme={theme === "modern" ? "classic" : theme}
                focusLine={sourceFocusLine}
                focusLineToken={sourceFocusToken}
                openSearchToken={sourceSearchToken}
                readOnly
                onChange={() => undefined}
                onSave={() => undefined}
              />
            </div>
          ) : (
            <div className="class-structure-panel">
              <div className="class-structure-message">
                <strong>{info.decompileMessage || "当前展示 class 元数据结构。"}</strong>
                <span>{hasSource ? "可切回源码查看 CFR 反编译结果。" : "未拿到可展示源码时，保留字段、方法、继承信息用于排查。"}</span>
              </div>
              <div className="class-preview-summary">
                <InfoLine label="文件头" value={info.magic} />
                <InfoLine label="版本" value={info.version} />
                <InfoLine label="访问标志" value={info.accessFlags} />
                <InfoLine label="父类" value={info.superClass} />
                <InfoLine label="接口" value={info.interfaces.length ? info.interfaces.join(", ") : "-"} wide />
                <InfoLine label="常量池" value={`${info.constantPoolCount} 项`} />
              </div>

              <MemberSection title={`字段 ${info.fields.length}`} members={info.fields} emptyText="当前 class 未声明字段。" />
              <MemberSection title={`方法 ${info.methods.length}`} members={info.methods} emptyText="当前 class 未声明方法。" />
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="structured-preview-metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function InfoLine({ label, value, wide = false }: { label: string; value: string; wide?: boolean }) {
  return (
    <div className={`class-preview-info-line${wide ? " class-preview-info-line-wide" : ""}`}>
      <span>{label}</span>
      <strong title={value}>{value}</strong>
    </div>
  );
}

function ClassOutlineSection({
  title,
  members,
  symbol,
  activeKey,
  getLine,
  onSelect,
}: {
  title: string;
  members: Array<{ access: string; name: string; descriptor: string; display: string }>;
  symbol: string;
  activeKey: string;
  getLine: (member: { access: string; name: string; descriptor: string; display: string }) => number | undefined;
  onSelect: (member: { access: string; name: string; descriptor: string; display: string }, key: string) => void;
}) {
  return (
    <div className="class-outline-block">
      <span className="class-outline-label">{title}</span>
      <div className="class-outline-list">
        {members.length ? members.map((member, index) => {
          const key = `${symbol}:${member.name}:${member.descriptor}:${index}`;
          const line = getLine(member);
          return (
            <button
              type="button"
              className={`class-outline-row${activeKey === key ? " class-outline-row-active" : ""}`}
              key={key}
              title={line ? `${member.display} · 第 ${line} 行` : member.display}
              onClick={() => onSelect(member, key)}
            >
              <span className={`class-outline-symbol ${symbol === "F" ? "class-outline-symbol-field" : "class-outline-symbol-method"}`}>{symbol}</span>
              <strong>{member.name}</strong>
              <span>{line ? `${member.access} · ${line}` : member.access}</span>
            </button>
          );
        }) : (
          <div className="class-outline-empty">未读取到 class 结构信息</div>
        )}
      </div>
    </div>
  );
}

function MemberSection({
  title,
  members,
  emptyText,
}: {
  title: string;
  members: Array<{ access: string; name: string; descriptor: string; display: string }>;
  emptyText: string;
}) {
  return (
    <section className="class-preview-section">
      <h4>{title}</h4>
      <div className="class-member-table">
        {members.length ? members.map((member, index) => (
          <div className="class-member-row" key={`${member.name}-${member.descriptor}-${index}`}>
            <span className="class-member-access">{member.access}</span>
            <span className="class-member-name">{member.name}</span>
            <span className="class-member-descriptor" title={member.descriptor}>{member.descriptor}</span>
          </div>
        )) : (
          <div className="structured-preview-empty">{emptyText}</div>
        )}
      </div>
    </section>
  );
}

function getClassSimpleName(className: string): string {
  const lastDot = className.lastIndexOf(".");
  return (lastDot >= 0 ? className.slice(lastDot + 1) : className) || "UnknownClass";
}

function getClassPackageName(className: string): string {
  const lastDot = className.lastIndexOf(".");
  return lastDot > 0 ? className.slice(0, lastDot) : "";
}

function decodeJavaUnicodeEscapes(source: string): string {
  return source.replace(/\\u([0-9a-fA-F]{4})/g, (_match, hex: string) => {
    return String.fromCharCode(Number.parseInt(hex, 16));
  });
}

function normalizeClassMethodName(name: string, simpleName: string): string {
  return name === "<init>" ? simpleName : name;
}

function buildClassSourceIndex(lines: string[], className?: string) {
  const simpleName = className ? getClassSimpleName(className) : "";
  const fields = new Map<string, number>();
  const methods = new Map<string, number>();
  let classLine = 0;

  lines.forEach((line, index) => {
    const lineNumber = index + 1;
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("@")) {
      return;
    }

    if (simpleName && !classLine && new RegExp(`\\b(class|interface|enum)\\s+${escapeRegExp(simpleName)}\\b`).test(trimmed)) {
      classLine = lineNumber;
    }

    const methodName = getJavaMethodName(trimmed, simpleName);
    if (methodName && !methods.has(methodName)) {
      methods.set(methodName, lineNumber);
    }

    const fieldName = getJavaFieldName(trimmed);
    if (fieldName && !fields.has(fieldName)) {
      fields.set(fieldName, lineNumber);
    }
  });

  if (simpleName && !methods.has(simpleName)) {
    const constructorLine = lines.findIndex((line) => new RegExp(`\\b${escapeRegExp(simpleName)}\\s*\\(`).test(line));
    if (constructorLine >= 0) {
      methods.set(simpleName, constructorLine + 1);
      methods.set("<init>", constructorLine + 1);
    }
  }

  return { classLine: classLine || 1, fields, methods };
}

function getJavaMethodName(trimmedLine: string, simpleName: string): string | null {
  if (!trimmedLine.includes("(") || trimmedLine.includes("=") || trimmedLine.startsWith("if ") || trimmedLine.startsWith("for ") || trimmedLine.startsWith("while ") || trimmedLine.startsWith("switch ")) {
    return null;
  }
  const beforeParen = trimmedLine.slice(0, trimmedLine.indexOf("(")).trim();
  const name = beforeParen.split(/\s+/).pop()?.replace(/[<{].*$/, "");
  if (!name || ["if", "for", "while", "switch", "catch", "return", "new"].includes(name)) {
    return null;
  }
  if (simpleName && name === simpleName) {
    return "<init>";
  }
  return name;
}

function getJavaFieldName(trimmedLine: string): string | null {
  if (!trimmedLine.endsWith(";") || trimmedLine.includes("(")) {
    return null;
  }
  const withoutValue = trimmedLine.replace(/=.*/, "").replace(/;$/, "").trim();
  const name = withoutValue.split(/\s+/).pop()?.replace(/\[\]$/, "");
  if (!name || ["return", "throw", "break", "continue"].includes(name)) {
    return null;
  }
  return name;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
