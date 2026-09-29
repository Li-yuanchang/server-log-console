import type { LogFileEntry } from "@server-log-console/shared";
import type { RefObject } from "react";

export interface FileContextMenuState {
  x: number;
  y: number;
  entry: LogFileEntry;
}

interface FileContextMenuProps {
  menu: FileContextMenuState | null;
  menuRef: RefObject<HTMLDivElement | null>;
  onClose: () => void;
  onOpen: (entry: LogFileEntry) => void;
  onPreview: (entry: LogFileEntry) => void;
  onDownload: (path: string) => void;
  onRename: (entry: LogFileEntry) => void;
  onMove: (entry: LogFileEntry) => void;
  onExtractHere: (path: string) => void;
  onExtractTo: (entry: LogFileEntry) => void;
  onCompress: (entry: LogFileEntry) => void;
  onMkdir: (parentDir: string) => void;
  onDelete: (entry: LogFileEntry) => void;
  onCopyPath: (entry: LogFileEntry) => void;
  onCopyName: (entry: LogFileEntry) => void;
}

function isArchiveFile(entry: LogFileEntry) {
  return entry.kind === "file" && /\.(zip|tar\.gz|tgz|tar\.bz2|tar\.xz|gz)$/i.test(entry.name);
}

export function FileContextMenu(props: FileContextMenuProps) {
  const {
    menu,
    menuRef,
    onClose,
    onOpen,
    onPreview,
    onDownload,
    onRename,
    onMove,
    onExtractHere,
    onExtractTo,
    onCompress,
    onMkdir,
    onDelete,
    onCopyPath,
    onCopyName,
  } = props;

  if (!menu) {
    return null;
  }

  const isFile = menu.entry.kind === "file";

  return (
    <div className="context-menu-backdrop">
      <div
        ref={menuRef}
        className="context-menu"
        style={{ left: menu.x, top: menu.y }}
        onClick={(event) => event.stopPropagation()}
        onContextMenu={(event) => {
          event.preventDefault();
          event.stopPropagation();
        }}
      >
        {/* 组①：打开 / 预览 · 下载 */}
        <div role="button" className="context-menu-item" onClick={() => { onClose(); onOpen(menu.entry); }}>
          {isFile ? "打开 / 预览" : "打开"}
        </div>
        {isFile ? (
          <div role="button" className="context-menu-item" onClick={() => { onClose(); onDownload(menu.entry.path); }}>
            下载
            <span className="context-menu-key">⌘D</span>
          </div>
        ) : null}
        <div className="context-menu-separator" role="separator" />
        {/* 组②：编辑 · 移动 · 重命名 · 复制 · 压缩 */}
        {isFile ? (
          <div role="button" className="context-menu-item" onClick={() => { onClose(); onPreview(menu.entry); }}>
            编辑
          </div>
        ) : null}
        <div role="button" className="context-menu-item" onClick={() => { onClose(); onMove(menu.entry); }}>
          移动到
        </div>
        <div role="button" className="context-menu-item" onClick={() => { onClose(); onRename(menu.entry); }}>
          重命名
          <span className="context-menu-key">F2</span>
        </div>
        <div role="button" className="context-menu-item" onClick={() => { onClose(); onCopyPath(menu.entry); }}>
          复制远程路径
        </div>
        <div role="button" className="context-menu-item" onClick={() => { onClose(); onCopyName(menu.entry); }}>
          复制文件名
        </div>
        {isArchiveFile(menu.entry) ? (
          <>
            <div role="button" className="context-menu-item" onClick={() => { onClose(); onExtractHere(menu.entry.path); }}>
              解压到当前目录
            </div>
            <div role="button" className="context-menu-item" onClick={() => { onClose(); onExtractTo(menu.entry); }}>
              解压到...
            </div>
          </>
        ) : null}
        <div role="button" className="context-menu-item" title="打包为 zip 归档" onClick={() => { onClose(); onCompress(menu.entry); }}>
          压缩为 zip
        </div>
        {!isFile ? (
          <div role="button" className="context-menu-item" onClick={() => { onClose(); onMkdir(menu.entry.path); }}>
            新建子目录
          </div>
        ) : null}
        <div className="context-menu-separator" role="separator" />
        {/* 组③：删除 */}
        <div role="button" className="context-menu-item context-menu-danger" onClick={() => { onClose(); onDelete(menu.entry); }}>
          删除
          <span className="context-menu-key">⌫</span>
        </div>
      </div>
    </div>
  );
}
