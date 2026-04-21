import type { WorkspaceSession } from "./types.js";

export type WorkspaceTabMenuState = {
  x: number;
  y: number;
  session: WorkspaceSession;
};

export type WorkspaceTabContextMenuProps = {
  menu: WorkspaceTabMenuState | null;
  menuRef: React.RefObject<HTMLDivElement | null>;
  onClose: () => void;
  onCopyServerName: (session: WorkspaceSession) => void;
  onCopyServerHost: (session: WorkspaceSession) => void;
  onCreateServer: () => void;
  onCloseSession: (sessionId: string) => void;
};

export function WorkspaceTabContextMenu(props: WorkspaceTabContextMenuProps) {
  const { menu, menuRef, onClose, onCopyServerName, onCopyServerHost, onCreateServer, onCloseSession } = props;

  if (!menu) return null;

  return (
    <div className="context-menu-backdrop">
      <div
        ref={menuRef}
        className="context-menu"
        style={{ left: menu.x, top: menu.y }}
        onClick={(event) => event.stopPropagation()}
        onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); }}
      >
        <div role="button" className="context-menu-item" onClick={() => {
          onClose();
          onCopyServerName(menu.session);
        }}>
          复制服务器名称
        </div>
        {menu.session.serverHost ? (
          <div role="button" className="context-menu-item" onClick={() => {
            onClose();
            onCopyServerHost(menu.session);
          }}>
            复制主机地址
          </div>
        ) : null}
        <div role="button" className="context-menu-item" onClick={() => {
          onClose();
          onCreateServer();
        }}>
          新增服务器
        </div>
        <div role="button" className="context-menu-item context-menu-danger" onClick={() => {
          onClose();
          onCloseSession(menu.session.id);
        }}>
          关闭工作区
        </div>
      </div>
    </div>
  );
}
