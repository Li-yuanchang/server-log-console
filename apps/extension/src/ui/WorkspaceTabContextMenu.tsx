import type { WorkspaceSession } from "./types.js";
import { ContextMenuShell } from "./ContextMenuShell.js";

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
  onCloseOtherSessions: (keepSessionId: string) => void;
};

export function WorkspaceTabContextMenu(props: WorkspaceTabContextMenuProps) {
  const { menu, menuRef, onClose, onCopyServerName, onCopyServerHost, onCreateServer, onCloseSession, onCloseOtherSessions } = props;

  if (!menu) return null;

  /* 内容指纹：有无「复制主机地址」项会改变高度，必须纳入重算条件 */
  const contentKey = `${menu.session.id}|${menu.session.serverHost ? "host" : "nohost"}`;

  return (
    <ContextMenuShell x={menu.x} y={menu.y} menuRef={menuRef} contentKey={contentKey}>
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
        <div role="button" className="context-menu-item" onClick={() => {
          onClose();
          onCloseOtherSessions(menu.session.id);
        }}>
          关闭其他工作区
        </div>
        <div role="button" className="context-menu-item context-menu-danger" onClick={() => {
          onClose();
          onCloseSession(menu.session.id);
        }}>
          关闭工作区
        </div>
    </ContextMenuShell>
  );
}
